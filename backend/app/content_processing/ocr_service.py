# OCR service: extracts text from scanned PDFs and image files using PyMuPDF (page rendering),
# pypdf (normal text layer) and EasyOCR (recognition). Called at upload time.
import logging
from pathlib import Path

import fitz  # PyMuPDF
import pypdf

from app.config import settings

logger = logging.getLogger("conceptintel.ocr")

_reader = None  # lazy-loaded EasyOCR Reader singleton (model weights are slow to load)


def _get_reader():
    """Loads the EasyOCR model once per process. First call is slow (downloads/loads
    model weights); subsequent calls reuse the same in-memory reader."""
    global _reader
    if _reader is None:
        import easyocr
        languages = [l.strip() for l in settings.OCR_LANGUAGES.split(",") if l.strip()]
        logger.info("Loading EasyOCR reader for languages: %s (first load can take a while)", languages)
        _reader = easyocr.Reader(languages, gpu=False)
    return _reader


def _ocr_pixmap(pix: "fitz.Pixmap") -> str:
    """Runs OCR on a rendered page image and returns joined recognized text."""
    reader = _get_reader()
    image_bytes = pix.tobytes("png")
    results = reader.readtext(image_bytes, detail=0, paragraph=True)
    return "\n".join(results)


def ocr_image_file(filepath: Path) -> str:
    """OCRs a standalone image file (jpg/jpeg/png)."""
    reader = _get_reader()
    results = reader.readtext(str(filepath), detail=0, paragraph=True)
    return "\n".join(results)


def extract_pdf_text_with_ocr_fallback(filepath: Path) -> tuple[str, bool]:
    """
    Extracts text from a PDF page by page. For each page, tries the normal text
    layer first (pypdf); if a page comes back with less than OCR_MIN_TEXT_LENGTH
    characters (i.e. it's a scanned image page with no real text layer), that page
    is rasterized and OCR'd instead. Returns (full_text, used_ocr).
    """
    reader_pypdf = pypdf.PdfReader(filepath)
    doc_fitz = fitz.open(filepath)

    pages_text = []
    used_ocr = False

    for i, page in enumerate(reader_pypdf.pages):
        text_layer = (page.extract_text() or "").strip()

        if len(text_layer) >= settings.OCR_MIN_TEXT_LENGTH:
            pages_text.append(text_layer)
            continue

        # No usable text layer on this page - rasterize and OCR it.
        try:
            fitz_page = doc_fitz[i]
            pix = fitz_page.get_pixmap(dpi=200)
            ocr_text = _ocr_pixmap(pix)
            pages_text.append(ocr_text)
            used_ocr = True
        except Exception as e:
            logger.error("OCR failed for page %d of %s: %s", i, filepath, str(e))
            pages_text.append(text_layer)  # keep whatever little text_layer had, even if short

    doc_fitz.close()
    return "\n".join(pages_text), used_ocr
