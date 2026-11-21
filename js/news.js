// نشرة الرافعية: what the people of the town are saying.
// Every post comes from the town's real state (water, jobs, services, season, events…), spoken by
// one of the residents in their own voice. They work out what is needed and how much, say where,
// remember what they asked for and what the mayor promised, answer each other and react to decisions.
import { B, ERAS, DECISIONS, MAP_SIZE } from "./data.js";

/** The residents: who they are, what they care about, and how they talk. */
export const RESIDENTS = [
  { id: "abufahad", icon: "🏪", name: "أبو فهد", role: "صاحب البقالة", color: "#c0703a", cares: ["shops", "roads", "tax", "money", "power"], voice: "تاجر حريص، يحسبها بالريال، يمزح بس يشتكي من الركود" },
  { id: "umsaad", icon: "🧕", name: "أم سعد", role: "أم لخمسة عيال", color: "#8e5aa8", cares: ["water", "school", "health", "housing", "safety"], voice: "أم عملية وصريحة، تتكلم عن عيالها وبيتها، ما تجامل" },
  { id: "abunasser", icon: "👴", name: "الشايب أبو ناصر", role: "كبير الحي", color: "#7a6a4f", cares: ["mosque", "palms", "tradition", "camels", "change"], voice: "شايب حكيم يذكر الماضي ويضرب أمثال، يحب المسجد والنخل ويخاف على العادات" },
  { id: "saud", icon: "🧑", name: "سعود", role: "شاب يدور شغل", color: "#2f6fa8", cares: ["jobs", "fun", "tax", "growth"], voice: "شاب متحمس وعصبي شوي، يبي شغل وطلعات، يتكلم بسرعة" },
  { id: "noura", icon: "📚", name: "أ. نورة", role: "معلمة", color: "#c2456b", cares: ["school", "parks", "growth", "health"], voice: "معلمة مرتبة ومنطقية، تطالب بأرقام وتقترح حلول" },
  { id: "abukhalid", icon: "🌴", name: "أبو خالد", role: "مزارع نخل", color: "#4f8a3c", cares: ["water", "farms", "rain", "dates", "season"], voice: "مزارع صبور، عينه على السماء والبئر، يتكلم عن التمر والصرام" },
  { id: "mishal", icon: "🚙", name: "مشعل", role: "سواق جيب", color: "#5d6770", cares: ["roads", "asphalt", "dust", "traffic"], voice: "سواق يمزح كثير، يشتكي من الطرق والغبار، يعرف كل شارع" },
  { id: "drYousef", icon: "🩺", name: "د. يوسف", role: "طبيب", color: "#2c8a7a", cares: ["health", "pollution", "water", "safety"], voice: "طبيب هادي وعلمي، ينبه بلطف ويعطي نصيحة" },
  { id: "haya", icon: "🎒", name: "هيا", role: "طالبة", color: "#d07a2a", cares: ["parks", "fun", "deco", "school", "projects"], voice: "طالبة مرحة، تحب الحدائق والزينة، تحلم بجامعة ومطار" },
  { id: "mubarak", icon: "🐪", name: "العم مبارك", role: "راعي إبل", color: "#a8843a", cares: ["camels", "fayda", "rain", "season", "change"], voice: "راعي بسيط وفصيح، يتكلم عن الإبل والمرعى والمطر" },
  { id: "abuabdullah", icon: "🏗️", name: "أبو عبدالله", role: "تاجر عقار", color: "#3b4f7a", cares: ["land", "projects", "growth", "money", "housing"], voice: "تاجر طموح، يشوف الفرص، يتكلم عن الأراضي والمشاريع" },
  { id: "jawaher", icon: "🧵", name: "جواهر", role: "صاحبة مشغل خياطة", color: "#b0466e", cares: ["shops", "events", "power", "safety", "tax"], voice: "سيدة أعمال ذكية، تتكلم عن الزبائن والمواسم والكهرباء" }
];
export const residentById = (id) => RESIDENTS.find((r) => r.id === id);

const NEWS_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const nAr = (n) => String(n).replace(/\d/g, (d) => NEWS_DIGITS[d]);
const num = (n) => nAr(Math.round(n).toLocaleString("en-US"));
const pct = (x) => `${nAr(Math.round(x * 100))}٪`;

