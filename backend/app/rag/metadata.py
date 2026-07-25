"""Metadata enrichment for RAG chunks.

A chunk embedded in isolation loses context a reader would get from the surrounding
document (which course, which file, which section). Prepending that context to the
text that gets *embedded* (not the text shown to the reader) measurably improves
retrieval - this is the same idea behind "contextual retrieval": the embedding
represents "this passage, in the context of X" rather than the passage alone.
"""
from app.rag.chunking import Chunk


def build_embedding_input(chunk: Chunk, course_name: str, file_name: str) -> str:
    """Text actually sent to the embedding model - includes context prefix.
    The chunk's own .text (unprefixed) is what gets stored/shown/cited."""
    parts = [f"Course: {course_name}", f"Source: {file_name}"]
    if chunk.section_heading:
        parts.append(f"Section: {chunk.section_heading}")
    context = " | ".join(parts)
    return f"[{context}]\n{chunk.text}"


def build_citation(course_name: str, file_name: str, chunk: Chunk) -> str:
    """Human-readable source citation for a retrieved chunk, shown alongside any
    AI-generated answer so a teacher/student can verify it against the original
    material - reduces perceived hallucination even when the model paraphrases."""
    label = file_name
    if chunk.section_heading:
        label += f" - {chunk.section_heading}"
    if chunk.page_number:
        label += f" (p. {chunk.page_number})"
    return f"{course_name}: {label}"
