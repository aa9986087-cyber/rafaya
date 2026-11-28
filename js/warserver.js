// The war server: every military action of «صراع الجوف» is checked and decided here, never in a
// player's browser. It runs inside the Durable Object of src/worker.js (with SQLite) and, for the trial
// copy only, inside js/preview.js (in memory). Storage is a small table interface:
//   db.get(tbl, id) → row | null      db.put(tbl, id, row, { k1, k2, at })      db.del(tbl, id)
//   db.list(tbl, { k1?, k2?, either?, upTo?, since?, limit? }) → rows, newest first (by at)
// world: { town(plot) → { plot, owner, town, era, pop, updated, snapshot } | null, player(name) → { name, plot, created } | null }
//
// Tables: acct (one per town: arsenal, reloads, charge counter, deputy settings), charge (money the town
// owes for war: the game takes each one off its budget once, by seq), rel (two towns), op (an attack),
// fly (attacks still in the air, by arrival), dmg (war damage on one building), hit (landed hits, for the
// caps), note (a town's military notifications), req (answers to requests already done: a request sent
// twice is answered twice the same, never done twice).
import { B, ERAS } from "./data.js";
import {
  WAR, WEAPONS, WEAPON_IDS, TARGETS, canTarget, milProfile, capacity, weaponBlocker, interceptChance, detects, flightMs,
  hitDamage, repairCostOf, repairMsOf, isHeavy, kindSum, rubbleCostOf, rubbleMsOf, relNow, relActions, conflictBlocker, minutesText, snapBuildings, milStat, THREATS, REL_NAMES, damageState,
  MOSQUES, blastArea, shieldPrice, tributeMax, casualties, economic, SPOILS, MEDALS
} from "./war.js";
import { CASTLE_ON, TROOPS, TROOP_IDS, CASTLE, troopCount, troopClean, barracksCap, trainFactor, finishTraining, castleBattle } from "./castle.js";

const SALVO_MAX = 6; // targets in one «دفعة»
const pairId = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
let noteN = 0; // keeps two notes of the same millisecond apart (never uses the dice: results must not depend on it)
const cleanReq = (v) => String(v ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
const nf = (n) => String(Math.round(n).toLocaleString("en-US")).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);

export class WarServer {
  constructor(db, world, { now = () => Date.now(), rand = Math.random, cfg = WAR } = {}) {
    this.db = db; this.world = world; this.now = now; this.rand = rand; this.cfg = cfg;
  }

