// الرافعية online: the game's files (static assets) plus a small API for the leaderboard and for
// visiting other players' towns. Everything is kept in one Durable Object with SQLite storage.
//
//   POST /api/publish            { code?, secret?, name, mayor, pop, happy, money, era, snapshot }
//                                → { code, secret }   (the first publish makes a code and a secret)
//   GET  /api/board?by=pop|happy|money   → { towns: [...] }  (top 50)
//   GET  /api/town/CODE          → { town, comments }   (with the town's snapshot)
//   POST /api/town/CODE/comment  { author, text } → { ok: true }
import { DurableObject } from "cloudflare:workers";

const MAX_SNAPSHOT = 400_000; // characters of the packed town
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const clean = (v, max) => String(v ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const int = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
const makeSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

export class Board extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS towns (code TEXT PRIMARY KEY, secret TEXT, name TEXT, mayor TEXT, pop INTEGER, happy INTEGER, money INTEGER, era INTEGER, updated INTEGER, snapshot TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, author TEXT, text TEXT, at INTEGER)`);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
    try {
      if (request.method === "POST" && parts[1] === "publish") return this.publish(await request.json());
      if (request.method === "GET" && parts[1] === "board") return this.board(url.searchParams.get("by"));
      if (parts[1] === "town" && parts[2]) {
        const code = clean(parts[2], 8).toUpperCase();
        if (request.method === "GET" && !parts[3]) return this.town(code);
        if (request.method === "POST" && parts[3] === "comment") return this.comment(code, await request.json());
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: "bad request" }, 400);
    }
  }

  publish(body) {
    const snapshot = String(body.snapshot || "");
    if (!snapshot || snapshot.length > MAX_SNAPSHOT) return json({ error: "snapshot too big" }, 413);
    const row = { name: clean(body.name, 24) || "مدينة", mayor: clean(body.mayor, 24) || "عمدة", pop: int(body.pop), happy: int(body.happy), money: int(body.money), era: int(body.era) };
    let code = clean(body.code, 8).toUpperCase(), secret = String(body.secret || "");
    const old = code ? this.sql.exec("SELECT secret FROM towns WHERE code = ?", code).toArray()[0] : null;
    if (!old || old.secret !== secret) {
      // a new town (or someone else's code): make a fresh code
      do code = makeCode(); while (this.sql.exec("SELECT 1 FROM towns WHERE code = ?", code).toArray().length);
      secret = makeSecret();
    }
    this.sql.exec(
      `INSERT INTO towns (code, secret, name, mayor, pop, happy, money, era, updated, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET name = excluded.name, mayor = excluded.mayor, pop = excluded.pop, happy = excluded.happy, money = excluded.money, era = excluded.era, updated = excluded.updated, snapshot = excluded.snapshot`,
      code, secret, row.name, row.mayor, row.pop, row.happy, row.money, row.era, Date.now(), snapshot
    );
    return json({ code, secret });
  }

  board(by) {
    const col = { pop: "pop", happy: "happy", money: "money" }[by] || "pop";
    const towns = this.sql.exec(`SELECT code, name, mayor, pop, happy, money, era, updated FROM towns ORDER BY ${col} DESC, updated DESC LIMIT 50`).toArray();
    return json({ towns });
  }

  town(code) {
    const town = this.sql.exec("SELECT code, name, mayor, pop, happy, money, era, updated, snapshot FROM towns WHERE code = ?", code).toArray()[0];
    if (!town) return json({ error: "no such town" }, 404);
    const comments = this.sql.exec("SELECT author, text, at FROM comments WHERE code = ? ORDER BY id DESC LIMIT 30", code).toArray();
    return json({ town, comments });
  }

  comment(code, body) {
    if (!this.sql.exec("SELECT 1 FROM towns WHERE code = ?", code).toArray().length) return json({ error: "no such town" }, 404);
    const text = clean(body.text, 200), author = clean(body.author, 24) || "زائر";
    if (!text) return json({ error: "empty" }, 400);
    this.sql.exec("INSERT INTO comments (code, author, text, at) VALUES (?, ?, ?, ?)", code, author, text, Date.now());
    // keep the newest 100 per town
    this.sql.exec("DELETE FROM comments WHERE code = ? AND id NOT IN (SELECT id FROM comments WHERE code = ? ORDER BY id DESC LIMIT 100)", code, code);
    return json({ ok: true });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const board = env.BOARD.get(env.BOARD.idFromName("rafaya"));
      return board.fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};
