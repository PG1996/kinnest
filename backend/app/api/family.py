import uuid
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.deps import Member, current_member, require_admin
from app.config import Settings, get_settings
from app.db import get_session
from app.models import PARENT_RELATIONS, RELATIONS, Invite, Kid, Membership, User
from app.services.email import send_email
from app.services.vaccines import follow_birth_date

router = APIRouter(prefix="/api")

Role = Literal["admin", "caregiver", "viewer"]
Relation = Literal["mom", "dad", "grandparent", "aunt", "relative", "nanny", "other"]


class InviteBody(BaseModel):
    email: EmailStr
    role: Role
    relation: Relation | None = None


class MemberPatch(BaseModel):
    """Change a member's role and/or relation to the baby. A relation of null clears it."""

    role: Role | None = None
    relation: Relation | None = None


def parents(db: Session, family_id: uuid.UUID) -> list[Membership]:
    return list(db.scalars(select(Membership).where(Membership.family_id == family_id, Membership.relation.in_(PARENT_RELATIONS))))


def _check_parent_rules(db: Session, family_id: uuid.UUID, row: Membership | None, new_relation: str | None) -> None:
    """One mom and one dad per family, and the last of them is never cleared, changed or removed."""
    if new_relation in PARENT_RELATIONS:
        taken = db.scalar(
            select(Membership).where(Membership.family_id == family_id, Membership.relation == new_relation, Membership.id != (row.id if row else None))
        )
        if taken is not None:
            raise HTTPException(409, f"the baby already has a {new_relation}")
    if row is not None and row.relation in PARENT_RELATIONS and new_relation != row.relation and len(parents(db, family_id)) <= 1:
        raise HTTPException(409, "the baby needs a mom or a dad")


class KidPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    birth_date: date | None = None
    feed_interval_minutes: int | None = Field(default=None, gt=0, le=24 * 60)
    diaper_alert_minutes: int | None = Field(default=None, gt=0, le=24 * 60)


def _kid_json(kid: Kid) -> dict:
    return {
        "id": str(kid.id),
        "name": kid.name,
        "birth_date": kid.birth_date.isoformat() if kid.birth_date else None,
        "feed_interval_minutes": kid.feed_interval_minutes,
        "diaper_alert_minutes": kid.diaper_alert_minutes,
    }


def _admin_count(db: Session, family_id: uuid.UUID) -> int:
    return db.scalar(
        select(func.count()).select_from(Membership).where(
            Membership.family_id == family_id, Membership.role == "admin"
        )
    )


def _membership(db: Session, member: Member, user_id: uuid.UUID) -> Membership:
    row = db.scalar(
        select(Membership).where(Membership.family_id == member.family_id, Membership.user_id == user_id)
    )
    if row is None:
        raise HTTPException(404, "member not found")
    return row


@router.get("/family/members")
def list_members(member: Member = Depends(current_member), db: Session = Depends(get_session)) -> list[dict]:
    rows = db.execute(
        select(Membership, User).join(User, User.id == Membership.user_id).where(
            Membership.family_id == member.family_id
        )
    ).all()
    out = [
        {"user_id": str(u.id), "email": u.email, "name": u.name, "role": m.role, "relation": m.relation, "pending": False}
        for m, u in rows
    ]
    invites = db.scalars(
        select(Invite).where(Invite.family_id == member.family_id, Invite.accepted_at.is_(None))
    ).all()
    out += [
        {"user_id": None, "email": i.email, "name": "", "role": i.role, "relation": i.relation, "pending": True} for i in invites
    ]
    return out


@router.post("/family/invites")
def invite(
    body: InviteBody,
    member: Member = Depends(require_admin),
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict[str, bool]:
    email = body.email.lower()
    _check_parent_rules(db, member.family_id, None, body.relation)
    existing = db.scalar(select(User).where(User.email == email))
    if existing and db.scalar(
        select(Membership).where(Membership.family_id == member.family_id, Membership.user_id == existing.id)
    ):
        raise HTTPException(409, "already a member")
    row = db.scalar(
        select(Invite).where(
            Invite.family_id == member.family_id, Invite.email == email, Invite.accepted_at.is_(None)
        )
    )
    if row:
        row.role = body.role
        row.relation = body.relation
    else:
        db.add(Invite(family_id=member.family_id, email=email, role=body.role, relation=body.relation))
    db.commit()
    send_email(
        settings,
        email,
        "You're invited to Kinnest",
        f"{member.user.name or member.user.email} invited you to Kinnest as {body.role}.\n"
        f"Open {settings.public_base_url} and sign in with this email address.\n",
    )
    return {"ok": True}


@router.patch("/family/members/{user_id}")
def change_member(
    user_id: uuid.UUID,
    body: MemberPatch,
    member: Member = Depends(require_admin),
    db: Session = Depends(get_session),
) -> dict[str, bool]:
    row = _membership(db, member, user_id)
    sent = body.model_fields_set
    if "role" in sent and body.role is not None:
        if row.role == "admin" and body.role != "admin" and _admin_count(db, member.family_id) <= 1:
            raise HTTPException(409, "cannot demote the last admin")
        row.role = body.role
    if "relation" in sent:
        _check_parent_rules(db, member.family_id, row, body.relation)
        row.relation = body.relation
    db.commit()
    return {"ok": True}


@router.delete("/family/members/{user_id}")
def remove_member(
    user_id: uuid.UUID,
    member: Member = Depends(require_admin),
    db: Session = Depends(get_session),
) -> dict[str, bool]:
    row = _membership(db, member, user_id)
    if row.role == "admin" and _admin_count(db, member.family_id) <= 1:
        raise HTTPException(409, "cannot remove the last admin")
    _check_parent_rules(db, member.family_id, row, None)
    user = db.get(User, user_id)
    db.delete(row)
    user.session_version += 1
    db.commit()
    return {"ok": True}


@router.get("/kid")
def get_kid(member: Member = Depends(current_member), db: Session = Depends(get_session)) -> dict:
    return _kid_json(db.get(Kid, member.kid_id))


@router.patch("/kid")
def patch_kid(
    body: KidPatch, member: Member = Depends(require_admin), db: Session = Depends(get_session)
) -> dict:
    kid = db.get(Kid, member.kid_id)
    old_birth = kid.birth_date
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(kid, field, value)
    if old_birth and kid.birth_date and kid.birth_date != old_birth:
        # a corrected birth date carries the vaccine schedule (and so its reminders) with it
        follow_birth_date(db, kid.id, old_birth, kid.birth_date)
    db.commit()
    return _kid_json(kid)
