"""Retrieval for RAG: similarity search over content_chunks (stored as pgvector
embeddings in Supabase Postgres) + hallucination guards.

Similarity search runs as a real SQL query using pgvector's cosine-distance operator
(ContentChunk.embedding.cosine_distance(...)) instead of pulling every course's chunks
into Python and computing cosine similarity by hand - this pushes the nearest-neighbor
search into the database itself, which is both faster and the correct approach as the
number of chunks grows (a brute-force Python loop over thousands of rows doesn't scale;
a SQL ORDER BY does, and can later take an ivfflat/hnsw index for free with no query
changes).

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
    human-readable citation. pgvector's cosine_distance() runs the nearest-neighbor
    search inside Postgres, ordered nearest-first - only the top_k rows are ever
    pulled into Python, regardless of how many chunks the course has."""
    query_vec = embed_query(query)

    rows = (
        db.query(ContentChunk, ContentChunk.embedding.cosine_distance(query_vec).label("distance"))
        .filter(ContentChunk.course_id == course_id)
        .order_by("distance")
        .limit(top_k)
        .all()
    )
    if not rows:
        return []

    course = db.query(Course).filter(Course.id == course_id).first()
    course_name = course.name if course else "this course"
    file_names = {
        f.id: f.filename
        for f in db.query(UploadedFile).filter(UploadedFile.course_id == course_id).all()
    }

    results = []
    for chunk, distance in rows:
        similarity = 1.0 - float(distance)  # cosine_distance = 1 - cosine_similarity
        if similarity < similarity_threshold:
            continue
        results.append({
            "text": chunk.text,
            "score": similarity,
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
