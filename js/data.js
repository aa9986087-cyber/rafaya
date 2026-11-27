// Everything the town can build, research and become. Numbers are per in-game day.

export const MAP_SIZE = 72;
/**
 * The town owns the middle (OWN_START … MAP_SIZE − OWN_START, 36 × 36); around it three rings of land
 * are bought in plots, each ring in four sides: the near land (RINGS[0] … OWN_START), the far land,
 * and the edges. A plot further out needs the one inside it on the same side first.
 */
export const OWN_START = 18;
export const RINGS = [12, 6, 0];
// Each side of each ring is split in two halves (a: the west or north half, b: the east or south half),
// so a plot id is side + ring + half: "na" (near north, west half), "e2b" (far east, south half)…
const SIDES = [["n", ["الشمال الغربي", "الشمال الشرقي"]], ["e", ["الشرق الشمالي", "الشرق الجنوبي"]], ["s", ["الجنوب الغربي", "الجنوب الشرقي"]], ["w", ["الغرب الشمالي", "الغرب الجنوبي"]]];
const RING_NAMES = [(n) => `أرض ${n} القريبة`, (n) => `أرض ${n} البعيدة`, (n) => `أطراف ${n}`];
export const PLOTS = RING_NAMES.flatMap((name, k) => SIDES.flatMap(([side, halves]) => ["a", "b"].map((h, j) => ({
  id: `${side}${k ? k + 1 : ""}${h}`, name: name(halves[j]), ...(k ? { needs: `${side}${k > 1 ? k : ""}${h}` } : {})
}))));
/** Each plot costs more than the last one bought. */
export const PLOT_PRICES = [3000, 4500, 6000, 7500, 9000, 11000, 13000, 15000, 18000, 21000, 24000, 28000, 32000, 36000, 41000, 46000, 52000, 58000, 65000, 72000, 80000, 90000, 100000, 115000];

export const GREATER_CITY_STAGE = 5;
/** Town stages: reaching the population opens the stage and its buildings. */
export const ERAS = [
  { id: 0, name: "قرية", pop: 0 },
  { id: 1, name: "بلدة", pop: 250 },
  { id: 2, name: "مدينة", pop: 1200 },
  { id: 3, name: "محافظة", pop: 4000 },
  { id: 4, name: "حاضرة", pop: 9000 },
  { id: GREATER_CITY_STAGE, name: "الحاضرة الكبرى", pop: 23000, worldOnly: true }
];

/**
 * How many military buildings a town may have by stage (the owner's rule): any mix of drone bases, missile pads,
 * radars and air-defence batteries. The command centre and the armory are not counted (one each).
 * Buildings over the limit from before stay; only new ones are refused.
 */
export const MIL_SLOTS = [0, 3, 5, 7, 9, 11];
export const milSlotsUsed = (s) => s.tiles.filter((t) => t.b && B[t.b.id]?.slot).length;
export const milSlotsMax = (s) => MIL_SLOTS[Math.min(s.era || 0, MIL_SLOTS.length - 1)];

export const CITY_MILESTONE = {
  goal: 80,
  amount: 1000,
  title: "وصلنا ٨٠ لاعب!",
  thanks: "يعطيكم العافية يا أهل الجوف! شكرًا لكل من نشر الرافعية وعزم ربعه عليها.",
  signature: "Vamos"
};

/**
 * Time: the town moves forward one hour at a time (one simulation step = one hour),
 * 24 hours make a day, and the year turns through four seasons of SEASON_DAYS days.
 * daylight: share of the day with the sun up (long summer days, longer winter nights; the players asked for long days and short nights).
 */
export const HOURS = 24;
/** A town's name for comparing: two towns in al-Jouf may not share it (spaces, tatweel, hamzas, ة/ه and ى/ي, case all ignored). */
export const townNameKey = (name) => String(name || "").toLowerCase().replace(/[\s_ـ]+/g, "").replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[\u064B-\u0652]/g, "");
export const SEASON_DAYS = 7; // a week a season (was 3: the owner found the seasons and the year too short)
export const SEASONS = [
  { id: "spring", name: "الربيع", daylight: 0.62, start: "دخل الربيع: الفيضة اخضرّت ونوّرت، والناس طلعوا يكشتون." },
  { id: "summer", name: "الصيف", daylight: 0.7, start: "دخل الصيف: الحر شديد، والبيوت تبي ماء أكثر، والفيضة يبست." },
  { id: "autumn", name: "الخريف", daylight: 0.62, start: "دخل الخريف: خفّ الحر وبدأ الصِّرام." },
  { id: "winter", name: "الشتاء", daylight: 0.55, start: "دخل الشتاء: برد وليالي طويلة. الربيع جاي بعده." }
];

// Building categories shown in the build bar.
export const CATS = [
  { id: "home", name: "سكن" },
  { id: "shop", name: "تجارة" },
  { id: "farm", name: "زراعة وصناعة" },
  { id: "util", name: "ماء وكهرباء" },
  { id: "serv", name: "خدمات" },
  { id: "road", name: "طرق" },
  { id: "deco", name: "زينة" },
  { id: "proj", name: "مشاريع كبرى" },
  // only in the world of al-Jouf (see js/war.js): never shown or buildable in a solo town
  { id: "mil", name: "الدفاع والعسكرية", worldOnly: true }
];

/*
 * cost: to build · upkeep: per day · era: stage needed · tech: research needed
 * cap: residents (houses, by level) · jobs / income: workplaces · water / power: + supplies, − uses
 * radius + happy / need: services felt by houses in range · pollute: unhappiness around it
 */
