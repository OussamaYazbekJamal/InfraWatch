"""
generate_templates.py — Template-based synthetic dataset generator.

Methodology note (cite this approach as "template-based data synthesis" /
"weak supervision" in your report): instead of manually labeling reports
one by one, or relying on an LLM's judgment for each example, this script
combines a fixed set of hand-written sentence templates with slot values
(locations, time expressions) across FOUR languages/registers: Fus'ha
(Modern Standard Arabic, Arabic script), Lebanese Arabizi (Arabic in
Latin letters/numbers), English, and French. Because urgency is tied
deterministically to which template a sentence came from, every
generated example is correctly labeled by construction - there is no
risk of a labeling error, which is the main practical advantage of this
approach over free-form LLM generation or manual annotation.

Each issue is hand-translated per language (not machine-translated at
generation time) so grammar stays correct across all four registers of
the same underlying event.

This produces a LARGE, perfectly-labeled but LOW-DIVERSITY dataset
(many rows follow similar sentence structure). It complements, rather
than replaces:
  - augment_data.py (back-translation) - adds surface-level paraphrase
    variety on top of these templates
  - real collected reports - still the only source of genuine linguistic
    variety and real-world phrasing quirks; template data should be
    described as a synthetic/weak-supervision component alongside real
    data in your report, not a substitute for it

Usage:
    python generate_templates.py --output template_data.csv --samples-per-combo 3
"""

import argparse
import random

import pandas as pd

random.seed(42)  # reproducibility

LOCATIONS = [
    {"msa": "في الحمرا", "ar": "bel Hamra", "en": "in Hamra", "fr": "à Hamra"},
    {"msa": "في الأشرفية", "ar": "bel Ashrafieh", "en": "in Ashrafieh", "fr": "à Achrafieh"},
    {"msa": "في الضاحية", "ar": "bel Dahye", "en": "in the Dahye area", "fr": "dans la Dahye"},
    {"msa": "في زحلة", "ar": "bel Zahle", "en": "in Zahle", "fr": "à Zahle"},
    {"msa": "في طرابلس", "ar": "bel Tripoli", "en": "in Tripoli", "fr": "à Tripoli"},
    {"msa": "بالقرب من الجامع", "ar": "3end el jame3", "en": "near the mosque", "fr": "près de la mosquée"},
    {"msa": "على الأوتوستراد", "ar": "3al autostrade", "en": "on the highway", "fr": "sur l'autoroute"},
    {"msa": "في الفردان", "ar": "bel Verdun", "en": "in Verdun", "fr": "à Verdun"},
    {"msa": "في برج حمود", "ar": "bel Bourj Hammoud", "en": "in Bourj Hammoud", "fr": "à Bourj Hammoud"},
    {"msa": "في صيدا", "ar": "bel Saida", "en": "in Saida", "fr": "à Saïda"},
    {"msa": "في جونيه", "ar": "bel Jounieh", "en": "in Jounieh", "fr": "à Jounieh"},
    {"msa": "في النبطية", "ar": "bel Nabatieh", "en": "in Nabatieh", "fr": "à Nabatieh"},
]

TIME_PHRASES = [
    {"msa": "منذ هذا الصباح", "ar": "mnel sobo7", "en": "since this morning", "fr": "depuis ce matin"},
    {"msa": "منذ ساعتين", "ar": "men sa3tein", "en": "for the past two hours", "fr": "depuis deux heures"},
    {"msa": "منذ الأمس", "ar": "men embeyra7", "en": "since yesterday", "fr": "depuis hier"},
    {"msa": "الآن", "ar": "hala2", "en": "right now", "fr": "en ce moment"},
    {"msa": "منذ الليلة الماضية", "ar": "mnel leel", "en": "since last night", "fr": "depuis la nuit dernière"},
    {"msa": "منذ قليل", "ar": "men chwaye", "en": "a short while ago", "fr": "il y a peu"},
]

