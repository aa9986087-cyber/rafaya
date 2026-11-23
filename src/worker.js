// الرافعية online: the game's files (static assets) plus the API of the world of al-Jouf.
// Everything is kept in one Durable Object with SQLite storage.
// (The old solo «مدن الربع» API — /api/publish, /api/board, /api/town — was removed on 2026-11-23
// at the owner's request; its "towns" table is left in place, unused.)
//
// The world of al-Jouf (one shared map; every player has a name and one plot with their town):
//   GET  /api/world/clock                       → { epoch, now, gen, slowAt }   (the world's shared time: 50 s an hour, but 75 s between slowAt and fastAt)
//   POST /api/world/join     { name }           → { name, secret, recovery }
//   POST /api/world/recover  { name, recovery } → { name, secret }
//   GET  /api/world/map                         → { plots: [...] }  (every claimed plot, no snapshots)
//   POST /api/world/claim    { name, secret, plot, town, terrain } → { ok }
//   POST /api/world/rename   { name, secret, town } → { ok, town } | { error }  (once per town; names are unique in al-Jouf)
//   POST /api/world/sync     { name, secret, pop, happy, money, era, snapshot } → { ok }
//   GET  /api/world/town/PLOT                   → { town, comments }
//   POST /api/world/town/PLOT/comment { name, secret, text } → { ok }
//   POST /api/world/report   { name, secret, plot, reason } → { ok }
//   GET  /api/world/live  (WebSocket)            → hints pushed the moment something changes: chat, war, news, town
//   GET  /api/world/chat?after=ID               → { messages: [...] }  (the public chat, newest 50 or those after ID)
//   POST /api/world/chat     { name, secret, text } → { ok, message }  (one message every 6 s, 200 characters)
//   POST /api/world/war/ACTION { name, secret, ... }   → «صراع الجوف», decided here (see js/warserver.js):
//        state · buy · rel · launch · op · repair · settings · enemy
import { DurableObject } from "cloudflare:workers";
import { WarServer, sqlWarDb } from "../js/warserver.js";
import { fastWar } from "../js/war.js";
import { ERAS, townNameKey } from "../js/data.js";
const POP_MARKS = [100, 500, 1000, 2500, 5000, 10000, 20000];

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
    try { this.sql.exec("ALTER TABLE plots ADD COLUMN renamed INTEGER DEFAULT 0"); } catch { /* already there */ }
    // the world's bulletin: new towns, towns growing up, wars, truces, peace and strikes (newest 300 kept)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS wnews (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, plot INTEGER, n INTEGER, text TEXT, at INTEGER)`);
    const warDb = sqlWarDb(this.sql); // creates the war table (new, nothing old is touched)
    const gen = Number(this.sql.exec("SELECT value FROM meta WHERE key = 'world_gen'").toArray()[0]?.value || 1);
    if (gen < WORLD_GEN) {
      this.sql.exec("DELETE FROM plots");
      this.sql.exec("DELETE FROM players");
      this.sql.exec("DELETE FROM reports");
      this.sql.exec("DELETE FROM comments WHERE code GLOB 'w[0-9]*'"); // world towns' comments are "w<plot>"; GLOB is case-sensitive, so the old 6-letter codes stay
      this.sql.exec("DELETE FROM war");
      this.sql.exec("DELETE FROM chat");
      this.sql.exec("DELETE FROM wnews");
      this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('world_gen', ?)", String(WORLD_GEN));
    }
    this.war = new WarServer(warDb, {
      town: (plot) => this.sql.exec("SELECT plot, owner, town, era, pop, updated, snapshot FROM plots WHERE plot = ?", plot).toArray()[0] || null,
      news: (kind, text, plot) => this.news(kind, text, plot),
      ping: (plot) => this.live({ t: "war" }, plot), // a war note for this town: its game asks for the state now
      player: (name) => this.sql.exec("SELECT name, plot, created FROM players WHERE name = ?", name).toArray()[0] || null
    }, env?.WAR_TEST === "1" ? { cfg: fastWar(30) } : {}); // WAR_TEST: local testing only (wrangler dev --var WAR_TEST:1), never set on the live site
  }

  // ---------- live: one socket per open game, so news reaches everyone the moment it happens ----------
  // The server pushes small hints ({ t: "chat", message } / { t: "war" } / { t: "news" } / { t: "town", plot });
  // the game then asks the usual routes. Nobody can see who is connected (never shown, never sent).
  liveSocket(request) {
    if (request.headers.get("Upgrade") !== "websocket") return json({ error: "websocket only" }, 426);
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  async webSocketMessage(ws, msg) {
    let m; try { m = JSON.parse(String(msg)); } catch { return; }
    if (m.t === "ping") { try { ws.send('{"t":"pong"}'); } catch { /* gone */ } return; }
    if (m.t === "hello") { // who this socket belongs to (only so war news reaches the right town)
      const row = this.sql.exec("SELECT secret, plot FROM players WHERE name = ?", clean(m.name, 16)).toArray()[0];
      const ok = row && row.secret === (await hash(String(m.secret || "")));
      ws.serializeAttachment({ plot: ok ? row.plot : null });
      try { ws.send(JSON.stringify({ t: "hi", ok: !!ok })); } catch { /* gone */ }
    }
  }
  webSocketClose(ws) { try { ws.close(); } catch { /* already */ } }
  webSocketError() { /* the game reconnects by itself */ }
  /** Wake up when the next strike arrives, to settle it then (results and notes go out live). */
  async armWar() {
    const next = this.war.nextArrival();
    if (!next) return;
    const cur = await this.ctx.storage.getAlarm();
    if (!cur || cur > next) await this.ctx.storage.setAlarm(Math.max(Date.now() + 50, next + 200));
  }
  async alarm() {
    try { this.war.settle(); } catch { /* the next request settles it */ }
    await this.armWar();
  }
  /** Tell every open game (or only the town at plot) that something changed. */
  live(msg, plot = null) {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (plot != null && ws.deserializeAttachment()?.plot !== plot) continue;
      try { ws.send(text); } catch { /* closing */ }
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
    if (parts[1] === "world" && parts[2] === "live" && (WORLD_OPEN || this.env?.WAR_TEST === "1")) return this.liveSocket(request);
    try {
      if (parts[1] === "world") return this.world(request, parts.slice(2));
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: "bad request" }, 400);
    }
  }

  /** Is this town name already used in al-Jouf (by another plot)? */
  nameTaken(town, plot = -1) {
    const key = townNameKey(town);
    return this.sql.exec("SELECT plot, town FROM plots").toArray().some((t) => t.plot !== plot && townNameKey(t.town) === key);
  }
  /** One line in the world's bulletin. With n, a town gets that line once (an era or a population mark). */
  news(kind, text, plot = null, n = null) {
    if (n != null && this.sql.exec("SELECT 1 FROM wnews WHERE kind = ? AND plot = ? AND n = ?", kind, plot, n).toArray().length) return;
    this.sql.exec("INSERT INTO wnews (kind, plot, n, text, at) VALUES (?, ?, ?, ?, ?)", kind, plot, n, text, Date.now());
    this.sql.exec("DELETE FROM wnews WHERE id NOT IN (SELECT id FROM wnews ORDER BY id DESC LIMIT 300)");
    this.live({ t: "news" });
  }

  // ---------- the world of al-Jouf ----------
  async world(request, p) {
    if (!WORLD_OPEN && this.env?.WAR_TEST !== "1") return json({ error: "maintenance" }, 503); // local tests may open it
    const post = request.method === "POST", body = post ? await request.json() : {};
    if (!post && p[0] === "clock") {
      // the day went from 20 to 30 minutes: hours before slowAt were 50 s, after it 75 s (set once, the first time this code runs)
      // and back to 20 minutes at fastAt (set once too): 75 s hours only between the two
      const meta = (k) => Number(this.sql.exec("SELECT value FROM meta WHERE key = ?", k).toArray()[0]?.value || 0);
      const setMeta = (k, v) => this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", k, String(v));
      let slowAt = meta("slow_at"), fastAt = meta("fast_at");
      if (!slowAt) { slowAt = Date.now(); setMeta("slow_at", slowAt); }
      if (!fastAt) { fastAt = Date.now(); setMeta("fast_at", fastAt); }
      return json({ epoch: WORLD_EPOCH, now: Date.now(), gen: WORLD_GEN, slowAt, fastAt });
    }
    if (!post && p[0] === "chat") {
      const after = int(new URL(request.url).searchParams.get("after"));
      const messages = after > 0
        ? this.sql.exec("SELECT id, name, plot, town, text, at FROM chat WHERE id > ? ORDER BY id ASC LIMIT 100", after).toArray()
        : this.sql.exec("SELECT id, name, plot, town, text, at FROM chat ORDER BY id DESC LIMIT 50", ).toArray().reverse();
      return json({ messages, now: Date.now() });
    }
    if (!post && p[0] === "news") {
      const after = int(new URL(request.url).searchParams.get("after"));
      const items = this.sql.exec("SELECT id, kind, plot, text, at FROM wnews WHERE id > ? ORDER BY id DESC LIMIT 60", after).toArray();
      return json({ items, now: Date.now() });
    }
    if (!post && p[0] === "map") {
      const plots = this.sql.exec("SELECT plot, owner, town, terrain, pop, happy, money, era, updated, renamed FROM plots ORDER BY plot LIMIT 3000").toArray();
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
      if (this.nameTaken(town)) return json({ error: "name taken" }, 422); // every town in al-Jouf has its own name
      this.sql.exec("INSERT INTO plots (plot, owner, town, terrain, pop, happy, money, era, updated, snapshot) VALUES (?, ?, ?, ?, 9, 55, 0, 0, ?, '')", plot, name, town, clean(body.terrain, 12), Date.now());
      this.sql.exec("UPDATE players SET plot = ? WHERE name = ?", plot, name);
      this.news("town", `🏕️ تأسست «${town}» بأرض الجوف. حيّاهم الله`, plot, 0);
      return json({ ok: true, plot });
    }
    if (p[0] === "sync") {
      if (me.plot == null) return json({ error: "no town" }, 400);
      const snapshot = String(body.snapshot || "");
      if (snapshot.length > MAX_SNAPSHOT) return json({ error: "snapshot too big" }, 413);
      const was = this.sql.exec("SELECT town, pop, era FROM plots WHERE plot = ?", me.plot).toArray()[0];
      if (was) {
        const era = int(body.era), pop = int(body.pop);
        if (era > (was.era || 0) && ERAS[era]) this.news("era", `🏙️ «${was.town}» صارت ${ERAS[era].name}!`, me.plot, era);
        const mark = POP_MARKS.filter((m) => pop >= m && (was.pop || 0) < m).pop();
        if (mark) this.news("pop", `👨‍👩‍👧 «${was.town}» وصل عدد سكانها ${mark.toLocaleString("en-US")}`, me.plot, mark);
      }
      this.sql.exec("UPDATE plots SET pop = ?, happy = ?, money = ?, era = ?, updated = ?, snapshot = CASE WHEN ? = '' THEN snapshot ELSE ? END WHERE plot = ?",
        int(body.pop), int(body.happy), int(body.money), int(body.era), Date.now(), snapshot, snapshot, me.plot);
      if (snapshot) this.live({ t: "town", plot: me.plot }); // its look changed: open maps and visitors refresh
      return json({ ok: true, town: was?.town });
    }
    if (p[0] === "rename") {
      // the mayor may rename the town once
      if (me.plot == null) return json({ error: "no town" }, 400);
      const row = this.sql.exec("SELECT town, renamed FROM plots WHERE plot = ?", me.plot).toArray()[0];
      const town = clean(body.town, 20);
      if (!row) return json({ error: "no town" }, 400);
      if (row.renamed) return json({ error: "غيّرت الاسم قبل، ما يتغير مرة ثانية" }, 200);
      if (town.length < 2 || badText(town)) return json({ error: "الاسم ما يصلح" }, 200);
      if (townNameKey(town) === townNameKey(row.town)) return json({ error: "هذا نفس الاسم" }, 200);
      if (this.nameTaken(town, me.plot)) return json({ error: "الاسم مأخوذ لمدينة ثانية بالجوف، اختر غيره" }, 200);
      this.sql.exec("UPDATE plots SET town = ?, renamed = 1 WHERE plot = ?", town, me.plot);
      this.news("rename", `✏️ «${row.town}» صار اسمها «${town}»`, me.plot, 0);
      this.live({ t: "town", plot: me.plot });
      return json({ ok: true, town });
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
      await this.armWar(); // the next strike lands on time, even if nobody asks
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
      this.live({ t: "chat", message });
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
