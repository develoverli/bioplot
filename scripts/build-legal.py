#!/usr/bin/env python3
"""Render PRIVACY.md and TERMS.md into the static pages the site serves.

Listing a browser extension requires a privacy policy anyone can open, from anywhere, forever.
A link into a code host depends on that host and that repository staying put, so the pages
ship with the app at its own origin instead.

Markdown stays the single source: the two files are edited, this regenerates the two pages, and
they cannot drift apart. Only the small subset of Markdown those files actually use is
supported, and anything unrecognised is passed through as a paragraph rather than guessed at.

    python scripts/build-legal.py
"""
from __future__ import annotations

import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "public"

PAGES = (("PRIVACY.md", "privacy.html"), ("TERMS.md", "terms.html"))

# Kept deliberately close to the app's dark palette, but standalone: these pages must render
# correctly with no build step, no fonts to fetch and no stylesheet to find.
STYLE = """
      :root { color-scheme: dark; }
      body {
        margin: 0;
        padding: 3rem 1.5rem 5rem;
        background: #0d1613;
        color: #dbe7e0;
        font: 16px/1.65 system-ui, -apple-system, 'Segoe UI', sans-serif;
      }
      main { max-width: 42rem; margin: 0 auto; }
      a { color: #86efac; }
      h1 { font-size: 1.6rem; line-height: 1.25; margin: 0 0 1.5rem; }
      h2 { font-size: 1.1rem; margin: 2.25rem 0 0.6rem; color: #f2fbf6; }
      p, ul { margin: 0 0 1rem; }
      ul { padding-left: 1.25rem; }
      li { margin-bottom: 0.35rem; }
      code {
        background: #16241f;
        border-radius: 4px;
        padding: 0.1em 0.35em;
        font-size: 0.9em;
      }
      strong { color: #f2fbf6; }
      .back { display: inline-block; margin-bottom: 2rem; font-size: 0.9rem; }
"""


def inline(text: str) -> str:
    """Escape first, then re-introduce only the inline markup these documents use."""
    out = html.escape(text, quote=False)
    out = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', out)
    out = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", out)
    out = re.sub(r"`([^`]+)`", r"<code>\1</code>", out)
    # Bare URLs and addresses are common in these two files and worth linking.
    out = re.sub(r"(?<!\")(https?://[^\s<]+)", r'<a href="\1">\1</a>', out)
    out = re.sub(r"(?<![\w>/])([\w.+-]+@[\w-]+\.[\w.-]+)", r'<a href="mailto:\1">\1</a>', out)
    return out


def render(markdown: str) -> tuple[str, str]:
    """Returns the page title and its body HTML."""
    title = ""
    body: list[str] = []
    paragraph: list[str] = []
    bullets: list[str] = []

    def flush() -> None:
        if paragraph:
            body.append(f"<p>{inline(' '.join(paragraph))}</p>")
            paragraph.clear()
        if bullets:
            items = "".join(f"<li>{inline(item)}</li>" for item in bullets)
            body.append(f"<ul>{items}</ul>")
            bullets.clear()

    for raw in markdown.splitlines():
        line = raw.rstrip()

        if not line.strip():
            flush()
            continue

        if line.startswith("# "):
            flush()
            title = line[2:].strip()
            body.append(f"<h1>{inline(title)}</h1>")
        elif line.startswith("## "):
            flush()
            body.append(f"<h2>{inline(line[3:].strip())}</h2>")
        elif line.startswith("- "):
            if paragraph:
                flush()
            bullets.append(line[2:].strip())
        elif bullets and line.startswith("  "):
            # A wrapped bullet belongs to the bullet above it, not to a new one.
            bullets[-1] += " " + line.strip()
        else:
            if bullets:
                flush()
            paragraph.append(line.strip())

    flush()
    return title, "\n      ".join(body)


def page(title: str, body: str) -> str:
    return f"""<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>{html.escape(title)}</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <style>{STYLE}    </style>
  </head>
  <body>
    <main>
      <a class="back" href="/">&larr; Bioplot</a>
      {body}
    </main>
  </body>
</html>
"""


def main() -> None:
    TARGET.mkdir(parents=True, exist_ok=True)
    for source, output in PAGES:
        title, body = render((ROOT / source).read_text(encoding="utf-8"))
        (TARGET / output).write_text(page(title, body), encoding="utf-8")
        print(f"  wrote public/{output}")


if __name__ == "__main__":
    main()
