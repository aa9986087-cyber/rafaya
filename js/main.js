// الرافعية: the game loop, the controls, the main menu and every screen around the 3D town.
import { rankSheet, ROOM, warRoom } from "./ui-warroom.js";
import { VERSION, REQUIRED } from "./version.js";
import { WHATS_NEW } from "./whats-new.js";
import { pendingSaveMatches, rememberPendingSave, townSaveWriter } from "./save-version.js";
import { GREATER_CITY_STAGE, greaterCityUpgrade } from "./data.js";
import { B, MIL, CATS, TECH, GOALS, ERAS, EVENTS, DECISIONS, ACHIEVEMENTS, MAP_SIZE as N, HOURS, SEASON_DAYS, SEASONS, PRAYERS, PLOTS, LOANS, SUBSIDY, BIZ_LEVELS, bizLevel, VAULT, DISTRICT_NAMES, ELECTION_GRANT, PROVINCE_FEES, GROUND, FILL_COST, CHAINS, MAT, ROAD_IDS, TERRAINS, SITES, REGION, WORLD, worldTerrain, worldPlace, worldXY, worldPlot, townNameKey } from "./data.js";
import { newGame, step, build, demolish, cantBuild, analyze, houseBlocker, upgradeHouse, upgradeCost, upgradePrice, upgradeEffect, upgradeAt, upgradeBlocker, upgradable, levelName, decide, optionCost, repair, repairAll, repairCost, condFactor, seasonOf, dayOf, hourOf, owns, plotAt, plotPrice, buyPlot, startResearch, fillWadi, deputyCatchUp, DEPUTY, AWAY_CAP, doorOf, roadPath, prayerNow, districtOf, districtName, districtStats, voteShare, hoursToElection, moveCost, moveBlocker, moveBuilding, layoutBlocker, creditLimit, loanBlocker, loanPer, takeLoan, payLoan, payoffCost, catchUp, pack, unpack, idx, inMap, ROCK_CLEAR, techUnlocked, changeMoney, worldEventsAt, provinceFee, moneyCap, priceOf, houseTop, housePrice, buildHouseAt, buildCost, removalRefund, joufHours, idleWhy } from "./sim.js";
import { World, thumbnail } from "./world3d.js";
import { advise, ADVISOR_FEE, ADVISOR_HOURS } from "./advisor.js";
import { WarFX } from "./warfx.js";
import { watchIcons, ICON_PATHS, medalSvg } from "./icons.js";
import { castleCrown } from "./ui-castle.js";
import { findSheet } from "./ui-find.js";
import { medalId, WAR, WEAPONS, WEAPON_IDS, TARGETS, canTarget, milStat, weaponBlocker, damageState, warFactor, repairCostOf, repairMsOf, flightMs, relActions, REL_NAMES, REL_ICONS, THREATS, minutesText } from "./war.js";
import { modelKey, setLandStyle, PLACE_STYLE } from "./models.js";
import { sfx, ambience, warSfx, warMusic } from "./sound.js";
import { writePosts, followUps, decisionReaction, replyOptions, answerPost, moodOf, FIX_HINT, topicName } from "./news.js";
import { familiesAt, jobOf, wishOf, familyDay } from "./people.js";
import { API, LIVE, PUSH, VISIT_OK, VISIT_SHEETS, WORLD_GEN_KEY, WORLD_ID, WORLD_SAVE, activePushWorker, api, b64, checkPush, conflictCopyKey, freshWorldTown, gunzipText, gzipText, handoffSheet, iosPrepareMove, keepDeviceSave, liveClose, liveOpen, makeWorldTown, me, moveCodeSheet, onlineOk, onlinePoll, ownsActiveSave, pendingSummary, prepareWorldSave, pushDeniedHelp, pushKey, pushOff, pushOffer, pushOn, pushState, registerPushEndpoint, registerPushWorker, saveWriters, takeMove, unb64, versionCheck, visitComments, worldHourNow, worldHours, worldSnapshot, worldSync } from "./ui-online.js";
import { idleClamp, perf, perfHud, perfWatch, runHour } from "./ui-idle.js";
import { focusTown, howTo, pauseMenu, reachClose, reachView } from "./ui-settings.js";
import { canDo, canTurn, hoverAt, isMulti, paintAt, paintStarts, pointers, reachLine, roadAim, roadAimStart, roadNext, roadUpWhy, showPending, tileCost, upFits, upgradeWhy, whyNot } from "./ui-tools.js";
import { arrBill, arrDrop, arrMovable, arrMove, arrPush, arrRemove, arrRender, arrRestore, arrSnapshot, arrUnstroke, arrUp, clearPreview, mosqueGaps, mosqueMap, nearRoad, showMove, showReach } from "./ui-arrange.js";
import { WARX, apologyBox, cityMilestonePopup, followTown, milHtml, relSheet, startTargeting, targetTap, warBack, warDamageHtml, warKey, warNews, warPoll, warRepairAt, warSeen, warSheet, warTownKey, warWatch } from "./ui-war.js";
import { F, FIX, NAME_KEEP, face, floatAt, here, nameLandmarks, renderCards, row, toast, toolsBar } from "./ui-build.js";
import { addPosts, council, decisionSheet, newsSheet, plotSheet, showDistrict, showNewsCount, whenSheet, wnewsPoll } from "./ui-news.js";
import { deputyReport, deputySheet, forgetTown, googleOffer, googleSection, nameSection, namefixSheet, openWorld, readCloudTown, readOwnTown, renameSheet, worldClosedSheet, worldIsClosed, worldJoinSheet } from "./ui-account.js";
import { advisorSheet, chainInfo, effectHtml, familySheet, followFamily, goals, kidsWord, matsNote, utilSheet } from "./ui-people.js";
import { CHAT, chatCount, chatPoll, developerNoteSheet, warCardHtml } from "./ui-chat.js";
import { setWarOpen, victoryScreen, zeroEnter } from "./ui-zero.js";
import { warGuide } from "./ui-warguide.js";
import { MENU, budget, maybeWhatsNew, menuBackdrop, shareGameSheet, showWhatsNewDot, whatsNewSheet } from "./ui-whatsnew.js";
import { noteNeighbours } from "./ui-region.js";

export const $ = (id) => document.getElementById(id);
const AR = "٠١٢٣٤٥٦٧٨٩";
export const ar = (n) => String(n).replace(/\d/g, (d) => AR[d]);
export const money = (n) => ar(Math.round(n).toLocaleString("en-US"));
/** Money with one decimal for small amounts (٠٫٦) and whole numbers otherwise. */
export const fine = (n) => (Math.abs(n) < 10 && Math.round(n) !== n ? ar(n.toFixed(1)).replace(".", "٫") : money(n));
const SAVE = "rafaya-save-v1";
export const storePrefix = globalThis.RAFAYA_PREVIEW_STORAGE || "";
const trialStore = storePrefix ? new Map() : null;
export const store = {
  get(k) {
    if (trialStore?.has(k)) return trialStore.get(k);
    try { return localStorage.getItem(storePrefix + k); } catch { return null; }
  },
  set(k, v) {
    trialStore?.set(k, v);
    try { localStorage.setItem(storePrefix + k, v); } catch { /* private mode: the game still runs */ }
  }
};
// Graphics: «auto» (the default) adapts as it plays; the others are fixed (with a safety net for a struggling phone).
// Old choices (high, medium, low) keep their meaning. RENDER maps each to the renderer's quality, its frame caps
// and whether the adaptive steps may move both ways.
const touch = matchMedia("(pointer: coarse)").matches;
const QUALITY = ["auto", "saver", "low", "medium", "high", "ultra"];
const settings = { quality: QUALITY.includes(store.get("rafaya-quality")) ? store.get("rafaya-quality") : "auto", daynight: true }; // night and day for everyone, as the world's clock says (the old switch is gone: the owner wants every player to see the same hour)
export const RENDER = {
  auto: { world: touch ? "medium" : "high", busy: touch ? 45 : 60, idle: 30, adapt: true },
  saver: { world: "low", busy: 30, idle: 20, adapt: false },
  low: { world: "low", busy: 30, idle: 24, adapt: false },
  medium: { world: "medium", busy: 45, idle: 30, adapt: false },
  high: { world: "high", busy: 60, idle: 30, adapt: false },
  ultra: { world: "high", busy: 60, idle: 30, adapt: false, ultra: true }
}[settings.quality];

// ---------- state ----------

// The region: every town has its own save; the region remembers them and the roads between them.
const REGION_KEY = "rafaya-region-v1";
export const townKey = (id) => (id === "main" ? SAVE : `rafaya-town-${id}`);
export let RG = null;
try { RG = JSON.parse(store.get(REGION_KEY) || "null"); } catch { RG = null; }
if (!RG || !RG.towns) RG = { towns: {}, roads: [], active: "main" };
export const saveRegion = () => store.set(REGION_KEY, JSON.stringify(RG));

export let S = null;
if (globalThis.RAFAYA_PREVIEW_SAMPLE && !store.get("rafaya-world-town")) {
  const sample = globalThis.RAFAYA_PREVIEW_SAMPLE();
  store.set("rafaya-world-id", JSON.stringify(sample.id));
  store.set("rafaya-world-town", pack(sample.town));
  store.set("rafaya-world-gen", "2");
}
try { const raw = store.get(townKey(RG.active)) || store.get(SAVE); if (raw) S = unpack(raw); } catch { S = null; }
if (!S) S = newGame();
export let A = analyze(S);
export let playing = false;
export let speed = 1;
export let tool = null; // { id } | { id: "bulldoze" } | null (look around)
export let openCat = null;
// A town day is 24 hours and lasts 20 minutes at normal speed (50 seconds an hour). For a while it was
// 30 minutes (75 s an hour); the owner found it too slow, so it is back to 20 (see worldHours for the world's clock).
// The town moves forward one step every hour. Days start at sunrise; how much of the day is
// light depends on the season (spring and autumn 10 min + 10 min, summer 12 + 8, winter 8 + 12).
export const HOUR_MS = 50000;
const evBanner = { key: null, at: 0, t: 0 }; // the event banner's 30 seconds
/** Where the sun is (0 midnight … 0.5 noon) for how far we are through the day (p: 0 = sunrise). */
const sunAt = (p, d) => (p < d ? 0.25 + (p / d) * 0.5 : 0.75 + ((p - d) / (1 - d)) * 0.5) % 1;
/** The part of the day by the prayer times themselves (data.js PRAYERS), so «الظهر» runs from the dhuhr call to the asr call. */
function partOfDay(p, d) {
  const x = p * HOURS, D = d * HOURS, at = (id) => PRAYERS.find((q) => q.id === id).at(D);
  if (x >= at("fajr")) return "الفجر";
  if (x < 2.5) return "الصبح";
  if (x < at("dhuhr")) return "الضحى";
  if (x < at("asr")) return "الظهر";
  if (x < at("maghrib")) return "العصر";
  if (x < at("isha")) return "المغرب";
  return "الليل";
}
/** A clock reading such as ٤:٣٠ م. Sunrise is earlier on long summer days. */
function clockAt(p, d) {
  const h = (12 - d * 12 + p * 24) % 24, hh = Math.floor(h), mm = Math.floor((h - hh) * 6) * 10;
  return `${ar(((hh + 11) % 12) + 1)}:${ar(String(mm).padStart(2, "0"))} ${hh < 12 ? "ص" : "م"}`;
}

export let arrange = null; // the layout editor's state while it is open (see enterArrange)
export let visiting = null; // { code, town, comments } while looking at another player's town
export let worldMode = false; // playing a town in the shared world of al-Jouf
// the iPhone, and the game opened as an app from the home screen (used early: by save and the app's move)
export const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
// Android: the whole screen, without the browser's bars. Browsers only allow it on a tap, so every tap asks again
// while it is on (the iPhone does not allow it at all: there the game is played from the home screen).
const isAndroid = /Android/i.test(navigator.userAgent) && !isIOS;
const canFull = () => isAndroid && !!document.documentElement.requestFullscreen && store.get("rafaya-fullscreen") !== "0";
addEventListener("pointerup", () => {
  if (!canFull() || document.fullscreenElement) return;
  document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => { /* refused: the next tap asks again */ });
}, { passive: true });
export const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
export function save(leaving = false) {
  if (arrange) return; // mid-layout the town is saved as it was before (see enterArrange)
  if (visiting) { if (leaving) worldSync(true, true); return; }
  if (isIOS && Date.now() - (save.moveAt || 0) > 600000) { save.moveAt = Date.now(); setTimeout(() => iosPrepareMove(), 1000); } // the app's copy stays fresh
  S.cam = { x: world.view.x, z: world.view.z, zoom: world.view.zoom, yawTarget: world.view.yawTarget };
  S.savedAt = Date.now();
  if (worldMode) { store.set(WORLD_SAVE, pack(S)); worldSync(leaving, leaving); return; }
  store.set(townKey(S.site || "main"), pack(S));
  noteTown();
}
/** Keep the region's note of this town up to date (what the region map shows for it). */
export function noteTown() {
  const id = S.site || "main";
  RG.towns[id] = { name: S.name || "الرافعية", terrain: S.terrain || "wadi", pop: S.pop, era: S.era, money: Math.round(S.money), net: Math.round(A?.net || 0) };
  RG.active = id;
  saveRegion();
}

// ---------- the 3D town ----------

const canvas = $("map");
export const world = new World(canvas, { quality: RENDER.world, ultra: !!RENDER.ultra });
// ?debug: the renderer's numbers for measuring (draw calls, triangles, memory, frame time); nothing changes in the game
if (new URLSearchParams(location.search).has("debug")) globalThis.RAFAYA_DEBUG = { world, get perf() { return { ...perf, fpsBusy }; }, info: () => ({ ...world.renderer.info.render, ...world.renderer.info.memory, programs: world.renderer.info.programs?.length, dpr: world.renderer.getPixelRatio(), size: [world.w, world.h] }) };
world.fx = new WarFX(world); // «صراع الجوف»: moving military parts, war damage and the war scenes
watchIcons(document.body); // every emoji in the page's text shows as its icon (js/icons.js)
world.dayCycle = settings.daynight;
// Only trust a saved 3D camera (saves from the old 2D map used other numbers).
const camOk = (c) => c && [c.x, c.z, c.zoom, c.yawTarget ?? c.yaw].every(Number.isFinite) && Math.abs(c.x) <= N / 2 && Math.abs(c.z) <= N / 2 && c.zoom >= 0.45 && c.zoom <= 3.2;
function restoreTownCamera(cam) {
  if (camOk(cam)) {
    const yaw = cam.yawTarget ?? cam.yaw;
    Object.assign(world.view, { x: cam.x, z: cam.z, zoom: cam.zoom, yaw, yawTarget: yaw });
  } else {
    focusTown();
    world.view.zoom = 0.9;
  }
  world.updateCamera();
}
restoreTownCamera(S.cam);
world.sync(S);
const hud = document.querySelector(".hud"), side = document.querySelector(".side"), dock = document.querySelector(".dock");
const view = window.visualViewport;
let layoutFrame = 0, resizeCanvas = false;

export function scheduleLayout() {
  if (layoutFrame) return;
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = 0;
    if (resizeCanvas) { resizeCanvas = false; world.resize(); }
    const visible = view && Math.abs(view.scale - 1) < 0.01;
    const root = document.documentElement;
    const height = visible ? Math.round(view.height) : innerHeight;
    root.style.setProperty("--view-height", `${height}px`);
    root.style.setProperty("--view-top", `${visible ? Math.round(view.offsetTop) : 0}px`);

    const visit = $("visitBar"), dockHeight = dock.offsetHeight;
    const stats = hud.querySelector(".stats"), top = hud.offsetTop + stats.offsetTop + stats.offsetHeight + 6; // under the four cards: the time, goal and event banners keep clear of it (--rail-space)
    const toolHeight = $("toolChip").offsetHeight;
    const bottom = (dockHeight ? dock.offsetTop : visit.offsetHeight ? visit.offsetTop : innerHeight) - (toolHeight ? toolHeight + 12 : 6);
    const available = Math.max(0, bottom - top);
    const count = document.body.classList.contains("world") ? side.children.length : side.querySelectorAll(".side-btn:not(.world-only)").length;
    // one column, always all of it: on a short screen (a browser with its bars) the buttons and gaps shrink to fit
    const gap = count * 50 + (count - 1) * 6 > available ? 4 : 6;
    const size = Math.min(50, Math.max(30, Math.floor((available - (count - 1) * gap) / count)));
    side.style.setProperty("--gap", `${gap}px`);
    side.style.top = `${top}px`;
    side.style.setProperty("--rail-height", `${available}px`);
    side.style.setProperty("--sz", `${size}px`);
    root.style.setProperty("--rail-space", `${size + 10}px`);
    root.style.setProperty("--dock-space", `${dockHeight}px`);
  });
}
addEventListener("resize", () => { resizeCanvas = true; scheduleLayout(); });
view?.addEventListener("resize", scheduleLayout);
view?.addEventListener("scroll", scheduleLayout);
if (window.ResizeObserver) {
  const observer = new ResizeObserver(scheduleLayout);
  for (const target of [hud, dock, $("visitBar"), $("toolChip")]) observer.observe(target);
}
new MutationObserver(scheduleLayout).observe(document.body, { attributes: true, attributeFilter: ["class"] });
document.fonts?.ready.then(scheduleLayout);
scheduleLayout();

export const sync = (roads) => world.sync(S, { tiles: false, roads, buildings: true });

// ---------- touch and mouse ----------

export let drag = null, pinch = null;

canvas.addEventListener("pointerdown", (e) => {
  if (!playing || pointers.size >= 2) return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: world.view.zoom, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    if (arrange?.held && arrange.dragging) arrDrop(null);
    arrUnstroke();
    restoreTapPreview();
    drag = null; return;
  }
  if (arrange) { arrDown(e); return; }
  // a finger paints only when it starts where painting makes sense (on a road or the road being drawn, on the wadi to
  // fill, on a building to upgrade…); started anywhere else it moves the map, so looking around never lays a road
  const painting = tool && (B[tool.id]?.cat === "road" || tool.id === "bulldoze" || tool.id === "upgrade" || tool.id === "roadup" || tool.id === "fill") && paintStarts(world.pick(e.clientX, e.clientY));
  drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, painting, done: new Set() };
  if (painting) drag.pendingBefore = pending.slice(); // the paint starts when this finger moves alone (a second finger means moving the map)
});
canvas.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId)) { if (e.pointerType === "mouse" && tool && playing && !pending.length) hoverAt(world.pick(e.clientX, e.clientY)); return; }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (distance > 0 && pinch.d > 0) { world.view.zoom = pinch.zoom; world.zoomBy(distance / pinch.d); }
    else if (distance > 0) { pinch.d = distance; pinch.zoom = world.view.zoom; }
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    world.pan(mid.x - pinch.mid.x, mid.y - pinch.mid.y); pinch.mid = mid;
    return;
  }
  if (!drag) return;
  if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > (e.pointerType === "touch" ? 14 : 8)) drag.moved = true; // a finger shakes a little on a tap
  if (arrange && arrMove(e)) return;
  if (drag.painting) {
    if (!drag.started) { if (!drag.moved) return; drag.started = true; paintAt(drag.x, drag.y); } // from where the finger first touched
    paintAt(e.clientX, e.clientY); return;
  }
  if (drag.moved) { world.pan(e.clientX - drag.lx, e.clientY - drag.ly); drag.lx = e.clientX; drag.ly = e.clientY; }
});
canvas.addEventListener("pointerup", (e) => {
  if (!pointers.delete(e.pointerId)) return;
  if (pointers.size < 2) pinch = null;
  if (arrange && drag && pointers.size === 0) { arrUp(e); drag = null; return; }
  if (drag && !drag.moved && (!drag.painting || !drag.started) && pointers.size === 0) tap(e.clientX, e.clientY);
  if (pointers.size === 0) drag = null;
});
function restoreTapPreview() {
  if (!drag?.pendingBefore || !tool) return;
  pending = drag.pendingBefore;
  showPending();
}
function cancelMapPointer(e) {
  if (!pointers.delete(e.pointerId)) return;
  if (arrange?.held && arrange.dragging) arrDrop(null);
  restoreTapPreview();
  drag = null; pinch = null;
}
canvas.addEventListener("pointercancel", cancelMapPointer);
canvas.addEventListener("lostpointercapture", cancelMapPointer);
canvas.addEventListener("wheel", (e) => { e.preventDefault(); if (playing) world.zoomBy(e.deltaY < 0 ? 1.12 : 0.89); }, { passive: false });

