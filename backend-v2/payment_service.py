"""Razorpay subscription payments — secure helpers for ScanG Premium.

Security notes (do not "simplify" these away):
- Amounts always come from PLAN_CATALOG on the server. The client only sends plan_id.
- Payment-callback signature uses the API key secret over payment_id|subscription_id.
- Webhook signature uses RAZORPAY_WEBHOOK_SECRET over the raw request body bytes.
  Never re-serialize JSON before hashing — whitespace/key order will break verification.
- Entitlement is granted/revoked from verified webhook events (or a server-side fetch),
  never from unauthenticated client claims alone.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

log = logging.getLogger(__name__)

# Default catalog amounts (paise). Override via env for Razorpay Plan IDs.
# Change these when you decide final pricing — keep in sync with Razorpay Dashboard plans.
_DEFAULT_FEATURES = [
    "Unlimited screener filters",
    "Full analyzer reports",
    "Priority Nifty Pulse updates",
    "Portfolio insights",
]


def _plan_id_from_env(key: str) -> str:
    return (os.environ.get(key) or "").strip()


def build_plan_catalog() -> Dict[str, Dict[str, Any]]:
    """Server-side source of truth for subscription plans (no secrets exposed)."""
    return {
        "premium_monthly": {
            "id": "premium_monthly",
            "name": "Premium Monthly",
            "description": "Full ScanG Premium, billed every month",
            "amount": 1000,  # ₹10.00
            "currency": "INR",
            "interval": "monthly",
            "interval_count": 1,
            "total_count": 120,  # 10 years of renewals
            "features": list(_DEFAULT_FEATURES),
            "razorpay_plan_id": _plan_id_from_env("RAZORPAY_PLAN_ID_MONTHLY"),
        },
        "premium_yearly": {
            "id": "premium_yearly",
            "name": "Premium Yearly",
            "description": "Full ScanG Premium, billed once a year",
            "amount": 2000,  # ₹20.00
            "currency": "INR",
            "interval": "yearly",
            "interval_count": 1,
            "total_count": 10,
            "features": list(_DEFAULT_FEATURES) + ["Best value — save vs monthly"],
            "razorpay_plan_id": _plan_id_from_env("RAZORPAY_PLAN_ID_YEARLY"),
        },
    }


def public_plans() -> List[Dict[str, Any]]:
    """Plans safe to return to clients (no Razorpay plan IDs required for display)."""
    out = []
    for plan in build_plan_catalog().values():
        out.append(
            {
                "id": plan["id"],
                "name": plan["name"],
                "description": plan["description"],
                "amount": plan["amount"],
                "currency": plan["currency"],
                "interval": plan["interval"],
                "features": plan["features"],
            }
        )
    return out


def get_plan(plan_id: str) -> Optional[Dict[str, Any]]:
    return build_plan_catalog().get(plan_id)


class PaymentError(Exception):
    """Domain error for payment flows (mapped to HTTP by routes)."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class SignatureVerificationError(PaymentError):
    def __init__(self, message: str = "Invalid payment signature"):
        super().__init__(message, status_code=400)


_client = None


def razorpay_configured() -> bool:
    key_id = (os.environ.get("RAZORPAY_KEY_ID") or "").strip()
    key_secret = (os.environ.get("RAZORPAY_KEY_SECRET") or "").strip()
    return bool(key_id and key_secret)


def get_key_id() -> str:
    key_id = (os.environ.get("RAZORPAY_KEY_ID") or "").strip()
    if not key_id:
        raise PaymentError("Payments are not configured", status_code=503)
    return key_id


def get_client():
    """Lazy Razorpay client singleton."""
    global _client
    if _client is not None:
        return _client
    if not razorpay_configured():
        raise PaymentError("Payments are not configured", status_code=503)
    import razorpay

    _client = razorpay.Client(
        auth=(
            os.environ["RAZORPAY_KEY_ID"].strip(),
            os.environ["RAZORPAY_KEY_SECRET"].strip(),
        )
    )
    return _client


