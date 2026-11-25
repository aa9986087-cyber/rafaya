// «صراع الجوف»: the server decides everything. These tests drive js/warserver.js with two towns.
import test from "node:test";
import assert from "node:assert/strict";
import { newGame, pack, unpack, idx, analyze, cantBuild, build, condFactor } from "../js/sim.js";
import { WAR, WEAPONS, interceptChance, milProfile, warFactor, relNow } from "../js/war.js";
import { WarServer, memWarDb, sqlWarDb } from "../js/warserver.js";

const HOUR = 3600000, MIN = 60000;

/** A world of towns with fake clock and dice. */
function makeWorld({ db = memWarDb(), rolls } = {}) {
  let now = Date.UTC(2026, 11, 1);
  const towns = new Map(), players = new Map();
  const dice = rolls ? [...rolls] : null;
  const rand = () => (dice && dice.length ? dice.shift() : 0.5);
  const world = { town: (p) => towns.get(p) || null, player: (n) => players.get(n) || null };
  const war = new WarServer(db, world, { now: () => now, rand });
  const addTown = (plot, name, { era = 2, money = 200000, mil = [], seq = 0 } = {}) => {
    const s = newGame(plot + 1, { site: "world", name });
    s.era = era; s.money = money; s.war = { seq };
    for (const [x, y, id, lvl = 0] of mil) s.tiles[idx(x, y)].b = { id, lvl, res: 0, cond: 100 };
    players.set(name, { name, plot, created: now - 3 * 24 * HOUR });
    towns.set(plot, { plot, owner: name, town: name, era, pop: 2000, updated: now, snapshot: pack(s), s });
    return { name, plot, created: now - 3 * 24 * HOUR };
  };
  const resync = (plot, f) => { const t = towns.get(plot); f?.(t.s); t.snapshot = pack(t.s); t.updated = now; };
  return { war, db, world, towns, addTown, resync, tick: (ms) => { now += ms; }, now: () => now, dice };
}
const BASE = [[20, 20, "milhq"], [22, 20, "dronebase"], [24, 20, "missilepad"], [26, 20, "radar"], [28, 20, "airdef"]];
const atWar = (W, a, b) => {
  assert.equal(W.war.handle("rel", { req: "h1", other: b.plot, act: "hostile" }, a).ok, true);
  W.tick(WAR.T.hostileToWar + MIN);
  assert.equal(W.war.handle("rel", { req: "w1", other: b.plot, act: "war" }, a).ok, true);
  W.tick(WAR.T.warning + MIN);
};

test("military buildings: world only, need the command centre, wear war damage separately", () => {
  const solo = newGame(1); solo.era = 2; solo.money = 1e6;
  assert.match(cantBuild(solo, 20, 20, "milhq"), /عالم الجوف/);
  const s = newGame(2, { site: "world" }); s.world = { plot: 1 }; s.era = 2; s.money = 1e6;
  assert.match(cantBuild(s, 22, 22, "radar"), /مركز القيادة/);
  assert.equal(build(s, 20, 20, "milhq"), "");
  assert.equal(cantBuild(s, 22, 22, "radar"), "");
  // war damage is its own field, kept in the save, and slows the building down
  const t = s.tiles[idx(20, 20)];
  t.b.wd = 50;
  const back = unpack(pack(s));
  assert.equal(back.tiles[idx(20, 20)].b.wd, 50);
  assert.equal(back.tiles[idx(20, 20)].b.cond, 100);
  assert.ok(condFactor(back.tiles[idx(20, 20)].b) < 0.7);
  assert.equal(warFactor(90), 0);
  // levels of military buildings survive a save
  s.tiles[idx(24, 24)].b = { id: "missilepad", lvl: 2, res: 0, cond: 100 };
  assert.equal(unpack(pack(s)).tiles[idx(24, 24)].b.lvl, 2);
  // old saves (no 8th field) load with no war damage
  const old = unpack(pack(newGame(3)));
  assert.ok(old.tiles.every((x) => !x.b?.wd));
  assert.ok(analyze(back).costs.military > 0);
});

