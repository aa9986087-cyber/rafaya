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
//   POST /api/world/handoff { name, secret } → { code } · POST handoff/claim { code } → { name, secret, plot }  (move to the home-screen app)
//   GET  /api/world/push/key · POST push/sub { name, secret, endpoint, keys } · POST push/unsub { endpoint } · GET push/inbox?k=
//        notifications on the phone (encrypted Web Push with VAPID; inbox supports older installations)
//   GET  /api/world/live  (WebSocket)            → hints pushed the moment something changes: chat, war, news, town
//   GET  /api/world/chat?after=ID               → { messages: [...] }  (the public chat, newest 50 or those after ID)
//   POST /api/world/chat     { name, secret, text } → { ok, message }  (one message every 6 s, 200 characters)
//   POST /api/world/feedback { name, secret, text } → { ok } (private to /api/admin/feedback)
//   POST /api/world/war/ACTION { name, secret, ... }   → «صراع الجوف», decided here (see js/warserver.js):
//        state · buy · rel · launch · op · repair · settings · enemy
import { DurableObject } from "cloudflare:workers";
import { WarServer, sqlWarDb } from "../js/warserver.js";
import { fastWar } from "../js/war.js";
import { ERAS, townNameKey } from "../js/data.js";
import { AWAY_CAP, dayOf, joufHours, joufDayStart } from "../js/sim.js";
import { VERSION, REQUIRED } from "../js/version.js";
import { pendingSaveMatches } from "../js/save-version.js";
import { encryptPush, pushKeys } from "./web-push.js";
import { createModeration } from "./moderation.js";
import { REVIEW_ROUTES, verifyReview } from "./review-access.js";
const POP_MARKS = [100, 500, 1000, 2500, 5000, 10000, 20000];

