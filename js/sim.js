// The town simulation: pure functions on a plain state object, so it saves as JSON and can be tested.
import { B, TECH, EVENTS, DECISIONS, ACHIEVEMENTS, GOALS, ERAS, MAP_SIZE, START_MONEY, SEASONS, SEASON_DAYS, HOURS, OWN_START, PLOTS, PLOT_PRICES, UPKEEP_RULES, PROVINCE_FEES, YEAR_HOURS, LOANS, BIZ_LEVELS, BIZ_UP, bizLevel, PRAYERS, DISTRICT_NAMES, ELECTION_GRANT, GROUND, FILL_COST, CHAINS, MAT, ROAD_IDS, TRAFFIC, TERRAINS } from "./data.js";

const N = MAP_SIZE;
export const idx = (x, y) => y * N + x;
export const inMap = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Small seeded random generator so a map is the same every time it loads. */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// ---------- land ----------

const O = OWN_START, E = N - OWN_START;
/** Which plot a tile belongs to ("" for the land the town starts with). The corners go clockwise. */
export function plotAt(x, y) {
  if (x >= O && x < E && y >= O && y < E) return "";
  if (y < O && x < E) return "n";
  if (x >= E && y < E) return "e";
  if (y >= E && x >= O) return "s";
  return "w";
}
export const owns = (s, x, y) => { const p = plotAt(x, y); return !p || !!s.owned?.[p]; };
export const plotPrice = (s) => PLOT_PRICES[Math.min(PLOT_PRICES.length - 1, PLOTS.filter((p) => s.owned?.[p.id]).length)];
export function buyPlot(s, id) {
  if (!PLOTS.some((p) => p.id === id)) return "ما فيه أرض كذا";
  if (s.owned[id]) return "الأرض لك من قبل";
  const price = plotPrice(s);
  if (s.money < price) return "ما يكفي المال";
  s.money -= price;
  s.owned[id] = true;
  return "";
}

/** Sand, a winding wadi and scattered rocks over the whole map, shaped by the kind of land. */
function makeLand(r, terrain = "wadi") {
  const tiles = Array.from({ length: N * N }, () => ({ t: "sand", b: null }));
  const shape = { wadi: [1, 0.053, 5], mountain: [0, 0.16, 2], dunes: [-1, 0.008, 2], meadow: [1, 0.03, 9], bigwadi: [2, 0.04, 4], plain: [1, 0.035, 5] }[terrain] || [1, 0.053, 5];
  const [half, rocks, faydas] = shape;
  // A dry wadi winding across the land: fertile ground for farms (none in the dunes).
  if (half >= 0) {
    let y = Math.floor(N * 0.3 + r() * N * 0.2);
    for (let x = 0; x < N; x++) {
      for (let w = -half; w <= half; w++) if (inMap(x, y + w)) tiles[idx(x, y + w)].t = "wadi";
      if (r() < 0.35) y = clamp(y + (r() < 0.5 ? -1 : 1), 2, N - 3);
    }
  }
  // Rocks here and there (cost a little to clear); mountain land is full of them.
  for (let i = 0; i < N * N * rocks; i++) {
    const x = Math.floor(r() * N), yy = Math.floor(r() * N), t = tiles[idx(x, yy)];
    if (t.t === "sand") t.t = "rock";
  }
  addFayda(tiles, r, faydas);
  return tiles;
}

// ---------- new game ----------

export function newGame(seed = Math.floor(Math.random() * 1e9), opts = {}) {
  const r = rng(seed);
  const terrain = opts.terrain || "wadi";
  const tiles = makeLand(r, terrain);
  // The old settlement in the middle: a lane, three tents, a well and palms on the wadi.
  const cx = Math.floor(N / 2), cy = Math.floor(N / 2) + 3;
  const put = (x, yy, id) => { const t = tiles[idx(x, yy)]; t.t = t.t === "rock" ? "sand" : t.t; t.b = { id, lvl: 0, res: id === "house" ? 3 : 0 }; };
  for (let x = cx - 3; x <= cx + 3; x++) put(x, cy, "road");
  put(cx - 2, cy - 1, "house"); put(cx, cy - 1, "house"); put(cx + 2, cy - 1, "house");
  put(cx - 1, cy + 1, "well");
  // Two palm groves on the nearest wadi ground the town owns (on sand if there is none).
  const spots = [];
  for (let yy = O; yy < E; yy++) for (let x = O; x < E; x++) if (!tiles[idx(x, yy)].b && tiles[idx(x, yy)].t !== "rock") spots.push([x, yy]);
  spots.sort(([ax, ay], [bx, by]) => (tiles[idx(ax, ay)].t === "wadi" ? 0 : 100) + Math.hypot(ax - cx, ay - cy) - (tiles[idx(bx, by)].t === "wadi" ? 0 : 100) - Math.hypot(bx - cx, by - cy));
  for (const [x, yy] of spots.slice(0, 2)) put(x, yy, "palms");
  return {
    v: 1, hv: 3, fv: 1, size: N, owned: {}, seed, day: 3, // hour 3 of day 1: two hours after sunrise
    name: opts.name || "الرافعية", site: opts.site || "main", terrain,
    aquifer: terrain === "mountain" ? 65 : 100,
    money: opts.money ?? START_MONEY, tax: 10, era: 0, pop: 9, happy: 55, tiles,
    tech: {}, research: null, events: [], goal: 0, history: [], log: [], savedAt: Date.now(), cam: null
  };
}

// ---------- building ----------

export const ROCK_CLEAR = 40;

// s.day counts hours (one step each). These turn it into days, hours and seasons.
export const dayOf = (hour) => Math.floor(Math.max(0, hour - 1) / HOURS) + 1;
export const hourOf = (hour) => Math.max(0, hour - 1) % HOURS;

/** Which season an hour falls in, which day of it, how far through it (0..1), and which year. */
export function seasonOf(hour) {
  const h = Math.max(0, hour - 1), day = Math.floor(h / HOURS), i = Math.floor(day / SEASON_DAYS) % 4;
  const inSeason = day % SEASON_DAYS;
  return { i, ...SEASONS[i], dayIn: inSeason + 1, left: SEASON_DAYS - inSeason, progress: (inSeason * HOURS + (h % HOURS)) / (SEASON_DAYS * HOURS), year: Math.floor(day / (SEASON_DAYS * 4)) + 1 };
}

/**
 * Faydah (فيضة): low ground where rainwater gathers. In spring it fills with annual plants and
 * flowers, and people go out to enjoy it. A few patches away from the old settlement.
 */
function addFayda(tiles, r, count = 5) {
  const cx = Math.floor(N / 2), cy = Math.floor(N / 2) + 3;
  let made = 0;
  for (let tries = 0; tries < 300 && made < count; tries++) {
    const x = 3 + Math.floor(r() * (N - 6)), y = 3 + Math.floor(r() * (N - 6));
    if (Math.hypot(x - cx, y - cy) < 8 || tiles[idx(x, y)].t !== "sand" || tiles[idx(x, y)].b) continue;
    const size = 7 + Math.floor(r() * 6), cells = [[x, y]];
    for (let k = 0; k < size * 3 && cells.length < size; k++) {
      const [bx, by] = cells[Math.floor(r() * cells.length)];
      const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(r() * 4)];
      const nx = bx + dx, ny = by + dy;
      if (!inMap(nx, ny) || tiles[idx(nx, ny)].t !== "sand" || tiles[idx(nx, ny)].b || cells.some(([a, b]) => a === nx && b === ny)) continue;
      cells.push([nx, ny]);
    }
    for (const [a, b] of cells) tiles[idx(a, b)].t = "fayda";
    made++;
  }
}

export function techUnlocked(s, def) { return !def.tech || s.tech[def.tech]; }

/** Why a building cannot go here ("" when it can). */
export function cantBuild(s, x, y, id) {
  const def = B[id];
  if (!inMap(x, y)) return "خارج الأرض";
  const t = s.tiles[idx(x, y)];
  if (!owns(s, x, y)) return "الأرض هذي مو لك: اضغط عليها عشان تشتريها";
  if (def.era > s.era) return `تحتاج الرافعية تصير ${ERAS[def.era].name}`;
  if (!techUnlocked(s, def)) return `تحتاج بحث «${TECH[def.tech].name}»`;
  if (def.unique && s.tiles.some((t) => t.b?.id === id)) return "عندك واحد منه";
  if (t.b) {
    // a better road can be laid over an old one
    if (ROAD_IDS.includes(id) && id !== "road" && ROAD_IDS.includes(t.b.id) && t.b.id !== id) return s.money < def.cost ? "ما يكفي المال" : "";
    return "المكان مشغول";
  }
  if (t.t === "lake") return "هذي بحيرة السد";
  if (def.onWadi && t.t !== "wadi") return "السد ينبني على الوادي بس";
  if (def.onRock && t.t !== "rock") return "الكسارة تنبني على الصخور";
  const cost = def.cost + (t.t === "rock" && !def.onRock ? ROCK_CLEAR : 0);
  if (s.money < cost) return "ما يكفي المال";
  return "";
}

export function build(s, x, y, id) {
  const why = cantBuild(s, x, y, id);
  if (why) return why;
  const t = s.tiles[idx(x, y)];
  const keepRock = B[id].onRock;
  s.money -= B[id].cost + (t.t === "rock" && !keepRock ? ROCK_CLEAR : 0);
  if (t.t === "rock" && !keepRock) t.t = "sand";
  t.b = { id, lvl: 0, res: 0, day: s.day, cond: 100 };
  if (B[id].buildHours) t.b.build = B[id].buildHours; // a grand project: a building site for a while
  return "";
}