export const B = {
  house: {
    cat: "home", name: "خيمة", cost: 50, upkeep: 0, era: 0, water: -1, power: -1,
    levels: [
      // cost: what the mayor pays to upgrade to this level (nothing upgrades by itself)
      { name: "خيمة", cap: 3 },
      { name: "بيت طين", cap: 6, cost: 200, needs: { road: 1, water: 1 } },
      { name: "بيت شعبي", cap: 10, cost: 700, needs: { road: 1, water: 1, happy: 45 } },
      { name: "فيلا", cap: 16, cost: 2000, needs: { road: 1, water: 1, power: 1, happy: 60, services: 2 } },
      { name: "عمارة", cap: 48, cost: 6000, needs: { road: 1, water: 1, power: 1, happy: 70, services: 4 }, era: 2 },
      { name: "برج سكني", cap: 120, cost: 16000, needs: { road: 1, water: 1, power: 1, happy: 75, services: 4 }, era: 3 },
      { name: "برج سكني شاهق", cap: 180, cost: 49000, needs: { road: 1, water: 1, power: 1, happy: 75, services: 4 }, era: GREATER_CITY_STAGE },
      { name: "مجمّع أبراج سكنية", cap: 270, cost: 98000, needs: { road: 1, water: 1, power: 1, happy: 80, services: 4 }, era: GREATER_CITY_STAGE }
    ],
    text: "طوّر السكن من خيمة إلى بيت ثم عمارة وبرج. المستويات الأعلى تحتاج طريق وماء وكهرباء وخدمات قريبة."
  },
  grocery: { cat: "shop", name: "بقالة", cost: 120, upkeep: 2, era: 0, jobs: 4, income: 14, water: -1, power: -1, radius: 4, happy: 3, text: "وظائف ودخل بسيط، والبيوت اللي حولها (لين ٤ مربعات) مرتاحة إن البقالة قريبة." },
  cafe: { cat: "shop", name: "مقهى", cost: 220, upkeep: 4, era: 0, jobs: 5, income: 22, water: -2, power: -2, radius: 3, happy: 6, text: "وظائف ويفرّح الحارة اللي حوله." },
  bank: { cat: "shop", unique: true, name: "بنك", cost: 400, upkeep: 4, era: 0, jobs: 6, income: 0, water: -1, power: -1, text: "يعطيك قروض: تاخذ المبلغ الحين وتسدده أقساط بالساعة مع فايدة. واحد يكفي البلد." },
  souq: { cat: "shop", name: "سوق شعبي", cost: 600, upkeep: 10, era: 1, jobs: 14, income: 60, water: -2, power: -3, text: "سوق يرفع الدخل كثير." },
  mandi: { cat: "shop", name: "مطعم مندي", cost: 450, upkeep: 6, era: 1, jobs: 9, income: 42, water: -3, power: -3, radius: 4, happy: 8, text: "الكل يحبه: وظائف ورضا." },
  hotel: { cat: "shop", visitors: true, name: "فندق", cost: 2600, upkeep: 30, era: 2, tech: "tourism", jobs: 30, income: 150, water: -8, power: -8, text: "يجيب الزوار والدخل." },
  mall: { cat: "shop", name: "مجمع تجاري", cost: 5200, upkeep: 60, era: 2, jobs: 70, income: 270, water: -10, power: -14, radius: 6, happy: 10, text: "وظائف كثيرة ودخل عالي." },

  palms: { cat: "farm", name: "مزرعة نخل", cost: 150, upkeep: 2, era: 0, jobs: 5, income: 11, water: -5, text: "تمور ودخل. في الوادي تنتج أكثر." },
  veg: { cat: "farm", name: "مزرعة خضار", cost: 200, upkeep: 3, era: 0, jobs: 6, income: 14, water: -6, text: "خضار للسوق." },
  pivot: { cat: "farm", name: "مزرعة محورية", cost: 1500, upkeep: 14, era: 1, jobs: 6, income: 70, water: -6, text: "رشاش دوّار يسقي دايرة قمح كبيرة ويبيعها للصوامع. دخله عالي، بس يسحب من الماء الجوفي كثير." },
  pen: { cat: "farm", name: "حظيرة حلال", cost: 150, upkeep: 3, era: 0, jobs: 3, income: 10, water: -1, text: "غنم وإبل. في الربيع ترعى في الفيضة القريبة (لين ٤ مربعات) ويزيد دخلها النص." },
  livestock: { cat: "farm", name: "سوق الماشية", cost: 900, upkeep: 12, era: 1, jobs: 10, income: 50, water: -2, radius: 3, happy: 4, text: "يبيع الحلال لبرا البلد. كل حظيرة عندك تزيد دخله ١٠٪ (لين الضعف)." },
  workshop: { cat: "farm", name: "ورشة", cost: 400, upkeep: 6, era: 1, jobs: 12, income: 45, power: -4, radius: 2, pollute: 8, text: "وظائف، بس صوتها يزعج الجيران." },
  datefactory: { cat: "farm", name: "مصنع تمور", cost: 1800, upkeep: 25, era: 1, tech: "packing", jobs: 30, income: 110, water: -6, power: -10, radius: 3, pollute: 6, text: "يغلّف التمور ويصدّرها. يحتاج ٦ مزارع نخل موصولة به بطريق عشان يشتغل كامل." },
  quarry: { cat: "farm", name: "كسارة حجر", cost: 700, upkeep: 10, era: 1, onRock: true, jobs: 8, radius: 2, pollute: 6, text: "تنبني على الصخور. تطلّع حجر = مواد بناء (٣ بالساعة) تحتاجها لتطوير البيوت والمحلات." },
  blockfactory: { cat: "farm", name: "مصنع بلوك", cost: 1600, upkeep: 18, era: 1, jobs: 15, power: -6, radius: 2, pollute: 5, text: "يحوّل حجر الكسارات لبلوك: ٨ مواد بناء بالساعة إذا وصلته كسارتين بطريق." },
  dairy: { cat: "farm", name: "مصنع ألبان ومسلخ", cost: 2200, upkeep: 25, era: 1, jobs: 20, income: 90, water: -4, power: -6, radius: 2, pollute: 3, text: "حليب ولحم من حلال الرافعية. يحتاج ٤ حظائر موصولة به بطريق." },
  mill: { cat: "farm", name: "صوامع ومطحنة", cost: 2400, upkeep: 25, era: 1, jobs: 15, income: 100, power: -8, radius: 2, pollute: 3, text: "تطحن قمح المزارع المحورية. تحتاج ٣ مزارع محورية موصولة بها بطريق." },
  olive: { cat: "farm", name: "مزرعة زيتون", cost: 260, upkeep: 3, era: 1, jobs: 6, income: 20, water: -4, text: "الجوف أرض الزيتون: صفوف زيتون تعطي دخل زين، وإذا وصلتها بمعصرة يصير دخلها أكثر." },
  oilpress: { cat: "farm", name: "معصرة زيتون", cost: 2600, upkeep: 26, era: 1, tech: "oliveoil", jobs: 18, income: 130, water: -3, power: -6, radius: 2, pollute: 2, text: "تعصر زيت الجوف وتصدّره. تحتاج ٥ مزارع زيتون موصولة بها بطريق." },
  factory: { cat: "farm", name: "مصنع", cost: 3500, upkeep: 45, era: 2, jobs: 60, income: 200, water: -8, power: -20, radius: 5, pollute: 14, text: "وظائف كثيرة وتلوّث." },

  // reach: how far (in tiles) its water or power gets; homes and shops farther away get none.
  dam: { cat: "util", name: "سد", cost: 2500, upkeep: 15, era: 1, tech: "dams", onWadi: true, buildHours: 48, jobs: 4, text: "ينبني على الوادي. يحجز السيل عن اللي بعده، ويجمع ماء المطر في بحيرة وراه تفرّح الناس وتغذي الماء الجوفي." },
  vault: { cat: "util", worldOnly: true, max: 4, name: "خزنة", cost: 500, upkeep: 1, era: 0, text: "تحفظ فلوس البلدية: كل خزنة تزيد كم تقدر تجمع. طوّرها تشيل أكثر." },
  well: { cat: "util", name: "بئر", cost: 100, upkeep: 2, era: 0, water: 30, reach: 5, text: "ماء ٣٠ وحدة، يوصل للبيوت اللي حوله لين ٥ مربعات." },
  tank: { cat: "util", name: "خزان ماء", cost: 900, upkeep: 12, era: 1, water: 140, reach: 9, power: -2, text: "ماء ١٤٠ وحدة، يوصل لين ٩ مربعات." },
  desal: { cat: "util", name: "محطة تحلية", cost: 4500, upkeep: 50, era: 2, tech: "desal", water: 700, reach: 15, power: -25, text: "ماء ٧٠٠ وحدة، يوصل لين ١٥ مربع." },
  generator: { cat: "util", name: "مولد كهرباء", cost: 700, upkeep: 14, era: 1, power: 70, reach: 7, radius: 3, pollute: 10, text: "كهرباء ٧٠ وحدة لين ٧ مربعات، بس دخانه يزعج اللي حوله ٣ مربعات. حطه بعيد عن البيوت ووصّل الكهرب بعمدان." },
  pole: { cat: "util", name: "عمود كهرباء", cost: 25, upkeep: 0.3, era: 1, pole: true, reach: 3, text: "ينقل الكهرب بسلك: حطه قريب من المولد أو المحطة أو من عمود ثاني (لين ٤ مربعات)، ويوصل الكهرب للي حوله لين ٣ مربعات. كذا تبعد المولد ودخانه عن البيوت." },
  solar: { cat: "util", name: "ألواح شمسية", cost: 1600, upkeep: 6, era: 1, tech: "solar", power: 90, reach: 6, text: "كهرباء ٩٠ وحدة نظيفة، توصل لين ٦ مربعات." },
  windfarm: { cat: "util", name: "مزرعة رياح", cost: 7000, upkeep: 30, era: 2, tech: "wind", power: 450, reach: 13, text: "توربينات رياح مثل اللي بدومة الجندل: كهرباء ٤٥٠ وحدة نظيفة بلا دخان، توصل لين ١٣ مربع." },
  powerplant: { cat: "util", name: "محطة كهرباء", cost: 5000, upkeep: 60, era: 2, power: 600, reach: 14, radius: 5, pollute: 12, text: "كهرباء ٦٠٠ وحدة توصل لين ١٤ مربع." },

  mosque: { cat: "serv", name: "مسجد", cost: 350, upkeep: 4, era: 0, water: -1, power: -1, radius: 5, happy: 14, service: "mosque", text: "يفرّح الحارة اللي حوله." },
  school: { cat: "serv", name: "مدرسة", cost: 600, upkeep: 10, era: 0, water: -2, power: -2, radius: 6, happy: 10, service: "school", text: "تعليم للعيال. البيوت القريبة تتطور أسرع." },
  clinic: { cat: "serv", name: "مستوصف", cost: 700, upkeep: 12, era: 0, water: -2, power: -2, radius: 6, happy: 10, service: "health", text: "صحة الناس." },
  park: { cat: "serv", name: "حديقة", cost: 180, upkeep: 2, era: 0, water: -2, radius: 3, happy: 9, text: "مكان للعوايل." },
  police: { cat: "serv", name: "مركز شرطة", cost: 800, upkeep: 14, era: 1, power: -2, radius: 7, happy: 8, service: "safety", text: "أمان الحارات." },
  civil: { cat: "serv", name: "دفاع مدني", cost: 800, upkeep: 14, era: 1, water: -2, power: -2, radius: 7, happy: 6, service: "safety", text: "يحمي من الحوادث." },
  stadium: { cat: "serv", name: "ملعب", cost: 1400, upkeep: 16, era: 1, water: -4, power: -4, radius: 6, happy: 14, text: "مباريات الحواري." },
  bigmosque: { cat: "serv", name: "جامع كبير", cost: 2400, upkeep: 18, era: 2, water: -3, power: -4, radius: 9, happy: 20, service: "mosque", text: "جامع للمدينة كلها." },
  hospital: { cat: "serv", name: "مستشفى", cost: 4200, upkeep: 50, era: 2, water: -6, power: -8, radius: 11, happy: 18, service: "health", text: "علاج ومواعيد قريبة." },
  library: { cat: "serv", name: "مكتبة عامة", cost: 2200, upkeep: 20, era: 2, water: -2, power: -4, radius: 9, happy: 12, service: "school", jobs: 10, text: "كتب وقاعات للشباب. تعليم ورضا." },
  university: { cat: "serv", name: "جامعة", cost: 6000, upkeep: 70, era: 3, water: -6, power: -10, radius: 12, happy: 18, service: "school", jobs: 30, text: "جامعة الرافعية. فخر المحافظة." },

  // Decorations: cheap, no road needed, they cheer up the streets around them.
  // quarter: a small decoration takes a quarter of a tile (up to 4 of the same on one tile, `n` on it)
  // monument: it can also stand in the middle of a roundabout on the road (the roundabout keeps working)
  // span 2: a big decoration takes 2×2 tiles (its own tile and the ones to its east and south, marked "decopart")
  decopart: { cat: "part", name: "زينة", cost: 0, upkeep: 0, era: 0, text: "جزء من زينة كبيرة." },
  streetpalm: { cat: "deco", quarter: true, name: "نخلة شارع", cost: 40, upkeep: 0, era: 0, radius: 2, happy: 2, text: "نخلة وحدة تزيّن الشارع." },
  flowers: { cat: "deco", quarter: true, name: "حوض زهور", cost: 30, upkeep: 0, era: 0, radius: 2, happy: 2, text: "زهور ملونة على الرصيف." },
  lantern: { cat: "deco", quarter: true, name: "فانوس زينة", cost: 50, upkeep: 1, era: 0, radius: 2, happy: 3, text: "فانوس ينوّر بالليل." },
  fountain: { cat: "deco", name: "نافورة", cost: 260, upkeep: 2, era: 1, radius: 3, happy: 5, text: "ماء وبرودة وسط الحارة." },
  dallah: { cat: "deco", span: 2, monument: true, name: "دوّار الدلة", cost: 420, upkeep: 2, era: 1, radius: 4, happy: 6, text: "دوار بوسطه دلة كبيرة، رمز الكرم." },
  olivetree: { cat: "deco", span: 2, monument: true, name: "نصب الزيتونة", cost: 600, upkeep: 2, era: 1, radius: 4, happy: 7, text: "زيتونة معمّرة وسط دوار: رمز الجوف." },
  bigfountain: { cat: "deco", span: 2, monument: true, name: "نافورة راقصة", cost: 2000, upkeep: 8, era: 2, radius: 6, happy: 11, text: "نافورة كبيرة تنوّر بالليل." },
  incense: { cat: "deco", span: 2, monument: true, name: "مجسم المبخرة", cost: 380, upkeep: 2, era: 1, radius: 4, happy: 6, text: "مبخرة عملاقة تفوح بالطيب." },

  // Grand projects: one of each, very dear, and they take days to build.
  mazayen: { cat: "proj", visitors: true, name: "ميدان مزاين الإبل", cost: 4000, upkeep: 25, era: 1, unique: true, buildHours: 72, jobs: 20, radius: 8, happy: 10, income: 120, water: -3, text: "ميدان لمزاين الإبل يجيب الزوار من كل مكان. كل حظيرة عندك تزيد دخله ٥٪." },
  gate: { cat: "proj", visitors: true, name: "بوابة الرافعية", cost: 5000, upkeep: 20, era: 1, unique: true, buildHours: 48, radius: 9, happy: 12, income: 60, text: "بوابة نجدية كبيرة على مدخل البلد. يفرح فيها الأهالي ويجيب زوار." },
  heritage: { cat: "proj", visitors: true, name: "السوق التراثي", cost: 9000, upkeep: 40, era: 1, unique: true, buildHours: 72, jobs: 40, radius: 7, happy: 10, income: 220, water: -4, power: -4, text: "سوق قديم مرمّم بالطين والخشب، فيه حرف ومطاعم ودلال." },
  tower: { cat: "proj", visitors: true, name: "برج الرافعية", cost: 22000, upkeep: 90, era: 2, unique: true, buildHours: 120, jobs: 60, radius: 14, happy: 15, income: 420, water: -8, power: -16, text: "برج يشوفه الكل من بعيد، فيه مطعم دوّار ومكاتب." },
  marid: { cat: "proj", visitors: true, name: "قلعة مارد", cost: 15000, upkeep: 50, era: 2, unique: true, buildHours: 96, jobs: 25, radius: 10, happy: 14, income: 140, text: "قلعة تراثية مثل قلعة مارد بدومة الجندل: تجيب السياح والفخر." },
  themepark: { cat: "proj", visitors: true, name: "مدينة ألعاب", cost: 30000, upkeep: 110, era: 2, unique: true, buildHours: 120, jobs: 80, radius: 12, happy: 18, income: 300, water: -10, power: -20, text: "دولاب هوا وألعاب: العوايل تجي من كل الجوف." },
  station: { cat: "proj", visitors: true, name: "محطة القطار", cost: 55000, upkeep: 170, era: 3, unique: true, buildHours: 144, jobs: 110, radius: 10, happy: 10, income: 520, power: -20, text: "قطار الشمال يوقف بالرافعية: زوار وتجارة كثيرة." },
  bigstadium: { cat: "proj", visitors: true, name: "استاد الجوف", cost: 70000, upkeep: 200, era: 3, unique: true, buildHours: 168, jobs: 120, radius: 14, happy: 22, income: 560, water: -12, power: -24, text: "استاد كبير للدوري: مباريات وجماهير ورضا." },
  skyline: { cat: "proj", visitors: true, name: "أبراج الرافعية", cost: 140000, upkeep: 380, era: 4, unique: true, buildHours: 240, jobs: 400, radius: 16, happy: 20, income: 1300, water: -20, power: -40, text: "مركز مال وأعمال بأبراج زجاج: تاج الحاضرة." },
  airport: { cat: "proj", visitors: true, name: "مطار الرافعية", cost: 45000, upkeep: 160, era: 3, unique: true, buildHours: 168, jobs: 150, radius: 10, happy: 8, income: 900, water: -10, power: -30, pollute: 4, text: "رحلات داخلية تربط الرافعية بالمملكة. أكبر مشروع في المحافظة." },

  // Defence (world of al-Jouf only). Levels, capacities and the rest of the war rules are in MIL below and js/war.js.
  // hq: everything military needs the command centre first; max: how many a town may have.
  milhq: { cat: "mil", worldOnly: true, unique: true, name: "مركز القيادة العسكرية", cost: 2500, upkeep: 15, era: 1, power: -4, text: "قلب القوة العسكرية: منه تدير الترسانة والدفاع والعمليات والعلاقات مع المدن. كل شي عسكري يحتاجه أول." },
  dronebase: { cat: "mil", worldOnly: true, hq: true, slot: true, name: "قاعدة المسيّرات", cost: 1200, upkeep: 10, era: 1, power: -3, text: "هنقر يجهّز المسيّرات ويخزنها ويطلقها. كل تطوير يزيد السعة ويفتح مسيّرات أقوى." },
  radar: { cat: "mil", worldOnly: true, hq: true, slot: true, name: "محطة الرادار والإنذار المبكر", cost: 1000, upkeep: 8, era: 1, power: -6, text: "رادار يدور طول الوقت: يرصد الهجمات قبل وصولها ويرفع دقة الدفاع الجوي. بدونه الدفاع شبه أعمى." },
  airdef: { cat: "mil", worldOnly: true, hq: true, slot: true, name: "بطارية الدفاع الجوي", cost: 1600, upkeep: 12, era: 1, power: -3, text: "تعترض الصواريخ والمسيّرات الجاية لمدينتك بذخيرة اعتراضية تشتريها. كل مستوى أدق وأقوى ضد الصواريخ." },
  missilepad: { cat: "mil", worldOnly: true, hq: true, slot: true, name: "منصة الصواريخ", cost: 3000, upkeep: 20, era: 2, power: -5, text: "منصة إطلاق صواريخ بعيدة المدى، تنرفع قبل الإطلاق وتنجهز بعده. كل تطوير يزيد الصواريخ ويقصّر وقت التجهيز." },
  barracks: { cat: "mil", worldOnly: true, hq: true, unique: true, name: "معسكر الجنود", cost: 2000, upkeep: 12, era: 1, power: -2, text: "يدرّب جنود مشاة وقوات خاصة وقناصة، عشان تزحف فيهم على قلعة مارد بنص الجوف. كل تطوير يزيد عدد الجنود ويسرّع التدريب." },
  armory: { cat: "mil", worldOnly: true, hq: true, unique: true, name: "مستودع الذخائر", cost: 1500, upkeep: 5, era: 1, text: "يزيد سعة تخزين المسيّرات والصواريخ والذخيرة الاعتراضية ٥٠٪، ويعرض المخزون كله." },

  road: { cat: "road", name: "طريق ترابي", cost: 8, upkeep: 0, era: 0, cap: 45, text: "يوصل البيوت والمحلات ببعض. يتزحم بسرعة." },
  asphalt: { cat: "road", name: "طريق مسفلت", cost: 25, upkeep: 0, era: 1, tech: "asphalt", radius: 1, happy: 2, cap: 110, text: "أنظف وأحسن من الترابي، ويشيل ضعف السيارات." },
  powerroad: { cat: "road", name: "طريق مكهرب", cost: 90, upkeep: 1, era: 1, tech: "asphalt", radius: 1, happy: 2, cap: 110, reach: 2, wire: true, text: "طريق مسفلت معه أعمدة كهرب: ينقل الكهرب على طوله (إذا اتصل بمولد أو محطة أو عمود) ويوصّله للمباني لين مربعين من جنبه." },
  avenue: { cat: "road", name: "شارع رئيسي", cost: 60, upkeep: 1, era: 1, tech: "asphalt", radius: 1, happy: 2, cap: 300, text: "مسارين بكل اتجاه وجزيرة نخل بالنص. يشيل زحمة كبيرة: حطه على الطرق اللي توصل الحارات بالشغل." },
  roundabout: { cat: "road", name: "دوار", cost: 120, upkeep: 1, era: 1, tech: "asphalt", radius: 1, happy: 3, cap: 240, junction: true, text: "حطه على التقاطعات: السيارات تمشي بدون ما توقف، والتقاطع يشيل أكثر بكثير." },
  signal: { cat: "road", name: "إشارة مرور", cost: 80, upkeep: 1, era: 1, tech: "asphalt", cap: 170, junction: true, text: "تنظّم التقاطع الزحمة. أرخص من الدوار بس تشيل أقل." },
  parking: { cat: "road", name: "مواقف", cost: 60, upkeep: 0, era: 1, tech: "asphalt", radius: 2, text: "جنب المحلات: الزباين يلقون مكان، فالمحلات القريبة تبيع ١٠٪ أكثر والطرق حولها تخف." }
};

