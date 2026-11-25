// The TRIAL copy only (scripts/bundle.mjs --preview): a practice world of al-Jouf that lives inside the
// page, so the owner can try «صراع الجوف» from one file before anything goes live. It answers the
// game's /api/world/* calls itself, with the same war server (js/warserver.js) the live site runs,
// shorter waits, and three rival towns played by simple bots. Nothing here is ever sent anywhere.
const PV_KEY = "rafaya-visual-preview-v5"; // v5: the trial opens in الحاضرة الكبرى
globalThis.RAFAYA_PREVIEW_STORAGE = "rafaya-visual-preview-v5:";
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
const pvHour = () => Math.floor((Date.now() - Date.UTC(2026, 10, 1)) / 50000) + 3;

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
    { name: "أبو_مشعل", town: "هجرة الشعيب", at: [24, 12], era: 2, mood: "enemy", mil: (put) => { put(22, 39, "milhq", 1); put(25, 39, "dronebase", 1); put(28, 39, "missilepad", 1); put(31, 39, "radar", 1); put(33, 39, "airdef", 1); put(44, 39, "airdef"); } },
    { name: "أبو_تركي", town: "النبك", at: [16, 18], era: 2, mood: "calm", mil: (put) => { put(22, 39, "milhq"); put(25, 39, "radar"); put(28, 39, "airdef"); } },
    { name: "سالم_الحربي", town: "الخضراء", at: [27, 19], era: 1, mood: "loud", mil: (put) => { put(22, 39, "milhq"); put(25, 39, "dronebase"); } }
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

