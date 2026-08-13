"""
build_gazetteer.py — Build a Lebanese place-name gazetteer from OpenStreetMap
via the Overpass API (the same data source your Leaflet health-facility
finder already uses).

Covers ALL of Lebanon, not just major cities:
  - Settlements: city, town, village, suburb, neighbourhood, hamlet,
    locality, isolated_dwelling (this last group matters a lot for rural
    areas - many small mountain villages in Akkar, Baalbek-Hermel, the
    Bekaa, and South Lebanon are only tagged as hamlet/locality in OSM,
    not village)
  - Administrative hierarchy: governorates (mohafazat, admin_level=4)
    and districts (aqdya, admin_level=6), so every settlement can be
    tied to its governorate/district - useful both for extraction and
    for cross-checking against your report categories

Usage:
    python build_gazetteer.py --output gazetteer.csv

Requires:
    pip install requests pandas
"""

import argparse
import time

import pandas as pd
import requests

# Overpass's public instances reject requests without an identifiable
# User-Agent (fair-use policy) - the default requests library User-Agent
# gets a 406 Not Acceptable. If the primary instance is down/overloaded,
# fall back to a mirror.
OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
]
HEADERS = {
    "User-Agent": "InfraWatch-Gazetteer/1.0 (Lebanon civic infrastructure senior project)"
}

# Broadened place types: includes rural/small-settlement tags
# (hamlet, locality, isolated_dwelling) alongside city/town/village/
# suburb/neighbourhood, so mountain and rural areas aren't undercounted
# relative to Beirut/major cities.
SETTLEMENTS_QUERY = """
[out:json][timeout:120];
area["ISO3166-1"="LB"][admin_level=2]->.lebanon;
(
  node["place"~"^(city|town|village|suburb|neighbourhood|hamlet|locality|isolated_dwelling)$"](area.lebanon);
  way["place"~"^(city|town|village|suburb|neighbourhood|hamlet|locality|isolated_dwelling)$"](area.lebanon);
);
out center tags;
"""

# Governorates (mohafazat) and districts (aqdya) - gives every settlement
# a place in Lebanon's administrative hierarchy.
ADMIN_QUERY = """
[out:json][timeout:120];
area["ISO3166-1"="LB"][admin_level=2]->.lebanon;
(
  relation["admin_level"~"^(4|6)$"](area.lebanon);
);
out center tags;
"""


def fetch_overpass(query: str, label: str) -> list[dict]:
    print(f"Querying Overpass API for {label} (this can take 30-120s)...")
    last_error = None
    for mirror in OVERPASS_MIRRORS:
        try:
            response = requests.post(mirror, data={"data": query}, headers=HEADERS, timeout=150)
            response.raise_for_status()
            data = response.json()
            print(f"Received {len(data.get('elements', []))} {label} elements from Overpass ({mirror})")
            return data.get("elements", [])
        except requests.exceptions.RequestException as e:
            print(f"  Mirror {mirror} failed ({e}); trying next mirror...")
            last_error = e
            time.sleep(2)
    raise RuntimeError(f"All Overpass mirrors failed for {label} query. Last error: {last_error}")


def elements_to_gazetteer(elements: list[dict], place_type_override: str = None) -> pd.DataFrame:
    rows = []
    for el in elements:
        tags = el.get("tags", {})
        name_default = tags.get("name")
        if not name_default:
            continue  # skip unnamed features - not useful for text matching

        center = el.get("center", {})
        lat = el.get("lat", center.get("lat"))
        lon = el.get("lon", center.get("lon"))

        place_type = place_type_override or tags.get("place")
        if place_type is None and tags.get("admin_level") == "4":
            place_type = "governorate"
        elif place_type is None and tags.get("admin_level") == "6":
            place_type = "district"

        rows.append({
            "osm_id": el.get("id"),
            "place_type": place_type,
            "name_default": name_default,
            "name_ar": tags.get("name:ar", ""),
            "name_en": tags.get("name:en", ""),
            "name_fr": tags.get("name:fr", ""),
            "lat": lat,
            "lon": lon,
        })

    df = pd.DataFrame(rows)
    if len(df) > 0:
        df = df.drop_duplicates(subset=["name_default", "lat", "lon"]).reset_index(drop=True)
    return df


def main():
    parser = argparse.ArgumentParser(description="Build a Lebanese place-name gazetteer from OpenStreetMap.")
    parser.add_argument("--output", default="gazetteer.csv", help="Path to write the gazetteer CSV")
    args = parser.parse_args()

    settlement_elements = fetch_overpass(SETTLEMENTS_QUERY, "settlement")
    settlements_df = elements_to_gazetteer(settlement_elements)

    time.sleep(2)  # be polite to the free Overpass instance between queries

    admin_elements = fetch_overpass(ADMIN_QUERY, "administrative boundary")
    admin_df = elements_to_gazetteer(admin_elements)

    combined = pd.concat([settlements_df, admin_df], ignore_index=True)
    combined = combined.drop_duplicates(subset=["name_default", "place_type"]).reset_index(drop=True)

    print(f"\nTotal gazetteer size: {len(combined)} named places")
    print("By place type:")
    print(combined["place_type"].value_counts())
    print(f"\nWith Arabic name tag: {(combined['name_ar'] != '').sum()}")
    print(f"With French name tag: {(combined['name_fr'] != '').sum()}")
    print(f"With English name tag: {(combined['name_en'] != '').sum()}")

    combined.to_csv(args.output, index=False)
    print(f"\nSaved to {args.output}")


if __name__ == "__main__":
    main()
