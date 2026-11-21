// Everything the town can build, research and become. Numbers are per in-game day.

export const MAP_SIZE = 30;

/** Town stages: reaching the population opens the stage and its buildings. */
export const ERAS = [
  { id: 0, name: "قرية", pop: 0 },
  { id: 1, name: "بلدة", pop: 250 },
  { id: 2, name: "مدينة", pop: 1200 },
  { id: 3, name: "محافظة", pop: 4000 }
];

/** The year turns through four seasons. Day 1 is the first day of spring. */
export const SEASON_DAYS = 30;
export const SEASONS = [
  { id: "spring", name: "الربيع", start: "دخل الربيع: الفيضة اخضرّت ونوّرت، والناس طلعوا يكشتون." },
  { id: "summer", name: "الصيف", start: "دخل الصيف: الحر شديد، والبيوت تبي ماء أكثر، والفيضة يبست." },
  { id: "autumn", name: "الخريف", start: "دخل الخريف: خفّ الحر وبدأ الصِّرام." },
  { id: "winter", name: "الشتاء", start: "دخل الشتاء: برد وليالي طويلة. الربيع جاي بعده." }
];

// Building categories shown in the build bar.
export const CATS = [
  { id: "home", name: "سكن" },
  { id: "shop", name: "تجارة" },
  { id: "farm", name: "زراعة وصناعة" },
  { id: "util", name: "ماء وكهرباء" },
  { id: "serv", name: "خدمات" },
  { id: "road", name: "طرق" }
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
      { name: "خيمة", cap: 3 },
      { name: "بيت طين", cap: 6, needs: { road: 1, water: 1, happy: 45, pop: 30 } },
      { name: "بيت شعبي", cap: 10, needs: { road: 1, water: 1, happy: 45 } },
      { name: "فيلا", cap: 16, needs: { road: 1, water: 1, power: 1, happy: 60, services: 2 } },
      { name: "عمارة", cap: 48, needs: { road: 1, water: 1, power: 1, happy: 70, services: 4 }, era: 2 }
    ],
    text: "يبدأ خيمة، ولما يستقر الأهل (٣٠ ساكن وماء) يتطور وحده لبيت طين ثم شعبي ثم فيلا ثم عمارة إذا توفر له الطريق والماء والكهرباء والخدمات."
  },
  grocery: { cat: "shop", name: "بقالة", cost: 120, upkeep: 2, era: 0, jobs: 4, income: 14, water: -1, power: -1, text: "وظائف ودخل بسيط." },
  cafe: { cat: "shop", name: "مقهى", cost: 220, upkeep: 4, era: 0, jobs: 5, income: 22, water: -2, power: -2, radius: 3, happy: 6, text: "وظائف ويفرّح الحارة اللي حوله." },
  souq: { cat: "shop", name: "سوق شعبي", cost: 600, upkeep: 10, era: 1, jobs: 14, income: 60, water: -2, power: -3, text: "سوق يرفع الدخل كثير." },
  mandi: { cat: "shop", name: "مطعم مندي", cost: 450, upkeep: 6, era: 1, jobs: 9, income: 42, water: -3, power: -3, radius: 4, happy: 8, text: "الكل يحبه: وظائف ورضا." },
  hotel: { cat: "shop", name: "فندق", cost: 2600, upkeep: 30, era: 2, tech: "tourism", jobs: 30, income: 150, water: -8, power: -8, text: "يجيب الزوار والدخل." },
  mall: { cat: "shop", name: "مجمع تجاري", cost: 5200, upkeep: 60, era: 2, jobs: 70, income: 270, water: -10, power: -14, radius: 6, happy: 10, text: "وظائف كثيرة ودخل عالي." },

  palms: { cat: "farm", name: "مزرعة نخل", cost: 150, upkeep: 2, era: 0, jobs: 5, income: 18, water: -5, text: "تمور ودخل. في الوادي تنتج أكثر." },
  veg: { cat: "farm", name: "مزرعة خضار", cost: 200, upkeep: 3, era: 0, jobs: 6, income: 22, water: -6, text: "خضار للسوق." },
  workshop: { cat: "farm", name: "ورشة", cost: 400, upkeep: 6, era: 1, jobs: 12, income: 45, power: -4, radius: 2, pollute: 8, text: "وظائف، بس صوتها يزعج الجيران." },
  datefactory: { cat: "farm", name: "مصنع تمور", cost: 1800, upkeep: 25, era: 1, tech: "packing", jobs: 30, income: 110, water: -6, power: -10, radius: 3, pollute: 6, text: "يغلّف التمور. كل مزرعة نخل تزيد دخله." },
  factory: { cat: "farm", name: "مصنع", cost: 3500, upkeep: 45, era: 2, jobs: 60, income: 200, water: -8, power: -20, radius: 5, pollute: 14, text: "وظائف كثيرة وتلوّث." },

  well: { cat: "util", name: "بئر", cost: 100, upkeep: 2, era: 0, water: 30, text: "يعطي ماء لكل البلد." },
  tank: { cat: "util", name: "خزان ماء", cost: 900, upkeep: 12, era: 1, water: 140, power: -2, text: "ماء أكثر بكثير." },
  desal: { cat: "util", name: "محطة تحلية", cost: 4500, upkeep: 50, era: 2, tech: "desal", water: 700, power: -25, text: "ماء يكفي مدينة." },
  generator: { cat: "util", name: "مولد كهرباء", cost: 700, upkeep: 14, era: 1, power: 70, radius: 3, pollute: 10, text: "كهرباء، بس دخانه يزعج." },
  solar: { cat: "util", name: "ألواح شمسية", cost: 1600, upkeep: 6, era: 1, tech: "solar", power: 90, text: "كهرباء نظيفة من الشمس." },
  powerplant: { cat: "util", name: "محطة كهرباء", cost: 5000, upkeep: 60, era: 2, power: 600, radius: 5, pollute: 12, text: "كهرباء تكفي مدينة." },

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

  road: { cat: "road", name: "طريق ترابي", cost: 8, upkeep: 0, era: 0, text: "يوصل البيوت والمحلات ببعض." },
  asphalt: { cat: "road", name: "طريق مسفلت", cost: 25, upkeep: 0, era: 1, tech: "asphalt", radius: 1, happy: 2, text: "أنظف وأحسن من الترابي." }
};

