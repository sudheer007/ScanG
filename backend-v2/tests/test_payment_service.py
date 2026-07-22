"""Tests for Razorpay payment_service and /api/payments routes."""

from __future__ import annotations

import hashlib
import hmac
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

import payment_service as pay
import server


class _FakeCursor:
    def __init__(self, items):
        self._items = items

    def sort(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    async def to_list(self, length):
        return self._items[:length]


@pytest.fixture
def client():
    return TestClient(server.app)


@pytest.fixture
def mock_verify_token():
    with patch("auth_service.verify_id_token") as mock:
        yield mock


def _sign(message: str, secret: str) -> str:
    return hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()


class TestSignatureVerification:
    def test_payment_signature_valid(self):
        secret = "test_key_secret"
        payment_id = "pay_123"
        sub_id = "sub_456"
        sig = _sign(f"{payment_id}|{sub_id}", secret)
        assert pay.verify_payment_signature(payment_id, sub_id, sig, key_secret=secret) is True

    def test_payment_signature_tampered(self):
        secret = "test_key_secret"
        sig = _sign("pay_123|sub_456", secret)
        with pytest.raises(pay.SignatureVerificationError):
            pay.verify_payment_signature("pay_999", "sub_456", sig, key_secret=secret)

    def test_webhook_signature_valid_raw_body(self):
        secret = "whsec_test"
        body = b'{"event":"subscription.activated","payload":{}}'
        sig = _sign(body.decode(), secret)
        assert pay.verify_webhook_signature(body, sig, webhook_secret=secret) is True

    def test_webhook_signature_rejects_reparsed_json(self):
        """Re-serializing JSON changes whitespace → signature must fail if body differs."""
        secret = "whsec_test"
        original = b'{"event":"subscription.activated","payload":{}}'
        sig = _sign(original.decode(), secret)
        # Compact vs spaced would fail; here we mutate payload slightly.
        mutated = b'{"event": "subscription.activated", "payload": {}}'
        with pytest.raises(pay.SignatureVerificationError):
            pay.verify_webhook_signature(mutated, sig, webhook_secret=secret)


class TestPlanCatalog:
    def test_public_plans_hide_razorpay_ids(self):
        items = pay.public_plans()
        assert len(items) >= 2
        for item in items:
            assert "razorpay_plan_id" not in item
            assert item["amount"] > 0
            assert item["currency"] == "INR"

    def test_unknown_plan(self):
        assert pay.get_plan("does_not_exist") is None


def test_webhook_idempotency():
    import asyncio

    async def _run():
        webhook_coll = MagicMock()
        webhook_coll.find_one = AsyncMock(side_effect=[None, {"event_id": "evt_1"}])
        webhook_coll.insert_one = AsyncMock()

        subs_coll = MagicMock()
        subs_coll.find_one = AsyncMock(return_value=None)
        subs_coll.update_one = AsyncMock()

        payments_coll = MagicMock()
        payments_coll.update_one = AsyncMock()

        db = SimpleNamespace(
            webhook_events=webhook_coll,
            subscriptions=subs_coll,
            payments=payments_coll,
        )

        event = {
            "event": "subscription.activated",
            "payload": {
                "subscription": {
                    "entity": {
                        "id": "sub_abc",
                        "status": "active",
                        "plan_id": "plan_x",
                        "notes": {"uid": "user-1", "plan_id": "premium_monthly"},
                        "current_start": 1700000000,
                        "current_end": 1702678400,
                    }
                }
            },
        }

        first = await pay.handle_webhook_event(db, "evt_1", event)
        assert first["ok"] is True
        assert first["duplicate"] is False
        assert webhook_coll.insert_one.await_count == 1
        assert subs_coll.update_one.await_count == 1

        second = await pay.handle_webhook_event(db, "evt_1", event)
        assert second["duplicate"] is True
        assert webhook_coll.insert_one.await_count == 1  # no second insert
        assert subs_coll.update_one.await_count == 1

    asyncio.run(_run())


class TestPaymentRoutes:
    def test_list_plans_public(self, client):
        r = client.get("/api/payments/plans")
        assert r.status_code == 200
        data = r.json()
        assert "items" in data
        assert any(p["id"] == "premium_monthly" for p in data["items"])

    def test_create_subscription_requires_auth(self, client):
        r = client.post("/api/payments/subscriptions", json={"plan_id": "premium_monthly"})
        assert r.status_code == 401

    def test_create_subscription_unknown_plan(self, client, mock_verify_token):
        mock_verify_token.return_value = {"uid": "user-abc", "email": "a@example.com"}
        with patch.object(pay, "razorpay_configured", return_value=True):
            r = client.post(
                "/api/payments/subscriptions",
                json={"plan_id": "not_a_real_plan"},
                headers={"Authorization": "Bearer good"},
            )
        assert r.status_code == 400
        assert "Unknown plan" in r.json()["detail"]

    def test_create_subscription_success(self, client, mock_verify_token):
        mock_verify_token.return_value = {"uid": "user-abc", "email": "a@example.com"}

        users = MagicMock()
        users.find_one = AsyncMock(return_value={"uid": "user-abc", "razorpay_customer_id": "cust_1"})
        users.update_one = AsyncMock()

        subs = MagicMock()
        subs.find_one = AsyncMock(return_value=None)
        subs.insert_one = AsyncMock()

        fake_client = MagicMock()
        fake_client.subscription.create.return_value = {
            "id": "sub_new",
            "status": "created",
        }

        with patch.object(server.db, "users", users), patch.object(
            server.db, "subscriptions", subs
        ), patch.object(pay, "get_client", return_value=fake_client), patch.object(
            pay, "get_key_id", return_value="rzp_test_key"
        ), patch.object(
            pay,
            "get_plan",
            return_value={
                "id": "premium_monthly",
                "name": "Premium Monthly",
                "amount": 29900,
                "currency": "INR",
                "interval": "monthly",
                "total_count": 120,
                "razorpay_plan_id": "plan_monthly_test",
                "features": [],
            },
        ):
            r = client.post(
                "/api/payments/subscriptions",
                json={"plan_id": "premium_monthly"},
                headers={"Authorization": "Bearer good"},
            )

        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert body["subscription_id"] == "sub_new"
        assert body["key_id"] == "rzp_test_key"
        fake_client.subscription.create.assert_called_once()
        # Client must never dictate amount — server catalog does.
        call_kwargs = fake_client.subscription.create.call_args[0][0]
        assert "amount" not in call_kwargs
        assert call_kwargs["plan_id"] == "plan_monthly_test"

    def test_webhook_invalid_signature(self, client):
        with patch.object(pay, "verify_webhook_signature", side_effect=pay.SignatureVerificationError()):
            r = client.post(
                "/api/payments/webhook",
                data=b'{"event":"subscription.activated"}',
                headers={"X-Razorpay-Signature": "bad"},
            )
        assert r.status_code == 400

    def test_webhook_valid(self, client):
        with patch.object(pay, "verify_webhook_signature", return_value=True), patch.object(
            pay, "handle_webhook_event", new_callable=AsyncMock
        ) as handler:
            handler.return_value = {"ok": True, "duplicate": False, "event": "subscription.activated"}
            r = client.post(
                "/api/payments/webhook",
                content=json.dumps({"event": "subscription.activated", "payload": {}}).encode(),
                headers={
                    "X-Razorpay-Signature": "ok",
                    "X-Razorpay-Event-Id": "evt_test",
                    "Content-Type": "application/json",
                },
            )
        assert r.status_code == 200
        assert r.json()["ok"] is True
        handler.assert_awaited_once()

    def test_me_subscription_requires_auth(self, client):
        r = client.get("/api/payments/me/subscription")
        assert r.status_code == 401

    def test_me_subscription(self, client, mock_verify_token):
        mock_verify_token.return_value = {"uid": "user-abc", "email": "a@example.com"}
        with patch.object(
            pay,
            "get_entitlement",
            new_callable=AsyncMock,
            return_value={
                "is_premium": True,
                "plan_id": "premium_monthly",
                "status": "active",
                "current_period_end": None,
                "subscription_id": "sub_1",
                "cancel_at_cycle_end": False,
            },
        ):
            r = client.get(
                "/api/payments/me/subscription",
                headers={"Authorization": "Bearer good"},
            )
        assert r.status_code == 200
        assert r.json()["is_premium"] is True
