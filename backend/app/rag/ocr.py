"""OCR fallback for scanned/photographed PDFs.

Normal text extraction (pypdf) returns nothing useful for a PDF that's really just
photographed textbook pages. This renders each page to an image (via PyMuPDF - pure
pip install, no external binary like poppler needed) and runs Tesseract OCR on it.

Tesseract itself is a system binary, not something pip can install - if it isn't on
PATH, OCR is skipped with a clear log message rather than crashing the upload
pipeline. Install it from https://github.com/UB-Mannheim/tesseract/wiki (Windows) or
`apt install tesseract-ocr` / `brew install tesseract`.
"""
import logging
from pathlib import Path

logger = logging.getLogger("conceptintel")

MIN_CHARS_BEFORE_OCR_FALLBACK = 200
MAX_OCR_PAGES = 50


def is_tesseract_available() -> bool:
    try:
        import pytesseract
        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


def needs_ocr_fallback(extracted_text: str, file_type: str) -> bool:
    """Heuristic: a real (non-scanned) PDF of any meaningful length yields far more
    than a couple hundred characters. Only applies to PDFs - DOCX/PPTX text extraction
    doesn't have this failure mode since it reads structured XML, not rendered pages."""
    if file_type != "pdf":
        return False
    return len(extracted_text.strip()) < MIN_CHARS_BEFORE_OCR_FALLBACK


def ocr_pdf(filepath: Path) -> str:
    """Rasterizes each page and OCRs it. Returns '' (not an exception) if Tesseract
    isn't installed - callers should treat OCR as best-effort, not required."""
    if not is_tesseract_available():
        logger.warning(
            "OCR fallback skipped for %s - Tesseract binary not found on PATH.", filepath.name
        )
        return ""

    import fitz  # PyMuPDF
    import pytesseract
    from PIL import Image, ImageOps

    texts = []
    doc = fitz.open(filepath)
    try:
        for i, page in enumerate(doc):
            if i >= MAX_OCR_PAGES:
                logger.warning("OCR truncated at %d pages for %s", MAX_OCR_PAGES, filepath.name)
                break
            pix = page.get_pixmap(dpi=200)
            image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            # Lightweight preprocessing without an opencv dependency - grayscale +
            # autocontrast measurably improves OCR accuracy on photographed pages.
            image = ImageOps.autocontrast(image.convert("L"))
            texts.append(pytesseract.image_to_string(image))
    finally:
        doc.close()

    return "\n\n".join(texts)
