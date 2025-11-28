from __future__ import annotations

import io

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from .pdf_extractor import build_zip_from_sources, generate_file_map, parse_pdf_bytes

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


@app.post("/extract", response_model=None)
async def extract_java_sources(
    pdf: UploadFile = File(...),
    base_directory: str = Form(""),
    response_format: str = Form("zip"),
) -> StreamingResponse | JSONResponse:
    if not pdf.filename or not pdf.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file")
    pdf_bytes = await pdf.read()
    try:
        sources = parse_pdf_bytes(pdf_bytes)
    except ValueError as exc:  # user input issue
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not sources:
        raise HTTPException(status_code=422, detail="No Java sources found in PDF")
    
    if response_format == "json":
        file_map = generate_file_map(sources, base_dir=base_directory)
        return JSONResponse(content=file_map)
    
    zip_bytes = build_zip_from_sources(sources, base_dir=base_directory)
    
    headers = {"Content-Disposition": 'attachment; filename="java_sources.zip"'}
    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers=headers,
    )
