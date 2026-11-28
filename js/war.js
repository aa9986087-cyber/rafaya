// «صراع الجوف»: the rules of war in the world of al-Jouf. Pure functions and numbers only, so the
// same rules run on the server (src/worker.js through js/warserver.js, which decides every result)
// and in the game (to show prices, reasons and what an attack could do before asking the server).
// Nothing here is real-world: speeds, ranges and damage are game balance values.
import { B, MIL, MIL_SLOTS, ERAS, GREATER_CITY_STAGE, MAP_SIZE, worldXY } from "./data.js";

const WAR_MIN = 60000, WAR_HOUR = 60 * WAR_MIN;
/** One day of al-Jouf in real time (24 game hours of 50 s = 20 minutes): the war's weeks and months follow the game's calendar. */
export const JOUF_DAY = 24 * 50000;
const warClamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Balance: every timing is in real milliseconds (the world runs on real time for everyone). */
export const WAR = {
  minEra: 1,                 // a village (قرية) can neither attack nor be attacked
  newPlayer: 24 * WAR_HOUR,      // a new player is protected this long after joining
  sleep: 7 * 24 * WAR_HOUR,      // a town not played this long sleeps and cannot be attacked
  away: 2 * WAR_HOUR,            // the owner counts as away after this long without a sync (lower loss cap)
  bully: 2,                  // a town two stages above another cannot declare war on it
  T: {
    hostileToWar: 10 * WAR_MIN,  // hostility must stand this long before war can be declared
    warning: 0,                  // a declared war starts at once: the first strike may go straight away (the owner, 28 Nov 2026)
    war: 24 * WAR_HOUR,          // how long a war lasts (a real day, the owner 28 Nov 2026), then it is judged and goes back to hostility
    truce: 2 * JOUF_DAY,         // a truce (both agree, any time) stops strikes this long, and ends the war
    peaceCool: 14 * JOUF_DAY,    // after peace, no new hostility or war between the two for two weeks of al-Jouf
    warCool: 24 * WAR_HOUR,      // after a war ends, no new war between the two for a real day (a shield ends it sooner: when the shield ends)
    tributeAnswer: JOUF_DAY,     // a demand of tribute waits a day of al-Jouf for its answer, then it is war
    tributePeace: 30 * JOUF_DAY, // tribute paid: no war and no new demand between the two for a month of al-Jouf
    shieldLast: 3 * 24 * WAR_HOUR, // a bought shield lasts three real days (owner, 2026-11-26)
    shieldEvery: 7 * 24 * WAR_HOUR, // and the next one four real days after it ends (seven after it was raised)
    say: 3000,                   // one line in a threat talk this often
    offer: JOUF_DAY,             // an offer of truce or peace waits a day of al-Jouf for an answer
    heat: 60 * WAR_MIN,          // a launcher that fired lately needs longer to get ready again (half as long again, never more)
    threat: 30 * WAR_MIN         // one threat per pair this often (the old ready-made threats)
  },
  flight: { missile: { base: 12000, perCell: 800 }, drone: { base: 25000, perCell: 2200 } },
  caps: {
    perOp: 60,               // most damage one operation can do to its building
    building: 100,           // a building's war damage never passes this (it is out of action, never removed)
    rehitWindow: 6 * WAR_HOUR, rehitMax: 2,   // the same building is hit at most twice in 6 hours
    awayWindow: 12 * WAR_HOUR, awayMax: 3,    // (the old protection of an owner away: off since 28 Nov 2026, see awayOn)
    inFlightTo: 3                          // operations flying at one town at once (from everyone)
  },
  interceptor: { price: 600, name: "صاروخ اعتراضي" },
  shieldPrice: [5000, 10000, 20000, 35000, 55000, 75000], // the bought shield, by the town's stage (village … greater city)
  tribute: { min: 1000, share: 0.15 }, // a demand of tribute: at least this, at most this share of the other town's budget
  maxWars: 3,                 // a town is at war with three towns at most at once
  casualty: { dead: 0.06, hurt: 0.3, warned: 0.6 }, // of the people reached (occupants × damage): killed, injured; × warned when the sirens sounded
  repairPerPoint: 45 * 1000,  // repair time: 45 s per point of damage (a building at 60% → 45 min)
  repairPrice: 0.012,         // repair: × the building's price, per point of damage
  autoBudget: 5000,           // the deputy's default repair and refill budget, per day
  rubble: { price: 0.1, min: 500, ms: 15 * WAR_MIN }, // clearing the rubble of a building: × its price × (1 + level) (at least min), and this long
  heavyIntc: 2,               // interceptors one try at a destructive weapon takes
  heavyDay: 24 * WAR_HOUR,    // the window of the counts below (the owner, 28 Nov 2026):
  heavyOut: 6,                // a town launches at most 6 destructive weapons in it
  heavyIn: 4,                 // and at most 4 are fired at one town in it
  // the war of 28 Nov 2026 (the owner, one question at a time):
  awayOn: false,              // no protection for an owner away: the defences and the deputy fight for the town
  heatMax: 1,                 // launches in the heat window add half the wait at most once (not once per launch)
  prize: 0.2,                 // the war's end: the town hurt more pays the other this share of its budget
  ruin: 0.5,                  // the war's end: a town with this share of its worth out of action (disabled or rubble) drops a stage
  flatAt: 85                  // a building already out of action (this damage or more) that is hit again falls to rubble
};
/** The destructive weapons (quake, storm) and «منظومة الحصن»: ready, but the owner releases them later (28 Nov 2026). */
export const HEAVY_ON = false;

