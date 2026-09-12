#!/usr/bin/env python3
"""Rebuild data/seeds.json and data/animals.json from the official Chainers GitBook.

The docs expose their whole corpus at a single URL, so the extraction is
reproducible: no scraping of the game itself, no auth, no private endpoints.

    python scripts/extract-docs.py [--corpus path/to/llms-full.txt]

Without --corpus the script downloads the corpus over HTTPS.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import urllib.request
from pathlib import Path

CORPUS_URL = "https://docs.chainers.io/chainers-docs/llms-full.txt"
SEEDS_DOC = "https://docs.chainers.io/chainers-docs/chainers/chainers-farm/seeds"
ANIMALS_DOC = "https://docs.chainers.io/chainers-docs/chainers/chainers-farm/animals"

RARITIES = ["common", "uncommon", "rare", "epic", "legendary"]
# Seeds that can only be planted on water plots (Tranquil Waters).
WATER_SEEDS = {
    "SPECTRAL TROUT JUVENILE",
    "SPECTRAL FERN",
    "JUVENILE TROUT",
    "SUGARCANE SEED",
}
DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def load_corpus(path: str | None) -> str:
    if path:
        return Path(path).read_text(encoding="utf-8")
    with urllib.request.urlopen(CORPUS_URL, timeout=60) as response:
        return response.read().decode("utf-8")


def section(corpus: str, heading: str, stop: str) -> str:
    """Return the text between two top-level '# ' headings."""
    start = corpus.index(f"\n# {heading}\n")
    end = corpus.index(f"\n# {stop}\n", start)
    return corpus[start:end]


def clean(value: str) -> str:
    value = html.unescape(re.sub(r"<[^>]+>", " ", value))
    return re.sub(r"\s+", " ", value).strip()


def html_rows(text: str) -> list[list[str]]:
    rows: list[list[str]] = []
    for table in re.findall(r"<table[^>]*>.*?</table>", text, re.S):
        for row in re.findall(r"<tr>(.*?)</tr>", table, re.S):
            rows.append([clean(c) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)])
    return rows


def number(value: str) -> int | None:
    digits = re.sub(r"[^0-9]", "", value)
    return int(digits) if digits else None


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def extract_seeds(corpus: str) -> dict:
    seeds: dict[str, dict] = {}
    skipped: list[list[str]] = []

    for cells in html_rows(section(corpus, "Seeds", "Farm Boost Items")):
        if len(cells) < 6:
            continue
        name, seed_type, _card, rarity, biopoints, growth = cells[:6]
        rarity = rarity.lower()
        biopoints, growth = number(biopoints), number(growth)
        if rarity not in RARITIES or biopoints is None or growth is None:
            skipped.append(cells)
            continue

        seed = seeds.setdefault(
            slug(name),
            {
                "id": slug(name),
                "name": name.title(),
                "type": seed_type,
                "medium": "water" if name.upper() in WATER_SEEDS else "soil",
                # "Disposable" seeds are consumed on harvest; every other family
                # is returned in the same form (docs: Seed Mechanic Update).
                "renewable": seed_type.lower() != "disposable",
                "variants": {},
            },
        )
        seed["variants"][rarity] = {"biopoints": biopoints, "growthSec": growth}

    for seed in seeds.values():
        seed["variants"] = {r: seed["variants"][r] for r in RARITIES if r in seed["variants"]}

    ordered = sorted(seeds.values(), key=lambda s: s["name"])
    if skipped:
        print(f"  skipped {len(skipped)} unparsable seed rows (header rows included)", file=sys.stderr)
    return {"source": SEEDS_DOC, "seeds": ordered}


def extract_animals(corpus: str) -> dict:
    text = section(corpus, "Animals", "Seeds")
    groups: list[dict] = []
    current: dict | None = None

    for line in text.replace("&#x20;", " ").split("\n"):
        heading = re.match(r"^#{2,6}\s*\*{0,2}(.+?)\*{0,2}\s*$", line.strip())
        if heading:
            title = re.sub(r"\s+", " ", heading.group(1)).strip()
            current = {"group": title, "products": []}
            groups.append(current)
            continue
        if current is None:
            continue

        if "<tr>" in line:
            rows = html_rows(line)
        elif line.count("|") >= 3 and set(line.strip()) - set("|- "):
            rows = [[clean(c) for c in line.strip().strip("|").split("|")]]
        else:
            continue

        for cells in rows:
            if len(cells) < 4:
                continue
            biopoints, growth = number(cells[-2]), number(cells[-1])
            if biopoints is None or growth is None:
                continue
            current["products"].append(
                {"name": cells[0], "biopoints": biopoints, "growthSec": growth}
            )

    return {
        "source": ANIMALS_DOC,
        "note": (
            "Animal PRODUCTS. Animals need food crafted in the Workshop, so their output "
            "is not a plain replant loop and the v1 optimizer does not schedule them."
        ),
        "groups": [g for g in groups if g["products"]],
    }


def write(path: Path, payload: dict, extracted_at: str) -> None:
    payload = {"source": payload.pop("source"), "extractedAt": extracted_at, **payload}
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"  wrote {path.relative_to(path.parent.parent)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", help="local copy of llms-full.txt (skips the download)")
    parser.add_argument("--extracted-at", default="2026-09-02", help="date stamp for the data files")
    args = parser.parse_args()

    corpus = load_corpus(args.corpus)
    print(f"corpus: {len(corpus):,} chars")

    seeds = extract_seeds(corpus)
    print(f"  seeds: {len(seeds['seeds'])} families, "
          f"{sum(len(s['variants']) for s in seeds['seeds'])} variants")
    write(DATA_DIR / "seeds.json", seeds, args.extracted_at)

    animals = extract_animals(corpus)
    print(f"  animals: {len(animals['groups'])} groups, "
          f"{sum(len(g['products']) for g in animals['groups'])} products")
    write(DATA_DIR / "animals.json", animals, args.extracted_at)


if __name__ == "__main__":
    main()
