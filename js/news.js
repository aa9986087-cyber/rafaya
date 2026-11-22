// نشرة الرافعية: what the people of the town are saying.
// Every post comes from the town's real state (water, jobs, services, season, events…), spoken by
// one of the residents in their own voice. They work out what is needed and how much, say where,
// remember what they asked for and what the mayor promised, answer each other and react to decisions.
import { B, ERAS, DECISIONS, MAP_SIZE } from "./data.js";
import { districtOf, districtName } from "./sim.js";
import { MEN, WOMEN, jobOf, someFamilies } from "./people.js";

// The quarters people live in (by the names the mayor gave them), so a speaker says where they are from.
let livedIn = [], families = [], townNow = null;
function learnQuarters(s) {
  townNow = s;
  families = someFamilies(s);
  const ds = new Set();
  s.tiles.forEach((t, i) => { if (t.b?.id === "house") ds.add(districtOf(i)); });
  livedIn = [...ds].map((d) => districtName(s, d));
}

/**
 * Kinds of people who speak up. They are types, not fixed people: every post gets a new person of
 * that kind (a name, a job that fits what the town really has, the part of town they live in),
 * so a city of thousands is not twelve people talking. The ids are kept for the lines tagged with them.
 */
export const RESIDENTS = [
  { id: "abufahad", gender: "m", cares: ["shops", "roads", "tax", "money", "power"], role: (a) => (a.count.grocery ? "صاحب بقالة" : a.count.cafe ? "صاحب مقهى" : a.count.souq ? "تاجر بالسوق" : "صاحب بسطة") },
  { id: "umsaad", gender: "mother", cares: ["water", "school", "health", "housing", "safety"], role: (a, r) => `أم لـ${nAr(2 + Math.floor(r() * 6))} عيال` },
  { id: "abunasser", gender: "elder", cares: ["mosque", "palms", "tradition", "camels", "change"], role: (a, r) => (a.count.mosque && r() < 0.3 ? "مؤذن المسجد" : "من كبار الحي") },
  { id: "saud", gender: "m", cares: ["jobs", "fun", "tax", "growth"], role: (a) => (a.unemployment > 0.15 ? "شاب يدور شغل" : "موظف") },
  { id: "noura", gender: "f", title: "أ.", cares: ["school", "parks", "growth", "health"], role: (a) => (a.count.school ? "معلمة" : "خريجة تربية") },
  { id: "abukhalid", gender: "father", cares: ["water", "farms", "rain", "dates", "season"], role: (a) => (a.count.palms ? "مزارع نخل" : a.count.veg ? "مزارع خضار" : "مزارع") },
  { id: "mishal", gender: "m", cares: ["roads", "asphalt", "dust", "traffic"], role: (a) => (a.count.asphalt ? "سواق تاكسي" : "سواق جيب") },
  { id: "drYousef", gender: "m", title: "د.", cares: ["health", "pollution", "water", "safety"], role: (a) => (a.count.hospital ? "طبيب بالمستشفى" : a.count.clinic ? "طبيب بالمستوصف" : "ممرض متقاعد") },
  { id: "haya", gender: "f", cares: ["parks", "fun", "deco", "school", "projects"], role: (a) => (a.count.university ? "طالبة جامعة" : a.count.school ? "طالبة" : "بنت تبي تدرس") },
  { id: "mubarak", gender: "uncle", cares: ["camels", "fayda", "rain", "season", "change"], role: () => "راعي إبل" },
  { id: "abuabdullah", gender: "father", cares: ["land", "projects", "growth", "money", "housing"], role: (a) => (a.count.factory || a.count.mall ? "مستثمر" : "تاجر عقار") },
  { id: "jawaher", gender: "f", cares: ["shops", "events", "power", "safety", "tax"], role: (a) => (a.grid ? "صاحبة مشغل خياطة" : "تبيع بالسوق") }
];
export const residentById = (id) => RESIDENTS.find((r) => r.id === id);