// A long game: building is dear next to what the town earns. Every price above is multiplied
// here (roads less, so a player can still lay out streets).
export const PRICE = { build: 3, road: 2, tech: 3, upkeep: 2, bigIncome: 0.85, shop: 2 };
// State support for trade: shops and markets cost 30% less (the full price is kept to show the saving).
export const SUBSIDY = { shop: 0.3 };
for (const d of Object.values(B)) {
  d.cost = Math.round(d.cost * (d.cat === "road" || d.cat === "deco" ? PRICE.road : PRICE.build) * (d.cat === "shop" ? PRICE.shop : 1)); // shops cost double again
  d.upkeep = Math.round((d.upkeep || 0) * PRICE.upkeep);
  if (d.income && d.era >= 2) d.income = Math.round(d.income * PRICE.bigIncome); // big city earners pay less
  if (SUBSIDY[d.cat]) { d.fullCost = d.cost; d.cost = Math.round(d.cost * (1 - SUBSIDY[d.cat])); }
}

// These are final prices after the ordinary catalog's price adjustments.
// The greater city opens at 23,000 people (it was 15,000): its prices, its strongroom and its vaults were all
// raised by the same ×1.53 (owner, 2026-11-26), so the path costs the same effort for the bigger town.
export const GREATER_CITY_PROJECTS = {
  civic_offices: { name: "مجمّع الأعمال", cost: 430000, upkeep: 650, jobs: 350, income: 1200, power: -45, water: -30, buildHours: 48, text: "مكاتب وشركات توفر وظائف للمدينة." },
  civic_expo: { name: "مركز معارض الجوف", cost: 845000, upkeep: 1350, jobs: 360, income: 1000, visitors: true, power: -85, water: -50, buildHours: 72, text: "معارض تجيب الزوار وتخدم سياحة المدينة." },
  civic_freight: { name: "مركز شحن الجوف", cost: 1535000, upkeep: 2100, jobs: 460, income: 1700, power: -90, water: -40, buildHours: 96, text: "مركز لشحن بضائع المصانع والمزارع ويوفر وظائف." },
  civic_water: { name: "مجمّع المياه", cost: 1455000, upkeep: 2200, jobs: 100, water: 2600, power: -180, reach: 20, buildHours: 120, text: "يزيد إمداد أحياء الحاضرة بالمياه." },
  civic_energy: { name: "مجمّع الطاقة", cost: 1610000, upkeep: 2000, jobs: 120, power: 2200, water: -55, reach: 20, buildHours: 120, text: "يزيد إمداد أحياء الحاضرة بالكهرباء. ينبني بعد تشغيل مجمّع المياه." },
  civic_tower: { name: "برج الحاضرة", cost: 2145000, upkeep: 3100, jobs: 330, income: 1900, visitors: true, power: -120, water: -70, radius: 16, happy: 20, buildHours: 144, text: "معلم يظهر من بعيد. يحتاج تشغيل خزائن الحاضرة الأربع ومجمّعي المياه والطاقة." },
  civic_culture: { name: "المجمّع الثقافي", cost: 3220000, upkeep: 2800, jobs: 230, income: 1800, visitors: true, power: -140, water: -90, radius: 18, happy: 24, buildHours: 168, text: "مسرح ومتاحف وساحات تفرّح أهل المدينة وتجيب زوار." }
};
for (const [id, project] of Object.entries(GREATER_CITY_PROJECTS)) {
  B[id] = { ...project, cat: "proj", unique: true, worldOnly: true, era: GREATER_CITY_STAGE };
}

