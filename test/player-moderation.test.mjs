import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createModeration } from "../src/moderation.js";

const loader = `export function resolve(specifier, context, next) {
  if (specifier === "cloudflare:workers") return {
    shortCircuit: true,
    url: "data:text/javascript,export class DurableObject { constructor(ctx) { this.ctx = ctx; } }"
  };
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`);
const { Board } = await import("../src/worker.js");

const hash = value => createHash("sha256").update(value).digest("hex");

function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const sql = (query, ...values) => db.prepare(query).all(...values);
  const socket = name => ({
    closed: false, messages: [],
    deserializeAttachment() { return { name }; },
    send(text) { this.messages.push(JSON.parse(text)); },
    close() { this.closed = true; }
  });
  const sockets = [socket("Old mayor"), socket("Other mayor")];
  const board = new Board({
    storage: {
      sql: { exec(query, ...values) { const rows = sql(query, ...values); return { toArray: () => rows }; } },
      transactionSync(action) {
        db.exec("BEGIN");
        try { const result = action(); db.exec("COMMIT"); return result; }
        catch (error) { db.exec("ROLLBACK"); throw error; }
      }
    },
    getWebSockets: () => sockets.filter(ws => !ws.closed)
  }, {});
  board.armWar = async () => {};
  const now = Date.now();
  const token = "test-owner-session";
  sql("INSERT INTO admintokens (token, at) VALUES (?, ?)", hash(token), now);
  async function request(path, body, owner = false) {
    const res = await board.fetch(new Request("https://example.test/api/" + path, {
      method: body ? "POST" : "GET",
      headers: owner ? { "x-admin": token } : {},
      body: body && JSON.stringify(body)
    }));
    return { status: res.status, data: await res.json() };
  }
  return { board, sql, now, sockets, request };
}

test("offensive compound names are blocked in player and town entry points", async (t) => {
  const filter = createModeration();
  for (const name of ["نياج الخروق", "نيــاج_الخُروق", "نياك خروق", "ابو نياجالخروق"]) {
    assert.equal(filter.blockedName(name), true);
  }
  assert.equal(filter.blockedChat("يا نياج الخروق"), true);
  assert.equal(filter.blockedName("خالد الخزاعي"), false);
  assert.equal(filter.blockedName("مدينة الروابي"), false);
  const { sql, now, request } = fixture(t);
  const name = "Old mayor", secret = "test-secret";
  sql("INSERT INTO players (name, secret, created) VALUES (?, ?, ?)", name, hash(secret), now);
  assert.equal((await request("world/join", { name: "نياج الخروق" })).status, 422);
  assert.match((await request("world/newname", { name, secret, newName: "نياج الخروق" })).data.error, /لقب مناسب/);
  assert.equal((await request("world/claim", { name, secret, plot: 12, town: "نياج الخروق" })).status, 400);
  assert.equal(sql("SELECT name FROM players")[0].name, name);
  assert.equal(sql("SELECT COUNT(*) AS n FROM plots")[0].n, 0);
});

test("the owner can apply private name rules immediately and review existing names", async (t) => {
  const { board, sql, now, request } = fixture(t);
  const name = "Old mayor", secret = "test-secret";
  sql("INSERT INTO players (name, secret, created, plot) VALUES (?, ?, ?, 7)", name, hash(secret), now);
  sql("INSERT INTO plots (plot, owner, town) VALUES (7, ?, 'لقب تجريبي')", name);
  sql("INSERT INTO wnews (kind, plot, text, at) VALUES ('town', 7, 'تأسست «لقب تجريبي»', ?)", now);
  assert.equal((await request("admin/name-rules")).status, 401);
  assert.equal((await request("admin/name-rules", { lines: "لقب تجريبي" })).status, 401);
  assert.equal((await request("admin/name-rules", { lines: "١_2???" }, true)).status, 422);
  const changed = await request("admin/name-rules", { lines: "لقب تجريبي\nلـقـب_تجريبي" }, true);
  assert.equal(changed.status, 200);
  assert.deepEqual(changed.data.rules, ["لقب تجريبي"]);
  assert.deepEqual(changed.data.matches, [{ name, town: "لقب تجريبي", what: "town" }]);
  assert.deepEqual(JSON.parse(sql("SELECT value FROM meta WHERE key = 'private_moderation'")[0].value).nameOnly, changed.data.rules);
  assert.equal(board.moderation.blockedChat("لقب تجريبي"), false);
  assert.equal((await request("world/join", { name: "لقب_تجريبي" })).status, 422);
  assert.match((await request("world/newname", { name, secret, newName: "لـقـب_تجريبي" })).data.error, /لقب مناسب/);
  assert.match((await request("admin/rename", { plot: 7, town: "لقب تجريبي" }, true)).data.error, /الاسم ما يصلح/);
  assert.equal((await request("world/news")).data.items.some((item) => item.plot === 7), false);
  board.news("town", "تأسست «لقب تجريبي»", 99);
  assert.equal(sql("SELECT 1 FROM wnews WHERE plot = 99").length, 0);
  assert.deepEqual((await request("admin/name-rules", { lines: "" }, true)).data.rules, []);
  assert.equal((await request("world/join", { name: "لقب_تجريبي" })).status, 200);
});