// ---------- paths ----------
/** The road tile beside a building (its door), or -1. */
export function doorOf(s, i) {
  const x = i % N, y = Math.floor(i / N);
  for (const [dx, dy] of near4) if (inMap(x + dx, y + dy) && isRoad(s.tiles[idx(x + dx, y + dy)])) return idx(x + dx, y + dy);
  return -1;
}
/** The shortest way along the roads between two road tiles (a list of tiles), or null. */
export function roadPath(s, from, to) {
  if (from < 0 || to < 0) return null;
  const prev = new Int32Array(N * N).fill(-2); prev[from] = -1;
  const q = [from];
  for (let h = 0; h < q.length && prev[to] === -2; h++) {
    const j = q[h], x = j % N, y = Math.floor(j / N);
    for (const [dx, dy] of near4) { const xx = x + dx, yy = y + dy; if (!inMap(xx, yy)) continue; const k = idx(xx, yy); if (prev[k] === -2 && isRoad(s.tiles[k])) { prev[k] = j; q.push(k); } }
  }
  if (prev[to] === -2) return null;
  const out = [];
  for (let j = to; j !== -1; j = prev[j]) out.push(j);
  return out.reverse();
}

// ---------- traffic ----------
/**
 * Rush hour: from every home the residents drive to the nearest workplace along the roads (a
 * multi-source search from the workplaces' doors gives every road tile its way to work). Each road
 * tile then carries a load against its capacity; where the load is more than it can take, it jams.
 */
function traffic(s, a) {
  const load = new Float32Array(N * N), cap = new Float32Array(N * N), cong = new Float32Array(N * N);
  const next = new Int32Array(N * N).fill(-1), dist = new Int32Array(N * N).fill(-1), src = new Int32Array(N * N).fill(-1);
  a.workOf = new Int32Array(N * N).fill(-1);
  const q = [];
  a.parkingNear = new Uint8Array(N * N);
  s.tiles.forEach((t, i) => {
    if (!t.b) return;
    const def = B[t.b.id];
    if (isRoad(t)) {
      const x = i % N, y = Math.floor(i / N);
      const ways = near4.filter(([dx, dy]) => inMap(x + dx, y + dy) && isRoad(s.tiles[idx(x + dx, y + dy)])).length;
      cap[i] = (def.cap || 45) * (ways >= 3 && !def.junction ? TRAFFIC.crossing : 1);
      return;
    }
    if (t.b.id === "parking") {
      const x = i % N, y = Math.floor(i / N);
      for (let yy = y - 2; yy <= y + 2; yy++) for (let xx = x - 2; xx <= x + 2; xx++) if (inMap(xx, yy)) a.parkingNear[idx(xx, yy)] = 1;
    }
    // workplaces: their road doors are where the trips end
    if (def.jobs && t.b.id !== "house" && t.b.works !== false && !(t.b.build > 0)) {
      const x = i % N, y = Math.floor(i / N);
      for (const [dx, dy] of near4) { const k = idx(x + dx, y + dy); if (inMap(x + dx, y + dy) && isRoad(s.tiles[k]) && dist[k] < 0) { dist[k] = 0; src[k] = i; q.push(k); } }
    }
  });
  for (let h = 0; h < q.length; h++) {
    const j = q[h], x = j % N, y = Math.floor(j / N);
    for (const [dx, dy] of near4) {
      const xx = x + dx, yy = y + dy;
      if (!inMap(xx, yy)) continue;
      const k = idx(xx, yy);
      if (dist[k] < 0 && isRoad(s.tiles[k])) { dist[k] = dist[j] + 1; next[k] = j; src[k] = src[j]; q.push(k); }
    }
  }
  let trips = 0;
  s.tiles.forEach((t, i) => {
    if (t.b?.id !== "house" || !t.b.res) return;
    const x = i % N, y = Math.floor(i / N);
    let door = -1;
    for (const [dx, dy] of near4) { const k = idx(x + dx, y + dy); if (inMap(x + dx, y + dy) && dist[k] >= 0 && (door < 0 || dist[k] < dist[door])) door = k; }
    if (door < 0) return;
    a.workOf[i] = src[door];
    const cars = t.b.res * TRAFFIC.perResident;
    trips += cars;
    for (let j = door, n = 0; j >= 0 && n < 200; j = next[j], n++) load[j] += cars;
  });
  // parking takes cars off the roads around the shops
  for (let i = 0; i < N * N; i++) if (load[i] && a.parkingNear[i]) load[i] *= 0.8;
  let jamWeighted = 0, jammed = 0;
  for (let i = 0; i < N * N; i++) {
    if (!cap[i] || !load[i]) continue;
    cong[i] = Math.max(0, Math.min(2, load[i] / cap[i] - 1));
    jamWeighted += cong[i] * load[i];
    if (cong[i] > 0.3) jammed++;
  }
  a.trafficLoad = load; a.trafficCap = cap; a.trafficCong = cong;
  a.trips = Math.round(trips);
  a.jam = load.reduce((n, v) => n + v, 0) ? jamWeighted / load.reduce((n, v) => n + v, 0) : 0;
  a.jammedRoads = jammed;
  // living on a jammed street is no fun
  s.tiles.forEach((t, i) => {
    if (t.b?.id !== "house") return;
    const x = i % N, y = Math.floor(i / N);
    for (const [dx, dy] of near4) { const k = idx(x + dx, y + dy); if (inMap(x + dx, y + dy) && cong[k] > 0.5) { a.local[i] -= 4; break; } }
  });
}

// ---------- production chains ----------
/** Road networks: each road tile gets the number of the network it belongs to. */
export function roadNets(s) {
  const net = new Int32Array(N * N).fill(-1);
  let n = 0;
  for (let i = 0; i < N * N; i++) {
    if (net[i] >= 0 || !isRoad(s.tiles[i])) continue;
    const stack = [i]; net[i] = n;
    while (stack.length) {
      const j = stack.pop(), x = j % N, y = Math.floor(j / N);
      for (const [dx, dy] of near4) {
        const xx = x + dx, yy = y + dy;
        if (!inMap(xx, yy)) continue;
        const k = idx(xx, yy);
        if (net[k] < 0 && isRoad(s.tiles[k])) { net[k] = n; stack.push(k); }
      }
    }
    n++;
  }
  return net;
}
/** The road networks a building touches. */
function netsOf(net, i) {
  const out = new Set(), x = i % N, y = Math.floor(i / N);
  for (const [dx, dy] of near4) if (inMap(x + dx, y + dy) && net[idx(x + dx, y + dy)] >= 0) out.add(net[idx(x + dx, y + dy)]);
  return out;
}
/**
 * Which producers feed which factory, by road. Each producer sends its goods to one factory of its
 * chain (the first that still has room). Returns the links (for the trucks) and per factory how full it runs.
 */
export function chainLinks(s, net = roadNets(s)) {
  const links = [], at = new Map();
  for (const c of CHAINS) {
    const factories = [], producers = [];
    s.tiles.forEach((t, i) => {
      if (!t.b || t.b.build > 0 || t.b.ruin) return;
      if (t.b.id === c.to) factories.push({ i, nets: netsOf(net, i), got: 0 });
      else if (t.b.id === c.from) producers.push({ i, nets: netsOf(net, i) });
    });
    for (const p of producers) {
      const f = factories.find((f) => f.got < c.need && [...p.nets].some((n) => f.nets.has(n)));
      if (f) { f.got++; links.push({ from: p.i, to: f.i, chain: c.id, cargo: c.cargo }); }
    }
    for (const f of factories) at.set(f.i, { chain: c, got: f.got, fill: Math.min(1, f.got / c.need) });
  }
  return { links, at };
}
function chainsInto(s, a) {
  const { links, at } = chainLinks(s);
  a.chainLinks = links; a.chainAt = at;
  // materials made this hour
  let made = 0;
  s.tiles.forEach((t, i) => {
    if (!t.b?.works && t.b?.works !== undefined) return;
    if (t.b?.id === "quarry" && !(t.b.build > 0)) made += MAT.quarry * condFactor(t.b);
    if (t.b?.id === "blockfactory" && !(t.b.build > 0)) made += MAT.block * (at.get(i)?.fill || 0) * condFactor(t.b);
  });
  a.matMade = made * (0.3 + 0.7 * (a.staffing ?? 1));
}