// Farms, shops and workshops grow in place: each step costs part of the building's price and
// earns more (with more staff and running costs). The last step needs a town (بلدة) and, for shops and
// workshops, electricity reaching the building; for farms, water reaching it.
export const BIZ_LEVELS = {
  palms: ["مزرعة نخل", "نخل بالري الحديث", "نخيل كبرى", "شركة تمور"],
  veg: ["مزرعة خضار", "بيوت محمية", "مزرعة حديثة", "مزرعة ذكية"],
  olive: ["مزرعة زيتون", "زيتون بالري الحديث", "بستان زيتون كبير", "شركة زيتون"],
  grocery: ["بقالة", "تموينات", "سوبرماركت", "هايبر ماركت"],
  cafe: ["مقهى", "مقهى كبير", "كوفي حديث", "سلسلة مقاهي"],
  souq: ["سوق شعبي", "سوق مسقوف", "سوق كبير", "سوق مركزي"],
  mandi: ["مطعم مندي", "مطعم مندي كبير", "مطاعم ومطابخ", "مجمع مطاعم"],
  workshop: ["ورشة", "ورشة كبيرة", "مجمع ورش", "مدينة صناعية"],
  dairy: ["مصنع ألبان ومسلخ", "مصنع ألبان كبير", "مجمع أغذية", "شركة أغذية"],
  mill: ["صوامع ومطحنة", "صوامع كبيرة", "مجمع حبوب", "شركة مطاحن"],
  oilpress: ["معصرة زيتون", "معصرة حديثة", "مصنع زيت كبير", "شركة زيت الجوف"],
  pen: ["حظيرة حلال", "حظيرة كبيرة", "عزبة", "مشروع حلال"],
  // services grow too: they cheer more people, further away
  mosque: ["مسجد", "مسجد بمنارتين", "جامع الحي", "جامع كبير بساحات"],
  hospital: ["مستشفى", "مستشفى تخصصي", "مدينة طبية", "مدينة طبية جامعية"]
};
/** What each step does: its price (× the building's price) and how income, staff and running costs grow. */
export const BIZ_UP = [
  { cost: 0, income: 1, jobs: 1, upkeep: 1, happy: 1, radius: 0 },
  { cost: 0.7, income: 1.6, jobs: 1.4, upkeep: 1.5, happy: 1.35, radius: 1 },
  { cost: 1.4, income: 2.3, jobs: 1.8, upkeep: 2, happy: 1.7, radius: 2, era: 1 },
  { cost: 2.6, income: 3.3, jobs: 2.3, upkeep: 2.7, happy: 2.1, radius: 3, era: 3 }
];
export const GREATER_CITY_UPGRADES = {
  mall: { name: "مول الجوف الكبير", from: 0, cost: 33500, income: 1.45, jobs: 1.45, upkeep: 1.5, happy: 1.2, radius: 1 },
  hospital: { name: "مستشفى إقليمي", from: 3, cost: 110000, mats: 57, jobs: 2.9, upkeep: 3.4, happy: 2.4, radius: 5 },
  university: { name: "جامعة الجوف البحثية", from: 0, cost: 27500, jobs: 1.55, upkeep: 1.55, happy: 1.3, radius: 2 },
  themepark: { name: "مدينة ألعاب كبرى", from: 0, cost: 138000, income: 1.45, jobs: 1.4, upkeep: 1.5, happy: 1.2, radius: 1 },
  airport: { name: "مطار دولي", from: 0, cost: 207000, income: 1.5, jobs: 1.5, upkeep: 1.6 },
  station: { name: "محطة قطار الجوف الكبرى", from: 0, cost: 253000, income: 1.45, jobs: 1.4, upkeep: 1.45, radius: 1 },
  bigstadium: { name: "استاد الجوف الكبير", from: 0, cost: 322000, income: 1.5, jobs: 1.45, upkeep: 1.55, happy: 1.25, radius: 1 },
  skyline: { name: "أبراج الرافعية الكبرى", from: 0, cost: 644000, income: 1.55, jobs: 1.5, upkeep: 1.7, happy: 1.25, radius: 1 },
  desal: { name: "محطة تحلية كبرى", from: 0, cost: 20700, capacity: 1.65, upkeep: 1.55 },
  powerplant: { name: "محطة كهرباء كبرى", from: 0, cost: 23000, capacity: 1.65, upkeep: 1.55 },
  avenue: { name: "شارع سريع", from: 0, cost: 185, capacity: 1.6, upkeep: 1.4 }
};
export const greaterCityUpgrade = (b) => GREATER_CITY_UPGRADES[b?.id];
export const bizLevel = (b) => {
  const civic = greaterCityUpgrade(b);
  if (civic && b.lvl > civic.from) return { ...BIZ_UP[0], ...civic };
  return (b?.id === "vault" ? { ...BIZ_UP[0], upkeep: VAULT[b.lvl || 0]?.upkeepX || 1 } : MIL[b?.id] ? MIL_UP[b.lvl || 0] : BIZ_UP[(BIZ_LEVELS[b?.id] && b.lvl) || 0]) || BIZ_UP[0];
};

/**
 * Money storage in al-Jouf (world only): the council's own strongroom holds BASE_VAULT for its stage, and
 * each vault adds its level's cap. Hourly income stops at the total; one-off sums (loans, rewards, refunds,
 * gifts) still come in, and money already above the cap is never taken.
 * Sized from the world's economy (2026-11-24): the base holds about a stage's dearest everyday building and
 * a year's province fee; the dearest projects (27k at بلدة, 90k مدينة, 210k محافظة, 420k حاضرة) need vaults.
 * `up` is the price of reaching that level; upkeepX × the vault's upkeep (2) an hour.
 */
export const BASE_VAULT = [5000, 15000, 50000, 150000, 400000, 615000];
export const CENTRAL_VAULT_LEVEL = 5;
// Prices (2026-11-24, the owner: "not easy, but fair"): about 40% of the capacity a level adds, roughly a
// game day of a careful town's net income at that stage, and always less than the stage's own strongroom
// holds (so nobody is stuck unable to pay). Each extra vault costs half as much again (VAULT_MORE).
export const VAULT = [
  { name: "خزنة صغيرة", era: 0, cap: 5000, up: 0, upkeepX: 1 },
  { name: "خزنة حديد", era: 1, cap: 15000, up: 6000, upkeepX: 2 },
  { name: "خزنة مصفّحة", era: 2, cap: 40000, up: 18000, upkeepX: 4 },
  { name: "بيت المال", era: 3, cap: 120000, up: 50000, upkeepX: 7.5 },
  { name: "خزينة الحاضرة", era: 4, cap: 350000, up: 140000, upkeepX: 15 },
  { name: "الخزنة المركزية", era: GREATER_CITY_STAGE, cap: 1075000, up: 950000, upkeepX: 30 } // up stays under what one strongroom and one خزينة الحاضرة hold, so the first central vault is always within reach
];
export const VAULT_MORE = 0.5;

/**
 * Military buildings (world of al-Jouf only) grow in up to three levels. Each level: its name, the
 * stage the town needs, and what it does (read by js/war.js on the server and in the game).
 *   milhq: ops = operations in the air at once, guard = extra interception chance
 *   dronebase: cap = drones stored, salvo = drones in one operation, reload = minutes before the next launch
 *   missilepad: cap = missiles, reload = minutes
 *   radar: detect = how much it sharpens the air defence
 *   airdef: vsDrone / vsMissile = interception chance, intc = interceptors it holds
 *   armory: store = × storage of everything
 */
export const MIL = {
  milhq: [{ name: "مركز قيادة صغير", era: 1, ops: 1, guard: 0.02 }, { name: "مقر قيادة متطور", era: 2, ops: 2, guard: 0.04 }, { name: "قيادة عسكرية إقليمية", era: 3, ops: 3, guard: 0.06 }],
  dronebase: [{ name: "هنقر مسيّرات", era: 1, cap: 2, salvo: 2, reload: 4 }, { name: "قاعدة مسيّرات", era: 2, cap: 4, salvo: 3, reload: 3 }, { name: "قاعدة مسيّرات كبرى", era: 3, cap: 6, salvo: 4, reload: 2 }],
  missilepad: [{ name: "منصة صواريخ", era: 2, cap: 1, reload: 8 }, { name: "منصة صواريخ مزدوجة", era: 2, cap: 2, reload: 6 }, { name: "مجمع صواريخ", era: 3, cap: 3, reload: 4 }],
  radar: [{ name: "رادار إنذار", era: 1, detect: 0.85 }, { name: "رادار بعيد المدى", era: 2, detect: 1 }, { name: "منظومة رادار متقدمة", era: 3, detect: 1.12 }],
  airdef: [{ name: "دفاع جوي قصير المدى", era: 1, vsDrone: 0.4, vsMissile: 0.15, intc: 4 }, { name: "دفاع جوي متوسط المدى", era: 2, vsDrone: 0.52, vsMissile: 0.35, intc: 8 }, { name: "دفاع جوي متقدم", era: 3, vsDrone: 0.62, vsMissile: 0.5, intc: 12 }],
  armory: [{ name: "مستودع الذخائر", era: 1, store: 1.5 }],
  barracks: [{ name: "معسكر تدريب", era: 1, cap: 30, speed: 1 }, { name: "معسكر كتيبة", era: 2, cap: 60, speed: 0.8 }, { name: "قاعدة لواء", era: 3, cap: 100, speed: 0.6 }]
};
/** A military level's price (× the building's price) and running costs (× its upkeep); nothing else changes. */
export const MIL_UP = [
  { cost: 0, income: 1, jobs: 1, upkeep: 1, happy: 1, radius: 0 },
  { cost: 1.5, income: 1, jobs: 1, upkeep: 1.6, happy: 1, radius: 0 },
  { cost: 3, income: 1, jobs: 1, upkeep: 2.4, happy: 1, radius: 0 }
];

// The five prayers, by the town's hour (hour 0 is sunrise; D is the hours of daylight that season).
export const PRAYERS = [
  { id: "fajr", name: "الفجر", at: () => 23 },
  { id: "dhuhr", name: "الظهر", at: (D) => Math.round(D / 2) },
  { id: "asr", name: "العصر", at: (D) => Math.round(D * 0.75) },
  { id: "maghrib", name: "المغرب", at: (D) => Math.round(D) },
  { id: "isha", name: "العشاء", at: (D) => Math.round(D) + 2 }
];