/** The municipal council's research. Takes money and days; each one stays forever. */
export const TECH = {
  irrigation: { name: "الري بالتنقيط", cost: 500, days: 6, era: 0, text: "المزارع تنتج أكثر بـ٣٠٪ وتصرف ماء أقل." },
  asphalt: { name: "سفلتة الطرق", cost: 600, days: 6, era: 1, text: "يفتح الطريق المسفلت، ويرفع رضا الناس حوله." },
  packing: { name: "تغليف التمور", cost: 900, days: 8, era: 1, text: "يفتح مصنع التمور." },
  concrete: { name: "البناء المسلّح", cost: 1200, days: 8, era: 1, text: "البيوت تسكّن ناس أكثر بـ٢٥٪." },
  solar: { name: "الطاقة الشمسية", cost: 1500, days: 10, era: 1, text: "يفتح الألواح الشمسية: كهرباء بدون تلوث." },
  zakat: { name: "تنظيم الميزانية", cost: 1000, days: 6, era: 1, text: "مصاريف المباني أقل بـ١٥٪." },
  tourism: { name: "السياحة", cost: 2500, days: 12, era: 2, text: "يفتح الفندق، ومهرجان الرافعية يجيب زوار ودخل." },
  desal: { name: "تحلية المياه", cost: 3000, days: 12, era: 2, text: "يفتح محطة التحلية." },
  smart: { name: "المدينة الذكية", cost: 6000, days: 16, era: 3, text: "الدخل كله أكثر بـ٢٠٪." }
};

