"""Retrieval for RAG: similarity search over content_chunks (stored as pgvector
embeddings in Supabase Postgres) + hallucination guards.

Similarity search runs as a real SQL query using pgvector's cosine-distance operator
(ContentChunk.embedding.cosine_distance(...)) instead of pulling every course's chunks
into Python and computing cosine similarity by hand - this pushes the nearest-neighbor
search into the database itself, which is both faster and the correct approach as the
number of chunks grows. It is now backed by an HNSW index (created by
scripts/reembed_content_chunks.py); before that every search was a sequential scan.

FETCH-THEN-THRESHOLD
--------------------
The similarity floor is applied in Python, so the SQL query deliberately fetches
`top_k * RAG_CANDIDATE_MULTIPLIER` rows and only then trims to top_k. The previous
implementation applied LIMIT top_k first and filtered afterwards, which meant a
strict threshold silently *shrank* the result set instead of searching deeper - if
three of the first five neighbours were weak matches, the caller got two results even
when better ones sat at rank six.

THRESHOLD IS MODEL-SPECIFIC
---------------------------
settings.RAG_SIMILARITY_THRESHOLD is calibrated against the configured embedding
model, not a universal constant. On openai/text-embedding-3-small an on-topic passage
scores ~0.62, a related-but-different one ~0.34 and an unrelated one ~0.13. BGE models
score far higher across the board. Changing EMBEDDING_MODEL means re-measuring it.

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
from typing import List, Optional

from sqlalchemy.orm import Session

from app.config import settings
from app.database.models import ContentChunk, Course, UploadedFile
from app.rag.embeddings import embed_query
from app.rag.metadata import build_citation

# System prompt forcing answers to stay within the retrieved excerpts (hallucination guard).
GROUNDED_ANSWER_SYSTEM_PROMPT = (
    "Answer using ONLY the provided course material excerpts. If the excerpts don't "
    "contain enough information to answer, say \"I couldn't find this in the uploaded "
    "course material\" instead of guessing. Never state something as fact unless it's "
    "directly supported by the excerpts, and cite which excerpt(s) you used."
)


# Core similarity search: embeds the query, runs a pgvector cosine query, applies the threshold, builds citations.
def retrieve(
    db: Session,
    course_id: Optional[int] = None,
    query: str = "",
    top_k: Optional[int] = None,
    similarity_threshold: Optional[float] = None,
    source_types: Optional[List[str]] = None,
    file_id: Optional[int] = None,
    course_ids: Optional[List[int]] = None,
) -> list[dict]:
    """Top-k most relevant chunks for a course (or a set of courses), each with a
    similarity score and a human-readable citation.

    Exactly one of `course_id` (single-course callers: content generation, grading,
    the question bank) or `course_ids` (multi-course callers: the assistant chatbot,
    which isn't scoped to one course) should be given.

    Only chunks belonging to files marked material_kind='material' are searchable -
    course outlines are never embedded (see app/rag/pipeline.py), but the join is
    filtered explicitly so any legacy outline chunks predating that rule are excluded
    too.

    Returns [] rather than raising when there's no indexed material, so callers can
    degrade to an ungrounded prompt instead of failing.
    """
    if not query or not query.strip():
        return []
    ids = course_ids if course_ids is not None else ([course_id] if course_id is not None else [])
    if not ids:
        return []

    top_k = top_k if top_k is not None else settings.RAG_TOP_K
    threshold = (
        similarity_threshold if similarity_threshold is not None
        else settings.RAG_SIMILARITY_THRESHOLD
    )
    candidate_limit = max(top_k, top_k * max(1, settings.RAG_CANDIDATE_MULTIPLIER))

    query_vec = embed_query(query)

    q = (
        db.query(ContentChunk, ContentChunk.embedding.cosine_distance(query_vec).label("distance"))
        .join(UploadedFile, ContentChunk.file_id == UploadedFile.id)
        .filter(ContentChunk.course_id.in_(ids))
        .filter(UploadedFile.material_kind == "material")
    )
    if source_types:
        q = q.filter(ContentChunk.source_type.in_(source_types))
    if file_id is not None:
        q = q.filter(ContentChunk.file_id == file_id)

    rows = q.order_by("distance").limit(candidate_limit).all()
    if not rows:
        return []

    course_names = {c.id: c.name for c in db.query(Course.id, Course.name).filter(Course.id.in_(ids)).all()}
    file_names = {
        f.id: f.filename
        for f in db.query(UploadedFile).filter(UploadedFile.course_id.in_(ids)).all()
    }

    results = []
    for chunk, distance in rows:
        similarity = 1.0 - float(distance)  # cosine_distance = 1 - cosine_similarity
        if similarity < threshold:
            continue
        results.append({
            "chunk_id": chunk.id,
            "file_id": chunk.file_id,
            "text": chunk.text,
            "score": round(similarity, 4),
            "source_type": chunk.source_type,
            "page_number": chunk.page_number,
            "section_heading": chunk.section_heading,
            "citation": build_citation(
                course_names.get(chunk.course_id, "this course"),
                file_names.get(chunk.file_id, "unknown file"),
                chunk,
            ),
        })
        if len(results) >= top_k:
            break
    return results


def retrieve_for_concept(
    db: Session,
    course_id: int,
    concept_name: str,
    concept_description: str = "",
    top_k: Optional[int] = None,
) -> list[dict]:
    """Retrieval tuned for 'find the course material that teaches concept X'.

    A bare concept name is a very short query and embeds poorly against long
    explanatory passages, so the name and its graph description are combined into one
    richer query string. Used to ground content generation, which previously sent the
    model nothing but a concept name and description.
    """
    parts = [concept_name.strip()]
    if concept_description and concept_description.strip():
        parts.append(concept_description.strip())
    return retrieve(db, course_id, ". ".join(parts), top_k=top_k)


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


def format_excerpts(retrieved: list[dict], max_chars: int = 6000) -> str:
    """Renders retrieved chunks as a context block for prompts that are NOT simple
    question-answering (content generation, grading), where the task instruction comes
    from the caller's own system prompt rather than GROUNDED_ANSWER_SYSTEM_PROMPT.

    Truncated to max_chars so a long retrieval can never crowd out the actual
    instruction - excerpts are ordered best-first, so truncation drops the weakest.
    """
    if not retrieved:
        return ""
    blocks = []
    used = 0
    for i, r in enumerate(retrieved):
        block = f"[Excerpt {i + 1} - {r['citation']}]\n{r['text']}"
        if used + len(block) > max_chars:
            break
        blocks.append(block)
        used += len(block)
    return "\n\n".join(blocks)