// The town's quarters: the land in a 3×3 grid. The mayor can rename them.
export const DISTRICT_NAMES = ["الحارة الشمالية الغربية", "الحارة الشمالية", "الحارة الشمالية الشرقية", "الحارة الغربية", "وسط البلد", "الحارة الشرقية", "الحارة الجنوبية الغربية", "الحارة الجنوبية", "الحارة الجنوبية الشرقية"];

// Elections for the municipal council, at the end of every year. Winning brings a grant from the
// province; losing doubles next year's province fee (the province sends an inspector).
export const ELECTION_GRANT = [1500, 5000, 15000, 40000, 40000, 60000];

// Groundwater under the town: wells and tanks pump it, rain and dam lakes refill it.
// Below LOW the wells give less water, down to 35% when it is empty.
/** Lightning while it rains: the chance of a bolt each rainy hour, and how much of a building's condition it takes (repairable). */
export const LIGHTNING = { chance: 0.12, min: 15, max: 35 };
export const GROUND = { start: 100, low: 40, pump: 0.0003, pivot: 0.06, base: 0.05, rain: 0.5, lake: 0.2, dam: 0.12, spring: 0.03 };
/** Price of filling a tile of wadi ground with earth (no more floods there, no more fertile ground). */
export const FILL_COST = 80;

// Production chains: farms send their goods by truck, along the roads, to the factory that works them.
// A factory runs at 30% with nothing coming in and at full power with `need` producers linked by road.
export const CHAINS = [
  { id: "dates", name: "التمور", from: "palms", to: "datefactory", need: 6, cargo: "#8a5a2b" },
  { id: "meat", name: "الحلال", from: "pen", to: "dairy", need: 4, cargo: "#f1ece0" },
  { id: "market", name: "سوق الماشية", from: "pen", to: "livestock", need: 4, cargo: "#c49a63" },
  { id: "wheat", name: "القمح", from: "pivot", to: "mill", need: 3, cargo: "#d9b54a" },
  { id: "stone", name: "الحجر", from: "quarry", to: "blockfactory", need: 2, cargo: "#a9a196" },
  { id: "olive", name: "الزيتون", from: "olive", to: "oilpress", need: 5, cargo: "#6b7a2a" }
];
// Building materials: quarries and block factories make them; upgrades use them. What is missing is
// bought from outside at MAT_PRICE a unit; the store holds MAT_CAP, and the rest is sold at MAT_SELL.
export const MAT = { price: 20, sell: 6, cap: 400, quarry: 3, block: 8, house: [0, 0, 4, 20, 80, 260, 364, 728], biz: [0, 0, 12, 45] };

// Everything a car can drive on.
export const ROAD_IDS = ["road", "asphalt", "powerroad", "avenue", "roundabout", "signal"];
// Traffic: each resident makes this many car trips an hour at rush time; a plain crossing (three or
// four roads meeting) carries this share of its road's capacity unless it has a roundabout or lights.
export const TRAFFIC = { perResident: 0.3, crossing: 0.75 };

// The region around الرافعية: places where new towns can be founded, each on its own kind of land.
// x, y are positions on the region map (0–100).
export const TERRAINS = {
  wadi: { name: "على الوادي", text: "وادي يمر بين الرمل والصخور: أرض خصبة للنخل والمزارع، بس تجيه السيول." },
  mountain: { name: "جبلية", text: "صخور كثيرة (حجر للكسارات) ووادي ضيق، والماء الجوفي أقل." },
  dunes: { name: "نفود", text: "رمل بلا صخور ولا وادي: أرض واسعة للبناء، بس المزارع ما تحب الرمل." },
  meadow: { name: "روضة", text: "فياض كثيرة تخضر بالربيع: الحلال يرعى، والناس يحبون الكشتات." },
  bigwadi: { name: "شعيب كبير", text: "وادي عريض وخصب للمزارع، بس السيول فيه قوية." },
  plain: { name: "سهل", text: "أرض مستوية فيها ماء جوفي كثير: الآبار تعطي زين." }
};
export const SITES = [
  { id: "main", x: 50, y: 52, terrain: "wadi", name: "الرافعية" },
  { id: "radifah", x: 22, y: 30, terrain: "meadow", name: "الرديفة" },
  { id: "adharea", x: 24, y: 78, terrain: "mountain", name: "الأضارع" },
  { id: "saffan", x: 80, y: 26, terrain: "dunes", name: "صفان" }
];
// Founding a town: paid by the town you are in; each one costs more. A road between two towns costs
// per unit of distance on the region map. Linked towns buy from each other.
export const REGION = { found: [15000, 30000, 60000, 120000, 200000], startMoney: 2500, roadPerUnit: 120, unlockEra: 1 };

// The world of al-Jouf: one map shared by every player, in plots (COLS × ROWS). Each part of the
// region has its own land; the names mark where the real places are (roughly).
// The map grew twice, and every plot keeps its number: first 24 × 16 (plots 0 … 383), then 40 × 26 round it
// (numbered after them, in reading order), then 6 columns more on each side, 52 × 26 (numbered after those,
// in reading order). On today's map the 40 × 26 one starts at column 6.
export const WORLD = {
  cols: 52, rows: 26, old: { cols: 40, rows: 26, x: 6, y: 0 }, first: { cols: 24, rows: 16, x: 14, y: 5 },
  places: [
    { name: "القريات", x: 17, y: 8, terrain: "mountain", r: 3.2 },
    { name: "طبرجل", x: 22, y: 10, terrain: "plain", r: 3 },
    { name: "دومة الجندل", x: 25, y: 14, terrain: "bigwadi", r: 2.6 },
    { name: "الرافعية", x: 20, y: 15, terrain: "wadi", r: 2.2 },
    { name: "سكاكا", x: 28, y: 12, terrain: "wadi", r: 3 },
    { name: "الحماد", x: 27, y: 7, terrain: "mountain", r: 4 },
    { name: "النفود الكبير", x: 32, y: 19, terrain: "dunes", r: 7 },
    { name: "روضات الجوف", x: 34, y: 9, terrain: "meadow", r: 3 },
    { name: "الحديثة", x: 11, y: 6, terrain: "plain", r: 2.6 },
    { name: "العيساوية", x: 15, y: 12, terrain: "plain", r: 2.2 },
    { name: "الشويحطية", x: 29, y: 3, terrain: "mountain", r: 2.6 },
    { name: "صوير", x: 38, y: 12, terrain: "plain", r: 2.6 },
    { name: "ميقوع", x: 31, y: 14, terrain: "wadi", r: 2 },
    { name: "أبو عجرم", x: 39, y: 18, terrain: "dunes", r: 2.6 },
    // added with the map's widening (2026-11-25): west and east of الرافعية, as on the region map
    { name: "الأضارع", x: 16, y: 16, terrain: "mountain", r: 2.4 },
    { name: "الرديفة", x: 23, y: 17, terrain: "meadow", r: 2.4 },
    { name: "زلوم", x: 24, y: 21, terrain: "meadow", r: 2.2 }
  ]
};
const FIRST = WORLD.first, FIRST_N = FIRST.cols * FIRST.rows, OLD = WORLD.old;
const inFirst = (x, y) => x >= FIRST.x && x < FIRST.x + FIRST.cols && y >= FIRST.y && y < FIRST.y + FIRST.rows;
const inOld = (x, y) => x >= OLD.x && x < OLD.x + OLD.cols && y >= OLD.y && y < OLD.y + OLD.rows;
const ADDED = [], ADDED_AT = new Map(), WIDE = [], WIDE_AT = new Map();
for (let y = OLD.y; y < OLD.y + OLD.rows; y++) for (let x = OLD.x; x < OLD.x + OLD.cols; x++) if (!inFirst(x, y)) { ADDED_AT.set(y * WORLD.cols + x, ADDED.length); ADDED.push([x, y]); }
for (let y = 0; y < WORLD.rows; y++) for (let x = 0; x < WORLD.cols; x++) if (!inOld(x, y)) { WIDE_AT.set(y * WORLD.cols + x, WIDE.length); WIDE.push([x, y]); }
/** Where a plot is on the map ([-1, -1] if there is no such plot). */
export function worldXY(plot) {
  if (plot >= 0 && plot < FIRST_N) return [(plot % FIRST.cols) + FIRST.x, Math.floor(plot / FIRST.cols) + FIRST.y];
  if (plot < FIRST_N + ADDED.length) return ADDED[plot - FIRST_N] || [-1, -1];
  return WIDE[plot - FIRST_N - ADDED.length] || [-1, -1];
}
/** The plot number of a place on the map. */
export function worldPlot(x, y) {
  if (inFirst(x, y)) return (y - FIRST.y) * FIRST.cols + (x - FIRST.x);
  if (inOld(x, y)) return FIRST_N + ADDED_AT.get(y * WORLD.cols + x);
  return FIRST_N + ADDED.length + WIDE_AT.get(y * WORLD.cols + x);
}
/** Towns that stood before الأضارع and الرديفة were added keep the place (and the landmarks) they had. */
const PLACE_KEEP = { 219: "العيساوية", 243: "الرافعية", 249: "دومة الجندل", 267: "الرافعية", 268: "الرافعية", 272: "الرافعية", 273: "دومة الجندل", 274: "دومة الجندل", 291: "الرافعية", 292: "الرافعية", 295: "الرافعية", 296: "الرافعية", 297: "النفود الكبير" };
/** The nearest named place to a plot. */
export function worldPlace(plot) {
  if (PLACE_KEEP[plot]) return PLACE_KEEP[plot];
  const [x, y] = worldXY(plot);
  return WORLD.places.reduce((b, p) => (Math.hypot(x - p.x, y - p.y) / p.r < Math.hypot(x - b.x, y - b.y) / b.r ? p : b)).name;
}
/** The kind of land of a plot: the nearest place inside its reach, the dunes to the south-east, plain elsewhere. */
export function worldTerrain(plot) {
  const [x, y] = worldXY(plot);
  let best = null, bd = 1e9;
  for (const p of WORLD.places) { const d = Math.hypot(x - p.x, y - p.y) / p.r; if (d < 1 && d < bd) { bd = d; best = p; } }
  if (best) return best.terrain;
  if (y <= 2) return "mountain"; // the stony Hamad to the north
  return y >= 16 || (x >= 31 && y >= 13) ? "dunes" : "plain";
}