const pickName = (list, r) => list[Math.floor(r() * list.length)];
/** A new person of a kind: their name, their job in this town, and where they live. */
export function makePerson(a, kindId, r = Math.random) {
  const k = residentById(kindId) || RESIDENTS[0];
  const family = `آل ${pickName(MEN, r)}`;
  const first = k.gender === "f" ? pickName(WOMEN, r) : pickName(MEN, r);
  const name = k.gender === "mother" ? `أم ${pickName(MEN, r)}` : k.gender === "father" ? `أبو ${pickName(MEN, r)}` : k.gender === "elder" ? `الشايب أبو ${pickName(MEN, r)}` : k.gender === "uncle" ? `العم ${pickName(MEN, r)}` : `${k.title ? k.title + " " : ""}${first} ${family}`;
  const areas = livedIn.length ? livedIn : ["الحارة الشمالية", "الحارة الجنوبية", "الحارة الشرقية", "الحارة الغربية", "وسط البلد"];
  // a real family of the town when there is one: the speaker's name, house and job are theirs
  if (families.length && townNow) {
    const { i, f } = families[Math.floor(r() * families.length)];
    const girl = f.kids.find((c) => !c.boy && c.age >= 14), son = f.kids.find((c) => c.boy && c.age >= 16);
    const real = k.gender === "mother" ? f.mother : k.gender === "father" ? `${f.kunya} ${f.surname}` : k.gender === "elder" ? `الشايب ${f.kunya}` : k.gender === "uncle" ? `العم ${f.father} ${f.surname}`
      : k.gender === "f" ? `${k.title ? k.title + " " : ""}${girl ? girl.name : f.mother.replace("أم ", "")} ${f.surname}` : `${k.title ? k.title + " " : ""}${son && k.id === "saud" ? son.name : f.father} ${f.surname}`;
    const job = (k.gender === "father" || k.gender === "m") && !k.title ? jobOf(townNow, a, i) : null;
    return { name: real, role: job && r() < 0.6 ? `يشتغل في ${job.name}` : k.role(a, r), area: `من ${districtName(townNow, districtOf(i))}`, kind: k.id, home: i };
  }
  const area = `من ${areas[Math.floor(r() * areas.length)]}`;
  return { name, role: k.role(a, r), area, kind: k.id };
}

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

  // Wear, floods, thefts, illness, traffic, strikes
  const worn = s.tiles.filter((t) => t.b && ((t.b.cond ?? 100) < 40 || t.b.ruin)).length;
  if (worn) add("repair", -1, 5 + Math.min(5, worn), [`abuabdullah:فيه ${nAr(worn)} مبنى متهالك بالبلد، وكلفة الترميم ${num(a.repairBill)} ريال. كل ما تأخرنا زاد الخراب، والمبنى اللي يخرب يطيح بعد يومين.`, `umsaad:سقف المدرسة يقطّر والجدران مشققة. رمّموها قبل لا تطيح على العيال.`]);
  if (s.lastFlood !== undefined && s.day - s.lastFlood < 48) add("flood", -1, 9, [`abukhalid:السيل أخذ مزرعتي اللي بالوادي. قلت لهم الوادي خصب بس خطير، والحين ${s.tech.dams ? "حتى السدود ما كفت" : "نحتاج سدود"}.`, `mubarak:الله يعوضنا. السيل جرف كل اللي بقاع الوادي. لا تبنون فيه إلا وأنتم مأمّنين.`]);
  if (a.aquifer < 40) add("aquifer", -1, 8, [`abukhalid:البئر اللي بمزرعتي صار يطلّع نص ماه. الماء الجوفي نزل لـ${nAr(Math.round(a.aquifer))}٪. نبي سد يجمع المطر قبل لا تنشف الآبار كلها.`, `abuabdullah:كل بئر جديد يسحب من نفس الماء. الماء الجوفي ${nAr(Math.round(a.aquifer))}٪ بس، والحل سد على الوادي أو تحلية.`]);
  if ((s.lake || 0) > 40 && a.lakeTiles) add("lake", 1, 4, [`saud:كشتة على بحيرة السد البارحة، والله ما توقعت نشوف ماء بالرافعية كذا!`, `umsaad:العيال يحبون البحيرة، كل عصر نطلع لها.`]);
  if (a.costs.theft > 1) add("safety", -1, 6, [`jawaher:انسرق من المحل البارحة. السرقات تاخذ ${num(a.costs.theft)} ريال بالساعة من محلات البلد. نبي شرطة تغطي الحارات.`]);
  if (a.costs.health > 2) add("pollution", -1, 6, [`drYousef:المستوصف مليان أمراض صدر من الدخان. علاجهم يكلف البلدية ${num(a.costs.health)} بالساعة. بعدوا المصانع عن البيوت.`]);
  if (a.congestion > 0.05) add("traffic", -1, 5, [`mishal:الزحمة ما تنطاق! الطرق الترابية ضيقة والناس صاروا ما يوصلون للسوق. سفلتوها.`]);
  if (s.events.some((e) => e.strike)) add("strike", -1, 8, [`saud:موظفين البلدية مضربين! المدرسة مقفلة والمستوصف مسكّر. أعطوهم حقهم.`]);
  if (s.events.some((e) => e.id === "locust")) add("farms", -1, 6, [`abukhalid:الجراد أكل نص الزرع! ${s.tech.pest ? "الحمد لله على المكافحة، خففت الضرر." : "لو عندنا مكافحة آفات كان سلمنا."}`]);

  // The market and the council's money
  if (a.shopRaw > a.shopDemand * 1.3 && a.shopRaw > 10) add("shops", -1, 6, [`abufahad:المحلات كثرت والزباين نفسهم! الأهالي يصرفون ${num(a.shopDemand)} بالساعة بس، وكل محل يقاسم الثاني. نبي ناس أكثر مو محلات أكثر.`, `jawaher:السوق مشبع، فتحت المشغل وما جاني إلا القليل. البلد تحتاج سكان قبل المحلات.`]);
  if (s.broke) add("money", -1, 12, [`umsaad:البلدية أفلست! المدرسة مقفلة والمستوصف مسكّر. وين راحت الفلوس؟`, `abuabdullah:الإفلاس ما يجي فجأة. المصاريف ${num(a.upkeep)} بالساعة والدخل أقل. قفلوا اللي ما يرجع وارفعوا الدخل.`]);
  else if (s.money < 0) add("money", -1, 9, [`drYousef:المستوصف يشتغل بنص طاقته لأن الرواتب متأخرة. الديون تأثر على صحة الناس.`]);

  // ---- the residents who think it through: how much is missing, where, and what it costs ----
  const n = needs(s, a);
  // homes the pipes do not reach, and where they are
  const dryList = [];
  s.tiles.forEach((t, i) => { if (t.b?.id === "house" && t.b.works && !a.watered?.[i]) dryList.push(i); });
  if (dryList.length) add("water", -1, 8, [`umsaad:${nAr(dryList.length)} بيت ${areaOf(s, dryList)} ما يوصلها ماء أبد، نجيب الماء بالجوالين من بعيد. البئر يوصل لين ٥ مربعات بس، حطوا واحد عندنا.`]);
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

