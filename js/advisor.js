// المستشار المالي: reads the whole town (money, quarters, services, water, power, jobs, traffic, buildings)
// and says, in order of what matters most, what is wrong, why, and the steps to fix it, with the numbers.
// Everything comes from the same arithmetic as the rest of the game (sim.js), so it is never wrong about the town.
import { B, ERAS, TECH, MAP_SIZE as N, GROUND } from "./data.js";
import { idleWhy, moneyCap, districtOf, districtName, idx } from "./sim.js";
import { needs } from "./news.js";

/** The price of a consultation by stage (the first one is free). */
export const ADVISOR_FEE = [50, 200, 500, 1000, 2000];
/** A consultation holds for this many town hours. */
export const ADVISOR_HOURS = 24;

const ADV_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const advAr = (n) => String(n).replace(/\d/g, (d) => ADV_DIGITS[d]);
const advNum = (n) => advAr(Math.round(n).toLocaleString("en-US"));
const advPct = (x) => `${advAr(Math.round(x * 100))}٪`;
/** "بيت واحد", "بيتين", "٥ بيوت", "٢٠ بيت": counted the way people say it. */
const advCount = (n, one, two, few, many = one) => (n === 1 ? `${one} واحد` : n === 2 ? two : n <= 10 ? `${advAr(n)} ${few}` : `${advAr(n)} ${many}`);
/** "بالحارة الشرقية": the quarter most of these tiles are in. */
function advWhere(s, list) {
  const c = new Map();
  for (const i of list) c.set(districtOf(i), (c.get(districtOf(i)) || 0) + 1);
  const d = [...c.entries()].sort((p, q) => q[1] - p[1])[0]?.[0];
  return d == null ? "" : `ب${districtName(s, d)}`;
}

/**
 * The report. Returns { net, verdict, mood, findings: [{ w, icon, title, why, steps: [], at }], good: [] }.
 * w: how much it matters (the list is sorted by it); at: a tile to show on the map (or -1).
 */