/** Quarter turns for the next building, chosen with ↻ before ✓ (kept for the next one too). */
export let placeRot = 0;

// ---------- choosing a spot, then confirming ----------
// Nothing is built on a tap. The tap (or a drag, for roads and removal) marks the spot,
// a preview shows it, and the ✓ button builds it.
export let pending = []; /** Buildings ready to move up a level right now (lit up while the upgrade tool is in hand). */
// ---------- road upgrades: the same as buildings (gold = ready, tap or drag, then ✓) ----------

/**
 * What a building would do to the town's money, BEFORE it is bought: the town is worked out as if it
 * already stood on these spots (staff, power, water, the market), then put back as it was.
 * Returns { income, upkeep, net } per hour, or null. Homes: the tax when full (people come over time).
 */
export function buildPreview(id, spots) {
  const d = B[id];
  if (!d || !spots.length || d.cat === "road") return null;
  const before = A, saved = spots.map((p) => { const t = S.tiles[idx(p.x, p.y)]; return [t, t.b, t.t]; });
  for (const [t, b] of saved) {
    if (b?.id === id && d.quarter) t.b = { ...b, n: (b.n || 1) + 1 };
    else if (b?.id === "roundabout" && d.monument) t.b = { ...b, monument: id };
    else t.b = { id, lvl: 0, res: 0, cond: 100, span: d.span };
  }
  let after;
  try { after = analyze(S); } finally { for (const [t, b, g] of saved) { t.b = b; t.t = g; } A = analyze(S); }
  const inc = (x) => (x.income || 0) + (x.farmIncome || 0) + (x.tax || 0);
  let income = inc(after) - inc(before), upkeep = after.upkeep - before.upkeep;
  if (id === "house") { const perHead = (S.tax / 100) * (3 - Math.min(1.2, S.pop / 2500)); income += d.levels[0].cap * spots.length * perHead; }
  return { income, upkeep, net: income - upkeep, jobs: (d.jobs || 0) * spots.length };
}


export function roadStroke(t) {
  const r = drag.road ||= { ...roadAimStart(t), base: pending.slice() };
  const tiles = roadAim(r, t);
  const before = pending.length, seen = new Set(r.base.map((p) => idx(p.x, p.y)));
  pending = r.base.slice();
  for (const p of tiles) {
    const k = idx(p.x, p.y);
    if (seen.has(k) || !inMap(p.x, p.y)) continue;
    seen.add(k);
    if (canDo(p.x, p.y)) pending.push(p);
  }
  if (pending.length > before) sfx.road();
}

function tap(sx, sy) {
  const t = world.pick(sx, sy);
  reachClose(); // a tap anywhere closes the reach view
  if (!inMap(t.x, t.y)) return;
  if (WARX.scene) return;
  if (WARX.targeting) { targetTap(t.x, t.y); return; }
  if (tool) {
    if (tool.id === "move") { moveTap(t); return; }
    if (isMulti()) {
      const at = pending.findIndex((p) => p.x === t.x && p.y === t.y);
      if (at >= 0) pending.splice(at, 1); else pending.push(t);
    } else pending = [t];
    sfx.tap();
    showPending();
    return;
  }
  inspect(t.x, t.y);
}

function confirmPending() {
  if (tool?.id === "move") { confirmMove(); return; }
  if (!tool || !pending.length) return;
  const list = pending.filter((p) => canDo(p.x, p.y));
  const cost = list.reduce((a, p) => a + tileCost(p.x, p.y), 0);
  if (!list.length) { toast(whyNot(pending[0].x, pending[0].y) || "ما ينفع هنا", "bad"); sfx.deny(); return; }
  if (cost > S.money) { toast("ما يكفي المال", "bad"); sfx.deny(); return; }
  if (tool.id === "fill" && world.floodAnim) { toast("السيل ماشي بالوادي الحين، انتظره يمر وبعدين اردم", "bad"); sfx.deny(); return; }
  for (const p of list) apply(p.x, p.y, list.length > 1);
  if (tool.id === "fill" && list.length > 1) { A = analyze(S); world.sync(S, { tiles: true, roads: false, buildings: true }); refresh(); } // the ground once, not once a tile (it froze phones)
  pending = [];
  world.setHover(null); world.setGhost(null); world.setOverlay(null);
  showPending();
}

// ---------- the layout editor (like a base editor): drag buildings around for free ----------
 // (a big decoration's 2×2 stays put) // war damage is kept by place on the server: repair first // everything moves, roads too (like walls in a base editor)
// Redrawn once a frame at most however many tiles a stroke touches, and with no building animation: in the editor a
// building moves, it is not built (both made dragging stutter).
let arrSyncAt = 0;
const arrSyncNow = () => { arrSyncAt = 0; world.prevKeys = null; world.anims?.clear(); world.sync(S, { tiles: false, roads: true, buildings: true }); };
export const arrSync = () => { if (!arrSyncAt) arrSyncAt = requestAnimationFrame(arrSyncNow); };
function enterArrange() {
  if (visiting) { toast("هذي مدينة غيرك: تتفرج بس", "bad"); return; }
  save();
  closeSheet();
  arrange = { tray: [], held: null, sel: null, hist: [], future: [], gone: [], rocks: [], del: false };
  arrange.start = arrSnapshot();
  document.body.classList.add("arranging");
  $("arrange").hidden = false;
  sfx.tap(); arrRender();
}
export function leaveArrange(keep) {
  if (!arrange) return;
  if (!keep) arrRestore(arrange.start);
  const bill = keep ? arrBill() : null, removed = keep ? arrange.gone.length : 0, cleared = keep ? arrange.rocks.length : 0;
  arrange = null;
  if (bill) { // the removals and cleared rocks are settled now
    if (bill.back) changeMoney(S, bill.back, "remove", `إزالة ${ar(removed)}`);
    if (bill.rocks) changeMoney(S, -bill.rocks, "rock");
    S.pop = Math.max(0, S.pop - bill.people);
  }
  document.body.classList.remove("arranging");
  $("arrange").hidden = true;
  world.setGhost(null); world.setHover(null); world.setOverlay(null);
  A = analyze(S); arrSync(); refresh();
  if (keep) { save(); toast(`انحفظ التعديل ✓${removed ? ` · انشال ${ar(removed)} ورجع لك ${money(bill.back)} ريال` : ""}${cleared ? ` · ${ar(cleared)} صخر بـ${money(bill.rocks)}` : ""}`, "goal"); sfx.build(); }
}
function arrDown(e) {
  const t = world.pick(e.clientX, e.clientY);
  const i = inMap(t.x, t.y) ? idx(t.x, t.y) : -1;
  // only the building already chosen (tapped) moves with the finger; any other drag moves the land,
  // so panning over a crowded town never picks up a building by mistake
  drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, painting: false, done: new Set(), grab: i >= 0 && i === arrange.sel && arrMovable(S.tiles[i].b) ? i : -1 };
  // a road from the tray: the finger lays road wherever it goes
  // laying road from the store, removing, lifting roads: nothing on touch-down. A lone finger's move does it (from where
  // it touched), a tap does it once, and a second finger takes the stroke back, so two fingers always just move the map.
  const h = arrange.held;
  const mode = arrange.erase ? "erase" : arrange.del ? "del" : h && h.from < 0 && B[h.b.id].cat === "road" ? "paint" : null;
  if (mode && i >= 0) { drag.mode = mode; drag.grab = -1; drag.start = t; drag.heldBefore = arrange.held; }
}
$("arrRot").addEventListener("click", () => {
  const sel = arrange?.sel, b = sel != null && S.tiles[sel].b;
  if (!b || !canTurn(b.id)) return;
  arrPush(); b.rot = ((b.rot || 0) + 1) % 4; sfx.tap(); arrSync(); arrRender();
});
$("arrErase").addEventListener("click", () => {
  if (!arrange) return;
  sfx.tap();
  if (arrange.held && arrange.held.from < 0) { arrange.tray.push(arrange.held.b); arrange.held = null; }
  arrange.erase = !arrange.erase; arrange.del = false; arrange.sel = null;
  arrRender();
});
// 🗑️: with a building chosen, it goes (↶ brings it back); with none, the removal mode (tap or drag over what goes)
$("arrDel").addEventListener("click", () => {
  if (!arrange) return;
  if (arrange.held) arrDrop(null);
  if (arrange.sel != null && !arrange.del) { arrPush(); arrRemove(arrange.sel); arrange.sel = null; sfx.remove(); arrSync(); arrRender(); return; }
  sfx.tap();
  arrange.del = !arrange.del; arrange.erase = false; arrange.sel = null;
  arrRender();
});
$("arrRedo").addEventListener("click", () => {
  if (!arrange?.future.length) return;
  arrange.held = null; arrange.hist.push(arrSnapshot()); arrRestore(arrange.future.pop()); arrange.sel = null;
  sfx.tap(); arrSync(); arrRender();
});
$("arrAll").addEventListener("click", () => {
  if (!arrange) return;
  if (arrange.held) arrDrop(null);
  arrPush();
  const one = arrange.sel != null && arrMovable(S.tiles[arrange.sel]?.b) ? arrange.sel : null; // one chosen: only it goes to the store
  if (one != null) { arrange.tray.push(S.tiles[one].b); S.tiles[one].b = null; }
  else S.tiles.forEach((t) => { if (arrMovable(t.b)) { arrange.tray.push(t.b); t.b = null; } });
  arrange.sel = null; sfx.remove(); arrSync(); arrRender();
});
$("arrUndo").addEventListener("click", () => {
  if (!arrange?.hist.length) return;
  arrange.held = null; arrange.future.push(arrSnapshot()); arrRestore(arrange.hist.pop()); arrange.sel = null;
  sfx.tap(); arrSync(); arrRender();
});
$("arrCancel").addEventListener("click", () => { sfx.tap(); leaveArrange(false); });
$("arrSave").addEventListener("click", () => {
  if (!arrange) return;
  const left = arrange.tray.length + (arrange.held ? 1 : 0);
  if (left) { toast(`حط كل المباني أول: باقي ${ar(left)} بالمخزن`, "bad"); sfx.deny(); return; }
  const bill = arrBill();
  if (bill.rocks > S.money + bill.back) { toast(`إزالة الصخور تبي ${money(bill.rocks)} ريال وما يكفي المال`, "bad"); sfx.deny(); return; }
  leaveArrange(true);
});

// ---------- moving buildings (tap one, tap where it goes, then ✓) ----------
function moveTap(t) {
  const b = S.tiles[idx(t.x, t.y)].b;
  const from = tool.from;
  if (from && from.x === t.x && from.y === t.y) { tool.from = null; pending = []; sfx.tap(); showMove(); return; }
  if (b) {
    const why = ROAD_IDS.includes(b.id) ? "الطرق ما تنقل: أزلها وارسمها من جديد" : b.build > 0 ? "تحت الإنشاء: انتظر لين يخلص" : "";
    if (why) { toast(why, "bad"); sfx.deny(); return; }
    tool.from = t; pending = []; sfx.tap(); showMove(); return;
  }
  if (!from) { toast("اضغط أول على المبنى اللي تبي تنقله", "bad"); sfx.deny(); return; }
  pending = [t]; sfx.tap(); showMove();
}
function confirmMove() {
  const from = tool.from, to = pending[0];
  if (!from || !to) return;
  const name = levelName(S.tiles[idx(from.x, from.y)].b);
  const why = moveBuilding(S, from.x, from.y, to.x, to.y);
  if (why) { toast(why, "bad"); sfx.deny(); return; }
  sfx.build(); A = analyze(S); sync(false); floatAt(to.x, to.y, `↔ ${name}`, "up");
  tool.from = null; pending = []; showMove(); refresh(); save();
}


function apply(x, y, quiet) {
  const tile = S.tiles[idx(x, y)];
  if (tool.id === "upgrade") {
    if (!upFits(tile.b)) { if (!quiet) { toast(upgradeWhy(x, y), "bad"); sfx.deny(); } return; }
    const why = upgradeAt(S, x, y, A);
    if (why) { if (!quiet) { toast(why, "bad"); sfx.deny(); } return; }
    A = analyze(S);
    sfx.levelUp(); sync(false);
    floatAt(x, y, `⬆ ${levelName(tile.b)}`, "up");
    refresh();
    return;
  }
  if (tool.id === "roadup") {
    const next = roadNext(tile.b), why = next ? roadUpWhy(x, y) || build(S, x, y, next) : roadUpWhy(x, y);
    if (why) { if (!quiet) { toast(why, "bad"); sfx.deny(); } return; }
    sfx.road(); sync(true); clearPreview(quiet); refresh();
    return;
  }
  if (tool.id === "fill") {
    if (world.floodAnim) { if (!quiet) { toast("السيل ماشي بالوادي الحين، انتظره يمر وبعدين اردم", "bad"); sfx.deny(); } return; }
    const why = fillWadi(S, x, y);
    if (why) { if (!quiet) { toast(why, "bad"); sfx.deny(); } return; }
    sfx.road();
    if (!quiet) { A = analyze(S); world.sync(S, { tiles: true, roads: false, buildings: true }); refresh(); } // many at once: redrawn once, after the last (confirmPending)
    return;
  }
  if (tool.id === "bulldoze") {
    if (!tile.b && tile.t !== "rock") return;
    const wasRoad = ROAD_IDS.includes(tile.b?.id);
    const why = demolish(S, x, y);
    if (why) { if (!quiet) { toast(why, "bad"); sfx.deny(); } return; }
    sfx.remove(); sync(wasRoad);
    clearPreview(quiet);
  } else {
    const why = tool.lvl ? buildHouseAt(S, x, y, tool.lvl) : build(S, x, y, tool.id);
    if (why) { if (!quiet || why === "ما يكفي المال") { toast(why, "bad"); sfx.deny(); } return; }
    if (tool.id === "milhq") addPosts([{ id: `d-war-hq${S.day}`, day: S.day, kind: "war", topic: "war", mood: 0, person: { name: "أبو فيصل", role: "من الأهالي", area: "" }, text: "العمدة افتتح مقر القيادة العسكرية، والناس يتساءلون عن المصاريف الجديدة." }]);
    if (placeRot && canTurn(tool.id)) tile.b.rot = placeRot;
    if (tool.id === "pole" && !analyze(S).poles.live.has(idx(x, y))) toast("العمود ما وصله كهرب: حطه لين ٤ مربعات من مولد أو من عمود موصول", "bad");
    const road = B[tool.id].cat === "road" || tile.b?.monument === tool.id; // (a decoration set in a roundabout is drawn with the roads)
    road ? sfx.road() : sfx.build();
    sync(road);
    clearPreview(quiet);
    if (!road && !["util", "farm", "deco"].includes(B[tool.id].cat) && !nearRoad(x, y)) toast("يحتاج طريق لاصق فيه من جنب (مو بالزاوية) عشان يشتغل", "bad");
  }
  refresh();
}




// ---------- build dock ----------

const ICONS = {
  home: `<path ${F} d="M4 20V10h16v10z"/><path d="M3 20h18M4 20V10h16v10M4 10l1.6-2.5L7.2 10l1.6-2.5L10.4 10 12 7.5l1.6 2.5 1.6-2.5 1.6 2.5 1.6-2.5L20 10M10.5 20v-4.5a1.5 1.5 0 0 1 3 0V20M6.5 13h2M15.5 13h2"/>`,
  shop: `<path ${F} d="M3 9h18l-2-5H5z"/><path d="M3 9h18l-2-5H5zM3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 11.5V20h14v-8.5M10 20v-5h4v5M3 20h18"/>`,
  farm: `<path d="M12.5 21c-.3-4 .2-8-.5-11.5"/><path ${F} d="M12 9.5C9 6.5 5.5 6.5 3 8c3.5-.3 6 .5 9 1.5zM12 9.5c3-3 6.5-3 9-1.5-3.5-.3-6 .5-9 1.5zM12 9.5c-2-3.5-1-6 1-7.5-1 2.5-1 5-1 7.5zM12 9.5c-3.5 0-6 2-7 5 2-2 4.5-3.5 7-5zM12 9.5c3.5 0 6 2 7 5-2-2-4.5-3.5-7-5z"/><path d="M12 9.5C9 6.5 5.5 6.5 3 8c3.5-.3 6 .5 9 1.5zM12 9.5c3-3 6.5-3 9-1.5-3.5-.3-6 .5-9 1.5zM12 9.5c-3.5 0-6 2-7 5 2-2 4.5-3.5 7-5zM12 9.5c3.5 0 6 2 7 5-2-2-4.5-3.5-7-5z"/><path d="M7 21h11"/>`,
  util: `<path ${F} d="M9 3s5.5 6.2 5.5 10.2a5.5 5.5 0 0 1-11 0C3.5 9.2 9 3 9 3z"/><path d="M9 3s5.5 6.2 5.5 10.2a5.5 5.5 0 0 1-11 0C3.5 9.2 9 3 9 3z"/><path d="m18.5 6-2.5 5h3.5L17 17" stroke-width="2.1"/>`,
  serv: `<path ${F} d="M5 20v-6h10v6zM6 14c0-3 1.8-5 4-6.2 2.2 1.2 4 3.2 4 6.2z"/><path d="M3 20h18M5 20v-6h10v6M6 14c0-3 1.8-5 4-6.2 2.2 1.2 4 3.2 4 6.2M10 7.8V5.5M18 20V9l1-2.5L20 9v11M8.5 20v-2.5a1.5 1.5 0 0 1 3 0V20"/>`,
  deco: `<path ${F} d="M12 4c2 2.5 2 5 0 7-2-2-2-4.5 0-7zM6 9c3 0 5 2 6 4-3 0-5-1.5-6-4zM18 9c-3 0-5 2-6 4 3 0 5-1.5 6-4z"/><path d="M12 4c2 2.5 2 5 0 7-2-2-2-4.5 0-7zM6 9c3 0 5 2 6 4-3 0-5-1.5-6-4zM18 9c-3 0-5 2-6 4 3 0 5-1.5 6-4zM12 13v8M8 21h8"/>`,
  proj: `<path ${F} d="M10 21V8l2-5 2 5v13z"/><path d="M10 21V8l2-5 2 5v13M7 21h10M10 12h4M10 16h4M4 21v-6h3M20 21v-6h-3"/>`,
  mil: `<path ${F} d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6zM9 12l2 2 4-4"/>`,
  move: `<path d="M12 3v18M3 12h18M12 3 9 6M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>`,
  edit: `<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4M4 20l1-4"/>`,
  road: `<path ${F} d="M8 3h8l4 18H4z"/><path d="M8 3 4 21M16 3l4 18M12 4v3M12 10v3M12 16v3"/>`,
  bulldoze: `<path ${F} d="M3 13h9v4H3zM5 9h5v4H5z"/><path d="M3 13h9v4H3zM5 9h5v4H5zM12 14l4-3 2 1-1 5h-5M18 12l3 5M4 19.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0M9 19.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0"/>`
};
 // moving, turning and removing: one mode (like the layout editors of the big city games)
