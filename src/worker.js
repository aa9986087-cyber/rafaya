// الرافعية online: the game's files (static assets) plus the API of the world of al-Jouf.
// Everything is kept in one Durable Object with SQLite storage.
// (The old solo «مدن الربع» API — /api/publish, /api/board, /api/town — was removed on 2026-11-23
// at the owner's request; its "towns" table is left in place, unused.)
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
//   GET  /api/world/chat?after=ID               → { messages: [...] }  (the public chat, newest 50 or those after ID)
//   POST /api/world/chat     { name, secret, text } → { ok, message }  (one message every 6 s, 200 characters)
//   POST /api/world/war/ACTION { name, secret, ... }   → «صراع الجوف», decided here (see js/warserver.js):
//        state · buy · rel · launch · op · repair · settings · enemy
import { DurableObject } from "cloudflare:workers";
import { WarServer, sqlWarDb } from "../js/warserver.js";
import { fastWar } from "../js/war.js";

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
// the solo game keeps working. Set back to true to reopen.
const WORLD_OPEN = true; // reopened 2026-11-23 with «صراع الجوف» (owner: «ارفعه ثم تفتح عالم الجوف»)
// The world's generation. Raising it wipes the whole world once (every town, player name, world
// comment and report) and tells every phone to forget its old world town. The solo game is never touched.
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
    this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS towns (code TEXT PRIMARY KEY, secret TEXT, name TEXT, mayor TEXT, pop INTEGER, happy INTEGER, money INTEGER, era INTEGER, updated INTEGER, snapshot TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, author TEXT, text TEXT, at INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS players (name TEXT PRIMARY KEY, secret TEXT, recovery TEXT, created INTEGER, plot INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS plots (plot INTEGER PRIMARY KEY, owner TEXT, town TEXT, terrain TEXT, pop INTEGER, happy INTEGER, money INTEGER, era INTEGER, updated INTEGER, snapshot TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, plot INTEGER, by TEXT, reason TEXT, at INTEGER)`);
    // the public chat of the world (newest 500 kept); it never says who is online, only who wrote what
    this.sql.exec(`CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, plot INTEGER, town TEXT, text TEXT, at INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
    const warDb = sqlWarDb(this.sql); // creates the war table (new, nothing old is touched)
    const gen = Number(this.sql.exec("SELECT value FROM meta WHERE key = 'world_gen'").toArray()[0]?.value || 1);
    if (gen < WORLD_GEN) {
      this.sql.exec("DELETE FROM plots");
      this.sql.exec("DELETE FROM players");
      this.sql.exec("DELETE FROM reports");
      this.sql.exec("DELETE FROM comments WHERE code GLOB 'w[0-9]*'"); // world towns' comments are "w<plot>"; GLOB is case-sensitive, so the old 6-letter codes stay
      this.sql.exec("DELETE FROM war");
      this.sql.exec("DELETE FROM chat");
      this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('world_gen', ?)", String(WORLD_GEN));
    }
    this.war = new WarServer(warDb, {
      town: (plot) => this.sql.exec("SELECT plot, owner, town, era, pop, updated, snapshot FROM plots WHERE plot = ?", plot).toArray()[0] || null,
      player: (name) => this.sql.exec("SELECT name, plot, created FROM players WHERE name = ?", name).toArray()[0] || null
    }, env?.WAR_TEST === "1" ? { cfg: fastWar(30) } : {}); // WAR_TEST: local testing only (wrangler dev --var WAR_TEST:1), never set on the live site
  }

  async fetch(request) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
    try {
      if (parts[1] === "world") return this.world(request, parts.slice(2));
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: "bad request" }, 400);
    }
  }

  // ---------- the world of al-Jouf ----------
  async world(request, p) {
    if (!WORLD_OPEN && this.env?.WAR_TEST !== "1") return json({ error: "maintenance" }, 503); // local tests may open it
    const post = request.method === "POST", body = post ? await request.json() : {};
    if (!post && p[0] === "clock") return json({ epoch: WORLD_EPOCH, now: Date.now(), gen: WORLD_GEN });
    if (!post && p[0] === "chat") {
      const after = int(new URL(request.url).searchParams.get("after"));
      const messages = after > 0
        ? this.sql.exec("SELECT id, name, plot, town, text, at FROM chat WHERE id > ? ORDER BY id ASC LIMIT 100", after).toArray()
        : this.sql.exec("SELECT id, name, plot, town, text, at FROM chat ORDER BY id DESC LIMIT 50", ).toArray().reverse();
      return json({ messages, now: Date.now() });
    }
    if (!post && p[0] === "map") {
      const plots = this.sql.exec("SELECT plot, owner, town, terrain, pop, happy, money, era, updated FROM plots ORDER BY plot LIMIT 3000").toArray();
      return json({ plots });
    }
    if (!post && p[0] === "town" && p[1]) {
      const plot = int(p[1]);
      const town = this.sql.exec("SELECT plot, owner, town, terrain, pop, happy, money, era, updated, snapshot FROM plots WHERE plot = ?", plot).toArray()[0];
      if (!town) return json({ error: "no such town" }, 404);
      const comments = this.sql.exec("SELECT author, text, at FROM comments WHERE code = ? ORDER BY id DESC LIMIT 30", `w${plot}`).toArray();
      return json({ town, comments, damage: this.war.publicDamage(plot) });
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
    if (p[0] === "war" && p[1]) {
      const who = this.sql.exec("SELECT name, plot, created FROM players WHERE name = ?", name).toArray()[0];
      const res = this.war.handle(p[1], body, who);
      return json(res, res.error === "not found" ? 404 : 200); // a refusal comes back as { error: "why, in Arabic" }
    }
    if (p[0] === "chat") {
      const text = clean(body.text, 200);
      if (!text) return json({ error: "اكتب شي" }, 200);
      if (badText(text)) return json({ error: "الكلام هذا ما يصير بالشات" }, 200);
      const last = this.sql.exec("SELECT at FROM chat WHERE name = ? ORDER BY id DESC LIMIT 1", name).toArray()[0];
      if (last && Date.now() - last.at < 6000) return json({ error: "على هونك: رسالة كل ٦ ثواني" }, 200);
      const town = me.plot != null ? this.sql.exec("SELECT town FROM plots WHERE plot = ?", me.plot).toArray()[0]?.town || "" : "";
      this.sql.exec("INSERT INTO chat (name, plot, town, text, at) VALUES (?, ?, ?, ?, ?)", name, me.plot, town, text, Date.now());
      this.sql.exec("DELETE FROM chat WHERE id NOT IN (SELECT id FROM chat ORDER BY id DESC LIMIT 500)");
      const message = this.sql.exec("SELECT id, name, plot, town, text, at FROM chat ORDER BY id DESC LIMIT 1").toArray()[0];
      return json({ ok: true, message });
    }
    if (p[0] === "report") {
      this.sql.exec("INSERT INTO reports (plot, by, reason, at) VALUES (?, ?, ?, ?)", int(body.plot), name, clean(body.reason, 200), Date.now());
      return json({ ok: true });
    }
    return json({ error: "not found" }, 404);
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