/** Goals that guide a new mayor; each pays a reward. */
export const GOALS = [
  { text: "انصب ٣ خيام جديدة", test: (s) => s.count.house >= 6, reward: 150 },
  { text: "وصّل الخيام بطريق", test: (s) => s.connectedHomes >= 3, reward: 100 },
  { text: "احفر بئرًا", test: (s) => s.count.well >= 1, reward: 100 },
  { text: "ابنِ مزرعة نخل", test: (s) => s.count.palms >= 1, reward: 150 },
  { text: "أول بيت طين (تحتاج ٣٠ ساكن)", test: (s) => s.levels[1] + s.levels[2] + s.levels[3] + s.levels[4] >= 1, reward: 150 },
  { text: "وصل عدد السكان ٤٠", test: (s) => s.pop >= 40, reward: 200 },
  { text: "ابنِ مسجدًا", test: (s) => s.count.mosque + s.count.bigmosque >= 1, reward: 200 },
  { text: "أول بيت شعبي", test: (s) => s.levels[2] >= 1, reward: 250 },
  { text: "ابنِ مدرسة", test: (s) => s.count.school >= 1, reward: 300 },
  { text: "ابحث الري بالتنقيط في المجلس البلدي", test: (s) => s.tech.irrigation, reward: 300 },
  { text: "صارت الرافعية بلدة (٢٥٠ ساكن)", test: (s) => s.pop >= 250, reward: 600 },
  { text: "ابنِ مولد كهرباء أو ألواح شمسية", test: (s) => s.count.generator + s.count.solar >= 1, reward: 400 },
  { text: "أول فيلا", test: (s) => s.levels[3] >= 1, reward: 500 },
  { text: "رضا الناس ٧٠٪", test: (s) => s.happy >= 70, reward: 600 },
  { text: "دخل يومي ٥٠٠ ريال", test: (s) => s.net >= 500, reward: 800 },
  { text: "صارت الرافعية مدينة (١٢٠٠ ساكن)", test: (s) => s.pop >= 1200, reward: 1500 },
  { text: "ابنِ مستشفى", test: (s) => s.count.hospital >= 1, reward: 1500 },
  { text: "أول عمارة", test: (s) => s.levels[4] >= 1, reward: 1500 },
  { text: "صارت الرافعية محافظة (٤٠٠٠ ساكن)", test: (s) => s.pop >= 4000, reward: 5000 },
  { text: "ابنِ جامعة الرافعية", test: (s) => s.count.university >= 1, reward: 5000 }
];

/** Things that happen. weight: how often; effect lasts `days`. */
export const EVENTS = [
  { id: "rain", name: "مطر الوسم", text: "نزل المطر! المزارع تنتج أكثر.", days: 4, weight: 3, farm: 1.5, happy: 6 },
  { id: "dust", name: "عاصفة غبار", text: "غبار يغطي البلد. الناس متضايقين.", days: 3, weight: 3, happy: -10 },
  { id: "drought", name: "جفاف", text: "الآبار نقصت. وفّروا الماء.", days: 5, weight: 2, water: 0.7 },
  { id: "ramadan", name: "رمضان", text: "رمضان كريم! المحلات تبيع أكثر والناس مرتاحين.", days: 6, weight: 2, shop: 1.3, happy: 8 },
  { id: "eid", name: "العيد", text: "عيدكم مبارك! فرحة في كل الحارات.", days: 3, weight: 2, happy: 15, shop: 1.2 },
  { id: "dates", name: "موسم التمور", text: "موسم الصرام! أسعار التمور فوق.", days: 5, weight: 3, farm: 1.4 },
  { id: "visit", name: "زيارة المحافظ", text: "المحافظ زار البلد وأعجبه، وصرف دعم.", days: 1, weight: 1, gift: true },
  { id: "festival", name: "مهرجان الرافعية", text: "المهرجان جاب زوار من كل مكان.", days: 4, weight: 2, tech: "tourism", shop: 1.6, happy: 10 }
];

/** Starting village: a few tents, a well and palms by the wadi. */
export const START_MONEY = 1500;
