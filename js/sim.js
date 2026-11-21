// The town simulation: pure functions on a plain state object, so it saves as JSON and can be tested.
import { B, TECH, EVENTS, GOALS, ERAS, MAP_SIZE, START_MONEY, SEASONS, SEASON_DAYS, HOURS, OWN_START, PLOTS, PLOT_PRICES } from "./data.js";

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

/** Sand, a winding wadi and scattered rocks over the whole map. */
function makeLand(r) {
  const tiles = Array.from({ length: N * N }, () => ({ t: "sand", b: null }));
  // A dry wadi winding across the land: fertile ground for farms.
  let y = Math.floor(N * 0.3 + r() * N * 0.2);
  for (let x = 0; x < N; x++) {
    for (let w = -1; w <= 1; w++) if (inMap(x, y + w)) tiles[idx(x, y + w)].t = "wadi";
    if (r() < 0.35) y = clamp(y + (r() < 0.5 ? -1 : 1), 2, N - 3);
  }
  // Rocks here and there (cost a little to clear).
  for (let i = 0; i < N * N * 0.053; i++) {
    const x = Math.floor(r() * N), yy = Math.floor(r() * N), t = tiles[idx(x, yy)];
    if (t.t === "sand") t.t = "rock";
  }
  addFayda(tiles, r);
  return tiles;
}

// ---------- new game ----------

