# Redis cache wrapper with graceful fallback when Redis is unavailable.
import hashlib
import json
import logging
from typing import Any, Optional

import redis

from app.config import settings

logger = logging.getLogger("conceptintel.cache")


class RedisCache:
    """Thin wrapper around a Redis client. Degrades to a no-op cache (every get()
    misses, every set() is ignored) if Redis isn't reachable, so the app keeps
    working exactly as before Redis was introduced - just without the speedup/
    cost-savings until Redis is actually running."""

    def __init__(self):
        """Try to connect to Redis and ping it; on any failure leave client as None."""
        self.client: Optional[redis.Redis] = None
        try:
            self.client = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
            self.client.ping()
            logger.info("Connected to Redis at %s", settings.REDIS_URL)
        except Exception as e:
            logger.warning("Redis unavailable (%s) - caching disabled, running without it.", str(e))
            self.client = None

    def get_json(self, key: str) -> Optional[Any]:
        """Return the cached JSON value for `key`, or None on miss/error/no Redis."""
        if not self.client:
            return None
        try:
            raw = self.client.get(key)
            return json.loads(raw) if raw else None
        except Exception as e:
            logger.warning("Redis GET failed for key %s: %s", key, str(e))
            return None

    def set_json(self, key: str, value: Any, ttl_seconds: Optional[int] = None) -> None:
        """Store `value` as JSON under `key` with an expiry (default from settings)."""
        if not self.client:
            return
        try:
            self.client.set(key, json.dumps(value), ex=ttl_seconds or settings.REDIS_CACHE_TTL_SECONDS)
        except Exception as e:
            logger.warning("Redis SET failed for key %s: %s", key, str(e))

    def invalidate(self, key: str) -> None:
        """Delete `key` from the cache (used when the underlying data changes)."""
        if not self.client:
            return
        try:
            self.client.delete(key)
        except Exception as e:
            logger.warning("Redis DEL failed for key %s: %s", key, str(e))


def content_hash(*parts: str) -> str:
    """Stable hash of one or more text parts, used as a cache key so identical
    (text, teacher_notes) pairs skip a repeat generation API call."""
    h = hashlib.sha256()
    for part in parts:
        h.update((part or "").encode("utf-8", errors="ignore"))
        h.update(b"\x00")
    return h.hexdigest()


# Shared singleton used by the rest of the app (and by rate_limit.py).
cache = RedisCache()