/** Everything worth talking about, measured from the town. Used by the local writer and by Claude. */
export function townFacts(s, a, season) {
  const homes = a.count.house, tents = a.levels[0];
  const projects = ["gate", "heritage", "tower", "airport"].map((id) => ({ id, t: s.tiles.find((t) => t.b?.id === id) })).filter((p) => p.t);
  return {
    stage: ERAS[s.era].name, day: Math.floor((s.day - 1) / 24) + 1, season: season.name, pop: s.pop, cap: a.cap, homes, tents,
    money: Math.round(s.money), netPerHour: a.net, tax: s.tax, happy: Math.round(s.happy),
    water: +a.waterRatio.toFixed(2), power: a.grid ? +a.powerRatio.toFixed(2) : null, unemployment: +a.unemployment.toFixed(2),
    jobs: a.jobs, workers: a.workers, unconnectedHomes: a.unconnected,
    mosques: a.count.mosque + a.count.bigmosque, schools: a.count.school, clinics: a.count.clinic + a.count.hospital,
    police: a.count.police, civil: a.count.civil, parks: a.count.park, palms: a.count.palms, wells: a.count.well,
    shops: a.count.grocery + a.count.cafe + a.count.souq + a.count.mandi, roadsDirt: a.count.road, roadsPaved: a.count.asphalt,
    decorations: ["streetpalm", "flowers", "lantern", "fountain", "dallah", "incense"].reduce((n, k) => n + a.count[k], 0),
    faydaGreen: a.fayda || 0, events: s.events.map((e) => e.name || e.id), plotsOwned: Object.values(s.owned || {}).filter(Boolean).length,
    projects: projects.map((p) => `${B[p.id].name}${p.t.b.build ? ` (تحت الإنشاء، باقي ${p.t.b.build} ساعة)` : ""}`),
    research: s.research ? s.research.id : null, inDebt: s.money < 0
  };
}

/**
 * What people would talk about right now: each topic has a mood (−1 upset, 0 asking, 1 pleased),
 * a weight (how much it matters) and lines that mention the real numbers.
 */