test("buying: needs the right building, room and money; a request sent twice buys once", () => {
  const W = makeWorld();
  const a = W.addTown(10, "الرافعية", { money: 5000, mil: [[22, 20, "dronebase"]] });
  assert.match(W.war.handle("buy", { req: "r0", kind: "drone", n: 1 }, a).error, /مركز القيادة/);
  W.resync(10, (s) => { s.tiles[idx(20, 20)].b = { id: "milhq", lvl: 0, res: 0, cond: 100 }; });
  assert.match(W.war.handle("buy", { req: "r1", kind: "missile", n: 1 }, a).error, /منصة/);
  const r = W.war.handle("buy", { req: "r2", kind: "drone", n: 2 }, a);
  assert.equal(r.ok, true);
  assert.equal(r.charge.amount, WEAPONS.drone.price * 2);
  const again = W.war.handle("buy", { req: "r2", kind: "drone", n: 2 }, a);
  assert.deepEqual(again, r);
  assert.equal(W.war.handle("state", {}, a).arsenal.drone, 2);
  // open war: the store has no limit for drones and missiles (the launchers set how many go at once)
  const caps = W.war.handle("state", {}, a).caps;
  assert.equal(caps.open, true); assert.ok(caps.drones >= 9999); assert.equal(caps.missiles, 0);
  // money already charged but not yet taken off the synced budget counts
  W.resync(10, (s) => { s.money = 3000; s.tiles[idx(23, 20)].b = { id: "dronebase", lvl: 0, res: 0, cond: 100 }; }); // 3000 ≥ 1800, but 1800 is still owed
  assert.match(W.war.handle("buy", { req: "r4", kind: "drone", n: 2 }, a).error, /المال/);
  // the state gives the charges the game has not applied yet
  const st = W.war.handle("state", { seq: 0 }, a);
  assert.equal(st.charges.length, 1);
  assert.equal(W.war.handle("state", { seq: 1 }, a).charges.length, 0);
});

test("relations: hostility first, a wait, a warning, then war; truce and peace by offer and answer", () => {
  const W = makeWorld();
  const a = W.addTown(10, "الرافعية", { mil: BASE }), b = W.addTown(30, "صفان", { mil: BASE });
  assert.match(W.war.handle("rel", { req: "x", other: 30, act: "war" }, a).error, /العداوة أول/);
  assert.equal(W.war.handle("rel", { req: "t", other: 30, act: "threat", text: 1 }, a).ok, true);
  assert.equal(W.war.handle("rel", { req: "h", other: 30, act: "hostile" }, a).ok, true);
  assert.match(W.war.handle("rel", { req: "w0", other: 30, act: "war" }, a).error, /باقي/);
  W.tick(WAR.T.hostileToWar + MIN);
  assert.equal(W.war.handle("rel", { req: "w", other: 30, act: "war" }, a).ok, true);
  assert.equal(W.war.handle("state", {}, b).rels[0].state, "warning");
  assert.ok(W.war.handle("state", {}, b).notes.some((n) => n.kind === "war"));
  W.tick(WAR.T.warning + MIN);
  assert.equal(W.war.handle("state", {}, b).rels[0].state, "war");
  // b offers a truce, a accepts
  assert.equal(W.war.handle("rel", { req: "o", other: 10, act: "truce" }, b).ok, true);
  assert.match(W.war.handle("rel", { req: "o2", other: 10, act: "accept" }, b).error, /ما فيه عرض/);
  assert.equal(W.war.handle("rel", { req: "acc", other: 30, act: "accept" }, a).ok, true);
  assert.equal(W.war.handle("state", {}, a).rels[0].state, "truce");
  W.tick(WAR.T.truce + MIN);
  assert.equal(W.war.handle("state", {}, a).rels[0].state, "hostile");
  assert.equal(W.war.handle("rel", { req: "p", other: 30, act: "peace" }, a).ok, true);
  assert.equal(W.war.handle("rel", { req: "pa", other: 10, act: "accept" }, b).ok, true);
  assert.equal(W.war.handle("state", {}, a).rels[0].state, "peace");
  assert.match(W.war.handle("rel", { req: "h2", other: 30, act: "hostile" }, a).error, /صلح/);
});

