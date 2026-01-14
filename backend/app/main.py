from __future__ import annotations

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.pdf_extractor import parse_pdf_bytes, build_zip_from_sources, generate_file_map

# FastAPI アプリケーションのインスタンスを作成します
app = FastAPI()

# CORS (Cross-Origin Resource Sharing) の設定
origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ヘルスチェック用エンドポイント
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
        # PDFからJavaソースコードを抽出する処理
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
