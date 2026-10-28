#!/usr/bin/env python3
"""Assemble the League Room page into one HTML file, ready to publish as the Claude artifact.

    python3 page/build.py      (from the repo root)

It inlines three things into page.html: the fetch script (offered on the Data tab),
tools/core.js (every calculation, shared with the scheduled task) and page/ui.js.
Output: page/fpl-league-room.built.html
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "page"
h = (PAGE / "page.html").read_text()
fetch = (ROOT / "fpl_fetch.py").read_text()
assert "</script" not in fetch.lower()
h = (h.replace("__FETCH_SRC__", fetch)
      .replace("__CORE_JS__", (ROOT / "tools" / "core.js").read_text())
      .replace("__UI_JS__", (PAGE / "ui.js").read_text()))
out = PAGE / "fpl-league-room.built.html"
out.write_text(h)
print(f"Wrote {out.relative_to(ROOT)} ({len(h) // 1024} KB)")
