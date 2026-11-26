// «غرفة العمليات»: everything of a war in one screen. Up top a live strip of every operation in the air
// (ours and theirs, with their countdowns) and a small map of the front; below, five tabs: a batch attack on
// several targets at once, defence and refilling, the enemies, negotiation, and the log with the damage to
// repair. Alerts never throw the mayor out of it; a scene they choose to watch brings them back after.
import { $, S, ar, closeSheet, money, sheet, sheetFor, visiting, worldMode } from "./main.js";
import { WARX, sceneMode, setSceneMode, weaponIcon, warApi, warNow, warPoll, warReq, warSyncNow, secLeft, fmtLeft, relTimer, weaponsText, replayOp, warDefenseScene, warSalvoScene, salvoOf, followTown, launcherTimes, warRepairAt, warSheet, startTargeting, stateTag } from "./ui-war.js";
import { api, me } from "./ui-online.js";
import { row, toast } from "./ui-build.js";
import { sfx } from "./sound.js";
import { unpack } from "./sim.js";
import { B, ERAS, WORLD, worldXY } from "./data.js";
import { WAR, WEAPONS, WEAPON_IDS, weaponBlocker, relActions, REL_NAMES, REL_ICONS, canTarget, TARGETS, flightMs, damageState, tributeMax, eraGap } from "./war.js";

export const ROOM = { tab: "attack", enemy: null, talk: null, sel: null, form: "", pick: {}, towns: new Map(), tick: null, back: false };
const TABS = [["attack", "🎯 هجوم"], ["world", "🗺️ الجوف والتفاوض"], ["def", "🛡️ الدفاع والدرع"], ["log", "📜 السجل"]];

