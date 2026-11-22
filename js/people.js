// The people of the town: every house holds real families, with names, a job for the father, children
// at school or not, and what they wish for. Families come from the house's place and the day it was
// built, so the same house always has the same families (nothing extra is saved).
import { B, MAP_SIZE as N } from "./data.js";
import { rng, districtOf, districtName } from "./sim.js";

export const MEN = ["فهد", "سعد", "ناصر", "خالد", "عبدالله", "محمد", "سلطان", "تركي", "مشعل", "فيصل", "بندر", "ماجد", "عبدالعزيز", "سعود", "راشد", "حمد", "نايف", "عادل", "مبارك", "صالح", "إبراهيم", "يوسف", "عمر", "زياد", "منصور", "بدر", "حمود", "عبدالرحمن", "سليمان", "متعب"];
export const WOMEN = ["نورة", "هيا", "سارة", "الجوهرة", "لطيفة", "منيرة", "ريم", "العنود", "دانة", "هند", "مها", "جواهر", "نوف", "شهد", "لولوة", "موضي", "حصة", "غادة", "أريج", "رهف"];
const pickOf = (list, r) => list[Math.floor(r() * list.length)];

/** The families living in the house on tile i (empty if it is not a lived-in house). */
export function familiesAt(s, i) {
  const b = s.tiles[i]?.b;
  if (b?.id !== "house" || !b.res) return [];
  const r = rng((((s.seed || 1) * 31 + i * 7919 + (b.day || 0) * 13) >>> 0) || 1);
  const out = [];
  let left = b.res;
  while (left > 0 && out.length < 16) {
    const size = Math.min(left, 2 + Math.floor(r() * 5));
    const father = pickOf(MEN, r), surname = `آل ${pickOf(MEN, r)}`;
    const kids = [];
    for (let k = 0; k < size - 2; k++) {
      const boy = r() < 0.5;
      kids.push({ name: pickOf(boy ? MEN : WOMEN, r), boy, age: 2 + Math.floor(r() * 17) });
    }
    kids.sort((p, q) => q.age - p.age);
    const eldestSon = kids.find((k) => k.boy)?.name || pickOf(MEN, r);
    out.push({ id: `${i}-${out.length}`, surname, father, kunya: `أبو ${eldestSon}`, mother: `أم ${eldestSon}`, kids, size: Math.max(1, size) });
    left -= size;
  }
  return out;
}

/** Where the father works (the nearest workplace by road), or null. */
export function jobOf(s, a, i) {
  const w = a.workOf?.[i];
  if (w == null || w < 0 || !s.tiles[w]?.b) return null;
  return { tile: w, name: B[s.tiles[w].b.id].name, quarter: districtName(s, districtOf(w)) };
}

/** What a family would ask the mayor for, from what their house is missing. */
export function wishOf(s, a, i) {
  const sv = a.services?.[i] || new Set();
  if (s.tiles[i].b.works === false) return "طريق يوصل بيتهم";
  if (!a.watered?.[i]) return "ماء يوصل بيتهم";
  if (!sv.has("mosque")) return "مسجد قريب منهم";
  if (!sv.has("school")) return "مدرسة قريبة لعيالهم";
  if (!sv.has("health")) return "مستوصف قريب";
  if (!sv.has("safety") && s.era >= 1) return "مركز شرطة يحمي الحارة";
  if (a.trafficCong && [1, -1, N, -N].some((d) => (a.trafficCong[i + d] || 0) > 0.5)) return "حل للزحمة اللي قدام بيتهم";
  return "";
}

/** A family's day, in a few lines: work, school, prayer, home. */
export function familyDay(s, a, i, f) {
  const job = jobOf(s, a, i), sv = a.services?.[i] || new Set();
  const school = f.kids.filter((k) => k.age >= 6 && k.age <= 18);
  const lines = [];
  lines.push(job ? `🌅 ${f.kunya} يطلع الصبح لدوامه في «${job.name}» (${job.quarter}).` : `🌅 ${f.kunya} يدور شغل: ما فيه وظيفة يوصلها بطريق.`);
  if (school.length) lines.push(sv.has("school") ? `🎒 ${school.length === 1 ? school[0].name + " يروح" : `${school.length} من العيال يروحون`} المدرسة القريبة.` : `🎒 ${school.length} من العيال بسن المدرسة، وما فيه مدرسة قريبة.`);
  lines.push(sv.has("mosque") ? "🕌 يصلون في المسجد اللي جنبهم." : "🕌 المسجد بعيد عليهم.");
  lines.push("🌙 بالليل يرجعون للبيت ويتعشون سوا.");
  return lines;
}

/** Everyone in town, for picking a speaker: a family per lived-in house (a few, spread over the town). */
export function someFamilies(s, max = 60) {
  const out = [];
  s.tiles.forEach((t, i) => { if (t.b?.id === "house" && t.b.res) out.push(i); });
  const step = Math.max(1, Math.floor(out.length / max));
  return out.filter((_, k) => k % step === 0).slice(0, max).map((i) => ({ i, f: familiesAt(s, i)[0] })).filter((x) => x.f);
}