test("protections: villages, new players, sleeping towns and bullies are out of reach", () => {
  const W = makeWorld();
  const a = W.addTown(10, "الرافعية", { era: 3 }), v = W.addTown(11, "قرية", { era: 0 }), small = W.addTown(12, "بلدة", { era: 1 });
  assert.match(W.war.handle("rel", { req: "1", other: 11, act: "hostile" }, a).error, /القرى/);
  assert.match(W.war.handle("rel", { req: "2", other: 12, act: "hostile" }, a).error, /الصغار/);
  const fresh = W.addTown(13, "جديد", { era: 2 });
  W.world.player("جديد").created = W.now();
  assert.match(W.war.handle("rel", { req: "3", other: 13, act: "hostile" }, a).error, /جديد/);
  const sleepy = W.addTown(14, "نايمة", { era: 2 });
  W.towns.get(14).updated = W.now() - 8 * 24 * HOUR;
  assert.match(W.war.handle("rel", { req: "4", other: 14, act: "hostile" }, a).error, /نايمة/);
  void small; void fresh; void v; void sleepy;
});

test("a strike: checked, paid once, decided once at arrival, with the caps", () => {
  const W = makeWorld({ rolls: [] });
  const a = W.addTown(10, "الرافعية", { mil: BASE }), b = W.addTown(30, "صفان", { mil: [[20, 20, "milhq"], [30, 30, "generator"], [31, 30, "house", 2], [33, 30, "mosque"]] });
  W.war.handle("buy", { req: "b1", kind: "missile", n: 1 }, a);
  W.war.handle("buy", { req: "b2", kind: "drone", n: 2 }, a);
  assert.match(W.war.handle("launch", { op: "o0", to: 30, x: 30, y: 30, load: { missile: 1 } }, a).error, /ما فيه حرب/);
  atWar(W, a, b);
  assert.match(W.war.handle("launch", { op: "o1", to: 30, x: 33, y: 30, load: { missile: 1 } }, a).error, /المساجد/);
  assert.match(W.war.handle("launch", { op: "o1", to: 30, x: 5, y: 5, load: { missile: 1 } }, a).error, /بعيد/);
  assert.match(W.war.handle("launch", { op: "o1", to: 30, x: 30, y: 30, load: { missile: 3 } }, a).error, /ما عندك/);
  const r = W.war.handle("launch", { op: "o1", to: 30, x: 30, y: 30, load: { missile: 1 } }, a);
  assert.equal(r.ok, true);
  const again = W.war.handle("launch", { op: "o1", to: 30, x: 30, y: 30, load: { missile: 1 } }, a);
  assert.deepEqual(again, r); // the same operation sent twice (a lost connection) is one operation
  assert.equal(W.war.handle("state", {}, a).arsenal.missile, 0);
  assert.match(W.war.handle("launch", { op: "o2", to: 30, x: 30, y: 30, load: { drone: 1 } }, a).error, /عملية بالجو/); // a small command runs one at a time
  // not decided before it arrives
  assert.equal(W.war.handle("op", { op: "o1" }, a).op.result, null);
  W.tick(r.op.arriveAt - W.now() + 1);
  const done = W.war.handle("op", { op: "o1" }, b).op;
  assert.equal(done.status, "done");
  assert.ok(done.result.dmg > 0 && done.result.dmg <= WAR.caps.perOp);
  const dmg1 = W.war.publicDamage(30)[0].wd;
  W.war.settle(); W.war.handle("state", {}, b);
  assert.equal(W.war.publicDamage(30)[0].wd, dmg1); // decided once
  assert.ok(W.war.handle("state", {}, b).notes.some((n) => n.kind === "hit"));
  // the defender's old sync does not undo the damage (it is kept on the server)
  W.resync(30);
  assert.equal(W.war.publicDamage(30)[0].wd, dmg1);
});