function topics(s, a, season, f) {
  const out = [];
  const add = (topic, mood, weight, lines) => out.push({ topic, mood, weight, lines });
  // Water
  if (f.water < 0.6) add("water", -1, 10, [`الماء ما يكفي نص الناس! ${num(f.pop)} نفس على ${nAr(f.wells)} بئر. نبي بئر جديد أو خزان اليوم قبل بكرة.`, `umsaad:من الفجر وأنا واقفة عند البئر، والسطل ما يمتلي. يا العمدة الماء ${pct(f.water)} من حاجتنا بس، هذا ما يصير.`, `abukhalid:النخل بدأ يصفار من العطش. إذا ما زاد الماء بنخسر محصول السنة كله.`]);
  else if (f.water < 0.95) add("water", -1, 6, [`الماء صار يخلص العصر. ${pct(1 - f.water)} من حاجتنا ناقصة، بئر واحد زيادة يحلها.`, `قبل الصيف لازم نزيد الماء، الحر جاي والاستهلاك يزيد عشرة بالمية.`]);
  else if (f.wells >= 2 && Math.random() < 0.3) add("water", 1, 1, [`abukhalid:الحمد لله الماء متوفر والبئر الجديد ريّحنا. الله يجزى العمدة خير.`]);
  // Power
  if (f.power !== null && f.power < 0.7) add("power", -1, 9, [`الكهرباء تطفي كل ساعة، والمكيف واقف والعيال يبكون من الحر. نبي مولد ثاني!`, `abufahad:ثلاجة المحل خربت من انقطاع الكهرباء، خسرت بضاعة. الكهرباء ${pct(f.power)} من الحاجة بس.`]);
  else if (f.power !== null && f.power < 0.98) add("power", -1, 5, [`الكهرباء على الحافة، أي بيت جديد بيطفيها. فكّروا بألواح شمسية قبل لا تصير مشكلة.`]);
  if (s.era >= 1 && f.power === null) add("power", 0, 5, [`صرنا ${f.stage} وللحين ما عندنا كهرباء! الفلل ما تنبني بدونها، والمحلات تبي إنارة.`, `كل البلدان اللي حولنا فيها كهرباء. مولد واحد يكفينا البداية.`]);
  // Jobs
  if (f.unemployment > 0.35 && f.pop > 20) add("jobs", -1, 9, [`${pct(f.unemployment)} من الشباب بلا شغل! الرافعية فيها ${num(f.jobs)} وظيفة بس لـ${num(f.workers)} يبون يشتغلون. افتحوا مزارع ومحلات.`, `saud:خلصت دراستي وقاعد بالبيت. لو فيه سوق أو ورشة كان اشتغلت بكرة.`, `الشباب بدوا يطلعون للمدن يدورون شغل. إذا ما فتحنا وظايف بتفضى البلد.`]);
  else if (f.unemployment > 0.15) add("jobs", 0, 4, [`فيه شباب يدورون شغل، بقالة أو مزرعة خضار زيادة تمشّيهم.`]);
  else if (f.pop > 30 && f.jobs > f.workers * 1.3) add("jobs", 0, 3, [`abufahad:عندي شغل وما لقيت عمال! الوظايف أكثر من الناس، نبي بيوت أكثر يسكنها ناس.`]);
  else if (f.pop > 30 && Math.random() < 0.3) add("jobs", 1, 1, [`saud:الحمد لله لقيت شغل بالرافعية وما احتجت أسافر.`]);
  // Housing
  if (f.cap && f.pop >= f.cap * 0.97) add("housing", 0, 5, [`saud:ولد عمي يبي يسكن عندنا بس ما فيه ولا بيت فاضي. البلد مليانة، نبي بيوت جديدة.`, `كل البيوت مسكونة. انصبوا خيام أو ابنوا، الناس يبون يجون.`]);
  if (f.unconnectedHomes > 0) add("roads", -1, 6, [`فيه ${nAr(f.unconnectedHomes)} بيت بلا طريق، محد يقدر يسكنها! وصلوها بطريق ترابي بس.`, `umsaad:بيت جاري واقف فاضي لأنه ما عليه طريق. حرام البناء ضايع.`]);
  // Services by reach (a home without them nearby)
  if (f.pop >= 25 && !f.mosques) add("mosque", -1, 8, [`صار عددنا ${num(f.pop)} ولا عندنا مسجد! نصلي بالخيام. أول شي يُبنى بالبلد المسجد.`, `abunasser:يا عيالي، البلد اللي ما فيها مسجد ما فيها بركة. ابنوا مسجد قبل أي شي.`]);
  if (f.pop >= 60 && !f.schools) add("school", -1, 7, [`umsaad:عيالي يمشون ساعة للمدرسة بالقرية الثانية. ${num(f.pop)} نفس وما عندنا مدرسة؟`, `noura:التعليم أساس. مدرسة وحدة تخلي البيوت اللي حولها تتطور أسرع.`]);
  if (f.pop >= 60 && !f.clinics) add("health", -1, 7, [`umsaad:أقرب مستوصف بعيد، وأمس ولد الجيران تعب بالليل وما لقينا طبيب.`, `drYousef:مع هالعدد من الناس لازم مستوصف. الوقاية أرخص من العلاج.`]);
  if (f.pop >= 150 && !f.police) add("safety", -1, 5, [`jawaher:صارت فيه سرقات بالليل. نبي مركز شرطة يطمّنا.`]);
  if (f.pop >= 40 && !f.parks) add("parks", 0, 4, [`haya:ما فيه مكان نطلع فيه العصر غير الشارع. حديقة صغيرة تكفي العوايل.`, `umsaad:العيال يلعبون بين السيارات. وين الحدائق؟`]);
  // Tax and money
  if (s.tax >= 15) add("tax", -1, 6 + (s.tax - 15), [`abufahad:الضريبة ${nAr(s.tax)}٪ كثيرة! المحل بالكاد يغطي. خففوها شوي والناس بترتاح.`, `كل شهر الضريبة تاكل نص الدخل. الناس بدوا يتذمرون.`]);
  else if (s.tax <= 6 && Math.random() < 0.4) add("tax", 1, 2, [`الضريبة خفيفة الله يجزاهم خير، الناس مرتاحين.`]);
  if (f.inDebt) add("money", -1, 8, [`سمعت إن البلدية مديونة والرواتب متأخرة! وش صاير؟ قللوا المصاريف.`, `الرواتب تأخرت أسبوع. البلدية لازم تشد الحزام.`]);
  // Roads
  if (f.roadsDirt >= 20 && !s.tech.asphalt) add("dust", -1, 4, [`mishal:الجيب صار لونه لون التراب! الطرق الترابية كثرت، متى السفلتة؟`, `umsaad:كل ما مرت سيارة دخل الغبار البيت. نبي طرق مسفلتة.`]);
  if (f.roadsPaved >= 10 && Math.random() < 0.4) add("asphalt", 1, 2, [`mishal:الطريق المسفلت فرق كبير! وصلت المحل بنص الوقت.`]);
  // Season and weather
  if (season.id === "spring" && f.faydaGreen > 0) add("fayda", 1, 5, [`الفيضة اخضرّت ونوّرت الخزامى! الإبل شبعت والناس طلعوا يكشتون. لا تبنون عليها تكفون.`, `haya:الله على ريحة الخزامى بالفيضة العصر. هالربيع خير.`]);
  if (season.id === "summer") add("season", -1, 3, [`الحر لاهب، والماء ينشف أسرع. انتبهوا للآبار.`, `abufahad:بالقايلة ما أحد يطلع. الشارع فاضي لين المغرب.`]);
  if (season.id === "winter" && f.tents >= 3) add("season", -1, 4, [`umsaad:البرد قارص والخيام ما تدفّي. متى نسكن بيوت طين؟`]);
  if (season.id === "autumn" && f.palms >= 1) add("dates", 1, 3, [`abukhalid:بدا الصرام! تمر هالسنة ممتاز، السكري والخلاص ما شاء الله.`]);
  for (const e of s.events) {
    if (e.id === "rain") add("rain", 1, 6, [`الحمد لله على المطر! الوادي سال والنخل ارتوى.`, `مطر الوسم نزل، الأرض بتربع إن شاء الله.`]);
    if (e.id === "dust") add("dust", -1, 5, [`الغبار ما خلى شي نظيف. سكروا الشبابيك.`]);
    if (e.id === "drought") add("water", -1, 7, [`الجفاف نشّف البئر. وفّروا الماء وادعوا بالمطر.`]);
    if (e.id === "ramadan") add("events", 1, 6, [`رمضان كريم! السوق بعد التراويح زحمة والحمد لله.`, `الفوانيس بالشوارع شي يشرح الصدر.`]);
    if (e.id === "eid") add("events", 1, 6, [`عيدكم مبارك! الألعاب النارية البارحة ما شاء الله.`, `abunasser:العيدية وزعناها على عيال الحي كلهم.`]);
    if (e.mazayen) add("camels", 1, 6, [`mubarak:مزاين الإبل جابت ناس من كل مكان! ناقتي أخذت المركز الثالث.`]);
  }
  // Growth and the town's look
  if (f.decorations >= 5) add("deco", 1, 2, [`الزينة بالشوارع حلوة، صارت الرافعية تفتح النفس.`]);
  if (f.projects.length) add("projects", 1, 4, f.projects.map((p) => `${p} — مشروع يرفع الراس.`));
  if (s.happy >= 80) add("growth", 1, 3, [`الرافعية تكبر يوم بعد يوم وكلنا مبسوطين. الله يحفظها.`]);
  if (s.happy < 35) add("growth", -1, 6, [`الناس زعلانين، والرضا ${nAr(Math.round(s.happy))}٪ بس. لازم العمدة يسمع لنا.`]);
  if (f.tents >= 10 && a.levels.slice(1).every((n) => !n)) add("change", 0, 4, [`abunasser:الخيام كثرت والحمد لله. إذا صرنا ٣٠ واستقرينا نبني بيوت طين مثل أول.`]);

  // ---- the residents who think it through: how much is missing, where, and what it costs ----
  const n = needs(s, a);
  if (n.wells > 0) add("water", -1, 7, [`abukhalid:حسبتها: الماء ناقص ${num(n.waterGap)} وحدة، والبئر يعطي ٣٠. يعني نحتاج ${nAr(n.wells)} ${n.wells === 1 ? "بئر" : "آبار"} زيادة${s.era >= 1 ? `، أو خزان واحد يكفي الكل` : ""}.`]);
  if (n.generators > 0) add("power", -1, 7, [`jawaher:الكهرباء ناقصة ${num(n.powerGap)}. مولد واحد يعطي ٧٠، فنحتاج ${nAr(n.generators)}${s.tech.solar ? `، والألواح الشمسية أنظف` : ""}.`]);
  if (n.jobGap >= 8) add("jobs", -1, 8, [`noura:فيه ${num(n.jobGap)} شخص يبي شغل زيادة عن الوظايف. ${n.jobIdea}`]);
  for (const sv of n.uncovered) add(sv.topic, -1, 4 + Math.min(4, sv.homes / 4), [`${sv.who}:${nAr(sv.homes)} بيت ${sv.area} ما يوصلها ${sv.what}. ${sv.idea}`]);
  if (n.polluted) add("pollution", -1, 6, [`drYousef:${nAr(n.polluted.homes)} بيت ${n.polluted.area} جنب ${n.polluted.by} وأهلها يشتكون من الدخان والإزعاج. الأفضل نبعد البيوت عنه أو نحط حديقة بينهم.`]);
  if (n.worst && s.happy < 60) add("growth", -1, 5, [`noura:الرضا ${nAr(Math.round(s.happy))}٪. أكبر سبب حسب كلام الناس: ${n.worst}. لو انحل نرتفع كثير.`]);
  if (n.saveFor) add("money", 0, 3, [`abuabdullah:الدخل ${num(a.net)} بالساعة، يعني ${num(a.net * 24)} باليوم. ${n.saveFor}`]);
  if (a.net < 0 && s.money > 0) add("money", -1, 7, [`abuabdullah:البلدية تصرف أكثر من دخلها: ${num(-a.net)} ريال بالساعة خسارة. بعد ${nAr(Math.max(1, Math.floor(s.money / -a.net / 24)))} يوم بتصير ديون. ارفعوا الضريبة شوي أو افتحوا محلات.`]);
  return out;
}

