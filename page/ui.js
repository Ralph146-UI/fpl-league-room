/* FPL League Room: page wiring. Reads everything from core.js. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const short = (n) => n.split(" ").slice(-1)[0];
const signed = (n) => (n > 0 ? "+" + n : n < 0 ? "−" + Math.abs(n) : "0");
const NS = "http://www.w3.org/2000/svg";
const el = (t, a = {}, p) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
const txt = (p, x, y, s, a = {}) => { const t = el("text", { x, y, ...a }, p); t.textContent = s; return t; };

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
let PREF = {};
try { PREF = JSON.parse(store.get("flr-prefs") || "{}") || {}; } catch (e) { PREF = {}; }
const savePrefs = () => store.set("flr-prefs", JSON.stringify(PREF));

let B = null, S = null, CAP = {}, UID = null;
/* Leagues: the main one (with the report and newsletter) and any others. Each keeps its own data and its own "you". */
let LEAGUES = [], PLAYERS = null, REPORT = null, NEWS = null;
const leagueKey = () => String((B && B.league && B.league.id) || "demo");
const isMain = () => !LEAGUES.length || (LEAGUES.find((l) => l.primary) || {}).id === (B && B.league.id);
let span = { a: 1, b: 1 };
let sortK = "rank", sortDir = 1;
let adv = { who: null, h: PREF.h || 5, ft: null };
let writer = { kind: "weekly", ctl: null, lastText: "" };

/* ------------------------------------------------------------ data */

function setBundle(b, { save } = {}) {
  B = b; S = build(b);
  const names = S.M.map((m) => m.name);
  PREF.meBy = PREF.meBy || {}; PREF.favBy = PREF.favBy || {};
  if (PREF.me && !Object.keys(PREF.meBy).length && !b.demo) PREF.meBy[leagueKey()] = PREF.me; /* older single-league setting */
  PREF.me = PREF.meBy[leagueKey()] || ""; PREF.fav = PREF.favBy[leagueKey()] || "";
  if (PREF.me && !names.includes(PREF.me)) PREF.me = "";
  if (PREF.fav && !names.includes(PREF.fav)) PREF.fav = "";
  document.body.classList.toggle("alt-league", !isMain());
  span = { a: S.first, b: S.gw };
  adv = { who: PREF.me || (tableAt(S, S.gw)[0] || {}).m?.name, h: PREF.h || 5, ft: null };
  if (save) persist(b);
  renderAll();
}

function splitBundle(b) {
  const { elements, teams, fixtures, events, ...rest } = b;
  return { players: { elements, teams, fixtures, events }, league: rest };
}

async function persist(b) {
  const local = store.set("flr-bundle", JSON.stringify(b));
  let remote = false, tooBig = false;
  if (CAP.db && UID) {
    const { players, league } = splitBundle(b);
    const pj = JSON.stringify(players), lj = JSON.stringify(league);
    if (pj.length < 240000 && lj.length < 240000) {
      try {
        await CAP.db.doc(`data/users/${UID}/players`).set({ fetched: b.fetched, json: pj });
        await CAP.db.doc(`data/users/${UID}/league`).set({ fetched: b.fetched, json: lj });
        remote = true;
      } catch (e) { remote = false; }
    } else tooBig = true;
  }
  const where = remote ? "Saved to your account, so it opens on your other devices too."
    : tooBig ? "Saved in this browser only: the league is too big to save to your account."
    : local ? "Saved in this browser only." : "Not saved: this browser blocks storage, so load it again next time.";
  return where;
}

async function initCaps() {
  const c = window.claude;
  if (!c || typeof c.use !== "function") { writerOff("Write-ups need the page to be open in Claude."); return; }
  const get = (n) => c.use(n).catch(() => null);
  const [db, user, sample, downloads] = await Promise.all([get("db"), get("user"), get("sample"), get("downloads")]);
  CAP = { db, user, sample, downloads };
  if (downloads) $("#dl-script").hidden = false;
  if (!sample) writerOff("Write-ups aren't available in this view.");
  if (db && user) {
    try {
      UID = await user.id();
      if (UID) {
        const [l, p, idx] = await Promise.all([db.doc(`data/users/${UID}/league`).get(), db.doc(`data/users/${UID}/players`).get(), db.doc(`data/users/${UID}/leagues`).get()]);
        if (p.exists) PLAYERS = JSON.parse(p.data().json);
        if (idx.exists && Array.isArray(idx.data().list)) LEAGUES = idx.data().list;
        const want = PREF.league && LEAGUES.some((x) => String(x.id) === String(PREF.league) && !x.primary) ? PREF.league : null;
        if (want) await switchLeague(want);
        else if (l.exists && PLAYERS) {
          const merged = { ...PLAYERS, ...JSON.parse(l.data().json) };
          if (!validateBundle(merged) && (B.demo || String(merged.fetched) > String(B.fetched) || String(merged.league.id) !== leagueKey())) {
            setBundle(merged);
            store.set("flr-bundle", JSON.stringify(merged));
          }
        }
        const [r, n] = await Promise.all([db.doc(`data/users/${UID}/report`).get(), db.doc(`data/users/${UID}/newsletter`).get()]);
        if (r.exists) REPORT = r.data();
        if (n.exists) NEWS = n.data();
        showMainOnly();
        renderBoard();
      }
    } catch (e) { /* account storage unavailable: the browser copy still works */ }
  }
  loadedInfo();
}

/* Move to another league: its own data, its own "you", and a different accent so it is never mistaken for the main one. */
async function switchLeague(id) {
  const L = LEAGUES.find((x) => String(x.id) === String(id));
  if (!L || !CAP.db || !UID || !PLAYERS) return;
  const msg = $("#lg-msg");
  try {
    const d = await CAP.db.doc(`data/users/${UID}/${L.primary ? "league" : "league_" + L.id}`).get();
    if (!d.exists) { if (msg) msg.textContent = `No data for ${L.name} yet.`; return; }
    const merged = { ...PLAYERS, ...JSON.parse(d.data().json) };
    if (validateBundle(merged)) return;
    PREF.league = L.primary ? "" : String(L.id); savePrefs();
    setBundle(merged);
    if (L.primary) store.set("flr-bundle", JSON.stringify(merged));
    showMainOnly();
  } catch (e) { if (msg) msg.textContent = "Couldn't load that league. Try again."; }
}

/* The weekly report and newsletter belong to the main league; other leagues say so instead of showing them. */
function showMainOnly() {
  const main = LEAGUES.find((x) => x.primary);
  const note = !isMain() && main ? `The weekly report and newsletter are written for ${main.name}. Switch to it in the bar at the top to see them.` : "";
  $("#auto-wrap").hidden = true;
  if (isMain()) { if (REPORT) showAutoReport(REPORT); if (NEWS) showNewsletter(NEWS); else { $("#nl-body").innerHTML = `<p class="muted">No newsletter yet. The first one appears here after the daily task has run for a finished gameweek.</p>`; } }
  else { $("#nl-body").innerHTML = `<p class="muted">${esc(note)}</p>`; $("#nl-save").hidden = true; }
}

/* The report the scheduled task writes each gameweek, kept in the account. */
function showAutoReport(r) {
  if (!r || typeof r.text !== "string" || !r.text.trim()) return;
  $("#auto-wrap").hidden = false;
  $("#auto-title").textContent = `Gameweek ${r.gw} report`;
  $("#auto-sub").textContent = `Written automatically ${r.written ? fmtDate(r.written) : ""}${r.voice ? ` in the ${r.voice} voice` : ""}. Write a different one below.`;
  $("#auto-label").textContent = `${r.league || ""} · GW${r.gw}`;
  $("#auto-text").textContent = r.text;
  const c = $("#auto-check");
  if (typeof r.check === "string" && r.check) { c.hidden = false; c.className = "check " + (/match/i.test(r.check) && !/check before/i.test(r.check) ? "ok" : "flag"); c.textContent = r.check; }
  $("#auto-copy").onclick = (e) => copyText(r.text, e.currentTarget);
}

