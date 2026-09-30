# Rate limiting for sensitive endpoints (login, join, etc.): Redis-backed with an in-memory fallback.
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, status

from app.core.cache import cache

# Per-process fallback store, keyed the same way as the Redis path below. Only
# holds counts for whichever worker process handles a given request, so under
# more than one backend process/instance this under-counts (each process has its
# own view) - acceptable as a fallback since it still bounds a single worker, but
# Redis (see app/core/cache.py) is what makes the limit actually hold app-wide.
_local_hits: dict = defaultdict(deque)
_local_lock = threading.Lock()

RATE_LIMIT_DETAIL = "Too many attempts. Please wait a few minutes and try again."


def _check_local(key: str, limit: int, window_seconds: int) -> None:
    """In-process sliding-window check: drop hits older than the window, then
    raise 429 if `limit` hits remain, otherwise record this hit."""
    now = time.monotonic()
    with _local_lock:
        hits = _local_hits[key]
        while hits and now - hits[0] > window_seconds:
            hits.popleft()
        if len(hits) >= limit:
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=RATE_LIMIT_DETAIL)
        hits.append(now)


def enforce_rate_limit(scope: str, identity: str, limit: int, window_seconds: int) -> None:
    """Fixed-window rate limit: at most `limit` calls for `identity` (a user id,
    IP address, etc.) within `window_seconds`, namespaced by `scope` (a short name
    identifying which endpoint is being guarded - e.g. "enrollment-join"). Raises
    HTTP 429 when the limit is exceeded; returns None otherwise.

    Backed by Redis (INCR + EXPIRE) when available - required for the limit to
    actually hold across more than one backend process/instance, same as any
    counter shared between workers - and falls back to an in-process counter
    (bounds a single worker only) when Redis is unreachable, matching
    app/core/cache.py's RedisCache degrade-gracefully posture so this still works
    in local dev without Redis running."""
    key = f"ratelimit:{scope}:{identity}"
    if cache.client:
        try:
            count = cache.client.incr(key)
            if count == 1:
                cache.client.expire(key, window_seconds)
            if count > limit:
                raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=RATE_LIMIT_DETAIL)
            return
        except HTTPException:
            raise
        except Exception:
            pass  # Redis hiccup - fall through to the in-process fallback below
    _check_local(key, limit, window_seconds)
