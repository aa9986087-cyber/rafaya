import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { reviewPayload } from "../src/review-access.js";

const loader = `export function resolve(specifier, context, next) {
  if (specifier === "cloudflare:workers") return {
    shortCircuit: true,
    url: "data:text/javascript,export class DurableObject { constructor(ctx) { this.ctx = ctx; } }"
  };
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`);
const { Board } = await import("../src/worker.js");

test("only the paired reviewer can read the admin lists while access is enabled", async (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const sql = (query, ...args) => db.prepare(query).all(...args);
  const identity = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKey = identity.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const board = new Board({
    storage: { sql: { exec(query, ...args) { const rows = sql(query, ...args); return { toArray: () => rows }; } } },
    getWebSockets: () => []
  }, { REVIEW_PUBLIC_KEY: publicKey });
  const hash = value => createHash("sha256").update(value).digest("hex");
  const now = Date.now(), ownerToken = "local-test-owner-session";
  sql("INSERT INTO admintokens (token, at) VALUES (?, ?)", hash(ownerToken), now);
  sql("INSERT INTO players (name, plot, created, banned) VALUES (?, ?, ?, 0)", "Review mayor", 20, now);
  sql("INSERT INTO plots (plot, owner, town, pop, era, money, updated) VALUES (?, ?, ?, ?, ?, ?, ?)", 20, "Review mayor", "Review town", 37, 0, 1234, now);
  sql("INSERT INTO reports (plot, by, reason, at) VALUES (?, ?, ?, ?)", 20, "Reporter", "Review fixture", now);
  sql("INSERT INTO feedback (name, town, text, at) VALUES (?, ?, ?, ?)", "Review mayor", "Review town", "Owner feedback", now);

  const target = route => new URL(`https://example.test/api/admin/${route}`);
  function signed(route, { key = identity.privateKey, timestamp = String(Date.now()) } = {}) {
    const proof = sign("sha256", reviewPayload(target(route), timestamp), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
    return { "x-rafaya-review-time": timestamp, "x-rafaya-review-proof": proof };
  }
  async function request(route, { method = "GET", body, headers = {} } = {}) {
    const res = await board.fetch(new Request(target(route), { method, headers, body: body && JSON.stringify(body) }));
    return { status: res.status, data: await res.json(), cache: res.headers.get("cache-control") };
  }
  const owner = { headers: { "x-admin": ownerToken } };
  const review = route => request(route, { headers: signed(route) });
  const change = (action, auth = owner) => request("review-access", { ...auth, method: "POST", body: { action } });

  assert.equal((await request("stats")).status, 401);
  assert.equal((await change("enable", {})).status, 401);
  assert.deepEqual((await request("review-access", owner)).data, { configured: true, enabled: true });
  for (const route of ["stats", "reports", "chat", "feedback", "players?q=Review", "namefix", "gifts", "statement?plot=20"]) {
    const result = await review(route);
    assert.equal(result.status, 200, route);
    assert.equal(result.cache, "no-store");
  }
  assert.equal((await review("statement?plot=20")).data.money, 1234);
  assert.equal((await review("feedback")).data.list[0].text, "Owner feedback");
  assert.equal((await review("reports?clear=1")).data.list.length, 1);

  const wrongKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;
  assert.equal((await request("stats", { headers: signed("stats", { key: wrongKey }) })).status, 401);
  assert.equal((await request("stats", { headers: signed("stats", { timestamp: String(Date.now() - 61_000) }) })).status, 401);
  assert.equal((await request("stats", { headers: signed("stats", { timestamp: String(Date.now() + 61_000) }) })).status, 401);
  assert.equal((await request("statement?plot=21", { headers: signed("statement?plot=20") })).status, 401);
  assert.equal((await request("chat", { headers: signed("stats") })).status, 401);
  assert.equal((await request("stats", { headers: { "x-rafaya-review": "rf-review-" + "0".repeat(32) } })).status, 401);
  assert.equal((await review("review-access")).status, 403);
  assert.equal((await change("enable", { headers: signed("review-access") })).status, 403);
  assert.equal((await change("revoke", { headers: signed("review-access") })).status, 403);
  assert.equal((await review("reports/nested")).status, 403);
  assert.equal((await request("reports", { method: "POST", headers: signed("reports"), body: { clear: 1 } })).status, 403);
  assert.equal((await request("ban", { method: "POST", headers: signed("ban"), body: { name: "Review mayor", on: true } })).status, 403);
  assert.equal((await review("players")).data.list[0].banned, 0);

  assert.equal((await change("revoke")).data.enabled, false);
  assert.equal((await review("stats")).status, 401);
  assert.equal((await request("stats", owner)).status, 200);
  assert.equal((await change("enable")).data.enabled, true);
  assert.equal((await review("stats")).status, 200);
});