test("air defence: radar, battery and interceptors decide the chance; each attempt uses an interceptor", () => {
  const W = makeWorld({ rolls: [0.01, 0.5] }); // first roll: intercepted
  const a = W.addTown(10, "الرافعية", { mil: BASE }), b = W.addTown(30, "صفان", { mil: [[20, 20, "milhq"], [26, 20, "radar"], [28, 20, "airdef"], [30, 30, "factory"]] });
  const p = milProfile(W.towns.get(30).snapshot);
  assert.ok(interceptChance(p, "drone") > interceptChance(p, "missile"));
  assert.ok(interceptChance(milProfile([]), "drone") === 0);
  W.war.handle("buy", { req: "i", kind: "intc", n: 2 }, b);
  W.war.handle("buy", { req: "d", kind: "drone", n: 1 }, a);
  atWar(W, a, b);
  const r = W.war.handle("launch", { op: "z1", to: 30, x: 30, y: 30, load: { drone: 1 } }, a);
  assert.ok(W.war.handle("state", {}, b).notes.some((n) => n.kind === "incoming")); // the radar saw it
  W.tick(r.op.arriveAt - W.now() + 1);
  const res = W.war.handle("op", { op: "z1" }, a).op.result;
  assert.equal(res.hits[0].intercepted, true);
  assert.equal(res.dmg, 0);
  assert.equal(res.intcUsed, 1);
  assert.equal(W.war.handle("state", {}, b).arsenal.intc >= 1, true);
  assert.equal(W.war.publicDamage(30).length, 0);
});

test("caps: one building twice in 6 hours, a town six hits then a shield", () => {
  const W = makeWorld();
  const a = W.addTown(10, "الرافعية", { mil: [[20, 20, "milhq", 2], [24, 20, "missilepad", 2], [25, 20, "missilepad", 2]] });
  const b = W.addTown(30, "صفان", { mil: [[20, 20, "milhq"], ...Array.from({ length: 8 }, (_, k) => [30 + k, 30, "factory"])] });
  W.war.handle("buy", { req: "m", kind: "missile", n: 6 }, a);
  atWar(W, a, b);
  const fire = (k, x) => { const r = W.war.handle("launch", { op: `f${k}`, to: 30, x, y: 30, load: { missile: 1 } }, a); if (r.ok) { W.tick(r.op.arriveAt - W.now() + 1); W.war.settle(); W.tick(5 * MIN); } return r; };
  W.war.handle("buy", { req: "m2", kind: "missile", n: 0 }, a);
  assert.equal(fire(1, 30).ok, true);
  W.war.handle("buy", { req: "m3", kind: "missile", n: 1 }, a);
  assert.equal(fire(2, 30).ok, true);
  W.war.handle("buy", { req: "m4", kind: "missile", n: 1 }, a);
  assert.match(fire(3, 30).error, /محمي/);
  for (let k = 0; k < 4; k++) { W.war.handle("buy", { req: `n${k}`, kind: "missile", n: 1 }, a); assert.equal(fire(10 + k, 31 + k).ok, true); }
  W.war.handle("buy", { req: "last", kind: "missile", n: 1 }, a);
  assert.match(fire(20, 36).error, /درع/);
});