function renderCats() {
  $("cats").innerHTML = toolsBar.filter((c) => !c.worldOnly || worldMode).map((c) => `<button type="button" class="cat ${c.id === "bulldoze" ? "danger" : ""} ${(openCat === c.id || tool?.id === c.id) ? "on" : ""}" data-cat="${c.id}"><svg viewBox="0 0 24 24">${ICONS[c.id]}</svg><span>${c.name}</span></button>`).join("");
  $("cats").querySelectorAll("[data-cat]").forEach((b) => b.addEventListener("click", () => {
    sfx.tap();
    const id = b.dataset.cat;
    if (id === "bulldoze") { openCat = null; setTool(tool?.id === "bulldoze" ? null : { id: "bulldoze" }); return; }
    if (id === "edit" || id === "move") { openCat = null; setTool(null); enterArrange(); return; }
    openCat = openCat === id ? null : id;
    renderCats(); renderCards();
  }));
}



export function setTool(t) {
  if (t && visiting) { toast("أنت تزور مدينة ثانية: ما تقدر تبني فيها", "bad"); return; }
  tool = t;
  pending = [];
  if (t) openCat = null;
  world.setHover(null); world.setGhost(null); world.setOverlay(null);
  $("toolChip").hidden = !t;
  if (t) {
    const d = B[t.id];
    showPending();
  }
  renderCats(); renderCards();
}
// ✕ first clears the chosen spot; a second ✕ puts the tool away.
$("toolCancel").addEventListener("click", () => { sfx.tap(); if (pending.length) { pending = []; world.setGhost(null); world.setHover(null); world.setOverlay(null); showPending(); } else setTool(null); });
$("toolOk").addEventListener("click", () => confirmPending());
// ↻ turns the building a quarter before it is built; the preview turns with it.
$("toolRot").addEventListener("click", () => {
  sfx.tap(); placeRot = (placeRot + 1) % 4;
  if (pending.length) hoverAt(pending[0]); else toast("اختر المكان، وتشوف الاتجاه قبل ما تبني", "");
});

// ---------- HUD ----------

export function refresh() {
  A = analyze(S);
  $("sMoney").textContent = money(S.money);
  const cap = moneyCap(S), full = A.net > 0 && S.money >= cap;
  $("sNet").textContent = full ? "🔒 الخزنة مليانة" : `${A.net >= 0 ? "+" : "−"}${money(Math.abs(A.net))} تقديري`;
  $("sNet").className = full ? "down" : A.net >= 0 ? "up" : "down";
  // al-Jouf: say it once when the vault fills (income stops until money is spent or a vault is built)
  if (full && !refresh.fullSaid && worldMode && !visiting) { refresh.fullSaid = true; toast(`🔒 الخزنة مليانة (${money(cap)}): الدخل يوقف لين تصرف أو تبني «خزنة» أو تطورها`, "bad"); }
  if (!full) refresh.fullSaid = false;
  $("sPop").textContent = money(S.pop);
  const gr = S.lastGrowth || 0;
  $("sGrow").textContent = gr ? `${gr > 0 ? "+" : "−"}${ar(Math.abs(gr))} آخر ساعة` : `السعة ${money(A.cap)}`;
  $("sGrow").className = gr > 0 ? "up" : gr < 0 ? "down" : "";
  $("sHappy").textContent = `${ar(Math.round(S.happy))}٪`;
  $("sFace").innerHTML = face(S.happy < 35 ? 0 : S.happy < 55 ? 1 : S.happy < 75 ? 2 : 3);
  const set = (el, r, show) => { el.style.width = `${Math.round((show ? r : 1) * 100)}%`; el.classList.toggle("low", show && r < 0.95); };
  set($("sWater"), A.waterRatio, true);
  $("sWater").classList.toggle("low", A.waterRatio < 0.95 || A.dryHomes > 0);
  if (A.grid) { set($("sPower"), A.powerRatio, true); $("sPower").classList.toggle("low", A.powerRatio < 0.95 || A.darkHomes > 0); }
  else { $("sPower").style.width = "0%"; $("sPower").classList.remove("low"); }
  $("sPowerLabel").textContent = A.grid ? "كهرباء" : "كهرباء —";
  $("statUtil")?.setAttribute("title", `${A.dryHomes ? `${A.dryHomes} بيت بلا ماء` : "الماء واصل للكل"}${A.grid ? (A.darkHomes ? ` · ${A.darkHomes} بيت بلا كهرباء` : "") : " · ما فيه كهرباء بعد"}`);
  $("sEra").textContent = !S.site || S.site === "main" ? ERAS[S.era].name : S.name;
  { // the next stage and how far the town has come (a tap on the clock shows the details)
    const nx = ERAS[S.era + 1]?.worldOnly && !worldMode ? null : ERAS[S.era + 1];
    $("sNext").hidden = false;
    if (nx) {
      const from = ERAS[S.era].pop, p = Math.max(0, Math.min(99, Math.floor((S.pop - from) / (nx.pop - from) * 100)));
      $("sNextText").textContent = `🏘️ ${ERAS[S.era].name} ← ${nx.name} · باقي ${ar(Math.max(0, nx.pop - S.pop))} نسمة`;
      $("sNextBar").style.width = `${p}%`;
    } else { $("sNextText").textContent = `🏙️ ${ERAS[S.era].name} · أعلى مرحلة 👏`; $("sNextBar").style.width = "100%"; }
  }
  const se = seasonOf(S.day);
  // in the world the calendar is shared; the day shown is the town's own (counted from its founding)
  $("sDay").textContent = `اليوم ${ar(S.world?.start != null ? Math.max(1, dayOf(S.day - S.world.start + 3)) : dayOf(S.day))}`;
  $("sSeason").textContent = `${se.name} · اليوم ${ar(se.dayIn)} من ${ar(SEASON_DAYS)}`;
  $("sSeason").dataset.s = se.id;
  $("sSeasonBar").style.width = `${Math.round(se.progress * 100)}%`;
  $("sSeasonBar").dataset.s = se.id;
  const goal = GOALS[S.goal];
  $("goal").innerHTML = S.world && S.era === GREATER_CITY_STAGE ? "مشاريع الحاضرة الكبرى" : goal ? `<i>المهمة</i> ${goal.text} <b>${money(goal.reward)}</b>` : here("<i>أنجزت كل المهام</i> كمّل تكبير الرافعية!");
  // The banner shows the main event, or else the strongest boost from a decision.
  const main = S.events.find((e) => e.id !== "boost"), boost = S.events.find((e) => e.id === "boost");
  const ev = main ? { ...EVENTS.find((e) => e.id === main.id), ...(main.name ? { name: main.name } : {}) } : boost ? { name: boost.name, text: `${boost.happy > 0 ? "الناس مبسوطين" : boost.happy < 0 ? "الناس متضايقين" : "شغّال"} · باقي ${ar(boost.left)} ساعة` } : null;
  // the banner shows for 30 seconds when an event starts, then gets out of the way (the time chip still lists it)
  const evKey = ev ? `${ev.name}|${ev.text}`.replace(/[٠-٩\d]+/g, "") : "";
  if (evKey !== evBanner.key) { evBanner.key = evKey; evBanner.at = Date.now(); clearTimeout(evBanner.t); if (ev) evBanner.t = setTimeout(() => { $("event").hidden = true; }, 30000); }
  $("event").hidden = !ev || Date.now() - evBanner.at > 30000;
  if (ev) $("event").innerHTML = here(`<b>${ev.name}</b> ${ev.text}`);
  $("councilDot").hidden = !!S.research || !Object.entries(TECH).some(([id, t]) => !S.tech[id] && t.era <= S.era && S.money >= t.cost);
  document.querySelectorAll("[data-speed]").forEach((b) => b.classList.toggle("on", Number(b.dataset.speed) === speed));
  if (openCat) renderCards();
  if (tool && pending.length) showPending();
}
document.querySelectorAll("[data-speed]").forEach((b) => b.addEventListener("click", () => { sfx.tap(); speed = Number(b.dataset.speed); refresh(); }));

// ---------- toasts and sheets ----------


export let sheetFor = null, sheetAt = 0;
let sheetHide = 0;
 // the owner's name request while it waits (see namefixSheet)
export function sheet(html, kind) {
  if (sheetFor === "update" && kind !== "update") return; // nothing covers the update
  clearTimeout(sheetHide); // a sheet opened while the last one was closing must stay open
  $("sheetClose").hidden = kind === "update" || kind === "namefix"; // those two can't be closed
  sheetFor = kind; sheetAt = performance.now();
  $("sheetBody").innerHTML = NAME_KEEP.has(kind) ? html : here(html);
  $("sheetBody").querySelectorAll("input[type=text], textarea").forEach((i) => { i.autocomplete = "off"; }); // no list of old entries over the keyboard
  $("sheet").hidden = false;
  $("sheet").classList.remove("closing");
}
export function closeSheet() {
  if ($("sheet").hidden || sheetFor === "update") return; // the update can't be put off
  if (sheetFor === "namefix" && FIX.ask) return; // nor the owner's name request, until the names are changed
  if (FIX.ask) setTimeout(() => { if (FIX.ask && sheetFor !== "namefix") namefixSheet(FIX.ask); }, 400); // another screen closed: the request comes back
  $("sheet").classList.add("closing");
  sheetHide = setTimeout(() => { $("sheet").hidden = true; $("sheet").classList.remove("closing"); }, 180);
  const was = sheetFor; sheetFor = null;
  world.setOverlay(null);
  if (was === "war-report" && WARX.st) setTimeout(() => { if (!WARX.scene) warWatch(WARX.st); }, 600); // an attack that waited for the report plays now
  if (was === "settings-menu") showMenu();
}
$("sheetClose").addEventListener("click", () => { sfx.tap(); closeSheet(); });
$("sheet").addEventListener("click", (e) => { if (e.target === $("sheet") && sheetFor !== "decision" && performance.now() - sheetAt > 400) closeSheet(); });





// ---------- نشرة الرافعية ----------


$("sheetBody").addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-district]");
  if (b) { sfx.tap(); showDistrict(Number(b.dataset.district)); }
});

$("newsBtn").addEventListener("click", () => { sfx.tap(); newsSheet(); });

// ---------- نشرة الجوف (world only): what happens in al-Jouf, for everyone ----------




export function inspect(x, y) {
  if (S.tiles[idx(x, y)].b?.id === "decopart") { const of = S.tiles[idx(x, y)].b.of; x = of % N; y = Math.floor(of / N); } // a big decoration's other tiles: the decoration
  const t = S.tiles[idx(x, y)];
  if (!owns(S, x, y)) { sfx.tap(); plotSheet(plotAt(x, y)); return; }
  if (t.b?.id === "bank" && !t.b.build && !visiting) { sfx.tap(); bankSheet(); return; }
  if (!t.b) {
    if (t.t === "rock") sheet(`<h2>صخور</h2><p>تقدر تشيلها بـ${money(ROCK_CLEAR)} ريال، أو تبني فوقها مباشرة والإزالة تنحسب مع السعر.</p>`, "inspect");
    else if (t.t === "wadi") sheet(`<h2>أرض الوادي</h2><p>أرض خصبة: مزارع النخل والخضار هنا تنتج ٥٠٪ أكثر.</p>`, "inspect");
    else if (t.t === "fayda") sheet(`<h2>فيضة</h2><p>أرض منخفضة يجتمع فيها ماء المطر. في الربيع تطلع فيها النباتات الحولية والزهور (الخزامى والنفل والأقحوان)، وتفرّح الناس وترعى فيها الإبل. وفي باقي السنة تيبس.</p>
      <div class="rows">${row("الموسم الحين", seasonOf(S.day).name)}${row("فرحة الناس منها في الربيع", `+${ar(Math.round(A.faydaHappy || 0))} رضا`, "plus")}</div>
      <div class="need">لو بنيت عليها تروح للأبد.</div>`, "inspect");
    return;
  }
  sfx.tap();
  const d = B[t.b.id];
  const works = t.b.works !== false;
  const title = levelName(t.b), up = bizLevel(t.b);
  let html = `<div class="ins-head"><img alt="" src="${thumbnail(modelKey(t.b.id, t.b.lvl), t.t)}"><div><h2>${title}</h2><p>${d.text}</p></div></div><div class="rows">`;
  if (repairCost(t.b) > 0 || t.b.ruin) {
    const c = Math.round(t.b.cond ?? 100), cost = repairCost(t.b);
    html += `<div class="row"><span>حالة المبنى</span><b class="${c < 40 ? "minus" : ""}">${ar(c)}٪</b></div><i class="prog cond"><i style="width:${c}%" class="${c < 40 ? "low" : ""}"></i></i>`;
    if (t.b.ruin) html += `<div class="need">خربان ووقف عن الشغل! إذا ما رممته خلال ${ar(Math.max(1, 48 - t.b.ruin))} ساعة بيطيح.</div>`;
    else if (c < 40) html += `<div class="need">متهالك: يشتغل بـ٦٠٪ بس من طاقته.</div>`;
    if (!visiting) html += `<div class="sheet-actions"><button class="btn go block" id="repairOne" type="button" ${S.money < cost ? "disabled" : ""}>رمّمه بـ${money(cost)} ريال</button></div>`;
  }
  if (t.b.build > 0) {
    const pct = Math.round((1 - t.b.build / d.buildHours) * 100);
    html += `<div class="need ok">تحت الإنشاء: باقي ${ar(t.b.build)} ساعة (${ar(Math.ceil(t.b.build / 24))} يوم)</div><i class="prog"><i style="width:${pct}%"></i></i>`;
  } else if (!works) html += `<div class="need">ما يشتغل: ${idleWhy(S, x, y) || "يحتاج طريق جنبه"}.</div>`;
  if (t.b.id === "house") {
    const cap = Math.round(d.levels[t.b.lvl].cap * (S.tech.concrete ? 1.25 : 1));
    html += row("السكان", `${ar(t.b.res || 0)} من ${ar(cap)}`);
    html += row("الحارة", districtName(S, districtOf(idx(x, y))));
    html += familiesHtml(idx(x, y));
    const i = idx(x, y);
    html += row("الماء", A.watered[i] ? "واصل ✓" : "ما يوصله ✕", A.watered[i] ? "plus" : "minus");
    if (A.grid || t.b.lvl >= 2) html += row("الكهرباء", A.powered[i] ? "واصلة ✓" : "ما توصله ✕", A.powered[i] ? "plus" : "minus");
    const levels = d.levels.filter((l) => l.era !== GREATER_CITY_STAGE || (S.world && S.era >= GREATER_CITY_STAGE)).map((l, k) => `<i class="${k <= t.b.lvl ? "on" : ""}">${l.name}</i>`).join("");
    html += `<div class="ladder">${levels}</div>`;
    const block = houseBlocker(S, A, x, y), next = d.levels[t.b.lvl + 1];
    if (block === "أعلى مستوى") html += `<div class="need ok">وصل أعلى مستوى.</div>`;
    else if (block) html += `<div class="need">عشان تطوره «${next.name}»: ${block}</div>`;
    else if (!visiting) { const pr = upgradePrice(S, t.b); html += `<div class="sheet-actions"><button class="btn go block" id="upgradeOne" type="button" ${S.money < pr.total ? "disabled" : ""}>طوّره إلى «${next.name}» بـ${money(pr.total)} ريال</button></div>${effectHtml(t.b)}${matsNote(pr)}`; }
  }
  const civic = S.world && S.era === GREATER_CITY_STAGE ? greaterCityUpgrade(t.b) : null;
  const baseUpgradeNames = t.b.id === "vault" ? VAULT.filter((level) => level.era <= 4 || S.era === GREATER_CITY_STAGE).map((level) => level.name) : BIZ_LEVELS[t.b.id];
  const upgradeNames = civic ? [...(baseUpgradeNames || [d.name]), civic.name] : baseUpgradeNames;
  if (upgradeNames && !t.b.build) {
    const next = upgradeNames[t.b.lvl + 1];
    html += `<div class="ladder">${upgradeNames.map((n, k) => `<i class="${k <= t.b.lvl ? "on" : ""}">${n}</i>`).join("")}</div>`;
    const block = upgradeBlocker(S, A, x, y), pr = upgradePrice(S, t.b), cost = pr.total;
    if (block === "أعلى مستوى") html += `<div class="need ok">وصل أعلى مستوى.</div>`;
    else if (block) {
      const nextName = next || (t.b.id === "vault" ? VAULT[t.b.lvl + 1]?.name : "");
      html += `<div class="need">عشان تطوره «${nextName}»: ${ar(block)}</div>`;
    }
    else if (!visiting) html += `<div class="sheet-actions"><button class="btn go block" id="upgradeOne" type="button" ${S.money < cost ? "disabled" : ""}>طوّره إلى «${next}» بـ${money(cost)} ريال</button></div>
      ${effectHtml(t.b)}${matsNote(pr)}`;
  }
  WARX.inspectAt = `${x}:${y}`;
  if (MIL[t.b.id] && !t.b.build) {
    const names = MIL[t.b.id].map((l) => l.name);
    if (names.length > 1) {
      const next = names[t.b.lvl + 1];
      html += `<div class="ladder">${names.map((n, k) => `<i class="${k <= t.b.lvl ? "on" : ""}">${n}</i>`).join("")}</div>`;
      const block = upgradeBlocker(S, A, x, y), pr = upgradePrice(S, t.b);
      if (block === "أعلى مستوى") html += `<div class="need ok">وصل أعلى مستوى.</div>`;
      else if (block) html += `<div class="need">عشان تطوره «${next}»: ${block}</div>`;
      else if (!visiting) html += `<div class="sheet-actions"><button class="btn go block" id="upgradeOne" type="button" ${S.money < pr.total ? "disabled" : ""}>طوّره إلى «${next}» بـ${money(pr.total)} ريال</button></div>${effectHtml(t.b)}${matsNote(pr)}`;
    }
    html += milHtml(t.b);
    if (t.b.id === "milhq" && worldMode && !visiting) html += `<div class="sheet-actions"><button class="btn go block" id="warOpen" type="button">⚔️ افتح القيادة العسكرية</button></div>`;
  }
  html += warDamageHtml(t.b);
  html += chainInfo(t, x, y);
  if (ROAD_IDS.includes(t.b.id) && A.trafficCap?.[idx(x, y)]) {
    const i = idx(x, y), ld = Math.round(A.trafficLoad[i]), cp = Math.round(A.trafficCap[i]), cg = A.trafficCong[i];
    html += row("السيارات وقت الذروة", `${ar(ld)} من ${ar(cp)} يشيلها`, cg > 0.3 ? "minus" : "plus");
    if (cg > 0.3) html += `<div class="need">زحمة هنا! ${t.b.id === "road" ? "سفلته أو حوله شارع رئيسي" : t.b.id === "asphalt" ? "حوله شارع رئيسي، أو حط دوار على التقاطع" : "فك الزحمة بطرق ثانية توصل الحارات بالشغل"}.</div>`;
  }
  if (d.jobs) html += row("الوظائف", ar(Math.round(d.jobs * up.jobs)));
  if (d.income) html += row("الدخل بالساعة (تقريبًا)", `${money(Math.round(d.income * up.income))} ريال`, "plus");
  if (d.upkeep) html += row("المصروف بالساعة", `${money(Math.round(d.upkeep * up.upkeep))} ريال`, "minus");
  if (t.b.id === "vault") { html += row("تشيل", `${money(VAULT[t.b.lvl || 0].cap)} ريال`, "plus"); html += row("الخزنة كلها (مع البلدية)", `${money(Math.max(0, S.money))} من ${money(moneyCap(S))}`); }
  if (d.water > 0) html += row("يعطي ماء", ar(Math.round(d.water * (up.capacity || 1))), "plus");
  if (d.power > 0) html += row("يعطي كهرباء", ar(Math.round(d.power * (up.capacity || 1))), "plus");
  if (d.pole || d.wire) {
    const live = A.poles.live.has(idx(x, y));
    html += row("الكهرباء في الخط", live ? "واصلة ✓" : "تحتاج مولد أو خط شغّال", live ? "plus" : "minus");
  }
  if (d.radius) html += row("يوصل تأثيره", `${ar(d.radius + (up.radius || 0))} مربعات`);
  if (d.radius && (d.happy || d.pollute)) { const line = reachLine(t.b.id, [{ x, y }], up.radius || 0); if (line) html += d.pollute && line.startsWith("⚠️") ? `<div class="need">${line}. الحل: أبعده عن البيوت، أو حط حديقة أو شجر بينهم.</div>` : row(d.pollute ? "الإزعاج" : "يخدم", line.replace(/^يخدم /, "")); }
  if (d.service === "mosque") { const u = mosqueGaps(); html += u ? `<div class="need">${ar(u)} ${u >= 3 && u <= 10 ? "بيوت" : "بيت"} برا مدى المساجد: ابنِ مسجد قريب منها.</div>` : `<div class="need ok">كل البيوت داخل مدى المساجد ✓</div>`; html += `<button class="btn block" id="showMosques" type="button">🕌 اعرض وين توصل المساجد كلها</button>`; }
  const rNext = roadNext(t.b), rWhy = rNext ? roadUpWhy(x, y) : "";
  html += `</div><div class="sheet-actions">${rNext && !visiting ? `<button class="btn go block" id="roadUpOne" type="button" ${rWhy ? "disabled" : ""}>⬆ طوّره إلى ${B[rNext].name} (${money(B[rNext].cost)} ريال)</button>${rWhy ? `<p class="hint">${rWhy}</p>` : ""}` : ""}${canTurn(t.b.id) && !visiting ? `<button class="btn block" id="turnOne" type="button">↻ لفّ المبنى (ببلاش)</button>` : ""}${visiting ? "" : `<button class="btn danger block" id="demolish" type="button">أزل المبنى (يرجع لك ${money(removalRefund(t.b))} ريال)</button>`}</div>`;
  const reachR = d.cat === "road" ? 0 : (d.radius ? d.radius + (up.radius || 0) : 0) || d.reach || 0; // (a road's cheer reaches only its own neighbours)
  if (reachR) html = html.replace('<div class="sheet-actions">', `<div class="sheet-actions"><button class="btn block" id="seeReach" type="button">🗺️ شوف مداه على الخريطة</button>`);
  sheet(html, "inspect");
  if (d.radius) showReach(x, y, { ...d, radius: d.radius + (up.radius || 0) });
  $("seeReach")?.addEventListener("click", () => { sfx.tap(); reachView(x, y, reachR); });
  $("showMosques")?.addEventListener("click", () => { sfx.tap(); mosqueMap(); });
  $("roadUpOne")?.addEventListener("click", () => {
    const why = roadUpWhy(x, y) || build(S, x, y, roadNext(S.tiles[idx(x, y)].b));
    if (why) { toast(why, "bad"); sfx.deny(); return; }
    sfx.road(); A = analyze(S); world.sync(S, { tiles: false, roads: true, buildings: true }); refresh(); save();
    inspect(x, y);
  });
  $("sheetBody").querySelectorAll("[data-follow]").forEach((btn) => btn.addEventListener("click", () => followFamily(idx(x, y), Number(btn.dataset.follow))));
  $("sheetBody").querySelectorAll("[data-day]").forEach((btn) => btn.addEventListener("click", () => familySheet(idx(x, y), Number(btn.dataset.day))));
  $("upgradeOne")?.addEventListener("click", () => {
    const why = upgradeAt(S, x, y, A);
    if (why) { toast(why, "bad"); sfx.deny(); return; }
    sfx.levelUp(); A = analyze(S); sync(ROAD_IDS.includes(t.b.id)); refresh(); save();
    floatAt(x, y, `⬆ ${levelName(S.tiles[idx(x, y)].b)}`, "up");
    inspect(x, y);
  });
  $("warOpen")?.addEventListener("click", async () => { await warPoll(true); warSheet(); });
  $("warRepair")?.addEventListener("click", () => warRepairAt(x, y));
  $("repairOne")?.addEventListener("click", () => { const why = repair(S, x, y); if (why) { toast(why, "bad"); sfx.deny(); return; } sfx.build(); toast("رجع المبنى جديد 🔧", "goal"); sync(false); refresh(); save(); inspect(x, y); });
  $("turnOne")?.addEventListener("click", () => { sfx.tap(); t.b.rot = ((t.b.rot || 0) + 1) % 4; world.sync(S, { buildings: true }); save(); });
  $("demolish")?.addEventListener("click", () => {
    const wasRoad = ROAD_IDS.includes(t.b?.id), why = demolish(S, x, y);
    if (why) { toast(why, "bad"); sfx.deny(); return; }
    sfx.remove(); closeSheet(); sync(wasRoad); refresh(); save();
  });
}

