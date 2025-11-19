"""Utilities for extracting Java sources from PDF text pages."""
from __future__ import annotations

import io
import re
import zipfile
from typing import Dict, Iterable, List

import pdfplumber
import pypdfium2 as pdfium

FILENAME_PATTERN = re.compile(r"([A-Za-z0-9_]+\.java)")
CODE_START_HINTS = (
    "package ",
    "import ",
    "public ",
    "class ",
    "interface ",
    "enum ",
    "@",
)


def _preprocess_page_text(text: str) -> str:
    """Remove printed headers and leading line numbers."""
    if not text:
        return ""
    lines = text.splitlines()
    # Drop the first two header lines (e.g., filename + printed timestamp)
    content_lines = lines[2:] if len(lines) > 2 else []
    cleaned: List[str] = []
    for line in content_lines:
        if re.match(r"^\s*\d+\s*$", line):
            cleaned.append("")
            continue
        match = re.match(r"^\s*\d+(\s+)(.*)$", line)
        if match:
            spacing, remainder = match.groups()
            keep_spacing = spacing[1:] if len(spacing) > 1 else ""
            cleaned.append(f"{keep_spacing}{remainder}")
        else:
            cleaned.append(line)
    return "\n".join(cleaned).strip()


def _extract_filename(text: str) -> str | None:
    """Return the first plausible *.java filename contained in the text."""
    lines = text.splitlines()
    header_slice = lines[:5]
    for line in header_slice:
        match = FILENAME_PATTERN.search(line)
        if match:
            return match.group(1)
    match = FILENAME_PATTERN.search(text)
    if match:
        return match.group(1)
    return None


def _extract_code_block(text: str) -> str | None:
    """Grab the code portion by finding the first code-like line."""
    lines = [line.rstrip() for line in text.splitlines()]
    code_start_idx = None
    for idx, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        normalized = stripped.lower()
        if any(stripped.startswith(prefix) for prefix in CODE_START_HINTS):
            code_start_idx = idx
            break
        if normalized.startswith(("/*", "//")):
            # Comments at the very top probably belong to the code block
            code_start_idx = idx
            break
    if code_start_idx is None:
        # fallback to very first non-empty line
        for idx, line in enumerate(lines):
            if line.strip():
                code_start_idx = idx
                break
    if code_start_idx is None:
        return None
    code = "\n".join(lines[code_start_idx:]).strip()
    return code or None


def extract_sources_from_pages(page_texts: Iterable[str]) -> Dict[str, str]:
    """Transform page texts into a mapping of filename -> source code."""
    sources: Dict[str, str] = {}
    for page_idx, text in enumerate(page_texts, start=1):
        if not text:
            continue
        filename = _extract_filename(text) or f"Page_{page_idx}.java"
        cleaned_text = _preprocess_page_text(text)
        code_block = _extract_code_block(cleaned_text)
        if not code_block:
            continue
        final_name = filename
        # Ensure we do not accidentally overwrite duplicates
        dedupe_suffix = 1
        while final_name in sources:
            stem = filename[:-5] if filename.lower().endswith(".java") else filename
            dedupe_suffix += 1
            final_name = f"{stem}_{dedupe_suffix}.java"
        sources[final_name] = code_block if code_block.endswith("\n") else f"{code_block}\n"
    return sources


def _extract_texts_with_pdfium(pdf_bytes: bytes) -> List[str]:
    doc = pdfium.PdfDocument(pdf_bytes)
    texts: List[str] = []
    try:
        for page_index in range(len(doc)):
            page = doc.get_page(page_index)
            try:
                textpage = page.get_textpage()
                texts.append(textpage.get_text_range() or "")
            finally:
                textpage.close()
                page.close()
    finally:
        doc.close()
    return texts


def _extract_texts_with_pdfplumber(pdf_bytes: bytes) -> List[str]:
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        return [page.extract_text() or "" for page in pdf.pages]


def parse_pdf_bytes(pdf_bytes: bytes) -> Dict[str, str]:
    """Read PDF bytes and return filename -> source mapping."""
    if not pdf_bytes:
        raise ValueError("PDF file is empty")

    texts: List[str] = []
    pdfium_error: Exception | None = None
    try:
        texts = _extract_texts_with_pdfium(pdf_bytes)
    except Exception as exc:  # pragma: no cover - depends on file contents
        pdfium_error = exc

    if not texts:
        try:
            texts = _extract_texts_with_pdfplumber(pdf_bytes)
        except Exception as exc:  # pragma: no cover - depends on file contents
            if pdfium_error:
                raise RuntimeError(
                    "Failed to extract PDF text using both pypdfium2 and pdfplumber",
                ) from exc
            raise

    sources = extract_sources_from_pages(texts)
    return sources


def build_zip_from_sources(sources: Dict[str, str]) -> bytes:
    """Create an in-memory ZIP archive from the extracted sources."""
    if not sources:
        raise ValueError("No sources to add to archive")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for filename, code in sources.items():
            zf.writestr(filename, code)
    buffer.seek(0)
    return buffer.getvalue()
