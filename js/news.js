// نشرة الرافعية: what the people of the town are saying.
// Every post comes from the town's real state (water, jobs, services, season, events…), spoken by
// one of the residents in their own voice. When the page runs inside Claude, the residents can
// also speak through Claude itself (see askResidents / replyFrom in main.js).
import { B, ERAS } from "./data.js";

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
  if (f.pop >= 40 && !f.parks && Math.random() < 0.6) add("parks", 0, 4, [`haya:ما فيه مكان نطلع فيه العصر غير الشارع. حديقة صغيرة تكفي العوايل.`, `umsaad:العيال يلعبون بين السيارات. وين الحدائق؟`]);
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
  return out;
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
    posts.push({ id: `${s.day}-${k}-${Math.floor(r() * 1e6)}`, day: s.day, who: who.id, text, mood: t.mood, topic: t.topic, likes: Math.round(t.weight * (2 + r() * 6)) });
  }
  return posts;
}

/** A resident's local reply to the mayor (used when Claude is not available). */
export function localReply(post, said) {
  const who = residentById(post.who);
  const yes = /بنبني|بنسوي|أبشر|ابشر|تم|إن شاء الله|ان شاء الله|قريب|حاضر|نوعدك|وعد/.test(said);
  const no = /لا |ما نقدر|ماعندنا|ما عندنا|مستحيل|بعدين|اصبر|اصبروا/.test(said);
  if (yes) return [`الله يجزاك خير يا العمدة، ننتظر ونشوف 👍`, `كلمة عمدة! الحي كله بيسمع وبيفرح.`, `هذا الكلام اللي نبيه. لا تنسانا.`][Math.floor(Math.random() * 3)];
  if (no) return post.mood < 0 ? `يعني نصبر لين متى؟ ${who.role === "كبير الحي" ? "الصبر زين بس الحاجة ما تنتظر." : "الناس بدت تتعب."}` : `خلاص على راحتكم، بس لا تطولون.`;
  return post.mood < 0 ? `نبي فعل مو كلام يا العمدة 🙏` : `حياك الله يا العمدة، نورتنا.`;
}

/** The instruction Claude gets to speak as the residents. */
export function residentsPrompt(facts, recent, want) {
  return `أنت تكتب منشورات "نشرة الرافعية" في لعبة بناء مدن سعودية. الرافعية قرية نجدية تكبر.
اكتب ${want} منشورات جديدة من الأهالي باللهجة النجدية السعودية، كل واحد بصوت صاحبه.
الأهالي:
${RESIDENTS.map((r) => `- ${r.id}: ${r.name} (${r.role}) — ${r.voice}. يهتم بـ: ${r.cares.join("، ")}`).join("\n")}

حال الرافعية الحين (أرقام حقيقية من اللعبة):
${JSON.stringify(facts)}
معاني: water/power نسبة المتوفر من الحاجة (1 = يكفي). unemployment نسبة البطالة. netPerHour صافي دخل البلدية بالساعة. cap سعة البيوت.

آخر ما قالوه (لا تكرره):
${recent.map((p) => `- ${p.name}: ${p.text}`).join("\n") || "- ما فيه"}

المطلوب: كن ذكيًا جدًا. لاحظ المشاكل الحقيقية في الأرقام وسببها، واذكر الرقم أو اسم المبنى، واقترح حل من مباني اللعبة (بئر، خزان ماء، مسجد، مدرسة، مستوصف، حديقة، مركز شرطة، دفاع مدني، بقالة، مقهى، سوق شعبي، مزرعة نخل، مزرعة خضار، مولد كهرباء، ألواح شمسية، طريق مسفلت، زينة…). خلّ فيهم اللي يشتكي واللي يطالب واللي مبسوط واللي يرد على غيره ويختلف معه. كل منشور جملة أو جملتين (أقل من ٢٠٠ حرف)، بدون إيموجي كثير، وما تذكر إنها لعبة.
أرجع JSON فقط: مصفوفة من {"who": "معرّف الساكن", "text": "الكلام", "mood": -1 أو 0 أو 1}`;
}

/** The instruction for one resident answering the mayor. */
export function replyPrompt(facts, post, thread, said) {
  const r = residentById(post.who);
  return `أنت ${r.name}، ${r.role} في قرية الرافعية النجدية. طبعك: ${r.voice}. تتكلم باللهجة النجدية السعودية.
حال الرافعية الحين: ${JSON.stringify(facts)}
كتبت في نشرة الرافعية: "${post.text}"
${thread.map((m) => `${m.from === "mayor" ? "العمدة" : r.name}: ${m.text}`).join("\n")}
العمدة رد عليك الحين: "${said}"
رد عليه بجملة أو جملتين بذكاء وبشخصيتك، اعتمد على الأرقام الحقيقية، وإذا وعد بشي اشكره بس ذكّره، وإذا تهرّب ناقشه. لا تذكر إنها لعبة. اكتب الرد فقط.`;
}