// Bank loans: the money now, paid back every hour with interest. Paying early skips the interest left.
export const LOANS = [
  { id: "small", name: "قرض صغير", amount: 3000, days: 5, rate: 0.15 },
  { id: "mid", name: "قرض متوسط", amount: 10000, days: 10, rate: 0.2 },
  { id: "big", name: "قرض كبير", amount: 30000, days: 20, rate: 0.25 }
];

/** The municipal council's research. Takes money and hours ("days" counts hours); each one stays forever. */
export const TECH = {
  irrigation: { name: "الري بالتنقيط", cost: 500, days: 6, era: 0, text: "المزارع تنتج أكثر بـ٣٠٪ وتصرف ماء أقل." },
  asphalt: { name: "سفلتة الطرق", cost: 600, days: 6, era: 1, text: "يفتح الطريق المسفلت، ويرفع رضا الناس حوله." },
  packing: { name: "تغليف التمور", cost: 900, days: 8, era: 1, text: "يفتح مصنع التمور." },
  concrete: { name: "البناء المسلّح", cost: 1200, days: 8, era: 1, text: "البيوت تسكّن ناس أكثر بـ٢٥٪." },
  solar: { name: "الطاقة الشمسية", cost: 1500, days: 10, era: 1, text: "يفتح الألواح الشمسية: كهرباء بدون تلوث." },
  zakat: { name: "تنظيم الميزانية", cost: 1000, days: 6, era: 1, text: "مصاريف المباني أقل بـ١٥٪." },
  tourism: { name: "السياحة", cost: 2500, days: 12, era: 2, text: "يفتح الفندق، ومهرجان الرافعية يجيب زوار ودخل." },
  desal: { name: "تحلية المياه", cost: 3000, days: 12, era: 2, text: "يفتح محطة التحلية." },
  smart: { name: "المدينة الذكية", cost: 6000, days: 16, era: 3, text: "الدخل كله أكثر بـ٢٠٪." },
  pest: { name: "مكافحة الآفات", cost: 400, days: 12, era: 0, text: "الجراد ما يضر المزارع إلا شوي." },
  hydro: { name: "الزراعة الحديثة", cost: 800, days: 10, era: 1, text: "مزارع النخل والخضار والزيتون تنتج أكثر بـ١٥٪." },
  oliveoil: { name: "عصر الزيتون", cost: 900, days: 10, era: 1, text: "يفتح معصرة الزيتون: زيت الجوف يتصدّر." },
  recharge: { name: "تغذية الماء الجوفي", cost: 1000, days: 14, era: 1, text: "آبار تغذية ترجّع ماء المطر للأرض: الماء الجوفي يرجع أسرع." },
  floodworks: { name: "تصريف السيول", cost: 1100, days: 14, era: 1, text: "عبّارات وقنوات: السيل يخرّب نص اللي كان يخربه." },
  recycle: { name: "إعادة تدوير المياه", cost: 1400, days: 12, era: 1, text: "البلد كله يصرف ماء أقل بـ١٥٪." },
  efficiency: { name: "ترشيد الكهرباء", cost: 1400, days: 12, era: 1, text: "البلد كله يصرف كهرباء أقل بـ١٥٪." },
  marketing: { name: "التسويق والتجارة الإلكترونية", cost: 1600, days: 12, era: 1, text: "المحلات تبيع أكثر بـ١٥٪." },
  health: { name: "الطب الوقائي", cost: 1600, days: 14, era: 2, text: "فاتورة علاج أمراض الدخان تنزل للنص." },
  security: { name: "الكاميرات الأمنية", cost: 1800, days: 14, era: 2, text: "السرقات تقل ٦٠٪." },
  logistics: { name: "الخدمات اللوجستية", cost: 2000, days: 14, era: 2, text: "المصانع تشتغل كامل بمزارع أقل (٧٠٪ من العدد)." },
  egov: { name: "الحكومة الإلكترونية", cost: 2200, days: 16, era: 2, text: "رواتب موظفي البلدية أقل بـ٢٠٪." },
  heritage: { name: "إحياء التراث", cost: 2400, days: 16, era: 2, text: "دخل الزوار والمشاريع الكبرى أكثر بـ٢٥٪." },
  transit: { name: "النقل العام", cost: 2500, days: 16, era: 2, text: "باصات وتنظيم: الطرق تشيل سيارات أكثر بـ٣٠٪ والزحمة تخف." },
  wind: { name: "طاقة الرياح", cost: 3500, days: 20, era: 2, text: "يفتح مزرعة الرياح: كهرباء كثيرة بلا دخان." },
  dams: { name: "سدود الأودية", cost: 1200, days: 24, era: 1, text: "يفتح بناء السدود على الوادي: تحجز السيل، وتجمع المطر في بحيرة، وتغذي الماء الجوفي." }
};
for (const t of Object.values(TECH)) t.cost = Math.round(t.cost * PRICE.tech);

/** Goals that guide a new mayor; each pays a reward. */
export const GOALS = [
  { text: "انصب ٣ خيام جديدة", test: (s) => s.count.house >= 6, reward: 450 },
  { text: "وصّل كل الخيام بطريق", test: (s) => s.count.house >= 6 && s.connectedHomes >= s.count.house, reward: 150 },
  { text: "ازرع مزرعة نخل ثالثة", test: (s) => s.count.palms >= 3, reward: 450 },
  { text: "احفر بئر ثاني", test: (s) => s.count.well >= 2, reward: 300 },
  { text: "طوّر خيمة إلى بيت طين", test: (s) => s.levels[1] + s.levels[2] + s.levels[3] + s.levels[4] >= 1, reward: 250 },
  { text: "وصل عدد السكان ٤٠", test: (s) => s.pop >= 40, reward: 200 }, // goals that need no building pay less (the money was too easy)
  { text: "ابنِ مسجدًا", test: (s) => s.count.mosque + s.count.bigmosque >= 1, reward: 1050 },
  { text: "طوّر بيت إلى بيت شعبي", test: (s) => s.levels[2] >= 1, reward: 800 },
  { text: "ابنِ مدرسة", test: (s) => s.count.school >= 1, reward: 1800 },
  { text: "ابحث الري بالتنقيط في المجلس البلدي", test: (s) => s.tech.irrigation, reward: 1500 },
  { text: "صارت الرافعية بلدة (٢٥٠ ساكن)", test: (s) => s.pop >= 250, reward: 800 },
  { text: "ابنِ مولد كهرباء أو ألواح شمسية", test: (s) => s.count.generator + s.count.solar >= 1, reward: 2100 },
  { text: "أول فيلا", test: (s) => s.levels[3] >= 1, reward: 2200 },
  { text: "رضا الناس ٧٠٪", test: (s) => s.happy >= 70, reward: 800 },
  { text: "دخل ٥٠٠ ريال بالساعة", test: (s) => s.net >= 500, reward: 1200 },
  { text: "صارت الرافعية مدينة (١٢٠٠ ساكن)", test: (s) => s.pop >= 1200, reward: 2500 },
  { text: "ابنِ مستشفى", test: (s) => s.count.hospital >= 1, reward: 12600 },
  { text: "أول عمارة", test: (s) => s.levels[4] >= 1, reward: 6500 },
  { text: "صارت الرافعية محافظة (٤٠٠٠ ساكن)", test: (s) => s.pop >= 4000, reward: 6000 },
  { text: "ابنِ جامعة الرافعية", test: (s) => s.count.university >= 1, reward: 18000 },
  { text: "ابنِ معصرة زيتون ووصّل لها ٥ مزارع زيتون", test: (s) => s.count.oilpress >= 1 && s.count.olive >= 5, reward: 12000 },
  { text: "ابنِ مزرعة رياح", test: (s) => s.count.windfarm >= 1, reward: 21000 },
  { text: "ابنِ قلعة مارد", test: (s) => s.count.marid >= 1, reward: 45000 },
  { text: "أول برج سكني", test: (s) => s.levels[5] >= 1, reward: 48000 },
  { text: "اشترِ أرض بعيدة", test: (s) => Object.keys(s.owned || {}).some((p) => s.owned[p] && /2/.test(p)), reward: 18000 },
  { text: "ابنِ محطة القطار", test: (s) => s.count.station >= 1, reward: 165000 },
  { text: "صارت الرافعية حاضرة (٩٠٠٠ ساكن)", test: (s) => s.pop >= 9000, reward: 50000 },
  { text: "ابنِ أبراج الرافعية", test: (s) => s.count.skyline >= 1, reward: 200000 }
];

/** Things that happen. weight: how often; effect lasts `days`. */
// days: how long it lasts, in hours.
// Weather follows the season, as in al-Jouf: rain in autumn (الوسم), winter and spring and never in
// summer; dust storms in spring and summer; heat waves in summer, cold snaps in winter; locusts in
// spring; the date harvest from late summer into autumn. Ramadan and Eid al-Adha follow the moon, so
// they can fall in any season; Eid al-Fitr comes right after Ramadan (it is never drawn on its own).
// seasons: how likely each is in each season (0 = never).
export const EVENTS = [
  { id: "rain", name: "مطر", text: "نزل المطر! المزارع تنتج أكثر، والماء الجوفي يرتفع.", days: 18, seasons: { spring: 3, summer: 0, autumn: 3, winter: 4 }, farm: 1.5, happy: 6 },
  { id: "dust", name: "عاصفة غبار", text: "غبار يغطي البلد والطرق الترابية انطمرت. الناس متضايقين.", days: 10, seasons: { spring: 3, summer: 3, autumn: 1, winter: 0.3 }, happy: -10 },
  { id: "heat", name: "موجة حر", text: "حر شديد: الناس ما يطلعون بالنهار، والمكيفات شغالة طول الوقت والكهرباء تتعب.", days: 24, seasons: { summer: 3 }, happy: -6, power: 0.85 },
  { id: "cold", name: "موجة برد", text: "برد قارس: الناس يدفّون بالدفايات والحطب، والكهرباء عليها ضغط.", days: 24, seasons: { winter: 3 }, happy: -4, power: 0.9 },
  { id: "locust", name: "جراد", text: "سرب جراد نزل على المزارع! المحصول بيقل يوم كامل.", days: 24, seasons: { spring: 2 }, farm: 0.4 },
  { id: "drought", name: "جفاف", text: "ما نزل مطر من زمان والآبار نقصت. وفّروا الماء.", days: 36, seasons: { summer: 3, autumn: 1 }, water: 0.7 },
  { id: "ramadan", name: "رمضان", text: "رمضان كريم! المحلات تبيع أكثر والناس يسهرون.", days: 48, seasons: { spring: 1, summer: 1, autumn: 1, winter: 1 }, shop: 1.3, happy: 8 },
  { id: "eid", name: "عيد الفطر", text: "عيدكم مبارك! فرحة في كل الحارات.", days: 24, seasons: {}, happy: 15, shop: 1.2 },
  { id: "adha", name: "عيد الأضحى", text: "عيد الأضحى مبارك! الأضاحي والزيارات في كل البيوت.", days: 24, seasons: { spring: 0.7, summer: 0.7, autumn: 0.7, winter: 0.7 }, happy: 12, shop: 1.15 },
  { id: "dates", name: "موسم الصرام", text: "موسم الصرام! أسعار التمور فوق.", days: 36, seasons: { summer: 2, autumn: 3 }, farm: 1.4 },
  { id: "visit", name: "زيارة المحافظ", text: "المحافظ زار البلد وأعجبه، وصرف دعم.", days: 1, seasons: { spring: 1, summer: 0.6, autumn: 1, winter: 1 }, gift: true },
  { id: "festival", name: "مهرجان الرافعية", text: "المهرجان جاب زوار من كل مكان.", days: 36, seasons: { spring: 2, autumn: 2, winter: 1 }, tech: "tourism", shop: 1.6, happy: 10 }
];
/** What the rain is called in each season. */
export const RAIN_NAMES = { spring: "مطر الربيع", autumn: "مطر الوسم", winter: "مطر الشتاء" };

