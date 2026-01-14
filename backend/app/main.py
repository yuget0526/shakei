

from __future__ import annotations

import io
import os
import uuid
from typing import List
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, status
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session, select

from app.pdf_extractor import parse_pdf_bytes, build_zip_from_sources, generate_file_map
from app.models import User, InvitationCode
from app.database import init_db, get_session
from app.auth import (
    get_password_hash,
    verify_password,
    create_access_token,
    get_current_user,
    get_current_admin,
    ACCESS_TOKEN_EXPIRE_MINUTES
)
from datetime import timedelta

# FastAPI アプリケーションのインスタンスを作成します
app = FastAPI()

# CORS (Cross-Origin Resource Sharing) の設定
# フロントエンド (http://localhost:3000) からのアクセスを許可します
origins = [
    "*"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"], # 全ての HTTP メソッド (GET, POST など) を許可
    allow_headers=["*"], # 全てのヘッダーを許可
)

# アプリケーション起動時に実行される処理
@app.on_event("startup")
def on_startup():
    # データベースの初期化 (テーブル作成など)
    init_db()
    
    # 管理者ユーザーが存在しない場合、環境変数から作成します
    # get_session ジェネレータからセッションを取得する少し特殊な書き方です
    with Session(get_session().__next__().bind) as session: 
        admin_username = os.getenv("ADMIN_USERNAME", "admin")
        statement = select(User).where(User.username == admin_username)
        admin = session.exec(statement).first()
        
        # 管理者がまだいなければ作成
        if not admin:
            admin_password = os.getenv("ADMIN_PASSWORD", "admin")
            hashed_password = get_password_hash(admin_password)
            admin_user = User(username=admin_username, hashed_password=hashed_password, is_admin=True)
            session.add(admin_user)
            session.commit()
            print(f"Admin user '{admin_username}' created.")

# ログイン用エンドポイント
# ユーザー名とパスワードを受け取り、正しければアクセストークン (JWT) を返します
@app.post("/auth/token")
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    session: Session = Depends(get_session)
):
    # データベースからユーザーを検索
    statement = select(User).where(User.username == form_data.username)
    user = session.exec(statement).first()
    
    # ユーザーがいない、またはパスワードが間違っている場合
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # アクセストークンの有効期限を設定 (デフォルト30分)
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    # トークンを作成
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    # トークンと管理者フラグを返す
    return {"access_token": access_token, "token_type": "bearer", "is_admin": user.is_admin}

# ユーザー登録用エンドポイント
# 招待コードが必要です
@app.post("/auth/register")
async def register(
    username: str = Form(...),
    password: str = Form(...),
    invitation_code: str = Form(...),
    session: Session = Depends(get_session)
):
    # 招待コードのチェック
    statement = select(InvitationCode).where(InvitationCode.code == invitation_code)
    invite = session.exec(statement).first()
    
    # コードが無効、または既に使用されている場合
    if not invite:
        raise HTTPException(status_code=400, detail="Invalid invitation code")
    if invite.is_used:
        raise HTTPException(status_code=400, detail="Invitation code already used")

    # ユーザー名が既に使用されていないかチェック
    statement = select(User).where(User.username == username)
    existing_user = session.exec(statement).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already registered")

    # パスワードをハッシュ化してユーザーを作成
    hashed_password = get_password_hash(password)
    new_user = User(username=username, hashed_password=hashed_password)
    session.add(new_user)
    
    # 招待コードを使用済みに更新
    invite.is_used = True
    
    # ユーザーを先に保存してIDを確定させる
    session.commit()
    session.refresh(new_user)
    
    # 招待コードに、誰が使ったかを記録
    invite.used_by_user_id = new_user.id
    session.add(invite)
    session.commit()

    return {"message": "User created successfully"}

# 招待コード生成エンドポイント (管理者専用)
@app.post("/auth/invite")
async def generate_invite(
    current_user: User = Depends(get_current_admin), # 管理者権限が必要
    session: Session = Depends(get_session)
):
    # ランダムなUUIDを生成して招待コードとする
    code = str(uuid.uuid4())
    invite = InvitationCode(code=code)
    session.add(invite)
    session.commit()
    return {"code": code}

# 招待コード一覧取得エンドポイント (管理者専用)
@app.get("/auth/invites")
async def list_invites(
    current_user: User = Depends(get_current_admin), # 管理者権限が必要
    session: Session = Depends(get_session)
):
    # 作成日時の新しい順に取得
    statement = select(InvitationCode).order_by(InvitationCode.created_at.desc())
    invites = session.exec(statement).all()
    return invites

# ヘルスチェック用エンドポイント
# サーバーが正常に動いているか確認するために使います
@app.get("/health")
def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})

# PDF抽出メインエンドポイント
# 認証不要 - 誰でもアクセス可能
@app.post("/extract", response_model=None)
async def extract_java_sources(
    pdf: UploadFile = File(...),
    base_directory: str = Form(""),
    response_format: str = Form("zip"),
) -> StreamingResponse | JSONResponse:
    # PDFファイルかどうかのチェック
    if not pdf.filename or not pdf.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")

    try:
        # PDFの中身を読み込む
        contents = await pdf.read()
        # PDFからJavaソースコードを抽出する処理 (pdf_extractor.py)
        sources = parse_pdf_bytes(contents)
        
        if not sources:
             raise HTTPException(status_code=400, detail="No Java source code found in PDF")

        if response_format == "json":
             # JSON形式で返す場合 (プレビュー用)
             file_map = generate_file_map(sources, base_directory)
             return JSONResponse(content=file_map)
        else:
            # ZIPファイルとして返す場合 (ダウンロード用)
            zip_bytes = build_zip_from_sources(sources, base_directory)
            
            return StreamingResponse(
                iter([zip_bytes]),
                media_type="application/zip",
                headers={"Content-Disposition": f"attachment; filename=extracted_sources.zip"}
            )

    except Exception as e:
        print(f"Error extracting PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))


