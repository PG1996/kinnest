"""WHO Child Growth Standards (girls, 0 to 60 months) from the bundled official LMS tables.

Information only, not medical advice. Formulas from the WHO technical report:
value = M * (1 + L*S*z) ** (1/L)  (M * exp(S*z) when L is 0),  z = ((value/M) ** L - 1) / (L*S).
"""

import json
import math
from functools import lru_cache
from pathlib import Path
from statistics import NormalDist

DATA = Path(__file__).resolve().parent.parent / "data" / "who"
KINDS = ("weight", "height", "head")
DAYS_PER_MONTH = 30.4375  # WHO: average month length (365.25 / 12)
MAX_MONTHS = 60
HEIGHT_FROM = 24  # recumbent length below 24 months, standing height from 24
_NORMAL = NormalDist()


@lru_cache
def _doc(kind: str) -> dict:
    if kind not in KINDS:
        raise ValueError(f"unknown growth measurement: {kind}")
    return json.loads((DATA / f"{kind}.json").read_text())


def _table(kind: str, age_months: float) -> dict[int, tuple[float, float, float]]:
    doc = _doc(kind)
    rows = doc["height_rows"] if kind == "height" and age_months >= HEIGHT_FROM else doc["rows"]
    return {int(r[0]): (r[1], r[2], r[3]) for r in rows}


def lms(kind: str, age_months: float) -> tuple[float, float, float]:
    """L, M, S at an age, interpolated linearly between whole months."""
    if not 0 <= age_months <= MAX_MONTHS:
        raise ValueError("age must be 0 to 60 months")
    table = _table(kind, age_months)
    lo = math.floor(age_months)
    frac = age_months - lo
    if frac == 0:
        return table[lo]
    a, b = table[lo], table[lo + 1]
    return tuple(x + (y - x) * frac for x, y in zip(a, b))  # type: ignore[return-value]


def value_at_percentile(kind: str, age_months: float, p: float) -> float:
    L, M, S = lms(kind, age_months)
    z = _NORMAL.inv_cdf(p / 100)
    if L == 0:
        return M * math.exp(S * z)
    return M * (1 + L * S * z) ** (1 / L)


def percentile_of(kind: str, age_months: float, value: float) -> float:
    """Percentile 0 to 100 (one decimal); values far outside the curves come out as 0.0 or 100.0."""
    L, M, S = lms(kind, age_months)
    z = math.log(value / M) / S if L == 0 else ((value / M) ** L - 1) / (L * S)
    return round(_NORMAL.cdf(z) * 100, 1)


def source(kind: str) -> dict:
    doc = _doc(kind)
    return {"name": doc["name"], "url": doc["source_url"], "retrieved_on": doc["retrieved_on"]}
