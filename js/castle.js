// «قلعة مارد»: the castle in the middle of al-Jouf, fought over by foot soldiers only (no missiles or drones).
// Pure rules and numbers, shared by the server (js/warserver.js) and the game. The owner's plan: docs/CASTLE_PLAN.md.
import { MIL } from "./data.js";

/** The castle is built but kept off until the owner says (27 Nov 2026): no camp to build, no card, no castle on the map, no crown. */
export const CASTLE_ON = false;
/** The three kinds of soldiers: price, training time (seconds), strength attacking and defending (on the walls). */
export const TROOPS = {
  inf: { name: "مشاة", icon: "🪖", cost: 150, sec: 20, atk: 1, def: 1, text: "رخيصين وكثار: عمود أي جيش." },
  sf: { name: "قوات خاصة", icon: "🎖️", cost: 600, sec: 60, atk: 4, def: 1.5, text: "غاليين وأقوى شي بالهجوم: يقتحمون الأسوار." },
  sn: { name: "قناصة", icon: "🎯", cost: 400, sec: 45, atk: 1, def: 4, text: "أقوى شي بالدفاع من فوق الأسوار." }
};
export const TROOP_IDS = Object.keys(TROOPS);
export const CASTLE = {
  name: "قلعة مارد",
  x: 25, y: 14,             // on the world map: at Dumat al-Jandal, where Qasr Marid really stands
  march: 5 * 60000,        // the march takes five minutes, from anywhere (the owner, 27 Nov 2026)
  shield: 60 * 60000,      // after it changes hands, an hour before it can be attacked again
  guards: { inf: 40, sf: 0, sn: 12 }, // the game's own guards, while nobody holds it
  sendMax: 200,            // soldiers in one march at most
  luck: 0.1                // a battle's strength varies ±10%
};
const troopZero = () => ({ inf: 0, sf: 0, sn: 0 });
export const troopCount = (u) => TROOP_IDS.reduce((n, k) => n + Math.max(0, Math.round(u?.[k] || 0)), 0);
export const troopClean = (u) => Object.fromEntries(TROOP_IDS.map((k) => [k, Math.max(0, Math.floor(Number(u?.[k]) || 0))]));
export const attackPower = (u) => TROOP_IDS.reduce((n, k) => n + (u[k] || 0) * TROOPS[k].atk, 0);
export const defencePower = (u) => TROOP_IDS.reduce((n, k) => n + (u[k] || 0) * TROOPS[k].def, 0);
/** How many soldiers a town's camp holds (its barracks level), 0 without one. */
export function barracksCap(p) {
  const b = p?.barracks; if (!b || b.wd >= 85) return 0;
  return Math.round((MIL.barracks[b.lvl]?.cap || 0) * (b.wd >= 30 ? 0.5 : 1));
}
/** The barracks trains faster at higher levels (× the time). */
export const trainFactor = (p) => MIL.barracks[p?.barracks?.lvl || 0]?.speed || 1;
/** Soldiers finished training by now: moves them from the queue to the camp. Returns true if anything changed. */
export function finishTraining(a, now) {
  a.troops ||= troopZero(); a.training ||= [];
  const left = []; let changed = false;
  for (const t of a.training) { if (t.done <= now) { a.troops[t.kind] = (a.troops[t.kind] || 0) + t.n; changed = true; } else left.push(t); }
  a.training = left; return changed;
}
/**
 * The fight at the castle. The attackers' strength against the garrison's (the walls make snipers strong),
 * each ±10%. The loser loses most of its men; the winner loses more the closer it was. Returns the outcome.
 */
export function castleBattle(att, def, rand = Math.random) {
  const A = attackPower(att) * (1 - CASTLE.luck + 2 * CASTLE.luck * rand()), D = defencePower(def) * (1 - CASTLE.luck + 2 * CASTLE.luck * rand());
  const win = A > D, r = Math.min(A, D) / Math.max(A, D, 1e-9);
  const lose = (u, f) => Object.fromEntries(TROOP_IDS.map((k) => [k, Math.min(u[k] || 0, Math.round((u[k] || 0) * f))]));
  const winLoss = Math.min(0.95, 0.6 * Math.pow(r, 1.5)), loseLoss = Math.min(1, 0.75 + 0.25 * r);
  const attLost = lose(att, win ? winLoss : loseLoss), defLost = lose(def, win ? loseLoss : winLoss);
  const sub = (u, l) => Object.fromEntries(TROOP_IDS.map((k) => [k, (u[k] || 0) - (l[k] || 0)]));
  return { win, A: Math.round(A), D: Math.round(D), attLost, defLost, attLeft: sub(att, attLost), defLeft: sub(def, defLost) };
}
export const troopsText = (u, nf = (n) => n) => TROOP_IDS.filter((k) => u?.[k]).map((k) => `${nf(u[k])} ${TROOPS[k].name}`).join("، ") || "ولا جندي";
