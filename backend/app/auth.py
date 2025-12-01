import os
from datetime import datetime, timedelta
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlmodel import Session, select
from app.models import User
from app.database import get_session

# 設定値
# 本番環境では環境変数から読み込むようにします
SECRET_KEY = os.getenv("SECRET_KEY", "dev_secret_key_change_me")
ALGORITHM = "HS256" # 暗号化アルゴリズム
ACCESS_TOKEN_EXPIRE_MINUTES = 30 # トークンの有効期限 (分)

# パスワードハッシュ化の設定 (bcryptを使用)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# OAuth2 の設定 (トークン取得用URLを指定)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/token")

# パスワードの検証
# 入力された平文パスワードと、保存されているハッシュ化パスワードが一致するか確認します
def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

# パスワードのハッシュ化
# 平文パスワードをハッシュ化して返します
def get_password_hash(password):
    return pwd_context.hash(password)

# アクセストークン (JWT) の作成
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    
    # 有効期限 (exp) をペイロードに追加
    to_encode.update({"exp": expire})
    
    # 秘密鍵を使って署名し、JWTを作成
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

# 現在ログインしているユーザーを取得する依存関係関数
# エンドポイントの引数として使うことで、認証済みユーザーのみアクセス可能にします
async def get_current_user(token: str = Depends(oauth2_scheme), session: Session = Depends(get_session)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        # トークンをデコードして検証
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    # ユーザー名からデータベースを検索
    statement = select(User).where(User.username == username)
    user = session.exec(statement).first()
    if user is None:
        raise credentials_exception
    return user

# 管理者権限を確認する依存関係関数
# get_current_user で取得したユーザーが管理者かどうかチェックします
async def get_current_admin(current_user: User = Depends(get_current_user)):
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required"
        )
    return current_user