  // ---------- small helpers ----------
  acct(plot) {
    const a = this.db.get("acct", String(plot)) || {};
    a.arsenal ||= {}; for (const k of [...WEAPON_IDS, "intc"]) a.arsenal[k] ||= 0;
    a.reload ||= {}; a.seq ||= 0; a.spent ||= { day: 0, amt: 0 };
    a.settings ||= { repair: true, refill: true, budget: this.cfg.autoBudget };
    return a;
  }
  saveAcct(plot, a) { a.plot = Number(plot); this.db.put("acct", String(plot), a, { k1: String(plot), at: this.now() }); }
  /** The war's counts of a town (for the medals): successful strikes, strikes on defences, interceptions, victories. */
  stat(a, k, n = 1) { a.stats ||= { hits: 0, defHits: 0, intc: 0, wins: 0 }; a.stats[k] = (a.stats[k] || 0) + n; }
  /** Every town's medals: { plot: [{ icon, name, text }] } (kept a minute: everyone's state shows them). */
  medals() {
    const now = this.now();
    if (this.medalCache && now - this.medalCache.at < 60000) return this.medalCache.map;
    const rows = this.db.list("acct", {}).filter((a) => a.plot != null && a.stats), map = {};
    for (const m of MEDALS) {
      const top = rows.reduce((best, a) => ((a.stats[m.id] || 0) > (best?.stats[m.id] || 0) ? a : best), null);
      if (top && (top.stats[m.id] || 0) >= m.min) (map[top.plot] ||= []).push({ id: m.id, icon: m.icon, name: m.name, text: m.text, n: top.stats[m.id] });
    }
    this.medalCache = { at: now, map };
    return map;
  }
  /**
   * A war is over (its time ran out, a truce, or peace): the side whose strikes landed more wins it, officially.
   * Once per war. Returns the relation as it should be stored.
   */
  judge(r, now) {
    if (!r?.warStart || r.judged === r.warStart) return r;
    const from = r.warStart - this.cfg.T.warning;
    const landed = (a, b) => this.db.list("op", { k1: String(a), k2: String(b), limit: 300 }).filter((o) => o.status === "done" && o.launchAt >= from && o.result?.dmg > 0).length;
    const ha = landed(r.a, r.b), hb = landed(r.b, r.a), out = { ...r, judged: r.warStart };
    if (ha === hb) return out; // a draw: no winner
    const [w, l, hw, hl] = ha > hb ? [r.a, r.b, ha, hb] : [r.b, r.a, hb, ha];
    const wn = this.townInfo(w)?.town || "مدينة", ln = this.townInfo(l)?.town || "مدينة";
    const wa = this.acct(w); this.stat(wa, "wins"); this.saveAcct(w, wa); this.medalCache = null;
    out.hist = [...(r.hist || []), { at: now, by: w, kind: "victory", text: "انتصار" }].slice(-30);
    void hw; void hl; // who won is told in words, never as a score
    this.note(w, "victory", `🏆 النصر لمدينتك! كسرت شوكة «${ln}» وانتهت الحرب بانتصارها. رايتها ترفرف فوق الجوف، وأهلها يحتفلون.`, { from: l, enemy: ln });
    this.note(l, "defeat", `🏳️ انتهت الحرب بخسارة مدينتك أمام «${wn}». الجولة الجاية لكم بإذن الله.`, { from: w });
    const lines = [
      `🏆 نصرٌ مؤزّر لمدينة «${wn}»! أخضعت مدينة «${ln}» ورفعت راية النصر فوق الجوف`,
      `⚔️ مدينة «${wn}» تكسر شوكة مدينة «${ln}» وتخرج من الحرب منتصرة مرفوعة الراس`,
      `🦅 الجوف تشهد: مدينة «${wn}» تنتصر على مدينة «${ln}» بعد حرب طاحنة`,
      `🏰 سقطت دفاعات مدينة «${ln}» وانتهت الحرب بنصر مدينة «${wn}»`
    ];
    this.news("victory", lines[(r.a * 7 + r.b * 13 + Math.floor(r.warStart / 1000)) % lines.length], l);
    return out;
  }
  /** A stored war whose time ran out since: judge it now (once). */
  judgeEnded(r, now) {
    if (!r?.warStart || r.judged === r.warStart || !["war", "warning"].includes(r.state)) return r;
    if (["war", "warning"].includes(relNow(r, now, this.cfg).state)) return r;
    const out = this.judge(r, now);
    this.saveRel(r.a, r.b, out);
    return out;
  }
  townInfo(plot) {
    const t = this.world.town(plot);
    if (!t) return null;
    const p = this.world.player(t.owner);
    return { ...t, created: p?.created || 0, snap: snapBuildings(t.snapshot || "") };
  }
  /** War damage rows of a town, with repairs counted to now: Map "x:y" → { x, y, bid, wd, rep }. */
  damage(plot) {
    const now = this.now(), out = new Map();
    for (const r of this.db.list("dmg", { k1: String(plot) })) {
      if (r.flat) { if (!this.rubbleDone(r, now)) out.set(`${r.x}:${r.y}`, r); continue; } // rubble stays at 100 until cleared
      const wd = this.wdNow(r, now);
      if (wd <= 0) { this.db.del("dmg", `${plot}:${r.x}:${r.y}`); continue; }
      out.set(`${r.x}:${r.y}`, { ...r, wd });
    }
    return out;
  }
  /** Rubble whose clearing has finished: the land is empty (the town's game takes the building off). */
  rubbleDone(r, now) { return !!(r.flat && r.clr && now >= r.clr.end); }
  /**
   * The spots cleared of rubble that the town's own save may still show a building on: { x, y, bid }.
   * Gone once the save no longer has that building there (or after three days).
   */
  cleared(plot, snapList = null) {
    const now = this.now(), out = [];
    for (const r of this.db.list("dmg", { k1: String(plot) })) {
      if (!this.rubbleDone(r, now)) continue;
      const still = snapList ? snapList.some((b) => b.x === r.x && b.y === r.y && b.id === r.bid && !(b.build > 0)) : true;
      if ((snapList && !still) || now - r.clr.end > 3 * 24 * 3600000) { this.db.del("dmg", `${plot}:${r.x}:${r.y}`); continue; }
      out.push({ x: r.x, y: r.y, bid: r.bid });
    }
    return out;
  }
  wdNow(r, now) {
    if (!r.rep) return r.wd;
    const k = Math.min(1, (now - r.rep.start) / Math.max(1, r.rep.end - r.rep.start));
    return k >= 1 ? 0 : Math.max(0, Math.round(r.rep.from * (1 - k) * 10) / 10);
  }
  profileOf(info) {
    const dmg = new Map([...this.damage(info.plot)].map(([k, r]) => [k, r.wd]));
    const p = milProfile(info.snap.list, dmg);
    p.era = info.snap.era || info.era || 0;
    return p;
  }
  /** Money the town can still spend: its last synced budget, less war charges it has not applied yet. */
  available(info, a) {
    const pending = this.db.list("charge", { k1: String(info.plot) }).filter((c) => c.seq > info.snap.seq).reduce((n, c) => n + c.amount, 0);
    return info.snap.money - pending;
  }
  charge(plot, a, amount, why) {
    a.seq += 1;
    const c = { seq: a.seq, amount: Math.round(amount), why, at: this.now() };
    this.db.put("charge", `${plot}:${a.seq}`, c, { k1: String(plot), at: c.at });
    return c;
  }
  /**
   * The mayor starts the town again: its war account (weapons, bills, damage, hits, notes) goes; its
   * relations with other towns stay (a fresh start is no way out of a war). Operations in flight still land.
   */
  resetTown(plot) {
    const k = String(plot);
    for (const tbl of ["acct", "charge", "dmg", "hit", "note"]) this.db.delK1(tbl, k);
  }
  /** Is anything of this town in the air (its own attack, or one coming at it)? A town does not move then. */
  inFlight(plot) { return this.db.list("op", { either: String(plot), limit: 500 }).some((o) => o.status === "flying"); }
  /**
   * The town moves to another plot of land: everything of its war goes with it (weapons, bills, damage, hits,
   * notes, its relations with every town, its operations' history). Other towns' rows that name it follow too.
   */
  moveTown(from, to) {
    const F = String(from), T = String(to), num = (v) => (v === from || v === F ? (typeof v === "number" ? to : T) : v);
    const fix = (row) => {
      for (const k of ["a", "b", "from", "to", "by", "plot", "other"]) if (k in row) row[k] = num(row[k]);
      if (Array.isArray(row.hist)) for (const h of row.hist) if (h && "by" in h) h.by = num(h.by);
      if (row.offer && "by" in row.offer) row.offer.by = num(row.offer.by);
      if (row.lastThreat && F in row.lastThreat) { row.lastThreat[T] = row.lastThreat[F]; delete row.lastThreat[F]; }
      return row;
    };
    for (const r of this.db.rowsOf(F)) {
      const row = fix(r.row);
      this.db.del(r.tbl, r.id);
      if (r.tbl === "rel") { if (row.a > row.b) [row.a, row.b] = [row.b, row.a]; this.db.put("rel", pairId(row.a, row.b), row, { k1: String(row.a), k2: String(row.b), at: r.at }); continue; }
      const id = r.id === F ? T : r.id.startsWith(F + ":") ? T + r.id.slice(F.length) : r.id;
      this.db.put(r.tbl, id, row, { k1: r.k1 === F ? T : r.k1, k2: r.k2 === F ? T : r.k2, at: r.at });
    }
    for (const r of this.db.rowsNaming(from)) this.db.put(r.tbl, r.id, fix(r.row), { k1: r.k1, k2: r.k2, at: r.at }); // other towns' damage and hits that it made
    const c = this.db.get("castle", "main"); if (c && c.holder === from) { c.holder = to; this.saveCastle(c); } // the castle's holder moved
  }
  /** Take back money a town should not have (the game pays it like a war bill, once), with a note saying why. */
  fine(plot, amount, why, text, kind = "fine", extra = {}) {
    const a = this.acct(plot), c = this.charge(plot, a, amount, why);
    this.saveAcct(plot, a);
    this.note(plot, kind, text, extra);
    return c;
  }
  note(plot, kind, text, extra = {}, notify = true) {
    const at = this.now();
    this.db.put("note", `${plot}:${at}:${(noteN = (noteN + 1) % 1e6)}`, { at, kind, text, ...extra }, { k1: String(plot), at });
    if (notify) try { this.world?.ping?.(Number(plot)); this.world?.notify?.(Number(plot), kind, text); } catch { /* live hints never stop the war */ }
  }
  /** A line for the world's bulletin (everyone reads it): only wars, truces, peace and strikes, never who is online. */
  news(kind, text, plot) { try { this.world?.news?.(kind, text, plot); } catch { /* the bulletin never stops the war */ } }
  rel(a, b) { const r = this.db.get("rel", pairId(a, b)); return r ? this.judgeEnded(this.lapse(r, this.now()), this.now()) : r; }
  /** A demand of tribute left without an answer past its day: the war it promised is stored, and both are told (once). */
  lapse(r, now) {
    if (!(r?.tribute && now >= r.tribute.until)) return r;
    const t = r.tribute, v = relNow(r, now, this.cfg), by = t.by, other = r.a === by ? r.b : r.a;
    const out = { ...r, state: "warning", since: t.until, warStart: v.warStart, warEnd: v.warEnd, tribute: null, offer: null };
    out.hist = [...(r.hist || []), { at: t.until, by: other, kind: "lapse", text: "ما رد على الجزية" }].slice(-30);
    const bn = this.townInfo(by)?.town || "مدينة", on = this.townInfo(other)?.town || "مدينة";
    this.note(by, "war", `⏳ «${on}» ما ردت على الجزية: الحرب بينكم ${now >= v.warStart ? "بدأت" : `تبدأ بعد ${minutesText(v.warStart - now)}`}.`, { from: other });
    this.note(other, "war", `⏳ ما رديت على جزية «${bn}»: الحرب بينكم ${now >= v.warStart ? "بدأت" : `تبدأ بعد ${minutesText(v.warStart - now)}`}.`, { from: by });
    this.news("war", `⚔️ «${on}» ما دفعت جزية «${bn}»: حرب`, other);
    this.saveRel(r.a, r.b, out);
    return out;
  }
  saveRel(a, b, r) { this.db.put("rel", pairId(a, b), r, { k1: String(Math.min(a, b)), k2: String(Math.max(a, b)), at: this.now() }); }
  /** A request already answered (the same request id sent again) gives back the same answer. */
  once(plot, req, fn) {
    const id = cleanReq(req);
    if (!id) return { error: "no request id" };
    const key = `${plot}:${id}`, old = this.db.get("req", key);
    if (old) return old.res;
    const res = fn();
    if (!res.error) this.db.put("req", key, { res }, { k1: String(plot), at: this.now() });
    return res;
  }
  /** The shield the mayor bought (a week of al-Jouf, once a month): nothing lands on the town. Returns the end time or 0. */
  shieldUntil(info, now = this.now()) {
    const sh = this.acct(info.plot).shield;
    return sh && sh.until > now ? sh.until : 0;
  }
  /** The bought shield as the town's own panel shows it. */
  shieldView(info, a, now) {
    const sh = a.shield || null, era = info ? info.snap.era || info.era || 0 : 0;
    return { until: sh && sh.until > now ? sh.until : 0, next: sh ? sh.at + this.cfg.T.shieldEvery : 0, price: shieldPrice(era, this.cfg), last: this.cfg.T.shieldLast };
  }
  buyShield(body, me) {
    const now = this.now(), info = this.townInfo(me.plot);
    if (!info?.snap.list.length) return { error: "زامن مدينتك أول (افتحها شوي)" };
    const a = this.acct(me.plot);
    if (a.shield && a.shield.until > now) return { error: `الدرع شغال: باقي ${minutesText(a.shield.until - now)}` };
    if (a.shield && now < a.shield.at + this.cfg.T.shieldEvery) return { error: `الدرع ينفتح لك بعد ٤ أيام من نهايته: تقدر بعد ${minutesText(a.shield.at + this.cfg.T.shieldEvery - now)}` };
    const price = shieldPrice(info.snap.era || info.era || 0, this.cfg);
    if (this.available(info, a) < price) return { error: "ما يكفي المال" };
    a.shield = { at: now, until: now + this.cfg.T.shieldLast };
    const c = this.charge(me.plot, a, price, "درع الحماية");
    this.saveAcct(me.plot, a);
    this.note(me.plot, "shield", `🛡️ رفعت درع الحماية: ما ينضرب فيك شي لمدة ${minutesText(this.cfg.T.shieldLast)} (٣ أيام). إذا هاجمت أحد ينكسر.`, {}, false);
    for (const r of this.db.list("rel", { either: String(me.plot) })) {
      const v = relNow(r, now, this.cfg), other = r.a === me.plot ? r.b : r.a;
      if (["warning", "war"].includes(v.state)) this.note(other, "shield", `🛡️ «${info.town}» رفعت درع الحماية: ضرباتك ما توصلها لمدة ${minutesText(this.cfg.T.shieldLast)}.`, { from: me.plot });
    }
    this.news("shield", `🛡️ «${info.town}» رفعت درع الحماية`, me.plot);
    return { ok: true, shield: this.shieldView(info, a, now), charge: c };
  }
  /** ساعة الصفر: before it, no war is declared, no tribute asked, no strike launched. Why not, or "". */
  notOpen(now) {
    const at = this.world?.openAt?.() || 0;
    return now < at ? `⏳ الحرب ما بدأت: ساعة الصفر بعد ${minutesText(at - now)}` : "";
  }
  /** Wars (and declared warnings) a town is in now. */
  warsOf(plot, now) { return this.db.list("rel", { either: String(plot) }).filter((r) => ["warning", "war"].includes(relNow(this.lapse(r, now), now, this.cfg).state)).length; }
  /**
   * حماية الغايب: an owner away (no game open for a while) takes only so many hits in a window, unless the town
   * attacked someone itself in that time. Returns why a strike stops here, or "".
   */
  awayBlock(info, now) {
    if (now - (info.updated || 0) <= this.cfg.away) return "";
    if (now - (this.acct(info.plot).lastAttack || 0) < this.cfg.caps.awayWindow) return "";
    const hits = this.db.list("hit", { k1: String(info.plot) }).filter((h) => now - h.at < this.cfg.caps.awayWindow);
    return hits.length >= this.cfg.caps.awayMax ? "صاحب المدينة غايب وأخذت حدها من الضربات: محمية لين يرجع" : "";
  }
  /** A launcher fired: its next ready time, longer for every launch it made in the last hour (no endless barrage). */
  reloadAfter(a, key, minutes, now) {
    a.fired ||= {};
    const recent = (a.fired[key] || []).filter((t) => now - t < this.cfg.T.heat);
    recent.push(now); a.fired[key] = recent;
    return now + minutes * 60000 * (1 + 0.5 * (recent.length - 1));
  }
  /** Attacking breaks the attacker's own shield (a shield is for staying out of the fight). */
  breakShield(plot, a, now) {
    a.lastAttack = now; // and ends the town's protection while away
    if (!(a.shield && a.shield.until > now)) return;
    a.shield.until = now;
    this.note(plot, "shield", "🛡️ انكسر درعك لأنك هاجمت.", {}, false);
  }

