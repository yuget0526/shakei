"""Utilities for extracting source code from PDF text pages."""
from __future__ import annotations

import io
import re
import zipfile
from typing import Dict, List, Tuple

import fitz  # PyMuPDF - best for Japanese and spacing
import pdfplumber
import pypdfium2 as pdfium

# Supported file patterns
JAVA_FILENAME_PATTERN = re.compile(r"([A-Za-z0-9_]+\.java)")
PHP_FILENAME_PATTERN = re.compile(r"([A-Za-z0-9_]+\.php)")

# Code start hints for Java
JAVA_CODE_START_HINTS = (
    "package ",
    "import ",
    "public ",
    "class ",
    "interface ",
    "enum ",
    "@",
)

# Code start hints for PHP
PHP_CODE_START_HINTS = (
    "<?php",
    "<?",
    "namespace ",
    "use ",
    "class ",
    "interface ",
    "trait ",
    "function ",
)


def _extract_filename_and_page_info(text: str) -> Tuple[str | None, int | None, int | None]:
    """
    Extract filename and page info (current/total) from header.
    Returns: (filename, current_page, total_pages)
    """
    lines = text.splitlines()[:5]
    
    for line in lines:
        # Try Java first
        java_match = JAVA_FILENAME_PATTERN.search(line)
        if java_match:
            filename = java_match.group(1)
            # Look for "Page X/Y" pattern
            page_match = re.search(r"Page\s+(\d+)/(\d+)", line)
            if page_match:
                return filename, int(page_match.group(1)), int(page_match.group(2))
            return filename, 1, 1
        
        # Try PHP
        php_match = PHP_FILENAME_PATTERN.search(line)
        if php_match:
            filename = php_match.group(1)
            page_match = re.search(r"Page\s+(\d+)/(\d+)", line)
            if page_match:
                return filename, int(page_match.group(1)), int(page_match.group(2))
            return filename, 1, 1
    
    return None, None, None


def _preprocess_page_text(text: str) -> str:
    """Remove printed headers and extract code with proper empty lines.
    
    PyMuPDF format:
    - Header lines: Page info, Filename, Printed timestamp, Printed for
    - Then alternating: code line, line number, code line, line number...
    
    We parse line numbers to detect gaps (which represent empty lines in the original).
    """
    if not text:
        return ""
    lines = text.splitlines()
    
    # Find where header ends (look for first line that's not header-like)
    header_end = 0
    for i, line in enumerate(lines):
        stripped = line.strip()
        # Skip obvious header lines
        if stripped.startswith('Page ') and '/' in stripped:
            header_end = i + 1
            continue
        if stripped.startswith('Printed'):
            header_end = i + 1
            continue
        # Check if it's a filename line (contains .java or .php)
        if re.search(r'\.(java|php)$', stripped, re.IGNORECASE):
            header_end = i + 1
            continue
        break
    
    content_lines = lines[header_end:]
    
    # Parse content: extract (line_number, code_line) pairs
    # PyMuPDF outputs: code_line, line_number, code_line, line_number...
    # Note: Multiple code lines may belong to the same line number
    parsed: List[Tuple[int, str]] = []
    current_code_parts: List[str] = []
    
    for line in content_lines:
        stripped = line.strip()
        
        # Check if this line is just a line number
        if re.match(r"^\d+$", stripped):
            line_num = int(stripped)
            if current_code_parts:
                # Join multiple code parts (they belong to the same logical line)
                # If previous part ends with space, direct join; otherwise add space
                combined_code = ""
                for part in current_code_parts:
                    if combined_code and not combined_code.endswith((" ", "\t")):
                        combined_code += " "
                    combined_code += part
                parsed.append((line_num, combined_code))
                current_code_parts = []
            else:
                # Line number without code = empty line
                parsed.append((line_num, ""))
        else:
            # This is a code line
            # Skip ellipsis (used as continuation marker in some PDFs)
            if stripped == "…" or stripped == "...":
                continue
            
            # For lines with leading line numbers (pypdfium2 format)
            match = re.match(r"^\s*\d+(\s+)(.*)$", line)
            if match:
                spacing, remainder = match.groups()
                keep_spacing = spacing[1:] if len(spacing) > 1 else ""
                current_code_parts.append(f"{keep_spacing}{remainder}")
            else:
                current_code_parts.append(line)
    
    # If there's remaining code without a line number, add it
    if current_code_parts:
        # Assign next line number
        last_num = parsed[-1][0] if parsed else 0
        combined_code = "\n".join(current_code_parts)
        parsed.append((last_num + 1, combined_code))
    
    # Sort by line number
    parsed.sort(key=lambda x: x[0])
    
    # Build output with gaps filled as empty lines
    cleaned: List[str] = []
    expected_line = 1
    
    for line_num, code in parsed:
        # Fill any gaps with empty lines
        while expected_line < line_num:
            cleaned.append("")
            expected_line += 1
        cleaned.append(code)
        expected_line = line_num + 1
    
    # Remove leading/trailing empty lines only, preserve indentation
    while cleaned and not cleaned[0].strip():
        cleaned.pop(0)
    while cleaned and not cleaned[-1].strip():
        cleaned.pop()
    
    return "\n".join(cleaned)