const AREAS = { n: "بالحارة الشمالية", s: "بالحارة الجنوبية", e: "بالحارة الشرقية", w: "بالحارة الغربية", c: "بوسط البلد" };
/** Which part of town a set of tiles is in (by its average position against the town's middle). */
function areaOf(s, list) {
  if (!list.length) return AREAS.c;
  let cx = 0, cy = 0, mx = 0, my = 0, all = 0;
  list.forEach((i) => { cx += i % MAP_SIZE; cy += Math.floor(i / MAP_SIZE); });
  s.tiles.forEach((t, i) => { if (t.b?.id === "house") { mx += i % MAP_SIZE; my += Math.floor(i / MAP_SIZE); all++; } });
  const dx = cx / list.length - mx / (all || 1), dy = cy / list.length - my / (all || 1);
  if (Math.hypot(dx, dy) < 2) return AREAS.c;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? AREAS.e : AREAS.w) : (dy > 0 ? AREAS.s : AREAS.n);
}

/** The arithmetic behind the complaints: what is missing, how many, where. */
export function needs(s, a) {
  const out = { uncovered: [] };
  out.waterGap = Math.max(0, Math.round(a.waterUse - a.waterSupply));
  out.wells = out.waterGap > 0 ? Math.ceil(out.waterGap / 30) : 0;
  out.powerGap = a.grid ? Math.max(0, Math.round(a.powerUse - a.powerSupply)) : 0;
  out.generators = out.powerGap > 0 ? Math.ceil(out.powerGap / 70) : 0;
  out.jobGap = Math.max(0, a.workers - a.jobs);
  out.jobIdea = s.era >= 1 ? `سوق شعبي يفتح ١٤ وظيفة، والورشة ١٢، ومزرعة الخضار ٦.` : `مزرعة خضار تفتح ٦ وظايف، والبقالة ٤، والمقهى ٥.`;
  // homes out of reach of a service, once the town has at least one of it
  const homes = [];
  s.tiles.forEach((t, i) => { if (t.b?.id === "house" && t.b.works) homes.push(i); });
  const services = [
    { svc: "mosque", topic: "mosque", what: "صوت الأذان", who: "abunasser", has: a.count.mosque + a.count.bigmosque, idea: "مسجد ثاني هناك يغطيهم ويفرّحهم." },
    { svc: "school", topic: "school", what: "مدرسة", who: "noura", has: a.count.school, idea: "مدرسة ثانية بينهم، والبيوت اللي حولها تتطور أسرع." },
    { svc: "health", topic: "health", what: "مستوصف", who: "drYousef", has: a.count.clinic + a.count.hospital, idea: "مستوصف قريب منهم ينقذ أرواح." },
    { svc: "safety", topic: "safety", what: "دورية أمن", who: "jawaher", has: a.count.police + a.count.civil, idea: "مركز شرطة هناك يطمّنهم." }
  ];
  for (const sv of services) {
    if (!sv.has) continue;
    const out2 = homes.filter((i) => !a.services[i].has(sv.svc));
    if (out2.length >= 4) out.uncovered.push({ ...sv, homes: out2.length, area: areaOf(s, out2) });
  }
  // nuisances near homes
  const smoky = homes.filter((i) => a.pollution[i] >= 8);
  if (smoky.length >= 2) {
    const polluters = ["generator", "workshop", "factory", "powerplant", "datefactory"].filter((k) => a.count[k]);
    out.polluted = { homes: smoky.length, area: areaOf(s, smoky), by: polluters.length ? B[polluters[0]].name : "المصانع" };
  }
  // what upsets people most
  const reasons = [
    [(1 - a.waterRatio) * 35, "نقص الماء"], [(1 - a.powerRatio) * 22, "انقطاع الكهرباء"], [a.unemployment * 30, "البطالة"],
    [(s.tax - 10) * 1.6, "الضريبة"], [s.money < 0 ? 12 : 0, "تأخر الرواتب"], [homes.length ? smoky.length / homes.length * 20 : 0, "الدخان والإزعاج"]
  ].sort((x, y) => y[0] - x[0]);
  if (reasons[0][0] > 3) out.worst = reasons[0][1];
  // what to save for next
  const next = !a.count.mosque && s.pop >= 20 ? "mosque" : !a.count.school && s.pop >= 50 ? "school" : !a.count.clinic && s.pop >= 50 ? "clinic" : null;
  if (next && a.net > 0 && s.money < B[next].cost) out.saveFor = `${B[next].name} يبي ${num(B[next].cost)}، يعني نوفّر ${nAr(Math.ceil((B[next].cost - s.money) / a.net))} ساعة تقريبًا.`;
  return out;
}