  // ---------- «قلعة مارد»: the castle in the middle, foot soldiers only (js/castle.js, docs/CASTLE_PLAN.md) ----------
  castleRow() {
    const c = this.db.get("castle", "main") || { holder: null, holderTown: "", since: 0, garrison: { ...CASTLE.guards }, guards: true, shieldUntil: 0, battles: [] };
    if (c.holder != null && !this.world.town(c.holder)) Object.assign(c, { holder: null, holderTown: "", since: 0, garrison: { ...CASTLE.guards }, guards: true }); // its holder's town is gone
    return c;
  }
  saveCastle(c) { this.db.put("castle", "main", c, { k1: "main", at: this.now() }); }
  castleRec(plot) { return this.db.get("crec", String(plot)) || { plot: Number(plot), town: "", held: 0, longest: 0, caps: 0, defs: 0, honour: 0 }; }
  saveRec(r) { this.db.put("crec", String(r.plot), r, { k1: String(r.plot), at: this.now() }); }
  /** My soldiers in camp, in training and on the march (they all take room in the camp). */
  troopsBusy(plot, a) { return troopCount(a.troops) + (a.training || []).reduce((n, t) => n + t.n, 0) + this.db.list("cmarch", { k1: String(plot) }).reduce((n, m) => n + troopCount(m.units), 0); }
  /** The castle as everyone sees it: who holds it, its garrison, the armies on the way, the record, the last battles. */
  castleView(me) {
    const now = this.now(), c = this.castleRow();
    const a = me ? this.acct(me.plot) : null; if (a && finishTraining(a, now)) this.saveAcct(me.plot, a);
    const info = me ? this.townInfo(me.plot) : null, p = info ? this.profileOf(info) : null;
    const marches = this.db.list("cmarch", {}).map((m) => ({ id: m.id, from: m.from, town: m.town, n: troopCount(m.units), mode: m.mode, sent: m.sent, at: m.at, mine: me && m.from === me.plot, units: me && m.from === me.plot ? m.units : undefined }));
    const recs = this.db.list("crec", {}).map((r) => ({ ...r, held: r.held + (c.holder === r.plot ? now - c.since : 0), longest: Math.max(r.longest, c.holder === r.plot ? now - c.since : 0) }));
    const top = (k) => [...recs].sort((x, y) => y[k] - x[k]).filter((r) => r[k] > 0).slice(0, 10).map((r) => ({ plot: r.plot, town: this.townInfo(r.plot)?.town || r.town, v: r[k] }));
    return {
      now, marchMs: this.cfg.marchMs ?? CASTLE.march, holder: c.holder, holderTown: c.holder != null ? this.townInfo(c.holder)?.town || c.holderTown : "", since: c.since, guards: !!c.guards,
      garrison: troopCount(c.garrison), garrisonUnits: me && me.plot === c.holder ? c.garrison : undefined, shieldUntil: c.shieldUntil, battles: (c.battles || []).slice(-12).reverse(), marches,
      records: { held: top("held"), longest: top("longest"), caps: top("caps"), defs: top("defs"), honour: top("honour") },
      lord: top("held")[0] || null,
      mine: me ? { troops: a.troops, training: a.training, cap: p ? barracksCap(p) : 0, busy: this.troopsBusy(me.plot, a), barracks: p?.barracks || null, hq: !!p?.hq, factor: p ? trainFactor(p) : 1 } : null
    };
  }
  /** Train soldiers in the camp: paid now, ready after their time. */
  train(body, me) {
    const now = this.now(), info = this.townInfo(me.plot);
    if (!info?.snap.list.length) return { error: "زامن مدينتك أول (افتحها شوي)" };
    const p = this.profileOf(info), kind = String(body.kind || ""), n = Math.max(1, Math.min(50, Math.round(Number(body.n) || 1)));
    if (!TROOPS[kind]) return { error: "نوع جنود غلط" };
    if (!p.hq) return { error: "ابنِ مركز القيادة العسكرية أول" };
    if (!p.barracks) return { error: "ابنِ معسكر الجنود أول" };
    const cap = barracksCap(p); if (!cap) return { error: "المعسكر متعطل: أصلحه أول" };
    const a = this.acct(me.plot); finishTraining(a, now);
    const room = cap - this.troopsBusy(me.plot, a);
    if (room < n) return { error: room > 0 ? `المعسكر يكفي ${nf(room)} بس` : "المعسكر مليان: طوّره يكبر" };
    const cost = TROOPS[kind].cost * n;
    if (this.available(info, a) < cost) return { error: "ما يكفي المال" };
    const last = a.training.reduce((m, t) => Math.max(m, t.done), now);
    a.training.push({ kind, n, done: last + Math.round(TROOPS[kind].sec * 1000 * n * trainFactor(p) * (this.cfg.troopTime ?? 1)) });
    const ch = this.charge(me.plot, a, cost, `تدريب ${nf(n)} ${TROOPS[kind].name}`);
    this.saveAcct(me.plot, a);
    return { ok: true, charge: ch, castle: this.castleView(me) };
  }
  /** Send soldiers walking to the castle: to take it, or (its holder) to guard it. Five minutes from anywhere. */
  march(body, me) {
    const now = this.now(), why = this.notOpen(now); if (why) return { error: why };
    const info = this.townInfo(me.plot);
    if (!info?.snap.list.length) return { error: "زامن مدينتك أول (افتحها شوي)" };
    const p = this.profileOf(info); if (!p.hq) return { error: "ابنِ مركز القيادة العسكرية أول" };
    const a = this.acct(me.plot); finishTraining(a, now);
    const units = troopClean(body.units), n = troopCount(units);
    if (!n) return { error: "اختر جنود" };
    if (n > CASTLE.sendMax) return { error: `أكثر شي ${nf(CASTLE.sendMax)} جندي بالزحفة` };
    for (const k of TROOP_IDS) if ((a.troops[k] || 0) < units[k]) return { error: `ما عندك ${nf(units[k])} ${TROOPS[k].name}` };
    const c = this.castleRow(), mode = c.holder === me.plot ? "guard" : "attack";
    if (mode === "attack" && c.shieldUntil > now + CASTLE.march) return { error: `القلعة محمية بعد ما تغيّر أميرها: تقدر تزحف بعد ${minutesText(c.shieldUntil - now - CASTLE.march)}` };
    for (const k of TROOP_IDS) a.troops[k] -= units[k];
    const id = `m${now.toString(36)}${Math.floor(this.rand() * 1e6).toString(36)}`, at = now + (this.cfg.marchMs ?? CASTLE.march);
    this.db.put("cmarch", id, { id, from: me.plot, town: info.town, units, mode, sent: now, at }, { k1: String(me.plot), at });
    if (mode === "attack") this.breakShield(me.plot, a, now);
    this.saveAcct(me.plot, a);
    if (mode === "attack") {
      this.news("castle", `⚔️ جيش «${info.town}» زاحف على ${CASTLE.name} (${nf(n)} جندي)، يوصل بعد ${minutesText(at - now)}`, me.plot);
      if (c.holder != null) this.note(c.holder, "castle", `⚔️ جيش «${info.town}» زاحف على ${CASTLE.name}: ${nf(n)} جندي يوصلون بعد ${minutesText(at - now)}. أرسل جنود يحرسونها!`, { from: me.plot });
    }
    return { ok: true, castle: this.castleView(me) };
  }
  /** Armies that have arrived: guards join the garrison; attackers fight it, one army after the other. */
  settleCastle(now) {
    const due = this.db.list("cmarch", { upTo: now }).sort((x, y) => x.at - y.at);
    if (!due.length) return;
    let c = this.castleRow();
    for (const m of due) {
      this.db.del("cmarch", m.id);
      if (m.mode === "guard" || m.from === c.holder) {
        if (m.from === c.holder) { for (const k of TROOP_IDS) c.garrison[k] = (c.garrison[k] || 0) + (m.units[k] || 0); continue; }
        // the castle changed hands on the way: the soldiers go home
        const a = this.acct(m.from); for (const k of TROOP_IDS) a.troops[k] = (a.troops[k] || 0) + (m.units[k] || 0); this.saveAcct(m.from, a);
        this.note(m.from, "castle", `🏰 جنودك وصلوا والقلعة صارت لغيرك: رجعوا لمعسكرك.`); continue;
      }
      const b = castleBattle(m.units, c.garrison, this.rand), lostA = troopCount(b.attLost), lostD = troopCount(b.defLost);
      const att = this.castleRec(m.from); att.town = m.town; att.honour += lostD;
      if (c.holder != null) { const h = this.castleRec(c.holder); h.honour += lostA; if (!b.win) h.defs += 1; this.saveRec(h); }
      const battle = { at: m.at, from: m.from, town: m.town, holder: c.holder, holderTown: c.holder != null ? this.townInfo(c.holder)?.town || c.holderTown : "حراس القلعة", sent: troopCount(m.units), garrison: troopCount(c.garrison), lostA, lostD, win: b.win };
      c.battles = [...(c.battles || []), battle].slice(-30);
      if (b.win) {
        // the castle falls: the old garrison's survivors go home, the attackers' survivors hold it
        if (c.holder != null) {
          const h = this.castleRec(c.holder), reign = m.at - c.since; h.held += reign; h.longest = Math.max(h.longest, reign); this.saveRec(h);
          const ha = this.acct(c.holder); for (const k of TROOP_IDS) ha.troops[k] = (ha.troops[k] || 0) + (b.defLeft[k] || 0); this.saveAcct(c.holder, ha);
          this.note(c.holder, "castle", `🏰 سقطت ${CASTLE.name}! «${m.town}» أخذها منك. رجع لمعسكرك ${nf(troopCount(b.defLeft))} جندي.`, { from: m.from });
        }
        att.caps += 1;
        c = { ...c, holder: m.from, holderTown: m.town, since: m.at, garrison: b.attLeft, guards: false, shieldUntil: m.at + (this.cfg.castleShield ?? CASTLE.shield) };
        this.note(m.from, "castle", `👑 أخذت ${CASTLE.name}! صرت أمير الجوف. خسرت ${nf(lostA)} جندي، و${nf(troopCount(b.attLeft))} صاروا حامية القلعة.`);
        this.news("castle", `👑 سقطت ${CASTLE.name}! «${m.town}» صار أمير الجوف`, m.from);
      } else {
        c.garrison = b.defLeft;
        const a = this.acct(m.from); for (const k of TROOP_IDS) a.troops[k] = (a.troops[k] || 0) + (b.attLeft[k] || 0); this.saveAcct(m.from, a);
        this.note(m.from, "castle", `🛡️ ${CASTLE.name} صدّت هجومك. خسرت ${nf(lostA)} جندي، ورجع لمعسكرك ${nf(troopCount(b.attLeft))}.`);
        if (c.holder != null) this.note(c.holder, "castle", `🛡️ حامية ${CASTLE.name} صدّت جيش «${m.town}». خسرت ${nf(lostD)} جندي.`, { from: m.from });
        this.news("castle", `🛡️ ${CASTLE.name} صدّت جيش «${m.town}»`, m.from);
      }
      this.saveRec(att);
    }
    this.saveCastle(c);
  }

  // ---------- the entry point ----------
  /** me: the signed-in player { name, plot, created }. Returns a plain object (sent as JSON). */
  handle(action, body, me) {
    this.settle();
    if (me.plot == null) return { error: "no town" };
    switch (action) {
      case "state": return this.state(body, me);
      case "buy": return this.once(me.plot, body.req, () => this.buy(body, me));
      case "rel": return this.once(me.plot, body.req, () => this.relAct(body, me));
      case "launch": return this.once(me.plot, body.op, () => this.launch(body, me));
      case "salvo": return this.once(me.plot, body.op, () => this.salvo(body, me));
      case "op": return this.opView(String(body.op || ""), me);
      case "repair": return this.once(me.plot, body.req, () => this.repair(body, me));
      case "clear": return this.once(me.plot, body.req, () => this.clearRubble(body, me));
      case "settings": return this.settings(body, me);
      case "shield": return this.once(me.plot, body.req, () => this.buyShield(body, me));
      case "enemy": return { view: this.enemyView(me, Math.round(Number(body.plot))) };
      case "watch": return this.watch(Math.round(Number(body.plot)), me);
      case "castle": return CASTLE_ON || this.cfg.castleOn ? { castle: this.castleView(me) } : { error: "قلعة مارد قريبًا" };
      case "train": if (!CASTLE_ON && !this.cfg.castleOn) return { error: "قلعة مارد قريبًا" }; return this.once(me.plot, body.req, () => this.train(body, me));
      case "march": if (!CASTLE_ON && !this.cfg.castleOn) return { error: "قلعة مارد قريبًا" }; return this.once(me.plot, body.req, () => this.march(body, me));
      default: return { error: "not found" };
    }
  }

