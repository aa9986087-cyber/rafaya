// «وش الجديد»: showing the release notes of js/whats-new.js.
// Moved out of js/main.js as it was (nothing changed in it); main.js and the modules import each other's names.
import { WHATS_NEW } from "./whats-new.js";
import { $, A, S, ar, bankSheet, closeSheet, fine, money, refresh, save, sheet, sheetFor, store, sync, tool, world, worldMode } from "./main.js";
import { WORLD_SAVE, me } from "./ui-online.js";
import { nameLandmarks, row, toast } from "./ui-build.js";
import { MAP_SIZE as N, worldPlace } from "./data.js";
import { dayOf, hoursToElection, moneyCap, provinceFee, repairAll, unpack } from "./sim.js";
import { productionHtml } from "./ui-people.js";
import { sfx } from "./sound.js";

// What changed in each release: js/whats-new.js (WHATS_NEW)
export const wnKey = (m) => `rafaya-news-seen-${m}`;
export const wnSeen = (m) => { try { return localStorage.getItem(wnKey(m)) === WHATS_NEW.v[m]; } catch { return true; } };
export const wnMark = (m) => { try { localStorage.setItem(wnKey(m), WHATS_NEW.v[m]); } catch { /* fine */ } };
export function whatsNewSheet() {
  wnMarkAll("world");
  showWhatsNewDot();
  const list = WHATS_NEW.items.filter(([m]) => m === "world" || m === "both");
  sheet(`<h2>وش الجديد في الرافعية؟</h2>
    <div class="rows">${list.map(([, icon, title, text]) => `<div class="row wn"><b class="wn-i">${icon}</b><span><b>${title}</b><small>${text}</small></span></div>`).join("")}</div>
    <div class="sheet-actions"><button class="btn go block" id="wnOk" type="button">يلا نلعب</button></div>`, "whatsnew");
  $("wnOk").addEventListener("click", closeSheet);
}
/** The "what's new" button on the screen: a red dot until the current mode's update has been read. */
export function showWhatsNewDot() {
  const dot = $("wnDot"); if (dot) dot.hidden = wnSeen(worldMode ? "world" : "solo"); // (the chip left the game screen; «وش الجديد» is on the main menu)
}
export function shareGameSheet() {
  // Invite players to the public home page, even if the current URL carries an account move or backup token.
  const url = "https://rafaya.vamosx.workers.dev/";
  const canShare = typeof navigator.share === "function";
  sheet(`<h2>شارك الرافعية</h2>
    <p>بيض الله وجهك على دعمك! اعزم ربعك يجرّبون الرافعية معك، وخلّ كل واحد يبني مدينته في عالم الجوف.</p>
    <label for="shareGameUrl">رابط اللعبة</label>
    <input class="share-url" id="shareGameUrl" type="text" dir="ltr" readonly value="${url}">
    <div class="sheet-actions">
      ${canShare ? '<button class="btn go block" id="shareGameSend" type="button">مشاركة اللعبة</button>' : ""}
      <button class="btn ${canShare ? "" : "go"} block" id="shareGameCopy" type="button">نسخ الرابط</button>
    </div>
    <p class="hint" id="shareGameStatus" role="status"></p>`, "share-game");
  const input = $("shareGameUrl"), status = $("shareGameStatus"), send = $("shareGameSend");
  if (!input) return;
  $("shareGameCopy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(url);
      status.textContent = "اننسخ الرابط. بيض الله وجهك على دعمك!";
    } catch {
      input.focus();
      input.select();
      status.textContent = "حددنا الرابط لك. انسخه من خيارات المتصفح.";
    }
  });
  send?.addEventListener("click", async () => {
    if (send.disabled) return;
    send.disabled = true;
    try {
      await navigator.share({ title: "الرافعية", text: "تعال جرّب الرافعية معي! ابدأ بخيمة وابنِ مدينتك في عالم الجوف.", url });
      status.textContent = "بيض الله وجهك على دعمك للرافعية!";
    } catch (error) {
      if (error.name !== "AbortError") status.textContent = "تقدر تنسخ الرابط وتشاركه.";
    } finally {
      send.disabled = false;
    }
  });
}
/**
 * The main menu shows your own al-Jouf town from the air, the camera drifting slowly over it, with a button to go
 * straight in. Without a town of your own, the menu keeps its usual scene.
 */
