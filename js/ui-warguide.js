// «دليل الحرب»: the whole of «صراع الجوف» explained in plain words, in order, with small drawings: how to get
// ready, how to start (or avoid) a war, how to strike and defend, and every rule that keeps it fair. Every
// number is read from the rules themselves (js/war.js, js/data.js), so the guide never says something else.
import { ar, money, sheet } from "./main.js";
import { WAR_LIVE, WEAPONS, WEAPON_IDS, JOUF_DAY, minutesText, shieldPrice, SPOILS, MEDALS } from "./war.js";
import { B, ERAS, MIL, MIL_SLOTS } from "./data.js";
import { weaponIcon } from "./ui-war.js";
import { medalSvg } from "./icons.js";
import { sfx } from "./sound.js";

const days = (ms) => { const d = Math.round(ms / JOUF_DAY); return d === 1 ? "يوم" : d === 2 ? "يومين" : d === 7 ? "أسبوع" : d === 14 ? "أسبوعين" : d === 30 ? "شهر" : `${ar(d)} ${d <= 10 ? "أيام" : "يوم"}`; };
const real = (ms) => minutesText(ms);
const era = (i) => ERAS[i]?.name || "";

/** A small drawing for each part (inline SVG, gold on dark, so it reads in any light). */
const ART = {
  steps: `<svg viewBox="0 0 320 86" class="wg-art" aria-hidden="true">
    ${[["🏛️", "القيادة"], ["🚀", "السلاح"], ["⚔️", "الإعلان"], ["⏳", "الإنذار"], ["🎯", "الضربة"]].map(([i, t], k) => `<g transform="translate(${16 + k * 64},10)"><circle cx="16" cy="22" r="20" class="wg-dot"/><text x="16" y="29" class="wg-emo">${i}</text><text x="16" y="62" class="wg-lbl">${t}</text>${k < 4 ? `<path d="M40 22h20" class="wg-arrow"/>` : ""}</g>`).join("")}</svg>`,
  aim: `<svg viewBox="0 0 320 120" class="wg-art" aria-hidden="true"><rect x="0" y="0" width="320" height="120" rx="12" class="wg-ground"/>
    ${[[60, 60], [150, 40], [230, 78]].map(([x, y], k) => `<g><circle cx="${x}" cy="${y}" r="${k === 1 ? 30 : 22}" class="wg-blast"/><circle cx="${x}" cy="${y}" r="5" class="wg-core"/><text x="${x}" y="${y - (k === 1 ? 36 : 28)}" class="wg-num">${"١٢٣"[k]}</text></g>`).join("")}
    <rect x="200" y="22" width="22" height="30" class="wg-house"/><rect x="40" y="70" width="26" height="20" class="wg-house"/><path d="M120 92h24l-12-16z" class="wg-mosque"/><text x="132" y="110" class="wg-lbl">مسجد محمي</text></svg>`,
  shield: `<svg viewBox="0 0 320 90" class="wg-art" aria-hidden="true"><path d="M160 8l44 16v26c0 18-18 32-44 38-26-6-44-20-44-38V24z" class="wg-shield"/><path d="M142 48l12 12 24-24" class="wg-check"/>
    <path d="M40 70 Q80 10 112 40" class="wg-miss"/><circle cx="112" cy="40" r="6" class="wg-pop"/><path d="M280 70 Q240 10 208 40" class="wg-miss"/><circle cx="208" cy="40" r="6" class="wg-pop"/></svg>`,
  scale: `<svg viewBox="0 0 320 80" class="wg-art" aria-hidden="true"><path d="M160 10v60M110 70h100M60 30h200" class="wg-beam"/><path d="M60 30l-24 26h48zM260 30l-24 26h48z" class="wg-pan"/><circle cx="160" cy="10" r="6" class="wg-core"/></svg>`
};

function section(id, icon, title, body, art = "") {
  return `<section class="wg-sec" id="wg-${id}"><h3><i>${icon}</i>${title}</h3>${art}${body}</section>`;
}
const li = (items) => `<ul class="wg-list">${items.map((t) => `<li>${t}</li>`).join("")}</ul>`;

