/* FPL League Room: pure logic. No DOM here, so it can be tested in Node.
   Every metric is defined once, in this file, and both the page and the
   write-ups read from it. */

const POS = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };
const CHIP = { "3xc": "Triple Captain", wildcard: "Wildcard", freehit: "Free Hit", bboost: "Bench Boost", manager: "Assistant Manager" };
const SQUAD_CHIPS = new Set(["wildcard", "freehit"]);
const DIFF_MULT = { 1: 1.25, 2: 1.12, 3: 1.0, 4: 0.88, 5: 0.75 };

const r1 = (x) => Math.round(x * 10) / 10;
const sum = (a) => a.reduce((s, x) => s + x, 0);
const mean = (a) => (a.length ? sum(a) / a.length : null);
/* Sample standard deviation (n-1). The one definition of "consistency". */
const sdev = (a) => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1));
};

/* ------------------------------------------------------------ load */

function validateBundle(b) {
  if (!b || typeof b !== "object") return "That file isn't JSON from the fetch script.";
  if (b.v !== 1) return "That file isn't from fpl_fetch.py (or it's from a different version).";
  if (!Array.isArray(b.managers) || !b.managers.length) return "The file has no managers in it.";
  if (!b.gw) return "The file doesn't say which gameweek it covers.";
  return null;
}

function build(b) {
  const ev = new Map(b.events.map((e) => [e.id, e]));
  const teams = new Map(b.teams.map((t) => [t[0], { short: t[1], name: t[2] }]));
  const P = new Map(b.elements.map((r) => [r[0], {
    id: r[0], name: r[1], team: r[2], pos: r[3], cost: r[4] / 10, form: r[5], ppg: r[6],
    mins: r[7], status: r[8], chance: r[9], news: r[10], own: r[11], total: r[12], raw: r,
  }]));
  const M = b.managers.map((m) => ({
    entry: m.entry, name: m.name, team: m.team,
    hist: new Map(m.history.map((h) => [h[0], {
      ev: h[0], pts: h[1], total: h[2], orank: h[3], bank: h[4], value: h[5], tx: h[6], cost: h[7], bench: h[8],
    }])),
    chips: m.chips || [], picks: m.picks, prev: m.prev, squad: m.squad, transfers: m.transfers || [], captains: m.captains || [], rank: m.rank || null, lastRank: m.last_rank || null,
  }));
  const live = new Map(Object.entries(b.live || {}).map(([k, v]) => [+k, { pts: v[0], mins: v[1] }]));
  const gws = [...new Set(M.flatMap((m) => [...m.hist.keys()]))].filter((g) => g <= b.gw).sort((a, c) => a - c);
  const S = { b, ev, teams, P, M, live, gw: b.gw, gws, first: gws[0], _rank: new Map() };
  return S;
}

const avgOf = (S, g) => { const e = S.ev.get(g); return e && e.avg != null ? e.avg : null; };
const teamShort = (S, id) => (S.teams.get(id) || { short: "?" }).short;
const pname = (S, id) => (S.P.get(id) || { name: "#" + id }).name;
const livePts = (S, id) => (S.live.get(id) || { pts: 0 }).pts;
const chipAt = (m, g) => { const c = m.chips.find((c) => c[1] === g); return c ? c[0] : null; };

/* ------------------------------------------------------------ standings */

/* The league table after gameweek g. Totals are FPL's own season totals,
   which are already net of transfer hits. Equal totals share a rank, as in FPL. */
function tableAt(S, g) {
  if (S._rank.has(g)) return S._rank.get(g);
  const rows = S.M.map((m) => { const h = m.hist.get(g); return h ? { m, total: h.total, pts: h.pts, cost: h.cost } : null; })
    .filter(Boolean)
    .sort((a, c) => c.total - a.total || c.pts - a.pts || a.m.name.localeCompare(c.m.name));
  let rank = 0, prev = null;
  rows.forEach((r, i) => { if (r.total !== prev) { rank = i + 1; prev = r.total; } r.rank = rank; });
  S._rank.set(g, rows);
  return rows;
}
const rankOf = (S, m, g) => { const r = tableAt(S, g).find((x) => x.m === m); return r ? r.rank : null; };

/* ------------------------------------------------------------ span stats */

/* One manager across gameweeks a..b. "net" = points minus hits.
   "beatG" compares the weekly score before hits with FPL's global average,
   which is how FPL reports that average. */
function spanStats(S, m, a, b) {
  const rows = [];
  for (let g = a; g <= b; g++) { const h = m.hist.get(g); if (h) rows.push(h); }
  if (!rows.length) return null;
  const net = rows.map((h) => h.pts - h.cost);
  const withAvg = rows.filter((h) => avgOf(S, h.ev) != null);
  const bestI = net.indexOf(Math.max(...net)), worstI = net.indexOf(Math.min(...net));
  const sd = sdev(net);
  return {
    m, played: rows.length, span: b - a + 1,
    net, gws: rows.map((h) => h.ev),
    total: sum(net),
    mean: r1(mean(net)),
    sd: sd == null ? null : r1(sd),
    best: { pts: net[bestI], gw: rows[bestI].ev },
    worst: { pts: net[worstI], gw: rows[worstI].ev },
    beatG: withAvg.filter((h) => h.pts > avgOf(S, h.ev)).length,
    vsG: sum(withAvg.map((h) => h.pts - avgOf(S, h.ev))),
    bench: sum(rows.map((h) => h.bench)),
    hits: sum(rows.map((h) => h.cost)),
    tx: sum(rows.map((h) => h.tx)),
    chips: m.chips.filter((c) => c[1] >= a && c[1] <= b).map((c) => [CHIP[c[0]] || c[0], c[1]]),
    orank: rows.map((h) => h.orank),
  };
}

function leagueAvg(S, g) {
  const p = S.M.map((m) => m.hist.get(g)).filter(Boolean).map((h) => h.pts);
  return p.length ? r1(mean(p)) : null;
}

/* Insight cards for the span, computed rather than written. Each returns
   null when the data doesn't separate anyone, so nothing is invented. */
