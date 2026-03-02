#!/usr/bin/env python3
"""Обновляет data/factories.json из OpenStreetMap Overpass."""

import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

OVERPASS_QUERY = """
[out:json][timeout:120];
area["ISO3166-1"="RU"][admin_level=2]->.ru;
(
  nwr["man_made"="works"](area.ru);
  nwr["industrial"~"factory|manufacture|industrial"](area.ru);
);
out tags center;
""".strip()


def fetch_payload() -> dict:
    req = urllib.request.Request(
        "https://overpass-api.de/api/interpreter",
        data=urllib.parse.urlencode({"data": OVERPASS_QUERY}).encode("utf-8"),
        headers={"User-Agent": "MartaFactoriesMap/1.0 (local update script)"},
    )
    with urllib.request.urlopen(req, timeout=240) as resp:
        return json.load(resp)


def normalize(elements: list[dict]) -> list[dict]:
    records = []
    seen = set()
    for el in elements:
        key = f"{el.get('type')}/{el.get('id')}"
        if key in seen:
            continue

        tags = el.get("tags", {})
        lat = el.get("lat")
        lon = el.get("lon")
        if lat is None or lon is None:
            center = el.get("center", {})
            lat = center.get("lat")
            lon = center.get("lon")
        if lat is None or lon is None:
            continue

        name = tags.get("name") or tags.get("name:ru") or tags.get("official_name") or "Без названия"
        records.append(
            {
                "id": key,
                "name": name,
                "lat": lat,
                "lon": lon,
                "city": tags.get("addr:city") or tags.get("is_in:city") or tags.get("addr:region") or "",
                "industry": tags.get("industrial") or tags.get("man_made") or "",
                "operator": tags.get("operator") or "",
                "product": tags.get("product") or "",
                "start_date": tags.get("start_date") or "",
                "description": tags.get("description") or tags.get("description:ru") or "",
                "website": tags.get("website") or tags.get("contact:website") or "",
                "wikipedia": tags.get("wikipedia") or "",
                "source": "OpenStreetMap",
            }
        )
        seen.add(key)

    records.sort(key=lambda x: (x["name"].lower(), x["city"].lower(), x["id"]))
    return records


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    output_path = (script_dir.parent / "data" / "factories.json").resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    payload = fetch_payload()
    elements = payload.get("elements", [])
    records = normalize(elements)

    output_path.write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8")
    print(f"Готово: {len(records)} записей сохранено в {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
