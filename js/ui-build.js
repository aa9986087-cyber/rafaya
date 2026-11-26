// The build dock, the HUD, toasts and sheets (screens): the parts of main.js that draw them.
// Moved out of js/main.js as it was (nothing changed in it); main.js and the modules import each other's names.
import { ACHIEVEMENTS, B, CATS, ERAS, EVENTS, FILL_COST, GOALS, GREATER_CITY_STAGE, MAP_SIZE as N, milSlotsMax, milSlotsUsed, SUBSIDY, TECH, VAULT } from "./data.js";
import { $, S, ar, money, openCat, scheduleLayout, setTool, sheet, sheetFor, speed, tool, world, worldMode } from "./main.js";
import { greaterCityProjectBlocker, housePrice, houseTop, priceOf, techUnlocked, upgradeCost } from "./sim.js";
import { PLACE_STYLE, modelKey, setLandStyle } from "./models.js";
import { thumbnail } from "./world3d.js";
import { sfx } from "./sound.js";
import { serviceInfo } from "./ui-arrange.js";

export const F = 'fill="currentColor" fill-opacity=".2"';
export const toolsBar = [...CATS.map((c) => ({ id: c.id, name: c.name, worldOnly: c.worldOnly })), { id: "edit", name: "تعديل" }];
export function lockReason(id) {
  if (id === "upgrade" || id === "fill" || id === "roadup") return "";
  const d = B[id];
  if (d.worldOnly && !worldMode) return "بعالم الجوف بس";
  if (d.unique && S.tiles.some((t) => t.b?.id === id)) return "عندك واحد منه";
  if (d.hq && !S.tiles.some((t) => t.b?.id === "milhq")) return "ابنِ مركز القيادة أول";
  if (d.max && S.tiles.filter((t) => t.b?.id === id).length >= d.max) return `الحد ${ar(d.max)}`;
  if (d.slot && milSlotsUsed(S) >= milSlotsMax(S)) return `الحد ${ar(milSlotsMax(S))} مباني عسكرية`;
  if (d.era > S.era) return `تنفتح لما تصير ${ERAS[d.era].name}`;
  const civicLock = greaterCityProjectBlocker(S, id);
  if (civicLock) return ar(civicLock);
  if (!techUnlocked(S, d)) return `تحتاج بحث «${TECH[d.tech].name}»`;
  return "";
}
export function renderCards() {
  scheduleLayout();
  const box = $("cards");
  if (!openCat) { box.hidden = true; return; }
  const ids = Object.keys(B).filter((k) => B[k].cat === openCat && (B[k].era !== GREATER_CITY_STAGE || (worldMode && S.era >= GREATER_CITY_STAGE - 1)));
  box.hidden = false;
  const UP_CARDS = {
    home: { key: modelKey("house", 2), name: "تطوير البيوت", from: B.house.levels[1].cost, path: "خيمة ← طين ← شعبي ← فيلا ← عمارة" },
    shop: { key: modelKey("grocery", 2), name: "تطوير المحلات", from: upgradeCost({ id: "grocery", lvl: 0 }), path: "بقالة ← تموينات ← سوبرماركت" },
    farm: { key: modelKey("palms", 2), name: "تطوير المزارع والورش", from: upgradeCost({ id: "palms", lvl: 0 }), path: "مزرعة ← بالري ← كبرى" }
  };
  UP_CARDS.serv = { key: modelKey("mosque", 2), name: "تطوير الخدمات", from: upgradeCost({ id: "mosque", lvl: 0 }), path: "مسجد ← بمنارتين ← جامع · مستشفى ← تخصصي ← مدينة طبية" };
  UP_CARDS.road = { key: modelKey("avenue", 0), name: "تطوير الطرق", from: B.asphalt.cost, path: "ترابي ← مسفلت ← شارع رئيسي", tool: "roadup" };
  UP_CARDS.util = { key: "rock", name: "ردم الوادي (مو السد)", from: FILL_COST, path: "يحمي من السيل · للمربع", tool: "fill" };
  const uc = UP_CARDS[openCat];
  const upgradeCard = uc ? `<button type="button" class="card ${tool?.id === (uc.tool || "upgrade") && (uc.tool || tool.cat === openCat) ? "on" : ""}" data-build="${uc.tool || "upgrade"}" style="--i:0">
      <img alt="" src="${thumbnail(uc.key)}"><b>${uc.name}</b><span class="price">من ${money(uc.from)} ريال</span><span class="hours">${uc.path}</span></button>` : "";
  // houses already upgraded to a level: that level is a card of its own, to build straight away
  const levelCards = openCat === "home" ? Array.from({ length: houseTop(S) }, (_, k) => k + 1).map((lvl) => {
    const p = housePrice(S, lvl), L = B.house.levels[lvl], cap = Math.round(L.cap * (S.tech.concrete ? 1.25 : 1));
    return `<button type="button" class="card ${tool?.id === "house" && tool.lvl === lvl ? "on" : ""} ${S.money < p.total ? "poor" : ""}" data-build="house" data-lvl="${lvl}">
      <img alt="" src="${thumbnail(modelKey("house", lvl))}"><b>${L.name}</b><span class="price">${money(p.total)} ريال</span><span class="hours">جاهز على طول · يسكن ${ar(cap)}</span></button>`;
  }).join("") : "";
  box.innerHTML = upgradeCard + levelCards + ids.map((id, i) => {
    const lock = lockReason(id);
    const afford = S.money >= priceOf(S, id);
    return `<button type="button" class="card ${tool?.id === id && !tool.lvl ? "on" : ""} ${lock ? "locked" : ""} ${!lock && !afford ? "poor" : ""}" data-build="${id}" style="--i:${i}">
      <img alt="" src="${thumbnail(modelKey(id, 0))}"><b>${B[id].name}</b>
      ${lock ? `<span class="lock">${lock}</span>` : `<span class="price">${B[id].fullCost ? `<s>${money(B[id].fullCost)}</s> ` : ""}${money(priceOf(S, id))} ريال</span>`}
      ${B[id].fullCost && !lock ? `<span class="hours">دعم الدولة −${ar(Math.round(SUBSIDY[B[id].cat] * 100))}٪</span>` : ""}
      ${B[id].buildHours && !lock ? `<span class="hours">يُبنى في ${ar(B[id].buildHours / 24)} أيام</span>` : ""}
      ${B[id].slot && !lock ? `<span class="hours">🎖️ عسكري ${ar(milSlotsUsed(S))} من ${ar(milSlotsMax(S))}</span>` : ""}
      ${id === "vault" ? `<span class="hours">+${money(VAULT[0].cap)} سعة · كل خزنة زيادة أغلى</span>` : ""}
      ${!lock && (B[id].income || B[id].upkeep) ? `<span class="money-line">${B[id].income ? `<i class="plus">+${money(B[id].income)}</i>` : ""}${B[id].upkeep ? `<i class="minus">−${money(B[id].upkeep)}</i>` : ""}<small>بالساعة</small></span>` : ""}</button>`;
  }).join("");
  box.querySelectorAll("[data-build]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.build, lock = lockReason(id), lvl = Number(b.dataset.lvl) || 0;
    if (lvl) { sfx.tap(); setTool(tool?.id === "house" && tool.lvl === lvl ? null : { id: "house", lvl }); return; } // a house at a level reached before
    if (B[id]?.cat === "serv" && tool?.id !== id) { sfx.tap(); serviceInfo(id); return; } // services: their card first (what they do, their reach), then build
    if (lock) { toast(lock, "bad"); sfx.deny(); return; }
    sfx.tap();
    const cat = id === "upgrade" ? openCat : undefined;
    setTool(tool?.id === id && tool.cat === cat ? null : { id, cat });
  }));
}
export const MOUTHS = ["M8.5 16.5c1.8-2 5.2-2 7 0", "M9 15.5h6", "M8.5 14.5c1.8 2 5.2 2 7 0", "M8 13.5c2 3.5 6 3.5 8 0z"];
export const FACE_COLORS = ["#d9573f", "#d9a540", "#7cb342", "#3f9a5c"];
export const face = (k) => `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="${FACE_COLORS[k]}"/><circle cx="9" cy="10" r="1.3" fill="#2f2114"/><circle cx="15" cy="10" r="1.3" fill="#2f2114"/><path d="${MOUTHS[k]}" stroke="#2f2114" stroke-width="1.6" fill="${k === 3 ? "#2f2114" : "none"}" stroke-linecap="round"/></svg>`;
export function toast(text, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = ar(here(text));
  $("toasts").append(el);
  const long = kind === "era" || kind.startsWith("season");
  setTimeout(() => el.classList.add("out"), long ? 4200 : 2300);
  setTimeout(() => el.remove(), long ? 4600 : 2700);
  while ($("toasts").children.length > 3) $("toasts").firstChild.remove();
}
/** The town's own name in place of «الرافعية» (the default town's name) in what its people and council say. */
// sheets that show what players wrote (al-Jouf's map, the chat, war screens): «الرافعية» there is a real name, never your town's
export const NAME_KEEP = new Set(["wnews", "news-up", "whatsnew", "share-game", "settings", "settings-menu", "how", "region", "budget", "world", "chat", "developer-note", "war", "warroom", "war-rel", "war-strike", "war-report", "war-back", "online", "namefix", "removed"]);
export function here(text) {
  const n = S?.name;
  // a landmark keeps its place's name (بوابة الرافعية is the gate of the place on al-Jouf's map, not of the town)
  return n && n !== "الرافعية" && typeof text === "string" ? text.replace(/(?<!(?:بوابة|برج|أبراج|مطار|مهرجان|جامعة) )الرافعية/g, n) : text;
}
/**
 * The landmarks carry the name of the place the town stands by on al-Jouf's map: a town by Sakaka builds
 * «بوابة سكاكا» and «أبراج سكاكا». Alone, the game is in الرافعية. Names only: nothing saved changes.
 */