function insights(S, a, b) {
  const all = S.M.map((m) => spanStats(S, m, a, b)).filter(Boolean);
  const full = all.filter((s) => s.played === s.span);
  const out = [];
  const n = b - a + 1;
  const end = tableAt(S, b);
  const top3 = new Set(end.filter((r) => r.rank <= 3).map((r) => r.m));

  if (n >= 3 && full.length > 2) {
    const c = full.slice().sort((x, y) => x.sd - y.sd)[0];
    const v = full.slice().sort((x, y) => y.sd - x.sd)[0];
    if (c.sd !== v.sd) out.push({ kind: "skill", stat: String(c.sd), unit: "pts std dev", head: `${c.m.name} is the steadiest`,
      body: `Weekly scores swing by ${c.sd} points around an average of ${c.mean}. At the other end, ${v.m.name} swings by ${v.sd}.` });
  }
  const quiet = full.filter((s) => !top3.has(s.m)).sort((x, y) => y.beatG - x.beatG || y.vsG - x.vsG)[0];
  if (quiet && quiet.beatG > n / 2) {
    out.push({ kind: "skill", stat: `${quiet.beatG}/${n}`, unit: "weeks above global", head: `${quiet.m.name}: better than the table says`,
      body: `Beat the FPL global average in ${quiet.beatG} of ${n} weeks while sitting ${ordinal(rankOf(S, quiet.m, b))}. The process is sound; the total hasn't caught up yet.` });
  }
  const hitter = all.slice().sort((x, y) => y.hits - x.hits)[0];
  if (hitter && hitter.hits > 0) {
    out.push({ kind: "cost", stat: `−${hitter.hits}`, unit: "pts on hits", head: `${hitter.m.name} pays to play`,
      body: `${hitter.tx} transfers and ${hitter.hits} points spent on hits across the span. That is ${r1(hitter.hits / n)} a week before any new player scores.` });
  }
  const bench = all.slice().sort((x, y) => y.bench - x.bench)[0];
  if (bench && bench.bench > 0 && all.some((s) => s.bench !== bench.bench)) {
    out.push({ kind: "luck", stat: String(bench.bench), unit: "pts on the bench", head: `${bench.m.name}'s bench`,
      body: `Points left among the substitutes. Partly selection, mostly luck: nobody plays their whole squad.` });
  }
  const startG = S.gws.includes(a - 1) ? a - 1 : a;
  if (startG < b) {
    const moves = S.M.map((m) => ({ m, from: rankOf(S, m, startG), to: rankOf(S, m, b) })).filter((x) => x.from && x.to);
    const up = moves.sort((x, y) => (y.from - y.to) - (x.from - x.to))[0];
    if (up && up.from > up.to) out.push({ kind: "skill", stat: `+${up.from - up.to}`, unit: "places", head: `${up.m.name} is on the move`,
      body: `From ${ordinal(up.from)} after GW${startG} to ${ordinal(up.to)} after GW${b}, the biggest climb in the league.` });
  }
  const lv = [];
  for (let g = a; g <= b; g++) { const l = leagueAvg(S, g), G = avgOf(S, g); if (l != null && G != null) lv.push(l - G); }
  if (lv.length) {
    const t = r1(sum(lv));
    out.push({ kind: "world", stat: (t > 0 ? "+" : t < 0 ? "−" : "") + Math.abs(t), unit: "pts vs global", head: t >= 0 ? "The league beats the world" : "The world beats the league",
      body: `Added up week by week, the league's average score finished ${Math.abs(t)} points ${t >= 0 ? "above" : "below"} the FPL global average over GW${a} to GW${b}.` });
  }
  return out;
}