/** The live rules as written (the trial copy shortens WAR's waits in place; the war guide always tells these). */
export const WAR_LIVE = JSON.parse(JSON.stringify(WAR));
/** The same rules with every wait cut short: only for local tests and the trial copy, never the live world. */
export function fastWar(div = 30) {
  const T = Object.fromEntries(Object.entries(WAR.T).map(([k, v]) => [k, Math.round(v / div)]));
  return { ...WAR, newPlayer: 0, T, rubble: { ...WAR.rubble, ms: WAR.rubble.ms / div }, heavyDay: WAR.heavyDay / div, caps: { ...WAR.caps, rehitWindow: WAR.caps.rehitWindow / div, awayWindow: WAR.caps.awayWindow / div }, repairPerPoint: WAR.repairPerPoint / 6 };
}

/** The weapons. needs: the building and level that must stand (milWorks) to own and launch it. */
export const WEAPONS = {
  drone: { name: "مسيّرة شاهين", kind: "drone", price: 900, fee: 150, power: 16, evade: 1, blast: 0.7, needs: ["dronebase", 0], icon: "🛩️", text: "رخيصة وبطيئة، ضررها محدود، والدفاع يصيدها بسهولة." },
  drone2: { name: "مسيّرة صقر", kind: "drone", price: 2400, fee: 300, power: 26, evade: 0.8, blast: 0.95, needs: ["dronebase", 1], icon: "🦅", text: "أغلى وأذكى: تتهرب من الدفاع أكثر وضررها أكبر." },
  missile: { name: "صاروخ طويق", kind: "missile", price: 4500, fee: 500, power: 38, evade: 0.75, blast: 1.5, needs: ["missilepad", 0], icon: "🚀", text: "سريع وضرره متوسط. الدفاع المتوسط والمتقدم يقدرون عليه." },
  missile2: { name: "صاروخ النفود", kind: "missile", price: 11000, fee: 900, power: 56, evade: 0.55, blast: 2.1, needs: ["missilepad", 2], icon: "☄️", text: "الأقوى: ضرر كبير ويصعب اعتراضه. يحتاج مجمع صواريخ." },
  // the destructive weapons (the owner, 28 Nov 2026): every building they reach (never a mosque) falls to rubble,
  // to be cleared before anything is built there again. Only «منظومة الحصن» can stop them. Off until HEAVY_ON.
  ...(HEAVY_ON ? HEAVY_WEAPONS() : {})
};
function HEAVY_WEAPONS() { return {
  quake: { name: "صاروخ الزلزال", kind: "missile", heavy: true, price: 150000, fee: 10000, power: 100, evade: 1, blast: 1.6, needs: ["missilepad", 2], minEra: 4, icon: "🌋", text: "مدمّر: يسوّي كل المباني اللي حوله بالأرض ويخليها ركام. الدفاع الجوي العادي ما يقدر عليه، بس «منظومة الحصن»." },
  storm: { name: "صاروخ الإعصار", kind: "missile", heavy: true, price: 400000, fee: 25000, power: 100, evade: 0.8, blast: 2.6, needs: ["missilepad", 2], minEra: 4, icon: "🌪️", text: "أقوى سلاح بالجوف: يمسح حارة كاملة ويخليها ركام، وأصعب بالاعتراض حتى على «منظومة الحصن»." }
}; }
/** A destructive weapon: what it reaches falls to rubble. */
export const isHeavy = (wid) => !!WEAPONS[wid]?.heavy;
/** How many of one kind (drone or missile) in an arsenal or a load. */
export const kindSum = (o, kind) => WEAPON_IDS.reduce((n, w) => n + (WEAPONS[w].kind === kind ? o?.[w] || 0 : 0), 0);
export const WEAPON_IDS = Object.keys(WEAPONS);
export const MIL_IDS = Object.keys(MIL);