// ---------- dams, lakes and groundwater ----------
/** Behind every finished dam (upstream, to the west) the empty wadi becomes a lake; without a dam it dries back. */
export function updateLake(s) {
  const want = new Set();
  s.tiles.forEach((t, i) => {
    if (t.b?.id !== "dam" || t.b.build > 0) return;
    const x = i % N, y = Math.floor(i / N);
    for (let xx = x - 4; xx < x; xx++) for (let yy = y - 2; yy <= y + 2; yy++) {
      if (!inMap(xx, yy)) continue;
      const u = s.tiles[idx(xx, yy)];
      if ((u.t === "wadi" || u.t === "lake") && !u.b) want.add(idx(xx, yy));
    }
  });
  let changed = false;
  s.tiles.forEach((t, i) => {
    if (want.has(i) && t.t !== "lake") { t.t = "lake"; changed = true; }
    else if (!want.has(i) && t.t === "lake") { t.t = "wadi"; changed = true; }
  });
  return changed;
}
/** Fill a tile of wadi with earth: safe from floods, but no longer fertile. */
export function fillWadi(s, x, y) {
  if (!inMap(x, y) || !owns(s, x, y)) return "الأرض هذي مو لك";
  const t = s.tiles[idx(x, y)];
  if (t.t !== "wadi") return "الردم على أرض الوادي بس";
  if (t.b) return "شيل اللي عليها أول";
  if (s.money < FILL_COST) return "ما يكفي المال";
  s.money -= FILL_COST; t.t = "sand";
  return "";
}
/** One hour of groundwater: pumping by wells, tanks and pivots; rain, lakes and spring refill it. */
function stepGround(s, a, raining, msgs) {
  const before = s.aquifer ?? GROUND.start;
  const share = a.waterSupply ? Math.min(1, a.groundSupply / a.waterSupply) : 0;
  const pumped = Math.min(a.waterUse, a.waterSupply) * share;
  const lakes = (s.lake || 0) > 10 ? a.count.dam : 0;
  const delta = -pumped * GROUND.pump * (s.terrain === "plain" ? 0.6 : 1) - a.count.pivot * GROUND.pivot + GROUND.base + (raining ? GROUND.rain : 0) + lakes * GROUND.lake + (seasonOf(s.day).id === "spring" ? GROUND.spring : 0);
  s.aquifer = Math.max(0, Math.min(100, before + delta));
  if (before >= GROUND.low && s.aquifer < GROUND.low) msgs.push({ kind: "event", title: "الماء الجوفي", text: `الآبار بدت تنشف: الماء الجوفي نزل لـ${Math.round(s.aquifer)}٪، والآبار تعطي أقل. ابنِ سد يجمع المطر أو خفف الضخ.` });
  if (before >= 15 && s.aquifer < 15) msgs.push({ kind: "event", title: "الماء الجوفي", text: "الماء الجوفي قرب يخلص! الآبار والخزانات صارت تعطي ثلث ماها. تحتاج سدود أو تحلية." });
  if (before < GROUND.low && s.aquifer >= GROUND.low + 5 && !s.aqBack) { s.aqBack = true; msgs.push({ kind: "goal", text: "الماء الجوفي رجع يرتفع، والآبار رجعت تعطي كامل." }); }
  if (s.aquifer < GROUND.low) s.aqBack = false;
}

// ---------- prayers ----------
/** The prayer whose time it is this town hour, or null. */
export function prayerNow(s) {
  const D = seasonOf(s.day).daylight * HOURS, h = hourOf(s.day);
  return PRAYERS.find((p) => p.at(D) === h) || null;
}

// ---------- the town's quarters ----------
/** Which quarter (0–8) a tile is in. */
export const districtOf = (i) => Math.min(2, Math.floor((Math.floor(i / N)) / (N / 3))) * 3 + Math.min(2, Math.floor((i % N) / (N / 3)));
export const districtName = (s, d) => s.districts?.[d] || DISTRICT_NAMES[d];
/** Each lived-in quarter: homes, people, happiness and what is missing there. */
export function districtStats(s, a = analyze(s)) {
  const out = DISTRICT_NAMES.map((n, d) => ({ d, name: districtName(s, d), homes: 0, pop: 0, happy: 0, dry: 0, dark: 0, noRoad: 0 }));
  s.tiles.forEach((t, i) => {
    if (t.b?.id !== "house") return;
    const o = out[districtOf(i)];
    o.homes++; o.pop += t.b.res || 0;
    o.happy += Math.max(0, Math.min(100, s.happy + (t.b.local || 0) * 0.6));
    if (t.b.works === false) o.noRoad++;
    else if (!a.watered[i]) o.dry++;
    if (a.grid && t.b.lvl >= 3 && !a.powered[i]) o.dark++;
  });
  for (const o of out) o.happy = o.homes ? Math.round(o.happy / o.homes) : 0;
  return out.filter((o) => o.homes);
}

// ---------- elections ----------
/** The share of the vote the mayor would get today (0–1). */
export function voteShare(s) {
  const r = s.record || {};
  const v = 0.2 + ((s.trust ?? 60) / 100) * 0.35 + ((s.happy - 40) / 100) * 0.6 + (r.kept || 0) * 0.02 - (r.broken || 0) * 0.04 - (s.broke ? 0.15 : s.money < 0 ? 0.05 : 0);
  return Math.max(0.05, Math.min(0.95, v));
}
/** Hours until the next election (the end of the year). */
export const hoursToElection = (s) => YEAR_HOURS - ((s.day - 1) % YEAR_HOURS);

// ---------- moving a building ----------
/** Movers' fee: a tenth of the building's price. Level, residents and condition move with it. */
export const moveCost = (b) => (b ? Math.max(5, Math.round(B[b.id].cost * 0.1)) : 0);
/** Why this building cannot move to (tx, ty), or "". */
export function moveBlocker(s, fx, fy, tx, ty) {
  const from = inMap(fx, fy) && s.tiles[idx(fx, fy)].b;
  if (!from) return "ما فيه مبنى هنا";
  if (ROAD_IDS.includes(from.id)) return "الطرق ما تنقل: أزلها وارسمها من جديد";
  if (from.build > 0) return "تحت الإنشاء: انتظر لين يخلص";
  if (!inMap(tx, ty)) return "خارج الأرض";
  if (!owns(s, tx, ty)) return "الأرض هذي مو لك";
  const t = s.tiles[idx(tx, ty)];
  if (t.b) return "المكان مشغول";
  if (t.t === "lake") return "هذي بحيرة السد";
  if (B[from.id].onWadi && t.t !== "wadi") return "السد ينبني على الوادي بس";
  if (B[from.id].onRock && t.t !== "rock") return "الكسارة تنبني على الصخور";
  if (s.money < moveCost(from) + (t.t === "rock" && !B[from.id].onRock ? ROCK_CLEAR : 0)) return "ما يكفي المال";
  return "";
}
/** Move a building to an empty tile you own. Returns why not, or "". */
export function moveBuilding(s, fx, fy, tx, ty) {
  const why = moveBlocker(s, fx, fy, tx, ty);
  if (why) return why;
  const src = s.tiles[idx(fx, fy)], dst = s.tiles[idx(tx, ty)];
  s.money -= moveCost(src.b) + (dst.t === "rock" && !B[src.b.id].onRock ? ROCK_CLEAR : 0);
  if (dst.t === "rock" && !B[src.b.id].onRock) dst.t = "sand";
  dst.b = src.b; src.b = null;
  return "";
}

/** Remove a building (a third of its price comes back) or clear a rock. */
export function demolish(s, x, y) {
  const t = s.tiles[idx(x, y)];
  if (!owns(s, x, y)) return "الأرض هذي مو لك";
  if (t.b) {
    const def = B[t.b.id];
    s.money += Math.floor(def.cost / 3);
    s.pop = Math.max(0, s.pop - (t.b.res || 0));
    t.b = null;
    return "";
  }
  if (t.t === "rock") {
    if (s.money < ROCK_CLEAR) return "ما يكفي المال";
    s.money -= ROCK_CLEAR; t.t = "sand"; return "";
  }
  return "ما فيه شي هنا";
}

// ---------- wear, repairs and insurance ----------

/** Buildings that wear out (roads and tents do not; tents are mended by their families). */
const wears = (b) => b && !ROAD_IDS.includes(b.id) && b.id !== "parking" && !(b.id === "house" && b.lvl === 0) && !(b.build > 0);
/** A worn building (below the WEAK line) works at 60%. */
export const condFactor = (b) => ((b?.cond ?? 100) < UPKEEP_RULES.weak ? 0.6 : 1);
/** What it costs to bring a building back to new. */
export const repairCost = (b) => (wears(b) ? Math.round(B[b.id].cost * UPKEEP_RULES.repair * (100 - (b.cond ?? 100)) / 100) : 0);
export function repair(s, x, y) {
  const b = s.tiles[idx(x, y)].b, cost = repairCost(b);
  if (!cost) return "ما يحتاج ترميم";
  if (s.money < cost) return "ما يكفي المال";
  s.money -= cost; b.cond = 100; b.ruin = 0;
  return "";
}
/** Repair everything that needs it (worst first) while the money lasts. Returns how many and the cost. */
export function repairAll(s) {
  const list = s.tiles.filter((t) => repairCost(t.b) > 0).sort((p, q) => (p.b.cond ?? 100) - (q.b.cond ?? 100));
  let n = 0, spent = 0;
  for (const t of list) { const c = repairCost(t.b); if (s.money < c) break; s.money -= c; spent += c; t.b.cond = 100; t.b.ruin = 0; n++; }
  return { n, spent };
}
/** A building is lost (fire, flood, collapse): insurance pays part of it back. Returns the refund. */
export function lose(s, t) {
  const refund = s.insured && t.b ? Math.round(B[t.b.id].cost * UPKEEP_RULES.insurePays) : 0;
  s.money += refund;
  t.b = null;
  return refund;
}

// ---------- analysis: what the town looks like right now ----------

const near4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const isRoad = (t) => t && t.b && ROAD_IDS.includes(t.b.id);

export function onRoad(s, x, y) {
  return near4.some(([dx, dy]) => inMap(x + dx, y + dy) && isRoad(s.tiles[idx(x + dx, y + dy)]));
}

/** Needs a road to work: homes, shops and services. Farms and utilities work on their own. */
const needsRoad = (def) => ["home", "shop", "serv"].includes(def.cat) || def.jobs && def.cat !== "farm";

// Events come from the EVENTS list, or are boosts made by a decision (they carry their own numbers).
const eventDef = (e) => (e.id === "boost" ? e : EVENTS.find((x) => x.id === e.id) || {});
export function activeEvent(s, key) {
  let m = 1;
  for (const e of s.events) { const d = eventDef(e); if (typeof d[key] === "number" && key !== "happy") m *= d[key]; }
  return m;
}
const eventHappy = (s) => s.events.reduce((a, e) => a + (eventDef(e).happy || 0), 0);

