// «صراع الجوف»: the rules of war in the world of al-Jouf. Pure functions and numbers only, so the
// same rules run on the server (src/worker.js through js/warserver.js, which decides every result)
// and in the game (to show prices, reasons and what an attack could do before asking the server).
// Nothing here is real-world: speeds, ranges and damage are game balance values.
import { B, MIL, ERAS, MAP_SIZE, worldXY } from "./data.js";

const WAR_MIN = 60000, WAR_HOUR = 60 * WAR_MIN;
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
    warning: 15 * WAR_MIN,       // after a declaration of war, no strike until this has passed
    war: 24 * WAR_HOUR,          // how long a war lasts, then it goes back to hostility
    truce: 6 * WAR_HOUR,         // a truce stops strikes this long
    peaceCool: 24 * WAR_HOUR,    // after peace, no new hostility between the two for this long
    warCool: 6 * WAR_HOUR,       // after a war ends, no new war between the two for this long
    offer: 6 * WAR_HOUR,         // an offer of truce or peace waits this long for an answer
    threat: 30 * WAR_MIN         // one threat per pair this often
  },
  flight: { missile: { base: 12000, perCell: 800 }, drone: { base: 25000, perCell: 2200 } },
  caps: {
    perOp: 60,               // most damage one operation can do to its building
    building: 100,           // a building's war damage never passes this (it is out of action, never removed)
    rehitWindow: 6 * WAR_HOUR, rehitMax: 2,   // the same building is hit at most twice in 6 hours
    cityWindow: 12 * WAR_HOUR, cityMax: 6,    // a town takes at most 6 landed hits in 12 hours,
    awayMax: 3,                           // or 3 while its owner is away,
    shield: 12 * WAR_HOUR,                    // and after that it is shielded this long
    inFlightTo: 3                          // operations flying at one town at once (from everyone)
  },
  interceptor: { price: 600, name: "صاروخ اعتراضي" },
  repairPerPoint: 45 * 1000,  // repair time: 45 s per point of damage (a building at 60% → 45 min)
  repairPrice: 0.012,         // repair: × the building's price, per point of damage
  autoBudget: 5000            // the deputy's default repair and refill budget, per day
};

/** The weapons. needs: the building and level that must stand (milWorks) to own and launch it. */
export const WEAPONS = {
  drone: { name: "مسيّرة شاهين", kind: "drone", price: 900, fee: 150, power: 16, evade: 1, needs: ["dronebase", 0], icon: "🛩️", text: "رخيصة وبطيئة، ضررها محدود، والدفاع يصيدها بسهولة." },
  drone2: { name: "مسيّرة صقر", kind: "drone", price: 2400, fee: 300, power: 26, evade: 0.8, needs: ["dronebase", 1], icon: "🦅", text: "أغلى وأذكى: تتهرب من الدفاع أكثر وضررها أكبر." },
  missile: { name: "صاروخ طويق", kind: "missile", price: 4500, fee: 500, power: 38, evade: 0.75, needs: ["missilepad", 0], icon: "🚀", text: "سريع وضرره متوسط. الدفاع المتوسط والمتقدم يقدرون عليه." },
  missile2: { name: "صاروخ النفود", kind: "missile", price: 11000, fee: 900, power: 56, evade: 0.55, needs: ["missilepad", 2], icon: "☄️", text: "الأقوى: ضرر كبير ويصعب اعتراضه. يحتاج مجمع صواريخ." }
};
export const WEAPON_IDS = Object.keys(WEAPONS);
export const MIL_IDS = Object.keys(MIL);

