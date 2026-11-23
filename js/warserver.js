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
  hitDamage, repairCostOf, repairMsOf, relNow, relActions, conflictBlocker, minutesText, snapBuildings, milStat, THREATS, REL_NAMES, damageState
} from "./war.js";

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
  saveAcct(plot, a) { this.db.put("acct", String(plot), a, { k1: String(plot), at: this.now() }); }
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
      const wd = this.wdNow(r, now);
      if (wd <= 0) { this.db.del("dmg", `${plot}:${r.x}:${r.y}`); continue; }
      out.set(`${r.x}:${r.y}`, { ...r, wd });
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
  note(plot, kind, text, extra = {}) {
    const at = this.now();
    this.db.put("note", `${plot}:${at}:${(noteN = (noteN + 1) % 1e6)}`, { at, kind, text, ...extra }, { k1: String(plot), at });
  }
  /** A line for the world's bulletin (everyone reads it): only wars, truces, peace and strikes, never who is online. */
  news(kind, text, plot) { try { this.world?.news?.(kind, text, plot); } catch { /* the bulletin never stops the war */ } }
  rel(a, b) { return this.db.get("rel", pairId(a, b)); }
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
  /** Shield: a town that took too many hits lately cannot be hit again for a while. Returns the end time or 0. */
  shieldUntil(info, now = this.now()) {
    const hits = this.db.list("hit", { k1: String(info.plot) }).filter((h) => now - h.at < this.cfg.caps.cityWindow);
    const away = now - (info.updated || 0) > this.cfg.away;
    const max = away ? this.cfg.caps.awayMax : this.cfg.caps.cityMax;
    if (hits.length < max) return 0;
    const last = Math.max(...hits.map((h) => h.at));
    return last + this.cfg.caps.shield > now ? last + this.cfg.caps.shield : 0;
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
      case "op": return this.opView(String(body.op || ""), me);
      case "repair": return this.once(me.plot, body.req, () => this.repair(body, me));
      case "settings": return this.settings(body, me);
      case "enemy": return { view: this.enemyView(me, Math.round(Number(body.plot))) };
      default: return { error: "not found" };
    }
  }

  // ---------- reading ----------
  state(body, me) {
    const now = this.now(), info = this.townInfo(me.plot), a = this.acct(me.plot);
    const p = info ? this.profileOf(info) : milProfile([]);
    const rels = this.db.list("rel", { either: String(me.plot) }).map((r) => {
      const other = r.a === me.plot ? r.b : r.a, o = this.townInfo(other), v = relNow(r, now, this.cfg);
      return { other, town: o?.town || "مدينة", owner: o?.owner || "", era: o?.era || 0, ...v, hist: (r.hist || []).slice(-20) };
    }).filter((r) => r.state !== "peace" || r.hist.length);
    const ops = this.db.list("op", { either: String(me.plot), limit: 40 }).map((o) => this.opPublic(o, me));
    const notes = this.db.list("note", { k1: String(me.plot), limit: 60 }); // the newest 60 (the game knows which it has seen)
    const charges = this.db.list("charge", { k1: String(me.plot) }).filter((c) => c.seq > (Number(body.seq) || 0)).sort((x, y) => x.seq - y.seq);
    const dmg = [...this.damage(me.plot).values()];
    return {
      now, arsenal: a.arsenal, caps: capacity(p), settings: a.settings, reload: a.reload, seq: a.seq,
      profile: { hq: p.hq, bases: p.bases, pads: p.pads, radars: p.radars, airdefs: p.airdefs, armory: p.armory, era: p.era },
      rels, ops, notes, charges, damage: dmg, shield: info ? this.shieldUntil(info, now) : 0,
      intercept: Object.fromEntries(WEAPON_IDS.map((w) => [w, interceptChance(p, w)]))
    };
  }
  /** War damage of any town (for visitors and the town itself). */
  publicDamage(plot) {
    this.settle();
    return [...this.damage(plot).values()].map((r) => ({ x: r.x, y: r.y, bid: r.bid, wd: r.wd, rep: r.rep || null }));
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
      if (!p.airdefs.length) return { error: "تحتاج بطارية دفاع جوي" };
      price = this.cfg.interceptor.price; room = caps.intc - a.arsenal.intc;
    } else {
      const why = weaponBlocker(p, kind);
      if (why) return { error: why };
      price = WEAPONS[kind].price;
      const drones = a.arsenal.drone + a.arsenal.drone2, missiles = a.arsenal.missile + a.arsenal.missile2;
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
    const block = conflictBlocker(mineEra, themEra, now, this.cfg);
    const stored = this.rel(me.plot, other);
    const r = { a: Math.min(me.plot, other), b: Math.max(me.plot, other), hist: [], lastThreat: {}, ...relNow(stored, now, this.cfg) };
    r.hist ||= []; r.lastThreat ||= {};
    const allowed = relActions(stored ? r : null, me.plot, now, block, this.cfg);
    if (!(act in allowed)) return { error: "طلب غير معروف" };
    if (allowed[act]) return { error: allowed[act] };
    const myName = mine.town, theirName = them.town;
    const log = (kind, text) => { r.hist.push({ at: now, by: me.plot, kind, text }); r.hist = r.hist.slice(-30); };
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
      r.state = "warning"; r.since = now; r.warStart = now + this.cfg.T.warning; r.warEnd = r.warStart + this.cfg.T.war; r.offer = null;
      log("war", "إعلان حرب");
      this.note(other, "war", `⚔️ مدينة «${myName}» أعلنت عليك الحرب! أول ضربة ممكنة بعد ${minutesText(this.cfg.T.warning)}. جهّز دفاعاتك.`, { from: me.plot });
      this.note(me.plot, "war", `⚔️ أعلنت الحرب على «${theirName}». أول ضربة ممكنة بعد ${minutesText(this.cfg.T.warning)}.`, { from: other });
      this.news("war", `⚔️ «${myName}» أعلنت الحرب على «${theirName}»`, other);
    } else if (act === "truce" || act === "peace") {
      r.offer = { kind: act, by: me.plot, at: now };
      log(act + "Offer", act === "truce" ? "عرض هدنة" : "عرض صلح");
      this.note(other, act + "Offer", act === "truce" ? `🏳️ «${myName}» تعرض عليك هدنة ${minutesText(this.cfg.T.truce)}.` : `🤝 «${myName}» تعرض عليك الصلح.`, { from: me.plot });
    } else if (act === "accept") {
      const kind = r.offer.kind; r.offer = null;
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
  plan(body, me) {
    const now = this.now(), to = Math.round(Number(body.to)), x = Math.round(Number(body.x)), y = Math.round(Number(body.y));
    const mine = this.townInfo(me.plot), them = this.townInfo(to);
    if (!mine?.snap.list.length) return { error: "زامن مدينتك أول" };
    if (!them) return { error: "ما لقيت المدينة" };
    const block = conflictBlocker({ ...mine, era: mine.snap.era || mine.era, created: me.created || mine.created }, { ...them, era: them.snap.era || them.era }, now, this.cfg);
    if (block) return { error: block };
    const r = relNow(this.rel(me.plot, to), now, this.cfg);
    if (r.state === "warning") return { error: `الحرب تبدأ بعد ${minutesText(r.warStart - now)}` };
    if (r.state !== "war") return { error: r.state === "truce" ? "فيه هدنة: ما يصير تضرب" : "ما فيه حرب مع هالمدينة" };
    const target = them.snap.list.find((b) => b.x === x && b.y === y);
    if (!target) return { error: "ما فيه مبنى هنا" };
    if (!canTarget(target.id)) return { error: "هذا مبنى مدني محمي: ما يصير تستهدفه" };
    if (target.build > 0) return { error: "المبنى تحت الإنشاء" };
    const shield = this.shieldUntil(them, now);
    if (shield) return { error: `المدينة عليها درع حماية: باقي ${minutesText(shield - now)}` };
    const rehits = this.db.list("hit", { k1: String(to) }).filter((h) => h.x === x && h.y === y && now - h.at < this.cfg.caps.rehitWindow);
    if (rehits.length >= this.cfg.caps.rehitMax) return { error: "هالمبنى انضرب كثير: محمي فترة" };
    const dmgRow = this.damage(to).get(`${x}:${y}`);
    if (dmgRow && dmgRow.wd >= this.cfg.caps.building) return { error: "المبنى متعطل أصلاً" };
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
    const drones = (load.drone || 0) + (load.drone2 || 0), missiles = (load.missile || 0) + (load.missile2 || 0);
    const readyBases = p.bases.filter((b) => b.wd < 85 && (a.reload[`b${b.x}:${b.y}`] || 0) <= now);
    const readyPads = p.pads.filter((b) => b.wd < 85 && (a.reload[`p${b.x}:${b.y}`] || 0) <= now);
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
    const flyingOut = this.db.list("op", { k1: String(me.plot), limit: 50 }).filter((o) => o.status === "flying").length;
    const ops = milStat("milhq", p.hq.lvl).ops;
    if (flyingOut >= ops) return { error: `القيادة تدير ${nf(ops)} عملية بالجو بس` };
    const flyingIn = this.db.list("op", { k2: String(to), limit: 50 }).filter((o) => o.status === "flying").length;
    if (flyingIn >= this.cfg.caps.inFlightTo) return { error: "الجو فوق المدينة زحمة عمليات: جرّب بعد شوي" };
    const fee = Object.entries(load).reduce((n, [w, k]) => n + WEAPONS[w].fee * k, 0);
    if (this.available(mine, a) < fee) return { error: "ما يكفي المال لتشغيل العملية" };
    const slowest = Object.keys(load).reduce((n, w) => Math.max(n, flightMs(me.plot, to, w, this.cfg)), 0);
    return { now, to, x, y, target, load, fee, a, p, mine, them, readyBases, readyPads, drones, missiles, flight: slowest, value: Object.entries(load).reduce((n, [w, k]) => n + WEAPONS[w].price * k, 0) };
  }

  launch(body, me) {
    const id = cleanReq(body.op);
    if (!id) return { error: "no operation id" };
    const pl = this.plan(body, me);
    if (pl.error) return pl;
    const { now, to, x, y, target, load, fee, a, mine, them, readyBases, readyPads, drones, missiles, flight } = pl;
    for (const [w, n] of Object.entries(load)) a.arsenal[w] -= n;
    if (drones) { const b = readyBases.sort((p, q) => q.lvl - p.lvl)[0]; a.reload[`b${b.x}:${b.y}`] = now + milStat("dronebase", b.lvl).reload * 60000; }
    if (missiles) { let left = missiles; for (const b of readyPads.sort((p, q) => q.lvl - p.lvl)) { if (left <= 0) break; left -= milStat("missilepad", b.lvl).cap; a.reload[`p${b.x}:${b.y}`] = now + milStat("missilepad", b.lvl).reload * 60000; } }
    const ch = this.charge(me.plot, a, fee, `تشغيل عملية على «${them.town}»`);
    this.saveAcct(me.plot, a);
    const theirP = this.profileOf(them);
    const seen = detects(theirP);
    const op = {
      id, from: me.plot, to, fromTown: mine.town, toTown: them.town, x, y, bid: target.id, blvl: target.lvl, bname: B[target.id].name,
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
  settle() {
    const now = this.now();
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
    const target = them?.snap.list.find((b) => b.x === op.x && b.y === op.y);
    const key = `${op.to}:${op.x}:${op.y}`, row = this.db.get("dmg", key);
    const before = row ? this.wdNow(row, now) : 0;
    res.before = before;
    if (!them || !target || target.id !== op.bid) res.blocked = "gone";
    else if (this.shieldUntil(them, now)) res.blocked = "shield";
    else if (relNow(this.rel(op.from, op.to), now, this.cfg).state !== "war") res.blocked = "truce";
    const p = them ? this.profileOf(them) : null;
    let dmg = 0;
    for (const w of weapons) {
      const h = { w, intercepted: false, tried: false, dmg: 0, chance: 0 };
      if (!res.blocked && p) {
        const chance = interceptChance(p, w);
        if (chance > 0 && da.arsenal.intc > 0) {
          h.tried = true; h.chance = Math.round(chance * 100); da.arsenal.intc -= 1; res.intcUsed += 1;
          if (this.rand() < chance) h.intercepted = true;
        }
        if (!h.intercepted) {
          const room = Math.min(this.cfg.caps.perOp - dmg, this.cfg.caps.building - before - dmg);
          h.dmg = Math.max(0, Math.min(room, hitDamage(w, this.rand())));
          dmg += h.dmg;
        }
      }
      res.hits.push(h);
    }
    res.dmg = dmg; res.after = Math.min(this.cfg.caps.building, before + dmg);
    res.airdef = p ? p.airdefs.filter((x) => x.wd < 85).length : 0; // working batteries (to tell "no defence" from "no interceptors")
    res.intcValue = res.intcUsed * this.cfg.interceptor.price;
    if (dmg > 0) {
      this.db.put("dmg", key, { x: op.x, y: op.y, bid: op.bid, wd: res.after, by: op.from, at: now }, { k1: String(op.to), at: now });
      this.db.put("hit", op.id, { x: op.x, y: op.y, at: now, from: op.from, dmg }, { k1: String(op.to), at: now });
    }
    res.state = damageState(res.after).name;
    op.status = "done"; op.result = res; op.doneAt = now;
    this.db.put("op", op.id, op, { k1: String(op.from), k2: String(op.to), at: op.launchAt });
    // notifications for both sides
    const intercepted = res.hits.filter((h) => h.intercepted).length, total = res.hits.length;
    if (res.blocked) {
      const why = { gone: "الهدف ما عاد موجود", shield: "المدينة دخلت درع الحماية", truce: "دخلت الهدنة قبل الوصول" }[res.blocked];
      this.note(op.from, "result", `📋 عمليتك على «${op.toTown}» ما أصابت: ${why}.`, { op: op.id });
      this.note(op.to, "result", `🛡️ هجوم «${op.fromTown}» ما وصل: ${why}.`, { op: op.id });
    } else if (dmg > 0) {
      this.note(op.to, "hit", `💥 تعرض ${op.bname} لضربة عسكرية من «${op.fromTown}» وتضرر بنسبة ${nf(dmg)}٪.${intercepted ? ` (دفاعك اعترض ${nf(intercepted)} من ${nf(total)})` : ""}`, { op: op.id, x: op.x, y: op.y });
      this.note(op.from, "result", `🎯 إصابة ناجحة: ${op.bname} في «${op.toTown}» تضرر ${nf(dmg)}٪.`, { op: op.id });
      this.news("hit", `💥 «${op.fromTown}» ضربت ${op.bname} في «${op.toTown}»`, op.to);
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
        if (r.rep) continue;
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
    if (r.rep) return { error: "يتصلح الحين" };
    const a = this.acct(me.plot), cost = repairCostOf(r.bid, r.wd, this.cfg);
    if (this.available(info, a) < cost) return { error: "ما يكفي المال" };
    const ms = this.startRepair(me.plot, r, a, cost, now, false);
    this.saveAcct(me.plot, a);
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
    list: (tbl, q = {}) => Object.values(key(tbl))
      .filter((r) => (q.k1 == null || r.k1 === q.k1) && (q.k2 == null || r.k2 === q.k2) && (q.either == null || r.k1 === q.either || r.k2 === q.either)
        && (q.upTo == null || r.at <= q.upTo) && (q.since == null || r.at > q.since))
      .sort((a, b) => b.at - a.at).slice(0, Math.max(1, Math.min(500, q.limit || 500))).map((r) => JSON.parse(JSON.stringify(r.row)))
  };
}
