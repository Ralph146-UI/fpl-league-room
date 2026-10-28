#!/usr/bin/env node
/* Builds the weekly newsletter as a Word file, in the layout of the hand-made issues.

   node tools/newsletter.js figures.json columns.json out.docx

   figures.json  from: node tools/payload.js newsletter data/fpl_bundle.json figures.json
   columns.json  the written columns:
     { "intro": "…", "managers_column": ["…", …], "transfer_chip_column": ["…", …], "players_column": ["…", …] }
*/
const fs = require("fs");
let D;
try { D = require("docx"); } catch (e) {
  console.error("The docx package is missing. Run: npm install docx");
  process.exit(1);
}
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType,
  BorderStyle, ExternalHyperlink, LevelFormat, VerticalAlign, TableLayoutType,
} = D;

const [figPath, colPath, outPath] = process.argv.slice(2);
if (!figPath || !colPath || !outPath) { console.error("Usage: node tools/newsletter.js figures.json columns.json out.docx"); process.exit(2); }
const F = JSON.parse(fs.readFileSync(figPath, "utf8"));
const C = JSON.parse(fs.readFileSync(colPath, "utf8"));

const PURPLE = "37003C", GREEN = "00FF87", GREY = "F5F5F5", WHITE = "FFFFFF", FONT = "Aptos";
const PAGE_W = 9026; /* A4 less 1-inch margins, in twentieths of a point */
const LEFT_W = 4700, GAP_W = 226, RIGHT_W = PAGE_W - LEFT_W - GAP_W;
const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
const line = (c = PURPLE, s = 8) => ({ style: BorderStyle.SINGLE, size: s, color: c });
const boxBorders = { top: line(), bottom: line(), left: line(), right: line() };

const run = (text, o = {}) => new TextRun({ text: String(text ?? ""), font: FONT, size: o.size || 21, bold: o.bold, color: o.color, underline: o.underline ? {} : undefined, italics: o.italics });
const para = (children, o = {}) => new Paragraph({ children: Array.isArray(children) ? children : [children], alignment: o.align, spacing: { before: o.before ?? 0, after: o.after ?? 120, line: o.line }, numbering: o.bullet ? { reference: "dash", level: 0 } : undefined, keepNext: o.keepNext });

/* **bold** inside written text becomes a bold run */
function rich(text, size = 21) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((p) => (p.startsWith("**") ? run(p.slice(2, -2), { bold: true, size }) : run(p, { size })));
}

function cell(children, o = {}) {
  return new TableCell({
    children: Array.isArray(children) ? children : [children],
    width: { size: o.w, type: WidthType.DXA },
    columnSpan: o.span,
    shading: o.fill ? { type: ShadingType.CLEAR, color: "auto", fill: o.fill } : undefined,
    borders: o.borders || { top: none, bottom: none, left: none, right: none },
    margins: o.margins || { top: 60, bottom: 60, left: 100, right: 100 },
    verticalAlign: o.valign || VerticalAlign.CENTER,
  });
}

function table(widths, rows, o = {}) {
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: o.borders || noBorders,
    rows,
  });
}

/* A purple block with a white heading, as used above each side table */
function banner(text, w) {
  return table([w], [new TableRow({ children: [cell(para(run(text, { bold: true, color: WHITE, size: 24 }), { after: 0 }), { w, fill: PURPLE, margins: { top: 160, bottom: 160, left: 160, right: 160 } })] })]);
}

const small = 16;
function headRow(labels, widths) {
  return new TableRow({ tableHeader: true, children: labels.map((l, i) => cell(para(run(l, { bold: true, size: small }), { after: 0, align: i ? AlignmentType.CENTER : AlignmentType.LEFT }), { w: widths[i], fill: GREEN })) });
}
function dataRow(vals, widths, fill) {
  return new TableRow({ cantSplit: true, children: vals.map((v, i) => cell(para(run(v, { size: small }), { after: 0, align: i ? AlignmentType.CENTER : AlignmentType.LEFT }), { w: widths[i], fill })) });
}
function sectionRow(label, widths) {
  return new TableRow({ cantSplit: true, children: [cell(para(run(label, { bold: true, underline: true, size: small }), { after: 0, align: AlignmentType.CENTER, before: 60 }), { w: widths.reduce((a, b) => a + b, 0), span: widths.length })] });
}

function listTable(title, labels, rows, w) {
  const widths = [Math.round(w * 0.42), Math.round(w * 0.22)]; widths.push(w - widths[0] - widths[1]);
  const body = rows.length ? rows.map((r, i) => dataRow(r, widths, i % 2 ? GREY : WHITE)) : [dataRow(["None this week", "", ""], widths, WHITE)];
  return [banner(title, w), table(widths, [headRow(labels, widths), ...body], { borders: { ...noBorders, bottom: line(PURPLE, 6) } }), para(run(""), { after: 160 })];
}

/* ---------------------------------------------------------- sections */

const H = F.highlights || {};
const managerHl = [
  ["MANAGER OF THE WEEK", H.manager_of_the_week], ["BIGGEST RISE", H.biggest_rise], ["BIGGEST FALL", H.biggest_fall],
  ["BEST TRANSFERS THIS WEEK", H.best_transfers_this_week], ["WORST TRANSFERS THIS WEEK", H.worst_transfers_this_week],
  ["MOST POINTS ON BENCH THIS WEEK", H.most_points_on_bench_this_week], ["MOST TRANSFERS THIS SEASON", H.most_transfers_this_season],
  ["BEST TEAM VALUE", H.best_team_value], ["BEST CAPTAIN PICKER", H.best_captain_picker], ["WORST CAPTAIN PICKER", H.worst_captain_picker],
].filter(([, v]) => v);
const mw = [Math.round(LEFT_W * 0.4), Math.round(LEFT_W * 0.36)]; mw.push(LEFT_W - mw[0] - mw[1]);
const managerTable = table(mw, [headRow(["Team", "Manager", "Pts/#"], mw), ...managerHl.flatMap(([k, v]) => [sectionRow(k, mw), dataRow([v.team, v.manager, v.value], mw, WHITE)])],
  { borders: { ...noBorders, bottom: line(PURPLE, 6) } });