export function warGuide(go = "") {
  const T = WAR_LIVE.T;
  const toc = [["zero", "⏳", "ساعة الصفر"], ["ready", "🏗️", "التجهيز"], ["arms", "🚀", "الأسلحة"], ["before", "🤝", "قبل الحرب"], ["war", "⚔️", "الحرب"], ["defend", "🛡️", "الدفاع"], ["hits", "💥", "النتائج"], ["rewards", "🏆", "المكاسب"], ["fair", "⚖️", "العدل"], ["end", "🏳️", "النهاية"], ["watch", "👁️", "المتفرج"], ["tips", "🧠", "نصايح"]];
  const milRows = [
    ["milhq", "🏛️", "أساس كل شي: بدونه لا سلاح ولا حرب. كل ما ترقّى أدار عمليات أكثر بنفس الوقت."],
    ["dronebase", "🛩️", "تطلق المسيّرات."],
    ["missilepad", "🚀", "تطلق الصواريخ. المستوى الثالث «مجمع صواريخ» يطلق صاروخ النفود."],
    ["radar", "📡", "يرصد الهجوم قبل وصوله (تنطلق صفارات الإنذار)، ويرفع دقة دفاعك."],
    ["airdef", "🛡️", "يعترض المسيّرات والصواريخ بالصواريخ الاعتراضية."],
    ["fortdef", "🏰", "الدرع الوحيد ضد صاروخ الزلزال وصاروخ الإعصار: كل محاولة اعتراض تاخذ صاروخين اعتراضيين. بدونها، الأسلحة المدمّرة توصل."],
    ["armory", "📦", "مخزن الذخيرة."]
  ];
  sheet(`<div class="wg">
    <div class="wg-hero"><b>📖 دليل صراع الجوف</b><small>كل شي عن الحرب: كيف تتجهز، كيف تهاجم وتدافع، وكل القوانين. اقرأه مرة وتصير قائد.</small>${ART.steps}</div>
    <nav class="wg-toc">${toc.map(([id, i, t]) => `<button type="button" data-wg="${id}">${i} ${t}</button>`).join("")}</nav>

    ${section("zero", "⏳", "ساعة الصفر", `<p>الحرب تفتح <b>للكل بنفس اللحظة</b>. قبلها تشوف عداد ساعة الصفر: تبني وتجهّز وتشتري سلاحك، لكن ما فيه إعلان حرب ولا جزية ولا ضربات لين يخلص العداد. أول ما يوصل صفر يطلع البيان الرسمي وتبدأ الحرب.</p>`)}

    ${section("ready", "🏗️", "التجهيز: المباني الحربية", `<p>من «البناء ← الدفاع والعسكرية». القرية ما تدخل حروب: تبدأ من <b>${era(WAR_LIVE.minEra)}</b>.</p>
      <div class="wg-slots"><b>🎖️ كم مبنى عسكري تقدر تبني؟</b><div>${ERAS.slice(1).map((e) => `<span><small>${e.name}</small><b>${ar(MIL_SLOTS[e.id])}</b></span>`).join("")}</div><small>وأنت تختار وش تبني: منصات، قواعد مسيّرات، رادارات، بطاريات دفاع… أي خلطة تبيها. مركز القيادة والمستودع ما ينحسبون (واحد من كل واحد).</small></div>
      <div class="wg-table">${milRows.map(([id, i, t]) => `<div class="wg-row"><span class="wg-ic">${i}</span><span><b>${B[id].name}</b><small>${t}</small><small class="wg-num2">بناء ${money(B[id].cost)} · ترقية ${MIL[id][1] ? `${money(Math.round(B[id].cost * 1.5))} ثم ${money(B[id].cost * 3)}` : "ما فيه"} · ${B[id].slot ? "ينحسب من عددك" : "واحد"} · من ${era(MIL[id][0].era)}</small></span></div>`).join("")}</div>
      <p class="wg-note">المستوى الثاني لكل المباني يحتاج «${era(2)}»، والثالث يحتاج «${era(3)}». الحاضرة والحاضرة الكبرى ما عندها سلاح زيادة: القوة بالتخطيط مو بالحجم.</p>`)}

    ${section("arms", "🚀", "الأسلحة", `<div class="wg-table">${WEAPON_IDS.map((w) => { const W = WEAPONS[w], need = MIL[W.needs[0]][W.needs[1]]; return `<div class="wg-row"><span class="wg-ic wg-w">${weaponIcon(w)}</span><span><b>${W.name}</b><small>${W.text}</small><small class="wg-num2">السعر ${money(W.price)} · تشغيل كل ضربة ${money(W.fee)} · القوة ${ar(W.power)} · من ${era(need.era)}</small></span></div>`; }).join("")}
      <div class="wg-row"><span class="wg-ic wg-w">${weaponIcon("intc")}</span><span><b>${WAR_LIVE.interceptor.name}</b><small>ذخيرة الدفاع الجوي: كل واحد يحاول يسقط ضربة جاية.</small><small class="wg-num2">السعر ${money(WAR_LIVE.interceptor.price)} · المخزون حسب بطارياتك</small></span></div></div>
      <p class="wg-note">المسيّرات والصواريخ تخزّن منها اللي تبي. المنصة والقاعدة تحدد كم ينطلق بكل مرة.</p>
      <div class="wg-row"><span class="wg-ic">🧱</span><span><b>الأسلحة المدمّرة والركام</b><small>صاروخ الزلزال وصاروخ الإعصار يسوّون كل مبنى بمداهم بالأرض (إلا المساجد). المبنى يصير <b>ركام</b>: ما يشتغل ولا يتصلح. صاحبه لازم يضغطه ويختار «🧹 شيل الركام» (يدفع ويستنى ${real(WAR_LIVE.rubble.ms)})، وبعدها الأرض تفضى ويبني فوقها من جديد. الدفاع الجوي العادي ما يقدر عليها: بس «منظومة الحصن».</small></span></div>`)}

    ${section("before", "🤝", "قبل الحرب: الجزية والمحادثة والإعلان", `<p>من «القيادة ← 🗺️ الجوف والتفاوض» اضغط أي مدينة:</p>
      ${li([
        `<b>🪙 الجزية:</b> تطلب مبلغ لين <b>${ar(WAR_LIVE.tribute.share * 100)}٪</b> من ميزانيتهم. عندهم ${days(T.tributeAnswer)} بالجوف (${real(T.tributeAnswer)}) يردون. إذا دفعوا: يوصلك المبلغ وسلام بينكم ${days(T.tributePeace)} (${real(T.tributePeace)}). إذا رفضوا أو ما ردوا: الحرب تنعلن لحالها. كل طرف حر.`,
        `<b>💬 المحادثة:</b> تهديد أو شروط بكلامك، وهم يردون بنفس المحادثة. أي واحد ينهي المحادثة تبدأ الحرب.`,
        `<b>⚔️ إعلان الحرب:</b> مباشرة، بضغطة.`
      ])}`)}

    ${section("war", "⚔️", "الحرب: كيف تهاجم", `${li([
        `بعد الإعلان فيه <b>إنذار ${real(T.warning)}</b>: ما فيه ضربات، كل واحد يجهّز دفاعه.`,
        `الحرب تدوم <b>${days(T.war)} بالجوف</b> (${real(T.war)}).`,
        `<b>الهجوم بخطوتين:</b> ١) اختر السلاح ٢) اضغط على مدينتهم مكان الضربة. لين ٦ أماكن بالدفعة، ولكل مكان سلاحه وعدده.`,
        `الضربة تنزل على المكان <b>واللي حوله</b> حسب مدى السلاح: الحلقة الحمراء توريك وش بيتضرر.`,
        `<b>التجهيز يطول:</b> كل إطلاق من نفس المنصة خلال ساعة يزيد وقت تجهيزها النص (٤ دقايق ثم ٦ ثم ٨…). وزّع ضرباتك.`
      ])}`, ART.aim)}

    ${section("defend", "🛡️", "الدفاع", `${li([
        `<b>الرادار</b> يرصد الهجوم: يجيك إنذار وعداد، وتنطلق صفارات الإنذار فتقل الوفيات.`,
        `<b>الدفاع الجوي</b> يعترض بالصواريخ الاعتراضية. بطاريات أكثر ومستوى أعلى = اعتراض أكثر. خلّ الذخيرة دايم مليانة.`,
        `<b>النائب</b> يعبّي الاعتراضية ويصلّح الأضرار لحاله من ميزانية تحددها.`,
        `<b>🛡️ درع الحماية:</b> ما ينضرب فيك شي ${real(T.shieldLast)} (٣ أيام)، حتى لو كنت بنص حرب. إذا خلص، ما ترفعه مرة ثانية إلا بعد ٤ أيام. سعره حسب مدينتك: من ${money(shieldPrice(1))} للبلدة إلى ${money(shieldPrice(5))} للحاضرة الكبرى. <b>إذا هاجمت وأنت عليه ينكسر.</b>`
      ])}`, ART.shield)}

    ${section("hits", "💥", "النتائج", `${li([
        `كل مبنى ياخذ نسبة ضرر. لين ٨٥٪ يتعطل، والمبنى ما ينهدم نهائي: يتصلح.`,
        `<b>الوفيات والإصابات</b> تنحسب من الناس اللي بالمبنى ونسبة الضرر، وتقل إذا انطلقت صفارات الإنذار. <b>تنقص من سكان مدينتك</b> ويحزن أهلها فينزل الرضا فترة.`,
        `أهل البيوت المتضررة <b>ينزحون</b> لين تتصلح.`,
        `<b>الإصلاح</b> من «القيادة ← السجل»: صلّح جنب كل مبنى.`,
        `كل ضربة تطلع بالتقرير والنشرة.`
      ])}`)}

    ${section("rewards", "🏆", "وش تكسب من الحرب؟", `${li([
        `<b>💰 غنيمة الحرب:</b> كل ضربة ناجحة على مبنى اقتصادي (مصنع، سوق، محطة كهرباء أو ماء…) تعطيك ${ar(Math.round(SPOILS * 100))}٪ من كلفة إصلاحه، تنزل بميزانيتك على طول.`,
        `<b>🏆 النصر الرسمي:</b> لا خلصت الحرب (بوقتها أو بهدنة أو صلح)، اللي ضرباته وصلت أكثر ينتصر: يطلع بالنشرة، ورضا أهل مدينته يرتفع ١٠ من الفخر.`,
        `<b>🎖️ الأوسمة:</b> تطلع جنب اسمك بالشات والخريطة، وكل وسام لصاحب أعلى رقم بالجوف.<span class="wg-medals">${MEDALS.map((m) => `<span>${medalSvg(m.id, 64)}<b>${m.name}</b><small>${m.text}</small></span>`).join("")}</span>`,
        `<b>🪙 الجزية:</b> فلوس بدون حرب إذا دفعوا.`
      ])}`)}

    ${section("fair", "⚖️", "قوانين العدل", `${li([
        `<b>المتقاربين بس:</b> إذا الفرق بينكم مستويين أو أكثر، ولا واحد يبدأ على الثاني (الحاضرة الكبرى تنحسب حاضرة).`,
        `<b>${ar(WAR_LIVE.maxWars)} حروب بالكثير</b> للمدينة بنفس الوقت.`,
        `<b>المساجد محمية</b> من الضربات ومن مداها.`,
        `<b>القرى محمية</b>، و<b>اللاعب الجديد</b> محمي ${real(WAR_LIVE.newPlayer)}، و<b>المدينة النايمة</b> (صاحبها غايب أسبوع) محمية.`,
        `<b>حماية الغايب:</b> إذا صاحب المدينة ما فتح اللعبة ${real(WAR_LIVE.away)}، ما ياخذ أكثر من ${ar(WAR_LIVE.caps.awayMax)} ضربات كل ${real(WAR_LIVE.caps.awayWindow)}. وإذا هاجم أحد تنكسر حمايته.`,
        `نفس المكان ما ينضرب أكثر من ${ar(WAR_LIVE.caps.rehitMax)} مرات كل ${real(WAR_LIVE.caps.rehitWindow)}.`,
        `<b>زحمة الجو:</b> ما يكون بالجو أكثر من ${ar(WAR_LIVE.caps.inFlightTo)} هجمات رايحة لنفس المدينة بنفس اللحظة (من كل أعدائها مع بعض). الدفعة الوحدة تنحسب هجمة وحدة، ولا وصلت وحدة ينفتح مكان للي بعدها. عشان ما يتجمع الكل على مدينة وحدة بلحظة.`,
        `كل شي يقرره <b>السيرفر</b>، مو جوال اللاعب: ما فيه غش.`
      ])}`, ART.scale)}

    ${section("end", "🏳️", "نهاية الحرب", `${li([
        `<b>الهدنة</b> متى ما بغيتوا إذا الطرفين وافقوا: توقف الضربات وتنهي الحرب.`,
        `<b>الصلح</b> ينهي العداوة كلها.`,
        `بعد أي حرب أو صلح: <b>${days(T.warCool)} بالجوف</b> (${real(T.warCool)}) قبل حرب جديدة بينكم.`
      ])}`)}

    ${section("watch", "👁️", "للي مو داخل حرب", `${li([
        `بخريطة الجوف: خط أحمر بين كل مدينتين بينهم حرب.`,
        `اضغط مدينة بحرب ← <b>«👁️ تابع حربها»</b>: تشوف كل ضربة تنزل عليها لحظتها.`,
        `النشرة تعلن الحروب والجزية والضربات والوفيات.`
      ])}`)}

    ${section("tips", "🧠", "نصايح القائد", `${li([
        `اضرب <b>الرادار</b> أول: دفاعهم يصير أعمى ويعترض أقل.`,
        `اضرب <b>بطاريات الدفاع الجوي</b>: صواريخك توصل أكثر.`,
        `اضرب <b>مركز القيادة</b>: عملياتهم تقل.`,
        `اضرب <b>المنصات والقواعد</b>: يوقف هجومهم.`,
        `حط الضربة بين كذا مبنى: المدى يضرهم كلهم.`,
        `لا تطلق كل شي مرة وحدة: المنصة تتأخر. التوقيت والأهداف تفوز، مو الكثرة.`
      ])}`)}
  </div>`, "war-guide");
  const body = document.getElementById("sheetBody");
  body.querySelectorAll("[data-wg]").forEach((b) => b.addEventListener("click", () => { sfx.tap(); body.querySelector(`#wg-${b.dataset.wg}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }));
  if (go) setTimeout(() => body.querySelector(`#wg-${go}`)?.scrollIntoView({ block: "start" }), 50);
}