function ordinal(n) {
  if (n == null) return "?";
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/* ------------------------------------------------------------ gameweek */

function captaincy(S, picks) {
  if (!picks) return null;
  const ps = picks.picks.map((p) => ({ el: p[0], position: p[1], mult: p[2], cap: !!p[3], vice: !!p[4] }));
  const nominal = ps.find((p) => p.cap);
  const arm = ps.filter((p) => p.mult >= 2).sort((a, b) => b.mult - a.mult)[0];
  const d = (p) => p && { name: pname(S, p.el), raw: livePts(S, p.el), mult: p.mult, delivered: livePts(S, p.el) * p.mult };
  return { nominal: d(nominal), effective: d(arm), moved: !!(nominal && arm && nominal.el !== arm.el) };
}

function gameweek(S) {
  const g = S.gw;
  const rows = S.M.map((m) => {
    const h = m.hist.get(g);
    if (!h) return null;
    const chip = chipAt(m, g) || (m.picks && m.picks.chip) || null;
    const transfers = m.transfers.filter((t) => t[2] === g).map((t) => ({
      in: pname(S, t[0]), inPts: livePts(S, t[0]), out: pname(S, t[1]), outPts: livePts(S, t[1]),
      net: livePts(S, t[0]) - livePts(S, t[1]),
    }));
    let chipGain = null;
    if (m.picks && chip === "3xc") {
      const c = m.picks.picks.find((p) => p[2] >= 3); if (c) chipGain = livePts(S, c[0]);
    } else if (m.picks && chip === "bboost") {
      chipGain = sum(m.picks.picks.filter((p) => p[1] >= 12).map((p) => livePts(S, p[0])));
    } else if (chip === "wildcard" && m.prev) {
      const capEl = (m.prev.picks.find((p) => p[3]) || [])[0];
      const old = sum(m.prev.picks.filter((p) => p[1] <= 11).map((p) => livePts(S, p[0]) * (p[0] === capEl ? 2 : 1)));
      chipGain = h.pts - old;
    }
    const benchList = m.picks ? m.picks.picks.filter((p) => p[2] === 0).map((p) => ({ name: pname(S, p[0]), pts: livePts(S, p[0]) })).sort((a, b) => b.pts - a.pts) : [];
    return {
      m, pts: h.pts, hit: h.cost, net: h.pts - h.cost, total: h.total, tx: h.tx, bench: h.bench,
      chip, chipLabel: chip ? CHIP[chip] || chip : null, chipGain,
      cap: captaincy(S, m.picks), transfers, topBench: benchList[0] || null,
    };
  }).filter(Boolean);

  const byPts = rows.slice().sort((a, b) => b.pts - a.pts);
  const now = tableAt(S, g), before = S.gws.includes(g - 1) ? tableAt(S, g - 1) : null;
  /* FPL's own league positions (it splits ties) when the fetch has them for this gameweek; otherwise shared ranks from totals. */
  const fplRanks = S.b.standings_gw === g && S.M.every((m) => m.rank && m.lastRank);
  const moves = fplRanks
    ? S.M.map((m) => ({ m, rank: m.rank, prev: m.lastRank, change: m.lastRank - m.rank }))
    : before ? now.map((r) => { const p = before.find((x) => x.m === r.m); return p ? { m: r.m, rank: r.rank, prev: p.rank, change: p.rank - r.rank } : null; }).filter(Boolean) : [];
  const climb = moves.filter((x) => x.change > 0).sort((a, b) => b.change - a.change)[0] || null;
  const fall = moves.filter((x) => x.change < 0).sort((a, b) => a.change - b.change)[0] || null;

  const regular = rows.filter((r) => !SQUAD_CHIPS.has(r.chip));
  const tx = regular.flatMap((r) => r.transfers.map((t) => ({ ...t, m: r.m })));
  const bestTx = tx.length ? tx.slice().sort((a, b) => b.net - a.net)[0] : null;
  const worstTx = tx.length ? tx.slice().sort((a, b) => a.net - b.net)[0] : null;
  const busiest = regular.filter((r) => r.tx > 1).sort((a, b) => b.tx - a.tx)[0] || null;

  const capCounts = {};
  rows.forEach((r) => { if (r.cap && r.cap.effective && r.cap.effective.mult === 2) capCounts[r.cap.effective.name] = (capCounts[r.cap.effective.name] || 0) + 1; });
  const bestCap = rows.filter((r) => r.cap && r.cap.effective).sort((a, b) => b.cap.effective.delivered - a.cap.effective.delivered)[0] || null;

  const owners = new Map();
  S.M.forEach((m) => { if (!m.picks) return; m.picks.picks.filter((p) => p[2] > 0).forEach((p) => { if (!owners.has(p[0])) owners.set(p[0], []); owners.get(p[0]).push(m); }); });
  const differentials = [...owners.entries()].filter(([el, who]) => who.length === 1 && livePts(S, el) >= 6)
    .map(([el, who]) => ({ player: pname(S, el), team: teamShort(S, (S.P.get(el) || {}).team), pts: livePts(S, el), m: who[0] }))
    .sort((a, b) => b.pts - a.pts).slice(0, 5);

  const benchKing = rows.slice().sort((a, b) => b.bench - a.bench)[0];
  const e = S.ev.get(g) || {};
  return {
    gw: g, final: !!e.checked, rows, byPts, moves, climb, fall, bestTx, worstTx, busiest,
    hits: rows.filter((r) => r.hit > 0), capCounts, bestCap,
    armMoved: rows.filter((r) => r.cap && r.cap.moved),
    chips: rows.filter((r) => r.chip), differentials, benchKing,
    leagueAvg: r1(mean(rows.map((r) => r.pts))), globalAvg: e.avg ?? null, globalHigh: e.high ?? null,
    table: now,
  };
}

/* ------------------------------------------------------------ transfers */

function nextGw(S) {
  const n = S.b.events.find((e) => e.next);
  return n ? n.id : S.b.squad_gw + 1;
}

function freeTransferEstimate(m) {
  /* Banks one a week up to five; wildcard and free hit weeks don't use one. */
  let ft = 1;
  [...m.hist.values()].sort((a, b) => a.ev - b.ev).forEach((h) => {
    if (h.ev < 2) return;
    const c = chipAt(m, h.ev);
    if (c === "wildcard" || c === "freehit") return;
    ft = Math.min(5, Math.max(0, ft - h.tx) + 1);
  });
  return ft;
}

function advise(S, m, horizon, freeTransfers) {
  const start = nextGw(S);
  const gws = [];
  for (let g = start; g < start + horizon && g <= 38; g++) gws.push(g);
  if (!gws.length || !m.squad) return null;

  const run = new Map([...S.teams.keys()].map((t) => [t, { mult: 0, n: 0, list: [] }]));
  S.b.fixtures.filter((f) => gws.includes(f[0])).sort((a, b) => a[0] - b[0]).forEach(([g, h, a, hd, ad]) => {
    const H = run.get(h), A = run.get(a);
    if (H) { H.mult += DIFF_MULT[hd] + 0.05; H.n++; H.list.push(`${teamShort(S, a)} (H)`); H.d = (H.d || []).concat(hd); }
    if (A) { A.mult += DIFF_MULT[ad]; A.n++; A.list.push(`${teamShort(S, h)} (A)`); A.d = (A.d || []).concat(ad); }
  });
  const played = Math.max(1, S.b.events.filter((e) => e.finished && e.id <= S.b.squad_gw).length);
  const avail = (p) => (p.chance != null ? p.chance / 100 : ({ a: 1, d: 0.5 })[p.status] ?? 0);
  const proj = (p) => {
    const base = (p.form + p.ppg) / 2;
    const mins = Math.min(1, p.mins / (played * 90));
    const r = run.get(p.team) || { mult: 0, n: 0 };
    const share = r.n ? 1 / r.n : 0;
    return r1(base * mins * r.mult * (1 - share + share * avail(p)));
  };
  const card = (p) => ({ ...p, posName: POS[p.pos], club: teamShort(S, p.team), proj: proj(p), avail: avail(p), fixtures: (run.get(p.team) || { list: [] }).list.join(", ") });

  const squad = m.squad.picks.map((x) => card(S.P.get(x[0]))).filter((x) => x.id);
  const bank = (m.squad.bank || 0) / 10;
  const bestXI = (sq) => {
    const by = (pos) => sq.filter((x) => x.pos === pos).map((x) => x.proj).sort((a, b) => b - a);
    const gk = by(1), d = by(2), mi = by(3), f = by(4);
    const core = (gk[0] || 0) + sum(d.slice(0, 3)) + sum(mi.slice(0, 2)) + (f[0] || 0);
    const rest = d.slice(3, 5).concat(mi.slice(2, 5), f.slice(1, 3)).sort((a, b) => b - a);
    return core + sum(rest.slice(0, 4));
  };
  const base = bestXI(squad);
  const inSquad = new Set(squad.map((x) => x.id));
  const clubs = {};
  squad.forEach((x) => { clubs[x.team] = (clubs[x.team] || 0) + 1; });
  const pool = [...S.P.values()].filter((p) => !inSquad.has(p.id) && avail(p) >= 0.75 && p.mins > 0).map(card).sort((a, b) => b.proj - a.proj);
  const clubOk = (cc, ins) => { const c = { ...cc }; for (const i of ins) { c[i.team] = (c[i.team] || 0) + 1; if (c[i.team] > 3) return false; } return true; };

  const singles = [];
  squad.forEach((out) => {
    const cc = { ...clubs }; cc[out.team]--;
    const budget = bank + out.cost + 1e-9;
    let best = null;
    pool.filter((i) => i.pos === out.pos && i.cost <= budget).slice(0, 30).forEach((c) => {
      if (!clubOk(cc, [c])) return;
      const gain = bestXI(squad.filter((x) => x.id !== out.id).concat(c)) - base;
      if (!best || gain > best.gain) best = { c, gain };
    });
    if (best && best.gain > 0.5) singles.push({ out, in: best.c, gain: r1(best.gain), left: r1(budget - best.c.cost) });
  });
  singles.sort((a, b) => b.gain - a.gain);

  let pair = null;
  const outs = singles.slice(0, 6).map((s) => s.out);
  for (let i = 0; i < outs.length; i++) for (let j = i + 1; j < outs.length; j++) {
    const o1 = outs[i], o2 = outs[j];
    const cc = { ...clubs }; cc[o1.team]--; cc[o2.team]--;
    const money = bank + o1.cost + o2.cost + 1e-9;
    const kept = squad.filter((x) => x.id !== o1.id && x.id !== o2.id);
    const A = pool.filter((p) => p.pos === o1.pos).slice(0, 15), Bp = pool.filter((p) => p.pos === o2.pos).slice(0, 15);
    for (const a of A) for (const b of Bp) {
      if (a.id === b.id || a.cost + b.cost > money || !clubOk(cc, [a, b])) continue;
      const gain = bestXI(kept.concat(a, b)) - base;
      if (!pair || gain > pair.gain) pair = { out: [o1, o2], in: [a, b], gain: r1(gain) };
    }
  }

  const ft = freeTransfers;
  const extra = pair && singles.length ? r1(pair.gain - singles[0].gain) : null;
  let plan;
  if (!singles.length || singles[0].gain < 2) plan = { kind: "hold", text: "No move adds two projected points. Rolling the transfer is a reasonable call." };
  else if (ft >= 2 && pair && extra > 0) plan = { kind: "pair", text: `${ft} free transfers: make both moves. Together they add ${pair.gain} projected points.` };
  else if (ft === 0) plan = { kind: "hit", text: `No free transfers. The best move adds ${singles[0].gain} projected points, so a 4-point hit only pays if you trust that over ${gws.length} gameweeks.` };
  else if (pair && extra >= 8) plan = { kind: "hit", text: `The second move adds ${extra} more projected points, above the 8 needed to justify a 4-point hit. A judgement call.` };
  else plan = { kind: "single", text: pair ? `Make the top move. A second one would add ${extra} more projected points, not enough to justify a 4-point hit.` : "Make the top move." };

  const runs = [...run.entries()].filter(([, r]) => r.n).map(([t, r]) => ({ team: teamShort(S, t), score: r1(r.mult), n: r.n, fixtures: r.list.join(", ") }))
    .sort((a, b) => b.score - a.score);
  return {
    m, gws, bank, ft, base: r1(base), squad: squad.sort((a, b) => a.proj - b.proj), singles: singles.slice(0, 6), pair, extra, plan,
    easiest: runs.slice(0, 5), hardest: runs.slice(-5).reverse(),
    flags: squad.filter((x) => x.news || x.avail < 1),
  };
}

/* ------------------------------------------------------------ payloads for write-ups */

function payloadWeekly(S) {
  const w = gameweek(S);
  const lead = w.table[0];
  return {
    league: S.b.league.name, gameweek: w.gw, final: w.final,
    global_average: w.globalAvg, global_highest: w.globalHigh, league_average_before_hits: w.leagueAvg,
    league_minus_global: w.globalAvg != null ? r1(w.leagueAvg - w.globalAvg) : null,
    table_after_gameweek: w.table.map((r, i) => ({
      rank: r.rank, manager: r.m.name, team: r.m.team, total_after_hits: r.total,
      behind_leader: lead.total - r.total, behind_place_above: i ? w.table[i - 1].total - r.total : 0,
    })),
    scores_this_week: w.byPts.map((r) => ({ manager: r.m.name, points_before_hits: r.pts, hit: r.hit, points_after_hits: r.net, vs_global: w.globalAvg != null ? r.pts - w.globalAvg : null, chip: r.chipLabel, transfers: r.tx, bench_points: r.bench })),
    movers: { biggest_climber: w.climb && { manager: w.climb.m.name, from: w.climb.prev, to: w.climb.rank, places: w.climb.change },
      biggest_faller: w.fall && { manager: w.fall.m.name, from: w.fall.prev, to: w.fall.rank, places: -w.fall.change } },
    captaincy: {
      most_common: Object.entries(w.capCounts).sort((a, b) => b[1] - a[1])[0] || null,
      best: w.bestCap && { manager: w.bestCap.m.name, player: w.bestCap.cap.effective.name, points_delivered: w.bestCap.cap.effective.delivered },
      armband_moved_to_vice: w.armMoved.map((r) => ({ manager: r.m.name, captain: r.cap.nominal.name, vice: r.cap.effective.name, vice_delivered: r.cap.effective.delivered })),
    },
    transfers: {
      note: "Wildcard and Free Hit managers are excluded from best and worst transfer.",
      best: w.bestTx && { manager: w.bestTx.m.name, in: w.bestTx.in, in_points: w.bestTx.inPts, out: w.bestTx.out, out_points: w.bestTx.outPts, net: w.bestTx.net },
      worst: w.worstTx && { manager: w.worstTx.m.name, in: w.worstTx.in, in_points: w.worstTx.inPts, out: w.worstTx.out, out_points: w.worstTx.outPts, net: w.worstTx.net },
      busiest: w.busiest && { manager: w.busiest.m.name, transfers: w.busiest.tx, hit: w.busiest.hit },
    },
    biggest_bench: w.benchKing && { manager: w.benchKing.m.name, bench_points: w.benchKing.bench, top_benched_player: w.benchKing.topBench },
    chips: w.chips.map((r) => ({ manager: r.m.name, chip: r.chipLabel, extra_points_from_chip: r.chipGain })),
    differentials: w.differentials.map((d) => ({ player: d.player, club: d.team, points: d.pts, only_owner: d.m.name })),
  };
}

function payloadTrend(S, a, b) {
  const st = S.M.map((m) => spanStats(S, m, a, b)).filter(Boolean);
  const startG = S.gws.includes(a - 1) ? a - 1 : a;
  return {
    league: S.b.league.name, from_gameweek: a, to_gameweek: b,
    definitions: {
      total_in_span: "points after hits scored inside the span only",
      season_total: "official FPL total after hits",
      consistency_sd: "sample standard deviation of weekly scores after hits; lower is steadier",
      weeks_beat_global: "weeks where the score before hits beat the FPL global average",
    },
    global_average_by_gameweek: Object.fromEntries(S.gws.filter((g) => g >= a && g <= b).map((g) => [g, avgOf(S, g)])),
    league_average_by_gameweek: Object.fromEntries(S.gws.filter((g) => g >= a && g <= b).map((g) => [g, leagueAvg(S, g)])),
    managers: st.map((s) => ({
      manager: s.m.name, rank_after_span: rankOf(S, s.m, b), rank_before_span: rankOf(S, s.m, startG),
      season_total: s.m.hist.get(b) ? s.m.hist.get(b).total : null,
      total_in_span: s.total, mean: s.mean, consistency_sd: s.sd, gameweeks_played: s.played,
      best_week: s.best, worst_week: s.worst, weeks_beat_global: s.beatG, points_vs_global_total: s.vsG,
      bench_points: s.bench, hit_points: s.hits, transfers: s.tx, chips: s.chips,
    })).sort((x, y) => x.rank_after_span - y.rank_after_span),
    computed_insights: insights(S, a, b).map((i) => ({ headline: i.head, number: i.stat, detail: i.body })),
  };
}

function payloadAdvice(S, A) {
  return {
    manager: A.m.name, team: A.m.team, gameweeks: A.gws, bank: A.bank, free_transfers: A.ft,
    method: "Per-match value = average of form and season points per game, scaled by share of minutes played, multiplied across fixtures by difficulty (1.25 easiest to 0.75 hardest, +0.05 at home); first gameweek scaled by chance of playing. Gain = improvement to the best possible starting eleven over the window.",
    plan: A.plan.text,
    best_moves: A.singles.map((s) => ({ out: s.out.name, out_club: s.out.club, out_price: s.out.cost, out_form: s.out.form, out_news: s.out.news,
      in: s.in.name, in_club: s.in.club, in_price: s.in.cost, in_form: s.in.form, in_minutes: s.in.mins, in_fixtures: s.in.fixtures, money_left: s.left, projected_gain: s.gain })),
    best_pair: A.pair && { out: A.pair.out.map((x) => x.name), in: A.pair.in.map((x) => `${x.name} (${x.club}, £${x.cost}m)`), projected_gain: A.pair.gain, extra_over_single: A.extra },
    flags: A.flags.map((x) => ({ player: x.name, club: x.club, news: x.news, chance_of_playing: Math.round(x.avail * 100) })),
    easiest_fixture_runs: A.easiest, hardest_fixture_runs: A.hardest,
    limits: "Squad is as of the last deadline. Prices are current prices: the real selling price can be lower if a player rose after purchase.",
  };
}

/* ------------------------------------------------------------ insights: teams, positions, players */

/* Season performance from FPL's own player and match data, set against what this league owns. */
function playerInsights(S) {
  const stats = new Map((S.b.stats || []).map((r) => [r[0], { goals: r[1], assists: r[2], cs: r[3], gc: r[4], bonus: r[5], xg: r[6], xa: r[7], xgi: r[8], starts: r[9], saves: r[10], bps: r[11], dc: r[12] }]));
  if (!stats.size) return null;
  const N = S.M.length;
  /* league ownership: players in each manager's latest squad */
  const own = {};
  S.M.forEach((m) => { const sq = m.squad || m.picks; if (sq) sq.picks.forEach((p) => { own[p[0]] = (own[p[0]] || 0) + 1; }); });

  const players = [...S.P.values()].filter((p) => stats.has(p.id) && p.mins > 0).map((p) => {
    const s = stats.get(p.id);
    return {
      id: p.id, name: p.name, club: teamShort(S, p.team), teamId: p.team, pos: POS[p.pos], posN: p.pos, cost: p.cost, pts: p.total, form: p.form, mins: p.mins,
      ppm: r1(p.total / p.cost), per90: p.mins >= 90 ? r1(p.total / p.mins * 90) : null,
      goals: s.goals, assists: s.assists, ga: s.goals + s.assists, xgi: r1(s.xgi), gaVsXgi: r1(s.goals + s.assists - s.xgi), xg: r1(s.xg), goalsVsXg: r1(s.goals - s.xg),
      cs: s.cs, bonus: s.bonus, starts: s.starts, dc: s.dc, saves: s.saves,
      leagueOwn: own[p.id] || 0, leagueOwnPct: Math.round((own[p.id] || 0) / N * 100), globalOwn: p.own, news: p.news,
    };
  });

  /* teams from match results */
  const teams = new Map([...S.teams.entries()].map(([id, t]) => [id, { id, club: t.short, name: t.name, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, cs: 0, pts: 0, fplPts: 0, form: [] }]));
  (S.b.results || []).slice().sort((a, b) => a[0] - b[0]).forEach(([ev, h, a, hs, as]) => {
    if (hs == null || as == null) return;
    const H = teams.get(h), A = teams.get(a); if (!H || !A) return;
    H.p++; A.p++; H.gf += hs; H.ga += as; A.gf += as; A.ga += hs;
    if (as === 0) H.cs++; if (hs === 0) A.cs++;
    const rH = hs > as ? "W" : hs < as ? "L" : "D", rA = hs > as ? "L" : hs < as ? "W" : "D";
    H[rH.toLowerCase()]++; A[rA.toLowerCase()]++; H.form.push(rH); A.form.push(rA);
    H.pts += rH === "W" ? 3 : rH === "D" ? 1 : 0; A.pts += rA === "W" ? 3 : rA === "D" ? 1 : 0;
  });
  players.forEach((p) => { const t = teams.get(p.teamId); if (t) t.fplPts += p.pts; });
  const nextGws = [nextGw(S), nextGw(S) + 1, nextGw(S) + 2];
  const teamRows = [...teams.values()].map((t) => {
    const top = players.filter((p) => p.teamId === t.id).sort((a, b) => b.pts - a.pts)[0];
    const fx = S.b.fixtures.filter((f) => nextGws.includes(f[0]) && (f[1] === t.id || f[2] === t.id)).sort((a, b) => a[0] - b[0])
      .map((f) => (f[1] === t.id ? { opp: teamShort(S, f[2]), venue: "H", diff: f[3] } : { opp: teamShort(S, f[1]), venue: "A", diff: f[4] }));
    return { ...t, gd: t.gf - t.ga, form: t.form.slice(-5).join(""), top: top ? { name: top.name, pts: top.pts } : null, leagueOwn: sum(players.filter((p) => p.teamId === t.id).map((p) => p.leagueOwn)), next: fx };
  }).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);

  /* positions: where the points come from, overall and in this league's squads */
  const posRows = [1, 2, 3, 4].map((k) => {
    const ps = players.filter((p) => p.posN === k);
    const regulars = ps.filter((p) => p.mins >= 90 * Math.max(1, S.gw) * 0.5);
    const top5 = ps.slice().sort((a, b) => b.pts - a.pts).slice(0, 5);
    const ownedPts = sum(ps.map((p) => p.pts * p.leagueOwn));
    return {
      pos: POS[k], players: ps.length, regulars: regulars.length,
      avgPts: regulars.length ? r1(mean(regulars.map((p) => p.pts))) : null,
      avgPpm: regulars.length ? r1(mean(regulars.map((p) => p.ppm))) : null,
      top5Pts: sum(top5.map((p) => p.pts)), best: top5[0] ? { name: top5[0].name, club: top5[0].club, pts: top5[0].pts } : null,
      bestValue: regulars.slice().sort((a, b) => b.ppm - a.ppm)[0] || null,
      ownedPts,
    };
  });
  const totalOwned = sum(posRows.map((r) => r.ownedPts)) || 1;
  posRows.forEach((r) => (r.ownedShare = Math.round(r.ownedPts / totalOwned * 100)));

  /* the league against reality */
  const byPts = players.slice().sort((a, b) => b.pts - a.pts);
  const missing = byPts.slice(0, 40).filter((p) => p.leagueOwnPct < 15).slice(0, 6);
  const leagueFavs = players.filter((p) => p.leagueOwnPct >= 25).sort((a, b) => a.ppm - b.ppm).slice(0, 6);
  return { players, teams: teamRows, positions: posRows, missing, leagueFavs, managers: N };
}

