// Settings, saving and the main menu.
// Moved out of js/main.js as it was (nothing changed in it); main.js and the modules import each other's names.
import { ACHIEVEMENTS, B, ERAS, MAP_SIZE as N } from "./data.js";
import { $, S, ar, closeSheet, leaveVisit, leaveWorld, money, save, settingsSheet, sheet, sheetFor, showMenu, tool, visiting, world, worldMapSheet, worldMode } from "./main.js";
import { api, me } from "./ui-online.js";
import { idx, levelName } from "./sim.js";
import { reachHomes } from "./ui-tools.js";
import { showReach } from "./ui-arrange.js";
import { menuBackdrop, whatsNewSheet } from "./ui-whatsnew.js";
import { regionSheet } from "./ui-region.js";
import { deputySheet } from "./ui-account.js";
import { achievementsSheet } from "./ui-build.js";

/** The guide: how to play, how the town grows into a city, and how to upgrade. */
export function howTo(fromMenu) {
  const next = ERAS[S.era + 1];
  const pct = next ? Math.min(100, Math.round((S.pop / next.pop) * 100)) : 100;
  const opens = (e) => Object.values(B).filter((d) => d.era === e.id && d.cat !== "road" && d.cat !== "deco").map((d) => d.name).slice(0, 6).join("، ");
  const step = (n, text) => `<div class="row g-step"><b class="g-n">${ar(n)}</b><span>${text}</span></div>`;
  sheet(`<h2>شرح اللعبة</h2>
    <p>أنت عمدة الرافعية. تبدأ بثلاث خيام وبئر جنب الوادي، وهدفك تكبّرها من قرية إلى بلدة ثم مدينة ثم محافظة، وأهلها مبسوطين وميزانيتها سليمة.</p>
    <div class="g-now"><div class="row"><span>الرافعية الحين</span><b>${ERAS[S.era].name}</b></div>
      ${next ? `<div class="row"><span>عشان تصير «${next.name}»</span><b>${money(S.pop)} / ${money(next.pop)} ساكن</b></div><i class="prog"><i style="width:${pct}%"></i></i>` : `<div class="need ok">وصلت أعلى مرحلة 🎉</div>`}</div>

    <details open><summary>البداية خطوة بخطوة</summary><div class="rows">
      ${step(1, "انصب خيام جنب الطريق (من «سكن»). كل خيمة يسكنها ٣.")}
      ${step(2, "احفر بئر قريب منها: البئر يوصل الماء لين ٥ مربعات بس.")}
      ${step(3, "ازرع نخل في الوادي وافتح بقالة: وظائف ودخل.")}
      ${step(4, "طوّر الخيام إلى بيوت طين عشان يسكن ناس أكثر.")}
      ${step(5, "ابنِ مسجد ومدرسة لما يكثر الناس: يرفعون الرضا ويخلون البيوت تتطور.")}
      ${step(6, "تابع «المهمة» فوق: كل مهمة تعطيك مكافأة تغطي تكلفتها.")}
    </div></details>

    <details><summary>كيف تصير بلدة ومدينة؟</summary>
      <p>المرحلة تتحدد بعدد السكان. والسكان يجون إذا فيه بيوت فاضية والناس مبسوطين، ويطلعون إذا زعلوا.</p>
      <div class="rows">${ERAS.map((e) => `<div class="row ${e.id === S.era ? "now" : e.id < S.era ? "done" : ""}"><span><b>${e.name}</b><small>${e.pop ? `من ${money(e.pop)} ساكن` : "البداية"}${opens(e) ? ` · تفتح: ${opens(e)}` : ""}</small></span><b>${e.id < S.era ? "✓" : e.id === S.era ? "الحين" : ""}</b></div>`).join("")}</div>
      <p>عشان يزيد السكان: بيوت أكثر وأكبر، ماء وكهرباء واصلة، وظائف، وخدمات قريبة (مسجد، مدرسة، مستوصف، حديقة)، وضريبة معقولة.</p>
    </details>

    <details><summary>التطوير</summary>
      <p><b>البيوت:</b> اضغط على البيت أو اختر «سكن ← تطوير البيوت». كل مستوى يسكّن ناس أكثر:</p>
      <div class="rows">${B.house.levels.map((l, k) => `<div class="row"><span><b>${l.name}</b><small>${k ? `${money(l.cost)} ريال · يحتاج: ${[l.needs.road && "طريق", l.needs.water && "ماء واصل", l.needs.power && "كهرباء واصلة", l.needs.happy && `رضا ${ar(l.needs.happy)}٪`, l.needs.services && `${ar(l.needs.services)} خدمات قريبة`, l.era && `تكون ${ERAS[l.era].name}`].filter(Boolean).join("، ")}` : "تنصبها من «سكن»"}</small></span><b>${ar(l.cap)} ساكن</b></div>`).join("")}</div>
      <p><b>المحلات والمزارع والورش:</b> لها ٣ مستويات. اضغط عليها أو اختر «تطوير» من قسمها. المستوى الثاني يزيد الدخل ٦٠٪، والثالث يضاعفه، ويحتاج تكون بلدة مع كهرباء (للمحلات) أو ماء (للمزارع).</p>
      <p><b>الأبحاث:</b> من «المجلس» تبحث أشياء تفتح مباني وتزيد الإنتاج.</p>
    </details>

    <details><summary>الفلوس</summary><div class="rows">
      <div class="row"><span>الدخل</span><b>ضرائب، محلات، مزارع، ورش، زوار</b></div>
      <div class="row"><span>المصروف</span><b>رواتب، نظافة، صيانة، تشغيل المباني</b></div>
      <div class="row"><span>المحلات</span><b>تبيع على قد اللي يصرفه أهل البلد</b></div>
      <div class="row"><span>الورش والمصانع</span><b>تبيع لبرا، والزايد بثلث السعر</b></div>
      <div class="row"><span>البنك (من «تجارة»)</span><b>قروض تسددها بالساعة مع فايدة</b></div>
      <div class="row"><span>الضريبة (من «الأرقام»)</span><b>أعلى = دخل أكثر ورضا أقل</b></div>
      </div><div class="need">لو صارت الديون كبيرة تفلس البلدية وتقفل الخدمات. تابع «الأرقام» دايم.</div></details>

    <details><summary>الماء والكهرباء</summary>
      <p>كل بئر وخزان ومولد يوصل لمسافة محدودة. البيت اللي برا المسافة ما يجيه شي. اضغط مربع الماء والكهرباء فوق عشان تشوف وين واصل، ولما تمسك بئر أو مولد يبين لك وين بيوصل.</p></details>

    <details><summary>الخسائر والصيانة</summary>
      <p>المباني تخرب مع الوقت: رمّمها من «الأرقام» أو بالضغط عليها، وإلا تخرب وتطيح. السيل ينزل الوادي وقت المطر ويجرف اللي فيه. التأمين (من «الأرقام») يعوضك ٧٠٪. وكل سنة فيه رسوم للمحافظة وعلاوة للموظفين.</p></details>

    <details><summary>عالم الجوف (أونلاين)</summary>
      <p>من الشاشة الرئيسية «🌍 عالم الجوف»: تختار اسمك (واحفظ كود الاسترجاع)، وتختار أرض في خريطة الجوف وتأسس مدينتك: القريات وطبرجل وسكاكا ودومة الجندل والحماد والنفود الكبير، كل منطقة لها أرضها. وتضغط على أي مدينة بالخريطة وتدخلها وتشوفها وتعلق عليها.</p>
      <p>وقت العالم واحد للكل ويمشي دايم، فما فيه تسريع. وإذا طلعت يمسك مدينتك «نائب العمدة» حسب أوامرك (من القائمة)، ومعه «درع الغياب»: ما تفلس، وما تخسر أكثر من ٥٪ من ناسك باليوم، وبعد أسبوع غياب تنام مدينتك لين ترجع. وأول ما ترجع يعطيك تقريره.</p></details>

    <details><summary>المنطقة والمدن الثانية</summary>
      <p>لما تصير الرافعية بلدة تنفتح «خريطة المنطقة» (اضغط مربع الوقت فوق، أو من القائمة). تأسس فيها مدن المنطقة: «الرديفة» في روضة تخضر بالربيع، و«الأضارع» في أرض جبلية فيها حجر كثير، و«صفان» في النفود: رمل واسع بلا وادي.</p>
      <p>وصّل المدن بطرق: ناسها يتسوقون عند بعض وتجارها يشترون من ورش بعض. وتقدر تحوّل فلوس من مدينة لثانية. المدن اللي ما أنت فيها توقف لين ترجع لها. وإذا صار عندك ٣ مدن صرت «أمير المنطقة».</p></details>

    <details><summary>أهل الرافعية</summary>
      <p>كل بيت ساكنة فيه عوايل حقيقية: أسماءهم، ووين يشتغل الأب، وكم عيل عندهم، ووش يتمنون. اضغط على أي بيت وشوف «العوايل»، واضغط «تابع» تمشي معه وهو رايح دوامه. واللي يكتبون في النشرة ناس من الديرة، وتقدر تروح لبيت أي واحد منهم.</p></details>

    <details><summary>المرور والزحمة</summary>
      <p>الصبح والعصر الناس يطلعون من بيوتهم لدوامهم بسياراتهم. كل طريق يشيل عدد سيارات: الترابي قليل، والمسفلت ضعفه، و«الشارع الرئيسي» أكثر بكثير. التقاطعات تتزحم أكثر، و«الدوار» و«إشارة المرور» يفكونها، و«المواقف» جنب المحلات تخفف الطرق وتزيد البيع.</p>
      <p>الزحمة تأخر الموظفين، وتبعد الزباين، وتزعّل اللي ساكنين على الشارع. شوفها من «الأرقام ← اعرض الزحمة»، أو اضغط على أي طريق.</p></details>

    <details><summary>سلاسل الإنتاج ومواد البناء</summary>
      <p>المزارع ترسل إنتاجها بالشاحنات للمصانع، بس لازم طريق يوصل بينهم: النخل لمصنع التمور، الحظائر لمصنع الألبان وسوق الماشية، المزارع المحورية للصوامع، والكسارات لمصنع البلوك. المصنع يشتغل كامل إذا وصله العدد اللي يحتاجه.</p>
      <p>تطوير البيوت الكبيرة والمحلات يحتاج مواد بناء. «كسارة حجر» تنبني على الصخور وتطلّعها، وإذا ما عندك تنشرى من برا غالي. تابعها في «الأرقام».</p></details>

    <details><summary>السدود والماء الجوفي</summary>
      <p>تحت الرافعية ماء جوفي: الآبار والخزانات والمزارع المحورية تسحب منه، والمطر يرجّعه. إذا نزل كثير الآبار تعطي أقل. تابعه من مربع الماء فوق.</p>
      <p>«السد» (بعد بحث «سدود الأودية») ينبني على الوادي: يحجز السيل عن كل اللي بعده، ويجمع المطر في بحيرة وراه تفرّح الناس حولها وتغذي الماء الجوفي. و«ردم الوادي» يحوّل أرض الوادي لأرض عادية ما يجيها سيل.</p></details>

    <details><summary>الصلاة والحلال</summary>
      <p>خمس صلوات باليوم. وقت الصلاة يطلع لك تنبيه، والرجال يمشون للمسجد، والمحلات تسكر شوي ويقل بيعها. ابنِ مسجد قريب من البيوت.</p>
      <p>«حظيرة حلال» (من «زراعة وصناعة») تجيب دخل، وفي الربيع ترعى في الفيضة القريبة ويزيد دخلها النص. «سوق الماشية» يزيد دخله مع كل حظيرة، و«ميدان مزاين الإبل» مشروع كبير يجيب الزوار.</p></details>

    <details><summary>الحارات والانتخابات</summary>
      <p>من «المجلس ← حارات الرافعية» تشوف كل حارة: كم بيت فيها، ورضا أهلها، وش ناقصها، وتسميها بالاسم اللي تبيه.</p>
      <p>آخر كل سنة فيه انتخابات للمجلس البلدي. الأصوات تجي من رضا الناس وثقتهم والوعود اللي وفيت فيها. إذا فزت تجيك منحة من المحافظة، وإذا خسرت تتضاعف رسومها السنة الجاية. تابع التوقعات في «المجلس».</p></details>

    <details><summary>الناس والنشرة والقرارات</summary>
      <p>في «النشرة» الأهالي يتكلمون عن اللي ناقصهم واللي مبسوطين فيه، وترد عليهم بوعد أو تسكيت أو رفض. الوعد لازم توفي فيه. ومرة كل كم يوم يجيك قرار من المجلس تختار فيه.</p></details>

    <details><summary>الأدوات</summary><div class="rows">
      <div class="row"><span>اسحب بإصبع / بإصبعين</span><b>تتحرك / تكبّر وتصغّر</b></div>
      <div class="row"><span>زر «لفّ»</span><b>تدوّر المنظر</b></div>
      <div class="row"><span>اختر من تحت، اضغط مكانه، ثم ✓</span><b>تبني</b></div>
      <div class="row"><span>اسحب بالطريق ثم ✓</span><b>ترسمه مرة وحدة</b></div>
      <div class="row"><span>«✏️ تعديل»: اختر مبنى واسحبه</span><b>تنقله أو تبادله مع غيره ببلاش، و↻ تلفه</b></div>
      <div class="row"><span>«✏️ تعديل» ← 🗑️</span><b>تشيل المبنى أو الطريق أو الصخر (يرجع لك ثلث سعره)</b></div>
      <div class="row"><span>↶ و ↷، ثم ✓</span><b>ترجع وتعيد، وما ينحسب شي إلا بعد ✓</b></div>
      <div class="row"><span>اضغط على الأرض ورا السياج</span><b>تشتريها وتكبر فيها</b></div>
      <div class="row"><span>اضغط على أي مبنى</span><b>تشوف وش ينقصه</b></div>
      <div class="row"><span>القائمة ← الإنجازات</span><b>تشوف وش حققت</b></div>
    </div></details>`, fromMenu ? "settings-menu" : "how");
}
/** The player's own start (day, date, time) and time played. Only theirs: nobody else's is shown. */
export async function playersSheet() {
  sheet(`<h2>⏱️ وقتك في اللعبة</h2><p class="hint">نجيب وقتك…</p>`, "players");
  const id = me();
  let r;
  try { r = id ? await api("/world/me", { name: id.name, secret: id.secret }) : null; } catch { r = null; }
  if (sheetFor !== "players") return;
  if (!r || r.error) { sheet(`<h2>⏱️ وقتك في اللعبة</h2><div class="need">ما قدرنا نجيب وقتك، جرّب بعد شوي.</div>`, "players"); return; }
  const when = (t) => new Date(t).toLocaleString("ar-SA-u-ca-gregory", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });
  const time = (sec) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return h ? `${ar(h)} ساعة${m ? ` و${ar(m)} دقيقة` : ""}` : m ? `${ar(m)} دقيقة` : "أقل من دقيقة"; };
  const days = r.started ? Math.max(0, Math.floor((Date.now() - r.started) / 86400000)) : 0;
  sheet(`<h2>⏱️ وقتك في اللعبة</h2>
    <div class="rows">
      <div class="row"><span>👤 ${r.name}</span><b></b></div>
      <div class="row"><span>بدأت</span><b>${r.started ? when(r.started) : "—"}</b></div>
      <div class="row"><span>معنا من</span><b>${days ? `${ar(days)} ${days === 1 ? "يوم" : days === 2 ? "يومين" : "أيام"}` : "اليوم"}</b></div>
      <div class="row"><span>وقت لعبك</span><b>${time(r.played)}</b></div>
    </div>
    <p class="hint">وقت اللعب ينحسب واللعبة مفتوحة قدامك، من يوم ما نزلت هالخانة. وما أحد غيرك يشوفه.</p>`, "players");
}
/**
 * A building's reach on the map (the sheet out of the way): the camera on it, wide enough for all of it, its reach
 * tinted, and a tag that says who it serves, with its information a tap away. It stays until ✕ or another tap.
 */
