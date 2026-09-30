# Regression tests for the auth hardening: login rate limiting and refresh-token misuse.
import pytest
from fastapi import HTTPException

from app.auth.routes import get_current_user
from app.auth.utils import create_access_token, create_refresh_token
from app.core.rate_limit import _local_hits, enforce_rate_limit


def test_rate_limit_blocks_after_limit(monkeypatch):
    # Force the in-process fallback so the test needs no Redis.
    monkeypatch.setattr("app.core.rate_limit.cache.client", None, raising=False)
    _local_hits.clear()
    for _ in range(3):
        enforce_rate_limit("test-scope", "someone@example.com", 3, 60)
    with pytest.raises(HTTPException) as exc:
        enforce_rate_limit("test-scope", "someone@example.com", 3, 60)
    assert exc.value.status_code == 429
    # A different identity is tracked separately.
    enforce_rate_limit("test-scope", "other@example.com", 3, 60)


def test_refresh_token_cannot_authenticate_api_calls():
    token = create_refresh_token({"sub": "a@b.com", "user_id": 1, "tv": 0})
    with pytest.raises(HTTPException) as exc:
        get_current_user(token=token, db=None)  # rejected before any DB lookup
    assert exc.value.status_code == 401


def test_access_token_has_no_type_claim():
    from app.auth.utils import decode_access_token
    payload = decode_access_token(create_access_token({"sub": "a@b.com", "user_id": 1, "tv": 0}))
    assert payload.get("type") is None
