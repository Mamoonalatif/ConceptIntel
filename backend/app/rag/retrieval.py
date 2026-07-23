"""Retrieval for RAG: similarity search over content_chunks + hallucination guards.

Three-layer hallucination mitigation, standard practice for grounded generation:
1. Similarity threshold - a query with no good match returns nothing rather than
   forcing in irrelevant context (a major cause of an LLM "making up" an answer
   instead of saying it doesn't know).
2. Source citations attached to every result, so any downstream consumer can show
   "grounded in: {citation}" for a teacher/student to verify against the original.
3. A strict system prompt (below) for anything that generates text from retrieved
   chunks: answer ONLY from the provided context, and say so explicitly if the
   context doesn't cover the question.
"""
import numpy as np
from sqlalchemy.orm import Session

from app.database.models import ContentChunk, Course, UploadedFile
from app.rag.embeddings import embed_query
from app.rag.metadata import build_citation

SIMILARITY_THRESHOLD = 0.45  # below this, a match is treated as "not actually relevant"
DEFAULT_TOP_K = 5

GROUNDED_ANSWER_SYSTEM_PROMPT = (
    "Answer using ONLY the provided course material excerpts. If the excerpts don't "
    "contain enough information to answer, say \"I couldn't find this in the uploaded "
    "course material\" instead of guessing. Never state something as fact unless it's "
    "directly supported by the excerpts, and cite which excerpt(s) you used."
)


def retrieve(
    db: Session,
    course_id: int,
    query: str,
    top_k: int = DEFAULT_TOP_K,
    similarity_threshold: float = SIMILARITY_THRESHOLD,
) -> list[dict]:
    """Top-k most relevant chunks for a course, each with a similarity score and a
    human-readable citation. Brute-force over all of a course's chunks - at this
    scale (a few hundred chunks per course) that's milliseconds; no ANN index needed."""
    chunks = db.query(ContentChunk).filter(ContentChunk.course_id == course_id).all()
    if not chunks:
        return []

    query_vec = np.array(embed_query(query), dtype=np.float32)
    course = db.query(Course).filter(Course.id == course_id).first()
    course_name = course.name if course else "this course"
    file_names = {
        f.id: f.filename
        for f in db.query(UploadedFile).filter(UploadedFile.course_id == course_id).all()
    }

    scored = []
    for chunk in chunks:
        vec = np.array(chunk.embedding, dtype=np.float32)
        score = float(np.dot(query_vec, vec))  # both pre-normalized -> this is cosine similarity
        if score >= similarity_threshold:
            scored.append((score, chunk))
    scored.sort(key=lambda pair: pair[0], reverse=True)

    results = []
    for score, chunk in scored[:top_k]:
        results.append({
            "text": chunk.text,
            "score": score,
            "source_type": chunk.source_type,
            "citation": build_citation(course_name, file_names.get(chunk.file_id, "unknown file"), chunk),
        })
    return results


def build_grounded_prompt(query: str, retrieved: list[dict]) -> str:
    """Assembles the user-turn prompt for a downstream generation call - pair this
    with GROUNDED_ANSWER_SYSTEM_PROMPT as the system message."""
    if not retrieved:
        return (
            f"Question: {query}\n\n"
            "No relevant course material was found for this question. Respond that "
            "this isn't covered in the uploaded material."
        )
    context_blocks = "\n\n".join(
        f"[Excerpt {i + 1} - {r['citation']}]\n{r['text']}" for i, r in enumerate(retrieved)
    )
    return f"Course material excerpts:\n\n{context_blocks}\n\nQuestion: {query}"