// ---------- memory: what people asked for, and what the mayor promised ----------

const TOPIC_NAMES = { water: "الماء", power: "الكهرباء", jobs: "الشغل", mosque: "المسجد", school: "المدرسة", health: "المستوصف", safety: "الأمن", parks: "الحديقة", roads: "الطريق", tax: "تخفيف الضريبة", housing: "البيوت", dust: "سفلتة الطرق", money: "ترتيب الميزانية", pollution: "إبعاد الدخان" };
/** Is anyone still upset about this topic right now? */
const stillMissing = (s, a, season, topic) => topics(s, a, season, townFacts(s, a, season)).some((t) => t.topic === topic && t.mood < 0);

/**
 * Each town hour: thank the mayor for wishes that came true, and remind of the ones still waiting
 * (asked three days ago) or promises not kept after two days.
 */
export function followUps(s, a, season) {
  const posts = [];
  s.demands ||= {}; s.promises ||= [];
  const post = (who, text, mood, topic) => posts.push({ id: `f-${s.day}-${posts.length}-${topic}`, day: s.day, who, text, mood, topic, likes: 10 + Math.floor(Math.random() * 30) });
  // Promises first: a kept promise is thanked once (and closes the same wish).
  s.promises = s.promises.filter((p) => {
    if (!stillMissing(s, a, season, p.topic)) { post(p.who, `وفيت بوعدك يا العمدة. قلت «${p.said.slice(0, 40)}» وصار. الرجال كلمة 👏`, 1, p.topic); delete s.demands[p.topic]; return false; }
    if (!p.reminded && s.day - p.day >= 48) { post(p.who, `يا العمدة، وعدتنا قبل يومين: «${p.said.slice(0, 40)}». الناس يسألون وين الوعد؟`, -1, p.topic); p.reminded = true; }
    return s.day - p.day < 24 * 8;
  });
  for (const [topic, d] of Object.entries(s.demands)) {
    const days = Math.round((s.day - d.day) / 24);
    const when = days < 1 ? "بنفس اليوم" : days === 1 ? "بيوم واحد" : days === 2 ? "بيومين" : `بعد ${nAr(days)} أيام`;
    if (!stillMissing(s, a, season, topic)) {
      post(d.who, `الله يعطيك العافية يا العمدة! طلبنا ${TOPIC_NAMES[topic] || "طلبنا"} وتحقق ${when}. هذا اللي نبيه 👏`, 1, topic);
      delete s.demands[topic];
    } else if (!d.reminded && s.day - d.day >= 72) {
      post(d.who, `صار لنا ${nAr(days)} أيام نطالب بـ${TOPIC_NAMES[topic] || "حقنا"} وللحين ما صار شي. لا تنسانا يا العمدة.`, -1, topic);
      d.reminded = true;
    }
  }
  return posts;
}

