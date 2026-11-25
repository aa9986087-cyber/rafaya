import assert from "node:assert/strict";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { newGame, pack, unpack } from "../js/sim.js";
import { rememberPendingSave, townSaveWriter } from "../js/save-version.js";

const workerLoader = `export function resolve(specifier, context, next) {
  if (specifier === "cloudflare:workers") return {
    shortCircuit: true,
    url: "data:text/javascript,export class DurableObject { constructor(ctx) { this.ctx = ctx; } }"
  };
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(workerLoader)}`);
const { Board } = await import("../src/worker.js");

test("world saves preserve newer progress across device handoffs and retries", async () => {
  const db = new DatabaseSync(":memory:");
  const board = new Board({
    storage: {
      sql: { exec(query, ...args) {
        const rows = db.prepare(query).all(...args);
        return { toArray: () => rows };
      }},
      getAlarm: async () => null,
      setAlarm: async () => {}
    },
    getWebSockets: () => []
  }, { WAR_TEST: "1" });

  async function request(path, body) {
    const response = await board.fetch(new Request(`https://example.test/api/world/${path}`, body && {
      method: "POST", body: JSON.stringify(body)
    }));
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data;
  }

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
  db.close();
});
