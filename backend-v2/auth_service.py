"""Firebase Admin authentication helpers for user-scoped API routes."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Any, Dict, Optional

import firebase_admin
from firebase_admin import auth, credentials
from fastapi import Depends, Header, HTTPException

log = logging.getLogger(__name__)


@dataclass
class FirebaseUser:
    uid: str
    email: Optional[str] = None
    claims: Optional[Dict[str, Any]] = None


def _init_firebase() -> None:
    if firebase_admin._apps:
        return

    creds_json = os.environ.get("FIREBASE_CREDENTIALS_JSON")
    creds_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")

    if creds_json:
        cred = credentials.Certificate(json.loads(creds_json))
        firebase_admin.initialize_app(cred)
        log.info("Firebase Admin initialized from FIREBASE_CREDENTIALS_JSON")
    elif creds_path:
        if not os.path.isfile(creds_path):
            log.error("Firebase credentials file not found: %s", creds_path)
            return
        try:
            cred = credentials.Certificate(creds_path)
            firebase_admin.initialize_app(cred)
            log.info("Firebase Admin initialized from GOOGLE_APPLICATION_CREDENTIALS")
        except Exception as exc:
            log.error("Failed to load Firebase credentials from %s: %s", creds_path, exc)
            return
    else:
        log.warning(
            "Firebase Admin not configured; set FIREBASE_CREDENTIALS_JSON or "
            "GOOGLE_APPLICATION_CREDENTIALS for protected routes"
        )


def verify_id_token(token: str) -> Dict[str, Any]:
    _init_firebase()
    if not firebase_admin._apps:
        raise HTTPException(status_code=503, detail="Firebase Admin is not configured")
    try:
        return auth.verify_id_token(token)
    except auth.ExpiredIdTokenError:
        raise HTTPException(status_code=401, detail="Authentication token expired")
    except auth.RevokedIdTokenError:
        raise HTTPException(status_code=401, detail="Authentication token revoked")
    except auth.InvalidIdTokenError:
        raise HTTPException(status_code=401, detail="Invalid authentication token")
    except Exception as exc:
        log.warning("Token verification failed: %s", exc)
        raise HTTPException(status_code=401, detail="Authentication failed")


async def require_firebase_user(
    authorization: Optional[str] = Header(None),
) -> FirebaseUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing Bearer token")

    decoded = verify_id_token(token)
    return FirebaseUser(
        uid=decoded["uid"],
        email=decoded.get("email"),
        claims=decoded,
    )


async def require_self_user(
    user_id: str,
    user: FirebaseUser = Depends(require_firebase_user),
) -> FirebaseUser:
    if user_id != user.uid:
        raise HTTPException(status_code=403, detail="Forbidden")
    return user