export function reachView(x, y, r) {
  const b = S.tiles[idx(x, y)].b, d = b && B[b.id];
  if (!d) return;
  closeSheet();
  world.focus(x, y); world.view.zoom = Math.max(0.5, Math.min(1.6, 9 / (2 * r + 4))); world.updateCamera();
  setTimeout(() => showReach(x, y, { ...d, radius: d.radius ? r : 0, reach: d.radius ? 0 : r }), 200);
  const homes = reachHomes([{ x, y }], r);
  $("reachName").textContent = `مدى «${levelName(b)}»: ${r === 1 ? "مربع واحد" : r === 2 ? "مربعين" : `${ar(r)} ${r <= 10 ? "مربعات" : "مربع"}`}`;
  $("reachWhat").textContent = d.pollute ? (homes.homes ? `⚠️ يزعج ${ar(homes.homes)} بيت` : "ما حوله بيوت") : d.water > 0 ? "الأزرق يوصله الماء" : d.power > 0 || d.wire ? "البنفسجي توصله الكهرب" : homes.homes ? `يخدم ${ar(homes.homes)} بيت (${ar(homes.people)} ساكن)` : "ما حوله بيوت للحين";
  $("reachTag").hidden = false;
  reachView.at = { x, y };
}
export function reachClose() { if ($("reachTag").hidden) return; $("reachTag").hidden = true; reachView.at = null; if (!tool && !sheetFor) world.setOverlay(null); }
export function pauseMenu() {
  if (visiting) { // looking at someone else's town: a short menu, and the way home
    sheet(`<h2>القائمة</h2><p class="hint">أنت تتفرج على مدينة غيرك. ما تقدر تغيّر فيها شي.</p><div class="rows">
      <button class="row link" id="pmBack" type="button"><span>🏠 ارجع لمدينتك</span><b>←</b></button>
      <button class="row link" id="pmHow" type="button"><span>❓ الشرح</span><b>←</b></button>
      <button class="row link" id="pmResume" type="button"><span>كمّل التفرج</span><b>←</b></button></div>`, "pause");
    $("pmBack").addEventListener("click", () => leaveVisit());
    $("pmHow").addEventListener("click", () => howTo(false));
    $("pmResume").addEventListener("click", closeSheet);
    return;
  }
  sheet(`<h2>القائمة</h2><div class="rows">
    <button class="row link" id="pmResume" type="button"><span>كمّل اللعب</span><b>←</b></button>
    <button class="row link" id="pmHow" type="button"><span>❓ الشرح</span><b>←</b></button>
    <button class="row link" id="pmNew" type="button"><span>وش الجديد؟</span><b>←</b></button>
    ${worldMode ? `<button class="row link" id="pmWorld" type="button"><span>🌍 خريطة عالم الجوف</span><b>←</b></button>
    <button class="row link" id="pmDeputy" type="button"><span>🧑‍💼 أوامر نائب العمدة</span><b>←</b></button>` : `<button class="row link" id="pmRegion" type="button"><span>🗺️ خريطة المنطقة</span><b>←</b></button>`}
    ${worldMode ? `<button class="row link" id="pmPlayers" type="button"><span>⏱️ وقتك في اللعبة</span><b>←</b></button>` : ""}
    <button class="row link" id="pmAch" type="button"><span>الإنجازات</span><b>${ar(ACHIEVEMENTS.filter((x) => S.ach?.[x.id]).length)}/${ar(ACHIEVEMENTS.length)}</b></button>
    <button class="row link" id="pmSettings" type="button"><span>الإعدادات والنسخة الاحتياطية</span><b>←</b></button>
    <button class="row link" id="pmMain" type="button"><span>القائمة الرئيسية</span><b>←</b></button>
  </div>`, "pause");
  $("pmResume").addEventListener("click", closeSheet);
  $("pmHow").addEventListener("click", () => howTo(false));
  $("pmNew").addEventListener("click", () => whatsNewSheet());
  $("pmRegion")?.addEventListener("click", () => regionSheet());
  $("pmWorld")?.addEventListener("click", () => worldMapSheet());
  $("pmDeputy")?.addEventListener("click", () => deputySheet());
  $("pmAch").addEventListener("click", () => achievementsSheet());
  $("pmPlayers")?.addEventListener("click", () => playersSheet());
  $("pmSettings").addEventListener("click", () => settingsSheet(false));
  $("pmMain").addEventListener("click", () => { save(); leaveWorld(); closeSheet(); showMenu(); menuBackdrop(); });
}
/** Look at the middle of everything built so far. */
export function focusTown() {
  let sx = 0, sy = 0, n = 0;
  S.tiles.forEach((t, i) => { if (t.b) { sx += i % N; sy += Math.floor(i / N); n++; } });
  if (n) world.focus(Math.round(sx / n), Math.round(sy / n)); else world.focus(N / 2, N / 2);
}