/** Remember the complaints that ask for something (so they can be thanked or followed up). */
export function rememberDemands(s, posts) {
  s.demands ||= {};
  for (const p of posts) if (p.mood < 0 && TOPIC_NAMES[p.topic] && !s.demands[p.topic]) s.demands[p.topic] = { day: s.day, who: p.who };
}

// ---------- residents answering each other ----------

const ANSWERS = {
  tax: [["abuabdullah", -1, "الضريبة هي اللي بنت المسجد والمدرسة. اصبروا، الخير جاي."], ["saud", 1, "صدق، الضريبة صارت تاكل الراتب كله."]],
  fayda: [["abuabdullah", -1, "الفيضة أرض ذهب، لو انبنى عليها سوق كان أنفع للبلد."], ["mubarak", 1, "الله لا يغيّر علينا، الفيضة حلال الإبل والعيال."]],
  jobs: [["abufahad", 0, "عندي مكان لعامل، بس الشباب يبون رواتب عالية من أول يوم."], ["umsaad", 1, "ولدي من سنة يدور. افتحوا مزرعة ولا محل."]],
  water: [["abukhalid", 1, "والنخل أولى من الكل، إذا عطش ما يرجع."], ["drYousef", 1, "والماء الملوث أخطر من قلته، انتبهوا للآبار."]],
  mosque: [["noura", 1, "وتحتها حلقة تحفيظ للعيال إن شاء الله."]],
  school: [["haya", 1, "وفيها مكتبة تكفون!"]],
  dust: [["umsaad", 1, "الغبار مو بس بالسيارات، حتى الربو زاد عند العيال."]],
  power: [["abufahad", 1, "وأنا أول المتضررين، الثلاجات واقفة."]],
  money: [["abufahad", 0, "التوفير زين، بس لا توقفون المشاريع كلها."]],
  growth: [["abunasser", 0, "يا عيالي البلد تكبر بالصبر، ما تنبني بيوم."]],
  events: [["jawaher", 1, "والمشغل ما وقف من الطلبات، الله يديمها."]],
  rain: [["mubarak", 1, "والإبل بتشبع هالسنة إن شاء الله."]],
  housing: [["abuabdullah", 1, "عندي أراضي جاهزة، بس البلدية تبني الطرق."]]
};
/** Sometimes another resident joins in: agrees, adds a detail, or disagrees. */
export function maybeAnswer(post, r = Math.random) {
  const list = (ANSWERS[post.topic] || []).filter(([who]) => who !== post.who);
  if (!list.length || r() > 0.45) return post;
  const [who, , text] = list[Math.floor(r() * list.length)];
  return { ...post, replies: [...(post.replies || []), { from: "res", who, text }] };
}

// ---------- reactions to the mayor's decisions ----------