def reset_client_for_tests() -> None:
    """Clear cached client (tests only)."""
    global _client
    _client = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hmac_hex(message: str, secret: str) -> str:
    return hmac.new(
        secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def verify_payment_signature(
    payment_id: str,
    subscription_id: str,
    signature: str,
    *,
    key_secret: Optional[str] = None,
) -> bool:
    """Verify Checkout callback signature.

    Message: payment_id|subscription_id
    Key: Razorpay API key secret (NOT the webhook secret).
    """
    secret = (key_secret or os.environ.get("RAZORPAY_KEY_SECRET") or "").strip()
    if not secret or not payment_id or not subscription_id or not signature:
        raise SignatureVerificationError()
    expected = _hmac_hex(f"{payment_id}|{subscription_id}", secret)
    if not hmac.compare_digest(expected, signature):
        raise SignatureVerificationError()
    return True


def verify_webhook_signature(
    raw_body: bytes,
    signature: str,
    *,
    webhook_secret: Optional[str] = None,
) -> bool:
    """Verify webhook X-Razorpay-Signature over the raw body bytes.

    Key: RAZORPAY_WEBHOOK_SECRET (NOT the API key secret).
    Pass the exact bytes Razorpay sent — do not parse/re-stringify JSON first.
    """
    secret = (webhook_secret or os.environ.get("RAZORPAY_WEBHOOK_SECRET") or "").strip()
    if not secret or not signature or raw_body is None:
        raise SignatureVerificationError("Invalid webhook signature")
    body_str = raw_body.decode("utf-8") if isinstance(raw_body, (bytes, bytearray)) else str(raw_body)
    expected = _hmac_hex(body_str, secret)
    if not hmac.compare_digest(expected, signature):
        raise SignatureVerificationError("Invalid webhook signature")
    return True


async def create_or_get_customer(db, client, user) -> str:
    """Create or reuse a Razorpay customer keyed by Firebase uid."""
    existing = await db.users.find_one({"uid": user.uid}, {"_id": 0, "razorpay_customer_id": 1})
    if existing and existing.get("razorpay_customer_id"):
        return existing["razorpay_customer_id"]

    payload: Dict[str, Any] = {
        "name": (getattr(user, "email", None) or user.uid)[:50],
        "fail_existing": "0",
        "notes": {"uid": user.uid},
    }
    if getattr(user, "email", None):
        payload["email"] = user.email

    try:
        customer = client.customer.create(payload)
    except Exception as exc:
        log.warning("Razorpay customer.create failed for uid=%s: %s", user.uid, exc)
        raise PaymentError("Unable to start payment. Please try again.", status_code=502)

    customer_id = customer.get("id")
    if not customer_id:
        raise PaymentError("Unable to start payment. Please try again.", status_code=502)

    await db.users.update_one(
        {"uid": user.uid},
        {
            "$set": {
                "razorpay_customer_id": customer_id,
                "updated_at": _now(),
            },
            "$setOnInsert": {
                "uid": user.uid,
                "email": getattr(user, "email", None),
                "created_at": _now(),
                "onboarding_completed": False,
            },
        },
        upsert=True,
    )
    return customer_id


async def create_subscription(db, user, plan_id: str) -> Dict[str, Any]:
    """Create a Razorpay subscription for the authenticated user."""
    plan = get_plan(plan_id)
    if not plan:
        raise PaymentError("Unknown plan", status_code=400)

    rz_plan_id = (plan.get("razorpay_plan_id") or "").strip()
    if not rz_plan_id:
        raise PaymentError(
            "This plan is not available yet. Please contact support.",
            status_code=503,
        )

    # Block duplicate active/creating subscriptions for the same user.
    active = await db.subscriptions.find_one(
        {
            "uid": user.uid,
            "status": {"$in": ["created", "authenticated", "active", "pending", "halted"]},
        },
        {"_id": 0},
    )
    if active and active.get("status") in ("active", "authenticated"):
        raise PaymentError("You already have an active subscription", status_code=409)

    client = get_client()
    customer_id = await create_or_get_customer(db, client, user)

    try:
        sub = client.subscription.create(
            {
                "plan_id": rz_plan_id,
                "customer_id": customer_id,
                "total_count": int(plan["total_count"]),
                "customer_notify": 1,
                "notes": {
                    "uid": user.uid,
                    "plan_id": plan_id,
                },
            }
        )
    except Exception as exc:
        log.warning("Razorpay subscription.create failed uid=%s plan=%s: %s", user.uid, plan_id, exc)
        raise PaymentError("Unable to create subscription. Please try again.", status_code=502)

    subscription_id = sub.get("id")
    if not subscription_id:
        raise PaymentError("Unable to create subscription. Please try again.", status_code=502)

    now = _now()
    doc = {
        "id": str(uuid.uuid4()),
        "uid": user.uid,
        "plan_id": plan_id,
        "razorpay_subscription_id": subscription_id,
        "razorpay_customer_id": customer_id,
        "razorpay_plan_id": rz_plan_id,
        "status": sub.get("status") or "created",
        "amount": plan["amount"],
        "currency": plan["currency"],
        "current_start": None,
        "current_end": None,
        "cancel_at_cycle_end": False,
        "created_at": now,
        "updated_at": now,
    }
    await db.subscriptions.insert_one(doc)

    return {
        "subscription_id": subscription_id,
        "key_id": get_key_id(),
        "plan": {
            "id": plan["id"],
            "name": plan["name"],
            "amount": plan["amount"],
            "currency": plan["currency"],
            "interval": plan["interval"],
        },
        "name": "ScanG",
        "description": plan["name"],
        "prefill": {
            "email": getattr(user, "email", None) or "",
        },
        "theme": {"color": "#1A82FF"},
    }


async def verify_and_record_payment(
    db,
    user,
    *,
    razorpay_payment_id: str,
    razorpay_subscription_id: str,
    razorpay_signature: str,
) -> Dict[str, Any]:
    """Verify Checkout signature and optimistically mark subscription authenticated.

    Webhooks remain the source of truth for entitlement activation.
    """
    if not all([razorpay_payment_id, razorpay_subscription_id, razorpay_signature]):
        raise PaymentError("Missing payment verification fields", status_code=400)

    verify_payment_signature(
        razorpay_payment_id,
        razorpay_subscription_id,
        razorpay_signature,
    )

    local = await db.subscriptions.find_one(
        {"razorpay_subscription_id": razorpay_subscription_id, "uid": user.uid},
        {"_id": 0},
    )
    if not local:
        raise PaymentError("Subscription not found", status_code=404)

    # Double-check with Razorpay (server-to-server).
    try:
        remote = get_client().subscription.fetch(razorpay_subscription_id)
    except Exception as exc:
        log.warning("subscription.fetch failed %s: %s", razorpay_subscription_id, exc)
        remote = {}

    remote_status = (remote or {}).get("status") or local.get("status") or "authenticated"
    now = _now()
    updates: Dict[str, Any] = {
        "status": remote_status if remote_status != "created" else "authenticated",
        "updated_at": now,
        "last_payment_id": razorpay_payment_id,
    }
    if (remote or {}).get("current_start"):
        updates["current_start"] = datetime.fromtimestamp(
            int(remote["current_start"]), tz=timezone.utc
        )
    if (remote or {}).get("current_end"):
        updates["current_end"] = datetime.fromtimestamp(
            int(remote["current_end"]), tz=timezone.utc
        )

    await db.subscriptions.update_one(
        {"razorpay_subscription_id": razorpay_subscription_id, "uid": user.uid},
        {"$set": updates},
    )

    await db.payments.update_one(
        {"razorpay_payment_id": razorpay_payment_id},
        {
            "$set": {
                "uid": user.uid,
                "razorpay_payment_id": razorpay_payment_id,
                "razorpay_subscription_id": razorpay_subscription_id,
                "plan_id": local.get("plan_id"),
                "amount": local.get("amount"),
                "currency": local.get("currency") or "INR",
                "status": "authorized",
                "updated_at": now,
            },
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "created_at": now,
            },
        },
        upsert=True,
    )

    entitlement = await get_entitlement(db, user.uid)
    return {
        "ok": True,
        "verified": True,
        "status": updates["status"],
        "subscription": entitlement,
        "payment_id": razorpay_payment_id,
        "amount": local.get("amount"),
        "currency": local.get("currency") or "INR",
    }