test("owner can ban and purge the associated content without removing another player's town", async (t) => {
  const { sql, now, sockets, request } = fixture(t);
  const name = "Old mayor", other = "Other mayor", town = "Old town", secret = "original-device";
  const device = "fixture-original-device";
  sql("INSERT INTO players (name, secret, recovery, google, device, created, plot, played) VALUES (?, ?, ?, ?, ?, ?, ?, 91)", name, hash(secret), hash("RECOVERY"), hash("google"), hash("d:" + device), now, 7);
  sql("INSERT INTO players (name, secret, created, plot) VALUES (?, ?, ?, ?)", other, hash("other-device"), now, 8);
  sql("INSERT INTO plots (plot, owner, town, snapshot) VALUES (7, ?, ?, ?), (8, ?, ?, ?)", name, town, "old save", other, "Other town", "unrelated save");
  sql("INSERT INTO keys (name, secret, at) VALUES (?, ?, ?)", name, hash("extra-device"), now);
  sql("INSERT INTO handoff (code, name, at) VALUES ('123456', ?, ?)", name, now);
  sql("INSERT INTO chat (name, plot, town, text) VALUES (?, 7, ?, 'old chat'), (?, 8, 'Other town', 'other chat')", name, town, other);
  sql("INSERT INTO comments (code, author, text) VALUES ('w8', ?, 'old comment'), ('w7', ?, 'on removed town'), ('w8', ?, 'keep')", name, other, other);
  sql("INSERT INTO reports (plot, by, reason) VALUES (8, ?, 'reported by old'), (7, ?, 'reports old'), (8, ?, 'keep')", name, other, other);
  sql("INSERT INTO feedback (name, town, text, at) VALUES (?, ?, 'old feedback', ?), (?, 'Other town', 'keep', ?)", name, town, now, other, now);
  sql("INSERT INTO namefix (name, removed) VALUES (?, 0)", name);
  sql("INSERT INTO awayfix (plot, owner, town) VALUES (7, ?, ?), (8, ?, 'Other town')", name, town, other);
  sql("INSERT INTO pushsubs (k, plot) VALUES ('old-device', 7), ('other-device', 8)");
  sql("INSERT INTO pushq (k, tag, body) VALUES ('old-device','citizens','remove'), ('other-device','war-hit','«Old town»'), ('other-device','citizens','keep')");
  sql("INSERT INTO citizen_support_push (day, plot, k, next_at) VALUES (1, 7, 'old-device', ?), (1, 8, 'other-device', ?)", now, now);
  sql("INSERT INTO wnews (kind, plot, text) VALUES ('town', 7, '«Old town»'), ('hit', 8, '«Old town» ضربت «Other town»'), ('town', 8, '«Other town»')");
  const war = (tbl, id, row, k1 = null, k2 = null) => sql("INSERT INTO war (tbl, id, k1, k2, at, data) VALUES (?, ?, ?, ?, ?, ?)", tbl, id, k1, k2, tbl === "fly" ? now + 60000 : now, JSON.stringify(row));
  war("op", "remove-op", { from: 7, to: 8, status: "flying", fromTown: town, toTown: "Other town" }, "7", "8");
  war("fly", "remove-op", { id: "remove-op" });
  war("op", "keep-op", { from: 8, to: 9 }, "8", "9");
  war("fly", "keep-op", { id: "keep-op" });
  war("note", "remove-note", { op: "remove-op" }, "8");
  war("dmg", "remove-damage", { by: 7, wd: 32 }, "8");
  war("hit", "remove-hit", { from: 7 }, "8");
  war("rel", "7:8", { a: 7, b: 8 }, "7", "8");
  war("req", "8:remove-req", { res: { op: { id: "remove-op" } } }, "8");
  war("charge", "8:1", { why: "تشغيل عملية على «Old town»", amount: 900, seq: 1 }, "8");
  const account = { name, secret };
  const archived = await request("move/backup", { data: "test backup", account });
  const transferred = await request("move/put", { data: "test move", account });
  const unrelated = await request("move/backup", { data: "anonymous backup" });

  const remove = { name, on: true, purge: true, reason: "bad name" };
  assert.equal((await request("admin/ban", remove)).status, 401);
  assert.equal((await request("admin/ban", { ...remove, on: false }, true)).status, 400);
  assert.equal((await request("admin/ban", { name, on: true }, true)).data.ok, true);
  assert.equal((await request("world/town/7")).status, 200);
  assert.equal((await request("world/recover", { name, recovery: "RECOVERY" })).status, 403);
  assert.equal((await request("admin/ban", remove, true)).data.purged, true);
  assert.equal((await request("world/town/7")).status, 404);
  assert.equal((await request("world/town/8")).data.town.snapshot, "unrelated save");
  assert.equal((await request("world/town/8")).data.comments[0].text, "keep");
  assert.equal((await request("world/chat")).data.messages.length, 1);
  assert.equal((await request("world/news")).data.items.filter(x => x.plot != null).length, 1);
  assert.equal((await request("world/me", account)).status, 403);
  assert.equal((await request("world/me", { name, secret: "extra-device" })).status, 403);
  assert.match((await request("world/handoff/claim", { code: "123456" })).data.error, /انتهى/);
  assert.match((await request("move/restore", { code: archived.data.code })).data.error, /انتهى/);
  assert.equal((await request("move/take", { token: transferred.data.token })).data.error, "gone");
  assert.equal((await request("move/restore", { code: unrelated.data.code })).data.data, "anonymous backup");
  assert.equal((await request("move/backup", { data: "can't return", account })).status, 403);
  assert.equal((await request("world/join", { name })).status, 409);
  assert.equal((await request("world/join", { name: "Fresh player", device })).status, 403);
  const player = sql("SELECT banned, purged, secret, recovery, plot, played, google FROM players WHERE name = ?", name)[0];
  assert.deepEqual({ ...player }, { banned: 1, purged: 1, secret: null, recovery: null, plot: null, played: 0, google: hash("google") });
  for (const table of ["keys", "handoff", "namefix"]) assert.equal(sql("SELECT * FROM " + table).length, 0, table);
  for (const table of ["reports", "feedback", "awayfix", "pushsubs", "pushq", "citizen_support_push"]) assert.equal(sql("SELECT * FROM " + table).length, 1, table);
  assert.deepEqual(sql("SELECT id FROM war ORDER BY tbl").map(x => x.id), ["8:1","keep-op","keep-op"]);
  const charge = JSON.parse(sql("SELECT data FROM war WHERE id = '8:1'")[0].data);
  assert.deepEqual(charge, { why: "تشغيل عملية على مدينة محذوفة", amount: 900, seq: 1 });
  assert.ok(sockets[0].closed);
  assert.ok(sockets[0].messages.some(m => m.t === "banned"));
  assert.ok(sockets[1].messages.some(m => m.removed && m.plot === 7));
  assert.ok(sockets[1].messages.some(m => m.t === "chatdel" && m.ids.length === 1));
  assert.equal((await request("admin/ban", remove, true)).data.purged, true);
  assert.equal((await request("admin/ban", { name, on: false }, true)).data.freshStart, true);
  assert.equal((await request("world/join", { name, device })).status, 200);
  assert.equal((await request("world/town/7")).status, 404);
});

