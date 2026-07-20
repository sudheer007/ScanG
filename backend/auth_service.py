"""Google Sign-In: verify Google ID tokens, issue our own short-lived session JWT.

No passwords, no server-side sessions to manage — a signed JWT (HS256) is the
session. Google is the only identity provider; we never see or store a password.
"""
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

import jwt
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

JWT_ALG = "HS256"
JWT_TTL_DAYS = 30

_google_request = google_requests.Request()


class AuthNotConfigured(Exception):
    """Raised when GOOGLE_CLIENT_ID or JWT_SECRET is missing from the environment."""


def _client_ids() -> list[str]:
    raw = os.environ.get("GOOGLE_CLIENT_ID", "")
    return [c.strip() for c in raw.split(",") if c.strip()]


def _jwt_secret() -> str:
    secret = os.environ.get("JWT_SECRET", "")
    if not secret:
        raise AuthNotConfigured("JWT_SECRET not set")
    return secret


def verify_google_id_token(token: str) -> Dict[str, Any]:
    """Verify a Google-issued ID token (JWT) and return its decoded payload.

    Checks Google's signature, expiry, issuer, and that the audience matches
    one of our configured OAuth client IDs — this is what actually proves the
    token was issued to our app and not phished/replayed from elsewhere.
    """
    client_ids = _client_ids()
    if not client_ids:
        raise AuthNotConfigured("GOOGLE_CLIENT_ID not set")

    idinfo = google_id_token.verify_oauth2_token(token, _google_request, audience=None)

    if idinfo.get("aud") not in client_ids:
        raise ValueError("Token audience does not match configured Google client ID")
    if idinfo.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise ValueError("Unexpected token issuer")

    return idinfo


async def get_or_create_user(db, idinfo: Dict[str, Any]) -> Dict[str, Any]:
    sub = idinfo["sub"]
    now = datetime.now(timezone.utc)
    fields = {
        "email": idinfo.get("email"),
        "name": idinfo.get("name"),
        "picture": idinfo.get("picture"),
        "email_verified": bool(idinfo.get("email_verified")),
        "last_login_at": now,
    }
    await db.users.update_one(
        {"_id": sub},
        {"$set": fields, "$setOnInsert": {"_id": sub, "created_at": now}},
        upsert=True,
    )
    doc = await db.users.find_one({"_id": sub})
    return {
        "id": doc["_id"],
        "email": doc.get("email"),
        "name": doc.get("name"),
        "picture": doc.get("picture"),
    }


def create_session_token(user: Dict[str, Any]) -> str:
    secret = _jwt_secret()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user["id"],
        "email": user.get("email"),
        "name": user.get("name"),
        "picture": user.get("picture"),
        "iat": now,
        "exp": now + timedelta(days=JWT_TTL_DAYS),
    }
    return jwt.encode(payload, secret, algorithm=JWT_ALG)


def decode_session_token(token: str) -> Dict[str, Any]:
    secret = _jwt_secret()
    return jwt.decode(token, secret, algorithms=[JWT_ALG])