# Each issue: MSA, Arabizi, English, French clause - all describing the
# same event, hand-written per language (not machine-translated) so
# grammar is correct in every register.
CATEGORY_ISSUES = {
    "Electricity": {
        "urgent": [
            {
                "msa": "سقط سلك كهرباء مكشوف على الطريق",
                "ar": "fi selek kahraba maf9ou3 wa2e3 3al tari2",
                "en": "an exposed power cable has fallen onto the road",
                "fr": "un câble électrique dénudé est tombé sur la route",
            },
            {
                "msa": "يوجد عطل في المحول الكهربائي ويتصاعد منه دخان",
                "ar": "fi transformer 3am ya3mel sada w tale3 menno da5khan",
                "en": "a transformer is malfunctioning and giving off smoke",
                "fr": "un transformateur est en panne et dégage de la fumée",
            },
            {
                "msa": "اندلع حريق صغير بسبب عطل كهربائي",
                "ar": "sar 7ari2 saghir b sabab 3atal kahraba",
                "en": "a small fire has started due to an electrical fault",
                "fr": "un petit incendie s'est déclaré à cause d'une panne électrique",
            },
            {
                "msa": "انفجرت لوحة الكهرباء الرئيسية في المبنى",
                "ar": "faj2it lawhet el kahraba el ra2iseyye bel binaye",
                "en": "the main electrical panel in the building has exploded",
                "fr": "le tableau électrique principal du bâtiment a explosé",
            },
        ],
        "not_urgent": [
            {
                "msa": "مصباح الشارع مطفأ منذ فترة",
                "ar": "streetlight mtfeye men fatra",
                "en": "a streetlight has been out for a while",
                "fr": "un lampadaire est éteint depuis un moment",
            },
            {
                "msa": "يوجد تغيير بسيط في جدول توزيع الكهرباء",
                "ar": "fi ta8yir bsit bel jadwal el kahraba",
                "en": "there is a minor change to the electricity schedule",
                "fr": "il y a un léger changement dans l'horaire de l'électricité",
            },
            {
                "msa": "الكهرباء متقطعة بشكل بسيط وهذا أمر معتاد",
                "ar": "kahraba ma3atle chwaye bas 3ade",
                "en": "there is a minor, routine power flicker",
                "fr": "il y a une légère coupure de courant habituelle",
            },
        ],
    },
    "Fuel": {
        "urgent": [
            {
                "msa": "لا يوجد وقود في المنطقة بأكملها وتحدث مشادات",
                "ar": "mafi mazout bel mantaka kellon w fi khna2at",
                "en": "there is no fuel anywhere in the area and altercations are breaking out",
                "fr": "il n'y a plus de carburant dans toute la région et des bagarres éclatent",
            },
            {
                "msa": "المحطة مغلقة بالكامل ويوجد ازدحام خطير",
                "ar": "el mahatta sakra bel kemel w fi izdi7am khatir",
                "en": "the station is completely closed and there is dangerous overcrowding",
                "fr": "la station est complètement fermée et il y a une surpopulation dangereuse",
            },
        ],
        "not_urgent": [
            {
                "msa": "يوجد طابور طويل في المحطة لكنه يتحرك",
                "ar": "fi saff tawil bel mahatta bas 3am yet7arrak",
                "en": "there is a long queue at the station but it is moving",
                "fr": "il y a une longue file à la station mais elle avance",
            },
            {
                "msa": "يوجد فرق بسيط في السعر بين المحطات",
                "ar": "fi far2 se3er bsit bein mahattet",
                "en": "there is a small price difference between stations",
                "fr": "il y a une petite différence de prix entre les stations",
            },
        ],
    },
    "Transport": {
        "urgent": [
            {
                "msa": "المحطة الرئيسية مغلقة بالكامل والناس عالقون",
                "ar": "el mahatta el ra2iseyye msakkra kellyan w nnas 3aliqin",
                "en": "the main station is completely closed and people are stranded",
                "fr": "la gare principale est complètement fermée et les gens sont bloqués",
            },
            {
                "msa": "توقفت خدمة النقل بالكامل في المنطقة",
                "ar": "khadamet naql it2attalet kellyan bel mantaka",
                "en": "transport service has stopped entirely in the area",
                "fr": "le service de transport s'est arrêté complètement dans la région",
            },
        ],
        "not_urgent": [
            {
                "msa": "يوجد تأخير بسيط في موعد الحافلة",
                "ar": "fi ta2khir bsit bel bus",
                "en": "there is a minor delay with the bus",
                "fr": "il y a un léger retard du bus",
            },
            {
                "msa": "خدمة النقل محدودة في عطلة نهاية الأسبوع كالمعتاد",
                "ar": "khadamet naql msh metwaffra bel weekend bas 3ade",
                "en": "transport service is limited on weekends as usual",
                "fr": "le service de transport est limité le week-end comme d'habitude",
            },
        ],
    },
    "Roads": {
        "urgent": [
            {
                "msa": "انهار الطريق بالكامل وتصطدم السيارات",
                "ar": "tari2 mnhadem kellyan w sayyarat 3am tenkeb",
                "en": "the road has completely collapsed and cars are crashing",
                "fr": "la route s'est complètement effondrée et des voitures ont des accidents",
            },
            {
                "msa": "يوجد حفرة عميقة في منتصف الطريق وخطيرة على السيارات",
                "ar": "fi 7ofra 3mi2a bel nos tari2 w khatira 3al sayyarat",
                "en": "there is a deep pothole in the middle of the road, dangerous for cars",
                "fr": "il y a un nid-de-poule profond au milieu de la route, dangereux pour les voitures",
            },
            {
                "msa": "الطريق مغمور بالمياه ولا يمكن عبوره",
                "ar": "el tari2 mgha6a bel mai w mesh 2ader el 3oboor",
                "en": "the road is flooded and impassable",
                "fr": "la route est inondée et impraticable",
            },
            {
                "msa": "انهار جزء من الجسر ويشكل خطرا مباشرا",
                "ar": "2it2a3 jouz2 mnel jiser w saar khatar mbacher",
                "en": "part of the bridge has collapsed and poses an immediate danger",
                "fr": "une partie du pont s'est effondrée et représente un danger immédiat",
            },
        ],
        "not_urgent": [
            {
                "msa": "يوجد شرخ بسيط في الإسفلت",
                "ar": "fi crack bsit bel asphalt",
                "en": "there is a minor crack in the asphalt",
                "fr": "il y a une petite fissure dans l'asphalte",
            },
            {
                "msa": "يوجد حفرة صغيرة غير مزعجة",
                "ar": "fi 7ofra sghire mesh mez3ije",
                "en": "there is a small, non-disruptive pothole",
                "fr": "il y a un petit nid-de-poule sans gravité",
            },
            {
                "msa": "لافتة الطريق مائلة قليلا لكنها واضحة",
                "ar": "lafte tari2 mayle chwaye bas wade7a",
                "en": "a road sign is slightly tilted but still clearly visible",
                "fr": "un panneau routier est légèrement incliné mais reste bien visible",
            },
        ],
    },
}


