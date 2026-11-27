// Online: the API, visiting towns, the world account, phone notifications, the iPhone app, updates, live hints.
// Moved out of js/main.js as it was (nothing changed in it); main.js and the modules import each other's names.
import { menuBackdrop } from "./ui-whatsnew.js";
import { $, S, ar, arrange, canRegisterWorker, chatSheet, closeSheet, isIOS, lastSync, leaveArrange, leaveVisit, leaveWorld, playing, recoverWorldSave, refreshVisit, save, sendWorldSave, sheet, sheetFor, showMenu, standalone, store, storePrefix, visiting, worldClock, worldMapSheet, worldMode } from "./main.js";
import { FIX, toast } from "./ui-build.js";
import { sfx } from "./sound.js";
import { joufHours, newGame, pack } from "./sim.js";
import { DECISIONS, worldTerrain } from "./data.js";
import { WARX, warKey, warPoll, warSyncNow } from "./ui-war.js";
import { REQUIRED, VERSION } from "./version.js";
import { CHAT, chatCount, chatPoll } from "./ui-chat.js";
import { wnewsPoll, worldNewsSheet } from "./ui-news.js";
import { pendingSaveMatches } from "./save-version.js";

export const API = "/api";
export const onlineOk = () => !!globalThis.RAFAYA_PREVIEW || (location.protocol.startsWith("http") && !location.hostname.endsWith("claudeusercontent.com"));
/** This phone's own random number (made here once, never anything about the person). */
export function deviceId() {
  let d = store.get("rafaya-device");
  if (!d || d.length < 16) { d = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""); store.set("rafaya-device", d); }
  return d;
}
export async function api(path, body) {
  if (globalThis.RAFAYA_PREVIEW) return globalThis.RAFAYA_PREVIEW(path, body); // the trial copy answers by itself (js/preview.js)
  if (body && typeof body === "object" && path.startsWith("/world/")) body = { ...body, device: deviceId() }; // so a ban from the owner keeps this phone out
  const r = await fetch(API + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  if (r.status === 403 && (await r.clone().json().catch(() => null))?.error === "banned" && !api.bannedSaid) { api.bannedSaid = true; toast("⛔ حسابك بعالم الجوف موقوف من الإدارة", "bad"); }
  if (!r.ok) throw new Error(r.status === 503 ? "maintenance" : String(r.status));
  return r.json();
}
/**
 * Looking round someone else's town is look-only: anything in a sheet that would change it
 * (build, upgrade, repair, remove, turn, tax, loans, decisions, replies, names) is stopped here,
 * before its own handler runs. Reading, following a family, the world map and comments still work.
 */
export const VISIT_OK = ".keep, [data-follow], [data-day], [data-plot], [data-district], .wm-zoom, #olText, #wmTown, .ol-com";
export const VISIT_SHEETS = new Set(["chat", "developer-note", "online", "world", "pop", "happy", "when", "util", "pause", "how", "whatsnew", "war", "war-rel", "war-strike", "war-report", "war-back"]);
export function visitComments() {
  if (!visiting) return;
  const v = visiting;
  sheet(`<h2>💬 تعليقات على ${v.info.name}</h2>
    <div class="rows">${v.comments.length ? v.comments.map((c) => `<div class="row ol-com"><span><b>${c.author}</b><small>${new Date(c.at).toLocaleDateString("ar-SA")}</small></span><p>${c.text}</p></div>`).join("") : `<p class="hint">ما أحد علّق للحين.</p>`}</div>
    <h3>اكتب تعليقك</h3>
    <textarea id="olText" maxlength="200" rows="3" placeholder="مدينتك حلوة! عجبني…"></textarea>
    <div class="sheet-actions keep"><button class="btn go block" id="olSend" type="button">أرسل باسم ${me()?.name || "زائر"}</button></div>`, "online");
  $("olSend").addEventListener("click", async () => {
    const text = $("olText").value.trim();
    if (!text) return;
    try {
      const id = me();
      if (!id) { toast("سجّل اسمك في عالم الجوف أول", "bad"); return; }
      await api(`/world/town/${v.code}/comment`, { name: id.name, secret: id.secret, text });
      v.comments.unshift({ author: id.name, text, at: Date.now() });
      sfx.coin(); toast("وصل تعليقك ✓", "goal"); visitComments();
    } catch { toast("ما وصل التعليق، جرب بعدين", "bad"); }
  });
}
export const WORLD_ID = "rafaya-world-id", WORLD_SAVE = "rafaya-world-town", WORLD_GEN_KEY = "rafaya-world-gen";
export const worldHours = () => joufHours(Date.now() + worldClock.offset, worldClock);
export const worldHourNow = () => Math.floor(worldHours()) + 3;
export function me() {
  try { return JSON.parse(store.get(WORLD_ID) || "null"); }
  catch { return null; }
}
export const PUSH = { registration: null, key: null, checked: false, enabled: false, checking: null };
export const pushable = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export function registerPushWorker() {
  if (!PUSH.registration) {
    PUSH.registration = navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
      .catch(() => { PUSH.registration = null; return null; });
  }
  return PUSH.registration;
}
export async function activePushWorker() {
  if (!canRegisterWorker || !await registerPushWorker()) throw new Error("worker");
  let timer;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("worker")), 6500); })
    ]);
  } finally { clearTimeout(timer); }
}
export function pushState() {
  if (globalThis.RAFAYA_PREVIEW || !onlineOk()) return "no";
  if (isIOS && !standalone()) return "ios-install";
  if (!pushable()) return "no";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted" || store.get("rafaya-push-on") !== "1" || me()?.plot == null) return "off";
  return PUSH.checked ? (PUSH.enabled ? "on" : "off") : "checking";
}
export function pushKey() {
  if (!PUSH.key) PUSH.key = api("/world/push/key").catch((e) => { PUSH.key = null; throw e; });
  return PUSH.key;
}
export async function registerPushEndpoint(sub, id) {
  const { keys } = sub.toJSON();
  const r = await api("/world/push/sub", { name: id.name, secret: id.secret, endpoint: sub.endpoint, keys });
  if (!r.ok) throw new Error(r.error || "subscription");
}
export function checkPush() {
  const id = me();
  if (pushState() !== "checking" || !id?.secret || id.plot == null) return;
  if (PUSH.checking) return PUSH.checking;
  PUSH.checking = (async () => {
    try {
      const reg = await activePushWorker();
      const sub = await reg.pushManager.getSubscription();
      if (sub) await registerPushEndpoint(sub, id);
      PUSH.enabled = !!sub;
    } catch { PUSH.enabled = false; }
    finally { PUSH.checked = true; PUSH.checking = null; }
  })();
  return PUSH.checking;
}
export const b64urlBytes = (s) => { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
export async function pushOn() {
  const id = me();
  if (!id?.secret || id.plot == null) { toast("أسّس مدينتك بالجوف أول", "bad"); return false; }
  if (pushState() === "ios-install") { pushIosHelp(); return false; }
  if (!pushable()) { toast("جوالك أو متصفحك ما يدعم التنبيهات", "bad"); return false; }
  try {
    const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (perm !== "granted") {
      if (perm === "denied") pushDeniedHelp(); else toast("ما سمحت بالتنبيهات", "bad");
      return false;
    }
    const [reg, { key }] = await Promise.all([activePushWorker(), pushKey()]);
    const serverKey = b64urlBytes(key);
    let sub = await reg.pushManager.getSubscription();
    if (sub?.options?.applicationServerKey) {
      const previous = new Uint8Array(sub.options.applicationServerKey);
      if (previous.length !== serverKey.length || previous.some((v, i) => v !== serverKey[i])) {
        await sub.unsubscribe();
        sub = null;
      }
    }
    sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey });
    await registerPushEndpoint(sub, id);
    PUSH.checked = PUSH.enabled = true;
    store.set("rafaya-push-on", "1");
    toast("🔔 تمام! بيوصلك تنبيه إذا انضربت مدينتك أو أحد ذكرك بالشات", "goal");
    return true;
  } catch { toast("ما زبط تفعيل التنبيهات، جرّب بعد شوي", "bad"); return false; }
}
/** Notifications were refused once: how to allow them again, for this phone. */
export function pushDeniedHelp() {
  sheet(`<h2>🔔 التنبيهات مقفلة</h2><p>رفضتها مرة، ترجّعها كذا:</p>
    <div class="rows"><div class="row g-step"><b class="g-n">١</b><span>${isIOS ? "إعدادات الآيفون ← <b>الإشعارات</b> ← <b>الرافعية</b> ← اسمح" : "اضغط 🔒 جنب الرابط فوق ← <b>الإشعارات</b> ← <b>سماح</b>"}</span></div>
    <div class="row g-step"><b class="g-n">٢</b><span>ارجع هنا واضغط «فعّل التنبيهات»</span></div></div>`, "push");
}
export async function pushOff() {
  try {
    const reg = await activePushWorker(), sub = await reg.pushManager.getSubscription();
    if (sub) { await api("/world/push/unsub", { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
  } catch { /* fine */ }
  PUSH.checked = true; PUSH.enabled = false;
  store.set("rafaya-push-on", "0");
  toast("وقفت التنبيهات", "");
}
/** The iPhone version, e.g. 17.2 (0 when not an iPhone). */
export const iosVersion = () => { const m = navigator.userAgent.match(/OS (\d+)_(\d+)/); return m ? Number(m[1]) + Number(m[2]) / 100 : 0; };
export const SHARE_IC = `<svg viewBox="0 0 24 24" width="20" height="20" style="vertical-align:-4px" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>`;
export const ADD_IC = `<svg viewBox="0 0 24 24" width="20" height="20" style="vertical-align:-4px" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></svg>`;
/**
 * The iPhone, step by step: notifications only work from the app on the home screen, and that app keeps
 * its own storage, so the account goes over with a 6-digit move code.
 */
export async function pushIosHelp() {
  const v = iosVersion(), old = v && v < 16.04;
  let code = "";
  const id = me();
  if (!old) { try { code = (await iosPrepareMove(true)).code || ""; } catch { /* shown without */ } } // the whole game: by itself, or by this code (the owner's two ways)
  // iOS 26 moved Share into the «⋯» menu and added an «Open as Web App» switch that must stay on
  const v26 = v >= 26;
  const MORE_IC = `<b style="font-size:20px;letter-spacing:1px">⋯</b>`;
  sheet(`<h2>🔔 تنبيهات الآيفون</h2>
    ${old ? `<div class="need">حدّث الآيفون أول: الإعدادات ← عام ← تحديث البرنامج</div>` : `<p>حطّ اللعبة على شاشة جوالك مثل التطبيق، ولعبتك تنتقل معها:</p>
    <div class="rows">
      ${v26 ? `<div class="row g-step"><b class="g-n">١</b><span>اضغط ${MORE_IC} تحت يمين بسفاري ← <b>«مشاركة»</b> ${SHARE_IC}</span></div>`
        : `<div class="row g-step"><b class="g-n">١</b><span>اضغط ${SHARE_IC} تحت بسفاري <small>(ما تشوفه؟ اضغط ${MORE_IC} تحت يمين)</small></span></div>`}
      <div class="row g-step"><b class="g-n">٢</b><span>اختر ${ADD_IC} <b>«إضافة إلى الشاشة الرئيسية»</b>${v26 ? " وخل <b>«فتح كتطبيق ويب»</b> شغّال ✅" : ""} ← <b>«إضافة»</b></span></div>
      <div class="row g-step"><b class="g-n">٣</b><span>افتح <b>الرافعية</b> من الأيقونة: لعبتك تجيك لحالها، ولو طلب منك رمز اكتب اللي تحت</span></div>
      <div class="row g-step"><b class="g-n">٤</b><span>الإعدادات ← <b>«التنبيهات على الجوال»</b></span></div>
    </div>
    ${code ? `<div class="vote"><b class="ol-code" style="letter-spacing:6px">${ar(code)}</b><span>رمز لعبتك · لو ما انتقلت لحالها (صالح ٢٤ ساعة)</span></div><button class="btn block" id="iosCopy" type="button">انسخ الرمز</button>` : ""}
    <p class="ios-point">👇 الأزرار تحت الشاشة، تحت هالصفحة</p>`}`, "push");
  $("iosCopy")?.addEventListener("click", () => navigator.clipboard?.writeText(code).then(() => toast("نسخت الرمز ✓", "goal")));
}
/** A fresh town on the same land and name (the restart, here or from another phone). */
export function makeWorldTown(id, name, restartAt = 0) {
  const s = newGame(Math.floor(Math.random() * 1e9), { terrain: worldTerrain(id.plot), name, site: "world" });
  s.day = worldHourNow(); s.world = { plot: id.plot, owner: id.name, start: s.day, restartAt, saveVersion: "" }; s.war = { seq: 0 };
  return s;
}
export function freshWorldTown(name, restartAt, saveVersion = "") {
  const s = makeWorldTown(me(), name, restartAt);
  s.world.saveVersion = saveVersion;
  store.set(WORLD_SAVE, pack(s));
  store.set(warKey("seen"), "0");
  return s;
}
/** The new app (iPhone home screen): bring the account over with the move code. */
export function handoffSheet(firstOpen) {
  sheet(`<h2>📲 جيب لعبتك من سفاري</h2><p>${firstOpen ? "كنت تلعب من سفاري؟ " : ""}افتح اللعبة بسفاري ← الإعدادات ← <b>«انقل لعبتك للتطبيق»</b>، واكتب الرمز هنا: يجيك كل شي (حساب الجوف ومدنك).${firstOpen ? " ما عندك لعبة قبل؟ سكّر هالصفحة وكمّل عادي." : ""}</p>
    <label class="rg-name">الرمز <input id="hoCode" type="text" inputmode="numeric" maxlength="6" placeholder="١٢٣٤٥٦" style="letter-spacing:6px;text-align:center"></label>
    <div class="sheet-actions keep"><button class="btn go block" id="hoGo" type="button">رجّع حسابي</button></div>`, "world");
  $("hoGo").addEventListener("click", async () => {
    const code = ($("hoCode").value || "").replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
    try { if (await takeMove(code)) return; } catch { /* maybe an older account-only code */ }
    try {
      const r = await api("/world/handoff/claim", { code });
      if (r.error) { toast(r.error, "bad"); sfx.deny(); return; }
      store.set(WORLD_ID, JSON.stringify({ name: r.name, secret: r.secret, plot: r.plot }));
      toast(`رجع حسابك يا ${r.name} ✓`, "goal"); worldMapSheet();
    } catch { toast("ما زبط، جرّب بعد شوي", "bad"); }
  });
}
/** Once, on entering al-Jouf: offer notifications (they work best when asked at the right time). */
export function pushOffer(tries = 0) {
  const st = pushState();
  if (st === "checking") { checkPush()?.then(() => pushOffer(tries)); return; }
  if (st === "on" || st === "no" || st === "denied" || store.get("rafaya-push-asked") === "1" || !worldMode) return;
  if (sheetFor || visiting || WARX.scene) { if (tries < 20) setTimeout(() => pushOffer(tries + 1), 10000); return; } // after the screen in front closes
  if (st === "off") pushKey().catch(() => {});
  store.set("rafaya-push-asked", "1");
  sheet(`<h2>🔔 تبي تنبيهات؟</h2><p>يوصلك تنبيه حتى واللعبة مسكّرة:</p>
    <div class="rows"><div class="row"><span>🚨 هجوم على مدينتك أو حرب</span></div><div class="row"><span>💬 أحد ذكرك بالشات</span></div><div class="row"><span>📰 مواطنينك يبونك وانت غايب</span></div></div>
    ${st === "ios-install" ? `<p class="hint">بالآيفون: ٣ خطوات سهلة تطلع لك بعد ما تضغط «فعّلها».</p>` : ""}
    <div class="sheet-actions two"><button class="btn" id="pushLater" type="button">بعدين</button><button class="btn go" id="pushYes" type="button">🔔 فعّلها</button></div>`, "push");
  $("pushLater").addEventListener("click", closeSheet);
  $("pushYes").addEventListener("click", async () => { if (await pushOn()) closeSheet(); });
}
// In Safari on an iPhone the game keeps a fresh copy of all its saves on the server (gzip) and puts its token in
// the page's address and the manifest's start, so the app added to the home screen opens with it and restores
// everything (the al-Jouf account, the solo towns, the settings). A 6-digit code (24 h) does the same by hand.
export const MOVE = { token: "", code: "", at: 0, snapshot: "", pending: null };
export const moveKeys = () => Object.keys(localStorage).filter((k) => k.startsWith("rafaya-") && !k.startsWith("rafaya-move") && k !== "rafaya-handoff-asked" && k !== "rafaya-push-on");
export const b64 = (buf) => { let s = ""; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768)); return btoa(s); };
export const unb64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
export async function gzipText(text) { return b64(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer()); }
export async function gunzipText(data) { return new Response(new Blob([unb64(data)]).stream().pipeThrough(new DecompressionStream("gzip"))).text(); }
/** Safari on an iPhone: a fresh copy of the saves on the server, its token in the address and the manifest. */
export async function iosPrepareMove(force) {
  if (!isIOS || standalone() || !onlineOk() || globalThis.RAFAYA_PREVIEW || typeof CompressionStream === "undefined") return MOVE;
  if (MOVE.pending) return MOVE.pending;
  MOVE.pending = (async () => {
    const all = {}; for (const k of moveKeys()) all[k] = localStorage.getItem(k);
    const text = JSON.stringify(all);
    if (!force && MOVE.token && MOVE.snapshot === text && Date.now() - MOVE.at < 6 * 3600000) return MOVE;
    const id = me(), account = id && { name: id.name, secret: id.secret };
    const r = await (await fetch(API + "/move/put", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: await gzipText(text), old: MOVE.token, account }) })).json();
    if (!r.token) return MOVE;
    Object.assign(MOVE, { token: r.token, code: r.code, at: Date.now(), snapshot: text });
    const link = new URLSearchParams(location.search).get("link");
    history.replaceState(null, "", `/?move=${r.token}${link ? `&link=${link}` : ""}`);
    document.querySelector('link[rel="manifest"]')?.setAttribute("href", `/api/world/manifest?m=${r.token}${link ? `&t=${link}` : ""}`);
    return MOVE;
  })();
  try { return await MOVE.pending; }
  catch { return MOVE; }
  finally { MOVE.pending = null; }
}
/** The app: take the copy (by the link or a typed code) and restore it, then start again with it. */
export async function takeMove(tokenOrCode) {
  const r = await (await fetch(API + "/move/take", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: tokenOrCode }) })).json();
  if (!r.data) return false;
  const all = JSON.parse(await gunzipText(r.data));
  for (const [k, v] of Object.entries(all)) if (k !== "rafaya-push-on" && typeof v === "string") localStorage.setItem(k, v);
  sessionStorage.setItem("rafaya-moved", "1");
  location.replace("/");
  return true;
}
/** Safari: the code to type in the app (and the steps). */
export async function moveCodeSheet() {
  sheet(`<h2>📲 انقل لعبتك للتطبيق</h2><p class="hint">نجهّز…</p>`, "push");
  const m = await iosPrepareMove(true);
  if (!m.code) { sheet(`<h2>📲 انقل لعبتك للتطبيق</h2><div class="need">ما زبط، جرّب بعد شوي</div>`, "push"); return; }
  sheet(`<h2>📲 انقل لعبتك للتطبيق</h2><p>بالتطبيق (الأيقونة) اكتب هالرمز ويجيك كل شي: حساب الجوف ومدنك والإعدادات.</p>
    <div class="vote"><b class="ol-code" style="letter-spacing:6px">${ar(m.code)}</b><span>صالح ٢٤ ساعة · مرة وحدة</span></div>
    <button class="btn block" id="mvCopy" type="button">انسخ الرمز</button>
    <p class="hint">ما عندك التطبيق؟ افتح «تنبيهات الآيفون» من الإعدادات تلقى خطوات الإضافة.</p>`, "push");
  $("mvCopy").addEventListener("click", () => navigator.clipboard?.writeText(m.code).then(() => toast("نسخت الرمز ✓", "goal")));
}
export const UPDATE_PARAM = "rafaya-release";
export async function versionCheck(timed = false) {
  if (VERSION === "dev" || globalThis.RAFAYA_PREVIEW || !onlineOk() || sheetFor === "update") return;
  // the minute's check: while the live socket answers, its pong says the release, so ask only every 10 minutes
  if (timed && document.hidden) return; // in the background: checked again the moment it comes back (visibilitychange)
  if (timed && LIVE.ok && Date.now() - (LIVE.pongAt || 0) < 90000 && Date.now() - (versionCheck.at || 0) < 10 * 60000) return;
  versionCheck.at = Date.now();
  let v;
  try { v = (await (await fetch("/api/version", { cache: "no-store" })).json()).version; } catch { return; } // the oldest release that may carry on
  if (!v || v === "dev") return;
  if (v === VERSION || v === REQUIRED) { // this copy is that release or a later one (an optional update came after it)
    const url = new URL(location.href);
    if (url.searchParams.has(UPDATE_PARAM)) {
      url.searchParams.delete(UPDATE_PARAM);
      url.searchParams.delete("rafaya-retry");
      history.replaceState(history.state, "", url);
    }
    return;
  }
  updateSheet(v);
}
export function updateSheet(v) {
  const tried = sessionStorage.getItem("rafaya-update-tried") === v; // already reloaded for this version once: the browser kept old files
  sheet(`<h2>⬆️ تحديث جديد</h2><p>نزل تحديث جديد للعبة، ولازم تحدّث عشان تكمل. مدينتك محفوظة وما يضيع منها شي.</p>
    ${tried ? `<div class="need">المتصفح ما جاب النسخة الجديدة. اقفل اللعبة وافتحها من نفس المكان، من الأيقونة أو من المتصفح، وجرّب زر التحديث مرة ثانية.</div>` : ""}
    <div class="sheet-actions keep"><button class="btn go block" id="updNow" type="button">حدّث الحين</button></div>`, "update");
  $("sheetClose").hidden = true;
  $("updNow").addEventListener("click", async () => {
    $("updNow").disabled = true; $("updNow").textContent = "نحدّث…";
    try {
      if (playing) save();
      if (worldMode) await Promise.race([worldSync(true), new Promise((resolve) => setTimeout(resolve, 2500))]);
    } catch { /* the save is on the phone already */ }
    try { sessionStorage.setItem("rafaya-update-tried", v); } catch { /* fine */ }
    const url = new URL(location.href);
    url.searchParams.set(UPDATE_PARAM, v);
    url.searchParams.set("rafaya-retry", String(Date.now()));
    location.replace(url);
  });
}
export const LIVE = { ws: null, ok: false, tries: 0, timer: 0, ping: 0 };
export function liveOpen() {
  if (LIVE.ws || globalThis.RAFAYA_PREVIEW || !onlineOk() || !worldMode) return;
  let ws;
  try { ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${API}/world/live`); } catch { liveRetry(); return; }
  LIVE.ws = ws;
  ws.onopen = () => {
    LIVE.ok = true; LIVE.tries = 0;
    const id = me();
    if (id) ws.send(JSON.stringify({ t: "hello", name: id.name, secret: id.secret }));
    clearInterval(LIVE.ping); LIVE.ping = setInterval(() => { if (!document.hidden) try { ws.send('{"t":"ping"}'); } catch { /* closing */ } }, 30000); // phones drop quiet sockets; only while in front (the server sends no phone notification then)
    warPoll(true); chatPoll(true); wnewsPoll(true); // catch up on what happened while not connected
    if (LIVE.was) versionCheck(); // back after a drop: a new release restarts the server, so the update shows at once
    LIVE.was = true;
  };
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } liveHint(m); };
  ws.onclose = () => { LIVE.ws = null; LIVE.ok = false; clearInterval(LIVE.ping); liveRetry(); };
  ws.onerror = () => { try { ws.close(); } catch { /* closed */ } };
}
export function liveRetry() {
  clearTimeout(LIVE.timer);
  if (!worldMode) return;
  LIVE.timer = setTimeout(liveOpen, Math.min(30000, 1000 * 2 ** LIVE.tries++)); // 1 s, 2 s, 4 s… up to 30 s
}
export function liveClose() {
  clearTimeout(LIVE.timer); clearInterval(LIVE.ping);
  const ws = LIVE.ws; LIVE.ws = null; LIVE.ok = false;
  if (ws) { ws.onclose = null; try { ws.close(); } catch { /* closed */ } }
}
/** How many towns of al-Jouf are being played right now: a number only, never who (every 45 s while playing there). */
export const ONLINE = { at: 0, busy: false };
export async function onlinePoll(force) {
  const chip = $("sOnline");
  if (!worldMode || globalThis.RAFAYA_PREVIEW || !onlineOk()) { chip.hidden = true; return; }
  if (ONLINE.busy || document.hidden || (!force && Date.now() - ONLINE.at < 45000)) return;
  if (!force && LIVE.ok && Date.now() - (LIVE.pongAt || 0) < 70000) return; // the live socket's pong brings the number
  ONLINE.busy = true; ONLINE.at = Date.now();
  try { const r = await api("/world/online"); if (Number.isFinite(r.n) && worldMode) { chip.textContent = `${ar(Math.max(1, r.n))} متصل`; chip.hidden = false; } } catch { /* next time */ }
  finally { ONLINE.busy = false; }
}
/** What the server said changed: ask for it now. */
export function liveHint(m) {
  if (m.t === "pong") { // every 30 s while in front: the number playing and the release to run, without a request
    LIVE.pongAt = Date.now();
    const chip = $("sOnline");
    if (Number.isFinite(m.n) && worldMode && chip) { chip.textContent = `${ar(Math.max(1, m.n))} متصل`; chip.hidden = false; }
    if (m.v && m.v !== "dev" && VERSION !== "dev" && m.v !== VERSION && m.v !== REQUIRED) versionCheck(); // a new release: ask once and show it
    return;
  }
  if (!worldMode) return;
  if (m.t === "chat" && m.message) {
    if (!CHAT.msgs.some((x) => x.id === m.message.id)) { CHAT.msgs = [...CHAT.msgs, m.message].slice(-120); CHAT.last = Math.max(CHAT.last || 0, m.message.id); }
    if (sheetFor === "chat") chatSheet(true);
    chatCount();
  } else if (m.t === "chatdel") {
    const ids = new Set(Array.isArray(m.ids) ? m.ids : [m.id]);
    CHAT.msgs = CHAT.msgs.filter((x) => !ids.has(x.id));
    if (sheetFor === "chat") chatSheet(true);
    chatCount();
  } else if (m.t === "banned" && m.purged) {
    if (arrange) leaveArrange(false);
    FIX.ask = null;
    leaveWorld();
    try { localStorage.removeItem(storePrefix + WORLD_ID); localStorage.removeItem(storePrefix + WORLD_SAVE); } catch { /* storage unavailable */ }
    showMenu(); menuBackdrop();
    toast("حسابك بعالم الجوف موقوف من الإدارة وحُذفت مدينتك", "bad");
  }
  else if (m.t === "war" || m.t === "namefix") warPoll(true);
  else if (m.t === "news") { wnewsPoll(true).then(() => { if (sheetFor === "wnews") worldNewsSheet(true); }); }
  else if (m.t === "town") {
    if (m.plot === me()?.plot) return;
    if (sheetFor === "world") clearTimeout(liveHint.map), liveHint.map = setTimeout(() => { if (sheetFor === "world") worldMapSheet(); }, 800);
    if (visiting?.world && Number(visiting.code) === m.plot) {
      clearTimeout(liveHint.visit);
      if (m.removed) { leaveVisit(); toast("المدينة انشالت من عالم الجوف", "bad"); }
      else if (!WARX.targeting) liveHint.visit = setTimeout(() => refreshVisit(), 800);
    }
  }
}
/** The citizens' important requests still waiting for the mayor (for a reminder on the phone while away). */
export function pendingSummary(home) {
  const list = (home.news || []).filter((p) => p.mood < 0 && !p.answered && p.person).sort((a, b) => (b.likes || 0) - (a.likes || 0));
  const d = home.decision && DECISIONS.find((x) => x.id === home.decision.id);
  return { n: list.length, who: list[0]?.person?.name || "", text: list[0]?.text || "", decision: d?.title || "" };
}
export const saveRequests = new WeakMap();
export const saveWriters = new WeakMap();
export function ownsActiveSave(home) {
  const id = me();
  return worldMode && id?.plot != null && (visiting?.home ?? S) === home && home?.world?.plot === id.plot && home.world.owner === id.name;
}
export function worldSnapshot(home, compare = false) {
  const { saveVersion, pendingWrites, syncConflict, ...online } = home.world;
  return pack({ ...home, world: online, savedAt: compare ? undefined : home.savedAt, cam: compare ? undefined : home.cam,
    moneyLog: undefined, news: [], history: [], log: [], neighbours: [], promises: [], comebacks: [], demands: {} });
}
export function prepareWorldSave(home, { state, town }) {
  const revision = state.world.saveVersion;
  const sameRestart = (town.restarted || 0) === (home.world.restartAt || 0);
  const knownRevision = home.world.saveVersion === revision || pendingSaveMatches(revision, home.world.pendingWrites);
  if (!sameRestart || (!knownRevision && town.snapshot && worldSnapshot(state, true) !== worldSnapshot(home, true))) return false;
  home.world.saveVersion = revision;
  delete home.world.syncConflict;
  return true;
}
export const conflictCopyKey = (id) => `rafaya-world-copy-${id.plot}-${id.name}`;
export function keepDeviceSave(home, id) {
  const copy = pack(home), key = conflictCopyKey(id);
  store.set(key, copy);
  return store.get(key) === copy;
}
/** Send the town to the server: its look within seconds of a change, its numbers every 2 minutes, and now when leaving. */
export function worldSync(force, leaving = false) {
  const id = me();
  if (!worldMode || id?.plot == null || !onlineOk() || navigator.onLine === false || arrange) return;
  const mine = visiting ? visiting.home : S; // while visiting, S is the other player's town: never send it as yours
  if (!ownsActiveSave(mine)) return;
  if (mine.world.syncConflict) return leaving ? undefined : recoverWorldSave(mine);
  if (leaving && Date.now() - (worldSync.backgroundAt || 0) < 1000) return;
  if (!force) {
    clearTimeout(worldSync.soon);
    worldSync.soon = setTimeout(() => warSyncNow(false), 3000); // only sent if the layout changed
    if (Date.now() - lastSync < 2 * 60000) return;
  }
  const busy = saveRequests.get(mine);
  if (busy) {
    if (force && !leaving) busy.next ??= busy.task.then(() => {
      if (ownsActiveSave(mine)) return worldSync(true);
    });
    return busy.next ?? busy.task;
  }
  const request = {};
  request.task = sendWorldSave(mine, id, leaving).catch(() => {}).finally(() => saveRequests.delete(mine));
  saveRequests.set(mine, request);
  return request.task;
}
export const esc = (t) => String(t ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);