$("councilBtn").addEventListener("click", () => { sfx.tap(); council(); });
document.querySelector(".when")?.addEventListener("click", () => { sfx.tap(); whenSheet(); });

/** The quarters: who lives where, how happy, what is missing, and their names (the mayor can rename them). */
export function quartersSheet() {
  A = analyze(S);
  const list = districtStats(S, A);
  sheet(`<h2>🏘️ حارات الرافعية</h2><p>الرافعية مقسومة حارات. سمّها بالأسامي اللي تبيها، والأهالي في النشرة بيتكلمون عنها بأسمائها.</p>
    <div class="rows">${list.length ? list.map((o) => `<div class="quarter">
      <div class="row"><span><b>${o.name}</b><small>${ar(o.homes)} بيت · ${money(o.pop)} ساكن</small></span><b class="${o.happy >= 60 ? "plus" : o.happy < 40 ? "minus" : ""}">رضا ${ar(o.happy)}٪</b></div>
      ${o.dry || o.noRoad || o.dark ? `<div class="need">${[o.noRoad && `${ar(o.noRoad)} بيت بلا طريق`, o.dry && `${ar(o.dry)} بيت بلا ماء`, o.dark && `${ar(o.dark)} بيت بلا كهرباء`].filter(Boolean).join(" · ")}</div>` : ""}
      <div class="q-edit"><input type="text" maxlength="24" data-q="${o.d}" value="${o.name.replace(/"/g, "")}" aria-label="اسم الحارة"><button class="btn" type="button" data-qsave="${o.d}">سمّها</button><button class="btn" type="button" data-qshow="${o.d}">وريني</button></div>
    </div>`).join("") : `<div class="need">ما فيه بيوت للحين.</div>`}</div>`, "quarters");
  $("sheetBody").querySelectorAll("[data-qsave]").forEach((b) => b.addEventListener("click", () => {
    const d = Number(b.dataset.qsave), v = $("sheetBody").querySelector(`[data-q="${d}"]`).value.trim().slice(0, 24);
    S.districts ||= {};
    if (!v || v === DISTRICT_NAMES[d]) delete S.districts[d]; else S.districts[d] = v;
    sfx.coin(); save(); toast(`صار اسمها «${districtName(S, d)}»`, "goal"); quartersSheet();
  }));
  $("sheetBody").querySelectorAll("[data-qshow]").forEach((b) => b.addEventListener("click", () => showDistrict(Number(b.dataset.qshow))));
}

// ---------- online: the server API and visiting other world towns ----------
/** Look round another player's town in the world of al-Jouf (look-only). */
/** opts.target: choosing a building to strike; opts.scene: shown for a war scene (no visit bar). */
export async function visitTown(code, opts = {}) {
  if (code === "" || code == null) return;
  if (arrange) { toast("احفظ الترتيب أو ألغِه قبل الزيارة", "bad"); return; }
  if (!onlineOk()) { toast("الأونلاين يشتغل من رابط اللعبة", "bad"); return; }
  let data;
  try { data = await api(`/world/town/${code}`); } catch { toast("ما لقيت المدينة", "bad"); return; }
  data.town = { ...data.town, name: data.town.town, mayor: data.town.owner };
  if (!data.town.snapshot) { toast("صاحبها للحين ما بدأ يلعب فيها", ""); return; }
  let town;
  try { town = unpack(data.town.snapshot); } catch { toast("حفظ المدينة خربان", "bad"); return; }
  // war damage is the server's, never the town's own save
  for (const t of town.tiles) if (t.b) delete t.b.wd;
  for (const r of data.damage || []) { const t = town.tiles[idx(r.x, r.y)]; if (t?.b && t.b.id === r.bid) t.b.wd = r.wd; }
  if (visiting) leaveVisit(); // from one visit straight to another: home stays your own town
  save();
  visiting = { code, world: true, info: data.town, comments: data.comments, home: S, cam: S.cam };
  nameLandmarks(worldPlace(Number(code))); // the visited town's landmarks are of its own place
  S = town; A = analyze(S);
  closeSheet(); setTool(null);
  world.stopFollow?.(); $("followTag").hidden = true;
  world.newTown(); world.sync(S, { tiles: true, roads: true, buildings: true });
  focusTown(); world.view.zoom = 0.9; world.updateCamera();
  document.body.classList.add("visiting");
  $("visitName").textContent = data.town.name; $("visitMayor").textContent = ` · العمدة ${data.town.mayor}`;
  $("visitBar").hidden = !!(opts.target || opts.scene);
  refresh();
  if (!opts.target && !opts.scene) toast(`أهلًا بك في ${data.town.name}`, "goal");
}
/** The town being visited changed (its owner built something): show it as it is now, camera and sheet left alone. */
export async function refreshVisit() {
  const visit = visiting;
  if (!visit?.world) return;
  let data, town;
  try { data = await api(`/world/town/${visit.code}`); town = unpack(data.town.snapshot); } catch { return; }
  if (visiting !== visit) return;
  for (const t of town.tiles) if (t.b) delete t.b.wd;
  for (const r of data.damage || []) { const t = town.tiles[idx(r.x, r.y)]; if (t?.b && t.b.id === r.bid) t.b.wd = r.wd; }
  S = town; A = analyze(S);
  world.sync(S, { tiles: true, roads: true, buildings: true });
  refresh();
}
 // the war sheets only talk to the server
for (const type of ["click", "input", "change"]) $("sheetBody").addEventListener(type, (e) => {
  if (!visiting || VISIT_SHEETS.has(sheetFor)) return;
  const el = e.target.closest?.("button, input, select, textarea, [data-tech], [data-opt]");
  if (!el || el.closest(VISIT_OK)) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (type === "click") { sfx.deny(); toast("هذي مدينة غيرك: تتفرج بس، ما تقدر تغيّر فيها شي", "bad"); }
}, true);
export function leaveVisit() {
  if (!visiting) return;
  if (WARX.targeting) { WARX.targeting = null; document.body.classList.remove("targeting"); world.fx?.showTargets(null); $("targetBar").hidden = true; }
  S = visiting.home; const cam = visiting.cam; visiting = null;
  if (worldMode && me()?.plot != null) nameLandmarks(worldPlace(me().plot));
  A = analyze(S);
  document.body.classList.remove("visiting"); $("visitBar").hidden = true;
  closeSheet();
  world.newTown(); world.sync(S, { tiles: true, roads: true, buildings: true });
  restoreTownCamera(cam);
  refresh();
}
$("visitBack").addEventListener("click", () => { sfx.tap(); leaveVisit(); });
$("visitComments").addEventListener("click", () => { sfx.tap(); visitComments(); });

// ---------- the world of al-Jouf ----------
export let worldClock = { epoch: Date.UTC(2026, 10, 1), offset: 0, slowAt: Date.UTC(2026, 10, 1), fastAt: Date.UTC(2026, 10, 1), serverAt: 0, perfAt: 0 }, lastSync = 0, soloS = null;
/**
 * The world's time now: the server's clock when we last asked, plus the time that has really passed since,
 * measured by the browser's steady timer. Changing the phone's clock moves nothing (it used to give away
 * hours, and their money). Asked again whenever the game comes back to the screen (the steady timer may
 * stop while the phone sleeps).
 */
export const worldNow = () => (worldClock.serverAt ? worldClock.serverAt + Math.max(0, performance.now() - worldClock.perfAt) : Date.now() + worldClock.offset);
export async function loadClock() {
  try {
    const c = await api("/world/clock"); worldClock = { epoch: c.epoch, offset: c.now - Date.now(), slowAt: c.slowAt ?? c.epoch, fastAt: c.fastAt ?? c.slowAt ?? c.epoch, serverAt: c.now, perfAt: performance.now() };
    setWarOpen(c.warOpenAt); // ساعة الصفر: the same moment for everyone
    // the world was wiped (a new generation): forget the old name and world town on this phone
    if (c.gen && String(c.gen) !== store.get(WORLD_GEN_KEY)) {
      try { localStorage.removeItem(WORLD_ID); localStorage.removeItem(WORLD_SAVE); } catch { /* fine */ }
      store.set(WORLD_GEN_KEY, String(c.gen));
    }
  } catch { /* keep the local guess */ }
}
// ---------- notifications on the phone (al-Jouf): attacks, war and being named in the chat, even with the game shut ----------
export const canRegisterWorker = "serviceWorker" in navigator && onlineOk() && !globalThis.RAFAYA_PREVIEW && isSecureContext;
if (canRegisterWorker) registerPushWorker();
/** The server says this town started again (from another phone) after this copy: take the new one. */
async function syncReply(r, home, cloud) {
  if (!r || !ownsActiveSave(home)) return;
  if (r.conflict || (r.hasSave && r.restarted > (home.world.restartAt || 0))) {
    home.world.syncConflict = true;
    if (!arrange) store.set(WORLD_SAVE, pack(home));
    await recoverWorldSave(home, cloud);
    return;
  }
  if (!r.restarted || (home.world.restartAt || 0) >= r.restarted) {
    if (r.town && r.town !== home.name) {
      home.name = r.town;
      if (!arrange) store.set(WORLD_SAVE, pack(home));
      if (!visiting) refresh();
    }
    return;
  }
  if (arrange) leaveArrange(false);
  const town = freshWorldTown(r.town || home.name, r.restarted, r.saveVersion);
  if (visiting) { visiting.home = town; visiting.cam = town.cam; return; }
  S = town; A = analyze(S);
  world.newTown(); world.sync(S, { tiles: true, roads: true, buildings: true }); restoreTownCamera(S.cam); refresh();
  sheet(`<h2>🔄 مدينتك بدأت من جديد</h2><p>بدأت «${S.name}» من جديد من جوال ثاني، فهذا الجوال أخذ المدينة الجديدة.</p><div class="sheet-actions keep"><button class="btn go block" id="rsOk" type="button">تمام</button></div>`, "away");
  $("rsOk").addEventListener("click", closeSheet);
}
/** Start your al-Jouf town again from nothing: same land, same name; everything else goes (once a day). */
function restartSheet() {
  const id = me();
  sheet(`<h2>🔄 ابدأ من جديد</h2><p>مدينتك بالجوف ترجع <b>قرية صغيرة من الصفر</b> على نفس الأرض وبنفس الاسم.</p>
    <div class="need">يروح كل شي: المباني والسكان والفلوس والأسلحة والمراحل. وما ترجع.</div>
    <div class="rows"><div class="row"><span>يبقى</span><b>اسمك واسم مدينتك وأرضك وعلاقاتك</b></div><div class="row"><span>مرة كل</span><b>٢٤ ساعة</b></div></div>
    <label class="rg-name">اكتب اسم مدينتك عشان تتأكد <input id="rsName" type="text" placeholder="${S.world ? S.name : ""}"></label>
    <div class="sheet-actions two"><button class="btn" id="rsNo" type="button">لا، خلها</button><button class="btn danger" id="rsYes" type="button">ابدأ من جديد</button></div>`, "world");
  $("rsNo").addEventListener("click", closeSheet);
  $("rsYes").addEventListener("click", async () => {
    const town = worldMode && S.world ? S.name : (() => { try { return unpack(store.get(WORLD_SAVE)).name; } catch { return ""; } })();
    if (($("rsName").value || "").trim() !== (town || "").trim()) { toast("اكتب اسم مدينتك بالضبط", "bad"); sfx.deny(); return; }
    let r;
    try { r = await api("/world/restart", { name: id.name, secret: id.secret }); } catch { toast("ما زبط، جرّب بعد شوي", "bad"); return; }
    if (r.error) { toast(r.error, "bad"); sfx.deny(); return; }
    // a fresh town on the same land (like founding it), the world's hour, no old war bills
    const s = freshWorldTown(town, r.restarted || Date.now(), r.saveVersion);
    if (worldMode) { S = s; A = analyze(S); world.sync(S, { tiles: true, roads: true, buildings: true }); }
    closeSheet(); sfx.era(); toast(`🔄 «${town}» بدأت من جديد. بالتوفيق!`, "era");
    enterWorldTown();
  });
}