  /**
   * The fronts of al-Jouf for everyone (the world map shows them): only who fights whom, since when and how many
   * strikes landed each way. Never budgets, weapons or defences.
   */
  fronts() {
    this.settle();
    const now = this.now(), out = [];
    for (const r0 of this.db.list("rel", {})) {
      const r = this.judgeEnded(this.lapse(r0, now), now), v = relNow(r, now, this.cfg);
      if (!["warning", "war", "truce"].includes(v.state) && !r.tribute) continue;
      const landed = (from, to) => this.db.list("op", { k1: String(from), k2: String(to), limit: 200 }).filter((o) => o.status === "done" && o.launchAt >= (v.warStart || 0) - this.cfg.T.warning && o.result?.dmg > 0).length;
      const started = [...(r.hist || [])].reverse().find((h) => ["war", "refuse", "lapse"].includes(h.kind));
      out.push({ a: r.a, b: r.b, state: v.state, by: started?.kind === "war" ? started.by : null, tribute: !!r.tribute, warStart: v.warStart || 0, warEnd: v.warEnd || 0, truceEnd: v.truceEnd || 0, hitsA: landed(r.a, r.b), hitsB: landed(r.b, r.a) });
    }
    return out;
  }

  /** Every attack in the air over al-Jouf, for the map (public, like the fronts): who at whom, when it left and lands, what kind. */
  flights() {
    const now = this.now(), out = [];
    for (const f of this.db.list("fly", { since: now, limit: 200 })) {
      const o = this.db.get("op", f.id);
      if (!o || o.status !== "flying") continue;
      const ws = Object.keys(o.load || {});
      out.push({ id: o.id, from: o.from, to: o.to, launchAt: o.launchAt, arriveAt: o.arriveAt, kind: ws.some((w) => WEAPONS[w]?.kind === "missile") ? "missile" : "drone", heavy: ws.some(isHeavy) });
    }
    return out;
  }
  /**
   * «تابع»: the strikes landing on a town at war, for anyone watching from outside (what the scene needs, the
   * same as any visitor could see of the damage): the last half hour, and those still in the air.
   */
  watch(plot, me) {
    const info = this.townInfo(plot);
    if (!info) return { error: "ما لقيت المدينة" };
    const now = this.now();
    const ops = this.db.list("op", { k2: String(plot), limit: 60 }).filter((o) => o.status === "flying" || now - (o.doneAt || 0) < 30 * 60000).map((o) => ({
      id: o.id, salvo: o.salvo || null, from: o.from, to: o.to, fromTown: o.fromTown, toTown: o.toTown, x: o.x, y: o.y, bname: o.bname, load: o.load,
      launchAt: o.launchAt, arriveAt: o.arriveAt, doneAt: o.doneAt || 0, status: o.status, detected: o.detected, side: "watch",
      result: o.status === "done" ? { hits: o.result.hits, area: o.result.area, dmg: o.result.dmg, blocked: o.result.blocked, displaced: o.result.displaced || 0, dead: o.result.dead || 0, hurt: o.result.hurt || 0, airdef: o.result.airdef || 0 } : null
    }));
    const war = this.db.list("rel", { either: String(plot) }).some((r) => ["warning", "war"].includes(relNow(this.lapse(r, now), now, this.cfg).state));
    return { town: info.town, war, ops, now, mine: plot === me.plot };
  }

  // ---------- reading ----------
  state(body, me) {
    // what this town's game has applied (the bills and gifts up to this number): the owner's panel shows a gift as arrived
    { const a0 = this.acct(me.plot), seen = Math.round(Number(body.seq) || 0); if (seen > (a0.seenSeq || 0)) { a0.seenSeq = seen; this.saveAcct(me.plot, a0); } }
    const now = this.now(), info = this.townInfo(me.plot), a = this.acct(me.plot);
    const p = info ? this.profileOf(info) : milProfile([]);
    const rels = this.db.list("rel", { either: String(me.plot) }).map((r0) => {
      const r = this.judgeEnded(this.lapse(r0, now), now), other = r.a === me.plot ? r.b : r.a, o = this.townInfo(other), v = relNow(r, now, this.cfg);
      return { other, town: o?.town || "مدينة", owner: o?.owner || "", era: o?.era || 0, money: undefined, ...v, hist: (r.hist || []).slice(-20), chat: (r.chat?.lines || []).slice(-40), chatOpen: !!r.chat?.open, lastSay: undefined, lastThreat: undefined };
    }).filter((r) => r.state !== "peace" || r.hist.length || r.chat.length);
    const ops = this.db.list("op", { either: String(me.plot), limit: 40 }).map((o) => this.opPublic(o, me));
    const notes = this.db.list("note", { k1: String(me.plot), limit: 60 }); // the newest 60 (the game knows which it has seen)
    const charges = this.db.list("charge", { k1: String(me.plot) }).filter((c) => c.seq > (Number(body.seq) || 0)).sort((x, y) => x.seq - y.seq);
    const dmg = [...this.damage(me.plot).values()], cleared = this.cleared(me.plot, info?.snap.list || null);
    return {
      now, arsenal: a.arsenal, caps: capacity(p), settings: a.settings, reload: a.reload, seq: a.seq,
      profile: { hq: p.hq, bases: p.bases, pads: p.pads, radars: p.radars, airdefs: p.airdefs, forts: p.forts, armory: p.armory, barracks: p.barracks, era: p.era },
      openAt: (this.world?.shownOpenAt || this.world?.openAt)?.() || 0, medals: this.medals(), rels, ops, notes, charges, damage: dmg, cleared, shield: info ? this.shieldUntil(info, now) : 0, shieldBuy: this.shieldView(info, a, now),
      cityMilestoneSeq: a.cityMilestoneSeq || 0,
      castle: (() => { const c = this.castleRow(); return { holder: c.holder, town: c.holder != null ? this.townInfo(c.holder)?.town || c.holderTown : "", since: c.since, marching: this.db.list("cmarch", {}).length, marches: this.db.list("cmarch", {}).map((m) => ({ from: m.from, n: troopCount(m.units), mode: m.mode, sent: m.sent, at: m.at })) }; })(),
      intercept: Object.fromEntries(WEAPON_IDS.map((w) => [w, interceptChance(p, w)]))
    };
  }
  /** War damage of any town (for visitors and the town itself). */
  publicDamage(plot) {
    this.settle();
    return [...this.damage(plot).values()].map((r) => ({ x: r.x, y: r.y, bid: r.bid, wd: r.wd, rep: r.rep || null, flat: !!r.flat, clr: r.clr || null }))
      .concat(this.cleared(plot).map((r) => ({ ...r, wd: 0, gone: true })));
  }
  opPublic(o, me) {
    const mine = o.from === me.plot;
    return { ...o, side: mine ? "out" : "in", result: o.status === "done" ? o.result : null };
  }
  opView(id, me) {
    const o = this.db.get("op", id);
    if (!o || (o.from !== me.plot && o.to !== me.plot)) return { error: "no such operation" };
    return { op: this.opPublic(o, me), now: this.now() };
  }
  /** What another town looks like to my command (for the strike panel): defence known only with a good radar. */
  enemyView(me, plot) {
    const info = this.townInfo(plot);
    if (!info) return null;
    const myInfo = this.townInfo(me.plot), mp = myInfo ? this.profileOf(myInfo) : milProfile([]);
    const p = this.profileOf(info);
    const radar = mp.radars.filter((r) => r.wd < 85).sort((x, y) => y.lvl - x.lvl)[0];
    return { known: !!radar && radar.lvl >= 1, airdefs: p.airdefs.length, bestAirdef: p.airdefs.reduce((n, x) => Math.max(n, x.lvl + 1), 0), radar: p.radars.length > 0 };
  }

  // ---------- buying ----------
  buy(body, me) {
    const info = this.townInfo(me.plot);
    if (!info?.snap.list.length) return { error: "زامن مدينتك أول (افتحها شوي)" };
    const a = this.acct(me.plot), p = this.profileOf(info);
    if (!p.hq) return { error: "ابنِ مركز القيادة العسكرية أول" };
    if (p.hq.wd >= 85) return { error: "مركز القيادة متعطل: أصلحه أول" };
    const kind = String(body.kind || ""), n = Math.max(1, Math.min(12, Math.round(Number(body.n) || 1)));
    const caps = capacity(p);
    let price, room;
    if (kind === "intc") {
      if (!p.airdefs.length && !p.forts.length) return { error: "تحتاج بطارية دفاع جوي أو منظومة الحصن" };
      price = this.cfg.interceptor.price; room = caps.intc - a.arsenal.intc;
    } else {
      const why = weaponBlocker(p, kind);
      if (why) return { error: why };
      price = WEAPONS[kind].price;
      const drones = kindSum(a.arsenal, "drone"), missiles = kindSum(a.arsenal, "missile");
      room = WEAPONS[kind].kind === "drone" ? caps.drones - drones : caps.missiles - missiles;
    }
    if (room < n) return { error: room > 0 ? `المكان يكفي ${nf(room)} بس` : "المخزن مليان: طوّر أو ابنِ مستودع ذخائر" };
    const cost = price * n;
    if (this.available(info, a) < cost) return { error: "ما يكفي المال" };
    a.arsenal[kind] += n;
    const c = this.charge(me.plot, a, cost, `شراء ${nf(n)} ${kind === "intc" ? this.cfg.interceptor.name : WEAPONS[kind].name}`);
    this.saveAcct(me.plot, a);
    return { ok: true, arsenal: a.arsenal, charge: c };
  }

  settings(body, me) {
    const a = this.acct(me.plot);
    a.settings = { repair: !!body.repair, refill: !!body.refill, budget: Math.max(0, Math.min(200000, Math.round(Number(body.budget) || 0))) };
    this.saveAcct(me.plot, a);
    return { ok: true, settings: a.settings };
  }

