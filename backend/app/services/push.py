import json
import logging
from typing import Literal

from pywebpush import WebPushException, webpush

from app.config import get_settings
from app.i18n import render
from app.models import PushSubscription

log = logging.getLogger(__name__)

Status = Literal["ok", "gone", "error"]
PUSH_TIMEOUT_SECONDS = 10


def send_payload(sub, payload: dict, urgency: str = "normal") -> Status:
    """Send one web push with a ready-made payload (title, body, url, tag and any notification options).
    "gone" means the browser dropped the subscription and it should be deleted."""
    settings = get_settings()
    if not settings.vapid_private_key:
        log.error("VAPID keys not configured; cannot send push")
        return "error"
    try:
        webpush(
            subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
            data=json.dumps(payload),
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},
            headers={"Urgency": urgency},
            ttl=3600,
            timeout=PUSH_TIMEOUT_SECONDS,  # a stalled push service must not freeze the reminder loop
        )
        return "ok"
    except WebPushException as e:
        status = getattr(e.response, "status_code", None)
        if status in (404, 410):
            return "gone"
        log.warning("push failed (%s): %s", status, e)
        return "error"
    except Exception:
        log.exception("push failed")
        return "error"


def send(sub: PushSubscription, title_key: str, body_params: dict, urgency: str = "normal", url: str = "/") -> Status:
    """Send one reminder: the text comes from the server's message table."""
    title, body = render(title_key, body_params)
    return send_payload(sub, {"title": title, "body": body, "url": url, "tag": title_key}, urgency)
