// The TRIAL copy only (scripts/bundle.mjs --preview): a practice world of al-Jouf that lives inside the
// page, so the owner can try «صراع الجوف» from one file before anything goes live. It answers the
// game's /api/world/* calls itself, with the same war server (js/warserver.js) the live site runs,
// shorter waits, and three rival towns played by simple bots. Nothing here is ever sent anywhere.
const PV_KEY = "rafaya-trial-world";
const PV_CFG = fastWar(20);
Object.assign(WAR, PV_CFG); // the game shows the same short waits the trial server uses
const pvLoad = () => { try { return JSON.parse(localStorage.getItem(PV_KEY) || "null"); } catch { return null; } };
const pvState = pvLoad() || { players: {}, plots: {}, comments: [], war: {}, bots: false, made: Date.now() };
const pvSave = () => { try { localStorage.setItem(PV_KEY, JSON.stringify({ ...pvState, war: pvDb.dump() })); } catch { /* full: the trial still runs */ } };
const pvDb = memWarDb(pvState.war);
const pvWorld = {
  town: (plot) => { const t = pvState.plots[plot]; return t ? { ...t } : null; },
  player: (name) => pvState.players[name] || null,
  news: (kind, text, plot) => pvNews(kind, text, plot)
};
/** The trial's world bulletin, like the live one (src/worker.js news()). */
function pvNews(kind, text, plot = null, n = null) {
  pvState.news ||= [];
  if (n != null && pvState.news.some((x) => x.kind === kind && x.plot === plot && x.n === n)) return;
  pvState.news.push({ id: (pvState.news[pvState.news.length - 1]?.id || 0) + 1, kind, plot, n, text, at: Date.now() });
  pvState.news = pvState.news.slice(-300);
}
const pvWar = new WarServer(pvDb, pvWorld, { cfg: PV_CFG });
const pvHour = () => Math.floor((Date.now() - Date.UTC(2026, 10, 1)) / 75000) + 3; // the trial's world is slow from its start

/** A rival town with roads, homes, a power station, factories and a military base. */
function pvTown(name, plot, owner, era, mil) {
  const s = newGame(plot * 13 + 7, { site: "world", name, terrain: "plain" });
  s.day = pvHour(); s.world = { plot, owner, start: s.day }; s.era = era; s.money = 400000; s.pop = era >= 2 ? 1600 : 400; s.war = { seq: 0 };
  const put = (x, y, id, lvl = 0) => { const t = s.tiles[idx(x, y)]; t.t = "sand"; t.b = { id, lvl, res: id === "house" ? 8 : 0, cond: 100 }; };
  for (let x = 18; x < 54; x++) { put(x, 30, "asphalt"); put(x, 38, "road"); }
  for (let y = 30; y < 39; y++) put(36, y, "road");
  for (let x = 19; x < 52; x += 2) { if (x === 35 || x === 37) continue; put(x, 31, "house", x % 3 ? 3 : 2); put(x, 37, "house", x % 4 ? 2 : 4); }
  put(22, 29, "mosque"); put(30, 29, "school"); put(26, 29, "clinic"); put(34, 29, "park");
  put(40, 29, "generator"); put(43, 29, "factory"); put(46, 29, "workshop"); put(49, 29, "tank"); put(38, 39, "datefactory"); put(41, 39, "mall");
  mil(put);
  return s;
}
function pvMakeBots() {
  if (pvState.bots) return;
  const bots = [
    { name: "أبو_مشعل", town: "هجرة الشعيب", at: [18, 12], era: 2, mood: "enemy", mil: (put) => { put(22, 39, "milhq", 1); put(25, 39, "dronebase", 1); put(28, 39, "missilepad", 1); put(31, 39, "radar", 1); put(33, 39, "airdef", 1); put(44, 39, "airdef"); } },
    { name: "أبو_تركي", town: "النبك", at: [10, 18], era: 2, mood: "calm", mil: (put) => { put(22, 39, "milhq"); put(25, 39, "radar"); put(28, 39, "airdef"); } },
    { name: "سالم_الحربي", town: "الخضراء", at: [21, 19], era: 1, mood: "loud", mil: (put) => { put(22, 39, "milhq"); put(25, 39, "dronebase"); } }
  ];
  for (const b of bots) {
    const plot = worldPlot(b.at[0], b.at[1]);
    const s = pvTown(b.town, plot, b.name, b.era, b.mil);
    pvState.players[b.name] = { name: b.name, plot, created: Date.now() - 3 * 86400000, bot: b.mood };
    pvState.plots[plot] = { plot, owner: b.name, town: b.town, terrain: "plain", pop: s.pop, happy: 62, money: s.money, era: b.era, updated: Date.now(), snapshot: pack(s) };
    const a = pvWar.acct(plot);
    a.arsenal = { drone: b.mood === "enemy" ? 4 : 1, drone2: 0, missile: b.mood === "enemy" ? 2 : 0, missile2: 0, intc: b.mood === "loud" ? 0 : 6 };
    a.settings = { repair: true, refill: true, budget: 20000 };
    pvWar.saveAcct(plot, a);
  }
  pvState.bots = true;
  pvSave();
}

