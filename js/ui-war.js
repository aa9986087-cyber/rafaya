// «صراع الجوف» on the game's side: the command, relations, targeting, scenes, war damage.
// Moved out of js/main.js as it was (nothing changed in it); main.js and the modules import each other's names.
import { ROOM, roomAfterScene, warRoom, warRoomBadge } from "./ui-warroom.js";
import { LIVE, api, me, worldSync } from "./ui-online.js";
import { $, A, S, ar, arrange, closeSheet, fine, inspect, leaveVisit, money, setTool, sheet, sheetFor, store, visitTown, visiting, warApply, world, worldMode } from "./main.js";
import { REL_ICONS, REL_NAMES, TARGETS, THREATS, WAR, WEAPONS, WEAPON_IDS, blastArea, canTarget, damageState, flightMs, milStat, minutesText, relActions, repairCostOf, repairMsOf, targetText, warFactor, weaponBlocker } from "./war.js";
import { sfx, warSfx } from "./sound.js";
import { namefixSheet, townRemoved } from "./ui-account.js";
import { FIX, floatAt, row, toast } from "./ui-build.js";
import { addPosts } from "./ui-news.js";
import { B, ERAS, MAP_SIZE as N, MIL, WORLD, worldXY } from "./data.js";
import { idx, levelName } from "./sim.js";

