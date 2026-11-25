// «غرفة العمليات»: everything of a war in one screen. Up top a live strip of every operation in the air
// (ours and theirs, with their countdowns) and a small map of the front; below, five tabs: a batch attack on
// several targets at once, defence and refilling, the enemies, negotiation, and the log with the damage to
// repair. Alerts never throw the mayor out of it; a scene they choose to watch brings them back after.
import { $, S, ar, closeSheet, money, sheet, sheetFor, visiting, worldMode } from "./main.js";
import { WARX, warApi, warNow, warPoll, warReq, warSyncNow, secLeft, fmtLeft, relTimer, weaponsText, opReport, replayOp, warOpScene, warDefenseScene, warRepairAt, warSheet, startTargeting, threatSheet, stateTag } from "./ui-war.js";
import { api, me } from "./ui-online.js";
import { row, toast } from "./ui-build.js";
import { sfx } from "./sound.js";
import { unpack } from "./sim.js";
import { B, ERAS, worldXY } from "./data.js";
import { WAR, WEAPONS, WEAPON_IDS, weaponBlocker, relActions, REL_NAMES, REL_ICONS, canTarget, TARGETS, flightMs, damageState } from "./war.js";

export const ROOM = { tab: "attack", enemy: null, talk: null, pick: {}, towns: new Map(), tick: null, back: false };
const TABS = [["attack", "🎯 هجوم"], ["def", "🛡️ دفاع وتعبئة"], ["enemies", "👥 الأعداء"], ["talk", "🤝 تفاوض"], ["log", "📜 السجل والأضرار"]];

