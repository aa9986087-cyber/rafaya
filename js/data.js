// Everything the town can build, research and become. Numbers are per in-game day.

export const MAP_SIZE = 40;
/** The town owns the middle (OWN_START … MAP_SIZE − OWN_START); the land around it is bought in plots. */
export const OWN_START = 5;
export const PLOTS = [
  { id: "n", name: "الأرض الشمالية" },
  { id: "e", name: "الأرض الشرقية" },
  { id: "s", name: "الأرض الجنوبية" },
  { id: "w", name: "الأرض الغربية" }
];
/** Each plot costs more than the last one bought. */
export const PLOT_PRICES = [6000, 12000, 20000, 32000];

/** Town stages: reaching the population opens the stage and its buildings. */
export const ERAS = [
  { id: 0, name: "قرية", pop: 0 },
  { id: 1, name: "بلدة", pop: 250 },
  { id: 2, name: "مدينة", pop: 1200 },
  { id: 3, name: "محافظة", pop: 4000 }
];

/**
 * Time: the town moves forward one hour at a time (one simulation step = one hour),
 * 24 hours make a day, and the year turns through four seasons of SEASON_DAYS days.
 * daylight: share of the day with the sun up (long summer days, long winter nights).
 */
export const HOURS = 24;
export const SEASON_DAYS = 3;
export const SEASONS = [
  { id: "spring", name: "الربيع", daylight: 0.5, start: "دخل الربيع: الفيضة اخضرّت ونوّرت، والناس طلعوا يكشتون." },
  { id: "summer", name: "الصيف", daylight: 0.6, start: "دخل الصيف: الحر شديد، والبيوت تبي ماء أكثر، والفيضة يبست." },
  { id: "autumn", name: "الخريف", daylight: 0.5, start: "دخل الخريف: خفّ الحر وبدأ الصِّرام." },
  { id: "winter", name: "الشتاء", daylight: 0.4, start: "دخل الشتاء: برد وليالي طويلة. الربيع جاي بعده." }
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
  { id: "proj", name: "مشاريع كبرى" }
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
      { name: "عمارة", cap: 48, cost: 6000, needs: { road: 1, water: 1, power: 1, happy: 70, services: 4 }, era: 2 }
    ],
    text: "تنصبها خيمة، وأنت اللي تطورها: بيت طين، ثم شعبي، ثم فيلا، ثم عمارة. كل مستوى له سعر، ويحتاج طريق وماء واصل، والأعلى يحتاج كهرباء وخدمات قريبة."
  },
  grocery: { cat: "shop", name: "بقالة", cost: 120, upkeep: 2, era: 0, jobs: 4, income: 14, water: -1, power: -1, text: "وظائف ودخل بسيط." },
  cafe: { cat: "shop", name: "مقهى", cost: 220, upkeep: 4, era: 0, jobs: 5, income: 22, water: -2, power: -2, radius: 3, happy: 6, text: "وظائف ويفرّح الحارة اللي حوله." },
  bank: { cat: "shop", unique: true, name: "بنك", cost: 400, upkeep: 4, era: 0, jobs: 6, income: 0, water: -1, power: -1, text: "يعطيك قروض: تاخذ المبلغ الحين وتسدده أقساط بالساعة مع فايدة. واحد يكفي البلد." },
  souq: { cat: "shop", name: "سوق شعبي", cost: 600, upkeep: 10, era: 1, jobs: 14, income: 60, water: -2, power: -3, text: "سوق يرفع الدخل كثير." },
  mandi: { cat: "shop", name: "مطعم مندي", cost: 450, upkeep: 6, era: 1, jobs: 9, income: 42, water: -3, power: -3, radius: 4, happy: 8, text: "الكل يحبه: وظائف ورضا." },
  hotel: { cat: "shop", visitors: true, name: "فندق", cost: 2600, upkeep: 30, era: 2, tech: "tourism", jobs: 30, income: 150, water: -8, power: -8, text: "يجيب الزوار والدخل." },
  mall: { cat: "shop", name: "مجمع تجاري", cost: 5200, upkeep: 60, era: 2, jobs: 70, income: 270, water: -10, power: -14, radius: 6, happy: 10, text: "وظائف كثيرة ودخل عالي." },

  palms: { cat: "farm", name: "مزرعة نخل", cost: 150, upkeep: 2, era: 0, jobs: 5, income: 11, water: -5, text: "تمور ودخل. في الوادي تنتج أكثر." },
  veg: { cat: "farm", name: "مزرعة خضار", cost: 200, upkeep: 3, era: 0, jobs: 6, income: 14, water: -6, text: "خضار للسوق." },
  workshop: { cat: "farm", name: "ورشة", cost: 400, upkeep: 6, era: 1, jobs: 12, income: 45, power: -4, radius: 2, pollute: 8, text: "وظائف، بس صوتها يزعج الجيران." },
  datefactory: { cat: "farm", name: "مصنع تمور", cost: 1800, upkeep: 25, era: 1, tech: "packing", jobs: 30, income: 110, water: -6, power: -10, radius: 3, pollute: 6, text: "يغلّف التمور. كل مزرعة نخل تزيد دخله." },
  factory: { cat: "farm", name: "مصنع", cost: 3500, upkeep: 45, era: 2, jobs: 60, income: 200, water: -8, power: -20, radius: 5, pollute: 14, text: "وظائف كثيرة وتلوّث." },

  // reach: how far (in tiles) its water or power gets; homes and shops farther away get none.
  well: { cat: "util", name: "بئر", cost: 100, upkeep: 2, era: 0, water: 30, reach: 5, text: "ماء ٣٠ وحدة، يوصل للبيوت اللي حوله لين ٥ مربعات." },
  tank: { cat: "util", name: "خزان ماء", cost: 900, upkeep: 12, era: 1, water: 140, reach: 9, power: -2, text: "ماء ١٤٠ وحدة، يوصل لين ٩ مربعات." },
  desal: { cat: "util", name: "محطة تحلية", cost: 4500, upkeep: 50, era: 2, tech: "desal", water: 700, reach: 15, power: -25, text: "ماء ٧٠٠ وحدة، يوصل لين ١٥ مربع." },
  generator: { cat: "util", name: "مولد كهرباء", cost: 700, upkeep: 14, era: 1, power: 70, reach: 7, radius: 3, pollute: 10, text: "كهرباء ٧٠ وحدة لين ٧ مربعات، بس دخانه يزعج." },
  solar: { cat: "util", name: "ألواح شمسية", cost: 1600, upkeep: 6, era: 1, tech: "solar", power: 90, reach: 6, text: "كهرباء ٩٠ وحدة نظيفة، توصل لين ٦ مربعات." },
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
  university: { cat: "serv", name: "جامعة", cost: 6000, upkeep: 70, era: 3, water: -6, power: -10, radius: 12, happy: 18, service: "school", jobs: 30, text: "جامعة الرافعية. فخر المحافظة." },

  // Decorations: cheap, no road needed, they cheer up the streets around them.
  streetpalm: { cat: "deco", name: "نخلة شارع", cost: 40, upkeep: 0, era: 0, radius: 2, happy: 2, text: "نخلة وحدة تزيّن الشارع." },
  flowers: { cat: "deco", name: "حوض زهور", cost: 30, upkeep: 0, era: 0, radius: 2, happy: 2, text: "زهور ملونة على الرصيف." },
  lantern: { cat: "deco", name: "فانوس زينة", cost: 50, upkeep: 1, era: 0, radius: 2, happy: 3, text: "فانوس ينوّر بالليل." },
  fountain: { cat: "deco", name: "نافورة", cost: 260, upkeep: 2, era: 1, radius: 3, happy: 5, text: "ماء وبرودة وسط الحارة." },
  dallah: { cat: "deco", name: "دوّار الدلة", cost: 420, upkeep: 2, era: 1, radius: 4, happy: 6, text: "دوار بوسطه دلة كبيرة، رمز الكرم." },
  incense: { cat: "deco", name: "مجسم المبخرة", cost: 380, upkeep: 2, era: 1, radius: 4, happy: 6, text: "مبخرة عملاقة تفوح بالطيب." },

  // Grand projects: one of each, very dear, and they take days to build.
  gate: { cat: "proj", visitors: true, name: "بوابة الرافعية", cost: 5000, upkeep: 20, era: 1, unique: true, buildHours: 48, radius: 9, happy: 12, income: 60, text: "بوابة نجدية كبيرة على مدخل البلد. يفرح فيها الأهالي ويجيب زوار." },
  heritage: { cat: "proj", visitors: true, name: "السوق التراثي", cost: 9000, upkeep: 40, era: 1, unique: true, buildHours: 72, jobs: 40, radius: 7, happy: 10, income: 220, water: -4, power: -4, text: "سوق قديم مرمّم بالطين والخشب، فيه حرف ومطاعم ودلال." },
  tower: { cat: "proj", visitors: true, name: "برج الرافعية", cost: 22000, upkeep: 90, era: 2, unique: true, buildHours: 120, jobs: 60, radius: 14, happy: 15, income: 420, water: -8, power: -16, text: "برج يشوفه الكل من بعيد، فيه مطعم دوّار ومكاتب." },
  airport: { cat: "proj", visitors: true, name: "مطار الرافعية", cost: 45000, upkeep: 160, era: 3, unique: true, buildHours: 168, jobs: 150, radius: 10, happy: 8, income: 900, water: -10, power: -30, pollute: 4, text: "رحلات داخلية تربط الرافعية بالمملكة. أكبر مشروع في المحافظة." },

  road: { cat: "road", name: "طريق ترابي", cost: 8, upkeep: 0, era: 0, text: "يوصل البيوت والمحلات ببعض." },
  asphalt: { cat: "road", name: "طريق مسفلت", cost: 25, upkeep: 0, era: 1, tech: "asphalt", radius: 1, happy: 2, text: "أنظف وأحسن من الترابي." }
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