  // ---------- relations ----------
  relAct(body, me) {
    const other = Math.round(Number(body.other)), act = String(body.act || ""), now = this.now();
    const mine = this.townInfo(me.plot), them = this.townInfo(other);
    if (!mine || !them || other === me.plot) return { error: "ما لقيت المدينة" };
    const mineEra = { ...mine, era: mine.snap.era || mine.era, created: me.created || mine.created };
    const themEra = { ...them, era: them.snap.era || them.era };
    const stored = this.rel(me.plot, other);
    const block = conflictBlocker(mineEra, themEra, now, this.cfg, stored ? relNow(stored, now, this.cfg) : null);
    const r = { a: Math.min(me.plot, other), b: Math.max(me.plot, other), hist: [], lastThreat: {}, ...relNow(stored, now, this.cfg) };
    r.hist ||= []; r.lastThreat ||= {};
    const allowed = relActions(stored ? r : null, me.plot, now, block, this.cfg);
    if (!(act in allowed)) return { error: "طلب غير معروف" };
    // before zero hour nothing that leads to a war: no declaration, no tribute, no threats or talk, no hostility
    if (["war", "tribute", "say", "endchat", "threat", "hostile"].includes(act) && this.notOpen(now)) return { error: this.notOpen(now) };
    if (allowed[act]) return { error: allowed[act] };
    const myName = mine.town, theirName = them.town;
    const log = (kind, text) => { r.hist.push({ at: now, by: me.plot, kind, text }); r.hist = r.hist.slice(-30); };
    const declare = (why) => {
      r.state = "warning"; r.since = now; r.warStart = now + this.cfg.T.warning; r.warEnd = r.warStart + this.cfg.T.war; r.offer = null; r.tribute = null;
      if (r.chat) r.chat.open = false;
      log("war", why);
      this.note(other, "war", `⚔️ مدينة «${myName}» أعلنت عليك الحرب! أول ضربة ممكنة بعد ${minutesText(this.cfg.T.warning)}. جهّز دفاعاتك.`, { from: me.plot });
      this.note(me.plot, "war", `⚔️ أعلنت الحرب على «${theirName}». أول ضربة ممكنة بعد ${minutesText(this.cfg.T.warning)}.`, { from: other });
      this.news("war", `⚔️ «${myName}» أعلنت الحرب على «${theirName}»`, other);
    };
    if (act === "threat") {
      const text = THREATS[Math.max(0, Math.min(THREATS.length - 1, Math.round(Number(body.text) || 0)))];
      if (r.state === "peace") { r.state = "tension"; r.since = now; }
      r.lastThreat[me.plot] = now;
      log("threat", text);
      this.note(other, "threat", `😠 تهديد من «${myName}»: ${text}`, { from: me.plot });
    } else if (act === "hostile") {
      r.state = "hostile"; r.since = now; r.offer = null;
      log("hostile", "إعلان عداوة");
      this.note(other, "hostile", `⚔️ «${myName}» أعلنت عليك العداوة!`, { from: me.plot });
    } else if (act === "war") {
      if (this.warsOf(me.plot, now) >= this.cfg.maxWars) return { error: `عندك ${nf(this.cfg.maxWars)} حروب: هذا الحد` };
      if (this.warsOf(other, now) >= this.cfg.maxWars) return { error: `«${theirName}» داخلة ${nf(this.cfg.maxWars)} حروب: هذا الحد` };
      declare("إعلان حرب");
    } else if (act === "tribute") {
      if (this.warsOf(me.plot, now) >= this.cfg.maxWars) return { error: `عندك ${nf(this.cfg.maxWars)} حروب: هذا الحد` };
      if (this.warsOf(other, now) >= this.cfg.maxWars) return { error: `«${theirName}» داخلة ${nf(this.cfg.maxWars)} حروب: هذا الحد` };
      // a demand of money: paid, a month of peace; refused or left without an answer for a day of al-Jouf, war
      const most = tributeMax(them.snap.money, this.cfg), amount = Math.round(Number(body.amount) || 0);
      if (most < this.cfg.tribute.min) return { error: "ميزانيتهم ما تكفي لجزية" };
      if (!(amount >= this.cfg.tribute.min && amount <= most)) return { error: `الجزية من ${nf(this.cfg.tribute.min)} إلى ${nf(most)} ريال (${nf(this.cfg.tribute.share * 100)}٪ من ميزانيتهم)` };
      r.tribute = { by: me.plot, amount, at: now, until: now + this.cfg.T.tributeAnswer };
      if (r.state === "peace") { r.state = "tension"; r.since = now; }
      log("tribute", `طلب جزية ${nf(amount)} ريال`);
      this.note(other, "tribute", `🪙 «${myName}» تطالبك بجزية ${nf(amount)} ريال. إذا دفعت: سلام شهر بالجوف. إذا رفضت أو ما رديت خلال ${minutesText(this.cfg.T.tributeAnswer)}: حرب.`, { from: me.plot, amount });
      this.news("tribute", `🪙 «${myName}» تطالب «${theirName}» بالجزية`, other);
    } else if (act === "pay") {
      const t = r.tribute;
      if (this.available(mine, this.acct(me.plot)) < t.amount) return { error: "ما يكفي المال للجزية" };
      const ma = this.acct(me.plot); this.charge(me.plot, ma, t.amount, `جزية لـ«${theirName}»`); this.saveAcct(me.plot, ma);
      const ta = this.acct(other); this.charge(other, ta, -t.amount, `جزية من «${myName}»`); this.saveAcct(other, ta);
      r.tribute = null; r.state = "peace"; r.since = now; r.tributePeace = now + this.cfg.T.tributePeace; r.offer = null;
      log("paid", `دفع الجزية ${nf(t.amount)} ريال`);
      this.note(other, "paid", `🪙 «${myName}» دفعت الجزية: ${nf(t.amount)} ريال وصلت ميزانيتك. سلام بينكم ${minutesText(this.cfg.T.tributePeace)} (شهر بالجوف).`, { from: me.plot, amount: t.amount });
      this.note(me.plot, "paid", `🪙 دفعت الجزية لـ«${theirName}» (${nf(t.amount)} ريال): سلام ${minutesText(this.cfg.T.tributePeace)} (شهر بالجوف).`, { from: other }, false);
      this.news("paid", `🪙 «${myName}» دفعت الجزية لـ«${theirName}»`, other);
    } else if (act === "refuse") {
      r.tribute = null;
      log("refuse", "رفض الجزية");
      // the refusal is the war the demand promised: declared in the name of the one who asked
      r.state = "warning"; r.since = now; r.warStart = now + this.cfg.T.warning; r.warEnd = r.warStart + this.cfg.T.war; r.offer = null;
      this.note(other, "war", `✋ «${myName}» رفضت الجزية: الحرب بينكم تبدأ بعد ${minutesText(this.cfg.T.warning)}.`, { from: me.plot });
      this.note(me.plot, "war", `✋ رفضت الجزية: الحرب مع «${theirName}» تبدأ بعد ${minutesText(this.cfg.T.warning)}. جهّز دفاعاتك.`, { from: other }, false);
      this.news("war", `⚔️ «${myName}» رفضت جزية «${theirName}»: حرب`, other);
    } else if (act === "say") {
      // a talk between the two mayors (the threat, in their own words): both may answer, either may end it with war
      const text = String(body.text || "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (!text) return { error: "اكتب شي" };
      if (this.world?.badText?.(text)) return { error: "الكلام هذا ما يصلح" };
      r.chat ||= { lines: [], open: true }; r.chat.open = true;
      r.chat.lines.push({ by: me.plot, at: now, text }); r.chat.lines = r.chat.lines.slice(-40);
      r.lastSay = { ...(r.lastSay || {}), [me.plot]: now };
      if (r.state === "peace") { r.state = "tension"; r.since = now; }
      this.note(other, "say", `💬 «${myName}»: ${text}`, { from: me.plot });
    } else if (act === "endchat") {
      const why = relActions(stored ? r : null, me.plot, now, block, this.cfg).war;
      if (why) { r.chat.open = false; log("endchat", "إنهاء المحادثة"); this.note(other, "say", `💬 «${myName}» أنهت المحادثة.`, { from: me.plot }); }
      else declare("أنهى المحادثة وأعلن الحرب");
    } else if (act === "truce" || act === "peace") {
      r.offer = { kind: act, by: me.plot, at: now };
      log(act + "Offer", act === "truce" ? "عرض هدنة" : "عرض صلح");
      this.note(other, act + "Offer", act === "truce" ? `🏳️ «${myName}» تعرض عليك هدنة ${minutesText(this.cfg.T.truce)}.` : `🤝 «${myName}» تعرض عليك الصلح.`, { from: me.plot });
    } else if (act === "accept") {
      const kind = r.offer.kind; r.offer = null;
      if (["war", "warning"].includes(r.state)) Object.assign(r, this.judge(r, now)); // the war ends here: who won it
      if (kind === "truce") {
        r.state = "truce"; r.since = now; r.truceEnd = now + this.cfg.T.truce;
        log("truce", "هدنة");
        for (const [p, o] of [[me.plot, theirName], [other, myName]]) this.note(p, "truce", `🏳️ هدنة مع «${o}» لمدة ${minutesText(this.cfg.T.truce)}: ما فيه ضربات.`, { from: p === me.plot ? other : me.plot });
        this.news("truce", `🏳️ هدنة بين «${myName}» و«${theirName}»`, other);
      } else {
        r.state = "peace"; r.since = now; r.cool = now + this.cfg.T.peaceCool;
        log("peace", "صلح");
        for (const p of [me.plot, other]) this.note(p, "peace", `🕊️ انتهت الحرب بين «${myName}» و«${theirName}».`, { from: p === me.plot ? other : me.plot });
        this.news("peace", `🕊️ صلح بين «${myName}» و«${theirName}»: انتهت الحرب`, other);
      }
    } else if (act === "reject") {
      const kind = r.offer.kind; r.offer = null;
      log("reject", kind === "truce" ? "رفض الهدنة" : "رفض الصلح");
      this.note(other, "reject", `✋ «${myName}» رفضت ${kind === "truce" ? "الهدنة" : "الصلح"}.`, { from: me.plot });
    }
    this.saveRel(me.plot, other, r);
    return { ok: true, rel: relNow(r, now, this.cfg) };
  }

  // ---------- attacking ----------
  /** Everything that stops this launch, before anything is spent. Returns { error } or the plan. */
  plan(body, me, opt = {}) {
    const now = this.now(), to = Math.round(Number(body.to)), x = Math.round(Number(body.x)), y = Math.round(Number(body.y));
    const mine = this.townInfo(me.plot), them = this.townInfo(to);
    if (!mine?.snap.list.length) return { error: "زامن مدينتك أول" };
    if (!them) return { error: "ما لقيت المدينة" };
    const r = relNow(this.rel(me.plot, to), now, this.cfg);
    const block = conflictBlocker({ ...mine, era: mine.snap.era || mine.era, created: me.created || mine.created }, { ...them, era: them.snap.era || them.era }, now, this.cfg, r);
    if (block) return { error: block };
    if (this.notOpen(now)) return { error: this.notOpen(now) };
    if (r.state === "warning") return { error: `الحرب تبدأ بعد ${minutesText(r.warStart - now)}` };
    if (r.state !== "war") return { error: r.state === "truce" ? "فيه هدنة: ما يصير تضرب" : "ما فيه حرب مع هالمدينة" };
    // a spot in the town: whatever stands there and around it is hit (never a mosque)
    if (!(x >= 0 && y >= 0 && x < 80 && y < 80)) return { error: "اختر مكان داخل المدينة" };
    const at = them.snap.list.find((b) => b.x === x && b.y === y);
    if (at && MOSQUES.has(at.id)) return { error: "المساجد محمية: ما تنقصف" };
    const near = at || them.snap.list.filter((b) => canTarget(b.id)).map((b) => ({ ...b, d: Math.hypot(b.x - x, b.y - y) })).sort((p, q) => p.d - q.d)[0];
    if (!near || Math.hypot(near.x - x, near.y - y) > 3) return { error: "المكان بعيد عن مباني المدينة" };
    const target = at ? { ...at, name: B[at.id].name } : { x, y, id: null, lvl: 0, name: `موقع قرب ${B[near.id].name}` };
    const shield = this.shieldUntil(them, now);
    if (shield) return { error: `المدينة عليها درع حماية: باقي ${minutesText(shield - now)}` };
    const away = this.awayBlock(them, now);
    if (away) return { error: away };
    const rehits = this.db.list("hit", { k1: String(to) }).filter((h) => h.x === x && h.y === y && now - h.at < this.cfg.caps.rehitWindow);
    if (rehits.length >= this.cfg.caps.rehitMax) return { error: "هالمكان انضرب كثير: محمي فترة" };
    // what is sent
    const a = this.acct(me.plot), p = this.profileOf(mine);
    if (!p.hq) return { error: "تحتاج مركز القيادة العسكرية" };
    if (p.hq.wd >= 85) return { error: "مركز القيادة متعطل" };
    const load = {};
    let total = 0;
    for (const w of WEAPON_IDS) { const n = Math.max(0, Math.min(8, Math.round(Number(body.load?.[w]) || 0))); if (n) { load[w] = n; total += n; } }
    if (!total) return { error: "اختر سلاح" };
    for (const [w, n] of Object.entries(load)) {
      if (a.arsenal[w] < n) return { error: `ما عندك ${nf(n)} ${WEAPONS[w].name}` };
      const why = weaponBlocker(p, w);
      if (why) return { error: why };
    }
    // the destructive weapons: one at a time, a town fires one every 6 hours and is the target of one every 12
    const heavyN = Object.entries(load).reduce((n, [w, k]) => n + (isHeavy(w) ? k : 0), 0);
    if (heavyN) {
      if (heavyN > 1) return { error: "سلاح مدمّر واحد بس بالعملية" };
      const D = this.cfg.heavyDay, mine0 = (a.heavyLog || []).filter((t) => now - t < D).sort((p, q) => p - q);
      if (mine0.length >= this.cfg.heavyOut) return { error: `أطلقت ${nf(this.cfg.heavyOut)} أسلحة مدمّرة باليوم: تقدر بعد ${minutesText(D - (now - mine0[0]))}` };
      const onThem = this.db.list("op", { k2: String(to), since: now - D, limit: 500 }).filter((o) => Object.keys(o.load || {}).some(isHeavy)).map((o) => o.launchAt).sort((p, q) => p - q);
      if (onThem.length >= this.cfg.heavyIn) return { error: `المدينة انضربت بـ${nf(this.cfg.heavyIn)} أسلحة مدمّرة باليوم: تنضرب مرة ثانية بعد ${minutesText(D - (now - onThem[0]))}` };
    }
    const drones = kindSum(load, "drone"), missiles = kindSum(load, "missile");
    const readyBases = p.bases.filter((b) => b.wd < 85 && (a.reload[`b${b.x}:${b.y}`] || 0) <= now);
    const readyPads = p.pads.filter((b) => b.wd < 85 && (a.reload[`p${b.x}:${b.y}`] || 0) <= now);
    const slowest = Object.keys(load).reduce((n, w) => Math.max(n, flightMs(me.plot, to, w, this.cfg)), 0);
    if (opt.batch) return { now, to, x, y, target, load, a, p, mine, them, readyBases, readyPads, drones, missiles, flight: slowest, fee: Object.entries(load).reduce((n, [w, k]) => n + WEAPONS[w].fee * k, 0), value: Object.entries(load).reduce((n, [w, k]) => n + WEAPONS[w].price * k, 0) };
    if (drones) {
      if (!readyBases.length) return { error: `قواعد المسيّرات تتجهز: باقي ${minutesText(Math.min(...p.bases.map((b) => a.reload[`b${b.x}:${b.y}`] || now)) - now)}` };
      const salvo = Math.max(...readyBases.map((b) => milStat("dronebase", b.lvl).salvo));
      if (drones > salvo) return { error: `القاعدة تطلق ${nf(salvo)} مسيّرات بالعملية الوحدة` };
    }
    if (missiles) {
      const room = readyPads.reduce((n, b) => n + milStat("missilepad", b.lvl).cap, 0);
      if (!readyPads.length) return { error: `المنصات تتجهز: باقي ${minutesText(Math.min(...p.pads.map((b) => a.reload[`p${b.x}:${b.y}`] || now)) - now)}` };
      if (missiles > room) return { error: `المنصات الجاهزة تطلق ${nf(room)} صواريخ بس` };
    }
    const ops = milStat("milhq", p.hq.lvl).ops;
    if (this.flying({ k1: String(me.plot) }) >= ops) return { error: `القيادة تدير ${nf(ops)} عملية بالجو بس` };
    if (this.flying({ k2: String(to) }) >= this.cfg.caps.inFlightTo) return { error: "الجو فوق المدينة زحمة عمليات: جرّب بعد شوي" };
    const fee = Object.entries(load).reduce((n, [w, k]) => n + WEAPONS[w].fee * k, 0);
    if (this.available(mine, a) < fee) return { error: "ما يكفي المال لتشغيل العملية" };
    return { now, to, x, y, target, load, fee, a, p, mine, them, readyBases, readyPads, drones, missiles, flight: slowest, value: Object.entries(load).reduce((n, [w, k]) => n + WEAPONS[w].price * k, 0) };
  }

  /** Operations in the air (a salvo counts once: it was launched as one). */
  flying(q) {
    const list = this.db.list("op", { ...q, limit: 80 }).filter((o) => o.status === "flying");
    return new Set(list.map((o) => o.salvo || o.id)).size;
  }

  /**
   * «دفعة»: several targets in one town, each with its own weapons, launched together. The whole batch is
   * checked first (ammunition, ready launchers, money, the operations in the air) and nothing is spent unless
   * all of it can go. It counts as one operation in the air; each target is its own result.
   */
  salvo(body, me) {
    const id = cleanReq(body.op);
    if (!id) return { error: "no operation id" };
    const list = (Array.isArray(body.targets) ? body.targets : []).slice(0, SALVO_MAX);
    if (!list.length) return { error: "اختر هدف واحد على الأقل" };
    const seen = new Set(), plans = [];
    for (const t of list) {
      const key = `${Math.round(Number(t.x))}:${Math.round(Number(t.y))}`;
      if (seen.has(key)) return { error: "نفس الهدف مكرر بالدفعة" };
      seen.add(key);
      const pl = this.plan({ to: body.to, x: t.x, y: t.y, load: t.load }, me, { batch: true });
      if (pl.error) return { error: pl.error };
      plans.push(pl);
    }
    const { now, to, a, p, mine, them, readyBases, readyPads } = plans[0];
    const need = {};
    for (const pl of plans) for (const [w, n] of Object.entries(pl.load)) need[w] = (need[w] || 0) + n;
    if (Object.entries(need).reduce((n, [w, k]) => n + (isHeavy(w) ? k : 0), 0) > 1) return { error: "سلاح مدمّر واحد بس بالدفعة" };
    for (const [w, n] of Object.entries(need)) if (a.arsenal[w] < n) return { error: `الدفعة تحتاج ${nf(n)} ${WEAPONS[w].name} وعندك ${nf(a.arsenal[w])}` };
    const drones = plans.reduce((n, pl) => n + pl.drones, 0), missiles = plans.reduce((n, pl) => n + pl.missiles, 0);
    const droneRoom = readyBases.reduce((n, b) => n + milStat("dronebase", b.lvl).salvo, 0), padRoom = readyPads.reduce((n, b) => n + milStat("missilepad", b.lvl).cap, 0);
    if (drones && !readyBases.length) return { error: "قواعد المسيّرات تتجهز" };
    if (drones > droneRoom) return { error: `القواعد الجاهزة تطلق ${nf(droneRoom)} مسيّرات بالدفعة` };
    if (missiles && !readyPads.length) return { error: "المنصات تتجهز" };
    if (missiles > padRoom) return { error: `المنصات الجاهزة تطلق ${nf(padRoom)} صواريخ بالدفعة` };
    const ops = milStat("milhq", p.hq.lvl).ops;
    if (this.flying({ k1: String(me.plot) }) >= ops) return { error: `القيادة تدير ${nf(ops)} عملية بالجو بس` };
    if (this.flying({ k2: String(to) }) >= this.cfg.caps.inFlightTo) return { error: "الجو فوق المدينة زحمة عمليات: جرّب بعد شوي" };
    const fee = plans.reduce((n, pl) => n + pl.fee, 0);
    if (this.available(mine, a) < fee) return { error: "ما يكفي المال لتشغيل الدفعة" };
    // spend: the ammunition, and the launchers that fired (only as many as the batch needed)
    for (const [w, n] of Object.entries(need)) a.arsenal[w] -= n;
    if (Object.keys(need).some(isHeavy)) a.heavyLog = [...(a.heavyLog || []).filter((t) => now - t < this.cfg.heavyDay), now];
    let left = drones;
    for (const b of readyBases.sort((q, r) => r.lvl - q.lvl)) { if (left <= 0) break; left -= milStat("dronebase", b.lvl).salvo; a.reload[`b${b.x}:${b.y}`] = this.reloadAfter(a, `b${b.x}:${b.y}`, milStat("dronebase", b.lvl).reload, now); }
    left = missiles;
    for (const b of readyPads.sort((q, r) => r.lvl - q.lvl)) { if (left <= 0) break; left -= milStat("missilepad", b.lvl).cap; a.reload[`p${b.x}:${b.y}`] = this.reloadAfter(a, `p${b.x}:${b.y}`, milStat("missilepad", b.lvl).reload, now); }
    this.breakShield(me.plot, a, now);
    const ch = this.charge(me.plot, a, fee, `دفعة على «${them.town}» (${nf(plans.length)} أهداف)`);
    this.saveAcct(me.plot, a);
    const detected = detects(this.profileOf(them));
    const out = plans.map((pl, i) => {
      const op = {
        id: `${id}-${i}`, salvo: id, from: me.plot, to, fromTown: mine.town, toTown: them.town, x: pl.x, y: pl.y, bid: pl.target.id, blvl: pl.target.lvl, bname: pl.target.name,
        load: pl.load, launchAt: now, arriveAt: now + pl.flight, status: "flying", fee: pl.fee, value: pl.value, detected,
        pads: readyPads.map((b) => [b.x, b.y]).slice(0, 2), bases: readyBases.map((b) => [b.x, b.y]).slice(0, 1)
      };
      this.db.put("op", op.id, op, { k1: String(me.plot), k2: String(to), at: now });
      this.db.put("fly", op.id, { id: op.id, at: op.arriveAt }, { at: op.arriveAt });
      return op;
    });
    if (detected) {
      const da = this.acct(to); if (da.settings.refill) this.deputy(them, da, now, true);
      const first = Math.min(...out.map((o) => o.arriveAt));
      this.note(to, "incoming", `🚨 إنذار عسكري: دفعة من ${nf(out.length)} ضربات من «${mine.town}» متجهة نحو مدينتك! أولها يوصل بعد ${minutesText(first - now)}.`, { op: out[0].id, from: me.plot });
    }
    return { ok: true, ops: out.map((o) => this.opPublic(o, me)), charge: ch, arsenal: a.arsenal, now };
  }

  launch(body, me) {
    const id = cleanReq(body.op);
    if (!id) return { error: "no operation id" };
    const pl = this.plan(body, me);
    if (pl.error) return pl;
    const { now, to, x, y, target, load, fee, a, mine, them, readyBases, readyPads, drones, missiles, flight } = pl;
    for (const [w, n] of Object.entries(load)) a.arsenal[w] -= n;
    if (Object.keys(load).some(isHeavy)) a.heavyLog = [...(a.heavyLog || []).filter((t) => now - t < this.cfg.heavyDay), now];
    if (drones) { const b = readyBases.sort((p, q) => q.lvl - p.lvl)[0]; a.reload[`b${b.x}:${b.y}`] = this.reloadAfter(a, `b${b.x}:${b.y}`, milStat("dronebase", b.lvl).reload, now); }
    if (missiles) { let left = missiles; for (const b of readyPads.sort((p, q) => q.lvl - p.lvl)) { if (left <= 0) break; left -= milStat("missilepad", b.lvl).cap; a.reload[`p${b.x}:${b.y}`] = this.reloadAfter(a, `p${b.x}:${b.y}`, milStat("missilepad", b.lvl).reload, now); } }
    this.breakShield(me.plot, a, now);
    const ch = this.charge(me.plot, a, fee, `تشغيل عملية على «${them.town}»`);
    this.saveAcct(me.plot, a);
    const theirP = this.profileOf(them);
    const seen = detects(theirP);
    const op = {
      id, from: me.plot, to, fromTown: mine.town, toTown: them.town, x, y, bid: target.id, blvl: target.lvl, bname: target.name,
      load, launchAt: now, arriveAt: now + flight, status: "flying", fee, value: pl.value, detected: seen,
      pads: pl.readyPads.map((b) => [b.x, b.y]).slice(0, 2), bases: pl.readyBases.map((b) => [b.x, b.y]).slice(0, 1)
    };
    this.db.put("op", id, op, { k1: String(me.plot), k2: String(to), at: now });
    this.db.put("fly", id, { id, at: op.arriveAt }, { at: op.arriveAt });
    // the defender's deputy fills the batteries when the attack is seen coming (within the owner's budget)
    if (seen) { const da = this.acct(to); if (da.settings.refill) this.deputy(them, da, now, true); }
    if (seen) this.note(to, "incoming", `🚨 إنذار عسكري: تم رصد هجوم من «${mine.town}» متجه نحو مدينتك! يوصل بعد ${minutesText(flight)}.`, { op: id, from: me.plot });
    return { ok: true, op: this.opPublic(op, me), charge: ch, arsenal: a.arsenal, now };
  }

  /** Decide every attack whose time has come (called on every request; each attack is decided once). */
  /** When the next operation in flight arrives (for the server's alarm), or 0. */
  nextArrival() {
    const all = [...this.db.list("fly", {}), ...this.db.list("cmarch", {})];
    return all.length ? Math.min(...all.map((f) => f.at)) : 0;
  }
  settle() {
    const now = this.now();
    try { this.settleCastle(now); } catch { /* the castle never stops the war */ }
    for (const f of this.db.list("fly", { upTo: now })) {
      const op = this.db.get("op", f.id);
      this.db.del("fly", f.id);
      if (!op || op.status !== "flying") continue;
      this.resolve(op, now);
    }
  }

  resolve(op, now) {
    const them = this.townInfo(op.to), res = { hits: [], dmg: 0, intcUsed: 0, before: 0, after: 0, blocked: "" };
    const da = this.acct(op.to);
    const weapons = WEAPON_IDS.flatMap((w) => Array(op.load[w] || 0).fill(w)).sort((p, q) => WEAPONS[p].kind === WEAPONS[q].kind ? 0 : WEAPONS[p].kind === "missile" ? -1 : 1);
    const key = `${op.to}:${op.x}:${op.y}`, row = this.db.get("dmg", key);
    const before = row ? this.wdNow(row, now) : 0;
    res.before = before;
    if (!them) res.blocked = "gone";
    else if (this.shieldUntil(them, now)) res.blocked = "shield";
    else if (this.awayBlock(them, now)) res.blocked = "away";
    else if (relNow(this.rel(op.from, op.to), now, this.cfg).state !== "war") res.blocked = "truce";
    const p = them ? this.profileOf(them) : null;
    // every weapon that gets through bursts on the spot: the buildings in its radius take a share of its damage
    const dmgMap = this.damage(op.to), area = new Map(), list = them ? them.snap.list.filter((b) => !(b.build > 0)) : [];
    const wdOf = (b) => { const k = `${b.x}:${b.y}`; if (!area.has(k)) { const r0 = dmgMap.get(k); area.set(k, { x: b.x, y: b.y, id: b.id, lvl: b.lvl || 0, before: r0 ? (r0.flat ? 100 : this.wdNow(r0, now)) : 0, wasFlat: !!r0?.flat, dmg: 0 }); } return area.get(k); };
    for (const w of weapons) {
      const h = { w, intercepted: false, tried: false, dmg: 0, chance: 0, reach: 0 };
      if (!res.blocked && p) {
        const chance = interceptChance(p, w), need = isHeavy(w) ? this.cfg.heavyIntc : 1;
        if (chance > 0 && da.arsenal.intc >= need) {
          h.tried = true; h.chance = Math.round(chance * 100); da.arsenal.intc -= need; res.intcUsed += need;
          if (this.rand() < chance) h.intercepted = true;
        }
        if (!h.intercepted && isHeavy(w)) { // everything in its reach falls to rubble
          for (const b of blastArea(list, op.x, op.y, WEAPONS[w].blast)) { if (B[b.id]?.cat === "road") continue; const a = wdOf(b); if (a.flat || a.before >= 100 && a.wasFlat) continue; a.flat = true; a.dmg = Math.max(a.dmg, 100 - a.before, 1); h.reach++; }
          h.dmg = 100; h.heavy = true;
        } else if (!h.intercepted) {
          const base = hitDamage(w, this.rand());
          for (const b of blastArea(list, op.x, op.y, WEAPONS[w].blast || 0.7)) {
            const a = wdOf(b), room = Math.min(this.cfg.caps.perOp - a.dmg, this.cfg.caps.building - a.before - a.dmg);
            const add = Math.max(0, Math.min(room, Math.round(base * b.f)));
            a.dmg += add; if (add) h.reach++;
          }
          h.dmg = base;
        }
      }
      res.hits.push(h);
    }
    const hurt = [...area.values()].filter((a) => a.dmg > 0 && !a.wasFlat).map((a) => ({ ...a, after: a.flat ? 100 : Math.min(this.cfg.caps.building, a.before + a.dmg) })).sort((p, q) => q.dmg - p.dmg);
    const centre = hurt.find((a) => a.x === op.x && a.y === op.y) || hurt[0];
    const dmg = hurt.length ? hurt[0].dmg : 0;
    res.area = hurt.map(({ x, y, id, dmg: d, before: b0, after, flat }) => ({ x, y, id, dmg: d, before: b0, after, ...(flat ? { flat: true } : {}) }));
    res.flat = hurt.filter((a) => a.flat).length; // buildings left as rubble
    res.dmg = dmg; res.before = centre ? centre.before : before; res.after = centre ? centre.after : before;
    // the people of the houses hit leave them until they are repaired (in the game's numbers)
    res.displaced = them ? hurt.filter((a) => a.id === "house").reduce((n, a) => { const t = them.snap.list.find((b) => b.x === a.x && b.y === a.y); return n + Math.round((t?.res || 0) * Math.min(1, a.dmg / 85)); }, 0) : 0;
    // the dead and the injured: the people of every building reached, by its damage (fewer when the sirens warned them)
    if (them) {
      let dead = 0, hurtN = 0;
      for (const a of hurt) { const t = them.snap.list.find((b) => b.x === a.x && b.y === a.y) || { id: a.id }; const c = casualties(t, a.dmg, op.detected, this.cfg); dead += c.dead; hurtN += c.hurt; }
      res.dead = Math.round(dead); res.hurt = Math.round(hurtN);
    }
    // spoils of war: every economic building hit pays the attacker a share of its repair
    res.spoils = Math.round(hurt.filter((a) => economic(a.id)).reduce((n, a) => n + repairCostOf(a.id, a.dmg, this.cfg), 0) * SPOILS);
    if (res.spoils > 0) { const fa = this.acct(op.from); this.charge(op.from, fa, -res.spoils, `غنيمة حرب من «${op.toTown}»`); this.saveAcct(op.from, fa); }
    // the counts for the medals
    { const fa = this.acct(op.from), def = hurt.filter((a) => a.id === "airdef" || a.id === "radar").length;
      if (dmg > 0) { this.stat(fa, "hits"); if (def) this.stat(fa, "defHits", def); this.saveAcct(op.from, fa); this.medalCache = null; }
      const stopped = res.hits.filter((h) => h.intercepted).length; if (stopped) this.stat(da, "intc", stopped); }
    res.airdef = p ? p.airdefs.filter((x) => x.wd < 85).length : 0; // working batteries (to tell "no defence" from "no interceptors")
    res.intcValue = res.intcUsed * this.cfg.interceptor.price;
    if (dmg > 0) {
      for (const a of hurt) this.db.put("dmg", `${op.to}:${a.x}:${a.y}`, { x: a.x, y: a.y, bid: a.id, wd: a.after, by: op.from, at: now, ...(a.flat ? { flat: true, lvl: a.lvl } : {}) }, { k1: String(op.to), at: now });
      this.db.put("hit", op.id, { x: op.x, y: op.y, at: now, from: op.from, dmg: hurt.reduce((n, a) => n + a.dmg, 0) }, { k1: String(op.to), at: now });
    }
    res.state = damageState(res.after).name;
    op.status = "done"; op.result = res; op.doneAt = now;
    this.db.put("op", op.id, op, { k1: String(op.from), k2: String(op.to), at: op.launchAt });
    // notifications for both sides
    const intercepted = res.hits.filter((h) => h.intercepted).length, total = res.hits.length;
    if (res.blocked) {
      const why = { gone: "الهدف ما عاد موجود", shield: "المدينة دخلت درع الحماية", truce: "دخلت الهدنة قبل الوصول", away: "صاحبها غايب وأخذت حدها من الضربات" }[res.blocked];
      this.note(op.from, "result", `📋 عمليتك على «${op.toTown}» ما أصابت: ${why}.`, { op: op.id });
      this.note(op.to, "result", `🛡️ هجوم «${op.fromTown}» ما وصل: ${why}.`, { op: op.id });
    } else if (dmg > 0) {
      const many = res.flat ? ` وصار ${nf(res.flat)} ${res.flat === 1 ? "مبنى" : "مباني"} ركام` : res.area.length > 1 ? ` وتضرر ${nf(res.area.length)} مباني حوله` : "", gone = res.displaced ? `، ونزح ${nf(res.displaced)} ساكن من بيوتهم` : "";
      const toll = res.dead || res.hurt ? ` ⚰️ ${nf(res.dead)} وفاة و🤕 ${nf(res.hurt)} إصابة.` : "";
      this.note(op.to, "hit", `💥 ضربة عسكرية من «${op.fromTown}» على ${op.bname}${many} (أكبر ضرر ${nf(dmg)}٪)${gone}.${toll}${intercepted ? ` (دفاعك اعترض ${nf(intercepted)} من ${nf(total)})` : ""}`, { op: op.id, x: op.x, y: op.y });
      this.note(op.from, "result", `🎯 إصابة ناجحة على ${op.bname} في «${op.toTown}»${many} (أكبر ضرر ${nf(dmg)}٪).${toll}${res.spoils ? ` 💰 غنيمة ${nf(res.spoils)} ريال.` : ""}`, { op: op.id });
      this.news("hit", `${res.flat ? `🌋 «${op.fromTown}» سوّت ${nf(res.flat)} ${res.flat === 1 ? "مبنى" : "مباني"} بالأرض` : `💥 «${op.fromTown}» ضربت ${op.bname}`} في «${op.toTown}»${res.dead || res.hurt ? `: ${nf(res.dead)} وفاة و${nf(res.hurt)} إصابة` : ""}`, op.to);
    } else {
      this.note(op.to, "intercept", `🛡️ دفاعاتك نجحت في اعتراض هجوم «${op.fromTown}».`, { op: op.id });
      this.note(op.from, "result", `🛡️ دفاع «${op.toTown}» اعترض عمليتك.`, { op: op.id });
      this.news("intercept", `🛡️ دفاع «${op.toTown}» صدّ هجوم «${op.fromTown}»`, op.to);
    }
    // the deputy: repairs and interceptors within the owner's daily budget
    if (them) this.deputy(them, da, now);
    else this.saveAcct(op.to, da);
  }

  deputy(info, a, now, refillOnly = false) {
    const day = Math.floor(now / (24 * 3600000));
    if (a.spent.day !== day) a.spent = { day, amt: 0 };
    const left = () => a.settings.budget - a.spent.amt;
    if (a.settings.refill) {
      const p = this.profileOf(info), room = capacity(p).intc - a.arsenal.intc;
      const n = Math.min(room, Math.floor(left() / this.cfg.interceptor.price), Math.floor(this.available(info, a) / this.cfg.interceptor.price));
      if (n > 0) {
        a.arsenal.intc += n; a.spent.amt += n * this.cfg.interceptor.price;
        this.charge(info.plot, a, n * this.cfg.interceptor.price, `النائب اشترى ${nf(n)} صواريخ اعتراضية`);
        this.note(info.plot, "deputy", `🧑‍💼 النائب عبّى الدفاع الجوي بـ${nf(n)} صواريخ اعتراضية (${nf(n * this.cfg.interceptor.price)} ريال).`);
      }
    }
    if (a.settings.repair && !refillOnly) {
      for (const r of [...this.damage(info.plot).values()].sort((p, q) => q.wd - p.wd)) {
        if (r.rep || r.flat) continue;
        const cost = repairCostOf(r.bid, r.wd, this.cfg);
        if (cost > left() || cost > this.available(info, a)) continue;
        this.startRepair(info.plot, r, a, cost, now, true);
        a.spent.amt += cost;
      }
    }
    this.saveAcct(info.plot, a);
  }

  startRepair(plot, r, a, cost, now, byDeputy) {
    const ms = repairMsOf(r.wd, this.cfg);
    this.db.put("dmg", `${plot}:${r.x}:${r.y}`, { x: r.x, y: r.y, bid: r.bid, wd: r.wd, by: r.by, at: r.at, rep: { start: now, end: now + ms, from: r.wd } }, { k1: String(plot), at: now });
    this.charge(plot, a, cost, `${byDeputy ? "النائب بدأ " : ""}إصلاح ${B[r.bid]?.name || "مبنى"}`);
    this.note(plot, "repair", `🔧 ${byDeputy ? "النائب بدأ " : "بدأ "}إصلاح ${B[r.bid]?.name || "مبنى"} (${nf(cost)} ريال)، يخلص بعد ${minutesText(ms)}.`, { x: r.x, y: r.y });
    return ms;
  }

  repair(body, me) {
    const x = Math.round(Number(body.x)), y = Math.round(Number(body.y)), now = this.now();
    const info = this.townInfo(me.plot), r = this.damage(me.plot).get(`${x}:${y}`);
    if (!r) return { error: "ما فيه ضرر هنا" };
    if (r.flat) return { error: "هذا ركام: ما يتصلح، شيله وابنِ من جديد" };
    if (r.rep) return { error: "يتصلح الحين" };
    const a = this.acct(me.plot), cost = repairCostOf(r.bid, r.wd, this.cfg);
    if (this.available(info, a) < cost) return { error: "ما يكفي المال" };
    const ms = this.startRepair(me.plot, r, a, cost, now, false);
    this.saveAcct(me.plot, a);
    return { ok: true, ms, charge: this.db.get("charge", `${me.plot}:${a.seq}`) };
  }
  /** Clear the rubble a destructive weapon left: paid now, done after a while; then the land is empty to build on. */
  clearRubble(body, me) {
    const x = Math.round(Number(body.x)), y = Math.round(Number(body.y)), now = this.now();
    const info = this.townInfo(me.plot), key = `${me.plot}:${x}:${y}`, r = this.db.get("dmg", key);
    if (!r?.flat) return { error: "ما فيه ركام هنا" };
    if (r.clr) return { error: now >= r.clr.end ? "انشال الركام" : "يتشال الحين" };
    const a = this.acct(me.plot), cost = rubbleCostOf(r.bid, r.lvl, this.cfg), name = r.bid === "house" ? "مبنى سكني" : B[r.bid]?.name || "مبنى";
    if (!info || this.available(info, a) < cost) return { error: "ما يكفي المال" };
    const ms = rubbleMsOf(this.cfg);
    this.db.put("dmg", key, { ...r, clr: { start: now, end: now + ms } }, { k1: String(me.plot), at: now });
    this.charge(me.plot, a, cost, `شيل ركام ${name}`);
    this.saveAcct(me.plot, a);
    this.note(me.plot, "repair", `🧹 بدأ شيل ركام ${name} (${nf(cost)} ريال)، يخلص بعد ${minutesText(ms)}، وبعدها تقدر تبني مكانه.`, { x, y });
    return { ok: true, ms, charge: this.db.get("charge", `${me.plot}:${a.seq}`) };
  }
}

/** Storage for the war tables in a SQLite Durable Object (one generic table, rows kept as JSON). */
export function sqlWarDb(sql) {
  sql.exec(`CREATE TABLE IF NOT EXISTS war (tbl TEXT, id TEXT, k1 TEXT, k2 TEXT, at INTEGER, data TEXT, PRIMARY KEY (tbl, id))`);
  sql.exec(`CREATE INDEX IF NOT EXISTS war_k1 ON war (tbl, k1, at)`);
  sql.exec(`CREATE INDEX IF NOT EXISTS war_k2 ON war (tbl, k2, at)`);
  sql.exec(`CREATE INDEX IF NOT EXISTS war_at ON war (tbl, at)`);
  const rows = (cur) => cur.toArray().map((r) => JSON.parse(r.data));
  return {
    get: (tbl, id) => { const r = sql.exec("SELECT data FROM war WHERE tbl = ? AND id = ?", tbl, id).toArray()[0]; return r ? JSON.parse(r.data) : null; },
    put: (tbl, id, row, k = {}) => { sql.exec("INSERT OR REPLACE INTO war (tbl, id, k1, k2, at, data) VALUES (?, ?, ?, ?, ?, ?)", tbl, id, k.k1 ?? null, k.k2 ?? null, k.at ?? 0, JSON.stringify(row)); },
    del: (tbl, id) => { sql.exec("DELETE FROM war WHERE tbl = ? AND id = ?", tbl, id); },
    delK1: (tbl, k1) => { sql.exec("DELETE FROM war WHERE tbl = ? AND k1 = ?", tbl, k1); },
    rowsOf: (k) => sql.exec("SELECT tbl, id, k1, k2, at, data FROM war WHERE k1 = ? OR k2 = ?", k, k).toArray().map((r) => ({ ...r, row: JSON.parse(r.data) })),
    rowsNaming: (plot) => sql.exec("SELECT tbl, id, k1, k2, at, data FROM war WHERE tbl IN ('dmg', 'hit') AND k1 != ?", String(plot)).toArray()
      .map((r) => ({ ...r, row: JSON.parse(r.data) })).filter((r) => r.row.by === plot || r.row.from === plot),
    list: (tbl, q = {}) => {
      const where = ["tbl = ?"], args = [tbl];
      if (q.k1 != null) { where.push("k1 = ?"); args.push(q.k1); }
      if (q.k2 != null) { where.push("k2 = ?"); args.push(q.k2); }
      if (q.either != null) { where.push("(k1 = ? OR k2 = ?)"); args.push(q.either, q.either); }
      if (q.upTo != null) { where.push("at <= ?"); args.push(q.upTo); }
      if (q.since != null) { where.push("at > ?"); args.push(q.since); }
      return rows(sql.exec(`SELECT data FROM war WHERE ${where.join(" AND ")} ORDER BY at DESC LIMIT ${Math.max(1, Math.min(500, q.limit || 500))}`, ...args));
    }
  };
}

/** The same storage in memory (the trial copy and the tests). */
export function memWarDb(seed) {
  const t = seed || {};
  const key = (tbl) => (t[tbl] ||= {});
  return {
    dump: () => t,
    get: (tbl, id) => (key(tbl)[id] ? JSON.parse(JSON.stringify(key(tbl)[id].row)) : null),
    put: (tbl, id, row, k = {}) => { key(tbl)[id] = { row: JSON.parse(JSON.stringify(row)), k1: k.k1 ?? null, k2: k.k2 ?? null, at: k.at ?? 0 }; },
    del: (tbl, id) => { delete key(tbl)[id]; },
    delK1: (tbl, k1) => { for (const [id, r] of Object.entries(key(tbl))) if (r.k1 === k1) delete key(tbl)[id]; },
    rowsOf: (k) => Object.entries(t).flatMap(([tbl, rows]) => Object.entries(rows).filter(([, r]) => r.k1 === k || r.k2 === k).map(([id, r]) => ({ tbl, id, k1: r.k1, k2: r.k2, at: r.at, row: JSON.parse(JSON.stringify(r.row)) }))),
    rowsNaming: (plot) => ["dmg", "hit"].flatMap((tbl) => Object.entries(key(tbl)).filter(([, r]) => r.k1 !== String(plot) && (r.row.by === plot || r.row.from === plot)).map(([id, r]) => ({ tbl, id, k1: r.k1, k2: r.k2, at: r.at, row: JSON.parse(JSON.stringify(r.row)) }))),
    list: (tbl, q = {}) => Object.values(key(tbl))
      .filter((r) => (q.k1 == null || r.k1 === q.k1) && (q.k2 == null || r.k2 === q.k2) && (q.either == null || r.k1 === q.either || r.k2 === q.either)
        && (q.upTo == null || r.at <= q.upTo) && (q.since == null || r.at > q.since))
      .sort((a, b) => b.at - a.at).slice(0, Math.max(1, Math.min(500, q.limit || 500))).map((r) => JSON.parse(JSON.stringify(r.row)))
  };
}