test("repairs: paid on the server, damage comes off over time; the deputy repairs within its budget", () => {
  const W = makeWorld();
  const a = W.addTown(10, "الرافعية", { mil: BASE }), b = W.addTown(30, "صفان", { mil: [[20, 20, "milhq"], [30, 30, "generator"]] });
  W.war.handle("settings", { repair: false, refill: false, budget: 0 }, b);
  W.war.handle("buy", { req: "m", kind: "missile", n: 1 }, a);
  atWar(W, a, b);
  const r = W.war.handle("launch", { op: "q", to: 30, x: 30, y: 30, load: { missile: 1 } }, a);
  W.tick(r.op.arriveAt - W.now() + 1);
  const wd = W.war.handle("state", {}, b).damage[0].wd;
  assert.ok(wd > 0);
  const rp = W.war.handle("repair", { req: "rp", x: 30, y: 30 }, b);
  assert.equal(rp.ok, true);
  assert.match(W.war.handle("repair", { req: "rp2", x: 30, y: 30 }, b).error, /يتصلح/);
  W.tick(rp.ms / 2);
  const half = W.war.handle("state", {}, b).damage[0].wd;
  assert.ok(half < wd && half > 0);
  W.tick(rp.ms);
  assert.equal(W.war.handle("state", {}, b).damage.length, 0);
  // the deputy, with a budget, starts the repair by itself after a hit
  W.war.handle("settings", { repair: true, refill: false, budget: 50000 }, b);
  W.tick(2 * HOUR);
  W.war.handle("buy", { req: "m9", kind: "missile", n: 1 }, a);
  const r2 = W.war.handle("launch", { op: "q2", to: 30, x: 30, y: 30, load: { missile: 1 } }, a);
  W.tick(r2.op.arriveAt - W.now() + 1);
  const st = W.war.handle("state", {}, b);
  assert.ok(st.damage[0].rep);
  assert.ok(st.notes.some((n) => n.kind === "repair"));
});

test("a truce stops strikes in the air; a spot left empty takes no damage", () => {
  const W = makeWorld();
  const a = W.addTown(10, "الرافعية", { mil: BASE }), b = W.addTown(30, "صفان", { mil: [[20, 20, "milhq"], [30, 30, "generator"]] });
  W.war.handle("buy", { req: "d", kind: "drone", n: 2 }, a);
  atWar(W, a, b);
  const r = W.war.handle("launch", { op: "g", to: 30, x: 30, y: 30, load: { drone: 1 } }, a);
  W.resync(30, (s) => { s.tiles[idx(30, 30)].b = null; }); // demolished before it arrived
  W.tick(r.op.arriveAt - W.now() + 1);
  assert.equal(W.war.handle("op", { op: "g" }, a).op.result.dmg, 0);
  assert.equal(relNow(null, 0).state, "peace");
});

test("the same rules on SQLite storage (as in the Durable Object)", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const dbs = new DatabaseSync(":memory:");
  const sql = { exec: (q, ...args) => { const st = dbs.prepare(q); if (/^\s*SELECT/i.test(q)) { const rows = st.all(...args); return { toArray: () => rows }; } st.run(...args); return { toArray: () => [] }; } };
  const W = makeWorld({ db: sqlWarDb(sql) });
  const a = W.addTown(10, "الرافعية", { mil: BASE }), b = W.addTown(30, "صفان", { mil: [[20, 20, "milhq"], [30, 30, "generator"]] });
  assert.equal(W.war.handle("buy", { req: "m", kind: "missile", n: 1 }, a).ok, true);
  atWar(W, a, b);
  const r = W.war.handle("launch", { op: "s1", to: 30, x: 30, y: 30, load: { missile: 1 } }, a);
  assert.equal(r.ok, true);
  W.tick(r.op.arriveAt - W.now() + 1);
  assert.ok(W.war.handle("op", { op: "s1" }, b).op.result.dmg > 0);
  assert.equal(W.war.publicDamage(30).length, 1);
});

test("the world: every town gets the same rain, dust, Ramadan and Eid at the same hour", async () => {
  const { worldEventsAt, step, SHARED_EVENTS } = await import("../js/sim.js");
  const a = newGame(101, { site: "world" }), b = newGame(202, { site: "world" });
  for (const s of [a, b]) { s.world = { plot: 1 }; s.day = 5000; }
  const seen = new Set();
  for (let h = 0; h < 600; h++) {
    step(a, Math.random); step(b, Math.random);
    const ea = a.events.filter((e) => SHARED_EVENTS.includes(e.id)).map((e) => e.id).sort().join(), eb = b.events.filter((e) => SHARED_EVENTS.includes(e.id)).map((e) => e.id).sort().join();
    assert.equal(ea, eb, `hour ${a.day}`);
    const want = worldEventsAt(a.day).map((e) => e.id).sort().join();
    assert.equal(ea, want);
    for (const e of a.events) seen.add(e.id);
  }
  assert.ok(seen.has("ramadan") && seen.has("eid") && seen.has("adha"), [...seen].join());
  assert.ok(["rain", "dust", "heat", "cold", "locust", "drought", "dates"].some((k) => seen.has(k)));
  // no rain in summer, ever
  for (let h = 0; h < 20000; h += 7) for (const e of worldEventsAt(h)) if (e.id === "rain") assert.notEqual(seasonOfTest(e.start), "summer");
});
function seasonOfTest(h) { const day = Math.floor(Math.max(0, h - 1) / 24); return ["spring", "summer", "autumn", "winter"][Math.floor(day / SEASON_DAYS_T) % 4]; }
const { SEASON_DAYS: SEASON_DAYS_T } = await import("../js/data.js");