/** What a hit does there (the military and the utilities in words of their own; the rest by kind below). */
export const TARGETS = {
  milhq: "تقل جاهزية العمليات: عمليات أقل بالجو",
  dronebase: "تقل سعة المسيّرات، وإذا تعطلت ما تطلق",
  missilepad: "تتعطل المنصة أو يطول تجهيزها",
  fortdef: "تقل حمايتك من الأسلحة المدمّرة",
  radar: "يقل الإنذار ودقة الدفاع الجوي",
  airdef: "تقل جاهزية الحماية من الهجمات",
  armory: "تقل سعة التخزين",
  barracks: "يقل عدد الجنود ويوقف التدريب",
  generator: "ينقص إنتاج الكهرباء", powerplant: "ينقص إنتاج الكهرباء", solar: "ينقص إنتاج الكهرباء", windfarm: "ينقص إنتاج الكهرباء",
  tank: "ينقص الماء", desal: "ينقص الماء",
  workshop: "ينقص الإنتاج والدخل", factory: "ينقص الإنتاج والدخل", datefactory: "ينقص الإنتاج والدخل", dairy: "ينقص الإنتاج والدخل",
  mill: "ينقص الإنتاج والدخل", oilpress: "ينقص الإنتاج والدخل", blockfactory: "تنقص مواد البناء", quarry: "تنقص مواد البناء",
  mall: "ينقص دخل المجمع"
};
/** Mosques are never struck, and a blast near them leaves them whole (the owner's rule). */
export const MOSQUES = new Set(["mosque", "bigmosque"]);
/** Everything may be struck except the mosques: a strike falls on a spot, and what stands around it is hit too. */
export const canTarget = (id) => !!B[id] && !MOSQUES.has(id);
const KIND_TEXT = {
  home: "تتضرر البيوت، ويطلع منها سكانها لين تتصلّح", shop: "ينقص الدخل والوظائف", serv: "تتعطل الخدمة عن الحي", part: "تتضرر الزينة",
  road: "ينقطع الطريق أو يبطأ", farm: "ينقص الإنتاج", util: "ينقص الماء أو الكهرباء", proj: "يتعطل المشروع لين يتصلّح", deco: "تتضرر الزينة"
};
export const targetText = (id) => TARGETS[id] || KIND_TEXT[B[id]?.cat] || "يتضرر المبنى";
/**
 * What a blast at (x, y) with radius r reaches: every building within r (the tile it falls on fully, the
 * ones further away less), never a mosque. list: [{ x, y, id, ... }] → [{ ...b, d, f }].
 */
export function blastArea(list, x, y, r) {
  return list.filter((b) => !MOSQUES.has(b.id)).map((b) => ({ ...b, d: Math.hypot(b.x - x, b.y - y) }))
    .filter((b) => b.d <= r + 0.01).map((b) => ({ ...b, f: b.d < 0.5 ? 1 : Math.max(0.3, 1 - (b.d - 0.5) / (r + 0.5)) }))
    .sort((p, q) => p.d - q.d);
}

