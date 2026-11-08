from fastapi import FastAPI
from starlette.middleware.sessions import SessionMiddleware

from app.api import auth, diapers, family, feeds, medicines, push, sleep, summary, vaccines, visits, vitals
from app.config import get_settings

app = FastAPI(title="Kinnest")
# Only holds the short-lived Google OAuth state; login itself uses the signed kinnest_session cookie.
app.add_middleware(SessionMiddleware, secret_key=get_settings().session_secret, same_site="lax")
app.include_router(auth.router)
app.include_router(family.router)
app.include_router(feeds.router)
app.include_router(diapers.router)
app.include_router(summary.router)
app.include_router(push.router)
app.include_router(medicines.router)
app.include_router(sleep.router)
app.include_router(vitals.router)
app.include_router(vaccines.router)
app.include_router(visits.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
