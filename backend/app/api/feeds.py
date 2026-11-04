import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import Member, current_member, require_caregiver
from app.db import get_session
from app.models import Feed
from app.services.entries import recent_other, reject_future, user_names

router = APIRouter(prefix="/api")

FeedType = Literal["breast_left", "breast_right", "breast_both", "expressed", "formula"]


class FeedIn(BaseModel):
    id: uuid.UUID
    type: FeedType
    started_at: AwareDatetime
    duration_min: int | None = Field(default=None, ge=0, le=600)
    quantity_ml: int | None = Field(default=None, ge=0, le=2000)
    note: str = ""
    fed_by_user_id: uuid.UUID | None = None


class FeedPatch(BaseModel):
    type: FeedType | None = None
    started_at: AwareDatetime | None = None
    duration_min: int | None = Field(default=None, ge=0, le=600)
    quantity_ml: int | None = Field(default=None, ge=0, le=2000)
    note: str | None = None
    fed_by_user_id: uuid.UUID | None = None


def feed_json(f: Feed, names: dict[uuid.UUID, str]) -> dict:
    return {
        "id": str(f.id),
        "type": f.type,
        "started_at": f.started_at.isoformat(),
        "duration_min": f.duration_min,
        "quantity_ml": f.quantity_ml,
        "note": f.note,
        "fed_by_user_id": str(f.fed_by_user_id),
        "fed_by_name": names.get(f.fed_by_user_id, ""),
        "created_by": str(f.created_by),
    }


def _one(db: Session, member: Member, feed_id: uuid.UUID) -> Feed:
    f = db.get(Feed, feed_id)
    if f is None or f.family_id != member.family_id or f.deleted_at is not None:
        raise HTTPException(404, "feed not found")
    return f


@router.post("/feeds", status_code=201)
def create_feed(
    body: FeedIn, response: Response, member: Member = Depends(require_caregiver), db: Session = Depends(get_session)
) -> dict:
    existing = db.get(Feed, body.id)
    if existing is not None:
        if existing.family_id != member.family_id:
            raise HTTPException(409, "id already used")
        response.status_code = 200
        return {**feed_json(existing, user_names(db, {existing.fed_by_user_id})), "recent_other": None}
    reject_future(body.started_at)
    me = member.user.id
    feed = Feed(
        id=body.id, family_id=member.family_id, kid_id=member.kid_id, type=body.type,
        started_at=body.started_at, duration_min=body.duration_min, quantity_ml=body.quantity_ml,
        note=body.note, fed_by_user_id=body.fed_by_user_id or me, created_by=me, updated_by=me,
    )
    warning = recent_other(db, Feed, member.kid_id, me, body.id)
    db.add(feed)
    db.commit()
    return {**feed_json(feed, user_names(db, {feed.fed_by_user_id})), "recent_other": warning}


@router.get("/feeds")
def list_feeds(
    from_: AwareDatetime | None = Query(default=None, alias="from"),
    to: AwareDatetime | None = None,
    member: Member = Depends(current_member),
    db: Session = Depends(get_session),
) -> list[dict]:
    q = select(Feed).where(Feed.kid_id == member.kid_id, Feed.deleted_at.is_(None))
    if from_:
        q = q.where(Feed.started_at >= from_)
    if to:
        q = q.where(Feed.started_at <= to)
    rows = db.scalars(q.order_by(Feed.started_at.desc())).all()
    names = user_names(db, {r.fed_by_user_id for r in rows})
    return [feed_json(r, names) for r in rows]


@router.patch("/feeds/{feed_id}")
def patch_feed(
    feed_id: uuid.UUID, body: FeedPatch, member: Member = Depends(require_caregiver), db: Session = Depends(get_session)
) -> dict:
    feed = _one(db, member, feed_id)
    data = body.model_dump(exclude_unset=True)
    if "started_at" in data and data["started_at"]:
        reject_future(data["started_at"])
    for k, v in data.items():
        if v is not None or k in ("duration_min", "quantity_ml"):
            setattr(feed, k, v)
    feed.updated_by = member.user.id
    db.commit()
    return feed_json(feed, user_names(db, {feed.fed_by_user_id}))


@router.delete("/feeds/{feed_id}")
def delete_feed(
    feed_id: uuid.UUID, member: Member = Depends(require_caregiver), db: Session = Depends(get_session)
) -> dict[str, bool]:
    feed = _one(db, member, feed_id)
    feed.deleted_at = datetime.now(UTC)
    feed.updated_by = member.user.id
    db.commit()
    return {"ok": True}