/** How well a building with war damage still works (0 … 1). */
export const warFactor = (wd) => (!wd ? 1 : wd >= 85 ? 0 : 1 - wd * 0.007);
export const DAMAGE_STATES = [
  { upTo: 0, name: "سليم", cls: "ok" },
  { upTo: 29, name: "متضرر خفيف", cls: "light" },
  { upTo: 59, name: "متضرر متوسط", cls: "mid" },
  { upTo: 84, name: "متضرر بشدة", cls: "heavy" },
  { upTo: 100, name: "متعطل مؤقتًا", cls: "out" }
];
export const damageState = (wd) => DAMAGE_STATES.find((d) => (wd || 0) <= d.upTo) || DAMAGE_STATES[4];

/** A military building's numbers at its level. */
export const milStat = (id, lvl = 0) => MIL[id]?.[Math.min(lvl || 0, MIL[id].length - 1)] || {};

// ---------- reading a town from its saved snapshot (the server only trusts what it can read here) ----------

/** The buildings of a packed town: [{ x, y, id, lvl, build }] (tiles "t:id:lvl:res:build:cond:rot:wd"). */
export function snapBuildings(snap) {
  const o = typeof snap === "string" ? (snap ? JSON.parse(snap) : null) : snap;
  if (!o || !Array.isArray(o.tiles)) return { list: [], era: 0, money: 0, seq: 0 };
  const n = Math.round(Math.sqrt(o.tiles.length)) || MAP_SIZE, list = [];
  o.tiles.forEach((str, i) => {
    const [, id, lvl, res, build] = String(str).split(":");
    if (id && B[id]) list.push({ x: i % n, y: Math.floor(i / n), id, lvl: Number(lvl) || 0, res: Number(res) || 0, build: Number(build) || 0 });
  });
  return { list, era: o.era || 0, money: Number(o.money) || 0, seq: Number(o.war?.seq) || 0, name: o.name };
}

/**
 * A town's military strength from its buildings and the war damage the server holds for it
 * (dmg: Map "x:y" → damage 0…100). Buildings still under construction do not count.
 */
export function milProfile(snapOrList, dmg = new Map()) {
  const town = Array.isArray(snapOrList) ? { list: snapOrList, era: 0 } : snapBuildings(snapOrList);
  const p = { era: town.era, hq: null, bases: [], pads: [], radars: [], airdefs: [], forts: [], armory: null, barracks: null };
  for (const b of town.list) {
    if (!MIL[b.id] || b.build > 0) continue;
    const it = { x: b.x, y: b.y, lvl: b.lvl, wd: dmg.get(`${b.x}:${b.y}`) || 0 };
    if (b.id === "milhq") p.hq = it;
    else if (b.id === "dronebase") p.bases.push(it);
    else if (b.id === "missilepad") p.pads.push(it);
    else if (b.id === "radar") p.radars.push(it);
    else if (b.id === "airdef") p.airdefs.push(it);
    else if (b.id === "fortdef") p.forts.push(it);
    else if (b.id === "armory") p.armory = it;
    else if (b.id === "barracks") p.barracks = it;
  }
  return p;
}
const milWorks = (it) => it && it.wd < 85;

/** Open war: no store limit for drones and missiles (a working base or pad is enough); the launchers set how many go at once. */
export const OPEN_STOCK = 9999;
/** How much the town can store of each thing: { drones, missiles, intc, open }. */
export function capacity(p) {
  const store = milWorks(p.armory) ? milStat("armory").store * warFactor(p.armory.wd) + (1 - warFactor(p.armory.wd)) : 1;
  const sum = (list, k, id) => list.filter(milWorks).reduce((n, it) => n + Math.round(milStat(id, it.lvl)[k] * (it.wd >= 30 ? 0.5 : 1)), 0);
  return {
    drones: p.bases.some(milWorks) ? OPEN_STOCK : 0,
    missiles: p.pads.some(milWorks) ? OPEN_STOCK : 0,
    open: true,
    intc: Math.floor((sum(p.airdefs, "intc", "airdef") + sum(p.forts || [], "intc", "fortdef")) * store)
  };
}

