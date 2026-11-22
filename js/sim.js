// The town simulation: pure functions on a plain state object, so it saves as JSON and can be tested.
import { B, TECH, EVENTS, DECISIONS, ACHIEVEMENTS, GOALS, ERAS, MAP_SIZE, START_MONEY, SEASONS, SEASON_DAYS, HOURS, OWN_START, PLOTS, PLOT_PRICES, UPKEEP_RULES, PROVINCE_FEES, YEAR_HOURS, LOANS, BIZ_LEVELS, BIZ_UP, bizLevel } from "./data.js";

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
    v: 1, hv: 3, fv: 1, size: N, owned: {}, seed, day: 3, // hour 3 of day 1: two hours after sunrise
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
  if (def.unique && s.tiles.some((t) => t.b?.id === id)) return "عندك واحد منه";
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
  t.b = { id, lvl: 0, res: 0, day: s.day, cond: 100 };
  if (B[id].buildHours) t.b.build = B[id].buildHours; // a grand project: a building site for a while
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
const wears = (b) => b && !["road", "asphalt"].includes(b.id) && !(b.id === "house" && b.lvl === 0) && !(b.build > 0);
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
const isRoad = (t) => t && t.b && (t.b.id === "road" || t.b.id === "asphalt");

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
    if (def.water > 0) a.waterSupply += def.water * f; else if (def.water && works && a.watered[here]) a.waterUse -= def.water;
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
      for (let yy = y - def.radius; yy <= y + def.radius; yy++) for (let xx = x - def.radius; xx <= x + def.radius; xx++) {
        if (!inMap(xx, yy) || Math.abs(xx - x) + Math.abs(yy - y) > def.radius) continue;
        const i = idx(xx, yy);
        if (def.happy) a.local[i] += (s.money < 0 && def.cat === "serv" ? def.happy / 2 : def.happy) * f;
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
  a.workers = Math.round(s.pop * 0.55);
  a.employed = Math.min(a.workers, a.jobs);
  a.staffing = a.jobs ? a.employed / a.jobs : 0;
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
  a.shopRaw = 0; a.visitorIncome = 0; a.industryIncome = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const t = s.tiles[idx(x, y)];
    if (!t.b || !t.b.works) continue;
    const def = B[t.b.id];
    if (!def.income) continue;
    if (def.cat === "farm" && (t.b.id === "palms" || t.b.id === "veg")) {
      const wadi = t.t === "wadi" ? 1.5 : 1;
      a.farmIncome += def.income * bizLevel(t.b).income * wadi * farmMult * (0.4 + 0.6 * a.waterRatio) * (0.5 + 0.5 * a.staffing) * condFactor(t.b);
    } else {
      let inc = def.income * bizLevel(t.b).income * (0.3 + 0.7 * a.staffing) * (0.4 + 0.6 * a.powerRatio) * condFactor(t.b);
      if (t.b.id === "datefactory") inc *= 1 + Math.min(1, palms.length * 0.1);
      if (def.visitors) a.visitorIncome += inc * shopMult;
      else if (def.cat === "shop") a.shopRaw += inc * shopMult;
      else a.industryIncome += inc;
    }
  }
  a.shopDemand = s.pop * 0.6 * shopMult;
  // Traffic: too many people for the roads, and dirt roads at that, keep customers away.
  const roadsAll = a.count.road + a.count.asphalt;
  a.congestion = roadsAll ? Math.max(0, Math.min(0.4, s.pop / (roadsAll * 20) - 1)) * (a.count.road / roadsAll) : 0;
  a.shopIncome = Math.min(a.shopRaw, a.shopDemand) * (1 - a.congestion);
  // Workshops and factories sell outside, but the traders who buy from a town of this size only take
  // so much: past that, extra output sells at about a third of the price.
  a.industryRaw = a.industryIncome;
  a.exportDemand = 300 + s.pop * 0.9;
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
  for (let i = 0; i < N * N; i++) {
    const t = s.tiles[i];
    if (!t.b || t.b.id !== "house" || !t.b.works) continue;
    const local = Math.min(40, a.local[i]) - Math.min(30, a.pollution[i]) - (a.watered[i] ? 0 : 10) - (a.grid && t.b.lvl >= 3 && !a.powered[i] ? 6 : 0); // villas and towers live on electricity
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
  // How much people trust the mayor (from answering them in the news): ±8 at most.
  a.councilMood = Math.max(-8, Math.min(8, ((s.trust ?? 60) - 60) * 0.3));
  a.happyTarget = clamp(
    48 + a.faydaHappy + a.councilMood + local * 0.9 - (1 - a.waterRatio) * 35 - (1 - a.powerRatio) * 22 - a.unemployment * 30 - (s.tax - 10) * 1.6 + eventHappy(s) - (s.money < 0 ? 12 : 0), 0, 100); // in debt: wages run late
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
  const cost = upgradeCost(b);
  if (s.money < cost) return "ما يكفي المال";
  s.money -= cost;
  b.lvl++; b.cond = 100; b.upAt = s.day;
  return "";
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
  const cost = upgradeCost(b);
  if (s.money < cost) return "ما يكفي المال";
  s.money -= cost;
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
  // A flash flood down the wadi, now and then while it rains (much rarer with dams).
  const raining = s.events.some((e) => e.id === "rain");
  if (raining && s.day - (s.lastFlood ?? -999) > 72 && r() < (s.tech.dams ? 0.008 : 0.03)) {
    const lost = [], damaged = [];
    let refund = 0;
    s.tiles.forEach((t, i) => {
      if (t.t !== "wadi" || !t.b) return;
      const isRoad = t.b.id === "road" || t.b.id === "asphalt";
      if (r() < (isRoad ? 0.3 : 0.45)) { lost.push({ i, id: t.b.id }); refund += lose(s, t); }
      else if (!isRoad) { t.b.cond = Math.max(1, (t.b.cond ?? 100) - 50); damaged.push(i); }
    });
    if (lost.length || damaged.length) {
      s.lastFlood = s.day;
      const names = [...new Set(lost.filter((x) => x.id !== "road" && x.id !== "asphalt").map((x) => B[x.id].name))].slice(0, 3);
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
    const fee = PROVINCE_FEES[s.era];
    if (fee) { s.money -= fee; msgs.push({ kind: "event", title: "رسوم المحافظة", text: `دفعت الرافعية رسومها السنوية للمحافظة: ${fee} ريال.` }); }
    if (!s.decision && s.pop >= 30) { s.decision = { id: "raise" }; msgs.push({ kind: "decision", text: "علاوة" }); }
  }
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
  // Version 3 (houses are upgraded by the mayor): every house in an older save goes back to a tent.
  const toTents = o.hv !== 3;
  const shift = 0;
  o.hv = 3;
  const faydaMissing = o.fv !== 1;
  o.fv = 1;
  o.tiles = o.tiles.map((str) => {
    const [t, id, lvl, res, build, cond] = String(str).split(":");
    const ground = t === "w" ? "wadi" : t === "r" ? "rock" : t === "f" ? "fayda" : "sand";
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
