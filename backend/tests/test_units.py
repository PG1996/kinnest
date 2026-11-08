from decimal import Decimal

import pytest

from app.units import DOSE_UNITS, format_dose, parse_legacy_dose


def test_the_unit_list_is_exactly_the_spec_list():
    assert DOSE_UNITS == ("ml", "drops", "mg", "mcg", "g", "IU", "tablet", "puff")


@pytest.mark.parametrize(
    "text, expected",
    [
        ("5 drops", (Decimal("5"), "drops")),
        ("1 drop", (Decimal("1"), "drops")),
        ("2.5ml", (Decimal("2.5"), "ml")),
        ("2.5 mL", (Decimal("2.5"), "ml")),
        ("0,5 ml", (Decimal("0.5"), "ml")),
        ("1/2 tablet", (Decimal("0.5"), "tablet")),
        ("1 tab", (Decimal("1"), "tablet")),
        ("2 tablets", (Decimal("2"), "tablet")),
        ("10 mcg", (Decimal("10"), "mcg")),
        ("10 µg", (Decimal("10"), "mcg")),
        ("10 ug", (Decimal("10"), "mcg")),
        ("250mg", (Decimal("250"), "mg")),
        ("1000 iu", (Decimal("1000"), "IU")),
        ("1000 IU", (Decimal("1000"), "IU")),
        ("2 puffs", (Decimal("2"), "puff")),
        ("1.5 gm", (Decimal("1.5"), "g")),
        ("  3 g ", (Decimal("3"), "g")),
    ],
)
def test_parse_legacy_dose(text, expected):
    assert parse_legacy_dose(text) == expected


@pytest.mark.parametrize("text", ["", "a little", "5", "two drops", "0 ml", "0.125 ml", "20000 mg", "1/0 tablet", "5 spoons"])
def test_unparseable_legacy_dose_is_none(text):
    assert parse_legacy_dose(text) is None


def test_format_dose_strips_zeros():
    assert format_dose(Decimal("0.25"), "ml") == "0.25 ml"
    assert format_dose(Decimal("5.00"), "drops") == "5 drops"
    assert format_dose(Decimal("1.50"), "ml") == "1.5 ml"
    assert format_dose(Decimal("100"), "mg") == "100 mg"