/** Can the town own and launch this weapon (the right building, milWorks, at the right level)? Returns why not, or "". */
export function weaponBlocker(p, wid) {
  const w = WEAPONS[wid];
  if (!w) return "سلاح غير معروف";
  if (w.minEra && (p.era || 0) < w.minEra) return `للحاضرة وفوق بس: مدينتك لازم تصير «${ERAS[w.minEra].name}»`;
  const [id, lvl] = w.needs, list = id === "dronebase" ? p.bases : p.pads;
  if (!list.length) return `يحتاج ${B[id].name}`;
  if (!list.some((it) => it.lvl >= lvl)) return `يحتاج «${milStat(id, lvl).name}»`;
  if (!list.some((it) => it.lvl >= lvl && milWorks(it))) return `${B[id].name} متعطلة: أصلحها أول`;
  return "";
}

/** The chance (0 … 0.85) that the town's air defence stops one weapon. 0 when it has no milWorks battery. */
export function interceptChance(p, wid) {
  const w = WEAPONS[wid], ads = (w?.heavy ? p.forts || [] : p.airdefs).filter(milWorks).sort((a, b) => b.lvl - a.lvl || a.wd - b.wd);
  if (!ads.length || !w) return 0; // a destructive weapon: only «منظومة الحصن» tries
  const best = ads[0], st = milStat(w.heavy ? "fortdef" : "airdef", best.lvl);
  let c = (w.heavy ? st.vsHeavy : w.kind === "drone" ? st.vsDrone : st.vsMissile) * (1 - best.wd * 0.008);
  c += Math.min(0.12, (ads.length - 1) * 0.06);
  const radar = p.radars.filter(milWorks).sort((a, b) => b.lvl - a.lvl)[0];
  c *= radar ? milStat("radar", radar.lvl).detect * (1 - radar.wd * 0.006) : 0.55;
  if (milWorks(p.hq)) c += milStat("milhq", p.hq.lvl).guard;
  return warClamp(c * w.evade, 0, 0.85);
}
/** Does the town see an attack coming (a milWorks radar)? */
export const detects = (p) => p.radars.some(milWorks);

/** Flight time in ms between two world plots for this weapon. */
export function flightMs(fromPlot, toPlot, wid, cfg = WAR) {
  const [ax, ay] = worldXY(fromPlot), [bx, by] = worldXY(toPlot);
  const f = cfg.flight[WEAPONS[wid].kind], d = Math.hypot(ax - bx, ay - by);
  return Math.round(f.base + d * f.perCell);
}

/** The damage one weapon does when it lands (before the caps), from a roll in 0 … 1. */
export const hitDamage = (wid, roll) => Math.round(WEAPONS[wid].power * (0.85 + 0.3 * roll));

/** What repairing this much war damage costs and takes. */
export const repairCostOf = (id, wd, cfg = WAR) => Math.round((B[id]?.cost || 1000) * cfg.repairPrice * wd);
export const repairMsOf = (wd, cfg = WAR) => Math.round(wd * cfg.repairPerPoint);
/** Clearing the rubble a destructive weapon left (then the land is empty, to build on again). */
export const rubbleCostOf = (id, lvl = 0, cfg = WAR) => Math.max(cfg.rubble.min, Math.round((B[id]?.cost || 1000) * (1 + (lvl || 0)) * cfg.rubble.price));
export const rubbleMsOf = (cfg = WAR) => cfg.rubble.ms;

// ---------- the war's end (the owner, 28 Nov 2026): who was hurt more pays, and a ruined town drops a stage ----------

/** Not part of a town's worth for the war: roads and the pieces of a big decoration. */
const NO_WORTH = new Set(["road", "part"]);
/** What a building is worth (its price and the upgrades on it): a house by its levels, the rest by level. */
export function worthOf(id, lvl = 0) {
  const d = B[id];
  if (!d || NO_WORTH.has(d.cat) || id === "decopart") return 0;
  if (id === "house") { let v = d.cost || 0; for (let k = 1; k <= (lvl || 0); k++) v += d.levels?.[k]?.cost || 0; return v; }
  return Math.round((d.cost || 0) * (1 + 1.5 * (lvl || 0)));
}
/**
 * How much of a town is out of action now: buildings at flatAt or more (disabled) and rubble, by worth.
 * list: snapBuildings().list; dmg: Map "x:y" → { bid, wd, flat }. Returns { total, out, share 0 … 1 }.
 */