/** The operations to show in the strip: in the air, and those that landed in the last three minutes. */
function liveOps(st) {
  const now = warNow();
  return (st?.ops || []).filter((o) => o.status === "flying" || (o.doneAt && now - o.doneAt < 3 * 60000))
    .sort((a, b) => (a.status === "flying" ? 0 : 1) - (b.status === "flying" ? 0 : 1) || a.arriveAt - b.arriveAt);
}
function chip(o) {
  const out = o.side === "out", r = o.result, now = warNow();
  const what = o.status === "flying" ? (o.arriveAt - now > 500 ? `⏱ ${secLeft(o.arriveAt - now)}` : "💥 يوصل الحين") : r?.blocked ? "ما أصابت" : r?.dmg ? `💥 ${ar(r.area?.length || 1)} · ${ar(r.dmg)}٪` : "🛡️ انعترضت";
  return `<button type="button" class="wr-chip ${out ? "out" : "in"} ${o.status === "flying" ? "fly" : "done"}" data-wrop="${o.id}"><small>${o.bname}</small><span>${weaponsText(o.load)}</span><i>${what}</i></button>`;
}
function stripHtml(st) {
  const list = liveOps(st);
  if (!list.length) return `<p class="wr-quiet">◉ الأجواء هادية · ما فيه عمليات بالجو</p>`;
  // grouped: every town attacking us, then our own operations by target, so several attackers stay readable
  const groups = new Map();
  for (const o of list) { const k = `${o.side}:${o.side === "in" ? o.from : o.to}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); }
  return [...groups.values()].sort((a, b) => (a[0].side === "in" ? 0 : 1) - (b[0].side === "in" ? 0 : 1)).map((g) => {
    const o = g[0], flying = g.filter((x) => x.status === "flying"), next = flying.sort((a, b) => a.arriveAt - b.arriveAt)[0];
    return `<div class="wr-group ${o.side}"><div class="wr-gh"><b>${o.side === "in" ? `⬅️ من «${o.fromTown}»` : `➡️ على «${o.toTown}»`}</b><small>${ar(g.length)} ${g.length > 1 ? "ضربات" : "ضربة"}${next && next.arriveAt - warNow() > 500 ? ` · أقربها ${secLeft(next.arriveAt - warNow())}` : ""}</small></div>
      <div class="wr-gl">${g.map(chip).join("")}</div></div>`;
  }).join("");
}
/**
 * The front, drawn as a plan (not to scale, so names never overlap): our town on the right, the towns we are
 * in conflict with spread down the left, and every operation in the air on its own curved path.
 */
function mapHtml(st) {
  const mine = me()?.plot, rels = (st?.rels || []).filter((r) => r.state !== "peace");
  const others = [...new Set([...rels.map((r) => r.other), ...liveOps(st).flatMap((o) => [o.from, o.to]).filter((p) => p !== mine)])];
  const W = 340, H = Math.max(120, 46 + others.length * 40);
  const me0 = [W - 62, H / 2];
  const pos = new Map(others.map((p, i) => [p, [70, others.length === 1 ? H / 2 : 30 + i * ((H - 60) / Math.max(1, others.length - 1))]]));
  pos.set(mine, me0);
  const name = (p) => p === mine ? "مدينتي" : rels.find((r) => r.other === p)?.town || liveOps(st).find((o) => o.from === p)?.fromTown || liveOps(st).find((o) => o.to === p)?.toTown || "";
  const flying = liveOps(st).filter((o) => o.status === "flying");
  const lines = flying.map((o, i) => {
    const [ax, ay] = pos.get(o.from) || me0, [bx, by] = pos.get(o.to) || me0;
    // incoming arc above, outgoing below, and each one a little apart from the others
    const lift = (o.side === "in" ? -1 : 1) * (18 + (i % 4) * 9), cx = (ax + bx) / 2, cy = (ay + by) / 2 + lift;
    return `<path d="M${ax},${ay} Q${cx},${cy} ${bx},${by}" class="wr-line ${o.side}"/><circle r="4.5" class="wr-dot ${o.side}" data-a="${ax},${ay}" data-c="${cx},${cy}" data-b="${bx},${by}" data-t0="${o.launchAt}" data-t1="${o.arriveAt}" cx="${ax}" cy="${ay}"/>`;
  }).join("");
  const towns = [...pos].map(([p, [x, y]]) => { const rel = rels.find((r) => r.other === p), in_ = flying.filter((o) => o.from === p).length, out = flying.filter((o) => o.to === p).length;
    return `<g class="wr-town ${p === mine ? "me" : rel?.state || ""}"><circle cx="${x}" cy="${y}" r="${p === mine ? 10 : 8}"/><text x="${x}" y="${y + (p === mine ? 24 : 21)}">${name(p)}</text>${in_ || out ? `<text class="wr-count" x="${x}" y="${y - 13}">${in_ ? `🔴${ar(in_)}` : ""}${out ? ` 🟢${ar(out)}` : ""}</text>` : ""}</g>`; }).join("");
  return `<svg class="wr-map" viewBox="0 0 ${W} ${H}" style="height:${Math.round(H * 0.95)}px" role="img" aria-label="خريطة الجبهة">${lines}${towns}</svg>`;
}
/** Every second while the room is open: the countdowns and the dots move (the tabs are left alone). */
function tick() {
  if (sheetFor !== "warroom") { clearInterval(ROOM.tick); ROOM.tick = null; $("sheet").classList.remove("warroom"); return; }
  const strip = $("wrStrip"); if (strip) { strip.innerHTML = stripHtml(WARX.st); bindStrip(); }
  const times = WARX.st?.profile ? new Map(launcherTimes(WARX.st).map((x) => [x.key, x])) : new Map();
  document.querySelectorAll(".wr-launcher").forEach((el) => {
    const x = times.get(el.dataset.key); if (!x) return;
    el.className = `wr-launcher ${x.broken ? "broken" : x.left ? "wait" : "ready"}`;
    el.querySelector("i").textContent = x.broken ? "متعطلة: صلّحها" : x.left ? `⏳ ${secLeft(x.left)}` : "✓ جاهزة";
    el.querySelector(".bar span").style.width = `${x.left ? Math.max(4, 100 - x.left / 6000) : 100}%`;
  });
  const now = warNow();
  document.querySelectorAll(".wr-dot").forEach((d) => {
    const [ax, ay] = d.dataset.a.split(",").map(Number), [cx, cy] = d.dataset.c.split(",").map(Number), [bx, by] = d.dataset.b.split(",").map(Number), t0 = Number(d.dataset.t0), t1 = Number(d.dataset.t1);
    const k = Math.max(0, Math.min(1, (now - t0) / Math.max(1, t1 - t0))), q = 1 - k;
    d.setAttribute("cx", q * q * ax + 2 * q * k * cx + k * k * bx); d.setAttribute("cy", q * q * ay + 2 * q * k * cy + k * k * by);
  });
  if (liveOps(WARX.st).some((o) => o.status === "flying" && o.arriveAt < now - 1500) && !ROOM.polling) { ROOM.polling = true; warPoll(true).then(() => { ROOM.polling = false; if (sheetFor === "warroom") warRoom(ROOM.tab); }); }
}
function bindStrip() {
  document.querySelectorAll("[data-wrop]").forEach((b) => b.addEventListener("click", () => { const o = WARX.st?.ops.find((x) => x.id === b.dataset.wrop); if (o) watch(o); }));
}
/** Watch one operation; the room opens again when the scene is over. */
function watch(o) {
  sfx.tap();
  ROOM.back = true;
  if (o.status === "flying" && o.side === "out") warSalvoScene(salvoOf(o), false);
  else if (o.status === "flying") { toast(`🚨 ${o.bname}: يوصل بعد ${secLeft(o.arriveAt - warNow())}. تشوف المشهد لا وصل`, ""); ROOM.back = false; }
  else if (o.side === "in") warDefenseScene(o, true);
  else replayOp(o);
}
/** Called when a war scene ends: back to the room if the mayor came from it. */
export function roomAfterScene() {
  if (!ROOM.back) return;
  ROOM.back = false;
  setTimeout(() => warRoom(ROOM.tab), 400);
}

/** The enemy town's buildings that may be struck (from its saved copy on the server). */
async function enemyTargets(plot) {
  const c = ROOM.towns.get(plot);
  if (c && Date.now() - c.at < 30000) return c.list;
  try {
    const d = await api(`/world/town/${plot}`), s = unpack(d.town.snapshot), N = Math.round(Math.sqrt(s.tiles.length));
    const dmg = new Map((d.damage || []).map((x) => [`${x.x}:${x.y}`, x.wd]));
    const list = [];
    s.tiles.forEach((t, i) => { if (t.b && !(t.b.build > 0) && canTarget(t.b.id)) list.push({ x: i % N, y: Math.floor(i / N), id: t.b.id, lvl: t.b.lvl || 0, wd: dmg.get(`${i % N}:${Math.floor(i / N)}`) || 0 }); });
    list.sort((a, b) => (TARGET_ORDER.indexOf(a.id) + 1 || 99) - (TARGET_ORDER.indexOf(b.id) + 1 || 99));
    ROOM.towns.set(plot, { at: Date.now(), list });
    return list;
  } catch { return null; }
}
const TARGET_ORDER = ["milhq", "airdef", "radar", "missilepad", "dronebase", "armory", "powerplant", "generator", "solar", "windfarm", "desal", "tank", "factory"];

/** Every pad and drone base with its countdown until it can fire again. */
function launchersHtml(st) {
  const list = launcherTimes(st);
  if (!list.length) return `<div class="need">ما عندك منصات ولا قواعد مسيّرات: ابنها من «البناء ← الدفاع والعسكرية».</div>`;
  return `<p class="hint">كل إطلاق خلال ساعة يطوّل تجهيز المنصة نفسها (٤ دقايق ثم ٦ ثم ٨…): وزّع ضرباتك واختر أهدافك صح.</p><div class="wr-launchers">${list.map((x) => `<div class="wr-launcher ${x.broken ? "broken" : x.left ? "wait" : "ready"}" data-left="${x.left}" data-key="${x.key}">
    <b>${x.kind === "missilepad" ? "🚀" : "🛩️"} ${x.name}</b><i>${x.broken ? "متعطلة: صلّحها" : x.left ? `⏳ ${secLeft(x.left)}` : "✓ جاهزة"}</i><span class="bar"><span style="width:${x.left ? Math.max(4, 100 - x.left / 6000) : 100}%"></span></span></div>`).join("")}</div>`;
}
async function attackTab(st) {
  const wars = st.rels.filter((r) => r.state === "war");
  const ars = st.arsenal, p = st.profile;
  const stock = WEAPON_IDS.filter((w) => !weaponBlocker(p, w)).map((w) => `<span class="wr-stock">${weaponIcon(w)} ${WEAPONS[w].name} <b>${ar(ars[w])}</b><small>مدى ${ar(WEAPONS[w].blast)}</small></span>`).join("");
  if (!wars.length) return `<h3>🚀 جاهزية المنصات</h3>${launchersHtml(st)}<p class="hint">ما فيه حرب الحين. الهجوم يفتح لا صار بينك وبين مدينة حرب: من «🗺️ الجوف والتفاوض» اضغط أي مدينة وأعلن عليها الحرب أو طالبها بجزية.</p>`;
  if (!wars.some((r) => r.other === ROOM.enemy)) ROOM.enemy = wars[0].other;
  const enemy = wars.find((r) => r.other === ROOM.enemy);
  return `<div class="wr-enemies">${wars.map((r) => `<button type="button" class="${r.other === enemy.other ? "on" : ""}" data-wrenemy="${r.other}">🔥 «${r.town}»<small>${relTimer(r).replace(/^\s*·\s*/, "")}</small></button>`).join("")}</div>
    <div class="wr-aim"><b>🎯 اختر أماكن الضربة على «${enemy.town}»</b><small>تدخل على مدينتهم، وتضغط أي مكان: الضربة تنزل عليه وعلى اللي حوله حسب مدى السلاح. لين ٦ أماكن بالدفعة، ولكل مكان سلاحه. المساجد محمية.</small>
      <button class="btn go block" type="button" id="wrMapTarget">🎯 افتح مدينة «${enemy.town}» واختر الأماكن</button></div>
    <h3>🚀 جاهزية المنصات</h3>${launchersHtml(st)}
    <h3>📦 الذخيرة</h3><div class="wr-stocks">${stock || "—"}</div>`;
}
/** al-Jouf's towns and fronts (the public map), kept a short while. */
async function worldMap(force) {
  if (!force && ROOM.map && Date.now() - ROOM.map.at < 20000) return ROOM.map;
  try { const d = await api("/world/map"); ROOM.map = { at: Date.now(), plots: d.plots || [], fronts: d.fronts || [] }; } catch { /* the last one, or none */ }
  return ROOM.map;
}
/** Why a relation action is closed for this town (the same rules the server checks). */
function relBlock(r, era) {
  const home = visiting ? visiting.home : S;
  return (home.era || 0) < WAR.minEra ? `مدينتك لازم تصير ${ERAS[WAR.minEra].name} أول` : (era || 0) < WAR.minEra ? "القرى محمية من الحروب"
    : !["hostile", "warning", "war"].includes(r.state) ? eraGap(home.era, era) : "";
}
/** The map of al-Jouf in the room: every town, the fronts between them; a tap opens that town's panel below. */
function worldSvg(map, st) {
  const mine = me()?.plot, cell = 10, plots = map.plots;
  const xy = (p) => { const [x, y] = worldXY(p); return [x * cell + cell / 2, y * cell + cell / 2]; };
  const all = plots.map((t) => xy(t.plot));
  const x0 = Math.max(0, Math.min(...all.map((a) => a[0])) - 30), x1 = Math.min(WORLD.cols * cell, Math.max(...all.map((a) => a[0])) + 30);
  const y0 = Math.max(0, Math.min(...all.map((a) => a[1])) - 22), y1 = Math.min(WORLD.rows * cell, Math.max(...all.map((a) => a[1])) + 22);
  const rel = (p) => st.rels.find((r) => r.other === p);
  const fronts = map.fronts.map((f) => { const [ax, ay] = xy(f.a), [bx, by] = xy(f.b), ours = f.a === mine || f.b === mine;
    return `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" class="wm-front ${f.state} ${ours ? "ours" : ""}"/>`; }).join("");
  const places = WORLD.places.map((p) => `<text x="${p.x * cell + cell / 2}" y="${p.y * cell + cell / 2}" class="wm-pl">${p.name}</text>`).join("");
  // every town has its name; which names show is decided on the screen (zoom in for more): the most
  // important first (mine, the chosen one, enemies, towns at war, the biggest), never one over another
  const byPop = [...plots].sort((a, b) => (b.pop || 0) - (a.pop || 0)), rank = new Map(byPop.map((t, i) => [t.plot, i]));
  const towns = plots.map((t) => {
    const [x, y] = xy(t.plot), r = rel(t.plot), state = t.plot === mine ? "me" : r?.state || "peace", sel = ROOM.sel === t.plot, atWar = map.fronts.some((f) => (f.a === t.plot || f.b === t.plot) && f.state !== "truce");
    const pri = (t.plot === mine ? 5e6 : 0) + (sel ? 4e6 : 0) + (r && r.state !== "peace" ? 3e6 : 0) + (atWar ? 2e6 : 0) + (1e5 - (rank.get(t.plot) || 0));
    return `<g class="wm-t ${state} ${sel ? "sel" : ""} ${atWar ? "fire" : ""}">${sel ? `<circle cx="${x}" cy="${y}" r="9" class="wm-ring" data-r="9"/>` : ""}<circle cx="${x}" cy="${y}" r="${t.plot === mine ? 5 : 3.6}" data-r="${t.plot === mine ? 5 : 3.6}"/><text x="${x}" y="${y - 8}" data-y="${y}" data-pri="${pri}" class="wm-name">${t.plot === mine ? "مدينتي" : t.town}</text><circle cx="${x}" cy="${y}" r="9" data-r="9" class="wm-hit" data-wrsel="${t.plot}"/></g>`;
  }).join("");
  ROOM.full = [x0, y0, x1 - x0, y1 - y0];
  const v = ROOM.mv && ROOM.mvFull === ROOM.full.join() ? ROOM.mv : ROOM.full;
  ROOM.mvFull = ROOM.full.join();
  return `<div class="wr-world-box"><svg class="wr-world" id="wrWorld" viewBox="${v.join(" ")}" role="img" aria-label="خريطة الجوف">${places}${fronts}${towns}</svg>
    <div class="wr-zoom"><button type="button" data-wrzoom="1.6" aria-label="قرّب">＋</button><button type="button" data-wrzoom="0.625" aria-label="بعّد">－</button><button type="button" data-wrzoom="0" aria-label="كل الخريطة">⤢</button></div>
    <small class="wr-zoom-hint">قرّب بإصبعين أو بـ＋ عشان تشوف أسماء أكثر</small></div>`;
}
async function worldTab(st) {
  const map = await worldMap();
  if (!map) return `<div class="need">ما قدرت أحمّل خريطة الجوف.</div>`;
  const mine = me()?.plot, t = map.plots.find((x) => x.plot === ROOM.sel);
  const legend = `<div class="wm-legend"><span class="me">مدينتي</span><span class="war">حرب</span><span class="hostile">توتر</span><span class="truce">هدنة</span><span class="front">جبهة بين مدن</span></div>`;
  return `${worldSvg(map, st)}${legend}${t ? diploPanel(st, map, t) : `<p class="hint">اضغط أي مدينة بالخريطة: تطالبها بجزية، تكلّمها، أو تعلن عليها الحرب.</p>${frontsList(map, null)}`}`;
}
/** The wars of al-Jouf in words (everyone can read them): who fights whom, and how many strikes landed. */
function frontsList(map, plot) {
  const name = (p) => map.plots.find((x) => x.plot === p)?.town || "مدينة", list = map.fronts.filter((f) => plot == null || f.a === plot || f.b === plot);
  if (!list.length) return plot == null ? `<p class="hint">🕊️ ما فيه حروب بالجوف الحين.</p>` : "";
  return `<h3>🔥 جبهات الجوف</h3><div class="rows">${list.map((f) => { const first = f.by === f.b ? f.b : f.a, second = first === f.a ? f.b : f.a, hf = first === f.a ? f.hitsA : f.hitsB, hs = first === f.a ? f.hitsB : f.hitsA;
    return row(`${REL_ICONS[f.state] || "⚔️"} «${name(first)}» ⟵ «${name(second)}»`, f.state === "war" ? `ضربات ${ar(hf)} مقابل ${ar(hs)}` : f.state === "warning" ? "إنذار حرب" : f.state === "truce" ? "هدنة" : "طلب جزية"); }).join("")}</div>`;
}
/** One town: what stands between us, and everything we can do with it (tribute, war, talk, truce, peace). */
function diploPanel(st, map, t) {
  const mine = me()?.plot, now = warNow();
  if (t.plot === mine) {
    const sb = st.shieldBuy || {};
    return `<div class="dp-card"><div class="dp-top"><b>📍 مدينتك «${t.town}»</b><small>${ERAS[t.era || 0].name}</small></div>
      ${sb.until > now ? `<p class="dp-shield">🛡️ درعك شغال · باقي ${fmtLeft(sb.until - now)}</p>` : `<p class="hint">ما عليك درع. ترفعه من «🛡️ الدفاع والدرع».</p>`}</div>${frontsList(map, t.plot)}`;
  }
  const r = st.rels.find((x) => x.other === t.plot) || { state: "peace", hist: [], chat: [] };
  const block = relBlock(r, t.era);
  const acts = relActions(r.state === "peace" && !r.hist?.length && !r.chat?.length ? null : { ...r, a: Math.min(mine, t.plot), b: Math.max(mine, t.plot) }, mine, now, block);
  const most = tributeMax(t.money);
  const big = (act, icon, label, sub, cls = "") => `<button type="button" class="dp-act ${cls}" data-dp="${act}" ${acts[act] ? `data-why="${acts[act]}" aria-disabled="true"` : ""}><i>${icon}</i><b>${label}</b><small>${acts[act] || sub}</small></button>`;
  const ask = r.tribute && r.tribute.by !== mine ? `<div class="dp-alert"><b>🪙 يطالبونك بجزية ${money(r.tribute.amount)} ريال</b><small>ادفع: سلام شهر بالجوف · ارفض أو لا ترد خلال ${fmtLeft(r.tribute.until - now)}: حرب</small>
      <div class="dp-row"><button class="btn go" type="button" data-dpdo="pay">🪙 ادفع ${money(r.tribute.amount)}</button><button class="btn danger" type="button" data-dpdo="refuse">✋ ارفض (حرب)</button></div></div>`
    : r.tribute ? `<div class="dp-wait">🪙 طلبت جزية ${money(r.tribute.amount)} ريال · ينتظر ردهم ${fmtLeft(r.tribute.until - now)}، بعدها حرب</div>` : "";
  const offer = r.offer && r.offer.by !== mine ? `<div class="dp-alert calm"><b>${r.offer.kind === "truce" ? "🏳️ يعرضون هدنة" : "🤝 يعرضون صلح"}</b><div class="dp-row"><button class="btn go" type="button" data-dpdo="accept">✓ اقبل</button><button class="btn" type="button" data-dpdo="reject">✋ ارفض</button></div></div>` : "";
  let form = "";
  if (ROOM.form === "tribute" && !acts.tribute) {
    const v = Math.min(most, Math.max(WAR.tribute.min, ROOM.amount || Math.round(most / 2 / 500) * 500));
    form = `<div class="dp-form"><b>🪙 كم تطلب من «${t.town}»؟</b>
      <div class="dp-amount"><output id="dpAmt">${money(v)}</output><small>ريال</small></div>
      <input type="range" id="dpRange" min="${WAR.tribute.min}" max="${most}" step="500" value="${v}">
      <div class="dp-scale"><small>${money(WAR.tribute.min)}</small><small>الحد ${money(most)} (${ar(Math.round(WAR.tribute.share * 100))}٪ من ميزانيتهم)</small></div>
      <p class="hint">إذا دفعوا: يوصلك المبلغ، وسلام بينكم شهر بالجوف (${fmtLeft(WAR.T.tributePeace)}). إذا رفضوا أو ما ردوا خلال يوم بالجوف (${fmtLeft(WAR.T.tributeAnswer)}): الحرب تنعلن لحالها.</p>
      <div class="dp-row"><button class="btn go" type="button" data-dpdo="tribute">أرسل الطلب</button><button class="btn" type="button" data-dpform="">إلغاء</button></div></div>`;
  } else if (ROOM.form === "chat") {
    const lines = r.chat || [];
    form = `<div class="dp-chat"><div class="dp-lines" id="dpLines">${lines.length ? lines.map((l) => `<p class="${l.by === mine ? "me" : "them"}"><span>${escapeHtml(l.text)}</span><small>${new Date(l.at - (WARX.offset || 0)).toLocaleTimeString("ar-SA", { hour: "numeric", minute: "2-digit" })}</small></p>`).join("") : `<p class="dp-empty">اكتب تهديدك أو شروطك. يوصلهم إشعار ويقدرون يردون هنا.</p>`}</div>
      <div class="dp-send"><input id="wrSay" type="text" maxlength="200" placeholder="اكتب رسالتك…" enterkeyhint="send"><button class="btn go" type="button" data-dpdo="say">إرسال</button></div>
      ${r.chatOpen ? `<button class="btn danger block" type="button" data-dpdo="endchat">⚔️ أنهِ المحادثة${acts.war ? "" : " وابدأ الحرب"}</button>` : ""}</div>`;
  }
  const watchable = map.fronts.some((f) => (f.a === t.plot || f.b === t.plot) && f.state !== "truce" && f.a !== mine && f.b !== mine);
  const med = st.medals?.[t.plot] || [];
  return `<div class="dp-card"><div class="dp-top"><b>${REL_ICONS[r.state]} «${t.town}»${med.map((x) => ` <span title="${x.name}">${x.icon}</span>`).join("")}</b><small>العمدة ${t.owner} · ${ERAS[t.era || 0].name}${med.length ? ` · ${med.map((x) => x.name).join(" · ")}` : ""}</small></div>
      <div class="dp-state ${r.state}">${REL_NAMES[r.state]}${relTimer(r)}</div>
      ${ask}${offer}
      ${r.state === "war" ? `<button class="btn go block dp-go" type="button" data-dpdo="attack">🎯 هاجم «${t.town}» الحين</button>` : ""}
      <div class="dp-acts">${big("tribute", "🪙", "طالب بجزية", most >= WAR.tribute.min ? `لين ${money(most)} ريال` : "ميزانيتهم ما تكفي")}${big("war", "⚔️", "أعلن الحرب", `تبدأ بعد ${fmtLeft(WAR.T.warning)}`, "danger")}
        ${big("say", "💬", "محادثة", r.chatOpen ? `${ar((r.chat || []).length)} رسالة` : "تهديد أو شروط بكلامك")}${["warning", "war"].includes(r.state) ? big("truce", "🏳️", "اعرض هدنة", "توقف الضربات فترة") : ""}${r.state !== "peace" ? big("peace", "🤝", "اقترح صلح", "تنتهي الحرب") : ""}</div>
      ${form}${watchable ? `<button class="btn block" type="button" id="dpFollow">${WARX.follow?.plot === t.plot ? "👁️ أوقف المتابعة" : "👁️ تابع حربها: تشوف كل ضربة تنزل عليها"}</button>` : ""}</div>${frontsList(map, t.plot)}`;
}
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function shieldCard(st) {
  const sb = st.shieldBuy, now = warNow();
  if (!sb) return "";
  if (sb.until > now) return `<div class="dp-shieldcard on"><b>🛡️ درع الحماية شغال</b><small>باقي ${fmtLeft(sb.until - now)} · ما ينضرب فيك شي. إذا هاجمت أحد ينكسر.</small></div>`;
  const wait = sb.next > now ? sb.next - now : 0;
  return `<div class="dp-shieldcard"><b>🛡️ درع الحماية</b><small>يحميك أسبوع بالجوف (${fmtLeft(sb.last)}) حتى لو كنت بنص حرب. بعدها ما ترفعه إلا بعد ٣ أسابيع من رفعه. إذا هاجمت وأنت عليه ينكسر.</small>
    <button class="btn go block" type="button" id="wrShield" ${wait ? `data-why="الدرع مرة كل ٣ أسابيع: تقدر بعد ${fmtLeft(wait)}" aria-disabled="true"` : ""}>${wait ? `متاح بعد ${fmtLeft(wait)}` : `ارفع الدرع · ${money(sb.price)} ريال`}</button></div>`;
}
function defTab(st) {
  const p = st.profile, ars = st.arsenal, caps = st.caps, home = visiting ? visiting.home : S;
  const drones = ars.drone + ars.drone2, missiles = ars.missile + ars.missile2;
  const room = (w) => w === "intc" ? caps.intc - ars.intc : WEAPONS[w].kind === "drone" ? caps.drones - drones : caps.missiles - missiles;
  const line = (w, name, icon, price, why) => `<div class="war-arm ${why ? "locked" : ""}"><b class="ic">${icon}</b><span><b>${name}</b><small>${why || `عندك <b>${ar(ars[w])}</b> · السعر ${money(price)}`}</small></span>
    ${why ? "" : w !== "intc" && caps.open
      ? `<span class="wr-buy"><button class="btn" type="button" data-wrbuy="${w}" data-n="1" ${home.money < price ? "disabled" : ""}>+١</button><button class="btn go" type="button" data-wrbuy="${w}" data-n="5" ${home.money < price * 5 ? "disabled" : ""}>+٥</button></span>`
      : `<span class="wr-buy"><button class="btn" type="button" data-wrbuy="${w}" data-n="1" ${room(w) <= 0 || home.money < price ? "disabled" : ""}>+١</button><button class="btn go" type="button" data-wrbuy="${w}" data-n="${Math.max(0, room(w))}" ${room(w) <= 0 ? "disabled" : ""}>عبّي (${ar(Math.max(0, room(w)))})</button></span>`}</div>`;
  return `${shieldCard(st)}<div class="war-grid">
      <div><b>${ar(drones)}${caps.open ? "" : `<small>/${ar(caps.drones)}</small>`}</b><span>🛩️ مسيّرات</span></div><div><b>${ar(missiles)}${caps.open ? "" : `<small>/${ar(caps.missiles)}</small>`}</b><span>🚀 صواريخ</span></div>
      <div><b>${ar(ars.intc)}<small>/${ar(caps.intc)}</small></b><span>🛡️ اعتراضية</span></div><div><b>${ar(Math.round(st.intercept.missile * 100))}٪</b><span>صدّ الصواريخ</span></div></div>
    <div class="sheet-actions keep"><button class="btn go block" type="button" id="wrFillAll">${caps.open ? "⚡ عبّي الاعتراضية كلها" : "⚡ عبّي كل شي مرة وحدة"}</button></div>
    <div class="rows">${p.airdefs.length ? line("intc", WAR.interceptor.name, weaponIcon("intc"), WAR.interceptor.price, "") : row("الدفاع الجوي", "✕ ما فيه: ابنِ بطارية دفاع جوي")}
      ${WEAPON_IDS.map((w) => line(w, WEAPONS[w].name, weaponIcon(w), WEAPONS[w].price, weaponBlocker(p, w))).join("")}</div>
    <div class="rows">${row("صدّ المسيّرة", `${ar(Math.round(st.intercept.drone * 100))}٪`)}${row("صدّ الصاروخ", `${ar(Math.round(st.intercept.missile * 100))}٪`)}
      ${row("الرادار", p.radars.length ? `${ar(p.radars.length)} ${p.radars.some((r) => r.wd < 85) ? "✓ يرصد" : "✕ متعطل"}` : "✕ ما فيه")}${row("بطاريات الدفاع", ar(p.airdefs.length))}
      ${row("النائب يعبّي ويصلّح", st.settings.refill || st.settings.repair ? `✓ لين ${money(st.settings.budget)} باليوم` : "✕ موقف")}</div>
    <h3>🎬 عرض الهجمات عليك</h3>
    <div class="wr-modes">${[["full", "مشاهد كاملة", "كل الهجمات بمشهد واحد"], ["fast", "مشاهد سريعة", "نفس المشهد بضعف السرعة"], ["off", "التقرير بس", "بدون مشاهد"]].map(([k, n, t]) => `<button type="button" class="${sceneMode() === k ? "on" : ""}" data-wrmode="${k}"><b>${n}</b><small>${t}</small></button>`).join("")}</div>
    <p class="hint">كل اللي يوصلك من هجمات، من مدينة وحدة أو أكثر، ينعرض مرة وحدة مع بعض، وبعده تقرير واحد.</p>
    <button class="btn block" type="button" id="wrDeputy">⚙️ أوامر النائب والقيادة التفصيلية</button>`;
}
function logTab(st) {
  const home = visiting ? visiting.home : S, N = Math.round(Math.sqrt(home.tiles.length));
  const hurt = []; home.tiles.forEach((t, i) => { if (t.b?.wd > 0) hurt.push({ x: i % N, y: Math.floor(i / N), b: t.b }); });
  hurt.sort((a, b) => b.b.wd - a.b.wd);
  const ops = (st.ops || []).filter((o) => o.status === "done").slice(0, 20);
  const filter = ROOM.logFilter || "all";
  const shown = ops.filter((o) => filter === "all" || (filter === "in" ? o.side === "in" : o.side === "out"));
  return `<h3>🔧 الأضرار (${ar(hurt.length)})</h3>
    ${hurt.length ? `<div class="rows">${hurt.map(({ x, y, b }) => `<div class="row"><span><b>${B[b.id].name}</b><small>${stateTag(b.wd)}${b.rep ? ` · يتصلّح، يخلص بعد ${fmtLeft(b.rep.end - warNow())}` : ""}</small></span>${b.rep ? "" : `<button class="btn go" type="button" data-wrfix="${x}:${y}">صلّح</button>`}</div>`).join("")}</div>` : `<p class="hint">ما فيه أضرار. ✓</p>`}
    <h3>📜 العمليات</h3><div class="wr-enemies">${[["all", "الكل"], ["in", "الوارد"], ["out", "الصادر"]].map(([k, n]) => `<button type="button" class="${filter === k ? "on" : ""}" data-wrlog="${k}">${n}</button>`).join("")}</div>
    ${shown.length ? `<div class="rows">${shown.map((o) => { const r = o.result, out = o.side === "out"; return `<button class="row link" type="button" data-wrop="${o.id}"><span><b>${out ? "➡️ على" : "⬅️ من"} «${out ? o.toTown : o.fromTown}»</b><small>${o.bname} · ${weaponsText(o.load)}</small></span><b class="${r?.dmg ? (out ? "plus" : "minus") : out ? "minus" : "plus"}">${r?.blocked ? "ما أصابت" : r?.dmg ? `إصابة ${ar(r.dmg)}٪` : "انعترضت"} ▶️</b></button>`; }).join("")}</div>` : `<p class="hint">ما فيه عمليات للحين.</p>`}`;
}

/** Open the war room (or draw it again) on a tab. */
export async function warRoom(tab = ROOM.tab) {
  if (!worldMode) return;
  if (tab === "talk" || tab === "enemies") { if (ROOM.talk != null) ROOM.sel = ROOM.talk; tab = "world"; }
  ROOM.tab = tab;
  const draft = $("wrSay")?.value || "", typing = document.activeElement?.id === "wrSay";
  const home = visiting ? visiting.home : S;
  if (!home.tiles.some((t) => t.b?.id === "milhq")) { warSheet(); return; } // no command centre yet: the old page explains how to start
  if (!WARX.st) { sheet(`<h2>⚔️ غرفة العمليات</h2><p class="hint">نحمّل…</p>`, "warroom"); await warPoll(true); }
  const st = WARX.st;
  if (!st) { sheet(`<h2>⚔️ غرفة العمليات</h2><div class="need">ما قدرت أوصل للسيرفر.</div>`, "warroom"); return; }
  const body = tab === "attack" ? await attackTab(st) : tab === "def" ? defTab(st) : tab === "world" ? await worldTab(st) : logTab(st);
  const mine = me()?.plot, asks = st.rels.filter((r) => (r.tribute && r.tribute.by !== mine) || (r.offer && r.offer.by !== mine) || (r.chatOpen && r.chat?.at(-1)?.by === r.other));
  const wars = st.rels.filter((r) => ["war", "warning"].includes(r.state)).length, inc = st.ops.filter((o) => o.side === "in" && o.status === "flying"), incoming = inc.length, attackers = new Set(inc.map((o) => o.from)).size;
  const keep = $("sheetBody").querySelector(".wr-body")?.scrollTop || 0;
  sheet(`<div class="wr-head"><span class="wr-radar"><i></i></span><span><h2>غرفة العمليات</h2><small>صراع الجوف · ${ERAS[home.era || 0].name}</small></span></div>
    <div class="wr-kpis"><div class="${wars ? "hot" : ""}"><b>${ar(wars)}</b><span>🔥 حروب</span></div><div class="${incoming ? "hot" : ""}"><b>${ar(incoming)}</b><span>🚨 ${attackers > 1 ? `هجوم من ${ar(attackers)} مدن` : "هجوم جاي"}</span></div>
      <div><b>${ar(st.arsenal.intc)}</b><span>🛡️ اعتراض</span></div><div><b>${home.money >= 1e6 ? `${ar((home.money / 1e6).toFixed(1))} م` : money(home.money)}</b><span>💰 الميزانية</span></div></div>
    <div class="wr-strip" id="wrStrip">${stripHtml(st)}</div>
    ${tab === "world" ? "" : mapHtml(st)}
    ${asks.filter((r) => !(tab === "world" && ROOM.sel === r.other)).map((r) => `<button type="button" class="wr-ask" data-wrask="${r.other}">${r.tribute && r.tribute.by !== mine ? `🪙 «${r.town}» تطالبك بجزية ${money(r.tribute.amount)} · باقي ${fmtLeft(r.tribute.until - warNow())}` : r.offer && r.offer.by !== mine ? `${r.offer.kind === "truce" ? "🏳️" : "🤝"} «${r.town}» تعرض ${r.offer.kind === "truce" ? "هدنة" : "صلح"}` : `💬 رسالة من «${r.town}»`}<b>افتح ←</b></button>`).join("")}
    <div class="war-tabs wr-tabs">${TABS.map(([k, n]) => `<button type="button" class="${k === tab ? "on" : ""}" data-wrtab="${k}">${n}${k === "world" && asks.length ? " 🔴" : ""}</button>`).join("")}</div>
    <div class="wr-body">${body}</div>`, "warroom");
  $("sheet").classList.add("warroom");
  const wb = $("sheetBody").querySelector(".wr-body"); if (wb && tab === ROOM.lastTab) wb.scrollTop = keep;
  ROOM.lastTab = tab;
  clearInterval(ROOM.tick); ROOM.tick = setInterval(tick, 1000);
  bind(st);
  const say = $("wrSay"); if (say) { say.value = draft; if (typing) say.focus(); }
  const lines = $("dpLines"); if (lines) lines.scrollTop = lines.scrollHeight;
}
function bind(st) {
  const q = (sel) => $("sheetBody").querySelectorAll(sel);
  bindStrip();
  q("[data-wrtab]").forEach((b) => b.addEventListener("click", () => { sfx.tap(); warRoom(b.dataset.wrtab); }));
  q("[data-wrenemy]").forEach((b) => b.addEventListener("click", () => { sfx.tap(); ROOM.enemy = Number(b.dataset.wrenemy); warRoom("attack"); }));
  q("[data-wrattack]").forEach((b) => b.addEventListener("click", () => { sfx.tap(); ROOM.enemy = Number(b.dataset.wrattack); warRoom("attack"); }));
  q("[data-wrtalk]").forEach((b) => b.addEventListener("click", () => { sfx.tap(); ROOM.talk = Number(b.dataset.wrtalk); warRoom("talk"); }));
  q("[data-wrtalkto]").forEach((b) => b.addEventListener("click", () => { sfx.tap(); ROOM.talk = Number(b.dataset.wrtalkto); warRoom("talk"); }));
  q("[data-wrlog]").forEach((b) => b.addEventListener("click", () => { sfx.tap(); ROOM.logFilter = b.dataset.wrlog; warRoom("log"); }));
  // al-Jouf and diplomacy
  worldZoom();
  q("[data-wrsel]").forEach((c) => c.addEventListener("click", () => { if (ROOM.dragged) return; sfx.tap(); const p = Number(c.dataset.wrsel); ROOM.sel = ROOM.sel === p ? null : p; ROOM.form = ""; warRoom("world"); }));
  q("[data-wrask]").forEach((b) => b.addEventListener("click", () => { sfx.tap(); ROOM.sel = Number(b.dataset.wrask); ROOM.focusSel = true; const r = st.rels.find((x) => x.other === ROOM.sel); ROOM.form = r?.chatOpen && !r.tribute && !r.offer ? "chat" : ""; warRoom("world"); }));
  q("[data-dpform]").forEach((b) => b.addEventListener("click", () => { sfx.tap(); ROOM.form = b.dataset.dpform; warRoom("world"); }));
  q("[data-dp]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.why) { toast(b.dataset.why, "bad"); sfx.deny(); return; }
    sfx.tap();
    const act = b.dataset.dp;
    if (act === "tribute" || act === "say") { ROOM.form = act === "say" ? "chat" : ROOM.form === "tribute" ? "" : "tribute"; ROOM.amount = 0; warRoom("world"); return; }
    if (act === "war" && !b.dataset.sure) { b.dataset.sure = "1"; b.querySelector("small").textContent = "متأكد؟ اضغط مرة ثانية"; return; }
    relDo(act);
  }));
  $("dpFollow")?.addEventListener("click", () => { const t = ROOM.map?.plots.find((x) => x.plot === ROOM.sel); if (t) { followTown(t.plot, t.town); warRoom("world"); } });
  $("dpRange")?.addEventListener("input", (e) => { ROOM.amount = Number(e.target.value); $("dpAmt").textContent = money(ROOM.amount); });
  q("[data-dpdo]").forEach((b) => b.addEventListener("click", () => {
    const act = b.dataset.dpdo;
    if (act === "attack") { closeSheet(); startTargeting(ROOM.sel); return; }
    if (["refuse", "endchat"].includes(act) && !b.dataset.sure) { b.dataset.sure = "1"; b.textContent = act === "refuse" ? "متأكد؟ الرفض = حرب" : "متأكد؟ اضغط مرة ثانية"; return; }
    if (act === "say") { const text = $("wrSay").value.trim(); if (!text) return; relDo("say", { text }); return; }
    if (act === "tribute") { relDo("tribute", { amount: ROOM.amount || Number($("dpRange").value) }); return; }
    relDo(act);
  }));
  $("wrSay")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("sheetBody").querySelector('[data-dpdo="say"]')?.click(); } });
  $("wrShield")?.addEventListener("click", async (e) => {
    const b = e.currentTarget;
    if (b.dataset.why) { toast(b.dataset.why, "bad"); sfx.deny(); return; }
    if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = `متأكد؟ ${money(st.shieldBuy.price)} ريال`; return; }
    b.disabled = true; await warSyncNow();
    const r = await warApi("shield", { req: warReq() });
    if (r.error) { toast(r.error, "bad"); sfx.deny(); b.disabled = false; return; }
    sfx.goal(); toast(`🛡️ رفعت درع الحماية (−${money(r.charge.amount)} ريال)`, "goal");
    await warPoll(true); warRoom("def");
  });
  $("wrMapTarget")?.addEventListener("click", () => { closeSheet(); startTargeting(ROOM.enemy); });
  // defence and refilling
  const buy = async (kind, n) => { const r = await warApi("buy", { req: warReq(), kind, n }); if (r.error) { toast(r.error, "bad"); sfx.deny(); return false; } return r; };
  q("[data-wrbuy]").forEach((b) => b.addEventListener("click", async () => {
    const n = Number(b.dataset.n); if (!n) return;
    b.disabled = true; await warSyncNow();
    const r = await buy(b.dataset.wrbuy, n);
    if (r) { sfx.coin(); toast(`✓ ${r.charge.why} (−${money(r.charge.amount)} ريال)`, "goal"); }
    await warPoll(true); warRoom("def");
  }));
  $("wrFillAll")?.addEventListener("click", async () => {
    $("wrFillAll").disabled = true; await warSyncNow();
    const p = st.profile, ars = st.arsenal, caps = st.caps;
    let spent = 0, got = 0;
    const kinds = [...(p.airdefs.length ? ["intc"] : []), ...(caps.open ? [] : WEAPON_IDS.filter((w) => !weaponBlocker(p, w)))]; // open war: no store to fill, the interceptors only
    let drones = ars.drone + ars.drone2, missiles = ars.missile + ars.missile2;
    for (const w of kinds) {
      const room = w === "intc" ? caps.intc - ars.intc : WEAPONS[w].kind === "drone" ? caps.drones - drones : caps.missiles - missiles;
      if (room <= 0) continue;
      const r = await warApi("buy", { req: warReq(), kind: w, n: room });
      if (r.error) continue;
      spent += r.charge.amount; got += room;
      if (w !== "intc") { if (WEAPONS[w].kind === "drone") drones += room; else missiles += room; }
    }
    if (got) { sfx.coin(); toast(`⚡ تعبّت الترسانة: ${ar(got)} قطعة بـ${money(spent)} ريال`, "goal"); } else toast("الترسانة مليانة أو ما تكفي الفلوس", "bad");
    await warPoll(true); warRoom("def");
  });
  $("wrDeputy")?.addEventListener("click", () => warSheet("deputy"));
  q("[data-wrmode]").forEach((b) => b.addEventListener("click", () => { sfx.tap(); setSceneMode(b.dataset.wrmode); toast({ full: "🎬 المشاهد كاملة", fast: "⏩ المشاهد سريعة", off: "📋 التقرير بس، بدون مشاهد" }[b.dataset.wrmode], "goal"); warRoom("def"); }));
  // repairs and replays
  q("[data-wrfix]").forEach((b) => b.addEventListener("click", async () => {
    const [x, y] = b.dataset.wrfix.split(":").map(Number);
    b.disabled = true; b.textContent = "…";
    const r = await warRepairAt(x, y, true);
    if (r?.error) { b.disabled = false; b.textContent = "صلّح"; return; }
    b.replaceWith(Object.assign(document.createElement("small"), { className: "wr-fixing", textContent: "🔧 يتصلّح" })); // the row changes in place: no redraw, no blink
  }));
}

