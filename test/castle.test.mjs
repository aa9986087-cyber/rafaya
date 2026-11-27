// «قلعة مارد»: foot soldiers train in the camp, march five minutes and fight the garrison; the winner holds it.
import test from "node:test";
import assert from "node:assert/strict";
import { newGame, pack, idx } from "../js/sim.js";
import { WarServer, memWarDb } from "../js/warserver.js";
import { WAR } from "../js/war.js";
import { TROOPS, CASTLE, castleBattle } from "../js/castle.js";

const MIN = 60000, HOUR = 60 * MIN;
function makeWorld() {
  let now = Date.UTC(2026, 11, 1);
  const towns = new Map(), players = new Map();
  const world = { town: (p) => towns.get(p) || null, player: (n) => players.get(n) || null, news: () => {} };
  const war = new WarServer(memWarDb(), world, { now: () => now, rand: () => 0.5, cfg: { ...WAR, castleOn: true } }); // the castle is off on the live site for now
  const addTown = (plot, name, { era = 2, money = 500000, barracks = 2 } = {}) => {
    const s = newGame(plot + 1, { site: "world", name }); s.era = era; s.money = money; s.war = { seq: 0 };
    s.tiles[idx(20, 20)].b = { id: "milhq", lvl: 0, res: 0, cond: 100 };
    if (barracks != null) s.tiles[idx(22, 20)].b = { id: "barracks", lvl: barracks, res: 0, cond: 100 };
    players.set(name, { name, plot, created: now - 3 * 24 * HOUR });
    towns.set(plot, { plot, owner: name, town: name, era, pop: 2000, updated: now, snapshot: pack(s), s });
    return { name, plot, created: now - 3 * 24 * HOUR };
  };
  return { war, addTown, towns, tick: (ms) => { now += ms; }, now: () => now };
}
const trainAll = (W, me, kind, n, req) => { const r = W.war.handle("train", { req, kind, n }, me); assert.equal(r.ok, true, r.error); W.tick(TROOPS[kind].sec * 1000 * n + 1000); };

test("the camp trains soldiers for money and time, within its room", () => {
  const W = makeWorld();
  const none = W.addTown(1, "بلا معسكر", { barracks: null });
  assert.match(W.war.handle("train", { req: "a", kind: "inf", n: 5 }, none).error, /معسكر/);
  const me = W.addTown(2, "الرافعية", { barracks: 0 });
  const r = W.war.handle("train", { req: "b", kind: "inf", n: 10 }, me);
  assert.equal(r.charge.amount, TROOPS.inf.cost * 10);
  assert.equal(W.war.handle("castle", {}, me).castle.mine.troops.inf, 0, "still training");
  W.tick(TROOPS.inf.sec * 1000 * 10 + 1);
  assert.equal(W.war.handle("castle", {}, me).castle.mine.troops.inf, 10);
  assert.match(W.war.handle("train", { req: "c", kind: "inf", n: 25 }, me).error, /يكفي ٢٠/, "a first camp holds 30");
});

test("an army marches five minutes, beats the guards, holds the castle; a stronger one takes it", () => {
  const W = makeWorld();
  const a = W.addTown(10, "الأولى"), b = W.addTown(11, "الثانية");
  trainAll(W, b, "sf", 50, "b1"); trainAll(W, b, "inf", 50, "b2");
  trainAll(W, a, "sf", 30, "a1");
  assert.equal(W.war.handle("march", { req: "m1", units: { sf: 30 } }, a).ok, true);
  assert.equal(W.war.handle("castle", {}, b).castle.marches.length, 1, "everyone sees the army on the way");
  W.tick(CASTLE.march - 1000); W.war.settle();
  assert.equal(W.war.handle("castle", {}, b).castle.holder, null, "not yet there");
  W.tick(2000); W.war.settle();
  let c = W.war.handle("castle", {}, b).castle;
  assert.equal(c.holder, 10);
  assert.ok(c.garrison > 0 && c.garrison < 30, "some fell taking it");
  // protected for an hour after it changes hands
  assert.match(W.war.handle("march", { req: "m2", units: { sf: 50, inf: 50 } }, b).error, /محمية/);
  W.tick(HOUR);
  assert.equal(W.war.handle("march", { req: "m3", units: { sf: 50, inf: 50 } }, b).ok, true);
  W.tick(CASTLE.march + 1000); W.war.settle();
  c = W.war.handle("castle", {}, a).castle;
  assert.equal(c.holder, 11);
  assert.equal(c.records.held[0].plot, 10, "the first holder's time is in the record");
  assert.ok(c.battles.length === 2 && c.battles[0].win);
});

test("the holder sends guards; a weak army is beaten back and its survivors go home", () => {
  const W = makeWorld();
  const a = W.addTown(20, "الحاكم"), b = W.addTown(21, "المهاجم");
  trainAll(W, a, "sf", 40, "a1");
  W.war.handle("march", { req: "m1", units: { sf: 40 } }, a); W.tick(CASTLE.march + 1000); W.war.settle();
  trainAll(W, a, "sn", 30, "a2");
  W.war.handle("march", { req: "m2", units: { sn: 30 } }, a); W.tick(CASTLE.march + 1000); W.war.settle();
  const before = W.war.handle("castle", {}, a).castle.garrison;
  W.tick(HOUR);
  trainAll(W, b, "inf", 20, "b1");
  W.war.handle("march", { req: "m3", units: { inf: 20 } }, b); W.tick(CASTLE.march + 1000); W.war.settle();
  const c = W.war.handle("castle", {}, b).castle;
  assert.equal(c.holder, 20);
  assert.ok(c.garrison <= before);
  assert.ok(c.mine.troops.inf < 20, "the survivors came home, fewer than went");
  assert.equal(c.records.defs[0].plot, 20);
});

test("the battle: more strength wins; the winner loses more when it was close", () => {
  const big = castleBattle({ inf: 0, sf: 50, sn: 0 }, { inf: 10, sf: 0, sn: 0 }, () => 0.5);
  const close = castleBattle({ inf: 0, sf: 12, sn: 0 }, { inf: 0, sf: 0, sn: 11 }, () => 0.5);
  assert.ok(big.win && close.win);
  assert.ok(big.attLost.sf < close.attLost.sf * 4);
  assert.equal(castleBattle({ inf: 10, sf: 0, sn: 0 }, { inf: 0, sf: 0, sn: 10 }, () => 0.5).win, false, "snipers on the walls hold");
});

test("while the castle is switched off, its actions answer «قريبًا»", () => {
  const war = new WarServer(memWarDb(), { town: () => null, player: () => null }, { now: () => 1000 });
  for (const a of ["castle", "train", "march"]) assert.match(war.handle(a, { req: "x" }, { name: "x", plot: 1 }).error, /قريبًا/);
});