export function ruinOf(list, dmg = new Map(), cfg = WAR) {
  let total = 0, out = 0;
  for (const b of list) {
    if (b.build > 0) continue;
    const v = worthOf(b.id, b.lvl);
    if (!v) continue;
    total += v;
    const r = dmg.get(`${b.x}:${b.y}`);
    if (r && r.bid === b.id && (r.flat || (r.wd || 0) >= cfg.flatAt)) out += v;
  }
  return { total, out, share: total ? out / total : 0 };
}
/** The war's prize: this share of the losing town's budget (rounded down to a hundred, never below zero). */
export const warPrize = (money, cfg = WAR) => Math.max(0, Math.floor(Math.max(0, money || 0) * cfg.prize / 100) * 100);
/** The stage a ruined town drops to (one stage, never below the village). */
export const demotedEra = (era) => Math.max(0, (era || 0) - 1);

// ---------- relations between two towns ----------

export const REL_NAMES = { peace: "سلام", tension: "توتر", hostile: "عداوة معلنة", warning: "إنذار حرب", war: "حرب", truce: "هدنة" };
/**
 * The people a strike reaches in a building (its residents, or its workers) and what happens to them: of those
 * reached (people × damage), some are killed and more injured, fewer when the sirens warned them in time.
 * Returns { dead, hurt } as fractions (the server adds them up and rounds once).
 */
export function casualties(b, dmg, warned, cfg = WAR) {
  const people = b.id === "house" ? b.res || 0 : B[b.id]?.jobs || 0;
  const reached = people * Math.min(1, dmg / 100), k = warned ? cfg.casualty.warned : 1;
  return { dead: reached * cfg.casualty.dead * k, hurt: reached * cfg.casualty.hurt * k };
}
/** Spoils of war: an economic building hit (it makes money, power or water) pays the attacker this share of its repair. */
export const SPOILS = 0; // (no spoils per strike since 28 Nov 2026: the money is the war's prize at its end)
export const economic = (id) => !!B[id] && B[id].cat !== "mil" && id !== "house" && !MOSQUES.has(id) && ((B[id].income || 0) > 0 || (B[id].power || 0) > 0 || (B[id].water || 0) > 0);
/** Medals of al-Jouf: each goes to the town that leads its count (at least `min`). */
export const MEDALS = [
  { id: "hits", icon: "🎯", name: "القائد الذكي", text: "أكثر ضربات ناجحة", min: 3 },
  { id: "defHits", icon: "💥", name: "قاهر الدفاعات", text: "أكثر ضربات على رادارات ودفاعات العدو", min: 2 },
  { id: "intc", icon: "🛡️", name: "حامي الجوف", text: "أكثر اعتراضات ناجحة", min: 3 },
  { id: "wins", icon: "🏆", name: "بطل الجوف", text: "أكثر انتصارات بالحروب", min: 1 }
];
/** The price of the bought shield for a town at this stage. */
export const shieldPrice = (era, cfg = WAR) => cfg.shieldPrice[Math.max(0, Math.min(cfg.shieldPrice.length - 1, era || 0))];
/** The most tribute that may be asked of a town with this budget. */
export const tributeMax = (money, cfg = WAR) => Math.max(0, Math.floor(Math.max(0, money || 0) * cfg.tribute.share / 100) * 100);
/** Which medal a server row is (rows from before the id came carry the name). */
export const medalId = (x) => x?.id || MEDALS.find((m) => m.name === x?.name)?.id || "wins";
export const REL_ICONS = { peace: "🕊️", tension: "😠", hostile: "⚔️", warning: "⏳", war: "🔥", truce: "🏳️" };