/** Which quarter a set of tiles is mostly in, as "بـ<name>" (the mayor may have renamed it). */
function areaOf(s, list) {
  const counts = new Map();
  for (const i of list) counts.set(districtOf(i), (counts.get(districtOf(i)) || 0) + 1);
  const d = [...counts.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] ?? 4;
  return `ب${districtName(s, d)}`;
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

const TOPIC_NAMES = { aquifer: "الماء الجوفي", repair: "ترميم المباني", traffic: "حل الزحمة", strike: "علاوة الموظفين", water: "الماء", power: "الكهرباء", jobs: "الشغل", mosque: "المسجد", school: "المدرسة", health: "المستوصف", safety: "الأمن", parks: "الحديقة", roads: "الطريق", tax: "تخفيف الضريبة", housing: "البيوت", dust: "سفلتة الطرق", money: "ترتيب الميزانية", pollution: "إبعاد الدخان" };
/** Is anyone still upset about this topic right now? */
/** What the mayor has to do to keep each kind of promise. */
export const FIX_HINT = {
  water: "ابنِ بئر أو خزان قريب من البيوت اللي ما يوصلها ماء",
  aquifer: "ابنِ سد على الوادي يجمع المطر، أو قلل الآبار، أو ابنِ تحلية",
  power: "ابنِ مولد أو ألواح شمسية قريب من البيوت",
  jobs: "افتح محلات أو مزارع أو ورش عشان الوظائف",
  mosque: "ابنِ مسجد قريب من البيوت",
  school: "ابنِ مدرسة قريبة من البيوت",
  health: "ابنِ مستوصف قريب من البيوت",
  safety: "ابنِ مركز شرطة قريب من الحارة",
  parks: "ابنِ حديقة قريبة من البيوت",
  roads: "وصّل البيوت بطريق",
  tax: "نزّل الضريبة من «الأرقام»",
  housing: "انصب خيام جديدة أو طوّر البيوت",
  dust: "سفلت الطرق (بحث «سفلتة الطرق» من المجلس)",
  money: "رجّع الميزانية فوق الصفر",
  pollution: "انقل الورش والمصانع بعيد عن البيوت",
  repair: "رمّم المباني من «الأرقام»",
  traffic: "زد الطرق أو سفلتها",
  strike: "وافق على علاوة الموظفين"
};
export const topicName = (t) => TOPIC_NAMES[t] || "الطلب";

const stillMissing = (s, a, season, topic) => topics(s, a, season, townFacts(s, a, season)).some((t) => t.topic === topic && t.mood < 0);

/**
 * Each town hour: thank the mayor for wishes that came true, and remind of the ones still waiting
 * (asked three days ago) or promises not kept after two days.
 */
export function followUps(s, a, season) {
  learnQuarters(s);
  const posts = [];
  s.demands ||= {}; s.promises ||= [];
  const post = (rec, text, mood, topic, ref) => posts.push({ id: `f-${s.day}-${posts.length}-${topic}`, day: s.day, who: rec.who, person: rec.person || makePerson(a, rec.who), text, mood, topic, likes: agreeing(s, 8), ...(ref ? { ref } : {}) });
  const refOf = (p) => ({ asked: p.asked || "", said: p.said || "", day: p.day });
  // Promises first: a kept promise is thanked once (and closes the same wish); a broken one hurts.
  s.promises = s.promises.filter((p) => {
    if (!stillMissing(s, a, season, p.topic)) { post(p, `وفيت بوعدك يا العمدة. وعدتنا بـ${topicName(p.topic)} وصار. الرجال كلمة 👏`, 1, p.topic, refOf(p)); moodOf(s, p.who, +10); (s.record ||= {}).kept = (s.record.kept || 0) + 1; delete s.demands[p.topic]; return false; }
    if (!p.reminded && s.day - p.day >= 48) {
      post(p, `يا العمدة، قبل يومين طلبنا ${topicName(p.topic)} ووعدتنا. للحين ما صار شي، والوعد دين.`, -1, p.topic, refOf(p));
      posts[posts.length - 1].noCalm = true;
      moodOf(s, p.who, -15); (s.record ||= {}).broken = (s.record.broken || 0) + 1; p.reminded = true;
    }
    return s.day - p.day < 24 * 8;
  });
  // People the mayor fobbed off come back for a real answer.
  s.comebacks = (s.comebacks || []).filter((c) => {
    if (s.day < c.at) return true;
    if (stillMissing(s, a, season, c.topic)) {
      post(c, [`قبل يوم قلت لي «نشوف». شفت؟ ${TOPIC_NAMES[c.topic] || "الموضوع"} للحين ناقص، وأبي جواب واضح: نعم ولا لا.`, `يا العمدة، ما أبي «إن شاء الله نشوف» مرة ثانية. ${TOPIC_NAMES[c.topic] || "طلبنا"}: بتسويه ولا لا؟`][s.day % 2], -1, c.topic, { asked: c.asked || "", said: "إن شاء الله، نشوف الموضوع", day: c.day ?? c.at - 24, calm: true });
      posts[posts.length - 1].noCalm = true;
    }
    return false;
  });
  for (const [topic, d] of Object.entries(s.demands)) {
    const days = Math.round((s.day - d.day) / 24);
    const when = days < 1 ? "بنفس اليوم" : days === 1 ? "بيوم واحد" : days === 2 ? "بيومين" : `بعد ${nAr(days)} أيام`;
    if (!stillMissing(s, a, season, topic)) {
      post(d, `الله يعطيك العافية يا العمدة! طلبنا ${TOPIC_NAMES[topic] || "طلبنا"} وتحقق ${when}. هذا اللي نبيه 👏`, 1, topic);
      delete s.demands[topic];
    } else if (!d.reminded && s.day - d.day >= 72) {
      post(d, `صار لنا ${nAr(days)} أيام نطالب بـ${TOPIC_NAMES[topic] || "حقنا"} وللحين ما صار شي. لا تنسانا يا العمدة.`, -1, topic);
      d.reminded = true;
    }
  }
  return posts;
}

/** Remember the complaints that ask for something (so they can be thanked or followed up). */
export function rememberDemands(s, posts) {
  s.demands ||= {};
  for (const p of posts) if (p.mood < 0 && TOPIC_NAMES[p.topic] && !s.demands[p.topic]) s.demands[p.topic] = { day: s.day, who: p.who, person: p.person };
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
export function maybeAnswer(s, a, post, r = Math.random) {
  const list = (ANSWERS[post.topic] || []).filter(([who]) => who !== post.who);
  if (!list.length || r() > 0.45) return post;
  const [who, , text] = list[Math.floor(r() * list.length)];
  return { ...post, replies: [...(post.replies || []), { from: "res", who, person: makePerson(a, who, r), text }] };
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
export function decisionReaction(s, a, id, choice) {
  const list = REACT[id];
  if (!list) return null;
  const [who, mood, text] = list[Math.min(choice, list.length - 1)];
  return { id: `d-${s.day}-${id}`, day: s.day, who, person: makePerson(a, who), text, mood, topic: "decision", likes: agreeing(s, 6) };
}

/** How many people agree with a post: a share of the town that grows with how much it matters. */
const agreeing = (s, weight, r = Math.random) => Math.max(1, Math.round(s.pop * Math.min(0.85, (weight / 14) * (0.35 + r() * 0.65))));

/** A small seeded random so a day's posts do not change on reload. */
function newsRand(seed) { let x = seed >>> 0 || 1; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }

/**
 * Write `count` new posts. Picks the topics that matter most (weighted), gives each to a
 * resident who cares about it, and avoids lines and topics said recently.
 */
export function writePosts(s, a, season, count = 1) {
  learnQuarters(s);
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
    posts.push(maybeAnswer(s, a, { id: `${s.day}-${k}-${Math.floor(r() * 1e6)}`, day: s.day, who: who.id, person: makePerson(a, who.id, r), text, mood: t.mood, topic: t.topic, likes: agreeing(s, t.weight, r) }, r));
  }
  rememberDemands(s, posts);
  return posts;
}

// ---------- how each resident feels about the mayor, and the answers the mayor can give ----------

/**
 * How much the people trust the mayor (0–100, starts at 60). Every answer moves it a little;
 * kept and broken promises move it more. Returns the new value.
 */
export function moodOf(s, who, change = 0) {
  s.trust = Math.max(0, Math.min(100, (s.trust ?? 60) + change * 0.4));
  return s.trust;
}

const PROMISE_LINE = { aquifer: "أبشر، بنبني سد يرجّع الماء للآبار",  repair: "أبشر، بنرمم المباني", traffic: "أبشر، بنسفلت ونوسع الطرق", strike: "أبشر، بنعطيهم حقهم",  mosque: "أبشر، بنبني مسجد قريب منكم", school: "أبشر، المدرسة جاية", health: "أبشر، بنفتح مستوصف", safety: "أبشر، مركز الشرطة بالطريق", parks: "أبشر، بنسوي حديقة للعوايل",
  water: "أبشر، بنحفر بئر جديد", power: "أبشر، بنزيد الكهرباء", jobs: "أبشر، بنفتح محلات ومزارع للشباب", tax: "أبشر، بنخفف الضريبة", dust: "أبشر، بنسفلت الطرق", roads: "أبشر، بنوصل البيوت بطريق",
  housing: "أبشر، بنبني بيوت جديدة", money: "أبشر، بنرتب الميزانية", pollution: "أبشر، بنبعد الدخان عن البيوت" };
const BUILDING_FOR = { mosque: "mosque", school: "school", health: "clinic", safety: "police", parks: "park", water: "well", power: "generator", jobs: "grocery", dust: "asphalt", roads: "road" };

/** The answers on offer under a post: promise (cheers), calm (they come back later), refuse (upsets). */
export function replyOptions(post) {
  if (post.mood > 0) return [
    { kind: "promise", label: "الله يسعدك، هذا واجبنا 🤝" },
    { kind: "calm", label: "شكرًا لك" },
    { kind: "refuse", label: "خلّونا من المدح واشتغلوا" }
  ];
  const opts = [
    { kind: "promise", label: PROMISE_LINE[post.topic] || "معك حق، بنحلها قريب" },
    { kind: "calm", label: "إن شاء الله، نشوف الموضوع" },
    { kind: "refuse", label: post.topic === "tax" ? "الضريبة باقية، البلد يحتاجها" : "مو أولوية الحين، الميزانية ما تسمح" }
  ];
  return post.noCalm ? opts.filter((o) => o.kind !== "calm") : opts;
}

/**
 * The mayor picks an answer. The resident replies in their own way, with the town's real numbers;
 * their contentment moves, and a promise or a fob-off is remembered. Returns { text, change }.
 */
export function answerPost(s, a, season, post, kind) {
  const who = residentById(post.who);
  const missing = TOPIC_NAMES[post.topic] && stillMissing(s, a, season, post.topic);
  const building = BUILDING_FOR[post.topic] && B[BUILDING_FOR[post.topic]];
  if (post.mood > 0) {
    const change = kind === "promise" ? 4 : kind === "refuse" ? -6 : 1;
    moodOf(s, post.who, change);
    const text = kind === "promise" ? "الله يحفظك يا العمدة، الرافعية بخير دامك فيها." : kind === "refuse" ? "طيب… كنت أشكرك بس 😐" : "العفو، الله يعطيك العافية.";
    return { text, change };
  }
  if (kind === "promise") {
    const change = post.noCalm ? 6 : 8;
    moodOf(s, post.who, change);
    if (missing) { s.promises ||= []; s.promises = s.promises.filter((p) => p.topic !== post.topic); s.promises.push({ who: post.who, person: post.person, topic: post.topic, day: s.day, said: PROMISE_LINE[post.topic] || "معك حق، بنحلها قريب", asked: post.text }); }
    s.comebacks = (s.comebacks || []).filter((c) => c.topic !== post.topic);
    const n = needs(s, a);
    const detail = post.topic === "water" && n.wells ? ` ترى نحتاج ${nAr(n.wells)} ${n.wells === 1 ? "بئر" : "آبار"} بالضبط.` : post.topic === "power" && n.generators ? ` نحتاج ${nAr(n.generators)} مولد على الأقل.` : post.topic === "jobs" && n.jobGap ? ` ${num(n.jobGap)} شخص ينتظرون.` : "";
    const text = missing ? `${post.noCalm ? "هذا الجواب اللي أبيه." : "كلمة عمدة!"} ننتظر، وبنذكّرك إن تأخر.${detail}` : `الله يجزاك خير، ${TOPIC_NAMES[post.topic] || "الموضوع"} ما عليه كلام الحين.`;
    return { text, change };
  }
  if (kind === "calm") {
    s.comebacks ||= [];
    if (missing && !s.comebacks.some((c) => c.topic === post.topic)) s.comebacks.push({ who: post.who, person: post.person, topic: post.topic, at: s.day + 24, day: s.day, asked: post.text });
    const text = post.who === "abunasser" ? "إن شاء الله… بس ترى «نشوف» ما تبني بيت. بكرة أرجع لك." : "طيب، بنصبر يوم. بس بكرة أبي جواب.";
    return { text, change: 0 };
  }
  // refuse: hurts, and hurts more when the money is plainly there
  let change = -10, text;
  if (building && s.money >= building.cost) { change = -15; text = `مو أولوية؟ الميزانية فيها ${num(s.money)} و${building.name} يبي ${num(building.cost)} بس! الناس بتعرف.`; }
  else if (building && a.net > 0) { const h = Math.ceil((building.cost - s.money) / a.net); text = `${building.name} يبي ${num(building.cost)}، والدخل ${num(a.net)} بالساعة. يعني ${h <= 24 ? `${nAr(h)} ساعة` : `${nAr(Math.ceil(h / 24))} أيام`} توفير بس. أفهم إنكم ما تبون.`; }
  else if (post.topic === "tax") text = `الضريبة ${nAr(s.tax)}٪ وتبونها تبقى؟ الناس بدت تفكر تطلع من البلد.`;
  else text = post.who === "abunasser" ? "الله المستعان. اللي ما يسمع من الكبار يندم." : "طيب… الناس بتتذكر هالكلام.";
  moodOf(s, post.who, change);
  s.comebacks = (s.comebacks || []).filter((c) => c.topic !== post.topic);
  return { text, change };
}
