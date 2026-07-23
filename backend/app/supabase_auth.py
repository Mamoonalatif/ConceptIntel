"""Bridge to Supabase Auth (GoTrue) - the backend is the SOLE integration point with
Supabase Auth, using the service_role key. This keeps the migration low-risk:

- Your own `users` table (integer id) stays the source of truth for every foreign
  key in the app (courses.teacher_id, enrollments.student_id, etc.) - unchanged.
- Your own JWT (create_access_token/get_current_user) stays the mechanism for
  authorizing every request - unchanged.
- Only the credential-establishing calls (register, login, Google sign-in, change
  password) now delegate to Supabase: passwords are verified/stored by Supabase,
  not locally, and every account gets a linked `auth.users` row in Supabase (tracked
  here via `users.supabase_uid`).

No frontend changes required - the frontend keeps talking to this backend's /auth/*
endpoints exactly as before.
"""
from functools import lru_cache
import httpx
from app.config import settings

AUTH_URL = f"{settings.SUPABASE_URL}/auth/v1"


@lru_cache(maxsize=1)
def _client() -> httpx.Client:
    """A single persistent client, reused across every call in this module. Every
    Supabase Auth call is a round-trip to another region - opening a fresh TCP+TLS
    connection per call (the previous module-level httpx.post/get/etc. behavior)
    adds a full handshake's worth of latency on top of that every single time.
    Keep-alive connection reuse cuts this down meaningfully after the first call."""
    return httpx.Client(
        base_url=AUTH_URL,
        headers={
            "Authorization": f"Bearer {settings.SUPABASE_KEY}",
            "apikey": settings.SUPABASE_KEY,
            "Content-Type": "application/json",
        },
        timeout=15.0,
    )


def is_supabase_auth_configured() -> bool:
    return bool(settings.SUPABASE_URL and settings.SUPABASE_KEY)


def create_supabase_user(email: str, password: str) -> str:
    """Creates an auth.users row via the Admin API. email_confirm=True since this
    app has its own registration validation and no separate email-confirmation flow -
    Supabase is used for credential storage/verification, not its confirmation emails.
    Returns the Supabase user's UUID."""
    resp = _client().post("/admin/users", json={"email": email, "password": password, "email_confirm": True})
    if resp.status_code not in (200, 201):
        raise Exception(f"Supabase user creation failed ({resp.status_code}): {resp.text}")
    return resp.json()["id"]


def verify_supabase_password(email: str, password: str) -> bool:
    """Verifies credentials via Supabase's password grant - this is the only way to
    check a password since the backend no longer stores it. Returns False (not an
    exception) on any auth failure, to keep call sites simple."""
    resp = _client().post("/token", params={"grant_type": "password"}, json={"email": email, "password": password})
    return resp.status_code == 200


def find_supabase_user_by_email(email: str) -> str | None:
    """Returns the Supabase user's UUID if one exists for this email, else None."""
    resp = _client().get("/admin/users", params={"filter": email})
    if resp.status_code != 200:
        return None
    for u in resp.json().get("users", []):
        if u.get("email", "").lower() == email.lower():
            return u["id"]
    return None


def get_or_create_supabase_user_by_email(email: str, full_name: str) -> str:
    """Used for Google sign-in: links (or creates) a matching Supabase auth user for
    an email that was just verified via Google's own ID token - no password is set
    (Google is the credential; Supabase's record exists for identity consistency)."""
    existing = find_supabase_user_by_email(email)
    if existing:
        return existing

    resp = _client().post("/admin/users", json={
        "email": email,
        "email_confirm": True,
        "user_metadata": {"full_name": full_name, "provider": "google"},
    })
    if resp.status_code not in (200, 201):
        raise Exception(f"Supabase user creation failed ({resp.status_code}): {resp.text}")
    return resp.json()["id"]


def update_supabase_user_password(supabase_uid: str, new_password: str) -> None:
    resp = _client().put(f"/admin/users/{supabase_uid}", json={"password": new_password})
    if resp.status_code != 200:
        raise Exception(f"Supabase password update failed ({resp.status_code}): {resp.text}")


def delete_supabase_user(supabase_uid: str) -> None:
    try:
        _client().delete(f"/admin/users/{supabase_uid}")
    except Exception as e:
        print(f"Warning: failed to delete Supabase auth user {supabase_uid}: {e}")
