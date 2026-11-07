from datetime import UTC, datetime


def get_now() -> datetime:
    """Current time as a FastAPI dependency, so tests can pin it."""
    return datetime.now(UTC)