def generate_msa(issue: dict, location: dict, time_phrase: dict) -> str:
    return f"{issue['msa']} {location['msa']} {time_phrase['msa']}."


def generate_arabizi(issue: dict, location: dict, time_phrase: dict) -> str:
    return f"{issue['ar']} {location['ar']} {time_phrase['ar']}"


def generate_english(issue: dict, location: dict, time_phrase: dict) -> str:
    clause = issue["en"][0].upper() + issue["en"][1:]
    return f"{clause} {location['en']} {time_phrase['en']}."


def generate_french(issue: dict, location: dict, time_phrase: dict) -> str:
    clause = issue["fr"][0].upper() + issue["fr"][1:]
    return f"{clause} {location['fr']} {time_phrase['fr']}."


def generate_dataset(samples_per_combo: int) -> pd.DataFrame:
    rows = []
    for category, urgency_map in CATEGORY_ISSUES.items():
        for urgency, issues in urgency_map.items():
            for issue_idx, issue in enumerate(issues):
                # All rows generated from this exact (category, urgency, issue)
                # combo - across every language and every location/time
                # variation - are near-duplicates of each other and MUST stay
                # together on one side of any train/val split. This ID is
                # what train_classifier.py's GroupKFold groups by.
                template_id = f"{category}_{urgency}_{issue_idx}"
                for _ in range(samples_per_combo):
                    location = random.choice(LOCATIONS)
                    time_phrase = random.choice(TIME_PHRASES)

                    rows.append({"text": generate_msa(issue, location, time_phrase),
                                 "label": urgency, "category": category, "source": "template-msa",
                                 "group_id": template_id})
                    rows.append({"text": generate_arabizi(issue, location, time_phrase),
                                 "label": urgency, "category": category, "source": "template-arabizi",
                                 "group_id": template_id})
                    rows.append({"text": generate_english(issue, location, time_phrase),
                                 "label": urgency, "category": category, "source": "template-english",
                                 "group_id": template_id})
                    rows.append({"text": generate_french(issue, location, time_phrase),
                                 "label": urgency, "category": category, "source": "template-french",
                                 "group_id": template_id})

    df = pd.DataFrame(rows)
    df = df.drop_duplicates(subset="text").reset_index(drop=True)
    return df


def main():
    parser = argparse.ArgumentParser(description="Generate a template-based synthetic urgency dataset.")
    parser.add_argument("--output", default="template_data.csv", help="Path to write the generated CSV")
    parser.add_argument("--samples-per-combo", type=int, default=3,
                         help="How many (location, time-phrase) variations per template (default: 3)")
    args = parser.parse_args()

    df = generate_dataset(args.samples_per_combo)

    print(f"Generated {len(df)} rows")
    print("\nLabel distribution:")
    print(df["label"].value_counts())
    print("\nCategory distribution:")
    print(df["category"].value_counts())
    print("\nSource (language) distribution:")
    print(df["source"].value_counts())

    # Full version keeps category/source for your own inspection; minimal
    # version keeps text,label,group_id - group_id is required by
    # train_classifier.py's GroupKFold to prevent near-duplicate template
    # variants from leaking across train/validation splits.
    df.to_csv(args.output, index=False)
    df[["text", "label", "group_id"]].to_csv(args.output.replace(".csv", "_minimal.csv"), index=False)
    print(f"\nSaved full version (with category/source columns) to {args.output}")
    print(f"Saved minimal version (text,label only) to {args.output.replace('.csv', '_minimal.csv')}")


if __name__ == "__main__":
    main()
