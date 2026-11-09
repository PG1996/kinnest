from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.family import parents
from app.auth import google
from app.auth.deps import Member, current_member
from app.auth.google import fetch_google_identity
from app.auth.magic_link import consume_magic_token, send_magic_link
from app.auth.service import complete_login, login_allowed
from app.auth.sessions import COOKIE_NAME, MAX_AGE, make_session_value
from app.config import Settings, get_settings
from app.models import Membership
from app.db import get_session

router = APIRouter(prefix="/api")


class MagicRequest(BaseModel):
    email: EmailStr


def _signed_in_redirect(settings: Settings, user) -> RedirectResponse:
    resp = RedirectResponse("/", status_code=303)
    resp.set_cookie(
        COOKIE_NAME,
        make_session_value(settings, user),
        max_age=MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=settings.public_base_url.startswith("https://"),
    )
    return resp


@router.post("/auth/magic/request")
def magic_request(
    body: MagicRequest, db: Session = Depends(get_session), settings: Settings = Depends(get_settings)
) -> dict[str, bool]:
    # Always 200 so the endpoint can't be used to probe who is invited; only invited emails get mail.
    if login_allowed(db, settings, body.email):
        send_magic_link(db, settings, body.email)
        db.commit()
    return {"ok": True}


@router.get("/auth/magic/verify")
def magic_verify(token: str, db: Session = Depends(get_session), settings: Settings = Depends(get_settings)):
    email = consume_magic_token(db, token)
    if email is None:
        raise HTTPException(400, "invalid or expired link")
    user = complete_login(db, settings, email)
    db.commit()
    return _signed_in_redirect(settings, user)


@router.get("/auth/google/start")
async def google_start(request: Request, settings: Settings = Depends(get_settings)):
    return await google.start_google(request, settings)


@router.get("/auth/google/callback")
async def google_callback(
    request: Request, db: Session = Depends(get_session), settings: Settings = Depends(get_settings)
):
    email, name = await fetch_google_identity(request, settings)
    user = complete_login(db, settings, email, name)
    db.commit()
    return _signed_in_redirect(settings, user)


@router.post("/auth/logout")
def logout(response: Response) -> dict[str, bool]:
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}


@router.get("/me")
def me(member: Member = Depends(current_member), db: Session = Depends(get_session)) -> dict:
    mine = db.scalar(select(Membership).where(Membership.user_id == member.user.id))
    return {
        "relation": mine.relation if mine else None,
        # a family needs a mom or a dad before it is set up; the app asks the admin for it
        "needs_parent": not parents(db, member.family_id),
        "user": {"id": str(member.user.id), "email": member.user.email, "name": member.user.name},
        "family_id": str(member.family_id),
        "kid_id": str(member.kid_id),
        "role": member.role,
    }
