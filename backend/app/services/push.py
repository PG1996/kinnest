import json
import logging
from typing import Literal

from pywebpush import WebPushException, webpush

from app.config import get_settings
from app.i18n import render
from app.models import PushSubscription

log = logging.getLogger(__name__)

Status = Literal["ok", "gone", "error"]


def send(sub: PushSubscription, title_key: str, body_params: dict, urgency: str = "normal", url: str = "/") -> Status:
    """Send one web push. "gone" means the browser dropped the subscription and it should be deleted."""
    settings = get_settings()
    if not settings.vapid_private_key:
        log.error("VAPID keys not configured; cannot send push")
        return "error"
    title, body = render(title_key, body_params)
    try:
        webpush(
            subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
            data=json.dumps({"title": title, "body": body, "url": url, "tag": title_key}),
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},
            headers={"Urgency": urgency},
            ttl=3600,
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