/* The newsletter the scheduled task builds: figures, written columns and the Word file. */
function showNewsletter(n) {
  let F, Cl;
  try { F = JSON.parse(n.figures); Cl = JSON.parse(n.columns); } catch (e) { return; }
  const rows = (list, cols) => list.map((r, i) => `<tr>${cols.map((c, j) => `<td class="${j ? "num" : "l"}"${i % 2 ? ' style="background:var(--sunk)"' : ""}>${esc(r[c])}</td>`).join("")}</tr>`).join("");
  const lt = (title, list, head) => `<div class="nl-t"><div class="ban">${esc(title)}</div><div class="tablewrap" style="border-radius:0 0 6px 6px"><table><thead><tr><th class="l">Player</th><th>Team</th><th>${esc(head)}</th></tr></thead><tbody>${list.length ? rows(list, ["player", "club", head === "Ownership" ? "share" : "count"]) : `<tr><td class="l muted" colspan="3">None this week</td></tr>`}</tbody></table></div></div>`;
  const H = F.highlights || {};
  const hl = [["Manager of the week", H.manager_of_the_week], ["Biggest rise", H.biggest_rise], ["Biggest fall", H.biggest_fall], ["Best transfers this week", H.best_transfers_this_week],
    ["Worst transfers this week", H.worst_transfers_this_week], ["Most points on bench this week", H.most_points_on_bench_this_week], ["Most transfers this season", H.most_transfers_this_season],
    ["Best team value", H.best_team_value], ["Best captain picker", H.best_captain_picker], ["Worst captain picker", H.worst_captain_picker]].filter(([, v]) => v);
  const P = F.player_highlights || {};
  const ph = [["Most captained", P.most_captained], ["Most owned", P.most_owned], ["Most transferred in", P.most_transferred_in], ["Most transferred out", P.most_transferred_out]].filter(([, v]) => v);
  const rich = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  $("#nl-body").innerHTML = `<div class="nl">
    <div><div class="nl-head"><b>${esc(F.league)} FPL</b><b>Game week ${F.gameweek}</b><span>Fantasy Premier League</span></div>
    <div class="nl-box">${F.final ? "" : `<p class="muted"><i>Provisional: bonus points weren't final when this was written.</i></p>`}<p>${rich(Cl.intro || "")}</p>
      <h3>The Managers Column</h3><ul>${(Cl.managers_column || []).map((t) => `<li>${rich(t)}</li>`).join("")}</ul>
      <h3>The Transfer &amp; Chip Column</h3><ul>${(Cl.transfer_chip_column || []).map((t) => `<li>${rich(t)}</li>`).join("")}</ul></div></div>
    <div class="nl-grid">
      <div class="nl-col">
        <div class="nl-t"><div class="ban">Manager Highlights</div><div class="tablewrap" style="border-radius:0 0 6px 6px"><table><thead><tr><th class="l">Team</th><th class="l">Manager</th><th>Pts/#</th></tr></thead><tbody>
          ${hl.map(([k, v]) => `<tr><td class="sec" colspan="3">${esc(k.toUpperCase())}</td></tr><tr class="after"><td class="l">${esc(v.team)}</td><td class="l">${esc(v.manager)}</td><td class="num">${esc(v.value)}</td></tr>`).join("")}</tbody></table></div></div>
        <div class="nl-t"><div class="ban">Player Highlights</div><div class="tablewrap" style="border-radius:0 0 6px 6px"><table><thead><tr><th class="l">Player</th><th>#</th></tr></thead><tbody>
          ${ph.map(([k, v]) => `<tr><td class="sec" colspan="2">${esc(k.toUpperCase())}</td></tr><tr class="after"><td class="l">${esc(v.player)}</td><td class="num">${esc(v.value)}</td></tr>`).join("")}</tbody></table></div></div>
      </div>
      <div class="nl-col">${lt("Top 5 Transfers IN", F.transfers_in_top5 || [], "Transfers In")}${lt("Top 5 Transfers OUT", F.transfers_out_top5 || [], "Transfers Out")}${lt(`Top 10 Player Ownership (GW${F.gameweek})`, F.ownership_top10 || [], "Ownership")}</div>
    </div>
    <div class="nl-box solo"><h3 style="margin-top:0">Players Column</h3>${(Cl.players_column || []).map((t) => `<p>${rich(t)}</p>`).join("")}</div>
    ${n.check ? `<p class="check ${/match/i.test(n.check) && !/check before/i.test(n.check) ? "ok" : "flag"}" style="padding:0">${esc(n.check)}</p>` : ""}
  </div>`;
  const btn = $("#nl-save");
  if (CAP.downloads && n.docx_b64) {
    btn.hidden = false;
    btn.onclick = async () => {
      const bin = atob(n.docx_b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const msg = $("#nl-msg");
      try { await CAP.downloads.save({ filename: `GW${F.gameweek}_FPL_Newsletter.docx`, data: bytes }); msg.className = "msg ok"; msg.textContent = "Saved."; }
      catch (e) { msg.className = "msg"; msg.textContent = e && e.code === "declined" ? "" : "Couldn't save it here. The Word file is also in your GitHub repo under data/newsletters."; }
    };
  }
}

function loadFile(file) {
  const msg = $("#load-msg");
  msg.className = "msg"; msg.textContent = "Reading " + file.name + "…";
  const r = new FileReader();
  r.onload = async () => {
    let b;
    try { b = JSON.parse(r.result); } catch (e) { msg.className = "msg err"; msg.textContent = "That file isn't valid JSON. Run fpl_fetch.py again and drop the new fpl_bundle.json."; return; }
    const bad = validateBundle(b);
    if (bad) { msg.className = "msg err"; msg.textContent = bad; return; }
    setBundle(b);
    const where = await persist(b);
    msg.className = "msg ok";
    msg.textContent = `Loaded ${b.league.name}, gameweek ${b.gw}, ${b.managers.length} managers. ${where}`;
    loadedInfo();
  };
  r.onerror = () => { msg.className = "msg err"; msg.textContent = "Couldn't read that file. Try choosing it again."; };
  r.readAsText(file);
}

function loadedInfo() {
  const e = S.ev.get(S.gw) || {};
  const when = B.demo ? "" : ` Fetched ${fmtDate(B.fetched)}.`;
  $("#loaded-info").textContent = B.demo
    ? "The example league is showing. Nothing of yours is loaded."
    : `${B.league.name}: ${S.M.length} managers, gameweek ${S.gw}${e.checked ? " (final)" : " (not final yet)"}.${when} ${UID ? "Kept in your account and this browser." : "Kept in this browser."}`;
  $("#clear").hidden = !!B.demo;
}

/* ------------------------------------------------------------ helpers */

function fmtDate(iso) {
  try { return new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch (e) { return iso; }
}
const meM = () => S.M.find((m) => m.name === PREF.me) || null;
function highlights() {
  const top = tableAt(S, span.b).slice(0, 3).map((r) => r.m.name);
  const cols = ["var(--accent)", "var(--s2)", "var(--s3)"];
  if (!PREF.me) return top.map((n, i) => ({ n, c: cols[i] }));
  const out = [{ n: PREF.me, c: "var(--me)" }];
  top.filter((n) => n !== PREF.me).slice(0, 2).forEach((n, i) => out.push({ n, c: cols[i] }));
  return out;
}
const colOf = (n, H) => (H.find((h) => h.n === n) || {}).c || null;
function niceStep(range, target) {
  const raw = range / target, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}
function tipFor(svg) {
  const fig = svg.closest(".chart"); let t = fig.querySelector(".tip");
  if (!t) { t = document.createElement("div"); t.className = "tip"; t.hidden = true; fig.appendChild(t); }
  return {
    show(evt, text) { const r = fig.getBoundingClientRect(); t.textContent = text; t.style.left = (evt.clientX - r.left) + "px"; t.style.top = (evt.clientY - r.top) + "px"; t.hidden = false; },
    hide() { t.hidden = true; },
  };
}

/* ------------------------------------------------------------ top bar */

function renderBoard() {
  const e = S.ev.get(S.gw) || {};
  $("#league-name").textContent = B.league.name;
  document.title = B.demo ? "FPL League Room" : `${B.league.name} · League Room`;
  $("#board-gw").textContent = `GW${S.gw}`;
  const nx = B.events.find((x) => x.next);
  const pills = [];
  if (B.demo) pills.push(`<span class="pill demo">Example data</span>`);
  else {
    pills.push(`<span class="pill${e.checked ? "" : " warn"}">GW${S.gw} ${e.checked ? "final" : "not final"}</span>`);
    pills.push(`<span class="pill" title="When the data was fetched">Fetched ${esc(fmtDate(B.fetched))}</span>`);
  }
  if (nx && nx.deadline) pills.push(`<span class="pill">GW${nx.id} deadline ${esc(fmtDate(nx.deadline))}</span>`);
  if (LEAGUES.length > 1) {
    const i = LEAGUES.findIndex((x) => String(x.id) === leagueKey());
    pills.unshift(`<span class="pill lg">${i >= 0 ? `League ${i + 1} of ${LEAGUES.length}` : "League"} · ${S.M.length} managers</span>`);
  }
  $("#status").innerHTML = pills.join("");
  const lp = $("#league-pick");
  lp.hidden = LEAGUES.length < 2;
  if (LEAGUES.length > 1) {
    lp.innerHTML = LEAGUES.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}${x.primary ? " (main)" : ""}</option>`).join("");
    lp.value = leagueKey();
  }
  const sel = $("#me");
  sel.innerHTML = `<option value="">Pick your name</option>` + tableAt(S, S.gw).map((r) => `<option value="${esc(r.m.name)}">${esc(r.m.name)}</option>`).join("");
  sel.value = PREF.me || "";
  $("#demo-banner").hidden = !B.demo;
}