export function newGame(seed = Math.floor(Math.random() * 1e9)) {
  const r = rng(seed);
  const tiles = makeLand(r);
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
    v: 1, hv: 2, fv: 1, size: N, owned: {}, seed, day: 3, // hour 3 of day 1: two hours after sunrise
    money: START_MONEY, tax: 10, era: 0, pop: 9, happy: 55, tiles,
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
function addFayda(tiles, r) {
  const cx = Math.floor(N / 2), cy = Math.floor(N / 2) + 3;
  let made = 0;
  for (let tries = 0; tries < 300 && made < 5; tries++) {
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
  if (t.b) {
    if (id === "asphalt" && t.b.id === "road") return s.money < def.cost ? "ما يكفي المال" : "";
    return "المكان مشغول";
  }
  const cost = def.cost + (t.t === "rock" ? ROCK_CLEAR : 0);
  if (s.money < cost) return "ما يكفي المال";
  return "";
}

export function build(s, x, y, id) {
  const why = cantBuild(s, x, y, id);
  if (why) return why;
  const t = s.tiles[idx(x, y)];
  s.money -= B[id].cost + (t.t === "rock" ? ROCK_CLEAR : 0);
  if (t.t === "rock") t.t = "sand";
  t.b = { id, lvl: 0, res: 0, day: s.day };
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

// ---------- analysis: what the town looks like right now ----------

const near4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const isRoad = (t) => t && t.b && (t.b.id === "road" || t.b.id === "asphalt");

export function onRoad(s, x, y) {
  return near4.some(([dx, dy]) => inMap(x + dx, y + dy) && isRoad(s.tiles[idx(x + dx, y + dy)]));
}

/** Needs a road to work: homes, shops and services. Farms and utilities work on their own. */
const needsRoad = (def) => ["home", "shop", "serv"].includes(def.cat) || def.jobs && def.cat !== "farm";

export function activeEvent(s, key) {
  let m = 1;
  for (const e of s.events) { const d = EVENTS.find((x) => x.id === e.id); if (d && d[key] !== undefined && typeof d[key] === "number") m *= key === "happy" ? 1 : d[key]; }
  return m;
}
const eventHappy = (s) => s.events.reduce((a, e) => a + (EVENTS.find((x) => x.id === e.id)?.happy || 0), 0);

export function analyze(s) {
  const a = {
    count: Object.fromEntries(Object.keys(B).map((k) => [k, 0])), levels: B.house.levels.map(() => 0),
    waterSupply: 0, waterUse: 0, powerSupply: 0, powerUse: 0, cap: 0, jobs: 0, income: 0, farmIncome: 0,
    upkeep: 0, homes: 0, connectedHomes: 0, local: new Float32Array(N * N), pollution: new Float32Array(N * N),
    services: Array.from({ length: N * N }, () => new Set())
  };
  const concrete = s.tech.concrete ? 1.25 : 1;
  const palms = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const t = s.tiles[idx(x, y)];
    if (!t.b) continue;
    const def = B[t.b.id];
    a.count[t.b.id]++;
    const works = !needsRoad(def) || onRoad(s, x, y);
    t.b.works = works;
    if (def.water > 0) a.waterSupply += def.water; else if (def.water && works) a.waterUse -= def.water;
    if (def.power > 0) a.powerSupply += def.power; else if (def.power && works) a.powerUse -= def.power;
    a.upkeep += def.upkeep || 0;
    if (t.b.id === "house") {
      a.homes++;
      a.levels[t.b.lvl]++;
      if (works) { a.connectedHomes++; a.cap += Math.round(def.levels[t.b.lvl].cap * concrete); }
      a.waterUse += t.b.lvl; // bigger homes use more
    }
    if (works && def.jobs) a.jobs += def.jobs;
    if (t.b.id === "palms") palms.push(t);
    // Services and nuisances spread over their radius.
    if (works && def.radius && (def.happy || def.pollute)) {
      for (let yy = y - def.radius; yy <= y + def.radius; yy++) for (let xx = x - def.radius; xx <= x + def.radius; xx++) {
        if (!inMap(xx, yy) || Math.abs(xx - x) + Math.abs(yy - y) > def.radius) continue;
        const i = idx(xx, yy);
        if (def.happy) a.local[i] += def.happy;
        if (def.pollute) a.pollution[i] += def.pollute;
        if (def.service) a.services[i].add(def.service);
      }
    }
  }
  if (s.tech.zakat) a.upkeep *= 0.85;
  a.waterSupply *= activeEvent(s, "water");
  if (seasonOf(s.day).id === "summer") a.waterUse = Math.round(a.waterUse * 1.1);
  a.waterRatio = a.waterUse ? clamp(a.waterSupply / a.waterUse, 0, 1) : 1;
  // Before the town has a power grid (the village stage) nothing needs electricity.
  a.grid = s.era >= 1 || a.powerSupply > 0;
  a.powerRatio = !a.grid ? 1 : a.powerUse ? clamp(a.powerSupply / a.powerUse, 0, 1) : 1;
  a.workers = Math.round(s.pop * 0.55);
  a.employed = Math.min(a.workers, a.jobs);
  a.staffing = a.jobs ? a.employed / a.jobs : 0;
  a.unemployment = a.workers ? 1 - a.employed / a.workers : 0;

  // Money for one day.
  const shopMult = activeEvent(s, "shop") * (s.tech.smart ? 1.2 : 1);
  const farmMult = activeEvent(s, "farm") * (s.tech.irrigation ? 1.3 : 1) * (s.tech.smart ? 1.2 : 1);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const t = s.tiles[idx(x, y)];
    if (!t.b || !t.b.works) continue;
    const def = B[t.b.id];
    if (!def.income) continue;
    if (def.cat === "farm" && (t.b.id === "palms" || t.b.id === "veg")) {
      const wadi = t.t === "wadi" ? 1.5 : 1;
      a.farmIncome += def.income * wadi * farmMult * (0.4 + 0.6 * a.waterRatio) * (0.5 + 0.5 * a.staffing);
    } else {
      let inc = def.income * (0.3 + 0.7 * a.staffing) * (0.4 + 0.6 * a.powerRatio);
      if (t.b.id === "datefactory") inc *= 1 + Math.min(1, palms.length * 0.1);
      a.income += inc * (def.cat === "shop" ? shopMult : 1);
    }
  }
  // Tax per person falls a little as the town grows, so big cities do not drown in money.
  a.tax = s.pop * (s.tax / 100) * (3 - Math.min(1.2, s.pop / 2500));
  a.net = Math.round(a.income + a.farmIncome + a.tax - a.upkeep);

  // How happy people are where they live.
  let sum = 0, weight = 0;
  for (let i = 0; i < N * N; i++) {
    const t = s.tiles[i];
    if (!t.b || t.b.id !== "house" || !t.b.works) continue;
    const local = Math.min(40, a.local[i]) - Math.min(30, a.pollution[i]);
    t.b.local = local;
    const w = Math.max(1, t.b.res || 1);
    sum += local * w; weight += w;
  }
  const local = weight ? sum / weight : 0;
  // Seasons: a green faydah in spring lifts spirits; summer heat makes homes thirstier.
  const season = seasonOf(s.day);
  a.season = season;
  a.fayda = 0;
  if (season.id === "spring") for (const t of s.tiles) if (t.t === "fayda" && !t.b) a.fayda++;
  a.faydaHappy = Math.min(8, a.fayda * 0.35);
  a.happyTarget = clamp(
    48 + a.faydaHappy + local * 0.9 - (1 - a.waterRatio) * 35 - (1 - a.powerRatio) * 22 - a.unemployment * 30 - (s.tax - 10) * 1.6 + eventHappy(s), 0, 100);
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
  if (n.pop && s.pop < n.pop) return `الأهل ما استقروا بعد: تحتاج ${n.pop} ساكن (الحين ${s.pop})`;
  if (n.water && a.waterRatio < 0.95) return "يحتاج ماء أكثر";
  if (n.power && (!a.grid || a.powerSupply === 0 || a.powerRatio < 0.95)) return "يحتاج كهرباء";
  const here = s.happy + (t.b.local || 0) * 0.6;
  if (n.happy && here < n.happy) return "يحتاج رضا أكثر (خدمات قريبة، حدائق، مساجد)";
  if (n.services && a.services[idx(x, y)].size < n.services) return `يحتاج ${n.services} خدمات قريبة (مسجد، مدرسة، مستوصف، أمن)`;
  return "";
}

export function step(s, r = Math.random) {
  const a = analyze(s);
  // People move in when there is room and life is good, and leave when it is not.
  const pull = clamp((s.happy - 25) / 50, 0, 1.2) * (1 - a.unemployment * 0.8);
  const target = a.cap * clamp(pull, 0, 1);
  const before = s.pop;
  s.pop = Math.max(0, Math.round(s.pop + (target - s.pop) * 0.12 + (target > s.pop ? 1 : 0)));
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
  // Houses move up (or slip down) a level.
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const t = s.tiles[idx(x, y)];
    if (t.b?.id !== "house") continue;
    if (!houseBlocker(s, a, x, y) && t.b.res >= B.house.levels[t.b.lvl].cap * 0.6 && r() < 0.25) {
      t.b.lvl++; t.b.upAt = s.day;
    } else if (t.b.lvl > 0 && (a.waterRatio < 0.6 || s.happy < 25) && r() < 0.08) t.b.lvl--;
  }
  s.money += a.net;
  s.happy = Math.round((s.happy * 0.7 + a.happyTarget * 0.3) * 10) / 10;
  const seasonBefore = seasonOf(s.day).i;
  s.day++;

  const msgs = [];
  // Stage of the town never goes back.
  for (const e of ERAS) if (s.pop >= e.pop && e.id > s.era) { s.era = e.id; msgs.push({ kind: "era", text: `الرافعية صارت ${e.name}! مباني جديدة انفتحت.` }); }
  // A new season.
  const season = seasonOf(s.day);
  if (season.i !== seasonBefore) msgs.push({ kind: "season", title: season.name, text: season.start });
  // Research.
  if (s.research && --s.research.left <= 0) {
    s.tech[s.research.id] = true;
    msgs.push({ kind: "tech", text: `انتهى بحث «${TECH[s.research.id].name}».` });
    s.research = null;
  }
  // Events.
  s.events = s.events.filter((e) => --e.left > 0);
  if (!s.events.length && s.day > 6 && r() < 0.09) {
    const pool = EVENTS.filter((e) => !e.tech || s.tech[e.tech]);
    let roll = r() * pool.reduce((t, e) => t + e.weight, 0);
    const ev = pool.find((e) => (roll -= e.weight) < 0) || pool[0];
    s.events.push({ id: ev.id, left: ev.days });
    let text = ev.text;
    if (ev.gift) { const g = 200 + Math.round(s.pop * 0.8); s.money += g; text += ` (+${g} ريال)`; }
    msgs.push({ kind: "event", title: ev.name, text });
  }
  // Goals.
  const g = GOALS[s.goal];
  if (g && g.test(goalView(s, analyze(s)))) {
    s.money += g.reward;
    msgs.push({ kind: "goal", text: `أنجزت: ${g.text} (+${g.reward} ريال)` });
    s.goal++;
  }
  s.history.push({ d: s.day, p: s.pop, m: Math.round(s.money), h: Math.round(s.happy), n: a.net });
  if (s.history.length > 60) s.history.shift();
  s.lastGrowth = s.pop - before;
  return { a, msgs };
}

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
  for (let i = 0; i < days; i++) msgs.push(...step(s).msgs);
  return { days, pop: s.pop - start.pop, money: Math.round(s.money - start.money), msgs };
}

// ---------- saving ----------

export function pack(s) {
  const tiles = s.tiles.map((t) => (t.t === "sand" ? "" : t.t[0]) + (t.b ? `:${t.b.id}:${t.b.lvl}:${t.b.res || 0}` : ""));
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
  const shift = o.hv === 2 ? 0 : 1; // saves from before tents: every house moves up one step
  o.hv = 2;
  const faydaMissing = o.fv !== 1;
  o.fv = 1;
  o.tiles = o.tiles.map((str) => {
    const [t, id, lvl, res] = String(str).split(":");
    const ground = t === "w" ? "wadi" : t === "r" ? "rock" : t === "f" ? "fayda" : "sand";
    return { t: ground, b: id && B[id] ? { id, lvl: Math.min((Number(lvl) || 0) + (id === "house" ? shift : 0), (B[id].levels?.length || 1) - 1), res: Number(res) || 0 } : null };
  });
  if (faydaMissing) addFayda(o.tiles, rng((o.seed || 1) + 99));
  // The land the town already used is its own, even outside the middle.
  o.tiles.forEach((t, i) => { if (t.b) { const p = plotAt(i % N, Math.floor(i / N)); if (p) o.owned[p] = true; } });
  return o;
}
