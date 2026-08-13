"""
check_specific_place.py — Look up a specific place name across all
variants in the gazetteer, to check if it exists and whether it's
duplicated/ambiguous.

Usage:
    python check_specific_place.py --name Hammara
"""
import argparse
import pandas as pd

parser = argparse.ArgumentParser()
parser.add_argument("--name", required=True)
parser.add_argument("--gazetteer", default="gazetteer.csv")
args = parser.parse_args()

df = pd.read_csv(args.gazetteer)
mask = (
    df["name_default"].str.contains(args.name, case=False, na=False)
    | df["name_ar"].str.contains(args.name, case=False, na=False)
    | df["name_en"].str.contains(args.name, case=False, na=False)
    | df["name_fr"].str.contains(args.name, case=False, na=False)
)
matches = df[mask]

print(f"Found {len(matches)} rows matching '{args.name}':")
print(matches[["name_default", "name_ar", "name_en", "name_fr", "place_type", "lat", "lon"]].to_string())
