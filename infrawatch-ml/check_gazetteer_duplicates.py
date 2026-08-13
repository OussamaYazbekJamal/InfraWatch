"""
check_gazetteer_duplicates.py — Measure how many place names in the
gazetteer are ambiguous (same or near-identical name appearing at
multiple, genuinely distinct locations).

Usage:
    python check_gazetteer_duplicates.py --input gazetteer.csv
"""

import argparse

import pandas as pd


def haversine_km(lat1, lon1, lat2, lon2):
    from math import radians, sin, cos, sqrt, atan2
    R = 6371
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="gazetteer.csv")
    parser.add_argument("--distance-threshold-km", type=float, default=5.0,
                         help="Two same-named places farther apart than this are 'genuinely distinct'")
    args = parser.parse_args()

    df = pd.read_csv(args.input)
    df = df.dropna(subset=["lat", "lon"])

    grouped = df.groupby("name_default")
    ambiguous_groups = []

    for name, group in grouped:
        if len(group) < 2:
            continue
        rows = group.to_dict("records")
        # Check if any pair in this group is genuinely far apart (not just
        # the same place duplicated in OSM with slightly different coords)
        max_distance = 0
        for i in range(len(rows)):
            for j in range(i + 1, len(rows)):
                d = haversine_km(rows[i]["lat"], rows[i]["lon"], rows[j]["lat"], rows[j]["lon"])
                max_distance = max(max_distance, d)
        if max_distance > args.distance_threshold_km:
            ambiguous_groups.append((name, len(rows), round(max_distance, 1)))

    print(f"Total gazetteer entries: {len(df)}")
    print(f"Distinct names with 2+ entries: {(grouped.size() >= 2).sum()}")
    print(f"Names that are GENUINELY ambiguous (entries >{args.distance_threshold_km}km apart): {len(ambiguous_groups)}")
    print()
    if ambiguous_groups:
        print("Examples (name, count, max distance apart in km):")
        for name, count, dist in sorted(ambiguous_groups, key=lambda x: -x[2])[:20]:
            print(f"  {name}: {count} entries, up to {dist}km apart")


if __name__ == "__main__":
    main()