export const MENU = { town: null, t: 0, cx: 0, cz: 0, pitch: null };
export function menuBackdrop() {
  const id = me();
  let town = null;
  if (id?.plot != null) try {
    const saved = unpack(store.get(WORLD_SAVE));
    if (saved.world?.plot === id.plot) town = saved;
  } catch { /* the town can still be loaded from the server after tapping Play */ }
  MENU.town = town;
  const label = $("mPlayLabel"), hint = $("mPlayHint");
  label.textContent = town ? `▶️ كمّل في «${town.name}»` : label.dataset.start || "▶️ ابدأ اللعب";
  hint.textContent = town ? "ادخل مدينتك على طول" : hint.dataset.start || "";
  hint.hidden = !hint.textContent;
  if (!town) return;
  nameLandmarks(worldPlace(id.plot));
  world.newTown(); world.sync(town, { tiles: true, roads: true, buildings: true });
  let sx = 0, sy = 0, n = 0;
  town.tiles.forEach((t, i) => { if (t.b) { sx += i % N; sy += Math.floor(i / N); n++; } });
  const c = n ? [Math.round(sx / n), Math.round(sy / n)] : [N / 2, N / 2];
  MENU.cx = c[0] - N / 2 + 0.5; MENU.cz = c[1] - N / 2 + 0.5;
  MENU.pitch ??= world.view.pitch;
}
// What changed since this phone last looked, per mode: the titles already seen are kept, so only the new
// lines show (a phone that knew only the old date stamp gets the newest few).
export const wnTitlesKey = (m) => `rafaya-news-titles-${m}`;
export function wnTitles(m) { try { return new Set(JSON.parse(localStorage.getItem(wnTitlesKey(m)) || "null") || []); } catch { return new Set(); } }
export function wnUnseen(m) {
  const list = WHATS_NEW.items.filter(([x]) => x === m || x === "both"), seen = wnTitles(m);
  if (!seen.size) return wnSeen(m) ? [] : list.slice(0, 5);
  return list.filter(([, , title]) => !seen.has(title));
}
export function wnMarkAll(m) {
  try { localStorage.setItem(wnTitlesKey(m), JSON.stringify(WHATS_NEW.items.filter(([x]) => x === m || x === "both").map(([, , t]) => t).slice(0, 300))); } catch { /* fine */ }
  wnMark(m);
}
/** Only what is new since last time, for the mode being played; «كل التحديثات» for the whole list. */
export function newSinceSheet(mode) {
  const list = wnUnseen(mode);
  if (!list.length) return false;
  wnMarkAll(mode); showWhatsNewDot();
  sheet(`<h2>✨ الجديد من آخر مرة</h2><p>${mode === "world" ? "بعالم الجوف" : "باللعب الفردي"} تغيّر ${ar(list.length)} ${list.length === 1 ? "شي" : list.length <= 10 ? "أشياء" : "شي"}:</p>
    <div class="rows">${list.map(([, icon, title, text]) => `<div class="row wn"><b class="wn-i">${icon}</b><span><b>${title}</b><small>${text}</small></span></div>`).join("")}</div>
    <div class="sheet-actions two"><button class="btn" id="wnAll" type="button">كل التحديثات</button><button class="btn go" id="wnOk" type="button">تمام 👍</button></div>`, "whatsnew");
  $("wnOk").addEventListener("click", closeSheet);
  $("wnAll").addEventListener("click", whatsNewSheet);
  return true;
}
/** Show updates after entering al-Jouf, once the deputy's report is closed. */
export function maybeWhatsNew(tries = 0) {
  if (!worldMode) return;
  if (sheetFor && sheetFor !== "whatsnew") { if (tries < 30) setTimeout(() => maybeWhatsNew(tries + 1), 1500); return; }
  newSinceSheet("world");
}
export function spark(values, color) {
  if (values.length < 2) return "<p>الأرقام تبين بعد كم ساعة.</p>";
  const max = Math.max(...values), min = Math.min(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 300},${66 - ((v - min) / span) * 60}`).join(" ");
  return `<svg class="spark" viewBox="0 0 300 70" preserveAspectRatio="none"><polyline points="${pts} 300,70 0,70" fill="${color}22" stroke="none"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="3" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}
