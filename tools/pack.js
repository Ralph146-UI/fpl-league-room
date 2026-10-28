#!/usr/bin/env node
/* Packs a finished newsletter into one JSON document for the League Room page.

   node tools/pack.js figures.json columns.json newsletter.docx check.txt out.json
*/
const fs = require("fs");
const [fig, col, docx, check, out] = process.argv.slice(2);
const F = JSON.parse(fs.readFileSync(fig, "utf8"));
const doc = {
  gw: F.gameweek,
  league: F.league,
  written: new Date().toISOString(),
  figures: fs.readFileSync(fig, "utf8"),
  columns: fs.readFileSync(col, "utf8"),
  docx_b64: fs.readFileSync(docx).toString("base64"),
  check: fs.existsSync(check) ? fs.readFileSync(check, "utf8").trim() : "",
};
const size = JSON.stringify(doc).length;
if (size > 250000) { console.error(`Too big to store (${size >> 10} KB).`); process.exit(1); }
fs.writeFileSync(out, JSON.stringify(doc));
console.log(`Wrote ${out} (${size >> 10} KB)`);