const MAX_SNAPSHOT = 400_000; // characters of the packed town
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const clean = (v, max) => String(v ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const int = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
// The world's clock started here; every town's hour is counted from it (50 seconds an hour).
const WORLD_EPOCH = Date.UTC(2026, 10, 1);
const CITIZEN_AMOUNT = 100, CITIZEN_LIMIT = 1000, CITIZEN_DAYS = 3;
const CITIZEN_TITLE = "حساب المواطن";
const CITIZEN_NOTE = "تم صرف ١٠٠ ريال دعم حساب المواطن في ميزانية مدينتك داخل لعبة الرافعية.";
// Maintenance switch for the world of al-Jouf: while false, every /api/world/* call answers 503
// { error: "maintenance" } and nothing in the world tables is read or changed. Towns stay saved;
// the solo game keeps working. Set back to true to reopen.
const WORLD_OPEN = true; // reopened 2026-11-23 with «صراع الجوف» (owner: «ارفعه ثم تفتح عالم الجوف»)
// The world's generation. Raising it wipes the whole world once (every town, player name, world
// comment and report) and tells every phone to forget its old world town. The solo game is never touched.
//   gen 2 (2026-11-23): the owner wiped the world so everyone starts again.
const WORLD_GEN = 2;
// the owner's reasons for asking a player to change a name (the panel picks them; the player reads the text)
const NAMEFIX_REASONS = {
  person: "ممنوع تكتب اسم شخص حقيقي غير اسمك",
  tribe: "ممنوع تكتب اسم أو رمز عائلة أو فخذ أو قبيلة",
  bad: "الاسم فيه كلام ما يصلح",
  fake: "الاسم يوهم إنه من الإدارة أو المطور"
};
const DEV_NAME = "🛠️ المطور"; // how the owner's messages show in the world's chat
const CHAT_MUTE_MS = 10 * 60 * 1000;
const NAME_RE = /^[\u0600-\u06FFA-Za-z0-9_ ]{3,16}$/;
// The owner's control panel (/admin.html): the owner's code is checked against this hash (the code itself is
// never in the repository). A login makes a token for that phone; tokens are kept hashed.
const ADMIN_CODE_HASH = "54906eee335cadf9ae395da8a17a35b2cd6c6695fded1d995d7174970a08218b";
const BAD = ["كلب", "حمار", "زق", "خرا", "سكس", "شرموط", "قحب", "fuck", "shit", "sex"];
const badText = (t) => BAD.some((w) => t.toLowerCase().includes(w));
async function hash(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const makeSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

export class Board extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS towns (code TEXT PRIMARY KEY, secret TEXT, name TEXT, mayor TEXT, pop INTEGER, happy INTEGER, money INTEGER, era INTEGER, updated INTEGER, snapshot TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, author TEXT, text TEXT, at INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS players (name TEXT PRIMARY KEY, secret TEXT, recovery TEXT, created INTEGER, plot INTEGER)`);
    try { this.sql.exec("ALTER TABLE players ADD COLUMN chat_warned INTEGER NOT NULL DEFAULT 0"); } catch { /* already there */ }
    try { this.sql.exec("ALTER TABLE players ADD COLUMN chat_muted_until INTEGER NOT NULL DEFAULT 0"); } catch { /* already there */ }
    this.sql.exec(`CREATE TABLE IF NOT EXISTS plots (plot INTEGER PRIMARY KEY, owner TEXT, town TEXT, terrain TEXT, pop INTEGER, happy INTEGER, money INTEGER, era INTEGER, updated INTEGER, snapshot TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, plot INTEGER, by TEXT, reason TEXT, at INTEGER)`);
    // the public chat of the world (newest 500 kept); it never says who is online, only who wrote what
    this.sql.exec(`CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, plot INTEGER, town TEXT, text TEXT, at INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, town TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL)`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS feedback_sender ON feedback (name, at DESC)");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
    const configuredModeration = this.sql.exec("SELECT value FROM meta WHERE key = 'private_moderation'").toArray()[0]?.value;
    this.moderation = createModeration(configuredModeration ? JSON.parse(configuredModeration) : {});
    this.sql.exec(`CREATE TABLE IF NOT EXISTS citizen_support (day INTEGER PRIMARY KEY, due INTEGER NOT NULL, closes INTEGER NOT NULL, paid_at INTEGER, recipients INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS citizen_support_push (day INTEGER, plot INTEGER, k TEXT, next_at INTEGER NOT NULL, attempts INTEGER DEFAULT 0, PRIMARY KEY (day, k))`);
    try { this.sql.exec("ALTER TABLE plots ADD COLUMN renamed INTEGER DEFAULT 0"); } catch { /* already there */ }
    try { this.sql.exec("ALTER TABLE plots ADD COLUMN pending TEXT"); } catch { /* already there */ }
    try { this.sql.exec("ALTER TABLE plots ADD COLUMN ledger TEXT"); } catch { /* already there */ } // the town's money moves, as its phone keeps them (the owner's statement)
    try { this.sql.exec("ALTER TABLE players ADD COLUMN banned INTEGER DEFAULT 0"); } catch { /* already there */ } // stopped by the owner
    try { this.sql.exec("ALTER TABLE players ADD COLUMN played INTEGER NOT NULL DEFAULT 0"); } catch { /* already there */ } // seconds with the game open and in front (counted from the live pings)
    try { this.sql.exec("ALTER TABLE plots ADD COLUMN restarted INTEGER DEFAULT 0"); } catch { /* already there */ } // the last fresh start (one a day)
    try { this.sql.exec("ALTER TABLE plots ADD COLUMN save_version TEXT NOT NULL DEFAULT ''"); } catch { /* already there */ }
    try { this.sql.exec("ALTER TABLE players ADD COLUMN ban_reason TEXT"); } catch { /* already there */ }
    this.sql.exec(`CREATE TABLE IF NOT EXISTS admintokens (token TEXT PRIMARY KEY, at INTEGER)`);
    // the owner asks a player to change a name that breaks the rules: player name and/or town (what: "name", "town", "both");
    // not done within a real day, the town is taken off al-Jouf (the request stays until the player changes)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS namefix (name TEXT PRIMARY KEY, what TEXT, reasons TEXT, note TEXT, at INTEGER, due INTEGER, removed INTEGER DEFAULT 0)`);
    this.adminFails = []; // the citizens' unanswered requests (for reminders)
    try { this.sql.exec("ALTER TABLE plots ADD COLUMN reminded INTEGER DEFAULT 0"); } catch { /* already there */ }
    // notifications on the phone (Web Push): who asked for them, and what is waiting to be shown
    // moving an account to another app on the same phone (the iPhone's home-screen app keeps its own storage):
    // a 6-digit code made in the old one gives the new one its own key; both keys work
    // the iPhone's home-screen app keeps its own storage: Safari leaves a copy of the game's saves here (gzip,
    // base64) under a random token; the app takes it once on its first launch. Kept 7 days at most.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS moves (token TEXT PRIMARY KEY, data TEXT, at INTEGER)`);
    // backups: a town (gzip, base64) under a short code like K7PM-2QXA to type on any phone; kept 60 days
    this.sql.exec(`CREATE TABLE IF NOT EXISTS backups (code TEXT PRIMARY KEY, data TEXT, at INTEGER)`);
    this.backupFails = [];
    try { this.sql.exec("ALTER TABLE moves ADD COLUMN code TEXT"); } catch { /* already there */ } // 6 digits to type in the app (24 h)
    this.moveFails = [];
    this.sql.exec(`CREATE TABLE IF NOT EXISTS handoff (code TEXT PRIMARY KEY, name TEXT, at INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS keys (name TEXT, secret TEXT, at INTEGER)`);
    this.handoffFails = [];
    this.sql.exec(`CREATE TABLE IF NOT EXISTS pushsubs (k TEXT PRIMARY KEY, plot INTEGER, endpoint TEXT, created INTEGER, p256dh TEXT, auth TEXT)`);
    try { this.sql.exec("ALTER TABLE pushsubs ADD COLUMN p256dh TEXT"); } catch { /* already there */ }
    try { this.sql.exec("ALTER TABLE pushsubs ADD COLUMN auth TEXT"); } catch { /* already there */ }
    try { this.sql.exec("ALTER TABLE pushsubs ADD COLUMN last_status INTEGER"); } catch { /* already there */ } // the provider's last answer (the owner's panel)
    try { this.sql.exec("ALTER TABLE pushsubs ADD COLUMN last_at INTEGER"); } catch { /* already there */ }
    this.sql.exec("DROP TABLE IF EXISTS pushack"); // the closed-game test is gone
    this.sql.exec(`CREATE TABLE IF NOT EXISTS pushq (id INTEGER PRIMARY KEY AUTOINCREMENT, k TEXT, title TEXT, body TEXT, tag TEXT, at INTEGER)`);
    this.outbox = [];
    // the world's bulletin: new towns, towns growing up, wars, truces, peace and strikes (newest 300 kept)
    // money a town gained while away beyond the cap, taken back (a record, so the owner can see who and how much)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS awayfix (id INTEGER PRIMARY KEY AUTOINCREMENT, plot INTEGER, owner TEXT, town TEXT, before INTEGER, after INTEGER, cap INTEGER, taken INTEGER, at INTEGER)`);
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
      this.sql.exec("DELETE FROM pushsubs"); this.sql.exec("DELETE FROM pushq"); this.sql.exec("DELETE FROM handoff"); this.sql.exec("DELETE FROM keys");
      this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('world_gen', ?)", String(WORLD_GEN));
    }
    this.war = new WarServer(warDb, {
      town: (plot) => this.sql.exec("SELECT plot, owner, town, era, pop, updated, snapshot FROM plots WHERE plot = ?", plot).toArray()[0] || null,
      news: (kind, text, plot) => this.news(kind, text, plot),
      ping: (plot) => this.live({ t: "war" }, plot), // a war note for this town: its game asks for the state now
      notify: (plot, kind, text) => this.push(plot, "⚔️ صراع الجوف", text, `war-${kind}`), // and on the phone, if the game isn't open
      player: (name) => this.sql.exec("SELECT name, plot, created FROM players WHERE name = ?", name).toArray()[0] || null
    }, env?.WAR_TEST === "1" ? { cfg: fastWar(30) } : {}); // WAR_TEST: local testing only (wrangler dev --var WAR_TEST:1), never set on the live site
    this.refundDebtFix();
  }
  /**
   * Once: towns that left in debt were measured from their debt, so the shield clearing it counted as income
   * and was taken back (الصالحية: 5,000 → −2,475). Give back what was taken beyond the right amount.
   */
  refundDebtFix() {
    if (this.sql.exec("SELECT 1 FROM meta WHERE key = 'refund_debtfix_v1'").toArray().length) return;
    for (const r of this.sql.exec("SELECT id, plot, owner, town, before, after, cap, taken FROM awayfix WHERE before < 0 AND taken > 0").toArray()) {
      const right = Math.max(0, r.after - Math.max(0, r.before) - Math.round(r.cap * 1.1)), back = r.taken - right;
      if (back <= 0) continue;
      // shown in the middle of the player's screen (kind "apology"), and kept in their war log
      this.war.fine(r.plot, -back, "refund", `🙏 نعتذر منك: صار خطأ من عندنا ببرمجة اللعبة بحساب خصم الغياب، وانخصم منك ${back.toLocaleString("en-US")} ريال ما كان المفروض ينخصم (درع الغياب سدّد دينك، وهذا مو كسب). رجّعنا لك حقك كامل. السموحة منك.`, "apology", { amount: back });
      this.sql.exec("UPDATE plots SET money = money + ? WHERE plot = ?", back, r.plot);
      this.sql.exec("INSERT INTO awayfix (plot, owner, town, before, after, cap, taken, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", r.plot, r.owner, r.town, r.before, r.after, r.cap, -back, Date.now());
    }
    this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('refund_debtfix_v1', ?)", String(Date.now()));
  }

  // ---------- notifications on the phone ----------
  /** The server's own signing keys (VAPID), made once and kept: nothing to set up by hand. */
  async vapid() {
    if (this.vapidKeys) return this.vapidKeys;
    const row = this.sql.exec("SELECT value FROM meta WHERE key = 'vapid'").toArray()[0];
    let v = row ? JSON.parse(row.value) : null;
    if (!v) {
      const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
      v = { pub: b64url(await crypto.subtle.exportKey("raw", kp.publicKey)), jwk: await crypto.subtle.exportKey("jwk", kp.privateKey) };
      this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('vapid', ?)", JSON.stringify(v));
    }
    v.key = await crypto.subtle.importKey("jwk", v.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    return (this.vapidKeys = v);
  }
  /** Is this town's game open and in front right now (it pinged in the last 50 s)? Then no phone notification. */
  watching(plot) {
    return this.ctx.getWebSockets().some((ws) => { const a = ws.deserializeAttachment(); return a?.plot === plot && Date.now() - (a.seen || 0) < 50000; });
  }
  /** Send a notification to a town's phones (see flush). */
  push(plot, title, body, tag = "jouf", force = false) {
    if (plot == null || (!force && this.watching(plot))) return;
    const subs = this.sql.exec("SELECT k, endpoint, p256dh, auth FROM pushsubs WHERE plot = ?", plot).toArray();
    const message = { title, body: String(body).slice(0, 180), tag };
    for (const sub of subs) this.outbox.push(this.sendPush(sub, message));
    this.sql.exec("DELETE FROM pushq WHERE at < ?", Date.now() - 3600000);
  }
  async sendPush(sub, message, ttl = "3600") {
    const keys = pushKeys(sub);
    // Existing subscriptions acquire encryption keys the next time a player opens the game.
    const queued = keys ? null : this.sql.exec(
      "INSERT INTO pushq (k, title, body, tag, at) VALUES (?, ?, ?, ?, ?) RETURNING id",
      sub.k, message.title, message.body, message.tag, Date.now()
    ).toArray()[0];
    const status = await this.wake(sub, message, keys, ttl);
    if (queued && (status < 200 || status >= 300)) this.sql.exec("DELETE FROM pushq WHERE id = ?", queued.id);
    return status;
  }
  async wake(sub, message, keys, ttl) {
    try {
      const v = await this.vapid(), now = Math.floor(Date.now() / 1000);
      const head = b64url(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
      const body = b64url(new TextEncoder().encode(JSON.stringify({ aud: new URL(sub.endpoint).origin, exp: now + 12 * 3600, sub: "https://rafaya.vamosx.workers.dev" })));
      const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, v.key, new TextEncoder().encode(`${head}.${body}`));
      const headers = { TTL: ttl, Urgency: "high", Authorization: `vapid t=${head}.${body}.${b64url(sig)}, k=${v.pub}` };
      const payload = keys ? await encryptPush(message, keys) : "";
      if (keys) {
        headers["Content-Encoding"] = "aes128gcm";
        headers["Content-Type"] = "application/octet-stream";
      }
      const r = await fetch(sub.endpoint, { method: "POST", body: payload, signal: AbortSignal.timeout(8000), headers }); // (no redirect option set to error: Workers refuse it, and every push failed before leaving)
      if (r.status === 404 || r.status === 410) this.sql.exec("DELETE FROM pushsubs WHERE k = ?", sub.k); // the phone dropped it
      else this.sql.exec("UPDATE pushsubs SET last_status = ?, last_at = ? WHERE k = ?", r.status, Date.now(), sub.k);
      return r.status;
    } catch { try { this.sql.exec("UPDATE pushsubs SET last_status = 0, last_at = ? WHERE k = ?", Date.now(), sub.k); } catch { /* gone */ } return 0; }
  }
  /**
   * The citizens' important requests: a town whose mayor has been away over an hour, with an unanswered
   * complaint or a decision waiting, gets one reminder on the phone (at most every 8 hours).
   */
  remind() {
    const now = Date.now();
    const rows = this.sql.exec("SELECT plot, town, pending, updated, reminded FROM plots WHERE pending IS NOT NULL AND plot IN (SELECT plot FROM pushsubs)").toArray();
    for (const t of rows) {
      let p; try { p = JSON.parse(t.pending); } catch { continue; }
      if (!p || (!(p.n > 0) && !p.decision)) continue;
      const fast = this.env?.WAR_TEST === "1"; // local tests: 10 s away, 30 s between reminders
      if (now - (t.updated || 0) < (fast ? 10000 : 60 * 60000) || now - (t.reminded || 0) < (fast ? 30000 : 8 * 3600000)) continue;
      const body = p.decision ? `قرار ينتظرك: ${p.decision}` : `${p.who ? `${p.who}: ` : ""}«${p.text || "عندنا طلب"}»${p.n > 1 ? ` · و${(p.n - 1).toLocaleString("ar-SA")} طلبات ثانية تنتظر ردك` : ""}`;
      this.push(t.plot, `📰 أهل «${t.town}» يبونك`, body, "citizens");
      this.sql.exec("UPDATE plots SET reminded = ? WHERE plot = ?", now, t.plot);
    }
  }
  async flush() { const out = this.outbox.splice(0); if (out.length) await Promise.allSettled(out); }

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
    if (m.t === "ping") { // the game is open and in front (it only pings while visible)
      const a = ws.deserializeAttachment() || {}, now = Date.now();
      // time played: the gap since the last sign of life, at most 45 s (a ping comes every 30 s while in front)
      if (a.name && a.seen) { const gap = Math.min(45, Math.max(0, Math.round((now - a.seen) / 1000))); if (gap) this.sql.exec("UPDATE players SET played = played + ? WHERE name = ?", gap, a.name); }
      ws.serializeAttachment({ ...a, seen: now });
      try { ws.send('{"t":"pong"}'); } catch { /* gone */ }
      return;
    }
    if (m.t === "hello") { // who this socket belongs to (only so war news reaches the right town)
      const row = this.sql.exec("SELECT secret, plot FROM players WHERE name = ?", clean(m.name, 16)).toArray()[0];
      const ok = await this.keyOk(clean(m.name, 16), row, m.secret);
      ws.serializeAttachment({ plot: ok ? row.plot : null, name: ok ? clean(m.name, 16) : null, seen: Date.now() });
      try { ws.send(JSON.stringify({ t: "hi", ok: !!ok })); } catch { /* gone */ }
    }
  }
  webSocketClose(ws) { try { ws.close(); } catch { /* already */ } }
  webSocketError() { /* the game reconnects by itself */ }
  /** Wake up when the next strike arrives, to settle it then (results and notes go out live). */
  async armWar() {
    const war = this.war.nextArrival(), subs = this.sql.exec("SELECT 1 FROM pushsubs LIMIT 1").toArray().length;
    const due = this.sql.exec("SELECT MIN(due) d FROM namefix WHERE removed = 0").toArray()[0]?.d; // a name request running out
    const support = WORLD_OPEN ? this.sql.exec(`SELECT MIN(at) at FROM (
      SELECT MIN(due) at FROM citizen_support WHERE paid_at IS NULL
      UNION ALL SELECT MIN(next_at) at FROM citizen_support_push
    )`).toArray()[0]?.at : null;
    const next = Math.min(war || Infinity, due || Infinity, support ?? Infinity, subs ? Date.now() + (this.env?.WAR_TEST === "1" ? 5000 : 30 * 60000) : Infinity); // reminders: every half hour while anyone has notifications on
    if (!Number.isFinite(next)) return;
    const cur = await this.ctx.storage.getAlarm();
    if (!cur || cur > next) await this.ctx.storage.setAlarm(Math.max(Date.now() + 50, next + 200));
  }
  /** Start one campaign with the current game day, then the next two shared days at sunrise. */
  startCitizenSupport(clock, now) {
    this.ctx.storage.transactionSync(() => {
      if (this.sql.exec("SELECT 1 FROM citizen_support LIMIT 1").toArray().length) return;
      const first = dayOf(Math.floor(joufHours(now, clock)) + 3);
      for (let i = 0; i < CITIZEN_DAYS; i++) {
        const day = first + i;
        this.sql.exec("INSERT INTO citizen_support (day, due, closes) VALUES (?, ?, ?)",
          day, i === 0 ? now : Math.ceil(joufDayStart(day, clock)), Math.ceil(joufDayStart(day + 1, clock)));
      }
    });
  }
  /** Credit balances, save the player notices and queue phone delivery as one SQLite transaction. */
  payCitizenSupport(now) {
    const payout = this.ctx.storage.transactionSync(() => {
      // A delayed alarm never catches up multiple payments in the same game day.
      this.sql.exec("UPDATE citizen_support SET paid_at = ?, recipients = 0 WHERE paid_at IS NULL AND closes <= ?", now, now);
      const round = this.sql.exec("SELECT day FROM citizen_support WHERE paid_at IS NULL AND due <= ? AND closes > ? ORDER BY day LIMIT 1", now, now).toArray()[0];
      if (!round) return null;
      const plots = this.sql.exec("SELECT plot FROM plots WHERE money < ? ORDER BY plot", CITIZEN_LIMIT).toArray().map((row) => row.plot);
      for (const plot of plots) {
        const account = this.war.acct(plot);
        this.war.charge(plot, account, -CITIZEN_AMOUNT, "citizenSupport");
        this.war.saveAcct(plot, account);
        this.war.note(plot, "citizenSupport", CITIZEN_NOTE, { amount: CITIZEN_AMOUNT, day: round.day }, false);
        this.sql.exec("UPDATE plots SET money = money + ? WHERE plot = ?", CITIZEN_AMOUNT, plot);
        this.sql.exec("INSERT OR IGNORE INTO citizen_support_push (day, plot, k, next_at) SELECT ?, plot, k, ? FROM pushsubs WHERE plot = ?", round.day, now, plot);
      }
      this.sql.exec("UPDATE citizen_support SET paid_at = ?, recipients = ? WHERE day = ?", now, plots.length, round.day);
      this.news("citizenSupport", plots.length
        ? "💰 صُرفت دفعة حساب المواطن اليوم للمدن المستحقة في عالم الجوف."
        : "💰 جرت مراجعة دفعة حساب المواطن اليوم. ما كانت فيه مدن مستحقة.", null, null, false);
      return plots;
    });
    if (!payout) return;
    this.live({ t: "news" });
    const paid = new Set(payout);
    for (const ws of this.ctx.getWebSockets()) if (paid.has(ws.deserializeAttachment()?.plot)) {
      try { ws.send('{"t":"war"}'); } catch { /* the next poll reads the saved credit */ }
    }
  }
  async flushCitizenSupport(now) {
    this.sql.exec(`DELETE FROM citizen_support_push WHERE NOT EXISTS (
      SELECT 1 FROM pushsubs WHERE pushsubs.k = citizen_support_push.k AND pushsubs.plot = citizen_support_push.plot
    )`);
    const rows = this.sql.exec(`SELECT q.day, q.attempts, s.k, s.endpoint, s.p256dh, s.auth
      FROM citizen_support_push q JOIN pushsubs s ON s.k = q.k
      WHERE q.next_at <= ? ORDER BY q.next_at, q.k LIMIT 16`, now).toArray();
    for (const row of rows) this.sql.exec("UPDATE citizen_support_push SET next_at = ?, attempts = attempts + 1 WHERE day = ? AND k = ?", now + 15000, row.day, row.k);
    await Promise.all(rows.map(async (row) => {
      const status = await this.sendPush(row, { title: CITIZEN_TITLE, body: CITIZEN_NOTE, tag: `citizen-support-${row.day}` }, "86400");
      if (row.attempts >= 2 || (status >= 200 && status < 500 && status !== 429)) {
        this.sql.exec("DELETE FROM citizen_support_push WHERE day = ? AND k = ?", row.day, row.k);
      }
    }));
  }
  /** Name requests past their day: the town leaves al-Jouf (the player stays, and must still change the name). */
  namefixSweep() {
    for (const f of this.sql.exec("SELECT name FROM namefix WHERE removed = 0 AND due <= ?", Date.now()).toArray()) {
      const pl = this.sql.exec("SELECT plot FROM players WHERE name = ?", f.name).toArray()[0];
      if (pl?.plot != null) this.removeTown(pl.plot, "ما تغيّر اسمها بالوقت");
      this.sql.exec("UPDATE namefix SET removed = 1 WHERE name = ?", f.name);
    }
  }
  /** Take a town off the map: its land is free again; the player keeps the account and may found a new one. */
  removeTown(plot, why) {
    const t = this.sql.exec("SELECT town FROM plots WHERE plot = ?", plot).toArray()[0];
    this.war.resetTown(plot);
    this.sql.exec("DELETE FROM plots WHERE plot = ?", plot);
    this.sql.exec("UPDATE players SET plot = NULL WHERE plot = ?", plot);
    this.sql.exec("DELETE FROM pushsubs WHERE plot = ?", plot);
    this.sql.exec("DELETE FROM comments WHERE code = ?", `w${plot}`);
    if (t) this.news("removed", `🗑️ «${t.town}» انحذفت من عالم الجوف (${why})`, plot);
    this.live({ t: "town", plot });
  }
  async alarm() {
    try { this.war.settle(); } catch { /* the next request settles it */ }
    if (WORLD_OPEN) {
      const now = Date.now();
      this.payCitizenSupport(now);
      await this.flushCitizenSupport(now);
    }
    try { this.remind(); } catch { /* next time */ }
    try { this.namefixSweep(); } catch { /* next time */ }
    await this.flush();
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
    if (parts[1] === "move") { try { return await this.move(request, parts[2]); } catch (e) { return json({ error: String(e.message || e) }, 500); } }
    if (parts[1] === "admin") { try { const res = await this.admin(request, parts.slice(2)); await this.flush(); return res; } catch (e) { return json({ error: String(e.message || e) }, 500); } }
    try {
      if (parts[1] === "world") { const res = await this.world(request, parts.slice(2)); await this.flush(); if (request.method === "POST") await this.armWar(); return res; }
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
  // ---------- moving the game's saves into the iPhone's home-screen app ----------
  async move(request, action) {
    if (request.method !== "POST") return json({ error: "post" }, 405);
    const body = await request.json().catch(() => ({})), now = Date.now();
    this.sql.exec("DELETE FROM moves WHERE at < ?", now - 7 * 86400000);
    if (action === "put") { // Safari: a fresh copy (the old token, if given, is replaced)
      const data = String(body.data || "");
      if (!data || data.length > 1800000) return json({ error: "كبير" }, 413);
      if (body.old) this.sql.exec("DELETE FROM moves WHERE token = ?", String(body.old).replace(/[^a-f0-9]/g, "").slice(0, 32));
      const token = makeSecret();
      let code; do { code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)); } while (this.sql.exec("SELECT 1 FROM moves WHERE code = ?", code).toArray().length);
      this.sql.exec("INSERT INTO moves (token, data, at, code) VALUES (?, ?, ?, ?)", token, data, now, code);
      return json({ token, code });
    }
    if (action === "backup") { // a short code for this town's copy (the same phone asking again replaces its last one)
      const data = String(body.data || "");
      if (!data || data.length > 1800000) return json({ error: "كبير" }, 413);
      const old = String(body.old || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
      const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L: easy to read and type
      const code = this.ctx.storage.transactionSync(() => {
        this.sql.exec("DELETE FROM backups WHERE at < ?", now - 60 * 86400000);
        let next;
        do { next = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => abc[b % abc.length]).join(""); }
        while (this.sql.exec("SELECT 1 FROM backups WHERE code = ?", next).toArray().length);
        this.sql.exec("INSERT INTO backups (code, data, at) VALUES (?, ?, ?)", next, data, now);
        if (old) this.sql.exec("DELETE FROM backups WHERE code = ?", old);
        return next;
      });
      return json({ code });
    }
    if (action === "restore") { // the copy behind a short code (it stays, so it works again on another phone)
      this.backupFails = this.backupFails.filter((t) => now - t < 60000);
      if (this.backupFails.length > 30) return json({ error: "محاولات كثير، جرّب بعد دقيقة" });
      const code = String(body.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
      const row = code.length === 8 ? this.sql.exec("SELECT data FROM backups WHERE code = ? AND at >= ?", code, now - 60 * 86400000).toArray()[0] : null;
      if (!row) { this.backupFails.push(now); return json({ error: "الكود غلط أو انتهى (يبقى ٦٠ يوم)" }); }
      return json({ data: row.data });
    }
    if (action === "take") { // the home-screen app: the copy, once (by the link's token, or the 6-digit code typed)
      const raw = String(body.token || body.code || ""), byCode = raw.replace(/\D/g, "").length === 6 && raw.length <= 8;
      if (byCode) {
        this.moveFails = this.moveFails.filter((t) => now - t < 60000);
        if (this.moveFails.length > 30) return json({ error: "محاولات كثير، جرّب بعد دقيقة" });
      }
      const row = byCode ? this.sql.exec("SELECT token, data, at FROM moves WHERE code = ?", raw.replace(/\D/g, "")).toArray()[0]
        : this.sql.exec("SELECT token, data, at FROM moves WHERE token = ?", raw.replace(/[^a-f0-9]/g, "").slice(0, 32)).toArray()[0];
      if (!row || (byCode && now - row.at > 86400000)) { if (byCode) this.moveFails.push(now); return json({ error: "gone" }); }
      this.sql.exec("DELETE FROM moves WHERE token = ?", row.token);
      return json({ data: row.data });
    }
    return json({ error: "not found" }, 404);
  }

  // ---------- the owner's control panel ----------
  async admin(request, p) {
    const post = request.method === "POST", body = post ? await request.json().catch(() => ({})) : {};
    const now = Date.now();
    if (post && p[0] === "login") {
      this.adminFails = this.adminFails.filter((t) => now - t < 600000);
      if (this.adminFails.length >= 10) return json({ error: "محاولات كثير، جرّب بعد ١٠ دقايق" }, 429);
      if ((await hash(String(body.code || "").trim().toUpperCase())) !== ADMIN_CODE_HASH) { this.adminFails.push(now); return json({ error: "الرمز غلط" }, 403); }
      const token = makeSecret() + makeSecret();
      this.sql.exec("INSERT INTO admintokens (token, at) VALUES (?, ?)", await hash(token), now);
      return json({ token });
    }
    const tok = request.headers.get("x-admin") || "";
    const one = (q, ...a) => this.sql.exec(q, ...a).toArray()[0];
    const owner = tok && one("SELECT 1 FROM admintokens WHERE token = ?", await hash(tok));
    const reviewKey = this.env?.REVIEW_PUBLIC_KEY;
    if (!owner) {
      if (!request.headers.has("x-rafaya-review-proof")) return json({ error: "سجّل دخول" }, 401);
      if (request.method !== "GET" || p.length !== 1 || !REVIEW_ROUTES.has(p[0])) return json({ error: "وصول المراجعة للقراءة فقط" }, 403);
      const verified = await verifyReview(request, reviewKey, Date.now());
      if (!verified || one("SELECT 1 FROM meta WHERE key = 'review_access_disabled'")) return json({ error: "وصول المراجعة غير متاح" }, 401);
    }
    if (p.length === 1 && p[0] === "review-access") {
      if (request.method === "GET") {
        const configured = !!reviewKey;
        return json({ configured, enabled: configured && !one("SELECT 1 FROM meta WHERE key = 'review_access_disabled'") });
      }
      if (post && body?.action === "enable" && reviewKey) {
        this.sql.exec("DELETE FROM meta WHERE key = 'review_access_disabled'");
        return json({ configured: true, enabled: true });
      }
      if (post && body?.action === "revoke") {
        this.sql.exec("INSERT OR IGNORE INTO meta (key, value) VALUES ('review_access_disabled', '1')");
        return json({ configured: !!reviewKey, enabled: false });
      }
      return json({ error: "وصول المراجعة يحتاج هوية مهيّأة" }, 400);
    }
    if (p[0] === "stats") {
      return json({
        players: one("SELECT COUNT(*) n FROM players").n, towns: one("SELECT COUNT(*) n FROM plots").n,
        newToday: one("SELECT COUNT(*) n FROM players WHERE created > ?", now - 86400000).n,
        activeToday: one("SELECT COUNT(*) n FROM plots WHERE updated > ?", now - 86400000).n,
        chatToday: one("SELECT COUNT(*) n FROM chat WHERE at > ?", now - 86400000).n,
        reports: one("SELECT COUNT(*) n FROM reports").n, banned: one("SELECT COUNT(*) n FROM players WHERE banned = 1").n,
        pushPhones: one("SELECT COUNT(*) n FROM pushsubs").n,
        pushOk: one("SELECT COUNT(*) n FROM pushsubs WHERE last_status BETWEEN 200 AND 299").n,
        pushFail: one("SELECT COUNT(*) n FROM pushsubs WHERE last_status IS NOT NULL AND (last_status < 200 OR last_status > 299)").n,
        biggest: this.sql.exec("SELECT town, owner, pop, era FROM plots ORDER BY pop DESC LIMIT 5").toArray()
      });
    }
    if (p[0] === "reports") {
      if (post && body.clear) { this.sql.exec("DELETE FROM reports WHERE id = ?", int(body.clear)); return json({ ok: true }); }
      return json({ list: this.sql.exec("SELECT r.id, r.plot, r.by, r.reason, r.at, t.town, t.owner FROM reports r LEFT JOIN plots t ON t.plot = r.plot ORDER BY r.id DESC LIMIT 100").toArray() });
    }
    if (p[0] === "chat") {
      if (post && body.del) { this.sql.exec("DELETE FROM chat WHERE id = ?", int(body.del)); this.live({ t: "chatdel", id: int(body.del) }); return json({ ok: true }); }
      return json({ list: this.sql.exec("SELECT id, name, town, text, at FROM chat ORDER BY id DESC LIMIT 100").toArray() });
    }
    if (request.method === "GET" && p[0] === "feedback") {
      const before = int(new URL(request.url).searchParams.get("before"));
      const rows = before > 0
        ? this.sql.exec("SELECT id, name, town, text, at FROM feedback WHERE id < ? ORDER BY id DESC LIMIT 51", before).toArray()
        : this.sql.exec("SELECT id, name, town, text, at FROM feedback ORDER BY id DESC LIMIT 51").toArray();
      const list = rows.slice(0, 50);
      return json({ list, nextBefore: rows.length > 50 ? list[49].id : null });
    }
    if (p[0] === "players") {
      const q = `%${clean(new URL(request.url).searchParams.get("q"), 20)}%`;
      const list = this.sql.exec("SELECT p.name, p.plot, p.created, p.banned, p.ban_reason, t.town, t.pop, t.money, t.era, t.updated FROM players p LEFT JOIN plots t ON t.plot = p.plot WHERE p.name LIKE ? OR t.town LIKE ? ORDER BY t.pop DESC LIMIT 50", q, q).toArray();
      for (const r of list) { // each phone with notifications on: its push service, and the service's last answer (201 = taken)
        r.phones = r.plot == null ? [] : this.sql.exec("SELECT endpoint, created, last_status, last_at, p256dh IS NOT NULL AS keyed FROM pushsubs WHERE plot = ? ORDER BY created DESC", r.plot).toArray()
          .map((x) => { let host = ""; try { host = new URL(x.endpoint).host; } catch { /* blank */ } return { host, created: x.created, status: x.last_status, at: x.last_at, keyed: !!x.keyed }; });
      }
      return json({ list });
    }
    if (post && p[0] === "ban") {
      const nm = clean(body.name, 16);
      if (!one("SELECT 1 x FROM players WHERE name = ?", nm)) return json({ error: "ما لقيت اللاعب" });
      this.sql.exec("UPDATE players SET banned = ?, ban_reason = ? WHERE name = ?", body.on ? 1 : 0, clean(body.reason, 100), nm);
      return json({ ok: true });
    }
    if (!post && p[0] === "gifts") { // the gifts sent, and whether each town's game has taken it yet
      const plots = new Map(this.sql.exec("SELECT plot, town, owner FROM plots").toArray().map((t) => [String(t.plot), t]));
      const rows = this.sql.exec("SELECT id, k1, data FROM war WHERE tbl = 'charge' ORDER BY at DESC LIMIT 500").toArray().map((r) => ({ plot: r.k1, c: JSON.parse(r.data) })).filter((r) => r.c.why === "gift").slice(0, 100);
      return json({ list: rows.map(({ plot, c }) => { const a = this.war.acct(Number(plot)), t = plots.get(String(plot)); return { town: t?.town || "؟", owner: t?.owner || "", amount: -c.amount, at: c.at, arrived: (a.seenSeq || 0) >= c.seq }; }) });
    }
    if (post && p[0] === "gift") {
      const plot = int(body.plot), amount = Math.max(1, Math.min(1000000, int(body.amount)));
      const t = one("SELECT town FROM plots WHERE plot = ?", plot);
      if (!t) return json({ error: "ما لقيت المدينة" });
      const msg = clean(body.text, 120);
      this.war.fine(plot, -amount, "gift", `🎁 هدية من إدارة الجوف: ${amount.toLocaleString("en-US")} ريال${msg ? ` · «${msg}»` : ""}`, "gift", { amount, text: msg });
      this.sql.exec("UPDATE plots SET money = money + ? WHERE plot = ?", amount, plot);
      return json({ ok: true, town: t.town });
    }
    if (post && p[0] === "rename") {
      const plot = int(body.plot), town = clean(body.town, 20), t = one("SELECT town FROM plots WHERE plot = ?", plot);
      if (!t || town.length < 2) return json({ error: "الاسم ما يصلح" });
      if (this.nameTaken(town, plot)) return json({ error: "الاسم مأخوذ" });
      this.sql.exec("UPDATE plots SET town = ? WHERE plot = ?", town, plot);
      this.live({ t: "town", plot });
      return json({ ok: true });
    }
    if (p[0] === "namefix") { // ask a player to change their name and/or town's name, with the reasons; cancel; the list
      if (post && body.cancel) { this.sql.exec("DELETE FROM namefix WHERE name = ?", clean(body.cancel, 16)); return json({ ok: true }); }
      if (post) {
        const nm = clean(body.name, 16), pl = one("SELECT name, plot FROM players WHERE name = ?", nm);
        if (!pl) return json({ error: "ما لقيت اللاعب" });
        const what = ["name", "town", "both"].includes(body.what) ? body.what : "both";
        const reasons = (Array.isArray(body.reasons) ? body.reasons : []).filter((r) => NAMEFIX_REASONS[r]).slice(0, 4);
        const note = clean(body.note, 160);
        if (!reasons.length && !note) return json({ error: "اختر سبب أو اكتب واحد" });
        const hours = this.env?.WAR_TEST === "1" && body.testSeconds ? Number(body.testSeconds) / 3600 : 24;
        this.sql.exec("INSERT OR REPLACE INTO namefix (name, what, reasons, note, at, due, removed) VALUES (?, ?, ?, ?, ?, ?, 0)", nm, what, JSON.stringify(reasons), note, now, now + hours * 3600000);
        if (pl.plot != null) { this.live({ t: "namefix" }, pl.plot); this.push(pl.plot, "✏️ مطلوب تغيير اسم", "الإدارة طلبت منك تغيير الاسم خلال ٢٤ ساعة، ادخل اللعبة وشوف السبب.", "namefix", true); this.ctx.waitUntil(this.flush()); }
        await this.armWar();
        return json({ ok: true });
      }
      return json({ list: this.sql.exec("SELECT f.name, f.what, f.reasons, f.note, f.at, f.due, f.removed, t.town FROM namefix f LEFT JOIN players p ON p.name = f.name LEFT JOIN plots t ON t.plot = p.plot ORDER BY f.at DESC").toArray() });
    }
    if (!post && p[0] === "statement") { // one town's money: its phone's moves, the server's charges and gifts, the away corrections
      const plot = int(new URL(request.url).searchParams.get("plot"));
      const t = one("SELECT plot, town, owner, pop, era, money, updated, ledger FROM plots WHERE plot = ?", plot);
      if (!t) return json({ error: "ما لقيت المدينة" });
      let ledger = null; try { ledger = JSON.parse(t.ledger || "null"); } catch { /* none */ }
      const charges = this.sql.exec("SELECT data FROM war WHERE tbl = 'charge' AND k1 = ? ORDER BY at DESC LIMIT 200", String(plot)).toArray().map((r) => JSON.parse(r.data));
      const away = this.sql.exec("SELECT before, after, cap, taken, at FROM awayfix WHERE plot = ? ORDER BY id DESC LIMIT 50", plot).toArray();
      return json({ town: t.town, owner: t.owner, pop: t.pop, era: t.era, money: t.money, updated: t.updated, ledger, charges, away });
    }
    if (post && p[0] === "say") { // the owner writes in the world's chat, as «المطور»
      const text = clean(body.text, 200);
      if (!text) return json({ error: "اكتب شي" });
      this.sql.exec("INSERT INTO chat (name, plot, town, text, at) VALUES (?, ?, ?, ?, ?)", DEV_NAME, null, "", text, now);
      this.sql.exec("DELETE FROM chat WHERE id NOT IN (SELECT id FROM chat ORDER BY id DESC LIMIT 500)");
      const message = one("SELECT id, name, plot, town, text, at FROM chat ORDER BY id DESC LIMIT 1");
      this.live({ t: "chat", message });
      return json({ ok: true });
    }
    if (post && p[0] === "announce") {
      const text = clean(body.text, 200);
      if (!text) return json({ error: "اكتب الإعلان" });
      this.news("admin", `📢 إعلان من الإدارة: ${text}`);
      this.sql.exec("INSERT INTO chat (name, plot, town, text, at) VALUES (?, ?, ?, ?, ?)", "📢 الإدارة", null, "", text, now);
      const message = one("SELECT id, name, plot, town, text, at FROM chat ORDER BY id DESC LIMIT 1");
      this.live({ t: "chat", message });
      return json({ ok: true });
    }
    return json({ error: "not found" }, 404);
  }
  /** Is this the player's key (the first one, or one given to another app by a move code)? */
  async keyOk(name, row, secret) {
    const h = await hash(String(secret || ""));
    return !!row && (row.secret === h || this.sql.exec("SELECT 1 FROM keys WHERE name = ? AND secret = ?", name, h).toArray().length > 0);
  }
  /** One line in the world's bulletin. With n, a town gets that line once (an era or a population mark). */
  news(kind, text, plot = null, n = null, notify = true) {
    if (n != null && this.sql.exec("SELECT 1 FROM wnews WHERE kind = ? AND plot = ? AND n = ?", kind, plot, n).toArray().length) return;
    this.sql.exec("INSERT INTO wnews (kind, plot, n, text, at) VALUES (?, ?, ?, ?, ?)", kind, plot, n, text, Date.now());
    this.sql.exec("DELETE FROM wnews WHERE id NOT IN (SELECT id FROM wnews ORDER BY id DESC LIMIT 300)");
    if (notify) this.live({ t: "news" });
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
      const clock = { epoch: WORLD_EPOCH, slowAt, fastAt }, now = Date.now();
      this.startCitizenSupport(clock, now);
      if (this.sql.exec("SELECT 1 FROM citizen_support WHERE paid_at IS NULL AND due <= ? LIMIT 1", now).toArray().length) {
        await this.armWar();
        this.payCitizenSupport(Date.now());
      }
      const citizenSupport = this.sql.exec("SELECT day, due, paid_at, recipients FROM citizen_support ORDER BY day")
        .toArray().map(({ day, due, paid_at, recipients }) => ({ day, due, paidAt: paid_at, credited: recipients > 0 }));
      return json({ ...clock, now, gen: WORLD_GEN, citizenSupport, worldVersion: VERSION });
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
    if (!post && p[0] === "manifest") { // the app's manifest, opening at /?link=TOKEN: the home-screen app takes the account over by itself
      const q = new URL(request.url).searchParams, t = String(q.get("t") || "").replace(/[^a-f0-9]/g, "").slice(0, 32), mv = String(q.get("m") || "").replace(/[^a-f0-9]/g, "").slice(0, 32);
      const start = "/" + (t || mv ? "?" + [mv && `move=${mv}`, t && `link=${t}`].filter(Boolean).join("&") : "");
      const m = { name: "الرافعية", short_name: "الرافعية", lang: "ar", dir: "rtl", start_url: start, scope: "/", display: "standalone", orientation: "portrait", background_color: "#2a1d12", theme_color: "#2a1d12",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" }, { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }] };
      return new Response(JSON.stringify(m), { headers: { "content-type": "application/manifest+json", "cache-control": "no-store" } });
    }
    if (!post && p[0] === "push" && p[1] === "key") return json({ key: (await this.vapid()).pub });
    if (!post && p[0] === "push" && p[1] === "inbox") { // the phone's service worker: what to show (by its endpoint's hash)
      const k = String(new URL(request.url).searchParams.get("k") || "").slice(0, 64);
      const items = this.sql.exec("SELECT title, body, tag FROM pushq WHERE k = ? ORDER BY id", k).toArray();
      this.sql.exec("DELETE FROM pushq WHERE k = ?", k);
      return json({ items });
    }
    if (post && p[0] === "push" && p[1] === "unsub") {
      this.sql.exec("DELETE FROM pushsubs WHERE k = ?", await hash(String(body.endpoint || "")));
      return json({ ok: true });
    }
    if (!post && p[0] === "awayfix") { // who had money taken back for gaining too much while away, and how much (newest first)
      const list = this.sql.exec("SELECT owner, town, before, after, cap, taken, at FROM awayfix ORDER BY id DESC LIMIT 200").toArray();
      if (new URL(request.url).searchParams.get("view") !== "page") return json({ list });
      // the same as a page in Arabic, for the owner to read on the phone
      const n = (v) => Number(v).toLocaleString("ar-SA"), esc = (t) => String(t ?? "").replace(/[<>&]/g, "");
      const rows = list.map((r) => {
        const refund = r.taken < 0, wrong = !refund && r.before < 0;
        return `<tr class="${refund ? "back" : wrong ? "bad" : ""}"><td><b>${esc(r.town)}</b><br><small>${esc(r.owner)}</small></td>
          <td>${refund ? `رجّعنا له <b>${n(-r.taken)}</b>` : `انخصم <b>${n(r.taken)}</b>`}</td>
          <td><small>قبل: ${n(r.before)}<br>رجع بـ: ${n(r.after)}<br>الحد: ${n(r.cap)}</small></td>
          <td>${refund ? "✅ رجعت فلوسه" : wrong ? "❌ خصم بالغلط (كان مديون)" : "✔️ خصم صحيح"}</td>
          <td><small>${new Date(r.at).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })}</small></td></tr>`;
      }).join("");
      const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>خصم الغياب</title>
<style>body{font-family:system-ui,sans-serif;background:#fbf3e4;color:#2a1d12;margin:0;padding:16px}h1{font-size:20px}table{width:100%;border-collapse:collapse;font-size:14px}td{padding:8px;border-bottom:1px solid #e5d6bb;vertical-align:top}tr.bad{background:#fde8e4}tr.back{background:#e6f4ec}small{color:#6b5a45}</style></head>
<body><h1>🧾 خصم الكسب وهم برا</h1><p>كل سطر: مدينة انخصم منها لأنها كسبت وصاحبها برا أكثر من الحد، أو رجعت لها فلوس. الأحمر خصم بالغلط، والأخضر الفلوس اللي رجعت.</p>
${list.length ? `<table>${rows}</table>` : "<p>ما فيه أحد للحين.</p>"}</body></html>`;
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    if (!post && p[0] === "online") { // how many towns are being played right now (a number only: never who)
      const plots = new Set();
      for (const ws of this.ctx.getWebSockets()) { const a = ws.deserializeAttachment(); if (a?.plot != null && Date.now() - (a.seen || 0) < 70000) plots.add(a.plot); }
      return json({ n: plots.size });
    }
    if (!post && p[0] === "players") { // every player: when they started and how long they have played (the owner chose to show it to all)
      const list = this.sql.exec("SELECT p.name, p.created, p.played, pl.town FROM players p LEFT JOIN plots pl ON pl.plot = p.plot WHERE COALESCE(p.banned, 0) = 0 ORDER BY p.created LIMIT 3000").toArray();
      return json({ players: list.map((r) => ({ name: r.name, town: r.town || "", started: r.created || 0, played: r.played || 0 })) });
    }
    if (!post && p[0] === "map") {
      const plots = this.sql.exec("SELECT plot, owner, town, terrain, pop, happy, money, era, updated, renamed FROM plots ORDER BY plot LIMIT 3000").toArray();
      return json({ plots });
    }
    if (!post && p[0] === "town" && p[1]) {
      const plot = int(p[1]);
      const town = this.sql.exec("SELECT plot, owner, town, terrain, pop, happy, money, era, updated, snapshot, restarted, save_version AS saveVersion FROM plots WHERE plot = ?", plot).toArray()[0];
      if (!town) return json({ error: "no such town" }, 404);
      const comments = this.sql.exec("SELECT author, text, at FROM comments WHERE code = ? ORDER BY id DESC LIMIT 30", `w${plot}`).toArray();
      return json({ town, comments, damage: this.war.publicDamage(plot) });
    }
    if (post && p[0] === "join") {
      const name = clean(body.name, 16);
      if (!NAME_RE.test(name)) return json({ error: "bad name" }, 400);
      if (badText(name) || this.moderation.blockedName(name)) return json({ error: "اختر لقب مناسب للعبة" }, 422);
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
    if (post && p[0] === "handoff" && p[1] === "claim") { // the new app: a move code → this player, with a key of its own
      const now = Date.now();
      this.handoffFails = this.handoffFails.filter((t) => now - t < 60000);
      if (this.handoffFails.length > 30) return json({ error: "محاولات كثير، جرّب بعد دقيقة" });
      const raw = String(body.code || ""), long = raw.length > 6;
      const code = long ? raw.replace(/[^a-f0-9]/g, "").slice(0, 32) : raw.replace(/\D/g, "").slice(0, 6);
      const row = this.sql.exec("SELECT name, at FROM handoff WHERE code = ?", code).toArray()[0];
      if (!row || now - row.at > (long ? 7 * 86400000 : 86400000)) { this.handoffFails.push(now); return json({ error: "الرمز غلط أو انتهى (صالح ٢٤ ساعة)" }); }
      this.sql.exec("DELETE FROM handoff WHERE code = ?", code);
      const pl = this.sql.exec("SELECT name, plot FROM players WHERE name = ?", row.name).toArray()[0];
      if (!pl) return json({ error: "ما لقيت الحساب" });
      const secret = makeSecret();
      this.sql.exec("INSERT INTO keys (name, secret, at) VALUES (?, ?, ?)", pl.name, await hash(secret), now);
      return json({ name: pl.name, secret, plot: pl.plot });
    }
    // everything below needs the player's own secret
    const name = clean(body.name, 16), me = this.sql.exec("SELECT secret, plot FROM players WHERE name = ?", name).toArray()[0];
    if (!me || !(await this.keyOk(name, me, body.secret))) return json({ error: "who are you" }, 403);
    if (this.sql.exec("SELECT banned FROM players WHERE name = ?", name).toArray()[0]?.banned) return json({ error: "banned" }, 403); // stopped by the owner
    if (post && p[0] === "feedback") {
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) return json({ error: "اكتب ملاحظتك أول" });
      if (text.length > 600) return json({ error: "اختصر الملاحظة إلى ٦٠٠ حرف" });
      const now = Date.now();
      const last = this.sql.exec("SELECT at FROM feedback WHERE name = ? ORDER BY at DESC LIMIT 1", name).toArray()[0];
      if (last && now - last.at < 20000) return json({ error: "انتظر شوي قبل ترسل ملاحظة ثانية" });
      const town = me.plot == null ? "" : this.sql.exec("SELECT town FROM plots WHERE plot = ?", me.plot).toArray()[0]?.town || "";
      this.sql.exec("INSERT INTO feedback (name, town, text, at) VALUES (?, ?, ?, ?)", name, town, text, now);
      return json({ ok: true });
    }
    const fix = this.sql.exec("SELECT what, reasons, note, due, removed FROM namefix WHERE name = ?", name).toArray()[0];
    if (p[0] === "namefix") { // the player changes the names the owner asked for (name and/or town)
      if (!fix) return json({ error: "ما فيه طلب تغيير" });
      const t = me.plot != null ? this.sql.exec("SELECT town FROM plots WHERE plot = ?", me.plot).toArray()[0] : null;
      const wantName = fix.what !== "town", wantTown = fix.what !== "name" && !!t;
      const newName = wantName ? clean(body.newName, 16) : name, newTown = wantTown ? clean(body.newTown, 20) : t?.town;
      if (wantName) {
        if (!NAME_RE.test(newName) || badText(newName) || this.moderation.blockedName(newName)) return json({ error: "اسمك الجديد ما يصلح. اختر لقب مناسب للعبة." });
        if (newName === name) return json({ error: "اكتب اسم غير اسمك القديم" });
        if (this.sql.exec("SELECT 1 FROM players WHERE name = ?", newName).toArray().length) return json({ error: "هالاسم مأخوذ، اختر غيره" });
      }
      if (wantTown) {
        if (newTown.length < 2 || badText(newTown) || this.moderation.blockedName(newTown)) return json({ error: "اختر اسم مناسب لمدينتك" });
        if (townNameKey(newTown) === townNameKey(t.town)) return json({ error: "اكتب اسم مدينة غير القديم" });
        if (this.nameTaken(newTown, me.plot)) return json({ error: "فيه مدينة بالجوف بهالاسم، اختر غيره" });
      }
      if (wantName) {
        this.sql.exec("UPDATE players SET name = ? WHERE name = ?", newName, name);
        for (const [tbl, col] of [["plots", "owner"], ["keys", "name"], ["handoff", "name"], ["chat", "name"], ["feedback", "name"], ["comments", "author"], ["reports", "by"]]) this.sql.exec(`UPDATE ${tbl} SET ${col} = ? WHERE ${col} = ?`, newName, name);
      }
      if (wantTown) {
        this.sql.exec("UPDATE plots SET town = ? WHERE plot = ?", newTown, me.plot);
        this.news("rename", `✏️ «${t.town}» صار اسمها «${newTown}»`, me.plot, 0);
      }
      this.sql.exec("DELETE FROM namefix WHERE name = ?", name);
      if (me.plot != null) this.live({ t: "town", plot: me.plot });
      return json({ ok: true, name: newName, town: newTown || null });
    }
    if (p[0] === "claim" && fix) return json({ error: "غيّر اسمك أول: الإدارة طالبة منك تغييره" });
    if (p[0] === "claim") {
      const plot = int(body.plot), town = clean(body.town, 20) || "هجرة";
      if (me.plot != null) return json({ error: "you have a town", plot: me.plot }, 409);
      if (plot < 0 || plot >= 5000 || badText(town) || this.moderation.blockedName(town)) return json({ error: "bad" }, 400);
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
      const was = this.sql.exec("SELECT town, owner, pop, era, money, updated, restarted, length(snapshot) > 0 AS hasSave, save_version AS saveVersion FROM plots WHERE plot = ?", me.plot).toArray()[0];
      if (!was) return json({ error: "no town" }, 400);
      // a copy of the town from before its fresh start (another phone): refused; that phone takes the new town
      if (was.restarted && int(body.restartAt) < was.restarted) return json({
        ok: false, restarted: was.restarted, town: was.town, hasSave: !!was.hasSave, saveVersion: was.saveVersion
      });
      const write = body.saveWrite;
      const tracked = typeof write === "string" && /^[a-f0-9-]{36}$/.test(write);
      const conflict = () => json({ ok: false, conflict: true, error: "فيه حفظ أحدث لمدينتك على السيرفر." });
      if (tracked) {
        if (!snapshot) return json({ error: "missing snapshot" }, 400);
        // A close or lost response may leave the phone with a write it sent but could not confirm.
        if (was.saveVersion === write) return json({ ok: true, town: was.town, saveVersion: write });
        if (body.saveVersion !== was.saveVersion && !pendingSaveMatches(was.saveVersion, body.pendingWrites)) return conflict();
      } else if (was.saveVersion && !was.saveVersion.startsWith("legacy-")) {
        return conflict(); // an installed app with old code must update before it can write again
      }
      const saveVersion = tracked ? write : "legacy-" + crypto.randomUUID();
      // back after a while away: a town gains at most AWAY_CAP for its stage while its mayor is out (old
      // games on phones without the cap too). Only what is above the cap is taken back; the money it had
      // when it left (the last sync before) is never touched. A little room is left for the minutes played since.
      const awayMs = this.env?.WAR_TEST === "1" ? 10000 : 10 * 60000; // local tests: 10 s
      // (a town that left in debt is measured from zero: the away shield clears debts, and that is not income)
      const base = Math.max(0, was?.money || 0);
      if (was && was.updated && Date.now() - was.updated > awayMs && int(body.money) > base) {
        const cap = AWAY_CAP[Math.min(AWAY_CAP.length - 1, Math.max(was.era || 0, int(body.era)))] ?? AWAY_CAP[0];
        const taken = int(body.money) - base - Math.round(cap * 1.1);
        if (taken > 0) {
          this.war.fine(me.plot, taken, "away cap", `🧾 تصحيح: مدينتك كسبت وانت برا أكثر من الحد (${cap.toLocaleString("en-US")} ريال لـ${ERAS[was.era || 0]?.name || "مدينتك"}). رجّعنا الزيادة بس (${taken.toLocaleString("en-US")} ريال)، وفلوسك اللي كانت قبل ما انلمست.`);
          this.sql.exec("INSERT INTO awayfix (plot, owner, town, before, after, cap, taken, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", me.plot, was.owner, was.town, was.money || 0, int(body.money), cap, taken, Date.now());
          body.money = int(body.money) - taken;
          this.live({ t: "war" }, me.plot);
        }
      }
      if (was) {
        const era = int(body.era), pop = int(body.pop);
        if (era > (was.era || 0) && ERAS[era]) this.news("era", `🏙️ «${was.town}» صارت ${ERAS[era].name}!`, me.plot, era);
        const mark = POP_MARKS.filter((m) => pop >= m && (was.pop || 0) < m).pop();
        if (mark) this.news("pop", `👨‍👩‍👧 «${was.town}» وصل عدد سكانها ${mark.toLocaleString("en-US")}`, me.plot, mark);
      }
      // A sync from a phone that hasn't read the credit yet must keep it in the town's server balance.
      let seen = body.warSeq;
      if (!Number.isSafeInteger(seen)) {
        try { seen = int(JSON.parse(snapshot || "{}").war?.seq); } catch { seen = 0; }
      }
      const support = this.sql.exec(`SELECT COALESCE(-SUM(json_extract(data, '$.amount')), 0) total FROM war
        WHERE tbl = 'charge' AND k1 = ? AND json_extract(data, '$.why') = 'citizenSupport' AND json_extract(data, '$.seq') > ?`,
        String(me.plot), Math.max(0, seen)).toArray()[0].total;
      this.sql.exec("UPDATE plots SET pop = ?, happy = ?, money = ?, era = ?, updated = ?, snapshot = CASE WHEN ? = '' THEN snapshot ELSE ? END, save_version = ? WHERE plot = ?",
        int(body.pop), int(body.happy), int(body.money) + support, int(body.era), Date.now(), snapshot, snapshot, saveVersion, me.plot);
      if (body.pending && typeof body.pending === "object") { const pj = JSON.stringify({ n: int(body.pending.n), who: clean(body.pending.who, 30), text: clean(body.pending.text, 140), decision: clean(body.pending.decision, 60) }); this.sql.exec("UPDATE plots SET pending = ? WHERE plot = ?", pj, me.plot); }
      if (body.ledger && typeof body.ledger === "object") { const lj = JSON.stringify(body.ledger); if (lj.length < 40000) this.sql.exec("UPDATE plots SET ledger = ? WHERE plot = ?", lj, me.plot); }
      if (snapshot) this.live({ t: "town", plot: me.plot }); // its look changed: open maps and visitors refresh
      return json({ ok: true, town: was.town, saveVersion });
    }
    if (p[0] === "restart") { // the mayor starts the town again from nothing, on the same land with the same name (once a day)
      if (me.plot == null) return json({ error: "ما عندك مدينة" });
      const t = this.sql.exec("SELECT town, restarted, save_version AS saveVersion FROM plots WHERE plot = ?", me.plot).toArray()[0];
      if (!t) return json({ error: "ما عندك مدينة" });
      const wait = (t?.restarted || 0) + 86400000 - Date.now();
      if (wait > 0) return json({ error: `بدأت من جديد قريب: تقدر مرة ثانية بعد ${Math.ceil(wait / 3600000)} ساعة` });
      this.war.resetTown(me.plot);
      const saveVersion = t.saveVersion && !t.saveVersion.startsWith("legacy-") ? crypto.randomUUID() : "";
      const at = Date.now();
      this.sql.exec("UPDATE plots SET pop = 9, happy = 55, money = 0, era = 0, snapshot = '', save_version = ?, pending = NULL, reminded = 0, restarted = ?, updated = ? WHERE plot = ?", saveVersion, at, at, me.plot);
      this.news("restart", `🔄 «${t.town}» بدأت من جديد. الله يوفقهم`, me.plot);
      this.live({ t: "town", plot: me.plot });
      return json({ ok: true, restarted: at, saveVersion });
    }
    if (p[0] === "handoff") { // a move for this account: a long token for the home-screen link (7 days) and a 6-digit code to type (24 hours); each works once
      const now = Date.now();
      this.sql.exec("DELETE FROM handoff WHERE name = ? OR (length(code) = 6 AND at < ?) OR at < ?", name, now - 86400000, now - 7 * 86400000);
      let code; do { code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)); } while (this.sql.exec("SELECT 1 FROM handoff WHERE code = ?", code).toArray().length);
      const token = makeSecret();
      this.sql.exec("INSERT INTO handoff (code, name, at) VALUES (?, ?, ?)", code, name, now);
      this.sql.exec("INSERT INTO handoff (code, name, at) VALUES (?, ?, ?)", token, name, now);
      return json({ code, token });
    }
    if (p[0] === "push" && p[1] === "test") {
      if (me.plot == null) return json({ error: "no town" }, 400);
      const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
      const subs = endpoint
        ? this.sql.exec("SELECT k, endpoint, p256dh, auth FROM pushsubs WHERE plot = ? AND k = ?", me.plot, await hash(endpoint)).toArray()
        : this.sql.exec("SELECT k, endpoint, p256dh, auth FROM pushsubs WHERE plot = ?", me.plot).toArray();
      if (!subs.length) return json({ error: "ما فيه اشتراك مسجّل لهالجهاز. فعّل التنبيهات أول." });
      const receipt = typeof body.receipt === "string" && /^[a-f0-9-]{36}$/.test(body.receipt) ? body.receipt : undefined;
      const message = { title: "🔔 تجربة التنبيهات", body: "وصلتك تجربة التنبيه من عالم الجوف.", tag: receipt ? `test-${receipt}` : "test", receipt };
      const statuses = await Promise.all(subs.map((sub) => this.sendPush(sub, message, "60")));
      const phones = statuses.filter((status) => status >= 200 && status < 300).length;
      if (phones) return json({ ok: true, phones });
      const expired = !!endpoint && statuses.some((status) => status === 404 || status === 410);
      const code = statuses.find((st) => st && (st < 200 || st >= 300)) ?? 0;
      return json({ expired, error: expired ? "اشتراك هالجهاز انتهى." : `مزوّد الإشعارات ما قبل التجربة (الرد: ${code || "ما وصل"}). جرّب بعد شوي، ولو تكرر أرسل الرقم للمطور.` });
    }
    if (p[0] === "push" && p[1] === "sub") { // this phone wants notifications for the player's town
      const endpoint = String(body.endpoint || "");
      const okUrl = /^https:\/\//.test(endpoint) || (this.env?.WAR_TEST === "1" && /^http:\/\/localhost/.test(endpoint)); // local tests: a fake push service
      if (!okUrl || endpoint.length > 1000 || me.plot == null) return json({ error: "bad" }, 400);
      if (body.keys != null && !pushKeys(body.keys)) return json({ error: "subscription keys" }, 400);
      this.sql.exec(`INSERT INTO pushsubs (k, plot, endpoint, created, p256dh, auth) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(k) DO UPDATE SET plot = excluded.plot,
        p256dh = COALESCE(excluded.p256dh, pushsubs.p256dh), auth = COALESCE(excluded.auth, pushsubs.auth)`,
      await hash(endpoint), me.plot, endpoint, Date.now(), body.keys?.p256dh ?? null, body.keys?.auth ?? null);
      return json({ ok: true });
    }
    if (p[0] === "rename") {
      // the mayor may rename the town once
      if (me.plot == null) return json({ error: "no town" }, 400);
      const row = this.sql.exec("SELECT town, renamed FROM plots WHERE plot = ?", me.plot).toArray()[0];
      const town = clean(body.town, 20);
      if (!row) return json({ error: "no town" }, 400);
      if (row.renamed) return json({ error: "غيّرت الاسم قبل، ما يتغير مرة ثانية" }, 200);
      if (town.length < 2 || badText(town) || this.moderation.blockedName(town)) return json({ error: "اختر اسم مناسب لمدينتك" }, 200);
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
      if (p[1] === "state") { // what the owner asks of this player, and whether the town is still on the map
        if (fix) res.namefix = { what: fix.what, reasons: JSON.parse(fix.reasons || "[]").map((r) => NAMEFIX_REASONS[r]).filter(Boolean), note: fix.note || "", due: fix.due, removed: !!fix.removed };
        if (me.plot == null) res.noTown = true;
      }
      return json(res, res.error === "not found" ? 404 : 200); // a refusal comes back as { error: "why, in Arabic" }
    }
    if (p[0] === "chat") {
      const text = clean(body.text, 200);
      if (!text) return json({ error: "اكتب شي" }, 200);
      const now = Date.now();
      const { chat_warned, chat_muted_until } = this.sql.exec("SELECT chat_warned, chat_muted_until FROM players WHERE name = ?", name).toArray()[0];
      if (chat_muted_until > now) {
        const minutes = Math.ceil((chat_muted_until - now) / 60000).toLocaleString("ar-SA");
        return json({ error: `الشات موقوف عندك مؤقتًا. باقي ${minutes} د.` });
      }
      if (this.moderation.blockedChat(text) || badText(text)) {
        if (chat_warned) {
          this.sql.exec("UPDATE players SET chat_warned = 0, chat_muted_until = ? WHERE name = ?", now + CHAT_MUTE_MS, name);
          return json({ error: "تكرر الكلام الممنوع. تم كتمك في الشات لمدة ١٠ دقائق." });
        }
        this.sql.exec("UPDATE players SET chat_warned = 1, chat_muted_until = 0 WHERE name = ?", name);
        return json({ error: "تنبيه: رسالتك فيها اسم أو كلام ممنوع. التكرار يوقف إرسال الشات ١٠ دقائق." });
      }
      const last = this.sql.exec("SELECT at FROM chat WHERE name = ? ORDER BY id DESC LIMIT 1", name).toArray()[0];
      if (last && now - last.at < 6000) return json({ error: "على هونك: رسالة كل ٦ ثواني" }, 200);
      const town = me.plot != null ? this.sql.exec("SELECT town FROM plots WHERE plot = ?", me.plot).toArray()[0]?.town || "" : "";
      this.sql.exec("INSERT INTO chat (name, plot, town, text, at) VALUES (?, ?, ?, ?, ?)", name, me.plot, town, text, now);
      this.sql.exec("DELETE FROM chat WHERE id NOT IN (SELECT id FROM chat ORDER BY id DESC LIMIT 500)");
      const message = this.sql.exec("SELECT id, name, plot, town, text, at FROM chat ORDER BY id DESC LIMIT 1").toArray()[0];
      this.live({ t: "chat", message });
      // someone named you or your town: a notification on your phone
      const low = text.toLowerCase();
      for (const t of this.sql.exec("SELECT plot, owner, town FROM plots").toArray()) {
        if (t.plot === me.plot) continue;
        if ((t.town && t.town.length >= 3 && low.includes(t.town.toLowerCase())) || (t.owner && t.owner.length >= 3 && low.includes(t.owner.toLowerCase()))) this.push(t.plot, "💬 شات الجوف", `${name}: ${text}`, "chat");
      }
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
    if (url.pathname === "/api/version") return new Response(JSON.stringify({ version: REQUIRED ?? VERSION, latest: VERSION }), { headers: { "content-type": "application/json", "cache-control": "no-store" } }); // the game checks it: an old copy must update
    if (url.pathname.startsWith("/api/")) {
      const board = env.BOARD.get(env.BOARD.idFromName("rafaya"));
      return board.fetch(request);
    }
    const response = await env.ASSETS.fetch(request);
    if (url.pathname === "/" || ["/index.html", "/sw.js", "/manifest.webmanifest"].includes(url.pathname)) {
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-cache, must-revalidate");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    return response;
  }
};