// ---------- the iPhone's home-screen app keeps its own storage: the game moves over with it ----------
(async () => {
  const q = new URLSearchParams(location.search), mv = q.get("move"), link = q.get("link");
  if (sessionStorage.getItem("rafaya-moved")) { sessionStorage.removeItem("rafaya-moved"); setTimeout(() => toast("📲 جبنا لعبتك كاملة من سفاري ✓", "goal"), 1500); }
  if (!onlineOk() || globalThis.RAFAYA_PREVIEW) return;
  if (!standalone()) { if (isIOS) setTimeout(() => iosPrepareMove(), 4000); return; } // Safari: keep a copy ready for the app
  if (mv || link) history.replaceState(null, "", "/"); // the app: a clean address
  const fresh = !me() && !(S.day > 48 || (S.pop || 0) > 15); // nothing of its own played here yet
  if (mv && (fresh || confirm("فيه لعبة محفوظة من سفاري. تبي تجيبها هنا بدل اللي بهالتطبيق؟"))) {
    try { if (await takeMove(mv)) return; } catch { /* the code below */ }
  }
  if (link && !me()) { // the older link (the al-Jouf account only)
    try { const r = await api("/world/handoff/claim", { code: link }); if (r.secret) { store.set(WORLD_ID, JSON.stringify({ name: r.name, secret: r.secret, plot: r.plot })); toast(`📲 حيّاك ${r.name}! حسابك بالجوف انتقل هنا ✓`, "goal"); return; } } catch { /* fine */ }
  }
  // the app opened empty (added before this, or iOS dropped the link): ask once for the code from Safari
  if (isIOS && fresh && store.get("rafaya-handoff-asked") !== "1") { store.set("rafaya-handoff-asked", "1"); setTimeout(() => { if (!me() && !sheetFor) handoffSheet(true); }, 2500); }
})();

// ---------- updates are a must: an older copy of the game asks to update and can't be used until it does ----------
versionCheck();
setInterval(() => versionCheck(true), 60000); // every minute, so an installed app notices a release without being reopened (only every 10 while the live socket brings it)
addEventListener("pageshow", () => { versionCheck(); checkPush(); });
addEventListener("online", versionCheck);
addEventListener("focus", versionCheck); // installed apps on some phones come back without a visibility change
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  versionCheck();
  if ((sheetFor === "settings" || sheetFor === "settings-menu") && !$("setPush")?.disabled && !$("pushTest")?.disabled) {
    PUSH.checked = false;
    settingsSheet(sheetFor === "settings-menu");
  }
});

// ---------- live: the server pushes what changed the moment it happens (chat, war, the bulletin, towns) ----------

// back on the phone after a while: the socket may have died while asleep
document.addEventListener("visibilitychange", () => { if (!document.hidden && worldMode && !LIVE.ws) { LIVE.tries = 0; liveOpen(); } });

const saveRecoveries = new WeakMap();
let saveRetryAt = 0;
export function recoverWorldSave(home, fetched) {
  if (!ownsActiveSave(home) || !home.world.syncConflict || arrange || WARX.scene || document.hidden || navigator.onLine === false) return;
  if (saveRecoveries.has(home)) return saveRecoveries.get(home);
  saveRetryAt = performance.now() + 10000;
  const id = me();
  const task = (async () => {
    const cloud = await (fetched || readCloudTown(id));
    if (!ownsActiveSave(home) || arrange || WARX.scene || document.hidden) return;
    // A response lost on this device is still the same save. Resume from its acknowledged revision.
    if (prepareWorldSave(home, cloud)) {
      store.set(WORLD_SAVE, pack(home));
      return;
    }
    if (!keepDeviceSave(home, id)) return;
    const state = cloud.state;
    store.set(WORLD_SAVE, pack(state));
    lastSync = Date.now();
    if (visiting) {
      visiting.home = state;
      visiting.cam = state.cam;
      return;
    }
    closeSheet();
    openCat = null;
    S = state;
    setTool(null);
    world.newTown();
    world.sync(S, { tiles: true, roads: true, buildings: true });
    restoreTownCamera(S.cam);
    refresh();
  })().catch(() => { /* keep the device copy active and retry when the world is reachable */ })
    .finally(() => saveRecoveries.delete(home));
  saveRecoveries.set(home, task);
  return task;
}
export async function sendWorldSave(mine, id, leaving) {
  if (typeof mine.world.saveVersion !== "string" && !globalThis.RAFAYA_PREVIEW) {
    const cloud = await readCloudTown(id);
    if (!ownsActiveSave(mine) || arrange) return;
    if (!prepareWorldSave(mine, cloud)) { await syncReply({ conflict: true }, mine, cloud); return; }
  }
  lastSync = Date.now();
  // the money moves too, for the owner's statement of this town (what came in, what went out, and why)
  const ledger = { log: (mine.moneyLog || []).slice(-80), day: mine.day, start: mine.world?.start ?? null,
    hour: visiting ? null : { tax: Math.round(A.tax || 0), shops: Math.round(A.income || 0), farms: Math.round(A.farmIncome || 0), costs: Object.fromEntries(Object.entries(A.costs || {}).map(([k, v]) => [k, Math.round(v || 0)])), net: Math.round(A.net || 0) } };
  const data = { name: id.name, secret: id.secret, pop: mine.pop, happy: Math.round(mine.happy), money: Math.round(mine.money), era: mine.era,
    pending: pendingSummary(mine), restartAt: mine.world.restartAt || 0, warSeq: mine.war?.seq || 0, ledger, snapshot: worldSnapshot(mine) };
  const key = warTownKey(mine);
  let r;
  if (globalThis.RAFAYA_PREVIEW) {
    r = await api("/world/sync", data);
  } else {
    const pendingWrites = Array.isArray(mine.world.pendingWrites) ? mine.world.pendingWrites : [];
    let nextWrite = saveWriters.get(mine);
    if (!nextWrite) { nextWrite = townSaveWriter(); saveWriters.set(mine, nextWrite); }
    const saveWrite = nextWrite();
    const body = JSON.stringify({ ...data, saveVersion: mine.world.saveVersion, saveWrite, pendingWrites });
    mine.world.pendingWrites = rememberPendingSave(pendingWrites, saveWrite);
    store.set(WORLD_SAVE, pack(mine)); // remember a background request even if the app closes before it gets a reply
    if (leaving) {
      worldSync.backgroundAt = Date.now();
      if (navigator.sendBeacon?.(API + "/world/sync", new Blob([body], { type: "application/json" }))) return;
    }
    const response = await fetch(API + "/world/sync", { method: "POST", headers: { "content-type": "application/json" }, body });
    r = await response.json();
    if (r.ok && r.saveVersion === saveWrite) {
      mine.world.saveVersion = saveWrite;
      delete mine.world.pendingWrites;
      if (!arrange && ownsActiveSave(mine)) store.set(WORLD_SAVE, pack(mine));
    }
  }
  if (r?.ok && ownsActiveSave(mine)) { WARX.syncTown = mine; WARX.syncKey = key; WARX.syncMoney = data.money; lastSync = Date.now(); }
  await syncReply(r, mine);
}
addEventListener("online", () => worldSync(true));

// ---------- the owner asked this player to change a name (player and/or town): it has to be done ----------

// ---------- «الدخول بحساب قوقل»: a Google account linked to the player, to sign in from any phone ----------
let gsiLoad = null;
export const gsi = () => (gsiLoad ||= new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "https://accounts.google.com/gsi/client"; sc.async = true; sc.onload = () => res(globalThis.google); sc.onerror = rej; document.head.appendChild(sc); }));
let worldPick = null;
/** How far the world map is zoomed in, kept while the sheet redraws. */
let wmView = null, wmSeen = false;
/**
 * Two fingers zoom the map in and out, one finger drags it, and a short tap picks a plot.
 * The view is the SVG viewBox, kept inside the map.
 */
function mapZoom(svg, W, H, onPick) {
  if (!svg) return;
  let v = wmView || { x: 0, y: 0, w: W, h: H };
  const ratio = H / W;
  const apply = () => {
    v.w = Math.min(W, Math.max(W / 6, v.w)); v.h = v.w * ratio;
    v.x = Math.min(W - v.w, Math.max(0, v.x)); v.y = Math.min(H - v.h, Math.max(0, v.y));
    svg.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
    wmView = v.w >= W ? null : { ...v };
  };
  // zoom by k around a point given in screen pixels
  const zoomAt = (k, cx, cy) => {
    const r = svg.getBoundingClientRect();
    const px = v.x + ((cx - r.left) / r.width) * v.w, py = v.y + ((cy - r.top) / r.height) * v.h;
    const nw = Math.min(W, Math.max(W / 6, v.w / k)), s2 = nw / v.w;
    v.x = px - (px - v.x) * s2; v.y = py - (py - v.y) * s2; v.w = nw;
    apply();
  };
  apply();
  const pts = new Map();
  let start = null, moved = false, pinch = null;
  svg.style.touchAction = "none";
  svg.addEventListener("pointerdown", (e) => {
    if (pts.size >= 2) return;
    try { svg.setPointerCapture(e.pointerId); } catch { /* not a live pointer */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { start = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y, target: e.target }; moved = false; }
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; moved = true; }
  });
  svg.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = svg.getBoundingClientRect();
    if (pts.size >= 2 && pinch) {
      const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 0 && pinch.d > 0) zoomAt(d / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch.d = d;
    } else if (start) {
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) > 8) moved = true;
      if (moved && v.w < W) { v.x = start.vx - (dx / r.width) * v.w; v.y = start.vy - (dy / r.height) * v.h; apply(); }
    }
  });
  const up = (e) => {
    if (!pts.delete(e.pointerId)) return;
    if (pts.size < 2) pinch = null;
    if (pts.size === 0) {
      if (start && !moved && e.type === "pointerup") {
        const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-plot]") || start.target.closest?.("[data-plot]");
        if (el) onPick(Number(el.dataset.plot));
      }
      start = null;
    } else { const [p] = [...pts.values()]; start = { x: p.x, y: p.y, vx: v.x, vy: v.y, target: e.target }; }
  };
  svg.addEventListener("pointerup", up);
  svg.addEventListener("pointercancel", up);
  svg.addEventListener("lostpointercapture", (e) => { if (pts.has(e.pointerId)) up(e); });
  svg.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX, e.clientY); }, { passive: false });
  const mid = (k) => { const r = svg.getBoundingClientRect(); zoomAt(k, r.left + r.width / 2, r.top + r.height / 2); };
  $("wmIn")?.addEventListener("click", () => { sfx.tap(); mid(1.6); });
  $("wmOut")?.addEventListener("click", () => { sfx.tap(); mid(1 / 1.6); });
}
export async function worldMapSheet(pick) {
  worldPick = pick ?? worldPick;
  if (sheetFor !== "world") sheet(`<h2>🌍 عالم الجوف</h2><p class="hint">نحمّل الخريطة…</p>`, "world"); // something on screen at once (the map comes from the server)
  const id = me();
  let plots = [], fronts = [];
  try { const d = await api("/world/map"); plots = d.plots; fronts = d.fronts || []; } catch (e) { if (e.message === "maintenance") worldClosedSheet(); else toast("ما قدرت أوصل للسيرفر", "bad"); return; }
  const byPlot = new Map(plots.map((p) => [p.plot, p]));
  const { cols, rows } = WORLD, cell = 5;
  const colors = { mountain: "#b9a58a", plain: "#e6cf9c", bigwadi: "#c9b878", wadi: "#d8c38e", dunes: "#efc98a", meadow: "#b8c27a" };
  let cells = "";
  for (let k = 0; k < cols * rows; k++) {
    const i = worldPlot(k % cols, Math.floor(k / cols));
    const x = (k % cols) * cell, y = Math.floor(k / cols) * cell, t = byPlot.get(i), mine = id?.plot === i;
    cells += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${colors[worldTerrain(i)]}" class="wm-cell ${worldPick === i ? "on" : ""}" data-plot="${i}"/>`;
    if (t) cells += `<circle cx="${x + cell / 2}" cy="${y + cell / 2}" r="${1.2 + Math.min(1.6, Math.log10((t.pop || 1) + 1) * 0.6)}" class="wm-town ${mine ? "mine" : ""}" data-plot="${i}"/>`;
    const rel = t && !mine && WARX.st?.rels.find((r) => r.other === i);
    if (rel && rel.state !== "peace") cells += `<circle cx="${x + cell - 0.9}" cy="${y + 0.9}" r="1.25" class="wm-rel-bg ${rel.state}"/><svg x="${x + cell - 1.8}" y="${y}" width="1.8" height="1.8" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" class="wm-rel">${ICON_PATHS[REL_ICONS[rel.state].replace(/\uFE0F/g, "")] || ""}</svg>`;
  }
  const labels = WORLD.places.map((p) => `<text x="${p.x * cell + cell / 2}" y="${p.y * cell + cell / 2}" class="wm-place">${p.name}</text>`).join("");
  // the fronts of al-Jouf, for everyone: a red line between every two towns at war (a pale one in a truce)
  const fxy = (p) => { const [x, y] = worldXY(p); return [x * cell + cell / 2, y * cell + cell / 2]; };
  cells += fronts.map((f) => { const [ax, ay] = fxy(f.a), [bx, by] = fxy(f.b), d = Math.hypot(bx - ax, by - ay) || 1, lift = Math.min(6, d * 0.12), cx = (ax + bx) / 2 + (by - ay) / d * lift, cy = (ay + by) / 2 - (bx - ax) / d * lift, ours = f.a === id?.plot || f.b === id?.plot;
    return `<path d="M${ax},${ay} Q${cx},${cy} ${bx},${by}" class="wm-war ${f.state} ${ours ? "ours" : ""}"/>`; }).join(""); // a gentle arc each; mine stand out
  const sel = worldPick, t = sel != null ? byPlot.get(sel) : null;
  const warsOf = (p) => fronts.filter((f) => f.a === p || f.b === p).map((f) => { const o = f.a === p ? f.b : f.a, mine = f.a === p ? f.hitsA : f.hitsB, theirs = f.a === p ? f.hitsB : f.hitsA;
    return row(`${REL_ICONS[f.state] || "⚔️"} ${f.tribute ? "طلب جزية مع" : f.state === "truce" ? "هدنة مع" : f.state === "warning" ? "إنذار حرب مع" : "حرب مع"} «${byPlot.get(o)?.town || "مدينة"}»`, f.state === "war" ? `ضربات ${ar(mine)} مقابل ${ar(theirs)}` : ""); }).join("");
  let detail = `<p class="hint">اضغط على أي أرض: المدن بالأخضر، ومدينتك بالذهبي.</p>`;
  if (sel != null) {
    const terr = TERRAINS[worldTerrain(sel)];
    if (t) {
      const mine = id?.plot === sel, ago = Math.max(0, Math.round((Date.now() - t.updated) / 60000));
      detail = `<div class="rg-card"><div class="rg-top"><b>${t.town}</b><small>${ERAS[t.era || 0].name} · قرب ${worldPlace(sel)} · أرض ${terr.name}</small></div>
        ${!mine && fronts.some((f) => (f.a === sel || f.b === sel) && f.state !== "truce") && !fronts.some((f) => (f.a === sel || f.b === sel) && (f.a === id?.plot || f.b === id?.plot)) ? `<button class="btn ${WARX.follow?.plot === sel ? "" : "go"} block wm-follow" id="wmFollow" type="button">${WARX.follow?.plot === sel ? "👁️ أوقف المتابعة" : "👁️ تابع حربها: تشوف كل ضربة تنزل عليها"}</button>` : ""}
        ${(WARX.st?.medals?.[sel] || []).length ? `<div class="medals">${WARX.st.medals[sel].map((x) => `<span>${medalSvg(medalId(x), 46)}<b>${x.name}<small>${x.text}</small></b></span>`).join("")}</div>` : ""}
        <div class="rows">${warsOf(sel)}${row("العمدة", t.owner)}${row("السكان", money(t.pop || 0))}${row("الرضا", `${ar(t.happy || 0)}٪`)}${row("آخر تحديث", ago < 1 ? "الحين" : ago < 60 ? `قبل ${ar(ago)} دقيقة` : ago < 1440 ? `قبل ${ar(Math.round(ago / 60))} ساعة` : `قبل ${ar(Math.round(ago / 1440))} يوم`)}</div>
        <div class="sheet-actions keep">${mine ? `<button class="btn go block" id="wmEnter" type="button">ادخل مدينتي</button>${t.renamed ? "" : `<button class="btn block" id="wmRename" type="button">✏️ غيّر اسم مدينتك (مرة وحدة بس)</button>`}` : `${warCardHtml(sel)}<button class="btn go block" id="wmVisit" type="button">ادخلها وشوفها</button><button class="btn block" id="wmReport" type="button">بلّغ عن اسم أو كلام مسيء</button>`}</div></div>`;
    } else {
      detail = `<div class="rg-card"><div class="rg-top"><b>أرض فاضية قرب ${worldPlace(sel)}</b><small>أرض ${terr.name}</small></div><p>${terr.text}</p>
        ${id && (id.plot == null) ? `<label class="rg-name">اسم مدينتك <input id="wmTown" type="text" maxlength="20" placeholder="مثلاً: هجرة الشعيب"></label>
          <div class="sheet-actions keep"><button class="btn go block" id="wmClaim" type="button">أسس مدينتك هنا</button></div>` : id && byPlot.get(id.plot) && !byPlot.get(id.plot).moved ? `<p class="hint">كل لاعب له مدينة وحدة بالعالم، بس تقدر تنقل مدينتك هنا بكل اللي فيها (مرة وحدة بس).</p>
          <div class="need">⚔️ قبل الحرب: المدن القريبة من بعض ضرباتها توصل أسرع (صاروخ الجار يوصل بـ١٢ ثانية، والمسيّرة بـ٢٥). اختر مكانك براحتك، وإذا تبي تبقى بديرتك بكيفك.</div>
          <div class="sheet-actions keep"><button class="btn go block" id="wmMove" type="button">🚚 انقل مدينتك هنا</button></div>` : id ? `<p class="hint">عندك مدينة. كل لاعب له مدينة وحدة بالعالم.</p>` : ""}</div>`;
    }
  }
  sheet(`<h2>🌍 عالم الجوف</h2><p>${id ? `أهلًا <b>${id.name}</b> · ` : ""}${ar(plots.length)} مدينة بالعالم${fronts.filter((f) => f.state === "war").length ? ` · <b class="minus">🔥 ${ar(fronts.filter((f) => f.state === "war").length)} حروب</b>` : ""}</p>
    <div class="wm-wrap"><svg class="wm-map" id="wmMap" viewBox="0 0 ${cols * cell} ${rows * cell}" role="img" aria-label="خريطة الجوف">${cells}${labels}</svg>
      <div class="wm-zoom"><button type="button" id="wmIn" aria-label="قرّب">＋</button><button type="button" id="wmOut" aria-label="بعّد">－</button></div></div>
    ${detail}
    ${id?.plot != null && sel !== id.plot ? `<button class="btn block" id="wmMine" type="button">📍 وريني مدينتي</button>` : ""}
    <button class="btn block" id="wmRank" type="button">🏆 الترتيب ومين يحارب مين</button>`, "world");
  // first time open: close in on your own town (or the middle), the whole of al-Jouf is a pinch away
  if (!wmView && !wmSeen) { const [mx, my] = id?.plot != null ? worldXY(id.plot) : [WORLD.cols / 2, WORLD.rows / 2]; const w = cols * cell / 2, h = rows * cell / 2; wmView = { x: mx * cell - w / 2, y: my * cell - h / 2, w, h }; }
  wmSeen = true;
  mapZoom($("wmMap"), cols * cell, rows * cell, (plot) => { sfx.tap(); worldMapSheet(plot); });
  $("wmMine")?.addEventListener("click", () => { wmView = null; wmSeen = false; worldMapSheet(id.plot); });
  $("wmRank")?.addEventListener("click", () => { sfx.tap(); rankSheet(); });
  $("wmFollow")?.addEventListener("click", () => { sfx.tap(); followTown(sel, t.town); worldMapSheet(sel); });
  $("wmEnter")?.addEventListener("click", () => enterWorldTown());
  $("wmRename")?.addEventListener("click", () => { sfx.tap(); renameSheet(t, plots); });
  $("wmVisit")?.addEventListener("click", () => visitTown(sel));
  $("wmRel")?.addEventListener("click", () => relSheet(sel));
  $("wmTarget")?.addEventListener("click", (e) => { const why = e.currentTarget.dataset.why; if (why) { toast(why, "bad"); sfx.deny(); return; } startTargeting(sel); });
  $("wmReport")?.addEventListener("click", async () => {
    try { await api("/world/report", { name: id?.name, secret: id?.secret, plot: sel, reason: "اسم أو كلام مسيء" }); toast("وصل البلاغ، شكرًا", "goal"); } catch { toast("سجّل اسمك أول", "bad"); }
  });
  $("wmMove")?.addEventListener("click", () => { sfx.tap(); moveSheet(byPlot.get(id.plot), sel); });
  $("wmClaim")?.addEventListener("click", async () => {
    const town = ($("wmTown").value || "").trim() || `هجرة ${id.name}`;
    if (plots.some((o) => townNameKey(o.town) === townNameKey(town))) { toast(`فيه مدينة بالجوف اسمها «${town}»، اختر اسم ثاني`, "bad"); sfx.deny(); return; }
    try {
      await api("/world/claim", { name: id.name, secret: id.secret, plot: sel, town, terrain: worldTerrain(sel) });
      store.set(WORLD_ID, JSON.stringify({ ...id, plot: sel }));
      const s = makeWorldTown({ ...id, plot: sel }, town);
      globalThis.RAFAYA_PREVIEW_TOWN?.(s); // the trial copy starts from a ready city
      store.set(WORLD_SAVE, pack(s));
      sfx.era(); toast(`تأسست «${town}» في عالم الجوف! 🎉`, "era");
      enterWorldTown();
    } catch (e) {
      const messages = { 409: "الأرض انأخذت، اختر غيرها", 422: "الاسم مأخوذ لمدينة ثانية بالجوف، اختر غيره", 400: "اختر اسم مناسب لمدينتك" };
      toast(messages[e.message] || "ما زبط التأسيس", "bad");
      if (e.message !== "400") worldMapSheet();
    }
  });
}
/** «انقل مدينتك»: the whole town (buildings, money, people, war, comments) goes to empty land, once a day. */
function moveSheet(t, to) {
  const id = me();
  if (!t || !id) return;
  if (arrange) { toast("احفظ الترتيب أو ألغِه قبل النقل", "bad"); return; }
  sheet(`<h2>🚚 انقل مدينتك</h2><p>تنقل «<b>${t.town}</b>» من ${worldPlace(id.plot)} إلى ${worldPlace(to)}، أرض ${TERRAINS[worldTerrain(to)].name}.</p>
    <p>كل شي ينتقل معك: المباني والفلوس والسكان والمخازن والحرب والعلاقات والتعليقات. أرضك القديمة تصير فاضية.</p>
    <p class="hint"><b>النقل مرة وحدة بس</b>، وبعدها تثبت مدينتك بمكانها. ويطلع خبر هجرتك بالنشرة.</p>
    <div class="need">⚔️ تذكّر: كل ما قربت من مدينة، ضرباتها توصلك أسرع وضرباتك توصلها أسرع. الجار القريب يعطيك وقت أقل تشوف الإنذار وتعبّي دفاعك.</div>
    <div class="sheet-actions keep"><button class="btn go block" id="mvGo" type="button">انقلها الحين</button><button class="btn block" id="mvBack" type="button">رجوع</button></div>`, "world");
  $("mvBack").addEventListener("click", () => worldMapSheet(to));
  $("mvGo").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    try {
      if (worldMode && !visiting) await worldSync(true); // the server has the town as it is now, before it moves
      const r = await api("/world/move", { name: id.name, secret: id.secret, plot: to });
      if (r.error) { toast(r.error, "bad"); sfx.deny(); worldMapSheet(to); return; }
      const from = id.plot;
      store.set(WORLD_ID, JSON.stringify({ ...me(), plot: r.plot }));
      try { const local = JSON.parse(store.get(WORLD_SAVE) || "null"); if (local?.world?.plot === from) { local.world.plot = r.plot; store.set(WORLD_SAVE, JSON.stringify(local)); } } catch { /* the server copy is read instead */ }
      const own = visiting ? visiting.home : S;
      if (own?.world?.plot === from) own.world.plot = r.plot;
      for (const k of Object.keys(localStorage)) if (k.startsWith("rafaya-war-") && k.endsWith(`-${from}`)) { try { localStorage.setItem(k.slice(0, -String(from).length) + r.plot, localStorage.getItem(k)); localStorage.removeItem(k); } catch { /* fine */ } }
      nameLandmarks(worldPlace(r.plot));
      sfx.era(); toast(`🚚 «${t.town}» انتقلت إلى ${worldPlace(r.plot)}! كل شي معك`, "era");
      wmView = null; wmSeen = false;
      if (worldMode) enterWorldTown(); else worldMapSheet(r.plot);
    } catch (err) { toast(err.message === "maintenance" ? "اللعبة بالصيانة، جرّب بعد شوي" : "ما زبط النقل، جرّب مرة ثانية", "bad"); worldMapSheet(to); }
  });
}

