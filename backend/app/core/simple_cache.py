"""In-process, per-worker TTL cache for read-heavy endpoints (dashboard listings,
analytics) - deliberately NOT Redis (app/core/cache.py's RedisCache), since Redis
isn't actually running in this deployment ("Redis unavailable ... caching
disabled" at startup) and a dashboard load shouldn't depend on a separate
service just to feel fast. A short TTL (seconds, not minutes) is the point: it
absorbs a burst of near-simultaneous requests for the same data (e.g. a
dashboard's several widgets each asking for the same course's analytics) without
serving noticeably stale data.

Not safe across multiple worker processes (each has its own cache) - fine for
this app's current single-process deployment; would need Redis for a
multi-worker one.
"""
import time
from typing import Any, Callable, Optional

_store: dict[str, tuple[float, Any]] = {}


def get_or_compute(key: str, ttl_seconds: float, compute: Callable[[], Any]) -> Any:
    cached = _store.get(key)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    value = compute()
    _store[key] = (time.monotonic() + ttl_seconds, value)
    return value


def invalidate(key: str) -> None:
    _store.pop(key, None)


def invalidate_prefix(prefix: str) -> None:
    for key in [k for k in _store if k.startswith(prefix)]:
        _store.pop(key, None)
