const protectedNames = ["عايض", "الفرحان", "غوينم", "سكران", "ترازا", "محاميد", "محدا", "رمال", "نمصان"];
const insults = [
  "كلب", "كلبه", "حمار", "حماره", "حقير", "حقيره", "غبي", "غبيه", "زباله", "نذل",
  "قحب", "قحبه", "شرموط", "شرموطه", "خرا", "خره", "زق", "ديوث", "خنيث", "زاني", "زانيه",
  "كس امك", "يلعن امك", "يلعن ابوك", "ابن الكلب", "ولد الكلب",
  "fuck", "fucking", "fucker", "shit", "bullshit", "bitch", "bastard", "asshole"
];

function normalize(text) {
  return text.normalize("NFKC").toLowerCase()
    .replace(/[\p{M}\p{Cf}ـ]/gu, "")
    .replace(/[أإآٱ]/g, "ا").replace(/[ىئ]/g, "ي").replace(/ة/g, "ه")
    .replace(/(\p{Script=Arabic})\1{2,}/gu, "$1");
}

// Treat spaces, punctuation and digits inside a term as separators while still matching whole words.
const separator = "[^\\p{L}]";
export function createModeration({ names = [], words = [] } = {}) {
  const families = [...protectedNames, ...names];
  const terms = [...families, ...insults, ...words].map((term) => term.replaceAll(" ", "").split("").join(`${separator}*`));
  const chatPattern = new RegExp(`(?:^|${separator})(?:[وف])?(?:يا${separator}*)?(?:ال${separator}*){0,2}(?:${terms.join("|")})(?=$|${separator})`, "u");
  const blockedChat = (text) => chatPattern.test(normalize(text));
  const blockedName = (text) => {
    const compact = normalize(text).replace(/[^\p{L}]/gu, "");
    return families.some((name) => compact.includes(name)) || blockedChat(text);
  };
  return { blockedChat, blockedName };
}