// ---------- war scenarios for the owner's review (trial only) ----------
// Each one puts the owner straight into a case, with the same war server the live site runs.
const pvMe = () => Object.values(pvState.players).find((p) => !p.bot && p.plot != null);
const pvBot = (mood) => Object.values(pvState.players).find((p) => p.bot === mood);
function pvSetEra(bot, era) {
  const t = pvState.plots[bot.plot];
  try {
    const o = JSON.parse(t.snapshot); o.era = era;
    // its command centre grows with it, so it can keep several operations in the air
    o.tiles = o.tiles.map((str) => { const q = String(str).split(":"); if (q[1] === "milhq") q[2] = String(era >= 3 ? 2 : era >= 2 ? 1 : 0); return q.join(":"); });
    t.snapshot = JSON.stringify(o);
  } catch { /* the bot keeps its stage */ }
  t.era = era;
}
/** Put two towns straight into a state (war starts now, no waiting), as if `by` had started it. */
function pvSetRel(by, other, state) {
  const now = Date.now(), a = Math.min(by.plot, other.plot), b = Math.max(by.plot, other.plot);
  const r = { a, b, state, since: now, hist: [{ at: now, by: by.plot, kind: state === "war" ? "war" : state, text: state === "war" ? "إعلان حرب" : state === "hostile" ? "إعلان عداوة" : "صلح" }], lastThreat: {}, offer: null };
  if (state === "war") { r.warStart = now - 1000; r.warEnd = now + PV_CFG.T.war; }
  if (state === "peace") { r.hist = []; r.cool = 0; }
  pvWar.saveRel(by.plot, other.plot, r);
}
function pvArm(plot, arsenal) { const a = pvWar.acct(plot); Object.assign(a.arsenal, arsenal); a.reload = {}; pvWar.saveAcct(plot, a); }
/** The owner's arsenal filled to what their stores hold (never past it). */
function pvFill(me) {
  const st = pvWar.handle("state", { since: 0, seq: 0 }, me);
  if (st.error) return;
  const a = pvWar.acct(me.plot), p = st.profile, c = st.caps;
  const can = (w) => !weaponBlocker(p, w);
  const drones = ["drone2", "drone"].filter(can), missiles = ["missile2", "missile"].filter(can);
  a.arsenal = { drone: 0, drone2: 0, missile: 0, missile2: 0, intc: p.airdefs.length ? c.intc : 0 };
  drones.forEach((w, i) => { a.arsenal[w] = i === drones.length - 1 ? c.drones - drones.slice(0, -1).reduce((n, x) => n + a.arsenal[x], 0) : Math.floor(c.drones / drones.length); });
  missiles.forEach((w, i) => { a.arsenal[w] = i === missiles.length - 1 ? c.missiles - missiles.slice(0, -1).reduce((n, x) => n + a.arsenal[x], 0) : Math.floor(c.missiles / missiles.length); });
  a.reload = {}; pvWar.saveAcct(me.plot, a);
}
/** Everything still in the air lands now (so a new scenario never waits on the last one's flights). */
function pvLandAll() {
  for (const f of pvDb.list("fly", {})) { const op = pvDb.get("op", f.id); if (op?.status === "flying") { op.arriveAt = Date.now() - 1; pvDb.put("op", op.id, op, { k1: String(op.from), k2: String(op.to), at: op.launchAt }); } pvDb.put("fly", f.id, { id: f.id, at: Date.now() - 1 }, { at: Date.now() - 1 }); }
  pvWar.settle();
}
function pvLaunchFrom(bot, load) {
  const me = pvMe(), mine = snapBuildings(pvState.plots[me.plot].snapshot);
  const t = mine.list.filter((b) => canTarget(b.id) && !(b.build > 0)).sort(() => Math.random() - .5)[0];
  pvArm(bot.plot, { drone: 6, drone2: 4, missile: 4, missile2: 2 });
  return t ? pvWar.handle("launch", { op: `sc${Date.now()}${Math.random()}`, to: me.plot, x: t.x, y: t.y, load }, bot) : { error: "no target" };
}
/** The bot fires at the owner's town: n operations at different buildings. Returns how many left. */
function pvStrike(bot, n, load) {
  pvLandAll();
  const me = pvMe(), mine = snapBuildings(pvState.plots[me.plot].snapshot);
  const targets = mine.list.filter((b) => canTarget(b.id) && !(b.build > 0)).sort(() => Math.random() - .5);
  let sent = 0, why = "";
  for (const t of targets) {
    if (sent >= n) break;
    pvArm(bot.plot, { drone: 6, drone2: 4, missile: 4, missile2: 2 });
    const r = pvWar.handle("launch", { op: `sc${Date.now()}${Math.random()}`, to: me.plot, x: t.x, y: t.y, load }, bot);
    if (r.ok) sent++; else why = r.error || why;
  }
  return { sent, why };
}
const PV_SCENARIOS = [
  ["small", "🎯 مدينة أصغر منك تعلن عليك الحرب وتضربك", "«الخضراء» (بلدة) تبدأ الحرب وتضرب. جرّب ترد عليها: حق الرد مسموح لأنها هي اللي بدأت.", () => {
    const me = pvMe(), bot = pvBot("loud"); pvSetEra(bot, 1); pvSetRel(bot, me, "war");
    const r = pvStrike(bot, 1, { drone: 1 }); pvFill(me);
    return { plot: null, msg: r.sent ? "«الخضراء» أعلنت الحرب وأطلقت مسيّرة عليك. ردّ عليها: «القيادة» ← «الخضراء» ← «استهداف المدينة»." : `أعلنت الحرب (ما قدرت تطلق: ${r.why})` };
  }],
  ["equal", "⚔️ حرب مع مدينة بنفس قوتك", "«هجرة الشعيب» تصير حاضرة وتدخل معك حرب مفتوحة، وتضربك بصاروخ.", () => {
    const me = pvMe(), bot = pvBot("enemy"); pvSetEra(bot, 4); pvSetRel(bot, me, "war");
    const r = pvStrike(bot, 1, { missile: 1 }); pvFill(me);
    return { plot: null, msg: r.sent ? "الحرب بدأت، وصاروخ جاي عليك. ردّ: «القيادة» ← «هجرة الشعيب» ← «استهداف المدينة»." : `الحرب بدأت (ما قدروا يطلقون: ${r.why})` };
  }],
  ["bully", "🛡️ أنت الأكبر: جرّب تبدأ على مدينة صغيرة", "ترجع «الخضراء» بسلام معك. جرّب تعلن عليها العداوة: اللعبة تمنعك لأنها أصغر منك بكثير.", () => {
    const me = pvMe(), bot = pvBot("loud"); pvSetEra(bot, 1); pvSetRel(me, bot, "peace");
    return { plot: bot.plot, msg: "«الخضراء» بسلام معك. جرّب «إعلان عداوة»." };
  }],
  ["wave", "💥 هجوم كبير: ثلاث ضربات بنفس الوقت", "«هجرة الشعيب» تطلق ثلاث عمليات على ثلاث مبانٍ عندك بنفس اللحظة.", () => {
    const me = pvMe(), bot = pvBot("enemy"); pvSetEra(bot, 4); pvSetRel(bot, me, "war");
    const r = pvStrike(bot, 3, { drone: 2 });
    return { plot: null, msg: r.sent ? `${r.sent} عمليات جاية عليك الحين` : `ما انطلقت: ${r.why}` };
  }],
  ["dry", "🔋 دفاعك بدون ذخيرة وجاك هجوم", "تنتهي صواريخ الاعتراض عندك، و«الخضراء» تضربك. تشوف الضرر وتجرب الإصلاح.", () => {
    const me = pvMe(), bot = pvBot("loud"); pvSetEra(bot, 4); pvSetRel(bot, me, "war");
    pvArm(me.plot, { intc: 0 }); const r = pvStrike(bot, 2, { drone: 2 });
    return { plot: null, msg: r.sent ? "ما عندك اعتراض، والضربات جاية. بعد ما توصل افتح المبنى المتضرر وجرّب الإصلاح." : `ما انطلقت: ${r.why}` };
  }],
  ["truce", "🏳️ عدوك يعرض عليك هدنة", "«هجرة الشعيب» بحرب معك وتعرض هدنة. اقبلها أو ارفضها.", () => {
    const me = pvMe(), bot = pvBot("enemy"); pvSetEra(bot, 4); pvSetRel(bot, me, "war");
    pvWar.handle("rel", { req: `sct${Date.now()}`, other: me.plot, act: "truce" }, bot);
    return { plot: bot.plot, msg: "وصلك عرض هدنة. افتح العلاقات واختر." };
  }],
  ["room", "⚔️ غرفة العمليات وسط معركة", "حرب مع «هجرة الشعيب» و«الخضراء»، ضربات جاية عليك، ترسانتك كاملة. جرّب الدفعة والتعبئة والتفاوض.", () => {
    const me = pvMe(), enemy = pvBot("enemy"), loud = pvBot("loud");
    pvSetEra(enemy, 4); pvSetEra(loud, 3); pvSetRel(enemy, me, "war"); pvSetRel(loud, me, "war");
    pvFill(me);
    pvStrike(enemy, 2, { missile: 1 });
    const r2 = pvLaunchFrom(loud, { drone: 2 }); void r2;
    pvWar.handle("rel", { req: `scr${Date.now()}`, other: me.plot, act: "truce" }, loud);
    return { plot: null, room: "attack", msg: "أنت وسط معركة: هجمات جاية عليك، وعدوين بحرب. جرّب كل شي من هنا." };
  }],
  ["arm", "📦 جهّز ترسانتي وزد فلوسي", "مسيّرات وصواريخ واعتراض كاملة، ومليون ريال زيادة.", () => {
    const me = pvMe(); pvFill(me);
    const home = typeof S !== "undefined" ? S : null; if (home) changeMoney(home, 1000000, "gift", "تجربة");
    return { plot: null, msg: "ترسانتك تعبّت لآخر سعة مخازنك وزادت فلوسك مليون." };
  }],
  ["peace", "🕊️ رجّع كل شي سلام", "تنتهي كل الحروب والعداوات مع كل المدن.", () => {
    const me = pvMe(); for (const bot of Object.values(pvState.players).filter((p) => p.bot)) pvSetRel(me, bot, "peace");
    return { plot: null, msg: "رجع السلام مع الكل." };
  }],
];
globalThis.RAFAYA_PREVIEW_SCENARIOS = () => {
  sheet(`<h2>🧪 سيناريوهات الحرب</h2><p class="hint">للتجربة بس: كل زر يحطك بحالة. تقدر تجرب وحدة بعد الثانية.</p>
    ${PV_SCENARIOS.map(([id, title, text]) => `<button class="btn block" type="button" data-sc="${id}">${title}<small>${text}</small></button>`).join("")}`, "scenarios");
  document.querySelectorAll("[data-sc]").forEach((b) => b.addEventListener("click", async () => {
    const sc = PV_SCENARIOS.find(([id]) => id === b.dataset.sc);
    let out;
    try { out = sc[3](); pvSave(); } catch (e) { toast(`ما زبط: ${e.message}`, "bad"); return; }
    closeSheet(); toast(out.msg, "goal");
    await warPoll(true);
    setTimeout(() => warRoom(out.room || (out.plot != null ? "talk" : "log")), 500); // every scenario lands in the war room
    if (out.plot != null) ROOM.talk = out.plot;
  }));
};

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
  if (!post && p[0] === "clock") return { epoch: Date.UTC(2026, 10, 1), now: Date.now(), gen: 2, slowAt: Date.UTC(2026, 10, 1), fastAt: Date.UTC(2026, 10, 1) };
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
  if (post && p[0] === "me") { const pl = pvState.players[body?.name]; return { name: body?.name, started: pl?.created || Date.now() - 3 * 86400000, played: pl?.played ?? 4 * 3600 + 25 * 60, renamed: !!pl?.renamed }; } // the trial: the player's own time
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
  if (p[0] === "newname") { // the player's own name, once only (like the live one)
    if (me.renamed) return { error: "غيّرت اسمك قبل، ما يتغير مرة ثانية" };
    const newName = String(body.newName || "").trim().slice(0, 16);
    if (newName.length < 3) return { error: "الاسم ما يصلح. اختر لقب مناسب للعبة (٣ حروف وأكثر)" };
    if (newName === me.name) return { error: "اكتب اسم غير اسمك الحالي" };
    if (pvState.players[newName]) return { error: "هالاسم مأخوذ، اختر غيره" };
    delete pvState.players[me.name];
    const old = me.name; me.name = newName; me.renamed = 1; pvState.players[newName] = me;
    if (me.plot != null && pvState.plots[me.plot]) pvState.plots[me.plot].owner = newName;
    for (const c of pvState.comments) if (c.author === old) c.author = newName;
    pvSave();
    return { ok: true, name: newName };
  }
  if (p[0] === "move") { // like the live one: the whole town to empty land (once only)
    const from = me.plot, to = Number(body.plot), t = pvState.plots[from];
    if (!t) return { error: "ما عندك مدينة تنقلها" };
    if (!(to >= 0 && to < WORLD.cols * WORLD.rows) || to === from) return { error: "اختر أرض ثانية فاضية" };
    if (pvState.plots[to]) return { error: "الأرض انأخذت، اختر غيرها" };
    if (t.moved) return { error: "نقلت مدينتك قبل، النقل مرة وحدة بس" };
    if (pvWar.inFlight(from)) return { error: "فيه عملية حربية بالجو تخص مدينتك، انتظر لين توصل" };
    delete pvState.plots[from];
    pvState.plots[to] = { ...t, plot: to, moved: 1 };
    if (t.snapshot) try { const o = JSON.parse(t.snapshot); o.world.plot = to; pvState.plots[to].snapshot = JSON.stringify(o); } catch { /* kept */ }
    me.plot = to;
    for (const c of pvState.comments) if (c.plot === from) c.plot = to;
    pvWar.moveTown(from, to);
    const was = worldPlace(from), now = worldPlace(to);
    pvNews("move", `🚚 «${me.name}» هاجر بمدينته «${t.town}» من ${was} إلى ${was === now ? `أرض ثانية في ${now}` : now}`, to);
    pvSave();
    return { ok: true, plot: to, from };
  }
  if (p[0] === "sync") {
    const t = pvState.plots[me.plot];
    if (!t) throw new Error("400");
    if (t.restarted && (Number(body.restartAt) || 0) < t.restarted) return { ok: false, restarted: t.restarted, town: t.town };
    if ((body.era || 0) > (t.era || 0) && ERAS[body.era]) pvNews("era", `🏙️ «${t.town}» صارت ${ERAS[body.era].name}!`, me.plot, body.era);
    Object.assign(t, { pop: body.pop, happy: body.happy, money: body.money, era: body.era, updated: Date.now() });
    if (body.snapshot) t.snapshot = body.snapshot;
    return { ok: true, town: t.town };
  }
  if (p[0] === "restart") {
    const t = pvState.plots[me.plot];
    if (!t) return { error: "ما عندك مدينة" };
    pvWar.resetTown(me.plot);
    Object.assign(t, { pop: 9, happy: 55, money: 0, era: 0, snapshot: "", updated: Date.now() });
    t.restarted = Date.now();
    pvNews("restart", `🔄 «${t.town}» بدأت من جديد. الله يوفقهم`, me.plot);
    return { ok: true, restarted: t.restarted };
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

/** A playable sample with an old quarter, a planted avenue, an oasis and a newer district. */
const PV_SCENES = [
  { title: "الشارع ليلًا", x: 38, y: 35, zoom: 1.54 },
  { title: "الواحة", x: 37, y: 37, zoom: .88 },
  { title: "الدوار", x: 40, y: 35, zoom: 1.54 },
  { title: "السوق والجامع", x: 36, y: 35, zoom: 1.42 },
  { title: "البيوت الأولى", x: 31, y: 37, zoom: 1.47 },
  { title: "الفلل والأبراج", x: 36.5, y: 30, zoom: 1.37 },
  { title: "الخدمات العامة", x: 36, y: 24, zoom: 1.27 },
  { title: "المزارع والحلال", x: 24, y: 33, zoom: 1.21 },
  { title: "المصانع والطاقة", x: 48, y: 35, zoom: 1.22 },
  { title: "المطار والمعالم", x: 26, y: 44, zoom: 1.18 },
  { title: "الأبراج والترفيه", x: 38, y: 48, zoom: 1.16 },
  { title: "الساحة والنوافير", x: 44, y: 27, zoom: 1.28 },
  { title: "المنشآت العسكرية", x: 49, y: 44, zoom: 1.23 },
];

function pvReadyTown(s) {
  for (let y = 25; y <= 45; y++) for (let x = 26; x <= 47; x++) {
    const t = s.tiles[idx(x, y)];
    t.b = null;
    if (t.t === "rock" || t.t === "wadi") t.t = "sand";
  }
  const put = (x, y, id, lvl = 0) => {
    const t = s.tiles[idx(x, y)];
    t.t = "sand";
    const res = id === "house" ? [3, 6, 10, 16, 42, 92, 170, 255][lvl] : 0;
    t.b = { id, lvl, res, cond: 100 };
  };
  for (let x = 29; x <= 44; x++) {
    put(x, 35, x > 31 && x < 41 ? "avenue" : "asphalt");
    if (x <= 42) put(x, 30, "asphalt");
    if (x <= 36) put(x, 39, "road");
  }
  for (const x of [32, 40]) for (let y = 30; y <= 39; y++) put(x, y, x === 32 && y > 35 ? "road" : "asphalt");
  put(32, 35, "signal"); put(40, 35, "roundabout"); put(40, 30, "signal");
  [
    [34,34,"heritage"], [35,34,"souq"], [36,34,"bigmosque"], [37,34,"cafe",1], [38,34,"grocery",1],
    [33,36,"lantern"], [34,36,"cafe"], [35,36,"streetpalm"], [36,36,"bigfountain"], [37,36,"streetpalm"], [38,36,"park"],
    [34,37,"house",1], [35,37,"flowers"], [36,37,"olivetree"], [37,37,"flowers"], [38,37,"house",3],
    [29,36,"house",0], [30,36,"house",0], [31,36,"mosque"], [31,37,"house",1], [31,38,"house",0],
    [33,38,"house",1], [34,38,"house",2], [35,38,"well"],
    [33,31,"house",3], [34,31,"house",4], [35,31,"library"], [36,31,"house",4], [37,31,"school"], [38,31,"clinic"], [39,31,"house",3],
    [34,32,"park"], [36,32,"streetpalm"], [38,32,"park"], [35,33,"flowers"], [37,33,"streetpalm"],
    [30,29,"tank"], [31,29,"windfarm"], [33,29,"desal"], [35,29,"mall"], [37,29,"house",5], [39,29,"hotel"],
    [41,31,"oilpress"], [42,31,"olive"], [41,33,"house",2], [42,34,"palms"], [43,34,"palms"], [44,34,"datefactory"],
    [41,36,"fountain"], [42,36,"house",3], [43,36,"house",4], [44,36,"workshop"], [41,37,"park"], [42,37,"desal"], [43,32,"powerplant"],
    [41,34,"gate"], [43,33,"tower"], [38,38,"house",3], [37,38,"house",2], [28,32,"generator"], [28,33,"windfarm"], [28,35,"marid"], [30,40,"pen"], [32,40,"palms"], [33,41,"palms"],
  ].forEach((args) => put(...args));
  for (let y = 38; y <= 47; y++) for (let x = 36; x <= 47; x++) {
    const t = s.tiles[idx(x, y)];
    if (t.b) continue;
    const d = ((x - 41.0 + (y - 42) * 0.69) / 3.8) ** 2 + ((y - 42) / 2.75) ** 2;
    if (d < 1) t.t = "lake";
    else if (d < 2.1) t.t = "wadi";
  }
  put(44, 40, "dam"); put(40, 39, "palms"); put(39, 39, "olive"); put(43, 38, "palms");
  for (const [x,y] of [[35,41],[36,42],[35,43],[36,43],[37,44],[38,45],[31,42],[32,43],[33,43],[33,45],[45,41],[46,40],[46,41]]) {
    s.tiles[idx(x,y)].t = "rock";
  }
  for (let x = 30; x <= 46; x++) put(x, 24, "asphalt");
  for (let y = 24; y < 30; y++) put(40, y, "asphalt");
  for (let x = 20; x <= 29; x++) put(x, 34, "road");
  put(29, 33, "road");
  for (let x = 45; x <= 51; x++) put(x, 35, "asphalt");
  for (let y = 35; y <= 45; y++) put(47, y, "asphalt");
  for (let y = 39; y <= 48; y++) put(32, y, "asphalt");
  for (let x = 21; x <= 32; x++) put(x, 44, "asphalt");
  for (let x = 32; x <= 42; x++) put(x, 48, x < 35 ? "asphalt" : "avenue");
  for (let x = 47; x <= 52; x++) put(x, 45, "asphalt");
  [
    [32,23,"stadium"], [34,23,"university"], [36,23,"hospital"], [38,23,"library"], [39,25,"civil"],
    [35,25,"police"], [37,25,"parking"], [38,26,"school"], [35,27,"bank",2], [37,27,"clinic"],
    [33,25,"mall",2], [34,27,"mandi",2], [31,25,"vault",3],
    [42,23,"streetpalm"], [43,23,"lantern"], [41,26,"dallah"], [43,26,"fountain"],
    [45,26,"incense"], [42,28,"olivetree"], [44,28,"bigfountain"], [46,28,"flowers"],
    [21,32,"olive"], [23,32,"pivot"], [25,32,"veg"], [27,32,"palms"],
    [21,35,"pen"], [23,35,"livestock"], [25,35,"veg"], [27,35,"well"], [23,36,"olive"],
    [47,34,"quarry"], [49,34,"blockfactory"], [51,34,"mill"], [46,36,"generator"],
    [48,36,"factory"], [49,37,"dairy"], [50,36,"solar"], [51,37,"windfarm"], [46,37,"pole"],
    [48,38,"powerplant"], [51,33,"tank"], [52,35,"desal"],
    [22,43,"airport"], [25,43,"station"], [28,43,"bigstadium"], [26,45,"parking"], [28,45,"mazayen"],
    [34,47,"lantern"], [37,47,"themepark"], [40,47,"skyline"], [35,49,"mandi"], [37,49,"hotel",2],
    [38,49,"streetpalm"], [40,49,"fountain"],
    [48,44,"milhq",2], [50,44,"dronebase",2], [52,44,"radar",2],
    [48,46,"armory"], [50,46,"airdef",2], [52,46,"missilepad",2]
  ].forEach((args) => put(...args));
  s.tiles[idx(47,34)].t = "rock";
  s.tiles[idx(44,40)].t = "wadi";
  s.lake = 84;
  pvGreaterCity(s, put);
  s.pop = s.tiles.reduce((sum, t) => sum + (t.b?.res || 0), 0);
  s.tech = { ...s.tech, asphalt: true, wind: true, desal: true };
  s.cam = { x: 2, z: -15.5, zoom: innerWidth < 560 ? 0.62 : 0.74, yawTarget: 0.79 };
  return s;
}

/**
 * الحاضرة الكبرى for the owner's review: a district north of the old town with every new landmark and the
 * new towers along a highway, the old landmarks in their big versions, and some left to upgrade by hand
 * (a vault, houses, a desalination and a power plant, the old avenue), with money to do it.
 */
function pvGreaterCity(s, put) {
  for (const p of PLOTS) (s.owned ||= {})[p.id] = true;
  for (let y = 13; y <= 22; y++) for (let x = 23; x <= 50; x++) { const t = s.tiles[idx(x, y)]; t.b = null; if (t.t !== "sand") t.t = "sand"; }
  for (let x = 23; x <= 50; x++) { put(x, 18, "avenue", 1); put(x, 15, "asphalt"); put(x, 21, "asphalt"); }
  for (const x of [23, 30, 40, 50]) for (let y = 15; y <= (x === 40 ? 23 : 22); y++) if (y !== 18) put(x, y, "asphalt");
  [
    [24,16,"house",6], [25,16,"house",7], [26,16,"house",6], [27,16,"house",7], [28,16,"house",6], [29,16,"house",7],
    [24,17,"house",7], [25,17,"streetpalm"], [26,17,"civic_tower"], [27,17,"lantern"], [28,17,"house",6], [29,17,"house",6],
    [31,16,"civic_offices"], [32,16,"house",6], [33,16,"house",7], [34,16,"civic_culture"], [35,16,"house",7], [36,16,"house",6],
    [31,17,"house",7], [32,17,"olivetree"], [33,17,"house",6], [34,17,"flowers"], [35,17,"house",5], [36,17,"house",5],
    [37,16,"civic_expo"], [38,16,"house",6], [39,16,"house",7], [37,17,"house",5], [38,17,"streetpalm"], [39,17,"house",6],
    [41,16,"house",7], [42,16,"house",6], [43,16,"house",7], [44,16,"house",6], [45,16,"house",7], [46,16,"house",6],
    [41,17,"house",6], [42,17,"bigfountain"], [44,17,"house",7], [45,17,"lantern"], [46,17,"house",6],
    [47,16,"house",7], [48,16,"house",6], [49,16,"lantern"], [47,17,"house",6], [48,17,"house",7], [49,17,"house",6],
    [24,19,"vault",5], [25,19,"vault",5], [26,19,"vault",5], [27,19,"vault",5], [28,19,"vault",4],
    [24,20,"mosque"], [25,20,"school"], [26,20,"clinic"], [27,20,"park"], [28,20,"house",5], [29,19,"house",6], [29,20,"police"],
    [31,19,"civic_water"], [33,19,"civic_energy"], [35,19,"civic_freight"], [32,19,"pole"], [34,19,"pole"],
    [31,20,"house",6], [32,20,"house",7], [33,20,"house",6], [34,20,"house",7], [35,20,"house",6], [36,19,"mosque"], [36,20,"house",6],
    [37,19,"school"], [38,19,"clinic"], [39,19,"police"], [37,20,"house",7], [38,20,"house",6], [39,20,"house",7],
    [41,19,"house",6], [42,19,"house",7], [43,19,"house",6], [44,19,"house",7], [45,19,"house",6], [46,19,"house",7],
    [41,20,"house",7], [42,20,"house",6], [43,20,"house",7], [44,20,"house",6], [45,20,"house",7], [46,20,"house",6],
    [47,19,"house",7], [48,19,"house",6], [49,19,"house",7], [47,20,"house",6], [48,20,"house",7], [49,20,"house",6],
    [24,22,"house",6], [25,22,"house",7], [26,22,"house",6], [27,22,"house",7], [28,22,"house",6], [29,22,"house",7],
    [31,22,"house",6], [32,22,"house",7], [33,22,"house",6], [34,22,"house",7], [35,22,"house",6], [36,22,"house",7],
    [41,22,"house",7], [42,22,"house",6], [43,22,"house",7], [44,22,"house",6], [45,22,"house",7], [46,22,"house",6],
  ].forEach((args) => put(...args));
  // the old landmarks in their big versions (left at the old level: one desalination, one power plant, the town's avenue)
  for (const [x, y, id, lvl] of [[33,25,"mall",1], [36,23,"hospital",4], [34,23,"university",1], [22,43,"airport",1], [25,43,"station",1],
    [28,43,"bigstadium",1], [40,47,"skyline",1], [37,47,"themepark",1], [52,35,"desal",1], [48,38,"powerplant",1]]) put(x, y, id, lvl);
  for (let x = 35; x <= 42; x++) put(x, 48, "avenue", 1);
  s.era = 5; s.money = 3000000;
}

function pvSample() {
  const name = "عمدة_التجربة", town = "واحة الرافعية", plot = worldPlot(25, 14), secret = "trial";
  const state = pvReadyTown(newGame(89213, { name: town, site: "world", terrain: "plain" }));
  state.day = pvHour();
  state.world = { plot, owner: name, start: state.day };
  pvState.players[name] = { name, plot, secret, created: Date.now() };
  pvState.plots[plot] = { plot, owner: name, town, terrain: state.terrain, pop: state.pop, happy: state.happy, money: state.money, era: state.era, updated: Date.now(), snapshot: pack(state) };
  pvSave();
  return { id: { name, secret, plot }, town: state };
}

globalThis.RAFAYA_PREVIEW = pvApi;
globalThis.RAFAYA_PREVIEW_TOWN = pvReadyTown;
globalThis.RAFAYA_PREVIEW_SAMPLE = pvSample;
let pvLight = 2;
let pvWeather = 2;
const pvWeatherModes = [
  { label: "مطر", rain: 1, wet: 1 },
  { label: "بعد المطر", rain: 0, wet: 0.7 },
  { label: "صحو", rain: 0, wet: 0 },
];
const pvLighting = [{ label: "العصر", time: 0.62 }, { label: "الغروب", time: 0.735 }, { label: "الليل", time: 0.9 }];
globalThis.RAFAYA_PREVIEW_LIGHT = () => pvLighting[pvLight].time;
globalThis.RAFAYA_PREVIEW_WEATHER = () => pvWeatherModes[pvWeather];
setInterval(() => { try { pvWar.settle(); pvBots(); } catch (e) { console.warn(e); } }, 8000);
/** Start the trial world again without touching other game saves. */
globalThis.RAFAYA_PREVIEW_RESET = () => {
  try { for (const k of Object.keys(localStorage)) if (k === PV_KEY || k.startsWith(globalThis.RAFAYA_PREVIEW_STORAGE)) localStorage.removeItem(k); } catch { /* storage can be disabled */ }
  location.reload();
};
{
  document.body.classList.add("visual-preview");
  document.querySelector(".menu-eyebrow").textContent = "تجربة الرافعية الجديدة";
  document.querySelector(".menu-sub").textContent = "تجربة الحاضرة الكبرى: لف وقرّب، وجرّب الليل والنهار";
  document.getElementById("mPlayLabel").dataset.start = "ادخل الحاضرة الكبرى";
  document.getElementById("mPlayHint").dataset.start = "مدينة جاهزة للاستكشاف والبناء • حفظ محلي";
  const scen = document.createElement("button");
  scen.type = "button"; scen.id = "pvScenarios"; scen.textContent = "🧪 سيناريوهات الحرب";
  scen.style.cssText = "position:fixed;z-index:30;left:12px;bottom:calc(96px + env(safe-area-inset-bottom));padding:8px 12px;border-radius:14px;border:0;background:#7a2e2e;color:#fff;font:700 13px Almarai,system-ui;box-shadow:0 2px 8px #0005";
  scen.addEventListener("click", () => globalThis.RAFAYA_PREVIEW_SCENARIOS());
  document.body.append(scen);
  const reset = document.createElement("button");
  reset.type = "button"; reset.className = "pv-reset"; reset.textContent = "أعد التجربة من البداية";
  reset.addEventListener("click", () => { if (confirm("ترجع المدينة التجريبية لبدايتها؟")) globalThis.RAFAYA_PREVIEW_RESET(); });
  document.querySelector(".menu-actions").append(reset);
  const lighting = document.createElement("button");
  lighting.type = "button"; lighting.className = "pv-light";
  lighting.textContent = `الإضاءة · ${pvLighting[pvLight].label}`;
  lighting.addEventListener("click", () => {
    pvLight = (pvLight + 1) % pvLighting.length;
    lighting.textContent = `الإضاءة · ${pvLighting[pvLight].label}`;
  });
  const weather = document.createElement("button");
  weather.type = "button"; weather.className = "pv-light";
  weather.textContent = `الجو · ${pvWeatherModes[pvWeather].label}`;
  weather.addEventListener("click", () => {
    pvWeather = (pvWeather + 1) % pvWeatherModes.length;
    weather.textContent = `الجو · ${pvWeatherModes[pvWeather].label}`;
  });
  const angle = document.createElement("select");
  angle.className = "pv-light pv-scenes";
  angle.setAttribute("aria-label", "مشاهد المدينة");
  angle.append(new Option("المشاهد", "", true, true));
  angle.options[0].disabled = true;
  PV_SCENES.forEach((scene, i) => angle.append(new Option(scene.title, i)));
  angle.addEventListener("change", () => {
    const next = PV_SCENES[Number(angle.value)], world = globalThis.__world;
    if (!world || !next) return;
    world.view.zoom = next.zoom;
    world.focus(next.x, next.y);
    angle.value = "";
  });
  const controls = document.createElement("div");
  controls.className = "pv-controls";
  controls.append(weather, lighting, angle);
  document.body.append(controls);
}