/** The bots: the enemy declares war once you have a command centre and strikes now and then; the others answer offers. */
function pvBots() {
  const me = Object.values(pvState.players).find((p) => !p.bot && p.plot != null);
  if (!me || !pvState.plots[me.plot]?.snapshot) return;
  const mine = snapBuildings(pvState.plots[me.plot].snapshot);
  const hasHQ = mine.list.some((b) => b.id === "milhq");
  for (const bot of Object.values(pvState.players).filter((p) => p.bot)) {
    const rel = relNow(pvDb.get("rel", bot.plot < me.plot ? `${bot.plot}:${me.plot}` : `${me.plot}:${bot.plot}`), Date.now(), PV_CFG);
    const act = (a, extra = {}) => pvWar.handle("rel", { req: `bot${Date.now()}${Math.random()}`, other: me.plot, act: a, ...extra }, bot);
    // answering offers: truces always after a little while, peace from the calm ones (the enemy rarely)
    if (rel.offer && rel.offer.by === me.plot && Date.now() - rel.offer.at > 15000) {
      const yes = rel.offer.kind === "truce" || bot.bot !== "enemy" || Math.random() < 0.3;
      act(yes ? "accept" : "reject");
      continue;
    }
    if (bot.bot === "loud" && hasHQ && rel.state === "peace" && Math.random() < 0.3) act("threat", { text: Math.floor(Math.random() * 6) });
    if (bot.bot !== "enemy" || !hasHQ || (mine.era || 0) < 1) continue;
    if (rel.state === "peace" || rel.state === "tension") act("hostile");
    else if (rel.state === "hostile") act("war");
    else if (rel.state === "war") {
      const last = pvState.lastStrike || 0;
      if (Date.now() - last < 100000) continue;
      const targets = mine.list.filter((b) => canTarget(b.id) && !(b.build > 0));
      if (!targets.length) continue;
      const pref = targets.filter((b) => ["generator", "powerplant", "factory", "airdef", "radar", "dronebase", "missilepad", "milhq"].includes(b.id));
      const t = (pref.length ? pref : targets)[Math.floor(Math.random() * (pref.length || targets.length))];
      const a = pvWar.acct(bot.plot);
      a.arsenal.drone = Math.max(a.arsenal.drone, 2); a.arsenal.missile = Math.max(a.arsenal.missile, 1); pvWar.saveAcct(bot.plot, a);
      const load = Math.random() < 0.35 ? { missile: 1 } : { drone: Math.random() < 0.5 ? 2 : 1 };
      const r = pvWar.handle("launch", { op: `bot${Date.now()}`, to: me.plot, x: t.x, y: t.y, load }, bot);
      if (r.ok) pvState.lastStrike = Date.now();
    }
  }
  pvSave();
}

/** The trial's chat: your messages, and now and then a word from the bots. */
function pvChat(name, plot, text) {
  pvState.chat ||= [];
  const id = (pvState.chat[pvState.chat.length - 1]?.id || 0) + 1;
  pvState.chat.push({ id, name, plot, town: pvState.plots[plot]?.town || "", text, at: Date.now() });
  pvState.chat = pvState.chat.slice(-200);
}
const PV_LINES = ["السلام عليكم يا أهل الجوف", "أحد عنده مسيّرات للبيع؟ 😄", "الهدنة أحسن لنا كلنا", "مدينتي صارت محافظة الحمدلله", "ترى الرادار حقي صاحي", "وش أحسن مكان للمزارع؟", "الله يجمعنا على خير"];
setInterval(() => { const bots = Object.values(pvState.players).filter((p) => p.bot); if (bots.length && Math.random() < 0.25) { const b = bots[Math.floor(Math.random() * bots.length)]; pvChat(b.name, b.plot, PV_LINES[Math.floor(Math.random() * PV_LINES.length)]); pvSave(); } }, 15000);