/** The operations to show in the strip: in the air, and those that landed in the last three minutes. */
function liveOps(st) {
  const now = warNow();
  return (st?.ops || []).filter((o) => o.status === "flying" || (o.doneAt && now - o.doneAt < 3 * 60000))
    .sort((a, b) => (a.status === "flying" ? 0 : 1) - (b.status === "flying" ? 0 : 1) || a.arriveAt - b.arriveAt);
}
function chip(o) {
  const out = o.side === "out", r = o.result, now = warNow();
  const what = o.status === "flying" ? `⏱ ${secLeft(o.arriveAt - now)}` : r?.blocked ? "ما أصابت" : r?.dmg ? `💥 ${ar(r.dmg)}٪` : "🛡️ انعترضت";
  return `<button type="button" class="wr-chip ${out ? "out" : "in"} ${o.status === "flying" ? "fly" : "done"}" data-wrop="${o.id}">
    <b>${out ? "➡️" : "⬅️"} ${out ? `«${o.toTown}»` : `«${o.fromTown}»`}</b><small>${o.bname} · ${weaponsText(o.load)}</small><i>${what}</i></button>`;
}
function stripHtml(st) {
  const list = liveOps(st);
  return list.length ? list.map(chip).join("") : `<p class="hint wr-quiet">ما فيه عمليات بالجو الحين.</p>`;
}
/** The front: our town in the middle, the towns we are in conflict with, and every operation moving between. */
function mapHtml(st) {
  const mine = me()?.plot, rels = (st?.rels || []).filter((r) => r.state !== "peace");
  const plots = new Set([mine, ...rels.map((r) => r.other), ...liveOps(st).flatMap((o) => [o.from, o.to])].filter((p) => p != null));
  const pts = [...plots].map((p) => [p, ...worldXY(p)]);
  const xs = pts.map((p) => p[1]), ys = pts.map((p) => p[2]);
  const x0 = Math.min(...xs) - 2, x1 = Math.max(...xs) + 2, y0 = Math.min(...ys) - 2, y1 = Math.max(...ys) + 2;
  const W = 340, H = 130, sx = W / Math.max(4, x1 - x0), sy = H / Math.max(4, y1 - y0), s = Math.min(sx, sy);
  const at = (p) => { const [x, y] = worldXY(p); return [(x - (x0 + x1) / 2) * s + W / 2, (y - (y0 + y1) / 2) * s + H / 2]; };
  const name = (p) => p === mine ? "مدينتي" : rels.find((r) => r.other === p)?.town || liveOps(st).find((o) => o.from === p)?.fromTown || liveOps(st).find((o) => o.to === p)?.toTown || "";
  const lines = liveOps(st).filter((o) => o.status === "flying").map((o) => {
    const [ax, ay] = at(o.from), [bx, by] = at(o.to);
    return `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" class="wr-line ${o.side}"/><circle r="4" class="wr-dot ${o.side}" data-from="${ax},${ay}" data-to="${bx},${by}" data-t0="${o.launchAt}" data-t1="${o.arriveAt}" cx="${ax}" cy="${ay}"/>`;
  }).join("");
  const towns = [...plots].map((p) => { const [x, y] = at(p), rel = rels.find((r) => r.other === p); return `<g class="wr-town ${p === mine ? "me" : rel?.state || ""}"><circle cx="${x}" cy="${y}" r="${p === mine ? 7 : 5.5}"/><text x="${x}" y="${y - 10}">${name(p)}</text></g>`; }).join("");
  return `<svg class="wr-map" viewBox="0 0 ${W} ${H}" role="img" aria-label="خريطة الجبهة">${lines}${towns}</svg>`;
}
/** Every second while the room is open: the countdowns and the dots move (the tabs are left alone). */
function tick() {
  if (sheetFor !== "warroom") { clearInterval(ROOM.tick); ROOM.tick = null; $("sheet").classList.remove("warroom"); return; }
  const strip = $("wrStrip"); if (strip) { strip.innerHTML = stripHtml(WARX.st); bindStrip(); }
  const now = warNow();
  document.querySelectorAll(".wr-dot").forEach((d) => {
    const [ax, ay] = d.dataset.from.split(",").map(Number), [bx, by] = d.dataset.to.split(",").map(Number), t0 = Number(d.dataset.t0), t1 = Number(d.dataset.t1);
    const k = Math.max(0, Math.min(1, (now - t0) / Math.max(1, t1 - t0)));
    d.setAttribute("cx", ax + (bx - ax) * k); d.setAttribute("cy", ay + (by - ay) * k);
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
  if (o.status === "flying" && o.side === "out") warOpScene(o, false);
  else if (o.status === "flying") { toast(`🚨 ${o.bname}: يوصل بعد ${secLeft(o.arriveAt - warNow())}. تشوف المشهد لا وصل`, ""); ROOM.back = false; }
  else if (o.side === "in") warDefenseScene(o);
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

async function attackTab(st) {
  const wars = st.rels.filter((r) => r.state === "war");
  if (!wars.length) return `<p class="hint">ما فيه حرب الحين. الهجوم يفتح لا صار بينك وبين مدينة حرب: من «🤝 تفاوض» أو خريطة الجوف.</p>`;
  if (!wars.some((r) => r.other === ROOM.enemy)) ROOM.enemy = wars[0].other;
  const enemy = wars.find((r) => r.other === ROOM.enemy);
  const list = await enemyTargets(enemy.other);
  const p = st.profile, ars = st.arsenal;
  const pick = ROOM.pick[enemy.other] ||= {};
  const avail = WEAPON_IDS.filter((w) => !weaponBlocker(p, w) && ars[w] > 0);
  const opts = (sel) => avail.map((w) => `<option value="${w}" ${sel === w ? "selected" : ""}>${WEAPONS[w].icon} ${WEAPONS[w].name} (${ar(ars[w])})</option>`).join("");
  const chosen = Object.entries(pick).filter(([, v]) => v.on);
  const need = {}; let fee = 0, eta = 0, value = 0;
  for (const [, v] of chosen) { need[v.w] = (need[v.w] || 0) + v.n; fee += WEAPONS[v.w].fee * v.n; value += WEAPONS[v.w].price * v.n; eta = Math.max(eta, flightMs(me().plot, enemy.other, v.w)); }
  const short = Object.entries(need).filter(([w, n]) => ars[w] < n).map(([w, n]) => `${WEAPONS[w].name}: تحتاج ${ar(n)} وعندك ${ar(ars[w])}`);
  return `<div class="wr-enemies">${wars.map((r) => `<button type="button" class="${r.other === enemy.other ? "on" : ""}" data-wrenemy="${r.other}">${REL_ICONS[r.state]} «${r.town}»<small>${relTimer(r)}</small></button>`).join("")}</div>
    ${list == null ? `<div class="need">ما قدرت أجيب مباني «${enemy.town}». جرّب بعد شوي.</div>` : !list.length ? `<p class="hint">ما عندها منشآت تنضرب.</p>` : !avail.length ? `<div class="need">💡 ما عندك أسلحة جاهزة: عبّ من «🛡️ دفاع وتعبئة».</div>` : `
    <p class="hint">اختر الأهداف، ولكل هدف سلاحه وعدده. الدفعة تنطلق مرة وحدة، وكل هدف له نتيجته. (حد الدفعة ٦ أهداف)</p>
    <div class="wr-targets">${list.slice(0, 18).map((t) => { const k = `${t.x}:${t.y}`, v = pick[k] || { on: false, w: avail[0], n: 1 }; pick[k] = v; return `<div class="wr-target ${v.on ? "on" : ""}">
      <label><input type="checkbox" data-wrpick="${k}" ${v.on ? "checked" : ""}><span><b>${B[t.id].name}</b><small>${TARGETS[t.id] || ""}${t.wd ? ` · ${damageState(t.wd).name} ${ar(Math.round(t.wd))}٪` : ""}</small></span></label>
      ${v.on ? `<span class="wr-load"><select data-wrw="${k}">${opts(v.w)}</select><span class="step"><button type="button" data-wrdec="${k}">−</button><b>${ar(v.n)}</b><button type="button" data-wrinc="${k}">+</button></span></span>` : ""}</div>`; }).join("")}</div>
    <div class="rows">${row("الأهداف", `${ar(chosen.length)} من ٦`)}${row("الذخيرة", Object.entries(need).map(([w, n]) => `${ar(n)}× ${WEAPONS[w].name}`).join(" · ") || "—")}
      ${row("تكلفة التشغيل", `${money(fee)} ريال`, "minus")}${row("قيمة الذخائر", `${money(value)} ريال`)}${row("وقت الوصول", eta ? `تقريبًا ${secLeft(eta)}` : "—")}</div>
    ${short.length ? `<div class="need">${short.join("<br>")}</div>` : ""}
    <div class="sheet-actions keep"><button class="btn go block" type="button" id="wrFire" ${!chosen.length || chosen.length > 6 || short.length ? "disabled" : ""}>🚀 أطلق الدفعة (${ar(chosen.length)} أهداف)</button>
      <button class="btn block" type="button" id="wrMapTarget">🗺️ أو اختر هدف واحد من المدينة نفسها</button></div>`}`;
}
function defTab(st) {
  const p = st.profile, ars = st.arsenal, caps = st.caps, home = visiting ? visiting.home : S;
  const drones = ars.drone + ars.drone2, missiles = ars.missile + ars.missile2;
  const room = (w) => w === "intc" ? caps.intc - ars.intc : WEAPONS[w].kind === "drone" ? caps.drones - drones : caps.missiles - missiles;
  const line = (w, name, icon, price, why) => `<div class="war-arm ${why ? "locked" : ""}"><b class="ic">${icon}</b><span><b>${name}</b><small>${why || `عندك <b>${ar(ars[w])}</b> · السعر ${money(price)}`}</small></span>
    ${why ? "" : `<span class="wr-buy"><button class="btn" type="button" data-wrbuy="${w}" data-n="1" ${room(w) <= 0 || home.money < price ? "disabled" : ""}>+١</button><button class="btn go" type="button" data-wrbuy="${w}" data-n="${Math.max(0, room(w))}" ${room(w) <= 0 ? "disabled" : ""}>عبّي (${ar(Math.max(0, room(w)))})</button></span>`}</div>`;
  return `<div class="war-grid">
      <div><b>${ar(drones)}<small>/${ar(caps.drones)}</small></b><span>🛩️ مسيّرات</span></div><div><b>${ar(missiles)}<small>/${ar(caps.missiles)}</small></b><span>🚀 صواريخ</span></div>
      <div><b>${ar(ars.intc)}<small>/${ar(caps.intc)}</small></b><span>🛡️ اعتراضية</span></div><div><b>${ar(Math.round(st.intercept.missile * 100))}٪</b><span>صدّ الصواريخ</span></div></div>
    <div class="sheet-actions keep"><button class="btn go block" type="button" id="wrFillAll">⚡ عبّي كل شي مرة وحدة</button></div>
    <div class="rows">${p.airdefs.length ? line("intc", WAR.interceptor.name, "🛡️", WAR.interceptor.price, "") : row("الدفاع الجوي", "✕ ما فيه: ابنِ بطارية دفاع جوي")}
      ${WEAPON_IDS.map((w) => line(w, WEAPONS[w].name, WEAPONS[w].icon, WEAPONS[w].price, weaponBlocker(p, w))).join("")}</div>
    <div class="rows">${row("صدّ المسيّرة", `${ar(Math.round(st.intercept.drone * 100))}٪`)}${row("صدّ الصاروخ", `${ar(Math.round(st.intercept.missile * 100))}٪`)}
      ${row("الرادار", p.radars.length ? `${ar(p.radars.length)} ${p.radars.some((r) => r.wd < 85) ? "✓ يرصد" : "✕ متعطل"}` : "✕ ما فيه")}${row("بطاريات الدفاع", ar(p.airdefs.length))}
      ${row("النائب يعبّي ويصلّح", st.settings.refill || st.settings.repair ? `✓ لين ${money(st.settings.budget)} باليوم` : "✕ موقف")}</div>
    <button class="btn block" type="button" id="wrDeputy">⚙️ أوامر النائب والقيادة التفصيلية</button>`;
}
function enemiesTab(st) {
  const mine = me()?.plot, rels = st.rels.filter((r) => r.state !== "peace");
  if (!rels.length) return `<p class="hint">ما عندك أعداء الحين. 🕊️</p>`;
  return rels.map((r) => {
    const theirs = st.ops.filter((o) => o.from === r.other && o.status === "done"), ours = st.ops.filter((o) => o.to === r.other && o.status === "done");
    const hit = (l) => l.filter((o) => o.result?.dmg).length;
    return `<div class="rg-card wr-enemy"><div class="rg-top"><b>${REL_ICONS[r.state]} «${r.town}»</b><small>العمدة ${r.owner} · ${ERAS[r.era || 0].name}</small></div>
      <div class="rows">${row("الحالة", `${REL_NAMES[r.state]}${relTimer(r)}`)}${row("ضرباتهم علينا", `${ar(theirs.length)} · أصابت ${ar(hit(theirs))}`)}${row("ضرباتنا عليهم", `${ar(ours.length)} · أصابت ${ar(hit(ours))}`)}
        ${r.offer && r.offer.by !== mine ? row("عرض", `<b class="plus">${r.offer.kind === "truce" ? "يعرضون هدنة" : "يعرضون صلح"}</b>`) : ""}</div>
      <div class="wr-acts">${r.state === "war" ? `<button class="btn go" type="button" data-wrattack="${r.other}">🎯 هاجمها</button>` : ""}<button class="btn" type="button" data-wrtalk="${r.other}">🤝 تفاوض</button></div></div>`;
  }).join("");
}
function talkTab(st) {
  const mine = me()?.plot, rels = st.rels;
  if (!rels.length) return `<p class="hint">ما بينك وبين أحد شي. من خريطة الجوف اضغط أي مدينة وتشوف «⚔️ العلاقات العسكرية».</p>`;
  if (!rels.some((r) => r.other === ROOM.talk)) ROOM.talk = (rels.find((r) => r.offer && r.offer.by !== mine) || rels.find((r) => r.state !== "peace") || rels[0]).other;
  const r = rels.find((x) => x.other === ROOM.talk), home = visiting ? visiting.home : S;
  const block = (home.era || 0) < WAR.minEra ? `مدينتك لازم تصير ${ERAS[WAR.minEra].name} أول` : (r.era || 0) < WAR.minEra ? "القرى محمية من الحروب" : (home.era || 0) - (r.era || 0) >= WAR.bully && !["hostile", "warning", "war"].includes(r.state) ? "مدينتك أكبر منها بكثير: ما تبدأ على الصغار (لكن إذا بدأوا عليك تقدر ترد)" : "";
  const acts = relActions(r.state === "peace" && !r.hist?.length ? null : { ...r, a: Math.min(mine, r.other), b: Math.max(mine, r.other) }, mine, warNow(), block);
  const btn = (act, label, cls = "") => `<button class="btn block ${cls}" type="button" data-wract="${act}" ${acts[act] ? `aria-disabled=true data-why="${acts[act]}"` : ""}>${label}${acts[act] ? `<small>${acts[act]}</small>` : ""}</button>`;
  return `<div class="wr-enemies">${rels.map((x) => `<button type="button" class="${x.other === r.other ? "on" : ""}" data-wrtalkto="${x.other}">${REL_ICONS[x.state]} «${x.town}»${x.offer && x.offer.by !== mine ? " 📩" : ""}</button>`).join("")}</div>
    <div class="rows">${row("الحالة", `${REL_NAMES[r.state]}${relTimer(r)}`)}${r.offer ? row("عرض", `${r.offer.kind === "truce" ? "هدنة" : "صلح"} من ${r.offer.by === mine ? "عندك (ينتظر ردهم)" : `«${r.town}»`}`) : ""}</div>
    <div class="war-acts keep">${r.offer && r.offer.by !== mine ? `${btn("accept", r.offer.kind === "truce" ? "🏳️ اقبل الهدنة" : "🤝 اقبل الصلح", "go")}${btn("reject", "✋ ارفض")}` : ""}
      ${btn("truce", "🏳️ اعرض هدنة")}${btn("peace", "🤝 اقترح صلح")}${btn("threat", "😠 أرسل تهديد")}${btn("hostile", "⚔️ إعلان عداوة")}${btn("war", "🔥 إعلان حرب", "danger")}</div>
    ${(r.hist || []).length ? `<h3>تاريخ النزاع</h3><div class="rows">${r.hist.slice(-8).reverse().map((h) => row(`${h.by === mine ? "أنت" : `«${r.town}»`}: ${h.text}`, new Date(h.at - (WARX.offset || 0)).toLocaleTimeString("ar-SA", { hour: "numeric", minute: "2-digit" }))).join("")}</div>` : ""}`;
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
  ROOM.tab = tab;
  const home = visiting ? visiting.home : S;
  if (!home.tiles.some((t) => t.b?.id === "milhq")) { warSheet(); return; } // no command centre yet: the old page explains how to start
  if (!WARX.st) { sheet(`<h2>⚔️ غرفة العمليات</h2><p class="hint">نحمّل…</p>`, "warroom"); await warPoll(true); }
  const st = WARX.st;
  if (!st) { sheet(`<h2>⚔️ غرفة العمليات</h2><div class="need">ما قدرت أوصل للسيرفر.</div>`, "warroom"); return; }
  const body = tab === "attack" ? await attackTab(st) : tab === "def" ? defTab(st) : tab === "enemies" ? enemiesTab(st) : tab === "talk" ? talkTab(st) : logTab(st);
  const wars = st.rels.filter((r) => ["war", "warning"].includes(r.state)).length, incoming = st.ops.filter((o) => o.side === "in" && o.status === "flying").length;
  const keep = $("sheetBody").querySelector(".wr-body")?.scrollTop || 0;
  sheet(`<h2>⚔️ غرفة العمليات</h2>
    <p class="wr-sum">${wars ? `🔥 ${ar(wars)} حرب` : "🕊️ ما فيه حرب"} · ${incoming ? `<b class="minus">🚨 ${ar(incoming)} هجوم جاي</b>` : "لا هجمات جاية"} · 💰 ${money(home.money)}</p>
    <div class="wr-strip" id="wrStrip">${stripHtml(st)}</div>
    ${mapHtml(st)}
    <div class="war-tabs wr-tabs">${TABS.map(([k, n]) => `<button type="button" class="${k === tab ? "on" : ""}" data-wrtab="${k}">${n}</button>`).join("")}</div>
    <div class="wr-body">${body}</div>`, "warroom");
  $("sheet").classList.add("warroom");
  const wb = $("sheetBody").querySelector(".wr-body"); if (wb && tab === ROOM.lastTab) wb.scrollTop = keep;
  ROOM.lastTab = tab;
  clearInterval(ROOM.tick); ROOM.tick = setInterval(tick, 1000);
  bind(st);
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
  // the batch: pick targets, weapons and how many
  const pick = ROOM.pick[ROOM.enemy] || {};
  q("[data-wrpick]").forEach((b) => b.addEventListener("change", () => {
    const v = pick[b.dataset.wrpick]; v.on = b.checked;
    if (v.on && Object.values(pick).filter((x) => x.on).length > 6) { v.on = false; toast("الدفعة ٦ أهداف بالكثير", "bad"); }
    sfx.tap(); warRoom("attack");
  }));
  q("[data-wrw]").forEach((s) => s.addEventListener("change", () => { pick[s.dataset.wrw].w = s.value; warRoom("attack"); }));
  q("[data-wrinc]").forEach((b) => b.addEventListener("click", () => { const v = pick[b.dataset.wrinc]; v.n = Math.min(8, v.n + 1); sfx.tap(); warRoom("attack"); }));
  q("[data-wrdec]").forEach((b) => b.addEventListener("click", () => { const v = pick[b.dataset.wrdec]; v.n = Math.max(1, v.n - 1); sfx.tap(); warRoom("attack"); }));
  $("wrMapTarget")?.addEventListener("click", () => { closeSheet(); startTargeting(ROOM.enemy); });
  $("wrFire")?.addEventListener("click", async () => {
    const targets = Object.entries(pick).filter(([, v]) => v.on).map(([k, v]) => { const [x, y] = k.split(":").map(Number); return { x, y, load: { [v.w]: v.n } }; });
    $("wrFire").disabled = true;
    await warSyncNow();
    const op = `salvo${warReq()}`;
    let r = await warApi("salvo", { op, to: ROOM.enemy, targets });
    if (r.error === "ما قدرت أوصل للسيرفر: جرّب بعد شوي") { await new Promise((ok) => setTimeout(ok, 1500)); r = await warApi("salvo", { op, to: ROOM.enemy, targets }); } // the same id: never twice
    if (r.error) { toast(r.error, "bad"); sfx.deny(); $("wrFire").disabled = false; return; }
    sfx.goal?.(); toast(`🚀 انطلقت الدفعة: ${ar(r.ops.length)} أهداف · تكلفة ${money(r.charge?.amount || 0)} ريال`, "goal");
    ROOM.pick[ROOM.enemy] = {};
    await warPoll(true);
    warRoom("attack");
  });
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
    const kinds = [...(p.airdefs.length ? ["intc"] : []), ...WEAPON_IDS.filter((w) => !weaponBlocker(p, w))];
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
  // negotiation
  q("[data-wract]").forEach((b) => b.addEventListener("click", async () => {
    if (b.dataset.why) { toast(b.dataset.why, "bad"); sfx.deny(); return; }
    const act = b.dataset.wract, r = st.rels.find((x) => x.other === ROOM.talk);
    if (act === "threat") { threatSheet(ROOM.talk, { town: r.town, owner: r.owner, era: r.era }); return; }
    if (act === "war" && !confirm(`تعلن الحرب على «${r.town}»؟`)) return;
    b.disabled = true; await warSyncNow();
    const res = await warApi("rel", { req: warReq(), other: ROOM.talk, act });
    if (res.error) { toast(res.error, "bad"); sfx.deny(); b.disabled = false; return; }
    sfx.tap(); toast({ accept: "✓ قبلت", reject: "رفضت العرض", truce: "🏳️ أرسلت عرض الهدنة", peace: "🤝 أرسلت عرض الصلح", hostile: "⚔️ أعلنت العداوة", war: "🔥 أعلنت الحرب" }[act] || "✓", "goal");
    await warPoll(true); warRoom("talk");
  }));
  // repairs and replays
  q("[data-wrfix]").forEach((b) => b.addEventListener("click", async () => { const [x, y] = b.dataset.wrfix.split(":").map(Number); b.disabled = true; await warRepairAt(x, y); await warPoll(true); warRoom("log"); }));
}

/** The war button: red and pulsing while there is a war or an attack on its way. */
export function warRoomBadge(st) {
  const btn = $("warBtn"); if (!btn || !st) return;
  const hot = st.rels?.some((r) => ["war", "warning"].includes(r.state)) || st.ops?.some((o) => o.side === "in" && o.status === "flying");
  btn.classList.toggle("wr-hot", !!hot);
  if (sheetFor === "warroom" && !ROOM.redrawing) { ROOM.redrawing = true; setTimeout(() => { ROOM.redrawing = false; if (sheetFor === "warroom" && !document.activeElement?.closest?.(".wr-body select")) warRoom(ROOM.tab); }, 300); }
}