/**
 * The map of al-Jouf zooms and pans (two fingers to pinch, one to drag, or the buttons). Dots and names keep
 * their size on the screen, and a name shows only where it does not cover another (more show as you zoom in).
 */
function worldZoom() {
  const svg = $("wrWorld"); if (!svg || !ROOM.full) return;
  const [fx, fy, fw, fh] = ROOM.full, ratio = fh / fw;
  let v = ROOM.mv && ROOM.mvFull === ROOM.full.join() ? [...ROOM.mv] : [...ROOM.full];
  const apply = () => {
    v[2] = Math.min(fw, Math.max(fw / 10, v[2])); v[3] = v[2] * ratio;
    v[0] = Math.min(fx + fw - v[2], Math.max(fx, v[0])); v[1] = Math.min(fy + fh - v[3], Math.max(fy, v[1]));
    ROOM.mv = [...v];
    svg.setAttribute("viewBox", v.join(" "));
    const k = v[2] / fw, px = v[2] / Math.max(1, svg.clientWidth); // user units in one screen pixel
    svg.querySelectorAll("[data-r]").forEach((c) => c.setAttribute("r", Number(c.dataset.r) * Math.max(0.35, Math.sqrt(k))));
    svg.querySelectorAll(".wm-name").forEach((t) => { t.style.fontSize = `${11 * px}px`; t.setAttribute("y", Number(t.dataset.y) - 9 * px); t.style.strokeWidth = `${2.6 * px}px`; });
    svg.querySelectorAll(".wm-pl").forEach((t) => { t.style.fontSize = `${9 * px}px`; });
    declutter();
  };
  let pending = 0;
  const declutter = () => { if (pending) return; pending = requestAnimationFrame(() => {
    pending = 0;
    const box = svg.getBoundingClientRect(), placed = [];
    const labels = [...svg.querySelectorAll(".wm-name")].sort((a, b) => Number(b.dataset.pri) - Number(a.dataset.pri));
    for (const t of labels) {
      t.style.display = "";
      const r = t.getBoundingClientRect();
      const out = r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom;
      const hit = placed.some((p) => r.left < p.right + 3 && r.right > p.left - 3 && r.top < p.bottom + 1 && r.bottom > p.top - 1);
      if (out || hit) t.style.display = "none"; else placed.push(r);
    }
  }); };
  const zoomAt = (f, cx = v[0] + v[2] / 2, cy = v[1] + v[3] / 2) => { const w = v[2] / f; v[0] = cx - (cx - v[0]) * (w / v[2]); v[1] = cy - (cy - v[1]) * (w / v[2]); v[2] = w; apply(); };
  const toUser = (e) => { const r = svg.getBoundingClientRect(); return [v[0] + (e.clientX - r.left) / r.width * v[2], v[1] + (e.clientY - r.top) / r.height * v[3]]; };
  const pts = new Map(); let start = null;
  svg.addEventListener("pointerdown", (e) => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); ROOM.dragged = false; start = { v: [...v], pts: new Map([...pts].map(([k, p]) => [k, { ...p }])) }; });
  svg.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId) || !start) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = svg.getBoundingClientRect(), s = start.v[2] / r.width;
    const now = [...pts.values()], was = [...start.pts.values()];
    if (now.length >= 2 && was.length >= 2) { // pinch: the spread between the fingers sets the zoom, around their middle
      const d0 = Math.hypot(was[0].x - was[1].x, was[0].y - was[1].y), d1 = Math.hypot(now[0].x - now[1].x, now[0].y - now[1].y);
      const mx = (was[0].x + was[1].x) / 2 - r.left, my = (was[0].y + was[1].y) / 2 - r.top;
      const cx = start.v[0] + mx * s, cy = start.v[1] + my * s, w = start.v[2] * d0 / Math.max(10, d1);
      v = [cx - (cx - start.v[0]) * (w / start.v[2]), cy - (cy - start.v[1]) * (w / start.v[2]), w, w * ratio];
      ROOM.dragged = true; apply();
    } else if (now.length === 1 && was.length === 1) {
      const dx = now[0].x - was[0].x, dy = now[0].y - was[0].y;
      if (!ROOM.dragged && Math.hypot(dx, dy) < 6) return; // a tap stays a tap
      ROOM.dragged = true;
      v = [start.v[0] - dx * s, start.v[1] - dy * s, start.v[2], start.v[3]]; apply();
    }
  });
  const up = (e) => { pts.delete(e.pointerId); start = pts.size ? { v: [...v], pts: new Map([...pts].map(([k, p]) => [k, { ...p }])) } : null; if (!pts.size && ROOM.dragged) setTimeout(() => { ROOM.dragged = false; }, 50); };
  svg.addEventListener("pointerup", up); svg.addEventListener("pointercancel", up); svg.addEventListener("pointerleave", up);
  svg.addEventListener("wheel", (e) => { e.preventDefault(); const [cx, cy] = toUser(e); zoomAt(e.deltaY < 0 ? 1.25 : 0.8, cx, cy); }, { passive: false });
  $("sheetBody").querySelectorAll("[data-wrzoom]").forEach((b) => b.addEventListener("click", () => { sfx.tap(); const f = Number(b.dataset.wrzoom); if (!f) { v = [...ROOM.full]; apply(); } else zoomAt(f); }));
  // a town chosen from outside the map (an alert, the world map): bring it into view
  if (ROOM.sel != null && ROOM.focusSel) { ROOM.focusSel = false; const c = svg.querySelector(`[data-wrsel="${ROOM.sel}"]`); if (c) { const cx = Number(c.getAttribute("cx")), cy = Number(c.getAttribute("cy")); v[2] = Math.min(v[2], fw / 3); v[3] = v[2] * ratio; v[0] = cx - v[2] / 2; v[1] = cy - v[3] / 2; } }
  apply();
}
/** One relation action with the selected town, then the room again (with the talk kept open for a message). */
async function relDo(act, extra = {}) {
  const other = ROOM.sel;
  await warSyncNow();
  const res = await warApi("rel", { req: warReq(), other, act, ...extra });
  if (res.error) { toast(res.error, "bad"); sfx.deny(); return; }
  if (act === "say") { const say = $("wrSay"); if (say) say.value = ""; }
  else { ROOM.form = ""; toast({ tribute: "🪙 وصلهم طلب الجزية", pay: "🪙 دفعت الجزية: سلام شهر", refuse: "✋ رفضت: الحرب تبدأ قريب", war: "⚔️ أعلنت الحرب", endchat: "⚔️ انتهت المحادثة", truce: "🏳️ أرسلت عرض الهدنة", peace: "🤝 أرسلت عرض الصلح", accept: "✓ قبلت", reject: "رفضت العرض" }[act] || "✓", ["war", "refuse", "endchat"].includes(act) ? "bad" : "goal"); }
  (["war", "refuse", "endchat"].includes(act) ? sfx.deny : sfx.goal)();
  await warPoll(true);
  if (act === "say") ROOM.form = "chat";
  warRoom("world");
}
/** The war button: red and pulsing while there is a war or an attack on its way. */
export function warRoomBadge(st) {
  const btn = $("warBtn"); if (!btn || !st) return;
  const hot = st.rels?.some((r) => ["war", "warning"].includes(r.state)) || st.ops?.some((o) => o.side === "in" && o.status === "flying");
  btn.classList.toggle("wr-hot", !!hot);
  // the room is drawn again only when something it shows changed (relations, operations, ammunition, damage)
  const sig = JSON.stringify([st.rels?.map((r) => [r.other, r.state, r.offer?.at, r.tribute?.at, r.chat?.length, r.chatOpen]), st.shieldBuy?.until, st.ops?.map((o) => [o.id, o.status]), st.arsenal, (visiting ? visiting.home : S)?.tiles.reduce((n, t) => n + (t.b?.wd ? 1 : 0), 0)]);
  if (sig === ROOM.sig) return;
  ROOM.sig = sig;
  if (sheetFor === "warroom" && !ROOM.redrawing) { ROOM.redrawing = true; setTimeout(() => { ROOM.redrawing = false; if (sheetFor === "warroom" && !document.activeElement?.closest?.(".wr-body select")) warRoom(ROOM.tab); }, 300); }
}
