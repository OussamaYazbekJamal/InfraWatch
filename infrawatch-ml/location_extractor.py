"""
location_extractor.py — Hybrid location extraction for InfraWatch reports.

Two-stage approach:
  1. Gazetteer matching: fuzzy string matching against known Lebanese
     place names (built by build_gazetteer.py from OpenStreetMap, or the
     bundled gazetteer_starter.csv as a smaller fallback for quick testing).
     This is fast, needs no model, and directly gives you coordinates for
     a matched place.
  2. NER fallback: for place-like words the gazetteer doesn't recognize
     (typos, informal names, streets not in OSM), a pretrained
     multilingual NER model (Davlan/bert-base-multilingual-cased-ner-hrl,
     covering Arabic/English/French LOC entities) flags candidate
     location mentions so they aren't silently dropped - these can be
     surfaced to an admin for manual confirmation rather than
     auto-matched to coordinates.

This design deliberately does NOT fine-tune a custom NER model: with a
small dataset, fine-tuning NER (a harder task than text classification)
would need far more labeled data than is available. Combining a
gazetteer (that grows for free as your Overpass/OSM coverage improves)
with an off-the-shelf pretrained NER model is the appropriate low-data
approach here, and is worth describing as such in your methodology.

Usage as a module:
    from location_extractor import LocationExtractor
    extractor = LocationExtractor(gazetteer_path="gazetteer.csv")
    result = extractor.extract("fi selek kahraba wa2e3 bel Hamra")

Requires:
    pip install rapidfuzz pandas transformers torch
"""

from dataclasses import dataclass, field

import pandas as pd
from rapidfuzz import fuzz, process

GAZETTEER_MATCH_THRESHOLD = 80  # rapidfuzz score (0-100); below this, not considered a match
NER_MODEL_NAME = "Davlan/bert-base-multilingual-cased-ner-hrl"
AMBIGUITY_DISTANCE_KM = 5.0  # same name appearing this far apart = genuinely distinct places


def _haversine_km(lat1, lon1, lat2, lon2):
    from math import radians, sin, cos, sqrt, atan2
    R = 6371
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))

# Common short function words (prepositions, articles, connectors) across
# the four registers this project handles. These get filtered out of
# gazetteer candidate windows entirely, since short words like Arabic "في"
# (in) or "ف" otherwise fuzzy-match false-positive against short place
# names purely by coincidence of character overlap.
STOPWORDS = {
    # Arabic (MSA + common dialect connectors)
    "في", "من", "الى", "إلى", "على", "عن", "مع", "ف", "و", "ب", "ل", "ال",
    "هذا", "هذه", "ذلك", "التي", "الذي",
    # Arabic contracted preposition+article combos (bi+al, ka+al, li+al, etc.)
    # - same false-positive risk as في, since these are extremely common
    # short function words that can coincidentally fuzzy-match short place names
    "بال", "كال", "لل", "وال", "فال", "بالقرب", "بالكامل",
    # Generic landmark/POI nouns - these describe a TYPE of place (mosque,
    # school, hospital...), not a specific place name, but often
    # coincidentally fuzzy-match an unrelated village/neighbourhood name
    # in the gazetteer. Excluded so "3end el jame3" (near the mosque)
    # doesn't get matched to some unrelated place just because "jame3"
    # happens to resemble part of its name.
    "الجامع", "جامع", "مسجد", "كنيسة", "مدرسة", "مستشفى", "سوق", "جسر",
    "jame3", "jem3a", "kanise", "madrase", "mustashfa", "souk", "jiser",
    "mosque", "church", "school", "hospital", "market", "bridge",
    "mosquée", "église", "école", "hôpital", "marché", "pont",
    # Arabizi
    "fi", "bel", "bl", "3ala", "3al", "men", "min", "3an", "w", "el", "l",
    "mesh", "bas", "sar", "kell", "kellon",
    # English
    "a", "an", "the", "in", "at", "on", "of", "to", "is", "there", "near",
    # French
    "le", "la", "les", "de", "du", "des", "à", "en", "un", "une", "il", "y", "a",
}


