"""Convert the official WHO Child Growth Standards girls tables (xlsx) into the JSON bundled in app/data/who/.

Download the monthly percentile tables from https://www.who.int/tools/child-growth-standards/standards
(weight-for-age, length/height-for-age, head-circumference-for-age; "Girls, percentiles, 0 to 5 years" and, for
length/height, "0 to 2 years" and "2 to 5 years"), then run:

    python scripts/load_who.py DOWNLOAD_DIR app/data/who YYYY-MM-DD

Only the Month, L, M and S columns are kept; percentile curves are computed from them. Standard library only.
"""

import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
CDN = "https://cdn.who.int/media/docs/default-source/child-growth/child-growth-standards/indicators"

TABLES = {
    "weight": {
        "files": ["tab_wfa_girls_p_0_5.xlsx"],
        "name": "WHO Child Growth Standards: weight-for-age, girls, 0 to 5 years",
        "page": "https://www.who.int/tools/child-growth-standards/standards/weight-for-age",
        "unit": "kg",
        "folder": "weight-for-age",
    },
    "height": {
        "files": ["tab_lhfa_girls_p_0_2.xlsx", "tab_lhfa_girls_p_2_5.xlsx"],
        "name": "WHO Child Growth Standards: length/height-for-age, girls, 0 to 5 years",
        "page": "https://www.who.int/tools/child-growth-standards/standards/length-height-for-age",
        "unit": "cm",
        "folder": "length-height-for-age",
        "note": (
            "Months 0 to 23 are recumbent length (tab_lhfa_girls_p_0_2), months 24 to 60 standing height "
            "(tab_lhfa_girls_p_2_5). WHO convention: standing height is on average 0.7 cm less than recumbent "
            "length, which is why the two tables both have month 24 and differ there. 'rows' is the length table "
            "(months 0 to 24, used below 24 months) and 'height_rows' the height table (months 24 to 60)."
        ),
    },
    "head": {
        "files": ["tab_hcfa_girls_p_0_5.xlsx"],
        "name": "WHO Child Growth Standards: head circumference-for-age, girls, 0 to 5 years",
        "page": "https://www.who.int/tools/child-growth-standards/standards/head-circumference-for-age",
        "unit": "cm",
        "folder": "head-circumference-for-age",
    },
}


def read_rows(path: Path) -> list[list[str]]:
    with zipfile.ZipFile(path) as z:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            shared = ["".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")) for si in root.findall("m:si", NS)]
        sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows = []
    for row in sheet.iter(f"{{{NS['m']}}}row"):
        cells: dict[int, str] = {}
        for c in row.findall("m:c", NS):
            col = re.match(r"[A-Z]+", c.get("r")).group(0)
            idx = 0
            for ch in col:
                idx = idx * 26 + ord(ch) - 64
            v = c.find("m:v", NS)
            if v is None:
                continue
            cells[idx - 1] = shared[int(v.text)] if c.get("t") == "s" else v.text
        if cells:
            rows.append([cells.get(i, "") for i in range(max(cells) + 1)])
    return rows


def lms_rows(path: Path) -> dict[int, list[float]]:
    rows = read_rows(path)
    header = [h.strip() for h in rows[0]]
    mi, li, mm, si = (header.index(k) for k in ("Month", "L", "M", "S"))
    return {int(float(r[mi])): [float(r[li]), float(r[mm]), float(r[si])] for r in rows[1:] if r[mi] != ""}


def main(src: str, out: str, retrieved_on: str) -> None:
    for kind, t in TABLES.items():
        tables = [lms_rows(Path(src) / f) for f in t["files"]]
        doc = {
            "kind": kind,
            "name": t["name"],
            "source_url": t["page"],
            "files": [f"{CDN}/{t['folder']}/{f}" for f in t["files"]],
            "retrieved_on": retrieved_on,
            "unit": t["unit"],
            "note": t.get("note", ""),
            "columns": ["month", "L", "M", "S"],
        }
        if kind == "height":
            # length table up to and including its own month 24 (so 23.5 months interpolates within length),
            # height table from month 24
            length, height = tables
            assert sorted(length) == list(range(25)) and sorted(height) == list(range(24, 61)), kind
            doc["rows"] = [[m, *length[m]] for m in range(25)]
            doc["height_rows"] = [[m, *height[m]] for m in range(24, 61)]
        else:
            (only,) = tables
            assert sorted(only) == list(range(61)), kind
            doc["rows"] = [[m, *only[m]] for m in range(61)]
        Path(out, f"{kind}.json").write_text(json.dumps(doc, indent=1) + "\n")
        print(kind, "rows", len(doc["rows"]) + len(doc.get("height_rows", [])))


if __name__ == "__main__":
    main(*sys.argv[1:4])
