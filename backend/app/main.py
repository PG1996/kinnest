from fastapi import FastAPI
from starlette.middleware.sessions import SessionMiddleware

from app.api import auth
from app.config import get_settings

app = FastAPI(title="Kinnest")
# Only holds the short-lived Google OAuth state; login itself uses the signed kinnest_session cookie.
app.add_middleware(SessionMiddleware, secret_key=get_settings().session_secret, same_site="lax")
app.include_router(auth.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