@dataclass
class LocationMatch:
    text_span: str            # the substring/entity as found in the input text
    matched_name: str         # canonical gazetteer name, or the raw NER entity if unmatched
    source: str                # "gazetteer" or "ner"
    confidence: float          # rapidfuzz score (0-100) or NER model confidence (0-1) depending on source
    lat: float = None
    lon: float = None
    place_type: str = None
    ambiguous: bool = False    # True if this name maps to multiple, genuinely distinct places
    alternative_candidates: list = field(default_factory=list)  # other (lat, lon, place_type) options if ambiguous


@dataclass
class LocationExtractionResult:
    matches: list = field(default_factory=list)
    gazetteer_matches: int = 0
    ner_only_matches: int = 0


class LocationExtractor:
    def __init__(self, gazetteer_path: str = "gazetteer.csv", use_ner_fallback: bool = True,
                 manual_additions_path: str = "gazetteer_manual_additions.csv"):
        self.gazetteer = pd.read_csv(gazetteer_path)

        try:
            manual_df = pd.read_csv(manual_additions_path)
            self.gazetteer = pd.concat([self.gazetteer, manual_df], ignore_index=True)
            print(f"Merged {len(manual_df)} manually-added gazetteer entries from {manual_additions_path}")
        except FileNotFoundError:
            pass

        self.gazetteer = self.gazetteer.reset_index(drop=True)  # clean integer index for union-find
        self._build_lookup()

        self.ner_pipeline = None
        if use_ner_fallback:
            self._load_ner_pipeline()

    def _build_lookup(self):
        """
        Flatten every name variant (default/ar/en/fr) into one lookup list
        of (variant_name, canonical_row) pairs, so fuzzy matching can hit
        any language variant and still resolve back to the canonical entry.

        Keeps ALL rows per variant name (not just the last one seen) - two
        different places can share the exact same name (e.g. multiple
        villages named "Hamra" in different governorates), and silently
        keeping only one would hide the ambiguity rather than surface it.
        """
        self._name_to_rows = {}  # variant_name_lower -> list of rows
        variants = []
        for _, row in self.gazetteer.iterrows():
            for col in ["name_default", "name_ar", "name_en", "name_fr"]:
                name = row.get(col)
                if isinstance(name, str) and name.strip():
                    variants.append(name.strip())
                    key = name.strip().lower()
                    self._name_to_rows.setdefault(key, []).append(row)
        self._all_variant_names = variants

        self._build_ambiguity_groups()

    def _build_ambiguity_groups(self):
        """
        Groups rows that refer to "the same searched-for name" even if
        their OFFICIAL names differ across languages - e.g. two real
        villages both commonly called "Mhaydse" in Arabizi, but with
        genuinely different official Arabic spellings (المحيدثة vs محيدسة).
        Grouping only by exact name_default match would miss this: the two
        rows would never be linked, and one would silently "win" a fuzzy
        match without the other ever being considered.

        Uses union-find: two rows are linked if they share ANY exact name
        variant (in any of the 4 language columns). A row's ambiguity
        group is then checked for genuinely distinct locations (>5km apart).
        """
        n = len(self.gazetteer)
        parent = list(range(n))

        def find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        def union(i, j):
            ri, rj = find(i), find(j)
            if ri != rj:
                parent[ri] = rj

        # Link rows sharing any exact variant string
        variant_to_indices = {}
        for idx, row in self.gazetteer.iterrows():
            for col in ["name_default", "name_ar", "name_en", "name_fr"]:
                name = row.get(col)
                if isinstance(name, str) and name.strip():
                    key = name.strip().lower()
                    variant_to_indices.setdefault(key, []).append(idx)

        for indices in variant_to_indices.values():
            for i in range(1, len(indices)):
                union(indices[0], indices[i])

        # Group row indices by their union-find root
        groups = {}
        for idx in range(n):
            root = find(idx)
            groups.setdefault(root, []).append(idx)

        # A row is ambiguous if ANY two rows in its group are genuinely
        # far apart (real distinct places), not just OSM duplicate tagging
        # of the same spot.
        self._row_ambiguous = [False] * n
        self._row_group = [None] * n
        for root, indices in groups.items():
            valid_indices = [i for i in indices
                              if pd.notna(self.gazetteer.loc[i, "lat"]) and pd.notna(self.gazetteer.loc[i, "lon"])]
            is_ambiguous_group = False
            for a in range(len(valid_indices)):
                for b in range(a + 1, len(valid_indices)):
                    row_a, row_b = self.gazetteer.loc[valid_indices[a]], self.gazetteer.loc[valid_indices[b]]
                    d = _haversine_km(row_a["lat"], row_a["lon"], row_b["lat"], row_b["lon"])
                    if d > AMBIGUITY_DISTANCE_KM:
                        is_ambiguous_group = True
                        break
                if is_ambiguous_group:
                    break
            for idx in indices:
                self._row_ambiguous[idx] = is_ambiguous_group
                self._row_group[idx] = indices

    def _resolve_row(self, variant_name_lower: str) -> dict:
        """Pick one representative row for a variant name (used for
        confidence/place_type display) - ambiguity is handled separately
        via _row_ambiguous / _row_group and alternative candidate lookup."""
        return self._name_to_rows[variant_name_lower][0]

    def _get_alternative_candidates(self, row_index: int) -> list:
        """All OTHER distinct (lat, lon, place_type) locations in this
        row's ambiguity group, for surfacing when a match is ambiguous.
        Uses the union-find group (linked by ANY shared name variant),
        not just an exact name_default match - this is what correctly
        catches cases like two villages both called "Mhaydse" in Arabizi
        but with different official Arabic spellings."""
        group_indices = self._row_group[row_index]
        if not group_indices:
            return []

        exclude_row = self.gazetteer.loc[row_index]
        alternatives = []
        seen_coords = {(exclude_row.get("lat"), exclude_row.get("lon"))}
        for idx in group_indices:
            row = self.gazetteer.loc[idx]
            coord = (row.get("lat"), row.get("lon"))
            if coord in seen_coords or pd.isna(row.get("lat")) or pd.isna(row.get("lon")):
                continue
            seen_coords.add(coord)
            alternatives.append({
                "lat": row.get("lat"),
                "lon": row.get("lon"),
                "place_type": row.get("place_type"),
            })
        return alternatives

    def _load_ner_pipeline(self):
        # Imported lazily so this module can be used for gazetteer-only
        # matching without requiring torch/transformers to be installed.
        from transformers import pipeline
        print(f"Loading NER fallback model ({NER_MODEL_NAME})...")
        self.ner_pipeline = pipeline("ner", model=NER_MODEL_NAME, aggregation_strategy="simple")

    def _gazetteer_match(self, text: str) -> list[LocationMatch]:
        """
        Scan sliding windows of 1-3 words in the text and fuzzy-match each
        against known place names. This catches multi-word names (e.g.
        "Bourj Hammoud") as well as single-word ones (e.g. "Hamra").

        Two corrections applied on top of naive windowing:
          1. Stopwords (prepositions, articles, connectors) are excluded
             from candidates entirely - short function words otherwise
             fuzzy-match false-positive against short place names purely
             by character overlap coincidence.
          2. Overlapping window matches are resolved by keeping only the
             longest (most specific) span per overlapping group - e.g.
             "Bourj" and "Bourj Hammoud" both matching should keep only
             "Bourj Hammoud".
        """
        words = text.split()
        # candidate: (text, start_word_idx, end_word_idx_exclusive)
        raw_candidates = []
        for window_size in (1, 2, 3):
            for i in range(len(words) - window_size + 1):
                span_words = words[i:i + window_size]
                candidate_text = " ".join(span_words)
                # Skip candidates that are pure stopwords (every word in the
                # span is a stopword) - single connector words shouldn't be
                # considered, but this still allows a stopword adjacent to a
                # real name if the window happens to include it.
                if all(w.strip(".,!?").lower() in STOPWORDS for w in span_words):
                    continue
                raw_candidates.append((candidate_text, i, i + window_size))

        raw_matches = []  # (LocationMatch, start_idx, end_idx)
        for candidate_text, start_idx, end_idx in raw_candidates:
            result = process.extractOne(
    candidate_text, self._all_variant_names, scorer=fuzz.ratio,
    score_cutoff=GAZETTEER_MATCH_THRESHOLD,
    processor=str.lower,
)
            if result is None:
                continue
            matched_name, score, _ = result
            row = self._resolve_row(matched_name.lower())
            canonical = row["name_default"]
            row_index = row.name  # pandas Series.name is the original DataFrame index

            is_ambiguous = self._row_ambiguous[row_index]
            alternatives = self._get_alternative_candidates(row_index) if is_ambiguous else []

            match = LocationMatch(
                text_span=candidate_text,
                matched_name=canonical,
                source="gazetteer",
                confidence=float(score),
                lat=row.get("lat"),
                lon=row.get("lon"),
                place_type=row.get("place_type"),
                ambiguous=is_ambiguous,
                alternative_candidates=alternatives,
            )
            raw_matches.append((match, start_idx, end_idx))

        # Resolve overlaps: sort by match confidence (best first), greedily
        # keep a match only if its word range doesn't overlap one already
        # kept. Confidence, not span length, decides the winner - a clean
        # exact match on "Hamra" (100%) should beat a noisier match that
        # happens to include an extra word like "bel Hamra" (82%), even
        # though the latter's window is longer.
        raw_matches.sort(key=lambda m: m[0].confidence, reverse=True)
        kept = []
        occupied_positions = set()
        for match, start_idx, end_idx in raw_matches:
            span_positions = set(range(start_idx, end_idx))
            if span_positions & occupied_positions:
                continue  # overlaps an already-kept, longer/equal match
            occupied_positions |= span_positions
            kept.append(match)

        return kept

    def _ner_match(self, text: str, matched_rows: list) -> list[LocationMatch]:
        if self.ner_pipeline is None:
            return []

        # Build the full set of name variants for every place the gazetteer
        # already matched, across all languages - so an NER hit like
        # "Achrafieh" correctly gets recognized as a duplicate of a
        # gazetteer match whose canonical name is stored in Arabic script.
        already_matched_variants = set()
        for row in matched_rows:
            for col in ["name_default", "name_ar", "name_en", "name_fr"]:
                val = row.get(col)
                if isinstance(val, str) and val.strip():
                    already_matched_variants.add(val.strip().lower())

        entities = self.ner_pipeline(text)
        matches = []
        for ent in entities:
            if ent["entity_group"] != "LOC":
                continue
            entity_text = ent["word"].strip()
            entity_lower = entity_text.lower()
            if any(entity_lower in variant or variant in entity_lower
                   for variant in already_matched_variants):
                continue  # gazetteer already found this place under some name variant
            matches.append(LocationMatch(
                text_span=entity_text,
                matched_name=entity_text,  # no gazetteer entry - raw NER text, needs admin review
                source="ner",
                confidence=float(ent["score"]),
            ))
        return matches

    def extract(self, text: str) -> LocationExtractionResult:
        gazetteer_matches = self._gazetteer_match(text)
        matched_rows = [
            self._resolve_row(m.matched_name.lower()) for m in gazetteer_matches
            if m.matched_name.lower() in self._name_to_rows
        ]
        ner_matches = self._ner_match(text, matched_rows)

        all_matches = gazetteer_matches + ner_matches
        return LocationExtractionResult(
            matches=all_matches,
            gazetteer_matches=len(gazetteer_matches),
            ner_only_matches=len(ner_matches),
        )


if __name__ == "__main__":
    # Quick manual test
    extractor = LocationExtractor(gazetteer_path="gazetteer.csv")
    test_sentences = [
        "fi selek kahraba wa2e3 bel Hamra",
        "tari2 mnhadem 3end Bourj Hammoud",
        "انقطاع كهرباء في طرابلس بالقرب من الجامع",
        "il y a une fuite d'eau à Achrafieh",
    ]
    for sentence in test_sentences:
        result = extractor.extract(sentence)
        print(f"\nText: {sentence}")
        for m in result.matches:
            print(f"  [{m.source}] '{m.text_span}' -> {m.matched_name} "
                  f"(confidence={m.confidence:.1f}, lat={m.lat}, lon={m.lon})")