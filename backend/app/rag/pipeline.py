"""Orchestrates the RAG ingestion pipeline for one uploaded file:

  clean -> chunk -> caption images -> dedup (exact, then semantic) -> embed -> store
  as ContentChunk rows (pgvector, in Supabase).

Called from upload/routes.py's background task, right after text extraction
succeeds. OCR is NOT done here - upload/services.py's extract_text_from_file already
ran EasyOCR on any scanned PDF page / plain image before this pipeline ever sees the
text (see app/content_processing/ocr_service.py), so there's no separate OCR fallback
step in this file. Every other step is best-effort (image captioning in particular)
so a missing optional dependency degrades gracefully instead of failing the whole
upload.

COURSE OUTLINES ARE NOT EMBEDDED
--------------------------------
A file marked material_kind='outline' returns immediately without producing any
chunk. This is deliberate, and it is not a performance tweak - it is a retrieval
quality fix. An outline is a table of contents: it names every topic in the course
in a couple of shallow lines each. Embedded, those chunks sit at moderate similarity
to *every* query in the course and reliably displace the actual explanatory passage
a question needs. Outline text is instead handed to the model as structured context
(see app/content_processing/pipeline_service.py), where being a list of topics is
exactly what makes it useful.

RE-INGESTION REPLACES, IT DOES NOT APPEND
-----------------------------------------
Any chunk previously stored for this file is deleted before the new ones are
written. Without this, POST /api/files/{id}/process (upload/routes.py) silently
duplicated every chunk on each run, each copy restarting chunk_index at 0 - a course
reprocessed three times had three copies of every passage, all competing for the same
top-k slots. This was observably happening: the one file in this database had 15
stored chunks for what re-ingests cleanly as 6.
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
from app.rag.images import extract_images, caption_image, is_captioning_configured

logger = logging.getLogger("conceptintel")


# Entry point of ingestion: clean -> chunk -> caption images -> dedup -> embed -> store.
def process_file_for_rag(
    db: Session,
    course_id: int,
    file_id: int,
    course_name: str,
    file_name: str,
    raw_text: str,
    file_type: str,
    filepath: Optional[Path] = None,
    material_kind: str = "material",
) -> int:
    """Runs the full pipeline and persists ContentChunk rows. Returns the number of
    chunks stored. filepath is only needed for image extraction (reads the original
    file directly) - pass None to skip that step (e.g. when the source file lives in
    remote storage and wasn't downloaded to a temp path, or during a bulk re-embed).

    material_kind='outline' short-circuits: outlines are never embedded, see the
    module docstring.
    """
    if material_kind == "outline":
        logger.info(
            "Skipping RAG embedding for '%s' - it is a course outline, which is passed "
            "to the model as structured context instead of being retrieved.", file_name,
        )
        _delete_existing_chunks(db, file_id)
        return 0

    text = clean_for_rag(raw_text)
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
        _delete_existing_chunks(db, file_id)
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

    # Replace rather than append. Done in the same transaction as the insert so a
    # failure mid-embed can never leave the file with zero chunks.
    _delete_existing_chunks(db, file_id, commit=False)
    # Flushed in small batches inside the one transaction: a single INSERT carrying
    # every chunk's 768-float vector is several hundred KB, and the Supabase pooler
    # drops the connection ("server closed the connection unexpectedly") on it,
    # leaving the file un-embedded. Still one commit, so still all-or-nothing.
    for start in range(0, len(rows), 5):
        db.add_all(rows[start:start + 5])
        db.flush()
    db.commit()
    return len(rows)


def _delete_existing_chunks(db: Session, file_id: int, commit: bool = True) -> int:
    """Remove any chunks previously stored for this file. Returns how many were
    removed. synchronize_session=False because nothing in this request holds those
    ORM objects - the rows are being discarded, not mutated."""
    removed = (
        db.query(ContentChunk)
        .filter(ContentChunk.file_id == file_id)
        .delete(synchronize_session=False)
    )
    if commit:
        db.commit()
    if removed:
        logger.info("Replaced %d previously stored chunk(s) for file_id=%s", removed, file_id)
    return removed