/** What may be hit, and what a hit does there. Homes, mosques, schools, clinics and parks never. */
export const TARGETS = {
  milhq: "تقل جاهزية العمليات: عمليات أقل بالجو",
  dronebase: "تقل سعة المسيّرات، وإذا تعطلت ما تطلق",
  missilepad: "تتعطل المنصة أو يطول تجهيزها",
  radar: "يقل الإنذار ودقة الدفاع الجوي",
  airdef: "تقل جاهزية الحماية من الهجمات",
  armory: "تقل سعة التخزين",
  generator: "ينقص إنتاج الكهرباء", powerplant: "ينقص إنتاج الكهرباء", solar: "ينقص إنتاج الكهرباء", windfarm: "ينقص إنتاج الكهرباء",
  tank: "ينقص الماء", desal: "ينقص الماء",
  workshop: "ينقص الإنتاج والدخل", factory: "ينقص الإنتاج والدخل", datefactory: "ينقص الإنتاج والدخل", dairy: "ينقص الإنتاج والدخل",
  mill: "ينقص الإنتاج والدخل", oilpress: "ينقص الإنتاج والدخل", blockfactory: "تنقص مواد البناء", quarry: "تنقص مواد البناء",
  mall: "ينقص دخل المجمع"
};
export const canTarget = (id) => !!TARGETS[id];

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
    const [, id, lvl, , build] = String(str).split(":");
    if (id && B[id]) list.push({ x: i % n, y: Math.floor(i / n), id, lvl: Number(lvl) || 0, build: Number(build) || 0 });
  });
  return { list, era: o.era || 0, money: Number(o.money) || 0, seq: Number(o.war?.seq) || 0, name: o.name };
}

/**
 * A town's military strength from its buildings and the war damage the server holds for it
 * (dmg: Map "x:y" → damage 0…100). Buildings still under construction do not count.
 */
export function milProfile(snapOrList, dmg = new Map()) {
  const town = Array.isArray(snapOrList) ? { list: snapOrList, era: 0 } : snapBuildings(snapOrList);
  const p = { era: town.era, hq: null, bases: [], pads: [], radars: [], airdefs: [], armory: null };
  for (const b of town.list) {
    if (!MIL[b.id] || b.build > 0) continue;
    const it = { x: b.x, y: b.y, lvl: b.lvl, wd: dmg.get(`${b.x}:${b.y}`) || 0 };
    if (b.id === "milhq") p.hq = it;
    else if (b.id === "dronebase") p.bases.push(it);
    else if (b.id === "missilepad") p.pads.push(it);
    else if (b.id === "radar") p.radars.push(it);
    else if (b.id === "airdef") p.airdefs.push(it);
    else if (b.id === "armory") p.armory = it;
  }
  return p;
}
const milWorks = (it) => it && it.wd < 85;

/** How much the town can store of each thing: { drones, missiles, intc }. */
export function capacity(p) {
  const store = milWorks(p.armory) ? milStat("armory").store * warFactor(p.armory.wd) + (1 - warFactor(p.armory.wd)) : 1;
  const sum = (list, k, id) => list.filter(milWorks).reduce((n, it) => n + Math.round(milStat(id, it.lvl)[k] * (it.wd >= 30 ? 0.5 : 1)), 0);
  return {
    drones: Math.floor(sum(p.bases, "cap", "dronebase") * store),
    missiles: Math.floor(sum(p.pads, "cap", "missilepad") * store),
    intc: Math.floor(sum(p.airdefs, "intc", "airdef") * store)
  };
}

/** Can the town own and launch this weapon (the right building, milWorks, at the right level)? Returns why not, or "". */
export function weaponBlocker(p, wid) {
  const w = WEAPONS[wid];
  if (!w) return "سلاح غير معروف";
  const [id, lvl] = w.needs, list = id === "dronebase" ? p.bases : p.pads;
  if (!list.length) return `يحتاج ${B[id].name}`;
  if (!list.some((it) => it.lvl >= lvl)) return `يحتاج «${milStat(id, lvl).name}»`;
  if (!list.some((it) => it.lvl >= lvl && milWorks(it))) return `${B[id].name} متعطلة: أصلحها أول`;
  return "";
}