def _extract_code_block(text: str, language: str = "java") -> str | None:
    """Grab the code portion by finding the first code-like line."""
    lines = [line.rstrip() for line in text.splitlines()]
    
    hints = JAVA_CODE_START_HINTS if language == "java" else PHP_CODE_START_HINTS
    
    code_start_idx = None
    for idx, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        if any(stripped.startswith(prefix) for prefix in hints):
            code_start_idx = idx
            break
        if stripped.startswith(("/*", "//", "#", "/**")):
            code_start_idx = idx
            break
    
    if code_start_idx is None:
        for idx, line in enumerate(lines):
            if line.strip():
                code_start_idx = idx
                break
    
    if code_start_idx is None:
        return None
    
    code = "\n".join(lines[code_start_idx:]).strip()
    return code or None


def _extract_java_package(code: str) -> str | None:
    """Extract the package name from Java source code."""
    match = re.search(r"^\s*package\s+([a-zA-Z0-9_.]+)\s*;", code, re.MULTILINE)
    if match:
        return match.group(1)
    return None


def _extract_php_namespace(code: str) -> str | None:
    """Extract the namespace from PHP source code."""
    match = re.search(r"^\s*namespace\s+([a-zA-Z0-9_\\]+)\s*;", code, re.MULTILINE)
    if match:
        return match.group(1)
    return None


def _get_language(filename: str) -> str:
    """Determine the language from filename."""
    if filename.lower().endswith(".java"):
        return "java"
    elif filename.lower().endswith(".php"):
        return "php"
    return "unknown"


def _build_relative_path(filename: str, code: str) -> str:
    """Build relative path based on language-specific rules."""
    language = _get_language(filename)
    
    if language == "java":
        package_name = _extract_java_package(code)
        if package_name:
            return f"{package_name.replace('.', '/')}/{filename}"
    elif language == "php":
        namespace = _extract_php_namespace(code)
        if namespace:
            # PHP uses backslash for namespaces, convert to forward slash
            return f"{namespace.replace(chr(92), '/')}/{filename}"
    
    return filename


def _merge_multipage_files(page_data: List[Tuple[str, int, int, str]]) -> Dict[str, str]:
    """
    Merge pages that belong to the same file.
    page_data: List of (filename, current_page, total_pages, cleaned_text)
    Returns: Dict of filename -> merged code
    """
    # Group pages by filename
    file_pages: Dict[str, List[Tuple[int, str]]] = {}
    
    for filename, current_page, total_pages, text in page_data:
        if filename not in file_pages:
            file_pages[filename] = []
        file_pages[filename].append((current_page, text))
    
    # Merge pages for each file
    merged: Dict[str, str] = {}
    for filename, pages in file_pages.items():
        # Sort by page number
        pages.sort(key=lambda x: x[0])
        # Merge all page texts
        merged_text = "\n".join(text for _, text in pages)
        merged[filename] = merged_text
    
    return merged