export function analyze(s) {
  const a = {
    count: Object.fromEntries(Object.keys(B).map((k) => [k, 0])), levels: B.house.levels.map(() => 0),
    waterSupply: 0, waterUse: 0, powerSupply: 0, powerUse: 0, cap: 0, jobs: 0, income: 0, farmIncome: 0,
    upkeep: 0, costs: { services: 0, utilities: 0, business: 0, sites: 0, staff: 0, cleaning: 0, waterNet: 0, roads: 0, loan: 0, insurance: 0, health: 0, theft: 0 },
    value: 0, repairBill: 0, homes: 0, connectedHomes: 0, local: new Float32Array(N * N), pollution: new Float32Array(N * N),
    services: Array.from({ length: N * N }, () => new Set())
  };
  const concrete = s.tech.concrete ? 1.25 : 1;
  const palms = [];
  const strike = s.events.some((e) => e.strike); // the council's staff are on strike
  // Water and power only reach so far from their source (a well's pipes, a generator's wires).
  a.watered = new Uint8Array(N * N); a.powered = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const b = s.tiles[idx(x, y)].b, def = b && B[b.id];
    if (!def?.reach || b.build > 0 || b.ruin) continue;
    const mark = def.water > 0 ? a.watered : def.power > 0 ? a.powered : null;
    if (!mark) continue;
    for (let yy = y - def.reach; yy <= y + def.reach; yy++) for (let xx = x - def.reach; xx <= x + def.reach; xx++)
      if (inMap(xx, yy) && Math.abs(xx - x) + Math.abs(yy - y) <= def.reach) mark[idx(xx, yy)] = 1;
  }
  a.dryHomes = 0; a.darkHomes = 0;
  a.aquifer = s.aquifer ?? GROUND.start;
  a.groundFactor = a.aquifer >= GROUND.low ? 1 : 0.35 + 0.65 * (a.aquifer / GROUND.low);
  a.groundSupply = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const t = s.tiles[idx(x, y)];
    if (!t.b) continue;
    const def = B[t.b.id];
    a.count[t.b.id]++;
    if (t.b.build > 0) { t.b.works = false; a.costs.sites += Math.round((def.upkeep || 0) / 4); continue; } // still being built
    // A bankrupt council cannot pay the people who run its services: they close.
    const works = (!needsRoad(def) || onRoad(s, x, y)) && !((s.broke || strike) && def.cat === "serv") && !(t.b.ruin > 0);
    const f = condFactor(t.b);
    const up = bizLevel(t.b);
    a.value += def.cost * (1 + (t.b.lvl && BIZ_LEVELS[t.b.id] ? BIZ_UP.slice(1, t.b.lvl + 1).reduce((n, u) => n + u.cost, 0) : 0));
    a.repairBill += repairCost(t.b);
    t.b.works = works;
    const here = idx(x, y);
    // only places the pipes and wires reach draw water and power
    const gw = t.b.id === "well" || t.b.id === "tank";
    if (gw) a.groundSupply += def.water * f * a.groundFactor;
    if (def.water > 0) a.waterSupply += def.water * f * (gw ? a.groundFactor : 1); else if (def.water && works && a.watered[here]) a.waterUse -= def.water;
    if (def.power > 0) a.powerSupply += def.power * f; else if (def.power && works && a.powered[here]) a.powerUse -= def.power;
    a.costs[def.cat === "util" ? "utilities" : def.cat === "shop" || def.cat === "farm" ? "business" : "services"] += (def.upkeep || 0) * up.upkeep;
    if (t.b.id === "house") {
      a.homes++;
      a.levels[t.b.lvl]++;
      if (works) { a.connectedHomes++; a.cap += Math.round(def.levels[t.b.lvl].cap * concrete); }
      if (a.watered[here]) a.waterUse += t.b.lvl; // bigger homes use more
      else if (works) a.dryHomes++;
      if (!a.powered[here] && works && t.b.lvl >= 3) a.darkHomes++;
    }
    if (works && def.jobs) a.jobs += Math.round(def.jobs * up.jobs);
    if (t.b.id === "palms") palms.push(t);
    // Services and nuisances spread over their radius.
    if (works && def.radius && (def.happy || def.pollute)) {
      const rad = def.radius + (up.radius || 0), cheer = (def.happy || 0) * (up.happy || 1);
      for (let yy = y - rad; yy <= y + rad; yy++) for (let xx = x - rad; xx <= x + rad; xx++) {
        if (!inMap(xx, yy) || Math.abs(xx - x) + Math.abs(yy - y) > rad) continue;
        const i = idx(xx, yy);
        if (def.happy) a.local[i] += (s.money < 0 && def.cat === "serv" ? cheer / 2 : cheer) * f;
        if (def.pollute) a.pollution[i] += def.pollute;
        if (def.service) a.services[i].add(def.service);
      }
    }
  }
  // Running the town, per hour: the council's own staff (more of them at each stage), cleaning and
  // rubbish for every resident, keeping the water network up, road repairs and street lights, loans.
  const c = a.costs;
  c.staff = ([3, 25, 90, 250][s.era] + s.pop * 0.02) * (1 + (s.staffRaise || 0));
  c.cleaning = s.pop * 0.05;
  c.waterNet = a.waterUse * 0.04;
  c.roads = a.count.road * 0.05 + a.count.asphalt * 0.15;
  c.loan = s.events.reduce((n, e) => n + (e.repay || 0), 0) + (s.loans || []).reduce((n, l) => n + l.per, 0);
  c.insurance = s.insured ? a.value * UPKEEP_RULES.insure : 0;
  // Smoke and noise next to homes make people ill: the clinic's bill.
  for (let i = 0; i < N * N; i++) { const t = s.tiles[i]; if (t.b?.id === "house" && a.pollution[i] > 0) c.health += (t.b.res || 0) * Math.min(30, a.pollution[i]) * 0.004; }
  if (s.tech.zakat) for (const k of ["services", "utilities", "business", "staff"]) c[k] *= 0.85;
  a.upkeep = Object.values(c).reduce((n, v) => n + v, 0);
  a.peopleCost = c.staff + c.cleaning + c.waterNet; a.roadCost = c.roads; a.loan = c.loan;
  a.waterSupply *= activeEvent(s, "water");
  a.powerSupply *= activeEvent(s, "power");
  if (seasonOf(s.day).id === "summer") { a.waterUse = Math.round(a.waterUse * 1.1); a.powerUse = Math.round(a.powerUse * 1.15); } // heat: more water, air conditioners
  a.waterRatio = a.waterUse ? clamp(a.waterSupply / a.waterUse, 0, 1) : 1;
  // Until the town builds its first power source nothing runs on electricity (and nothing misses it).
  a.grid = a.powerSupply > 0;
  a.powerRatio = !a.grid ? 1 : a.powerUse ? clamp(a.powerSupply / a.powerUse, 0, 1) : 1;
  traffic(s, a);
  a.workers = Math.round(s.pop * 0.55);
  a.employed = Math.min(a.workers, a.jobs);
  // stuck in traffic: some arrive late, and the work suffers
  a.staffing = (a.jobs ? a.employed / a.jobs : 0) * (1 - Math.min(0.25, a.jam * 0.2));
  a.unemployment = a.workers ? 1 - a.employed / a.workers : 0;

  // Money for one day.
  const shopMult = activeEvent(s, "shop") * (s.tech.smart ? 1.2 : 1);
  // Locusts take 60% of the harvest, or 15% with pest control.
  let farmEvents = activeEvent(s, "farm");
  if (s.tech.pest && s.events.some((e) => e.id === "locust")) farmEvents = (farmEvents / 0.4) * 0.85;
  const farmMult = farmEvents * (s.tech.irrigation ? 1.3 : 1) * (s.tech.smart ? 1.2 : 1);
  // Local shops can only sell what the residents spend (about 0.6 riyal a person an hour, more in
  // Ramadan and Eid); more shops than that share the same customers. Visitors' places (hotel, the
  // grand projects) and industry sell outside the town, so they are not capped.
  // A full dam lake: families go out to it (a kashta by the water).
  a.lakeTiles = 0;
  if ((s.lake || 0) > 10) {
    const near = new Uint8Array(N * N);
    s.tiles.forEach((t, i) => {
      if (t.t !== "lake") return;
      a.lakeTiles++;
      const x = i % N, y = Math.floor(i / N);
      for (let yy = y - 5; yy <= y + 5; yy++) for (let xx = x - 5; xx <= x + 5; xx++) if (inMap(xx, yy) && Math.abs(xx - x) + Math.abs(yy - y) <= 5) near[idx(xx, yy)] = 1;
    });
    for (let i = 0; i < N * N; i++) if (near[i]) a.local[i] += 6;
  }
  // Production chains and building materials.
  chainsInto(s, a);
  a.shopRaw = 0; a.visitorIncome = 0; a.industryIncome = 0;
  // Spring grazing: pens with green fayda within 4 tiles.
  a.grazing = new Set();
  if (seasonOf(s.day).id === "spring") for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (s.tiles[idx(x, y)].b?.id !== "pen") continue;
    let near = false;
    for (let yy = y - 4; yy <= y + 4 && !near; yy++) for (let xx = x - 4; xx <= x + 4 && !near; xx++) if (inMap(xx, yy) && Math.abs(xx - x) + Math.abs(yy - y) <= 4 && s.tiles[idx(xx, yy)].t === "fayda") near = true;
    if (near) a.grazing.add(idx(x, y));
  }
  // At prayer time the shops close their doors for a while.
  a.prayer = prayerNow(s);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const t = s.tiles[idx(x, y)];
    if (!t.b || !t.b.works) continue;
    const def = B[t.b.id];
    if (!def.income) continue;
    if (def.cat === "farm" && (t.b.id === "palms" || t.b.id === "veg")) {
      const wadi = t.t === "wadi" ? 1.5 : s.terrain === "dunes" ? 0.7 : 1;
      a.farmIncome += def.income * bizLevel(t.b).income * wadi * farmMult * (0.4 + 0.6 * a.waterRatio) * (0.5 + 0.5 * a.staffing) * condFactor(t.b);
    } else {
      let inc = def.income * bizLevel(t.b).income * (0.3 + 0.7 * a.staffing) * (0.4 + 0.6 * a.powerRatio) * condFactor(t.b);
      const ch = a.chainAt.get(idx(x, y));
      if (ch) inc *= 0.3 + 1.7 * ch.fill;
      if (t.b.id === "mazayen") inc *= 1 + Math.min(1, a.count.pen * 0.05);
      if (t.b.id === "pen" && a.grazing?.has(idx(x, y))) inc *= 1.5;
      if (t.b.id === "pivot") inc *= a.groundFactor;
      if (def.cat === "shop" && a.parkingNear?.[idx(x, y)]) inc *= 1.1;
      if (def.visitors) a.visitorIncome += inc * shopMult;
      else if (def.cat === "shop") a.shopRaw += inc * shopMult;
      else a.industryIncome += inc;
    }
  }
  // Towns linked by road in the region: their people shop here and their traders buy here.
  a.neighbourPop = (s.neighbours || []).reduce((n, t) => n + (t.pop || 0), 0);
  a.shopDemand = (s.pop + a.neighbourPop * 0.15) * 0.6 * shopMult;
  // Traffic jams keep customers away from the shops.
  a.congestion = Math.min(0.4, a.jam * 0.3);
  a.shopIncome = Math.min(a.shopRaw, a.shopDemand) * (1 - a.congestion) * (a.prayer && a.prayer.id !== "fajr" ? 0.6 : 1);
  // Workshops and factories sell outside, but the traders who buy from a town of this size only take
  // so much: past that, extra output sells at about a third of the price.
  if ((s.materials || 0) >= MAT.cap) a.industryIncome += a.matMade * MAT.sell;
  a.industryRaw = a.industryIncome;
  a.exportDemand = 300 + s.pop * 0.9 + a.neighbourPop * 0.4;
  if (a.industryRaw > a.exportDemand) a.industryIncome = a.exportDemand + (a.industryRaw - a.exportDemand) * 0.35;
  a.income = a.shopIncome + a.visitorIncome + a.industryIncome;
  // Thefts: in a big town, shops in quarters no police reaches lose part of their takings.
  if (s.pop >= 300) {
    let homes = 0, safe = 0;
    for (let i = 0; i < N * N; i++) if (s.tiles[i].b?.id === "house" && s.tiles[i].b.works) { homes++; if (a.services[i].has("safety")) safe++; }
    a.costs.theft = homes ? a.shopIncome * 0.12 * (1 - safe / homes) : 0;
    a.upkeep += a.costs.theft;
  }
  // Tax per person falls a little as the town grows, so big cities do not drown in money.
  a.tax = s.pop * (s.tax / 100) * (3 - Math.min(1.2, s.pop / 2500));
  a.net = Math.round(a.income + a.farmIncome + a.tax - a.upkeep);

  // How happy people are where they live.
  let sum = 0, weight = 0;
  const part = { cheer: 0, smoke: 0, dry: 0, dark: 0 };
  for (let i = 0; i < N * N; i++) {
    const t = s.tiles[i];
    if (!t.b || t.b.id !== "house" || !t.b.works) continue;
    const local = Math.min(40, a.local[i]) - Math.min(30, a.pollution[i]) - (a.watered[i] ? 0 : 10) - (a.grid && t.b.lvl >= 3 && !a.powered[i] ? 6 : 0); // villas and towers live on electricity
    t.b.local = local;
    const w = Math.max(1, t.b.res || 1);
    sum += local * w; weight += w;
    part.cheer += Math.min(40, a.local[i]) * w; part.smoke += Math.min(30, a.pollution[i]) * w;
    part.dry += (a.watered[i] ? 0 : 10) * w; part.dark += (a.grid && t.b.lvl >= 3 && !a.powered[i] ? 6 : 0) * w;
  }
  const local = weight ? sum / weight : 0;
  // Seasons: a green faydah in spring lifts spirits; summer heat makes homes thirstier.
  const season = seasonOf(s.day);
  a.season = season;
  a.fayda = 0;
  if (season.id === "spring") for (const t of s.tiles) if (t.t === "fayda" && !t.b) a.fayda++;
  a.faydaHappy = Math.min(8, a.fayda * 0.35);
  // How much people trust the mayor (from answering them in the news): ±8 at most.
  a.councilMood = Math.max(-8, Math.min(8, ((s.trust ?? 60) - 60) * 0.3));
  a.happyTarget = clamp(
    48 + a.faydaHappy + a.councilMood + local * 0.9 - (1 - a.waterRatio) * 35 - (1 - a.powerRatio) * 22 - a.unemployment * 30 - (s.tax - 10) * 1.6 + eventHappy(s) - (s.money < 0 ? 12 : 0), 0, 100); // in debt: wages run late
  // the same sum, item by item, for the happiness sheet
  const k = weight ? 0.9 / weight : 0;
  a.happyParts = [
    { id: "base", label: "الأساس", v: 48 },
    { id: "near", label: "الخدمات والأماكن الحلوة قرب البيوت", v: part.cheer * k, fix: "ابنِ مساجد ومدارس وحدائق ومستوصفات قريبة من البيوت، وطوّرها عشان توصل أبعد" },
    { id: "smoke", label: "الدخان والإزعاج قرب البيوت", v: -part.smoke * k, fix: "انقل الورش والمصانع بعيد عن البيوت" },
    { id: "dry", label: "بيوت ما يوصلها ماء", v: -part.dry * k, fix: "ابنِ بئر أو خزان قريب من البيوت اللي ما يوصلها ماء" },
    { id: "dark", label: "فلل وعماير بلا كهرباء", v: -part.dark * k, fix: "ابنِ مولد قريب منها" },
    { id: "water", label: "الماء ما يكفي البلد", v: -(1 - a.waterRatio) * 35, fix: "زد الآبار والخزانات" },
    { id: "power", label: "الكهرباء ما تكفي", v: -(1 - a.powerRatio) * 22, fix: "زد المولدات" },
    { id: "jobs", label: "البطالة", v: -a.unemployment * 30, fix: "افتح محلات ومزارع وورش" },
    { id: "tax", label: `الضريبة (${s.tax}٪)`, v: -(s.tax - 10) * 1.6, fix: "نزّل الضريبة من «الأرقام»" },
    { id: "fayda", label: "الفيضة خضرا بالربيع", v: a.faydaHappy },
    { id: "trust", label: "ثقتهم فيك (ردودك ووعودك)", v: a.councilMood, fix: "رد على النشرة ووفّ بوعودك" },
    ...s.events.filter((e) => eventDef(e).happy).map((e) => ({ id: "ev", label: e.name || eventDef(e).name || "حدث", v: eventDef(e).happy })),
    { id: "debt", label: "الميزانية بالسالب (رواتب متأخرة)", v: s.money < 0 ? -12 : 0, fix: "رجّع الميزانية فوق الصفر" }
  ];
  a.unconnected = a.homes - a.connectedHomes;
  return a;
}