/** Play your own town in the world: the deputy's report first if you were away. */
async function enterWorldTown() {
  if (arrange) { toast("احفظ الترتيب أو ألغِه أول", "bad"); return; }
  if (visiting) leaveVisit(); // back to your own state first, so the visited town is never kept
  const id = me();
  const town = worldMode && id?.plot != null && S.world?.plot === id.plot ? S : await readOwnTown(id);
  if (id?.plot !== me()?.plot || id?.name !== me()?.name) return;
  if (!town) { toast("ما قدرنا نقرأ حفظ مدينتك. جرّب بعد شوي", "bad"); return; }
  if (!worldMode) { if (playing) save(); soloS = S; }
  if (id?.plot != null) nameLandmarks(worldPlace(id.plot));
  worldMode = true; document.body.classList.add("world"); showWhatsNewDot();
  liveOpen(); lastTouch = Date.now();
  S = town;
  if (!S.world.syncConflict) S.idle = null;
  if (globalThis.RAFAYA_PREVIEW_SAMPLE) S.day = worldHourNow();
  if (S.day > worldHourNow() + 6) S.day = Math.floor(worldHourNow()); // a town that ran ahead of the world (the phone's clock pushed forward) comes back to the world's hour
  const gap = worldHourNow() - S.day;
  const report = S.world.syncConflict ? null : deputyCatchUp(S, gap);
  A = analyze(S);
  closeSheet(); setTool(null);
  world.newTown(); world.sync(S, { tiles: true, roads: true, buildings: true });
  restoreTownCamera(S.cam);
  startPlaying();
  save(); worldSync(true);
  setTimeout(zeroEnter, 1200); // the war trailer the first time, then the countdown to zero hour (or its announcement)
  if (S.world.syncConflict) return;
  if (report && gap > 1) deputyReport(report);
  warBack(!!report && gap > 1);
  if (!globalThis.RAFAYA_PREVIEW_SAMPLE) setTimeout(maybeWhatsNew, 1200); // after the deputy's report
  setTimeout(pushOffer, 6000); // waits for the report or any screen in front to close
  setTimeout(googleOffer, 20000); // after it: once, the Google link
}

// ---------- «صراع الجوف»: war in the world of al-Jouf (the server decides; see js/warserver.js) ----------
/** Charges, damage and repairs onto the own town (the server's numbers win over the town's own). */
export function warApply(st) {
  if (st.openAt != null) setWarOpen(st.openAt);
  const home = visiting ? visiting.home : S;
  home.war ||= { seq: 0 };
  let paid = 0, supportPaid = 0, posted = false;
  const reasons = new Map([["gift", "gift"], ["citizenSupport", "citizenSupport"], ["cityMilestone", "cityMilestone"], ["refund", "refund"], ["away cap", "awayLimit"]]);
  for (const c of st.charges || []) {
    if (!(c.seq > home.war.seq)) continue;
    const kind = reasons.get(c.why) || "worldBill";
    changeMoney(home, -c.amount, kind, kind === "worldBill" ? String(c.why || "").slice(0, 120) : "");
    home.war.seq = c.seq;
    paid += c.amount;
    if (kind === "citizenSupport") supportPaid -= c.amount;
    posted = true;
  }
  if (home === S && paid > 0) idleClamp(); // asleep: a war bill is paid from the income kept aside first (a refund is not)
  let changed = false;
  const rows = new Map((st.damage || []).map((r) => [`${r.x}:${r.y}`, r]));
  home.tiles.forEach((t, i) => {
    if (!t.b) return;
    const r = rows.get(`${i % N}:${Math.floor(i / N)}`), wd = r && r.bid === t.b.id ? Math.round(r.wd * 10) / 10 : 0;
    if ((t.b.wd || 0) !== wd) { if (wd) t.b.wd = wd; else delete t.b.wd; changed = true; }
  });
  // the dead and the injured of every strike that landed on us leave the town (each strike once): fewer people,
  // and a town in mourning (the people come back as it grows again; the grief fades over the hours)
  home.war.toll ||= [];
  let lost = 0;
  for (const o of st.ops || []) {
    if (o.side !== "in" || o.status !== "done" || !o.result || home.war.toll.includes(o.id)) continue;
    home.war.toll.push(o.id);
    const dead = o.result.dead || 0, hurt = o.result.hurt || 0;
    if (!dead && !hurt) continue;
    home.pop = Math.max(0, (home.pop || 0) - dead - Math.round(hurt / 2)); // the injured stay in hospital a while
    home.happy = Math.max(0, (home.happy || 0) - Math.min(20, dead * 0.4 + hurt * 0.05));
    lost += dead; changed = true;
  }
  home.war.toll = home.war.toll.slice(-200);
  // the count by stage: the military buildings over it go, once (the server paid their worth back ×1.5)
  for (const n of st.notes || []) {
    if (n.kind !== "miltrim" || !Array.isArray(n.trim) || (home.war.trimmed || 0) >= n.at) continue;
    home.war.trimmed = n.at;
    for (const b of n.trim) { const t = home.tiles[b.y * N + b.x]; if (t?.b?.id === b.id) { t.b = null; changed = true; } }
  }
  if (lost && !WARX.scene) toast(`⚰️ فقدت المدينة ${ar(lost)} من أهلها في القصف. الله يرحمهم`, "bad");
  if (world.fx && !visiting) {
    world.fx.repairs = new Map((st.damage || []).filter((r) => r.rep).map((r) => [`${r.x}:${r.y}`, { start: r.rep.start, end: r.rep.end }]));
    const ds = (st.arsenal?.drone || 0) + (st.arsenal?.drone2 || 0), ms = (st.arsenal?.missile || 0) + (st.arsenal?.missile2 || 0);
    if (ds !== world.fx.droneStock || ms !== world.fx.missileStock) { world.fx.droneStock = ds; world.fx.missileStock = ms; changed = true; } // what stands on the pads
  }
  if (!visiting && (changed || posted)) { A = analyze(S); world.sync(S, { buildings: true }); refresh(); }
  if (posted || changed) {
    if (visiting) store.set(WORLD_SAVE, pack(home));
    else save();
    worldSync(true);
  }
  if (posted && !visiting && sheetFor === "budget") budget();
  warWatch(st); // a fresh attack on us plays first; its notes then wait in the log
  // notes: the newest few as toasts, the big ones into the town's news
  const fresh = (st.notes || []).filter((n) => n.at > warSeen()).sort((a, b) => a.at - b.at);
  if (fresh.length) {
    store.set(warKey("seen"), String(fresh[fresh.length - 1].at));
    for (const n of fresh) if (n.kind === "apology" || n.kind === "gift" || n.kind === "miltrim") apologyBox(n); // our own mistake: said plainly, in the middle of the screen
    const won = fresh.find((n) => n.kind === "victory");
    if (won) { home.happy = Math.min(100, (home.happy || 0) + 10); if (!visiting) { A = analyze(S); refresh(); save(); } victoryScreen(won.enemy); } // a war won: the town is proud
    if (!WARX.quietNotes && !WARX.scene) for (const n of fresh.filter((x) => x.kind !== "apology" && x.kind !== "miltrim" && x.kind !== "citizenSupport").slice(-3)) toast(n.text, ["hit", "war", "hostile", "incoming"].includes(n.kind) ? "bad" : ["intercept", "peace", "truce"].includes(n.kind) ? "goal" : "");
    if (fresh.some((n) => n.kind === "incoming" || n.kind === "war")) warSfx.alarm();
    warNews(fresh);
  }
  if (supportPaid > 0) toast(`💰 مبروك نزلك حساب مواطن بقيمة ${money(supportPaid)} ريال، ويمكن نسترده بعدين 🏃🏻`, "goal");
  cityMilestonePopup(st);
  $("warDot").hidden = !(st.rels || []).some((r) => r.offer && r.offer.by !== me()?.plot) && !(st.ops || []).some((o) => o.side === "in" && o.status === "flying");
  if (sheetFor === "war") warSheet(WARX.tab);
}

// ---------- the command: «⚔️ القيادة العسكرية» ----------

// ---------- relations with one town ----------

// ---------- choosing a target inside the enemy town ----------

// ---------- the scenes ----------

// ---------- war damage in the building's sheet ----------

// ---------- the public chat of al-Jouf (world only; it never shows who is online) ----------
export function chatSheet(keep, draft = $("chatText")?.value || "") {
  const id = me(), box = $("chatList"), stick = !keep || !box || box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
  const when = (at) => { const d = new Date(at), today = new Date().toDateString() === d.toDateString(); return d.toLocaleString("ar-SA", today ? { hour: "numeric", minute: "2-digit" } : { weekday: "short", hour: "numeric", minute: "2-digit" }); };
  sheet(`<h2>💬 شات الجوف</h2>
    <div class="chat-list" id="chatList">${CHAT.msgs.length ? CHAT.msgs.map((m) => `<div class="chat-msg ${m.name === id?.name ? "mine" : ""}">
        <div class="chat-head"><b>${m.name}${castleCrown(m.plot)}${(WARX.st?.medals?.[m.plot] || []).map((x) => `<span class="medal" title="${x.name}">${medalSvg(medalId(x), 18)}</span>`).join("")}</b>${m.town ? `<button type="button" class="chat-town" data-town="${m.plot}">${m.town}</button>` : ""}<small>${when(m.at)}</small>${m.name !== id?.name ? `<button type="button" class="chat-rep" data-rep="${m.id}" aria-label="بلّغ">🚩</button>` : ""}</div>
        <p>${m.text}</p></div>`).join("") : `<p class="hint">ما أحد كتب للحين. ابدأ السالفة!</p>`}</div>
    <div class="chat-send keep"><input id="chatText" type="text" maxlength="200" autocomplete="off" enterkeyhint="send" name="chat-message-${Date.now()}" placeholder="اكتب رسالة للكل…" value="${draft.replace(/"/g, "&quot;")}"><button class="btn go" id="chatGo" type="button">أرسل</button></div>
    <p class="hint">الكلام يطلع لكل لاعبين الجوف باسمك. خلك محترم، والكلام المسيء ينحذف ويتبلّغ عنه.</p>
    ${globalThis.RAFAYA_PREVIEW ? "" : '<div class="sheet-actions keep"><button class="btn block" id="developerNote" type="button">ملاحظة خاصة للمطور</button></div>'}`, "chat");
  const list = $("chatList");
  if (stick) list.scrollTop = list.scrollHeight;
  store.set("rafaya-chat-seen", String(CHAT.last));
  chatCount();
  $("developerNote")?.addEventListener("click", () => {
    if (!id) { toast("سجّل اسمك في عالم الجوف أول", "bad"); return; }
    sfx.tap();
    developerNoteSheet(id, $("chatText").value);
  });
  const send = async () => {
    const button = $("chatGo");
    if (button.disabled) return;
    const text = $("chatText").value.trim();
    if (!text) return;
    if (!id) { toast("سجّل اسمك في عالم الجوف أول", "bad"); return; }
    button.disabled = true;
    let r;
    try { r = await api("/world/chat", { name: id.name, secret: id.secret, text }); } catch { r = { error: "ما وصلت الرسالة، جرّب بعد شوي" }; }
    if (r.error) {
      toast(r.error, "bad"); sfx.deny();
      const go = $("chatGo");
      if (go) go.disabled = false;
      return;
    }
    const input = $("chatText");
    if (input?.value.trim() === text) input.value = "";
    sfx.tap();
    await chatPoll(true);
    if (sheetFor === "chat") chatSheet();
  };
  $("chatGo").addEventListener("click", send);
  $("chatText").addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
  $("sheetBody").querySelectorAll("[data-town]").forEach((b) => b.addEventListener("click", () => { wmView = null; wmSeen = false; worldMapSheet(Number(b.dataset.town)); }));
  $("sheetBody").querySelectorAll("[data-rep]").forEach((b) => b.addEventListener("click", async () => {
    const m = CHAT.msgs.find((x) => x.id === Number(b.dataset.rep));
    if (!m || !id) return;
    try { await api("/world/report", { name: id.name, secret: id.secret, plot: m.plot, reason: `شات (${m.name}): ${m.text}` }); toast("وصل البلاغ، شكرًا", "goal"); b.disabled = true; } catch { toast("ما وصل البلاغ", "bad"); }
  }));
}
$("chatBtn").addEventListener("click", async () => { sfx.tap(); chatSheet(); await chatPoll(true); });

/** Back to the menu (or the solo game) from the world. */
export function leaveWorld() {
  if (!worldMode) return;
  if (visiting) leaveVisit(); // never save or send a visited town as yours
  save(); worldSync(true);
  worldMode = false; document.body.classList.remove("world"); showWhatsNewDot();
  $("sOnline").hidden = true;
  nameLandmarks("الرافعية");
  liveClose();
  if (soloS) { S = soloS; soloS = null; A = analyze(S); world.newTown(); world.sync(S, { tiles: true, roads: true, buildings: true }); }
}

// ---------- the region ----------
/** Leave this town (it waits as it is) and open another. */
export function switchTown(id) {
  const raw = store.get(townKey(id));
  if (!raw) { toast("ما لقيت حفظ المدينة", "bad"); return; }
  save();
  let next;
  try { next = unpack(raw); } catch { toast("حفظ المدينة خربان", "bad"); return; }
  S = next; RG.active = id;
  noteNeighbours();
  A = analyze(S);
  closeSheet(); setTool(null);
  world.stopFollow?.(); $("followTag").hidden = true;
  world.sync(S, { tiles: true, roads: true, buildings: true });
  restoreTownCamera(S.cam);
  save(); refresh(); showNewsCount?.();
  toast(`دخلت ${S.name}`, "goal");
}


