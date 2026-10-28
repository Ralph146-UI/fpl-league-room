# Scheduled task: "FPL League Room refresh"

Version 1.0, 28 October 2026. Task id `trig_016FNgx9PT5WW6cE9eZQgXSx`, daily at 07:43 Europe/London, runs in the cloud with automatic approval and push notifications.

To restore it, create a scheduled task with the schedule above and paste the prompt below exactly.

---

Refresh the user's FPL League Room page from their GitHub repo and, when a gameweek has just finished, write the weekly banter report and build the weekly Word newsletter for the main league. Work quietly: if there is nothing new, end with no message to the user.

Page (published artifact): https://claude.ai/artifact/9qRQFge74rDATu7jrbkEiw
Repo (private): https://github.com/Ralph146-UI/fpl-league-room
All database writes go to the page with the ArtifactData tool, in the user's private area: collection "data/users/me". Every write to a document that already exists needs if_version from your most recent get of it; omit if_version only when creating.

The repo tracks more than one league. settings.json "league_id" is the MAIN league: its data is data/fpl_bundle.json and it is the only league that gets the report and newsletter. Leagues in "other_leagues" have data/fpl_bundle_<id>.json and appear on the page only. Never mix data between leagues.

1. Get the data. Call the add_repo tool (owner Ralph146-UI, repo fpl-league-room, access push), then clone with the command it gives, into a folder called repo. If add_repo or the clone fails, send the user one short message ("Today's FPL refresh couldn't read your GitHub repo: <reason>. Check Claude still has access to fpl-league-room at https://github.com/settings/installations.") and stop. If repo/data/fpl_bundle.json does not exist, stop with no message.
2. Run: node repo/tools/payload.js info repo/data/fpl_bundle.json
   It prints league, gw, final, fetched for the main league. Remember them.
3. Stale data check. ArtifactData get collection "data/users/me", doc_id "status". If "fetched" is more than 48 hours before now and the status doc's "stale_alert_for" is not equal to that fetched value: send the user one short message ("The FPL fetch on GitHub hasn't produced new data since <date>. Check the Actions tab at https://github.com/Ralph146-UI/fpl-league-room/actions — the FPL site sometimes refuses GitHub's servers.") and set the status doc's stale_alert_for to that fetched value (update or create). Then stop.
4. Load the main league's page data. ArtifactData get "data/users/me" doc "league". If it exists and its "fetched" equals the bundle's fetched, skip to step 4b. Otherwise run: node repo/tools/payload.js split repo/data/fpl_bundle.json split
   then one ArtifactData batch with two "set" writes: collection "data/users/me", doc_id "players", file_path split/players.json; and doc_id "league", file_path split/league.json. Include if_version for each doc that already exists (get "players" too if you need its version).
4b. Load the league list and the other leagues. Run: node repo/tools/payload.js leagues repo lg
   It writes lg/leagues.json and lg/league_<id>.json for each other league. Get docs "leagues" and each "league_<id>" from "data/users/me"; then in one ArtifactData batch, "set" doc "leagues" from lg/leagues.json if its content differs, and "set" each "league_<id>" from lg/league_<id>.json whose "fetched" differs from the stored one (if_version for docs that exist). If repo/data/fetch_status.json shows an other league failing with "not found", mention it once in step 8's message if there is one.
5. If the main bundle's "final" is false, stop here with no message. Read repo/settings.json.

6. Weekly report for the main league (skip to step 7 if report.enabled is false, or ArtifactData doc "report" exists with "gw" greater than or equal to the bundle's gw).
   - Run: node repo/tools/payload.js weekly repo/data/fpl_bundle.json weekly.json   and read weekly.json. This is the DATA.
   - Read repo/personas/rules.md and repo/personas/<report.voice>.md (voice is banter, pundit, manager or plain; default banter). Adopt the persona completely. Lines in the persona starting "FAVOURITE:" apply only if report.running_joke_about names a manager; otherwise ignore them. The manager voice must not invent anything about real people.
   - Task: the weekly report for the league, gameweek gw. Cover in this order: the podium (top three scores, flag chips and hits); the table (top three, biggest climber and faller); decisions (best and worst transfer, biggest bench, busiest manager); chips and what they bought; differentials (anyone who won on a player nobody else started); sign off with the league average against the global average. Skip any part whose data is null or empty. Under 380 words. No tables, no markdown headings.
   - Formatting by report.going_to: whatsapp = plain text with *single asterisks* for bold; teams = **double asterisks** for bold section names; me = plain text.
   - Follow every rule in rules.md. Use only numbers from the DATA.
   - Save the report text to report.txt and run: node repo/tools/payload.js check weekly.json report.txt
     For every unmatched number, check it against the DATA. Fix any that are wrong and re-run the check. A number that is a correct sum or difference of DATA values may stay.
   - Set check to "All N numbers match the data." when unmatched is empty, otherwise "Check before posting: <numbers> are worked out from the data, not quoted from it."
   - ArtifactData set "data/users/me" doc "report" (if_version if it existed) with data: {"gw": <gw>, "league": <league>, "written": <current ISO time>, "voice": <voice>, "text": <report text>, "check": <check>}.

7. Newsletter for the main league (skip to step 8 if settings newsletter.enabled is false, or ArtifactData doc "newsletter" exists with "gw" greater than or equal to the bundle's gw).
   - Run: node repo/tools/payload.js newsletter repo/data/fpl_bundle.json figures.json   and read figures.json. These are the FIGURES.
   - Read repo/personas/newsletter.md and follow it exactly: write the four columns in that voice, using only FIGURES, and save them as columns.json in the JSON shape it gives.
   - Run: node repo/tools/payload.js check figures.json columns.json
     For every unmatched number, check it against FIGURES; fix anything wrong and re-run. Write the check line to check.txt in the same form as step 6.
   - Build the Word file: node repo/tools/newsletter.js figures.json columns.json repo/data/newsletters/GW<gw>_FPL_Newsletter.docx
     If it says the docx package is missing, run (cd repo && npm install docx --no-save --silent) and build again.
   - Look at it once: convert it to PDF with LibreOffice (soffice --headless --convert-to pdf) and view the pages. If anything is clearly broken (empty sections, text overflowing a table), fix columns.json and rebuild once.
   - Run: node repo/tools/pack.js figures.json columns.json repo/data/newsletters/GW<gw>_FPL_Newsletter.docx check.txt newsletter.json
     then ArtifactData set "data/users/me" doc "newsletter" with file_path newsletter.json (if_version if it existed).
   - Save it to the repo: cd repo, git add data/newsletters, commit "Newsletter GW<gw>", git pull --rebase, git push. If the push fails, carry on; the page still has the file.

8. Tell the user, only if step 6 or step 7 produced something new this run. One message:
   - First line: "GW<gw> is done." Then, if a newsletter was built: "The newsletter is ready on your League Room page (Newsletter tab) and in your repo under data/newsletters." plus its check line if it flagged anything.
   - If a report was written: a blank line, then "Banter report, ready to paste:" and the report text exactly as written.
   If you can send files to the user in this session, also send the newsletter .docx.
