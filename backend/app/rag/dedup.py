"""Deduplication for RAG chunks.

Two passes: exact (hash-based, free) before embedding at all, then semantic
(cosine-similarity, after embedding) to catch near-duplicates that differ only in
minor wording - lecture slides commonly repeat the same boilerplate/definition
across multiple decks, which otherwise wastes storage and biases retrieval toward
whichever duplicate happens to rank first.
"""
import numpy as np
from app.rag.chunking import Chunk

SEMANTIC_DUP_THRESHOLD = 0.92


def dedup_exact(chunks: list[Chunk]) -> list[Chunk]:
    """Drops chunks whose normalized-text hash has already been seen in this batch.
    Cheap - runs before embedding, so exact repeats never even reach the model."""
    seen = set()
    out = []
    for c in chunks:
        if c.chunk_hash in seen:
            continue
        seen.add(c.chunk_hash)
        out.append(c)
    return out


def dedup_semantic(chunks: list[Chunk], embeddings: list[list[float]]) -> tuple[list[Chunk], list[list[float]]]:
    """Drops chunks whose embedding is near-identical (cosine similarity above
    SEMANTIC_DUP_THRESHOLD) to one already kept. O(n^2) but n is a few hundred chunks
    per file at most, so this is milliseconds - no approximate/indexed search needed."""
    if not chunks:
        return [], []
    matrix = np.array(embeddings, dtype=np.float32)
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1e-8
    normalized = matrix / norms

    kept_idx: list[int] = []
    for i in range(len(chunks)):
        is_dup = False
        for j in kept_idx:
            similarity = float(np.dot(normalized[i], normalized[j]))
            if similarity >= SEMANTIC_DUP_THRESHOLD:
                is_dup = True
                break
        if not is_dup:
            kept_idx.append(i)

    return [chunks[i] for i in kept_idx], [embeddings[i] for i in kept_idx]