// ---------- what is new in this version ----------
$("mWhatsNew").addEventListener("click", () => { sfx.tap(); whatsNewSheet(); });
$("mShare").addEventListener("click", () => { sfx.tap(); shareGameSheet(); });
$("mContinue").addEventListener("click", async (e) => {
  sfx.tap();
  const button = e.currentTarget; button.disabled = true;
  try {
    if (globalThis.RAFAYA_PREVIEW_SAMPLE) { await enterWorldTown(); return; }
    if (!onlineOk()) { toast("عالم الجوف يشتغل من رابط اللعبة: rafaya.vamosx.workers.dev", "bad"); return; }
    if (await worldIsClosed()) { worldClosedSheet(); return; }
    await loadClock();
    const id = me();
    if (!id) { worldJoinSheet(); return; }
    try { // the owner's name request comes first; a town taken off the map is forgotten
      const st = await api("/world/war/state", { name: id.name, secret: id.secret, since: 0, seq: 0 });
      if (st.noTown && id.plot != null) { forgetTown(); menuBackdrop(); }
      if (st.namefix) { namefixSheet(st.namefix); return; }
    } catch { /* in anyway */ }
    if (me()?.plot == null) { worldMapSheet(); return; }
    await enterWorldTown();
  } finally { button.disabled = false; }
});
showWhatsNewDot();


// ---------- the people of the house ----------
function familiesHtml(i) {
  A = analyze(S);
  const fams = familiesAt(S, i);
  if (!fams.length) return "";
  const job = jobOf(S, A, i), wish = wishOf(S, A, i);
  return `<h3>👨‍👩‍👧 العوايل اللي ساكنة هنا</h3>${fams.slice(0, 4).map((f, k) => {
    const school = f.kids.filter((c) => c.age >= 6 && c.age <= 18).length;
    return `<div class="family"><div class="fam-top"><b>${f.surname}</b><small>${ar(f.size)} أفراد</small></div>
      <small>${f.kunya}${job ? ` · يشتغل في ${job.name}` : " · يدور شغل"} · ${f.mother}${f.kids.length ? ` · ${kidsWord(f.kids.length)}${school ? ` (${ar(school)} بسن المدرسة)` : ""}` : ""}</small>
      ${wish && k === 0 ? `<small class="wish">💬 يتمنون: ${wish}</small>` : ""}
      <div class="fam-btns"><button class="btn" type="button" data-day="${k}">يومهم</button>${job ? `<button class="btn go" type="button" data-follow="${k}">👁️ تابع ${f.kunya}</button>` : ""}</div></div>`;
  }).join("")}${fams.length > 4 ? `<p class="hint">و${ar(fams.length - 4)} عوايل ثانية.</p>` : ""}`;
}
$("followStop").addEventListener("click", () => { world.stopFollow(); $("followTag").hidden = true; sfx.tap(); });

/** The bank: loans to take, loans running, and paying them off early. */
export function bankSheet() {
  A = analyze(S);
  const has = A.count.bank > 0, limit = creditLimit(S, A), loans = S.loans || [];
  const days = (h) => (h >= 24 ? `${ar(Math.ceil(h / 24))} يوم` : `${ar(h)} ساعة`);
  sheet(`<h2>🏦 البنك</h2>
    ${has ? `<p>تاخذ المبلغ الحين، وتسدده قسط كل ساعة مع فايدة. لو سددت بدري ما تدفع الفايدة الباقية.</p>
    <div class="rows">${row("يقدر البنك يعطيك لين", `${money(limit)} ريال`, "plus")}</div>
    <h3>القروض المتاحة</h3>
    <div class="rows">${LOANS.map((o) => {
      const why = loanBlocker(S, o.id, A), per = loanPer(o);
      return `<div class="row"><span><b>${o.name}: ${money(o.amount)} ريال</b><small>فايدة ${ar(Math.round(o.rate * 100))}٪ · على ${ar(o.days)} أيام · ${money(per)} بالساعة · المجموع ${money(per * o.days * 24)}</small></span>
        <button class="btn go" type="button" data-loan="${o.id}" ${why ? "disabled" : ""}>${why ? (/أكبر/.test(why) ? "فوق حدّك" : "—") : "خذه"}</button></div>`;
    }).join("")}
    ${(() => { const why = LOANS.map((o) => loanBlocker(S, o.id, A)).find((w) => w && !/أكبر/.test(w)); return why ? `<div class="need">${why}</div>` : ""; })()}</div>` : `<p>ما عندك بنك. ابنه من قسم «تجارة» وبعدها تقدر تاخذ قروض.</p>`}
    <h3>قروضك</h3>
    <div class="rows">${loans.length ? loans.map((l, i) => `<div class="row"><span><b>${l.name}</b><small>${money(l.per)} بالساعة · باقي ${days(l.left)}</small></span>
      <button class="btn" type="button" data-pay="${i}" ${S.money < payoffCost(l) ? "disabled" : ""}>سدده بـ${money(payoffCost(l))}</button></div>`).join("") : row("ما عليك قروض", "✓", "plus")}</div>
    <div class="need">انتبه: الأقساط تنخصم كل ساعة حتى لو الميزانية بالسالب، ولو زادت الديون تفلس البلدية.</div>`, "bank");
  document.querySelectorAll("[data-loan]").forEach((b) => b.addEventListener("click", () => {
    const why = takeLoan(S, b.dataset.loan, A);
    if (why) { toast(why, "bad"); sfx.deny(); return; }
    sfx.build(); A = analyze(S); refresh(); save(); toast(`استلمت ${money(LOANS.find((o) => o.id === b.dataset.loan).amount)} ريال من البنك`, "goal"); bankSheet();
  }));
  document.querySelectorAll("[data-pay]").forEach((b) => b.addEventListener("click", () => {
    const why = payLoan(S, Number(b.dataset.pay));
    if (why) { toast(why, "bad"); sfx.deny(); return; }
    sfx.build(); A = analyze(S); refresh(); save(); toast("سددت القرض ✓", "goal"); bankSheet();
  }));
}
$("statUtil").addEventListener("click", () => { sfx.tap(); utilSheet(); });

for (const id of ["budgetBtn", "statMoney"]) $(id).addEventListener("click", () => { sfx.tap(); budget(); });
$("statPop").addEventListener("click", () => { sfx.tap(); popSheet(); });
/** The people: how many, how many homes for them, who is coming or leaving and why, work, the homes by level. */
function popSheet() {
  A = analyze(S);
  const pull = Math.max(0, Math.min(1.2, (S.happy - 20) / 40)) * (1 - A.unemployment * 0.8);
  const target = Math.round(A.cap * Math.min(1, pull));
  const going = target > S.pop ? "up" : target < S.pop ? "down" : "same";
  const reasons = [];
  if (S.pop >= A.cap * 0.95) reasons.push({ t: "البيوت امتلت: ما فيه مكان لناس جدد", fix: "انصب خيام أو طوّر البيوت عشان تسع ناس أكثر" });
  if (S.happy < 60) reasons.push({ t: `الرضا ${ar(Math.round(S.happy))}٪: الناس يجون كامل إذا الرضا ٦٠٪ وفوق`, fix: "شوف تفاصيل الرضا (اضغط مربع الرضا)" });
  if (A.unemployment > 0.1) reasons.push({ t: `البطالة ${ar(Math.round(A.unemployment * 100))}٪: اللي ما يلقى شغل ما يجي`, fix: "افتح محلات ومزارع وورش" });
  if (A.unconnected) reasons.push({ t: `${ar(A.unconnected)} بيت بلا طريق: ما أحد يسكنها`, fix: "وصّلها بطريق" });
  if (A.dryHomes) reasons.push({ t: `${ar(A.dryHomes)} بيت ما يوصلها ماء`, fix: "ابنِ بئر قريب منها" });
  sheet(`<h2>👨‍👩‍👧 السكان</h2>
    <div class="vote"><b>${money(S.pop)}</b><span>${going === "up" ? `يزيدون لين ${money(target)} تقريبًا` : going === "down" ? `ينقصون لين ${money(target)} تقريبًا` : "ثابتين"}</span></div>
    <div class="rows">
      ${row("السعة (كم تسع البيوت)", money(A.cap))}
      ${row("الوظائف", `${money(A.employed)} شغالين من ${money(A.workers)} يبون شغل`, A.unemployment > 0.15 ? "minus" : "plus")}
      ${row("البطالة", `${ar(Math.round(A.unemployment * 100))}٪`, A.unemployment > 0.15 ? "minus" : "")}
      ${row("الضريبة اللي يدفعونها", `+${fine(A.tax)} بالساعة`, "plus")}
    </div>
    ${reasons.length ? `<h3>${going === "down" ? "👎 ليش يطلعون" : "🚧 وش يوقف الزيادة"}</h3><div class="rows">${reasons.map((r) => `<div class="row"><span>${r.t}</span></div><div class="pfix">🛠️ ${r.fix}</div>`).join("")}</div>` : `<div class="need ok">ما فيه شي يوقف الناس عن الجية 👏</div>`}
    <h3>🏠 البيوت</h3><div class="rows">${B.house.levels.map((l, k) => A.levels[k] ? row(l.name, `${ar(A.levels[k])} · يسع كل واحد ${ar(l.cap)}`) : "").join("")}</div>
    <p class="hint">الناس يجون بسرعة إذا فيه مكان والحياة زينة، ويطلعون شوي شوي إذا زعلوا. كل ما زاد السكان صارت الرافعية بلدة ثم مدينة ثم محافظة.</p>`, "pop");
}
$("statHappy").addEventListener("click", () => { sfx.tap(); happySheet(); });
/** Why people are as happy as they are: every part of it, the worst first, with what fixes it. */
function happySheet() {
  A = analyze(S);
  const parts = A.happyParts.filter((p) => p.id === "base" || Math.abs(p.v) >= 0.5);
  const plus = parts.filter((p) => p.v > 0 && p.id !== "base").sort((p, q) => q.v - p.v), minus = parts.filter((p) => p.v < 0).sort((p, q) => p.v - q.v);
  const r = (p) => `<div class="row"><span>${p.label}</span><b class="${p.v >= 0 ? "plus" : "minus"}">${p.v >= 0 ? "+" : "−"}${ar(Math.round(Math.abs(p.v)))}</b></div>`;
  const target = Math.round(A.happyTarget), now = Math.round(S.happy);
  const quarters = districtStats(S, A).sort((p, q) => p.happy - q.happy);
  sheet(`<h2>😊 رضا الناس</h2>
    <div class="vote"><b class="${now >= 60 ? "plus" : now < 40 ? "minus" : ""}">${ar(now)}٪</b><span>${now === target ? "ثابت" : now < target ? `يرتفع شوي شوي لين ${ar(target)}٪` : `ينزل شوي شوي لين ${ar(target)}٪`}</span></div>
    ${minus.length ? `<h3>👎 اللي يزعلهم</h3><div class="rows">${minus.map((p) => r(p) + (p.fix ? `<div class="pfix">🛠️ ${p.fix}</div>` : "")).join("")}</div>` : `<div class="need ok">ما فيه شي يزعلهم الحين 👏</div>`}
    ${plus.length ? `<h3>👍 اللي يفرحهم</h3><div class="rows">${plus.map(r).join("")}</div>` : ""}
    <div class="rows">${row("الأساس", ar(48))}${row("المجموع", `${ar(target)}٪`, target >= 60 ? "plus" : target < 40 ? "minus" : "")}</div>
    ${quarters.length > 1 ? `<h3>🏘️ رضا الحارات</h3><div class="rows">${quarters.map((o) => row(o.name, `${ar(o.happy)}٪`, o.happy >= 60 ? "plus" : o.happy < 40 ? "minus" : "")).join("")}</div>` : ""}
    ${A.count.mosque || A.count.bigmosque ? `<button class="btn block" id="showMosques" type="button">🕌 اعرض وين توصل المساجد${mosqueGaps() ? ` (${ar(mosqueGaps())} بيت برا المدى)` : ""}</button>` : ""}
    <p class="hint">الرضا العالي يجيب ناس جدد ويخلي البيوت تتطور، والقليل يطفّش الناس. والرضا ما يتغير فجأة: يمشي شوي شوي نحو المجموع.</p>`, "happy");
  $("showMosques")?.addEventListener("click", () => { sfx.tap(); mosqueMap(); });
}

$("turnBtn").addEventListener("click", () => { sfx.tap(); world.turn(1); });
$("worldBtn").addEventListener("click", () => { sfx.tap(); if (worldMode) worldMapSheet(); else openWorld(); }); // solo too: the way into al-Jouf, on the game screen
$("deputyBtn").addEventListener("click", () => { sfx.tap(); deputySheet(); });

// ---------- المستشار المالي: a paid reading of the town (js/advisor.js), the first one free ----------
$("advisorBtn").addEventListener("click", () => { sfx.tap(); advisorSheet(); });
$("warBtn").addEventListener("click", async () => { sfx.tap(); warRoom(); }); // «غرفة العمليات»: the whole war in one screen
$("findBtn").addEventListener("click", () => { sfx.tap(); findSheet(); }); // «بحث»: any building of the town, and fly to it
$("warGuideBtn").addEventListener("click", () => { sfx.tap(); warGuide(); }); // «دليل الحرب»: how war works and its rules
$("warAlert").addEventListener("click", () => { sfx.tap(); warRoom(ROOM.tab); });
$("warSkip").addEventListener("click", () => { sfx.tap(); WARX.skipFlight = true; world.fx.skip(); });

$("goal").addEventListener("click", () => { sfx.tap(); goals(); });

// ---------- settings, saving, the main menu ----------

