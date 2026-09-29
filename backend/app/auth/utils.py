from datetime import datetime, timedelta
from typing import Union, Any, List
import bcrypt
import hashlib
import json
import secrets
import string
import pyotp
from jose import jwt, JWTError
from app.config import settings

def hash_password(password: str) -> str:
    """Hash password using bcrypt directly."""
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify plain password against hashed password using bcrypt directly."""
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False

def create_access_token(data: dict, expires_delta: Union[timedelta, None] = None) -> str:
    """Generate JWT access token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt

def create_refresh_token(data: dict) -> str:
    """Long-lived companion to create_access_token, marked with type='refresh' so
    /auth/refresh can reject an access token handed to it by mistake (and vice
    versa - an access token has no 'type' claim at all, so it never satisfies the
    refresh endpoint's check)."""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> Union[dict, None]:
    """Decode JWT access token and return payload."""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        return payload
    except JWTError:
        return None


TWO_FA_PENDING_EXPIRE_MINUTES = 5


def create_two_factor_pending_token(user_id: int) -> str:
    """Short-lived token issued after a password check succeeds for a 2FA-enabled
    account, in place of real access/refresh tokens - proves "this caller already
    knows the password" without granting API access, since it carries no role and
    decode_access_token's normal callers never see type="2fa_pending". Exchanged for
    real tokens by POST /auth/2fa/verify-login."""
    to_encode = {
        "user_id": user_id,
        "type": "2fa_pending",
        "exp": datetime.utcnow() + timedelta(minutes=TWO_FA_PENDING_EXPIRE_MINUTES),
    }
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def generate_totp_secret() -> str:
    """A fresh base32 secret for one user's authenticator app (RFC 6238)."""
    return pyotp.random_base32()


def get_totp_uri(secret: str, email: str) -> str:
    """otpauth:// URI an authenticator app (Google Authenticator, Authy, etc.) scans
    from the setup QR code."""
    return pyotp.totp.TOTP(secret).provisioning_uri(name=email, issuer_name=settings.SMTP_FROM_NAME or "ConceptIntel")


def verify_totp_code(secret: str, code: str) -> bool:
    """valid_window=1 tolerates the code from one 30s step before/after the server's
    clock, which is the standard allowance for ordinary clock drift between a phone
    and the server - without it, a code entered a couple seconds late fails for no
    good reason."""
    if not secret or not code:
        return False
    try:
        return pyotp.totp.TOTP(secret).verify(code.strip(), valid_window=1)
    except Exception:
        return False


BACKUP_CODE_COUNT = 8


def _hash_backup_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def generate_backup_codes() -> tuple[List[str], str]:
    """Returns (raw_codes_to_show_once, hashed_codes_json_to_store) - mirrors the
    reset-token convention of only ever persisting a hash, never the usable value."""
    raw_codes = ["-".join([secrets.token_hex(2), secrets.token_hex(2)]) for _ in range(BACKUP_CODE_COUNT)]
    hashed = [_hash_backup_code(c) for c in raw_codes]
    return raw_codes, json.dumps(hashed)


def consume_backup_code(backup_codes_json: Union[str, None], code: str) -> Union[str, None]:
    """Checks `code` against the stored hashes and, if it matches, returns the
    remaining set (already re-serialized, one-time use) to persist - or None if the
    code didn't match anything, so the caller can tell the two cases apart without
    a second lookup."""
    if not backup_codes_json or not code:
        return None
    try:
        hashes = json.loads(backup_codes_json)
    except Exception:
        return None
    target = _hash_backup_code(code.strip().lower())
    if target not in hashes:
        return None
    hashes.remove(target)
    return json.dumps(hashes)


def generate_temporary_password(length: int = 12) -> str:
    """Generate a random temporary password satisfying the app's strength rules
    (upper, lower, digit, special char) for admin-provisioned teacher accounts."""
    special_chars = "!@#$%^&*"
    alphabet = string.ascii_letters + string.digits + special_chars
    while True:
        candidate = "".join(secrets.choice(alphabet) for _ in range(length))
        if (
            any(c.isupper() for c in candidate)
            and any(c.islower() for c in candidate)
            and any(c.isdigit() for c in candidate)
            and any(c in special_chars for c in candidate)
        ):
            return candidate