/* ------------------------------------------------------------ league view */

function renderLeague() {
  const g = S.gw, T = tableAt(S, g), prevT = S.gws.includes(g - 1) ? tableAt(S, g - 1) : null;
  const G = avgOf(S, g);
  $("#table-title").textContent = `The table after GW${g}`;
  $("#th-gw").textContent = `GW${g}`;
  const lead = T[0], second = T[1] || T[0];
  const moves = prevT ? T.map((r) => { const p = prevT.find((x) => x.m === r.m); return p ? { m: r.m, c: p.rank - r.rank } : null; }).filter(Boolean) : [];
  const climb = moves.slice().sort((a, b) => b.c - a.c)[0];
  const lg = leagueAvg(S, g);
  $("#verdict").innerHTML =
    `<div><b>${esc(short(lead.m.name))}</b><span>Top on ${lead.total}</span></div>` +
    `<div><b>${lead.total - second.total}</b><span>Points clear of 2nd</span></div>` +
    (climb && climb.c > 0 ? `<div><b>+${climb.c}</b><span>Biggest climb in GW${g}: ${esc(climb.m.name)}</span></div>` : `<div><b>0</b><span>Nobody climbed in GW${g}</span></div>`) +
    `<div><b>${G == null ? "–" : signed(Math.round((lg - G) * 10) / 10)}</b><span>League average vs global, GW${g}</span></div>`;

  const me = meM(), yc = $("#youcard");
  const myRow = me && T.find((r) => r.m === me);
  if (myRow) {
    const i = T.indexOf(myRow), above = i > 0 ? T[i - 1] : null;
    const pr = prevT && prevT.find((x) => x.m === me);
    const mv = pr ? pr.rank - myRow.rank : 0;
    const st = spanStats(S, me, S.first, g);
    const vs = G == null ? null : myRow.pts - G;
    yc.hidden = false;
    yc.innerHTML = `<span class="big">${ordinal(myRow.rank)}</span><b>${esc(me.name)} · ${myRow.total} pts</b>
      <p>${mv > 0 ? `Up ${mv} this week.` : mv < 0 ? `Down ${-mv} this week.` : "No change this week."}
      GW${g} score ${myRow.pts}${myRow.cost ? ` (${myRow.pts - myRow.cost} after the hit)` : ""}${vs == null ? "" : `, ${Math.abs(vs)} ${vs >= 0 ? "above" : "below"} the global average`}.
      ${myRow.rank === 1 && T[1] ? `Leading by ${myRow.total - T[1].total}.` : `${lead.total - myRow.total} behind 1st${above && above.rank !== 1 ? `, ${above.total - myRow.total} behind ${ordinal(above.rank)}` : ""}.`}
      Beat the global average in ${st.beatG} of ${st.played} weeks.</p>`;
  } else yc.hidden = true;

  $("#standings").innerHTML = T.map((r) => {
    const p = prevT && prevT.find((x) => x.m === r.m);
    const mv = p ? p.rank - r.rank : 0;
    const mvH = !p ? `<span class="mv same">new</span>` : mv > 0 ? `<span class="mv up">▲ ${mv}</span>` : mv < 0 ? `<span class="mv down">▼ ${-mv}</span>` : `<span class="mv same">–</span>`;
    const chip = chipAt(r.m, g);
    return `<tr class="${r.m.name === PREF.me ? "me" : ""}"><td class="l pos">${r.rank}</td><td class="l">${mvH}</td>
      <td class="l"><div class="who"><b>${esc(r.m.name)}${chip ? `<span class="badge">${esc(CHIP[chip] || chip)}</span>` : ""}</b><span>${esc(r.m.team)}</span></div></td>
      <td>${G == null ? r.pts : `<span class="gw ${r.pts > G ? "above" : "below"}">${r.pts}</span>`}${r.cost ? `<span class="badge">−${r.cost}</span>` : ""}</td>
      <td class="num">${r.total}</td><td class="num muted">${r.rank === 1 ? "" : "−" + (lead.total - r.total)}</td></tr>`;
  }).join("");

  const opts = S.gws.map((x) => `<option value="${x}">GW${x}</option>`).join("");
  $("#span-from").innerHTML = opts; $("#span-to").innerHTML = opts;
  $("#span-from").value = span.a; $("#span-to").value = span.b;
  renderSpan();
}

function renderSpan() {
  const { a, b } = span, n = b - a + 1;
  $("#span-note").textContent = n === 1
    ? `GW${a} only. Pick a wider span to see consistency and movement.`
    : `GW${a} to GW${b}: ${n} gameweeks. Positions in the charts are real league positions; points in the squad sheet count only these weeks.`;
  const ins = insights(S, a, b);
  $("#insights").innerHTML = ins.length ? ins.map((i) => `<article class="note ${i.kind}"><span class="tag">${{ skill: "Skill", cost: "Cost", luck: "Luck", world: "Context" }[i.kind]}</span>
    <div class="stat"><b>${esc(i.stat)}</b><span>${esc(i.unit)}</span></div><h3>${esc(i.head)}</h3><p>${esc(i.body)}</p></article>`).join("")
    : `<p class="muted">Not enough weeks in this span to separate anyone yet.</p>`;
  $("#chartnote").textContent = PREF.me ? "Highlighted: you and the top of the table. Hover a grey line to see who it is." : "Highlighted: the top three. Pick yourself in the bar above to follow your own line.";
  $("#sheet-note").textContent = `GW${a} to GW${b}. Click a column to sort.`;
  bump(); weekChart(); scatter(); orank(); sheet();
}

function xScale(L, R, W) {
  const gs = S.gws.filter((g) => g >= span.a && g <= span.b);
  const n = gs.length;
  return { gs, x: (g) => (n === 1 ? (L + W - R) / 2 : L + gs.indexOf(g) * (W - L - R) / (n - 1)) };
}
function xLabels(s, gs, x, H) {
  const every = Math.ceil(gs.length / 10);
  gs.forEach((g, i) => { if (i % every === 0 || i === gs.length - 1) txt(s, x(g), H - 6, "GW" + g, { "text-anchor": "middle" }); });
}

