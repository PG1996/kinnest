"""Dose units and helpers. The unit list is the single backend source of truth (the frontend has a matching list)."""

import re
from decimal import Decimal, InvalidOperation

DOSE_UNITS: tuple[str, ...] = ("ml", "drops", "mg", "mcg", "g", "IU", "tablet", "puff")
MAX_DOSE = Decimal("10000")

_SYNONYMS = {
    "ml": "ml", "milliliter": "ml", "milliliters": "ml", "millilitre": "ml", "millilitres": "ml",
    "drop": "drops", "drops": "drops", "gtt": "drops",
    "mg": "mg", "mcg": "mcg", "µg": "mcg", "ug": "mcg",
    "g": "g", "gm": "g", "gram": "g", "grams": "g",
    "iu": "IU",
    "tab": "tablet", "tabs": "tablet", "tablet": "tablet", "tablets": "tablet",
    "puff": "puff", "puffs": "puff",
}
_PATTERN = re.compile(r"^\s*(\d+(?:[.,]\d+)?|\d+\s*/\s*\d+)\s*([A-Za-zµ]+)\s*$")


def parse_legacy_dose(text: str) -> tuple[Decimal, str] | None:
    """Best-effort conversion of an old free-text dose ("5 drops", "0,5 ml", "1/2 tablet"). None when unsure."""
    m = _PATTERN.match(text or "")
    if not m:
        return None
    unit = _SYNONYMS.get(m.group(2).lower())
    if unit is None:
        return None
    raw = m.group(1).replace(" ", "")
    try:
        if "/" in raw:
            top, bottom = raw.split("/")
            amount = Decimal(top) / Decimal(bottom)
        else:
            amount = Decimal(raw.replace(",", "."))
    except (InvalidOperation, ZeroDivisionError):
        return None
    if amount != amount.quantize(Decimal("0.01")) or not 0 < amount <= MAX_DOSE:
        return None
    return amount.quantize(Decimal("0.01")).normalize(), unit


def format_dose(amount: Decimal, unit: str) -> str:
    """"0.25 ml", "5 drops": trailing zeros stripped."""
    return f"{format(Decimal(amount).normalize(), 'f')} {unit}"