// ---------- one day ----------

/** Can this house move up a level today? Returns the missing thing, or "". */
export function houseBlocker(s, a, x, y) {
  const t = s.tiles[idx(x, y)];
  const next = B.house.levels[t.b.lvl + 1];
  if (!next) return "أعلى مستوى";
  if (next.era && s.era < next.era) return `تحتاج الرافعية تصير ${ERAS[next.era].name}`;
  const n = next.needs || {};
  if (n.road && !t.b.works) return "يحتاج طريق";
  const tile = idx(x, y);
  if (n.water && !a.watered[tile]) return "ما يوصله ماء: ابنِ بئر قريب منه (البئر يوصل لين ٥ مربعات)";
  if (n.water && a.waterRatio < 0.95) return "الماء ما يكفي البلد: زد الآبار";
  if (n.power && !a.powered[tile]) return "ما توصله الكهرباء: ابنِ مولد قريب منه (يوصل لين ٧ مربعات)";
  if (n.power && a.powerRatio < 0.95) return "الكهرباء ما تكفي: زد المولدات";
  const here = s.happy + (t.b.local || 0) * 0.6;
  if (n.happy && here < n.happy) return "يحتاج رضا أكثر (خدمات قريبة، حدائق، مساجد)";
  if (n.services && a.services[idx(x, y)].size < n.services) return `يحتاج ${n.services} خدمات قريبة (مسجد، مدرسة، مستوصف، أمن)`;
  return "";
}

/** Building materials the next level needs. */
export const upgradeMats = (b) => (b?.id === "house" ? MAT.house[b.lvl + 1] || 0 : BIZ_LEVELS[b?.id] ? MAT.biz[b.lvl + 1] || 0 : 0);
/** Everything the next level costs now: money, plus whatever materials are short, bought from outside. */
export function upgradePrice(s, b) {
  const need = upgradeMats(b), short = Math.max(0, need - (s.materials || 0));
  return { money: upgradeCost(b), mats: need, short, total: upgradeCost(b) + short * MAT.price };
}
function payUpgrade(s, b) {
  const p = upgradePrice(s, b);
  if (s.money < p.total) return "ما يكفي المال";
  s.money -= p.total;
  s.materials = Math.max(0, (s.materials || 0) - (p.mats - p.short));
  return "";
}
/** What the next level of this house costs (0 at the top). */
export const upgradeCost = (b) => (b?.id === "house" ? B.house.levels[b.lvl + 1]?.cost || 0
  : BIZ_LEVELS[b?.id] && BIZ_UP[b.lvl + 1] ? Math.round(B[b.id].cost * BIZ_UP[b.lvl + 1].cost) : 0);
