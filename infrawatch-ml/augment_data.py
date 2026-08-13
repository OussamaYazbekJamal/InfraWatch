"""
augment_data.py — Expand a small labeled dataset via back-translation.

Why: fine-tuning a transformer on a handful of examples per class will
overfit badly. Back-translation (source -> pivot language -> source)
generates paraphrases that preserve the label but vary the surface
wording, giving the model more to learn from without collecting new
raw data.

This version is multilingual-aware: Lebanese reports mix Arabic (MSA
and dialect), Arabizi (Arabic in Latin letters/numbers), French, and
English, sometimes within the same sentence. Each row's source language
is detected before translating, instead of assuming everything is
Arabic.

Known limitation: Arabizi (e.g. "fi 3atal kahraba") isn't a real
language code Google Translate understands, so it's approximated as
Arabic for the round-trip. Translation quality on Arabizi rows may be
poor or a no-op - that's expected, not a bug. Code-switched rows (mixing
two languages in one sentence) are treated by their dominant language
and may lose some of the mixing after round-tripping; if that matters
for your evaluation, keep a few code-switched rows un-augmented as-is.

Usage:
    python augment_data.py --input sample_data.csv --output augmented_data.csv --multiplier 3

Requires:
    pip install deep-translator pandas
    (deep-translator wraps Google Translate for free, no API key needed
     for light usage — swap for a paid provider if you hit rate limits)
"""

import argparse
import re
import time

import pandas as pd
from deep_translator import GoogleTranslator

FRENCH_MARKERS = re.compile(r"[éèàçêîôûë]|(?:^|\s)(le|la|les|une|un|est|dans|avec|c'est)(?:\s|$)", re.IGNORECASE)
ARABIZI_DIGITS = set("2378975")


def detect_source_lang(text: str) -> str:
    """
    Rough per-row language detection for choosing translation source.
    Returns a Google Translate language code: 'ar', 'fr', or 'en'.
    """
    arabic_chars = sum(1 for ch in text if "\u0600" <= ch <= "\u06FF")
    if arabic_chars > len(text) * 0.3:
        return "ar"

    arabizi_digit_count = sum(1 for ch in text if ch in ARABIZI_DIGITS)
    if arabizi_digit_count >= 2:
        return "ar"  # approximation - see module docstring

    if FRENCH_MARKERS.search(text):
        return "fr"

    return "en"


def back_translate(text: str, source_lang: str, pivot_lang: str, retries: int = 2) -> str:
    """Translate source -> pivot -> source to get a paraphrase."""
    if source_lang == pivot_lang:
        return text  # nothing to do, pivot would be a no-op
    for attempt in range(retries):
        try:
            to_pivot = GoogleTranslator(source=source_lang, target=pivot_lang).translate(text)
            back = GoogleTranslator(source=pivot_lang, target=source_lang).translate(to_pivot)
            return back
        except Exception:
            time.sleep(1.5)
    return text  # fall back to original if translation service fails


def augment_dataframe(df: pd.DataFrame, multiplier: int) -> pd.DataFrame:
    """
    For each row, generate `multiplier - 1` additional paraphrased rows
    (the original row is kept as-is), cycling through different pivot
    languages for more varied paraphrases. Pivot choice depends on each
    row's detected source language so we don't pivot a language through
    itself.
    """
    pivot_options = {
        "ar": ["en", "fr"],
        "fr": ["en", "ar"],
        "en": ["fr", "ar"],
    }
    augmented_rows = [df]
    detected_langs = df["text"].apply(detect_source_lang)

    for i in range(multiplier - 1):
        new_rows = df.copy()
        new_texts = []
        for text, src_lang in zip(df["text"], detected_langs):
            pivot = pivot_options[src_lang][i % len(pivot_options[src_lang])]
            new_texts.append(back_translate(text, source_lang=src_lang, pivot_lang=pivot))
        new_rows["text"] = new_texts
        augmented_rows.append(new_rows)

    result = pd.concat(augmented_rows, ignore_index=True)
    result = result.drop_duplicates(subset="text").reset_index(drop=True)
    return result


def main():
    parser = argparse.ArgumentParser(description="Augment a small labeled report dataset via back-translation.")
    parser.add_argument("--input", required=True, help="Path to input CSV with columns: text, label")
    parser.add_argument("--output", required=True, help="Path to write augmented CSV")
    parser.add_argument("--multiplier", type=int, default=3, help="Target size multiplier (default: 3x)")
    args = parser.parse_args()

    df = pd.read_csv(args.input)
    if "text" not in df.columns or "label" not in df.columns:
        raise ValueError("Input CSV must have 'text' and 'label' columns")

    print(f"Original dataset size: {len(df)}")
    print("Label distribution:")
    print(df["label"].value_counts())

    augmented = augment_dataframe(df, args.multiplier)

    print(f"\nAugmented dataset size: {len(augmented)}")
    print("Label distribution after augmentation:")
    print(augmented["label"].value_counts())

    augmented.to_csv(args.output, index=False)
    print(f"\nSaved to {args.output}")


if __name__ == "__main__":
    main()