function lineChart(id, { W, H, L, R, T, B: Bm, yOf, ticks, series, label }) {
  const s = $("#" + id); s.innerHTML = ""; s.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const { gs, x } = xScale(L, R, W);
  ticks.forEach(([v, l]) => { el("line", { x1: L, x2: W - R, y1: yOf(v), y2: yOf(v), stroke: "var(--line)" }, s); txt(s, L - 8, yOf(v) + 4, l, { "text-anchor": "end" }); });
  xLabels(s, gs, x, H);
  const H2 = highlights(), tip = tipFor(s);
  const pts = (m) => gs.map((g) => { const v = series(m, g); return v == null ? null : x(g) + "," + yOf(v); }).filter(Boolean).join(" ");
  S.M.filter((m) => !colOf(m.name, H2)).forEach((m) => {
    const p = pts(m); if (!p) return;
    const grp = el("g", { class: "mgr" }, s);
    el("polyline", { points: p, class: "bg-line" }, grp);
    const hit = el("polyline", { points: p, class: "hit" }, grp);
    hit.addEventListener("mousemove", (e) => tip.show(e, `${m.name} · ${label(m)}`));
    hit.addEventListener("mouseleave", () => tip.hide());
  });
  const ends = [];
  S.M.filter((m) => colOf(m.name, H2)).forEach((m) => {
    const c = colOf(m.name, H2), p = pts(m); if (!p) return;
    el("polyline", { points: p, fill: "none", stroke: c, "stroke-width": m.name === PREF.me ? 3.5 : 2.5, "stroke-linejoin": "round", "stroke-linecap": "round" }, s);
    gs.forEach((g) => { const v = series(m, g); if (v != null) el("circle", { cx: x(g), cy: yOf(v), r: 3.5, fill: c }, s); });
    const last = series(m, gs[gs.length - 1]);
    if (last != null) ends.push({ y: yOf(last), c, t: label(m) + "  " + short(m.name) });
  });
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
  ends.forEach((e) => txt(s, W - R + 10, e.y + 4, e.t, { class: "lbl", style: "fill:" + e.c }));
}

function bump() {
  const N = S.M.length, T = 12, Bm = 26, H = Math.max(220, Math.min(420, 60 + N * 18));
  const step = Math.max(1, Math.round(N / 5));
  const ticks = [1]; for (let k = 1 + step; k < N; k += step) ticks.push(k); if (N > 1) ticks.push(N);
  lineChart("c-bump", { W: 680, H, L: 34, R: 140, T, B: Bm, yOf: (p) => T + (N === 1 ? 0 : (p - 1) * (H - T - Bm) / (N - 1)),
    ticks: [...new Set(ticks)].map((v) => [v, v]), series: (m, g) => rankOf(S, m, g), label: (m) => ordinal(rankOf(S, m, span.b)) });
}

function orank() {
  const all = S.M.flatMap((m) => S.gws.filter((g) => g >= span.a && g <= span.b).map((g) => (m.hist.get(g) || {}).orank)).filter((v) => v > 0);
  const s = $("#c-orank");
  if (!all.length) { s.innerHTML = ""; s.setAttribute("viewBox", "0 0 680 40"); txt(s, 10, 24, "No overall rank in the data."); return; }
  const lo = Math.log10(Math.min(...all)) - 0.05, hi = Math.log10(Math.max(...all)) + 0.05;
  const T = 12, Bm = 26, H = 260;
  const ticks = [];
  for (let p = Math.floor(lo); p <= Math.ceil(hi); p++) for (const k of [1, 2, 5]) { const v = k * 10 ** p; const lv = Math.log10(v); if (lv >= lo && lv <= hi) ticks.push(v); }
  const fmt = (v) => (v >= 1e6 ? (v / 1e6).toFixed(v % 1e6 ? 1 : 0) + "m" : v >= 1e3 ? Math.round(v / 1e3) + "k" : String(v));
  lineChart("c-orank", { W: 680, H, L: 50, R: 130, T, B: Bm, yOf: (v) => T + (Math.log10(v) - lo) / (hi - lo || 1) * (H - T - Bm),
    ticks: ticks.map((v) => [v, fmt(v)]), series: (m, g) => { const h = m.hist.get(g); return h && h.orank > 0 ? h.orank : null; },
    label: (m) => { const h = m.hist.get(span.b); return h && h.orank ? fmt(h.orank) : "–"; } });
}

function weekChart() {
  const s = $("#c-week"); s.innerHTML = "";
  const W = 420, H = 270, L = 34, R = 14, T = 16, Bm = 26;
  s.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const { gs, x } = xScale(L, R, W);
  const mx = gs.map((g) => Math.max(...S.M.map((m) => (m.hist.get(g) || { pts: -1 }).pts)));
  const mn = gs.map((g) => Math.min(...S.M.map((m) => (m.hist.get(g) || { pts: 9999 }).pts)));
  const hi = Math.ceil(Math.max(...mx, ...gs.map((g) => avgOf(S, g) || 0)) / 20) * 20 + 10, lo = 0;
  const y = (v) => T + (hi - v) / (hi - lo) * (H - T - Bm);
  const step = niceStep(hi, 4);
  for (let v = 0; v <= hi; v += step) { el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: "var(--line)" }, s); txt(s, L - 8, y(v) + 4, v, { "text-anchor": "end" }); }
  xLabels(s, gs, x, H);
  if (gs.length > 1) el("polygon", { points: gs.map((g, i) => x(g) + "," + y(mx[i])).concat(gs.slice().reverse().map((g, j) => x(g) + "," + y(mn[gs.length - 1 - j]))).join(" "), fill: "var(--accent-soft)" }, s);
  if (gs.length <= 12) gs.forEach((g, i) => { txt(s, x(g), y(mx[i]) - 6, mx[i], { "text-anchor": "middle" }); txt(s, x(g), y(mn[i]) + 14, mn[i], { "text-anchor": "middle" }); });
  const line = (vals, a) => el("polyline", { points: gs.map((g, i) => vals[i] == null ? null : x(g) + "," + y(vals[i])).filter(Boolean).join(" "), fill: "none", ...a }, s);
  line(gs.map((g) => avgOf(S, g)), { stroke: "var(--ink)", "stroke-width": 1.5, "stroke-dasharray": "5 4" });
  line(gs.map((g) => leagueAvg(S, g)), { stroke: "var(--accent)", "stroke-width": 3 });
  const me = meM();
  if (me) { line(gs.map((g) => (me.hist.get(g) || {}).pts ?? null), { stroke: "var(--me)", "stroke-width": 2 }); gs.forEach((g) => { const h = me.hist.get(g); if (h) el("circle", { cx: x(g), cy: y(h.pts), r: 3, fill: "var(--me)" }, s); }); }
  $("#you-leg").innerHTML = me ? `<i style="background:var(--me)"></i>${esc(short(me.name))}` : "";
}

function scatter() {
  const s = $("#c-scatter"); s.innerHTML = "";
  const W = 420, H = 270, L = 38, R = 14, T = 16, Bm = 36;
  s.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const st = S.M.map((m) => spanStats(S, m, span.a, span.b)).filter((x) => x && x.played === x.span && x.sd != null);
  if (st.length < 2) { txt(s, W / 2, H / 2, "Needs at least two gameweeks.", { "text-anchor": "middle" }); return; }
  const xs = st.map((d) => d.mean), ys = st.map((d) => d.sd);
  const pad = (a, b) => { const r = (b - a) || 4; return [a - r * 0.12, b + r * 0.12]; };
  const [x0, x1] = pad(Math.min(...xs), Math.max(...xs)), [y0, y1] = pad(Math.min(...ys), Math.max(...ys));
  const x = (v) => L + (v - x0) / (x1 - x0) * (W - L - R), y = (v) => T + (y1 - v) / (y1 - y0) * (H - T - Bm);
  const sx = niceStep(x1 - x0, 4), sy = niceStep(y1 - y0, 4);
  for (let v = Math.ceil(x0 / sx) * sx; v <= x1; v += sx) { el("line", { x1: x(v), x2: x(v), y1: T, y2: H - Bm, stroke: "var(--line)" }, s); txt(s, x(v), H - Bm + 14, Math.round(v * 10) / 10, { "text-anchor": "middle" }); }
  for (let v = Math.ceil(y0 / sy) * sy; v <= y1; v += sy) { el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: "var(--line)" }, s); txt(s, L - 8, y(v) + 4, Math.round(v * 10) / 10, { "text-anchor": "end" }); }
  txt(s, (L + W - R) / 2, H - 4, "Points per week, after hits", { "text-anchor": "middle" });
  txt(s, L, T - 5, "Std dev");
  const H2 = highlights(), tip = tipFor(s);
  const always = [st.slice().sort((a, b) => a.sd - b.sd)[0].m.name, st.slice().sort((a, b) => b.sd - a.sd)[0].m.name];
  st.slice().sort((a) => (colOf(a.m.name, H2) ? 1 : -1)).forEach((d) => {
    const c = colOf(d.m.name, H2);
    const dot = el("circle", { cx: x(d.mean), cy: y(d.sd), r: c ? 6 : 4.5, fill: c || "var(--muted)", "fill-opacity": c ? 1 : 0.55, style: "cursor:pointer" }, s);
    dot.addEventListener("mousemove", (e) => tip.show(e, `${d.m.name} · ${d.mean} a week · sd ${d.sd}`));
    dot.addEventListener("mouseleave", () => tip.hide());
    if (c || always.includes(d.m.name)) { const left = x(d.mean) > W * 0.7; txt(s, x(d.mean) + (left ? -9 : 9), y(d.sd) + 4, short(d.m.name), { class: "lbl", "text-anchor": left ? "end" : "start", style: "fill:" + (c || "var(--ink)") }); }
  });
}