// Farms, shops and workshops grow in place: each step costs part of the building's price and
// earns more (with more staff and running costs). The last step needs a town (بلدة) and, for shops and
// workshops, electricity reaching the building; for farms, water reaching it.
export const BIZ_LEVELS = {
  palms: ["مزرعة نخل", "نخل بالري الحديث", "نخيل كبرى"],
  veg: ["مزرعة خضار", "بيوت محمية", "مزرعة حديثة"],
  grocery: ["بقالة", "تموينات", "سوبرماركت"],
  cafe: ["مقهى", "مقهى كبير", "كوفي حديث"],
  souq: ["سوق شعبي", "سوق مسقوف", "سوق كبير"],
  mandi: ["مطعم مندي", "مطعم مندي كبير", "مطاعم ومطابخ"],
  workshop: ["ورشة", "ورشة كبيرة", "مجمع ورش"]
};
/** What each step does: its price (× the building's price) and how income, staff and running costs grow. */
export const BIZ_UP = [
  { cost: 0, income: 1, jobs: 1, upkeep: 1 },
  { cost: 0.7, income: 1.6, jobs: 1.4, upkeep: 1.5 },
  { cost: 1.4, income: 2.3, jobs: 1.8, upkeep: 2, era: 1 }
];
export const bizLevel = (b) => BIZ_UP[(BIZ_LEVELS[b?.id] && b.lvl) || 0] || BIZ_UP[0];

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
  dams: { name: "سدود الأودية", cost: 1200, days: 24, era: 1, text: "سدود صغيرة على الوادي تخفف السيول: خطرها ينزل كثير." }
};
for (const t of Object.values(TECH)) t.cost = Math.round(t.cost * PRICE.tech);