/** Can this building be upgraded at all (a house, a farm, a shop, a workshop)? */
export const upgradable = (b) => b?.id === "house" || !!BIZ_LEVELS[b?.id];
/** Why this farm, shop or workshop cannot move up a level now, or "". */
export function bizBlocker(s, a, x, y) {
  const b = s.tiles[idx(x, y)]?.b;
  if (!b || !BIZ_LEVELS[b.id]) return "ما يتطور";
  const next = BIZ_UP[b.lvl + 1];
  if (!next) return "أعلى مستوى";
  if (b.build > 0) return "تحت الإنشاء";
  if (b.ruin > 0 || (b.cond ?? 100) < 40) return "رمّمه أول";
  if (b.works === false) return "ما يشتغل: يحتاج طريق";
  if (next.era && s.era < next.era) return `يحتاج تصير الرافعية ${ERAS[next.era].name}`;
  const here = idx(x, y), farm = B[b.id].cat === "farm" && b.id !== "workshop";
  if (next.era && farm && !a.watered[here]) return "ما يوصله ماء: ابنِ بئر قريب منه";
  if (next.era && !farm && !a.powered[here]) return "ما توصله الكهرباء: ابنِ مولد قريب منه";
  return "";
}
/** Why a building cannot be upgraded now (house or business), or "". */
export const upgradeBlocker = (s, a, x, y) => (s.tiles[idx(x, y)]?.b?.id === "house" ? houseBlocker(s, a, x, y) : bizBlocker(s, a, x, y));
/** Upgrade a farm, shop or workshop one level. Returns why not, or "". */
export function upgradeBiz(s, x, y, a = analyze(s)) {
  const b = s.tiles[idx(x, y)]?.b;
  const why = bizBlocker(s, a, x, y);
  if (why) return why;
  const paid = payUpgrade(s, b);
  if (paid) return paid;
  b.lvl++; b.cond = 100; b.upAt = s.day;
  return "";
}
/** What the next level changes, in numbers (income and costs an hour, jobs, cheer and reach, homes). */
export function upgradeEffect(s, b) {
  if (!b) return null;
  const def = B[b.id];
  if (b.id === "house") {
    const now = def.levels[b.lvl], next = def.levels[b.lvl + 1];
    if (!next) return null;
    const concrete = s.tech?.concrete ? 1.25 : 1, perHead = (s.tax / 100) * (3 - Math.min(1.2, s.pop / 2500));
    const capNow = Math.round(now.cap * concrete), capNext = Math.round(next.cap * concrete);
    return { house: true, capNow, capNext, taxGain: (capNext - capNow) * perHead };
  }
  if (!BIZ_LEVELS[b.id] || !BIZ_UP[b.lvl + 1]) return null;
  const u0 = bizLevel(b), u1 = BIZ_UP[b.lvl + 1];
  return {
    incomeNow: (def.income || 0) * u0.income, incomeNext: (def.income || 0) * u1.income,
    upkeepNow: (def.upkeep || 0) * u0.upkeep, upkeepNext: (def.upkeep || 0) * u1.upkeep,
    jobsNow: Math.round((def.jobs || 0) * u0.jobs), jobsNext: Math.round((def.jobs || 0) * u1.jobs),
    happyNow: (def.happy || 0) * (u0.happy || 1), happyNext: (def.happy || 0) * (u1.happy || 1),
    // reach only matters for what cheers or bothers its neighbours
    radiusNow: def.radius && (def.happy || def.pollute) ? def.radius + (u0.radius || 0) : 0, radiusNext: def.radius && (def.happy || def.pollute) ? def.radius + (u1.radius || 0) : 0
  };
}
/** Upgrade whatever is on this tile. */
export const upgradeAt = (s, x, y, a = analyze(s)) => (s.tiles[idx(x, y)]?.b?.id === "house" ? upgradeHouse(s, x, y, a) : upgradeBiz(s, x, y, a));
/** The name of a building at its level. */
export const levelName = (b) => (b.id === "house" ? B.house.levels[b.lvl].name : BIZ_LEVELS[b.id]?.[b.lvl] || B[b.id].name);

/** The mayor upgrades a house one level. Returns why not, or "". */
export function upgradeHouse(s, x, y, a = analyze(s)) {
  const b = s.tiles[idx(x, y)]?.b;
  if (b?.id !== "house") return "مو بيت";
  const why = houseBlocker(s, a, x, y);
  if (why) return why;
  const paid = payUpgrade(s, b);
  if (paid) return paid;
  b.lvl++; b.cond = 100; b.ruin = 0; b.upAt = s.day;
  return "";
}

/** What the bank will still lend: grows with what the town owns, less what is still owed. */
export function creditLimit(s, a = analyze(s)) {
  const owed = (s.loans || []).reduce((n, l) => n + l.per * l.left, 0);
  return Math.max(0, Math.round(3000 + a.value * 0.3 + s.pop * 15 - owed));
}
/** Why the bank says no to this loan, or "". */
export function loanBlocker(s, id, a = analyze(s)) {
  const o = LOANS.find((l) => l.id === id);
  if (!o) return "ما فيه قرض كذا";
  if (!a.count.bank) return "تحتاج تبني بنك";
  if (s.broke) return "البنك ما يقرض بلدية مفلسة";
  if ((s.loans || []).length >= 3) return "عندك ٣ قروض، سدد واحد أول";
  if (o.amount > creditLimit(s, a)) return "أكبر من اللي يقدر البنك يعطيك الحين";
  return "";
}
export const loanPer = (o) => Math.ceil((o.amount * (1 + o.rate)) / (o.days * 24));
export function takeLoan(s, id, a = analyze(s)) {
  const why = loanBlocker(s, id, a);
  if (why) return why;
  const o = LOANS.find((l) => l.id === id);
  s.loans ||= [];
  s.loans.push({ id: o.id, name: o.name, amount: o.amount, rate: o.rate, per: loanPer(o), left: o.days * 24, total: o.days * 24 });
  s.money += o.amount;
  return "";
}
/** Paying a loan off early: what is left of the amount, without the interest still to come. */
export const payoffCost = (l) => Math.ceil((l.amount * l.left) / l.total);
export function payLoan(s, i) {
  const l = s.loans?.[i];
  if (!l) return "ما فيه قرض";
  const cost = payoffCost(l);
  if (s.money < cost) return "ما يكفي المال";
  s.money -= cost;
  s.loans.splice(i, 1);
  return "";
}