function sheet() {
  const t = $("#sheet"), tb = t.querySelector("tbody");
  const rows = S.M.map((m) => spanStats(S, m, span.a, span.b)).filter(Boolean).map((s) => ({ ...s, name: s.m.name, rank: rankOf(S, s.m, span.b) ?? 999, bestN: s.best.pts, worstN: s.worst.pts }));
  const val = (r, k) => (k === "best" ? r.bestN : k === "worst" ? r.worstN : k === "sd" ? (r.sd ?? -1) : r[k]);
  rows.sort((a, b) => { const va = val(a, sortK), vb = val(b, sortK); return (typeof va === "string" ? va.localeCompare(vb) : va - vb) * sortDir || a.rank - b.rank; });
  tb.innerHTML = rows.map((r) => `<tr class="${r.name === PREF.me ? "me" : ""}"><td class="l pos">${r.rank === 999 ? "–" : r.rank}</td>
    <td class="l"><div class="who"><b>${esc(r.name)}</b><span>${esc(r.m.team)}${r.played < r.span ? ` · played ${r.played} of ${r.span}` : ""}</span></div></td>
    <td class="num">${r.total}</td><td class="num">${r.mean}</td><td class="num">${r.sd ?? "–"}</td><td class="num">${r.best.pts} <span class="muted">GW${r.best.gw}</span></td><td class="num">${r.worst.pts} <span class="muted">GW${r.worst.gw}</span></td>
    <td class="num">${r.beatG} of ${r.played}</td><td class="num">${r.bench}</td><td class="num">${r.hits ? "−" + r.hits : "0"}</td><td class="num">${r.tx}</td>
    <td class="l muted">${r.chips.length ? r.chips.map((c) => esc(c[0]) + " GW" + c[1]).join(", ") : "None"}</td></tr>`).join("");
  $$("th[data-k]", t).forEach((th) => {
    th.setAttribute("aria-sort", th.dataset.k === sortK ? (sortDir > 0 ? "ascending" : "descending") : "none");
    th.querySelector("button").onclick = () => {
      const k = th.dataset.k;
      if (k === sortK) sortDir *= -1; else { sortK = k; sortDir = ["rank", "name", "sd", "hits", "bench", "tx"].includes(k) ? 1 : -1; }
      sheet();
    };
  });
}

/* ------------------------------------------------------------ gameweek view */

function renderGameweek() {
  const w = gameweek(S);
  $("#gw-final").hidden = w.final || !!B.demo;
  $("#gw-title").textContent = `Gameweek ${w.gw}`;
  $("#gw-sub").textContent = w.globalAvg != null ? `League average ${w.leagueAvg}, global average ${w.globalAvg}, highest in the world ${w.globalHigh ?? "–"}.` : "";
  const places = ["Winner", "Second", "Third"];
  $("#podium").innerHTML = w.byPts.slice(0, 3).map((r, i) => `<div class="step"><span class="place">${places[i]}</span><span class="score">${r.pts}</span>
    <b style="color:var(--ink)">${esc(r.m.name)}</b><span class="muted" style="font-size:.82rem">${r.chipLabel ? esc(r.chipLabel) + " · " : ""}${r.hit ? `${r.net} after the −${r.hit} hit` : "no hit"}${w.globalAvg != null ? ` · ${signed(r.pts - w.globalAvg)} vs global` : ""}</span></div>`).join("");

  const F = [];
  const f = (k, v) => v && F.push(`<div class="fact"><dt>${k}</dt><dd>${v}</dd></div>`);
  f("Climber", w.climb && `<b>${esc(w.climb.m.name)}</b> up ${w.climb.change}, ${ordinal(w.climb.prev)} to ${ordinal(w.climb.rank)}`);
  f("Faller", w.fall && `<b>${esc(w.fall.m.name)}</b> down ${-w.fall.change}, ${ordinal(w.fall.prev)} to ${ordinal(w.fall.rank)}`);
  const mc = Object.entries(w.capCounts).sort((a, b) => b[1] - a[1])[0];
  f("Captain", w.bestCap && `Best: <b>${esc(w.bestCap.m.name)}</b>'s ${esc(w.bestCap.cap.effective.name)}, ${w.bestCap.cap.effective.delivered} pts${mc ? `. Most picked: ${esc(mc[0])} (${mc[1]})` : ""}`);
  f("Armband moved", w.armMoved.length && w.armMoved.map((r) => `<b>${esc(r.m.name)}</b>: ${esc(r.cap.nominal.name)} didn't play, ${esc(r.cap.effective.name)} scored ${r.cap.effective.delivered}`).join("<br>"));
  f("Best transfer", w.bestTx && `<b>${esc(w.bestTx.m.name)}</b>: ${esc(w.bestTx.in)} (${w.bestTx.inPts}) for ${esc(w.bestTx.out)} (${w.bestTx.outPts}), ${signed(w.bestTx.net)}`);
  f("Worst transfer", w.worstTx && w.worstTx !== w.bestTx && `<b>${esc(w.worstTx.m.name)}</b>: ${esc(w.worstTx.in)} (${w.worstTx.inPts}) for ${esc(w.worstTx.out)} (${w.worstTx.outPts}), ${signed(w.worstTx.net)}`);
  f("Busiest", w.busiest && `<b>${esc(w.busiest.m.name)}</b>, ${w.busiest.tx} transfers${w.busiest.hit ? `, −${w.busiest.hit} in hits` : ""}`);
  f("Biggest bench", w.benchKing && w.benchKing.bench > 0 && `<b>${esc(w.benchKing.m.name)}</b> left ${w.benchKing.bench} pts on the bench${w.benchKing.topBench ? `, ${esc(w.benchKing.topBench.name)} ${w.benchKing.topBench.pts} of them` : ""}`);
  f("Chips", w.chips.length && w.chips.map((r) => `<b>${esc(r.m.name)}</b>: ${esc(r.chipLabel)}${r.chipGain != null ? ` (${r.chip === "wildcard" ? `${signed(r.chipGain)} vs the old team` : `+${r.chipGain} from the chip`})` : ""}`).join("<br>"));
  f("Differentials", w.differentials.length && w.differentials.map((d) => `${esc(d.player)} (${esc(d.team)}) ${d.pts} pts, only <b>${esc(d.m.name)}</b> started him`).join("<br>"));
  $("#gw-facts").innerHTML = F.join("") || `<p class="muted">A quiet week: nothing stands out.</p>`;

  $("#gw-scores").innerHTML = w.byPts.map((r) => `<tr class="${r.m.name === PREF.me ? "me" : ""}"><td class="l"><div class="who"><b>${esc(r.m.name)}</b><span>${esc(r.m.team)}</span></div></td>
    <td>${w.globalAvg == null ? r.pts : `<span class="gw ${r.pts > w.globalAvg ? "above" : "below"}">${r.pts}</span>`}</td>
    <td class="num">${r.hit ? "−" + r.hit : ""}</td><td class="num">${w.globalAvg == null ? "–" : signed(r.pts - w.globalAvg)}</td>
    <td class="l">${r.cap && r.cap.effective ? `${esc(r.cap.effective.name)} <span class="muted">${r.cap.effective.delivered}</span>${r.cap.moved ? `<span class="badge flag">vice</span>` : ""}` : "–"}</td>
    <td class="num">${r.tx}</td><td class="num">${r.bench}</td><td class="l muted">${r.chipLabel ? esc(r.chipLabel) : ""}</td></tr>`).join("");
}