def _ts_to_dt(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc)
    except (TypeError, ValueError, OSError):
        return None


async def _upsert_subscription_from_entity(db, entity: Dict[str, Any], fallback_status: str) -> None:
    sub_id = entity.get("id")
    if not sub_id:
        return
    notes = entity.get("notes") or {}
    uid = notes.get("uid")
    plan_id = notes.get("plan_id")

    existing = await db.subscriptions.find_one(
        {"razorpay_subscription_id": sub_id},
        {"_id": 0},
    )
    if not uid and existing:
        uid = existing.get("uid")
    if not plan_id and existing:
        plan_id = existing.get("plan_id")
    if not uid:
        log.warning("Webhook subscription %s missing uid notes; skipping entitlement update", sub_id)
        return

    status = entity.get("status") or fallback_status
    now = _now()
    await db.subscriptions.update_one(
        {"razorpay_subscription_id": sub_id},
        {
            "$set": {
                "uid": uid,
                "plan_id": plan_id,
                "razorpay_subscription_id": sub_id,
                "razorpay_plan_id": entity.get("plan_id"),
                "status": status,
                "current_start": _ts_to_dt(entity.get("current_start")),
                "current_end": _ts_to_dt(entity.get("current_end")),
                "cancel_at_cycle_end": bool(entity.get("cancel_at_cycle_end")),
                "updated_at": now,
            },
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "created_at": now,
                "amount": (get_plan(plan_id) or {}).get("amount") if plan_id else None,
                "currency": "INR",
            },
        },
        upsert=True,
    )