def extract_sources_from_pages(page_texts: List[str]) -> Dict[str, str]:
    """Transform page texts into a mapping of filepath -> source code.
    
    Multi-page files are merged. PyMuPDF handles spacing correctly on all pages.
    """
    # First pass: extract filename, page info, and cleaned text
    page_data: List[Tuple[str, int, int, str]] = []
    
    for text in page_texts:
        if not text:
            continue
        
        filename, current_page, total_pages = _extract_filename_and_page_info(text)
        if not filename:
            continue
        
        cleaned_text = _preprocess_page_text(text)
        if not cleaned_text:
            continue
        
        page_data.append((filename, current_page or 1, total_pages or 1, cleaned_text))
    
    # Merge multi-page files
    merged_files = _merge_multipage_files(page_data)
    
    # Second pass: extract code and build paths
    sources: Dict[str, str] = {}
    
    for filename, merged_text in merged_files.items():
        language = _get_language(filename)
        if language == "unknown":
            continue
        
        code_block = _extract_code_block(merged_text, language)
        if not code_block:
            continue
        
        relative_path = _build_relative_path(filename, code_block)
        
        # Handle duplicates
        final_path = relative_path
        dedupe_suffix = 1
        while final_path in sources:
            stem, ext = filename.rsplit(".", 1)
            dedupe_suffix += 1
            suffix_filename = f"{stem}_{dedupe_suffix}.{ext}"
            final_path = _build_relative_path(suffix_filename, code_block)
        
        sources[final_path] = code_block if code_block.endswith("\n") else f"{code_block}\n"
    
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


def _extract_texts_with_pymupdf(pdf_bytes: bytes) -> List[str]:
    """Extract text using PyMuPDF (fitz) - best for Japanese and spacing."""
    doc = fitz.open(stream=pdf_bytes, filetype='pdf')
    texts: List[str] = []
    try:
        for page in doc:
            texts.append(page.get_text())
    finally:
        doc.close()
    return texts


def parse_pdf_bytes(pdf_bytes: bytes) -> Dict[str, str]:
    """Read PDF bytes and return filename -> source mapping."""
    if not pdf_bytes:
        raise ValueError("PDF file is empty")

    texts: List[str] = []
    pymupdf_error: Exception | None = None
    
    # Prefer PyMuPDF for best Japanese and spacing support
    try:
        texts = _extract_texts_with_pymupdf(pdf_bytes)
    except Exception as exc:
        pymupdf_error = exc

    # Fallback to pypdfium2
    if not texts or not any(t.strip() for t in texts):
        try:
            texts = _extract_texts_with_pdfium(pdf_bytes)
        except Exception as exc:
            if pymupdf_error:
                raise RuntimeError(
                    "Failed to extract PDF text using both PyMuPDF and pypdfium2",
                ) from exc
            raise

    # Skip the first page (cover page)
    if len(texts) > 1:
        texts = texts[1:]
    else:
        texts = []

    sources = extract_sources_from_pages(texts)
    return sources


def generate_file_map(sources: Dict[str, str], base_dir: str = "") -> Dict[str, str]:
    """Generate a mapping of full file paths to source code."""
    file_map: Dict[str, str] = {}
    
    base_dir = base_dir.strip().strip("/\\")
    
    for rel_path, code in sources.items():
        if base_dir:
            full_path = f"{base_dir}/{rel_path}"
        else:
            full_path = rel_path
        file_map[full_path] = code
        
    return file_map


def build_zip_from_sources(sources: Dict[str, str], base_dir: str = "") -> bytes:
    """Create an in-memory ZIP archive from the extracted sources."""
    if not sources:
        raise ValueError("No sources to add to archive")
    
    file_map = generate_file_map(sources, base_dir)
    
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for full_path, code in file_map.items():
            zf.writestr(full_path, code)
    buffer.seek(0)
    return buffer.getvalue()