/**
 * Choices the mayor gets now and then. when(s, a, season) says if it can come up;
 * each option: label, a line on what it does, cost (money), and the effect:
 * money, an hours-long boost { name, hours, happy, shop, farm }, tax change, a free building.
 * The last option is what happens if nobody answers (while the player is away).
 */
export const DECISIONS = [
  // ---- problems in the village: they come up only when their cause is there (weight 3) ----
  { id: "wellbroken", weight: 3, title: "البئر خرب", text: "انقطع حبل الدلو وطاحت البكرة في البئر. الأهالي يشيلون الماء بالسطول من بعيد.",
    when: (s, a) => a.count.well >= 1,
    options: [
      { label: "صلّحوه الحين", note: "يكلف ١٢٠ ريال", cost: 120, boost: { name: "البئر رجع يشتغل", hours: 12, happy: 2 } },
      { label: "نصبر", note: "الماء ينقص ٤٠٪ يومين", boost: { name: "البئر خربان", hours: 48, water: 0.6 } }
    ] },
  { id: "thirst", weight: 3, title: "الناس عطشانين", text: "الماء ما يكفي، والحريم يوقفون طوابير عند البئر من الفجر. الأهالي يطالبون بحل.",
    when: (s, a) => a.waterRatio < 0.9,
    options: [
      { label: "اطلب وايتات ماء", note: "تكلف ٣٠٠، ماء أكثر ليوم", cost: 300, boost: { name: "وايتات الماء", hours: 24, water: 1.6, happy: 2 } },
      { label: "قل لهم يقتصدون", note: "رضا −٨ ليوم", boost: { name: "عطش وزعل", hours: 24, happy: -8 } }
    ] },
  { id: "jobless", weight: 3, title: "شباب بلا شغل", text: "شباب الحي قاعدين على الرصيف من الصبح. يقولون: ما فيه شغل بالرافعية، بنطلع للمدن.",
    when: (s, a) => a.unemployment > 0.3 && s.pop >= 40,
    options: [
      { label: "مشروع تشغيل مؤقت", note: "يكلف ٦٠٠، رضا +٦ يومين", cost: 600, boost: { name: "تشغيل الشباب", hours: 48, happy: 6 } },
      { label: "خلهم يدورون", note: "بعضهم يطلع من البلد، ورضا −٦", popLoss: 0.05, boost: { name: "بطالة الشباب", hours: 48, happy: -6 } }
    ] },
  { id: "fever", weight: 3, title: "حمّى بالقرية", text: "انتشرت حمّى بين العيال، وأقرب مستوصف بعيد. الأمهات خايفات.",
    when: (s, a) => s.pop >= 60 && !a.count.clinic && !a.count.hospital,
    options: [
      { label: "جيبوا طبيب زائر", note: "يكلف ٥٠٠", cost: 500, boost: { name: "الطبيب الزائر", hours: 24, happy: 3 } },
      { label: "الله يشفيهم", note: "بعض العوايل تطلع، ورضا −٨ يومين", popLoss: 0.06, boost: { name: "حمّى", hours: 48, happy: -8 } }
    ] },
  { id: "tentsworn", weight: 3, title: "الخيام اهترت", text: "برد الشتاء والهواء قطّع شعر الخيام. الناس يرقّعونها بالبطانيات.",
    when: (s, a, season) => season.id === "winter" && a.levels[0] >= 5,
    options: [
      { label: "بدّلوا الشعر", note: "٢٠ ريال عن كل خيمة", costPer: { tents: 20 }, boost: { name: "خيام جديدة", hours: 24, happy: 4 } },
      { label: "يتحملون", note: "رضا −٦ ثلاث أيام", boost: { name: "برد الخيام", hours: 72, happy: -6 } }
    ] },
  { id: "floodroad", weight: 3, title: "السيل جرف الطريق", text: "سيل الوادي جرف أجزاء من الطرق الترابية، والسيارات تغرز.",
    when: (s, a) => a.count.road >= 10 && s.events.some((e) => e.id === "rain"),
    options: [
      { label: "رصفوها", note: "٦ ريال عن كل طريق ترابي", costPer: { roads: 6 } },
      { label: "تنشف لحالها", note: "المحلات تبيع أقل، ورضا −٤ يومين", boost: { name: "طرق مقطوعة", hours: 48, shop: 0.8, happy: -4 } }
    ] },
  { id: "thief", weight: 3, title: "سرقات بالليل", text: "انسرقت محلات بالليل، والتجار يقولون: ما فيه أحد يحرس.",
    when: (s, a) => s.pop >= 150 && !a.count.police,
    options: [
      { label: "عيّن حرّاس", note: "يكلف ٧٠٠", cost: 700, boost: { name: "حرّاس الليل", hours: 48, happy: 3 } },
      { label: "تجي الشرطة بعدين", note: "تنسرق ٨٪ من الميزانية، ورضا −٥", moneyLoss: 0.08, boost: { name: "خوف من السرقات", hours: 24, happy: -5 } }
    ] },
  { id: "fire", weight: 3, title: "حريق!", text: "شب حريق في محل، والنار بتمتد. ما عندكم دفاع مدني.",
    when: (s, a) => s.era >= 1 && !a.count.civil && ["grocery", "cafe", "souq", "mandi", "workshop"].some((k) => a.count[k]),
    options: [
      { label: "اطلب فزعة البلد المجاور", note: "يكلف ٦٠٠ وينطفي", cost: 600 },
      { label: "نطفيه بأنفسنا", note: "ممكن يحترق المحل كله", destroy: ["grocery", "cafe", "souq", "mandi", "workshop"], boost: { name: "آثار الحريق", hours: 24, happy: -6 } }
    ] },
  { id: "powercut", weight: 3, title: "الكهرباء تنقطع", text: "الكهرباء تطفي كل شوي، والمكيفات واقفة والناس يحترون.",
    when: (s, a) => a.grid && a.powerRatio < 0.95,
    options: [
      { label: "استأجر مولدات", note: "يكلف ٧٠٠، كهرباء أكثر ليوم", cost: 700, boost: { name: "مولدات مستأجرة", hours: 24, power: 1.5 } },
      { label: "نتحمل", note: "رضا −٩ ليوم", boost: { name: "انقطاع الكهرباء", hours: 24, happy: -9 } }
    ] },
  { id: "dusty", weight: 2, title: "غبار الطرق", text: "الطرق الترابية كثرت، والغبار يدخل البيوت مع كل سيارة.",
    when: (s, a) => a.count.road >= 30 && !s.tech.asphalt,
    options: [
      { label: "سيارة رش ماء", note: "تكلف ٣٠٠، رضا +٣ يومين", cost: 300, boost: { name: "رش الطرق", hours: 48, happy: 3 } },
      { label: "عادي", note: "رضا −٤ يومين", boost: { name: "غبار", hours: 48, happy: -4 } }
    ] },
  { id: "loan", weight: 4, title: "البنك يعرض قرض", text: "الميزانية بالسالب والرواتب متأخرة. البنك يعرض قرض ٣٠٠٠ ريال يتسدد على أربعة أيام.",
    when: (s) => s.money < 0,
    options: [
      { label: "خذ القرض", note: "+٣٠٠٠ الحين، وتدفع ٤٠ بالساعة ٤ أيام (٣٨٤٠)", money: 3000, boost: { name: "أقساط القرض", hours: 96, repay: 40 } },
      { label: "نشد الحزام", note: "الضريبة +٣٪ ورضا −٤", tax: 3, boost: { name: "تقشّف", hours: 48, happy: -4 } }
    ] },
  { id: "raise", weight: 0, title: "موظفو البلدية يطالبون بعلاوة", text: "مرت سنة، وموظفو البلدية يطالبون بزيادة رواتبهم ١٥٪. يقولون الأسعار زادت.",
    when: () => false, // comes every year by itself
    options: [
      { label: "اعطهم العلاوة", note: "رواتب البلدية +١٥٪ دايم", raise: 0.15, boost: { name: "الموظفين مبسوطين", hours: 24, happy: 3 } },
      { label: "ارفض", note: "إضراب يوم كامل: المساجد والمدارس والمستوصفات تقفل", boost: { name: "إضراب الموظفين", hours: 24, strike: true, happy: -6 } }
    ] },
  { id: "needy", weight: 3, title: "عوايل محتاجة", text: (s, season) => season.id === "winter" ? "فيه عوايل بالرافعية ما عندها تدفئة ولا أكل يكفي بهالبرد. أهل الخير يطالبون البلدية تساهم."
      : s.events.some((e) => e.id === "ramadan") ? "رمضان شهر الخير، وفيه عوايل بالرافعية ما عندها فطور وسحور يكفيها. أهل الخير يطالبون البلدية تساهم بسلال رمضان."
      : season.id === "summer" ? "فيه عوايل بالرافعية ما عندها مكيف ولا أكل يكفي بهالحر. أهل الخير يطالبون البلدية تساهم."
      : "فيه عوايل بالرافعية ما عندها اللي يكفيها. أهل الخير يطالبون البلدية تساهم.",
    when: (s, a, season) => (season.id === "winter" || s.events.some((e) => e.id === "ramadan")) && s.pop >= 50,
    options: [
      { label: "ادعمهم", note: "ريالين عن كل ساكن، والرضا +٨ يومين", costPer: { people: 2 }, boost: { name: "دعم المحتاجين", hours: 48, happy: 8 } },
      { label: "خلها على أهل الخير", note: "رضا −٥ يومين", boost: { name: "عتب على البلدية", hours: 48, happy: -5 } }
    ] },
  { id: "invest", weight: 2, title: "فرصة استثمار", text: "تاجر من الرياض يعرض على البلدية تدخل معه في مشروع: يقول بيرجع الضعف خلال ٣ أيام، بس مافي ضمان.",
    when: (s) => s.money >= 3000,
    options: [
      { label: "ادخل بـ٢٠٠٠", note: "ممكن ترجع ٤٠٠٠، وممكن تروح كلها", cost: 2000, invest: { amount: 2000, back: 4000, chance: 0.6, hours: 72 } },
      { label: "لا، شكرًا", note: "ما يصير شي" }
    ] },
  { id: "contractor", weight: 3, title: "شركة مقاولات", text: "شركة كبيرة تعرض تخلّص المشروع اللي تحت الإنشاء بنص الوقت، مقابل مبلغ.",
    when: (s) => s.tiles.some((t) => t.b?.build > 24),
    options: [
      { label: "اتفق معهم", note: "ربع سعر المشروع، ويخلص بنص الوقت الباقي", costPer: { project: 0.25 }, hurry: 0.5 },
      { label: "نكمل بعمالنا", note: "ما يصير شي" }
    ] },
  // ---- life and chances ----
  { id: "investor", title: "مستثمر على الباب", text: "تاجر يبي يفتح مصنع على حسابه قرب البلد، ويدفع للبلدية رسوم. بس الناس خايفين من الدخان.",
    when: (s) => s.pop >= 60,
    options: [
      { label: "وافق", note: "+٢٠٠٠ ريال، والرضا ينزل يومين", money: 2000, boost: { name: "زعل الأهالي من المصنع", hours: 48, happy: -7 } },
      { label: "ارفض", note: "الأهالي يشكرونك", boost: { name: "الأهالي راضين بقرارك", hours: 24, happy: 4 } }
    ] },
  { id: "mazayen", title: "مزاين الإبل", text: "الفيضة خضرا وأهل الإبل يبون يقيمون مزاين عندكم. تجيب زوار من كل مكان.",
    when: (s, a, season) => season.id === "spring" && s.pop >= 40 && a.faydaHappy >= 2, // only when the faydah is green
    options: [
      { label: "أقيموها", note: "تكلف ١٥٠٠، تفرّح الناس والمحلات تبيع أكثر يومين", cost: 1500, boost: { name: "مزاين الإبل", hours: 48, happy: 10, shop: 1.4, mazayen: true } },
      { label: "مو هالسنة", note: "ما يصير شي" }
    ] },
  { id: "kashta", title: "كشتة جماعية", text: "الأهالي يبون يطلعون كشتة بالفيضة، ويطلبون البلدية تجهّز الخيام والقهوة.",
    when: (s, a, season) => season.id === "spring" && a.faydaHappy >= 1.5,
    options: [
      { label: "جهّزوها", note: "تكلف ٤٠٠، رضا +٨ ليوم", cost: 400, boost: { name: "كشتة الربيع", hours: 24, happy: 8 } },
      { label: "خلّهم على حسابهم", note: "رضا +٢", boost: { name: "كشتة", hours: 12, happy: 2 } }
    ] },
  { id: "datesdeal", title: "تاجر تمور", text: "تاجر يبي يشتري محصول التمور مقدّم، يدفع الحين بس بسعر أقل.",
    when: (s, a, season) => season.id === "autumn" && a.count.palms >= 2,
    options: [
      { label: "بِع مقدّم", note: "٣٥٠ ريال عن كل مزرعة نخل، والمزارع تجيب أقل يومين", moneyPerPalm: 350, boost: { name: "المحصول مبيوع", hours: 48, farm: 0.6 } },
      { label: "ننتظر الصرام", note: "ما يصير شي" }
    ] },
  { id: "wedding", title: "عرس كبير", text: "عرس ولد شيخ الحي، ويدعون الرافعية كلها. تساهم البلدية بالعشاء؟",
    when: (s) => s.pop >= 30,
    options: [
      { label: "نساهم", note: "تكلف ٨٠٠، رضا +١٢ ليوم", cost: 800, boost: { name: "فرحة العرس", hours: 24, happy: 12 } },
      { label: "نعتذر", note: "رضا −٣ ليوم", boost: { name: "عتب أهل العرس", hours: 24, happy: -3 } }
    ] },
  { id: "oldmosque", title: "ترميم المسجد القديم", text: "كبار السن يطلبون ترميم المسجد الطيني القديم قبل يطيح.",
    when: (s, a) => a.count.mosque >= 1,
    options: [
      { label: "رمّموه", note: "تكلف ١٢٠٠، رضا +٦ أربعة أيام", cost: 1200, boost: { name: "المسجد القديم رجع", hours: 96, happy: 6 } },
      { label: "بعدين", note: "ما يصير شي" }
    ] },
  { id: "taxplea", title: "عريضة الأهالي", text: "الأهالي رفعوا عريضة يطلبون تخفيض الضريبة.",
    when: (s) => s.tax >= 12,
    options: [
      { label: "خفّضها", note: "الضريبة −٣٪ والناس يفرحون", tax: -3, boost: { name: "الأهالي يدعون لك", hours: 24, happy: 6 } },
      { label: "ارفض", note: "رضا −٥ يومين", boost: { name: "زعل من الضريبة", hours: 48, happy: -5 } }
    ] },
  { id: "drill", title: "حفّار آبار", text: "حفّار مرّ بالبلد ويعرض يحفر بئر بنص السعر، بس لازم تقرر الحين.",
    when: (s, a, season) => season.id === "summer",
    options: [
      { label: "احفر", note: "بئر جديد قرب البلد بـ١٥٠ ريال", cost: 150, freeBuild: "well" },
      { label: "ما نحتاج", note: "ما يصير شي" }
    ] }
];

