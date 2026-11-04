import logging
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from urllib.parse import unquote, urlparse

from app.config import Settings

log = logging.getLogger(__name__)


@dataclass
class Mail:
    to: str
    subject: str
    body: str


# Dev mode (no SMTP_URL): mails are logged and kept here so tests and the dev owner can read them.
OUTBOX: list[Mail] = []


def send_email(settings: Settings, to: str, subject: str, body: str) -> None:
    if not settings.smtp_url:
        OUTBOX.append(Mail(to, subject, body))
        log.warning("DEV EMAIL to=%s subject=%s\n%s", to, subject, body)
        return
    u = urlparse(settings.smtp_url)  # smtp://user:pass@host:587 or smtps://...:465
    msg = EmailMessage()
    user, password = unquote(u.username or ""), unquote(u.password or "")  # "@" in a Gmail address arrives as %40
    msg["From"] = user or "kinnest@localhost"
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    cls = smtplib.SMTP_SSL if u.scheme == "smtps" else smtplib.SMTP
    with cls(u.hostname, u.port or (465 if u.scheme == "smtps" else 587), timeout=20) as s:
        if u.scheme == "smtp":
            s.starttls()
        if user:
            s.login(user, password)
        s.send_message(msg)