test("a town that moves to other land takes its war with it", () => {
  const db = memWarDb(), war = new WarServer(db, { town: () => null, player: () => null }, { now: () => 1000 });
  war.saveAcct(5, { seq: 2, arsenal: { drone: 3 }, reload: {} });
  db.put("charge", "5:1", { seq: 1, amount: 10, at: 1 }, { k1: "5", at: 1 });
  db.put("dmg", "5:3:4", { x: 3, y: 4, by: 9, at: 1 }, { k1: "5", at: 1 });
  db.put("dmg", "9:1:1", { x: 1, y: 1, by: 5, at: 1 }, { k1: "9", at: 1 });
  war.note(5, "x", "hello", {}, false);
  war.saveRel(5, 9, { a: 5, b: 9, state: "war", hist: [{ by: 5 }], lastThreat: { 5: 7 } });
  db.put("op", "o1", { from: 5, to: 9, status: "done" }, { k1: "5", k2: "9", at: 1 });
  assert.equal(war.inFlight(5), false);
  war.moveTown(5, 20);
  assert.equal(war.acct(20).arsenal.drone, 3);
  assert.equal(db.list("charge", { k1: "20" }).length, 1);
  assert.equal(db.list("charge", { k1: "5" }).length, 0);
  assert.equal(db.get("dmg", "20:3:4").by, 9);
  assert.equal(db.get("dmg", "9:1:1").by, 20);
  assert.equal(db.list("note", { k1: "20" }).length, 1);
  const rel = war.rel(9, 20);
  assert.equal(rel.state, "war"); assert.equal(rel.a, 9); assert.equal(rel.b, 20); assert.equal(rel.hist[0].by, 20); assert.equal(rel.lastThreat[20], 7);
  assert.equal(war.rel(5, 9), null);
  assert.deepEqual([db.get("op", "o1").from, db.get("op", "o1").to], [20, 9]);
  db.put("op", "o2", { from: 9, to: 20, status: "flying" }, { k1: "9", k2: "20", at: 2 });
  assert.equal(war.inFlight(20), true);
});

test("حق الرد: a much bigger town never starts a war, but answers one the smaller town started", () => {
  const W = makeWorld();
  const big = W.addTown(1, "الكبيرة", { era: 4, mil: BASE }), small = W.addTown(2, "الصغيرة", { era: 2, mil: BASE });
  // the big one may not start
  assert.match(W.war.handle("rel", { req: "b1", other: small.plot, act: "hostile" }, big).error, /أكبر منها/);
  // the small one starts it and goes to war
  atWar(W, small, big);
  // now the big one can strike back
  const a = W.war.acct(big.plot); a.arsenal.drone = 3; W.war.saveAcct(big.plot, a);
  const t = W.towns.get(small.plot).s.tiles.findIndex((x) => x.b?.id === "dronebase");
  const r = W.war.handle("launch", { op: "r1", to: small.plot, x: t % 72, y: Math.floor(t / 72), load: { drone: 1 } }, big);
  assert.equal(r.error, undefined, r.error);
});