const REACT = {
  investor: [["saud", 1, "المصنع بيجيب شغل! قرار صح."], ["drYousef", -1, "الفلوس زينة، بس صحة الناس أهم. لا ترضى بدخان جنب البيوت."]],
  mazayen: [["mubarak", 1, "الله يجزاك خير يا العمدة، أهل الإبل كلهم بيجون."], ["mubarak", -1, "كان ودنا بالمزاين هالسنة، الفيضة ما خضرت كذا من زمان."]],
  kashta: [["haya", 1, "أحلى كشتة! القهوة والحطب جاهزة."], ["umsaad", 0, "طيب نطلع على حسابنا، بس الأولى البلدية تساعد."]],
  wedding: [["abunasser", 1, "كذا تكون الرافعية، الفزعة بالأفراح."], ["abunasser", -1, "العتب على قدر المحبة. أهل العرس زعلوا."]],
  oldmosque: [["abunasser", 1, "المسجد القديم فيه ذكرياتنا. الله يجزاك خير."]],
  taxplea: [["abufahad", 1, "خففت الضريبة؟ الله يبيض وجهك."], ["abufahad", -1, "رفضت العريضة؟ الناس بتتذكر."]],
  thirst: [["umsaad", 1, "الوايتات وصلت، الحمد لله. بس نبي حل دايم، بئر ثاني."], ["umsaad", -1, "نقتصد؟ ما بقى شي نقتصد فيه يا العمدة."]],
  jobless: [["saud", 1, "اشتغلت مع المشروع المؤقت، بس وش بعده؟"], ["saud", -1, "ولد خالي طلع للرياض. الشباب بيروحون إذا ما فيه شغل."]],
  fever: [["drYousef", 1, "الطبيب الزائر لحق عليهم. بس لازم مستوصف دايم."], ["umsaad", -1, "عوايل طلعت من البلد خوف من الحمّى. نبي مستوصف."]],
  thief: [["jawaher", 1, "الحرّاس طمّنونا. شكرًا."], ["jawaher", -1, "انسرق محلي. متى مركز الشرطة؟"]],
  fire: [["abufahad", 1, "فزعة الجيران أنقذت المحلات، الحمد لله."], ["abufahad", -1, "الحريق أكل المحل. لازم دفاع مدني بالبلد."]],
  loan: [["abuabdullah", 0, "القرض حل مؤقت. لا تبنون شي ما يرجع دخله."], ["abufahad", -1, "شد الحزام يعني ضريبة أكثر علينا."]],
  wellbroken: [["abukhalid", 1, "البئر رجع، الحمد لله. صلحوه بسرعة."], ["abukhalid", -1, "يومين بلا ماء كافي؟ النخل ما يتحمل."]]
};
/** One resident's word on what the mayor just decided (first option = 0). */
export function decisionReaction(s, id, choice) {
  const list = REACT[id];
  if (!list) return null;
  const [who, mood, text] = list[Math.min(choice, list.length - 1)];
  return { id: `d-${s.day}-${id}`, day: s.day, who, text, mood, topic: "decision", likes: 5 + Math.floor(Math.random() * 30) };
}

/** A small seeded random so a day's posts do not change on reload. */
function newsRand(seed) { let x = seed >>> 0 || 1; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }

/**
 * Write `count` new posts. Picks the topics that matter most (weighted), gives each to a
 * resident who cares about it, and avoids lines and topics said recently.
 */
export function writePosts(s, a, season, count = 1) {
  const f = townFacts(s, a, season);
  const all = topics(s, a, season, f);
  const recent = (s.news || []).slice(0, 8);
  const r = newsRand(s.day * 7919 + (s.news?.length || 0));
  const posts = [];
  for (let k = 0; k < count && all.length; k++) {
    const pool = all.filter((t) => !recent.some((p) => p.topic === t.topic) && !posts.some((p) => p.topic === t.topic));
    const list = pool.length ? pool : all;
    let roll = r() * list.reduce((n, t) => n + t.weight, 0);
    const t = list.find((x) => (roll -= x.weight) < 0) || list[0];
    // A line may name who says it ("umsaad:…"); otherwise someone who cares about the topic says it.
    const parse = (l) => { const m = /^([a-zA-Z]+):(.*)$/s.exec(l); return m ? { by: m[1], text: m[2] } : { by: "", text: l }; };
    const said = (txt) => (s.news || []).some((p) => p.text === txt) || posts.some((p) => p.text === txt);
    const fresh = t.lines.map(parse).filter((l) => !said(l.text));
    if (!fresh.length) { all.splice(all.indexOf(t), 1); k--; continue; }
    const line = fresh[Math.floor(r() * fresh.length)], text = line.text;
    const fans = RESIDENTS.filter((p) => p.cares.includes(t.topic));
    const who = residentById(line.by) || (fans.length ? fans : RESIDENTS)[Math.floor(r() * (fans.length || RESIDENTS.length))];
    posts.push(maybeAnswer({ id: `${s.day}-${k}-${Math.floor(r() * 1e6)}`, day: s.day, who: who.id, text, mood: t.mood, topic: t.topic, likes: Math.round(t.weight * (2 + r() * 6)) }, r));
  }
  rememberDemands(s, posts);
  return posts;
}

// ---------- the mayor answers a resident ----------

