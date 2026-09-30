"""Text embeddings for RAG, served by OpenRouter with a local offline fallback.

WHY OPENROUTER RATHER THAN A LOCAL MODEL OR A SECOND PROVIDER
-------------------------------------------------------------
Embeddings now go through the same OpenRouter key, endpoint and client factory as
every other AI call in this project (see app/content_processing/generation_service.py),
which keeps the number of providers at one. Two alternatives were tried and
rejected:

* Google Gemini (`google-genai` is installed and a valid key is in .env) is
  geo-blocked from this deployment's region - both `embed_content` and
  `generate_content` return "400 FAILED_PRECONDITION: User location is not
  supported for the API use". A valid key is not sufficient, so it cannot be the
  embedding backend here.
* Running a bigger local model (bge-base, nomic) is viable memory-wise, but a
  hosted 1536-dim model measurably out-retrieves any 384/768-dim ONNX model that
  fits comfortably in-process, and costs about half a cent to embed a 100-page
  book. The local path is kept as `EMBEDDING_PROVIDER=local` for offline work.

DIMENSION IS A SCHEMA CONTRACT
------------------------------
`settings.EMBEDDING_DIM` must equal the declared width of
`ContentChunk.embedding`. Postgres cannot change a pgvector column's dimension
in place while rows exist, and this project has no Alembic - so a mismatch is a
migration, not a config tweak (`scripts/reembed_content_chunks.py` handles it).
Because a wrong-width vector would otherwise fail deep inside the ingestion
pipeline's broad `except` and leave a file silently unembedded, every batch is
checked against EMBEDDING_DIM here and raises loudly if it drifts.

QUERY / DOCUMENT ASYMMETRY
--------------------------
Retrieval quality improves when a short question and a long passage are embedded
differently. The previous implementation embedded both identically. `embed_query`
now applies the appropriate asymmetry for whichever backend is active: an
instruction prefix for local BGE/E5 models (which are trained with one), and a
no-op for OpenAI's text-embedding-3 family (which is not, and is measurably
worse with a prefix bolted on).
"""
import logging
from functools import lru_cache
from typing import List

import numpy as np

from app.config import settings
from app.observability import trace_ai_call

logger = logging.getLogger("conceptintel.embeddings")

# BGE and E5 checkpoints are trained with an instruction prefix on the QUERY side
# only. Applying it to passages, or to a model that was not trained with one,
# hurts more than it helps - hence the explicit per-family mapping.
_LOCAL_QUERY_PREFIXES = {
    "bge": "Represent this sentence for searching relevant passages: ",
    "e5": "query: ",
    "nomic": "search_query: ",
}
_LOCAL_PASSAGE_PREFIXES = {
    "e5": "passage: ",
    "nomic": "search_document: ",
}

# Only OpenAI's text-embedding-3 family supports Matryoshka truncation via the
# `dimensions` parameter. Sending it to any other hosted model is an API error,
# so it is passed conditionally rather than always.
_MRL_MODEL_PREFIXES = ("openai/text-embedding-3", "text-embedding-3")


def _is_local() -> bool:
    """True when the local (offline fastembed) provider is configured instead of OpenRouter."""
    return settings.EMBEDDING_PROVIDER.strip().lower() == "local"


def _local_family() -> str:
    """Identifies the local model family (bge/e5/nomic) from its name so the right prefix is used."""
    name = settings.EMBEDDING_LOCAL_MODEL.lower()
    for family in ("bge", "e5", "nomic"):
        if family in name:
            return family
    return ""


def _supports_dimensions() -> bool:
    """True if the hosted model accepts the `dimensions` (truncation) parameter."""
    return settings.EMBEDDING_MODEL.startswith(_MRL_MODEL_PREFIXES)


@lru_cache(maxsize=1)
def _get_local_model():
    """Lazily loaded, process-wide singleton. Imported inside the function so a
    missing/broken fastembed install only breaks the local path, not import of
    this module (the hosted path is the default and must not depend on it)."""
    from fastembed import TextEmbedding

    logger.info("Loading local embedding model %s", settings.EMBEDDING_LOCAL_MODEL)
    return TextEmbedding(model_name=settings.EMBEDDING_LOCAL_MODEL)


def _normalize(vectors: List[List[float]]) -> List[List[float]]:
    """L2-normalize so a dot product equals cosine similarity at query time.
    text-embedding-3 already returns unit vectors, but normalizing is idempotent
    and keeps both backends on identical footing."""
    out = []
    for v in vectors:
        arr = np.asarray(v, dtype=np.float32)
        norm = float(np.linalg.norm(arr))
        if norm > 0:
            arr = arr / norm
        out.append(arr.tolist())
    return out


