// Names the owner asked to change, Google sign-in, the world map sheet, moving and renaming a town.
// Moved out of js/main.js as it was (nothing changed in it); main.js and the modules import each other's names.
import { $, S, ar, arrange, closeSheet, gsi, leaveArrange, leaveWorld, loadClock, money, refresh, save, sheet, sheetFor, showMenu, store, visiting, worldMapSheet, worldMode } from "./main.js";
import { FIX, row, toast } from "./ui-build.js";
import { WORLD_ID, WORLD_SAVE, api, esc, handoffSheet, makeWorldTown, me, onlineOk, prepareWorldSave } from "./ui-online.js";
import { DEPUTY, pack, unpack } from "./sim.js";
import { sfx } from "./sound.js";
import { menuBackdrop } from "./ui-whatsnew.js";
import { WARX } from "./ui-war.js";
import { ERAS, townNameKey } from "./data.js";

export const fixLeft = (due) => { const m = Math.max(0, Math.round((due - Date.now()) / 60000)); return m >= 60 ? `${ar(Math.floor(m / 60))} ساعة${m % 60 ? ` و${ar(m % 60)} دقيقة` : ""}` : `${ar(m)} دقيقة`; };
export function namefixSheet(f) {
  if (sheetFor === "namefix" || sheetFor === "update") return;
  FIX.ask = f;
  const id = me(), wantName = f.what !== "town", wantTown = f.what !== "name" && !f.removed && id?.plot != null;
  const town = worldMode && S.world ? S.name : (() => { try { return unpack(store.get(WORLD_SAVE)).name; } catch { return ""; } })();
  const why = [...f.reasons, ...(f.note ? [f.note] : [])];
  sheet(`<h2>✏️ مطلوب تغيير ${wantName && wantTown ? "اسمك واسم مدينتك" : wantName ? "اسمك" : "اسم مدينتك"}</h2>
    <p>الإدارة طلبت منك تغيّر ${wantName && wantTown ? "اسمك واسم مدينتك" : wantName ? "اسمك" : "اسم مدينتك"} عشان:</p>
    <div class="need">${why.map((w) => `• ${esc(w)}`).join("<br>")}</div>
    ${f.removed ? `<p class="hint">انتهت المهلة وانحذفت مدينتك من عالم الجوف. غيّر اسمك وتقدر تأسس مدينة جديدة.</p>` : `<div class="rows"><div class="row"><span>⏳ باقي على المهلة</span><b>${fixLeft(f.due)}</b></div></div><p class="hint">إذا ما غيّرته قبل ما تخلص المهلة، <b>تنحذف مدينتك كاملة من عالم الجوف</b>.</p>`}
    ${wantName ? `<label class="rg-name">اسمك الجديد <input id="nfName" type="text" maxlength="16" placeholder="بدل «${esc(id?.name || "")}»"></label>` : ""}
    ${wantTown ? `<label class="rg-name">اسم مدينتك الجديد <input id="nfTown" type="text" maxlength="20" placeholder="${town ? `بدل «${esc(town)}»` : ""}"></label>` : ""}
    <div class="sheet-actions keep"><button class="btn go block" id="nfGo" type="button">غيّر</button></div>`, "namefix");
  $("nfGo").addEventListener("click", async () => {
    const newName = ($("nfName")?.value || "").trim(), newTown = ($("nfTown")?.value || "").trim();
    if ((wantName && !newName) || (wantTown && !newTown)) { toast("اكتب الاسم الجديد", "bad"); sfx.deny(); return; }
    let r;
    try { r = await api("/world/namefix", { name: id.name, secret: id.secret, newName, newTown }); } catch { toast("ما زبط، جرّب بعد شوي", "bad"); return; }
    if (r.error) { toast(r.error, "bad"); sfx.deny(); return; }
    store.set(WORLD_ID, JSON.stringify({ ...me(), name: r.name }));
    try {
      const home = worldMode ? (visiting?.home ?? S) : unpack(store.get(WORLD_SAVE));
      if (home.world?.plot === id.plot) {
        home.world.owner = r.name;
        if (r.town) home.name = r.town;
        if (!arrange) store.set(WORLD_SAVE, pack(home));
        if (worldMode && !visiting) refresh();
      }
    } catch { /* the server copy is used if the local town is unreadable */ }
    FIX.ask = null; closeSheet();
    sfx.era(); toast("تم التغيير ✓ شكرًا لتعاونك", "goal");
    if (!worldMode) openWorld();
  });
}
/** The town is gone from the map (a name not changed in time): forget it on this phone. */
export function forgetTown() {
  try { localStorage.removeItem(WORLD_SAVE); } catch { /* fine */ }
  const id = me(); if (id) store.set(WORLD_ID, JSON.stringify({ ...id, plot: null }));
}
export function townRemoved(f) {
  if (sheetFor === "removed") return;
  if (arrange) leaveArrange(false);
  forgetTown();
  leaveWorld(); showMenu(); menuBackdrop();
  sheet(`<h2>🗑️ مدينتك انحذفت من عالم الجوف</h2><p>${f?.removed ? "انتهت مهلة تعديل الاسم، فانحذفت المدينة." : "حسابك باقي معك، وتقدر ترجع لخريطة الجوف."}</p>
    <div class="sheet-actions keep"><button class="btn go block" id="rmOk" type="button">تمام</button></div>`, "removed");
  $("rmOk").addEventListener("click", () => { closeSheet(); if (f) namefixSheet(f); });
}
/** The way into the world: a name first, then the map. */
/** The world is closed for maintenance (the server answers 503): say so, and that nothing is lost. */
export function worldClosedSheet() {
  sheet(`<h2>🛠️ عالم الجوف تحت الصيانة</h2>
    <p>نشتغل على عالم الجوف ونضيف له أشياء جديدة، وبيرجع قريب إن شاء الله.</p>
    <div class="rows"><div class="row"><span>مدينتك بالعالم</span><b>محفوظة ✓</b></div></div>
    <p class="hint">إذا رجع العالم، يمسك نائب العمدة مدينتك عن الأيام اللي فاتت مثل العادة.</p>`, "world");
}
export async function worldIsClosed() {
  try { await api("/world/clock"); return false; } catch (e) { return e.message === "maintenance"; }
}
export async function openWorld() {
  if (!onlineOk()) { toast("عالم الجوف يشتغل من رابط اللعبة: rafaya.vamosx.workers.dev", "bad"); return; }
  if (me()) sheet(`<h2>🌍 عالم الجوف</h2><p class="hint">نحمّل الخريطة…</p>`, "world"); // something on screen at once, while the server answers
  if (await worldIsClosed()) { worldClosedSheet(); return; }
  await loadClock();
  if (!me()) { worldJoinSheet(); return; }
  try { // a name the owner asked to change comes first; a town taken off the map is forgotten on this phone
    const id = me(), st = await api("/world/war/state", { name: id.name, secret: id.secret, since: 0, seq: 0 });
    if (st.noTown && id.plot != null) forgetTown();
    if (st.namefix) { namefixSheet(st.namefix); return; }
  } catch { /* the map anyway */ }
  worldMapSheet();
}
export const GOOGLE_CLIENT_ID = "610657966885-d15nel049o5fltrq4ospoe4gfb50hf4e.apps.googleusercontent.com";
export const inAppBrowser = () => /Snapchat|TikTok|musical_ly|Instagram|FBAN|FBAV|Line\/|; wv\)/i.test(navigator.userAgent);
/** Google's own button in `box`; onToken gets the signed answer (checked on the server). */
export async function googleButton(box, onToken) {
  if (!box) return;
  if (globalThis.RAFAYA_PREVIEW || !onlineOk()) { box.hidden = true; return; }
  if (inAppBrowser()) { box.innerHTML = `<p class="hint">قوقل ما يسمح بالدخول من داخل سناب وتيك توك وإنستقرام. افتح اللعبة في كروم أو سفاري وادخل بحساب قوقل من هناك.</p>`; return; }
  try {
    const g = await gsi();
    g.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: (r) => r?.credential && onToken(r.credential), ux_mode: "popup", auto_select: false, cancel_on_tap_outside: true });
    box.innerHTML = "";
    g.accounts.id.renderButton(box, { theme: "outline", size: "large", shape: "pill", text: "continue_with", locale: "ar", width: Math.min(320, box.clientWidth || 300) });
  } catch { box.innerHTML = `<p class="hint">ما قدرنا نفتح قوقل الحين، جرّب بعد شوي.</p>`; }
}
/** Once per player, on entering al-Jouf: a screen to link the account to Google (after any screen in front closes). */
export async function googleOffer(tries = 0) {
  const id = me();
  if (!worldMode || !id || globalThis.RAFAYA_PREVIEW || !onlineOk() || store.get("rafaya-google-asked") === "1") return;
  if (sheetFor || visiting || WARX.scene || arrange) { if (tries < 30) setTimeout(() => googleOffer(tries + 1), 15000); return; }
  let st = null;
  try { st = await api("/world/me", { name: id.name, secret: id.secret }); } catch { return; }
  store.set("rafaya-google-asked", "1");
  if (st?.google || sheetFor) return;
  sheet(`<h2>🔐 جديد: احفظ حسابك بقوقل</h2>
    <p>اربط حسابك «${id.name}» بحساب قوقل، ولو ضاع جوالك أو غيرته أو حذفت اللعبة، ترجع لمدينتك بضغطة من أي جوال، بدون كود استرجاع.</p>
    <p class="hint">ما ناخذ إيميلك ولا اسمك من قوقل، بس رقم حسابك مشفّر. وتقدر تفك الربط متى ما بغيت من الإعدادات.</p>
    <div id="gBtn" class="g-btn"></div>
    <div class="sheet-actions keep"><button class="btn block" id="gLater" type="button">بعدين (من الإعدادات)</button></div>`, "google");
  googleButton($("gBtn"), async (credential) => { await googleLink(credential); if (sheetFor === "google") closeSheet(); });
  $("gLater").addEventListener("click", closeSheet);
}
/** Sign in with Google: the player linked to that Google account, on this phone. */
export async function googleLogin(credential) {
  let r;
  try { r = await api("/world/google/login", { credential }); } catch (e) { r = { error: e.message }; }
  if (r?.secret) {
    store.set(WORLD_ID, JSON.stringify({ name: r.name, secret: r.secret, plot: r.plot }));
    toast(`حيّاك ${r.name}! دخلت بحساب قوقل ✓`, "goal"); sfx.goal(); worldMapSheet(); return;
  }
  toast(r?.error === "404" || r?.error === "none" ? "حساب قوقل هذا مو مربوط بأي لاعب. ادخل باسمك أو بكود الاسترجاع، واربطه من الإعدادات." : r?.error === "403" ? "ما قدرنا نتأكد من حساب قوقل، جرّب مرة ثانية" : "ما زبط الدخول بقوقل، جرّب بعد شوي", "bad");
}
/** Link (or unlink) this player to a Google account, from the settings. */
export async function googleLink(credential) {
  const id = me();
  if (!id) return;
  let r;
  try { r = await api("/world/google/link", { name: id.name, secret: id.secret, credential }); } catch (e) { r = { error: e.message === "409" ? "حساب قوقل هذا مربوط بلاعب ثاني" : "ما زبط الربط، جرّب بعد شوي" }; }
  if (r?.ok) { toast("انربط حسابك بقوقل ✓ تقدر تدخل منه من أي جوال", "goal"); sfx.goal(); googleSection(); }
  else toast(r?.error || "ما زبط الربط", "bad");
}
/** The settings' «حسابك» part: linked or not, and the button. */
/** «اسمك»: the player changes their own name in al-Jouf, once only. */
export async function nameSection() {
  const id = me();
  if (!$("nameBox") || !id) return;
  let st = null;
  try { st = await api("/world/me", { name: id.name, secret: id.secret }); } catch { st = null; }
  const box = $("nameBox");
  if (!box) return;
  if (!st) { box.innerHTML = `<p class="hint">ما قدرنا نوصل للسيرفر، جرّب بعد شوي.</p>`; return; }
  if (st.renamed) { box.innerHTML = `<p class="hint">اسمك «<b>${esc(id.name)}</b>». غيّرته قبل، والاسم يتغير مرة وحدة بس.</p>`; return; }
  box.innerHTML = `<p class="hint">اسمك الحين «<b>${esc(id.name)}</b>». تقدر تغيّره <b>مرة وحدة بس</b>، وبعدها يثبت.</p>
    <label class="rg-name">اسمك الجديد <input id="nmNew" type="text" maxlength="16" placeholder="بدل «${esc(id.name)}»"></label>
    <button class="btn block" id="nmGo" type="button">غيّر اسمي</button>`;
  $("nmGo").addEventListener("click", async () => {
    const newName = ($("nmNew").value || "").trim();
    if (!newName) { toast("اكتب الاسم الجديد", "bad"); sfx.deny(); return; }
    if (!confirm(`تغيّر اسمك إلى «${newName}»؟ ما تقدر تغيّره بعدها.`)) return;
    let r;
    try { r = await api("/world/newname", { name: id.name, secret: id.secret, newName }); } catch { toast("ما زبط، جرّب بعد شوي", "bad"); return; }
    if (r.error) { toast(r.error, "bad"); sfx.deny(); return; }
    store.set(WORLD_ID, JSON.stringify({ ...me(), name: r.name }));
    try {
      const home = worldMode ? (visiting?.home ?? S) : unpack(store.get(WORLD_SAVE));
      if (home.world?.plot === id.plot) { home.world.owner = r.name; if (!arrange) store.set(WORLD_SAVE, pack(home)); }
    } catch { /* the server copy is used if the local town is unreadable */ }
    sfx.goal(); toast(`صار اسمك «${r.name}» ✓`, "goal");
    nameSection();
  });
}
export async function googleSection() {
  const box = $("googleBox"), id = me();
  if (!box || !id) return;
  let st = null;
  try { st = await api("/world/me", { name: id.name, secret: id.secret }); } catch { st = null; }
  if (!$("googleBox")) return;
  if (st?.google) {
    box.innerHTML = `<div class="need ok">✓ حسابك «${id.name}» مربوط بحساب قوقل. من أي جوال: «عالم الجوف» ← «الدخول بحساب قوقل».</div><button class="btn block" id="gUnlink" type="button">فك الربط</button>`;
    $("gUnlink").addEventListener("click", async () => { try { await api("/world/google/unlink", { name: id.name, secret: id.secret }); toast("انفك الربط"); } catch { toast("ما زبط، جرّب بعد شوي", "bad"); } googleSection(); });
  } else {
    box.innerHTML = `<p>اربط حسابك بقوقل، ولو ضاع جوالك أو غيرته تدخل لمدينتك بضغطة. ما ناخذ إيميلك ولا اسمك من قوقل.</p><div id="gBtn" class="g-btn"></div>`;
    googleButton($("gBtn"), googleLink);
  }
}
export function worldJoinSheet(recover) {
  sheet(`<h2>🌍 عالم الجوف</h2>
    <p>عالم واحد يجمع كل اللاعبين على خريطة الجوف: كل واحد يأسس مدينته في أرض، والكل يشوف مدن الثاني ويدخلها. العالم يمشي دايم، وإذا طلعت يمسك مدينتك «نائب العمدة».</p>
    ${recover ? `<label class="rg-name">اسمك <input id="wjName" type="text" maxlength="16"></label>
      <label class="rg-name">كود الاسترجاع <input id="wjCode" type="text" maxlength="12" style="text-transform:uppercase"></label>
      <div class="sheet-actions keep"><button class="btn go block" id="wjGo" type="button">رجّع حسابي</button></div>`
      : `<label class="rg-name">اختر اسمك <input id="wjName" type="text" maxlength="16" placeholder="مثلاً: أبو_فهد"></label>
      <p class="hint">٣ إلى ١٦ حرف (عربي أو إنجليزي أو أرقام). يطلع للكل فوق مدينتك، فلا تكتب اسمك الكامل.</p>
      <div class="sheet-actions keep"><button class="btn go block" id="wjGo" type="button">ادخل العالم</button></div>
      <div class="g-or"><span>أو</span></div>
      <div id="wjGoogle" class="g-btn"></div>
      <p class="hint" style="text-align:center">«الدخول بحساب قوقل» للي ربط حسابه من الإعدادات.</p>
      <button class="btn block" id="wjRecover" type="button">عندي حساب وكود استرجاع</button>
      <button class="btn block" id="wjHandoff" type="button">📲 كنت ألعب من سفاري (عندي رمز)</button>`}`, "world");
  $("wjRecover")?.addEventListener("click", () => worldJoinSheet(true));
  googleButton($("wjGoogle"), googleLogin);
  $("wjHandoff")?.addEventListener("click", () => handoffSheet());
  $("wjGo").addEventListener("click", async () => {
    const name = $("wjName").value.trim();
    try {
      if (recover) {
        const r = await api("/world/recover", { name, recovery: $("wjCode").value.trim().toUpperCase() });
        store.set(WORLD_ID, JSON.stringify({ name: r.name, secret: r.secret, plot: r.plot }));
        toast(`رجع حسابك يا ${r.name} ✓`, "goal"); worldMapSheet();
      } else {
        const r = await api("/world/join", { name });
        store.set(WORLD_ID, JSON.stringify({ name: r.name, secret: r.secret, plot: null }));
        sheet(`<h2>هلا ${r.name}!</h2><p>هذا كود الاسترجاع حقك. احفظه عندك (صوّره أو انسخه): لو غيرت جوالك ترجع فيه لاسمك ومدينتك.</p>
          <div class="row"><span>كود الاسترجاع</span><b class="ol-code">${r.recovery}</b></div>
          <div class="sheet-actions keep"><button class="btn block" id="wjCopy" type="button">انسخ الكود</button><button class="btn go block" id="wjNext" type="button">حفظته، كمّل للخريطة</button></div>
          <h3>🔐 أو اربطه بقوقل (أسهل)</h3><p class="hint">تدخل من أي جوال بضغطة، بدون كود.</p><div id="gBtn" class="g-btn"></div>`, "world");
        googleButton($("gBtn"), googleLink);
        $("wjCopy").addEventListener("click", () => navigator.clipboard?.writeText(r.recovery).then(() => toast("نسخت ✓", "goal")));
        $("wjNext").addEventListener("click", () => worldMapSheet());
      }
    } catch (e) {
      const messages = { 409: "الاسم مأخوذ، اختر غيره", 400: "اختر اسمًا من ٣ إلى ١٦ حرف بدون رموز", 422: "هالاسم ما يصلح. اختر لقب مناسب للعبة." };
      toast(messages[e.message] || "ما زبط، تأكد من الاسم والكود", "bad");
    }
  });
}
/** Rename your town in al-Jouf: once only, and never to a name another town has. */
export function renameSheet(t, plots) {
  const id = me();
  sheet(`<h2>✏️ اسم مدينتك</h2><p>تقدر تغيّر اسم «${t.town}» <b>مرة وحدة بس</b>، وبعدها يثبت. والاسم لازم ما يكون لمدينة ثانية بالجوف.</p>
    <label class="rg-name">الاسم الجديد <input id="rnTown" type="text" maxlength="20" placeholder="${t.town}"></label>
    <div class="sheet-actions two"><button class="btn" id="rnBack" type="button">رجوع</button><button class="btn go" id="rnGo" type="button">ثبّت الاسم</button></div>`, "world");
  $("rnBack").addEventListener("click", () => worldMapSheet(t.plot));
  $("rnGo").addEventListener("click", async () => {
    const town = ($("rnTown").value || "").trim();
    if (town.length < 2) { toast("اكتب الاسم الجديد", "bad"); return; }
    if (plots.some((o) => o.plot !== t.plot && townNameKey(o.town) === townNameKey(town))) { toast(`فيه مدينة بالجوف اسمها «${town}»، اختر اسم ثاني`, "bad"); sfx.deny(); return; }
    if (!confirm(`متأكد؟ «${town}» بيصير اسمها للأبد وما تقدر تغيّره مرة ثانية.`)) return;
    try {
      const r = await api("/world/rename", { name: id.name, secret: id.secret, town });
      if (r.error) { toast(r.error, "bad"); sfx.deny(); return; }
      if (worldMode && S.world?.plot === t.plot) { S.name = r.town; save(); refresh(); }
      else { try { const s = unpack(store.get(WORLD_SAVE)); s.name = r.town; store.set(WORLD_SAVE, pack(s)); } catch { /* the town picks it up next time */ } }
      sfx.era(); toast(`صار اسمها «${r.town}» 🎉`, "era");
      worldMapSheet(t.plot);
    } catch { toast("ما زبط، جرّب بعد شوي", "bad"); }
  });
}
export async function readCloudTown(id) {
  const { town } = await api(`/world/town/${id.plot}`);
  if (town.owner !== id.name) throw new Error("different town owner");
  const state = town.snapshot ? unpack(town.snapshot) : makeWorldTown(id, town.town, town.restarted);
  if (state.world?.plot !== id.plot) throw new Error("different town plot");
  state.name = town.town;
  state.world.owner = id.name;
  state.world.saveVersion = town.saveVersion ?? "";
  return { state, town };
}
export async function readOwnTown(id) {
  if (id?.plot == null) return null;
  try {
    const local = unpack(store.get(WORLD_SAVE));
    if (local.world?.plot === id.plot) {
      local.world.owner = id.name;
      if (local.world.syncConflict || typeof local.world.saveVersion !== "string") {
        if (await prepareWorldSave(local, id).catch(() => null) === false) local.world.syncConflict = true;
      }
      return local;
    }
  } catch { /* use the server copy when local storage is missing or unreadable */ }
  return readCloudTown(id).then(({ state }) => state).catch(() => null);
}
export function deputyReport(r) {
  const h = r.hours, d = Math.round(h / 24), span = h < 24 ? `${ar(h)} ساعة` : d === 1 ? "يوم" : d === 2 ? "يومين" : `${ar(d)} ${d <= 10 ? "أيام" : "يوم"}`;
  sheet(`<h2>🧑‍💼 تقرير نائب العمدة</h2><p>غبت ${span} من وقت العالم، والنائب مسك البلد.${r.slept ? " وبعد أسبوع من الغياب دخلت المدينة في سبات لين رجعت." : ""}</p>
    <div class="rows">
      ${row("الميزانية", `${r.money >= 0 ? "+" : "−"}${money(Math.abs(r.money))} ريال`, r.money >= 0 ? "plus" : "minus")}
      ${r.capped ? `<div class="hint">💡 أكثر شي تكسبه مدينتك وانت برا ${money(r.cap)} ريال (${ERAS[S.era].name})، وكل ما كبرت مدينتك زاد الحد. العب وانت داخل تكسب كامل.</div>` : ""}
      ${row("السكان", `${r.pop >= 0 ? "+" : "−"}${money(Math.abs(r.pop))}`, r.pop >= 0 ? "plus" : "minus")}
      ${r.did.repairs ? row("رمّم المباني", `${ar(r.did.repairs)} مرة`) : ""}
      ${r.did.decisions ? row("قرارات أخذها بالخيار الآمن", ar(r.did.decisions)) : ""}
      ${r.did.taxUp ? row("رفع الضريبة", `من ${ar(r.taxFrom)}٪ إلى ${ar(S.tax)}٪`, "minus") : ""}
      ${r.did.shield ? row("🛡️ درع الغياب حماك", `${ar(r.did.shield)} مرة`, "plus") : ""}
    </div>
    ${r.msgs.filter((m) => m.text && m.kind !== "ach").slice(-4).map((m) => `<p class="hint">• ${m.title ? m.title + ": " : ""}${m.text}</p>`).join("")}
    <div class="sheet-actions keep"><button class="btn go block" id="depOk" type="button">تمام</button></div>`, "away");
  $("depOk").addEventListener("click", closeSheet);
}
/** Standing orders for the deputy mayor. */
export function deputySheet() {
  const o = { ...DEPUTY, ...(S.deputy || {}) };
  sheet(`<h2>🧑‍💼 نائب العمدة</h2><p>إذا طلعت من اللعبة، النائب يمسك مدينتك والعالم يكمل. هذي أوامرك له:</p>
    <div class="rows">
      <label class="row toggle"><span>يرمم المباني اللي تخرب</span><input type="checkbox" id="dpRepair" ${o.repair ? "checked" : ""}></label>
      <label class="row toggle"><span>يرفع الضريبة شوي إذا قلّت الفلوس</span><input type="checkbox" id="dpTax" ${o.tax ? "checked" : ""}></label>
      <div class="row"><span>ما يصرف لو الميزانية تحت</span><select id="dpFloor">${[0, 2000, 5000, 20000, 50000].map((v) => `<option value="${v}" ${o.floor === v ? "selected" : ""}>${money(v)}</option>`).join("")}</select></div>
    </div>
    <p class="hint">النائب ما يبني ولا يهد شي، ويختار الخيار الآمن في القرارات، ويرد على الناس بـ«نشوف».</p>
    <h3>🛡️ درع الغياب</h3>
    <p class="hint">وأنت طالع ما تفلس، وما تخسر أكثر من ٥٪ من سكانك باليوم، والسيول أخف. وإذا غبت أكثر من أسبوع تدخل مدينتك في سبات وما يتغير فيها شي.</p>`, "deputy");
  const set = () => { S.deputy = { repair: $("dpRepair").checked, tax: $("dpTax").checked, floor: Number($("dpFloor").value) }; save(); };
  for (const k of ["dpRepair", "dpTax", "dpFloor"]) $(k).addEventListener("change", set);
}