export const LANDMARKS = { b: ["gate", "tower", "skyline", "airport"], events: ["festival"] };
export const placeNames = { from: null };
export function nameLandmarks(place) {
  if (!placeNames.from) { // the names as written, once
    placeNames.from = { b: Object.fromEntries(LANDMARKS.b.map((id) => [id, B[id].name])), goals: GOALS.map((g) => g.text), events: Object.fromEntries(EVENTS.filter((e) => LANDMARKS.events.includes(e.id)).map((e) => [e.id, e.name])) };
  }
  const swap = (t) => t.replace(/الرافعية/g, place);
  for (const id of LANDMARKS.b) B[id].name = swap(placeNames.from.b[id]);
  GOALS.forEach((g, i) => { if (/^ابنِ .*الرافعية$/.test(placeNames.from.goals[i])) g.text = swap(placeNames.from.goals[i]); });
  for (const e of EVENTS) if (placeNames.from.events[e.id]) e.name = swap(placeNames.from.events[e.id]);
  setLandStyle(PLACE_STYLE[place] || ""); // and the place's own designs for them
}
export const FIX = { ask: null };
export const row = (k, v, cls = "") => `<div class="row"><span>${k}</span><b class="${cls}">${v}</b></div>`;
/** A little label that floats up from a tile: income, a house moving up. */
export function floatAt(x, y, text, cls = "") {
  const p = world.toScreen(x, y);
  if (p.sx < 0 || p.sy < 60 || p.sx > innerWidth || p.sy > innerHeight - 120) return;
  const el = document.createElement("div");
  el.className = `floater ${cls}`;
  el.textContent = text;
  el.style.left = `${p.sx}px`; el.style.top = `${p.sy - 30}px`;
  $("floaters").append(el);
  setTimeout(() => el.remove(), 1900);
}
/** After each town hour: a few income labels, and a cheer for houses that moved up. */
export function hourEffects() {
  if (speed > 5 || sheetFor) return;
  const earners = [], ups = [];
  S.tiles.forEach((t, i) => {
    if (!t.b?.works) return;
    if (B[t.b.id].income) { const q = world.toScreen(i % N, Math.floor(i / N)); if (q.sx > 0 && q.sx < innerWidth && q.sy > 60 && q.sy < innerHeight - 120) earners.push(i); }
    if (t.b.id === "house" && t.b.upAt === S.day - 1) ups.push(i);
  });
  for (let k = 0; k < Math.min(3, earners.length); k++) {
    const i = earners.splice(Math.floor(Math.random() * earners.length), 1)[0], d = B[S.tiles[i].b.id];
    floatAt(i % N, Math.floor(i / N), `+${ar(Math.max(1, Math.round(d.income * 0.7)))}`, "coin");
  }
  for (const i of ups.slice(0, 4)) floatAt(i % N, Math.floor(i / N), `⬆ ${B.house.levels[S.tiles[i].b.lvl].name}`, "up");
  if (ups.length) sfx.levelUp();
  // worn-out buildings show a wrench, ruined ones a warning
  let shown = 0;
  S.tiles.forEach((t, i) => {
    if (shown >= 3 || !t.b || !(t.b.ruin || (t.b.cond ?? 100) < 40) || Math.random() > 0.35) return;
    floatAt(i % N, Math.floor(i / N), t.b.ruin ? "⚠️ خربان" : "🔧 يحتاج ترميم", "warn"); shown++;
  });
}
export function achievementsSheet() {
  const got = ACHIEVEMENTS.filter((x) => S.ach?.[x.id]).length;
  sheet(`<h2>الإنجازات</h2><p>${ar(got)} من ${ar(ACHIEVEMENTS.length)}</p><div class="achs">${ACHIEVEMENTS.map((x, i) => `<div class="ach ${S.ach?.[x.id] ? "done" : ""}" style="--i:${i}"><span>${S.ach?.[x.id] ? "🏆" : "🔒"}</span><b>${x.name}</b><small>${x.text}</small></div>`).join("")}</div>`, "ach");
}
