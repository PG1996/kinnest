"""Vaccination schedule templates (bundled official schedules) and due-date arithmetic."""

import calendar
import json
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data" / "vaccines"


def add_months(d: date, n: int) -> date:
    """The same day n months later; a day the target month lacks becomes its last day (Jan 31 + 1 = Feb 28/29)."""
    month0 = d.month - 1 + n
    year, month = d.year + month0 // 12, month0 % 12 + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def due_date_for(birth: date, due_after: dict) -> date:
    (unit, n), = due_after.items()
    if unit == "days":
        return birth + timedelta(days=n)
    if unit == "weeks":
        return birth + timedelta(weeks=n)
    if unit == "months":
        return add_months(birth, n)
    raise ValueError(f"unknown due_after unit: {unit}")


@lru_cache
def load_templates() -> dict[str, dict]:
    out = {}
    for path in sorted(DATA.glob("*.json")):
        t = json.loads(path.read_text())
        out[t["id"]] = t
    return out


def entry_key(name: str, dose_label: str) -> tuple[str, str]:
    return (" ".join(name.lower().split()), " ".join(dose_label.lower().split()))


def follow_birth_date(db, kid_id, old: date, new: date) -> int:
    """After the birth date changes, move pending template entries whose due date nobody edited (it still equals the
    date computed from the old birth date). Given, skipped, manual and hand-moved entries keep their dates."""
    from sqlalchemy import select

    from app.models import Vaccination

    templates = load_templates()
    moved = 0
    rows = db.scalars(
        select(Vaccination).where(
            Vaccination.kid_id == kid_id, Vaccination.deleted_at.is_(None), Vaccination.status == "pending"
        )
    )
    for v in rows:
        template = templates.get(v.source)
        if template is None:
            continue
        entry = next(
            (e for e in template["entries"] if entry_key(e["name"], e["dose_label"]) == entry_key(v.name, v.dose_label)),
            None,
        )
        if entry is None or v.due_date != due_date_for(old, entry["due_after"]):
            continue
        v.due_date = due_date_for(new, entry["due_after"])
        moved += 1
    return moved
