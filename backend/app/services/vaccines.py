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
