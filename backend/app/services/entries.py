import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User

MAX_FUTURE = timedelta(minutes=5)
RECENT_OTHER_WINDOW = timedelta(minutes=2)


def reject_future(ts: datetime) -> None:
    if ts > datetime.now(UTC) + MAX_FUTURE:
        raise HTTPException(422, "timestamp is in the future")


def recent_other(db: Session, model, kid_id: uuid.UUID, me: uuid.UUID, exclude_id: uuid.UUID) -> dict | None:
    """Entry of the same kind that someone else logged in the last 2 minutes (double-logging warning)."""
    row = db.execute(
        select(model, User.name)
        .join(User, User.id == model.created_by)
        .where(
            model.kid_id == kid_id,
            model.deleted_at.is_(None),
            model.created_by != me,
            model.id != exclude_id,
            model.created_at >= datetime.now(UTC) - RECENT_OTHER_WINDOW,
        )
        .order_by(model.created_at.desc())
        .limit(1)
    ).first()
    return {"user_name": row[1], "at": row[0].created_at.isoformat()} if row else None


def user_names(db: Session, ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not ids:
        return {}
    return {u.id: u.name for u in db.scalars(select(User).where(User.id.in_(ids)))}