/** The ready-made threats a mayor can send (no free text: nothing to moderate). */
export const THREATS = [
  "حدّك حدّك، ترى صبرنا له حدود!",
  "لا تختبر صبر الرافعية، ترى عندنا رجال.",
  "شفنا تحركاتك، وإحنا جاهزين لأي شي.",
  "نصيحة: ارجع عن اللي ناوي عليه قبل لا تندم.",
  "ترى دفاعاتنا صاحية ليل ونهار.",
  "لا يغرك هدوءنا، الجوف ما تنام."
];

/**
 * A pair's relation as it stands now (timers turn a warning into war, a war or a truce back into hostility).
 * rel: the stored row or null. Returns { state, since, warStart, warEnd, truceEnd, offer, cool, warCool }.
 */
export function relNow(rel, now, cfg = WAR) {
  if (!rel) return { state: "peace", since: 0, offer: null };
  const r = { ...rel };
  if (r.tribute && now >= r.tribute.until) { // no answer to the demand of tribute in time: war, declared at the deadline
    r.state = "warning"; r.since = r.tribute.until; r.warStart = r.tribute.until + cfg.T.warning; r.warEnd = r.warStart + cfg.T.war;
    r.lapsed = r.tribute; r.tribute = null; r.offer = null;
  }
  if (r.state === "warning" && now >= r.warStart) r.state = "war";
  if (r.state === "war" && now >= r.warEnd) { r.state = "hostile"; r.since = r.warEnd; r.warCool = r.warEnd + cfg.T.warCool; }
  if (r.state === "truce" && now >= r.truceEnd) { r.state = "hostile"; r.since = r.truceEnd; r.warCool = r.truceEnd + cfg.T.warCool; }
  if (r.offer && now - r.offer.at > cfg.T.offer) r.offer = null;
  return r;
}

/** What one side may do with the other now: { [action]: "" (allowed) or why not }. */
export function relActions(rel, me, now, ok, cfg = WAR) {
  const r = relNow(rel, now, cfg), out = {};
  const blockAll = ok || "";
  const coolLeft = (t) => (t && now < t ? `باقي ${minutesText(t - now)}` : "");
  out.threat = blockAll || (rel?.lastThreat?.[me] && now - rel.lastThreat[me] < cfg.T.threat ? "أرسلت تهديد قبل شوي" : "");
  out.hostile = blockAll || (["peace", "tension"].includes(r.state) ? (coolLeft(r.cool) ? `فيه صلح جديد: ${coolLeft(r.cool)}` : "") : "فيه عداوة أو حرب أصلاً");
  // war straight away (open war): never twice at once, never right after a war, a peace or a tribute paid
  const warWhy = ["warning", "war"].includes(r.state) ? "فيه حرب أصلاً" : r.state === "truce" ? "فيه هدنة بينكم"
    : coolLeft(r.tributePeace) ? `دفعوا الجزية: سلام ${coolLeft(r.tributePeace)}` : coolLeft(r.warCool) ? `توكم طالعين من حرب: ${coolLeft(r.warCool)}`
      : coolLeft(r.cool) ? `فيه صلح جديد: ${coolLeft(r.cool)}` : r.tribute ? "فيه طلب جزية ينتظر رد" : "";
  out.war = blockAll || warWhy;
  out.tribute = blockAll || warWhy;
  out.pay = r.tribute && r.tribute.by !== me ? "" : "ما فيه طلب جزية";
  out.refuse = out.pay;
  out.say = rel?.lastSay?.[me] && now - rel.lastSay[me] < cfg.T.say ? "شوي شوي" : ""; // talking is open to anyone (the words go through the filter)
  out.endchat = r.chat?.open ? "" : "ما فيه محادثة";
  out.truce = ["warning", "war"].includes(r.state) ? (r.offer?.by === me ? "عرضك ينتظر رد" : "") : "ما فيه حرب";
  out.peace = ["tension", "hostile", "warning", "war", "truce"].includes(r.state) ? (r.offer?.by === me ? "عرضك ينتظر رد" : "") : "أنتم بسلام";
  out.accept = r.offer && r.offer.by !== me ? "" : "ما فيه عرض";
  out.reject = out.accept;
  return out;
}

