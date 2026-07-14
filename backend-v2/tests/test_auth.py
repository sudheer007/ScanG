"""Tests for Firebase authentication on user-scoped routes."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import auth_service
import server


class _FakeCursor:
    def __init__(self, items):
        self._items = items

    async def to_list(self, length):
        return self._items


@pytest.fixture
def client():
    return TestClient(server.app)


@pytest.fixture
def mock_verify_token():
    with patch("auth_service.verify_id_token") as mock:
        yield mock


@pytest.fixture
def mock_watchlist_db():
    coll = MagicMock()
    coll.find_one = AsyncMock(return_value=None)
    coll.insert_one = AsyncMock()
    coll.delete_one = AsyncMock(return_value=SimpleNamespace(deleted_count=1))
    coll.find = MagicMock(return_value=_FakeCursor([]))
    with patch.object(server.db, "watchlist", coll):
        yield coll


@pytest.fixture
def mock_screens_db():
    coll = MagicMock()
    coll.find_one = AsyncMock(return_value=None)
    coll.insert_one = AsyncMock()
    coll.delete_one = AsyncMock(return_value=SimpleNamespace(deleted_count=1))
    coll.find = MagicMock(return_value=_FakeCursor([]))
    with patch.object(server.db, "screens", coll):
        yield coll


@pytest.fixture
def mock_users_db():
    coll = MagicMock()
    coll.find_one = AsyncMock(return_value=None)
    coll.insert_one = AsyncMock()
    coll.update_one = AsyncMock()
    with patch.object(server.db, "users", coll):
        yield coll


def _auth_token():
    return {"uid": "user-abc", "email": "a@example.com", "name": "Mahesh Kumar"}


class TestAuthService:
    def test_verify_id_token_expired(self):
        with patch("auth_service._init_firebase"), patch(
            "auth_service.firebase_admin._apps", {"default": object()}
        ), patch("auth_service.auth.verify_id_token") as mock_verify:
            from firebase_admin import auth as firebase_auth

            mock_verify.side_effect = firebase_auth.ExpiredIdTokenError("msg", Exception("cause"))
            with pytest.raises(HTTPException) as exc:
                auth_service.verify_id_token("token")
            assert exc.value.status_code == 401
            assert exc.value.detail == "Authentication token expired"

    def test_verify_id_token_revoked(self):
        with patch("auth_service._init_firebase"), patch(
            "auth_service.firebase_admin._apps", {"default": object()}
        ), patch("auth_service.auth.verify_id_token") as mock_verify:
            from firebase_admin import auth as firebase_auth

            mock_verify.side_effect = firebase_auth.RevokedIdTokenError("revoked")
            with pytest.raises(HTTPException) as exc:
                auth_service.verify_id_token("token")
            assert exc.value.status_code == 401
            assert exc.value.detail == "Authentication token revoked"


class TestWatchlistAuth:
    def test_list_watchlist_missing_token(self, client):
        r = client.get("/api/watchlist/user-abc")
        assert r.status_code == 401
        assert r.json()["detail"] == "Missing Bearer token"

    def test_list_watchlist_invalid_token(self, client, mock_verify_token):
        def _raise(_token):
            raise HTTPException(status_code=401, detail="Invalid authentication token")

        mock_verify_token.side_effect = _raise
        r = client.get("/api/watchlist/user-abc", headers={"Authorization": "Bearer bad"})
        assert r.status_code == 401

    def test_list_watchlist_cross_user_denied(self, client, mock_verify_token):
        mock_verify_token.return_value = _auth_token()
        r = client.get("/api/watchlist/other-user", headers={"Authorization": "Bearer good"})
        assert r.status_code == 403
        assert r.json()["detail"] == "Forbidden"

    def test_list_watchlist_success(self, client, mock_verify_token, mock_watchlist_db):
        mock_verify_token.return_value = _auth_token()
        mock_watchlist_db.find.return_value = _FakeCursor([{"symbol": "AAPL", "user_id": "user-abc"}])

        r = client.get("/api/watchlist/user-abc", headers={"Authorization": "Bearer good"})
        assert r.status_code == 200
        assert r.json()["items"] == [{"symbol": "AAPL", "user_id": "user-abc"}]
        mock_watchlist_db.find.assert_called_once_with({"user_id": "user-abc"}, {"_id": 0})

    def test_add_watchlist_uses_token_uid(
        self, client, mock_verify_token, mock_watchlist_db
    ):
        mock_verify_token.return_value = _auth_token()

        r = client.post(
            "/api/watchlist",
            headers={"Authorization": "Bearer good"},
            json={"symbol": "AAPL", "market": "US"},
        )
        assert r.status_code == 200
        assert r.json()["ok"] is True
        inserted = mock_watchlist_db.insert_one.call_args[0][0]
        assert inserted["user_id"] == "user-abc"
        assert inserted["symbol"] == "AAPL"

    def test_add_watchlist_body_user_mismatch_denied(
        self, client, mock_verify_token, mock_watchlist_db
    ):
        mock_verify_token.return_value = _auth_token()

        r = client.post(
            "/api/watchlist",
            headers={"Authorization": "Bearer good"},
            json={"user_id": "other-user", "symbol": "AAPL", "market": "US"},
        )
        assert r.status_code == 403
        mock_watchlist_db.insert_one.assert_not_called()


class TestScreensAuth:
    def test_delete_screen_missing_token(self, client):
        r = client.delete("/api/screens/screen-1")
        assert r.status_code == 401

    def test_delete_screen_cross_user_denied(self, client, mock_verify_token, mock_screens_db):
        mock_verify_token.return_value = _auth_token()
        mock_screens_db.find_one = AsyncMock(
            return_value={"id": "screen-1", "user_id": "other-user"}
        )

        r = client.delete("/api/screens/screen-1", headers={"Authorization": "Bearer good"})
        assert r.status_code == 403
        mock_screens_db.delete_one.assert_not_called()

    def test_delete_screen_success(self, client, mock_verify_token, mock_screens_db):
        mock_verify_token.return_value = _auth_token()
        mock_screens_db.find_one = AsyncMock(
            return_value={"id": "screen-1", "user_id": "user-abc"}
        )

        r = client.delete("/api/screens/screen-1", headers={"Authorization": "Bearer good"})
        assert r.status_code == 200
        assert r.json()["deleted"] == 1
        mock_screens_db.delete_one.assert_called_once_with(
            {"id": "screen-1", "user_id": "user-abc"}
        )

    def test_save_screen_uses_token_uid(self, client, mock_verify_token, mock_screens_db):
        mock_verify_token.return_value = _auth_token()

        r = client.post(
            "/api/screens",
            headers={"Authorization": "Bearer good"},
            json={"name": "Value", "market": "US", "filters": {"pe_max": 20}},
        )
        assert r.status_code == 200
        inserted = mock_screens_db.insert_one.call_args[0][0]
        assert inserted["user_id"] == "user-abc"
        assert inserted["name"] == "Value"


class TestMeOnboarding:
    def test_get_me_requires_auth(self, client):
        r = client.get("/api/me")
        assert r.status_code == 401

    def test_get_me_creates_profile_requiring_onboarding(
        self, client, mock_verify_token, mock_users_db
    ):
        mock_verify_token.return_value = _auth_token()

        r = client.get("/api/me", headers={"Authorization": "Bearer good"})
        assert r.status_code == 200
        body = r.json()
        assert body["uid"] == "user-abc"
        assert body["onboarding_completed"] is False
        assert body["display_name"] == "Mahesh Kumar"
        mock_users_db.insert_one.assert_called_once()

    def test_get_me_repairs_auto_completed_profile(
        self, client, mock_verify_token, mock_users_db
    ):
        mock_verify_token.return_value = _auth_token()
        mock_users_db.find_one = AsyncMock(
            return_value={
                "uid": "user-abc",
                "email": "a@example.com",
                "display_name": "Mahesh Kumar",
                "onboarding_completed": True,
                # Missing onboarding_completed_at => never finished the name screen.
            }
        )

        r = client.get("/api/me", headers={"Authorization": "Bearer good"})
        assert r.status_code == 200
        assert r.json()["onboarding_completed"] is False
        mock_users_db.update_one.assert_called_once()
        mock_users_db.insert_one.assert_not_called()

    def test_get_me_keeps_completed_profile(
        self, client, mock_verify_token, mock_users_db
    ):
        mock_verify_token.return_value = _auth_token()
        mock_users_db.find_one = AsyncMock(
            return_value={
                "uid": "user-abc",
                "email": "a@example.com",
                "display_name": "Existing",
                "onboarding_completed": True,
                "onboarding_completed_at": "2026-07-13T00:00:00Z",
            }
        )

        r = client.get("/api/me", headers={"Authorization": "Bearer good"})
        assert r.status_code == 200
        assert r.json()["onboarding_completed"] is True
        mock_users_db.update_one.assert_not_called()
        mock_users_db.insert_one.assert_not_called()

    def test_complete_onboarding(self, client, mock_verify_token, mock_users_db):
        mock_verify_token.return_value = _auth_token()
        mock_users_db.find_one = AsyncMock(
            side_effect=[
                None,
                {
                    "uid": "user-abc",
                    "email": "a@example.com",
                    "display_name": "Custom Name",
                    "onboarding_completed": True,
                },
            ]
        )

        r = client.post(
            "/api/me/onboarding",
            headers={"Authorization": "Bearer good"},
            json={"display_name": "Custom Name"},
        )
        assert r.status_code == 200
        assert r.json()["onboarding_completed"] is True
        assert r.json()["display_name"] == "Custom Name"
        update = mock_users_db.update_one.call_args[0][1]["$set"]
        assert update["display_name"] == "Custom Name"
        assert update["onboarding_completed"] is True

    def test_complete_onboarding_rejects_empty_name(
        self, client, mock_verify_token, mock_users_db
    ):
        mock_verify_token.return_value = _auth_token()

        r = client.post(
            "/api/me/onboarding",
            headers={"Authorization": "Bearer good"},
            json={"display_name": "   "},
        )
        assert r.status_code == 400
        mock_users_db.update_one.assert_not_called()
