/* FPL League Room: the newsletter as an email you paste in by hand.

   emailNewsletter(figures, columns) -> { html, text }

   Layout only: every figure comes from the newsletter's FIGURES (core.js payloadNewsletter)
   and every word from its written columns. Nothing is calculated here.

   Built for pasting into Outlook (desktop, web), Gmail and phones:
   a 640px layout of plain tables (two columns in the middle section), every style inline, no CSS classes,
   no flex or grid, bgcolor attributes as well as background styles (Outlook desktop
   ignores some CSS), and a system font so it looks the same everywhere.
*/
const EMAIL = (() => {
  const PURPLE = "#37003c", GREEN = "#00ff87", INK = "#1a1a1a", MUTED = "#5a5a5a", LINE = "#d9d9d9", SUNK = "#f3f0f4";
  const FONT = "Arial, Helvetica, sans-serif";
  const W = 640;
  const FPL = "https://fantasy.premierleague.com/";

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rich = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  const plain = (t) => String(t ?? "").replace(/\*\*(.+?)\*\*/g, "$1");
  const td = (inner, st = "", attrs = "") => `<td ${attrs} style="font-family:${FONT};font-size:14px;line-height:1.5;color:${INK};${st}">${inner}</td>`;
  const tbl = (rows, attrs = "") => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;${attrs}">${rows}</table>`;
  const gap = (h = 16) => `<tr><td height="${h}" style="height:${h}px;line-height:${h}px;font-size:1px">&nbsp;</td></tr>`;

  /* A purple bar with a white heading, as in the Word issues */
  const banner = (title) => `<tr>${td(`<b>${esc(title)}</b>`, `background:${PURPLE};color:#ffffff;padding:10px 12px;font-size:15px`, `bgcolor="${PURPLE}"`)}</tr>`;
  const heading = (t) => `<p style="margin:14px 0 6px;font-family:${FONT};font-size:15px;font-weight:bold;color:${PURPLE}">${esc(t)}</p>`;
  const bullets = (list) => list.length
    ? `<ul style="margin:0 0 0 22px;padding:0">${list.map((t) => `<li style="margin:0 0 8px;font-family:${FONT};font-size:14px;line-height:1.5;color:${INK}">${rich(t)}</li>`).join("")}</ul>`
    : "";

  /* A data table: green header row, then rows, numbers centred */
  function dataTable(heads, rows) {
    const th = heads.map((h, i) => td(`<b>${esc(h)}</b>`, `background:${GREEN};padding:7px 10px;font-size:13px;text-align:${i ? "center" : "left"};border-bottom:1px solid ${LINE}`, `bgcolor="${GREEN}"`)).join("");
    const body = rows.length
      ? rows.map((r, n) => `<tr>${r.map((v, i) => td(esc(v), `padding:6px 10px;font-size:13px;text-align:${i ? "center" : "left"};border-bottom:1px solid ${LINE};${n % 2 ? `background:${SUNK};` : ""}`, n % 2 ? `bgcolor="${SUNK}"` : "")).join("")}</tr>`).join("")
      : `<tr>${td("None this week", `padding:6px 10px;font-size:13px;color:${MUTED}`, `colspan="${heads.length}"`)}</tr>`;
    return tbl(`<tr>${th}</tr>${body}`, `border:1px solid ${LINE};`);
  }
  /* Highlights: a centred, underlined label row above each value row */
  function highlightTable(heads, items) {
    const th = heads.map((h, i) => td(`<b>${esc(h)}</b>`, `background:${GREEN};padding:7px 10px;font-size:13px;text-align:${i === heads.length - 1 ? "center" : "left"}`, `bgcolor="${GREEN}"`)).join("");
    const body = items.map(([label, cells]) =>
      `<tr>${td(`<b><u>${esc(label.toUpperCase())}</u></b>`, `padding:9px 10px 2px;font-size:12px;text-align:center;letter-spacing:.03em`, `colspan="${heads.length}"`)}</tr>` +
      `<tr>${cells.map((v, i) => td(esc(v), `padding:2px 10px 8px;font-size:13px;text-align:${i === cells.length - 1 ? "center" : "left"};border-bottom:1px solid ${LINE}`)).join("")}</tr>`).join("");
    return tbl(`<tr>${th}</tr>${body}`, `border:1px solid ${LINE};`);
  }

  /* Two side-by-side cells of a plain table: the one two-column layout that survives a paste into Outlook desktop. */
  const COL = 310, GUT = 20;
  const twoColumns = (left, right) => `<table role="presentation" width="${W}" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%"><tr>` +
    `<td width="${COL}" valign="top" style="width:${COL}px;vertical-align:top">${left}</td>` +
    `<td width="${GUT}" style="width:${GUT}px;font-size:1px;line-height:1px">&nbsp;</td>` +
    `<td width="${COL}" valign="top" style="width:${COL}px;vertical-align:top">${right}</td></tr></table>`;

  function sections(F) {
    const H = F.highlights || {}, P = F.player_highlights || {};
    const managers = [["Manager of the week", H.manager_of_the_week], ["Biggest rise", H.biggest_rise], ["Biggest fall", H.biggest_fall],
      ["Best transfers this week", H.best_transfers_this_week], ["Worst transfers this week", H.worst_transfers_this_week],
      ["Most points on bench this week", H.most_points_on_bench_this_week], ["Most transfers this season", H.most_transfers_this_season],
      ["Best team value", H.best_team_value], ["Best captain picker", H.best_captain_picker], ["Worst captain picker", H.worst_captain_picker]]
      .filter(([, v]) => v).map(([k, v]) => [k, [v.team, v.manager, v.value]]);
    const players = [["Most captained", P.most_captained], ["Most owned", P.most_owned], ["Most transferred in", P.most_transferred_in], ["Most transferred out", P.most_transferred_out]]
      .filter(([, v]) => v).map(([k, v]) => [k, [v.player, v.value]]);
    const tin = (F.transfers_in_top5 || []).map((x) => [x.player, x.club, String(x.count)]);
    const tout = (F.transfers_out_top5 || []).map((x) => [x.player, x.club, String(x.count)]);
    const own = (F.ownership_top10 || []).map((x) => [x.player, x.club, x.share]);
    return { managers, players, tin, tout, own };
  }

  function emailNewsletter(F, Cl) {
    Cl = Cl || {};
    const X = sections(F);
    const box = (inner) => `<tr>${td(inner, `padding:16px 18px;border:1px solid ${LINE};border-top:0`)}</tr>`;
    const provisional = F.final ? "" : `<p style="margin:0 0 10px;font-family:${FONT};font-size:13px;font-style:italic;color:${MUTED}">Provisional: this gameweek's bonus points weren't final when this was written.</p>`;
    const rows = [
      /* masthead */
      `<tr>${td(`<div style="font-family:${FONT};font-size:26px;font-weight:bold;color:#ffffff;line-height:1.2">${esc(F.league)} FPL</div>` +
        `<div style="font-family:${FONT};font-size:26px;font-weight:bold;color:#ffffff;line-height:1.2;margin:2px 0 10px">GAME WEEK ${esc(F.gameweek)}</div>` +
        `<a href="${FPL}" style="font-family:${FONT};font-size:12px;font-weight:bold;color:${GREEN};text-decoration:underline">Fantasy Premier League, Official Fantasy Football Game of the Premier League</a>`,
        `background:${PURPLE};padding:24px 18px 20px;text-align:center`, `bgcolor="${PURPLE}" align="center"`)}</tr>`,
      /* intro and the two columns */
      box(`${provisional}<p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.5;color:${INK}">${rich(Cl.intro || "")}</p>` +
        heading("The Managers Column") + bullets(Cl.managers_column || []) +
        heading("The Transfer & Chip Column") + bullets(Cl.transfer_chip_column || [])),
      gap(20),
      /* the middle section in two columns, as in the Word issues: highlights left, transfers and ownership right */
      `<tr><td>${twoColumns(
        tbl(banner("Manager Highlights") + `<tr><td>${highlightTable(["Team", "Manager", "Pts/#"], X.managers)}</td></tr>` + gap() +
            banner("Player Highlights") + `<tr><td>${highlightTable(["Player", "#"], X.players)}</td></tr>`),
        tbl(banner("Top 5 Transfers IN") + `<tr><td>${dataTable(["Player", "Team", "Transfers In"], X.tin)}</td></tr>` + gap() +
            banner("Top 5 Transfers OUT") + `<tr><td>${dataTable(["Player", "Team", "Transfers Out"], X.tout)}</td></tr>` + gap() +
            banner(`Top 10 Player Ownership (GW${F.gameweek})`) + `<tr><td>${dataTable(["Player", "Team", "Ownership"], X.own)}</td></tr>`))}</td></tr>`,
      gap(20),
      /* players column */
      banner("Players Column"),
      box((Cl.players_column || []).map((t) => `<p style="margin:0 0 10px;font-family:${FONT};font-size:14px;line-height:1.5;color:${INK}">${rich(t)}</p>`).join("")),
      `<tr>${td(`<a href="${FPL}" style="font-family:${FONT};font-size:11px;color:${PURPLE};text-decoration:underline">Fantasy Premier League, Official Fantasy Football Game of the Premier League</a>`, `padding:16px 0 0;text-align:center`, `align="center"`)}</tr>`,
    ].join("");
    /* Outer wrapper: fixed 640px, white, left-aligned so it sits naturally under a greeting typed above it. */
    const html = `<table role="presentation" width="${W}" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="border-collapse:collapse;width:${W}px;max-width:100%;background:#ffffff;font-family:${FONT};color:${INK}">${rows}</table>`;

    /* Plain-text version, for clients that refuse formatting */
    const T = [];
    const line = (s = "") => T.push(s);
    const list = (title, heads, rows) => { line(title.toUpperCase()); rows.length ? rows.forEach((r) => line("  " + r.join(" | "))) : line("  None this week"); line(); };
    line(`${F.league} FPL: Game Week ${F.gameweek}`); line("=".repeat(40)); line();
    if (!F.final) { line("Provisional: bonus points weren't final when this was written."); line(); }
    line(plain(Cl.intro)); line();
    line("THE MANAGERS COLUMN"); (Cl.managers_column || []).forEach((t) => line("- " + plain(t))); line();
    line("THE TRANSFER & CHIP COLUMN"); (Cl.transfer_chip_column || []).forEach((t) => line("- " + plain(t))); line();
    line("MANAGER HIGHLIGHTS"); X.managers.forEach(([k, c]) => line(`  ${k}: ${c[0]} (${c[1]}), ${c[2]}`)); line();
    line("PLAYER HIGHLIGHTS"); X.players.forEach(([k, c]) => line(`  ${k}: ${c[0]}, ${c[1]}`)); line();
    list("Top 5 transfers in", [], X.tin);
    list("Top 5 transfers out", [], X.tout);
    list(`Top 10 player ownership (GW${F.gameweek})`, [], X.own);
    line("PLAYERS COLUMN"); (Cl.players_column || []).forEach((t) => { line(plain(t)); line(); });
    line(FPL);
    return { html, text: T.join("\n") };
  }
  return { emailNewsletter };
})();
const emailNewsletter = EMAIL.emailNewsletter;
if (typeof module !== "undefined") module.exports = { emailNewsletter };