async def _record_payment_from_entity(
    db,
    payment: Dict[str, Any],
    *,
    subscription_id: Optional[str] = None,
    status: Optional[str] = None,
) -> None:
    payment_id = payment.get("id")
    if not payment_id:
        return
    notes = payment.get("notes") or {}
    uid = notes.get("uid")
    if not uid and subscription_id:
        sub = await db.subscriptions.find_one(
            {"razorpay_subscription_id": subscription_id},
            {"_id": 0, "uid": 1, "plan_id": 1},
        )
        if sub:
            uid = sub.get("uid")
            notes_plan = sub.get("plan_id")
        else:
            notes_plan = None
    else:
        notes_plan = notes.get("plan_id")

    now = _now()
    await db.payments.update_one(
        {"razorpay_payment_id": payment_id},
        {
            "$set": {
                "uid": uid,
                "razorpay_payment_id": payment_id,
                "razorpay_subscription_id": subscription_id or payment.get("subscription_id"),
                "razorpay_order_id": payment.get("order_id"),
                "plan_id": notes_plan,
                "amount": payment.get("amount"),
                "currency": payment.get("currency") or "INR",
                "status": status or payment.get("status") or "unknown",
                "method": payment.get("method"),
                "error_reason": payment.get("error_description") or payment.get("error_reason"),
                "updated_at": now,
            },
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "created_at": now,
            },
        },
        upsert=True,
    )


async def handle_webhook_event(db, event_id: Optional[str], event: Dict[str, Any]) -> Dict[str, Any]:
    """Idempotent webhook handler. Returns quickly after persisting state."""
    event_type = event.get("event") or "unknown"
    if event_id:
        seen = await db.webhook_events.find_one({"event_id": event_id}, {"_id": 1})
        if seen:
            return {"ok": True, "duplicate": True, "event": event_type}

        await db.webhook_events.insert_one(
            {
                "event_id": event_id,
                "event_type": event_type,
                "received_at": _now(),
            }
        )

    payload = event.get("payload") or {}

    if event_type in (
        "subscription.activated",
        "subscription.charged",
        "subscription.pending",
        "subscription.halted",
        "subscription.cancelled",
        "subscription.completed",
        "subscription.authenticated",
        "subscription.paused",
        "subscription.resumed",
    ):
        entity = ((payload.get("subscription") or {}).get("entity")) or {}
        fallback = {
            "subscription.activated": "active",
            "subscription.charged": "active",
            "subscription.authenticated": "authenticated",
            "subscription.pending": "pending",
            "subscription.halted": "halted",
            "subscription.cancelled": "cancelled",
            "subscription.completed": "completed",
            "subscription.paused": "paused",
            "subscription.resumed": "active",
        }.get(event_type, entity.get("status") or "unknown")
        await _upsert_subscription_from_entity(db, entity, fallback)

        payment_entity = ((payload.get("payment") or {}).get("entity")) or {}
        if payment_entity:
            await _record_payment_from_entity(
                db,
                payment_entity,
                subscription_id=entity.get("id"),
                status=payment_entity.get("status"),
            )

    elif event_type in ("payment.captured", "payment.authorized", "payment.failed"):
        payment_entity = ((payload.get("payment") or {}).get("entity")) or {}
        await _record_payment_from_entity(
            db,
            payment_entity,
            subscription_id=payment_entity.get("subscription_id"),
            status=payment_entity.get("status")
            or ("failed" if event_type == "payment.failed" else payment_entity.get("status")),
        )

    else:
        log.info("Ignoring unhandled Razorpay event type=%s", event_type)

    return {"ok": True, "duplicate": False, "event": event_type}


