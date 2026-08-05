"""Free, local text embeddings via fastembed.

fastembed (from the Qdrant team) runs ONNX Runtime instead of full PyTorch - same
underlying sentence-transformer models, but without pulling in torch (hundreds of MB,
much slower cold start). No API key, no per-token cost, no rate limit, and content
never leaves the server - a meaningfully more efficient choice than either the
OpenAI embeddings API (costs money) or raw sentence-transformers (heavier runtime)
for a small-scale deployment like this one.
"""
from functools import lru_cache
import numpy as np

EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"  # 384-dim, ~130MB, free, CPU-friendly
EMBEDDING_DIM = 384

# Small on purpose: this runs alongside PyTorch/ONNX/EasyOCR on a memory-constrained
# machine (observed crashing the whole server with only ~470MB free while embedding
# ~540 chunks from a 102-page book in one shot). Embedding in small batches and
# releasing each batch's tensors before starting the next keeps peak memory well
# below what a single all-at-once call needs, at the cost of slightly more overhead
# per batch - a worthwhile trade here.
EMBED_BATCH_SIZE = 8


@lru_cache(maxsize=1)
def _get_model():
    from fastembed import TextEmbedding
    return TextEmbedding(model_name=EMBEDDING_MODEL)


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embeds in small batches (not all at once) to bound peak memory - see
    EMBED_BATCH_SIZE above. Returns plain Python lists (JSON/DB-friendly),
    L2-normalized so a dot product is equivalent to cosine similarity at query time."""
    if not texts:
        return []
    model = _get_model()
    out = []
    for start in range(0, len(texts), EMBED_BATCH_SIZE):
        batch = texts[start:start + EMBED_BATCH_SIZE]
        for v in model.embed(batch, batch_size=EMBED_BATCH_SIZE):
            arr = np.asarray(v, dtype=np.float32)
            norm = np.linalg.norm(arr)
            if norm > 0:
                arr = arr / norm
            out.append(arr.tolist())
    return out


def embed_query(text: str) -> list[float]:
    return embed_texts([text])[0]