const PROMISE_WORDS = /بنبني|بنسوي|ابشر|أبشر|تم|إن شاء الله|ان شاء الله|قريب|حاضر|وعد|بكرة|بكره|الحين|نبني|بنحط|بنفتح|بنحفر|بنزيد|بنخفف|بنسفلت/;
const REFUSE_WORDS = /لا |ما نقدر|ماعندنا|ما عندنا|مستحيل|بعدين|اصبر|اصبروا|ما فيه فلوس|مافيه فلوس|غالي/;
const ASK_WORDS = /وش تبون|وش تبي|وش ناقص|وش الناقص|وش تحتاجون|وش المشكلة|ليش/;
const KEYWORDS = [[/مسجد|جامع/, "mosque"], [/مدرس|تعليم/, "school"], [/مستوصف|مستشفى|طبيب/, "health"], [/شرط|أمن|حرّاس|حراس/, "safety"], [/حديق|منتزه/, "parks"],
  [/بئر|ماء|خزان|تحلية|وايت/, "water"], [/كهرب|مولد|شمسي/, "power"], [/شغل|وظ|سوق|مزرع|محل|ورش|مصنع/, "jobs"], [/ضريب/, "tax"], [/سفلت|زفت|غبار/, "dust"],
  [/طريق|شارع/, "roads"], [/بيوت|خيام|سكن/, "housing"]];

/**
 * A resident answers the mayor. They read what the mayor said (a promise, a refusal, a question),
 * check it against the town's numbers, and remember promises to follow them up.
 */
export function smartReply(s, a, season, post, said) {
  const who = residentById(post.who), n = needs(s, a);
  const topic = (KEYWORDS.find(([re]) => re.test(said)) || [])[1] || (TOPIC_NAMES[post.topic] ? post.topic : null);
  const missing = topic && stillMissing(s, a, season, topic);
  const detail = topic === "water" && n.wells ? ` ترى نحتاج ${nAr(n.wells)} ${n.wells === 1 ? "بئر" : "آبار"} بالضبط.` : topic === "power" && n.generators ? ` نحتاج ${nAr(n.generators)} مولد على الأقل.` : topic === "jobs" && n.jobGap ? ` ${num(n.jobGap)} شخص ينتظرون وظيفة.` : "";
  if (ASK_WORDS.test(said)) {
    const list = topics(s, a, season, townFacts(s, a, season)).filter((t) => t.mood < 0).sort((x, y) => y.weight - x.weight).slice(0, 2).map((t) => TOPIC_NAMES[t.topic]).filter(Boolean);
    return list.length ? `بصراحة يا العمدة: ${list.join("، وبعده ")}.${detail}` : `الحمد لله ما ينقصنا شي كبير الحين. استمر كذا.`;
  }
  if (PROMISE_WORDS.test(said) && !REFUSE_WORDS.test(said)) {
    if (topic && !missing) return `${TOPIC_NAMES[topic]} ما عليه كلام الحين، الله يجزاك خير. ${who.role === "كبير الحي" ? "الكلمة الطيبة صدقة." : "بس لا تنسى الباقي."}`;
    if (topic) { s.promises ||= []; if (!s.promises.some((p) => p.topic === topic)) s.promises.push({ who: post.who, topic, day: s.day, said }); }
    return [`كلمة عمدة! ننتظر ${TOPIC_NAMES[topic] || "الوعد"}، وبنذكّرك إن تأخر 😄.${detail}`, `الله يجزاك خير، الحي كله بيسمع. ${detail || "لا تطوّل علينا."}`][Math.floor(Math.random() * 2)];
  }
  if (REFUSE_WORDS.test(said)) {
    const building = { mosque: "mosque", school: "school", health: "clinic", safety: "police", parks: "park", water: "well", power: "generator", jobs: "grocery", dust: "asphalt", roads: "road" }[topic];
    if (/فلوس|غالي/.test(said) && building && B[building]) {
      const cost = B[building].cost;
      if (s.money >= cost) return `ما فيه فلوس؟ الميزانية فيها ${num(s.money)} و${B[building].name} يبي ${num(cost)} بس. الفلوس موجودة يا العمدة!`;
      if (a.net > 0) { const h = Math.ceil((cost - s.money) / a.net); return `${B[building].name} يبي ${num(cost)}، والدخل ${num(a.net)} بالساعة. يعني ${h <= 24 ? `${nAr(h)} ساعة` : `${nAr(Math.ceil(h / 24))} أيام`} توفير ويصير. نصبر بس لا تنسى.`; }
      return `البلدية تخسر كل ساعة، صح. بس سكّروا الهدر أول وبعدين ${B[building].name}.`;
    }
    return post.mood < 0 ? `يعني نصبر لين متى؟ ${who.role === "كبير الحي" ? "الصبر زين بس الحاجة ما تنتظر." : "الناس بدت تتعب."}` : `خلاص على راحتكم، بس لا تطولون.`;
  }
  return post.mood < 0 ? `نبي فعل مو كلام يا العمدة 🙏${detail}` : `حياك الله يا العمدة، نورتنا.`;
}
