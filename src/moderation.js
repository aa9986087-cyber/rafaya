import { BAD_WORD_LIST } from "./badwords.js";
const protectedNames = ["عايض", "الفرحان", "غوينم", "سكران", "ترازا", "محاميد", "محدا", "رمال", "نمصان"];
const WHOLE_WORD_FAMILIES = new Set(["رمال"]);
const abusiveNames = ["نياج الخروق", "نياج خروق", "نياك الخروق", "نياك خروق"];
const insults = [
  "كلب", "كلبه", "حمار", "حماره", "حقير", "حقيره", "غبي", "غبيه", "زباله", "نذل",
  "قحب", "قحبه", "شرموط", "شرموطه", "خرا", "خره", "زق", "ديوث", "خنيث", "زاني", "زانيه",
  "كس امك", "يلعن امك", "يلعن ابوك", "ابن الكلب", "ولد الكلب",
  "نيك", "نياك", "نايك", "منيوك", "منيوكه", "نياج", "نايج", "منيوج", "منيوجه", "خروق", "زب", "طيز", "عير", "كس", "شرج", "لوطي",
  "fuck", "fucking", "fucker", "shit", "bullshit", "bitch", "bastard", "asshole"
];

function normalize(text) {
  return text.normalize("NFKC").toLowerCase()
    .replace(/[\p{M}\p{Cf}ـ]/gu, "")
    .replace(/چ/g, "ج").replace(/[گڭ]/g, "ك").replace(/ڤ/g, "ف").replace(/پ/g, "ب") // Persian letters some type for Gulf sounds
    .replace(/[أإآٱ]/g, "ا").replace(/[ىئ]/g, "ي").replace(/ة/g, "ه")
    .replace(/(\p{Script=Arabic})\1{2,}/gu, "$1");
}

// Treat spaces, punctuation and digits inside a term as separators while still matching whole words.
const separator = "[^\\p{L}]";
export const nameRuleKey = (text) => normalize(text).replace(/[^\p{L}]/gu, "");
export function createModeration({ names = [], words = [], nameOnly = [] } = {}) {
  const families = [...protectedNames, ...names];
  const terms = [...families, ...insults, ...BAD_WORD_LIST, ...abusiveNames, ...words].map(nameRuleKey).filter(Boolean).map((term) => [...term].join(`${separator}*`));
  const explicitNames = [...abusiveNames, ...nameOnly].map(nameRuleKey).filter(Boolean);
  // «رمال» is blocked as a word of its own (رمال، الرمال), not inside another name: «الرمالي» is a family name (the owner, 2026-11-25)
  const blockedNames = [...families.filter((f) => !WHOLE_WORD_FAMILIES.has(f)).map(nameRuleKey).filter(Boolean), ...explicitNames];
  const chatPattern = new RegExp(`(?:^|${separator})(?:[وف])?(?:يا${separator}*)?(?:ال${separator}*){0,2}(?:${terms.join("|")})(?=$|${separator})`, "u");
  const blockedChat = (text) => chatPattern.test(normalize(text));
  const blockedExplicitName = (text) => { const compact = nameRuleKey(text); return explicitNames.some((name) => compact.includes(name)); };
  const blockedName = (text) => {
    const compact = nameRuleKey(text);
    return blockedNames.some((name) => compact.includes(name)) || blockedChat(text);
  };
  return { blockedChat, blockedName, blockedExplicitName };
}