def _is_premium_status(status: Optional[str], current_end: Any) -> bool:
    if status not in ("active", "authenticated"):
        # Allow cancelled-but-still-in-period if cancel_at_cycle_end kept access.
        if status == "cancelled" and current_end:
            end = current_end
            if isinstance(end, str):
                try:
                    end = datetime.fromisoformat(end.replace("Z", "+00:00"))
                except ValueError:
                    return False
            if getattr(end, "tzinfo", None) is None:
                end = end.replace(tzinfo=timezone.utc)
            return end > _now()
        return False
    if current_end:
        end = current_end
        if isinstance(end, str):
            try:
                end = datetime.fromisoformat(end.replace("Z", "+00:00"))
            except ValueError:
                return True
        if getattr(end, "tzinfo", None) is None:
            end = end.replace(tzinfo=timezone.utc)
        return end > _now()
    # Authenticated/active without period end yet (just after Checkout) → treat as premium.
    return status in ("active", "authenticated")


async def get_entitlement(db, uid: str) -> Dict[str, Any]:
    """Return premium entitlement for a user."""
    cursor = (
        db.subscriptions.find({"uid": uid}, {"_id": 0})
        .sort("updated_at", -1)
        .limit(5)
    )
    items = await cursor.to_list(5)
    if not items:
        return {
            "is_premium": False,
            "plan_id": None,
            "status": None,
            "current_period_end": None,
            "subscription_id": None,
            "cancel_at_cycle_end": False,
        }

    # Prefer the most relevant active-ish doc.
    preferred = None
    for doc in items:
        if doc.get("status") in ("active", "authenticated", "pending", "halted"):
            preferred = doc
            break
    if preferred is None:
        preferred = items[0]

    status = preferred.get("status")
    current_end = preferred.get("current_end")
    return {
        "is_premium": _is_premium_status(status, current_end),
        "plan_id": preferred.get("plan_id"),
        "status": status,
        "current_period_end": current_end,
        "current_period_start": preferred.get("current_start"),
        "subscription_id": preferred.get("razorpay_subscription_id"),
        "cancel_at_cycle_end": bool(preferred.get("cancel_at_cycle_end")),
        "amount": preferred.get("amount"),
        "currency": preferred.get("currency") or "INR",
    }


async def cancel_subscription(db, uid: str) -> Dict[str, Any]:
    """Cancel at end of billing cycle (keeps access until current_end)."""
    sub = await db.subscriptions.find_one(
        {
            "uid": uid,
            "status": {"$in": ["active", "authenticated", "pending", "halted"]},
        },
        {"_id": 0},
    )
    if not sub:
        raise PaymentError("No active subscription to cancel", status_code=404)

    sub_id = sub.get("razorpay_subscription_id")
    try:
        remote = get_client().subscription.cancel(sub_id, {"cancel_at_cycle_end": 1})
    except Exception as exc:
        log.warning("subscription.cancel failed %s: %s", sub_id, exc)
        raise PaymentError("Unable to cancel subscription. Please try again.", status_code=502)

    now = _now()
    await db.subscriptions.update_one(
        {"razorpay_subscription_id": sub_id, "uid": uid},
        {
            "$set": {
                "status": remote.get("status") or "cancelled",
                "cancel_at_cycle_end": True,
                "updated_at": now,
                "current_end": _ts_to_dt(remote.get("current_end")) or sub.get("current_end"),
            }
        },
    )
    return await get_entitlement(db, uid)


async def list_payments(db, uid: str, limit: int = 50) -> List[Dict[str, Any]]:
    items = (
        await db.payments.find({"uid": uid}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(limit)
    )
    return items
