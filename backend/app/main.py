from __future__ import annotations

import io

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from .pdf_extractor import build_zip_from_sources, parse_pdf_bytes

app = FastAPI(title="PDF Java Extractor", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})


@app.post("/extract")
async def extract_java_sources(pdf: UploadFile = File(...)) -> StreamingResponse:
    if not pdf.filename or not pdf.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file")
    pdf_bytes = await pdf.read()
    try:
        sources = parse_pdf_bytes(pdf_bytes)
    except ValueError as exc:  # user input issue
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not sources:
        raise HTTPException(status_code=422, detail="No Java sources found in PDF")
    zip_bytes = build_zip_from_sources(sources)
    headers = {"Content-Disposition": 'attachment; filename="java_sources.zip"'}
    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers=headers,
    )