const P = F.player_highlights || {};
const playerHl = [["MOST CAPTAINED", P.most_captained], ["MOST OWNED", P.most_owned], ["MOST TRANSFERRED IN", P.most_transferred_in], ["MOST TRANSFERRED OUT", P.most_transferred_out]].filter(([, v]) => v);
const pw = [Math.round(LEFT_W * 0.55)]; pw.push(LEFT_W - pw[0]);
const playerTable = table(pw, [headRow(["Player", "#"], pw), ...playerHl.flatMap(([k, v]) => [sectionRow(k, pw), dataRow([v.player, v.value], pw, WHITE)])],
  { borders: { ...noBorders, bottom: line(PURPLE, 6) } });

const left = [banner("Manager Highlights", LEFT_W), managerTable, para(run(""), { after: 200 }), banner("Player Highlights", LEFT_W), playerTable];
const right = [
  ...listTable("Top 5 Transfers IN", ["Player", "Team", "Transfers In"], (F.transfers_in_top5 || []).map((x) => [x.player, x.club, String(x.count)]), RIGHT_W),
  ...listTable("Top 5 Transfers OUT", ["Player", "Team", "Transfers Out"], (F.transfers_out_top5 || []).map((x) => [x.player, x.club, String(x.count)]), RIGHT_W),
  ...listTable(`Top 10 Player Ownership (GW${F.gameweek})`, ["Player", "Team", "Ownership"], (F.ownership_top10 || []).map((x) => [x.player, x.club, x.share]), RIGHT_W),
];

const header = table([PAGE_W], [new TableRow({ children: [cell([
  para(run(`${F.league} FPL`, { bold: true, color: WHITE, size: 36 }), { align: AlignmentType.CENTER, after: 40 }),
  para(run(`GAME WEEK ${F.gameweek}`, { bold: true, color: WHITE, size: 36 }), { align: AlignmentType.CENTER, after: 160 }),
  para(new ExternalHyperlink({ link: "https://fantasy.premierleague.com/", children: [run("Fantasy Premier League, Official Fantasy Football Game of the Premier League", { size: 18, bold: true, color: GREEN, underline: true })] }), { align: AlignmentType.CENTER, after: 0 }),
], { w: PAGE_W, fill: PURPLE, margins: { top: 360, bottom: 280, left: 240, right: 240 } })] })]);

const bullets = (arr) => (arr || []).filter((t) => String(t).trim()).map((t) => para(rich(t), { bullet: true, after: 100 }));
const columns = table([PAGE_W], [new TableRow({ children: [cell([
  ...(F.final ? [] : [para(run("Provisional: this gameweek's bonus points weren't final when this was written.", { italics: true, size: 18 }), { after: 120 })]),
  para(rich(C.intro || ""), { after: 200 }),
  para(run("The Managers Column", { bold: true }), { after: 100, keepNext: true }),
  ...bullets(C.managers_column),
  para(run("The Transfer & Chip Column", { bold: true }), { before: 120, after: 100, keepNext: true }),
  ...bullets(C.transfer_chip_column),
], { w: PAGE_W, borders: boxBorders, margins: { top: 240, bottom: 200, left: 240, right: 240 }, valign: VerticalAlign.TOP })] })]);

const sideBySide = table([LEFT_W, GAP_W, RIGHT_W], [new TableRow({ children: [
  cell(left, { w: LEFT_W, margins: { top: 0, bottom: 0, left: 0, right: 0 }, valign: VerticalAlign.TOP }),
  cell(para(run("")), { w: GAP_W, margins: { top: 0, bottom: 0, left: 0, right: 0 } }),
  cell(right, { w: RIGHT_W, margins: { top: 0, bottom: 0, left: 0, right: 0 }, valign: VerticalAlign.TOP }),
] })]);

const players = table([PAGE_W], [new TableRow({ children: [cell([
  para(run("Players Column", { bold: true }), { after: 140 }),
  ...(C.players_column || []).filter((t) => String(t).trim()).map((t) => para(rich(t), { after: 140 })),
], { w: PAGE_W, borders: boxBorders, margins: { top: 240, bottom: 160, left: 240, right: 240 }, valign: VerticalAlign.TOP })] })]);

const footer = para(new ExternalHyperlink({ link: "https://fantasy.premierleague.com/", children: [run("Fantasy Premier League, Official Fantasy Football Game of the Premier League", { size: 16, color: PURPLE, underline: true })] }), { align: AlignmentType.CENTER, before: 200 });

const doc = new Document({
  creator: "FPL League Room",
  title: `${F.league} FPL — Game Week ${F.gameweek}`,
  styles: { default: { document: { run: { font: FONT, size: 21 } } } },
  numbering: { config: [{ reference: "dash", levels: [{ level: 0, format: LevelFormat.BULLET, text: "-", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 280 } } } }] }] },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    children: [header, columns, para(run(""), { after: 200 }), sideBySide, para(run(""), { after: 200 }), players, footer],
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  /* Route every run through the theme's body font, set to Aptos, so Word shows "Aptos (Body)". */
  require("child_process").execFileSync("python3", [require("path").join(__dirname, "theme_font.py"), outPath], { stdio: "inherit" });
  console.log(`Wrote ${outPath} (${fs.statSync(outPath).size >> 10} KB)`);
});