/** A launcher's wait in words (it can be a minute and a half). */
export function reloadText(m) {
  const ar = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
  return m === 1 ? "دقيقة" : m === 1.5 ? "دقيقة ونص" : m === 2 ? "دقيقتين" : Number.isInteger(m) ? `${ar(m)} دقايق` : `${ar(Math.floor(m))} دقايق ونص`;
}
export function minutesText(ms) {
  const m = Math.max(1, Math.ceil(ms / WAR_MIN));
  const ar = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
  if (m < 60) return m === 1 ? "دقيقة" : m === 2 ? "دقيقتين" : `${ar(m)} ${m <= 10 ? "دقايق" : "دقيقة"}`;
  const h = Math.round(m / 60);
  return h === 1 ? "ساعة" : h === 2 ? "ساعتين" : `${ar(h)} ${h <= 10 ? "ساعات" : "ساعة"}`;
}

/**
 * Wars are between towns of near size: two stages apart or more, neither may start on the other (the greater
 * city counts as a حاضرة). Why not, or "".
 */
export function eraGap(mine, theirs, cfg = WAR) {
  const top = (e) => Math.min(e || 0, GREATER_CITY_STAGE - 1), d = top(mine) - top(theirs);
  if (d >= cfg.bully) return "مدينتك أكبر منها بكثير: الحرب بين المدن المتقاربة بس";
  if (-d >= cfg.bully) return "مدينتك أصغر منها بكثير: الحرب بين المدن المتقاربة بس";
  return "";
}
/** Can these two towns be in a conflict at all (both past village, near in size, protections)? Why not, or "". */
export function conflictBlocker(a, b, now, cfg = WAR, rel = null) {
  // a, b: { era, created, updated, plot, name }
  if (!b) return "ما لقيت المدينة";
  if (a.plot === b.plot) return "هذي مدينتك";
  if ((a.era || 0) < cfg.minEra) return `مدينتك لازم تصير ${ERAS[cfg.minEra].name} أول`;
  if ((b.era || 0) < cfg.minEra) return `هذي ${ERAS[b.era || 0].name}: القرى محمية من الحروب`;
  if (now - (b.created || 0) < cfg.newPlayer) return "لاعب جديد: محمي فترة البداية";
  if (now - (a.created || 0) < cfg.newPlayer) return `أنت لاعب جديد: تقدر تدخل الحروب بعد ${minutesText(cfg.newPlayer - (now - a.created))}`;
  if (now - (b.updated || 0) > cfg.sleep) return "المدينة نايمة (صاحبها غايب من زمان): محمية";
  // a conflict already under way (from before a town grew) goes on to its end
  if (rel && ["hostile", "warning", "war"].includes(rel.state)) return "";
  const gap = eraGap(a.era, b.era, cfg);
  if (gap) return gap;
  return "";
}

/** What a military building is worth: its price and the upgrades paid on it (×1, ×2.5, ×5.5 by level). */
export const milValue = (id, lvl = 0) => Math.round((B[id]?.cost || 0) * [1, 2.5, 5.5][Math.min(lvl || 0, 2)]);
/**
 * Once, when the count by stage came (the owner's rule): the military buildings over the town's count go, and
 * their worth is paid back one and a half times. What goes: from the kind the town has most of, its lowest
 * level first, so the town keeps a mix and its best. list: snapBuildings().list → { remove, refund }.
 */
export function milTrimPlan(list, era) {
  const max = MIL_SLOTS[Math.min(era || 0, MIL_SLOTS.length - 1)], mine = list.filter((b) => B[b.id]?.slot).map((b) => ({ x: b.x, y: b.y, id: b.id, lvl: b.lvl || 0 }));
  const remove = [];
  while (mine.length > max) {
    const count = (id) => mine.filter((b) => b.id === id).length;
    mine.sort((a, b) => count(b.id) - count(a.id) || a.lvl - b.lvl || milValue(a.id, a.lvl) - milValue(b.id, b.lvl));
    remove.push(mine.shift());
  }
  return { remove, refund: Math.round(remove.reduce((n, b) => n + milValue(b.id, b.lvl), 0) * 1.5), max };
}
