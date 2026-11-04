import logging
import time
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_engine
from app.services.push import send
from app.worker.reminders import tick

log = logging.getLogger("kinnest.worker")


def run_once() -> int:
    with Session(get_engine(), expire_on_commit=False) as db:
        sent = tick(db, datetime.now(UTC), send, get_settings().app_timezone)
    return len(sent)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    log.info("worker started")
    while True:
        try:
            n = run_once()
            if n:
                log.info("sent %d notifications", n)
        except Exception:
            log.exception("tick failed")  # never die: the next minute tries again
        time.sleep(60 - time.time() % 60)


if __name__ == "__main__":
    main()