def _check_dim(vectors: List[List[float]]) -> None:
    """Raises if vector width differs from EMBEDDING_DIM, since pgvector cannot store a mismatched width."""
    if not vectors:
        return
    actual = len(vectors[0])
    if actual != settings.EMBEDDING_DIM:
        raise RuntimeError(
            f"Embedding width mismatch: model '{settings.EMBEDDING_MODEL}' returned "
            f"{actual}-dim vectors but EMBEDDING_DIM (and the content_chunks.embedding "
            f"column) is {settings.EMBEDDING_DIM}. Fix EMBEDDING_DIM/EMBEDDING_MODEL in "
            f".env and run scripts/reembed_content_chunks.py - inserting these vectors "
            f"would fail at the database layer."
        )


def _embed_remote(texts: List[str]) -> List[List[float]]:
    """Batched embedding via OpenRouter. Retries the whole call up to 3 times,
    matching the convention in generation_service.clean_and_structure_chunk."""
    from app.content_processing.generation_service import _get_client, openrouter_payment_error_message

    client = _get_client()
    if client is None:
        raise RuntimeError(
            "OPENROUTER_API_KEY is not configured - it is required for embeddings "
            "(EMBEDDING_PROVIDER=openrouter). Set it in backend/.env, or set "
            "EMBEDDING_PROVIDER=local to embed offline with fastembed instead."
        )

    kwargs = {}
    if _supports_dimensions():
        kwargs["dimensions"] = settings.EMBEDDING_DIM

    out: List[List[float]] = []
    batch_size = max(1, settings.EMBEDDING_BATCH_SIZE)
    for start in range(0, len(texts), batch_size):
        batch = texts[start:start + batch_size]
        last_error = None
        for attempt in range(3):
            try:
                response = client.embeddings.create(
                    model=settings.EMBEDDING_MODEL,
                    input=batch,
                    timeout=60.0,
                    **kwargs,
                )
                # The API does not guarantee response order, so sort by index
                # rather than trusting the sequence as returned.
                ordered = sorted(response.data, key=lambda d: d.index)
                out.extend([d.embedding for d in ordered])
                break
            except Exception as e:  # noqa: BLE001 - retried, then re-raised below
                payment_message = openrouter_payment_error_message(e)
                if payment_message:
                    raise RuntimeError(payment_message) from e
                last_error = e
                logger.warning(
                    "Embedding batch %d-%d attempt %d/3 failed: %s: %s",
                    start, start + len(batch), attempt + 1, type(e).__name__, str(e),
                )
        else:
            raise RuntimeError(
                f"Embedding failed after 3 attempts for batch starting at {start}: {last_error}"
            )
    return out


def _embed_local(texts: List[str]) -> List[List[float]]:
    """Offline embedding via fastembed/ONNX. Kept in small batches because this
    runs in the same process as EasyOCR and ONNX Runtime; embedding a large book
    in one shot has previously exhausted memory on a constrained machine."""
    model = _get_local_model()
    out: List[List[float]] = []
    batch_size = max(1, min(settings.EMBEDDING_BATCH_SIZE, 16))
    for start in range(0, len(texts), batch_size):
        batch = texts[start:start + batch_size]
        for v in model.embed(batch, batch_size=batch_size):
            out.append(np.asarray(v, dtype=np.float32).tolist())
    return out


@trace_ai_call("rag-embed-texts")
def embed_texts(texts: List[str]) -> List[List[float]]:
    """Embed passages (the document side). Returns plain Python lists, L2-normalized.

    Raises rather than returning partial results - a caller that silently stored
    fewer embeddings than chunks would corrupt the chunk/embedding zip in
    app/rag/pipeline.py.
    """
    if not texts:
        return []

    family = _local_family() if _is_local() else ""
    prefix = _LOCAL_PASSAGE_PREFIXES.get(family, "")
    prepared = [prefix + t for t in texts] if prefix else texts

    vectors = _embed_local(prepared) if _is_local() else _embed_remote(prepared)

    if len(vectors) != len(texts):
        raise RuntimeError(
            f"Embedding count mismatch: asked for {len(texts)} vectors, got {len(vectors)}."
        )
    vectors = _normalize(vectors)
    _check_dim(vectors)
    return vectors


@trace_ai_call("rag-embed-query")
def embed_query(text: str) -> List[float]:
    """Embed a search query (the question side).

    Unlike the previous implementation this is NOT just `embed_texts([text])[0]`:
    local BGE/E5/nomic checkpoints are trained with a query-side instruction
    prefix, and using the passage encoding for a short question measurably hurts
    recall. Hosted text-embedding-3 models take no prefix.
    """
    if not text.strip():
        raise ValueError("embed_query() requires a non-empty query")

    family = _local_family() if _is_local() else ""
    prefix = _LOCAL_QUERY_PREFIXES.get(family, "")
    prepared = prefix + text

    vectors = _embed_local([prepared]) if _is_local() else _embed_remote([prepared])
    vectors = _normalize(vectors)
    _check_dim(vectors)
    return vectors[0]
