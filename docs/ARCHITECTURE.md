# FPL League Room: architecture and handover

| | |
| --- | --- |
| **Version** | 1.0 |
| **Date** | 28 October 2026 |
| **Saved as** | Branch `v1.0` on GitHub, frozen at this version. To go back: open the branch on GitHub, or `git checkout v1.0`. |
| **State** | Live. Gameweek 8 complete; report and newsletter produced automatically. |
| **Owner** | Rahul Chadha |

## 1. Purpose

A personal, hands-off tool for Fantasy Premier League mini-leagues. Every morning it fetches league data, refreshes a private web page (tables, charts, insights, transfer planner), and after each finished gameweek writes a banter report and a Word newsletter for the main league and notifies the owner's phone. Nobody runs anything by hand.

It replaced a Copilot-based kit (script, brief file, upload, prompt, paste) that needed six manual steps a week.

## 2. Leagues

| Role | League | Id | Managers | Gets report and newsletter |
| --- | --- | --- | --- | --- |
| Main | Aberdeen plc | 554519 | 88 | Yes |
| Other | 12 Bottles of Bleach pls | 554564 | 11 | No (page only) |

Set in `settings.json` (`league_id`, `other_leagues`). **League ids change every season**, so update them in August.

## 3. Architecture

```
FPL public API ──► GitHub Action (06:17 daily) ──► private repo: data/*.json
                                                        │
                                                        ▼
                         Claude scheduled task (07:43 daily, Europe/London)
                          │  loads data · writes report + newsletter · checks numbers
                          ├──────────────► League Room page (Claude artifact, private store)
                          └──────────────► owner's phone (notification + .docx)
```

| Component | Where | What it does |
| --- | --- | --- |
| FPL API | `fantasy.premierleague.com/api/` | Public JSON, no login. Endpoints: `bootstrap-static`, `leagues-classic/{id}/standings`, `entry/{id}/history`, `entry/{id}/event/{gw}/picks`, `entry/{id}/transfers`, `event/{gw}/live`, `fixtures`. |
| Fetch | `fpl_fetch.py`, run by `.github/workflows/fetch.yml` | Python standard library only. Writes `data/fpl_bundle.json` (main league), `data/fpl_bundle_<id>.json` (others), `data/captains.json` (season captaincy, topped up incrementally) and `data/fetch_status.json`. Commits back to the repo. Manual run: Actions → Fetch FPL league → Run workflow (optional `gw` input writes a past gameweek to its own file). |
| Repository | `github.com/Ralph146-UI/fpl-league-room` (private) | The hub: data, settings, code, voices, newsletters. Claude's GitHub app has access to this repo only. |
| Shared logic | `tools/core.js` | **Every calculation, defined once**, used by both the page and the task: tables, movers, span stats, insights, gameweek analysis, transfer model, newsletter figures, player/team insights, number check, example league. |
| Task helpers | `tools/payload.js` | `info`, `weekly`, `newsletter`, `split`, `leagues`, `check`. |
| Newsletter | `tools/newsletter.js`, `tools/theme_font.py`, `tools/pack.js` | Builds the Word file in the GW7 layout (A4, purple `#37003C`, green `#00FF87`, Aptos (Body) via theme fonts), then packs figures, columns and .docx for the page. |
| Voices | `personas/` | `rules.md` (applies to every write-up), `banter.md`, `pundit.md`, `manager.md`, `plain.md`, `newsletter.md` (newsletter voice with the hand-written GW7 issue as style example). |
| Scheduled task | Claude, id `trig_016FNgx9PT5WW6cE9eZQgXSx` | Daily 07:43 Europe/London, cloud, automatic approval, push notifications. Full prompt: `docs/scheduled-task-prompt.md`. |
| Page | Claude artifact `https://claude.ai/artifact/9qRQFge74rDATu7jrbkEiw`, pinned | Single HTML file. Source in `page/` (`page.html`, `ui.js`; `build.py` inlines `fpl_fetch.py`, `tools/core.js` and `ui.js`). Capabilities: `db`, `user`, `sample`, `downloads`. |

### Page storage (artifact database, owner's private area `data/users/<id>/`)

| Document | Written by | Contents |
| --- | --- | --- |
| `players` | task | Shared player data: elements, teams, fixtures, events (from the main bundle) |
| `league` | task | Main league: managers, history, picks, live points, stats, results |
| `league_<id>` | task | Each other league's league part |
| `leagues` | task | List for the league picker: id, name, managers, primary, fetched |
| `report` | task | Latest banter report: gw, text, voice, number-check line |
| `newsletter` | task | Latest newsletter: figures JSON, columns JSON, .docx as base64, check line |
| `status` | task | Stale-data alert memory |