/** The chance (0 … 0.85) that the town's air defence stops one weapon. 0 when it has no milWorks battery. */
export function interceptChance(p, wid) {
  const w = WEAPONS[wid], ads = p.airdefs.filter(milWorks).sort((a, b) => b.lvl - a.lvl || a.wd - b.wd);
  if (!ads.length || !w) return 0;
  const best = ads[0], st = milStat("airdef", best.lvl);
  let c = (w.kind === "drone" ? st.vsDrone : st.vsMissile) * (1 - best.wd * 0.008);
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

// ---------- relations between two towns ----------

export const REL_NAMES = { peace: "سلام", tension: "توتر", hostile: "عداوة معلنة", warning: "إنذار حرب", war: "حرب", truce: "هدنة" };
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
  if (r.state === "warning" && now >= r.warStart) r.state = "war";
  if (r.state === "war" && now >= r.warEnd) { r.state = "hostile"; r.since = r.warEnd; r.warCool = r.warEnd + cfg.T.warCool; }
  if (r.state === "truce" && now >= r.truceEnd) { r.state = "hostile"; r.since = r.truceEnd; }
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
  out.war = blockAll || (r.state !== "hostile" ? (["warning", "war"].includes(r.state) ? "فيه حرب أصلاً" : "لازم تعلن العداوة أول")
    : now - r.since < cfg.T.hostileToWar ? `العداوة لازم تمضي ${minutesText(cfg.T.hostileToWar)}: باقي ${minutesText(cfg.T.hostileToWar - (now - r.since))}`
      : coolLeft(r.warCool) ? `توكم طالعين من حرب: ${coolLeft(r.warCool)}` : "");
  out.truce = ["warning", "war"].includes(r.state) ? (r.offer?.by === me ? "عرضك ينتظر رد" : "") : "ما فيه حرب";
  out.peace = ["tension", "hostile", "warning", "war", "truce"].includes(r.state) ? (r.offer?.by === me ? "عرضك ينتظر رد" : "") : "أنتم بسلام";
  out.accept = r.offer && r.offer.by !== me ? "" : "ما فيه عرض";
  out.reject = out.accept;
  return out;
}

export function minutesText(ms) {
  const m = Math.max(1, Math.ceil(ms / WAR_MIN));
  const ar = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
  if (m < 60) return m === 1 ? "دقيقة" : m === 2 ? "دقيقتين" : `${ar(m)} ${m <= 10 ? "دقايق" : "دقيقة"}`;
  const h = Math.round(m / 60);
  return h === 1 ? "ساعة" : h === 2 ? "ساعتين" : `${ar(h)} ${h <= 10 ? "ساعات" : "ساعة"}`;
}

/** Can these two towns be in a conflict at all (both past village, not a bully, protections)? Why not, or "". */
export function conflictBlocker(a, b, now, cfg = WAR) {
  // a, b: { era, created, updated, plot, name }
  if (!b) return "ما لقيت المدينة";
  if (a.plot === b.plot) return "هذي مدينتك";
  if ((a.era || 0) < cfg.minEra) return `مدينتك لازم تصير ${ERAS[cfg.minEra].name} أول`;
  if ((b.era || 0) < cfg.minEra) return `هذي ${ERAS[b.era || 0].name}: القرى محمية من الحروب`;
  if (now - (b.created || 0) < cfg.newPlayer) return "لاعب جديد: محمي فترة البداية";
  if (now - (a.created || 0) < cfg.newPlayer) return `أنت لاعب جديد: تقدر تدخل الحروب بعد ${minutesText(cfg.newPlayer - (now - a.created))}`;
  if (now - (b.updated || 0) > cfg.sleep) return "المدينة نايمة (صاحبها غايب من زمان): محمية";
  if ((a.era || 0) - (b.era || 0) >= cfg.bully) return "مدينتك أكبر منها بكثير: ما يصير تتعدى على الصغار";
  return "";
}
