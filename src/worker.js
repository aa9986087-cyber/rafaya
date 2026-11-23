// الرافعية online: the game's files (static assets) plus a small API for the leaderboard and for
// visiting other players' towns. Everything is kept in one Durable Object with SQLite storage.
//
//   POST /api/publish            { code?, secret?, name, mayor, pop, happy, money, era, snapshot }
//                                → { code, secret }   (the first publish makes a code and a secret)
//   GET  /api/board?by=pop|happy|money   → { towns: [...] }  (top 50)
//   GET  /api/town/CODE          → { town, comments }   (with the town's snapshot)
//   POST /api/town/CODE/comment  { author, text } → { ok: true }
//
// The world of al-Jouf (one shared map; every player has a name and one plot with their town):
//   GET  /api/world/clock                       → { epoch, now }   (the world's shared time)
//   POST /api/world/join     { name }           → { name, secret, recovery }
//   POST /api/world/recover  { name, recovery } → { name, secret }
//   GET  /api/world/map                         → { plots: [...] }  (every claimed plot, no snapshots)
//   POST /api/world/claim    { name, secret, plot, town, terrain } → { ok }
//   POST /api/world/sync     { name, secret, pop, happy, money, era, snapshot } → { ok }
//   GET  /api/world/town/PLOT                   → { town, comments }
//   POST /api/world/town/PLOT/comment { name, secret, text } → { ok }
//   POST /api/world/report   { name, secret, plot, reason } → { ok }
import { DurableObject } from "cloudflare:workers";