Each document must stay under 256 KB; `payload.js` refuses anything over 240 KB.

### Page tabs

League (table, form over a span, four charts, squad sheet) · Gameweek (podium, facts, every score) · Insights (league vs reality, positions, teams, players) · Transfers (planner) · Newsletter (main league only; Word download) · Write-ups (on-demand reports in five voices, run on the viewer's Claude usage) · Data (manual load and fetch script).

A non-main league switches the accent to blue and shows "League N of M". "You" and the running-joke manager are remembered per league in browser storage.

## 4. Design rules (keep these)

1. **Hands-off first.** Judge changes by clicks per week, not features.
2. **One definition per metric**, in `tools/core.js`. Never compute a figure in two places.
3. **Code counts, the model writes.** Write-ups receive finished data only, and every number in the output is checked against it (`numberCheck`). Unmatched numbers are fixed or flagged.
4. **Leagues never mix.** One bundle per league, one stored document per league; the report and newsletter belong to the main league only.
5. **Drop unreliable figures rather than guess** (for example the global most-bought player, which FPL only gives for the open transfer window).
6. **No credentials anywhere.** Public data only. Narrowest access for each part.

## 5. Definitions that matter

| Metric | Definition |
| --- | --- |
| Totals and positions | FPL season totals, after hits |
| Weekly score | Before hits; hits shown separately |
| Newsletter average and median | After hits (matches the hand-made issues) |
| Benchmark | FPL global average for that gameweek (never the league average) |
| Consistency | Sample standard deviation of weekly scores after hits |
| Rank movement | FPL's own `rank`/`last_rank` for the current gameweek (FPL splits ties); shared ranks from totals for history |
| League transfers in/out | Excludes Wildcard and Free Hit weeks |
| Captain picker | Points the armband delivered, Triple Captain included |
| Team value | Squad value, excluding the bank |
| Ownership | In the 15-man squad |

Validated by regenerating the hand-made GW7 newsletter: every table matched. The hand-made issue undercounted Triple Captains (11 against FPL's 13).

## 6. Operations

| When | What happens |
| --- | --- |
| Daily 06:17 UK | GitHub fetches all leagues and commits the data |
| Daily 07:43 UK | Task loads data into the page; silent if nothing new |
| Morning after a gameweek is final | Banter report and newsletter written, checked, saved; notification sent |
| Fetch stale for 48 hours | Task sends one warning |
| Each August | Update `league_id` and `other_leagues` |

To rebuild the page: `python3 page/build.py`, then publish `page/fpl-league-room.built.html` to the same artifact URL.

## 7. Known issues and limits

- FPL can block cloud servers. Fallback: run `python3 fpl_fetch.py` locally and drop the file on the page's Data tab.
- The task's own push of the newsletter .docx failed once (GW8). The page and phone copies were unaffected and the file was added by hand. Watch on GW9.
- The ArtifactData tool may refuse writes from an interactive session without approval. Firing the scheduled task is the reliable way to reload data.
- The transfer model is simple (form, minutes, fixture difficulty). No xG, rotation or price changes.
- The page is private. Sharing requires viewers signed in to Claude, and the data is currently in the owner's private area, so shared viewers would see the example league.

## 8. Roadmap (agreed, not built)

**Next: Forecast tab**, decided 28 October 2026.

- **Team model:** Poisson expected goals per fixture from attack and defence ratings, using the last 5 gameweeks blended with the season (recent weight grows as the season builds), giving win/draw/loss and clean-sheet probabilities.
- **Player model:** expected points = P(plays) × (appearance + xG/90 × goal points by position + xA/90 × 3 + clean-sheet probability × CS points + average bonus + defensive contributions), scaled by the team model. Shown as a range.
- **Needs:** per-player gameweek history (`element-summary/{id}/`, about 450 requests a day on GitHub).
- **Outputs:** fixture predictions, top expected points by position, captain picks, a predicted podium for each league from managers' actual squads, and a **scorecard** comparing predictions with results each gameweek.
- **Open question:** whether forecasts and the scorecard appear in the newsletter or only on the page.

Later, if wanted: news context from the Premier League's "The Scout" (summarised, linked and kept separate from checked figures).

## 9. Change log

| Version | Date | Change |
| --- | --- | --- |
| 1.0 | 28 Oct 2026 | Live system: daily fetch, page with seven tabs, two leagues, banter report, Word newsletter, Insights tab, number checking. |
