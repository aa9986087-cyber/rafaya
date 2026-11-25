import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const loader = `export function resolve(specifier, context, next) {
  if (specifier === "cloudflare:workers") return {
    shortCircuit: true,
    url: "data:text/javascript,export class DurableObject { constructor(ctx) { this.ctx = ctx; } }"
  };
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`);
const { Board } = await import("../src/worker.js");

test("the owner can grant and revoke temporary access to the admin lists", async (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const sql = (query, ...args) => db.prepare(query).all(...args);
  const board = new Board({
    storage: { sql: { exec(query, ...args) { const rows = sql(query, ...args); return { toArray: () => rows }; } } },
    getWebSockets: () => []
  }, {});
  const hash = value => createHash("sha256").update(value).digest("hex");
  const now = Date.now(), ownerToken = "local-test-owner-session";
  sql("INSERT INTO admintokens (token, at) VALUES (?, ?)", hash(ownerToken), now);
  sql("INSERT INTO players (name, plot, created, banned) VALUES (?, ?, ?, 0)", "Review mayor", 20, now);
  sql("INSERT INTO plots (plot, owner, town, pop, era, money, updated) VALUES (?, ?, ?, ?, ?, ?, ?)", 20, "Review mayor", "Review town", 37, 0, 1234, now);
  sql("INSERT INTO reports (plot, by, reason, at) VALUES (?, ?, ?, ?)", 20, "Reporter", "Review fixture", now);
  sql("INSERT INTO feedback (name, town, text, at) VALUES (?, ?, ?, ?)", "Review mayor", "Review town", "Owner feedback", now);

  async function request(route, { method = "GET", body, owner, review } = {}) {
    const headers = {};
    if (owner) headers["x-admin"] = owner;
    if (review) headers["x-rafaya-review"] = review;
    const res = await board.fetch(new Request(`https://example.test/api/admin/${route}`, {
      method, headers, body: body && JSON.stringify(body)
    }));
    return { status: res.status, data: await res.json(), cache: res.headers.get("cache-control") };
  }
  const owner = { owner: ownerToken };
  const change = (action, auth = owner) => request("review-access", { ...auth, method: "POST", body: { action } });

  assert.equal((await request("stats")).status, 401);
  assert.equal((await change("create", {})).status, 401);
  assert.equal((await request("review-access", owner)).data.expires, null);
  const created = await change("create");
  assert.equal(created.status, 200);
  assert.equal(created.cache, "no-store");
  const { token, expires } = created.data;
  assert.match(token, /^rf-review-[a-f0-9]{32}$/);
  assert.ok(expires > now && expires - Date.now() <= 15 * 60 * 1000);
  assert.equal(sql("SELECT token FROM review_access")[0].token, hash(token));
  assert.deepEqual((await request("review-access", owner)).data, { expires });

  const review = { review: token };
  for (const route of ["stats", "reports", "chat", "feedback", "players?q=Review", "namefix", "gifts", "statement?plot=20"]) {
    assert.equal((await request(route, review)).status, 200, route);
  }
  assert.equal((await request("statement?plot=20", review)).data.money, 1234);
  assert.equal((await request("feedback", review)).data.list[0].text, "Owner feedback");
  assert.equal((await request("reports?clear=1", review)).data.list.length, 1);

  assert.equal((await request("players", { owner: token })).status, 401);
  assert.equal((await request("players", { review: "rf-review-" + "0".repeat(32) })).status, 401);
  assert.equal((await request("review-access", review)).status, 403);
  assert.equal((await change("create", review)).status, 403);
  assert.equal((await change("revoke", review)).status, 403);
  assert.equal((await request("reports/nested", review)).status, 403);
  assert.equal((await request("reports", { ...review, method: "POST", body: { clear: 1 } })).status, 403);
  assert.equal((await request("ban", { ...review, method: "POST", body: { name: "Review mayor", on: true } })).status, 403);
  assert.equal((await request("players", review)).data.list[0].banned, 0);

  const replacement = { review: (await change("create")).data.token };
  assert.equal((await request("stats", review)).status, 401);
  assert.equal((await request("stats", replacement)).status, 200);
  sql("UPDATE review_access SET expires = ?", Date.now() - 1);
  assert.equal((await request("stats", replacement)).status, 401);
  assert.equal((await request("review-access", owner)).data.expires, null);

  const active = { review: (await change("create")).data.token };
  assert.equal((await change("revoke")).data.ok, true);
  assert.equal((await request("stats", active)).status, 401);
  assert.equal((await request("stats", owner)).status, 200);
});