export function step(s, r = Math.random) {
  const a = analyze(s);
  // People move in when there is room and life is good, and leave when it is not.
  // Homes fill up when life is good (fully from 60% content), and empty when it is not.
  const pull = clamp((s.happy - 20) / 40, 0, 1.2) * (1 - a.unemployment * 0.8);
  const target = a.cap * clamp(pull, 0, 1);
  const before = s.pop;
  // People come quickly when there is room, but leave slowly: a bad day does not empty a town.
  s.pop = Math.max(0, Math.round(s.pop + (target - s.pop) * (target > s.pop ? 0.12 : 0.03) + (target > s.pop ? 1 : 0)));
  if (s.pop > a.cap) s.pop = a.cap;
  // Spread residents evenly over the connected houses (every house about equally full).
  const concrete = s.tech.concrete ? 1.25 : 1;
  const fill = a.cap ? s.pop / a.cap : 0;
  let left = s.pop;
  for (let i = 0; i < N * N; i++) {
    const t = s.tiles[i];
    if (t.b?.id !== "house") continue;
    const cap = t.b.works ? Math.round(B.house.levels[t.b.lvl].cap * concrete) : 0;
    t.b.res = Math.min(cap, left, Math.round(cap * fill));
    left -= t.b.res;
  }
  for (let i = 0; i < N * N && left > 0; i++) {
    const t = s.tiles[i];
    if (t.b?.id !== "house" || !t.b.works) continue;
    const room = Math.round(B.house.levels[t.b.lvl].cap * concrete) - t.b.res;
    const add = Math.min(room, left);
    t.b.res += add; left -= add;
  }
  // Houses do not change by themselves: the mayor upgrades them (upgradeHouse); only neglect brings one down.
  // Building sites move on; a finished grand project is news.
  const done = [];
  for (const t of s.tiles) if (t.b?.build > 0 && --t.b.build <= 0) { delete t.b.build; done.push(B[t.b.id].name); }
  // Wear: every building loses a little every hour; mud houses faster. At zero it falls down.
  const fell = [];
  s.tiles.forEach((t, i) => {
    if (!wears(t.b)) return;
    const rate = t.b.id === "house" && t.b.lvl === 1 ? UPKEEP_RULES.mudDecay : B[t.b.id].cat === "deco" ? UPKEEP_RULES.decay / 2 : UPKEEP_RULES.decay;
    t.b.cond = Math.max(0, (t.b.cond ?? 100) - rate);
    if (t.b.cond > 0) return;
    // Worn out: it stops working, and after two days more it falls down.
    t.b.ruin = (t.b.ruin || 0) + 1;
    if (t.b.ruin === 1) fell.push({ i, name: B[t.b.id].name, warn: true });
    if (t.b.ruin < UPKEEP_RULES.ruinHours) return;
    if (t.b.id === "house") { t.b.lvl--; t.b.cond = 60; t.b.ruin = 0; fell.push({ i, name: "بيت", house: true }); }
    else { const name = B[t.b.id].name; fell.push({ i, name, refund: lose(s, t) }); }
  });
  s.money += a.net;
  s.happy = Math.round((s.happy * 0.7 + a.happyTarget * 0.3) * 10) / 10;
  const seasonBefore = seasonOf(s.day).i, yearBefore = Math.floor((s.day - 1) / YEAR_HOURS);
  s.day++;

  const msgs = done.map((name) => ({ kind: "goal", text: `اكتمل مشروع «${name}»! 🎉` }));
  for (const f of fell) msgs.push(f.warn ? { kind: "event", title: "مبنى خربان", tile: f.i, text: `«${f.name}» خرب ووقف عن الشغل. رمّمه خلال يومين وإلا بيطيح.` } : { kind: "collapse", tile: f.i, text: f.house ? "بيت انهار من الإهمال ورجع أصغر. رمّم بيوتك قبل لا تطيح." : `انهار «${f.name}» من الإهمال!${f.refund ? ` التأمين عوّضك ${f.refund} ريال.` : " ما كان عليه تأمين."}` });
  // Building materials: what the quarries made goes in the store.
  s.materials = Math.min(MAT.cap, (s.materials || 0) + (a.matMade || 0));
  // Groundwater, and the water held behind the dams.
  const raining = s.events.some((e) => e.id === "rain");
  const aNow = a;
  stepGround(s, aNow, raining, msgs);
  if (updateLake(s)) msgs.push({ kind: "land" });
  if (aNow.count.dam) {
    const dry = seasonOf(s.day).id === "summer" ? 0.2 : 0.06;
    s.lake = Math.max(0, Math.min(100, (s.lake || 0) + (raining ? 2.2 : -dry)));
  } else s.lake = 0;
  // A flash flood down the wadi, now and then while it rains. Water runs from west to east: a dam
  // holds it while its lake has room, and nothing below (east of) a dam is touched.
  const damXs = [];
  s.tiles.forEach((t, i) => { if (t.b?.id === "dam" && !(t.b.build > 0)) damXs.push(i % N); });
  const firstDam = damXs.length ? Math.min(...damXs) : N;
  if (raining && s.day - (s.lastFlood ?? -999) > 72 && r() < (s.tech.dams ? 0.02 : 0.03)) {
    if (damXs.length && (s.lake || 0) < 80) {
      s.lastFlood = s.day; s.lake = Math.min(100, (s.lake || 0) + 30);
      msgs.push({ kind: "event", title: "السد حجز السيل", text: "نزل سيل قوي والسد حجزه! البحيرة امتلت والماء الجوفي بيرتفع، وما تضرر شي." });
    }
  }
  if (raining && s.day - (s.lastFlood ?? -999) > 72 && r() < (s.tech.dams ? 0.02 : 0.03) * (s.away ? 0.3 : 1)) {
    const lost = [], damaged = [];
    let refund = 0;
    s.tiles.forEach((t, i) => {
      if (t.t !== "wadi" || !t.b || i % N > firstDam || t.b.id === "dam") return;
      const isRoad = ROAD_IDS.includes(t.b.id);
      if (r() < (isRoad ? 0.3 : 0.45) * (s.terrain === "bigwadi" ? 1.4 : 1)) { lost.push({ i, id: t.b.id }); refund += lose(s, t); }
      else if (!isRoad) { t.b.cond = Math.max(1, (t.b.cond ?? 100) - 50); damaged.push(i); }
    });
    if (lost.length || damaged.length) {
      s.lastFlood = s.day;
      const names = [...new Set(lost.filter((x) => !ROAD_IDS.includes(x.id)).map((x) => B[x.id].name))].slice(0, 3);
      msgs.push({ kind: "flood", lost: lost.map((x) => x.i), damaged, text: `سيل جارف نزل الوادي! راح ${lost.length} مبنى وطريق${names.length ? ` (منها ${names.join("، ")})` : ""}، وتضرر ${damaged.length}.${refund ? ` التأمين عوّضك ${refund} ريال.` : s.insured ? "" : " ما كان فيه تأمين."}` });
    }
  }
  // Investments come due: the trader pays double, or the money is gone.
  s.investments = (s.investments || []).filter((v) => {
    if (s.day < v.at) return true;
    if (r() < v.chance) { s.money += v.back; msgs.push({ kind: "goal", text: `الاستثمار نجح! رجع لك ${v.back} ريال.` }); }
    else msgs.push({ kind: "event", title: "خسارة", text: `التاجر خسر في المشروع وراحت الـ${v.amount} ريال.` });
    return false;
  });
  // Contractors sometimes run late.
  for (const t of s.tiles) if (t.b?.build > 0 && r() < 0.003) { t.b.build += 24; msgs.push({ kind: "event", title: "تأخير", text: `المقاول تعثّر في «${B[t.b.id].name}»، والمشروع تأخر يوم.` }); }
  // Stage of the town never goes back.
  for (const e of ERAS) if (s.pop >= e.pop && e.id > s.era) { s.era = e.id; msgs.push({ kind: "era", text: `الرافعية صارت ${e.name}! مباني جديدة انفتحت.` }); }
  // Bankruptcy: deep in debt the council stops paying its services; back above zero they reopen.
  const limit = 1500 + a.upkeep * 12;
  if (!s.broke && s.money < -limit) { s.broke = true; msgs.push({ kind: "event", title: "البلدية أفلست", text: "الديون فاقت الحد، والمساجد والمدارس والمستوصفات قفلت لأن الرواتب ما انصرفت. ارفع الدخل أو خذ قرض." }); }
  else if (s.broke && s.money >= 0) { s.broke = false; msgs.push({ kind: "goal", text: "سددت الديون! الخدمات رجعت تشتغل." }); }
  // A new year: the province's fee, and the council's staff ask for a raise.
  if (Math.floor((s.day - 1) / YEAR_HOURS) > yearBefore) {
    const fee = PROVINCE_FEES[s.era] * (s.feeX || 1);
    if (fee) { s.money -= fee; msgs.push({ kind: "event", title: "رسوم المحافظة", text: `دفعت الرافعية رسومها السنوية للمحافظة: ${fee} ريال.` }); }
    if (!s.decision && s.pop >= 30) { s.decision = { id: "raise" }; msgs.push({ kind: "decision", text: "علاوة" }); }
    if (s.pop >= 30) {
      const share = voteShare(s), won = share >= 0.5, year = Math.floor((s.day - 1) / YEAR_HOURS);
      const grant = won ? ELECTION_GRANT[s.era] : 0;
      if (won) { s.money += grant; s.events.push({ id: "boost", name: "فرحة الفوز بالانتخابات", left: 48, hours: 48, happy: 6 }); s.feeX = 1; }
      else { s.events.push({ id: "boost", name: "زعل بعد الانتخابات", left: 48, hours: 48, happy: -5 }); s.feeX = 2; s.trust = Math.max(s.trust ?? 60, 50); }
      s.elections = [...(s.elections || []), { year, share: Math.round(share * 100), won }].slice(-10);
      msgs.push({ kind: "election", share, won, grant, record: { ...(s.record || {}) } });
      s.record = { kept: 0, broken: 0 };
    }
  } else if (s.pop >= 30 && hoursToElection(s) === 48) msgs.push({ kind: "event", title: "الانتخابات", text: `انتخابات المجلس البلدي بعد يومين. لو صارت اليوم بتاخذ ${Math.round(voteShare(s) * 100)}٪ من الأصوات.` });
  // A new season.
  const season = seasonOf(s.day);
  if (season.i !== seasonBefore) msgs.push({ kind: "season", title: season.name, text: season.start });
  // Research.
  if (s.research && --s.research.left <= 0) {
    s.tech[s.research.id] = true;
    msgs.push({ kind: "tech", text: `انتهى بحث «${TECH[s.research.id].name}».` });
    s.research = null;
  }
  // Bank loans: one instalment an hour (it is in the costs above) until paid.
  if (s.loans?.length) s.loans = s.loans.filter((l) => { if (--l.left > 0) return true; msgs.push({ kind: "event", title: "البنك", text: `خلصت أقساط «${l.name}». الله يبارك لك.` }); return false; });
  // Events.
  s.events = s.events.filter((e) => --e.left > 0);
  if (!s.events.some((e) => e.id !== "boost") && s.day > 12 && r() < 0.025) {
    const pool = EVENTS.filter((e) => !e.tech || s.tech[e.tech]);
    let roll = r() * pool.reduce((t, e) => t + e.weight, 0);
    const ev = pool.find((e) => (roll -= e.weight) < 0) || pool[0];
    s.events.push({ id: ev.id, left: ev.days });
    let text = ev.text;
    if (ev.id === "dust" && a.count.road) { const clean = a.count.road * 3; s.money -= clean; text += ` (تنظيف الطرق الترابية: ${clean} ريال)`; }
    if (ev.gift) { const g = 200 + Math.round(s.pop * 0.8); s.money += g; text += ` (+${g} ريال)`; }
    msgs.push({ kind: "event", title: ev.name, text });
  }
  // Now and then a choice for the mayor, with at least three days between them.
  if (!s.decision && s.day > 30 && s.day - (s.lastDecisionAt || 0) >= 72 && r() < 0.015) {
    s.lastDecisionAt = s.day;
    const pool = DECISIONS.filter((d) => d.when(s, a, season) && d.id !== s.lastDecision);
    let roll = r() * pool.reduce((n, d) => n + (d.weight || 1), 0);
    if (pool.length) { const d = pool.find((x) => (roll -= x.weight || 1) < 0) || pool[0]; s.decision = { id: d.id }; s.lastDecision = d.id; msgs.push({ kind: "decision", text: d.title }); }
  }
  // Goals.
  const g = GOALS[s.goal];
  if (g && g.test(goalView(s, analyze(s)))) {
    s.money += g.reward;
    msgs.push({ kind: "goal", text: `أنجزت: ${g.text} (+${g.reward} ريال)` });
    s.goal++;
  }
  // Achievements, once each.
  s.ach ||= {};
  const after = ACHIEVEMENTS.some((x) => !s.ach[x.id]) ? analyze(s) : null;
  for (const x of ACHIEVEMENTS) if (!s.ach[x.id] && x.test(s, after)) { s.ach[x.id] = s.day; msgs.push({ kind: "ach", text: `🏆 إنجاز: ${x.name}` }); }
  s.history.push({ d: s.day, p: s.pop, m: Math.round(s.money), h: Math.round(s.happy), n: a.net });
  if (s.history.length > 60) s.history.shift();
  s.lastGrowth = s.pop - before;
  return { a, msgs };
}

