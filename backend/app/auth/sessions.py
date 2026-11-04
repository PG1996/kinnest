import uuid

from itsdangerous import BadSignature, URLSafeTimedSerializer

from app.config import Settings
from app.models import User

COOKIE_NAME = "kinnest_session"
MAX_AGE = 60 * 60 * 24 * 90


def _serializer(settings: Settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.session_secret, salt="kinnest-session")


def make_session_value(settings: Settings, user: User) -> str:
    return _serializer(settings).dumps({"u": str(user.id), "v": user.session_version})


def read_session_value(settings: Settings, value: str) -> tuple[uuid.UUID, int] | None:
    try:
        data = _serializer(settings).loads(value, max_age=MAX_AGE)
        return uuid.UUID(data["u"]), int(data["v"])
    except (BadSignature, KeyError, ValueError):
        return None
