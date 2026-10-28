# FPL League Room

Keeps an FPL mini-league up to date without anyone running anything.

1. **GitHub fetches the league every morning** (06:17 UTC). The workflow in
   `.github/workflows/fetch.yml` runs `fpl_fetch.py` and saves the result to
   `data/fpl_bundle.json`.
2. **A Claude scheduled task picks it up an hour later.** It loads the data into
   the League Room page, and when a gameweek has just finished it writes the
   weekly report and sends it to you.

Full design, definitions and handover: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** (version 1.0, 28 Oct 2026, git tag `v1.0`).

## Settings

Edit `settings.json` on GitHub (pencil icon, then Commit changes):

| Setting | What it does |
| --- | --- |
| `league_id` | Your classic league's number, from `fantasy.premierleague.com/leagues/<number>/standings/c`. **Changes every season.** |
| `other_leagues` | Extra leagues to fetch, e.g. `[554564]`. They show on the page's league picker; the report and newsletter stay with the main league. |
| `report.enabled` | `false` to just refresh the data with no report. |
| `report.voice` | `banter`, `pundit`, `manager` or `plain` (the files in `personas/`). |
| `report.running_joke_about` | A manager's name for the running joke, or `""`. |
| `report.going_to` | `whatsapp`, `teams` or `me`: sets the formatting. |
| `newsletter.enabled` | `false` to stop the weekly Word newsletter. |

## When something goes wrong

- **The fetch failed:** GitHub emails you. Open the Actions tab to see why.
  The FPL site sometimes refuses cloud servers, or is offline while it updates
  between gameweeks. It tries again the next morning. To run it now, open
  Actions, then Fetch FPL league, then Run workflow.
- **Run it by hand instead:** `python3 fpl_fetch.py` on your own computer, then
  drop `data/fpl_bundle.json` on the page's Data tab.

## Files

| File | What it is |
| --- | --- |
| `fpl_fetch.py` | Fetches the league. Standard library only. |
| `tools/core.js` | Every calculation: the same file the page uses. |
| `tools/payload.js` | Helpers the scheduled task uses (report data, number check). |
| `personas/` | The report voices, the rules every report follows, and `newsletter.md` (the newsletter's voice and your GW7 issue as the style example). |
| `tools/newsletter.js` | Builds the newsletter Word file in the GW7 layout. |
| `data/newsletters/` | Every newsletter, one Word file per gameweek. |
| `data/fpl_bundle.json` | The latest data, written by the workflow. |
| `page/` | The League Room page source; `python3 page/build.py` assembles it. |
| `docs/` | Architecture and handover, and the scheduled task's full instructions. |
