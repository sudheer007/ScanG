"""Unit tests for auth_service pure functions (JWT session issue/verify).

No network, no live server, no Google calls — token verification against
Google is exercised manually / in prod, not here. Run:
    cd backend && pytest tests/test_auth.py -v
"""
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import auth_service as auth  # noqa: E402

USER = {"id": "google-sub-123", "email": "a@example.com", "name": "A B", "picture": "https://x/y.png"}


def test_create_and_decode_session_token_roundtrip(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    token = auth.create_session_token(USER)
    payload = auth.decode_session_token(token)
    assert payload["sub"] == USER["id"]
    assert payload["email"] == USER["email"]
    assert payload["name"] == USER["name"]
    assert payload["picture"] == USER["picture"]


def test_decode_rejects_tampered_token(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    token = auth.create_session_token(USER)
    tampered = token[:-1] + ("A" if token[-1] != "A" else "B")
    with pytest.raises(Exception):
        auth.decode_session_token(tampered)


def test_decode_rejects_token_signed_with_different_secret(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "secret-one")
    token = auth.create_session_token(USER)
    monkeypatch.setenv("JWT_SECRET", "secret-two")
    with pytest.raises(Exception):
        auth.decode_session_token(token)


def test_missing_jwt_secret_raises_auth_not_configured(monkeypatch):
    monkeypatch.delenv("JWT_SECRET", raising=False)
    with pytest.raises(auth.AuthNotConfigured):
        auth.create_session_token(USER)


def test_verify_google_id_token_requires_client_id(monkeypatch):
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
    with pytest.raises(auth.AuthNotConfigured):
        auth.verify_google_id_token("whatever")
