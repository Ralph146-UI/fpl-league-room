# Forecast tab: design proposal (parked)

| | |
| --- | --- |
| **Status** | Proposal, parked 28 October 2026. Not built. |
| **Builds on** | `docs/ARCHITECTURE.md` section 8 (agreed roadmap) |
| **Purpose** | Records the review of the agreed spec and the changes proposed before building, so work can restart without redoing the analysis. |

## 1. Starting point

The agreed spec (architecture section 8): a team Poisson model, a player expected-points model shown as a range, per-player gameweek history from `element-summary/{id}/`, and these outputs: fixture predictions, top expected points by position, captain picks, a predicted podium per league, and a scorecard against results each gameweek.

What the data already has (checked against `data/fpl_bundle.json` at GW8):

- `results`: every finished match with scores (80 matches, GW1 to GW8).
- `stats`: season totals for 451 players with minutes, including xG, xA, bonus, starts and defensive contribution.
- `elements`: chance of playing next round, status and news.
- `fixtures`: future fixtures with FPL difficulty.

## 2. Proposed changes to the spec

### 2.1 Use stored gameweek data instead of 450 `element-summary` calls a day

**Problem.** FPL already blocks cloud servers sometimes (architecture section 7). Adding about 450 calls a day from GitHub raises the chance that the main fetch is blocked too, which would cost the parts that already work.

**Proposal.** Fetch `event/{gw}/live` once per finished gameweek and append it to a running file (for example `data/player_gw.json`). The fetch already calls this endpoint for captaincy. That gives per-player minutes, xG, xA, bonus and defensive contribution by gameweek for about 1 new request a week instead of about 3,000.

**To verify on the first Action run:** that the live stats include `expected_goals`, `expected_assists` and `defensive_contribution`. This could not be checked from the build environment, which cannot reach FPL.

**Fallback.** If those fields are missing, use `element-summary`, but only for players with minutes and only once per finished gameweek, never daily. Run it as a separate workflow step with `continue-on-error`, so a failure cannot break the main fetch.

### 2.2 The team model needs no new data

`results` already holds every finished match. The weakness is sample size: 8 gameweeks of goals is noisy.

- **Shrinkage:** pull each team's attack and defence ratings towards the league average, with the pull weakening as the season builds.
- **Attacking xG:** blend team goals with team attacking xG (the sum of its players' xG from `stats`), so one lucky week does not swing the ratings.
- **Recency:** blend the last 5 gameweeks with the season, as agreed. The recent weight grows as the season builds.
- **Known gap:** defensive xG is not available. Clean-sheet odds rest on goals conceded, so they are the weakest output, and the page must say so.

### 2.3 Freeze predictions before kick-off, and add a baseline

**Problem.** A scorecard recalculated after the gameweek can quietly use the results it is meant to predict.

**Proposal.**

- The GitHub Action runs the forecast with Node, using `tools/core.js`, and writes `data/forecasts/gwN.json`. This keeps one definition per metric (design rule 2).
- The file is overwritten daily until the gameweek deadline, then never touched again.
- The scorecard always compares against a simple baseline, such as points per game. Without one, an error like "off by 12 points" says nothing about whether the model is any good.

### 2.4 The podium is projected from the last squads

FPL only publishes a manager's picks after the deadline, and the last fetch before a Saturday deadline is at 06:17 that morning. A podium "from actual squads" is not available in time.

**Proposal.** Project the podium from each manager's *last* squad, label it that way, and freeze it at the deadline with the other predictions. Leagues never mix: one podium per league, stored with that league.

### 2.5 State how the range is worked out

Simulate each player's gameweek many times (goals, assists, clean sheet, bonus, defensive contribution) and show the 10th to 90th percentile, rather than an arbitrary ± around one number.

Defensive contributions need per-gameweek counts to estimate the chance of reaching the threshold. Season totals are not enough, which is another reason for the gameweek archive in 2.1.

## 3. Player model (as agreed, with the changes above)

Expected points = P(plays) × (appearance + xG/90 × goal points by position + xA/90 × 3 + clean-sheet probability × CS points + average bonus + defensive contributions), scaled by the team model's expected goals for that fixture.

- **P(plays):** from `chance_of_playing_next_round` where FPL gives it; otherwise from recent minutes and starts.
- **Per-90 rates:** recent gameweeks blended with the season, with a minimum-minutes floor so small samples do not dominate.

## 4. Open questions (to answer before restarting)

1. **Newsletter or page only?** Recommended: page only for the first three scored gameweeks. Add a short forecast section to the newsletter only once the scorecard shows the model beats the baseline. Unproven numbers in front of 88 managers would break design rule 5.
2. **Data source:** agree the stored `event/live` approach (2.1), with `element-summary` only as the fallback?
3. **Podium:** agree "projected from last week's squads, frozen at the deadline" (2.4)?
4. **First live gameweek:** pick a gameweek with time to merge before its deadline, and test against the previous gameweek's results first.

## 5. Build outline (when restarted)

1. Fetch: add the gameweek archive (2.1) and confirm its fields.
2. `core.js`: team model, player model, simulation for ranges, podium, scorecard, plus tests against past gameweeks.
3. Action: a Node step that freezes `data/forecasts/gwN.json` before the deadline.
4. Task: load the forecast and scorecard into new page documents, each under the 240 KB limit; one podium per league.
5. Page: the Forecast tab (fixtures, top expected points by position, captains, podium, scorecard).
6. Update `ARCHITECTURE.md` and the change log.