export function advise(s, a) {
  const out = [], good = [];
  const add = (w, icon, title, why, steps, at = -1) => out.push({ w, icon, title, why, steps, at });
  const n = needs(s, a);
  const tiles = s.tiles;
  const homes = [];
  tiles.forEach((t, i) => { if (t.b?.id === "house") homes.push(i); });

  // ---- money: winning or losing, and where it goes ----
  const income = { "المحلات": a.shopIncome || 0, "الزوار والسياحة": a.visitorIncome || 0, "المصانع والصناعة": a.industryIncome || 0, "المزارع": a.farmIncome || 0, "الضريبة": a.tax || 0 };
  const c = a.costs || {};
  const costs = { "رواتب موظفي البلدية": c.staff, "صيانة الخدمات": c.services, "الماء والكهرب": c.utilities, "تشغيل المحلات والمزارع": c.business, "النظافة": c.cleaning, "شبكة الماء": c.waterNet, "صيانة الطرق": c.roads, "أقساط القروض": c.loan, "التأمين": c.insurance, "علاج أمراض الدخان": c.health, "السرقات": c.theft, "العسكرية": c.military, "مشاريع تحت الإنشاء": c.sites };
  const topCosts = Object.entries(costs).filter(([, v]) => v > 0.5).sort((p, q) => q[1] - p[1]).slice(0, 3);
  const topIncome = Object.entries(income).filter(([, v]) => v > 0.5).sort((p, q) => q[1] - p[1]).slice(0, 2);
  const net = a.net;
  if (s.money < 0) {
    add(120, "🚨", "البلدية مديونة", `عليك ${advNum(-s.money)} ريال، وأكبر مصاريفك: ${topCosts.map(([k, v]) => `${k} ${advNum(v)}`).join("، ")} بالساعة.`, [
      net < 0 ? `أول شي وقّف الخسارة: الصافي ${advNum(net)} ريال بالساعة.` : net > 0
        ? `فائضك ${advNum(net)} ريال بالساعة، وتسدد دينك بعد ${advAr(Math.ceil(-s.money / net))} ساعة تقريباً إذا ما صرفت.`
        : "دخلك يغطي المصاريف بالضبط. تحتاج فائض عشان ينقص الدين.",
      "لا تبني شي جديد لين ترجع فوق الصفر، إلا اللي يجيب دخل.",
      s.tax < 12 ? `ارفع الضريبة شوي (الحين ${advAr(s.tax)}٪) من «الأرقام».` : "شيل المباني اللي ما تشتغل ومصروفها عليك (تحت)."
    ]);
  } else if (net < 0) {
    const hours = s.money / -net;
    add(100, "📉", "مدينتك خسرانة", `تخسر ${advNum(-net)} ريال بالساعة. إذا كمّلت كذا تخلص فلوسك بعد ${hours < 48 ? `${advAr(Math.max(1, Math.round(hours)))} ساعة` : `${advAr(Math.round(hours / 24))} يوم`} باللعبة. أكبر مصاريفك: ${topCosts.map(([k, v]) => `${k} (${advNum(v)})`).join("، ")}.`, [
      ...(a.shopDemand > (a.shopRaw || 0) * 1.15 ? [`الناس يبون يشترون أكثر من اللي تبيعه محلاتك (طلب ${advNum(a.shopDemand)} وبيع ${advNum(a.shopRaw || 0)}): ابنِ محلات (بقالة، مقهى، سوق) جنب البيوت.`] : []),
      ...(s.tax < 11 && s.pop * 0.02 * (3 - Math.min(1.2, s.pop / 2500)) * (12 - s.tax) / 2 > -net * 0.15 ? [`الضريبة ${advAr(s.tax)}٪: رفعها لـ١٢٪ يزيد الدخل تقريباً ${advNum(s.pop * 0.02 * (3 - Math.min(1.2, s.pop / 2500)) * (12 - s.tax) / 2)} بالساعة، والناس ما يزعلون كثير.`] : []),
      "شيل أو صلّح المباني الواقفة اللي تصرف بدون فايدة (تحت).",
      "لا تبني خدمات زيادة عن حاجتك: كل مسجد ومدرسة ومستوصف له راتب."
    ]);
  } else if (net > 0) good.push(`رابح ${advNum(net)} ريال بالساعة (${advNum(net * 24)} باليوم)${topIncome.length ? `، أغلبها من ${topIncome.map(([k]) => k).join(" و")}` : ""}.`);

  // shops: too many for the people, or too few
  if ((a.shopRaw || 0) > a.shopDemand * 1.35 && a.count.grocery + a.count.cafe + a.count.souq + a.count.mandi + a.count.mall > 3)
    add(55, "🏪", "محلات أكثر من الزباين", `محلاتك تقدر تبيع بـ${advNum(a.shopRaw)} والناس يصرفون ${advNum(a.shopDemand)} بس، فكل محل ياخذ أقل وتدفع تشغيله كامل.`, ["وقّف بناء المحلات لين يكبر عدد السكان.", "كبّر البلد بالبيوت: كل بيت جديد يزيد الزباين.", "حوّل بعض المحلات لبيوت إذا تبي ربح أسرع."]);

  // vault full: money above the cap is lost
  const cap = moneyCap(s);
  if (Number.isFinite(cap) && s.money >= cap) add(70, "🔒", "الخزنة مليانة", `فلوسك ${advNum(s.money)} والحد ${advNum(cap)}: أي دخل زيادة يضيع.`, ["اصرف على شي يجيب دخل أو يكبّر البلد.", "ابنِ خزنة جديدة أو طوّر خزنتك (قسم ماء وكهرباء)."]);

  // ---- buildings that stand idle, and why ----
  const idle = new Map();
  tiles.forEach((t, i) => {
    if (!t.b || t.b.works !== false || t.b.build > 0 || t.b.id === "decopart") return;
    const why = idleWhy(s, i % N, Math.floor(i / N)) || "واقف";
    if (!idle.has(why)) idle.set(why, []);
    idle.get(why).push(i);
  });
  for (const [why, list] of idle) {
    const names = [...new Set(list.map((i) => B[tiles[i].b.id].name))].slice(0, 3).join("، ");
    const waste = list.reduce((m, i) => m + (B[tiles[i].b.id].upkeep || 0), 0);
    add(why.includes("طريق") ? 75 : 60, "🚧", advCount(list.length, "مبنى واقف", "مبنيين واقفين", "مباني واقفة", "مبنى واقف"), `${names} ${advWhere(s, list)}: ${why}.${waste ? ` تصرف عليها ${advNum(waste)} ريال بالساعة بدون فايدة.` : ""}`,
      why.includes("طريق") ? ["وصّل كل واحد بطريق لاصق فيه من جنب (مو بالزاوية).", "إذا ما تحتاجه، شيله ويرجع لك ثلث سعره."] : ["اضغط عليه وتشوف وش يبي بالضبط."], list[0]);
  }

  // worn out: they work at 60% and fall down if left
  const worn = []; tiles.forEach((t, i) => { if (t.b && !(t.b.build > 0) && t.b.id !== "decopart" && ((t.b.cond ?? 100) < 40 || t.b.ruin)) worn.push(i); });
  if (worn.length) add(worn.some((i) => tiles[i].b.ruin) ? 90 : 50, "🔧", advCount(worn.length, "مبنى متهالك", "مبنيين متهالكين", "مباني متهالكة", "مبنى متهالك"), `تشتغل بـ٦٠٪ بس${worn.some((i) => tiles[i].b.ruin) ? "، وفيه منها خربان بيطيح خلال يومين" : ""}. الترميم كله ${advNum(a.repairBill)} ريال.`, ["رمّمها كلها من «الأرقام» ← رمّم الكل.", "أو فعّل النائب يرمّم عنك وانت برا."], worn.find((i) => tiles[i].b.ruin) ?? worn[0]);

  // ---- water ----
  const dry = homes.filter((i) => tiles[i].b.works && !a.watered?.[i]);
  if (n.wells > 0 || dry.length) add(85, "💧", "الماء ناقص", `${n.wells ? `الماء ناقص ${advNum(n.waterGap)} وحدة (عندك ${advPct(a.waterRatio)} من الحاجة). ` : ""}${dry.length ? `${advCount(dry.length, "بيت", "بيتين", "بيوت")} ${advWhere(s, dry)} ما توصلها مواسير.` : ""}`,
    [n.wells ? `ابنِ ${advCount(n.wells, "بئر", "بئرين", "آبار", "بئر")} (كل بئر ٣٠ وحدة)${s.era >= 1 ? " أو خزان (١٤٠ وحدة ويوصل ٩ مربعات)" : ""}.` : "", dry.length ? "حط البئر أو الخزان وسط البيوت اللي ما يوصلها ماء." : ""].filter(Boolean), dry[0] ?? -1);
  if ((s.aquifer ?? 100) < GROUND.low && (s.aquiferRate ?? 0) <= 0.05) add(80, "🏜️", "الماء الجوفي ينزل", `الماء الجوفي ${advPct((s.aquifer ?? 0) / 100)}، والآبار والخزانات تعطي أقل من ماها. عندك ${advAr(a.count.well)} بئر و${advAr(a.count.tank)} خزان و${advAr(a.count.pivot)} مزرعة محورية تسحب.`,
    [s.tech.dams ? "ابنِ سد أو سدّين على الوادي: يرجّعون الماء للأرض." : "ابحث «سدود الأودية» من المجلس، وابنِ سد.",
      s.era >= B.desal.era ? (s.tech.desal ? "التحلية تعطي ماء بدون ما تسحب من الأرض." : "ابحث «تحلية المياه» قبل بناء محطة التحلية.") : "خفّف الآبار الزايدة.",
      a.count.pivot ? "المزارع المحورية تسحب كثير: لا تزيدها." : ""].filter(Boolean));

  // ---- power ----
  const dark = homes.filter((i) => tiles[i].b.works && tiles[i].b.lvl >= 3 && a.grid && !a.powered?.[i]);
  if (n.generators > 0 || dark.length) add(70, "⚡", "الكهرب ناقصة", `${n.generators ? `ناقصة ${advNum(n.powerGap)} (عندك ${advPct(a.powerRatio)}). ` : ""}${dark.length ? `${advAr(dark.length)} فيلا وعمارة ${advWhere(s, dark)} ما توصلها كهرب، وأهلها زعلانين.` : ""}`,
    [n.generators ? `ابنِ ${advCount(n.generators, "مولد", "مولدين", "مولدات", "مولد")}${s.tech.solar ? " أو ألواح شمسية (أنظف)" : ""}.` : "", dark.length ? "مد لها عمدان كهرب أو «طريق مكهرب» من المولد." : ""].filter(Boolean), dark[0] ?? -1);

  // ---- people: jobs, homes ----
  if (a.unemployment > 0.15 && s.pop > 30) add(65, "👷", "بطالة", `${advPct(a.unemployment)} من الشباب بلا شغل (${advNum(a.workers - a.employed)} شخص). كل عاطل ما يصرف بالمحلات.`, [n.jobIdea, "الوظايف تزيد الدخل والرضا مع بعض."]);
  else if (s.pop > 30 && a.jobs > a.workers * 1.3) add(45, "🏠", "وظايف أكثر من الناس", `فيه ${advNum(a.jobs)} وظيفة و${advNum(a.workers)} عامل بس: محلات ومصانع تشتغل بنص طاقتها.`, ["ابنِ بيوت أو طوّرها عشان يجون ناس أكثر.", "لا تبني محلات ومصانع جديدة الحين."]);
  if (a.cap && s.pop >= a.cap * 0.97) add(50, "🏘️", "البيوت مليانة", `السكان ${advNum(s.pop)} والسعة ${advNum(a.cap)}: البلد ما تقدر تكبر.`, ["انصب خيام جديدة أو طوّر البيوت (الفلل والعماير تشيل ناس أكثر)."]);
  if (a.unconnected > 0) { const u = homes.filter((i) => !tiles[i].b.works); add(72, "🛣️", `${advCount(a.unconnected, "بيت", "بيتين", "بيوت")} بلا طريق`, `ما أحد يسكنها ${advWhere(s, u)}.`, ["وصّلها بطريق ترابي بس، رخيص (٨ ريال)."], u[0] ?? -1); }

  // ---- services and nuisances by quarter ----
  for (const sv of n.uncovered) add(40 + Math.min(20, sv.homes), sv.svc === "mosque" ? "🕌" : sv.svc === "school" ? "🏫" : sv.svc === "health" ? "🏥" : "👮", `${advAr(sv.homes)} بيت ${sv.area} بلا ${sv.what}`, "الخدمة قريبة ترفع رضا البيت وتطوّره.", [sv.idea], sv.list?.[0] ?? -1);
  for (const sv of n.noRoad) add(55, "🚧", `${sv.name} ${sv.area} ما عليه طريق`, `واقف، و${advAr(sv.homes)} بيت حوله محرومة منه.`, ["وصّله بطريق بس."], sv.list?.[0] ?? -1);
  if (n.polluted) add(45, "🏭", "دخان جنب البيوت", `${advAr(n.polluted.homes)} بيت ${n.polluted.area} جنب ${n.polluted.by}: رضا أقل، وعلاج أمراض الدخان ${advNum(c.health || 0)} بالساعة.`, ["انقل المصنع أو المولد بعيد (من «✏️ تعديل»).", "أو حط حديقة ونخل بينه وبين البيوت."], n.polluted.list?.[0] ?? -1);

  // ---- traffic ----
  const jam = []; if (a.trafficCong) for (let i = 0; i < N * N; i++) if (a.trafficCong[i] > 0.6) jam.push(i);
  if (jam.length >= 3) add(40, "🚗", "زحمة", `${advAr(jam.length)} مربع طريق مزحوم ${advWhere(s, jam)}: الناس يتأخرون والمحلات تبيع أقل.`, [s.tech.asphalt ? "حوّل الطرق المزحومة لشارع رئيسي، وحط دوار على التقاطعات." : "ابحث «سفلتة الطرق» من المجلس.", "افتح طرق ثانية بين الحارات والشغل."], jam[0]);

  // ---- tax and happiness ----
  if (s.tax >= 15) add(50, "🧾", "الضريبة عالية", `${advAr(s.tax)}٪ تزعّل الناس وتخليهم يطلعون.`, ["نزّلها لـ١٠–١٢٪ من «الأرقام»."]);
  if (n.worst && s.happy < 55) add(45, "😟", "الرضا نازل", `${advAr(Math.round(s.happy))}٪، وأكبر سبب: ${n.worst}.`, ["حل السبب هذا أول، والرضا يرتفع بسرعة."]);
  else if (s.happy >= 70) good.push(`الناس مبسوطين (${advAr(Math.round(s.happy))}٪).`);

  // ---- growth: the next stage, research ----
  const nx = ERAS[s.era + 1];
  if (nx) add(20, "⬆️", `الطريق لـ${nx.name}`, `باقي ${advNum(Math.max(0, nx.pop - s.pop))} نسمة.`, ["بيوت أكثر، وماء وكهرب واصلة، وخدمات قريبة، تجيب ناس أسرع.", "طوّر البيوت: الفلة تشيل أكثر من الخيمة بكثير."]);
  const tech = Object.entries(TECH).filter(([id, t]) => !s.tech[id] && t.era <= s.era).sort((p, q) => p[1].cost - q[1].cost)[0];
  if (tech && !s.research && s.money > tech[1].cost * 2) add(25, "🧪", "المجلس فاضي", `ما فيه بحث شغال. «${tech[1].name}» بـ${advNum(tech[1].cost)}: ${tech[1].text}`, ["ابدأه من «المجلس»."]);

  out.sort((p, q) => q.w - p.w);
  const verdict = s.money < 0 ? "مديون" : net < 0 ? "خسران" : net === 0 ? "الدخل يغطي المصاريف" : out.some((f) => f.w >= 70) ? "رابح بس فيه مشاكل" : "ماشي زين";
  return { net, verdict, findings: out, good };
}