/** What an option costs right now (some depend on how many tents or roads there are). */
export function optionCost(s, a, o) {
  if (o.costPer) {
    const site = s.tiles.find((t) => t.b?.build > 0);
    return Math.round((o.costPer.tents || 0) * a.levels[0] + (o.costPer.roads || 0) * a.count.road + (o.costPer.people || 0) * s.pop + (o.costPer.project && site ? o.costPer.project * B[site.b.id].cost : 0));
  }
  return o.cost || 0;
}

/** The mayor picks an option of the waiting decision. Returns what happened, or why not. */
export function decide(s, i) {
  const d = DECISIONS.find((x) => x.id === s.decision?.id), o = d?.options[i];
  if (!o) { s.decision = null; return { error: "ما فيه قرار" }; }
  const a = analyze(s);
  const cost = optionCost(s, a, o);
  if (cost && s.money < cost) return { error: "ما يكفي المال" };
  s.money -= cost;
  if (o.popLoss) s.pop = Math.max(0, Math.round(s.pop * (1 - o.popLoss)));
  if (o.moneyLoss && s.money > 0) s.money = Math.round(s.money * (1 - o.moneyLoss));
  let lost = "";
  if (o.destroy) {
    const spots = [];
    s.tiles.forEach((t) => { if (t.b && o.destroy.includes(t.b.id)) spots.push(t); });
    if (spots.length) { const t = spots[(s.day * 7919 + spots.length) % spots.length]; lost = B[t.b.id].name; lose(s, t); }
  }
  s.money += (o.money || 0) + (o.moneyPerPalm || 0) * a.count.palms;
  if (o.tax) s.tax = clamp(s.tax + o.tax, 0, 25);
  if (o.raise) s.staffRaise = (s.staffRaise || 0) + o.raise;
  if (o.invest) (s.investments ||= []).push({ ...o.invest, at: s.day + o.invest.hours });
  if (o.hurry) for (const t of s.tiles) if (t.b?.build > 0) t.b.build = Math.max(1, Math.round(t.b.build * o.hurry));
  if (o.boost) s.events.push({ id: "boost", left: o.boost.hours, ...o.boost });
  let built = "";
  if (o.freeBuild) {
    let best = null; // the free owned tile nearest the middle of the town
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const t = s.tiles[idx(x, y)];
      if (t.b || t.t === "rock" || !owns(s, x, y)) continue;
      const dist = Math.hypot(x - N / 2, y - N / 2 - 3);
      if (!best || dist < best.dist) best = { x, y, dist };
    }
    if (best) { s.tiles[idx(best.x, best.y)].b = { id: o.freeBuild, lvl: 0, res: 0 }; built = o.freeBuild; }
  }
  s.decision = null;
  return { ok: true, built, lost };
}

/** While the player was away, the last option of a decision is taken. */
const decideDefault = (s) => { const d = DECISIONS.find((x) => x.id === s.decision?.id); decide(s, d ? d.options.length - 1 : 0); };

export function goalView(s, a) {
  return { ...a, pop: s.pop, happy: s.happy, tech: s.tech, net: a.net };
}

export function startResearch(s, id) {
  const t = TECH[id];
  if (!t || s.tech[id] || s.research) return "فيه بحث شغّال";
  if (t.era > s.era) return `تحتاج الرافعية تصير ${ERAS[t.era].name}`;
  if (s.money < t.cost) return "ما يكفي المال";
  s.money -= t.cost;
  s.research = { id, left: t.days };
  return "";
}

/** While the app was closed the town carried on, slowly: one day for every two minutes away, at most 60. */
export function catchUp(s, now = Date.now()) {
  const away = Math.max(0, now - (s.savedAt || now));
  const days = Math.min(144, Math.floor(away / 60000)); // one town hour per minute away, up to six days
  if (!days) return null;
  const start = { pop: s.pop, money: s.money, day: s.day };
  const msgs = [];
  for (let i = 0; i < days; i++) { msgs.push(...step(s).msgs); if (s.decision) decideDefault(s); }
  return { days, pop: s.pop - start.pop, money: Math.round(s.money - start.money), msgs };
}

// ---------- the world: the deputy mayor while the mayor is away ----------
/** Standing orders the mayor leaves the deputy. */
export const DEPUTY = { repair: true, floor: 2000, tax: true };
/** How many hours the deputy runs the town in full; after that the town is kept steady. */
export const DEPUTY_FULL_HOURS = 168;
/** After this long away (a week of real time, in town hours) the town sleeps: nothing changes. */
export const SLEEP_HOURS = Math.round((7 * 86400) / 50);
/**
 * The town carries on while its mayor is away: the deputy runs it (repairs, pays, answers with the
 * safe choice, raises the tax a little if money runs short) under the shield: the town never goes
 * bankrupt while away and never loses more than 5% of its people a day. The first week of town time
 * is worked out hour by hour; after that the town is kept as it is and only earns (or pays) its
 * steady income, until it falls asleep. Returns a summary.
 */
export function deputyCatchUp(s, hours, r = Math.random) {
  if (hours <= 0) return null;
  const orders = { ...DEPUTY, ...(s.deputy || {}) };
  const start = { pop: s.pop, money: s.money, tax: s.tax };
  const msgs = [], did = { repairs: 0, decisions: 0, shield: 0, taxUp: 0 };
  const full = Math.min(hours, DEPUTY_FULL_HOURS);
  s.away = true;
  let dayPop = s.pop;
  for (let i = 0; i < full; i++) {
    msgs.push(...step(s, r).msgs);
    if (s.decision) { decideDefault(s); did.decisions++; }
    if (s.money < 0) { s.money = 0; did.shield++; }
    if (i % 24 === 23) {
      if (s.pop < Math.ceil(dayPop * 0.95)) { s.pop = Math.ceil(dayPop * 0.95); did.shield++; }
      dayPop = s.pop;
      if (orders.repair) { const bill = analyze(s).repairBill; if (bill && s.money - bill > orders.floor) { repairAll(s); did.repairs++; } }
      // only when the money is short and still falling
      if (orders.tax && s.money < orders.floor && s.tax < 15 && analyze(s).net < 0) { s.tax++; did.taxUp++; }
    }
  }
  s.away = false;
  // the rest of the time: steady, the deputy careful with money (80% of the income)
  const rest = Math.min(hours, SLEEP_HOURS) - full;
  let steady = 0;
  if (rest > 0) {
    const net = analyze(s).net;
    steady = Math.round(net > 0 ? net * rest * 0.8 : Math.max(net * rest, -Math.max(0, s.money - orders.floor)));
    s.money = Math.max(0, s.money + steady);
  }
  s.day += hours - full; // the town keeps the world's hour
  return { hours, full, steady, slept: hours > SLEEP_HOURS, pop: s.pop - start.pop, money: Math.round(s.money - start.money), taxFrom: start.tax, did, msgs };
}

// ---------- saving ----------

export function pack(s) {
  const tiles = s.tiles.map((t) => (t.t === "sand" ? "" : t.t[0]) + (t.b ? `:${t.b.id}:${t.b.lvl}:${t.b.res || 0}:${t.b.build || 0}:${Math.round(t.b.cond ?? 100)}` : ""));
  const { tiles: _, ...rest } = s;
  return JSON.stringify({ ...rest, tiles });
}

export function unpack(text) {
  const o = JSON.parse(text);
  if (!o || o.v !== 1 || !Array.isArray(o.tiles)) throw new Error("bad save");
  // Saves from the 30×30 map: the old town goes in the middle, with new land around it to buy.
  const old = Math.round(Math.sqrt(o.tiles.length));
  if (old * old !== o.tiles.length || old > N) throw new Error("bad save");
  if (old < N) {
    const off = (N - old) / 2, land = makeLand(rng((o.seed || 1) + 7));
    const fresh = land.map((t) => (t.t === "sand" ? "" : t.t[0]));
    o.tiles.forEach((str, i) => { fresh[idx((i % old) + off, Math.floor(i / old) + off)] = str; });
    o.tiles = fresh;
    if (o.cam) { o.cam = null; }
  }
  o.size = N;
  o.owned ||= {};
  o.name ||= "الرافعية"; o.site ||= "main"; o.terrain ||= "wadi";
  // Version 3 (houses are upgraded by the mayor): every house in an older save goes back to a tent.
  const toTents = o.hv !== 3;
  const shift = 0;
  o.hv = 3;
  const faydaMissing = o.fv !== 1;
  o.fv = 1;
  o.tiles = o.tiles.map((str) => {
    const [t, id, lvl, res, build, cond] = String(str).split(":");
    const ground = t === "w" ? "wadi" : t === "r" ? "rock" : t === "f" ? "fayda" : t === "l" ? "lake" : "sand";
    const b = id && B[id] ? { id, lvl: id === "house" && toTents ? 0 : Math.min((Number(lvl) || 0) + shift, (B[id].levels?.length || BIZ_LEVELS[id]?.length || 1) - 1), res: Number(res) || 0 } : null;
    if (b && Number(build) > 0) b.build = Number(build);
    if (b) b.cond = cond === undefined ? 100 : Number(cond);
    return { t: ground, b };
  });
  if (faydaMissing) addFayda(o.tiles, rng((o.seed || 1) + 99));
  // The land the town already used is its own, even outside the middle.
  o.tiles.forEach((t, i) => { if (t.b) { const p = plotAt(i % N, Math.floor(i / N)); if (p) o.owned[p] = true; } });
  return o;
}