/* ------------------------------------------------------------ newsletter */

/* Every figure in the newsletter, in one place. The written columns are
   produced from this and nothing else. */
function payloadNewsletter(S) {
  const g = S.gw, w = gameweek(S), N = S.M.length;
  const club = (el) => teamShort(S, (S.P.get(el) || {}).team);
  const stat = (el) => { const v = (S.b.live || {})[String(el)] || [0, 0, 0, 0, 0, 0]; return { pts: v[0], mins: v[1], goals: v[2] || 0, assists: v[3] || 0, bonus: v[4] || 0 }; };
  const label = (m) => ({ team: m.team, manager: m.name });
  const pct = (n) => `${(Math.round(n / N * 10000) / 100).toFixed(2)}% (${n}/${N})`;
  /* The newsletter's average and median are after hits, as in the hand-made issues. */
  const scores = w.rows.map((r) => r.net).sort((a, b) => a - b);
  const median = scores.length % 2 ? scores[(scores.length - 1) / 2] : (scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2;

  /* movement */
  const moves = w.moves.map((x) => { const r = w.rows.find((y) => y.m === x.m); return { ...label(x.m), from: x.prev, to: x.rank, change: x.change, points: r ? r.pts : null, captain: r && r.cap && r.cap.effective ? r.cap.effective.name : null, chip: r ? r.chipLabel : null, transfers: r ? r.tx : null }; });
  const risers = moves.filter((x) => x.change > 0).sort((a, b) => b.change - a.change || b.points - a.points).slice(0, 3);
  const fallers = moves.filter((x) => x.change < 0).sort((a, b) => a.change - b.change || a.points - b.points).slice(0, 3);

  /* transfers: net points of all of a manager's moves this week. Wildcard and Free Hit weeks are left out. */
  const txNet = w.rows.filter((r) => !SQUAD_CHIPS.has(r.chip) && r.transfers.length)
    .map((r) => ({ ...label(r.m), moves: r.transfers.length, net: sum(r.transfers.map((t) => t.net)), hit: r.hit, detail: r.transfers.map((t) => `${t.out} (${t.outPts}) out, ${t.in} (${t.inPts}) in`) }));
  const bestTx = txNet.slice().sort((a, b) => b.net - a.net)[0] || null;
  const worstTx = txNet.slice().sort((a, b) => a.net - b.net)[0] || null;

  /* league transfers in and out this week, all managers */
  const tIn = {}, tOut = {};
  /* Wildcard and Free Hit squads are left out: they are rebuilds, not transfer decisions. */
  w.rows.filter((r) => !SQUAD_CHIPS.has(r.chip)).forEach((r) => r.m.transfers.filter((t) => t[2] === g).forEach((t) => { tIn[t[0]] = (tIn[t[0]] || 0) + 1; tOut[t[1]] = (tOut[t[1]] || 0) + 1; }));
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1] || pname(S, +a[0]).localeCompare(pname(S, +b[0]))).slice(0, n).map(([el, c]) => ({ player: pname(S, +el), club: club(+el), count: c }));

  /* ownership: in the 15-man squad for this gameweek */
  const own = {}, capN = {};
  S.M.forEach((m) => { if (!m.picks) return; m.picks.picks.forEach((p) => { own[p[0]] = (own[p[0]] || 0) + 1; if (p[3]) capN[p[0]] = (capN[p[0]] || 0) + 1; }); });
  const ownership = Object.entries(own).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([el, c]) => ({ player: pname(S, +el), club: club(+el), owners: c, share: pct(c) }));
  const capTop = Object.entries(capN).sort((a, b) => b[1] - a[1])[0];

  /* season captaincy: the points the armband actually delivered, triple captain included */
  const capSeason = S.M.map((m) => ({ ...label(m), points: sum((m.captains || []).filter((c) => c[0] <= g).map((c) => c[3])), weeks: (m.captains || []).filter((c) => c[0] <= g).length }))
    .filter((x) => x.weeks > 0);
  const capBest = capSeason.slice().sort((a, b) => b.points - a.points)[0] || null;
  const capWorst = capSeason.slice().sort((a, b) => a.points - b.points)[0] || null;

  /* season transfers and squad value */
  const seasonTx = S.M.map((m) => ({ ...label(m), transfers: sum([...m.hist.values()].filter((h) => h.ev <= g).map((h) => h.tx)) })).sort((a, b) => b.transfers - a.transfers)[0];
  const value = S.M.map((m) => { const h = m.hist.get(g); return h ? { ...label(m), value: h.value / 10 } : null; }).filter(Boolean).sort((a, b) => b.value - a.value)[0];

  /* chips by type */
  const chipGroups = {};
  w.rows.filter((r) => r.chip).forEach((r) => {
    const k = r.chipLabel;
    (chipGroups[k] = chipGroups[k] || []).push({ ...label(r.m), points: r.pts, extra: r.chipGain, on: r.chip === "3xc" && r.cap && r.cap.effective ? r.cap.effective.name : null });
  });
  const chips = Object.entries(chipGroups).map(([chip, list]) => {
    const s = list.slice().sort((a, b) => b.points - a.points);
    const ons = {}; list.forEach((x) => x.on && (ons[x.on] = (ons[x.on] || 0) + 1));
    return { chip, managers: list.length, best: s[0], worst: s.length > 1 ? s[s.length - 1] : null, triple_captain_on: Object.keys(ons).length ? ons : null,
      note: chip === "Wildcard" ? "extra = points against what the old team would have scored" : chip === "Triple Captain" ? "extra = the third helping of the captain's points" : chip === "Bench Boost" ? "extra = points from the bench" : null };
  });

  /* players: facts for the Players Column */
  const fixtureOf = (el) => {
    const t = (S.P.get(el) || {}).team;
    const f = (S.b.gw_fixtures || []).filter((x) => x[0] === t || x[1] === t);
    return f.map((x) => x[0] === t ? `${teamShort(S, x[1])} (H) ${x[2] ?? "?"}-${x[3] ?? "?"}` : `${teamShort(S, x[0])} (A) ${x[3] ?? "?"}-${x[2] ?? "?"}`).join(", ");
  };
  const player = (el) => el && { player: pname(S, +el), club: club(+el), ...stat(+el), fixture: fixtureOf(+el), league_owners: own[el] || 0, league_captains: capN[el] || 0 };
  const owned = Object.keys(own).map(Number).sort((a, b) => stat(b).pts - stat(a).pts);
  const tcRows = w.rows.filter((r) => r.chip === "3xc" && r.cap && r.cap.effective);
  const capRows = w.rows.filter((r) => r.cap && r.cap.effective && r.cap.effective.mult === 2);
  const globalFav = [...S.P.values()].filter((p) => p.raw && p.raw[13] != null).sort((a, b) => b.raw[13] - a.raw[13])[0];
  const leagueFav = Object.entries(tIn).sort((a, b) => b[1] - a[1])[0];

  const T = w.table;
  return {
    league: S.b.league.name, gameweek: g, final: w.final, managers: N,
    intro: { average_after_hits: r1(mean(scores)), median, managers_90_plus: scores.filter((x) => x >= 90).length, top_scorer: w.byPts[0] && { ...label(w.byPts[0].m), points: w.byPts[0].pts, hit: w.byPts[0].hit },
      global_average: w.globalAvg, league_average_before_hits: w.leagueAvg, league_minus_global_before_hits: w.globalAvg != null ? r1(w.leagueAvg - w.globalAvg) : null },
    table_top3: T.slice(0, 3).map((r, i) => ({ rank: r.rank, ...label(r.m), total: r.total, week_points: r.pts, behind_leader: T[0].total - r.total, moved: (moves.find((x) => x.manager === r.m.name) || {}).change ?? 0 })),
    manager_of_the_week: w.byPts[0] && { ...label(w.byPts[0].m), points: w.byPts[0].pts, transfers: w.byPts[0].tx, hit: w.byPts[0].hit, chip: w.byPts[0].chipLabel, places_moved: (moves.find((x) => x.manager === w.byPts[0].m.name) || {}).change ?? 0 },
    biggest_risers: risers, biggest_fallers: fallers,
    chips,
    highlights: {
      manager_of_the_week: w.byPts[0] && { ...label(w.byPts[0].m), value: `${w.byPts[0].pts} pts` },
      biggest_rise: risers[0] && { team: risers[0].team, manager: risers[0].manager, value: `+${risers[0].change}` },
      biggest_fall: fallers[0] && { team: fallers[0].team, manager: fallers[0].manager, value: `${fallers[0].change}` },
      best_transfers_this_week: bestTx && bestTx.net > 0 && { team: bestTx.team, manager: bestTx.manager, value: `${bestTx.net} net pts` },
      worst_transfers_this_week: worstTx && worstTx.net < 0 && { team: worstTx.team, manager: worstTx.manager, value: `${worstTx.net} net pts` },
      most_points_on_bench_this_week: w.benchKing && w.benchKing.bench > 0 && { ...label(w.benchKing.m), value: `${w.benchKing.bench} pts` },
      most_transfers_this_season: seasonTx && { team: seasonTx.team, manager: seasonTx.manager, value: `${seasonTx.transfers} transfers` },
      best_team_value: value && { team: value.team, manager: value.manager, value: `£${value.value.toFixed(1)}M` },
      best_captain_picker: capBest && { team: capBest.team, manager: capBest.manager, value: `${capBest.points} pts` },
      worst_captain_picker: capWorst && { team: capWorst.team, manager: capWorst.manager, value: `${capWorst.points} pts` },
    },
    transfer_detail: { best: bestTx, worst: worstTx },
    player_highlights: {
      most_captained: capTop && { player: pname(S, +capTop[0]), value: `${Math.round(capTop[1] / N * 100)}% (${capTop[1]}/${N})` },
      most_owned: ownership[0] && { player: ownership[0].player, value: ownership[0].share },
      most_transferred_in: leagueFav && { player: top(tIn, 10).filter((x) => x.count === leagueFav[1]).map((x) => x.player).join(", "), value: `${leagueFav[1]}${top(tIn, 10).filter((x) => x.count === leagueFav[1]).length > 1 ? " each" : ""}` },
      most_transferred_out: Object.keys(tOut).length && { player: top(tOut, 1)[0].player, value: `${top(tOut, 1)[0].count} out` },
    },
    transfers_in_top5: top(tIn, 5), transfers_out_top5: top(tOut, 5), ownership_top10: ownership,
    players: {
      most_captained: capTop && { ...player(capTop[0]), captained_by: capTop[1], triple_captained_by: tcRows.filter((r) => r.cap.effective.name === pname(S, +capTop[0])).length,
        points_per_captain: stat(+capTop[0]).pts * 2, points_per_triple_captain: stat(+capTop[0]).pts * 3 },
      top_scorers_owned_in_league: owned.slice(0, 5).map(player),
      league_most_bought: leagueFav && { ...player(leagueFav[0]), bought_by: leagueFav[1] },
      /* FPL only gives global transfer counts for the open transfer window, not a finished gameweek, so there is no global most-bought figure. */
      differentials: w.differentials.map((d) => ({ player: d.player, club: d.team, points: d.pts, only_starter: d.m.name })),
      captains_used: capRows.length,
    },
  };
}

