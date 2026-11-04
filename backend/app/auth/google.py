from authlib.integrations.starlette_client import OAuth
from fastapi import HTTPException, Request

from app.config import Settings


def _client(settings: Settings):
    if not settings.google_client_id:
        raise HTTPException(503, "google sign-in not configured")
    oauth = OAuth()
    oauth.register(
        name="google",
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )
    return oauth.google


def callback_url(settings: Settings) -> str:
    return f"{settings.public_base_url}/api/auth/google/callback"


async def start_google(request: Request, settings: Settings):
    return await _client(settings).authorize_redirect(request, callback_url(settings))


async def fetch_google_identity(request: Request, settings: Settings) -> tuple[str, str]:
    token = await _client(settings).authorize_access_token(request)
    info = token.get("userinfo") or {}
    if not info.get("email") or not info.get("email_verified"):
        raise HTTPException(403, "google email not verified")
    return info["email"], info.get("name", "")