export const WARX = {
  st: null,          // the last state from the server
  polled: 0,         // when it was asked (ms)
  busy: false,
  targeting: null,   // { plot, town, owner, era, list, sel } while choosing a building in an enemy town
  scene: null,       // { op, kind } while a war scene plays
  watched: new Set() // operations whose result was already shown
};
export const warKey = (k) => `rafaya-war-${k}-${me()?.plot ?? "x"}`;
export const warSeen = () => Number(store.get(warKey("seen")) || 0);
export const warPlayed = () => new Set(JSON.parse(store.get(warKey("played")) || "[]"));
export const markPlayed = (id) => { const s = warPlayed(); s.add(id); store.set(warKey("played"), JSON.stringify([...s].slice(-80))); };
export const warReq = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e8).toString(36)}`;
export const warNow = () => Date.now() + (WARX.offset || 0);
export const fmtLeft = (ms) => minutesText(Math.max(1000, ms));
export const secLeft = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return s >= 90 ? minutesText(s * 1000) : `${ar(s)} ث`; };
/** A war request to the server (always as you, with your secret). Returns the answer ({ error } when refused). */
export async function warApi(action, body = {}) {
  const id = me();
  if (!id || id.plot == null) return { error: "سجّل وأسس مدينتك بعالم الجوف أول" };
  if (action !== "state" && worldMode && (visiting?.home ?? S).world?.syncConflict) return { error: "افتح حفظ السيرفر أول عشان ترجع مزامنة مدينتك" };
  try { return await api(`/world/war/${action}`, { name: id.name, secret: id.secret, ...body }); } catch (e) { return { error: e.message === "maintenance" ? "عالم الجوف تحت الصيانة" : "ما قدرت أوصل للسيرفر: جرّب بعد شوي" }; }
}
/** The buildings as the server last saw them: when they changed, send the town before any war action (the server only trusts what it has). */
export const warTownKey = (s) => `${s.era}|${s.tiles.map(({ t, b }) => b
  ? [t, b.id, b.lvl, b.build > 0 ? "b" : "", b.rot || 0, b.n || 1, b.monument || ""].join(":") : t[0]).join(",")}`;
export async function warSyncNow() {
  const home = visiting ? visiting.home : S, id = me();
  if (!worldMode || arrange || id?.plot == null || home?.world?.plot !== id.plot) return;
  if (WARX.syncTown === home && warTownKey(home) === WARX.syncKey) return;
  await worldSync(true);
}
/** An apology in the middle of the screen: what went wrong (our mistake) and what was given back. 30 seconds, or «تمام». */
export function apologyBox(n) {
  document.getElementById("apology")?.remove();
  const el = document.createElement("div");
  el.id = "apology"; el.className = "apology";
  el.innerHTML = n.kind === "gift" ? `<div class="apology-card"><div class="apology-ic">🎁</div><h2>هدية من إدارة الجوف</h2>
    <div class="apology-back">وصلتك هدية<b>+${money(n.amount || 0)} ريال</b></div>
    ${n.text ? `<p>«${n.text.replace(/[<>]/g, "")}»</p>` : ""}` : `<div class="apology-card"><div class="apology-ic">🙏</div><h2>نعتذر منك</h2>
    <p>صار <b>خطأ من عندنا</b> ببرمجة اللعبة بحساب خصم الغياب، وانخصم من مدينتك مبلغ ما كان المفروض ينخصم.</p>
    <div class="apology-back">رجّعنا لك حقك كامل<b>+${money(n.amount || 0)} ريال</b></div>
    <p class="hint">السموحة منك، وشكرًا على صبرك 🌹</p>`;
  el.innerHTML += `<i class="apology-bar"></i><button class="btn go block" type="button">تمام</button>`;
  el.querySelector(".apology-card").append(...el.querySelectorAll(":scope > .apology-bar, :scope > button")); // the bar and «تمام» for both kinds
  document.body.append(el);
  sfx.coin?.();
  const close = () => { el.classList.add("out"); setTimeout(() => el.remove(), 300); };
  el.querySelector("button").addEventListener("click", close);
  setTimeout(close, 30000);
}
/** Ask the server how things stand, and bring the town up to date (money, damage, notes, attacks). */
export async function warPoll(force) {
  if (force && WARX.busy) { WARX.again = true; return WARX.st; } // a hint while a poll runs: ask again right after (a gift or a strike is never left waiting)
  if (!worldMode || WARX.busy || (!force && Date.now() - WARX.polled < (LIVE.ok ? 90000 : 25000))) return WARX.st; // live: pushed at once, this is only a safety net
  WARX.busy = true; WARX.polled = Date.now();
  if (force) await warSyncNow();
  const st = await warApi("state", { since: warSeen(), seq: (visiting ? visiting.home : S).war?.seq || 0 });
  WARX.busy = false;
  if (st.noTown && worldMode) { townRemoved(st.namefix); return WARX.st; }
  if (st.namefix) namefixSheet(st.namefix);
  else if (FIX.ask && !st.error) { FIX.ask = null; if (sheetFor === "namefix") closeSheet(); } // the owner took the request back
  if (st.error) return WARX.st;
  WARX.offset = st.now - Date.now();
  world.fx && (world.fx.clockOffset = WARX.offset);
  WARX.st = st;
  if (!(visiting?.home ?? S).world?.syncConflict) warApply(st);
  if (WARX.again) { WARX.again = false; setTimeout(() => warPoll(true), 50); }
  return st;
}
/** Results to show: an attack on us that just landed (played here if the mayor is home), our own that just landed. */
export function warWatch(st) {
  const played = warPlayed();
  for (const o of st.ops || []) {
    if (o.status !== "done" || played.has(o.id) || WARX.watched.has(o.id)) continue;
    if (o.salvo && (st.ops || []).some((x) => x.salvo === o.salvo && x.status === "flying")) continue; // a salvo plays once all of it has landed
    if (Date.now() - (o.doneAt - WARX.offset) > 15 * 60000) { markPlayed(o.id); continue; } // old news: in the log only
    if (WARX.scene || sheetFor === "war-report") continue; // a scene or its report is on: this one plays after (next poll)
    // another attack on us lands within half a minute: wait for it, so they play together (but never more than 45 s)
    if (o.side === "in" && Date.now() - (o.doneAt - WARX.offset) < 45000 && (st.ops || []).some((x) => x.side === "in" && x.status === "flying" && x.arriveAt - warNow() < 30000)) { clearTimeout(WARX.gatherT); WARX.gatherT = setTimeout(() => warPoll(true), 4000); continue; }
    // it plays at once, wherever the mayor is (the report then has the way back to the war room); only choosing targets,
    // a decision to answer or another scene make it wait (it plays right after them)
    if (WARX.targeting || WARX.scene || sheetFor === "decision") continue;
    WARX.watched.add(o.id);
    if (o.side === "in") warDefenseScene(o);
    else { for (const x of salvoOf(o)) { markPlayed(x.id); WARX.watched.add(x.id); } resultScene(o); }
  }
  // an attack on its way: a countdown at the top
  const incoming = (st.ops || []).filter((o) => o.side === "in" && o.status === "flying" && o.detected).sort((a, b) => a.arriveAt - b.arriveAt)[0];
  clearTimeout(WARX.arriveTimer);
  const next = (st.ops || []).filter((o) => o.status === "flying").sort((a, b) => a.arriveAt - b.arriveAt)[0];
  if (next) WARX.arriveTimer = setTimeout(() => warPoll(true), Math.max(1500, next.arriveAt - warNow() + 1500));
  warAlertBar(incoming);
  warRoomBadge(st);
}
export function warAlertBar(op) {
  const bar = $("warAlert");
  clearInterval(WARX.alertTick);
  if (!op) { bar.hidden = true; return; }
  bar.hidden = false;
  const draw = () => { const left = op.arriveAt - warNow(); bar.innerHTML = `🚨 هجوم من «${op.fromTown}» على ${op.bname} · يوصل بعد <b>${secLeft(left)}</b>`; if (left <= 0) { clearInterval(WARX.alertTick); bar.hidden = true; } };
  draw(); WARX.alertTick = setInterval(draw, 1000);
}
/** What the residents say about the war (local templates only). */
export function warNews(notes) {
  const hour = S.day, posts = [];
  // "d-": a post the mayor does not answer (no promise to keep); a complaint still shows «💡 وش يبي»
  const say = (kind, text, mood) => posts.push({ id: `d-war${Date.now()}${posts.length}`, day: hour, kind: "war", person: { name: ["أبو سعد", "أم فهد", "أبو ناصر", "مشاري", "أبو خالد", "نوف"][Math.floor(Math.random() * 6)], role: "من الأهالي", area: "" }, text, mood, topic: "war" });
  for (const n of notes) {
    if (n.kind === "hit") say("hit", `${n.text.replace(/^💥 /, "")} الأهالي ينتظرون الإصلاح.`, -1);
    if (n.kind === "intercept") say("intercept", "دفاعات المدينة نجحت في اعتراض هجوم جوي، والحمد لله ما صار ضرر.", 1);
    if (n.kind === "war") say("war", n.text.includes("أعلنت الحرب على") ? "العمدة أعلن الحرب! الله يستر، والناس يسألون عن المصاريف." : "أعلنوا علينا الحرب! نبي دفاع جوي يحمينا.", -1);
    if (n.kind === "repair" && n.text.startsWith("🔧 النائب")) say("repair", "شفنا عمال الإصلاح عند المبنى المضروب، الله يعطيهم العافية.", 1);
    if (n.kind === "peace") say("peace", "انتهت العداوة بين المدينتين، والأهالي يأملون ترجع الأمور طبيعية.", 1);
    if (n.kind === "truce") say("truce", "هدنة! الناس ارتاحوا شوي.", 1);
  }
  if (posts.length) addPosts(posts.slice(0, 3));
}
export const WAR_TABS = [["home", "نظرة عامة"], ["arms", "الترسانة"], ["def", "الدفاع"], ["ops", "العمليات"], ["rels", "العلاقات"], ["log", "السجل"], ["deputy", "النائب"]];
export const stateTag = (wd) => { const d = damageState(wd); return `<i class="wd-tag ${d.cls}">${d.name}${wd ? ` ${ar(Math.round(wd))}٪` : ""}</i>`; };
export async function warSheet(tab = "home") {
  WARX.tab = tab;
  if (!worldMode) return;
  const home = visiting ? visiting.home : S;
  const hasHQ = home.tiles.some((t) => t.b?.id === "milhq");
  if (!WARX.st) { sheet(`<h2>⚔️ القيادة العسكرية</h2><p class="hint">نحمّل…</p>`, "war"); await warPoll(true); }
  const st = WARX.st;
  if (!st) { sheet(`<h2>⚔️ القيادة العسكرية</h2><div class="need">ما قدرت أوصل للسيرفر.</div>`, "war"); return; }
  if (!hasHQ) {
    sheet(`<h2>⚔️ القيادة العسكرية — عالم الجوف</h2>
      <p>بعالم الجوف تقدر تبني قوة عسكرية: صواريخ ومسيّرات تضرب فيها منشآت الخصوم وقت الحرب، ورادار ودفاع جوي يحمي مدينتك.</p>
      <div class="rows">${row("تبدأ من", `${ERAS[WAR.minEra].name} (${ar(ERAS[WAR.minEra].pop)} ساكن)`)}${row("أول خطوة", "ابنِ «مركز القيادة العسكرية»")}${row("وين؟", "البناء ← الدفاع والعسكرية")}</div>
      <div class="need ok">الضربة تنزل على مكان، وكل اللي حوله يتضرر حسب قوة السلاح، إلا المساجد: ما تنقصف ولا تتضرر. والضرر ينصلح وما يمسح شي.</div>
      ${home.era < WAR.minEra ? `<div class="need">مدينتك للحين ${ERAS[home.era].name}: القرى ما تهاجم ولا تنهاجم.</div>` : ""}`, "war");
    return;
  }
  const tabs = `<div class="war-tabs">${WAR_TABS.map(([k, n]) => `<button type="button" class="${k === tab ? "on" : ""}" data-wtab="${k}">${n}</button>`).join("")}</div>`;
  const p = st.profile, ars = st.arsenal, caps = st.caps;
  const drones = ars.drone + ars.drone2, missiles = ars.missile + ars.missile2;
  const list = (items, id) => items.length ? items.map((it) => row(`${milStat(id, it.lvl).name}`, stateTag(it.wd))).join("") : "";
  let body = "";
  if (tab === "home") {
    const flying = st.ops.filter((o) => o.status === "flying");
    body = `<div class="war-grid">
        <div><b>${ar(drones)}${caps.open ? "" : `<small>/${ar(caps.drones)}</small>`}</b><span>🛩️ مسيّرات</span></div>
        <div><b>${ar(missiles)}${caps.open ? "" : `<small>/${ar(caps.missiles)}</small>`}</b><span>🚀 صواريخ</span></div>
        <div><b>${ar(ars.intc)}<small>/${ar(caps.intc)}</small></b><span>🛡️ اعتراضية</span></div>
        <div><b>${ar(flying.length)}</b><span>✈️ عمليات بالجو</span></div></div>
      <div class="rows">
        ${p.hq ? row("مركز القيادة", `${milStat("milhq", p.hq.lvl).name} ${stateTag(p.hq.wd)}`) : ""}
        ${row("قواعد المسيّرات", ar(p.bases.length))}${row("منصات الصواريخ", ar(p.pads.length))}
        ${row("الرادار", p.radars.length ? `${ar(p.radars.length)} ${p.radars.some((r) => r.wd < 85) ? "✓ يرصد" : "✕ متعطل"}` : "✕ ما فيه")}
        ${row("الدفاع الجوي", p.airdefs.length ? `${ar(p.airdefs.length)} بطارية` : "✕ ما فيه")}
        ${row("فرصة اعتراض مسيّرة", `${ar(Math.round(st.intercept.drone * 100))}٪`)}${row("فرصة اعتراض صاروخ", `${ar(Math.round(st.intercept.missile * 100))}٪`)}
        ${row("المصروف العسكري بالساعة", `−${fine(A.costs.military || 0)}`, "minus")}
        ${st.shield ? row("🛡️ درع الحماية", `باقي ${fmtLeft(st.shield - warNow())}`, "plus") : ""}
        ${row("علاقات متوترة", ar(st.rels.filter((r) => r.state !== "peace").length))}
      </div>
      ${!p.airdefs.length ? `<div class="need">💡 مدينتك بلا دفاع جوي: أي هجوم يوصل. ابنِ بطارية دفاع جوي ورادار، واشترِ صواريخ اعتراضية.</div>` : !ars.intc ? `<div class="need">💡 الدفاع الجوي بلا ذخيرة: اشترِ صواريخ اعتراضية من «الدفاع».</div>` : ""}
      <p class="hint">للهجوم: افتح خريطة الجوف، اختر مدينة بينك وبينها حرب، واضغط «🎯 استهداف المدينة».</p>`;
  } else if (tab === "arms") {
    body = `<p class="hint">الأسعار من ميزانية مدينتك. المسيّرات تنحفظ بالقاعدة، والصواريخ على المنصات.</p><div class="rows">` + WEAPON_IDS.map((w) => {
      const W = WEAPONS[w], why = weaponBlocker(p, w), kind = W.kind === "drone" ? "drones" : "missiles", room = caps[kind] - (W.kind === "drone" ? drones : missiles);
      return `<div class="war-arm ${why ? "locked" : ""}"><b class="ic">${weaponIcon(w)}</b><span><b>${W.name}</b><small>${W.text}</small><small>القوة ${ar(W.power)} · السعر ${money(W.price)} ريال · تشغيل ${money(W.fee)} · عندك <b>${ar(ars[w])}</b></small>${why ? `<small class="minus">${why}</small>` : ""}</span>
        ${why ? "" : `<button class="btn go" type="button" data-buy="${w}" ${room <= 0 || home.money < W.price ? "disabled" : ""}>+١</button>`}</div>`;
    }).join("") + `</div><p class="hint">${caps.open ? "⚔️ الحرب مفتوحة: خزّن اللي تبي من المسيّرات والصواريخ. المنصة والقاعدة تحددان كم ينطلق بكل تجهيز." : `مكان للمسيّرات: ${ar(Math.max(0, caps.drones - drones))} · للصواريخ: ${ar(Math.max(0, caps.missiles - missiles))}`}</p>`;
  } else if (tab === "def") {
    body = `<div class="rows">${list(p.airdefs, "airdef") || row("بطاريات الدفاع الجوي", "✕ ما فيه")}${list(p.radars, "radar") || row("الرادار", "✕ ما فيه")}
        ${row("صواريخ اعتراضية", `${ar(ars.intc)} من ${ar(caps.intc)}`)}
        ${row("ضد المسيّرة الأساسية", `${ar(Math.round(st.intercept.drone * 100))}٪`)}${row("ضد المسيّرة المتطورة", `${ar(Math.round(st.intercept.drone2 * 100))}٪`)}
        ${row("ضد الصاروخ العادي", `${ar(Math.round(st.intercept.missile * 100))}٪`)}${row("ضد الصاروخ المتقدم", `${ar(Math.round(st.intercept.missile2 * 100))}٪`)}</div>
      ${p.airdefs.length ? `<div class="sheet-actions keep"><button class="btn go block" type="button" data-buy="intc" ${ars.intc >= caps.intc || home.money < WAR.interceptor.price ? "disabled" : ""}>اشترِ صاروخ اعتراضي (${money(WAR.interceptor.price)} ريال)</button>
        <button class="btn block" type="button" data-buy="intcfill" ${ars.intc >= caps.intc ? "disabled" : ""}>عبّها كلها (${money((caps.intc - ars.intc) * WAR.interceptor.price)} ريال)</button></div>` : ""}
      <p class="hint">كل محاولة اعتراض تستهلك صاروخ اعتراضي. الرادار يرفع الدقة ويعطيك إنذار قبل الوصول، وبدونه الدفاع شبه أعمى. والضرر على الرادار أو البطارية يضعف الحماية.</p>`;
  } else if (tab === "ops") {
    body = st.ops.length ? `<div class="rows">${st.ops.map((o) => {
      const r = o.result, out = o.side === "out", when = new Date(o.launchAt - WARX.offset).toLocaleTimeString("ar-SA", { hour: "numeric", minute: "2-digit" });
      const what = o.status === "flying" ? `بالجو · يوصل بعد ${secLeft(o.arriveAt - warNow())}` : r.blocked ? "ما أصابت" : r.dmg ? `إصابة ${ar(r.dmg)}٪` : "انعترضت";
      return `<button class="row link" type="button" data-op="${o.id}"><span><b>${out ? "➡️ على" : "⬅️ من"} «${out ? o.toTown : o.fromTown}»</b><small>${o.bname} · ${weaponsText(o.load)} · ${when}</small></span><b class="${o.status === "flying" ? "" : r.dmg ? (out ? "plus" : "minus") : out ? "minus" : "plus"}">${what}</b></button>`;
    }).join("")}</div>` : `<p class="hint">ما فيه عمليات للحين.</p>`;
  } else if (tab === "rels") {
    body = st.rels.length ? `<div class="rows">${st.rels.map((r) => `<button class="row link" type="button" data-rel="${r.other}"><span><b>${REL_ICONS[r.state]} «${r.town}»</b><small>العمدة ${r.owner} · ${ERAS[r.era || 0].name}${r.offer && r.offer.by !== me()?.plot ? ` · <b class="plus">${r.offer.kind === "truce" ? "يعرض هدنة" : "يعرض صلح"}</b>` : ""}</small></span><b>${REL_NAMES[r.state]}${relTimer(r)}</b></button>`).join("")}</div>`
      : `<p class="hint">ما بينك وبين أحد شي. من خريطة الجوف اضغط أي مدينة وتشوف «⚔️ العلاقات العسكرية».</p>`;
  } else if (tab === "log") {
    const notes = (st.notes || []).slice(0, 40);
    body = notes.length ? `<div class="rows">${notes.map((n) => `<div class="row ol-com"><span><small>${new Date(n.at - WARX.offset).toLocaleString("ar-SA", { weekday: "short", hour: "numeric", minute: "2-digit" })}</small></span><p>${n.text}</p></div>`).join("")}</div>` : `<p class="hint">السجل فاضي.</p>`;
  } else if (tab === "deputy") {
    const o = st.settings;
    body = `<p>وأنت طالع، النائب يتصرف بالدفاع بس: ما يعلن حرب ولا يهاجم ولا يشتري أسلحة هجومية.</p>
      <div class="rows"><label class="row toggle"><span>يصلح الأضرار العسكرية بنفسه</span><input type="checkbox" id="wdRepair" ${o.repair ? "checked" : ""}></label>
        <label class="row toggle"><span>يعبي الصواريخ الاعتراضية</span><input type="checkbox" id="wdRefill" ${o.refill ? "checked" : ""}></label>
        <div class="row"><span>أقصى صرف له باليوم</span><select id="wdBudget">${[0, 2000, 5000, 10000, 25000, 50000].map((v) => `<option value="${v}" ${o.budget === v ? "selected" : ""}>${money(v)}</option>`).join("")}</select></div></div>
      <p class="hint">يصرف من ميزانية مدينتك، وما يتعدى الحد اللي حددته.</p>`;
  }
  sheet(`<h2>⚔️ القيادة العسكرية — عالم الجوف</h2>${tabs}${body}`, "war");
  $("sheetBody").querySelectorAll("[data-wtab]").forEach((b) => b.addEventListener("click", () => { sfx.tap(); warSheet(b.dataset.wtab); }));
  $("sheetBody").querySelectorAll("[data-buy]").forEach((b) => b.addEventListener("click", async () => {
    const kind = b.dataset.buy === "intcfill" ? "intc" : b.dataset.buy, n = b.dataset.buy === "intcfill" ? caps.intc - ars.intc : 1;
    b.disabled = true;
    await warSyncNow();
    const r = await warApi("buy", { req: warReq(), kind, n });
    if (r.error) { toast(r.error, "bad"); sfx.deny(); b.disabled = false; return; }
    sfx.coin(); toast(`✓ ${r.charge.why} (−${money(r.charge.amount)} ريال)`, "goal");
    await warPoll(true);
    warSheet(tab);
  }));
  $("sheetBody").querySelectorAll("[data-op]").forEach((b) => b.addEventListener("click", () => { const o = st.ops.find((x) => x.id === b.dataset.op); if (o) opReport(o); }));
  $("sheetBody").querySelectorAll("[data-rel]").forEach((b) => b.addEventListener("click", () => relSheet(Number(b.dataset.rel))));
  const setDeputy = async () => { const r = await warApi("settings", { repair: $("wdRepair").checked, refill: $("wdRefill").checked, budget: Number($("wdBudget").value) }); if (r.error) toast(r.error, "bad"); else { WARX.st.settings = r.settings; toast("✓ حفظنا أوامر النائب", "goal"); } };
  for (const k of ["wdRepair", "wdRefill", "wdBudget"]) $(k)?.addEventListener("change", setDeputy);
}
export const weaponsText = (load) => Object.entries(load || {}).map(([w, n]) => `${n > 1 ? `${ar(n)}× ` : ""}${WEAPONS[w].name}`).join(" + ");
export function relTimer(r) {
  const now = warNow();
  if (r.state === "warning") return ` · تبدأ بعد ${fmtLeft(r.warStart - now)}`;
  if (r.state === "war") return ` · تخلص بعد ${fmtLeft(r.warEnd - now)}`;
  if (r.state === "truce") return ` · باقي ${fmtLeft(r.truceEnd - now)}`;
  return "";
}
export async function relSheet(plot) {
  // with a command centre: the town opens in the war room's map (tribute, war, talk, truce, peace)
  if ((visiting ? visiting.home : S).tiles.some((t) => t.b?.id === "milhq")) { ROOM.sel = plot; ROOM.form = ""; warRoom("world"); return; }
  const st = await warPoll(true) || WARX.st;
  let r = st?.rels.find((x) => x.other === plot);
  let info = r ? { town: r.town, owner: r.owner, era: r.era } : null;
  if (!info) { try { const d = await api(`/world/town/${plot}`); info = { town: d.town.town, owner: d.town.owner, era: d.town.era }; } catch { toast("ما لقيت المدينة", "bad"); return; } }
  r ||= { state: "peace", hist: [] };
  const mine = me()?.plot, home = visiting ? visiting.home : S;
  const block = (home.era || 0) < WAR.minEra ? `مدينتك لازم تصير ${ERAS[WAR.minEra].name} أول` : (info.era || 0) < WAR.minEra ? "القرى محمية من الحروب" : (home.era || 0) - (info.era || 0) >= WAR.bully && !["hostile", "warning", "war"].includes(r.state) ? "مدينتك أكبر منها بكثير: ما تبدأ على الصغار (لكن إذا بدأوا عليك تقدر ترد)" : "";
  const acts = relActions(r.state === "peace" && !r.hist?.length ? null : { ...r, a: Math.min(mine, plot), b: Math.max(mine, plot) }, mine, warNow(), block);
  const btn = (act, label, cls = "") => `<button class="btn block ${cls}" type="button" data-act="${act}" ${acts[act] ? `data-why="${acts[act]}"` : ""} ${acts[act] ? "aria-disabled=true" : ""}>${label}${acts[act] ? `<small>${acts[act]}</small>` : ""}</button>`;
  sheet(`<h2>⚔️ العلاقات العسكرية</h2>
    <div class="rg-card"><div class="rg-top"><b>${REL_ICONS[r.state]} «${info.town}»</b><small>العمدة ${info.owner} · ${ERAS[info.era || 0].name}</small></div>
      <div class="rows">${row("الحالة", `${REL_NAMES[r.state]}${relTimer(r)}`)}${r.offer ? row("عرض", `${r.offer.kind === "truce" ? "هدنة" : "صلح"} من ${r.offer.by === mine ? "عندك" : `«${info.town}»`}`) : ""}</div></div>
    <div class="war-acts keep">
      ${r.offer && r.offer.by !== mine ? `${btn("accept", r.offer.kind === "truce" ? "🏳️ اقبل الهدنة" : "🤝 اقبل الصلح", "go")}${btn("reject", "✋ ارفض")}` : ""}
      ${btn("threat", "😠 أرسل تهديد")}${btn("hostile", "⚔️ إعلان عداوة")}${btn("war", "🔥 إعلان حرب", "danger")}${btn("truce", "🏳️ اعرض هدنة")}${btn("peace", "🤝 اقترح صلح")}
      ${r.state === "war" ? `<button class="btn go block" type="button" id="relTarget">🎯 استهداف المدينة</button>` : ""}
    </div>
    <h3>تاريخ النزاع</h3>
    ${r.hist?.length ? `<div class="rows">${r.hist.slice().reverse().map((h) => `<div class="row"><span>${h.by === mine ? "أنت" : `«${info.town}»`}: ${h.text}</span><b><small>${new Date(h.at - (WARX.offset || 0)).toLocaleDateString("ar-SA", { month: "short", day: "numeric" })}</small></b></div>`).join("")}</div>` : `<p class="hint">ما بينكم شي للحين.</p>`}
    <p class="hint">بعد إعلان الحرب فيه إنذار ${minutesText(WAR.T.warning)}، والحرب تدوم ${minutesText(WAR.T.war)}. للجزية والمحادثة ابنِ مركز القيادة العسكرية.</p>`, "war-rel");
  $("relTarget")?.addEventListener("click", () => startTargeting(plot));
  $("sheetBody").querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async () => {
    if (b.dataset.why) { toast(b.dataset.why, "bad"); sfx.deny(); return; }
    const act = b.dataset.act;
    if (act === "threat") { threatSheet(plot, info); return; }
    if ((act === "war" || act === "hostile") && !b.dataset.sure) { b.dataset.sure = "1"; b.querySelector("small")?.remove(); b.insertAdjacentHTML("beforeend", "<small>متأكد؟ اضغط مرة ثانية</small>"); return; }
    const res = await warApi("rel", { req: warReq(), other: plot, act });
    if (res.error) { toast(res.error, "bad"); sfx.deny(); return; }
    (act === "war" ? warSfx.alarm : sfx.goal)();
    await warPoll(true);
    relSheet(plot);
  }));
}
export function threatSheet(plot, info) {
  sheet(`<h2>😠 تهديد لـ«${info.town}»</h2><p>اختر الرسالة (تنرسل باسم مدينتك):</p>
    <div class="rows keep">${THREATS.map((t, i) => `<button class="row link" type="button" data-threat="${i}"><span>${t}</span><b>←</b></button>`).join("")}</div>`, "war-rel");
  $("sheetBody").querySelectorAll("[data-threat]").forEach((b) => b.addEventListener("click", async () => {
    const res = await warApi("rel", { req: warReq(), other: plot, act: "threat", text: Number(b.dataset.threat) });
    if (res.error) { toast(res.error, "bad"); return; }
    toast("وصل التهديد 😠", ""); relSheet(plot);
  }));
}
export async function startTargeting(plot) {
  const st = WARX.st || await warPoll(true);
  const r = st?.rels.find((x) => x.other === plot);
  if (!r || r.state !== "war") { toast(r?.state === "warning" ? `الحرب تبدأ بعد ${fmtLeft(r.warStart - warNow())}` : "لازم تكون بينكم حرب", "bad"); return; }
  if (!(visiting ? visiting.home : S).tiles.some((t) => t.b?.id === "milhq")) { toast("تحتاج مركز القيادة العسكرية", "bad"); return; }
  await visitTown(plot, { target: true });
  if (!visiting) return;
  const list = [];
  S.tiles.forEach((t, i) => { if (t.b && !(t.b.build > 0)) list.push({ x: i % N, y: Math.floor(i / N), id: t.b.id }); });
  WARX.targeting = { plot, town: visiting.info.name, owner: visiting.info.mayor, era: visiting.info.era, list, points: [], sel: -1 };
  document.body.classList.add("targeting");
  world.fx.showTargets(null);
  strikeView();
  targetBar();
  toast("🎯 اضغط أي مكان بالمدينة: الضربة تنزل عليه وعلى اللي حوله (المساجد محمية)", "");
}
/** The weapons ready for this town's attack, best first (missiles before drones). */
const readyWeapons = () => { const st = WARX.st, p = st?.profile; return p ? ["missile2", "missile", "drone2", "drone"].filter((w) => !weaponBlocker(p, w) && st.arsenal[w] > 0) : []; };

/** Each weapon drawn in its own shape (inline SVG, coloured by the button it sits in). */
const WEAPON_SVG = {
  // صاروخ طويق: a slim missile, pointed nose, four fins
  missile: `<svg viewBox="0 0 64 24" aria-hidden="true"><path d="M6 12 L16 7 H50 L60 12 L50 17 H16 Z" fill="#e9e4d6"/><path d="M50 7 L60 12 L50 17 Z" fill="#c8463a"/><rect x="22" y="7" width="3" height="10" fill="#8a7a55"/><path d="M8 12 L2 3 L12 7 Z M8 12 L2 21 L12 17 Z" fill="#8a8f8c"/><path d="M6 10 H0 V14 H6 Z" fill="#ffb347"/></svg>`,
  // صاروخ النفود: heavy, thick body, red band, big fins
  missile2: `<svg viewBox="0 0 64 24" aria-hidden="true"><path d="M8 12 L16 5 H48 L62 12 L48 19 H16 Z" fill="#d9d2c0"/><path d="M48 5 L62 12 L48 19 Z" fill="#8a2a22"/><rect x="30" y="5" width="5" height="14" fill="#c8463a"/><path d="M10 12 L1 1 L16 5 Z M10 12 L1 23 L16 19 Z" fill="#6f746f"/><path d="M8 9 H0 V15 H8 Z" fill="#ff8a2a"/></svg>`,
  // مسيّرة شاهين: a delta wing seen from above
  drone: `<svg viewBox="0 0 48 32" aria-hidden="true"><path d="M44 16 L6 2 L12 16 L6 30 Z" fill="#c9c2b0"/><rect x="10" y="14" width="30" height="4" rx="2" fill="#8a8f8c"/><path d="M8 11 L4 16 L8 21 Z" fill="#5a5f5c"/><circle cx="6" cy="16" r="3.5" fill="none" stroke="#5a5f5c" stroke-width="1.5"/></svg>`,
  // مسيّرة صقر: long swept wings and a tail, like a falcon
  drone2: `<svg viewBox="0 0 48 32" aria-hidden="true"><path d="M40 16 L22 15 L14 2 L10 2 L15 15 L6 15 L2 10 H0 L3 16 L0 22 H2 L6 17 L15 17 L10 30 L14 30 L22 17 Z" fill="#b8b2a0"/><path d="M40 16 L46 16 L40 13 Z" fill="#c8463a"/><rect x="18" y="14" width="24" height="4" rx="2" fill="#7a7f7c"/></svg>`,
  // صاروخ اعتراضي: a slim white dart
  intc: `<svg viewBox="0 0 64 24" aria-hidden="true"><path d="M8 12 L14 9 H54 L62 12 L54 15 H14 Z" fill="#f4f6f2"/><path d="M54 9 L62 12 L54 15 Z" fill="#2c6fb0"/><path d="M12 12 L6 5 L16 9 Z M12 12 L6 19 L16 15 Z" fill="#2c6fb0"/><path d="M8 10.5 H2 V13.5 H8 Z" fill="#ffd27a"/></svg>`
};
export const weaponIcon = (w) => `<i class="w-ic w-ic-${w}">${WEAPON_SVG[w] || ""}</i>`;
/** What each chosen spot would reach, drawn on the town. */
function strikeView() {
  const tg = WARX.targeting; if (!tg) return;
  const hit = new Map();
  tg.points.forEach((p) => { for (const b of blastArea(tg.list, p.x, p.y, WEAPONS[p.w].blast)) hit.set(`${b.x}:${b.y}`, { x: b.x, y: b.y, f: Math.max(b.f, hit.get(`${b.x}:${b.y}`)?.f || 0) }); });
  world.fx.showStrike(tg.points.map((p, i) => ({ x: p.x, y: p.y, r: WEAPONS[p.w].blast, on: i === tg.sel })), [...hit.values()]);
  return hit;
}
export function targetBar() {
  const tg = WARX.targeting, bar = $("targetBar");
  if (!tg) { bar.hidden = true; return; }
  bar.hidden = false;
  const st = WARX.st, ars = st?.arsenal || {}, weapons = readyWeapons(), hit = strikeView();
  const need = {}; let fee = 0, eta = 0;
  for (const p of tg.points) { need[p.w] = (need[p.w] || 0) + p.n; fee += WEAPONS[p.w].fee * p.n; eta = Math.max(eta, flightMs(me().plot, tg.plot, p.w)); }
  const short = Object.entries(need).find(([w, n]) => (ars[w] || 0) < n);
  const sel = tg.points[tg.sel];
  const near = sel ? blastArea(tg.list, sel.x, sel.y, WEAPONS[sel.w].blast) : [];
  const ready = (st?.profile ? launcherTimes(st) : []).filter((x) => x.left > 0);
  bar.innerHTML = `<div class="tb-strike">
    <div class="tb-head"><b>🎯 «${tg.town}»</b><small>${tg.points.length ? `${ar(tg.points.length)} أماكن · ${ar(hit?.size || 0)} مبنى بالمدى` : "اضغط أي مكان بالمدينة (٦ أماكن بالكثير)"}</small></div>
    ${tg.points.length ? `<div class="tb-pts">${tg.points.map((p, i) => `<button type="button" class="${i === tg.sel ? "on" : ""}" data-pt="${i}">${ar(i + 1)} ${weaponIcon(p.w)}${p.n > 1 ? `×${ar(p.n)}` : ""}</button>`).join("")}</div>` : ""}
    ${sel ? `<div class="tb-sel"><span><b>${ar(tg.sel + 1)}. ${near[0] && near[0].d < 0.5 ? B[near[0].id].name : "أرض"}</b><small>يوصل لـ${ar(near.length)} مبنى · نصف قطر ${ar(WEAPONS[sel.w].blast)} مربع</small></span>
      <span class="tb-w">${weapons.map((w) => { const l = (ars[w] || 0) - tg.points.reduce((n, p) => n + (p !== sel && p.w === w ? p.n : 0), 0); return `<button type="button" class="${w === sel.w ? "on" : ""} ${l < 1 ? "out" : ""}" data-tw="${w}">${weaponIcon(w)}<b>${WEAPONS[w].name.replace(/^(صاروخ|مسيّرة) /, "")}</b><small>${ar(Math.max(0, l))} باقي</small></button>`; }).join("")}</span>
      <span class="step"><button type="button" id="tbDec">−</button><b>${ar(sel.n)}</b><button type="button" id="tbInc">+</button></span><button type="button" class="tb-del" id="tbDel" aria-label="شيل المكان">✕</button></div>` : ""}
    <small class="tb-hint">اضغط على المدينة تضيف مكان · اضغط المكان المختار مرة ثانية تشيله</small>
    ${ready.length ? `<small class="tb-ready">⏳ ${ready.map((x) => `${x.name}: ${secLeft(x.left)}`).join(" · ")}</small>` : ""}
    <div class="tb-go"><span><small>${short ? `<b class="minus">ما يكفي ${WEAPONS[short[0]].name}</b>` : fee ? `التشغيل ${money(fee)} ريال · يوصل خلال ${secLeft(eta)}` : weapons.length ? "" : "<b class='minus'>ما عندك ذخيرة جاهزة: عبّ من غرفة العمليات</b>"}</small></span>
      <button class="btn go" type="button" id="tbGo" ${!tg.points.length || short ? "disabled" : ""}>🚀 أطلق</button><button class="btn" type="button" id="tbX">✕</button></div></div>`;
  bar.querySelectorAll("[data-pt]").forEach((b) => b.addEventListener("click", () => { sfx.tap(); tg.sel = Number(b.dataset.pt); targetBar(); }));
  const left = (w) => (ars[w] || 0) - tg.points.reduce((n, p) => n + (p !== sel && p.w === w ? p.n : 0), 0);
  bar.querySelectorAll("[data-tw]").forEach((b) => b.addEventListener("click", () => { sfx.tap(); if (left(b.dataset.tw) < 1) { toast(`ما بقى ${WEAPONS[b.dataset.tw].name}: موزّعة على أماكن ثانية`, "bad"); return; } sel.w = b.dataset.tw; sel.n = Math.min(sel.n, left(sel.w)); targetBar(); }));
  $("tbInc")?.addEventListener("click", () => { sel.n = Math.min(8, Math.max(1, left(sel.w)), sel.n + 1); sfx.tap(); targetBar(); });
  $("tbDec")?.addEventListener("click", () => { sel.n = Math.max(1, sel.n - 1); sfx.tap(); targetBar(); });
  $("tbDel")?.addEventListener("click", () => { tg.points.splice(tg.sel, 1); tg.sel = tg.points.length - 1; sfx.tap(); targetBar(); });
  $("tbGo")?.addEventListener("click", () => fireStrike());
  $("tbX").addEventListener("click", () => { sfx.tap(); stopTargeting(); });
}
/** When each launcher of ours is ready again (a pad or a drone base reloading). */
export function launcherTimes(st) {
  const p = st.profile, now = warNow(), out = [];
  for (const [k, list, kind] of [["p", p.pads, "missilepad"], ["b", p.bases, "dronebase"]]) list.forEach((it, i) => {
    const at = st.reload?.[`${k}${it.x}:${it.y}`] || 0;
    out.push({ key: `${k}${it.x}:${it.y}`, kind, name: `${milStat(kind, it.lvl).name}${list.length > 1 ? ` ${ar(i + 1)}` : ""}`, left: it.wd >= 85 ? -1 : Math.max(0, at - now), broken: it.wd >= 85 });
  });
  return out;
}
async function fireStrike() {
  const tg = WARX.targeting; if (!tg?.points.length) return;
  $("tbGo").disabled = true;
  await warSyncNow();
  const op = `salvo${warReq()}`, targets = tg.points.map((p) => ({ x: p.x, y: p.y, load: { [p.w]: p.n } }));
  let r = await warApi("salvo", { op, to: tg.plot, targets });
  if (r.error === "ما قدرت أوصل للسيرفر: جرّب بعد شوي") { await new Promise((ok) => setTimeout(ok, 1500)); r = await warApi("salvo", { op, to: tg.plot, targets }); } // the same id: never twice
  if (r.error) { toast(r.error, "bad"); sfx.deny(); if ($("tbGo")) $("tbGo").disabled = false; return; }
  stopTargeting();
  warSalvoScene(r.ops, true); // ours first; an attack on us that lands meanwhile plays after
  warPoll(true);
}
export function stopTargeting() {
  WARX.targeting = null;
  document.body.classList.remove("targeting");
  world.fx?.showTargets(null);
  world.fx?.showStrike(null);
  $("targetBar").hidden = true;
  if (visiting) leaveVisit();
}
/** A tap while targeting: a spot (anywhere but a mosque); tapping a chosen spot selects it. */
export function targetTap(x, y) {
  const tg = WARX.targeting, b = S.tiles[idx(x, y)]?.b;
  if (b && !canTarget(b.id)) { toast("المساجد محمية: ما تنقصف", "bad"); sfx.deny(); return; }
  if (!tg.list.some((t) => Math.hypot(t.x - x, t.y - y) <= 3)) { toast("اختر مكان قريب من مباني المدينة", "bad"); return; }
  const at = tg.points.findIndex((p) => Math.abs(p.x - x) <= 0 && Math.abs(p.y - y) <= 0);
  if (at >= 0 && at === tg.sel) { tg.points.splice(at, 1); tg.sel = tg.points.length - 1; sfx.tap(); targetBar(); return; } // the chosen spot tapped again: taken off
  if (at >= 0) { tg.sel = at; sfx.tap(); targetBar(); return; }
  if (tg.points.length >= 6) { toast("الدفعة ٦ أماكن بالكثير", "bad"); sfx.deny(); return; }
  // the strongest weapon still left after the spots already chosen
  const used = {}; for (const p of tg.points) used[p.w] = (used[p.w] || 0) + p.n;
  const ars = WARX.st?.arsenal || {}, w = readyWeapons().find((k) => (ars[k] || 0) - (used[k] || 0) >= 1);
  if (!w) { toast("خلصت الذخيرة الجاهزة: كل اللي عندك موزّع على الأماكن", "bad"); sfx.deny(); return; }
  tg.points.push({ x, y, w, n: 1 }); tg.sel = tg.points.length - 1;
  sfx.tap(); warSfx?.lock?.();
  targetBar();
}
/** The screen flashes at a hit: white heat, then red, fading (stronger for heavier weapons). */
function screenFlash(k) {
  let el = document.getElementById("warFlash");
  if (!el) { el = document.createElement("div"); el.id = "warFlash"; document.body.append(el); }
  el.style.setProperty("--k", String(k));
  el.classList.remove("on"); void el.offsetWidth; el.classList.add("on");
  if (navigator.vibrate) try { navigator.vibrate(Math.round(60 + k * 120)); } catch { /* no vibration */ }
}
export function sceneUi(on) {
  const ui = $("warScene");
  if (world.fx) world.fx.onFlash = screenFlash;
  ui.hidden = !on;
  document.body.classList.toggle("war-scene", !!on);
  if (!on) { $("warBanner").hidden = true; $("warMap").hidden = true; roomAfterScene(); setTimeout(() => { if (!WARX.scene && WARX.st && sheetFor !== "war-report") warWatch(WARX.st); }, 1500); }
}
export function banner(text, cls = "") {
  const b = $("warBanner");
  b.textContent = text; b.className = `war-banner ${cls}`; b.hidden = false;
  clearTimeout(banner.t); banner.t = setTimeout(() => { b.hidden = true; }, 2600);
}
export const fxSfx = () => ({ prep: () => warSfx.prep(), launch: () => warSfx.launch(), drone: () => warSfx.drone(), whoosh: () => warSfx.whoosh(), intercept: () => warSfx.intercept(), airBurst: () => warSfx.airBurst(), boom: () => warSfx.boom(), alarm: () => warSfx.alarm() });
/** Where the attack comes from, as a direction on the ground of the target town. */
export function dirFrom(from, to) { const [ax, ay] = worldXY(from), [bx, by] = worldXY(to); const d = Math.hypot(ax - bx, ay - by) || 1; return { x: (ax - bx) / d, z: (ay - by) / d }; }
/** The al-Jouf map with the operation's path and a moving marker, until it arrives (or is skipped). */
export function mapFlight(op, quick) {
  return new Promise((resolve) => {
    const box = $("warMap");
    box.hidden = false;
    const { cols, rows } = WORLD, cell = 5, [ax, ay] = worldXY(op.from), [bx, by] = worldXY(op.to);
    const P = (x, y) => [x * cell + cell / 2, y * cell + cell / 2];
    const [x1, y1] = P(ax, ay), [x2, y2] = P(bx, by), mx = (x1 + x2) / 2, my = Math.min(y1, y2) - Math.hypot(x2 - x1, y2 - y1) * 0.25;
    const missile = Object.keys(op.load).some((w) => WEAPONS[w].kind === "missile");
    const pad = 22, vx = Math.max(0, Math.min(x1, x2) - pad), vy = Math.max(0, Math.min(y1, y2, my) - pad), vw = Math.min(cols * cell, Math.abs(x2 - x1) + pad * 2), vh = Math.min(rows * cell, Math.abs(Math.max(y1, y2) - Math.min(y1, y2, my)) + pad * 2);
    const labels = WORLD.places.map((p) => `<text x="${p.x * cell + cell / 2}" y="${p.y * cell + cell / 2}" class="wm-place">${p.name}</text>`).join("");
    box.innerHTML = `<div class="wf-head"><b>${missile ? "🚀" : "🛩️"} ${weaponsText(op.load)}</b><small>من «${op.fromTown}» إلى «${op.toTown}» · الهدف: ${op.bname}</small></div>
      <svg viewBox="${vx} ${vy} ${Math.max(vw, 60)} ${Math.max(vh, 40)}" class="wf-map"><rect x="0" y="0" width="${cols * cell}" height="${rows * cell}" fill="#e6cf9c"/>${labels}
        <path d="M${x1},${y1} Q${mx},${my} ${x2},${y2}" class="wf-path ${missile ? "fast" : ""}"/>
        <circle cx="${x1}" cy="${y1}" r="2.4" class="wf-from"/><circle cx="${x2}" cy="${y2}" r="2.6" class="wf-to"/><circle cx="${x2}" cy="${y2}" r="5" class="wf-ping"/>
        <text x="${x1}" y="${y1 - 4}" class="wf-name">${op.fromTown}</text><text x="${x2}" y="${y2 - 5}" class="wf-name">${op.toTown}</text>
        <g id="wfDot"><circle r="2.2" class="wf-dot ${missile ? "fast" : ""}"/></g></svg>
      <div class="wf-foot"><span id="wfLeft"></span></div>`;
    const dot = $("wfDot"), left = $("wfLeft");
    const t0 = op.launchAt, t1 = op.arriveAt, start = performance.now();
    const quickMs = 3200;
    const tick = () => {
      if (WARX.skipFlight) { WARX.skipFlight = false; box.hidden = true; resolve(false); return; }
      const k = quick ? Math.min(1, (performance.now() - start) / quickMs) : Math.max(0, Math.min(1, (warNow() - t0) / Math.max(1, t1 - t0)));
      const q = 1 - k, x = q * q * x1 + 2 * q * k * mx + k * k * x2, y = q * q * y1 + 2 * q * k * my + k * k * y2;
      dot.setAttribute("transform", `translate(${x} ${y})`);
      left.textContent = quick ? "إعادة" : k >= 1 ? "وصل… ننتظر النتيجة" : `⏳ يوصل بعد ${secLeft(t1 - warNow())}`;
      if (k >= 1) { setTimeout(() => { box.hidden = true; resolve(true); }, 400); return; }
      requestAnimationFrame(tick);
    };
    tick();
  });
}
/** Wait for the server's result (it decides at the arrival time). */
export async function opResult(op) {
  for (let i = 0; i < 20; i++) {
    const r = await warApi("op", { op: op.id });
    if (r.op?.status === "done") return r.op;
    await new Promise((res) => setTimeout(res, 1500));
  }
  return null;
}
/** Look at a town for a scene (like a visit, without the visit bar). */
export async function sceneTown(plot) {
  if (plot === me()?.plot) { if (visiting) leaveVisit(); return true; }
  await visitTown(plot, { scene: true });
  return !!visiting;
}
export function incomingOpts(op, prof) { return salvoOpts([op], prof); }
/** The scene of one operation or a whole salvo: every spot with its weapons, its blast and what it reached. */
export function salvoOpts(ops, prof) {
  const live = ops.filter((op) => op.result && !op.result.blocked), first = ops[0];
  return {
    x: first.x, y: first.y, dir: dirFrom(first.from, first.to), detected: ops.some((op) => op.detected),
    strikes: live.map((op) => ({
      x: op.x, y: op.y, dir: dirFrom(op.from, op.to), r: Math.max(...Object.keys(op.load).map((w) => WEAPONS[w].blast || 0.7)),
      weapons: op.result.hits.map((h) => ({ ...h, kind: WEAPONS[h.w].kind })), area: op.result.area || [{ x: op.x, y: op.y, dmg: op.result.dmg, after: op.result.after }],
      onHit: (dmg) => {
        let changed = false;
        for (const a of op.result.area || [{ x: op.x, y: op.y, after: op.result.after }]) { const t = S.tiles[idx(a.x, a.y)]; if (t?.b && (t.b.wd || 0) < a.after) { t.b.wd = Math.min(100, a.after); changed = true; } }
        if (changed) world.sync(S, { buildings: true });
        if (dmg) floatAt(op.x, op.y, `💥 −${ar(op.result.dmg)}٪${(op.result.area?.length || 1) > 1 ? ` · ${ar(op.result.area.length)} مباني` : ""}`, "down");
      }
    })),
    noAmmo: live.some((op) => op.result.airdef > 0 && !op.result.hits.some((h) => h.tried)),
    airdefs: (prof?.airdefs || []).map((a) => ({ x: a.x, y: a.y })), radars: (prof?.radars || []).map((a) => ({ x: a.x, y: a.y })),
    banner, sfx: fxSfx()
  };
}
/** The buildings a salvo hit, put back as they stood before it (the scene then shows the damage arriving). */
function salvoBefore(ops) {
  for (const op of ops) for (const a of op.result?.area || []) { const t = S.tiles[idx(a.x, a.y)]; if (t?.b) { if (a.before) t.b.wd = a.before; else delete t.b.wd; } }
  world.sync(S, { buildings: true });
}
/** How the attacks on us are shown (the mayor's choice, kept on the phone): "full", "fast" or "off" (the report only). */
export const sceneMode = () => store.get("rafaya-war-scenes") || "full";
export const setSceneMode = (m) => store.set("rafaya-war-scenes", m);
/** Every attack on us that landed and was not shown yet (from every town), or just this one's salvo. */
function landedOnUs(op) {
  const played = warPlayed(), st = WARX.st;
  const all = (st?.ops || []).filter((o) => o.side === "in" && o.status === "done" && !played.has(o.id) && !(o.salvo && st.ops.some((x) => x.salvo === o.salvo && x.status === "flying")));
  return all.length ? all.slice(0, 24) : salvoOf(op).filter((o) => o.status === "done");
}
/** The operations launched with this one (a salvo), or just it. */
export const salvoOf = (op) => (op.salvo ? (WARX.st?.ops || []).filter((o) => o.salvo === op.salvo) : [op]);
/** Townsfolk' view of the defending town's defence, for the scene (radars and batteries are on the map). */
export function defenceOf(s) {
  const out = { airdefs: [], radars: [] };
  s.tiles.forEach((t, i) => { if (t.b?.id === "airdef" && !(t.b.build > 0)) out.airdefs.push({ x: i % N, y: Math.floor(i / N) }); if (t.b?.id === "radar" && !(t.b.build > 0)) out.radars.push({ x: i % N, y: Math.floor(i / N) }); });
  return out;
}
/** Our own operation: the launch at home, the flight on the map, then the result at the target. */
export async function warOpScene(op, launch) {
  if (WARX.scene) return;
  WARX.scene = { op };
  sceneUi(true); closeSheet(); setTool(null);
  try {
    if (launch) {
      if (visiting) leaveVisit();
      const missile = Object.keys(op.load).some((w) => WEAPONS[w].kind === "missile");
      const wid = Object.keys(op.load).find((w) => WEAPONS[w].kind === (missile ? "missile" : "drone"));
      const at = (missile ? op.pads?.[0] : op.bases?.[0]) || [N / 2, N / 2];
      const d = dirFrom(op.to, op.from);
      await world.fx.playLaunch({ x: at[0], y: at[1], kind: missile ? "missile" : "drone", wid, n: op.load[wid], dir: { x: d.x, z: d.z }, sfx: fxSfx() });
      world.fx.clear();
    }
    const arrived = await mapFlight(op, !launch);
    if (!arrived) { toast("العملية مكمّلة بالجو، وتوصلك النتيجة لا وصلت", ""); return; }
    const done = op.result ? op : await opResult(op);
    if (!done) { toast("النتيجة تتأخر: تلقاها بسجل العمليات", ""); return; }
    markPlayed(done.id); WARX.watched.add(done.id);
    if (await sceneTown(done.to)) {
      if (done.result.blocked) banner({ gone: "الهدف ما عاد موجود", shield: "المدينة دخلت درع الحماية", truce: "دخلت الهدنة قبل الوصول" }[done.result.blocked], "bad");
      else await world.fx.playIncoming(incomingOpts(done, defenceOf(S)));
    }
    world.fx.clear();
    if (visiting) leaveVisit(); // back home before the report
    opReport(done, true);
  } finally {
    sceneUi(false); WARX.scene = null; world.fx.clear();
    if (visiting && !WARX.targeting) { const keep = sheetFor; leaveVisit(); if (keep === "war-report") opReport(WARX.lastReport, true); }
  }
}
/** Our operation's result arrived while no scene was on: straight to the target town, the hits, then the report. */
async function resultScene(op) {
  if (WARX.scene || !op.result) return;
  const ops = salvoOf(op).filter((o) => o.result);
  if (sceneMode() === "off") { if (ops.length > 1) salvoReport(ops, true); else opReport(op, true); return; }
  WARX.scene = { op };
  sceneUi(true); closeSheet(); setTool(null);
  world.fx.speed = sceneMode() === "fast" ? 2.2 : 1;
  try {
    banner(`🎯 ضربتك على «${op.toTown}» وصلت`, "");
    if (await sceneTown(op.to)) {
      salvoBefore(ops);
      if (ops.some((o) => !o.result.blocked)) await world.fx.playIncoming(salvoOpts(ops, defenceOf(S)));
      else banner({ gone: "الهدف ما عاد موجود", shield: "المدينة دخلت درع الحماية", truce: "دخلت الهدنة قبل الوصول" }[op.result.blocked] || "ما أصابت", "bad");
    }
    world.fx.clear();
    if (visiting) leaveVisit();
    if (ops.length > 1) salvoReport(ops, true); else opReport(op, true);
  } finally {
    sceneUi(false); WARX.scene = null; world.fx.clear();
    if (visiting && !WARX.targeting) leaveVisit();
  }
}
/** An attack on us that just landed, played in our own town. */
export async function warDefenseScene(op, replay = false) {
  if (WARX.scene) return;
  if (visiting && !replay) leaveVisit(); // it plays at home, wherever the mayor was looking
  // everything that landed on us plays together in one scene (several towns, many missiles), then one report
  const ops = replay ? salvoOf(op).filter((o) => o.status === "done") : landedOnUs(op);
  for (const o of ops) { markPlayed(o.id); WARX.watched.add(o.id); }
  const mode = replay ? "full" : sceneMode();
  if (mode === "off") { if (sheetFor !== "warroom") salvoReport(ops, true); else toast(`📋 وصلت ${ar(ops.length)} ضربات: التقرير بالسجل`, "bad"); return; }
  WARX.scene = { op };
  sceneUi(true); closeSheet(); setTool(null);
  world.fx.speed = mode === "fast" ? 2.2 : 1;
  try {
    const towns = [...new Set(ops.map((o) => o.fromTown))];
    banner(towns.length > 1 ? `🚨 هجمات من ${towns.map((t) => `«${t}»`).join(" و")}!` : ops.length > 1 ? `🚨 ${ar(ops.length)} ضربات من «${towns[0]}»!` : `🚨 هجوم من «${towns[0]}»!`, "bad");
    const keys = ops.flatMap((o) => (o.result.area || [{ x: o.x, y: o.y }]).map((a) => `${a.x}:${a.y}`)), reps = keys.map((k) => [k, world.fx.repairs.get(k)]).filter(([, r]) => r);
    for (const [k] of reps) world.fx.repairs.delete(k); // the deputy's repairs start after the hit, not before
    salvoBefore(ops);
    if (reps.length) setTimeout(() => { for (const [k, r] of reps) world.fx.repairs.set(k, r); world.sync(S, { buildings: true }); }, 9000);
    if (ops.some((o) => !o.result.blocked)) await world.fx.playIncoming(salvoOpts(ops, defenceOf(S)));
    world.fx.clear();
    if (ops.length > 1) salvoReport(ops, true); else opReport(op, true);
  } finally { sceneUi(false); WARX.scene = null; world.fx.clear(); }
}
/** Our salvo: the launch at home, the flight on the map, then every spot at the target together. */
export async function warSalvoScene(ops, launch) {
  if (WARX.scene || !ops?.length) return;
  WARX.scene = { op: ops[0] };
  ROOM.back = true; ROOM.tab = "log";
  sceneUi(true); closeSheet(); setTool(null);
  world.fx.speed = sceneMode() === "fast" ? 2.2 : 1;
  try {
    if (launch) {
      if (visiting) leaveVisit();
      const load = {}; for (const o of ops) for (const [w, n] of Object.entries(o.load)) load[w] = (load[w] || 0) + n;
      const missile = Object.keys(load).some((w) => WEAPONS[w].kind === "missile");
      const wid = Object.keys(load).find((w) => WEAPONS[w].kind === (missile ? "missile" : "drone"));
      const at = (missile ? ops[0].pads?.[0] : ops[0].bases?.[0]) || [N / 2, N / 2];
      const d = dirFrom(ops[0].to, ops[0].from);
      await world.fx.playLaunch({ x: at[0], y: at[1], kind: missile ? "missile" : "drone", wid, n: Math.min(4, load[wid]), dir: { x: d.x, z: d.z }, sfx: fxSfx() });
      world.fx.clear();
    }
    const last = ops.slice().sort((a, b) => b.arriveAt - a.arriveAt)[0];
    const arrived = await mapFlight({ ...last, load: ops.reduce((l, o) => { for (const [w, n] of Object.entries(o.load)) l[w] = (l[w] || 0) + n; return l; }, {}), bname: ops.length > 1 ? `${ar(ops.length)} أماكن` : last.bname }, !launch && !!last.result);
    if (!arrived) { toast("الدفعة مكمّلة بالجو، وتوصلك النتيجة لا وصلت", ""); return; }
    const done = [];
    for (const o of ops) { const d = o.result ? o : await opResult(o); if (d) done.push(d); }
    if (!done.length) { toast("النتيجة تتأخر: تلقاها بالسجل", ""); return; }
    for (const d of done) { markPlayed(d.id); WARX.watched.add(d.id); }
    if (await sceneTown(done[0].to)) {
      salvoBefore(done);
      if (done.every((d) => d.result.blocked)) banner({ gone: "الهدف ما عاد موجود", shield: "المدينة دخلت درع الحماية", truce: "دخلت الهدنة قبل الوصول" }[done[0].result.blocked], "bad");
      else await world.fx.playIncoming(salvoOpts(done, defenceOf(S)));
    }
    world.fx.clear();
    if (visiting) leaveVisit();
    ROOM.back = false;
    salvoReport(done, true);
  } finally {
    sceneUi(false); WARX.scene = null; world.fx.clear();
    if (visiting && !WARX.targeting) leaveVisit();
  }
}
/** Watch again everything in a report together (an attack of several towns). */
async function warReplayAll(ops) {
  if (WARX.scene) return;
  WARX.scene = { op: ops[0], replay: true };
  sceneUi(true); closeSheet();
  const keep = new Map();
  try {
    if (visiting) leaveVisit();
    for (const o of ops) for (const a of o.result?.area || [{ x: o.x, y: o.y }]) { const t = S.tiles[idx(a.x, a.y)]; if (t?.b) keep.set(`${a.x}:${a.y}`, t.b.wd); }
    salvoBefore(ops);
    if (ops.some((o) => o.result && !o.result.blocked)) await world.fx.playIncoming(salvoOpts(ops.filter((o) => o.result), defenceOf(S)));
    for (const [k, wd] of keep) { const [x, y] = k.split(":").map(Number), t = S.tiles[idx(x, y)]; if (t?.b) { if (wd) t.b.wd = wd; else delete t.b.wd; } }
    world.sync(S, { buildings: true });
  } finally { world.fx.clear(); sceneUi(false); WARX.scene = null; salvoReport(ops); }
}
/** The report of a salvo: every spot with what it reached. */
export function salvoReport(ops, fresh) {
  const out = ops[0].side === "out" || ops[0].from === me()?.plot;
  const area = ops.reduce((n, o) => n + (o.result?.area?.length || 0), 0), people = ops.reduce((n, o) => n + (o.result?.displaced || 0), 0);
  const stopped = ops.reduce((n, o) => n + (o.result?.hits.filter((h) => h.intercepted).length || 0), 0), sent = ops.reduce((n, o) => n + (o.result?.hits.length || 0), 0);
  sheet(`<h2>📋 ${out ? "تقرير الدفعة" : "تقرير الهجمات عليك"}</h2>
    <div class="war-grid"><div><b>${ar(ops.length)}</b><span>📍 أماكن</span></div><div><b>${ar(area)}</b><span>🏚️ مباني تضررت</span></div><div><b>${ar(stopped)}<small>/${ar(sent)}</small></b><span>🛡️ انعترض</span></div><div><b>${ar(people)}</b><span>🧳 نزحوا</span></div></div>
    <div class="rows">${row(out ? "المدينة المستهدفة" : ops.length > 1 && new Set(ops.map((o) => o.from)).size > 1 ? "المهاجمين" : "المهاجم", out ? `«${ops[0].toTown}»` : [...new Set(ops.map((o) => o.fromTown))].map((t) => `«${t}»`).join(" · "))}
      ${ops.map((o, i) => { const r = o.result; return row(`${ar(i + 1)}. ${out || new Set(ops.map((x) => x.from)).size === 1 ? "" : `«${o.fromTown}» ← `}${o.bname} · ${weaponsText(o.load)}`, !r ? "بالجو" : r.blocked ? "ما أصابت" : r.dmg ? `💥 ${ar(r.area?.length || 1)} مباني · أكبر ضرر ${ar(r.dmg)}٪` : "🛡️ انعترضت", r?.dmg ? (out ? "plus" : "minus") : ""); }).join("")}</div>
    ${!out && area ? `<div class="need">💡 الإصلاح من «غرفة العمليات ← السجل والأضرار»: كل مبنى وجنبه «صلّح».</div>` : ""}
    <div class="sheet-actions keep"><button class="btn go block" type="button" id="srReplay">🎬 شاهد الإعادة</button><button class="btn block" type="button" id="srRoom">⚔️ غرفة العمليات</button>${fresh ? `<button class="btn block" type="button" id="srOk">تمام</button>` : ""}</div>`, "war-report");
  $("srReplay").addEventListener("click", () => (out ? replayOp(ops[0]) : warReplayAll(ops)));
  $("srRoom").addEventListener("click", () => warRoom("log"));
  $("srOk")?.addEventListener("click", closeSheet);
}
/** Watch an operation again from its saved data: nothing is charged or damaged again. */
export async function replayOp(op) {
  if (WARX.scene || !op.result) return;
  const ops = salvoOf(op).filter((o) => o.result);
  WARX.scene = { op, replay: true };
  sceneUi(true); closeSheet();
  const homeWas = !visiting;
  const keep = new Map();
  try {
    await mapFlight(op, true);
    if (await sceneTown(op.to)) {
      // show the buildings as they were before, then the hits arriving, then as they stand now
      for (const o of ops) for (const a of o.result.area || [{ x: o.x, y: o.y }]) { const t = S.tiles[idx(a.x, a.y)]; if (t?.b) keep.set(`${a.x}:${a.y}`, t.b.wd); }
      salvoBefore(ops);
      if (ops.some((o) => !o.result.blocked)) await world.fx.playIncoming(salvoOpts(ops, defenceOf(S)));
      for (const [k, wd] of keep) { const [x, y] = k.split(":").map(Number), t = S.tiles[idx(x, y)]; if (t?.b) { if (wd) t.b.wd = wd; else delete t.b.wd; } }
      world.sync(S, { buildings: true });
    }
  } finally {
    world.fx.clear(); sceneUi(false); WARX.scene = null;
    if (homeWas && visiting) leaveVisit();
    if (ops.length > 1) salvoReport(ops); else opReport(op);
  }
}
export function opReport(op, fresh) {
  WARX.lastReport = op;
  const r = op.result, out = op.side === "out" || op.from === me()?.plot;
  const when = new Date(op.launchAt - (WARX.offset || 0)).toLocaleString("ar-SA", { weekday: "long", hour: "numeric", minute: "2-digit" });
  const verdict = !r ? `بالجو · يوصل بعد ${secLeft(op.arriveAt - warNow())}` : r.blocked ? "ما أصابت" : r.dmg ? "إصابة ناجحة" : "انعترضت";
  sheet(`<h2>📋 تقرير العملية العسكرية</h2>
    <div class="rows">${row("المدينة المهاجمة", `«${op.fromTown}»`)}${row("المدينة المستهدفة", `«${op.toTown}»`)}${row("السلاح", weaponsText(op.load))}${row("الهدف", op.bname)}
      ${row("النتيجة", verdict, r ? (r.dmg ? (out ? "plus" : "minus") : out ? "minus" : "plus") : "")}
      ${r && !r.blocked ? row("الاعتراض", r.hits.filter((h) => h.tried).length ? r.hits.map((h) => `${weaponIcon(h.w)} ${h.intercepted ? "✅ انعترض" : h.tried ? "❌ فشل الاعتراض" : "ما انعترض"}`).join(" · ") : r.airdef ? "الدفاع الجوي بلا صواريخ اعتراضية" : "ما فيه دفاع جوي") : ""}
      ${!out && r && !r.blocked && r.airdef && !r.hits.some((h) => h.tried) ? `<div class="need">💡 بطاريتك ما ردّت لأن ما عندها صواريخ اعتراضية: اشترِ من «القيادة ← الدفاع»، أو خلّ النائب يعبيها.</div>` : ""}
      ${r?.dmg ? row("الضرر", `${ar(r.dmg)}٪ (صار ${ar(Math.round(r.after))}٪)`, out ? "plus" : "minus") : ""}
      ${r && !r.blocked ? row("الحالة", r.state) : ""}
      ${out ? row("تكلفة العملية", `${money(op.fee)} ريال تشغيل + ذخائر بقيمة ${money(op.value)}`) : r?.intcUsed ? row("ذخيرة الدفاع المستخدمة", `${ar(r.intcUsed)} صاروخ اعتراضي (${money(r.intcValue)} ريال)`) : ""}
      ${row("وقت العملية", when)}</div>
    ${!out && r?.dmg ? `<div class="need">💡 اضغط على ${op.bname} بمدينتك واختر «🔧 إصلاح الأضرار العسكرية»، أو خلّ النائب يصلحها (القيادة ← النائب).</div>` : ""}
    <div class="sheet-actions keep">${r ? `<button class="btn go block" type="button" id="opReplay">🎬 مشاهدة إعادة العملية</button>` : ""}<button class="btn block" type="button" id="opBack">${fresh ? "تمام" : "رجوع للعمليات"}</button></div>`, "war-report");
  $("opReplay")?.addEventListener("click", () => replayOp(op));
  $("opBack").addEventListener("click", () => (fresh ? closeSheet() : warSheet("ops")));
}
export function warDamageHtml(b) {
  if (!worldMode || !b?.wd) return "";
  const d = damageState(b.wd), rep = world.fx?.repairs.get(WARX.inspectAt);
  const cost = repairCostOf(b.id, b.wd), ms = repairMsOf(b.wd);
  let html = `<h3>💥 ضرر عسكري</h3><div class="rows">${row("الحالة", `${d.name} · ${ar(Math.round(b.wd))}٪`, "minus")}<i class="prog cond"><i style="width:${100 - b.wd}%" class="low"></i></i>
    ${row("كفاءة المبنى الحين", `${ar(Math.round(warFactor(b.wd) * 100))}٪`, "minus")}${targetText(b.id) ? row("الأثر", targetText(b.id)) : ""}</div>`;
  if (visiting) return html;
  if (rep) html += `<div class="need ok">🔧 يتصلح الحين: يخلص بعد ${fmtLeft(rep.end - warNow())}</div>`;
  else html += `<div class="sheet-actions"><button class="btn go block" id="warRepair" type="button" ${S.money < cost ? "disabled" : ""}>🔧 إصلاح الأضرار العسكرية (${money(cost)} ريال)</button></div>
    <p class="hint">يستغرق ${fmtLeft(ms)}، ويرجّع كفاءة المبنى ١٠٠٪ تدريجيًا. ما يحتاج مواد بناء.</p>`;
  return html;
}
export async function warRepairAt(x, y, quiet = false) {
  const r = await warApi("repair", { req: warReq(), x, y });
  if (r.error) { toast(r.error, "bad"); sfx.deny(); return r; }
  sfx.build(); toast(`🔧 بدأ الإصلاح (${money(r.charge?.amount || 0)} ريال)`, "goal");
  await warPoll(true);
  if (!quiet) inspect(x, y); // from the war room the row changes in place instead (no other screen opens)
  return r;
}
/** The levels of a military building and what they do, for its sheet. */
export function milHtml(b) {
  if (!MIL[b.id]) return "";
  const st = milStat(b.id, b.lvl), lines = [];
  if (st.ops) lines.push(row("عمليات بالجو بنفس الوقت", ar(st.ops)));
  if (st.cap && b.id === "dronebase") lines.push(row("سعة المسيّرات", ar(st.cap)), row("مسيّرات بالعملية", ar(st.salvo)), row("وقت التجهيز", `${ar(st.reload)} دقايق`));
  if (st.cap && b.id === "missilepad") lines.push(row("صواريخ عليها", ar(st.cap)), row("وقت التجهيز", `${ar(st.reload)} دقايق`));
  if (st.detect) lines.push(row("يرفع دقة الدفاع", `×${ar(st.detect)}`));
  if (st.vsDrone) lines.push(row("ضد المسيّرات", `${ar(Math.round(st.vsDrone * 100))}٪`), row("ضد الصواريخ", `${ar(Math.round(st.vsMissile * 100))}٪`), row("صواريخ اعتراضية", ar(st.intc)));
  if (st.store) lines.push(row("يزيد التخزين", "٥٠٪"));
  return lines.join("");
}
/** Back in the world town: what happened in the war while you were away (from the server's notes). */
export async function warBack(reportOpen) {
  WARX.st = null; WARX.watched.clear();
  const before = warSeen();
  WARX.quietNotes = true;
  const st = await warPoll(true);
  WARX.quietNotes = false;
  const fresh = (st?.notes || []).filter((n) => n.at > before);
  if (!fresh.length || !before) return;
  const show = () => sheet(`<h2>🎖️ أحداث عسكرية وأنت غايب</h2><div class="rows">${fresh.slice(0, 15).map((n) => `<div class="row ol-com"><p>${n.text}</p></div>`).join("")}</div>
    <div class="sheet-actions keep"><button class="btn go block" type="button" id="wbOps">📋 العمليات والإعادة</button><button class="btn block" type="button" id="wbOk">تمام</button></div>`, "war-back");
  const open = () => { show(); $("wbOps").addEventListener("click", () => warSheet("ops")); $("wbOk").addEventListener("click", closeSheet); };
  if (reportOpen) { const wait = setInterval(() => { if (sheetFor !== "deputyReport" && $("sheet").hidden) { clearInterval(wait); open(); } }, 800); } else open();
}