const MAX_SNAPSHOT = 400_000; // characters of the packed town
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const clean = (v, max) => String(v ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const int = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
// The world's clock started here; every town's hour is counted from it (50 seconds an hour).
const WORLD_EPOCH = Date.UTC(2026, 10, 1);
// Maintenance switch for the world of al-Jouf: while false, every /api/world/* call answers 503
// { error: "maintenance" } and nothing in the world tables is read or changed. Towns stay saved;
// the solo game and the old /api/publish leaderboard keep working. Set back to true to reopen.
const WORLD_OPEN = false;
// The world's generation. Raising it wipes the whole world once (every town, player name, world
// comment and report) and tells every phone to forget its old world town. The solo game and the
// old /api/publish leaderboard are never touched.
//   gen 2 (2026-11-23): the owner wiped the world so everyone starts again.
const WORLD_GEN = 2;
const NAME_RE = /^[\u0600-\u06FFA-Za-z0-9_ ]{3,16}$/;
const BAD = ["كلب", "حمار", "زق", "خرا", "سكس", "شرموط", "قحب", "fuck", "shit", "sex"];
const badText = (t) => BAD.some((w) => t.toLowerCase().includes(w));
async function hash(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
const makeSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

export class Board extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS towns (code TEXT PRIMARY KEY, secret TEXT, name TEXT, mayor TEXT, pop INTEGER, happy INTEGER, money INTEGER, era INTEGER, updated INTEGER, snapshot TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, author TEXT, text TEXT, at INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS players (name TEXT PRIMARY KEY, secret TEXT, recovery TEXT, created INTEGER, plot INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS plots (plot INTEGER PRIMARY KEY, owner TEXT, town TEXT, terrain TEXT, pop INTEGER, happy INTEGER, money INTEGER, era INTEGER, updated INTEGER, snapshot TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, plot INTEGER, by TEXT, reason TEXT, at INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
    const gen = Number(this.sql.exec("SELECT value FROM meta WHERE key = 'world_gen'").toArray()[0]?.value || 1);
    if (gen < WORLD_GEN) {
      this.sql.exec("DELETE FROM plots");
      this.sql.exec("DELETE FROM players");
      this.sql.exec("DELETE FROM reports");
      this.sql.exec("DELETE FROM comments WHERE code GLOB 'w[0-9]*'"); // world towns' comments are "w<plot>"; GLOB is case-sensitive, so the old 6-letter codes stay
      this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('world_gen', ?)", String(WORLD_GEN));
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
    try {
      if (request.method === "POST" && parts[1] === "publish") return this.publish(await request.json());
      if (request.method === "GET" && parts[1] === "board") return this.board(url.searchParams.get("by"));
      if (parts[1] === "world") return this.world(request, parts.slice(2));
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

  // ---------- the world of al-Jouf ----------
  async world(request, p) {
    if (!WORLD_OPEN) return json({ error: "maintenance" }, 503);
    const post = request.method === "POST", body = post ? await request.json() : {};
    if (!post && p[0] === "clock") return json({ epoch: WORLD_EPOCH, now: Date.now(), gen: WORLD_GEN });
    if (!post && p[0] === "map") {
      const plots = this.sql.exec("SELECT plot, owner, town, terrain, pop, happy, money, era, updated FROM plots ORDER BY plot LIMIT 3000").toArray();
      return json({ plots });
    }
    if (!post && p[0] === "town" && p[1]) {
      const plot = int(p[1]);
      const town = this.sql.exec("SELECT plot, owner, town, terrain, pop, happy, money, era, updated, snapshot FROM plots WHERE plot = ?", plot).toArray()[0];
      if (!town) return json({ error: "no such town" }, 404);
      const comments = this.sql.exec("SELECT author, text, at FROM comments WHERE code = ? ORDER BY id DESC LIMIT 30", `w${plot}`).toArray();
      return json({ town, comments });
    }
    if (post && p[0] === "join") {
      const name = clean(body.name, 16);
      if (!NAME_RE.test(name) || badText(name)) return json({ error: "bad name" }, 400);
      if (this.sql.exec("SELECT 1 FROM players WHERE name = ?", name).toArray().length) return json({ error: "taken" }, 409);
      const secret = makeSecret(), recovery = makeCode() + makeCode();
      this.sql.exec("INSERT INTO players (name, secret, recovery, created, plot) VALUES (?, ?, ?, ?, NULL)", name, await hash(secret), await hash(recovery), Date.now());
      return json({ name, secret, recovery });
    }
    if (post && p[0] === "recover") {
      const name = clean(body.name, 16), row = this.sql.exec("SELECT recovery, plot FROM players WHERE name = ?", name).toArray()[0];
      if (!row || row.recovery !== (await hash(String(body.recovery || "").toUpperCase().trim()))) return json({ error: "wrong" }, 403);
      const secret = makeSecret();
      this.sql.exec("UPDATE players SET secret = ? WHERE name = ?", await hash(secret), name);
      return json({ name, secret, plot: row.plot });
    }
    // everything below needs the player's own secret
    const name = clean(body.name, 16), me = this.sql.exec("SELECT secret, plot FROM players WHERE name = ?", name).toArray()[0];
    if (!me || me.secret !== (await hash(String(body.secret || "")))) return json({ error: "who are you" }, 403);
    if (p[0] === "claim") {
      const plot = int(body.plot), town = clean(body.town, 20) || "هجرة";
      if (me.plot != null) return json({ error: "you have a town", plot: me.plot }, 409);
      if (plot < 0 || plot >= 5000 || badText(town)) return json({ error: "bad" }, 400);
      if (this.sql.exec("SELECT 1 FROM plots WHERE plot = ?", plot).toArray().length) return json({ error: "taken" }, 409);
      this.sql.exec("INSERT INTO plots (plot, owner, town, terrain, pop, happy, money, era, updated, snapshot) VALUES (?, ?, ?, ?, 9, 55, 0, 0, ?, '')", plot, name, town, clean(body.terrain, 12), Date.now());
      this.sql.exec("UPDATE players SET plot = ? WHERE name = ?", plot, name);
      return json({ ok: true, plot });
    }
    if (p[0] === "sync") {
      if (me.plot == null) return json({ error: "no town" }, 400);
      const snapshot = String(body.snapshot || "");
      if (snapshot.length > MAX_SNAPSHOT) return json({ error: "snapshot too big" }, 413);
      this.sql.exec("UPDATE plots SET pop = ?, happy = ?, money = ?, era = ?, updated = ?, snapshot = CASE WHEN ? = '' THEN snapshot ELSE ? END WHERE plot = ?",
        int(body.pop), int(body.happy), int(body.money), int(body.era), Date.now(), snapshot, snapshot, me.plot);
      return json({ ok: true });
    }
    if (p[0] === "town" && p[2] === "comment") {
      const plot = int(p[1]), text = clean(body.text, 200);
      if (!text || badText(text)) return json({ error: "bad" }, 400);
      if (!this.sql.exec("SELECT 1 FROM plots WHERE plot = ?", plot).toArray().length) return json({ error: "no such town" }, 404);
      this.sql.exec("INSERT INTO comments (code, author, text, at) VALUES (?, ?, ?, ?)", `w${plot}`, name, text, Date.now());
      this.sql.exec("DELETE FROM comments WHERE code = ? AND id NOT IN (SELECT id FROM comments WHERE code = ? ORDER BY id DESC LIMIT 100)", `w${plot}`, `w${plot}`);
      return json({ ok: true });
    }
    if (p[0] === "report") {
      this.sql.exec("INSERT INTO reports (plot, by, reason, at) VALUES (?, ?, ?, ?)", int(body.plot), name, clean(body.reason, 200), Date.now());
      return json({ ok: true });
    }
    return json({ error: "not found" }, 404);
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