/** The trial's answer to every /api call the game makes. */
async function pvApi(path, body) {
  await new Promise((r) => setTimeout(r, 60)); // a little like a network
  const p = path.split("/").filter(Boolean); // ["world", ...]
  if (p[0] !== "world") throw new Error("404");
  pvMakeBots();
  const res = pvRoute(p.slice(1), body || null);
  pvSave();
  return res;
}
function pvRoute(p, body) {
  const post = !!body;
  if (!post && p[0] === "clock") return { epoch: Date.UTC(2026, 10, 1), now: Date.now(), gen: 2, slowAt: Date.UTC(2026, 10, 1) };
  if (!post && p[0].startsWith("chat")) {
    const after = Number((p[0].split("after=")[1]) || 0);
    pvState.chat ||= [];
    return { messages: after ? pvState.chat.filter((m) => m.id > after) : pvState.chat.slice(-50), now: Date.now() };
  }
  if (!post && p[0].startsWith("news")) {
    pvState.news ||= [];
    if (!pvState.news.length) for (const t of Object.values(pvState.plots)) pvNews("town", `🏕️ تأسست «${t.town}» بأرض الجوف. حيّاهم الله`, t.plot, 0);
    return { items: pvState.news.slice(-60).reverse(), now: Date.now() };
  }
  if (!post && p[0] === "map") return { plots: Object.values(pvState.plots).map(({ snapshot, ...t }) => t) };
  if (!post && p[0] === "town") {
    const t = pvState.plots[Number(p[1])];
    if (!t) throw new Error("404");
    return { town: t, comments: pvState.comments.filter((c) => c.plot === t.plot).slice(-30).reverse(), damage: pvWar.publicDamage(t.plot) };
  }
  if (p[0] === "join") {
    const name = String(body.name || "").trim();
    if (name.length < 3) throw new Error("400");
    if (pvState.players[name]) throw new Error("409");
    pvState.players[name] = { name, secret: "trial", plot: null, created: Date.now() };
    return { name, secret: "trial", recovery: "TRIAL0000000" };
  }
  if (p[0] === "recover") { const pl = pvState.players[body.name]; if (!pl) throw new Error("403"); return { name: pl.name, secret: "trial", plot: pl.plot }; }
  const me = pvState.players[body?.name];
  if (!me) throw new Error("403");
  if (p[0] === "claim") {
    if (me.plot != null) throw new Error("409");
    if (pvState.plots[body.plot]) throw new Error("409");
    if (Object.values(pvState.plots).some((t) => townNameKey(t.town) === townNameKey(body.town))) throw new Error("422");
    me.plot = Number(body.plot);
    pvState.plots[me.plot] = { plot: me.plot, owner: me.name, town: body.town || "هجرة", terrain: body.terrain || "plain", pop: 9, happy: 55, money: 0, era: 0, updated: Date.now(), snapshot: "" };
    pvNews("town", `🏕️ تأسست «${pvState.plots[me.plot].town}» بأرض الجوف. حيّاهم الله`, me.plot, 0);
    return { ok: true, plot: me.plot };
  }
  if (p[0] === "sync") {
    const t = pvState.plots[me.plot];
    if (!t) throw new Error("400");
    if ((body.era || 0) > (t.era || 0) && ERAS[body.era]) pvNews("era", `🏙️ «${t.town}» صارت ${ERAS[body.era].name}!`, me.plot, body.era);
    Object.assign(t, { pop: body.pop, happy: body.happy, money: body.money, era: body.era, updated: Date.now() });
    if (body.snapshot) t.snapshot = body.snapshot;
    return { ok: true, town: t.town };
  }
  if (p[0] === "rename") {
    const t = pvState.plots[me.plot], town = String(body.town || "").trim().slice(0, 20);
    if (!t) throw new Error("400");
    if (t.renamed) return { error: "غيّرت الاسم قبل، ما يتغير مرة ثانية" };
    if (town.length < 2) return { error: "الاسم ما يصلح" };
    if (townNameKey(town) === townNameKey(t.town)) return { error: "هذا نفس الاسم" };
    if (Object.values(pvState.plots).some((o) => o.plot !== t.plot && townNameKey(o.town) === townNameKey(town))) return { error: "الاسم مأخوذ لمدينة ثانية بالجوف، اختر غيره" };
    pvNews("rename", `✏️ «${t.town}» صار اسمها «${town}»`, t.plot, 0);
    t.town = town; t.renamed = 1;
    return { ok: true, town };
  }
  if (p[0] === "town" && p[2] === "comment") { pvState.comments.push({ plot: Number(p[1]), author: me.name, text: String(body.text || "").slice(0, 200), at: Date.now() }); return { ok: true }; }
  if (p[0] === "chat") {
    const text = String(body.text || "").replace(/[<>]/g, "").trim().slice(0, 200);
    if (!text) return { error: "اكتب شي" };
    pvChat(me.name, me.plot, text);
    return { ok: true };
  }
  if (p[0] === "report") return { ok: true };
  if (p[0] === "war") return pvWar.handle(p[1], body, me);
  throw new Error("404");
}