test("a failed purge rolls back the city and the moderator gets an error", async (t) => {
  const { sql, now, request } = fixture(t);
  const name = "Old mayor";
  sql("INSERT INTO players (name, created, plot) VALUES (?, ?, 7)", name, now);
  sql("INSERT INTO plots (plot, owner, town) VALUES (7, ?, 'Old town')", name);
  sql("INSERT INTO chat (name, text) VALUES (?, 'test')", name);
  sql("CREATE TRIGGER fail_purge BEFORE DELETE ON chat BEGIN SELECT RAISE(ABORT, 'failure'); END;");
  assert.equal((await request("admin/ban", { name, on: true, purge: true }, true)).status, 500);
  assert.equal(sql("SELECT banned FROM players WHERE name = ?", name)[0].banned, 0);
  assert.equal((await request("world/town/7")).status, 200);
  assert.equal(sql("SELECT COUNT(*) AS n FROM chat")[0].n, 1);
});

test("the bad-word bank blocks bad names and chat, but not normal names", async () => {
  const { createModeration } = await import("../src/moderation.js");
  const m = createModeration();
  for (const bad of ["شرموطة", "يا كلب", "كسمك", "sharmoota", "ك س م ك", "قحــــبه"]) assert.equal(m.blockedChat(bad) || m.blockedName(bad), true, bad);
  for (const ok of ["عبدالله", "كساب", "مصطفى", "الكسوة", "فرج الله", "هجرة الخير", "الرافعية", "كلبي ضاع", "Scunthorpe", "class"]) assert.equal(m.blockedName(ok), false, ok);
});