/** Goals that guide a new mayor; each pays a reward. */
export const GOALS = [
  { text: "انصب ٣ خيام جديدة", test: (s) => s.count.house >= 6, reward: 450 },
  { text: "وصّل كل الخيام بطريق", test: (s) => s.count.house >= 6 && s.connectedHomes >= s.count.house, reward: 150 },
  { text: "ازرع مزرعة نخل ثالثة", test: (s) => s.count.palms >= 3, reward: 450 },
  { text: "احفر بئر ثاني", test: (s) => s.count.well >= 2, reward: 300 },
  { text: "طوّر خيمة إلى بيت طين", test: (s) => s.levels[1] + s.levels[2] + s.levels[3] + s.levels[4] >= 1, reward: 250 },
  { text: "وصل عدد السكان ٤٠", test: (s) => s.pop >= 40, reward: 400 },
  { text: "ابنِ مسجدًا", test: (s) => s.count.mosque + s.count.bigmosque >= 1, reward: 1050 },
  { text: "طوّر بيت إلى بيت شعبي", test: (s) => s.levels[2] >= 1, reward: 800 },
  { text: "ابنِ مدرسة", test: (s) => s.count.school >= 1, reward: 1800 },
  { text: "ابحث الري بالتنقيط في المجلس البلدي", test: (s) => s.tech.irrigation, reward: 1500 },
  { text: "صارت الرافعية بلدة (٢٥٠ ساكن)", test: (s) => s.pop >= 250, reward: 1500 },
  { text: "ابنِ مولد كهرباء أو ألواح شمسية", test: (s) => s.count.generator + s.count.solar >= 1, reward: 2100 },
  { text: "أول فيلا", test: (s) => s.levels[3] >= 1, reward: 2200 },
  { text: "رضا الناس ٧٠٪", test: (s) => s.happy >= 70, reward: 1500 },
  { text: "دخل ٥٠٠ ريال بالساعة", test: (s) => s.net >= 500, reward: 2500 },
  { text: "صارت الرافعية مدينة (١٢٠٠ ساكن)", test: (s) => s.pop >= 1200, reward: 4000 },
  { text: "ابنِ مستشفى", test: (s) => s.count.hospital >= 1, reward: 12600 },
  { text: "أول عمارة", test: (s) => s.levels[4] >= 1, reward: 6500 },
  { text: "صارت الرافعية محافظة (٤٠٠٠ ساكن)", test: (s) => s.pop >= 4000, reward: 10000 },
  { text: "ابنِ جامعة الرافعية", test: (s) => s.count.university >= 1, reward: 18000 }
];

