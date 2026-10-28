#!/usr/bin/env node
/* Helpers for the scheduled Claude task. Uses the same logic as the page.

   node tools/payload.js info    data/fpl_bundle.json            -> {gw, final, fetched, league}
   node tools/payload.js weekly  data/fpl_bundle.json  out.json  -> the weekly report data
   node tools/payload.js split   data/fpl_bundle.json  outdir    -> league.json + players.json, ready to store
   node tools/payload.js check   out.json  report.txt            -> numbers in the report that aren't in the data
   node tools/payload.js leagues repo      outdir                -> leagues.json (the page's league list) and league_<id>.json for each extra league
*/
const fs = require("fs");
const path = require("path");
const C = require("./core.js");

const [cmd, a, b] = process.argv.slice(2);
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

if (cmd === "info") {
  const B = read(a);
  const bad = C.validateBundle(B);
  if (bad) { console.error(bad); process.exit(1); }
  const e = B.events.find((x) => x.id === B.gw) || {};
  console.log(JSON.stringify({ league: B.league.name, gw: B.gw, final: !!e.checked, fetched: B.fetched, managers: B.managers.length }));
} else if (cmd === "weekly") {
  const S = C.build(read(a));
  fs.writeFileSync(b, JSON.stringify(C.payloadWeekly(S)));
  console.log("Wrote " + b);
} else if (cmd === "newsletter") {
  const S = C.build(read(a));
  fs.writeFileSync(b, JSON.stringify(C.payloadNewsletter(S), null, 1));
  console.log("Wrote " + b);
} else if (cmd === "split") {
  const B = read(a);
  const { elements, teams, fixtures, events, ...rest } = B;
  const players = JSON.stringify({ elements, teams, fixtures, events });
  const league = JSON.stringify(rest);
  if (players.length > 240000 || league.length > 240000) { console.error("Too big for one stored document."); process.exit(1); }
  fs.mkdirSync(b, { recursive: true });
  fs.writeFileSync(path.join(b, "players.json"), JSON.stringify({ fetched: B.fetched, json: players }));
  fs.writeFileSync(path.join(b, "league.json"), JSON.stringify({ fetched: B.fetched, json: league }));
  console.log(`Wrote ${b}/players.json (${players.length >> 10} KB) and ${b}/league.json (${league.length >> 10} KB)`);
} else if (cmd === "leagues") {
  /* Every league in settings.json: the main one first. Extra leagues share the main league's player data, so only their league part is stored. */
  const settings = read(path.join(a, "settings.json"));
  const ids = [settings.league_id, ...(settings.other_leagues || []).filter((x) => x !== settings.league_id)];
  fs.mkdirSync(b, { recursive: true });
  const list = [];
  ids.forEach((id, i) => {
    const file = path.join(a, "data", i === 0 ? "fpl_bundle.json" : `fpl_bundle_${id}.json`);
    if (!fs.existsSync(file)) return;
    const B = read(file);
    if (C.validateBundle(B)) return;
    list.push({ id: B.league.id, name: B.league.name, managers: B.managers.length, primary: i === 0, fetched: B.fetched });
    if (i > 0) {
      const { elements, teams, fixtures, events, ...rest } = B;
      const league = JSON.stringify(rest);
      if (league.length > 240000) { console.error(`League ${id} is too big to store.`); return; }
      fs.writeFileSync(path.join(b, `league_${B.league.id}.json`), JSON.stringify({ fetched: B.fetched, json: league }));
    }
  });
  fs.writeFileSync(path.join(b, "leagues.json"), JSON.stringify({ list }));
  console.log(JSON.stringify(list));
} else if (cmd === "check") {
  const r = C.numberCheck(fs.readFileSync(b, "utf8"), read(a));
  console.log(JSON.stringify(r));
} else {
  console.error("Usage: node tools/payload.js info|weekly|split|check ...");
  process.exit(2);
}
