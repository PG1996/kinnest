from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.diapers import diaper_json
from app.api.feeds import feed_json
from app.api.sleep import sleep_json
from app.auth.deps import Member, current_member
from app.config import Settings, get_settings
from app.db import get_session
from app.models import Kid
from app.services.entries import user_names
from app.services.summary import build_summary

router = APIRouter(prefix="/api")


@router.get("/summary")
def summary(
    member: Member = Depends(current_member),
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    s = build_summary(db, db.get(Kid, member.kid_id), datetime.now(UTC), settings.app_timezone)
    ids = {x.fed_by_user_id for x in [s.last_feed] if x} | {x.changed_by_user_id for x in [s.last_diaper] if x}
    for sl in (s.open_sleep, s.last_sleep):
        if sl:
            ids |= {sl.started_by_user_id, sl.ended_by_user_id} - {None}
    names = user_names(db, ids)
    return {
        "last_feed": feed_json(s.last_feed, names) if s.last_feed else None,
        "next_feed_due_at": s.next_feed_due_at.isoformat() if s.next_feed_due_at else None,
        "last_diaper": diaper_json(s.last_diaper, names) if s.last_diaper else None,
        "feeds_today": s.feeds_today,
        "diapers_today": s.diapers_today,
        "sleep": {
            "open": sleep_json(s.open_sleep, names) if s.open_sleep else None,
            "last": sleep_json(s.last_sleep, names) if s.last_sleep else None,
        },
    }