/* ------------------------------------------------------------ insights view */

let INS = null, insSort = { teams: { k: "rank", d: 1 }, players: { k: "pts", d: -1 } }, insPos = "";
function renderInsights() {
  INS = playerInsights(S);
  $("#ins-empty").hidden = !!INS; $("#ins-body").hidden = !INS;
  if (!INS) return;
  INS.teams.forEach((t, i) => (t.rank = i + 1));
  const li = (p, right) => `<li><span style="font-family:var(--body);color:var(--text);white-space:normal"><b>${esc(p.name)}</b> ${esc(p.club)} · ${p.pos} · £${p.cost}m</span><span>${right}</span><span>${p.leagueOwnPct}% own</span></li>`;
  $("#ins-missing").innerHTML = INS.missing.length ? INS.missing.map((p) => li(p, `${p.pts} pts`)).join("") : `<li class="muted">Nobody: the league owns all the top scorers.</li>`;
  $("#ins-favs").innerHTML = INS.leagueFavs.map((p) => li(p, `${p.ppm} pts/£m`)).join("");
  $("#ins-pos").innerHTML = INS.positions.map((r) => `<div class="poscard"><span class="pn">${r.pos}</span>
    <dl><dt>Regulars</dt><dd>${r.regulars}</dd><dt>Avg pts</dt><dd>${r.avgPts ?? "–"}</dd><dt>Avg pts/£m</dt><dd>${r.avgPpm ?? "–"}</dd>
    <dt>Top scorer</dt><dd>${r.best ? `${esc(r.best.name)} ${r.best.pts}` : "–"}</dd><dt>Best value</dt><dd>${r.bestValue ? `${esc(r.bestValue.name)} ${r.bestValue.ppm}` : "–"}</dd></dl>
    <span class="muted" style="font-size:.78rem">${r.ownedShare}% of the points in this league's squads</span><div class="share"><i style="width:${r.ownedShare}%"></i></div></div>`).join("");
  insTeams(); insPlayers();
}
function insSortable(table, which, render) {
  $$("th[data-k]", table).forEach((th) => {
    const st = insSort[which];
    th.setAttribute("aria-sort", th.dataset.k === st.k ? (st.d > 0 ? "ascending" : "descending") : "none");
    th.querySelector("button").onclick = () => { const k = th.dataset.k; if (k === st.k) st.d *= -1; else { st.k = k; st.d = ["rank", "name", "ga", "l", "cost"].includes(k) ? 1 : -1; } render(); };
  });
}
const cmp = (k, d) => (a, b) => { const x = a[k] ?? -1e9, y = b[k] ?? -1e9; return (typeof x === "string" ? x.localeCompare(y) : x - y) * d; };
function insTeams() {
  const t = $("#ins-teams"), st = insSort.teams;
  const rows = INS.teams.slice().sort(cmp(st.k === "name" ? "name" : st.k, st.d));
  t.querySelector("tbody").innerHTML = rows.map((r) => `<tr><td class="l num">${r.rank}</td><td class="l"><div class="who"><b>${esc(r.name)}</b><span>${esc(r.club)}</span></div></td>
    <td class="num">${r.p}</td><td class="num">${r.w}</td><td class="num">${r.d}</td><td class="num">${r.l}</td><td class="num">${r.gf}</td><td class="num">${r.ga}</td><td class="num">${signed(r.gd)}</td><td class="num">${r.cs}</td>
    <td class="num"><b style="color:var(--ink)">${r.pts}</b></td><td class="l"><span class="frm">${[...r.form].map((c) => `<span class="${c}">${c}</span>`).join("")}</span></td>
    <td class="num">${r.fplPts}</td><td class="l">${r.top ? `${esc(r.top.name)} <span class="muted">${r.top.pts}</span>` : "–"}</td><td class="num">${r.leagueOwn}</td>
    <td class="l">${r.next.map((f) => `<span class="fd d${f.diff}" title="FPL difficulty ${f.diff}">${esc(f.opp)} ${f.venue}</span>`).join("") || "–"}</td></tr>`).join("");
  insSortable(t, "teams", insTeams);
}
function insPlayers() {
  const t = $("#ins-players"), st = insSort.players, min = +$("#ins-min").value;
  $$("#ins-posf button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.p === insPos)));
  const rows = INS.players.filter((p) => (!insPos || p.pos === insPos) && p.mins >= min).sort(cmp(st.k, st.d)).slice(0, 40);
  t.querySelector("tbody").innerHTML = rows.map((p) => `<tr><td class="l"><b style="color:var(--ink);font-weight:500">${esc(p.name)}</b> <span class="muted">${esc(p.club)}</span>${p.news ? `<span class="badge flag" title="${esc(p.news)}">news</span>` : ""}</td><td class="l muted">${p.pos}</td>
    <td class="num">${p.cost.toFixed(1)}</td><td class="num"><b style="color:var(--ink)">${p.pts}</b></td><td class="num">${p.ppm}</td><td class="num">${p.per90 ?? "–"}</td><td class="num">${p.form}</td><td class="num">${p.mins}</td>
    <td class="num">${p.goals}</td><td class="num">${p.assists}</td><td class="num">${p.xgi}</td><td class="num ${p.gaVsXgi >= 1.5 ? "over" : p.gaVsXgi <= -1.5 ? "under" : ""}">${signed(p.gaVsXgi)}</td>
    <td class="num">${p.cs}</td><td class="num">${p.bonus}</td><td class="num">${p.dc}</td><td class="num">${p.leagueOwnPct}%</td><td class="num muted">${p.globalOwn}%</td></tr>`).join("") || `<tr><td class="l muted" colspan="17">No players match.</td></tr>`;
  insSortable(t, "players", insPlayers);
}

/* ------------------------------------------------------------ transfers view */

let lastAdvice = null;
function renderTransfers() {
  const who = $("#adv-who");
  who.innerHTML = tableAt(S, S.gw).map((r) => `<option value="${esc(r.m.name)}">${esc(r.m.name)}</option>`).join("");
  if (!S.M.some((m) => m.name === adv.who)) adv.who = S.M[0].name;
  who.value = adv.who;
  $$("#adv-h button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.h === adv.h)));
  const m = S.M.find((x) => x.name === adv.who);
  const est = freeTransferEstimate(m);
  if (adv.ft == null) adv.ft = est;
  $("#adv-ft").value = adv.ft;
  $("#adv-ft-note").textContent = `Estimated ${est} free transfer${est === 1 ? "" : "s"} from the transfer history. Check the number in the FPL app and change it here if it's different.`;
  const A = advise(S, m, adv.h, adv.ft);
  lastAdvice = A;
  const body = $("#adv-body");
  if (!A) { body.innerHTML = `<p class="muted">No fixtures left to plan for, or no squad in the data.</p>`; return; }
  const mv = (s, lead) => `<div class="move${lead ? " lead" : ""}">
    <div class="side"><span class="eyebrow">Out</span><span class="nm">${esc(s.out.name)}</span><span class="meta">${esc(s.out.club)} · £${s.out.cost}m · form ${s.out.form}${s.out.news ? ` · <span style="color:var(--warn)">${esc(s.out.news)}</span>` : ""}</span></div>
    <span class="gain">+${s.gain} projected</span>
    <div class="side in"><span class="eyebrow">In</span><span class="nm">${esc(s.in.name)}</span><span class="meta">${esc(s.in.club)} · £${s.in.cost}m · form ${s.in.form} · ${Math.round(s.in.mins / 90 * 10) / 10} full games</span></div>
    <div class="fx">${esc(s.in.name)}'s next ${A.gws.length}: ${esc(s.in.fixtures || "no fixtures")}. £${s.left}m left in the bank${s.left <= 0.3 ? ", tight: your real selling price may be lower" : ""}.</div></div>`;
  const maxProj = Math.max(...A.squad.map((x) => x.proj), 1);
  body.innerHTML = `
    <section><div class="sechead"><h2>The call</h2><p>GW${A.gws[0]} to GW${A.gws[A.gws.length - 1]} · £${A.bank}m in the bank · best eleven projects ${A.base} pts</p></div>
      <p class="plan ${A.plan.kind}">${esc(A.plan.text)}</p>
      ${A.singles[0] ? mv(A.singles[0], true) : ""}
      ${A.plan.kind === "pair" && A.pair ? `<p class="muted" style="font-size:.88rem">The pair: ${A.pair.out.map((x) => esc(x.name)).join(" and ")} out, ${A.pair.in.map((x) => `${esc(x.name)} (${esc(x.club)}, £${x.cost}m)`).join(" and ")} in. +${A.pair.gain} projected together.</p>` : ""}
    </section>
    ${A.singles.length > 1 ? `<section><div class="sechead"><h2>Alternatives</h2></div>${A.singles.slice(1, 4).map((s) => mv(s)).join("")}</section>` : ""}
    <section><div class="sechead"><h2>Squad projection</h2><p>Lowest first: these are the weak spots. Flags show injury news or doubt.</p></div>
      <div class="tablewrap"><table><thead><tr><th class="l">Player</th><th class="l">Pos</th><th>Price</th><th>Form</th><th>Projected</th><th class="l">Next fixtures</th></tr></thead><tbody>
      ${A.squad.map((p) => `<tr><td class="l"><b style="color:var(--ink);font-weight:500">${esc(p.name)}</b> <span class="muted">${esc(p.club)}</span>${p.news ? `<span class="badge flag" title="${esc(p.news)}">${p.avail < 1 ? Math.round(p.avail * 100) + "%" : "news"}</span>` : ""}</td><td class="l muted">${p.posName}</td><td class="num">£${p.cost}</td><td class="num">${p.form}</td>
        <td class="num">${p.proj} <span class="bar"><i style="width:${Math.round(p.proj / maxProj * 100)}%"></i></span></td><td class="l muted" style="white-space:normal;min-width:12em">${esc(p.fixtures)}</td></tr>`).join("")}
      </tbody></table></div></section>
    <section><div class="sechead"><h2>Fixture runs</h2><p>Summed difficulty over the window; double gameweeks count twice.</p></div>
      <div class="runs"><div><h3>Easiest</h3><ol>${A.easiest.map((r) => `<li><span><b>${esc(r.team)}</b> ${r.n > A.gws.length ? `<span class="badge">${r.n} games</span>` : ""}</span><span>${esc(r.fixtures)}</span></li>`).join("")}</ol></div>
      <div><h3>Hardest</h3><ol>${A.hardest.map((r) => `<li><span><b>${esc(r.team)}</b> ${r.n < A.gws.length ? `<span class="badge">${r.n} games</span>` : ""}</span><span>${esc(r.fixtures)}</span></li>`).join("")}</ol></div></div></section>
    <section><p class="muted" style="font-size:.82rem">How it works: each player's value per match is the average of recent form and season points per game, scaled by the share of minutes played. Each fixture scales that by difficulty, from 1.25 for the easiest to 0.75 for the hardest, with a little extra at home, and the first week by chance of playing. A move is worth what it adds to your best possible starting eleven, so upgrading a substitute who would never start counts for nothing. Limits: the squad is as of the last deadline; prices are current prices, so your selling price can be lower; the model knows nothing about expected goals, rotation or price changes.</p></section>`;
}

/* ------------------------------------------------------------ write-ups */

function writerOff(why) {
  $("#w-go").disabled = true;
  $("#w-msg").className = "msg"; $("#w-msg").textContent = why;
  $$("[data-write]").forEach((b) => (b.hidden = true));
}

function renderWriter() {
  $$("#w-kind button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === writer.kind)));
  const notes = {
    weekly: `Gameweek ${S.gw}: podium, table, decisions, chips, differentials.`,
    trend: `Review of GW${span.a} to GW${span.b}. Change the span on the League tab.`,
    advice: `Transfer advice for ${adv.who}, ${adv.h} gameweeks, ${adv.ft ?? "estimated"} free transfers. Change it on the Transfers tab.`,
  };
  $("#w-kind-note").textContent = notes[writer.kind];
  $("#w-persona").value = PREF.persona || (writer.kind === "trend" ? "pundit" : writer.kind === "advice" ? "plain" : "banter");
  $("#w-custom-wrap").hidden = $("#w-persona").value !== "custom";
  $("#w-custom").value = PREF.custom || "";
  const fav = $("#w-fav");
  fav.innerHTML = `<option value="">Nobody</option>` + S.M.map((m) => `<option value="${esc(m.name)}">${esc(m.name)}</option>`).join("");
  fav.value = PREF.fav || "";
  $("#w-dest").value = PREF.dest || "whatsapp";
}

function buildPrompt() {
  const kind = writer.kind;
  let data, task;
  if (kind === "weekly") {
    data = payloadWeekly(S);
    task = `Write the weekly report for ${S.b.league.name}, gameweek ${S.gw}.${data.final ? "" : " The gameweek is NOT final yet: say so in one line at the top."}
Cover, in this order: the podium (top three scores, flag chips and hits); the table (top three, the biggest climber and faller); decisions (best and worst transfer, the biggest bench, the busiest manager); chips and what they bought; differentials (anyone who won on a player nobody else started); sign off with the league average against the global average. Skip any part whose data is null or empty. Under 380 words.`;
  } else if (kind === "trend") {
    data = payloadTrend(S, span.a, span.b);
    task = `Write a review of ${S.b.league.name} covering gameweeks ${span.a} to ${span.b}. State the span in the first line.
The table already shows who is winning; find what it hides: process against outcome (a high mean with a poor rank, or a total built on two huge weeks, using consistency_sd), the cost of activity (hit points against transfers), quiet competence (a manager outside the top three who beat the global average most weeks), movement (rank_before_span to rank_after_span), luck (bench points) and chip timing. Name managers and cite their numbers. Close with one concrete piece of advice for whoever is last and one warning for the leader. Under 450 words.`;
  } else {
    const A = lastAdvice || advise(S, S.M.find((m) => m.name === adv.who), adv.h, adv.ft ?? 1);
    data = payloadAdvice(S, A);
    task = `Give transfer advice for ${A.m.name} (${A.m.team}) for gameweeks ${A.gws[0]} to ${A.gws[A.gws.length - 1]}.
Lead with the move from "plan" and the first of best_moves: who out, who in, price, and why in one or two sentences, explained with form, minutes, fixtures and injury news, never with the projection number alone. Then up to two alternatives, one line each. Mention best_pair only if the plan uses it. Flag anyone in "flags". If the plan says hold, say holding is fine. End with one short line on the limits. 150 to 250 words.`;
  }
  const pk = $("#w-persona").value;
  let persona = pk === "custom" ? ($("#w-custom").value.trim() || "Plain and friendly.") : $("#p-" + pk).textContent.trim();
  const fav = $("#w-fav").value;
  persona = fav ? persona.replace(/FAVOURITE:/g, `Favourite manager: ${fav}.`) : persona.replace(/^.*FAVOURITE:.*$/gm, "").replace(/^\d\. FAVOURITE:.*$/gm, "");
  const dest = { whatsapp: "a WhatsApp group: plain text, *single asterisks* for bold, short paragraphs.", teams: "a Teams or Slack channel: **double asterisks** for bold section names, short paragraphs.", me: "the manager to read privately: plain text, short paragraphs." }[$("#w-dest").value];
  const extra = $("#w-extra").value.trim();
  const prompt = `TASK\n${task}\nIt is going to ${dest}\n\nPERSONA (adopt it completely)\n${persona}${fav ? `\nThe running joke is about ${fav}.` : ""}\n\n${$("#t-rules").textContent.trim()}\n${extra ? `\nEXTRA CONTEXT FROM THE USER (not data; don't invent numbers from it)\n${extra}\n` : ""}\nDATA\n${JSON.stringify(data)}\n\nWrite it now. Output only the finished text, nothing before or after it.`;
  return { prompt, data };
}

async function runWriter() {
  if (!CAP.sample) return;
  const out = $("#w-out"), check = $("#w-check"), go = $("#w-go"), stop = $("#w-stop"), copy = $("#w-copy"), msg = $("#w-msg");
  PREF.persona = $("#w-persona").value; PREF.custom = $("#w-custom").value; PREF.fav = $("#w-fav").value; PREF.favBy = PREF.favBy || {}; PREF.favBy[leagueKey()] = PREF.fav; PREF.dest = $("#w-dest").value; savePrefs();
  const { prompt, data } = buildPrompt();
  writer.ctl = new AbortController();
  go.disabled = true; stop.hidden = false; copy.disabled = true; check.hidden = true; msg.textContent = "";
  out.classList.remove("idle"); out.textContent = "Thinking…";
  $("#w-label").textContent = { weekly: `Weekly report · GW${S.gw}`, trend: `Review · GW${span.a}–${span.b}`, advice: `Transfers · ${adv.who}` }[writer.kind];
  let text = "";
  try {
    const r = await CAP.sample(prompt, { signal: writer.ctl.signal, cache: false, onText: (u) => { text = u.text; out.textContent = u.text; } });
    text = r.text; out.textContent = text;
    if (r.truncated) msg.textContent = "It was cut short. Try a shorter brief or fewer extras.";
  } catch (e) {
    if (e && e.text) { text = e.text; out.textContent = text; }
    const copyFor = {
      cancelled: "", not_granted: "Write-ups are switched off for this page. You can allow them from the page's permissions.",
      sampling_disabled: "Claude isn't available on this account.", rate_limited: "Too many requests just now. Try again in a minute.",
      session_expired: "Sign in to Claude again, then try.", refused: "Claude declined that one. Try a different voice or remove the extra context.",
      prompt_too_large: "The league is too big for one write-up. Try a shorter span.", empty_completion: "Nothing came back. Try again with a simpler brief.",
    };
    const c = e && e.code;
    if (c === "refused") { text = ""; out.textContent = ""; }
    if (c === "not_granted" || c === "sampling_disabled") writerOff(copyFor[c]);
    else { msg.className = "msg err"; msg.textContent = c in copyFor ? copyFor[c] : "The connection dropped. Press Write it to try again."; }
    if (!text) { out.classList.add("idle"); out.textContent = c === "cancelled" ? "Stopped." : "Nothing written."; }
  } finally {
    go.disabled = !CAP.sample; stop.hidden = true; writer.ctl = null;
  }
  writer.lastText = text;
  copy.disabled = !text;
  if (text) {
    const nc = numberCheck(text, data);
    check.hidden = false;
    check.className = "check " + (nc.unmatched.length ? "flag" : "ok");
    check.textContent = nc.unmatched.length
      ? `Check before posting: ${nc.unmatched.join(", ")} ${nc.unmatched.length === 1 ? "doesn't" : "don't"} appear in the data it was given. It may be a sum Claude worked out, or a mistake.`
      : `All ${nc.checked} numbers match the data it was given.`;
  }
}

async function copyText(text, btn) {
  const was = btn.textContent;
  try { await navigator.clipboard.writeText(text); btn.textContent = "Copied"; }
  catch (e) {
    const r = document.createRange(); const t = $("#w-out"); r.selectNodeContents(t);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); btn.textContent = "Selected: press copy";
  }
  setTimeout(() => (btn.textContent = was), 1800);
}

/* ------------------------------------------------------------ routing and wiring */

const VIEWS = ["league", "gameweek", "insights", "transfers", "newsletter", "write-ups", "data"];
function route() {
  const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "league";
  $$("[data-view]").forEach((x) => (x.hidden = x.dataset.view !== v));
  $$(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.v === v));
  if (v === "write-ups") renderWriter();
  window.scrollTo(0, 0);
}

function renderAll() {
  renderBoard(); renderLeague(); renderGameweek(); renderInsights(); renderTransfers(); renderWriter(); loadedInfo();
}

function wire() {
  addEventListener("hashchange", route);
  $("#league-pick").onchange = (e) => switchLeague(e.target.value);
  $("#me").onchange = (e) => { PREF.me = e.target.value; PREF.meBy = PREF.meBy || {}; PREF.meBy[leagueKey()] = PREF.me; savePrefs(); if (PREF.me) { adv.who = PREF.me; adv.ft = null; } renderLeague(); renderGameweek(); renderTransfers(); };
  const spanChange = () => {
    let a = +$("#span-from").value, b = +$("#span-to").value;
    if (a > b) [a, b] = [b, a];
    span = { a, b }; $("#span-from").value = a; $("#span-to").value = b; renderSpan();
  };
  $("#span-from").onchange = spanChange; $("#span-to").onchange = spanChange;
  $$("#ins-posf button").forEach((b) => (b.onclick = () => { insPos = b.dataset.p; insPlayers(); }));
  $("#ins-min").onchange = () => insPlayers();
  $("#adv-who").onchange = (e) => { adv.who = e.target.value; adv.ft = null; renderTransfers(); };
  $$("#adv-h button").forEach((b) => (b.onclick = () => { adv.h = +b.dataset.h; PREF.h = adv.h; savePrefs(); renderTransfers(); }));
  $("#adv-ft").onchange = (e) => { const v = Math.max(0, Math.min(5, Math.round(+e.target.value || 0))); adv.ft = v; renderTransfers(); };
  $$("[data-write]").forEach((b) => (b.onclick = () => { writer.kind = b.dataset.write; PREF.persona = ""; location.hash = "write-ups"; }));
  $$("#w-kind button").forEach((b) => (b.onclick = () => { writer.kind = b.dataset.k; PREF.persona = ""; renderWriter(); }));
  $("#w-persona").onchange = (e) => { PREF.persona = e.target.value; savePrefs(); $("#w-custom-wrap").hidden = e.target.value !== "custom"; };
  $("#w-go").onclick = runWriter;
  $("#w-stop").onclick = () => writer.ctl && writer.ctl.abort();
  $("#w-copy").onclick = (e) => copyText(writer.lastText, e.currentTarget);

  const drop = $("#drop");
  $("#file").onchange = (e) => { const f = e.target.files[0]; if (f) loadFile(f); e.target.value = ""; };
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });

  const src = $("#fetch-src").textContent.replace(/^\n/, "");
  $("#script-view").textContent = src;
  $("#copy-script").onclick = (e) => { const b = e.currentTarget; navigator.clipboard.writeText(src).then(() => { b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy the code"), 1800); }, () => { $("details").open = true; b.textContent = "Select it below"; }); };
  $("#dl-script").onclick = async () => {
    const msg = $("#load-msg");
    try { await CAP.downloads.save({ filename: "fpl_fetch.py", data: src }); msg.className = "msg ok"; msg.textContent = "Saved fpl_fetch.py."; }
    catch (e) { msg.className = "msg"; msg.textContent = "Not saved. Use Copy the code instead and paste it into a file called fpl_fetch.py."; }
  };
  $("#use-demo").onclick = () => { setBundle(demoBundle()); showMainOnly(); location.hash = "league"; };
  $("#clear").onclick = () => {
    $("#clear-q").textContent = `Remove ${B.league.name} from this browser${UID ? " and your account" : ""}?`;
    $("#clear-confirm").hidden = false; $("#clear").hidden = true;
  };
  $("#clear-no").onclick = () => { $("#clear-confirm").hidden = true; $("#clear").hidden = false; };
  $("#clear-yes").onclick = async () => {
    store.del("flr-bundle");
    if (CAP.db && UID) { try { await CAP.db.doc(`data/users/${UID}/league`).delete(); await CAP.db.doc(`data/users/${UID}/players`).delete(); } catch (e) {} }
    $("#clear-confirm").hidden = true;
    setBundle(demoBundle());
    $("#load-msg").className = "msg ok"; $("#load-msg").textContent = "Removed. The example league is showing.";
  };
}

/* boot */
(function boot() {
  let b = null;
  const raw = store.get("flr-bundle");
  if (raw) { try { const x = JSON.parse(raw); if (!validateBundle(x)) b = x; } catch (e) {} }
  wire();
  setBundle(b || demoBundle());
  route();
  initCaps();
})();