export const MONEY_MOVES = {
  hour: ["◷", "تشغيل المدينة"], away: ["◷", "تشغيل المدينة وقت غيابك"],
  build: ["🏘️", "بناء"], upgrade: ["⬆️", "تطوير"], materials: ["🏘️", "شراء مواد بناء"],
  land: ["🗺️", "شراء أرض"], fill: ["🛠️", "ردم الوادي"], rock: ["🛠️", "إزالة صخر"],
  move: ["🏘️", "نقل مبنى"], remove: ["🏘️", "مبلغ رجع من إزالة مبنى"],
  repair: ["🔧", "ترميم"], insurance: ["🛡️", "تعويض التأمين"], shield: ["🛡️", "درع الغياب سدّد الدين"],
  loan: ["🏦", "مبلغ القرض"], payoff: ["🏦", "سداد باقي القرض"], research: ["📋", "بحث"],
  decision: ["📋", "قرار البلدية"], investment: ["💼", "عائد استثمار"], goal: ["🎯", "مكافأة مهمة"],
  election: ["🗳️", "دعم الفوز بالانتخابات"], grant: ["🎉", "دعم من المحافظ"],
  fee: ["🏦", "رسوم المحافظة السنوية"], cleaning: ["🛣️", "تنظيف الطرق"],
  citizenSupport: ["💰", "دعم حساب المواطن"], gift: ["🎁", "هدية من إدارة الجوف"], refund: ["↩", "مبلغ رجّعته إدارة الجوف"],
  cityMilestone: ["🎉", "هدية وصول عالم الجوف إلى ٨٠ مدينة"],
  worldBill: ["📋", "عملية في عالم الجوف"], transfer: ["↔", "تحويل بين المدن"], advisor: ["💼", "المستشار المالي"],
  awayLimit: ["🔒", "خصم كسب الغياب الزايد"], idleLimit: ["🔒", "كسب فوق حدّ الخمول"],
  idleCover: ["🛡️", "تغطية مصروف من كسب الخمول"]
};
export const signedMoney = (value) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${fine(Math.abs(value))}`;
export const BUDGET_INCOME = {
  tax: "ضريبة الأهالي", shops: "المحلات", farms: "المزارع", industry: "الورش والمصانع", visitors: "الزوار والمشاريع"
};
export const BUDGET_EXPENSES = {
  staff: "رواتب البلدية", cleaning: "النظافة", waterNet: "شبكة الماء", roads: "الطرق والإنارة",
  services: "الخدمات", utilities: "تشغيل الماء والكهرباء", business: "تشغيل المحلات والمزارع والمصانع",
  military: "تشغيل وصيانة القيادة", sites: "مواقع الإنشاء", loan: "أقساط القروض",
  insurance: "التأمين", health: "علاج أمراض التلوث", theft: "سرقات المحلات"
};
export function moneyMoveRow(entry, open) {
  const { amount, day, detail, operating } = entry;
  const [icon, title] = Object.hasOwn(MONEY_MOVES, entry.kind) ? MONEY_MOVES[entry.kind] : ["📋", "حركة مالية"];
  const dayLabel = ar(dayOf(S.world?.start != null ? day - S.world.start + 3 : day));
  const note = operating
    ? `دخل ${fine(operating.income)} · صرف ${fine(operating.expenses)}${operating.limited ? ` · الخزنة حدّت الكسب بـ${fine(operating.limited)}` : ""}`
    : detail.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const hourKey = `hour-${day}`;
  const breakdown = (labels, values, sign) => Object.entries(labels)
    .filter(([key]) => Number.isFinite(values?.[key]) && values[key] > 0)
    .map(([key, label]) => row(label, `<bdi>${signedMoney(sign * values[key])}</bdi> ريال`, sign > 0 ? "plus" : "minus")).join("");
  const details = operating?.costs ? `<details class="money-hour-details" data-budget-details="${hourKey}" ${open.has(hourKey) ? "open" : ""}>
    <summary>تفاصيل هالساعة</summary><div class="rows">${breakdown(BUDGET_INCOME, operating.revenue, 1)}${breakdown(BUDGET_EXPENSES, operating.costs, -1)}</div>
  </details>` : "";
  return `<div class="money-move">
    <span class="money-symbol" aria-hidden="true">${icon}</span>
    <span class="money-move-info"><b>${title}</b>${note ? `<small>${ar(note)}</small>` : ""}<small>اليوم ${dayLabel}</small></span>
    <b class="${amount > 0 ? "plus" : amount < 0 ? "minus" : ""}"><bdi>${signedMoney(amount)}</bdi> ريال</b>
  </div>${details}`;
}
export function budget() {
  const h = S.history;
  const wasOpen = sheetFor === "budget";
  const open = new Set(wasOpen ? [...$("sheetBody").querySelectorAll("details[open]")].map((part) => part.dataset.budgetDetails) : []);
  const section = (id, title) => `<details class="budget-details" data-budget-details="${id}" ${open.has(id) ? "open" : ""}><summary>${title}</summary>`;
  const entries = (S.moneyLog || []).slice().reverse();
  const loans = S.loans || [];
  const income = A.income + A.farmIncome + A.tax, cap = moneyCap(S);
  const nextNet = Math.min(A.net, Math.max(0, cap - S.money));
  sheet(`<h2>الميزانية</h2>
    <div class="budget-balance"><span>الرصيد الحالي</span><strong><bdi>${money(S.money)}</bdi> <small>ريال</small></strong></div>
    <div class="rows budget-actions">
      <div class="row"><span><b>البنك</b><small>${loans.length ? `عليك ${ar(loans.length)} · الأقساط ${fine(loans.reduce((n, l) => n + l.per, 0))} ريال بالساعة` : "ما عليك قروض"}</small></span>
        <button class="btn" id="openBank" type="button">🏦 افتح البنك</button></div>
      <div class="row"><span><b>صيانة المباني</b><small>${A.repairBill ? `كلفة التصليح ${money(A.repairBill)} ريال` : "كل المباني سليمة"}</small></span>
        <button class="btn go" id="repairAll" type="button" ${A.repairBill ? "" : "disabled"}>🔧 صلّح الكل</button></div>
      <div class="row budget-tax">
        <div class="tax"><label for="taxIn"><b>الضريبة</b></label><input id="taxIn" type="range" min="0" max="25" step="1" value="${S.tax}"><b id="taxOut">${ar(S.tax)}٪</b></div>
        <small>رفع الضريبة يزيد الدخل ويقلّل الرضا.</small>
      </div>
    </div>
    <h3>تقدير الساعة الجاية</h3>
    <div class="budget-totals">
      <div><span>↓ يدخل</span><b class="plus"><bdi>${signedMoney(income)}</bdi></b></div>
      <div><span>↑ يطلع</span><b class="minus"><bdi>${signedMoney(-A.upkeep)}</bdi></b></div>
      <div><span>= الصافي</span><b class="${nextNet < 0 ? "minus" : "plus"}"><bdi>${signedMoney(nextNet)}</bdi></b></div>
    </div>
    ${nextNet < A.net ? '<p class="hint">سعة الخزنة تحدّ من المبلغ اللي يزيد على رصيدك.</p>' : ""}
    ${S.broke ? '<p class="need">البلدية مفلسة. بعض الخدمات مقفلة لين يرجع الرصيد فوق الصفر.</p>' : S.money < 0 ? '<p class="need">رصيد البلدية بالسالب. الخدمات تشتغل بنص طاقتها.</p>' : ""}
    <h3>🧾 آخر الحركات</h3>
    ${entries.length ? `<div class="rows">${entries.slice(0, 3).map((entry) => moneyMoveRow(entry, open)).join("")}</div>` : '<p class="hint">تظهر هنا أي مبالغ تدخل أو تنخصم من الآن.</p>'}
    ${entries.length > 3 ? `${section("history", "حركات أقدم")}<div class="rows">${entries.slice(3).map((entry) => moneyMoveRow(entry, open)).join("")}</div></details>` : ""}
    ${section("income", "↓ من وين يجي الدخل؟")}
      <p class="hint">الأرقام تقديرية وتتغيّر مع المبيعات والصلاة والزحمة.</p>
    <div class="rows">
      ${row("الضرائب على الأهالي", `+${fine(A.tax)}`, "plus")}
      ${row("مبيعات المحلات", `+${fine(A.shopIncome)}`, "plus")}
      ${A.shopRaw > A.shopDemand * 1.02 ? `<div class="need">السوق مشبع: الأهالي يصرفون ${fine(A.shopDemand)} بالساعة بس، والمحلات تقدر تبيع ${fine(A.shopRaw)}. محلات زيادة ما تجيب دخل، تحتاج ناس أكثر.</div>` : A.shopRaw > 0 ? `<div class="need ok">السوق فيه مجال: الأهالي يصرفون ${fine(A.shopDemand)} والمحلات تبيع ${fine(A.shopRaw)}.</div>` : ""}
      ${A.visitorIncome ? row("الزوار والمشاريع الكبرى", `+${fine(A.visitorIncome)}`, "plus") : ""}
      ${A.industryIncome ? row("الورش والمصانع", `+${fine(A.industryIncome)}`, "plus") : ""}
      ${A.industryRaw > A.exportDemand * 1.02 ? `<div class="need">التجار يشترون من الورش والمصانع بقيمة ${fine(A.exportDemand)} بالساعة بس. الإنتاج الزايد (${fine(A.industryRaw - A.exportDemand)}) ينباع بثلث السعر. يزيد الطلب كل ما كثر سكان البلد.</div>` : ""}
      ${row("المزارع", `+${fine(A.farmIncome)}`, "plus")}
      ${A.farmRaw > A.farmDemand * 1.02 ? `<div class="need">التجار يشترون من محاصيل المزارع بقيمة ${fine(A.farmDemand)} بالساعة بس. المحصول الزايد (${fine(A.farmRaw - A.farmDemand)}) ينباع بـ٤٠٪ من سعره. يزيد الطلب لما يزيد الناس أو توصّل مدن جارة بطريق.</div>` : ""}
    </div></details>
    ${section("expenses", "↑ وين يروح الصرف؟")}
    <div class="rows">
      ${row("رواتب موظفي البلدية", `−${fine(A.costs.staff)}`, "minus")}
      ${row("النظافة وجمع النفايات", `−${fine(A.costs.cleaning)}`, "minus")}
      ${row("صيانة شبكة الماء", `−${fine(A.costs.waterNet)}`, "minus")}
      ${row("صيانة الطرق والإنارة", `−${fine(A.costs.roads)}`, "minus")}
      ${A.costs.services ? row("رواتب الخدمات (مساجد، مدارس، مستوصفات…)", `−${fine(A.costs.services)}`, "minus") : ""}
      ${A.costs.utilities ? row("تشغيل الآبار والكهرباء", `−${fine(A.costs.utilities)}`, "minus") : ""}
      ${A.costs.business ? row("مصاريف المحلات والمزارع والمصانع", `−${fine(A.costs.business)}`, "minus") : ""}
      ${A.costs.military ? row("القوة العسكرية (تشغيل وصيانة)", `−${fine(A.costs.military)}`, "minus") : ""}
      ${A.costs.sites ? row("مواقع الإنشاء", `−${fine(A.costs.sites)}`, "minus") : ""}
      ${A.costs.loan ? row("أقساط القرض", `−${fine(A.costs.loan)}`, "minus") : ""}
      ${A.costs.insurance ? row("التأمين على المباني", `−${fine(A.costs.insurance)}`, "minus") : ""}
      ${A.costs.health ? row("علاج أمراض التلوث", `−${fine(A.costs.health)}`, "minus") : ""}
      ${A.costs.theft ? row("سرقات من المحلات (حارات بلا شرطة)", `−${fine(A.costs.theft)}`, "minus") : ""}
      ${row("المجموع بالساعة", `−${fine(A.upkeep)}`, "minus")}
      ${provinceFee(S) ? row(`رسوم المحافظة بعد ${ar(Math.ceil(hoursToElection(S) / 24))} يوم`, `تقريبًا −${money(provinceFee(S))} ريال`, "minus") : ""}
    </div></details>
    ${section("manage", "🏦 الخزنة وإدارة الميزانية")}
    ${S.world ? row("🔒 سعة الخزنة", `${money(Math.max(0, S.money))} من ${money(cap)} ريال`) : ""}
    ${S.staffRaise ? `<p>رواتب البلدية زادت ${ar(Math.round(S.staffRaise * 100))}٪ من العلاوات السنوية. وكل سنة تدفع رسوم المحافظة.</p>` : ""}
    <h3>🚦 المرور</h3><div class="rows">
      ${row("مشاوير الدوام وقت الذروة", `${ar(A.trips || 0)} سيارة`)}
      ${row("طرق مزحومة", ar(A.jammedRoads || 0), A.jammedRoads ? "minus" : "plus")}
      ${A.congestion > 0.02 ? `<div class="need">الزحمة تأخر الموظفين وتبعد الزباين: المحلات تخسر ${ar(Math.round(A.congestion * 100))}٪. سفلت الطرق المزحومة، أو حط شارع رئيسي ودوارات.</div>` : ""}
      <button class="btn block" id="showTraffic" type="button">🚦 اعرض الزحمة على الخريطة</button></div>
    ${productionHtml()}
    <h3>التأمين</h3>
    <p>يكلف ${fine(A.value * 0.0003)} بالساعة، ويعوضك ٧٠٪ من أي مبنى يروح بحريق أو سيل أو انهيار.</p>
    <div class="rows"><label class="row toggle"><span>${S.insured ? "المباني مؤمّنة ✓" : "المباني بدون تأمين"}</span><input type="checkbox" id="insureIn" ${S.insured ? "checked" : ""}></label></div>
    <h3>الناس</h3>
    <div class="rows">
      ${row("السكان / السعة", `${money(S.pop)} / ${money(A.cap)}`)}
      ${row("الوظائف", `${money(A.employed)} شغالين من ${money(A.workers)}`)}
      ${row("البطالة", `${ar(Math.round(A.unemployment * 100))}٪`, A.unemployment > 0.2 ? "minus" : "")}
      ${row("الماء", `${money(A.waterSupply)} / ${money(A.waterUse)}`, A.waterRatio < 1 ? "minus" : "plus")}
      ${A.grid ? row("الكهرباء", `${money(A.powerSupply)} / ${money(A.powerUse)}`, A.powerRatio < 1 ? "minus" : "plus") : ""}
      ${A.unconnected ? `<div class="need">${ar(A.unconnected)} بيوت ما عندها طريق، فما أحد يسكنها.</div>` : ""}
    </div>
    <h3>السكان</h3>${spark(h.map((x) => x.p), "#2c8a7a")}
    <h3>الميزانية</h3>${spark(h.map((x) => x.m), "#c48a24")}</details>`, "budget");
  if (sheetFor !== "budget") return;
  if (!wasOpen) $("sheetBody").closest(".sheet-box").scrollTop = 0;
  $("openBank").addEventListener("click", () => { sfx.tap(); bankSheet(); });
  $("showTraffic").addEventListener("click", () => {
    closeSheet();
    const v = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) if (A.trafficLoad?.[i] > 0) v[i] = Math.max(0.02, Math.min(1, (A.trafficLoad[i] / A.trafficCap[i]) / 2));
    setTimeout(() => world.setOverlay(v, "heat"), 220);
    toast("الأخضر سالك، والأصفر يتزحم، والأحمر زحمة", "");
    setTimeout(() => { if (!tool) world.setOverlay(null); }, 7000);
  });
  $("repairAll").addEventListener("click", () => {
    const { n, spent } = repairAll(S);
    if (!n) { toast("ما يكفي المال", "bad"); sfx.deny(); return; }
    sfx.build();
    toast(`رممت ${ar(n)} مبنى بـ${money(spent)} ريال`, "goal");
    refresh();
    sync(false);
    save();
    budget();
  });
  $("insureIn").addEventListener("change", (e) => { S.insured = e.target.checked; sfx.tap(); refresh(); save(); budget(); });
  $("taxIn").addEventListener("input", (e) => { S.tax = Number(e.target.value); $("taxOut").textContent = `${ar(S.tax)}٪`; refresh(); });
  $("taxIn").addEventListener("change", () => save());
}