/** The trial's town: already a city (مدينة) with streets, homes, power and factories, and money to build a base. */
function pvReadyTown(s) {
  const put = (x, y, id, lvl = 0) => { const t = s.tiles[idx(x, y)]; t.t = t.t === "wadi" || t.t === "lake" ? "sand" : t.t === "rock" ? "sand" : t.t; t.b = { id, lvl, res: id === "house" ? 8 : 0, cond: 100 }; };
  for (let x = 19; x < 53; x++) { put(x, 27, "asphalt"); put(x, 35, "road"); }
  for (let y = 27; y < 36; y++) { put(26, y, "road"); put(44, y, "road"); }
  for (let x = 20; x < 52; x += 2) { if ([26, 44].includes(x)) continue; put(x, 28, "house", x % 3 ? 3 : 2); put(x, 34, "house", 2); }
  put(21, 26, "mosque"); put(24, 26, "school"); put(28, 26, "clinic"); put(31, 26, "park"); put(34, 26, "bigmosque");
  put(47, 26, "factory"); put(50, 26, "workshop"); put(29, 36, "datefactory"); put(33, 36, "mall"); put(37, 36, "souq");
  // water and power for everyone: a desalination plant and two wind farms between the streets
  put(36, 31, "desal"); put(29, 31, "windfarm"); put(41, 31, "windfarm"); put(40, 26, "generator"); put(22, 31, "tank"); put(50, 31, "tank");
  s.era = 2; s.money = 300000; s.pop = 0; s.tech = { ...(s.tech || {}), asphalt: true, wind: true, desal: true };
  return s;
}

globalThis.RAFAYA_PREVIEW = pvApi;
globalThis.RAFAYA_PREVIEW_TOWN = pvReadyTown;
setInterval(() => { try { pvWar.settle(); pvBots(); } catch (e) { console.warn(e); } }, 8000);
/** Start the trial world again from nothing (from the menu note). */
globalThis.RAFAYA_PREVIEW_RESET = () => { for (const k of [PV_KEY, "rafaya-world-id", "rafaya-world-town"]) localStorage.removeItem(k); for (const k of Object.keys(localStorage)) if (k.startsWith("rafaya-war-")) localStorage.removeItem(k); location.reload(); };

// a note on the menu: this is the trial, and a way to start it again
{
  const pvNote = document.createElement("div");
  pvNote.className = "pv-note";
  pvNote.innerHTML = `<b>🧪 نسخة تجريبية لـ«صراع الجوف»</b><small>عالم الجوف هنا تجريبي داخل الملف، فيه ٣ مدن خصوم، والأوقات أقصر عشان تجرب بسرعة. ما ينرسل شي للموقع.</small><button type="button" class="btn" id="pvReset">ابدأ العالم التجريبي من جديد</button>`;
  document.getElementById("menu")?.prepend(pvNote);
  document.getElementById("pvReset")?.addEventListener("click", (e) => { if (!e.target.dataset.sure) { e.target.dataset.sure = "1"; e.target.textContent = "متأكد؟ اضغط مرة ثانية"; return; } globalThis.RAFAYA_PREVIEW_RESET(); });
}