/** Things that happen. weight: how often; effect lasts `days`. */
// days: how long it lasts, in hours.
export const EVENTS = [
  { id: "rain", name: "مطر الوسم", text: "نزل المطر! المزارع تنتج أكثر.", days: 18, weight: 3, farm: 1.5, happy: 6 },
  { id: "dust", name: "عاصفة غبار", text: "غبار يغطي البلد والطرق الترابية انطمرت. الناس متضايقين.", days: 10, weight: 3, happy: -10 },
  { id: "locust", name: "جراد", text: "سرب جراد نزل على المزارع! المحصول بيقل يوم كامل.", days: 24, weight: 2, farm: 0.4 },
  { id: "drought", name: "جفاف", text: "الآبار نقصت. وفّروا الماء.", days: 36, weight: 2, water: 0.7 },
  { id: "ramadan", name: "رمضان", text: "رمضان كريم! المحلات تبيع أكثر والناس يسهرون.", days: 72, weight: 2, shop: 1.3, happy: 8 },
  { id: "eid", name: "العيد", text: "عيدكم مبارك! فرحة في كل الحارات.", days: 24, weight: 2, happy: 15, shop: 1.2 },
  { id: "dates", name: "موسم التمور", text: "موسم الصرام! أسعار التمور فوق.", days: 36, weight: 3, farm: 1.4 },
  { id: "visit", name: "زيارة المحافظ", text: "المحافظ زار البلد وأعجبه، وصرف دعم.", days: 1, weight: 1, gift: true },
  { id: "festival", name: "مهرجان الرافعية", text: "المهرجان جاب زوار من كل مكان.", days: 36, weight: 2, tech: "tourism", shop: 1.6, happy: 10 }
];

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
  { id: "needy", weight: 3, title: "عوايل محتاجة", text: "فيه عوايل بالرافعية ما عندها تدفئة ولا أكل يكفي. أهل الخير يطالبون البلدية تساهم.",
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
    when: (s, a, season) => season.id === "spring" && s.pop >= 40,
    options: [
      { label: "أقيموها", note: "تكلف ١٥٠٠، تفرّح الناس والمحلات تبيع أكثر يومين", cost: 1500, boost: { name: "مزاين الإبل", hours: 48, happy: 10, shop: 1.4, mazayen: true } },
      { label: "مو هالسنة", note: "ما يصير شي" }
    ] },
  { id: "kashta", title: "كشتة جماعية", text: "الأهالي يبون يطلعون كشتة بالفيضة، ويطلبون البلدية تجهّز الخيام والقهوة.",
    when: (s, a, season) => season.id === "spring",
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
export const PROVINCE_FEES = [0, 1500, 6000, 20000];
export const YEAR_HOURS = 24 * 12;

/** Achievements: test(s, a) with the town state and its analysis. */
const PROJECTS = ["gate", "heritage", "tower", "airport"];
const finished = (s, id) => s.tiles.some((t) => t.b?.id === id && !t.b.build);
export const ACHIEVEMENTS = [
  { id: "tents", name: "أهل البيوت", text: "انصب ١٠ خيام", test: (s, a) => a.count.house >= 10 },
  { id: "mud", name: "من الشعر إلى الطين", text: "أول بيت طين", test: (s, a) => a.levels.slice(1).some((n) => n > 0) },
  { id: "pop100", name: "مية نفس", text: "١٠٠ ساكن", test: (s) => s.pop >= 100 },
  { id: "town", name: "صارت بلدة", text: "وصل الرافعية لبلدة", test: (s) => s.era >= 1 },
  { id: "year", name: "سنة كاملة", text: "عِش أربعة مواسم", test: (s) => s.day >= 3 + 24 * 12 },
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
  { id: "allland", name: "كل الأرض لك", text: "اشترِ كل الأراضي", test: (s) => ["n", "e", "s", "w"].every((p) => s.owned?.[p]) },
  { id: "allprojects", name: "الرافعية الكبرى", text: "كمّل كل المشاريع الكبرى", test: (s) => PROJECTS.every((id) => finished(s, id)) },
  { id: "pop5000", name: "خمسة آلاف", text: "٥٠٠٠ ساكن", test: (s) => s.pop >= 5000 }
];

/** Starting village: a few tents, a well and palms by the wadi. */
export const START_MONEY = 600;
