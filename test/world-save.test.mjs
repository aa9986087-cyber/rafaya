import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { newGame, pack, unpack } from "../js/sim.js";
import { rememberPendingSave, townSaveWriter } from "../js/save-version.js";
import { CITY_MILESTONE } from "../js/data.js";

const workerLoader = `export function resolve(specifier, context, next) {
  if (specifier === "cloudflare:workers") return {
    shortCircuit: true,
    url: "data:text/javascript,export class DurableObject { constructor(ctx) { this.ctx = ctx; } }"
  };
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(workerLoader)}`);
const { Board } = await import("../src/worker.js");

function worldFixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const messages = [];
  const board = new Board({
    storage: {
      sql: { exec(query, ...args) {
        const rows = db.prepare(query).all(...args);
        return { toArray: () => rows };
      }},
      transactionSync(action) {
        db.exec("BEGIN");
        try {
          const result = action();
          db.exec("COMMIT");
          return result;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
      getAlarm: async () => null,
      setAlarm: async () => {}
    },
    getWebSockets: () => [{ send: (data) => messages.push(JSON.parse(data)), deserializeAttachment: () => ({}) }]
  }, { WAR_TEST: "1" });

  async function request(path, body) {
    const response = await board.fetch(new Request(`https://example.test/api/world/${path}`, body && {
      method: "POST", body: JSON.stringify(body)
    }));
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data;
  }
  return { db, board, messages, request };
}

test("world saves preserve newer progress across device handoffs and retries", async (t) => {
  const { request } = worldFixture(t);
  const plot = 17, name = "auditMayor", town = "Audit town";
  const first = await request("join", { name });
  assert.ok((await request("claim", { ...first, plot, town })).ok);
  const { code } = await request("handoff", first);
  const second = await request("handoff/claim", { code });
  assert.notEqual(first.secret, second.secret);
  const original = newGame(16, { name: town, site: "world" });
  original.world = { plot, owner: name, restartAt: 0 };
  original.money = 1000;
  const sync = (device, s, revision) => request("sync", {
    name, secret: device.secret, pop: 9, happy: 55, era: 0, money: s.money,
    restartAt: s.world.restartAt, warSeq: 0, snapshot: pack(s), ...revision
  });
  const read = async () => (await request(`town/${plot}`)).town;
  const write = (saveVersion, pendingWrites = []) => ({ saveVersion, saveWrite: crypto.randomUUID(), pendingWrites });

  const legacy = await sync(first, original);
  const newerLegacy = await sync(first, original);
  assert.equal((await sync(second, original, write(legacy.saveVersion))).conflict, true);
  const latest = unpack((await read()).snapshot);
  const build = latest.tiles.findIndex(({ b, t }) => !b && t === "sand");
  latest.tiles[build].b = { id: "house", lvl: 0, cond: 100 };
  latest.money = 975;
  const accepted = write(newerLegacy.saveVersion);
  assert.equal((await sync(first, latest, accepted)).saveVersion, accepted.saveWrite);
  assert.equal((await sync(second, original, write(newerLegacy.saveVersion))).conflict, true);
  assert.equal((await sync(second, original)).conflict, true);
  const server = await read();
  assert.equal(server.money, 975);
  assert.equal(unpack(server.snapshot).tiles[build].b.id, "house");

  const pending = write(accepted.saveWrite);
  const next = write(accepted.saveWrite, [pending.saveWrite]);
  assert.ok((await sync(first, latest, pending)).ok);
  latest.money = 1100;
  assert.ok((await sync(first, latest, next)).ok, "the previous save response can be lost");
  assert.ok((await sync(first, original, next)).ok, "retrying an accepted write returns its confirmation");
  assert.equal((await sync(first, original, pending)).conflict, true, "the older request cannot be applied a second time");
  assert.equal((await read()).money, 1100);

  const restarted = await request("restart", first);
  assert.ok(restarted.ok && restarted.saveVersion !== next.saveWrite);
  const obsolete = await sync(second, original, next);
  assert.equal(obsolete.restarted, restarted.restarted);
  assert.equal(obsolete.hasSave, false);
  original.world.restartAt = restarted.restarted;
  assert.equal((await sync(second, original)).conflict, true, "restarting does not let old clients bypass protected saves");
  assert.ok((await sync(first, original, write(restarted.saveVersion))).ok);
  const oldTown = await sync(second, latest, next);
  assert.equal(oldTown.hasSave, true);

  const base = (await read()).saveVersion;
  const sameSession = townSaveWriter();
  const background = sameSession();
  original.money = 1200;
  assert.ok((await sync(first, original, { saveVersion: base, saveWrite: background })).ok);
  let unconfirmed = [background];
  // Several closing/reconnecting attempts receive no answer, but the first attempt was accepted.
  for (let i = 0; i < 20; i++) unconfirmed = rememberPendingSave(unconfirmed, sameSession());
  assert.equal(unconfirmed.length, 1);
  assert.notEqual(unconfirmed[0], background);
  original.money = 1350;
  const resumed = sameSession();
  assert.equal((await sync(first, original, { saveVersion: base, saveWrite: resumed, pendingWrites: unconfirmed })).saveVersion, resumed);
  assert.equal((await sync(first, original, { saveVersion: base, saveWrite: background, pendingWrites: [] })).conflict, true);
  const differentSession = townSaveWriter();
  assert.equal((await sync(second, original, { saveVersion: base, saveWrite: differentSession(), pendingWrites: [differentSession()] })).conflict, true);
  assert.equal((await read()).money, 1350);
});

test("the 80th eligible city credits all current towns once and announces it in chat and news", async (t) => {
  const { db, board, messages, request } = worldFixture(t);
  const { goal, amount, title, thanks, signature } = CITY_MILESTONE;
  const sql = (query, ...args) => db.prepare(query).all(...args);
  const now = Date.now();
  const player = sql.bind(null, "INSERT INTO players (name, secret, plot, banned, created) VALUES (?, ?, ?, ?, ?)");
  const town = sql.bind(null, "INSERT INTO plots (plot, owner, town, money, updated, snapshot) VALUES (?, ?, ?, ?, ?, ?)");
  const secret = "test-city-milestone";
  const secretHash = createHash("sha256").update(secret).digest("hex");
  const save = newGame(31, { name: "City first", site: "world" });
  save.money = 5000;
  save.world = { plot: 1, owner: "Mayor1" };
  for (let plot = 1; plot < goal; plot++) {
    player(`Mayor${plot}`, secretHash, plot, 0, now);
    town(plot, `Mayor${plot}`, `City ${plot}`, 5000, now, plot === 1 ? pack(save) : "");
  }
  player("BannedMayor", secretHash, 100, 1, now);
  town(100, "BannedMayor", "Banned city", 5000, now, "");
  player("FutureMayor", secretHash, null, 0, now);
  player("LaterMayor", secretHash, null, 0, now);
  const charges = () => sql("SELECT data FROM war WHERE tbl = 'charge'").map(({ data }) => JSON.parse(data));
  const claim = { name: "FutureMayor", secret, plot: 80, town: "City new" };
  const hasAnnouncement = (entry) => entry.text.includes(title) && entry.text.includes(thanks) && entry.text.endsWith(`— ${signature}`);
  assert.equal(charges().length, 0);
  assert.equal((await request("chat")).messages.some(hasAnnouncement), false);
  assert.equal((await request("news")).items.some(hasAnnouncement), false);

  db.exec(`CREATE TRIGGER fail_celebration BEFORE INSERT ON chat
    BEGIN SELECT RAISE(ABORT, 'temporary failure writing chat'); END`);
  const failed = await board.fetch(new Request("https://example.test/api/world/claim", {
    method: "POST", body: JSON.stringify(claim)
  }));
  assert.equal(failed.status, 400);
  assert.equal(charges().length, 0);
  assert.equal(sql("SELECT 1 FROM plots WHERE plot = 80").length, 0);
  assert.equal(messages.length, 0);
  db.exec("DROP TRIGGER fail_celebration");

  assert.equal((await request("claim", claim)).ok, true);
  assert.equal(charges().length, goal);
  assert.ok(charges().every(({ why, amount: value }) => why === "cityMilestone" && value === -amount));
  assert.equal(sql("SELECT money FROM plots WHERE plot = 80")[0].money, amount, "the founding city gets the gift with everyone else");
  assert.equal(sql("SELECT money FROM plots WHERE plot = 100")[0].money, 5000);
  assert.equal((await request("chat")).messages.filter(hasAnnouncement).length, 1);
  assert.equal((await request("news")).items.filter(hasAnnouncement).length, 1);
  assert.deepEqual(messages.map((message) => message.t), ["chat", "news", "war"]);

  const auth = { name: "Mayor1", secret };
  assert.ok((await request("sync", { ...auth, money: 5000, warSeq: 0, snapshot: pack(save) })).ok);
  assert.equal((await request("town/1")).town.money, 5000 + amount, "an earlier saved balance keeps its new credit");
  const state = await request("war/state", { ...auth, seq: 0 });
  assert.equal(state.cityMilestoneSeq, state.charges[0].seq);
  save.money = 5000 + amount;
  save.war = { seq: state.cityMilestoneSeq };
  assert.ok((await request("sync", { ...auth, money: save.money, warSeq: save.war.seq, snapshot: pack(save) })).ok);
  assert.equal((await request("town/1")).town.money, save.money);
  const seen = await request("war/state", { ...auth, seq: save.war.seq });
  assert.equal(seen.charges.length, 0);
  assert.equal(seen.cityMilestoneSeq, save.war.seq, "the on-screen announcement is independent of later ledger requests");

  sql("DELETE FROM plots WHERE plot = 80");
  assert.equal((await request("claim", { ...claim, name: "LaterMayor", plot: 81, town: "City later" })).ok, true);
  assert.equal(sql("SELECT money FROM plots WHERE plot = 81")[0].money, 0, "reaching 80 again does not give a second gift");
  assert.equal(charges().length, goal);
  assert.equal((await request("chat")).messages.filter(hasAnnouncement).length, 1);
  assert.equal((await request("news")).items.filter(hasAnnouncement).length, 1);
});

test("a phone clock pushed ahead does not pay the hours the world has not reached", async (t) => {
  const { request } = worldFixture(t);
  const plot = 23, name = "clockMayor", town = "Clock town";
  const me = await request("join", { name });
  assert.ok((await request("claim", { ...me, plot, town })).ok);
  const s = newGame(16, { name: town, site: "world" });
  s.world = { plot, owner: name, restartAt: 0 };
  const { joufHours } = await import("../js/sim.js");
  const now = Date.now(); // a fresh world: its slow and fast hours both start now
  const hourNow = Math.floor(joufHours(now, { epoch: Date.UTC(2026, 10, 1), slowAt: now, fastAt: now }));
  let version = null;
  const sync = async (money, day) => {
    s.money = money; s.day = day;
    const r = await request("sync", { name, secret: me.secret, pop: 9, happy: 55, era: 1, money, restartAt: 0, warSeq: 0,
      ledger: { log: [], day, start: null, hour: null }, snapshot: pack(s), ...(version ? { saveVersion: version, saveWrite: crypto.randomUUID(), pendingWrites: [] } : {}) });
    if (r.saveVersion) version = r.saveVersion;
    return (await request(`town/${plot}`)).town.money;
  };
  assert.equal(await sync(5000, hourNow), 5000, "a normal sync keeps its money");
  assert.equal(await sync(15000, hourNow + 500), 5000, "hours ahead of the world earn nothing");
  assert.equal(await sync(5600, hourNow + 1), 5600, "back on the world's time, it earns again");
});

test("the clock cheaters are banned once, and the bulletin names them", async (t) => {
  const { db, board } = worldFixture(t);
  db.prepare("INSERT INTO players (name, secret, created, plot) VALUES (?, 's', 1, 5), (?, 's', 1, 6)").run("Waleed", "honestMayor");
  db.prepare("DELETE FROM meta WHERE key = 'clock_ban_v1'").run();
  board.clockBan();
  board.clockBan(); // once only
  const banned = db.prepare("SELECT name FROM players WHERE banned = 1").all().map((r) => r.name);
  assert.deepEqual(banned, ["Waleed"]);
  const lines = db.prepare("SELECT text FROM wnews WHERE kind = 'admin' AND text LIKE '%تم حظر%'").all();
  assert.equal(lines.length, 1);
  assert.ok(lines[0].text.includes("Waleed") && !lines[0].text.includes("honestMayor"));
});