export function settingsSheet(fromMenu) {
  const q = settings.quality, pushStatus = pushState();
  const id = me();
  if (pushStatus === "off" && id?.plot != null) pushKey().catch(() => {});
  const deviceCopy = id?.plot != null ? store.get(conflictCopyKey(id)) : null;
  sheet(`<h2>الإعدادات</h2>
    <h3>الرسوم</h3><p>«عالية» فيها توهّج الانفجارات والأضواء وأعلى دقة. لو الجوال يسخن أو البطارية تخلص بسرعة، اختر «متوسطة» أو «خفيفة».</p>
    <div class="seg seg-wrap">${[["auto", "✨ تلقائي"], ["saver", "🔋 توفير"], ["low", "خفيفة"], ["medium", "متوازنة"], ["high", "عالية"], ["ultra", "فائقة"]].map(([k, n]) => `<button type="button" class="${q === k ? "on" : ""}" data-q="${k}">${n}</button>`).join("")}</div>
    <p class="hint">${{ auto: "يختار لحاله حسب جوالك، ويخفف إذا الجوال تعب أو سخن، ويرجع يرفع إذا ارتاح.", saver: "أقل استهلاك للبطارية والحرارة: ٣٠ إطار بالكثير، بدون ظلال ولا زحمة سيارات.", low: "للجوالات الضعيفة: بدون ظلال ولا توهج.", medium: "جودة حلوة واستهلاك معتدل.", high: "ظلال ناعمة وتوهج الأضواء بالليل، ٦٠ إطار.", ultra: "أعلى دقة وأنعم ظلال، للجوالات والكمبيوترات القوية." }[q]}</p>
    <div class="rows" style="margin-top:10px">
      ${isAndroid && document.documentElement.requestFullscreen ? `<label class="row toggle"><span>📱 شاشة كاملة <small>(بدون أشرطة المتصفح)</small></span><input type="checkbox" id="setFull" ${store.get("rafaya-fullscreen") !== "0" ? "checked" : ""}></label>` : ""}
      <label class="row toggle"><span>الأصوات</span><input type="checkbox" id="setSound" ${sfx.on ? "checked" : ""}></label>
      <label class="row vol-row"><span>🎵 موسيقى الحرب</span><input type="range" min="0" max="100" step="1" id="setWarVol" value="${Math.round(warMusic.volume * 100)}" aria-label="صوت موسيقى الحرب"><small>${warMusic.volume > 0 ? "" : "مطفية"}</small></label>
      <label class="row toggle"><span>أصوات الحرب (إنذار وانفجارات)</span><input type="checkbox" id="setWarSound" ${warSfx.on ? "checked" : ""}></label>
      ${pushStatus !== "no" ? `<label class="row toggle"><span>🔔 التنبيهات على الجوال <small>(عالم الجوف)</small></span><input type="checkbox" id="setPush" ${pushStatus === "on" ? "checked" : pushStatus === "checking" ? "disabled" : ""}></label>` : ""}
    </div>
    ${me()?.plot != null ? `<h3>🔔 تنبيهات الجوف</h3><p>الهجوم والحرب، ولما أحد يذكرك بالشات، ولما مواطنينك يبونك. حتى واللعبة مسكّرة.</p>
    <div class="rows">${(() => { const st = pushStatus; return st === "checking" ? `<p class="hint">نتأكد من اشتراك هالجهاز…</p>` : st === "on" ? `<button class="btn go block" id="pushTest" type="button">📲 جرّب التنبيه</button><div id="pushTestStatus" role="status" aria-live="polite"></div>` : st === "denied" ? `<button class="btn block" id="pushDenied" type="button">🔒 التنبيهات مقفلة: كيف أرجّعها؟</button>` : st === "no" ? `<div class="need">${isIOS ? "تنبيهات الآيفون تحتاج iOS 16.4 أو أحدث، واللعب من أيقونة الشاشة الرئيسية." : "هالمتصفح ما يدعم التنبيهات. جرّب Chrome أو متصفح يدعم إشعارات المواقع."}</div>` : `<p class="hint">شغّلها من «🔔 التنبيهات على الجوال» فوق.</p>`; })()}</div>` : ""}
    ${isIOS && !standalone() && onlineOk() && !globalThis.RAFAYA_PREVIEW ? `<h3>📲 التطبيق</h3><p>حاط اللعبة تطبيق بشاشتك؟ انقل لها لعبتك من هنا.</p><button class="btn block" id="moveCode" type="button">📲 انقل لعبتك للتطبيق</button>` : ""}
    ${me()?.plot != null ? `<h3>🔄 مدينتك بالجوف</h3><p>تبي تبدأ من الصفر؟ نفس الأرض ونفس الاسم، بس كل شي يرجع من أول.</p><button class="btn danger block" id="worldRestart" type="button">🔄 ابدأ مدينتي من جديد</button>` : ""}
    ${id && onlineOk() ? `<h3>✏️ اسمك</h3><div id="nameBox"><p class="hint">نشيّك…</p></div>` : ""}
    ${id && onlineOk() && !globalThis.RAFAYA_PREVIEW ? `<h3>🔐 حسابك وقوقل</h3><div id="googleBox"><p class="hint">نشيّك…</p></div>` : ""}
    <h3>نسخة احتياطية</h3>
    <p>المدينة تنحفظ لحالها في جوالك. تبي تنقلها لجهاز ثاني؟ اطلع لها كود قصير، واكتبه بالجهاز الثاني. الكود يبقى ٦٠ يوم.</p>
    <div id="backupBox"></div>
    <div class="sheet-actions two"><button class="btn" id="copySave" type="button">🔑 اطلع كود</button><button class="btn" id="loadSave" type="button">استرجع من كود</button></div>
    ${deviceCopy ? `<button class="btn block" id="copyDeviceSave" type="button">نسخة الجهاز قبل المزامنة</button>` : ""}
    <h3>عن اللعبة</h3>
    <p>صُنعت في الرافعية بيد Vamos. الرسم ثلاثي الأبعاد بمكتبة three.js (ترخيص MIT)، وكل المباني مصممة داخل اللعبة.</p>`, fromMenu ? "settings-menu" : "settings");
  $("sheetBody").querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => {
    store.set("rafaya-quality", b.dataset.q); save();
    toast("نطبّق الإعداد…"); setTimeout(() => location.reload(), 300);
  }));
  $("moveCode")?.addEventListener("click", () => moveCodeSheet());
  googleSection(); nameSection();
  $("worldRestart")?.addEventListener("click", () => restartSheet());
  $("copyDeviceSave")?.addEventListener("click", () => {
    const box = $("backupBox");
    box.innerHTML = `<label class="rg-name">كود نسخة هذا الجهاز <textarea id="deviceSaveCode" dir="ltr" readonly></textarea></label>`;
    const field = $("deviceSaveCode");
    field.value = b64(new TextEncoder().encode(deviceCopy));
    field.focus();
    field.select();
    navigator.clipboard?.writeText(field.value).then(() => toast("نسخت الكود ✓"), () => {});
  });
  $("pushDenied")?.addEventListener("click", () => pushDeniedHelp());
  $("pushTest")?.addEventListener("click", async (e) => {
    const button = e.currentTarget, status = $("pushTestStatus"), id = me();
    const receipt = crypto.randomUUID();
    let onReceipt, timer;
    const confirmation = new Promise((resolve) => {
      onReceipt = ({ data }) => { if (data?.type === "push-test" && data.receipt === receipt) resolve(data.shown); };
    });
    const systemHelp = isIOS ? "شيّك إشعارات الرافعية والتركيز في إعدادات الآيفون." : "شيّك إذن الإشعارات للتطبيق أو المتصفح في إعدادات الجهاز.";
    navigator.serviceWorker.addEventListener("message", onReceipt);
    button.disabled = true;
    status.textContent = "نرسل التجربة وننتظر رد هالجهاز…";
    try {
      const sub = await (await activePushWorker()).pushManager.getSubscription();
      if (sub) {
        await registerPushEndpoint(sub, id);
        const r = await api("/world/push/test", { name: id.name, secret: id.secret, endpoint: sub.endpoint, receipt });
        if (r.ok) {
          const shown = await Promise.race([confirmation, new Promise((resolve) => { timer = setTimeout(resolve, 12000); })]);
          status.textContent = shown === true ? `وصل التنبيه لهالجهاز وطلبنا عرضه. إذا ما ظهر لك، ${systemHelp}`
            : shown === false ? `وصل التنبيه وتعذّر عرضه على الجهاز. ${systemHelp}`
              : "ما جانا تأكيد من هالجهاز. طفّ «التنبيهات على الجوال» وشغّلها من جديد، ثم جرّب مرة ثانية.";
          return;
        }
        if (!r.expired) { status.textContent = r.error || "ما قدرنا نرسل التجربة. جرّب بعد شوي."; return; }
        await sub.unsubscribe();
      }
      PUSH.enabled = false;
      toast("اشتراك هالجهاز انتهى. فعّل التنبيهات مرة ثانية.", "bad");
      if (button.isConnected) settingsSheet(fromMenu);
    } catch { status.textContent = "ما قدرنا نرسل التجربة. جرّب بعد شوي."; }
    finally {
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("message", onReceipt);
      button.disabled = false;
    }
  });
  const pushToggle = $("setPush");
  if (pushToggle && pushStatus === "checking") checkPush()?.then(() => {
    if (pushToggle.isConnected) settingsSheet(fromMenu);
  });
  pushToggle?.addEventListener("change", async (e) => {
    const want = e.target.checked;
    e.target.disabled = true;
    if (!want) await pushOff();
    else await pushOn();
    if (e.target.isConnected) settingsSheet(fromMenu);
  });
  $("setFull")?.addEventListener("change", (e) => {
    store.set("rafaya-fullscreen", e.target.checked ? "1" : "0");
    if (e.target.checked) document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
    else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  });
  $("setSound").addEventListener("change", (e) => { sfx.set(e.target.checked); sfx.tap(); });
  $("setWarVol").addEventListener("input", (e) => warMusic.setVolume(Number(e.target.value) / 100));
  $("setWarSound").addEventListener("change", (e) => { warSfx.set(e.target.checked); sfx.tap(); });
  // the backup: a short code (the town waits on the server, 60 days), or the long code when the server can't be reached
  const short = onlineOk() && !globalThis.RAFAYA_PREVIEW && typeof CompressionStream !== "undefined";
  $("copySave").addEventListener("click", async (e) => {
    const box = $("backupBox"), button = e.currentTarget;
    if (arrange) { toast("احفظ الترتيب أو ألغِه أول", "bad"); return; }
    button.disabled = true;
    const id = me();
    const town = fromMenu && id?.plot != null ? await readOwnTown(id) : (visiting?.home ?? S);
    if (!button.isConnected) return;
    if (!town) { button.disabled = false; toast("ما قدرنا نقرأ مدينتك عشان ننسخها", "bad"); return; }
    const snapshot = pack(town);
    let code = "";
    if (short) {
      box.innerHTML = `<p class="hint">نطلع الكود…</p>`;
      try {
        const account = id && town.world ? { name: id.name, secret: id.secret } : null;
        const r = await (await fetch(API + "/move/backup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: await gzipText(snapshot), old: store.get("rafaya-backup-code") || "", account }) })).json();
        if (r.code) { code = `${r.code.slice(0, 4)}-${r.code.slice(4)}`; store.set("rafaya-backup-code", r.code); }
      } catch { /* the long code below */ }
    }
    button.disabled = false;
    if (!box.isConnected) return;
    if (code) box.innerHTML = `<div class="backup-code" dir="ltr">${code}</div><p class="hint">هذا كود مدينتك الحين. لو كملت لعب وتبي آخر شي، اطلع كود جديد.</p>`;
    else { code = b64(new TextEncoder().encode(snapshot)); box.innerHTML = `<textarea id="saveCode" readonly></textarea><p class="hint">ما قدرنا نوصل للسيرفر، فهذا الكود الطويل.</p>`; $("saveCode").value = code; }
    try { await navigator.clipboard.writeText(code); toast("انسخ الكود ✓"); } catch { $("saveCode")?.select(); }
  });
  $("loadSave").addEventListener("click", function first() { // the first tap shows the box; the next one restores (it used to clear what was typed)
    this.removeEventListener("click", first);
    $("backupBox").innerHTML = `<label class="rg-name">الكود <input id="restoreCode" type="text" autocomplete="off" dir="ltr" placeholder="ABCD-EFGH" style="text-transform:uppercase"></label>`;
    $("restoreCode").focus();
    $("loadSave").textContent = "استرجع الحين";
    $("loadSave").onclick = async (event) => {
      if (arrange || visiting) { toast("ارجع لمدينتك وخلّص ترتيبها أول", "bad"); return; }
      const button = event.currentTarget, current = S, id = me();
      const raw = $("restoreCode").value.trim();
      button.disabled = true;
      try {
        let text;
        if (raw.replace(/[^A-Za-z0-9]/g, "").length === 8) { // the short code
          const r = await (await fetch(API + "/move/restore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: raw }) })).json();
          if (r.error || !r.data) { toast(r.error || "الكود غير صحيح", "bad"); return; }
          text = await gunzipText(r.data);
        } else text = new TextDecoder("utf-8", { fatal: true }).decode(unb64(raw));
        if (!button.isConnected || S !== current || me()?.plot !== id?.plot || me()?.name !== id?.name || visiting || arrange) return;
        const restored = unpack(text), next = analyze(restored);
        if (restored.world) {
          if (id?.plot !== restored.world.plot || id?.name !== restored.world.owner) {
            toast("ادخل حساب المدينة نفسها في الجوف قبل تسترجع نسختها", "bad"); return;
          }
          const active = worldMode ? current : await readOwnTown(id);
          if (!button.isConnected || S !== current || me()?.plot !== id.plot || me()?.name !== id.name || visiting || arrange) return;
          if ((active?.world?.restartAt || 0) > (restored.world.restartAt || 0) || (active?.war?.seq || 0) > (restored.war?.seq || 0)) {
            toast("هالنسخة أقدم من آخر تحديث لحساب مدينتك", "bad"); return;
          }
          if (!worldMode) { store.set(WORLD_SAVE, pack(restored)); menuBackdrop(); }
          else { S = restored; A = next; world.newTown(); world.sync(S); restoreTownCamera(S.cam); refresh(); save(); worldSync(true); }
        } else {
          if (worldMode) { toast("هذا كود مدينة من طور مختلف", "bad"); return; }
          S = restored; A = next; world.newTown(); world.sync(S); restoreTownCamera(S.cam); refresh(); save();
        }
        closeSheet(); toast("رجعت مدينتك!", "goal");
      } catch { toast("الكود غير صحيح", "bad"); }
      finally { button.disabled = false; }
    };
  });
}


$("reachStop").addEventListener("click", () => { sfx.tap(); reachClose(); });
$("reachInfo").addEventListener("click", () => { sfx.tap(); const a = reachView.at; reachClose(); if (a) inspect(a.x, a.y); });
$("pauseMenuBtn").addEventListener("click", () => { sfx.tap(); pauseMenu(); });

export function showMenu() {
  playing = false;
  setTool(null); openCat = null; renderCards();
  document.body.classList.add("at-menu");
}


function startPlaying() {
  document.body.classList.remove("at-menu");
  if (MENU.pitch != null) { world.view.pitch = MENU.pitch; world.updateCamera(); } // back to the game's view from the menu's flight
  playing = true;
  refresh();
  scheduleLayout();
}

$("mHow").addEventListener("click", () => { sfx.tap(); howTo(true); });
$("mSettings").addEventListener("click", () => { sfx.tap(); settingsSheet(true); });

// ---------- the clock ----------

let ambT = 0;
let last = performance.now(), acc = 0, tod = 0.36, shownTime = "";
/** One town hour: the simulation moves on, and the screen shows what happened. */
// ---------- asleep with the game open (al-Jouf): after 15 minutes untouched the deputy takes over ----------
 // (tests shorten it)
export let lastTouch = Date.now();
function idleWake() {
  lastTouch = Date.now();
  if (!S?.idle) return;
  const gained = Math.round(S.money - S.idle.money);
  S.idle = null;
  if (worldMode) toast(`☀️ هلا بك! وانت غافي ${gained >= 0 ? "كسبت" : "صرفت"} ${money(Math.abs(gained))} ريال`, "goal");
}
for (const ev of ["pointerdown", "keydown", "wheel"]) addEventListener(ev, idleWake, { capture: true, passive: true });

/**
 * Phones get hot when a page draws at the screen's full rate (120 a second on newer iPhones) all the time.
 * So the town draws 30 times a second when nothing moves fast, and faster only while a finger is on the
 * screen, the camera turns, or a war scene or a building's rise is playing.
 */
let lastDraw = 0;
let fpsBusy = RENDER.busy, fpsIdle = RENDER.idle;
export function perfSet(level, now) {
  const max = RENDER.adapt ? 4 : 2;
  level = Math.max(0, Math.min(max, level));
  if (level === perf.level) return;
  if (level > perf.level) perf.downAt = now;
  perf.level = level;
  world.setLevel(Math.min(3, level));
  fpsBusy = level >= 4 ? Math.min(30, RENDER.busy) : RENDER.busy;
}
try { localStorage.removeItem("rafaya-perf-level"); localStorage.removeItem("rafaya-perf-quality"); } catch { /* fine */ }
if (perfHud) {
  perfHud.style.cssText = "position:fixed;z-index:50;left:8px;bottom:calc(var(--dock-space,0px) + 8px);padding:4px 8px;border-radius:8px;background:rgba(0,0,0,.62);color:#fff;font:600 11px/1.35 ui-monospace,monospace;direction:ltr;pointer-events:none";
  let frames = 0, t0 = performance.now();
  perfHud.tick = () => { frames++; const t = performance.now(); if (t - t0 < 1000) return;
    const fps = Math.round(frames * 1000 / (t - t0)); frames = 0; t0 = t;
    perfHud.textContent = `${fps} fps · ${settings.quality} L${perf.level} · ${world.renderer.getPixelRatio().toFixed(2)}x · ${world.renderer.shadowMap.enabled ? "shadows" : "no shadows"} · ${world.drawnBuildings ?? 0} bld${world.lodFar ? " far" : ""}`; };
}
function frame(now) {
  const busy = pointers.size > 0 || drag || world.fx?.tasks.length || world.fx?.activeParts || world.floodAnim || world.anims?.size || Math.abs(world.view.yaw - world.view.yawTarget) > 1e-3 || arrange;
  // behind an open sheet, or on the main menu, the town barely needs to move
  const quiet = !busy && (!playing || (!$("sheet").hidden && !WARX.scene));
  const flying = !playing && MENU.town; // the menu's flight over your town: smooth, not the 15 frames of a still menu
  const wanted = 1000 / (busy ? fpsBusy : (quiet && !flying) || S?.idle ? 15 : fpsIdle);
  if (now - lastDraw < wanted - 2) { requestAnimationFrame(frame); return; } // nobody watching: slow, cool and kind to the battery
  lastDraw = now;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const paused = ["away", "pause", "settings", "how", "decision", "election", "whatsnew", "update"].includes(sheetFor);
  if (arrange) { /* wait for the layout to be settled */ }
  else if (worldMode && (visiting?.home ?? S).world?.syncConflict) {
    if (now >= saveRetryAt) { saveRetryAt = now + 10000; worldSync(true); }
  } else if (playing && !visiting && worldMode) {
    // the world's clock: one town hour every 50 seconds of real time, for everyone, always
    const wh = worldHourNow();
    if (S.day > wh + 6) S.day = Math.floor(wh); // ahead of the world (an old clock trick): back to the world's hour, nothing paid
    if (!paused && wh - S.day > 3) {
      // the phone was asleep or the game in the background: the deputy ran the town (with the away cap)
      const r = deputyCatchUp(S, wh - S.day);
      idleClamp(); // asleep and then hidden: still one cap
      A = analyze(S); world.sync(S, { tiles: true, roads: true, buildings: true }); save(); refresh();
      if (r && (r.money || r.pop)) deputyReport(r);
    } else if (!paused && S.day < wh) runHour();
    acc = Math.max(0, Math.min(HOUR_MS - 1, (worldHours() % 1) * HOUR_MS));
  } else if (playing && !visiting && speed > 0 && !paused) {
    acc += dt * 1000 * speed;
    while (acc >= HOUR_MS) { acc -= HOUR_MS; runHour(); }
  }
  if (playing) {
    const d = seasonOf(S.day).daylight, p = (hourOf(S.day) + acc / HOUR_MS) / HOURS;
    tod = sunAt(p, d);
    const part = partOfDay(p, d), text = `${part} ${clockAt(p, d)}${world.prayer ? " · 🕌" : ""}`;
    if (text !== shownTime) { shownTime = text; $("sTime").textContent = text; $("sTime").dataset.p = part; world.nightTime = part === "الليل" || part === "الفجر"; }
  }
  if (!playing) {
    if (MENU.town) { // a slow flight over your town: higher up, drifting across it
      MENU.t += dt; const v = world.view;
      v.pitch = 0.88; v.zoom = 0.62 + 0.08 * Math.sin(MENU.t * 0.07);
      v.x = MENU.cx + Math.sin(MENU.t * 0.045) * 4; v.z = MENU.cz + Math.cos(MENU.t * 0.06) * 3;
    }
    world.view.yawTarget += dt * 0.06; world.view.yaw = world.view.yawTarget; world.updateCamera(); tod = (tod + dt / 300) % 1;
  }
  if (playing && S.decision && $("sheet").hidden && !WARX.scene) decisionSheet(); // never over a war scene
  if (playing && worldMode && !arrange) { warPoll(); chatPoll(); wnewsPoll(); onlinePoll(); } // «صراع الجوف» every 25 s; the chat every 20 s (4 s while open)
  ambT -= dt;
  // lightning far off while it rains: a flash in the clouds, the rumble a moment later
  if (playing && world.raining && !document.hidden && Math.random() < dt / 22) { world.skyFlash(); sfx.thunder(0.15 + Math.random() * 0.25, 1 + Math.random() * 2.5); }
  if (ambT <= 0) { ambT = 0.5; ambience.update({ playing, night: world.nightTime, raining: world.raining, season: seasonOf(S.day).id, dusty: world.dusty }); }
  const t0 = performance.now();
  const previewLight = globalThis.RAFAYA_PREVIEW_LIGHT?.(), previewWeather = globalThis.RAFAYA_PREVIEW_WEATHER?.();
  if (previewWeather) {
    world.previewStorm = previewWeather.rain;
    world.previewWet = previewWeather.wet;
  }
  if (previewLight != null) {
    world.previewTod ??= previewLight;
    world.previewTod += (previewLight - world.previewTod) * (1 - Math.exp(-dt * 5));
    world.previewNight = world.previewTod > .81;
  }
  world.frame(dt, world.previewTod ?? tod);
  perfWatch(performance.now() - t0, now, wanted, busy);
  perfHud?.tick();
  if (world.follow && world.followPos) {
    const q = world.project(world.followPos), tag = $("followTag");
    tag.style.transform = `translate(${Math.round(q.sx)}px, ${Math.round(q.sy - 70)}px) translate(-50%, -100%)`;
    $("followWhat").textContent = world.follow.dir > 0 ? `رايح لدوامه في ${world.follow.label.to}` : "راجع لبيته";
  }
  requestAnimationFrame(frame);
}

// ---------- iPhone Safari and leaving the page ----------

// Safari also emits legacy pinch gestures. Only the two game maps own those gestures.
for (const event of ["gesturestart", "gesturechange"]) {
  document.addEventListener(event, (e) => {
    if (pointers.size || e.target.closest?.("#map, .wm-map")) e.preventDefault();
  }, { passive: false });
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) save(true);
  else if (worldMode) loadClock(); // the steady timer may have stopped while the phone slept: ask the server the time again
  if (!document.hidden && playing) {
    refresh();
    if (worldMode && (visiting?.home ?? S).world?.syncConflict) worldSync(true);
    cityMilestonePopup(WARX.st);
  }
});
addEventListener("pagehide", () => save(true));

// For tests and curious players.
Object.defineProperty(window, "__S", { get: () => S });
window.__world = world;
window.__play = startPlaying;
window.__tod = (t) => { tod = t; playing = false; };

// ---------- start ----------

renderCats();
refresh();
showMenu();
menuBackdrop();
$("loading").classList.add("done");
setTimeout(() => $("loading").remove(), 700);
requestAnimationFrame(frame);
