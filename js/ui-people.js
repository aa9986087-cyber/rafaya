// The people of the house, and the advisor's sheet.
// Moved out of js/main.js as it was (nothing changed in it); main.js and the modules import each other's names.
import { $, A, S, ar, arrange, closeSheet, fine, inspect, money, refresh, save, sheet, tool, visiting, world } from "./main.js";
import { familiesAt, familyDay, jobOf, wishOf } from "./people.js";
import { changeMoney, districtName, districtOf, doorOf, greaterCityProgress, idx, roadPath, upgradeEffect } from "./sim.js";
import { sfx } from "./sound.js";
import { row, toast } from "./ui-build.js";
import { B, CHAINS, GOALS, GREATER_CITY_PROJECTS, GREATER_CITY_STAGE, GROUND, MAP_SIZE as N, MAT, ROAD_IDS, bizLevel } from "./data.js";
import { ADVISOR_FEE, ADVISOR_HOURS, advise } from "./advisor.js";
import { reloadText } from "./war.js";

export const kidsWord = (n) => (n === 1 ? "عيل واحد" : n === 2 ? "عيالين" : `${ar(n)} عيال`);
export function familySheet(i, k) {
  const f = familiesAt(S, i)[k];
  if (!f) return;
  const kids = f.kids.map((c) => `${c.name} (${ar(c.age)})`).join("، ");
  sheet(`<h2>${f.surname}</h2><p>${f.kunya} و${f.mother}${kids ? `، وعيالهم: ${kids}` : ""}. ساكنين ${districtName(S, districtOf(i))}.</p>
    <h3>يومهم</h3><div class="rows">${familyDay(S, A, i, f).map((l) => `<div class="row"><span>${l}</span></div>`).join("")}</div>
    ${wishOf(S, A, i) ? `<div class="need">يتمنون: ${wishOf(S, A, i)}</div>` : `<div class="need ok">مرتاحين في بيتهم.</div>`}
    ${jobOf(S, A, i) ? `<div class="sheet-actions"><button class="btn go block" id="famFollow" type="button">👁️ تابع ${f.kunya} وهو رايح دوامه</button></div>` : ""}`, "family");
  $("famFollow")?.addEventListener("click", () => followFamily(i, k));
}
/** The camera walks with the father from his house to his work. */
export function followFamily(i, k) {
  const f = familiesAt(S, i)[k], job = jobOf(S, A, i);
  if (!f || !job) { toast("ما عنده دوام يوصله بطريق", "bad"); return; }
  const path = roadPath(S, doorOf(S, i), doorOf(S, job.tile));
  if (!path) { toast("ما فيه طريق يوصل بيته بدوامه", "bad"); return; }
  closeSheet();
  world.view.zoom = Math.max(world.view.zoom, 1.5);
  world.followPerson(path, { name: `${f.kunya} ${f.surname}`, to: job.name });
  $("followName").textContent = `${f.kunya} ${f.surname}`;
  $("followWhat").textContent = `رايح لدوامه في ${job.name}`;
  $("followTag").hidden = false;
  sfx.tap();
}
/** What an upgrade changes: income and costs an hour, jobs, cheer, reach, homes (before → after). */
export function effectHtml(b) {
  const e = upgradeEffect(S, b);
  if (!e) return "";
  const ch = (label, a, z, good = true, unit = "") => {
    const d = z - a; if (!d) return "";
    const up = d > 0, cls = up === good ? "plus" : "minus";
    return `<div class="row eff"><span>${label}</span><b class="${cls}">${fine(a)} ← ${fine(z)}${unit} <small>(${up ? "+" : "−"}${fine(Math.abs(d))})</small></b></div>`;
  };
  if (e.vault) return `<div class="effect"><b>بعد التطوير:</b><div class="rows">${ch("تشيل", e.capNow, e.capNext, true, " ريال")}${ch("المصروف بالساعة", e.upkeepNow, e.upkeepNext, false)}</div></div>`;
  if (e.utility) {
    const label = ROAD_IDS.includes(b.id) ? "سعة الطريق" : B[b.id].water > 0 ? "إنتاج الماء" : "إنتاج الكهرباء";
    return `<div class="effect"><b>بعد التطوير:</b><div class="rows">${ch(label, e.output, e.outputNext)}${ch("المصروف بالساعة", e.upkeepNow, e.upkeepNext, false)}</div></div>`;
  }
  if (e.mil) {
    const n = e.next, stat = n.ops ? `عمليات بالجو: ${ar(n.ops)}` : n.salvo ? `سعة ${ar(n.cap)} · ${ar(n.salvo)} بالعملية · تجهيز ${reloadText(n.reload)}` : n.cap ? `صواريخ ${ar(n.cap)} · تجهيز ${reloadText(n.reload)}` : n.detect ? `دقة الدفاع ×${ar(n.detect)}` : n.vsDrone ? `ضد المسيّرات ${ar(Math.round(n.vsDrone * 100))}٪ · ضد الصواريخ ${ar(Math.round(n.vsMissile * 100))}٪ · ${ar(n.intc)} اعتراضية` : "";
    return `<div class="effect"><b>بعد التطوير:</b><div class="rows">${ch("المصروف بالساعة", e.upkeepNow, e.upkeepNext, false)}<div class="row eff"><span>القدرة العسكرية</span><b class="plus">${stat}</b></div></div></div>`;
  }
  const rows = e.house
    ? ch("يسكنه", e.capNow, e.capNext, true, " ساكن") + (e.taxGain ? `<div class="row eff"><span>ضريبة زيادة تقريبًا</span><b class="plus">+${fine(e.taxGain)} بالساعة</b></div>` : "")
    : ch("الدخل بالساعة", e.incomeNow, e.incomeNext) + ch("المصروف بالساعة", e.upkeepNow, e.upkeepNext, false) + ch("الوظائف", e.jobsNow, e.jobsNext) + ch("يفرّح اللي حوله", e.happyNow, e.happyNext) + ch("يوصل تأثيره", e.radiusNow, e.radiusNext, true, " مربع");
  const net = e.house ? null : (e.incomeNext - e.upkeepNext) - (e.incomeNow - e.upkeepNow);
  return `<div class="effect"><b>بعد التطوير:</b><div class="rows">${rows}${net != null && (e.incomeNow || e.incomeNext) ? `<div class="row eff"><span>الصافي بالساعة</span><b class="${net >= 0 ? "plus" : "minus"}">${net >= 0 ? "+" : "−"}${fine(Math.abs(net))}</b></div>` : ""}</div><p class="hint">${e.house ? "تقريبي: إذا امتلى البيت، على نسبة الضريبة الحين." : "تقريبي: يعتمد على الموظفين والكهرباء والزباين."}</p></div>`;
}
/** The materials part of an upgrade: from the store, or bought from outside. */
export function matsNote(pr) {
  if (!pr.mats) return "";
  return `<p class="hint">🧱 يحتاج ${ar(pr.mats)} مواد بناء${pr.short ? `: عندك ${ar(Math.floor(S.materials || 0))}، والباقي (${ar(pr.short)}) ينشرى من برا بـ${money(pr.short * MAT.price)} ريال (داخل في السعر). كسارة حجر توفر عليك.` : " من مخزونك."}</p>`;
}
/** A factory: how many farms feed it by road. A farm: which factory it sends to. */
export function chainInfo(t, x, y) {
  const i = idx(x, y);
  const asFactory = A.chainAt?.get(i);
  if (asFactory) {
    const c = asFactory.chain;
    return `${row(`يجيه من ${B[c.from].name}`, `${ar(asFactory.got)} من ${ar(asFactory.need ?? c.need)}`, asFactory.fill >= 1 ? "plus" : "minus")}<i class="prog"><i style="width:${Math.round(asFactory.fill * 100)}%"></i></i>
      ${asFactory.fill < 1 ? `<p class="hint">🚚 يشتغل بـ${ar(Math.round((0.3 + 1.7 * asFactory.fill) / 2 * 100))}٪. يحتاج ${ar((asFactory.need ?? c.need) - asFactory.got)} ${B[c.from].name} زيادة موصولة به بطريق (المزرعة لازم يكون جنبها طريق يوصل للمصنع).</p>` : `<p class="hint">🚚 الشاحنات توصله كل اللي يحتاجه.</p>`}`;
  }
  const chains = CHAINS.filter((c) => c.from === t.b.id);
  if (!chains.length) return "";
  const link = A.chainLinks?.find((l) => l.from === i);
  if (link) return row("يرسل إنتاجه إلى", `${B[S.tiles[link.to].b.id].name} 🚚`, "plus");
  return `<div class="need">ما فيه ${chains.map((c) => B[c.to].name).join(" ولا ")} موصول بطريق. ${chains.map((c) => B[c.to].name).join(" أو ")} يضاعف قيمة إنتاجه.</div>`;
}
/** Production: each chain, and the building materials. */
export function productionHtml() {
  const rows = CHAINS.map((c) => {
    const factories = [...(A.chainAt || new Map()).values()].filter((f) => f.chain.id === c.id);
    const producers = A.count[c.from] || 0;
    if (!factories.length && !producers) return "";
    const linked = factories.reduce((n, f) => n + f.got, 0), want = factories.length * c.need;
    return row(`${c.name}: ${B[c.from].name} ← ${B[c.to].name}`, factories.length ? `${ar(linked)}/${ar(want)} موصولة` : `${ar(producers)} بلا مصنع`, factories.length && linked >= want ? "plus" : "minus");
  }).join("");
  return `<h3>🏭 الإنتاج ومواد البناء</h3><div class="rows">
    ${row("مواد البناء بالمخزن", `${ar(Math.floor(S.materials || 0))} / ${ar(MAT.cap)}`)}
    ${row("تنتج بالساعة", `${ar(Math.round((A.matMade || 0) * 10) / 10)}`, A.matMade ? "plus" : "")}
    ${!A.matMade ? `<p class="hint">ما عندك كسارة: أي مواد تحتاجها للتطوير تنشرى من برا بـ${ar(MAT.price)} ريال للوحدة. الكسارة تنبني على الصخور.</p>` : (S.materials || 0) >= MAT.cap ? `<p class="hint">المخزن مليان: الزايد ينباع بـ${ar(MAT.sell)} للوحدة.</p>` : ""}
    ${rows || `<p class="hint">المزارع ترسل إنتاجها بالشاحنات للمصانع الموصولة فيها بطريق: النخل لمصنع التمور، الحظائر لمصنع الألبان وسوق الماشية، المحورية للصوامع، والكسارة لمصنع البلوك.</p>`}
  </div>`;
}
/** The next level's numbers for a farm, shop or workshop. */
export const bizLevelNext = (b) => bizLevel({ id: b.id, lvl: b.lvl + 1 });
/** Water and power: how much there is, who it does not reach, and a map of where it goes. */
export function utilSheet() {
  sheet(`<h2>الماء والكهرباء</h2><p>كل بئر وخزان ومولد يوصل لمسافة محدودة. البيت اللي برا المسافة ما يجيه شي، حتى لو الكمية تكفي.</p>
    <h3>الماء</h3><div class="rows">
      ${row("المتوفر / المطلوب", `${money(A.waterSupply)} / ${money(A.waterUse)}`, A.waterRatio < 1 ? "minus" : "plus")}
      ${A.dryHomes ? `<div class="need">${ar(A.dryHomes)} بيت ما يوصلها ماء: ابنِ بئر قريب منها.</div>` : `<div class="need ok">الماء واصل لكل البيوت.</div>`}
      ${row("الماء الجوفي", `${ar(Math.round(A.aquifer))}٪`, A.aquifer < GROUND.low ? "minus" : "plus")}<i class="prog"><i style="width:${Math.round(A.aquifer)}%" class="${A.aquifer < GROUND.low ? "low" : ""}"></i></i>
      <p class="hint">الآبار والخزانات تسحب من الماء الجوفي، والمطر والسدود ترجّعه. إذا نزل تحت ${ar(GROUND.low)}٪ الآبار تعطي أقل${A.aquifer < GROUND.low ? ` (الحين ${ar(Math.round(A.groundFactor * 100))}٪ من ماها)` : ""}. التحلية ما تحتاجه.</p>
      ${A.count.dam ? row("بحيرة السد", `${ar(Math.round(S.lake || 0))}٪`, (S.lake || 0) > 10 ? "plus" : "") : ""}
      <button class="btn block" id="showWater" type="button">💧 اعرض وين يوصل الماء</button>
    </div>
    <h3>الكهرباء</h3><div class="rows">
      ${A.grid ? row("المتوفر / المطلوب", `${money(A.powerSupply)} / ${money(A.powerUse)}`, A.powerRatio < 1 ? "minus" : "plus") : `<div class="need">ما فيه كهرباء بالبلد. المولد ينفتح لما تصير بلدة، والفلل تحتاجها.</div>`}
      ${A.grid && A.darkHomes ? `<div class="need">${ar(A.darkHomes)} فيلا وعمارة ما توصلها الكهرباء.</div>` : ""}
      ${A.grid ? `<button class="btn block" id="showPower" type="button">⚡ اعرض وين توصل الكهرباء</button>` : ""}
    </div>`, "util");
  const show = (arr, color) => { const v = new Float32Array(N * N); arr.forEach((x, i) => { v[i] = x; }); closeSheet(); setTimeout(() => world.setOverlay(v, color), 200); setTimeout(() => { if (!tool) world.setOverlay(null); }, 6000); };
  $("showWater").addEventListener("click", () => show(A.watered, "#3b8fd6"));
  $("showPower")?.addEventListener("click", () => show(A.powered, "#9b5cf6"));
}
export const advisorFee = () => (S.advisor?.used ? ADVISOR_FEE[Math.min(ADVISOR_FEE.length - 1, S.era)] : 0);
export function advisorSheet() {
  if (arrange || visiting) { toast("افتح المستشار من مدينتك بعد ما تخلّص الترتيب", "bad"); return; }
  const age = S.day - S.advisor?.at;
  const fresh = age >= 0 && age < ADVISOR_HOURS;
  if (!fresh) {
    const fee = advisorFee(), poor = fee > 0 && fee > S.money;
    sheet(`<h2>💼 المستشار المالي</h2>
      <p>يقرأ مدينتك كلها: الفلوس، وكل حارة، والماء والكهرب، والوظايف، والزحمة، والمباني الواقفة. ويقول لك إذا كنت رابح أو خسران، ووش أكبر أخطاءك، وكيف تصلحها خطوة خطوة.</p>
      <p class="hint">الاستشارة صالحة ${ar(ADVISOR_HOURS)} ساعة باللعبة. سعرها حسب مرحلة مدينتك.</p>
      <div class="sheet-actions"><button class="btn go block" id="advPay" type="button" ${poor ? "disabled" : ""}>${fee ? `استشره بـ${money(fee)} ريال` : "استشره مجاناً (أول مرة)"}${poor ? " · ما يكفي المال" : ""}</button></div>`, "advisor");
    $("advPay").addEventListener("click", () => {
      const f = advisorFee();
      if (f > 0 && f > S.money) { toast("ما يكفي المال", "bad"); sfx.deny(); return; }
      if (f) changeMoney(S, -f, "advisor", "المستشار المالي");
      S.advisor = { at: S.day, used: true };
      sfx.coin(); refresh(); save(); advisorSheet();
    });
    return;
  }
  const r = advise(S, A), left = ADVISOR_HOURS - age;
  const mood = r.verdict === "مديون" || r.verdict === "خسران" ? "minus" : "plus";
  sheet(`<h2>💼 المستشار المالي</h2>
    <div class="rows">
      <div class="row"><span>وضعك</span><b class="${mood}">${r.verdict}</b></div>
      <div class="row"><span>الصافي بالساعة</span><b class="${r.net >= 0 ? "plus" : "minus"}">${r.net >= 0 ? "+" : "−"}${money(Math.abs(r.net))}</b></div>
    </div>
    ${r.good.length ? `<div class="need ok">👍 ${r.good.join(" ")}</div>` : ""}
    <h3>${r.findings.length ? "اللي يحتاج تصليح، الأهم أول" : "ما لقيت مشاكل تذكر 👏"}</h3>
    ${r.findings.slice(0, 7).map((f, k) => `<div class="adv-item">
      <b>${f.icon} ${ar(k + 1)}. ${f.title}</b>
      <p>${f.why}</p>
      <ol>${f.steps.map((st) => `<li>${st}</li>`).join("")}</ol>
      ${f.at >= 0 ? `<button class="btn small" type="button" data-advgo="${f.at}">📍 وريني</button>` : ""}
    </div>`).join("")}
    <p class="hint">الاستشارة صالحة ${ar(left)} ساعة باقية، والأرقام تتحدث كل ما فتحتها.</p>`, "advisor");
  $("sheetBody").querySelectorAll("[data-advgo]").forEach((b) => b.addEventListener("click", () => {
    const i = Number(b.dataset.advgo);
    closeSheet(); world.focus(i % N, Math.floor(i / N)); world.view.zoom = Math.max(world.view.zoom, 1.4); world.updateCamera();
    setTimeout(() => inspect(i % N, Math.floor(i / N)), 350);
  }));
}
export function goals() {
  const progress = S.world && S.era === GREATER_CITY_STAGE ? greaterCityProgress(S) : null;
  const statuses = { open: "شغّال ✓", building: "قيد الإنشاء", stopped: "متوقف" };
  const civic = !progress ? "" : `<h3>مشاريع الحاضرة الكبرى</h3>
    <div class="rows">
      ${row("الخزائن المركزية الشغّالة", `${ar(progress.central)} من ${ar(B.vault.max)}`)}
      ${row("توسعة أبراج الرافعية", progress.upgradedTowers ? "شغّالة ✓" : progress.central < B.vault.max ? "تحتاج ٤ خزائن مركزية شغّالة" : "بانتظار التوسعة والتشغيل", progress.upgradedTowers ? "plus" : "")}
      ${Object.entries(GREATER_CITY_PROJECTS).map(([id, project]) => {
        const status = progress.projects.get(id);
        return row(project.name, statuses[status] || `${money(project.cost)} ريال`, status === "open" ? "plus" : status === "stopped" ? "minus" : "");
      }).join("")}
    </div>`;
  const done = GOALS.slice(0, S.goal).map((x) => `<div class="row done"><span>${x.text}</span><b class="plus">✓</b></div>`).join("");
  const early = S.goalsEarly || [];
  const next = GOALS.slice(S.goal, S.goal + 3).map((x, i) => early.includes(S.goal + i) ? `<div class="row done"><span>${x.text}</span><b class="plus">✓ استلمت ${money(x.reward)}</b></div>` : `<div class="row ${i ? "" : "now"}"><span>${x.text}</span><b>${money(x.reward)} ريال</b></div>`).join("");
  const rules = progress ? "" : "كل مهمة تعطيك مكافأة، ولو خلّصت وحدة من اللي تحت قبل اللي فوقها تستلمها على طول. ";
  sheet(`<h2>المهام</h2>${civic}<p>${rules}أنجزت ${ar(S.goal + early.length)} من ${ar(GOALS.length)} من مهام المدينة.</p><div class="rows">${next}${done}</div>`, "goals");
}