test("«دفعة»: several targets in one batch, checked as a whole, one operation in the air, a result for each", () => {
  const W = makeWorld();
  const a = W.addTown(1, "المهاجمة", { era: 3, mil: [[20, 20, "milhq", 2], [22, 20, "dronebase", 1], [24, 20, "missilepad", 1], [26, 20, "radar"], [28, 20, "airdef"]] });
  const b = W.addTown(2, "الهدف", { era: 3, mil: [[20, 20, "milhq"], [22, 20, "dronebase"], [24, 20, "missilepad"], [26, 20, "radar"], [28, 20, "airdef"], [30, 30, "generator"]] });
  atWar(W, a, b);
  const acct = W.war.acct(a.plot); acct.arsenal.drone = 4; acct.arsenal.missile = 2; W.war.saveAcct(a.plot, acct);
  // too much for the ready launchers: nothing is spent
  const tooMuch = W.war.handle("salvo", { op: "s0", to: b.plot, targets: [{ x: 22, y: 20, load: { drone: 4 } }, { x: 24, y: 20, load: { drone: 4 } }] }, a);
  assert.ok(tooMuch.error);
  assert.equal(W.war.acct(a.plot).arsenal.drone, 4);
  // a duplicate target is refused
  assert.match(W.war.handle("salvo", { op: "s1", to: b.plot, targets: [{ x: 22, y: 20, load: { drone: 1 } }, { x: 22, y: 20, load: { drone: 1 } }] }, a).error, /مكرر/);
  // three targets: drones on two, a missile on the third
  const r = W.war.handle("salvo", { op: "s2", to: b.plot, targets: [{ x: 22, y: 20, load: { drone: 1 } }, { x: 26, y: 20, load: { drone: 1 } }, { x: 30, y: 30, load: { missile: 1 } }] }, a);
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.ops.length, 3);
  assert.equal(W.war.acct(a.plot).arsenal.drone, 2);
  assert.equal(W.war.acct(a.plot).arsenal.missile, 1);
  assert.equal(W.war.flying({ k1: String(a.plot) }), 1); // one operation in the air
  // the same request again is answered the same, never launched twice
  assert.deepEqual(W.war.handle("salvo", { op: "s2", to: b.plot, targets: [] }, a).ops.map((o) => o.id), r.ops.map((o) => o.id));
  W.tick(30 * MIN); W.war.settle();
  const done = r.ops.map((o) => W.db.get("op", o.id));
  assert.ok(done.every((o) => o.status === "done" && o.result));
});

test("a strike falls on a spot: the buildings around it are hit too, mosques never, and people leave hit houses", () => {
  const W = makeWorld({ rolls: Array(40).fill(0.99) }); // no interception, full damage
  const a = W.addTown(1, "المهاجمة", { era: 3, mil: [[20, 20, "milhq", 2], [24, 20, "missilepad", 2], [26, 20, "radar"]] });
  const b = W.addTown(2, "الهدف", { era: 3, mil: [[20, 20, "milhq"], [40, 40, "house", 3], [41, 40, "house", 3], [42, 40, "generator"], [40, 41, "mosque"], [45, 45, "factory"]] });
  W.resync(2, (s) => { s.tiles[idx(40, 40)].b.res = 16; s.tiles[idx(41, 40)].b.res = 16; });
  atWar(W, a, b);
  const acct = W.war.acct(a.plot); acct.arsenal.missile2 = 2; W.war.saveAcct(a.plot, acct);
  const r = W.war.handle("launch", { op: "area", to: 2, x: 40, y: 40, load: { missile2: 1 } }, a);
  assert.equal(r.error, undefined, r.error);
  W.tick(30 * MIN); W.war.settle();
  const res = W.db.get("op", "area").result;
  const hit = new Set(res.area.map((h) => `${h.x}:${h.y}`));
  assert.ok(hit.has("40:40") && hit.has("41:40") && hit.has("42:40"), JSON.stringify(res.area));
  assert.ok(!hit.has("40:41"), "the mosque is never hit");
  assert.ok(!hit.has("45:45"), "too far");
  const centre = res.area.find((h) => h.x === 40 && h.y === 40), side = res.area.find((h) => h.x === 42 && h.y === 40);
  assert.ok(centre.dmg > side.dmg, "less damage further from the spot");
  assert.ok(res.displaced > 0);
  assert.equal(W.war.publicDamage(2).some((d) => d.x === 40 && d.y === 41), false);
});