/**
 * What it costs to keep the town standing.
 * decay: condition lost per hour (100 = new); below WEAK a building works at 60%; at 0 it stops working,
 * and after RUIN_HOURS more without repair it falls down.
 * Repairing costs REPAIR of the building's price for the damage done. Insurance: INSURE of the value of
 * everything built, per hour; it pays back INSURE_PAYS of a building lost to fire, flood or collapse.
 */
export const UPKEEP_RULES = { decay: 100 / (24 * 24), mudDecay: 100 / (24 * 16), weak: 40, repair: 0.2, ruinHours: 48, insure: 0.0003, insurePays: 0.7 };
/** Paid once a year (12 days) to the province, by stage. */
export const PROVINCE_FEES = [0, 1500, 6000, 20000, 20000, 20000].map((f) => Math.round(f * SEASON_DAYS / 3)); // a yearly fee: the year got longer, so the fee grew with it (the same per hour)
export const YEAR_HOURS = 24 * 4 * SEASON_DAYS;

/** Achievements: test(s, a) with the town state and its analysis. */
const PROJECTS = ["gate", "heritage", "tower", "airport", "marid", "themepark", "station", "bigstadium", "skyline"];
const finished = (s, id) => s.tiles.some((t) => t.b?.id === id && !t.b.build);
export const ACHIEVEMENTS = [
  { id: "tents", name: "أهل البيوت", text: "انصب ١٠ خيام", test: (s, a) => a.count.house >= 10 },
  { id: "mud", name: "من الشعر إلى الطين", text: "أول بيت طين", test: (s, a) => a.levels.slice(1).some((n) => n > 0) },
  { id: "pop100", name: "مية نفس", text: "١٠٠ ساكن", test: (s) => s.pop >= 100 },
  { id: "town", name: "صارت بلدة", text: "وصل الرافعية لبلدة", test: (s) => s.era >= 1 },
  { id: "year", name: "سنة كاملة", text: "عِش أربعة مواسم", test: (s) => s.day >= 3 + YEAR_HOURS },
  { id: "villa", name: "أول فيلا", text: "بيت يتطور لفيلا", test: (s, a) => a.levels[3] + a.levels[4] > 0 },
  { id: "pop1000", name: "ألف ساكن", text: "١٠٠٠ ساكن", test: (s) => s.pop >= 1000 },
  { id: "city", name: "صارت مدينة", text: "وصل الرافعية لمدينة", test: (s) => s.era >= 2 },
  { id: "tower", name: "أول عمارة", text: "بيت يتطور لعمارة", test: (s, a) => a.levels[4] > 0 },
  { id: "deco", name: "الحارة الحلوة", text: "حط ١٠ قطع زينة", test: (s, a) => ["streetpalm", "flowers", "lantern", "fountain", "dallah", "incense"].reduce((n, k) => n + a.count[k], 0) >= 10 },
  { id: "land", name: "أرض جديدة", text: "اشترِ أول أرض", test: (s) => Object.values(s.owned || {}).some(Boolean) },
  { id: "project", name: "مشروع العمر", text: "كمّل أول مشروع كبير", test: (s) => PROJECTS.some((id) => finished(s, id)) },
  { id: "happy", name: "بلد سعيد", text: "رضا ٩٠٪", test: (s) => s.happy >= 90 },
  { id: "rich", name: "خزنة مليانة", text: "٥٠٬٠٠٠ ريال بالميزانية", test: (s) => s.money >= 50000 },
  { id: "province", name: "محافظة الرافعية", text: "وصل الرافعية لمحافظة", test: (s) => s.era >= 3 },
  { id: "allland", name: "كل الأرض لك", text: "اشترِ كل الأراضي القريبة", test: (s) => PLOTS.slice(0, 8).every((p) => s.owned?.[p.id]) },
  { id: "alledges", name: "الرافعية من الطرف للطرف", text: "اشترِ كل الأراضي لين الأطراف", test: (s) => PLOTS.every((p) => s.owned?.[p.id]) },
  { id: "hadira", name: "حاضرة الجوف", text: "وصل الرافعية لحاضرة", test: (s) => s.era >= 4 },
  { id: "skytower", name: "فوق الغيم", text: "أول برج سكني", test: (s, a) => a.levels[5] > 0 },
  { id: "allprojects", name: "الرافعية الكبرى", text: "كمّل كل المشاريع الكبرى", test: (s) => PROJECTS.every((id) => finished(s, id)) },
  { id: "pop5000", name: "خمسة آلاف", text: "٥٠٠٠ ساكن", test: (s) => s.pop >= 5000 }
];

/** Starting village: a few tents, a well and palms by the wadi. */
export const START_MONEY = 600;