/* ------------------------------------------------------------ number check */

/* Every number in the write-up should appear somewhere in the data it was
   given. Returns the ones that don't, for a human to look at. */
function numberCheck(text, payload) {
  const known = new Set();
  const add = (x) => { const n = Number(x); if (Number.isFinite(n)) { known.add(n); known.add(Math.abs(n)); known.add(r1(n)); known.add(Math.round(n)); } };
  const walk = (v) => {
    if (v == null) return;
    if (typeof v === "number") add(v);
    else if (typeof v === "string") (v.match(/-?\d+(?:\.\d+)?/g) || []).forEach(add);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(payload);
  for (let i = 0; i <= 4; i++) known.add(i); /* small counts ("two managers") are safe */
  const found = (text.match(/(?<![\w.£])-?\d+(?:\.\d+)?/g) || []).map(Number);
  const bad = [...new Set(found.filter((n) => !known.has(n) && !known.has(Math.abs(n))))];
  return { checked: found.length, unmatched: bad };
}

/* ------------------------------------------------------------ demo league */

function mulberry(seed) {
  return function () { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function demoBundle() {
  const R = mulberry(20261028);
  const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  const norm = (m, s) => { let u = 0, v = 0; while (!u) u = R(); while (!v) v = R(); return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const clubs = [["ASH", "Ashford Rovers"], ["BRK", "Brookmere"], ["CAL", "Caldwell Town"], ["DUN", "Dunmore"], ["ELM", "Elmbridge"], ["FEN", "Fenwick United"],
    ["GRA", "Grantham Vale"], ["HAR", "Harrowgate"], ["IVY", "Ivybridge"], ["KES", "Kestrel Park"], ["LYN", "Lynford"], ["MAR", "Marlow Athletic"],
    ["NOR", "Northcote"], ["OAK", "Oakhurst"], ["PEN", "Penrith Albion"], ["QUA", "Quarry Bank"], ["RAV", "Ravenscar"], ["STO", "Stonebridge"],
    ["THO", "Thornbury"], ["WES", "Westmarch"]];
  const teams = clubs.map((c, i) => [i + 1, c[0], c[1]]);
  const strength = teams.map(() => R());
  const syl = ["Ad", "Bel", "Cor", "Dal", "Ek", "Far", "Gil", "Hal", "Ish", "Jor", "Kal", "Lom", "Mar", "Nor", "Ov", "Pel", "Quin", "Ros", "Sal", "Tor", "Ul", "Var", "Wen", "Yar", "Zel"];
  const end = ["ani", "ez", "son", "ley", "ovic", "ard", "ini", "ton", "eau", "ski", "ham", "o", "ers", "ic", "well"];
  const used = new Set();
  const nm = () => { let n; do n = pick(syl) + pick(end); while (used.has(n)); used.add(n); return n; };
  const elements = [];
  let id = 1;
  const layout = { 1: 2, 2: 5, 3: 5, 4: 3 }, priceBase = { 1: 45, 2: 45, 3: 55, 4: 60 };
  teams.forEach((t, ti) => {
    for (const pos of [1, 2, 3, 4]) for (let k = 0; k < layout[pos]; k++) {
      const q = Math.max(0, Math.min(1, strength[ti] * 0.6 + R() * 0.6 - (k > 2 ? 0.25 : 0)));
      const cost = priceBase[pos] + Math.round(q * (pos >= 3 ? 70 : 20) / 5) * 5;
      const starter = pos === 1 ? k === 0 : k < (pos === 4 ? 2 : 4);
      const mins = starter ? ri(600, 810) : ri(0, 260);
      const ppg = Math.max(0, r1(1.5 + q * (pos >= 3 ? 5 : 3) + norm(0, 0.6)));
      const status = R() < 0.05 ? (R() < 0.5 ? "d" : "i") : "a";
      elements.push([id++, nm(), t[0], pos, cost, Math.max(0, r1(ppg + norm(0, 1.4))), ppg, mins, status,
        status === "a" ? null : status === "d" ? 75 : 0, status === "d" ? "Knock - 75% chance of playing" : status === "i" ? "Hamstring injury - unknown return date" : "",
        r1(Math.max(0.1, q * q * 45 + R() * 3)), Math.round(ppg * mins / 90)]);
    }
  });
  const gw = 9;
  const events = [];
  for (let g = 1; g <= 38; g++) events.push({ id: g, avg: g <= gw ? Math.round(norm(52, 7)) : null, high: g <= gw ? ri(110, 145) : null, finished: g <= gw, checked: g <= gw, current: g === gw, next: g === gw + 1, deadline: null });
  const fixtures = [];
  for (let g = gw + 1; g <= gw + 8; g++) {
    const order = teams.map((t) => t[0]).sort(() => R() - 0.5);
    for (let i = 0; i < 20; i += 2) {
      const h = order[i], a = order[i + 1];
      const diff = (x) => Math.max(1, Math.min(5, Math.round(1 + strength[x - 1] * 4)));
      fixtures.push([g, h, a, diff(a), diff(h)]);
    }
  }
  const live = {};
  elements.forEach((e) => { const starter = e[7] > 400; const mins = starter ? (R() < 0.85 ? 90 : ri(20, 70)) : (R() < 0.3 ? ri(5, 30) : 0); const pts = mins ? Math.max(1, Math.round(norm(e[6], 2.6))) : 0; if (mins || pts) live[e[0]] = [pts, mins]; });
  const lp = (el) => (live[el] || [0])[0];
  const names = ["Priya Nair", "Tom Okafor", "Hannah Reid", "Marcus Chen", "Ellie Fraser", "Sam Patel", "Jonny Burke", "Aisha Mensah", "Callum Grant", "Leah Murray", "Dev Sharma", "Rory McLeod"];
  const tnames = ["Nair Necessities", "Okafor Granted", "Reid Alert", "Chen Reaction", "Fraser Rangers", "Patel Power", "Burke Lane FC", "Mensah Sana", "Grant Thy Wish", "Murray Christmas", "Sharma Chameleon", "McLeod of Hope"];
  const byPos = (p) => elements.filter((e) => e[3] === p);
  const managers = names.map((n, mi) => {
    const skill = norm(0, 4);
    const squad = [], clubs = {};
    for (const [p, c] of [[1, 2], [2, 5], [3, 5], [4, 3]]) {
      const pool = byPos(p).sort(() => R() - 0.5).sort((a, b) => b[12] - a[12] + norm(0, 25));
      for (const e of pool) { if (squad.filter((x) => x[3] === p).length >= c) break; if ((clubs[e[2]] || 0) >= 3) continue; clubs[e[2]] = (clubs[e[2]] || 0) + 1; squad.push(e); }
    }
    const xi = [squad[0], ...squad.slice(2, 6), ...squad.slice(7, 11), ...squad.slice(12, 14)];
    const bench = [squad[1], squad[6], squad[11], squad[14]];
    const order = [...xi, ...bench];
    const capIdx = 5 + ri(0, 3);
    const chips = [];
    if (R() < 0.4) chips.push(["wildcard", ri(4, 8)]);
    if (mi === 3) chips.push(["3xc", gw]);
    if (mi === 7) chips.push(["bboost", gw]);
    const history = [];
    let total = 0, orank = ri(800000, 4500000);
    for (let g = 1; g <= gw; g++) {
      const tx = g === 1 ? 0 : ri(0, R() < 0.2 ? 3 : 1);
      const cost = tx > 1 && R() < 0.7 ? (tx - 1) * 4 : 0;
      let pts = Math.max(18, Math.round(norm(events[g - 1].avg + skill, 13)));
      const benchPts = ri(0, 14);
      if (g === gw) {
        pts = sum(order.slice(0, 11).map((e, i) => lp(e[0]) * (i === capIdx ? (mi === 3 ? 3 : 2) : 1)));
        if (mi === 7) pts += sum(bench.map((e) => lp(e[0])));
      }
      total += pts - cost;
      orank = Math.max(20000, Math.round(orank * Math.exp(-(pts - events[g - 1].avg) / 40)));
      history.push([g, pts, total, orank, ri(0, 25), 1000 + g * 2, tx, cost, g === gw ? (mi === 7 ? 0 : sum(bench.map((e) => lp(e[0])))) : benchPts]);
    }
    const pk = { chip: mi === 3 ? "3xc" : mi === 7 ? "bboost" : null, bank: ri(0, 25), picks: order.map((e, i) => [e[0], i + 1, i < 11 ? (i === capIdx ? (mi === 3 ? 3 : 2) : 1) : (mi === 7 ? 1 : 0), i === capIdx ? 1 : 0, i === capIdx + 1 ? 1 : 0]) };
    const transfers = [];
    const h9 = history[gw - 1];
    for (let k = 0; k < h9[6]; k++) { const inn = order[ri(0, 10)][0]; const out = pick(byPos(S_pos(elements, inn))).at(0); transfers.push([inn, out, gw]); }
    return { entry: 1000 + mi, name: n, team: tnames[mi], history, chips, picks: pk, prev: pk, squad: pk, transfers };
  });
  return { v: 1, demo: true, fetched: "2026-10-28T09:00+00:00", league: { id: 0, name: "Example League" }, gw, squad_gw: gw, events, teams, elements, fixtures, live, managers };
}
function S_pos(elements, id) { const e = elements.find((x) => x[0] === id); return e ? e[3] : 1; }

if (typeof module !== "undefined") module.exports = { build, validateBundle, tableAt, rankOf, spanStats, insights, gameweek, advise, freeTransferEstimate, payloadWeekly, payloadTrend, payloadAdvice, payloadNewsletter, playerInsights, numberCheck, demoBundle, leagueAvg, avgOf, ordinal, POS, CHIP };
