"""Orchestrates the full RAG ingestion pipeline for one uploaded file:

  clean -> (OCR fallback if needed) -> chunk -> caption images -> dedup (exact,
  then semantic) -> embed -> store as ContentChunk rows.

Called from upload/routes.py's background task, right after text extraction
succeeds. Every step is best-effort where it reasonably can be (OCR, image
captioning) so a missing optional dependency degrades gracefully instead of
failing the whole upload.
"""
import logging
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from app.database.models import ContentChunk
from app.rag.cleaning import clean_for_rag
from app.rag.chunking import Chunk, chunk_document
from app.rag.metadata import build_embedding_input
from app.rag.dedup import dedup_exact, dedup_semantic
from app.rag.embeddings import embed_texts
from app.rag.ocr import needs_ocr_fallback, ocr_pdf
from app.rag.images import extract_images, caption_image, is_captioning_configured

logger = logging.getLogger("conceptintel")


def process_file_for_rag(
    db: Session,
    course_id: int,
    file_id: int,
    course_name: str,
    file_name: str,
    raw_text: str,
    file_type: str,
    filepath: Optional[Path] = None,
) -> int:
    """Runs the full pipeline and persists ContentChunk rows. Returns the number of
    chunks stored. filepath is only needed for OCR fallback and image extraction
    (both read the original file directly) - pass None to skip those steps (e.g.
    when the source file lives in Supabase and wasn't downloaded to a temp path)."""

    text = clean_for_rag(raw_text)

    # OCR fallback: a scanned PDF yields almost no text from normal extraction.
    if filepath is not None and needs_ocr_fallback(text, file_type):
        logger.info("File %s looks scanned (little/no extractable text) - trying OCR fallback.", file_name)
        ocr_text = ocr_pdf(filepath)
        if ocr_text.strip():
            text = clean_for_rag(ocr_text)

    chunks: list[Chunk] = chunk_document(text) if text.strip() else []

    # Multi-modal: extract embedded images, caption each, and treat the caption as
    # just another chunk (source_type="image_caption") - same embedding space as
    # everything else, see app/rag/images.py for why.
    if filepath is not None and is_captioning_configured():
        try:
            images = extract_images(filepath, file_type)
            for img_bytes in images:
                caption = caption_image(img_bytes, course_name)
                if caption:
                    chunks.append(Chunk(text=caption, token_count=0, source_type="image_caption"))
        except Exception as e:
            logger.warning("Image extraction/captioning failed for %s (continuing without it): %s", file_name, e)

    if not chunks:
        return 0

    chunks = dedup_exact(chunks)

    embedding_inputs = [build_embedding_input(c, course_name, file_name) for c in chunks]
    embeddings = embed_texts(embedding_inputs)

    chunks, embeddings = dedup_semantic(chunks, embeddings)

    rows = [
        ContentChunk(
            course_id=course_id,
            file_id=file_id,
            chunk_index=i,
            text=chunk.text,
            embedding=embedding,
            token_count=chunk.token_count,
            chunk_hash=chunk.chunk_hash,
            section_heading=chunk.section_heading,
            source_type=chunk.source_type,
            page_number=chunk.page_number,
        )
        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings))
    ]
    db.add_all(rows)
    db.commit()
    return len(rows)
