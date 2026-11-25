// الرافعية: the game loop, the controls, the main menu and every screen around the 3D town.
import { VERSION, REQUIRED } from "./version.js";
import { B, MIL, CATS, TECH, GOALS, ERAS, EVENTS, DECISIONS, ACHIEVEMENTS, MAP_SIZE as N, HOURS, SEASON_DAYS, SEASONS, PRAYERS, PLOTS, LOANS, SUBSIDY, BIZ_LEVELS, bizLevel, VAULT, DISTRICT_NAMES, ELECTION_GRANT, PROVINCE_FEES, GROUND, FILL_COST, CHAINS, MAT, ROAD_IDS, TERRAINS, SITES, REGION, WORLD, worldTerrain, worldPlace, worldXY, worldPlot, townNameKey } from "./data.js";
import { newGame, step, build, demolish, cantBuild, analyze, houseBlocker, upgradeHouse, upgradeCost, upgradePrice, upgradeEffect, upgradeAt, upgradeBlocker, upgradable, levelName, decide, optionCost, repair, repairAll, repairCost, condFactor, seasonOf, dayOf, hourOf, owns, plotAt, plotPrice, buyPlot, startResearch, fillWadi, deputyCatchUp, DEPUTY, AWAY_CAP, doorOf, roadPath, prayerNow, districtOf, districtName, districtStats, voteShare, hoursToElection, moveCost, moveBlocker, moveBuilding, layoutBlocker, creditLimit, loanBlocker, loanPer, takeLoan, payLoan, payoffCost, catchUp, pack, unpack, idx, inMap, ROCK_CLEAR, techUnlocked, changeMoney, worldEventsAt, provinceFee, moneyCap, priceOf, houseTop, housePrice, buildHouseAt, buildCost, removalRefund, joufHours, idleWhy } from "./sim.js";
import { World, thumbnail } from "./world3d.js";
import { advise, ADVISOR_FEE, ADVISOR_HOURS } from "./advisor.js";
import { WarFX } from "./warfx.js";
import { watchIcons, ICON_PATHS } from "./icons.js";
import { WAR, WEAPONS, WEAPON_IDS, TARGETS, canTarget, milStat, weaponBlocker, damageState, warFactor, repairCostOf, repairMsOf, flightMs, relActions, REL_NAMES, REL_ICONS, THREATS, minutesText } from "./war.js";
import { modelKey, setLandStyle, PLACE_STYLE } from "./models.js";
import { sfx, ambience, warSfx } from "./sound.js";
import { writePosts, followUps, decisionReaction, replyOptions, answerPost, moodOf, FIX_HINT, topicName } from "./news.js";
import { familiesAt, jobOf, wishOf, familyDay } from "./people.js";

const $ = (id) => document.getElementById(id);
const AR = "٠١٢٣٤٥٦٧٨٩";
const ar = (n) => String(n).replace(/\d/g, (d) => AR[d]);
const money = (n) => ar(Math.round(n).toLocaleString("en-US"));
/** Money with one decimal for small amounts (٠٫٦) and whole numbers otherwise. */
const fine = (n) => (Math.abs(n) < 10 && Math.round(n) !== n ? ar(n.toFixed(1)).replace(".", "٫") : money(n));
const SAVE = "rafaya-save-v1";
const storePrefix = globalThis.RAFAYA_PREVIEW_STORAGE || "";
const trialStore = storePrefix ? new Map() : null;
const store = {
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
const RENDER = {
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
const townKey = (id) => (id === "main" ? SAVE : `rafaya-town-${id}`);
let RG = null;
try { RG = JSON.parse(store.get(REGION_KEY) || "null"); } catch { RG = null; }
if (!RG || !RG.towns) RG = { towns: {}, roads: [], active: "main" };
const saveRegion = () => store.set(REGION_KEY, JSON.stringify(RG));

let S = null;
if (globalThis.RAFAYA_PREVIEW_SAMPLE && !store.get("rafaya-world-town")) {
  const sample = globalThis.RAFAYA_PREVIEW_SAMPLE();
  store.set("rafaya-world-id", JSON.stringify(sample.id));
  store.set("rafaya-world-town", pack(sample.town));
  store.set("rafaya-world-gen", "2");
}
try { const raw = store.get(townKey(RG.active)) || store.get(SAVE); if (raw) S = unpack(raw); } catch { S = null; }
if (!S) S = newGame();
let A = analyze(S);
let playing = false;
let speed = 1;
let tool = null; // { id } | { id: "bulldoze" } | null (look around)
let openCat = null;
// A town day is 24 hours and lasts 20 minutes at normal speed (50 seconds an hour). For a while it was
// 30 minutes (75 s an hour); the owner found it too slow, so it is back to 20 (see worldHours for the world's clock).
// The town moves forward one step every hour. Days start at sunrise; how much of the day is
// light depends on the season (spring and autumn 10 min + 10 min, summer 12 + 8, winter 8 + 12).
const HOUR_MS = 50000;
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

let arrange = null; // the layout editor's state while it is open (see enterArrange)
let visiting = null; // { code, town, comments } while looking at another player's town
let worldMode = false; // playing a town in the shared world of al-Jouf
// the iPhone, and the game opened as an app from the home screen (used early: by save and the app's move)
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
// Android: the whole screen, without the browser's bars. Browsers only allow it on a tap, so every tap asks again
// while it is on (the iPhone does not allow it at all: there the game is played from the home screen).
const isAndroid = /Android/i.test(navigator.userAgent) && !isIOS;
const canFull = () => isAndroid && !!document.documentElement.requestFullscreen && store.get("rafaya-fullscreen") !== "0";
addEventListener("pointerup", () => {
  if (!canFull() || document.fullscreenElement) return;
  document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => { /* refused: the next tap asks again */ });
}, { passive: true });
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
function save(leaving = false) {
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
function noteTown() {
  const id = S.site || "main";
  RG.towns[id] = { name: S.name || "الرافعية", terrain: S.terrain || "wadi", pop: S.pop, era: S.era, money: Math.round(S.money), net: Math.round(A?.net || 0) };
  RG.active = id;
  saveRegion();
}

// ---------- the 3D town ----------

const canvas = $("map");
const world = new World(canvas, { quality: RENDER.world, ultra: !!RENDER.ultra });
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

function scheduleLayout() {
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

const sync = (roads) => world.sync(S, { tiles: false, roads, buildings: true });

// ---------- touch and mouse ----------

const pointers = new Map();
let drag = null, pinch = null;

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
/** Does a drag that starts on tile t paint (true) or move the map (false)? */
function paintStarts(t) {
  if (!inMap(t.x, t.y)) return false;
  const tile = S.tiles[idx(t.x, t.y)];
  if (tool.id === "roadup") return ROAD_IDS.includes(tile.b?.id);
  if (tool.id === "fill") return tile.t === "wadi";
  if (tool.id === "upgrade") return !!tile.b;
  if (tool.id === "bulldoze") return !!tile.b || tile.t === "rock";
  // a road: from a road, from the road being drawn, or from a tile right beside either
  const isEnd = (x, y) => inMap(x, y) && (ROAD_IDS.includes(S.tiles[idx(x, y)].b?.id) || pending.some((p) => p.x === x && p.y === y));
  return isEnd(t.x, t.y) || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isEnd(t.x + dx, t.y + dy));
}
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
let placeRot = 0;
const canTurn = (id) => !!B[id] && B[id].cat !== "road" && !["dam", "pivot"].includes(id);
const ghostAngle = (x, y, id) => (canTurn(id) ? world.faceAngle(S, x, y) + placeRot * Math.PI / 2 : 0);
function hoverAt(t) {
  if (!tool || !inMap(t.x, t.y)) { world.setHover(null); world.setGhost(null); return; }
  if (tool.id === "upgrade" || tool.id === "roadup" || tool.id === "fill") { world.setHover(t, canDo(t.x, t.y)); return; }
  if (tool.id === "move") return; // the move tool shows its own preview
  const tile = S.tiles[idx(t.x, t.y)];
  const ok = tool.id === "bulldoze" ? !!(tile.b || tile.t === "rock") : !cantBuild(S, t.x, t.y, tool.id);
  world.setHover(t, ok);
  if (tool.id !== "bulldoze" && B[tool.id].cat !== "road" && !tile.b) world.setGhost(t, modelKey(tool.id, tool.lvl || 0), ok, tile.t, ghostAngle(t.x, t.y, tool.id));
  else world.setGhost(null);
  if (tool.id !== "bulldoze" && (B[tool.id].radius || B[tool.id].reach)) showReach(t.x, t.y, B[tool.id]);
}

// ---------- choosing a spot, then confirming ----------
// Nothing is built on a tap. The tap (or a drag, for roads and removal) marks the spot,
// a preview shows it, and the ✓ button builds it.
let pending = []; // [{ x, y }]
// "upgrade" is the house-upgrade tool: tap (or drag over) houses that are ready, then ✓.
const isMulti = () => tool && tool.id !== "move" && (tool.id === "bulldoze" || tool.id === "upgrade" || tool.id === "roadup" || tool.id === "fill" || B[tool.id].cat === "road");
const tileCost = (x, y) => (tool.lvl ? housePrice(S, tool.lvl).total + (S.tiles[idx(x, y)].t === "rock" ? ROCK_CLEAR : 0) : tool.id === "roadup" ? B[roadNext(S.tiles[idx(x, y)].b)]?.cost || 0 : tool.id === "fill" ? FILL_COST : tool.id === "bulldoze" ? 0 : tool.id === "upgrade" ? upgradePrice(S, S.tiles[idx(x, y)].b).total : buildCost(S, x, y, tool.id));
/** The upgrade tool works on one kind: homes, shops, or farms and workshops. */
const upFits = (b) => upgradable(b) && (!tool?.cat || B[b.id].cat === tool.cat);
const upgradeWhy = (x, y) => { const b = S.tiles[idx(x, y)].b; return !upFits(b) ? (tool?.cat === "shop" ? "اضغط على محل" : tool?.cat === "farm" ? "اضغط على مزرعة أو ورشة" : tool?.cat === "serv" ? "اضغط على مسجد أو مستشفى" : "اضغط على بيت") : upgradeBlocker(S, A, x, y); };
const canDo = (x, y) => { const t = S.tiles[idx(x, y)]; if (tool.id === "roadup") return !!roadNext(t.b) && !roadUpWhy(x, y); if (tool.id === "fill") return owns(S, x, y) && t.t === "wadi" && !t.b; return tool.id === "bulldoze" ? !!(t.b || t.t === "rock") : tool.id === "upgrade" ? !upgradeWhy(x, y) : !cantBuild(S, x, y, tool.id); };
const whyNot = (x, y) => (tool.id === "roadup" ? roadUpWhy(x, y) : tool.id === "fill" ? (S.tiles[idx(x, y)].t !== "wadi" ? "الردم على أرض الوادي بس" : "شيل اللي عليها أول") : tool.id === "upgrade" ? upgradeWhy(x, y) : cantBuild(S, x, y, tool.id));
/** Buildings ready to move up a level right now (lit up while the upgrade tool is in hand). */
// ---------- road upgrades: the same as buildings (gold = ready, tap or drag, then ✓) ----------
/** The next road up from this one: dirt → asphalt (needs the research) → main street. */
const roadNext = (b) => (b?.id === "road" ? "asphalt" : b?.id === "asphalt" ? "avenue" : null);
function roadUpWhy(x, y) {
  const b = S.tiles[idx(x, y)].b, next = roadNext(b);
  if (!b || !ROAD_IDS.includes(b.id)) return "اضغط على طريق";
  if (!next) return b.id === "avenue" ? "هذا شارع رئيسي: أعلى مستوى" : "الدوار والإشارة ما تتطور";
  if (B[next].tech && !S.tech[B[next].tech]) return "تحتاج بحث «السفلتة» من المجلس أول";
  if (B[next].era > S.era) return `تحتاج البلد تصير ${ERAS[B[next].era].name}`;
  return cantBuild(S, x, y, next) || "";
}
function readyRoads() {
  const values = new Float32Array(N * N);
  S.tiles.forEach((t, i) => { if (roadNext(t.b) && !roadUpWhy(i % N, Math.floor(i / N))) values[i] = 1; });
  return values;
}
function readyHouses() {
  const values = new Float32Array(N * N);
  S.tiles.forEach((t, i) => { if (upFits(t.b) && !upgradeBlocker(S, A, i % N, Math.floor(i / N))) values[i] = 1; });
  return values;
}

/**
 * What a building would do to the town's money, BEFORE it is bought: the town is worked out as if it
 * already stood on these spots (staff, power, water, the market), then put back as it was.
 * Returns { income, upkeep, net } per hour, or null. Homes: the tax when full (people come over time).
 */
function buildPreview(id, spots) {
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
const signed = (v) => `${v >= 0 ? "+" : "−"}${fine(Math.abs(v))}`;
/** The homes (and the people in them) within a building's reach: who it serves, or who its smoke bothers. */
function reachHomes(spots, rad) {
  const seen = new Set();
  let homes = 0, people = 0;
  for (const p of spots) for (let y = p.y - rad; y <= p.y + rad; y++) for (let x = p.x - rad; x <= p.x + rad; x++) {
    if (!inMap(x, y) || Math.abs(x - p.x) + Math.abs(y - p.y) > rad) continue;
    const i = idx(x, y), b = S.tiles[i].b;
    if (b?.id !== "house" || seen.has(i)) continue;
    seen.add(i); homes++; people += b.res || 0;
  }
  return { homes, people };
}
/** "يخدم ١٢ بيت (٨٠ ساكن)" for services and shops, "بيزعّل ٥ بيوت" for smoke and noise. */
function reachLine(id, spots, lvlUp = 0) {
  const d = B[id];
  if (!d?.radius || (!d.happy && !d.pollute)) return "";
  const r = reachHomes(spots, d.radius + lvlUp), who = `${ar(r.homes)} ${r.homes >= 3 && r.homes <= 10 ? "بيوت" : "بيت"}${r.people ? ` (${ar(r.people)} ساكن)` : ""}`;
  if (d.pollute) return r.homes ? `⚠️ دخانه وإزعاجه بيزعّل ${who}` : "ما حوله بيوت: ما يزعج أحد ✓";
  if (d.service === "mosque") return `مداه ${ar(d.radius + lvlUp)} مربعات حوله (الأخضر)`;
  return r.homes ? `يخدم ${who}` : "ما حوله بيوت للحين";
}

function showPending() {
  if (!tool) return;
  if (tool.id === "move") { showMove(); return; }
  if (tool.id === "upgrade" && !pending.length) world.setOverlay(readyHouses(), "#e0a44a");
  else if (tool.id === "roadup" && !pending.length) world.setOverlay(readyRoads(), "#ff9a1f", 0.62, 0.12); // above the road surface (a strong orange: dirt roads are already sandy)
  else if (isMulti()) {
    const values = new Float32Array(N * N);
    for (const p of pending) values[idx(p.x, p.y)] = 1;
    world.setOverlay(pending.length ? values : null, tool.id === "bulldoze" ? "#e0523f" : tool.id === "upgrade" || tool.id === "roadup" ? "#e0a44a" : "#2cb59c", tool.id === "roadup" ? 0.55 : 0.3, tool.id === "roadup" ? 0.12 : 0.015);
    world.setHover(pending.length ? pending[pending.length - 1] : null, true);
  } else if (pending.length) hoverAt(pending[0]);
  else { world.setHover(null); world.setGhost(null); world.setOverlay(null); }
  const d = B[tool.id];
  const ok = pending.filter((p) => canDo(p.x, p.y));
  const cost = ok.reduce((a, p) => a + tileCost(p.x, p.y), 0);
  $("toolOk").hidden = !pending.length;
  $("toolRot").hidden = !canTurn(tool.id);
  $("toolOk").textContent = tool.id === "bulldoze" ? "✓ أزل" : tool.id === "upgrade" || tool.id === "roadup" ? "✓ طوّر" : tool.id === "fill" ? "✓ اردم" : "✓ ابنِ";
  if (tool.id === "fill") {
    $("toolName").textContent = !pending.length ? `ردم الوادي: اسحب على أرض الوادي (${money(FILL_COST)} للمربع). ما يجيها سيل، بس تروح خصوبتها` : !ok.length ? whyNot(pending[0].x, pending[0].y) : `ردم ${ar(ok.length)} مربع · ${money(cost)} ريال${cost > S.money ? " · ما يكفي المال" : ""}`;
    return;
  }
  $("toolOk").disabled = !ok.length || cost > S.money;
  if (tool.id === "roadup") {
    const ready = readyRoads().reduce((n, v) => n + v, 0), toA = ok.filter((q) => S.tiles[idx(q.x, q.y)].b?.id === "road").length;
    $("toolName").textContent = !pending.length ? (ready ? `تطوير الطرق: ${ar(ready)} طريق جاهز (بالذهبي) · اضغط أو اسحب عليها` : `ما فيه طريق يتطور الحين: ${S.tech.asphalt ? "اضغط على طريق تشوف ليش" : "تحتاج بحث «السفلتة» من المجلس أول"}`)
      : !ok.length ? roadUpWhy(pending[0].x, pending[0].y) : `${toA ? `${ar(toA)} ترابي ← مسفلت` : ""}${toA && ok.length > toA ? " · " : ""}${ok.length > toA ? `${ar(ok.length - toA)} مسفلت ← شارع رئيسي` : ""} · ${money(cost)} ريال${cost > S.money ? " · ما يكفي المال" : ""}`;
    return;
  }
  if (tool.id === "upgrade") {
    const ready = readyHouses().reduce((n, v) => n + v, 0);
    const what = tool.cat === "shop" ? "محل" : tool.cat === "farm" ? "مزرعة وورشة" : tool.cat === "serv" ? "مسجد ومستشفى" : "بيت";
    $("toolName").textContent = !pending.length ? (ready ? `تطوير: ${ar(ready)} ${what} جاهز (بالذهبي) · اضغط عليها` : `ما فيه ${what} جاهز للتطوير الحين: اضغط على واحد تشوف وش ينقصه`)
      : !ok.length ? upgradeWhy(pending[0].x, pending[0].y) : `تطوير ${ar(ok.length)} · ${money(cost)} ريال${(() => { let inc = 0, upk = 0, tax = 0; for (const q of ok) { const e = upgradeEffect(S, S.tiles[idx(q.x, q.y)].b); if (!e) continue; if (e.house) tax += e.taxGain; else { inc += e.incomeNext - e.incomeNow; upk += e.upkeepNext - e.upkeepNow; } } return inc || upk || tax ? ` · دخل +${fine(inc + tax)} مصروف +${fine(upk)}` : ""; })()}${cost > S.money ? " · ما يكفي المال" : ""}`;
    return;
  }
  if (!pending.length) $("toolName").textContent = tool.id === "bulldoze" ? "إزالة: اضغط أو اسحب على اللي تبي تشيله" : `${tool.lvl ? B.house.levels[tool.lvl].name : d.name} · ${money(tool.lvl ? housePrice(S, tool.lvl).total : priceOf(S, tool.id))} ريال${d.cat === "road" ? " · اسحب من طريق موجود، أو اضغط مكان البداية واسحب منه" : " · اضغط مكانه"}`;
  else if (tool.id === "bulldoze") $("toolName").textContent = `إزالة ${ar(ok.length)} ${ok.length === 1 ? "شي" : "أشياء"}؟`;
  else if (!ok.length) $("toolName").textContent = cantBuild(S, pending[0].x, pending[0].y, tool.id) || "ما ينفع هنا";
  else {
    const pv = buildPreview(tool.id, ok);
    const shortStaff = pv && pv.jobs && pv.net < 0 && A.workers - A.employed < pv.jobs;
    $("toolName").innerHTML = `${isMulti() ? `${ar(ok.length)} مربع` : tool.lvl ? B.house.levels[tool.lvl].name : d.name} · ${money(cost)} ريال${cost > S.money ? " · ما يكفي المال" : ""}`
      + (pv && (pv.income || pv.upkeep) ? `<span class="tool-money">بالساعة: <b class="plus">دخل ${signed(pv.income)}</b> <b class="minus">مصروف −${fine(Math.max(0, pv.upkeep))}</b> <b class="${pv.net >= 0 ? "plus" : "minus"}">صافي ${signed(pv.net)}</b>${d.buildHours ? " (بعد ما يخلص)" : ""}</span>`
        + (shortStaff ? `<span class="tool-hint">💡 الناس قليل: الدخل يزيد لا كبرت البلد</span>` : "") : "")
      + (reachLine(tool.id, ok) ? `<span class="tool-hint ${d.pollute && reachHomes(ok, d.radius).homes ? "warn" : ""}">${reachLine(tool.id, ok)}</span>` : "");
  }
}

/** Every tile from a to b, one step at a time along x or y, so a fast finger never leaves a gap. */
function stepTiles(a, b) {
  const out = [], n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  let x = a.x, y = a.y;
  for (let k = 1; k <= n; k++) {
    const tx = Math.round(a.x + (b.x - a.x) * k / n), ty = Math.round(a.y + (b.y - a.y) * k / n);
    if (tx !== x && ty !== y) out.push({ x: tx, y }); // a corner step, not a diagonal hop
    x = tx; y = ty; out.push({ x, y });
  }
  return out;
}
/**
 * Roads follow the finger, tile by tile (a fast finger leaves no gap). Going back over the road already
 * drawn while still holding takes it back to there, so a wrong tile is undone without lifting the finger.
 */
function roadAim(r, t) {
  const last = r.path[r.path.length - 1];
  if (last.x === t.x && last.y === t.y) return r.path;
  for (const p of stepTiles(last, t)) {
    const k = r.path.findIndex((q) => q.x === p.x && q.y === p.y);
    if (k >= 0) r.path = r.path.slice(0, k + 1); else r.path.push(p);
  }
  return r.path;
}
const roadAimStart = (t) => ({ path: [t] });
function roadStroke(t) {
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
function paintAt(sx, sy) {
  const t = world.pick(sx, sy);
  if (!inMap(t.x, t.y)) return;
  if (B[tool?.id]?.cat === "road") { roadStroke(t); showPending(); return; }
  const from = drag?.last || t;
  if (drag) drag.last = t;
  for (const p of [t, ...stepTiles(from, t)]) {
    const key = idx(p.x, p.y);
    if (drag?.done.has(key)) continue;
    drag?.done.add(key);
    if (!pending.some((q) => q.x === p.x && q.y === p.y) && canDo(p.x, p.y)) { pending.push(p); sfx.road(); }
  }
  showPending();
}

function tap(sx, sy) {
  const t = world.pick(sx, sy);
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
  for (const p of list) apply(p.x, p.y, list.length > 1);
  if (tool.id === "fill" && list.length > 1) { A = analyze(S); world.sync(S, { tiles: true, roads: false, buildings: true }); refresh(); } // the ground once, not once a tile (it froze phones)
  pending = [];
  world.setHover(null); world.setGhost(null); world.setOverlay(null);
  showPending();
}

// ---------- the layout editor (like a base editor): drag buildings around for free ----------
// Touch a building and drag it; drop it on an empty tile, or on another building to swap them.
// A tap selects one (↻ turns it). «شيل الكل» lifts every building into the tray at the bottom; a tap
// on the tray picks one up, a tap on the land puts it down. ↶ undoes, ✕ puts everything back as it was,
// ✓ keeps it (once the tray is empty). The town waits while you arrange; roads stay where they are.
const arrMovable = (b) => !!b && !(b.build > 0) && !(b.wd > 0) && !b.span && b.id !== "decopart"; // (a big decoration's 2×2 stays put) // war damage is kept by place on the server: repair first // everything moves, roads too (like walls in a base editor)
// Redrawn once a frame at most however many tiles a stroke touches, and with no building animation: in the editor a
// building moves, it is not built (both made dragging stutter).
let arrSyncAt = 0;
const arrSyncNow = () => { arrSyncAt = 0; world.prevKeys = null; world.anims?.clear(); world.sync(S, { tiles: false, roads: true, buildings: true }); };
const arrSync = () => { if (!arrSyncAt) arrSyncAt = requestAnimationFrame(arrSyncNow); };
/** Lay the next one of the same kind from the tray (roads are laid by dragging a finger along). */
function arrNext(id) {
  const k = arrange.tray.findIndex((b) => b.id === id);
  if (k < 0) { arrange.held = null; return; }
  arrange.held = { b: arrange.tray[k], from: -1 };
  arrange.tray.splice(k, 1);
}
/** Every tile on the line from the last one the finger was on to this one (a fast finger skips tiles). */
function arrLine(t) {
  const a = drag.last || t, n = Math.max(Math.abs(t.x - a.x), Math.abs(t.y - a.y)), out = [];
  for (let k = 1; k <= n; k++) out.push({ x: Math.round(a.x + (t.x - a.x) * k / n), y: Math.round(a.y + (t.y - a.y) * k / n) });
  if (!n) out.push(t);
  drag.last = t;
  return out;
}
/** The road eraser: roads under the finger go back to the store, to be drawn again somewhere else. */
function arrErase(t) {
  for (const c of arrLine(t)) {
    if (!inMap(c.x, c.y)) continue;
    const i = idx(c.x, c.y), b = S.tiles[i].b;
    if (!b || B[b.id].cat !== "road" || !arrMovable(b)) continue;
    if (!drag.pushed) { arrPush(); drag.pushed = true; }
    arrange.tray.push(b); S.tiles[i].b = null; sfx.road();
  }
  arrSync(); arrRender();
}
function arrPaint(t) {
  drag.road ||= roadAimStart(t);
  drag.placed ||= new Map(); // tiles this stroke put a road on (so going back can take them up again)
  if (arrange.held) drag.roadId = arrange.held.b.id;
  const want = roadAim(drag.road, t), keep = new Set(want.map((c) => idx(c.x, c.y)));
  // the finger went back: the roads past it go back to the store
  for (const [i, b] of [...drag.placed]) {
    if (keep.has(i)) continue;
    S.tiles[i].b = null; drag.placed.delete(i); drag.done.delete(i);
    if (arrange.held) arrange.tray.push(b); else arrange.held = { b, from: -1 };
  }
  for (const c of want) {
    const i = idx(c.x, c.y), had = S.tiles[i]?.b;
    arrPaintOne(c); // the finger's path, like building roads (it skips tiles already done)
    if (inMap(c.x, c.y) && !had && S.tiles[i].b) drag.placed.set(i, S.tiles[i].b);
  }
  arrSync(); arrRender();
}
function arrPaintOne(t) {
  const h = arrange.held;
  if (!h || !inMap(t.x, t.y) || drag.done.has(idx(t.x, t.y))) return;
  drag.done.add(idx(t.x, t.y));
  if (layoutBlocker(S, t.x, t.y, h.b)) return;
  if (!drag.pushed) { arrPush(); drag.pushed = true; }
  S.tiles[idx(t.x, t.y)].b = h.b;
  sfx.road();
  arrNext(h.b.id);
}
function arrSnapshot() {
  const tray = arrange ? [...arrange.tray] : [];
  if (arrange?.held?.from < 0) tray.push(arrange.held.b); // a road in hand from the store goes back with ↶, never lost
  return { b: S.tiles.map((t) => t.b), rot: S.tiles.map((t) => t.b?.rot || 0), tt: S.tiles.map((t) => t.t),
    tray, gone: arrange ? [...arrange.gone] : [], rocks: arrange ? [...arrange.rocks] : [] };
}
function arrRestore(snap) {
  S.tiles.forEach((t, i) => { t.b = snap.b[i]; t.t = snap.tt[i]; if (t.b) { if (snap.rot[i]) t.b.rot = snap.rot[i]; else delete t.b.rot; } });
  arrange.tray = [...snap.tray]; arrange.gone = [...snap.gone]; arrange.rocks = [...snap.rocks];
}
/** What the removals give back (a third of each price) and what the cleared rocks cost, settled on ✓. */
function arrBill() {
  let back = 0, people = 0;
  for (const { b } of arrange.gone) { back += Math.floor(((B[b.id]?.cost || 0) * (b.n || 1) + (B[b.monument]?.cost || 0)) / 3); people += b.res || 0; }
  return { back, people, rocks: arrange.rocks.length * ROCK_CLEAR };
}
/** Remove what stands on tile i (a big decoration with all its tiles), or clear a rock. Callers take the snapshot. */
function arrRemove(i) {
  const t = S.tiles[i];
  if (!t) return false;
  let b = t.b;
  if (!b) { if (t.t !== "rock") return false; arrange.rocks.push(i); t.t = "sand"; return true; }
  if (b.id === "decopart") { i = b.of; b = S.tiles[i]?.b; if (!b) { t.b = null; return true; } }
  if (b.span) S.tiles.forEach((tt) => { if (tt.b?.id === "decopart" && tt.b.of === i) tt.b = null; });
  arrange.gone.push({ b, i });
  S.tiles[i].b = null;
  if (arrange.sel === i) arrange.sel = null;
  return true;
}
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
function leaveArrange(keep) {
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
const arrPush = () => { arrange.hist.push(arrSnapshot()); arrange.future = []; if (arrange.hist.length > 40) arrange.hist.shift(); };
/** Lift a building: off its tile (or out of the tray), into the hand. */
function arrLift(i) {
  const b = S.tiles[i].b;
  arrPush();
  S.tiles[i].b = null;
  arrange.held = { b, from: i };
  arrange.sel = null;
  arrSync();
}
/** Put what is in the hand down on tile t (or back where it came from); a building there swaps. */
function arrDrop(t) {
  const h = arrange.held;
  if (!h) return;
  if (h.from < 0 && t && !layoutBlocker(S, t.x, t.y, h.b)) arrPush();
  arrange.held = null; arrange.dragging = false;
  const back = () => { if (h.from >= 0) S.tiles[h.from].b = h.b; else arrange.tray.push(h.b); };
  if (!t || !inMap(t.x, t.y)) { back(); arrSync(); arrRender(); return; }
  const i = idx(t.x, t.y), there = S.tiles[i].b;
  if (there && arrMovable(there) && h.from >= 0) {
    // swap: each goes to the other's place, if both fit there
    S.tiles[i].b = null;
    const ok1 = !layoutBlocker(S, t.x, t.y, h.b), ok2 = !layoutBlocker(S, h.from % N, Math.floor(h.from / N), there);
    if (ok1 && ok2) { S.tiles[i].b = h.b; S.tiles[h.from].b = there; sfx.build(); arrange.sel = i; }
    else { S.tiles[i].b = there; back(); toast("ما يصير يتبادلون: واحد منهم ما يناسب المكان الثاني", "bad"); sfx.deny(); }
  } else {
    const why = layoutBlocker(S, t.x, t.y, h.b);
    if (why) { back(); toast(why, "bad"); sfx.deny(); }
    else { S.tiles[i].b = h.b; arrange.sel = i; sfx.build(); }
  }
  arrSync(); arrRender();
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
/** One step of the editor's finger tools at tile t (the stroke has begun). */
function arrStroke(t) {
  if (drag.mode === "erase") { arrErase(t); return; }
  if (drag.mode === "paint") { arrPaint(t); return; }
  let any = false;
  for (const c of arrLine(t)) if (inMap(c.x, c.y) && arrRemove(idx(c.x, c.y))) any = true;
  if (any) { sfx.remove(); arrSync(); arrRender(); }
}
function arrBegin() {
  drag.started = true; drag.pushed = true; arrPush(); // one ↶ takes the whole stroke back
  drag.last = drag.start;
  if (drag.mode === "paint") drag.paint = true;
  if (drag.mode === "erase") drag.erase = true;
  if (drag.mode === "del") { drag.del = true; if (arrRemove(idx(drag.start.x, drag.start.y))) { sfx.remove(); arrSync(); } }
  else arrStroke(drag.start);
}
/** A second finger landed: take back what this stroke did. */
function arrUnstroke() {
  if (!arrange || !drag?.mode || !drag.started || !arrange.hist.length) return;
  arrRestore(arrange.hist.pop()); arrange.held = drag.heldBefore;
  if (arrange.held) { const k = arrange.tray.lastIndexOf(arrange.held.b); if (k >= 0) arrange.tray.splice(k, 1); }
  arrSync(); arrRender();
}
/** While a finger moves: a building under it at the start is dragged; otherwise the land pans. */
function arrMove(e) {
  if (drag.mode) {
    if (!drag.moved) return true;
    if (!drag.started) arrBegin();
    arrStroke(world.pick(e.clientX, e.clientY)); return true;
  }
  if (!drag.moved) return true;
  if (drag.grab >= 0 && !arrange.held) { arrLift(drag.grab); arrange.dragging = true; }
  if (arrange.held && arrange.dragging) {
    const t = world.pick(e.clientX, e.clientY);
    if (inMap(t.x, t.y)) {
      const there = S.tiles[idx(t.x, t.y)].b;
      const ok = there ? arrMovable(there) : !layoutBlocker(S, t.x, t.y, arrange.held.b);
      world.setHover(t, ok); world.setGhost(t, modelKey(arrange.held.b.id, arrange.held.b.lvl), ok, S.tiles[idx(t.x, t.y)].t, canTurn(arrange.held.b.id) ? world.faceAngle(S, t.x, t.y) + (arrange.held.b.rot || 0) * Math.PI / 2 : 0);
    }
    return true;
  }
  return false; // let the land pan
}
function arrUp(e) {
  const t = world.pick(e.clientX, e.clientY);
  if (drag.mode && !drag.started && !drag.moved) { arrBegin(); arrRender(); return; } // a tap: once, there
  if (drag.mode) { arrRender(); return; }
  if (arrange.held && arrange.dragging) { arrDrop(t); return; }
  if (drag.moved) return;
  if (arrange.held) { arrDrop(t); return; } // something from the tray: tap where it goes
  const i = inMap(t.x, t.y) ? idx(t.x, t.y) : -1;
  let pick = i >= 0 && S.tiles[i].b ? i : -1;
  if (pick >= 0 && S.tiles[pick].b.id === "decopart") pick = S.tiles[pick].b.of; // a big decoration: the whole of it
  arrange.sel = pick >= 0 ? (arrange.sel === pick ? null : pick) : null;
  sfx.tap(); arrRender();
}
function arrRender() {
  if (!arrange) return;
  const sel = arrange.sel, values = new Float32Array(N * N);
  if (sel != null) values[sel] = 1;
  world.setOverlay(sel != null ? values : null, "#e0a44a");
  if (!arrange.held) { world.setGhost(null); world.setHover(null); }
  // the tray, grouped by kind and level
  const groups = new Map();
  arrange.tray.forEach((b, k) => { const key = modelKey(b.id, b.lvl); if (!groups.has(key)) groups.set(key, { b, list: [] }); groups.get(key).list.push(k); });
  $("arrTray").innerHTML = [...groups.entries()].map(([key, g]) => `<button type="button" class="arr-item ${arrange.held && arrange.held.from < 0 && modelKey(arrange.held.b.id, arrange.held.b.lvl) === key ? "on" : ""}" data-k="${g.list[0]}"><img alt="" src="${thumbnail(key)}"><b>${levelName(g.b)}</b><i>${ar(g.list.length)}</i></button>`).join("");
  $("arrTray").hidden = !arrange.tray.length && !(arrange.held && arrange.held.from < 0);
  $("arrTip").textContent = arrange.held && arrange.held.from < 0 ? (B[arrange.held.b.id].cat === "road" ? `اسحب إصبعك على الأرض وترصف «${B[arrange.held.b.id].name}» (باقي ${ar(1 + arrange.tray.filter((b) => b.id === arrange.held.b.id).length)})` : `اضغط على الأرض وين تبي «${levelName(arrange.held.b)}»`)
    : arrange.tray.length ? `باقي ${ar(arrange.tray.length)} ${arrange.tray.length >= 3 && arrange.tray.length <= 10 ? "مباني" : "مبنى"} بالمخزن: اضغط واحد ثم اضغط مكانه`
    : arrange.erase ? "اسحب إصبعك على الطرق وتنشال للمخزن. بعدها اختر الطريق من المخزن وارسمه بإصبعك."
    : arrange.del ? "🗑️ وضع الإزالة: اضغط أو اسحب إصبعك على اللي تبي تشيله (مباني، طرق، صخور). تقدر ترجعه بـ↶، وما ينحسب إلا إذا ضغطت ✓."
    : sel != null ? (arrMovable(S.tiles[sel].b) ? `«${levelName(S.tiles[sel].b)}»: اسحبه لمكان ثاني، أو ↻ تلفه، أو 🗑️ تشيله` : `«${levelName(S.tiles[sel].b)}»: ما ينقل${S.tiles[sel].b.build > 0 ? " (تحت الإنشاء)" : S.tiles[sel].b.wd > 0 ? " (فيه ضرر عسكري)" : ""}، بس تقدر 🗑️ تشيله`)
    : "اضغط على مبنى عشان تختاره، بعدها اسحبه بإصبعك لمكانه أو شيله بـ🗑️. حطه على مبنى ثاني ويتبادلون مكانهم.";
  $("arrRot").disabled = sel == null || !arrMovable(S.tiles[sel]?.b) || !canTurn(S.tiles[sel]?.b?.id);
  $("arrUndo").disabled = !arrange.hist.length;
  $("arrRedo").disabled = !arrange.future.length;
  $("arrDel").classList.toggle("on", !!arrange.del);
  $("arrDel").querySelector("small").textContent = sel != null && !arrange.del ? "شيله" : "إزالة";
  { const bill = arrBill(), n = arrange.gone.length;
    $("arrSum").hidden = !n && !arrange.rocks.length;
    $("arrSum").textContent = `${n ? `🗑️ بتشيل ${ar(n)} · يرجع لك ${money(bill.back)} ريال` : ""}${n && bill.rocks ? " · " : ""}${bill.rocks ? `🪨 ${ar(arrange.rocks.length)} صخر بـ${money(bill.rocks)}` : ""}`; }
  $("arrErase").classList.toggle("on", !!arrange.erase);
  $("arrTray").querySelectorAll("[data-k]").forEach((el) => el.addEventListener("click", () => {
    if (arrange.held && arrange.held.from < 0) arrange.tray.push(arrange.held.b);
    const k = Number(el.dataset.k), b = arrange.tray[k];
    arrange.tray.splice(k, 1);
    arrange.held = { b, from: -1 }; arrange.dragging = false; arrange.sel = null; arrange.erase = false;
    sfx.tap(); arrRender();
  }));
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
  S.tiles.forEach((t) => { if (arrMovable(t.b)) { arrange.tray.push(t.b); t.b = null; } });
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
function showMove() {
  const from = tool.from, to = pending[0];
  const values = new Float32Array(N * N);
  if (from) values[idx(from.x, from.y)] = 1;
  world.setOverlay(from ? values : null, "#e0a44a");
  const b = from && S.tiles[idx(from.x, from.y)].b;
  const why = b && to ? moveBlocker(S, from.x, from.y, to.x, to.y) : "";
  if (b && to) { world.setHover(to, !why); world.setGhost(to, modelKey(b.id, b.lvl), !why, S.tiles[idx(to.x, to.y)].t); }
  else { world.setHover(null); world.setGhost(null); }
  $("toolOk").hidden = !(b && to);
  $("toolOk").textContent = "✓ انقل";
  $("toolOk").disabled = !!why;
  $("toolName").textContent = !b ? "نقل: اضغط على المبنى اللي تبي تنقله"
    : !to ? `«${levelName(b)}» · اضغط المكان الجديد (أجرة النقل ${money(moveCost(b))} ريال)`
    : why || `انقل «${levelName(b)}» هنا بـ${money(moveCost(b) + (S.tiles[idx(to.x, to.y)].t === "rock" ? ROCK_CLEAR : 0))} ريال؟${["home", "shop", "serv"].includes(B[b.id].cat) && !nearRoad(to.x, to.y) ? " ⚠️ ما جنبه طريق" : ""}`;
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

const nearRoad = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inMap(x + dx, y + dy) && ROAD_IDS.includes(S.tiles[idx(x + dx, y + dy)].b?.id));

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

/** Once something is placed, the green preview goes so the real building shows straight away. */
function clearPreview(painting) {
  world.setGhost(null);
  if (!painting) { world.setHover(null); world.setOverlay(null); }
}

/** Shows how far a building reaches: water in blue, power in gold, cheer in green, nuisance in red. */
function showReach(x, y, def) {
  const r = def.reach || def.radius;
  const values = new Float32Array(N * N);
  for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++)
    if (inMap(xx, yy) && Math.abs(xx - x) + Math.abs(yy - y) <= r) values[idx(xx, yy)] = 1;
  world.setOverlay(values, def.reach ? (def.water > 0 ? "#3b8fd6" : "#9b5cf6") : def.pollute ? "#e0523f" : "#2cb59c");
}

/** The homes no mosque reaches. */
/** Buildings that serve the same need cover for each other (a mosque and a big mosque, a clinic and a hospital…). */
const SERVICE_GROUP = { mosque: "المساجد", school: "المدارس", health: "المستوصفات والمستشفيات", safety: "الشرطة والدفاع المدني" };
const sameNeed = (a, b) => (B[a].service ? B[a].service === B[b]?.service : a === b);
const needName = (id) => SERVICE_GROUP[B[id].service] || { park: "الحدائق", stadium: "الملاعب" }[id] || B[id].name;
/** Every tile some working building of this need reaches (with its upgrades). */
function needCover(id) {
  const on = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const b = S.tiles[idx(x, y)].b;
    if (!b || !b.works || !sameNeed(id, b.id)) continue;
    const r = upgradeEffect(S, b)?.radiusNow || B[b.id].radius || 0;
    for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) if (inMap(xx, yy) && Math.abs(xx - x) + Math.abs(yy - y) <= r) on[idx(xx, yy)] = 1;
  }
  return on;
}
/** The homes no building of this need reaches. */
function needGaps(id, cover = needCover(id)) {
  let n = 0;
  for (let i = 0; i < N * N; i++) if (S.tiles[i].b?.id === "house" && !cover[i]) n++;
  return n;
}
const mosqueGaps = () => needGaps("mosque");
/** Like the water and power maps: where this need is met in green, the homes outside it in red. */
function needMap(id) {
  const cover = needCover(id), v = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) { if (cover[i]) v[i] = 0.01; else if (S.tiles[i].b?.id === "house") v[i] = 1; }
  closeSheet();
  setTimeout(() => world.setOverlay(v, "heat"), 200);
  clearTimeout(needMap.t); needMap.t = setTimeout(() => { if (!tool) world.setOverlay(null); }, 7000);
  const u = needGaps(id, cover), has = cover.some((c) => c);
  toast(!has ? `ما عندك ${needName(id)} للحين: كل البيوت بالأحمر` : u ? `الأخضر يوصله ${needName(id)}، والأحمر ${ar(u)} بيت برا المدى` : `الأخضر يوصله ${needName(id)}: كل البيوت داخل المدى ✓`);
}
const mosqueMap = () => needMap("mosque");
/** A service's card in the build dock: what it does, what it costs and how far it reaches, then build it or see its reach. */
function serviceInfo(id) {
  const d = B[id], lock = lockReason(id), cover = needCover(id), gaps = needGaps(id, cover), mine = S.tiles.filter((t) => t.b && sameNeed(id, t.b.id)).length;
  sheet(`<div class="ins-head"><img alt="" src="${thumbnail(modelKey(id, 0), "sand")}"><div><h2>${d.name}</h2><p>${d.text}</p></div></div>
    <div class="rows">
      ${row("السعر", `${money(d.cost)} ريال`)}
      ${d.upkeep ? row("المصروف بالساعة", `${money(d.upkeep)} ريال`, "minus") : ""}
      ${d.happy ? row("يفرّح الناس حوله", `+${ar(d.happy)}`, "plus") : ""}
      ${d.radius ? row("المدى", `${ar(d.radius)} مربعات حوله`) : ""}
      ${d.jobs ? row("الوظائف", ar(d.jobs)) : ""}
      ${row(`عندك من ${needName(id)}`, ar(mine))}
      ${mine ? (gaps ? `<div class="need">${ar(gaps)} ${gaps >= 3 && gaps <= 10 ? "بيوت" : "بيت"} برا مدى ${needName(id)}: ابنِ واحد قريب منها.</div>` : `<div class="need ok">كل البيوت داخل مدى ${needName(id)} ✓</div>`) : ""}
      ${lock ? `<div class="need">${lock}</div>` : ""}
    </div>
    <div class="sheet-actions two"><button class="btn" id="svMap" type="button">🗺️ اعرض مداه</button><button class="btn go" id="svBuild" type="button" ${lock ? "disabled" : ""}>🔨 ابنِ</button></div>`, "svc");
  $("svMap").addEventListener("click", () => { sfx.tap(); needMap(id); });
  $("svBuild").addEventListener("click", () => { if (lock) return; sfx.tap(); closeSheet(); setTool({ id }); });
}

// ---------- build dock ----------

const F = 'fill="currentColor" fill-opacity=".2"';
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
const toolsBar = [...CATS.map((c) => ({ id: c.id, name: c.name, worldOnly: c.worldOnly })), { id: "edit", name: "تعديل" }]; // moving, turning and removing: one mode (like the layout editors of the big city games)
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

function lockReason(id) {
  if (id === "upgrade" || id === "fill" || id === "roadup") return "";
  const d = B[id];
  if (d.worldOnly && !worldMode) return "بعالم الجوف بس";
  if (d.unique && S.tiles.some((t) => t.b?.id === id)) return "عندك واحد منه";
  if (d.hq && !S.tiles.some((t) => t.b?.id === "milhq")) return "ابنِ مركز القيادة أول";
  if (d.max && S.tiles.filter((t) => t.b?.id === id).length >= d.max) return `الحد ${ar(d.max)}`;
  if (d.era > S.era) return `تنفتح لما تصير ${ERAS[d.era].name}`;
  if (!techUnlocked(S, d)) return `تحتاج بحث «${TECH[d.tech].name}»`;
  return "";
}

function renderCards() {
  scheduleLayout();
  const box = $("cards");
  if (!openCat) { box.hidden = true; return; }
  const ids = Object.keys(B).filter((k) => B[k].cat === openCat);
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
    const p = housePrice(S, lvl), L = B.house.levels[lvl];
    return `<button type="button" class="card ${tool?.id === "house" && tool.lvl === lvl ? "on" : ""} ${S.money < p.total ? "poor" : ""}" data-build="house" data-lvl="${lvl}">
      <img alt="" src="${thumbnail(modelKey("house", lvl))}"><b>${L.name}</b><span class="price">${money(p.total)} ريال</span><span class="hours">جاهز على طول · يسكن ${ar(L.cap)}</span></button>`;
  }).join("") : "";
  box.innerHTML = upgradeCard + levelCards + ids.map((id, i) => {
    const lock = lockReason(id);
    const afford = S.money >= priceOf(S, id);
    return `<button type="button" class="card ${tool?.id === id && !tool.lvl ? "on" : ""} ${lock ? "locked" : ""} ${!lock && !afford ? "poor" : ""}" data-build="${id}" style="--i:${i}">
      <img alt="" src="${thumbnail(modelKey(id, 0))}"><b>${B[id].name}</b>
      ${lock ? `<span class="lock">${lock}</span>` : `<span class="price">${B[id].fullCost ? `<s>${money(B[id].fullCost)}</s> ` : ""}${money(priceOf(S, id))} ريال</span>`}
      ${B[id].fullCost && !lock ? `<span class="hours">دعم الدولة −${ar(Math.round(SUBSIDY[B[id].cat] * 100))}٪</span>` : ""}
      ${B[id].buildHours && !lock ? `<span class="hours">يُبنى في ${ar(B[id].buildHours / 24)} أيام</span>` : ""}
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

function setTool(t) {
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

const MOUTHS = ["M8.5 16.5c1.8-2 5.2-2 7 0", "M9 15.5h6", "M8.5 14.5c1.8 2 5.2 2 7 0", "M8 13.5c2 3.5 6 3.5 8 0z"];
const FACE_COLORS = ["#d9573f", "#d9a540", "#7cb342", "#3f9a5c"];
const face = (k) => `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="${FACE_COLORS[k]}"/><circle cx="9" cy="10" r="1.3" fill="#2f2114"/><circle cx="15" cy="10" r="1.3" fill="#2f2114"/><path d="${MOUTHS[k]}" stroke="#2f2114" stroke-width="1.6" fill="${k === 3 ? "#2f2114" : "none"}" stroke-linecap="round"/></svg>`;
function refresh() {
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
    const nx = ERAS[S.era + 1];
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
  $("goal").innerHTML = goal ? `<i>المهمة</i> ${goal.text} <b>${money(goal.reward)}</b>` : here("<i>أنجزت كل المهام</i> كمّل تكبير الرافعية!");
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

function toast(text, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = ar(here(text));
  $("toasts").append(el);
  const long = kind === "era" || kind.startsWith("season");
  setTimeout(() => el.classList.add("out"), long ? 4200 : 2300);
  setTimeout(() => el.remove(), long ? 4600 : 2700);
  while ($("toasts").children.length > 3) $("toasts").firstChild.remove();
}

let sheetFor = null, sheetAt = 0;
let sheetHide = 0;
/** The town's own name in place of «الرافعية» (the default town's name) in what its people and council say. */
// sheets that show what players wrote (al-Jouf's map, the chat, war screens): «الرافعية» there is a real name, never your town's
const NAME_KEEP = new Set(["wnews", "news-up", "whatsnew", "share-game", "settings", "settings-menu", "how", "region", "budget", "world", "chat", "developer-note", "war", "war-rel", "war-strike", "war-report", "war-back", "online", "namefix", "removed"]);
function here(text) {
  const n = S?.name;
  // a landmark keeps its place's name (بوابة الرافعية is the gate of the place on al-Jouf's map, not of the town)
  return n && n !== "الرافعية" && typeof text === "string" ? text.replace(/(?<!(?:بوابة|برج|أبراج|مطار|مهرجان|جامعة) )الرافعية/g, n) : text;
}
/**
 * The landmarks carry the name of the place the town stands by on al-Jouf's map: a town by Sakaka builds
 * «بوابة سكاكا» and «أبراج سكاكا». Alone, the game is in الرافعية. Names only: nothing saved changes.
 */
const LANDMARKS = { b: ["gate", "tower", "skyline", "airport"], events: ["festival"] };
const placeNames = { from: null };
function nameLandmarks(place) {
  if (!placeNames.from) { // the names as written, once
    placeNames.from = { b: Object.fromEntries(LANDMARKS.b.map((id) => [id, B[id].name])), goals: GOALS.map((g) => g.text), events: Object.fromEntries(EVENTS.filter((e) => LANDMARKS.events.includes(e.id)).map((e) => [e.id, e.name])) };
  }
  const swap = (t) => t.replace(/الرافعية/g, place);
  for (const id of LANDMARKS.b) B[id].name = swap(placeNames.from.b[id]);
  GOALS.forEach((g, i) => { if (/^ابنِ .*الرافعية$/.test(placeNames.from.goals[i])) g.text = swap(placeNames.from.goals[i]); });
  for (const e of EVENTS) if (placeNames.from.events[e.id]) e.name = swap(placeNames.from.events[e.id]);
  setLandStyle(PLACE_STYLE[place] || ""); // and the place's own designs for them
}
const FIX = { ask: null }; // the owner's name request while it waits (see namefixSheet)
function sheet(html, kind) {
  if (sheetFor === "update" && kind !== "update") return; // nothing covers the update
  clearTimeout(sheetHide); // a sheet opened while the last one was closing must stay open
  $("sheetClose").hidden = kind === "update" || kind === "namefix"; // those two can't be closed
  sheetFor = kind; sheetAt = performance.now();
  $("sheetBody").innerHTML = NAME_KEEP.has(kind) ? html : here(html);
  $("sheetBody").querySelectorAll("input[type=text], textarea").forEach((i) => { i.autocomplete = "off"; }); // no list of old entries over the keyboard
  $("sheet").hidden = false;
  $("sheet").classList.remove("closing");
}
function closeSheet() {
  if ($("sheet").hidden || sheetFor === "update") return; // the update can't be put off
  if (sheetFor === "namefix" && FIX.ask) return; // nor the owner's name request, until the names are changed
  if (FIX.ask) setTimeout(() => { if (FIX.ask && sheetFor !== "namefix") namefixSheet(FIX.ask); }, 400); // another screen closed: the request comes back
  $("sheet").classList.add("closing");
  sheetHide = setTimeout(() => { $("sheet").hidden = true; $("sheet").classList.remove("closing"); }, 180);
  const was = sheetFor; sheetFor = null;
  world.setOverlay(null);
  if (was === "settings-menu") showMenu();
}
$("sheetClose").addEventListener("click", () => { sfx.tap(); closeSheet(); });
$("sheet").addEventListener("click", (e) => { if (e.target === $("sheet") && sheetFor !== "decision" && performance.now() - sheetAt > 400) closeSheet(); });

const row = (k, v, cls = "") => `<div class="row"><span>${k}</span><b class="${cls}">${v}</b></div>`;

/** A little label that floats up from a tile: income, a house moving up. */
function floatAt(x, y, text, cls = "") {
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
function hourEffects() {
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

function achievementsSheet() {
  const got = ACHIEVEMENTS.filter((x) => S.ach?.[x.id]).length;
  sheet(`<h2>الإنجازات</h2><p>${ar(got)} من ${ar(ACHIEVEMENTS.length)}</p><div class="achs">${ACHIEVEMENTS.map((x, i) => `<div class="ach ${S.ach?.[x.id] ? "done" : ""}" style="--i:${i}"><span>${S.ach?.[x.id] ? "🏆" : "🔒"}</span><b>${x.name}</b><small>${x.text}</small></div>`).join("")}</div>`, "ach");
}

// ---------- نشرة الرافعية ----------

function addPosts(posts) {
  if (!posts.length) return;
  S.news = [...posts, ...(S.news || [])].slice(0, 50);
  S.newsUnread = (S.newsUnread || 0) + posts.length;
  showNewsCount();
  if (sheetFor === "news") newsSheet();
}
function showNewsCount() {
  const n = (S.newsUnread || 0) + (worldMode ? wnewsUnread() : 0) + (() => { try { return wnUnseen(worldMode ? "world" : "solo").length; } catch { return 0; } })(); // (before the updates list is set up: none)
  $("newsCount").hidden = !n;
  $("newsCount").textContent = ar(Math.min(n, 9)) + (n > 9 ? "+" : "");
}
function hourNews(msgs) {
  const season = seasonOf(S.day);
  const big = msgs.some((m) => ["event", "season"].includes(m.kind));
  const posts = followUps(S, A, season);
  // People speak up twice a day (morning and evening), a little more in a big city; big news brings one more.
  const hour = hourOf(S.day);
  if (hour === 9 || hour === 19) posts.push(...writePosts(S, A, season, Math.min(2, 1 + Math.floor(S.pop / 1500))));
  else if (big) posts.push(...writePosts(S, A, season, 1));
  addPosts(posts);
}

const moodTag = (m) => (m < 0 ? `<i class="mood bad">زعلان</i>` : m > 0 ? `<i class="mood good">مبسوط</i>` : `<i class="mood ask">يطالب</i>`);
/** Who wrote a post (old saves only have the kind of person). */
const personOf = (p) => p.person || { name: "واحد من الأهالي", role: "", area: "" };
/**
 * «📍 وين؟» buttons for the quarters a text names (the longest names first, so «الحارة الشمالية
 * الغربية» is not also read as «الحارة الشمالية»).
 */
function districtLinks(...texts) {
  let text = texts.filter(Boolean).join(" ");
  const names = Array.from({ length: 9 }, (_, d) => ({ d, name: districtName(S, d) })).sort((p, q) => q.name.length - p.name.length);
  const found = [];
  for (const { d, name } of names) if (text.includes(name)) { found.push({ d, name }); text = text.split(name).join(" "); }
  return found.map(({ d, name }) => `<button class="home-btn" type="button" data-district="${d}">📍 وين ${name}؟</button>`).join("");
}
/** Show a quarter on the map: the camera goes there and its land lights up for a few seconds. */
function showDistrict(d) {
  closeSheet();
  const values = new Float32Array(N * N);
  let sx = 0, sy = 0, n = 0, hx = 0, hy = 0, homes = 0;
  for (let i = 0; i < N * N; i++) {
    if (districtOf(i) !== d || !owns(S, i % N, Math.floor(i / N))) continue;
    values[i] = 1; sx += i % N; sy += Math.floor(i / N); n++;
    if (S.tiles[i].b?.id === "house") { hx += i % N; hy += Math.floor(i / N); homes++; }
  }
  if (!n) return;
  const cx = Math.round(homes ? hx / homes : sx / n), cy = Math.round(homes ? hy / homes : sy / n);
  world.setOverlay(values, "#ff8a00", 0.55);
  world.focus(cx, cy); world.view.zoom = Math.min(world.view.zoom, 0.8); world.updateCamera();
  setTimeout(() => floatAt(cx, cy, `📍 ${districtName(S, d)}`, "up"), 300);
  toast(`📍 هذي ${districtName(S, d)}: المربعات المضيئة`, "");
  clearTimeout(showDistrict.t);
  showDistrict.t = setTimeout(() => { if (!tool && !arrange) world.setOverlay(null); }, 8000);
}
$("sheetBody").addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-district]");
  if (b) { sfx.tap(); showDistrict(Number(b.dataset.district)); }
});
function postHtml(p) {
  const r = personOf(p);
  const when = `اليوم ${ar(dayOf(p.day))} · ${ar(hourOf(p.day))}:٠٠`;
  return `<article class="post" data-post="${p.id}">
    <div class="post-head"><div><b>${r.name}</b><small>${[r.role, r.area, when].filter(Boolean).join(" · ")}</small></div>${moodTag(p.mood)}</div>
    <p>${p.text}</p>
    ${p.ref ? refHtml(p) : p.mood < 0 && FIX_HINT[p.topic] && !p.answered ? `<div class="pfix">💡 وش يبي: ${FIX_HINT[p.topic]}</div>` : ""}
    ${(p.replies || []).map((m) => `<div class="reply ${m.from}"><b>${m.from === "mayor" ? "العمدة" : m.person ? m.person.name : r.name}</b>${m.person?.role ? `<small> (${m.person.role})</small>` : ""} ${m.text}</div>`).join("")}
    ${p.person?.home != null && S.tiles[p.person.home]?.b?.id === "house" ? `<button class="home-btn" type="button" data-home="${p.person.home}">📍 بيته</button>` : ""}${districtLinks(p.text, p.ref?.asked)}
    <div class="post-foot"><span>👥 ${ar(p.likes || 1)} ${(p.likes || 1) > 10 ? "من الأهالي" : ""} يوافقونه</span>${p.answered ? `<span class="answered ${p.change > 0 ? "up" : p.change < 0 ? "down" : ""}">${p.change > 0 ? "الناس ارتاحوا" : p.change < 0 ? "الناس زعلوا" : "بيرجع لك بكرة"}</span>` : ""}</div>
    ${p.answered || p.id.startsWith("d-") ? "" : `<div class="answers">${replyOptions(p).map((o) => `<button type="button" class="ans ${o.tone || o.kind}" data-post="${p.id}" data-kind="${o.kind}">${o.label}</button>`).join("")}</div>`}
  </article>`;
}

/** The promise (or the "we'll see") a follow-up post is about: what they asked, what the mayor said, and when. */
function refHtml(p) {
  const r = p.ref, when = r.day != null ? `اليوم ${ar(dayOf(r.day))} · ${ar(hourOf(r.day))}:٠٠` : "";
  return `<div class="pref">
    ${r.asked ? `<div><small>طلبهم ${when ? `(${when})` : ""}</small><q>${r.asked}</q></div>` : ""}
    <div><small>${r.calm ? "رديت عليهم" : "وعدك لهم"}</small><b>«${r.said}»</b></div>
    ${p.mood < 0 && FIX_HINT[p.topic] ? `<div class="pfix">🛠️ عشان توفي: ${FIX_HINT[p.topic]}</div>` : ""}
  </div>`;
}
/** Promises the mayor has made that are still open, and people waiting for a real answer. */
function promisesHtml() {
  const open = (S.promises || []).map((p) => {
    const left = 48 - (S.day - p.day), name = p.person?.name || "واحد من الأهالي";
    return `<div class="prom ${left <= 0 ? "late" : ""}"><div class="prom-top"><b>${topicName(p.topic)}</b><small>${left > 0 ? `باقي ${ar(left)} ساعة قبل لا يذكّرونك` : "تأخرت عليهم!"}</small></div>
      <small>وعدت ${name}${p.person?.area ? ` ${p.person.area}` : ""}: «${p.said}»</small>
      ${FIX_HINT[p.topic] ? `<div class="pfix">🛠️ ${FIX_HINT[p.topic]}</div>` : ""}${districtLinks(p.asked, p.text, p.person?.area)}</div>`;
  });
  const waiting = (S.comebacks || []).map((c) => `<div class="prom calm"><div class="prom-top"><b>${topicName(c.topic)}</b><small>بيرجعون لك بعد ${ar(Math.max(1, c.at - S.day))} ساعة</small></div><small>قلت لـ${c.person?.name || "واحد من الأهالي"}: «إن شاء الله، نشوف»</small></div>`);
  if (!open.length && !waiting.length) return "";
  return `<details class="proms" open><summary>🤝 وعودك (${ar(open.length)})${waiting.length ? ` · ينتظرون جواب (${ar(waiting.length)})` : ""}</summary>${open.join("")}${waiting.join("")}</details>`;
}
function newsSheet() {
  if (WNEWS.tab === "updates") { updatesNewsSheet(); return; }
  if (worldMode && WNEWS.tab === "world") { worldNewsSheet(); return; }
  S.newsUnread = 0; showNewsCount();
  const posts = S.news || [];
  const trust = Math.round(moodOf(S, null));
  sheet(`${newsTabs("town")}<div class="news-head"><h2>نشرة الرافعية</h2><p>وش يقولون أهل الرافعية عن بلدهم. اختار ردك: الوعد يريّحهم بس لازم توفي، و«نشوف» يرجعون لك بعدها، والرفض يزعّلهم.</p>
    <div class="trust"><span>ثقة الأهالي بالعمدة</span><i class="bar"><i style="width:${trust}%" class="${trust < 45 ? "low" : ""}"></i></i><b>${ar(trust)}٪</b></div></div>
    ${promisesHtml()}
    <div class="feed">${posts.length ? posts.map(postHtml).join("") : `<p class="empty">للحين ما أحد كتب شي. الناس يتكلمون كل كم ساعة.</p>`}</div>`, "news");
  bindNewsTabs();
  $("sheetBody").querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => answer(b.dataset.post, b.dataset.kind)));
  $("sheetBody").querySelectorAll("[data-home]").forEach((b) => b.addEventListener("click", () => {
    const i = Number(b.dataset.home);
    closeSheet(); world.focus(i % N, Math.floor(i / N)); world.view.zoom = Math.max(world.view.zoom, 1.4); world.updateCamera();
    setTimeout(() => { inspect(i % N, Math.floor(i / N)); }, 350);
  }));
}
$("newsBtn").addEventListener("click", () => { sfx.tap(); newsSheet(); });

// ---------- نشرة الجوف (world only): what happens in al-Jouf, for everyone ----------
const WNEWS = { items: [], polled: 0, busy: false, tab: "town", map: null };
const wnewsSeen = () => Number(store.get("rafaya-wnews-seen") || 0);
const wnewsUnread = () => WNEWS.items.filter((x) => x.id > wnewsSeen() && x.plot !== S.world?.plot).length;
async function wnewsPoll(force) {
  if (!worldMode || WNEWS.busy || (!force && Date.now() - WNEWS.polled < (LIVE.ok ? 300000 : 60000))) return; // live: the server tells us
  WNEWS.busy = true; WNEWS.polled = Date.now();
  try { const r = await api("/world/news"); WNEWS.items = r.items || []; } catch { /* the next time */ }
  WNEWS.busy = false;
  showNewsCount();
}
/** The news sheet's tabs: the town's news, al-Jouf's (world only) and the game's updates. */
function newsTabs(on) {
  const mode = worldMode ? "world" : "solo", n = worldMode ? wnewsUnread() : 0, up = wnUnseen(mode).length;
  const tabs = [
    ["town", "📰", worldMode ? "مدينتي" : "القرية", S.newsUnread],
    ...(worldMode ? [["world", "🌍", "الجوف", n]] : []),
    ["updates", "✨", "التحديثات", up],
  ];
  return `<div class="wn-tabs" style="--news-tabs:${tabs.length}">${tabs.map(([key, icon, name, unread]) =>
    `<button type="button" class="btn${on === key ? " go" : ""}" data-ntab="${key}"><span aria-hidden="true">${icon}</span><span class="wn-tab-label">${name}</span>${unread && on !== key ? '<i class="dot"></i>' : ""}</button>`
  ).join("")}</div>`;
}
/** The updates tab: what changed in the game for this mode, newest first (the new ones marked). */
function updatesNewsSheet() {
  const mode = worldMode ? "world" : "solo", fresh = new Set(wnUnseen(mode).map(([, , t]) => t));
  const list = WHATS_NEW.items.filter(([m]) => m === mode || m === "both");
  wnMarkAll(mode); showWhatsNewDot(); showNewsCount();
  sheet(`${newsTabs("updates")}<div class="news-head"><h2>✨ التحديثات</h2><p>وش تغيّر ${mode === "world" ? "بعالم الجوف" : "باللعب الفردي"}، الأحدث فوق.</p></div>
    <div class="rows">${list.map(([, icon, title, text]) => `<div class="row wn"><b class="wn-i">${icon}</b><span><b>${title}${fresh.has(title) ? ' <small class="new-tag">جديد</small>' : ""}</b><small>${text}</small></span></div>`).join("")}</div>`, "news-up");
  bindNewsTabs();
}
function bindNewsTabs() {
  $("sheetBody").querySelectorAll("[data-ntab]").forEach((b) => b.addEventListener("click", () => { sfx.tap(); WNEWS.tab = b.dataset.ntab; newsSheet(); }));
}
/** The weather and the calendar are the same for every town in al-Jouf: what is on now and what comes in the next two days. */
function worldForecast() {
  const h = S.day, now = worldEventsAt(h), seen = new Set(now.map((e) => `${e.id}:${e.start}`)), soon = [];
  for (let k = 1; k <= 48; k++) for (const e of worldEventsAt(h + k)) {
    const key = `${e.id}:${e.start}`;
    if (!seen.has(key)) { seen.add(key); soon.push({ ...e, in: k }); }
  }
  const icon = (id) => ({ rain: "🌧️", dust: "🌪️", heat: "🔥", cold: "❄️", locust: "🦗", drought: "🏜️", dates: "🌴", ramadan: "🌙", eid: "🎉", adha: "🐑" })[id] || "📅";
  const left = (e) => e.end - h;
  return `${now.length ? now.map((e) => row(`${icon(e.id)} ${e.name} (الحين)`, `باقي ${ar(left(e))} ساعة`)).join("") : row("☀️ الجو", "هادي ما فيه شي")}
    ${soon.length ? soon.map((e) => row(`${icon(e.id)} ${e.name}`, `بعد ${ar(e.in)} ساعة`)).join("") : `<p class="hint">ما فيه شي متوقع بالـ٤٨ ساعة الجاية.</p>`}`;
}
function agoText(at) {
  const m = Math.max(0, Math.round((Date.now() - at) / 60000));
  return m < 1 ? "الحين" : m < 60 ? `قبل ${ar(m)} دقيقة` : m < 1440 ? `قبل ${ar(Math.round(m / 60))} ساعة` : `قبل ${ar(Math.round(m / 1440))} يوم`;
}
async function worldNewsSheet(refreshed) {
  const top = (WNEWS.map || []).slice();
  const big = top.sort((p, q) => q.pop - p.pop).slice(0, 5), happy = (WNEWS.map || []).filter((t) => t.pop >= 30).sort((p, q) => q.happy - p.happy).slice(0, 3);
  const mine = S.world?.plot;
  const town = (t) => `<button type="button" class="linkish" data-goplot="${t.plot}">«${t.town}»${t.plot === mine ? " (مدينتك)" : ""}</button>`;
  sheet(`${newsTabs("world")}<div class="news-head"><h2>🌍 نشرة الجوف</h2><p>اللي يصير بأرض الجوف كلها: الأجواء، والمدن الجديدة، واللي كبرت، والحروب والصلح.</p></div>
    <h3>🌦️ أجواء الجوف (واحدة للكل)</h3><div class="rows">${worldForecast()}</div>
    ${big.length ? `<h3>🏆 أكبر المدن</h3><div class="rows">${big.map((t, i) => row(`${ar(i + 1)}. ${town(t)}`, `${money(t.pop)} ساكن · ${ERAS[t.era]?.name || ""}`)).join("")}</div>` : ""}
    ${happy.length ? `<h3>😊 أسعد المدن</h3><div class="rows">${happy.map((t) => row(town(t), `${ar(t.happy)}٪`, "plus")).join("")}</div>` : ""}
    <h3>📰 الأخبار</h3>
    <div class="rows">${WNEWS.items.length ? WNEWS.items.map((x) => `<div class="row wnews ${x.id > wnewsSeen() ? "new" : ""}"><span>${ar(x.text)}</span><small>${agoText(x.at)}</small></div>`).join("") : `<p class="hint">${refreshed ? "للحين ما صار شي بالجوف." : "نحمّل…"}</p>`}</div>`, "wnews");
  bindNewsTabs();
  $("sheetBody").querySelectorAll("[data-goplot]").forEach((b) => b.addEventListener("click", () => { sfx.tap(); const p = Number(b.dataset.goplot); if (p === mine) closeSheet(); else visitTown(p); }));
  if (WNEWS.items.length) store.set("rafaya-wnews-seen", String(WNEWS.items[0].id));
  showNewsCount();
  if (!refreshed) {
    await Promise.all([wnewsPoll(true), api("/world/map").then((r) => { WNEWS.map = r.plots || []; }).catch(() => {})]);
    if (sheetFor === "wnews") worldNewsSheet(true);
  }
}

/** The mayor answers a post with one of the offered replies. */
function answer(id, kind) {
  const post = (S.news || []).find((p) => p.id === id);
  if (!post || post.answered) return;
  const label = replyOptions(post).find((o) => o.kind === kind)?.label;
  const r = answerPost(S, A, seasonOf(S.day), post, kind);
  post.replies = [...(post.replies || []), { from: "mayor", text: label }, { from: "res", who: post.who, text: r.text }];
  post.answered = kind; post.change = r.change;
  (r.change > 0 ? sfx.coin : r.change < 0 ? sfx.deny : sfx.tap)();
  refresh(); save();
  newsSheet();
}

/** A choice for the mayor: the story, and a button per option with what it costs and does. */
function decisionSheet() {
  const d = DECISIONS.find((x) => x.id === S.decision?.id);
  if (!d) return;
  sfx.event();
  sheet(`<div class="decision"><span class="badge">قرار</span><h2>${d.title}</h2><p>${typeof d.text === "function" ? d.text(S, seasonOf(S.day)) : d.text}</p>
    <div class="choices">${d.options.map((o, i) => { const c = optionCost(S, A, o), poor = c > 0 && S.money < c; return `<button type="button" class="choice ${i === 0 ? "first" : ""}" data-choice="${i}" ${poor ? "disabled" : ""}>
      <b>${o.label}</b><small>${o.note}${o.costPer ? ` (${money(c)} ريال)` : ""}${poor ? " · ما يكفي المال" : ""}</small></button>`; }).join("")}</div></div>`, "decision");
  $("sheetClose").hidden = true;
  $("sheetBody").querySelectorAll("[data-choice]").forEach((b) => b.addEventListener("click", () => {
    const choice = Number(b.dataset.choice), decided = S.decision?.id;
    const r = decide(S, choice);
    if (r.error) { toast(r.error, "bad"); sfx.deny(); return; }
    sfx.coin();
    $("sheetClose").hidden = false;
    closeSheet();
    if (r.built) { world.sync(S); toast(`انحفر ${B[r.built].name} جديد قرب البلد`, "goal"); }
    if (r.lost) { world.sync(S); toast(`احترق ${r.lost} 🔥`, "bad"); }
    if (r.ok) { const re = decisionReaction(S, A, decided, choice); if (re) addPosts([re]); }
    refresh(); save();
  }));
}

/** Land outside the town: what it is, what it costs, and a button to buy it. */
function plotSheet(id) {
  const plot = PLOTS.find((p) => p.id === id), price = plotPrice(S);
  let wadi = 0, fayda = 0, rocks = 0, size = 0;
  S.tiles.forEach((t, i) => { if (plotAt(i % N, Math.floor(i / N)) !== id) return; size++; if (t.t === "wadi") wadi++; else if (t.t === "fayda") fayda++; else if (t.t === "rock") rocks++; });
  const bought = PLOTS.filter((p) => S.owned[p.id]).length;
  sheet(`<h2>${plot.name} للبيع</h2><p>أرض جديدة تكبر فيها الرافعية. كل ما اشتريت أرض، اللي بعدها تصير أغلى.</p>
    <div class="rows">
      ${row("المساحة", `${ar(size)} مربع`)}
      ${wadi ? row("أرض الوادي (خصبة)", `${ar(wadi)} مربع`, "plus") : ""}
      ${fayda ? row("فيضة", `${ar(fayda)} مربع`, "plus") : ""}
      ${rocks ? row("صخور", `${ar(rocks)}`) : ""}
      ${row("السعر", `${money(price)} ريال`, S.money >= price ? "" : "minus")}
      ${row("اشتريت", `${ar(bought)} من ${ar(PLOTS.length)}`)}
    </div>
    <div class="sheet-actions"><button class="btn go block" id="buyPlot" type="button" ${S.money < price ? "disabled" : ""}>${S.money < price ? `تحتاج ${money(price - S.money)} ريال زيادة` : `اشترِ الأرض بـ${money(price)} ريال`}</button></div>`, "plot");
  $("buyPlot").addEventListener("click", () => {
    const why = buyPlot(S, id);
    if (why) { toast(why, "bad"); sfx.deny(); return; }
    sfx.era(); closeSheet(); toast(`صارت ${plot.name} لك!`, "goal");
    world.sync(S); refresh(); save();
  });
}

function inspect(x, y) {
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
    const levels = d.levels.map((l, k) => `<i class="${k <= t.b.lvl ? "on" : ""}">${l.name}</i>`).join("");
    html += `<div class="ladder">${levels}</div>`;
    const block = houseBlocker(S, A, x, y), next = d.levels[t.b.lvl + 1];
    if (block === "أعلى مستوى") html += `<div class="need ok">وصل أعلى مستوى.</div>`;
    else if (block) html += `<div class="need">عشان تطوره «${next.name}»: ${block}</div>`;
    else if (!visiting) { const pr = upgradePrice(S, t.b); html += `<div class="sheet-actions"><button class="btn go block" id="upgradeOne" type="button" ${S.money < pr.total ? "disabled" : ""}>طوّره إلى «${next.name}» بـ${money(pr.total)} ريال</button></div>${effectHtml(t.b)}${matsNote(pr)}`; }
  }
  if (BIZ_LEVELS[t.b.id] && !t.b.build) {
    const names = BIZ_LEVELS[t.b.id], next = names[t.b.lvl + 1];
    html += `<div class="ladder">${names.map((n, k) => `<i class="${k <= t.b.lvl ? "on" : ""}">${n}</i>`).join("")}</div>`;
    const block = upgradeBlocker(S, A, x, y), pr = upgradePrice(S, t.b), cost = pr.total;
    if (block === "أعلى مستوى") html += `<div class="need ok">وصل أعلى مستوى.</div>`;
    else if (block) html += `<div class="need">عشان تطوره «${next}»: ${block}</div>`;
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
  if (d.water > 0) html += row("يعطي ماء", ar(d.water), "plus");
  if (d.power > 0) html += row("يعطي كهرباء", ar(d.power), "plus");
  if (d.pole || d.wire) {
    const live = A.poles.live.has(idx(x, y));
    html += row("الكهرباء في الخط", live ? "واصلة ✓" : "تحتاج مولد أو خط شغّال", live ? "plus" : "minus");
  }
  if (d.radius) html += row("يوصل تأثيره", `${ar(d.radius + (up.radius || 0))} مربعات`);
  if (d.radius && (d.happy || d.pollute)) { const line = reachLine(t.b.id, [{ x, y }], up.radius || 0); if (line) html += d.pollute && line.startsWith("⚠️") ? `<div class="need">${line}. الحل: أبعده عن البيوت، أو حط حديقة أو شجر بينهم.</div>` : row(d.pollute ? "الإزعاج" : "يخدم", line.replace(/^يخدم /, "")); }
  if (d.service === "mosque") { const u = mosqueGaps(); html += u ? `<div class="need">${ar(u)} ${u >= 3 && u <= 10 ? "بيوت" : "بيت"} برا مدى المساجد: ابنِ مسجد قريب منها.</div>` : `<div class="need ok">كل البيوت داخل مدى المساجد ✓</div>`; html += `<button class="btn block" id="showMosques" type="button">🕌 اعرض وين توصل المساجد كلها</button>`; }
  const rNext = roadNext(t.b), rWhy = rNext ? roadUpWhy(x, y) : "";
  html += `</div><div class="sheet-actions">${rNext && !visiting ? `<button class="btn go block" id="roadUpOne" type="button" ${rWhy ? "disabled" : ""}>⬆ طوّره إلى ${B[rNext].name} (${money(B[rNext].cost)} ريال)</button>${rWhy ? `<p class="hint">${rWhy}</p>` : ""}` : ""}${canTurn(t.b.id) && !visiting ? `<button class="btn block" id="turnOne" type="button">↻ لفّ المبنى (ببلاش)</button>` : ""}${visiting ? "" : `<button class="btn danger block" id="demolish" type="button">أزل المبنى (يرجع لك ${money(removalRefund(t.b))} ريال)</button>`}</div>`;
  sheet(html, "inspect");
  if (d.radius) showReach(x, y, { ...d, radius: d.radius + (up.radius || 0) });
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
    sfx.levelUp(); A = analyze(S); sync(false); refresh(); save();
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

function council() {
  const list = Object.entries(TECH).map(([id, t], i) => {
    const done = S.tech[id], going = S.research?.id === id, locked = t.era > S.era;
    const pct = going ? Math.round((1 - S.research.left / t.days) * 100) : 0;
    return `<div class="tech ${done ? "done" : going ? "going" : ""} ${locked ? "locked" : ""}" style="--i:${i}"><div class="tech-top"><b>${t.name}</b>
      ${done ? "<span class='ok'>تم ✓</span>" : going ? `<span>باقي ${ar(S.research.left)} ساعة</span>` : locked ? `<span class="lock">يفتح في ${ERAS[t.era].name}</span>` : `<button class="btn go" data-tech="${id}" type="button" ${S.research || S.money < t.cost ? "disabled" : ""}>${money(t.cost)} ريال · ${ar(t.days)} ساعة</button>`}
      </div><p>${t.text}</p>${going ? `<i class="prog"><i style="width:${pct}%"></i></i>` : ""}</div>`;
  }).join("");
  const vote = Math.round(voteShare(S) * 100), days = Math.ceil(hoursToElection(S) / 24), last = S.elections?.[S.elections.length - 1];
  const elect = S.pop >= 30 ? `<h3>🗳️ الانتخابات</h3><div class="rows">
      ${row("الانتخابات الجاية", days === 1 ? "بكرة" : days === 2 ? "بعد يومين" : `بعد ${ar(days)} ${days <= 10 ? "أيام" : "يوم"}`)}
      ${row("لو صارت اليوم", `${ar(vote)}٪ ${vote >= 50 ? "تفوز" : "تخسر"}`, vote >= 50 ? "plus" : "minus")}
      ${row("وعود وفيت فيها هالسنة", ar(S.record?.kept || 0), "plus")}${S.record?.broken ? row("وعود ما وفيت فيها", ar(S.record.broken), "minus") : ""}
      ${last ? row(`آخر انتخابات`, `${ar(last.share)}٪ ${last.won ? "فزت ✓" : "خسرت"}`, last.won ? "plus" : "minus") : ""}
      <p class="hint">الأصوات تجي من رضا الناس وثقتهم فيك والوعود اللي وفيت فيها. الفوز يجيب دعم ${money(ELECTION_GRANT[S.era])} ريال من المحافظة، والخسارة تضاعف رسوم المحافظة السنة الجاية.</p></div>` : "";
  sheet(`<h2>المجلس البلدي</h2>${elect}
    <div class="sheet-actions"><button class="btn block" id="openQuarters" type="button">🏘️ حارات الرافعية</button></div>
    <h3>الأبحاث</h3><p>أبحاث تطوّر الرافعية. بحث واحد في كل مرة، ويبقى للأبد.</p><div class="rows">${list}</div>`, "council");
  $("openQuarters").addEventListener("click", () => { sfx.tap(); quartersSheet(); });
  $("sheetBody").querySelectorAll("[data-tech]").forEach((b) => b.addEventListener("click", () => {
    const why = startResearch(S, b.dataset.tech);
    if (why) { toast(why, "bad"); sfx.deny(); } else { toast(`بدأ بحث «${TECH[b.dataset.tech].name}»`); sfx.coin(); }
    refresh(); council();
  }));
}
$("councilBtn").addEventListener("click", () => { sfx.tap(); council(); });
document.querySelector(".when")?.addEventListener("click", () => { sfx.tap(); whenSheet(); });
/** What the season, the hour and the town's stage mean, and what comes next. */
/** «بعد يومين», «بعد ٣ أيام», «بعد ١٢ يوم». */
const afterDays = (d) => (d <= 1 ? "بكرة" : d === 2 ? "بعد يومين" : `بعد ${ar(d)} ${d <= 10 ? "أيام" : "يوم"}`);
const SEASON_NOTES = {
  spring: ["الفيضة تخضر إذا الشتاء كان ممطر، والناس يكشتون", "الحلال يرعى بالفياض ببلاش", "يجي جراد أحيانًا ويضر المزارع", "مطر الربيع خفيف"],
  summer: ["ما فيه مطر أبد", "الحر يزيد طلب الماء والكهرب (المكيفات)", "موجات حر وغبار", "الناس يقيّلون الظهر والشوارع تفضى"],
  autumn: ["الصِّرام: التمر يجيب دخل زيادة", "يبدأ الوسم وتجي أول الأمطار", "السيول تبدأ بالوادي"],
  winter: ["أكثر وقت للمطر والسيول", "موجات برد: الناس يبون تدفئة وكهرب", "الليل طويل", "مطر الشتاء هو اللي يخضّر الربيع الجاي"]
};
function whenSheet() {
  const se = seasonOf(S.day), next = SEASONS[(se.i + 1) % 4], h = hourOf(S.day), D = se.daylight * HOURS;
  const era = ERAS[S.era], nextEra = ERAS[S.era + 1];
  const prayers = PRAYERS.map((p) => ({ ...p, h: p.at(D) % HOURS }));
  const upcoming = prayers.map((p) => ({ ...p, in: (p.h - h + HOURS) % HOURS || HOURS })).sort((a, b) => a.in - b.in)[0];
  const toElect = hoursToElection(S);
  sheet(`<h2>🌤️ الوقت والموسم</h2>
    <div class="vote"><b>${se.name}</b><span>اليوم ${ar(se.dayIn)} من ${ar(SEASON_DAYS)} · السنة ${ar(se.year)} · ${h < D ? "نهار ☀️" : "ليل 🌙"}</span></div>
    <h3>وش يصير ب${se.name}</h3>
    <div class="rows">${SEASON_NOTES[se.id].map((t) => `<div class="row"><span>• ${t}</span></div>`).join("")}</div>
    <div class="rows">
      ${row("بعده", `${next.name} ${afterDays(Math.ceil(se.left))}`)}
      ${row("طول النهار", `${ar(Math.round(D))} ساعة من ${ar(HOURS)}`)}
      ${upcoming ? row("الصلاة الجاية", `${upcoming.name} بعد ${ar(upcoming.in)} ساعة`) : ""}
      ${toElect != null ? row("الانتخابات", afterDays(Math.ceil(toElect / HOURS))) : ""}
    </div>
    <h3>🏘️ ${S.name && S.site && S.site !== "main" ? S.name : "الرافعية"}: ${era.name}</h3>
    ${nextEra ? `<div class="rows">${row(`عشان تصير ${nextEra.name}`, `${money(S.pop)} من ${money(nextEra.pop)} نسمة`, S.pop >= nextEra.pop ? "plus" : "")}</div>
      <i class="bar wide"><i style="width:${Math.min(100, Math.round((S.pop / nextEra.pop) * 100))}%"></i></i>` : `<div class="need ok">وصلت أعلى مرحلة 👏</div>`}
    <p class="hint">كل ساعة باللعبة = ${ar(Math.round(HOUR_MS / 1000))} ثانية. ${worldMode ? "بعالم الجوف الوقت ماشي للكل حتى وانت طالع." : "اللعبة توقف وانت طالع منها."}</p>
    <div class="sheet-actions keep"><button class="btn block" id="whenMap" type="button">${worldMode ? "🌍 خريطة الجوف" : "🗺️ خريطة المنطقة"}</button></div>`, "when");
  $("whenMap")?.addEventListener("click", () => { sfx.tap(); if (worldMode) worldMapSheet(); else regionSheet(); });
}

/** The quarters: who lives where, how happy, what is missing, and their names (the mayor can rename them). */
function quartersSheet() {
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
const API = "/api";
const onlineOk = () => !!globalThis.RAFAYA_PREVIEW || (location.protocol.startsWith("http") && !location.hostname.endsWith("claudeusercontent.com"));
async function api(path, body) {
  if (globalThis.RAFAYA_PREVIEW) return globalThis.RAFAYA_PREVIEW(path, body); // the trial copy answers by itself (js/preview.js)
  const r = await fetch(API + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  if (r.status === 403 && (await r.clone().json().catch(() => null))?.error === "banned" && !api.bannedSaid) { api.bannedSaid = true; toast("⛔ حسابك بعالم الجوف موقوف من الإدارة", "bad"); }
  if (!r.ok) throw new Error(r.status === 503 ? "maintenance" : String(r.status));
  return r.json();
}
/** Look round another player's town in the world of al-Jouf (look-only). */
/** opts.target: choosing a building to strike; opts.scene: shown for a war scene (no visit bar). */
async function visitTown(code, opts = {}) {
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
async function refreshVisit() {
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
/**
 * Looking round someone else's town is look-only: anything in a sheet that would change it
 * (build, upgrade, repair, remove, turn, tax, loans, decisions, replies, names) is stopped here,
 * before its own handler runs. Reading, following a family, the world map and comments still work.
 */
const VISIT_OK = ".keep, [data-follow], [data-day], [data-plot], [data-district], .wm-zoom, #olText, #wmTown, .ol-com";
const VISIT_SHEETS = new Set(["chat", "developer-note", "online", "world", "pop", "happy", "when", "util", "pause", "how", "whatsnew", "war", "war-rel", "war-strike", "war-report", "war-back"]); // the war sheets only talk to the server
for (const type of ["click", "input", "change"]) $("sheetBody").addEventListener(type, (e) => {
  if (!visiting || VISIT_SHEETS.has(sheetFor)) return;
  const el = e.target.closest?.("button, input, select, textarea, [data-tech], [data-opt]");
  if (!el || el.closest(VISIT_OK)) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (type === "click") { sfx.deny(); toast("هذي مدينة غيرك: تتفرج بس، ما تقدر تغيّر فيها شي", "bad"); }
}, true);
function leaveVisit() {
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
function visitComments() {
  if (!visiting) return;
  const v = visiting;
  sheet(`<h2>💬 تعليقات على ${v.info.name}</h2>
    <div class="rows">${v.comments.length ? v.comments.map((c) => `<div class="row ol-com"><span><b>${c.author}</b><small>${new Date(c.at).toLocaleDateString("ar-SA")}</small></span><p>${c.text}</p></div>`).join("") : `<p class="hint">ما أحد علّق للحين.</p>`}</div>
    <h3>اكتب تعليقك</h3>
    <textarea id="olText" maxlength="200" rows="3" placeholder="مدينتك حلوة! عجبني…"></textarea>
    <div class="sheet-actions keep"><button class="btn go block" id="olSend" type="button">أرسل باسم ${me()?.name || "زائر"}</button></div>`, "online");
  $("olSend").addEventListener("click", async () => {
    const text = $("olText").value.trim();
    if (!text) return;
    try {
      const id = me();
      if (!id) { toast("سجّل اسمك في عالم الجوف أول", "bad"); return; }
      await api(`/world/town/${v.code}/comment`, { name: id.name, secret: id.secret, text });
      v.comments.unshift({ author: id.name, text, at: Date.now() });
      sfx.coin(); toast("وصل تعليقك ✓", "goal"); visitComments();
    } catch { toast("ما وصل التعليق، جرب بعدين", "bad"); }
  });
}
$("visitBack").addEventListener("click", () => { sfx.tap(); leaveVisit(); });
$("visitComments").addEventListener("click", () => { sfx.tap(); visitComments(); });

// ---------- the world of al-Jouf ----------
const WORLD_ID = "rafaya-world-id", WORLD_SAVE = "rafaya-world-town", WORLD_GEN_KEY = "rafaya-world-gen";
let worldClock = { epoch: Date.UTC(2026, 10, 1), offset: 0, slowAt: Date.UTC(2026, 10, 1), fastAt: Date.UTC(2026, 10, 1) }, lastSync = 0, soloS = null;
const worldHours = () => joufHours(Date.now() + worldClock.offset, worldClock);
const worldHourNow = () => Math.floor(worldHours()) + 3;
function me() {
  try { return JSON.parse(store.get(WORLD_ID) || "null"); }
  catch { return null; }
}
async function loadClock() {
  try {
    const c = await api("/world/clock"); worldClock = { epoch: c.epoch, offset: c.now - Date.now(), slowAt: c.slowAt ?? c.epoch, fastAt: c.fastAt ?? c.slowAt ?? c.epoch };
    // the world was wiped (a new generation): forget the old name and world town on this phone
    if (c.gen && String(c.gen) !== store.get(WORLD_GEN_KEY)) {
      try { localStorage.removeItem(WORLD_ID); localStorage.removeItem(WORLD_SAVE); } catch { /* fine */ }
      store.set(WORLD_GEN_KEY, String(c.gen));
    }
  } catch { /* keep the local guess */ }
}
// ---------- notifications on the phone (al-Jouf): attacks, war and being named in the chat, even with the game shut ----------
const PUSH = { registration: null, key: null, checked: false, enabled: false, checking: null };
const pushable = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const canRegisterWorker = "serviceWorker" in navigator && onlineOk() && !globalThis.RAFAYA_PREVIEW && isSecureContext;
function registerPushWorker() {
  if (!PUSH.registration) {
    PUSH.registration = navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
      .catch(() => { PUSH.registration = null; return null; });
  }
  return PUSH.registration;
}
if (canRegisterWorker) registerPushWorker();
async function activePushWorker() {
  if (!canRegisterWorker || !await registerPushWorker()) throw new Error("worker");
  let timer;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("worker")), 6500); })
    ]);
  } finally { clearTimeout(timer); }
}
function pushState() {
  if (globalThis.RAFAYA_PREVIEW || !onlineOk()) return "no";
  if (isIOS && !standalone()) return "ios-install";
  if (!pushable()) return "no";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted" || store.get("rafaya-push-on") !== "1" || me()?.plot == null) return "off";
  return PUSH.checked ? (PUSH.enabled ? "on" : "off") : "checking";
}
function pushKey() {
  if (!PUSH.key) PUSH.key = api("/world/push/key").catch((e) => { PUSH.key = null; throw e; });
  return PUSH.key;
}
async function registerPushEndpoint(sub, id) {
  const { keys } = sub.toJSON();
  const r = await api("/world/push/sub", { name: id.name, secret: id.secret, endpoint: sub.endpoint, keys });
  if (!r.ok) throw new Error(r.error || "subscription");
}
function checkPush() {
  const id = me();
  if (pushState() !== "checking" || !id?.secret || id.plot == null) return;
  if (PUSH.checking) return PUSH.checking;
  PUSH.checking = (async () => {
    try {
      const reg = await activePushWorker();
      const sub = await reg.pushManager.getSubscription();
      if (sub) await registerPushEndpoint(sub, id);
      PUSH.enabled = !!sub;
    } catch { PUSH.enabled = false; }
    finally { PUSH.checked = true; PUSH.checking = null; }
  })();
  return PUSH.checking;
}
const b64urlBytes = (s) => { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
async function pushOn() {
  const id = me();
  if (!id?.secret || id.plot == null) { toast("أسّس مدينتك بالجوف أول", "bad"); return false; }
  if (pushState() === "ios-install") { pushIosHelp(); return false; }
  if (!pushable()) { toast("جوالك أو متصفحك ما يدعم التنبيهات", "bad"); return false; }
  try {
    const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (perm !== "granted") {
      if (perm === "denied") pushDeniedHelp(); else toast("ما سمحت بالتنبيهات", "bad");
      return false;
    }
    const [reg, { key }] = await Promise.all([activePushWorker(), pushKey()]);
    const serverKey = b64urlBytes(key);
    let sub = await reg.pushManager.getSubscription();
    if (sub?.options?.applicationServerKey) {
      const previous = new Uint8Array(sub.options.applicationServerKey);
      if (previous.length !== serverKey.length || previous.some((v, i) => v !== serverKey[i])) {
        await sub.unsubscribe();
        sub = null;
      }
    }
    sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey });
    await registerPushEndpoint(sub, id);
    PUSH.checked = PUSH.enabled = true;
    store.set("rafaya-push-on", "1");
    toast("🔔 تمام! بيوصلك تنبيه إذا انضربت مدينتك أو أحد ذكرك بالشات", "goal");
    return true;
  } catch { toast("ما زبط تفعيل التنبيهات، جرّب بعد شوي", "bad"); return false; }
}
/** Notifications were refused once: how to allow them again, for this phone. */
function pushDeniedHelp() {
  sheet(`<h2>🔔 التنبيهات مقفلة</h2><p>رفضتها مرة، ترجّعها كذا:</p>
    <div class="rows"><div class="row g-step"><b class="g-n">١</b><span>${isIOS ? "إعدادات الآيفون ← <b>الإشعارات</b> ← <b>الرافعية</b> ← اسمح" : "اضغط 🔒 جنب الرابط فوق ← <b>الإشعارات</b> ← <b>سماح</b>"}</span></div>
    <div class="row g-step"><b class="g-n">٢</b><span>ارجع هنا واضغط «فعّل التنبيهات»</span></div></div>`, "push");
}
async function pushOff() {
  try {
    const reg = await activePushWorker(), sub = await reg.pushManager.getSubscription();
    if (sub) { await api("/world/push/unsub", { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
  } catch { /* fine */ }
  PUSH.checked = true; PUSH.enabled = false;
  store.set("rafaya-push-on", "0");
  toast("وقفت التنبيهات", "");
}
/** The iPhone version, e.g. 17.2 (0 when not an iPhone). */
const iosVersion = () => { const m = navigator.userAgent.match(/OS (\d+)_(\d+)/); return m ? Number(m[1]) + Number(m[2]) / 100 : 0; };
const SHARE_IC = `<svg viewBox="0 0 24 24" width="20" height="20" style="vertical-align:-4px" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>`;
const ADD_IC = `<svg viewBox="0 0 24 24" width="20" height="20" style="vertical-align:-4px" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></svg>`;
/**
 * The iPhone, step by step: notifications only work from the app on the home screen, and that app keeps
 * its own storage, so the account goes over with a 6-digit move code.
 */
async function pushIosHelp() {
  const v = iosVersion(), old = v && v < 16.04;
  let code = "";
  const id = me();
  if (!old) { try { code = (await iosPrepareMove(true)).code || ""; } catch { /* shown without */ } } // the whole game: by itself, or by this code (the owner's two ways)
  // iOS 26 moved Share into the «⋯» menu and added an «Open as Web App» switch that must stay on
  const v26 = v >= 26;
  const MORE_IC = `<b style="font-size:20px;letter-spacing:1px">⋯</b>`;
  sheet(`<h2>🔔 تنبيهات الآيفون</h2>
    ${old ? `<div class="need">حدّث الآيفون أول: الإعدادات ← عام ← تحديث البرنامج</div>` : `<p>حطّ اللعبة على شاشة جوالك مثل التطبيق، ولعبتك تنتقل معها:</p>
    <div class="rows">
      ${v26 ? `<div class="row g-step"><b class="g-n">١</b><span>اضغط ${MORE_IC} تحت يمين بسفاري ← <b>«مشاركة»</b> ${SHARE_IC}</span></div>`
        : `<div class="row g-step"><b class="g-n">١</b><span>اضغط ${SHARE_IC} تحت بسفاري <small>(ما تشوفه؟ اضغط ${MORE_IC} تحت يمين)</small></span></div>`}
      <div class="row g-step"><b class="g-n">٢</b><span>اختر ${ADD_IC} <b>«إضافة إلى الشاشة الرئيسية»</b>${v26 ? " وخل <b>«فتح كتطبيق ويب»</b> شغّال ✅" : ""} ← <b>«إضافة»</b></span></div>
      <div class="row g-step"><b class="g-n">٣</b><span>افتح <b>الرافعية</b> من الأيقونة: لعبتك تجيك لحالها، ولو طلب منك رمز اكتب اللي تحت</span></div>
      <div class="row g-step"><b class="g-n">٤</b><span>الإعدادات ← <b>«التنبيهات على الجوال»</b></span></div>
    </div>
    ${code ? `<div class="vote"><b class="ol-code" style="letter-spacing:6px">${ar(code)}</b><span>رمز لعبتك · لو ما انتقلت لحالها (صالح ٢٤ ساعة)</span></div><button class="btn block" id="iosCopy" type="button">انسخ الرمز</button>` : ""}
    <p class="ios-point">👇 الأزرار تحت الشاشة، تحت هالصفحة</p>`}`, "push");
  $("iosCopy")?.addEventListener("click", () => navigator.clipboard?.writeText(code).then(() => toast("نسخت الرمز ✓", "goal")));
}
/** A fresh town on the same land and name (the restart, here or from another phone). */
function makeWorldTown(id, name, restartAt = 0) {
  const s = newGame(Math.floor(Math.random() * 1e9), { terrain: worldTerrain(id.plot), name, site: "world" });
  s.day = worldHourNow(); s.world = { plot: id.plot, owner: id.name, start: s.day, restartAt, saveVersion: "" }; s.war = { seq: 0 };
  return s;
}
function freshWorldTown(name, restartAt, saveVersion = "") {
  const s = makeWorldTown(me(), name, restartAt);
  s.world.saveVersion = saveVersion;
  store.set(WORLD_SAVE, pack(s));
  store.set(warKey("seen"), "0");
  return s;
}
/** The server says this town started again (from another phone) after this copy: take the new one. */
function syncReply(r, home) {
  if (!r || !ownsActiveSave(home)) return;
  if (r.conflict || (r.hasSave && r.restarted > (home.world.restartAt || 0))) {
    home.world.syncConflict = true;
    if (!arrange) store.set(WORLD_SAVE, pack(home));
    if (!document.hidden && !arrange && !["update", "namefix", "decision"].includes(sheetFor)) saveConflictSheet();
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
/** The new app (iPhone home screen): bring the account over with the move code. */
function handoffSheet(firstOpen) {
  sheet(`<h2>📲 جيب لعبتك من سفاري</h2><p>${firstOpen ? "كنت تلعب من سفاري؟ " : ""}افتح اللعبة بسفاري ← الإعدادات ← <b>«انقل لعبتك للتطبيق»</b>، واكتب الرمز هنا: يجيك كل شي (حساب الجوف ومدنك).${firstOpen ? " ما عندك لعبة قبل؟ سكّر هالصفحة وكمّل عادي." : ""}</p>
    <label class="rg-name">الرمز <input id="hoCode" type="text" inputmode="numeric" maxlength="6" placeholder="١٢٣٤٥٦" style="letter-spacing:6px;text-align:center"></label>
    <div class="sheet-actions keep"><button class="btn go block" id="hoGo" type="button">رجّع حسابي</button></div>`, "world");
  $("hoGo").addEventListener("click", async () => {
    const code = ($("hoCode").value || "").replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
    try { if (await takeMove(code)) return; } catch { /* maybe an older account-only code */ }
    try {
      const r = await api("/world/handoff/claim", { code });
      if (r.error) { toast(r.error, "bad"); sfx.deny(); return; }
      store.set(WORLD_ID, JSON.stringify({ name: r.name, secret: r.secret, plot: r.plot }));
      toast(`رجع حسابك يا ${r.name} ✓`, "goal"); worldMapSheet();
    } catch { toast("ما زبط، جرّب بعد شوي", "bad"); }
  });
}
/** Once, on entering al-Jouf: offer notifications (they work best when asked at the right time). */
function pushOffer(tries = 0) {
  const st = pushState();
  if (st === "checking") { checkPush()?.then(() => pushOffer(tries)); return; }
  if (st === "on" || st === "no" || st === "denied" || store.get("rafaya-push-asked") === "1" || !worldMode) return;
  if (sheetFor || visiting || WARX.scene) { if (tries < 20) setTimeout(() => pushOffer(tries + 1), 10000); return; } // after the screen in front closes
  if (st === "off") pushKey().catch(() => {});
  store.set("rafaya-push-asked", "1");
  sheet(`<h2>🔔 تبي تنبيهات؟</h2><p>يوصلك تنبيه حتى واللعبة مسكّرة:</p>
    <div class="rows"><div class="row"><span>🚨 هجوم على مدينتك أو حرب</span></div><div class="row"><span>💬 أحد ذكرك بالشات</span></div><div class="row"><span>📰 مواطنينك يبونك وانت غايب</span></div></div>
    ${st === "ios-install" ? `<p class="hint">بالآيفون: ٣ خطوات سهلة تطلع لك بعد ما تضغط «فعّلها».</p>` : ""}
    <div class="sheet-actions two"><button class="btn" id="pushLater" type="button">بعدين</button><button class="btn go" id="pushYes" type="button">🔔 فعّلها</button></div>`, "push");
  $("pushLater").addEventListener("click", closeSheet);
  $("pushYes").addEventListener("click", async () => { if (await pushOn()) closeSheet(); });
}

// ---------- the iPhone's home-screen app keeps its own storage: the game moves over with it ----------
// In Safari on an iPhone the game keeps a fresh copy of all its saves on the server (gzip) and puts its token in
// the page's address and the manifest's start, so the app added to the home screen opens with it and restores
// everything (the al-Jouf account, the solo towns, the settings). A 6-digit code (24 h) does the same by hand.
const MOVE = { token: "", code: "", at: 0, snapshot: "", pending: null };
const moveKeys = () => Object.keys(localStorage).filter((k) => k.startsWith("rafaya-") && !k.startsWith("rafaya-move") && k !== "rafaya-handoff-asked" && k !== "rafaya-push-on");
const b64 = (buf) => { let s = ""; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768)); return btoa(s); };
const unb64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
async function gzipText(text) { return b64(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer()); }
async function gunzipText(data) { return new Response(new Blob([unb64(data)]).stream().pipeThrough(new DecompressionStream("gzip"))).text(); }
/** Safari on an iPhone: a fresh copy of the saves on the server, its token in the address and the manifest. */
async function iosPrepareMove(force) {
  if (!isIOS || standalone() || !onlineOk() || globalThis.RAFAYA_PREVIEW || typeof CompressionStream === "undefined") return MOVE;
  if (MOVE.pending) return MOVE.pending;
  MOVE.pending = (async () => {
    const all = {}; for (const k of moveKeys()) all[k] = localStorage.getItem(k);
    const text = JSON.stringify(all);
    if (!force && MOVE.token && MOVE.snapshot === text && Date.now() - MOVE.at < 6 * 3600000) return MOVE;
    const r = await (await fetch(API + "/move/put", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: await gzipText(text), old: MOVE.token }) })).json();
    if (!r.token) return MOVE;
    Object.assign(MOVE, { token: r.token, code: r.code, at: Date.now(), snapshot: text });
    const link = new URLSearchParams(location.search).get("link");
    history.replaceState(null, "", `/?move=${r.token}${link ? `&link=${link}` : ""}`);
    document.querySelector('link[rel="manifest"]')?.setAttribute("href", `/api/world/manifest?m=${r.token}${link ? `&t=${link}` : ""}`);
    return MOVE;
  })();
  try { return await MOVE.pending; }
  catch { return MOVE; }
  finally { MOVE.pending = null; }
}
/** The app: take the copy (by the link or a typed code) and restore it, then start again with it. */
async function takeMove(tokenOrCode) {
  const r = await (await fetch(API + "/move/take", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: tokenOrCode }) })).json();
  if (!r.data) return false;
  const all = JSON.parse(await gunzipText(r.data));
  for (const [k, v] of Object.entries(all)) if (k !== "rafaya-push-on" && typeof v === "string") localStorage.setItem(k, v);
  sessionStorage.setItem("rafaya-moved", "1");
  location.replace("/");
  return true;
}
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
/** Safari: the code to type in the app (and the steps). */
async function moveCodeSheet() {
  sheet(`<h2>📲 انقل لعبتك للتطبيق</h2><p class="hint">نجهّز…</p>`, "push");
  const m = await iosPrepareMove(true);
  if (!m.code) { sheet(`<h2>📲 انقل لعبتك للتطبيق</h2><div class="need">ما زبط، جرّب بعد شوي</div>`, "push"); return; }
  sheet(`<h2>📲 انقل لعبتك للتطبيق</h2><p>بالتطبيق (الأيقونة) اكتب هالرمز ويجيك كل شي: حساب الجوف ومدنك والإعدادات.</p>
    <div class="vote"><b class="ol-code" style="letter-spacing:6px">${ar(m.code)}</b><span>صالح ٢٤ ساعة · مرة وحدة</span></div>
    <button class="btn block" id="mvCopy" type="button">انسخ الرمز</button>
    <p class="hint">ما عندك التطبيق؟ افتح «تنبيهات الآيفون» من الإعدادات تلقى خطوات الإضافة.</p>`, "push");
  $("mvCopy").addEventListener("click", () => navigator.clipboard?.writeText(m.code).then(() => toast("نسخت الرمز ✓", "goal")));
}

// ---------- updates are a must: an older copy of the game asks to update and can't be used until it does ----------
const UPDATE_PARAM = "rafaya-release";
async function versionCheck() {
  if (VERSION === "dev" || globalThis.RAFAYA_PREVIEW || !onlineOk() || sheetFor === "update") return;
  let v;
  try { v = (await (await fetch("/api/version", { cache: "no-store" })).json()).version; } catch { return; } // the oldest release that may carry on
  if (!v || v === "dev") return;
  if (v === VERSION || v === REQUIRED) { // this copy is that release or a later one (an optional update came after it)
    const url = new URL(location.href);
    if (url.searchParams.has(UPDATE_PARAM)) {
      url.searchParams.delete(UPDATE_PARAM);
      url.searchParams.delete("rafaya-retry");
      history.replaceState(history.state, "", url);
    }
    return;
  }
  updateSheet(v);
}
function updateSheet(v) {
  const tried = sessionStorage.getItem("rafaya-update-tried") === v; // already reloaded for this version once: the browser kept old files
  sheet(`<h2>⬆️ تحديث جديد</h2><p>نزل تحديث جديد للعبة، ولازم تحدّث عشان تكمل. مدينتك محفوظة وما يضيع منها شي.</p>
    ${tried ? `<div class="need">المتصفح ما جاب النسخة الجديدة. اقفل اللعبة وافتحها من نفس المكان، من الأيقونة أو من المتصفح، وجرّب زر التحديث مرة ثانية.</div>` : ""}
    <div class="sheet-actions keep"><button class="btn go block" id="updNow" type="button">حدّث الحين</button></div>`, "update");
  $("sheetClose").hidden = true;
  $("updNow").addEventListener("click", async () => {
    $("updNow").disabled = true; $("updNow").textContent = "نحدّث…";
    try {
      if (playing) save();
      if (worldMode) await Promise.race([worldSync(true), new Promise((resolve) => setTimeout(resolve, 2500))]);
    } catch { /* the save is on the phone already */ }
    try { sessionStorage.setItem("rafaya-update-tried", v); } catch { /* fine */ }
    const url = new URL(location.href);
    url.searchParams.set(UPDATE_PARAM, v);
    url.searchParams.set("rafaya-retry", String(Date.now()));
    location.replace(url);
  });
}
versionCheck();
setInterval(versionCheck, 60000); // every minute (a small request), so an installed app notices a release without being reopened
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
const LIVE = { ws: null, ok: false, tries: 0, timer: 0, ping: 0 };
function liveOpen() {
  if (LIVE.ws || globalThis.RAFAYA_PREVIEW || !onlineOk() || !worldMode) return;
  let ws;
  try { ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${API}/world/live`); } catch { liveRetry(); return; }
  LIVE.ws = ws;
  ws.onopen = () => {
    LIVE.ok = true; LIVE.tries = 0;
    const id = me();
    if (id) ws.send(JSON.stringify({ t: "hello", name: id.name, secret: id.secret }));
    clearInterval(LIVE.ping); LIVE.ping = setInterval(() => { if (!document.hidden) try { ws.send('{"t":"ping"}'); } catch { /* closing */ } }, 30000); // phones drop quiet sockets; only while in front (the server sends no phone notification then)
    warPoll(true); chatPoll(true); wnewsPoll(true); // catch up on what happened while not connected
    if (LIVE.was) versionCheck(); // back after a drop: a new release restarts the server, so the update shows at once
    LIVE.was = true;
  };
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } liveHint(m); };
  ws.onclose = () => { LIVE.ws = null; LIVE.ok = false; clearInterval(LIVE.ping); liveRetry(); };
  ws.onerror = () => { try { ws.close(); } catch { /* closed */ } };
}
function liveRetry() {
  clearTimeout(LIVE.timer);
  if (!worldMode) return;
  LIVE.timer = setTimeout(liveOpen, Math.min(30000, 1000 * 2 ** LIVE.tries++)); // 1 s, 2 s, 4 s… up to 30 s
}
function liveClose() {
  clearTimeout(LIVE.timer); clearInterval(LIVE.ping);
  const ws = LIVE.ws; LIVE.ws = null; LIVE.ok = false;
  if (ws) { ws.onclose = null; try { ws.close(); } catch { /* closed */ } }
}
/** How many towns of al-Jouf are being played right now: a number only, never who (every 45 s while playing there). */
const ONLINE = { at: 0, busy: false };
async function onlinePoll(force) {
  const chip = $("sOnline");
  if (!worldMode || globalThis.RAFAYA_PREVIEW || !onlineOk()) { chip.hidden = true; return; }
  if (ONLINE.busy || document.hidden || (!force && Date.now() - ONLINE.at < 45000)) return;
  ONLINE.busy = true; ONLINE.at = Date.now();
  try { const r = await api("/world/online"); if (Number.isFinite(r.n) && worldMode) { chip.textContent = `${ar(Math.max(1, r.n))} متصل`; chip.hidden = false; } } catch { /* next time */ }
  finally { ONLINE.busy = false; }
}

/** What the server said changed: ask for it now. */
function liveHint(m) {
  if (!worldMode) return;
  if (m.t === "chat" && m.message) {
    if (!CHAT.msgs.some((x) => x.id === m.message.id)) { CHAT.msgs = [...CHAT.msgs, m.message].slice(-120); CHAT.last = Math.max(CHAT.last || 0, m.message.id); }
    if (sheetFor === "chat") chatSheet(true);
    chatCount();
  } else if (m.t === "chatdel") { CHAT.msgs = CHAT.msgs.filter((x) => x.id !== m.id); if (sheetFor === "chat") chatSheet(true); chatCount(); }
  else if (m.t === "war" || m.t === "namefix") warPoll(true);
  else if (m.t === "news") { wnewsPoll(true).then(() => { if (sheetFor === "wnews") worldNewsSheet(true); }); }
  else if (m.t === "town") {
    if (m.plot === me()?.plot) return;
    if (sheetFor === "world") clearTimeout(liveHint.map), liveHint.map = setTimeout(() => { if (sheetFor === "world") worldMapSheet(); }, 800);
    if (visiting?.world && Number(visiting.code) === m.plot && !WARX.targeting) clearTimeout(liveHint.visit), liveHint.visit = setTimeout(() => refreshVisit(), 800);
  }
}
// back on the phone after a while: the socket may have died while asleep
document.addEventListener("visibilitychange", () => { if (!document.hidden && worldMode && !LIVE.ws) { LIVE.tries = 0; liveOpen(); } });

/** The citizens' important requests still waiting for the mayor (for a reminder on the phone while away). */
function pendingSummary(home) {
  const list = (home.news || []).filter((p) => p.mood < 0 && !p.answered && p.person).sort((a, b) => (b.likes || 0) - (a.likes || 0));
  const d = home.decision && DECISIONS.find((x) => x.id === home.decision.id);
  return { n: list.length, who: list[0]?.person?.name || "", text: list[0]?.text || "", decision: d?.title || "" };
}
const saveRequests = new WeakMap();
function ownsActiveSave(home) {
  const id = me();
  return worldMode && id?.plot != null && (visiting?.home ?? S) === home && home?.world?.plot === id.plot && home.world.owner === id.name;
}
function worldSnapshot(home, compare = false) {
  const { saveVersion, pendingWrites, syncConflict, ...online } = home.world;
  return pack({ ...home, world: online, savedAt: compare ? undefined : home.savedAt, cam: compare ? undefined : home.cam,
    moneyLog: undefined, news: [], history: [], log: [], neighbours: [], promises: [], comebacks: [], demands: {} });
}
async function prepareWorldSave(home, id) {
  if (globalThis.RAFAYA_PREVIEW || typeof home.world.saveVersion === "string") return;
  const local = worldSnapshot(home, true);
  const { state, town } = await readCloudTown(id);
  if (home.world.syncConflict || town.restarted > (home.world.restartAt || 0) || (town.snapshot && worldSnapshot(state, true) !== local)) {
    home.world.syncConflict = true;
    return;
  }
  home.world.saveVersion = state.world.saveVersion;
}
const conflictCopyKey = (id) => `rafaya-world-copy-${id.plot}-${id.name}`;
function saveConflictSheet() {
  const id = me(), home = visiting?.home ?? S;
  if (!ownsActiveSave(home) || !home.world.syncConflict || sheetFor === "update" || sheetFor === "namefix") return;
  sheet(`<h2>حفظ مدينتك على جهاز ثاني</h2><p>حفظ هذا الجهاز يختلف عن حفظ السيرفر. وقفنا المزامنة عشان نحافظ على النسختين.</p>
    <p>إذا فتحت حفظ السيرفر، بنحتفظ بنسخة هذا الجهاز في الإعدادات.</p>
    <div class="sheet-actions keep"><button class="btn go block" id="openServerSave" type="button">افتح حفظ السيرفر</button></div>`, "save-conflict");
  $("openServerSave").addEventListener("click", async (event) => {
    if (arrange) { toast("احفظ الترتيب أو ألغِه أول", "bad"); return; }
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const { state } = await readCloudTown(id);
      if (!button.isConnected || !ownsActiveSave(home) || arrange) return;
      const backup = pack(home), key = conflictCopyKey(id);
      store.set(key, backup);
      if (store.get(key) !== backup) { toast("ما فيه مساحة كافية لحفظ نسخة هذا الجهاز", "bad"); return; }
      if (visiting) leaveVisit();
      S = state;
      store.set(WORLD_SAVE, pack(S));
      await enterWorldTown();
      toast("فتحنا حفظ السيرفر وحفظنا نسخة هذا الجهاز في الإعدادات", "goal");
    } catch {
      toast("ما قدرنا نفتح حفظ السيرفر. جرّب بعد شوي", "bad");
    } finally {
      button.disabled = false;
    }
  });
}
/** Send the town to the server: its look within seconds of a change, its numbers every 2 minutes, and now when leaving. */
function worldSync(force, leaving = false) {
  const id = me();
  if (!worldMode || id?.plot == null || !onlineOk() || arrange) return;
  const mine = visiting ? visiting.home : S; // while visiting, S is the other player's town: never send it as yours
  if (!ownsActiveSave(mine) || mine.world.syncConflict) return;
  if (leaving && Date.now() - (worldSync.backgroundAt || 0) < 1000) return;
  if (!force) {
    clearTimeout(worldSync.soon);
    worldSync.soon = setTimeout(warSyncNow, 3000); // only sent if the layout changed
    if (Date.now() - lastSync < 2 * 60000) return;
  }
  const busy = saveRequests.get(mine);
  if (busy) {
    if (force && !leaving) busy.next ??= busy.task.then(() => {
      if (ownsActiveSave(mine)) return worldSync(true);
    });
    return busy.next ?? busy.task;
  }
  const request = {};
  request.task = sendWorldSave(mine, id, leaving).catch(() => {}).finally(() => saveRequests.delete(mine));
  saveRequests.set(mine, request);
  return request.task;
}
async function sendWorldSave(mine, id, leaving) {
  if (typeof mine.world.saveVersion !== "string" && !globalThis.RAFAYA_PREVIEW) {
    await prepareWorldSave(mine, id);
    if (!ownsActiveSave(mine) || arrange) return;
    if (mine.world.syncConflict) { syncReply({ conflict: true }, mine); return; }
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
    const saveWrite = crypto.randomUUID();
    const body = JSON.stringify({ ...data, saveVersion: mine.world.saveVersion, saveWrite, pendingWrites });
    mine.world.pendingWrites = [...pendingWrites, saveWrite].slice(-8);
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
  if (r?.ok && ownsActiveSave(mine)) { WARX.syncTown = mine; WARX.syncKey = key; lastSync = Date.now(); }
  syncReply(r, mine);
}
addEventListener("online", () => worldSync(true));

const esc = (t) => String(t ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);
// ---------- the owner asked this player to change a name (player and/or town): it has to be done ----------
const fixLeft = (due) => { const m = Math.max(0, Math.round((due - Date.now()) / 60000)); return m >= 60 ? `${ar(Math.floor(m / 60))} ساعة${m % 60 ? ` و${ar(m % 60)} دقيقة` : ""}` : `${ar(m)} دقيقة`; };
function namefixSheet(f) {
  if (sheetFor === "namefix" || sheetFor === "update") return;
  FIX.ask = f;
  const id = me(), wantName = f.what !== "town", wantTown = f.what !== "name" && !f.removed && id?.plot != null;
  const town = worldMode && S.world ? S.name : (() => { try { return unpack(store.get(WORLD_SAVE)).name; } catch { return ""; } })();
  const why = [...f.reasons, ...(f.note ? [f.note] : [])];
  sheet(`<h2>✏️ مطلوب تغيير ${wantName && wantTown ? "اسمك واسم مدينتك" : wantName ? "اسمك" : "اسم مدينتك"}</h2>
    <p>الإدارة طلبت منك تغيّر ${wantName && wantTown ? "اسمك واسم مدينتك" : wantName ? "اسمك" : "اسم مدينتك"} عشان:</p>
    <div class="need">${why.map((w) => `• ${esc(w)}`).join("<br>")}</div>
    ${f.removed ? `<p class="hint">انتهت المهلة وانحذفت مدينتك من عالم الجوف. غيّر اسمك وتقدر تأسس مدينة جديدة.</p>` : `<div class="rows"><div class="row"><span>⏳ باقي على المهلة</span><b>${fixLeft(f.due)}</b></div></div><p class="hint">إذا ما غيّرته قبل ما تخلص المهلة، <b>تنحذف مدينتك كاملة من عالم الجوف</b>.</p>`}
    ${wantName ? `<label class="rg-name">اسمك الجديد <input id="nfName" type="text" maxlength="16" placeholder="بدل «${esc(id?.name || "")}»"></label>` : ""}
    ${wantTown ? `<label class="rg-name">اسم مدينتك الجديد <input id="nfTown" type="text" maxlength="20" placeholder="${town ? `بدل «${esc(town)}»` : ""}"></label>` : ""}
    <div class="sheet-actions keep"><button class="btn go block" id="nfGo" type="button">غيّر</button></div>`, "namefix");
  $("nfGo").addEventListener("click", async () => {
    const newName = ($("nfName")?.value || "").trim(), newTown = ($("nfTown")?.value || "").trim();
    if ((wantName && !newName) || (wantTown && !newTown)) { toast("اكتب الاسم الجديد", "bad"); sfx.deny(); return; }
    let r;
    try { r = await api("/world/namefix", { name: id.name, secret: id.secret, newName, newTown }); } catch { toast("ما زبط، جرّب بعد شوي", "bad"); return; }
    if (r.error) { toast(r.error, "bad"); sfx.deny(); return; }
    store.set(WORLD_ID, JSON.stringify({ ...me(), name: r.name }));
    try {
      const home = worldMode ? (visiting?.home ?? S) : unpack(store.get(WORLD_SAVE));
      if (home.world?.plot === id.plot) {
        home.world.owner = r.name;
        if (r.town) home.name = r.town;
        if (!arrange) store.set(WORLD_SAVE, pack(home));
        if (worldMode && !visiting) refresh();
      }
    } catch { /* the server copy is used if the local town is unreadable */ }
    FIX.ask = null; closeSheet();
    sfx.era(); toast("تم التغيير ✓ شكرًا لتعاونك", "goal");
    if (!worldMode) openWorld();
  });
}
/** The town is gone from the map (a name not changed in time): forget it on this phone. */
function forgetTown() {
  try { localStorage.removeItem(WORLD_SAVE); } catch { /* fine */ }
  const id = me(); if (id) store.set(WORLD_ID, JSON.stringify({ ...id, plot: null }));
}
function townRemoved(f) {
  if (sheetFor === "removed") return;
  if (arrange) leaveArrange(false);
  forgetTown();
  leaveWorld(); showMenu(); menuBackdrop();
  sheet(`<h2>🗑️ مدينتك انحذفت من عالم الجوف</h2><p>${f?.removed ? "انتهت مهلة تعديل الاسم، فانحذفت المدينة." : "حسابك باقي معك، وتقدر ترجع لخريطة الجوف."}</p>
    <div class="sheet-actions keep"><button class="btn go block" id="rmOk" type="button">تمام</button></div>`, "removed");
  $("rmOk").addEventListener("click", () => { closeSheet(); if (f) namefixSheet(f); });
}

/** The way into the world: a name first, then the map. */
/** The world is closed for maintenance (the server answers 503): say so, and that nothing is lost. */
function worldClosedSheet() {
  sheet(`<h2>🛠️ عالم الجوف تحت الصيانة</h2>
    <p>نشتغل على عالم الجوف ونضيف له أشياء جديدة، وبيرجع قريب إن شاء الله.</p>
    <div class="rows"><div class="row"><span>مدينتك بالعالم</span><b>محفوظة ✓</b></div></div>
    <p class="hint">إذا رجع العالم، يمسك نائب العمدة مدينتك عن الأيام اللي فاتت مثل العادة.</p>`, "world");
}
async function worldIsClosed() {
  try { await api("/world/clock"); return false; } catch (e) { return e.message === "maintenance"; }
}
async function openWorld() {
  if (!onlineOk()) { toast("عالم الجوف يشتغل من رابط اللعبة: rafaya.vamosx.workers.dev", "bad"); return; }
  if (me()) sheet(`<h2>🌍 عالم الجوف</h2><p class="hint">نحمّل الخريطة…</p>`, "world"); // something on screen at once, while the server answers
  if (await worldIsClosed()) { worldClosedSheet(); return; }
  await loadClock();
  if (!me()) { worldJoinSheet(); return; }
  try { // a name the owner asked to change comes first; a town taken off the map is forgotten on this phone
    const id = me(), st = await api("/world/war/state", { name: id.name, secret: id.secret, since: 0, seq: 0 });
    if (st.noTown && id.plot != null) forgetTown();
    if (st.namefix) { namefixSheet(st.namefix); return; }
  } catch { /* the map anyway */ }
  worldMapSheet();
}
function worldJoinSheet(recover) {
  sheet(`<h2>🌍 عالم الجوف</h2>
    <p>عالم واحد يجمع كل اللاعبين على خريطة الجوف: كل واحد يأسس مدينته في أرض، والكل يشوف مدن الثاني ويدخلها. العالم يمشي دايم، وإذا طلعت يمسك مدينتك «نائب العمدة».</p>
    ${recover ? `<label class="rg-name">اسمك <input id="wjName" type="text" maxlength="16"></label>
      <label class="rg-name">كود الاسترجاع <input id="wjCode" type="text" maxlength="12" style="text-transform:uppercase"></label>
      <div class="sheet-actions keep"><button class="btn go block" id="wjGo" type="button">رجّع حسابي</button></div>`
      : `<label class="rg-name">اختر اسمك <input id="wjName" type="text" maxlength="16" placeholder="مثلاً: أبو_فهد"></label>
      <p class="hint">٣ إلى ١٦ حرف (عربي أو إنجليزي أو أرقام). يطلع للكل فوق مدينتك، فلا تكتب اسمك الكامل.</p>
      <div class="sheet-actions keep"><button class="btn go block" id="wjGo" type="button">ادخل العالم</button></div>
      <button class="btn block" id="wjRecover" type="button">عندي حساب وكود استرجاع</button>
      <button class="btn block" id="wjHandoff" type="button">📲 كنت ألعب من سفاري (عندي رمز)</button>`}`, "world");
  $("wjRecover")?.addEventListener("click", () => worldJoinSheet(true));
  $("wjHandoff")?.addEventListener("click", () => handoffSheet());
  $("wjGo").addEventListener("click", async () => {
    const name = $("wjName").value.trim();
    try {
      if (recover) {
        const r = await api("/world/recover", { name, recovery: $("wjCode").value.trim().toUpperCase() });
        store.set(WORLD_ID, JSON.stringify({ name: r.name, secret: r.secret, plot: r.plot }));
        toast(`رجع حسابك يا ${r.name} ✓`, "goal"); worldMapSheet();
      } else {
        const r = await api("/world/join", { name });
        store.set(WORLD_ID, JSON.stringify({ name: r.name, secret: r.secret, plot: null }));
        sheet(`<h2>هلا ${r.name}!</h2><p>هذا كود الاسترجاع حقك. احفظه عندك (صوّره أو انسخه): لو غيرت جوالك ترجع فيه لاسمك ومدينتك.</p>
          <div class="row"><span>كود الاسترجاع</span><b class="ol-code">${r.recovery}</b></div>
          <div class="sheet-actions keep"><button class="btn block" id="wjCopy" type="button">انسخ الكود</button><button class="btn go block" id="wjNext" type="button">حفظته، كمّل للخريطة</button></div>`, "world");
        $("wjCopy").addEventListener("click", () => navigator.clipboard?.writeText(r.recovery).then(() => toast("نسخت ✓", "goal")));
        $("wjNext").addEventListener("click", () => worldMapSheet());
      }
    } catch (e) {
      const messages = { 409: "الاسم مأخوذ، اختر غيره", 400: "اختر اسمًا من ٣ إلى ١٦ حرف بدون رموز", 422: "هالاسم ما يصلح. اختر لقب مناسب للعبة." };
      toast(messages[e.message] || "ما زبط، تأكد من الاسم والكود", "bad");
    }
  });
}
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
async function worldMapSheet(pick) {
  worldPick = pick ?? worldPick;
  if (sheetFor !== "world") sheet(`<h2>🌍 عالم الجوف</h2><p class="hint">نحمّل الخريطة…</p>`, "world"); // something on screen at once (the map comes from the server)
  const id = me();
  let plots = [];
  try { plots = (await api("/world/map")).plots; } catch (e) { if (e.message === "maintenance") worldClosedSheet(); else toast("ما قدرت أوصل للسيرفر", "bad"); return; }
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
  const sel = worldPick, t = sel != null ? byPlot.get(sel) : null;
  let detail = `<p class="hint">اضغط على أي أرض: المدن بالأخضر، ومدينتك بالذهبي.</p>`;
  if (sel != null) {
    const terr = TERRAINS[worldTerrain(sel)];
    if (t) {
      const mine = id?.plot === sel, ago = Math.max(0, Math.round((Date.now() - t.updated) / 60000));
      detail = `<div class="rg-card"><div class="rg-top"><b>${t.town}</b><small>${ERAS[t.era || 0].name} · قرب ${worldPlace(sel)} · أرض ${terr.name}</small></div>
        <div class="rows">${row("العمدة", t.owner)}${row("السكان", money(t.pop || 0))}${row("الرضا", `${ar(t.happy || 0)}٪`)}${row("آخر تحديث", ago < 1 ? "الحين" : ago < 60 ? `قبل ${ar(ago)} دقيقة` : ago < 1440 ? `قبل ${ar(Math.round(ago / 60))} ساعة` : `قبل ${ar(Math.round(ago / 1440))} يوم`)}</div>
        <div class="sheet-actions keep">${mine ? `<button class="btn go block" id="wmEnter" type="button">ادخل مدينتي</button>${t.renamed ? "" : `<button class="btn block" id="wmRename" type="button">✏️ غيّر اسم مدينتك (مرة وحدة بس)</button>`}` : `${warCardHtml(sel)}<button class="btn go block" id="wmVisit" type="button">ادخلها وشوفها</button><button class="btn block" id="wmReport" type="button">بلّغ عن اسم أو كلام مسيء</button>`}</div></div>`;
    } else {
      detail = `<div class="rg-card"><div class="rg-top"><b>أرض فاضية قرب ${worldPlace(sel)}</b><small>أرض ${terr.name}</small></div><p>${terr.text}</p>
        ${id && (id.plot == null) ? `<label class="rg-name">اسم مدينتك <input id="wmTown" type="text" maxlength="20" placeholder="مثلاً: هجرة الشعيب"></label>
          <div class="sheet-actions keep"><button class="btn go block" id="wmClaim" type="button">أسس مدينتك هنا</button></div>` : id ? `<p class="hint">عندك مدينة. كل لاعب له مدينة وحدة بالعالم.</p>` : ""}</div>`;
    }
  }
  sheet(`<h2>🌍 عالم الجوف</h2><p>${id ? `أهلًا <b>${id.name}</b> · ` : ""}${ar(plots.length)} مدينة بالعالم</p>
    <div class="wm-wrap"><svg class="wm-map" id="wmMap" viewBox="0 0 ${cols * cell} ${rows * cell}" role="img" aria-label="خريطة الجوف">${cells}${labels}</svg>
      <div class="wm-zoom"><button type="button" id="wmIn" aria-label="قرّب">＋</button><button type="button" id="wmOut" aria-label="بعّد">－</button></div></div>
    ${detail}
    ${id?.plot != null && sel !== id.plot ? `<button class="btn block" id="wmMine" type="button">📍 وريني مدينتي</button>` : ""}`, "world");
  // first time open: close in on your own town (or the middle), the whole of al-Jouf is a pinch away
  if (!wmView && !wmSeen) { const [mx, my] = id?.plot != null ? worldXY(id.plot) : [WORLD.cols / 2, WORLD.rows / 2]; const w = cols * cell / 2, h = rows * cell / 2; wmView = { x: mx * cell - w / 2, y: my * cell - h / 2, w, h }; }
  wmSeen = true;
  mapZoom($("wmMap"), cols * cell, rows * cell, (plot) => { sfx.tap(); worldMapSheet(plot); });
  $("wmMine")?.addEventListener("click", () => { wmView = null; wmSeen = false; worldMapSheet(id.plot); });
  $("wmEnter")?.addEventListener("click", () => enterWorldTown());
  $("wmRename")?.addEventListener("click", () => { sfx.tap(); renameSheet(t, plots); });
  $("wmVisit")?.addEventListener("click", () => visitTown(sel));
  $("wmRel")?.addEventListener("click", () => relSheet(sel));
  $("wmTarget")?.addEventListener("click", (e) => { const why = e.currentTarget.dataset.why; if (why) { toast(why, "bad"); sfx.deny(); return; } startTargeting(sel); });
  $("wmReport")?.addEventListener("click", async () => {
    try { await api("/world/report", { name: id?.name, secret: id?.secret, plot: sel, reason: "اسم أو كلام مسيء" }); toast("وصل البلاغ، شكرًا", "goal"); } catch { toast("سجّل اسمك أول", "bad"); }
  });
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
/** Rename your town in al-Jouf: once only, and never to a name another town has. */
function renameSheet(t, plots) {
  const id = me();
  sheet(`<h2>✏️ اسم مدينتك</h2><p>تقدر تغيّر اسم «${t.town}» <b>مرة وحدة بس</b>، وبعدها يثبت. والاسم لازم ما يكون لمدينة ثانية بالجوف.</p>
    <label class="rg-name">الاسم الجديد <input id="rnTown" type="text" maxlength="20" placeholder="${t.town}"></label>
    <div class="sheet-actions two"><button class="btn" id="rnBack" type="button">رجوع</button><button class="btn go" id="rnGo" type="button">ثبّت الاسم</button></div>`, "world");
  $("rnBack").addEventListener("click", () => worldMapSheet(t.plot));
  $("rnGo").addEventListener("click", async () => {
    const town = ($("rnTown").value || "").trim();
    if (town.length < 2) { toast("اكتب الاسم الجديد", "bad"); return; }
    if (plots.some((o) => o.plot !== t.plot && townNameKey(o.town) === townNameKey(town))) { toast(`فيه مدينة بالجوف اسمها «${town}»، اختر اسم ثاني`, "bad"); sfx.deny(); return; }
    if (!confirm(`متأكد؟ «${town}» بيصير اسمها للأبد وما تقدر تغيّره مرة ثانية.`)) return;
    try {
      const r = await api("/world/rename", { name: id.name, secret: id.secret, town });
      if (r.error) { toast(r.error, "bad"); sfx.deny(); return; }
      if (worldMode && S.world?.plot === t.plot) { S.name = r.town; save(); refresh(); }
      else { try { const s = unpack(store.get(WORLD_SAVE)); s.name = r.town; store.set(WORLD_SAVE, pack(s)); } catch { /* the town picks it up next time */ } }
      sfx.era(); toast(`صار اسمها «${r.town}» 🎉`, "era");
      worldMapSheet(t.plot);
    } catch { toast("ما زبط، جرّب بعد شوي", "bad"); }
  });
}
async function readCloudTown(id) {
  const { town } = await api(`/world/town/${id.plot}`);
  if (town.owner !== id.name) throw new Error("different town owner");
  const state = town.snapshot ? unpack(town.snapshot) : makeWorldTown(id, town.town, town.restarted);
  if (state.world?.plot !== id.plot) throw new Error("different town plot");
  state.name = town.town;
  state.world.owner = id.name;
  state.world.saveVersion = town.saveVersion ?? "";
  return { state, town };
}
async function readOwnTown(id) {
  if (id?.plot == null) return null;
  try {
    const local = unpack(store.get(WORLD_SAVE));
    if (local.world?.plot === id.plot) {
      local.world.owner = id.name;
      if (!local.world.syncConflict) await prepareWorldSave(local, id).catch(() => {});
      return local;
    }
  } catch { /* use the server copy when local storage is missing or unreadable */ }
  return readCloudTown(id).then(({ state }) => state).catch(() => null);
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
  const gap = worldHourNow() - S.day;
  const report = S.world.syncConflict ? null : deputyCatchUp(S, gap);
  A = analyze(S);
  closeSheet(); setTool(null);
  world.newTown(); world.sync(S, { tiles: true, roads: true, buildings: true });
  restoreTownCamera(S.cam);
  startPlaying();
  save(); worldSync(true);
  if (S.world.syncConflict) { saveConflictSheet(); return; }
  if (report && gap > 1) deputyReport(report);
  warBack(!!report && gap > 1);
  if (!globalThis.RAFAYA_PREVIEW_SAMPLE) setTimeout(maybeWhatsNew, 1200); // after the deputy's report
  setTimeout(pushOffer, 6000); // waits for the report or any screen in front to close
}
function deputyReport(r) {
  const h = r.hours, d = Math.round(h / 24), span = h < 24 ? `${ar(h)} ساعة` : d === 1 ? "يوم" : d === 2 ? "يومين" : `${ar(d)} ${d <= 10 ? "أيام" : "يوم"}`;
  sheet(`<h2>🧑‍💼 تقرير نائب العمدة</h2><p>غبت ${span} من وقت العالم، والنائب مسك البلد.${r.slept ? " وبعد أسبوع من الغياب دخلت المدينة في سبات لين رجعت." : ""}</p>
    <div class="rows">
      ${row("الميزانية", `${r.money >= 0 ? "+" : "−"}${money(Math.abs(r.money))} ريال`, r.money >= 0 ? "plus" : "minus")}
      ${r.capped ? `<div class="hint">💡 أكثر شي تكسبه مدينتك وانت برا ${money(r.cap)} ريال (${ERAS[S.era].name})، وكل ما كبرت مدينتك زاد الحد. العب وانت داخل تكسب كامل.</div>` : ""}
      ${row("السكان", `${r.pop >= 0 ? "+" : "−"}${money(Math.abs(r.pop))}`, r.pop >= 0 ? "plus" : "minus")}
      ${r.did.repairs ? row("رمّم المباني", `${ar(r.did.repairs)} مرة`) : ""}
      ${r.did.decisions ? row("قرارات أخذها بالخيار الآمن", ar(r.did.decisions)) : ""}
      ${r.did.taxUp ? row("رفع الضريبة", `من ${ar(r.taxFrom)}٪ إلى ${ar(S.tax)}٪`, "minus") : ""}
      ${r.did.shield ? row("🛡️ درع الغياب حماك", `${ar(r.did.shield)} مرة`, "plus") : ""}
    </div>
    ${r.msgs.filter((m) => m.text && m.kind !== "ach").slice(-4).map((m) => `<p class="hint">• ${m.title ? m.title + ": " : ""}${m.text}</p>`).join("")}
    <div class="sheet-actions keep"><button class="btn go block" id="depOk" type="button">تمام</button></div>`, "away");
  $("depOk").addEventListener("click", closeSheet);
}
/** Standing orders for the deputy mayor. */
function deputySheet() {
  const o = { ...DEPUTY, ...(S.deputy || {}) };
  sheet(`<h2>🧑‍💼 نائب العمدة</h2><p>إذا طلعت من اللعبة، النائب يمسك مدينتك والعالم يكمل. هذي أوامرك له:</p>
    <div class="rows">
      <label class="row toggle"><span>يرمم المباني اللي تخرب</span><input type="checkbox" id="dpRepair" ${o.repair ? "checked" : ""}></label>
      <label class="row toggle"><span>يرفع الضريبة شوي إذا قلّت الفلوس</span><input type="checkbox" id="dpTax" ${o.tax ? "checked" : ""}></label>
      <div class="row"><span>ما يصرف لو الميزانية تحت</span><select id="dpFloor">${[0, 2000, 5000, 20000, 50000].map((v) => `<option value="${v}" ${o.floor === v ? "selected" : ""}>${money(v)}</option>`).join("")}</select></div>
    </div>
    <p class="hint">النائب ما يبني ولا يهد شي، ويختار الخيار الآمن في القرارات، ويرد على الناس بـ«نشوف».</p>
    <h3>🛡️ درع الغياب</h3>
    <p class="hint">وأنت طالع ما تفلس، وما تخسر أكثر من ٥٪ من سكانك باليوم، والسيول أخف. وإذا غبت أكثر من أسبوع تدخل مدينتك في سبات وما يتغير فيها شي.</p>`, "deputy");
  const set = () => { S.deputy = { repair: $("dpRepair").checked, tax: $("dpTax").checked, floor: Number($("dpFloor").value) }; save(); };
  for (const k of ["dpRepair", "dpTax", "dpFloor"]) $(k).addEventListener("change", set);
}

// ---------- «صراع الجوف»: war in the world of al-Jouf (the server decides; see js/warserver.js) ----------
const WARX = {
  st: null,          // the last state from the server
  polled: 0,         // when it was asked (ms)
  busy: false,
  targeting: null,   // { plot, town, owner, era, list, sel } while choosing a building in an enemy town
  scene: null,       // { op, kind } while a war scene plays
  watched: new Set() // operations whose result was already shown
};
const warKey = (k) => `rafaya-war-${k}-${me()?.plot ?? "x"}`;
const warSeen = () => Number(store.get(warKey("seen")) || 0);
const warPlayed = () => new Set(JSON.parse(store.get(warKey("played")) || "[]"));
const markPlayed = (id) => { const s = warPlayed(); s.add(id); store.set(warKey("played"), JSON.stringify([...s].slice(-80))); };
const warReq = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e8).toString(36)}`;
const warNow = () => Date.now() + (WARX.offset || 0);
const fmtLeft = (ms) => minutesText(Math.max(1000, ms));
const secLeft = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return s >= 90 ? minutesText(s * 1000) : `${ar(s)} ث`; };
/** A war request to the server (always as you, with your secret). Returns the answer ({ error } when refused). */
async function warApi(action, body = {}) {
  const id = me();
  if (!id || id.plot == null) return { error: "سجّل وأسس مدينتك بعالم الجوف أول" };
  if (action !== "state" && worldMode && (visiting?.home ?? S).world?.syncConflict) return { error: "افتح حفظ السيرفر أول عشان ترجع مزامنة مدينتك" };
  try { return await api(`/world/war/${action}`, { name: id.name, secret: id.secret, ...body }); } catch (e) { return { error: e.message === "maintenance" ? "عالم الجوف تحت الصيانة" : "ما قدرت أوصل للسيرفر: جرّب بعد شوي" }; }
}
/** The buildings as the server last saw them: when they changed, send the town before any war action (the server only trusts what it has). */
const warTownKey = (s) => `${s.era}|${s.tiles.map(({ t, b }) => b
  ? [t, b.id, b.lvl, b.build > 0 ? "b" : "", b.rot || 0, b.n || 1, b.monument || ""].join(":") : t[0]).join(",")}`;
async function warSyncNow() {
  const home = visiting ? visiting.home : S, id = me();
  if (!worldMode || arrange || id?.plot == null || home?.world?.plot !== id.plot) return;
  if (WARX.syncTown === home && warTownKey(home) === WARX.syncKey) return;
  await worldSync(true);
}
/** An apology in the middle of the screen: what went wrong (our mistake) and what was given back. 30 seconds, or «تمام». */
function apologyBox(n) {
  document.getElementById("apology")?.remove();
  const el = document.createElement("div");
  el.id = "apology"; el.className = "apology";
  el.innerHTML = n.kind === "gift" ? `<div class="apology-card"><div class="apology-ic">🎁</div><h2>هدية من إدارة الجوف</h2>
    <div class="apology-back">وصلتك هدية<b>+${money(n.amount || 0)} ريال</b></div>
    ${n.text ? `<p>«${n.text.replace(/[<>]/g, "")}»</p>` : ""}` : `<div class="apology-card"><div class="apology-ic">🙏</div><h2>نعتذر منك</h2>
    <p>صار <b>خطأ من عندنا</b> ببرمجة اللعبة بحساب خصم الغياب، وانخصم من مدينتك مبلغ ما كان المفروض ينخصم.</p>
    <div class="apology-back">رجّعنا لك حقك كامل<b>+${money(n.amount || 0)} ريال</b></div>
    <p class="hint">السموحة منك، وشكرًا على صبرك 🌹</p>`;
  el.innerHTML += `<i class="apology-bar"></i><button class="btn go block" type="button">تمام</button>`;
  el.querySelector(".apology-card").append(...el.querySelectorAll(":scope > .apology-bar, :scope > button")); // the bar and «تمام» for both kinds
  document.body.append(el);
  sfx.coin?.();
  const close = () => { el.classList.add("out"); setTimeout(() => el.remove(), 300); };
  el.querySelector("button").addEventListener("click", close);
  setTimeout(close, 30000);
}
/** Ask the server how things stand, and bring the town up to date (money, damage, notes, attacks). */
async function warPoll(force) {
  if (force && WARX.busy) { WARX.again = true; return WARX.st; } // a hint while a poll runs: ask again right after (a gift or a strike is never left waiting)
  if (!worldMode || WARX.busy || (!force && Date.now() - WARX.polled < (LIVE.ok ? 90000 : 25000))) return WARX.st; // live: pushed at once, this is only a safety net
  WARX.busy = true; WARX.polled = Date.now();
  if (force) await warSyncNow();
  const st = await warApi("state", { since: warSeen(), seq: (visiting ? visiting.home : S).war?.seq || 0 });
  WARX.busy = false;
  if (st.noTown && worldMode) { townRemoved(st.namefix); return WARX.st; }
  if (st.namefix) namefixSheet(st.namefix);
  else if (FIX.ask && !st.error) { FIX.ask = null; if (sheetFor === "namefix") closeSheet(); } // the owner took the request back
  if (st.error) return WARX.st;
  WARX.offset = st.now - Date.now();
  world.fx && (world.fx.clockOffset = WARX.offset);
  WARX.st = st;
  if (!(visiting?.home ?? S).world?.syncConflict) warApply(st);
  if (WARX.again) { WARX.again = false; setTimeout(() => warPoll(true), 50); }
  return st;
}
/** Charges, damage and repairs onto the own town (the server's numbers win over the town's own). */
function warApply(st) {
  const home = visiting ? visiting.home : S;
  home.war ||= { seq: 0 };
  let paid = 0, supportPaid = 0, posted = false;
  const reasons = new Map([["gift", "gift"], ["citizenSupport", "citizenSupport"], ["refund", "refund"], ["away cap", "awayLimit"]]);
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
    for (const n of fresh) if (n.kind === "apology" || n.kind === "gift") apologyBox(n); // our own mistake: said plainly, in the middle of the screen
    if (!WARX.quietNotes && !WARX.scene) for (const n of fresh.filter((x) => x.kind !== "apology" && x.kind !== "citizenSupport").slice(-3)) toast(n.text, ["hit", "war", "hostile", "incoming"].includes(n.kind) ? "bad" : ["intercept", "peace", "truce"].includes(n.kind) ? "goal" : "");
    if (fresh.some((n) => n.kind === "incoming" || n.kind === "war")) warSfx.alarm();
    warNews(fresh);
  }
  if (supportPaid > 0) toast(`💰 تم صرف ${money(supportPaid)} ريال من حساب المواطن لمدينتك`, "goal");
  $("warDot").hidden = !(st.rels || []).some((r) => r.offer && r.offer.by !== me()?.plot) && !(st.ops || []).some((o) => o.side === "in" && o.status === "flying");
  if (sheetFor === "war") warSheet(WARX.tab);
}
/** Results to show: an attack on us that just landed (played here if the mayor is home), our own that just landed. */
function warWatch(st) {
  const played = warPlayed();
  for (const o of st.ops || []) {
    if (o.status !== "done" || played.has(o.id) || WARX.watched.has(o.id)) continue;
    if (Date.now() - (o.doneAt - WARX.offset) > 15 * 60000) { markPlayed(o.id); continue; } // old news: in the log only
    WARX.watched.add(o.id);
    if (o.side === "in" && !visiting && !WARX.scene && sheetFor !== "decision") { warDefenseScene(o); }
    else if (o.side === "out" && !WARX.scene) { markPlayed(o.id); toast(`📋 نتيجة عمليتك على «${o.toTown}» وصلت`, o.result.dmg ? "goal" : ""); }
  }
  // an attack on its way: a countdown at the top
  const incoming = (st.ops || []).filter((o) => o.side === "in" && o.status === "flying" && o.detected).sort((a, b) => a.arriveAt - b.arriveAt)[0];
  clearTimeout(WARX.arriveTimer);
  const next = (st.ops || []).filter((o) => o.status === "flying").sort((a, b) => a.arriveAt - b.arriveAt)[0];
  if (next) WARX.arriveTimer = setTimeout(() => warPoll(true), Math.max(1500, next.arriveAt - warNow() + 1500));
  warAlertBar(incoming);
}
function warAlertBar(op) {
  const bar = $("warAlert");
  clearInterval(WARX.alertTick);
  if (!op) { bar.hidden = true; return; }
  bar.hidden = false;
  const draw = () => { const left = op.arriveAt - warNow(); bar.innerHTML = `🚨 هجوم من «${op.fromTown}» على ${op.bname} · يوصل بعد <b>${secLeft(left)}</b>`; if (left <= 0) { clearInterval(WARX.alertTick); bar.hidden = true; } };
  draw(); WARX.alertTick = setInterval(draw, 1000);
}
/** What the residents say about the war (local templates only). */
function warNews(notes) {
  const hour = S.day, posts = [];
  // "d-": a post the mayor does not answer (no promise to keep); a complaint still shows «💡 وش يبي»
  const say = (kind, text, mood) => posts.push({ id: `d-war${Date.now()}${posts.length}`, day: hour, kind: "war", person: { name: ["أبو سعد", "أم فهد", "أبو ناصر", "مشاري", "أبو خالد", "نوف"][Math.floor(Math.random() * 6)], role: "من الأهالي", area: "" }, text, mood, topic: "war" });
  for (const n of notes) {
    if (n.kind === "hit") say("hit", `${n.text.replace(/^💥 /, "")} الأهالي ينتظرون الإصلاح.`, -1);
    if (n.kind === "intercept") say("intercept", "دفاعات المدينة نجحت في اعتراض هجوم جوي، والحمد لله ما صار ضرر.", 1);
    if (n.kind === "war") say("war", n.text.includes("أعلنت الحرب على") ? "العمدة أعلن الحرب! الله يستر، والناس يسألون عن المصاريف." : "أعلنوا علينا الحرب! نبي دفاع جوي يحمينا.", -1);
    if (n.kind === "repair" && n.text.startsWith("🔧 النائب")) say("repair", "شفنا عمال الإصلاح عند المبنى المضروب، الله يعطيهم العافية.", 1);
    if (n.kind === "peace") say("peace", "انتهت العداوة بين المدينتين، والأهالي يأملون ترجع الأمور طبيعية.", 1);
    if (n.kind === "truce") say("truce", "هدنة! الناس ارتاحوا شوي.", 1);
  }
  if (posts.length) addPosts(posts.slice(0, 3));
}

// ---------- the command: «⚔️ القيادة العسكرية» ----------
const WAR_TABS = [["home", "نظرة عامة"], ["arms", "الترسانة"], ["def", "الدفاع"], ["ops", "العمليات"], ["rels", "العلاقات"], ["log", "السجل"], ["deputy", "النائب"]];
const stateTag = (wd) => { const d = damageState(wd); return `<i class="wd-tag ${d.cls}">${d.name}${wd ? ` ${ar(Math.round(wd))}٪` : ""}</i>`; };
async function warSheet(tab = "home") {
  WARX.tab = tab;
  if (!worldMode) return;
  const home = visiting ? visiting.home : S;
  const hasHQ = home.tiles.some((t) => t.b?.id === "milhq");
  if (!WARX.st) { sheet(`<h2>⚔️ القيادة العسكرية</h2><p class="hint">نحمّل…</p>`, "war"); await warPoll(true); }
  const st = WARX.st;
  if (!st) { sheet(`<h2>⚔️ القيادة العسكرية</h2><div class="need">ما قدرت أوصل للسيرفر.</div>`, "war"); return; }
  if (!hasHQ) {
    sheet(`<h2>⚔️ القيادة العسكرية — عالم الجوف</h2>
      <p>بعالم الجوف تقدر تبني قوة عسكرية: صواريخ ومسيّرات تضرب فيها منشآت الخصوم وقت الحرب، ورادار ودفاع جوي يحمي مدينتك.</p>
      <div class="rows">${row("تبدأ من", `${ERAS[WAR.minEra].name} (${ar(ERAS[WAR.minEra].pop)} ساكن)`)}${row("أول خطوة", "ابنِ «مركز القيادة العسكرية»")}${row("وين؟", "البناء ← الدفاع والعسكرية")}</div>
      <div class="need ok">ما أحد يقدر يضرب البيوت ولا المساجد ولا المدارس ولا المستوصفات ولا الحدائق. الضربات على المنشآت العسكرية والكهرباء والماء والمصانع بس، والضرر ينصلح وما يمسح شي.</div>
      ${home.era < WAR.minEra ? `<div class="need">مدينتك للحين ${ERAS[home.era].name}: القرى ما تهاجم ولا تنهاجم.</div>` : ""}`, "war");
    return;
  }
  const tabs = `<div class="war-tabs">${WAR_TABS.map(([k, n]) => `<button type="button" class="${k === tab ? "on" : ""}" data-wtab="${k}">${n}</button>`).join("")}</div>`;
  const p = st.profile, ars = st.arsenal, caps = st.caps;
  const drones = ars.drone + ars.drone2, missiles = ars.missile + ars.missile2;
  const list = (items, id) => items.length ? items.map((it) => row(`${milStat(id, it.lvl).name}`, stateTag(it.wd))).join("") : "";
  let body = "";
  if (tab === "home") {
    const flying = st.ops.filter((o) => o.status === "flying");
    body = `<div class="war-grid">
        <div><b>${ar(drones)}<small>/${ar(caps.drones)}</small></b><span>🛩️ مسيّرات</span></div>
        <div><b>${ar(missiles)}<small>/${ar(caps.missiles)}</small></b><span>🚀 صواريخ</span></div>
        <div><b>${ar(ars.intc)}<small>/${ar(caps.intc)}</small></b><span>🛡️ اعتراضية</span></div>
        <div><b>${ar(flying.length)}</b><span>✈️ عمليات بالجو</span></div></div>
      <div class="rows">
        ${p.hq ? row("مركز القيادة", `${milStat("milhq", p.hq.lvl).name} ${stateTag(p.hq.wd)}`) : ""}
        ${row("قواعد المسيّرات", ar(p.bases.length))}${row("منصات الصواريخ", ar(p.pads.length))}
        ${row("الرادار", p.radars.length ? `${ar(p.radars.length)} ${p.radars.some((r) => r.wd < 85) ? "✓ يرصد" : "✕ متعطل"}` : "✕ ما فيه")}
        ${row("الدفاع الجوي", p.airdefs.length ? `${ar(p.airdefs.length)} بطارية` : "✕ ما فيه")}
        ${row("فرصة اعتراض مسيّرة", `${ar(Math.round(st.intercept.drone * 100))}٪`)}${row("فرصة اعتراض صاروخ", `${ar(Math.round(st.intercept.missile * 100))}٪`)}
        ${row("المصروف العسكري بالساعة", `−${fine(A.costs.military || 0)}`, "minus")}
        ${st.shield ? row("🛡️ درع الحماية", `باقي ${fmtLeft(st.shield - warNow())}`, "plus") : ""}
        ${row("علاقات متوترة", ar(st.rels.filter((r) => r.state !== "peace").length))}
      </div>
      ${!p.airdefs.length ? `<div class="need">💡 مدينتك بلا دفاع جوي: أي هجوم يوصل. ابنِ بطارية دفاع جوي ورادار، واشترِ صواريخ اعتراضية.</div>` : !ars.intc ? `<div class="need">💡 الدفاع الجوي بلا ذخيرة: اشترِ صواريخ اعتراضية من «الدفاع».</div>` : ""}
      <p class="hint">للهجوم: افتح خريطة الجوف، اختر مدينة بينك وبينها حرب، واضغط «🎯 استهداف المدينة».</p>`;
  } else if (tab === "arms") {
    body = `<p class="hint">الأسعار من ميزانية مدينتك. المسيّرات تنحفظ بالقاعدة، والصواريخ على المنصات${p.armory ? "، والمستودع يزيد السعة ٥٠٪" : ""}.</p><div class="rows">` + WEAPON_IDS.map((w) => {
      const W = WEAPONS[w], why = weaponBlocker(p, w), kind = W.kind === "drone" ? "drones" : "missiles", room = caps[kind] - (W.kind === "drone" ? drones : missiles);
      return `<div class="war-arm ${why ? "locked" : ""}"><b class="ic">${W.icon}</b><span><b>${W.name}</b><small>${W.text}</small><small>القوة ${ar(W.power)} · السعر ${money(W.price)} ريال · تشغيل ${money(W.fee)} · عندك <b>${ar(ars[w])}</b></small>${why ? `<small class="minus">${why}</small>` : ""}</span>
        ${why ? "" : `<button class="btn go" type="button" data-buy="${w}" ${room <= 0 || home.money < W.price ? "disabled" : ""}>+١</button>`}</div>`;
    }).join("") + `</div><p class="hint">مكان للمسيّرات: ${ar(Math.max(0, caps.drones - drones))} · للصواريخ: ${ar(Math.max(0, caps.missiles - missiles))}</p>`;
  } else if (tab === "def") {
    body = `<div class="rows">${list(p.airdefs, "airdef") || row("بطاريات الدفاع الجوي", "✕ ما فيه")}${list(p.radars, "radar") || row("الرادار", "✕ ما فيه")}
        ${row("صواريخ اعتراضية", `${ar(ars.intc)} من ${ar(caps.intc)}`)}
        ${row("ضد المسيّرة الأساسية", `${ar(Math.round(st.intercept.drone * 100))}٪`)}${row("ضد المسيّرة المتطورة", `${ar(Math.round(st.intercept.drone2 * 100))}٪`)}
        ${row("ضد الصاروخ العادي", `${ar(Math.round(st.intercept.missile * 100))}٪`)}${row("ضد الصاروخ المتقدم", `${ar(Math.round(st.intercept.missile2 * 100))}٪`)}</div>
      ${p.airdefs.length ? `<div class="sheet-actions keep"><button class="btn go block" type="button" data-buy="intc" ${ars.intc >= caps.intc || home.money < WAR.interceptor.price ? "disabled" : ""}>اشترِ صاروخ اعتراضي (${money(WAR.interceptor.price)} ريال)</button>
        <button class="btn block" type="button" data-buy="intcfill" ${ars.intc >= caps.intc ? "disabled" : ""}>عبّها كلها (${money((caps.intc - ars.intc) * WAR.interceptor.price)} ريال)</button></div>` : ""}
      <p class="hint">كل محاولة اعتراض تستهلك صاروخ اعتراضي. الرادار يرفع الدقة ويعطيك إنذار قبل الوصول، وبدونه الدفاع شبه أعمى. والضرر على الرادار أو البطارية يضعف الحماية.</p>`;
  } else if (tab === "ops") {
    body = st.ops.length ? `<div class="rows">${st.ops.map((o) => {
      const r = o.result, out = o.side === "out", when = new Date(o.launchAt - WARX.offset).toLocaleTimeString("ar-SA", { hour: "numeric", minute: "2-digit" });
      const what = o.status === "flying" ? `بالجو · يوصل بعد ${secLeft(o.arriveAt - warNow())}` : r.blocked ? "ما أصابت" : r.dmg ? `إصابة ${ar(r.dmg)}٪` : "انعترضت";
      return `<button class="row link" type="button" data-op="${o.id}"><span><b>${out ? "➡️ على" : "⬅️ من"} «${out ? o.toTown : o.fromTown}»</b><small>${o.bname} · ${weaponsText(o.load)} · ${when}</small></span><b class="${o.status === "flying" ? "" : r.dmg ? (out ? "plus" : "minus") : out ? "minus" : "plus"}">${what}</b></button>`;
    }).join("")}</div>` : `<p class="hint">ما فيه عمليات للحين.</p>`;
  } else if (tab === "rels") {
    body = st.rels.length ? `<div class="rows">${st.rels.map((r) => `<button class="row link" type="button" data-rel="${r.other}"><span><b>${REL_ICONS[r.state]} «${r.town}»</b><small>العمدة ${r.owner} · ${ERAS[r.era || 0].name}${r.offer && r.offer.by !== me()?.plot ? ` · <b class="plus">${r.offer.kind === "truce" ? "يعرض هدنة" : "يعرض صلح"}</b>` : ""}</small></span><b>${REL_NAMES[r.state]}${relTimer(r)}</b></button>`).join("")}</div>`
      : `<p class="hint">ما بينك وبين أحد شي. من خريطة الجوف اضغط أي مدينة وتشوف «⚔️ العلاقات العسكرية».</p>`;
  } else if (tab === "log") {
    const notes = (st.notes || []).slice(0, 40);
    body = notes.length ? `<div class="rows">${notes.map((n) => `<div class="row ol-com"><span><small>${new Date(n.at - WARX.offset).toLocaleString("ar-SA", { weekday: "short", hour: "numeric", minute: "2-digit" })}</small></span><p>${n.text}</p></div>`).join("")}</div>` : `<p class="hint">السجل فاضي.</p>`;
  } else if (tab === "deputy") {
    const o = st.settings;
    body = `<p>وأنت طالع، النائب يتصرف بالدفاع بس: ما يعلن حرب ولا يهاجم ولا يشتري أسلحة هجومية.</p>
      <div class="rows"><label class="row toggle"><span>يصلح الأضرار العسكرية بنفسه</span><input type="checkbox" id="wdRepair" ${o.repair ? "checked" : ""}></label>
        <label class="row toggle"><span>يعبي الصواريخ الاعتراضية</span><input type="checkbox" id="wdRefill" ${o.refill ? "checked" : ""}></label>
        <div class="row"><span>أقصى صرف له باليوم</span><select id="wdBudget">${[0, 2000, 5000, 10000, 25000, 50000].map((v) => `<option value="${v}" ${o.budget === v ? "selected" : ""}>${money(v)}</option>`).join("")}</select></div></div>
      <p class="hint">يصرف من ميزانية مدينتك، وما يتعدى الحد اللي حددته.</p>`;
  }
  sheet(`<h2>⚔️ القيادة العسكرية — عالم الجوف</h2>${tabs}${body}`, "war");
  $("sheetBody").querySelectorAll("[data-wtab]").forEach((b) => b.addEventListener("click", () => { sfx.tap(); warSheet(b.dataset.wtab); }));
  $("sheetBody").querySelectorAll("[data-buy]").forEach((b) => b.addEventListener("click", async () => {
    const kind = b.dataset.buy === "intcfill" ? "intc" : b.dataset.buy, n = b.dataset.buy === "intcfill" ? caps.intc - ars.intc : 1;
    b.disabled = true;
    await warSyncNow();
    const r = await warApi("buy", { req: warReq(), kind, n });
    if (r.error) { toast(r.error, "bad"); sfx.deny(); b.disabled = false; return; }
    sfx.coin(); toast(`✓ ${r.charge.why} (−${money(r.charge.amount)} ريال)`, "goal");
    await warPoll(true);
    warSheet(tab);
  }));
  $("sheetBody").querySelectorAll("[data-op]").forEach((b) => b.addEventListener("click", () => { const o = st.ops.find((x) => x.id === b.dataset.op); if (o) opReport(o); }));
  $("sheetBody").querySelectorAll("[data-rel]").forEach((b) => b.addEventListener("click", () => relSheet(Number(b.dataset.rel))));
  const setDeputy = async () => { const r = await warApi("settings", { repair: $("wdRepair").checked, refill: $("wdRefill").checked, budget: Number($("wdBudget").value) }); if (r.error) toast(r.error, "bad"); else { WARX.st.settings = r.settings; toast("✓ حفظنا أوامر النائب", "goal"); } };
  for (const k of ["wdRepair", "wdRefill", "wdBudget"]) $(k)?.addEventListener("change", setDeputy);
}
const weaponsText = (load) => Object.entries(load || {}).map(([w, n]) => `${n > 1 ? `${ar(n)}× ` : ""}${WEAPONS[w].name}`).join(" + ");
function relTimer(r) {
  const now = warNow();
  if (r.state === "warning") return ` · تبدأ بعد ${fmtLeft(r.warStart - now)}`;
  if (r.state === "war") return ` · تخلص بعد ${fmtLeft(r.warEnd - now)}`;
  if (r.state === "truce") return ` · باقي ${fmtLeft(r.truceEnd - now)}`;
  return "";
}

// ---------- relations with one town ----------
async function relSheet(plot) {
  const st = await warPoll(true) || WARX.st;
  let r = st?.rels.find((x) => x.other === plot);
  let info = r ? { town: r.town, owner: r.owner, era: r.era } : null;
  if (!info) { try { const d = await api(`/world/town/${plot}`); info = { town: d.town.town, owner: d.town.owner, era: d.town.era }; } catch { toast("ما لقيت المدينة", "bad"); return; } }
  r ||= { state: "peace", hist: [] };
  const mine = me()?.plot, home = visiting ? visiting.home : S;
  const block = (home.era || 0) < WAR.minEra ? `مدينتك لازم تصير ${ERAS[WAR.minEra].name} أول` : (info.era || 0) < WAR.minEra ? "القرى محمية من الحروب" : (home.era || 0) - (info.era || 0) >= WAR.bully ? "مدينتك أكبر منها بكثير: ما يصير تتعدى على الصغار" : "";
  const acts = relActions(r.state === "peace" && !r.hist?.length ? null : { ...r, a: Math.min(mine, plot), b: Math.max(mine, plot) }, mine, warNow(), block);
  const btn = (act, label, cls = "") => `<button class="btn block ${cls}" type="button" data-act="${act}" ${acts[act] ? `data-why="${acts[act]}"` : ""} ${acts[act] ? "aria-disabled=true" : ""}>${label}${acts[act] ? `<small>${acts[act]}</small>` : ""}</button>`;
  sheet(`<h2>⚔️ العلاقات العسكرية</h2>
    <div class="rg-card"><div class="rg-top"><b>${REL_ICONS[r.state]} «${info.town}»</b><small>العمدة ${info.owner} · ${ERAS[info.era || 0].name}</small></div>
      <div class="rows">${row("الحالة", `${REL_NAMES[r.state]}${relTimer(r)}`)}${r.offer ? row("عرض", `${r.offer.kind === "truce" ? "هدنة" : "صلح"} من ${r.offer.by === mine ? "عندك" : `«${info.town}»`}`) : ""}</div></div>
    <div class="war-acts keep">
      ${r.offer && r.offer.by !== mine ? `${btn("accept", r.offer.kind === "truce" ? "🏳️ اقبل الهدنة" : "🤝 اقبل الصلح", "go")}${btn("reject", "✋ ارفض")}` : ""}
      ${btn("threat", "😠 أرسل تهديد")}${btn("hostile", "⚔️ إعلان عداوة")}${btn("war", "🔥 إعلان حرب", "danger")}${btn("truce", "🏳️ اعرض هدنة")}${btn("peace", "🤝 اقترح صلح")}
      ${r.state === "war" ? `<button class="btn go block" type="button" id="relTarget">🎯 استهداف المدينة</button>` : ""}
    </div>
    <h3>تاريخ النزاع</h3>
    ${r.hist?.length ? `<div class="rows">${r.hist.slice().reverse().map((h) => `<div class="row"><span>${h.by === mine ? "أنت" : `«${info.town}»`}: ${h.text}</span><b><small>${new Date(h.at - (WARX.offset || 0)).toLocaleDateString("ar-SA", { month: "short", day: "numeric" })}</small></b></div>`).join("")}</div>` : `<p class="hint">ما بينكم شي للحين.</p>`}
    <p class="hint">العداوة لازم تمضي ${minutesText(WAR.T.hostileToWar)} قبل إعلان الحرب، وبعد الإعلان فيه إنذار ${minutesText(WAR.T.warning)}، والحرب تدوم ${minutesText(WAR.T.war)}.</p>`, "war-rel");
  $("relTarget")?.addEventListener("click", () => startTargeting(plot));
  $("sheetBody").querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async () => {
    if (b.dataset.why) { toast(b.dataset.why, "bad"); sfx.deny(); return; }
    const act = b.dataset.act;
    if (act === "threat") { threatSheet(plot, info); return; }
    if ((act === "war" || act === "hostile") && !b.dataset.sure) { b.dataset.sure = "1"; b.querySelector("small")?.remove(); b.insertAdjacentHTML("beforeend", "<small>متأكد؟ اضغط مرة ثانية</small>"); return; }
    const res = await warApi("rel", { req: warReq(), other: plot, act });
    if (res.error) { toast(res.error, "bad"); sfx.deny(); return; }
    (act === "war" ? warSfx.alarm : sfx.goal)();
    await warPoll(true);
    relSheet(plot);
  }));
}
function threatSheet(plot, info) {
  sheet(`<h2>😠 تهديد لـ«${info.town}»</h2><p>اختر الرسالة (تنرسل باسم مدينتك):</p>
    <div class="rows keep">${THREATS.map((t, i) => `<button class="row link" type="button" data-threat="${i}"><span>${t}</span><b>←</b></button>`).join("")}</div>`, "war-rel");
  $("sheetBody").querySelectorAll("[data-threat]").forEach((b) => b.addEventListener("click", async () => {
    const res = await warApi("rel", { req: warReq(), other: plot, act: "threat", text: Number(b.dataset.threat) });
    if (res.error) { toast(res.error, "bad"); return; }
    toast("وصل التهديد 😠", ""); relSheet(plot);
  }));
}

// ---------- choosing a target inside the enemy town ----------
async function startTargeting(plot) {
  const st = WARX.st || await warPoll(true);
  const r = st?.rels.find((x) => x.other === plot);
  if (!r || r.state !== "war") { toast(r?.state === "warning" ? `الحرب تبدأ بعد ${fmtLeft(r.warStart - warNow())}` : "لازم تكون بينكم حرب", "bad"); return; }
  if (!(visiting ? visiting.home : S).tiles.some((t) => t.b?.id === "milhq")) { toast("تحتاج مركز القيادة العسكرية", "bad"); return; }
  await visitTown(plot, { target: true });
  if (!visiting) return;
  const list = [];
  S.tiles.forEach((t, i) => { if (t.b && !(t.b.build > 0) && canTarget(t.b.id)) list.push({ x: i % N, y: Math.floor(i / N), id: t.b.id }); });
  WARX.targeting = { plot, town: visiting.info.name, owner: visiting.info.mayor, era: visiting.info.era, list, sel: null };
  document.body.classList.add("targeting");
  world.fx.showTargets(list, null);
  targetBar();
  toast(list.length ? "🎯 اختر المبنى اللي تبي تستهدفه" : "ما فيه منشآت تنضرب بهالمدينة", list.length ? "" : "bad");
}
function targetBar() {
  const tg = WARX.targeting, bar = $("targetBar");
  if (!tg) { bar.hidden = true; return; }
  bar.hidden = false;
  const sel = tg.sel, b = sel && S.tiles[idx(sel.x, sel.y)].b;
  bar.innerHTML = sel && b ? `<div class="tb-info"><b>🎯 ${levelName(b)}</b><small>${ERAS[0] && ""}المستوى ${ar((b.lvl || 0) + 1)} · ${damageState(b.wd).name}${b.wd ? ` ${ar(Math.round(b.wd))}٪` : ""}</small><small>لو انضرب: ${TARGETS[b.id]}</small></div>
      <button class="btn go" type="button" id="tbGo">تجهيز العملية</button><button class="btn" type="button" id="tbX">✕</button>`
    : `<div class="tb-info"><b>🎯 استهداف «${tg.town}»</b><small>اضغط على منشأة عليها دائرة. البيوت والمساجد والمدارس والمستوصفات محمية.</small></div><button class="btn" type="button" id="tbX">✕ رجوع</button>`;
  $("tbGo")?.addEventListener("click", () => strikeSheet());
  $("tbX").addEventListener("click", () => { sfx.tap(); if (tg.sel) { tg.sel = null; world.fx.showTargets(tg.list, null); targetBar(); } else stopTargeting(); });
}
function stopTargeting() {
  WARX.targeting = null;
  document.body.classList.remove("targeting");
  world.fx?.showTargets(null);
  $("targetBar").hidden = true;
  if (visiting) leaveVisit();
}
/** A tap while targeting: only real buildings that may be hit. */
function targetTap(x, y) {
  const tg = WARX.targeting, b = S.tiles[idx(x, y)]?.b;
  if (!b) { toast("اختر مبنى، مو أرض فاضية", "bad"); return; }
  if (!canTarget(b.id)) { toast(`${levelName(b)}: مبنى مدني محمي، ما يصير تستهدفه`, "bad"); sfx.deny(); return; }
  if (b.build > 0) { toast("المبنى تحت الإنشاء", "bad"); return; }
  sfx.tap();
  tg.sel = { x, y };
  world.fx.showTargets(tg.list, tg.sel);
  targetBar();
}
async function strikeSheet() {
  const tg = WARX.targeting;
  if (!tg?.sel) return;
  const st = await warPoll(true), b = S.tiles[idx(tg.sel.x, tg.sel.y)].b, home = visiting.home;
  const ev = await warApi("enemy", { plot: tg.plot });
  const p = st.profile, ars = st.arsenal, now = warNow();
  const load = WARX.load ||= {};
  const avail = (w) => (weaponBlocker(p, w) ? 0 : ars[w]);
  for (const w of WEAPON_IDS) load[w] = Math.min(load[w] || 0, avail(w));
  if (!WEAPON_IDS.some((w) => load[w])) { const first = WEAPON_IDS.find((w) => avail(w) > 0); if (first) load[first] = 1; }
  const draw = () => {
    const fee = WEAPON_IDS.reduce((n, w) => n + WEAPONS[w].fee * (load[w] || 0), 0), value = WEAPON_IDS.reduce((n, w) => n + WEAPONS[w].price * (load[w] || 0), 0);
    const lo = Math.min(WAR.caps.perOp, WEAPON_IDS.reduce((n, w) => n + Math.round(WEAPONS[w].power * 0.85) * (load[w] || 0), 0));
    const hi = Math.min(WAR.caps.perOp, WEAPON_IDS.reduce((n, w) => n + Math.round(WEAPONS[w].power * 1.15) * (load[w] || 0), 0));
    const eta = WEAPON_IDS.filter((w) => load[w]).reduce((n, w) => Math.max(n, flightMs(me().plot, tg.plot, w)), 0);
    const padReady = (k, list) => list.map((it) => { const at = st.reload[`${k}${it.x}:${it.y}`] || 0; return at > now ? `تتجهز (${secLeft(at - now)})` : it.wd >= 85 ? "متعطلة" : "جاهزة ✓"; });
    sheet(`<h2>🎯 تجهيز عملية عسكرية</h2>
      <div class="rows">${row("المدينة المستهدفة", `«${tg.town}» · العمدة ${tg.owner}`)}${row("الهدف", `${levelName(b)} ${stateTag(b.wd)}`)}${row("لو أصاب", TARGETS[b.id])}
        ${row("دفاع الخصم", ev.view?.known ? (ev.view.airdefs ? `${ar(ev.view.airdefs)} بطارية · أقوى مستوى ${ar(ev.view.bestAirdef)}${ev.view.radar ? " · عنده رادار" : ""}` : "ما عنده دفاع جوي 👀") : "غير معروف (تحتاج رادار)")}</div>
      <h3>الأسلحة</h3><div class="rows">${WEAPON_IDS.map((w) => { const why = weaponBlocker(p, w); return `<div class="war-arm ${why || !ars[w] ? "locked" : ""}"><b class="ic">${WEAPONS[w].icon}</b><span><b>${WEAPONS[w].name}</b><small>${why || `عندك ${ar(ars[w])}`}</small></span>
        ${why || !ars[w] ? "" : `<span class="step"><button type="button" data-dec="${w}">−</button><b>${ar(load[w] || 0)}</b><button type="button" data-inc="${w}">+</button></span>`}</div>`; }).join("")}</div>
      <div class="rows">${row("تكلفة التشغيل", `${money(fee)} ريال`, "minus")}${row("قيمة الذخائر", `${money(value)} ريال`)}${row("الضرر المحتمل", hi ? `${ar(lo)}٪ – ${ar(hi)}٪ (إذا ما انعترض)` : "—")}${row("وقت الوصول", eta ? `تقريبًا ${secLeft(eta)}` : "—")}
        ${p.pads.length ? row("المنصات", padReady("p", p.pads).join(" · ")) : ""}${p.bases.length ? row("قواعد المسيّرات", padReady("b", p.bases).join(" · ")) : ""}</div>
      ${!WEAPON_IDS.some((w) => ars[w]) ? `<div class="need">💡 ما عندك أسلحة: اشترِ من «القيادة العسكرية ← الترسانة».</div>` : ""}
      <div class="sheet-actions keep"><button class="btn go block" type="button" id="stGo" ${fee ? "" : "disabled"}>🚀 إطلاق العملية</button><button class="btn block" type="button" id="stArms">🛒 الترسانة</button></div>`, "war-strike");
    $("sheetBody").querySelectorAll("[data-inc]").forEach((x) => x.addEventListener("click", () => { const w = x.dataset.inc; load[w] = Math.min(avail(w), (load[w] || 0) + 1); sfx.tap(); draw(); }));
    $("sheetBody").querySelectorAll("[data-dec]").forEach((x) => x.addEventListener("click", () => { const w = x.dataset.dec; load[w] = Math.max(0, (load[w] || 0) - 1); sfx.tap(); draw(); }));
    $("stArms").addEventListener("click", () => warSheet("arms"));
    $("stGo").addEventListener("click", async () => {
      $("stGo").disabled = true;
      const opId = `op${warReq()}`;
      let res = await warApi("launch", { op: opId, to: tg.plot, x: tg.sel.x, y: tg.sel.y, load });
      if (res.error === "ما قدرت أوصل للسيرفر: جرّب بعد شوي") { await new Promise((r) => setTimeout(r, 1500)); res = await warApi("launch", { op: opId, to: tg.plot, x: tg.sel.x, y: tg.sel.y, load }); } // the same id: never twice
      if (res.error) { toast(res.error, "bad"); sfx.deny(); $("stGo").disabled = false; return; }
      closeSheet();
      WARX.load = {};
      stopTargeting();
      await warPoll(true);
      warOpScene(res.op, true);
    });
    void home;
  };
  draw();
}

// ---------- the scenes ----------
function sceneUi(on) {
  const ui = $("warScene");
  ui.hidden = !on;
  document.body.classList.toggle("war-scene", !!on);
  if (!on) { $("warBanner").hidden = true; $("warMap").hidden = true; }
}
function banner(text, cls = "") {
  const b = $("warBanner");
  b.textContent = text; b.className = `war-banner ${cls}`; b.hidden = false;
  clearTimeout(banner.t); banner.t = setTimeout(() => { b.hidden = true; }, 2600);
}
const fxSfx = () => ({ prep: () => warSfx.prep(), launch: () => warSfx.launch(), drone: () => warSfx.drone(), whoosh: () => warSfx.whoosh(), intercept: () => warSfx.intercept(), airBurst: () => warSfx.airBurst(), boom: () => warSfx.boom(), alarm: () => warSfx.alarm() });
/** Where the attack comes from, as a direction on the ground of the target town. */
function dirFrom(from, to) { const [ax, ay] = worldXY(from), [bx, by] = worldXY(to); const d = Math.hypot(ax - bx, ay - by) || 1; return { x: (ax - bx) / d, z: (ay - by) / d }; }
/** The al-Jouf map with the operation's path and a moving marker, until it arrives (or is skipped). */
function mapFlight(op, quick) {
  return new Promise((resolve) => {
    const box = $("warMap");
    box.hidden = false;
    const { cols, rows } = WORLD, cell = 5, [ax, ay] = worldXY(op.from), [bx, by] = worldXY(op.to);
    const P = (x, y) => [x * cell + cell / 2, y * cell + cell / 2];
    const [x1, y1] = P(ax, ay), [x2, y2] = P(bx, by), mx = (x1 + x2) / 2, my = Math.min(y1, y2) - Math.hypot(x2 - x1, y2 - y1) * 0.25;
    const missile = Object.keys(op.load).some((w) => WEAPONS[w].kind === "missile");
    const pad = 22, vx = Math.max(0, Math.min(x1, x2) - pad), vy = Math.max(0, Math.min(y1, y2, my) - pad), vw = Math.min(cols * cell, Math.abs(x2 - x1) + pad * 2), vh = Math.min(rows * cell, Math.abs(Math.max(y1, y2) - Math.min(y1, y2, my)) + pad * 2);
    const labels = WORLD.places.map((p) => `<text x="${p.x * cell + cell / 2}" y="${p.y * cell + cell / 2}" class="wm-place">${p.name}</text>`).join("");
    box.innerHTML = `<div class="wf-head"><b>${missile ? "🚀" : "🛩️"} ${weaponsText(op.load)}</b><small>من «${op.fromTown}» إلى «${op.toTown}» · الهدف: ${op.bname}</small></div>
      <svg viewBox="${vx} ${vy} ${Math.max(vw, 60)} ${Math.max(vh, 40)}" class="wf-map"><rect x="0" y="0" width="${cols * cell}" height="${rows * cell}" fill="#e6cf9c"/>${labels}
        <path d="M${x1},${y1} Q${mx},${my} ${x2},${y2}" class="wf-path ${missile ? "fast" : ""}"/>
        <circle cx="${x1}" cy="${y1}" r="2.4" class="wf-from"/><circle cx="${x2}" cy="${y2}" r="2.6" class="wf-to"/><circle cx="${x2}" cy="${y2}" r="5" class="wf-ping"/>
        <text x="${x1}" y="${y1 - 4}" class="wf-name">${op.fromTown}</text><text x="${x2}" y="${y2 - 5}" class="wf-name">${op.toTown}</text>
        <g id="wfDot"><circle r="2.2" class="wf-dot ${missile ? "fast" : ""}"/></g></svg>
      <div class="wf-foot"><span id="wfLeft"></span></div>`;
    const dot = $("wfDot"), left = $("wfLeft");
    const t0 = op.launchAt, t1 = op.arriveAt, start = performance.now();
    const quickMs = 3200;
    const tick = () => {
      if (WARX.skipFlight) { WARX.skipFlight = false; box.hidden = true; resolve(false); return; }
      const k = quick ? Math.min(1, (performance.now() - start) / quickMs) : Math.max(0, Math.min(1, (warNow() - t0) / Math.max(1, t1 - t0)));
      const q = 1 - k, x = q * q * x1 + 2 * q * k * mx + k * k * x2, y = q * q * y1 + 2 * q * k * my + k * k * y2;
      dot.setAttribute("transform", `translate(${x} ${y})`);
      left.textContent = quick ? "إعادة" : k >= 1 ? "وصل… ننتظر النتيجة" : `⏳ يوصل بعد ${secLeft(t1 - warNow())}`;
      if (k >= 1) { setTimeout(() => { box.hidden = true; resolve(true); }, 400); return; }
      requestAnimationFrame(tick);
    };
    tick();
  });
}
/** Wait for the server's result (it decides at the arrival time). */
async function opResult(op) {
  for (let i = 0; i < 20; i++) {
    const r = await warApi("op", { op: op.id });
    if (r.op?.status === "done") return r.op;
    await new Promise((res) => setTimeout(res, 1500));
  }
  return null;
}
/** Look at a town for a scene (like a visit, without the visit bar). */
async function sceneTown(plot) {
  if (plot === me()?.plot) { if (visiting) leaveVisit(); return true; }
  await visitTown(plot, { scene: true });
  return !!visiting;
}
function incomingOpts(op, prof) {
  return {
    x: op.x, y: op.y, dir: dirFrom(op.from, op.to), detected: op.detected,
    weapons: op.result.hits.map((h) => ({ ...h, kind: WEAPONS[h.w].kind })),
    noAmmo: !op.result.blocked && op.result.airdef > 0 && !op.result.hits.some((h) => h.tried),
    airdefs: (prof?.airdefs || []).map((a) => ({ x: a.x, y: a.y })), radars: (prof?.radars || []).map((a) => ({ x: a.x, y: a.y })),
    banner, sfx: fxSfx(),
    onHit: (dmg) => {
      const t = S.tiles[idx(op.x, op.y)];
      if (t?.b) { t.b.wd = Math.min(100, Math.max(t.b.wd || 0, op.result.after)); world.sync(S, { buildings: true }); }
      if (dmg) floatAt(op.x, op.y, `💥 −${ar(dmg)}٪`, "down");
    }
  };
}
/** Townsfolk' view of the defending town's defence, for the scene (radars and batteries are on the map). */
function defenceOf(s) {
  const out = { airdefs: [], radars: [] };
  s.tiles.forEach((t, i) => { if (t.b?.id === "airdef" && !(t.b.build > 0)) out.airdefs.push({ x: i % N, y: Math.floor(i / N) }); if (t.b?.id === "radar" && !(t.b.build > 0)) out.radars.push({ x: i % N, y: Math.floor(i / N) }); });
  return out;
}
/** Our own operation: the launch at home, the flight on the map, then the result at the target. */
async function warOpScene(op, launch) {
  if (WARX.scene) return;
  WARX.scene = { op };
  sceneUi(true); closeSheet(); setTool(null);
  try {
    if (launch) {
      if (visiting) leaveVisit();
      const missile = Object.keys(op.load).some((w) => WEAPONS[w].kind === "missile");
      const wid = Object.keys(op.load).find((w) => WEAPONS[w].kind === (missile ? "missile" : "drone"));
      const at = (missile ? op.pads?.[0] : op.bases?.[0]) || [N / 2, N / 2];
      const d = dirFrom(op.to, op.from);
      await world.fx.playLaunch({ x: at[0], y: at[1], kind: missile ? "missile" : "drone", wid, n: op.load[wid], dir: { x: d.x, z: d.z }, sfx: fxSfx() });
      world.fx.clear();
    }
    const arrived = await mapFlight(op, !launch);
    if (!arrived) { toast("العملية مكمّلة بالجو، وتوصلك النتيجة لا وصلت", ""); return; }
    const done = op.result ? op : await opResult(op);
    if (!done) { toast("النتيجة تتأخر: تلقاها بسجل العمليات", ""); return; }
    markPlayed(done.id); WARX.watched.add(done.id);
    if (await sceneTown(done.to)) {
      if (done.result.blocked) banner({ gone: "الهدف ما عاد موجود", shield: "المدينة دخلت درع الحماية", truce: "دخلت الهدنة قبل الوصول" }[done.result.blocked], "bad");
      else await world.fx.playIncoming(incomingOpts(done, defenceOf(S)));
    }
    world.fx.clear();
    if (visiting) leaveVisit(); // back home before the report
    opReport(done, true);
  } finally {
    sceneUi(false); WARX.scene = null; world.fx.clear();
    if (visiting && !WARX.targeting) { const keep = sheetFor; leaveVisit(); if (keep === "war-report") opReport(WARX.lastReport, true); }
  }
}
/** An attack on us that just landed, played in our own town. */
async function warDefenseScene(op) {
  if (WARX.scene) return;
  WARX.scene = { op };
  markPlayed(op.id);
  sceneUi(true); closeSheet(); setTool(null);
  try {
    banner(`🚨 هجوم من «${op.fromTown}»!`, "bad");
    const t = S.tiles[idx(op.x, op.y)], rk = `${op.x}:${op.y}`, rep = world.fx.repairs.get(rk);
    world.fx.repairs.delete(rk); // the deputy's repair starts after the hit, not before
    if (t?.b && op.result.dmg) { t.b.wd = op.result.before || 0; if (!t.b.wd) delete t.b.wd; world.sync(S, { buildings: true }); } // as it stood before the hit
    if (rep) setTimeout(() => { world.fx.repairs.set(rk, rep); world.sync(S, { buildings: true }); }, 9000);
    if (!op.result.blocked) await world.fx.playIncoming(incomingOpts(op, defenceOf(S)));
    world.fx.clear();
    opReport(op, true);
  } finally { sceneUi(false); WARX.scene = null; world.fx.clear(); }
}
/** Watch an operation again from its saved data: nothing is charged or damaged again. */
async function replayOp(op) {
  if (WARX.scene || !op.result) return;
  WARX.scene = { op, replay: true };
  sceneUi(true); closeSheet();
  const homeWas = !visiting;
  try {
    await mapFlight(op, true);
    if (await sceneTown(op.to)) {
      // show the building as it was before the hit, then as it was after
      const t = S.tiles[idx(op.x, op.y)];
      const keep = t?.b?.wd;
      if (t?.b) { t.b.wd = op.result.before || 0; world.sync(S, { buildings: true }); }
      if (!op.result.blocked) await world.fx.playIncoming({ ...incomingOpts(op, defenceOf(S)), onHit: (dmg) => { if (t?.b) { t.b.wd = op.result.after; world.sync(S, { buildings: true }); } if (dmg) floatAt(op.x, op.y, `💥 −${ar(dmg)}٪`, "down"); } });
      if (t?.b) { if (keep) t.b.wd = keep; else delete t.b.wd; world.sync(S, { buildings: true }); }
    }
  } finally {
    world.fx.clear(); sceneUi(false); WARX.scene = null;
    if (homeWas && visiting) leaveVisit();
    opReport(op);
  }
}
function opReport(op, fresh) {
  WARX.lastReport = op;
  const r = op.result, out = op.side === "out" || op.from === me()?.plot;
  const when = new Date(op.launchAt - (WARX.offset || 0)).toLocaleString("ar-SA", { weekday: "long", hour: "numeric", minute: "2-digit" });
  const verdict = !r ? `بالجو · يوصل بعد ${secLeft(op.arriveAt - warNow())}` : r.blocked ? "ما أصابت" : r.dmg ? "إصابة ناجحة" : "انعترضت";
  sheet(`<h2>📋 تقرير العملية العسكرية</h2>
    <div class="rows">${row("المدينة المهاجمة", `«${op.fromTown}»`)}${row("المدينة المستهدفة", `«${op.toTown}»`)}${row("السلاح", weaponsText(op.load))}${row("الهدف", op.bname)}
      ${row("النتيجة", verdict, r ? (r.dmg ? (out ? "plus" : "minus") : out ? "minus" : "plus") : "")}
      ${r && !r.blocked ? row("الاعتراض", r.hits.filter((h) => h.tried).length ? r.hits.map((h) => `${WEAPONS[h.w].icon} ${h.intercepted ? "✅ انعترض" : h.tried ? "❌ فشل الاعتراض" : "ما انعترض"}`).join(" · ") : r.airdef ? "الدفاع الجوي بلا صواريخ اعتراضية" : "ما فيه دفاع جوي") : ""}
      ${!out && r && !r.blocked && r.airdef && !r.hits.some((h) => h.tried) ? `<div class="need">💡 بطاريتك ما ردّت لأن ما عندها صواريخ اعتراضية: اشترِ من «القيادة ← الدفاع»، أو خلّ النائب يعبيها.</div>` : ""}
      ${r?.dmg ? row("الضرر", `${ar(r.dmg)}٪ (صار ${ar(Math.round(r.after))}٪)`, out ? "plus" : "minus") : ""}
      ${r && !r.blocked ? row("الحالة", r.state) : ""}
      ${out ? row("تكلفة العملية", `${money(op.fee)} ريال تشغيل + ذخائر بقيمة ${money(op.value)}`) : r?.intcUsed ? row("ذخيرة الدفاع المستخدمة", `${ar(r.intcUsed)} صاروخ اعتراضي (${money(r.intcValue)} ريال)`) : ""}
      ${row("وقت العملية", when)}</div>
    ${!out && r?.dmg ? `<div class="need">💡 اضغط على ${op.bname} بمدينتك واختر «🔧 إصلاح الأضرار العسكرية»، أو خلّ النائب يصلحها (القيادة ← النائب).</div>` : ""}
    <div class="sheet-actions keep">${r ? `<button class="btn go block" type="button" id="opReplay">🎬 مشاهدة إعادة العملية</button>` : ""}<button class="btn block" type="button" id="opBack">${fresh ? "تمام" : "رجوع للعمليات"}</button></div>`, "war-report");
  $("opReplay")?.addEventListener("click", () => replayOp(op));
  $("opBack").addEventListener("click", () => (fresh ? closeSheet() : warSheet("ops")));
}

// ---------- war damage in the building's sheet ----------
function warDamageHtml(b) {
  if (!worldMode || !b?.wd) return "";
  const d = damageState(b.wd), rep = world.fx?.repairs.get(WARX.inspectAt);
  const cost = repairCostOf(b.id, b.wd), ms = repairMsOf(b.wd);
  let html = `<h3>💥 ضرر عسكري</h3><div class="rows">${row("الحالة", `${d.name} · ${ar(Math.round(b.wd))}٪`, "minus")}<i class="prog cond"><i style="width:${100 - b.wd}%" class="low"></i></i>
    ${row("كفاءة المبنى الحين", `${ar(Math.round(warFactor(b.wd) * 100))}٪`, "minus")}${TARGETS[b.id] ? row("الأثر", TARGETS[b.id]) : ""}</div>`;
  if (visiting) return html;
  if (rep) html += `<div class="need ok">🔧 يتصلح الحين: يخلص بعد ${fmtLeft(rep.end - warNow())}</div>`;
  else html += `<div class="sheet-actions"><button class="btn go block" id="warRepair" type="button" ${S.money < cost ? "disabled" : ""}>🔧 إصلاح الأضرار العسكرية (${money(cost)} ريال)</button></div>
    <p class="hint">يستغرق ${fmtLeft(ms)}، ويرجّع كفاءة المبنى ١٠٠٪ تدريجيًا. ما يحتاج مواد بناء.</p>`;
  return html;
}
async function warRepairAt(x, y) {
  const r = await warApi("repair", { req: warReq(), x, y });
  if (r.error) { toast(r.error, "bad"); sfx.deny(); return; }
  sfx.build(); toast(`🔧 بدأ الإصلاح (${money(r.charge?.amount || 0)} ريال)`, "goal");
  await warPoll(true);
  inspect(x, y);
}
/** The levels of a military building and what they do, for its sheet. */
function milHtml(b) {
  if (!MIL[b.id]) return "";
  const st = milStat(b.id, b.lvl), lines = [];
  if (st.ops) lines.push(row("عمليات بالجو بنفس الوقت", ar(st.ops)));
  if (st.cap && b.id === "dronebase") lines.push(row("سعة المسيّرات", ar(st.cap)), row("مسيّرات بالعملية", ar(st.salvo)), row("وقت التجهيز", `${ar(st.reload)} دقايق`));
  if (st.cap && b.id === "missilepad") lines.push(row("صواريخ عليها", ar(st.cap)), row("وقت التجهيز", `${ar(st.reload)} دقايق`));
  if (st.detect) lines.push(row("يرفع دقة الدفاع", `×${ar(st.detect)}`));
  if (st.vsDrone) lines.push(row("ضد المسيّرات", `${ar(Math.round(st.vsDrone * 100))}٪`), row("ضد الصواريخ", `${ar(Math.round(st.vsMissile * 100))}٪`), row("صواريخ اعتراضية", ar(st.intc)));
  if (st.store) lines.push(row("يزيد التخزين", "٥٠٪"));
  return lines.join("");
}

/** Back in the world town: what happened in the war while you were away (from the server's notes). */
async function warBack(reportOpen) {
  WARX.st = null; WARX.watched.clear();
  const before = warSeen();
  WARX.quietNotes = true;
  const st = await warPoll(true);
  WARX.quietNotes = false;
  const fresh = (st?.notes || []).filter((n) => n.at > before);
  if (!fresh.length || !before) return;
  const show = () => sheet(`<h2>🎖️ أحداث عسكرية وأنت غايب</h2><div class="rows">${fresh.slice(0, 15).map((n) => `<div class="row ol-com"><p>${n.text}</p></div>`).join("")}</div>
    <div class="sheet-actions keep"><button class="btn go block" type="button" id="wbOps">📋 العمليات والإعادة</button><button class="btn block" type="button" id="wbOk">تمام</button></div>`, "war-back");
  const open = () => { show(); $("wbOps").addEventListener("click", () => warSheet("ops")); $("wbOk").addEventListener("click", closeSheet); };
  if (reportOpen) { const wait = setInterval(() => { if (sheetFor !== "deputyReport" && $("sheet").hidden) { clearInterval(wait); open(); } }, 800); } else open();
}
// ---------- the public chat of al-Jouf (world only; it never shows who is online) ----------
const CHAT = { msgs: [], last: 0, polled: 0, busy: false };
const chatSeen = () => Number(store.get("rafaya-chat-seen") || 0);
async function chatPoll(force) {
  if (!worldMode || CHAT.busy || (!force && Date.now() - CHAT.polled < (LIVE.ok ? 120000 : sheetFor === "chat" ? 4000 : 20000))) return; // live: messages arrive by themselves
  CHAT.busy = true; CHAT.polled = Date.now();
  try {
    const r = await api(`/world/chat${CHAT.last ? `?after=${CHAT.last}` : ""}`);
    if (r.messages?.length) {
      CHAT.msgs = [...CHAT.msgs, ...r.messages].slice(-120);
      CHAT.last = CHAT.msgs[CHAT.msgs.length - 1].id;
      if (sheetFor === "chat") chatSheet(true);
    }
  } catch { /* the next time */ }
  CHAT.busy = false;
  chatCount();
}
function chatCount() {
  const mine = me()?.name, n = CHAT.msgs.filter((m) => m.id > chatSeen() && m.name !== mine).length;
  $("chatCount").hidden = !n || sheetFor === "chat";
  $("chatCount").textContent = ar(Math.min(n, 9)) + (n > 9 ? "+" : "");
}
function chatSheet(keep, draft = $("chatText")?.value || "") {
  const id = me(), box = $("chatList"), stick = !keep || !box || box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
  const when = (at) => { const d = new Date(at), today = new Date().toDateString() === d.toDateString(); return d.toLocaleString("ar-SA", today ? { hour: "numeric", minute: "2-digit" } : { weekday: "short", hour: "numeric", minute: "2-digit" }); };
  sheet(`<h2>💬 شات الجوف</h2>
    <div class="chat-list" id="chatList">${CHAT.msgs.length ? CHAT.msgs.map((m) => `<div class="chat-msg ${m.name === id?.name ? "mine" : ""}">
        <div class="chat-head"><b>${m.name}</b>${m.town ? `<button type="button" class="chat-town" data-town="${m.plot}">${m.town}</button>` : ""}<small>${when(m.at)}</small>${m.name !== id?.name ? `<button type="button" class="chat-rep" data-rep="${m.id}" aria-label="بلّغ">🚩</button>` : ""}</div>
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
function developerNoteSheet(id, chatDraft) {
  sheet(`<h2>ملاحظة خاصة للمطور</h2>
    <p>المطور يشوف ملاحظتك واسمك في اللعبة. الملاحظة تبقى خاصة وما تظهر في الشات العام.</p>
    <form id="developerNoteForm">
      <label for="developerNoteText">ملاحظتك</label>
      <textarea id="developerNoteText" maxlength="600" required placeholder="اكتب اقتراحك أو وصف المشكلة"></textarea>
      <div class="sheet-actions keep">
        <button class="btn go block" id="developerNoteSend" type="submit">إرسال للمطور فقط</button>
        <button class="btn block" id="developerNoteBack" type="button">رجوع للشات</button>
      </div>
    </form>`, "developer-note");
  const form = $("developerNoteForm");
  $("developerNoteBack").addEventListener("click", () => chatSheet(false, chatDraft));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = $("developerNoteText").value.trim(), send = $("developerNoteSend");
    if (send.disabled) return;
    if (!text) { toast("اكتب ملاحظتك أول", "bad"); return; }
    send.disabled = true;
    let result;
    try {
      result = await api("/world/feedback", { name: id.name, secret: id.secret, text });
    } catch (error) {
      result = { error: error.message === "maintenance" ? "عالم الجوف تحت الصيانة" : "ما وصلت الملاحظة، جرّب مرة ثانية" };
    } finally {
      send.disabled = false;
    }
    if (!result.ok) {
      toast(result.error || "ما وصلت الملاحظة، جرّب مرة ثانية", "bad");
      sfx.deny();
      return;
    }
    toast("وصلت ملاحظتك للمطور", "goal");
    sfx.tap();
    if (sheetFor === "developer-note" && form.isConnected) chatSheet(false, chatDraft);
  });
}
$("chatBtn").addEventListener("click", async () => { sfx.tap(); chatSheet(); await chatPoll(true); });

/** The military part of another town's card on the al-Jouf map. */
function warCardHtml(plot) {
  if (!worldMode) return "";
  const r = WARX.st?.rels.find((x) => x.other === plot), state = r?.state || "peace";
  const home = visiting ? visiting.home : S;
  const why = !home.tiles.some((t) => t.b?.id === "milhq") ? "تحتاج مركز القيادة العسكرية" : state === "warning" ? `الحرب تبدأ بعد ${fmtLeft(r.warStart - warNow())}` : state !== "war" ? (state === "truce" ? "فيه هدنة" : "لازم تكون بينكم حرب: من العلاقات العسكرية") : "";
  return `<div class="row"><span>العلاقة</span><b>${REL_ICONS[state]} ${REL_NAMES[state]}${r ? relTimer(r) : ""}</b></div>
    <button class="btn block" id="wmRel" type="button">⚔️ العلاقات العسكرية</button>
    <button class="btn ${why ? "" : "danger"} block" id="wmTarget" type="button" ${why ? `data-why="${why}"` : ""}>🎯 استهداف المدينة${why ? `<small>${why}</small>` : ""}</button>`;
}
/** Back to the menu (or the solo game) from the world. */
function leaveWorld() {
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
const linked = (a, b) => RG.roads.some(([p, q]) => (p === a && q === b) || (p === b && q === a));
// (towns founded before the region had its real names keep a place on the map)
const siteOf = (id) => SITES.find((x) => x.id === id) || { id, x: 50, y: 86, terrain: RG.towns[id]?.terrain || "plain", name: RG.towns[id]?.name || "" };
const regionOpen = () => (RG.towns.main?.era ?? (S.site === "main" ? S.era : 0)) >= REGION.unlockEra;
/** What linked towns this town trades with (their people shop and their traders buy here). */
function noteNeighbours() {
  const here = S.site || "main";
  S.neighbours = Object.keys(RG.towns).filter((id) => id !== here && linked(here, id)).map((id) => ({ id, name: RG.towns[id].name, pop: RG.towns[id].pop }));
}
function regionSheet(pick) {
  noteTown();
  const here = S.site || "main", towns = RG.towns, ids = Object.keys(towns);
  const totalPop = ids.reduce((n, id) => n + (towns[id].pop || 0), 0), totalMoney = ids.reduce((n, id) => n + (towns[id].money || 0), 0);
  const title = ids.length >= 3 ? "أمير المنطقة" : "عمدة الرافعية";
  const sel = pick || here, site = siteOf(sel), t = towns[sel];
  const founded = ids.length - 1, price = REGION.found[Math.min(founded, REGION.found.length - 1)];
  const roads = RG.roads.map(([p, q]) => { const a = siteOf(p), b = siteOf(q); return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="rg-road"/>`; }).join("");
  const dots = [...SITES, ...Object.keys(towns).filter((id) => !SITES.some((x) => x.id === id)).map(siteOf)].map((x) => {
    const tt = towns[x.id], cur = x.id === here, on = x.id === sel;
    const rad = tt ? 3.2 + Math.min(4, Math.log10((tt.pop || 1) + 1) * 1.3) : 3;
    return `<g class="rg-site ${tt ? "town" : "free"} ${cur ? "cur" : ""} ${on ? "on" : ""}" data-site="${x.id}" transform="translate(${x.x} ${x.y})">
      <circle r="${rad}"/>${tt ? "" : `<text class="plus" y="1.3">+</text>`}
      <text class="lbl" y="${-rad - 1.6}">${tt ? tt.name : x.name}</text>${tt ? `<text class="pop" y="${rad + 3.4}">${ar((tt.pop || 0).toLocaleString("en-US"))}</text>` : ""}</g>`;
  }).join("");
  let detail;
  if (t) {
    detail = `<div class="rg-card"><div class="rg-top"><b>${t.name}</b><small>${ERAS[t.era || 0].name} · ${TERRAINS[t.terrain]?.name || ""}</small></div>
      <div class="rows">${row("السكان", money(t.pop || 0))}${row("الميزانية", `${money(t.money || 0)} ريال`, (t.money || 0) < 0 ? "minus" : "")}${row("الدخل بالساعة", `${(t.net || 0) >= 0 ? "+" : "−"}${money(Math.abs(t.net || 0))}`, (t.net || 0) >= 0 ? "plus" : "minus")}</div>
      ${sel === here ? `<p class="hint">أنت فيها الحين.</p>` : `<div class="sheet-actions"><button class="btn go block" id="rgEnter" type="button">ادخل ${t.name}</button></div>
        ${linked(here, sel) ? `<p class="hint">🛣️ موصولة بطريق: يتسوقون ويتاجرون مع بعض.</p><div class="rg-send"><span>حوّل لها من ميزانيتك:</span>${[1000, 5000, 20000].map((v) => `<button class="btn" type="button" data-send="${v}" ${S.money < v ? "disabled" : ""}>${money(v)}</button>`).join("")}</div>`
          : `<div class="sheet-actions"><button class="btn block" id="rgRoad" type="button" ${S.money < roadCost(here, sel) ? "disabled" : ""}>🛣️ وصّل طريق من ${S.name} بـ${money(roadCost(here, sel))} ريال</button></div><p class="hint">المدن الموصولة بطريق يتسوق ناسها عند بعض، والتجار يشترون من ورشهم.</p>`}`}</div>`;
  } else {
    detail = `<div class="rg-card"><div class="rg-top"><b>${site.name}</b><small>أرض ${TERRAINS[site.terrain].name}</small></div><p>${TERRAINS[site.terrain].text}</p>
      ${regionOpen() ? `<input id="rgName" type="hidden" value="${site.name}">
        <div class="sheet-actions"><button class="btn go block" id="rgFound" type="button" ${S.money < price ? "disabled" : ""}>أسس ${site.name} بـ${money(price)} ريال</button></div>
        <p class="hint">تندفع من ميزانية ${S.name}، و${site.name} تبدأ بثلاث خيام و${money(REGION.startMoney)} ريال. المدن اللي ما أنت فيها توقف لين ترجع لها.</p>`
        : `<div class="need">تنفتح لما تصير الرافعية ${ERAS[REGION.unlockEra].name} (${money(ERAS[REGION.unlockEra].pop)} ساكن).</div>`}</div>`;
  }
  sheet(`<h2>🗺️ منطقة الرافعية</h2><p>لقبك: <b>${title}</b> · ${ar(ids.length)} ${ids.length === 1 ? "مدينة" : "مدن"} · ${money(totalPop)} ساكن · ${money(totalMoney)} ريال</p>
    <svg class="rg-map" viewBox="0 0 100 100" role="img" aria-label="خريطة المنطقة"><defs><radialGradient id="rgSand" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#f1d9a6"/><stop offset="1" stop-color="#d9b47a"/></radialGradient></defs>
      <rect width="100" height="100" rx="6" fill="url(#rgSand)"/>
      <path d="M0 52 C 20 46, 35 60, 50 54 S 80 44, 100 50" class="rg-wadi"/>
      <path d="M6 12 l6 -6 l6 6 z M12 30 l5 -5 l5 5 z M24 16 l4 -4 l4 4 z" class="rg-hill"/>
      <path d="M68 10 q 6 -4 12 0 q 6 4 12 0 M70 30 q 6 -4 12 0" class="rg-dune"/>
      ${roads}${dots}</svg>
    ${detail}`, "region");
  $("sheetBody").querySelectorAll("[data-site]").forEach((g) => g.addEventListener("click", () => { sfx.tap(); regionSheet(g.dataset.site); }));
  $("rgEnter")?.addEventListener("click", () => switchTown(sel));
  $("rgRoad")?.addEventListener("click", () => {
    const c = roadCost(here, sel);
    if (S.money < c) { toast("ما يكفي المال", "bad"); sfx.deny(); return; }
    changeMoney(S, -c, "build", "ربط المدن بطريق"); RG.roads.push([here, sel]); noteNeighbours(); save(); sfx.build(); toast(`انفتح الطريق بين ${S.name} و${t.name} 🛣️`, "goal"); refresh(); regionSheet(sel);
  });
  $("sheetBody").querySelectorAll("[data-send]").forEach((b) => b.addEventListener("click", () => {
    const v = Number(b.dataset.send);
    if (S.money < v) return;
    const raw = store.get(townKey(sel));
    if (!raw) return;
    const other = unpack(raw);
    changeMoney(other, v, "transfer", S.name);
    changeMoney(S, -v, "transfer", other.name);
    store.set(townKey(sel), pack(other));
    RG.towns[sel].money = Math.round(other.money);
    save(); refresh(); sfx.coin(); toast(`حوّلت ${money(v)} ريال لـ${t.name}`, "goal"); regionSheet(sel);
  }));
  $("rgFound")?.addEventListener("click", () => {
    if (S.money < price) { toast("ما يكفي المال", "bad"); sfx.deny(); return; }
    const name = ($("rgName").value || site.name).trim().slice(0, 20);
    changeMoney(S, -price, "land", site.name); save();
    const town = newGame(Math.floor(Math.random() * 1e9), { terrain: site.terrain, name, site: site.id, money: REGION.startMoney });
    store.set(townKey(site.id), pack(town));
    RG.towns[site.id] = { name, terrain: site.terrain, pop: town.pop, era: 0, money: town.money, net: 0 };
    saveRegion();
    sfx.era(); toast(`تأسست «${name}»! 🎉`, "era");
    switchTown(site.id);
  });
}
const roadCost = (a, b) => { const p = siteOf(a), q = siteOf(b); return Math.round(Math.hypot(p.x - q.x, p.y - q.y) * REGION.roadPerUnit); };
/** Leave this town (it waits as it is) and open another. */
function switchTown(id) {
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

/** The result of the yearly election. */
function electionSheet(m) {
  const pct = Math.round(m.share * 100);
  sfx[m.won ? "era" : "event"]();
  sheet(`<h2>🗳️ نتيجة انتخابات المجلس البلدي</h2>
    <div class="vote"><b class="${m.won ? "plus" : "minus"}">${ar(pct)}٪</b><span>من أصوات أهل الرافعية</span></div>
    <i class="prog"><i style="width:${pct}%"></i></i>
    <p>${m.won ? `مبروك! الأهالي جددوا ثقتهم فيك سنة ثانية. المحافظة صرفت لك دعم <b>${money(m.grant)} ريال</b>، والناس فرحانين يومين.` : `خسرت هالمرة. المحافظة بترسل مراقب، ورسومها السنة الجاية بتكون الضعف (${money(PROVINCE_FEES[S.era] * 2)} ريال). شد حيلك ووفّ بوعودك عشان ترجع ثقة الناس.`}</p>
    <div class="rows">${row("وعود وفيت فيها", ar(m.record.kept || 0), "plus")}${row("وعود ما وفيت فيها", ar(m.record.broken || 0), m.record.broken ? "minus" : "")}${row("رضا الناس", `${ar(Math.round(S.happy))}٪`)}${row("ثقة الناس فيك", `${ar(Math.round(S.trust ?? 60))}٪`)}</div>
    <div class="sheet-actions"><button class="btn go block" id="electOk" type="button">تمام</button></div>`, "election");
  $("electOk").addEventListener("click", closeSheet);
}

// ---------- what is new in this version ----------
// What changed, per mode: "solo" (اللعب الفردي), "world" (عالم الجوف) or "both" (shared game rules).
// Each mode has its own version: bump only the one an update touches (both for a "both" item).
const WHATS_NEW = {
  v: { solo: "2026-11-25-updates", world: "2026-11-25-updates" },
  items: [
    ["both", "⬆️", "التحديثات توصلك على طول", "• إذا نزل تحديث وأنت داخل اللعبة (حتى لو حاطها تطبيق)، يطلع لك «تحديث جديد» خلال ثواني بعالم الجوف، وخلال دقيقة برا، بدون ما تطلع وترجع."],
    ["both", "🏠", "ابنِ البيت المطوّر على طول", "• إذا طوّرت بيت لمستوى (طين، شعبي، فيلا، عمارة…)، يطلع هالمستوى في قسم «سكن» بطاقة لحاله، وتبنيه جاهز على طول. • سعره: الخيمة مع كل التطويرات اللي قبله ومواد البناء، نفس لو بنيته وطورته."],
    ["both", "✏️", "وضع التعديل", "• «ترتيب» و«إزالة» صاروا زر واحد: «✏️ تعديل». • اختر أي مبنى: اسحبه لمكان ثاني أو بدّله مع غيره ببلاش، ↻ تلفه، 🗑️ تشيله. • 🗑️ بدون ما تختار شي يفتح وضع الإزالة: اضغط أو اسحب إصبعك على المباني والطرق والصخور. • ↶ تراجع و↷ إعادة لكل شي، وتشوف فوق كم بيرجع لك من الإزالة، وما ينحسب شي إلا إذا ضغطت ✓ (و✕ يرجّع كل شي مثل ما كان)."],
    ["world", "💾", "حفظ المدينة بين الأجهزة", "الحفظ القديم من جهاز ثاني ما يرجّع مبانيك أو رصيدك. إذا اختلف الحفظ، تقدر تفتح حفظ السيرفر وتلقى نسخة هذا الجهاز في الإعدادات."],
    ["both", "⚡", "أسلاك الكهرباء تظهر", "صلّحنا ظهور الأسلاك بين الأعمدة وعلى الطرق المكهربة، عشان تشوف مسار التوصيل وأنت تقرّب الخريطة."],
    ["both", "💼", "أول استشارة مجانية", "تقدر تاخذ أول استشارة من المستشار المالي حتى لو ميزانية مدينتك بالسالب."],
    ["both", "💼", "المستشار المالي", "• زر جديد «المستشار» فوق «القائمة»: يقرأ مدينتك كلها ويقول لك إذا كنت رابح أو خسران، ووش أكبر أخطاءك، وكيف تصلحها خطوة خطوة بالأرقام، مع زر «📍 وريني» يوديك للمكان. • أول استشارة مجانية، وبعدها سعرها حسب مرحلتك، وتبقى صالحة يوم كامل باللعبة."],
    ["both", "💧", "الخزان والسد ينبنون", "• صلّحنا خطأ كان يعلّق اختيار مكان الخزان والسد، فما كانوا ينبنون. الحين تختار المكان وتبني عادي."],
    ["both", "⚡", "طريق مكهرب", "• طريق جديد بقسم الطرق: مسفلت ومعه أعمدة كهرب. إذا اتصل بمولد أو محطة أو عمود، ينقل الكهرب على طوله ويوصّلها للمباني لين مربعين من جنبه. سعره أغلى من المسفلت."],
    ["both", "🌴", "الزينة صارت تفرق", "• النخل والزهور والفوانيس والنوافير صار لها أثر خاص فوق أثر الخدمات، فتزيد رضا البيوت حولها حتى في الحارات المخدومة. • الزينة الكبيرة (النافورة الراقصة، دوار الدلة، نصب الزيتونة، مجسم المبخرة) صارت تاخذ ٢×٢ مربعات بحجم أكبر، والصغيرة (النخلة، الزهور، الفانوس) تاخذ ربع مربع: تقدر تحط ٤ من نفس النوع بمربع واحد، وكل وحدة تحسب، وإذا جنبها طريق تنصف على طرفه. • النخل والفوانيس صارت تطلع من الأرض بدون حوض. • الدلة والزيتونة والمبخرة والنافورة الراقصة تقدر تركبها في وسط دوار على الطريق، والدوار يكمل شغله. اللي مبنية من قبل تبقى مثل ما هي."],
    ["both", "🏗️", "الردم ما يعلّق", "• ردم مربعات كثيرة مرة وحدة صار سريع وما يعلّق الجوال."],
    ["both", "⬆️", "كم باقي للمرحلة الجاية", "• تحت الوقت فوق تشوف مرحلتك والمرحلة الجاية وكم نسمة باقي لها، وشريط ذهبي يتعبّى كل ما كبرت. • وصلّحنا خطأ كان بيخرّب ميزانية أي مدينة توصل «حاضرة»."],
    ["both", "⚡", "البرق والرعد", "• صوت مطر حقيقي مسجّل، ورعد حقيقي: قريب مع الصاعقة، وبعيد يدوّي بالسما. • وقت المطر ممكن تنزل صاعقة على أرضك: إذا صابت مبنى ينقص من حالته (ترممه عادي، والصاعقة ما تطيّحه)، وإذا صابت أرض فاضية بس تنوّر وتولّع شرار. • السماء تبرق بين وقت وثاني، والمدينة تنوّر مع البرقة."],
    ["both", "☀️", "نهار أطول وليل أوضح", "• النهار صار أطول والليل أقصر بكل الفصول. • الليل صار أوضح، والمدينة تبان حتى تحت المطر."],
    ["both", "💧", "الماء الجوفي يرجع", "• كل سد خالص يرجّع ماء للأرض حتى لو بحيرته صغيرة، وإذا امتلت يرجّع أكثر. • إذا قرب الماء الجوفي يخلص، الآبار تسحب أقل، فيقدر يرجع يرتفع بالسدود والتحلية. • بطاقة «ردم الوادي» تغيّرت صورتها عشان ما تنلخبط مع السد."],
    ["both", "🏫", "سبب واضح للمبنى الواقف", "• إذا مبنى ما يشتغل، يقول لك السبب الصحيح: طريق، أو إفلاس البلدية، أو إضراب، أو خراب. قبل كان يقول «يحتاج طريق» دايم."],
    ["world", "💰", "دعم حساب المواطن", "لمدة ٣ أيام متتالية داخل اللعبة، المدن اللي رصيدها أقل من ألف ريال وقت الصرف تستلم ١٠٠ ريال من الدولة. الدعم ينزل في الميزانية مرة واحدة في يوم الجوف، ويوصلك تنبيه عند الصرف."],
    ["world", "🤝", "شارك الرافعية مع ربعك", "من القائمة الرئيسية اضغط «شارك الرافعية» وأرسل الدعوة من تطبيقات جوالك، أو انسخ الرابط وشاركه مع ربعك. بيض الله وجيهكم على دعمكم!"],
    ["both", "💡", "إنارة الليل الجديدة", "غيّرنا شكل أعمدة الإنارة والفوانيس. ضوها يبان على الشارع والواجهات القريبة، ومصابيح السيارات تنوّر الطريق قدّامها. بعد المطر، يبان أثر الإنارة على البرك."],
    ["both", "🏙️", "المباني أوضح من بعيد", "تفاصيل النوافذ والواجهات تبقى ظاهرة وأنت تبعّد الكاميرا أو تشوف المدينة من فوق. خفّفنا تعقيد المجسّمات عشان يبقى الرسم أخف."],
    ["world", "🔒", "ملاحظة خاصة للمطور", "من شات الجوف اختر «ملاحظة خاصة للمطور» وأرسل اقتراحك أو وصف المشكلة. ملاحظتك تظهر في لوحة المطور فقط."],
    ["both", "🚗", "الطرق الترابية وظلال المركبات", "على الطرق الترابية تشوف أثر الكفرات والغبار بينها. ظل السيارة أو الشاحنة يتحرّك ويلف معها بشكل متصل."],
    ["both", "🏥", "طلبات الأهالي صارت أدق", "• اللي يطلب مستوصف أو مدرسة أو مسجد أو شرطة أو ماء، بيته فعلاً ما توصله الخدمة، وزر «📍 بيته» يوريك مكانه. • إذا الخدمة موجودة بس ما عليها طريق، يطلبون الطريق مو مبنى ثاني. • تنبني الخدمة عند اللي طلبوها؟ ينحسب الوعد وفيته، حتى لو حارة ثانية للحين تبي. • شكوى السرقات ما تجي إلا إذا فيه بيوت فعلاً برا مدى الشرطة."],
    ["both", "🏗️", "البناء صار أطول وأحلى", "• انميشن البناء صار ١٠ ثواني: السقالات، والمبنى يرتفع دور دور، وبعدها تنزل السقالات. • المبنى يشتغل من أول لحظة مثل قبل."],
    ["both", "🎨", "الرافعية بحلّة جديدة", "• أكثر من ٩٠ مبنى بتصاميم جديدة: البيوت والفلل والعماير، والمساجد، والأسواق بالحجر، والمدارس والمستشفيات، والمصانع ومحطات الماء والكهرباء، والمشاريع الكبرى. • خامات حقيقية: حجر بمداميك، ولياسة، وخشب. • أرض فيها كثبان وحصى، والنخل يتحرك مع الريح، والإسفلت يلمع إذا تبلل، وبرك ماء بالمطر. • سيارات وناس بتصاميم جديدة. • مواقف بمظلات، وكافرات أصفر وأسود على الشوارع، وإشارات مرور حقيقية، وبيت الشعر بالمجلس والدلة. • وخط جديد للعبة: العناوين بخط المسيري، والكلام بخط المراعي."],
    ["both", "🏗️", "شوف مدينتك وهي تنبني", "• أي مبنى تبنيه أو تطوّره يطلع له موقع بناء بسقالات، ويرتفع دور دور، وبعدها تنزل السقالات. • للشكل بس: المبنى يشتغل من أول لحظة مثل قبل."],
    ["both", "⚡", "أجمل وأخف على الجوال", "• اللعبة ما ترسم إلا اللي قدامك، ومن بعيد ترسم المباني بنسخة أخف. • الرسومات صارت أجمل بكثير، والجوال يتعب أقل من قبل. • جودة «✨ تلقائي» (الافتراضية) تخفف لحالها إذا الجوال تعب أو سخن، وترجع ترفع إذا ارتاح. • وبالإعدادات صار فيه «🔋 توفير الطاقة» و«فائقة» للجوالات القوية."],
    ["world", "▶️", "كمّل ديرتك على طول", "• بالقائمة الرئيسية صار فيه زر «كمّل في …» يدخلك مدينتك على طول، بدون الخريطة. • وخلفية القائمة صارت مدينتك نفسها بتصوير جوي يتحرك فوقها."],
    ["world", "🟢", "كم واحد متصل الحين", "• داخل عالم الجوف تشوف جنب الوقت كم لاعب متصل الحين. رقم بس، بدون أسماء."],
    ["world", "🏛️", "المشاريع الكبرى باسم مكانك وشكله", "• البوابة والبرج والأبراج والمطار والمهرجان صارت تاخذ اسم المكان اللي مدينتك فيه على خريطة الجوف: اللي قرب سكاكا يبني «بوابة سكاكا» و«أبراج سكاكا». • وكل مكان له تصميمه: دومة الجندل حجر ذهبي على طراز قلعة مارد، وسكاكا وميقوع طين أحمر على طراز قلعة زعبل، والقريات والحديثة والحماد حجر أسود بأقواس، وطبرجل والروضات وصوير حجر أبيض بين الزيتون، والنفود بيت شعر بالسدو."],
    ["both", "📱", "شاشة كاملة بالأندرويد", "• بالأندرويد اللعبة صارت تاخذ الشاشة كلها أول ما تلمسها، وتختفي أشرطة المتصفح. • ما تبيها؟ طفّها من الإعدادات ← «📱 شاشة كاملة»."],
    ["both", "🔑", "كود النسخة الاحتياطية صار قصير", "• بالإعدادات ← «نسخة احتياطية» ← «🔑 اطلع كود»: يطلع لك كود قصير مثل K7PM-2QXA بدل الكود الطويل. • تكتبه بالجهاز الثاني من «استرجع من كود»، ويبقى ٦٠ يوم."],
    ["world", "🛠️", "إصلاحات الخريطة والشات", "• اسم «الرافعية» على خريطة الجوف وبالشات صار يطلع مثل ما هو، بدل ما يتبدل باسم مدينتك. • ولما تكتب بالشات ما تطلع لك قائمة كتاباتك القديمة فوق الكيبورد."],
    ["world", "🔔", "التنبيهات رجعت مثل أول", "• رجّعنا طريقة اشتراك جوالك بالتنبيهات مثل ما كانت لما كانت توصل. • إذا ما وصلتك: الإعدادات ← طفّ «التنبيهات على الجوال» وشغّلها من جديد."],
    ["world", "✏️", "قوانين الأسماء بالجوف", "• ممنوع تكتب باسمك أو اسم مدينتك اسم شخص حقيقي غير اسمك، أو اسم أو رمز عائلة أو فخذ أو قبيلة. • إذا الإدارة طلبت منك تغيّر الاسم، يطلع لك السبب ومعك يوم كامل تغيّره، وإذا ما غيّرته تنحذف مدينتك من عالم الجوف. • والمطور صار يكتب معكم بالشات باسم «🛠️ المطور»."],
    ["both", "🖼️", "الرسوم رجعت واضحة", "• كانت اللعبة إذا حسّت إن الجوال بطيء لحظة، تنزّل الدقة وتحفظها للأبد، فتصير مبكسلة. • الحين ترجع واضحة، وإذا الجوال تعب فعلًا تخفف الظلال بس ولهالمرة، والدقة تبقى حلوة."],
    ["both", "📱", "أزرار الجنب كلها تبان", "• إذا الشاشة قصيرة (مثل المتصفح بأشرطته)، أزرار الجنب تصغر شوي عشان تبان كلها بعمود واحد."],
    ["both", "🎯", "المهام ما تتعلق", "• لو خلّصت مهمة من اللي تحت قبل اللي فوقها (مثل بحث الري بالتنقيط قبل المدرسة)، تستلم مكافأتها على طول. • واللي خلّصها قبل ومكافأته معلقة، تجيه خلال ساعة من دخوله."],
    ["world", "🌧️", "الشتاء رجع له مطره", "• الشتاء صار موسم المطر بالجوف: ينزل فيه مطر ثلاث مرات على الأقل (أوله ونصه وآخره)، وكل مرة قرابة اليوم. • ومطر الشتاء يخلّي الربيع اللي بعده أخضر."],
    ["both", "🗣️", "طلبات الأهالي على قد مستواك", "• الأهالي يطلبون اللي تقدر تسويه بمرحلتك. • وإذا تمنّوا شي لمرحلة أكبر (مثل السفلتة أو مركز الشرطة وانتم بلدة)، يجي كأمنية لبعدين: ما فيها وعد ينحسب عليك ولا زعل."],
    ["both", "🛠️", "إصلاحات", "• التنبيهات على الجوال ما كانت توصل أبد (لا آيفون ولا أندرويد): انصلحت، وجرّبها من الإعدادات ← «جرّب التنبيه»، ولو ما وصلت يقولك رقم الرد عشان نعرف السبب. • خريطة الجوف تطلع «نحمّل الخريطة…» على طول بدل ما تحس إن الزر ما اشتغل. • نقل اللعبة للتطبيق بالآيفون صار بطريقتين بس: لحالها أو بالرمز. • هدايا الإدارة توصلك على طول حتى لو وصلت وانت داخل اللعبة."],
    ["world", "🔔", "اختبار التنبيه يوضح النتيجة", "زر «جرّب التنبيه» ينتظر رد جهازك ويبيّن إذا وصل طلب عرض الإشعار. ونص التنبيه يوصل معه مباشرة حتى لو اللعبة مسكّرة."],
    ["world", "🔔", "التحديث والتنبيهات على الجوال", "التحديث يوصل من الأيقونة والمتصفح. الإعدادات تتحقق من اشتراك هالجهاز، وزر تجربة التنبيه يجرّب نفس الجهاز."],
    ["world", "📱", "واجهة الجوال أضبط", "الضغط على الأزرار والكتابة بسفاري ما تكبّر الصفحة بالغلط. أدوات اليسار بعمود واحد تقدر تمرّره، وكلمة «التحديثات» بالنشرة تظهر كاملة. تقدر تكبّر الخريطة بإصبعين."],
    ["world", "🧾", "ميزانية أوضح", "اضغط الميزانية وتشوف رصيدك، وكم تتوقع يدخل ويطلع الساعة الجاية. سجل الحركات يبيّن كل مبلغ وسببه، مثل المكافآت والرسوم والهدايا."],
    ["world", "🌍", "عالم الجوف أول القائمة", "اللعب الحين في عالم الجوف. تلقى زرّه أول شي في القائمة الرئيسية، وتدخل العالم إذا ضغطت عليه."],
    ["both", "📲", "لعبتك تنتقل للتطبيق", "بالآيفون: إذا حطيت اللعبة تطبيق بشاشتك (من سفاري: إضافة إلى الشاشة الرئيسية) وفتحتها، تلقى لعبتك كاملة: حساب الجوف ومدنك والإعدادات. ولو فتحت التطبيق ولقيته فاضي: بسفاري ← الإعدادات ← «انقل لعبتك للتطبيق» وتكتب الرمز بالتطبيق."],
    ["world", "📱", "الآيفون أسهل", "خطوات الآيفون صارت أوضح وتناسب نسخة جوالك: بالنسخ الجديدة زر المشاركة داخل «⋯» تحت يمين، وخل «فتح كتطبيق ويب» شغّال. ولو فتحت الأيقونة وما انتقل حسابك، يطلب منك رمز الاحتياط على طول (صالح ٢٤ ساعة)."],
    ["world", "💰", "أسعار الخزنة", "الخزنة صارت أغلى شوي: بناؤها ١٬٥٠٠، وكل خزنة زيادة أغلى من اللي قبلها (لين ٣٬٧٥٠ للرابعة)، والتطوير ٦٬٠٠٠ ثم ١٨٬٠٠٠ ثم ٥٠٬٠٠٠ ثم ١٤٠٬٠٠٠. اللي بنيته قبل يبقى لك."],
    ["both", "✨", "الجديد يوصلك", "كل ما تدخل (الفردي أو الجوف) وفيه شي جديد من آخر مرة، يطلع لك «الجديد من آخر مرة» بالأشياء الجديدة بس. وبالنشرة صار فيه تبويب «✨ التحديثات» تلقى فيه كل اللي تغيّر، والجديد عليه علامة."],
    ["world", "🔄", "ابدأ من جديد", "بالإعدادات صار فيه «ابدأ مدينتي من جديد»: مدينتك بالجوف ترجع قرية من الصفر على نفس الأرض وبنفس الاسم. مرة كل ٢٤ ساعة، وتكتب اسم مدينتك تتأكد قبل."],
    ["world", "🔒", "الخزنة", "بعالم الجوف صار للفلوس سعة: البلدية تشيل (قرية ٥٬٠٠٠ · بلدة ١٥٬٠٠٠ · مدينة ٥٠٬٠٠٠ · محافظة ١٥٠٬٠٠٠ · حاضرة ٤٠٠٬٠٠٠)، ولما تمتلي يوقف الدخل لين تصرف. تبي تجمع أكثر؟ ابنِ «خزنة» من «ماء وكهرباء» (١٬٥٠٠، وكل خزنة زيادة أغلى، لين ٤) وطوّرها خمس مستويات: من ٥٬٠٠٠ لين ٣٥٠٬٠٠٠ للخزنة الوحدة (التطوير من ٦٬٠٠٠ لين ١٤٠٬٠٠٠). فلوسك اللي معك الحين ما تنلمس، والقروض والمكافآت تدخل حتى لو مليانة."],
    ["world", "🛠️", "الإدارة صارت معكم", "إدارة الجوف تقدر ترسل إعلانات (تطلع بالنشرة والشات) وهدايا للمدن، وتمسح الرسايل المسيئة وتوقف اللي يسيء. بلّغ عن أي إساءة من زر البلاغ والإدارة تشوفه."],
    ["world", "🔔", "زر التنبيهات بالإعدادات", "بالإعدادات صار فيه مفتاح «🔔 التنبيهات على الجوال»: شغّله وقت ما تبي (حتى لو قلت «بعدين» أول مرة)، وطفّه وقت ما تبي."],
    ["world", "📱", "التنبيهات بالآيفون", "بالآيفون: الإعدادات ← «فعّل التنبيهات» تطلع لك الخطوات بالصور: زر المشاركة ← «إضافة إلى الشاشة الرئيسية»، وتفتح اللعبة من أيقونتها وحسابك ومدينتك ينتقلون لحالهم، وبعدها تفعّل التنبيهات. ولو ما انتقل الحساب فيه رمز احتياط."],
    ["world", "📰", "مواطنينك يبونك", "إذا غبت أكثر من ساعة وعند أهل مدينتك طلب مهم ما رديت عليه (أو قرار ينتظرك)، يوصلك تنبيه على جوالك فيه كلامهم، مرة كل ٨ ساعات بالكثير. وبالإعدادات صار فيه زر «جرّب التنبيه» تتأكد فيه إن التنبيهات توصلك."],
    ["world", "🧾", "تصحيح خصم الغياب", "اللي كانت مدينته مديونة وطلع، ودرع الغياب سدّد دينه، كان ينخصم منه بالغلط كأنه كسب. صلّحناه، ورجّعنا لكل واحد صار له كذا فلوسه مع رسالة اعتذار."],
    ["world", "🔔", "تنبيهات على جوالك", "بعالم الجوف يوصلك تنبيه حتى واللعبة مسكّرة: إذا صاروخ أو مسيّرة جاية لمدينتك أو انضربت، إذا أحد أعلن عليك حرب أو عرض هدنة أو صلح، وإذا أحد ذكر اسمك أو اسم مدينتك بالشات. فعّلها من الإعدادات. بالآيفون: أضف اللعبة للشاشة الرئيسية أول (زر المشاركة ← إضافة إلى الشاشة الرئيسية)."],
    ["both", "⬆️", "التحديث صار إجباري", "إذا نزل تحديث جديد واللعبة عندك قديمة، تطلع لك شاشة «تحديث جديد» وتضغط «حدّث الحين»: مدينتك تنحفظ أول، وتنزل النسخة الجديدة. كذا الكل يلعب على نفس النسخة."],
    ["both", "🛣️", "تطوير الطرق", "بقائمة الطرق صار فيه بطاقة «تطوير الطرق» مثل تطوير المباني: الطرق اللي تقدر تطورها تطلع بالذهبي، اضغط أو اسحب عليها ثم ✓ طوّر (ترابي ← مسفلت ← شارع رئيسي). ولو ضغطت على أي طريق فيه زر «طوّره» على طول."],
    ["world", "😴", "اللي ينام والجوال شغال", "إذا ما لمست اللعبة ربع ساعة بعالم الجوف، النائب يمسك البلد وينطبق حد الكسب وانت برا (حسب مرحلة مدينتك)، واللعبة تخفف رسمها عشان الجوال ما يسخن. أول ما تلمس الشاشة يرجع كل شي ويقولك كم كسبت وانت غافي."],
    ["world", "🧾", "حد للكسب وانت برا", "بعالم الجوف، أكثر شي تكسبه مدينتك وانت طالع: قرية ٥٬٠٠٠، بلدة ١٠٬٠٠٠، مدينة ٢٠٬٠٠٠، محافظة ٤٠٬٠٠٠، حاضرة ٨٠٬٠٠٠. فلوسك اللي كانت قبل ما تطلع ما تنلمس أبد، والخسارة ما يزيدها الحد (درع الغياب يحميك). ولو أحد جاه أكثر من الحد ينرجع الزايد بس وتوصله رسالة."],
    ["world", "⚡", "الجوف صار مباشر", "كل شي بعالم الجوف يوصلك على طول: رسايل الشات، والإنذارات والضربات والهدن، وأخبار نشرة الجوف، ومدن الناس لما يبنون فيها (تشوفها تتغير وانت تزورها). ومدينتك توصل للناس خلال ثواني من أي بناء. والضربة تنحسب بالضبط وقت وصولها حتى لو محد فاتح."],
    ["both", "🔆", "السطوع طبيعي بالنهار", "السيارات والآبار كانت تلمع بقوة بالنهار على الرسوم العالية. الحين التوهّج بالليل بس (المصابيح والأضواء)، وبالنهار الألوان طبيعية."],
    ["both", "🕰️", "اليوم رجع ٢٠ دقيقة", "يوم اللعبة رجع ٢٠ دقيقة (كل ساعة باللعبة ٥٠ ثانية) عشان اللعب ما يبطى. والفصول باقية ٧ أيام."],
    ["both", "🏫", "تفاصيل الخدمات ومداها", "اضغط أي خدمة بقائمة البناء (مسجد، مدرسة، مستوصف، شرطة، حديقة…) وتطلع لك تفاصيلها: السعر والمصروف وكم تفرّح الناس ومداها وكم عندك منها وكم بيت برا مداها. وفيها زر «اعرض مداه» يلوّن الخريطة: الأخضر يوصله والأحمر البيوت اللي برا، وزر «ابنِ»."],
    ["both", "↩️", "ترجع وانت ماسك", "الطريق يمشي مع إصبعك وين ما تروح زي أول، وما يفوّت مربعات لو سحبت بسرعة. ولو طلع مربع غلط وانت ماسك، ارجع بإصبعك على نفس الطريق وينمسح اللي بعده، وكمّل بدون ما ترفع إصبعك. ونفس الشي بالترتيب."],
    ["both", "🔔", "تنبيه رسوم المحافظة", "قبل رسوم المحافظة السنوية بـ٣ أيام وبيوم يوصلك تنبيه بالمبلغ تقريبًا، وبالأرقام تشوف كم باقي لها وكم بتدفع."],
    ["both", "🌬️", "مراوح الرياح تدور", "مراوح مزرعة الرياح صارت تدور، وإذا تضررت المزرعة تبطّي، وإذا انهدمت توقف."],
    ["both", "⚖️", "موازنة الفلوس", "التجار يشترون من محاصيل مزارعك على قد حجم بلدك: المزارع الأولى تبيع كامل، واللي يزيد عن الطلب ينباع بـ٤٠٪ (تشوفه بالأرقام). مكافآت المهام اللي ما تطلب بناء (عدد السكان، الرضا، المرحلة) صارت أقل، ومهام البناء باقية تغطي سعرها. ورسوم المحافظة صارت على قد الوقت اللي قضيته بكل مرحلة، فما تنضرب برسوم مدينة كاملة لو صرت مدينة آخر السنة."],
    ["both", "🔔", "شريط الأحداث يختفي", "شريط الحدث (موجة حر، رمضان، مطر…) يطلع ٣٠ ثانية أول ما يبدأ وبعدين يختفي، وتلقاه بمربع الوقت فوق."],
    ["world", "✏️", "اسم مدينتك بالجوف", "كل مدينة بالجوف لها اسم ما يتكرر: إذا الاسم مأخوذ يقولك اختر غيره. وتقدر تغيّر اسم مدينتك مرة وحدة بس من خريطة الجوف ← مدينتك ← «غيّر اسم مدينتك»، ويطلع الخبر بنشرة الجوف."],
    ["both", "📅", "فصول أطول", "كل فصل صار أسبوع كامل (٧ أيام) بدال ٣، والسنة ٢٨ يوم. اليوم نفسه ما تغيّر. ورمضان صار يومين، وكل عيد يوم كامل، ورسوم المحافظة السنوية زادت بقدر ما طالت السنة."],
    ["world", "🌍", "نشرة الجوف", "داخل «النشرة» صار فيه تبويب «نشرة الجوف»: أجواء الجوف الحين واللي جاي بالـ٤٨ ساعة (مطر، غبار، رمضان، العيد)، وأكبر المدن وأسعدها، وأخبار الجوف كلها: مدن جديدة، مدن كبرت، حروب وهدن وصلح وضربات. وتطلع لك نقطة إذا فيه خبر جديد."],
    ["both", "🌙", "رمضان بوقته", "رمضان صار يجي مرة بالسنة على تقويم ثابت (مو بالصدفة)، ويقعد يوم كامل من أيام اللعبة، وبعده عيد الفطر نص يوم، وعيد الأضحى بعده بأيام. وكل سنة يتقدم شوي فيمر على كل الفصول."],
    ["both", "🕐", "الوقت مضبوط على الصلاة", "اللي مكتوب فوق (الضحى، الظهر، العصر، المغرب) صار يمشي مع أذان كل صلاة: الساعة ١ الظهر يكتب «الظهر» مو «العصر»."],
    ["both", "🗞️", "كلام الناس منطقي", "الناس صاروا يسمّون مدينتك باسمها مو «الرافعية»، وطلب العوايل المحتاجة يناسب الوقت (تدفئة بالشتاء، مكيف بالصيف، فطور وسحور برمضان)، وما عاد أحد يشتكي إن البيع واقف ورمضان شغال."],
    ["both", "🕌", "مدى المساجد على الخريطة", "مثل الماء والكهرباء: من «الرضا» أو من أي مسجد اضغط «اعرض وين توصل المساجد» وتشوف وين يوصل المسجد بالأخضر، والبيوت اللي برا المدى بالأحمر مع عددها. ولا جيت تبني مسجد يقولك مداه كم مربع."],
    ["both", "📊", "صافي اليوم صار حقيقي", "بالأرقام «اللي دخل آخر ٢٤ ساعة» صار مجموع اللي دخل فعلاً، مو ساعة وحدة × ٢٤ عشان كذا كان يتقلب. والصافي بالساعة طبيعي يتغير: وقت الصلاة المحلات تسكر، ووقت الذروة الزحمة تأخر الموظفين، وتشوف تحته ليش."],
    ["both", "🕌", "كم يخدم وكم يزعج", "قبل لا تبني وبعده: المسجد والمدرسة والمستوصف والبقالة والحديقة يقولون لك «يخدم ١٢ بيت (٨٠ ساكن)»، والمصانع والورش والمولدات تحذرك «⚠️ بيزعّل ٧ بيوت» وتشوف منطقة الدخان بالأحمر. والبقالة صارت تريّح البيوت اللي حولها."],
    ["both", "💰", "تعرف الدخل قبل لا تشتري", "كل بطاقة بناء فيها دخلها ومصروفها بالساعة. ولا اخترت المكان، قبل «ابنِ» يحسب لك اللعبة مدينتك كأن المبنى موجود ويقولك بالضبط: دخل كذا، مصروف كذا، وصافيك يزيد أو ينقص كم. وإذا الدخل قليل لأن الناس قليلين يقولك."],
    ["world", "🌦️", "جو واحد لكل الجوف", "بعالم الجوف المطر والغبار والحر والبرد والجراد والجفاف وموسم الصرام صارت تجي لكل المدن بنفس الساعة وتخلص سوا، ورمضان والعيدين على تقويم واحد للكل يتنقل بين الفصول من سنة لسنة. والوقت والفصول والصلاة أصلاً واحدة. كذا الكل على نفس الظروف."],
    ["world", "💬", "شات الجوف", "شات عام لكل لاعبين الجوف من زر «الشات» على الجنب، ويطلع لك عدد الرسائل الجديدة. اضغط اسم المدينة تروح لها بالخريطة، وتقدر تبلّغ عن أي رسالة مسيئة. رسالة كل ٦ ثواني، والكلام البذيء ينمنع."],
    ["both", "🏙️", "فلل وعماير وأبراج جديدة", "الفلل صار فيها حجر وأعمدة على المدخل وبلكونة زجاج وبوابة حديد ومظلة سيارات وسيارة وحديقة بنخلة، والعماير صار تحتها محلات بلوحات، وفيها بلكونات ومكيفات سبليت وخزانات على السطح، والأبراج السكنية زجاج بين أعمدة حجر وتاج منوّر."],
    ["both", "🔋", "حماية من الحرارة لكل الجوالات", "إذا حسّت اللعبة إن جوالك يتعب، تخفف نفسها لحالها (دقة أقل، ثم بدون ظلال) وتتذكر هذا. ووقت ما تكون فاتح نافذة أو بالقائمة الرئيسية ترسم أقل بكثير."],
    ["both", "🏘️", "مدينة أوقع (المرحلة الثالثة)", "أرصفة على حواف الطرق، وظل ناعم تحت كل مبنى يخليه قاعد على الأرض، والناس بأشكال أنعم."],
    ["both", "🌴", "نخل وسيارات أوقع", "النخل صار بسعف مقوّس ينزل لتحت وخوص على الجنبين وجذع بحلقات وعذوق تمر، والجيوب صار شكلها مدوّر بزجاج وجنوط وأنوار."],
    ["both", "🔋", "أخف على الجوال", "اللعبة صارت ترسم ٣٠ مرة بالثانية وهي هادية بدل ١٢٠، والظلال تنحسب أقل، والتوهّج صار بالجودة «عالية» بس. الجوال ما عاد يسخن مثل قبل والبطارية تطوّل."],
    ["both", "🛣️", "الطرق بالترتيب صارت رسم", "بوضع الترتيب: زر «امسح طرق» واسحب إصبعك على الطرق وتنشال كلها للمخزن، بعدها اختر الطريق من المخزن وارسمه بإصبعك وين تبي، بدون فراغات حتى لو سحبت بسرعة."],
    ["both", "🏙️", "مباني أوقع (المرحلة الأولى)", "الجدران صار فيها ملمس لياسة حقيقي، والحواف ناعمة تلقط الضوء، والشبابيك والألواح الشمسية زجاج يعكس السماء، والرمل فيه حبيبات. وانشال «وقت العالم» و«وش الجديد» من شاشة اللعب (وش الجديد باقي بالقائمة الرئيسية)."],
    ["both", "🌍", "زر الجوف على الشاشة", "خريطة عالم الجوف صار لها زر «الجوف» على جنب الشاشة، حتى وأنت تلعب فردي، بدون ما تطلع للقائمة."],
    ["both", "🧱", "«المكان مشغول» صار يوضح", "إذا ما قدرت تبني بمكان، تعرف وش اللي فيه (مثلاً «كسارة حجر»)، والصخور ما عاد تعلّق فوق المباني."],
    ["world", "🛡️", "المضاد يبين وهو يصد", "وقت الهجوم تشوف البطارية تلف على الهدف وترتفع وتطلق صاروخ اعتراضي بلهب وخط دخان لين يفجّره بالجو. ولو ما فيها صواريخ اعتراضية تطلع لك رسالة واضحة، والنائب يعبيها أول ما ينرصد الهجوم."],
    ["both", "🧩", "الترتيب صار أضبط", "اضغط المبنى عشان تختاره وبعدها اسحبه. أي سحب ثاني يحرك الخريطة بس، فما عاد ينشال مبنى بالغلط."],
    ["both", "⚡", "مدى الكهرباء بلون واضح", "مدى الكهرباء صار بنفسجي بدل الأصفر اللي يضيع مع لون الأرض."],
    ["world", "🌍", "عالم الجوف رجع!", "خلصت الصيانة، والعالم مفتوح من جديد ومعه «صراع الجوف». أسس مدينتك من الصفر."],
    ["world", "💥", "الضربة تبين على المبنى", "المبنى المضروب يهبط ويميل على حسب الضرر، وحوله ركام وحديد بارز وآثار حريق، وتطلع منه نار ودخان لين تصلحه."],
    ["both", "✨", "أيقونات جديدة وصورة أنعم", "بدل الإيموجي صارت أيقونات مرتبة بكل اللعبة، والحواف صارت ناعمة بدون تسنين."],
    ["world", "✨", "حرب بشكل واقعي", "المباني العسكرية انبنت من جديد بتفاصيل واقعية: شاحنة صواريخ بحاويات، وبطارية دفاع جوي، ورادار بعاكس دوّار، وهنقر مسيّرات. والمعادن تعكس سماء حقيقية، والانفجارات صارت بلهب ودخان وشظايا ووميض يضوي اللي حوله."],
    ["world", "⚔️", "صراع الجوف", "ابنِ مركز القيادة العسكرية، وقاعدة مسيّرات، ومنصة صواريخ، ورادار، ودفاع جوي (البناء ← الدفاع والعسكرية). أعلن العداوة ثم الحرب من خريطة الجوف، واختر مبنى بمدينة خصمك وشوف الإطلاق والتحليق والاعتراض والإصابة. البيوت والمساجد والمدارس والمستوصفات محمية، والضرر ينصلح وما يمسح شي، والسيرفر هو اللي يحكم بالنتيجة."],
    ["solo", "🌐", "شلنا «مدن الربع»", "النشر بالكود ولوحة الصدارة انشالت من اللعب الفردي. الفردي صار لك لحالك، واللعب مع الناس صار بعالم الجوف بس."],
    ["world", "🧹", "عالم الجوف من جديد", "مسحنا كل مدن عالم الجوف وأسماءه، والكل بيبدأ من الصفر لا رجع العالم من الصيانة. مدنكم الفردية ما تأثرت."],
    ["world", "📦", "ما عاد فيه نقل من الفردي", "المدن الفردية ما عادت تنتقل لعالم الجوف. بالعالم كل واحد يبدأ من الصفر، والفردي له حياته لحاله."],
    ["both", "🆕", "«وش الجديد» صار قسمين", "تحديثات اللعب الفردي لحالها، وتحديثات عالم الجوف لحالها. اختر القسم من فوق."],
    ["world", "🛠️", "عالم الجوف تحت الصيانة", "قفلنا عالم الجوف فترة عشان نشتغل عليه ونضيف له أشياء جديدة. مدنكم فيه محفوظة، واللعب الفردي شغال عادي."],
    ["both", "🧪", "بحوث جديدة بالمجلس", "١٤ بحث جديد: الزراعة الحديثة، عصر الزيتون، تغذية الماء الجوفي، تصريف السيول، تدوير المياه، ترشيد الكهرباء، التسويق، الطب الوقائي، الكاميرات الأمنية، اللوجستية، الحكومة الإلكترونية، إحياء التراث، النقل العام، وطاقة الرياح."],
    ["both", "🛣️", "الطرق تنشال بالترتيب", "«شيل الكل» يشيل الطرق والزفلت بعد، وترصفها من جديد بسحب إصبعك على الأرض."],
    ["both", "🧩", "وضع الترتيب", "مثل كلانس: من «ترتيب» اسحب أي مبنى بإصبعك لمكان ثاني ببلاش، حطه على مبنى ثاني ويتبادلون، «شيل الكل» يحطها بالمخزن وترتب من الصفر، وفيه تراجع وإلغاء."],
    ["both", "📍", "وين الحارة؟", "إذا أحد بالنشرة أو بالوعود ذكر حارة، تحتها زر «📍 وين؟» يوديك لها وتضوي أرضها."],
    ["both", "🗺️", "الأرض كبرت", "أرض البداية صارت أوسع، وحولها ٢٤ أرض تشتريها: قريبة ثم بعيدة ثم الأطراف، كل جهة نصين، وأسعارها تبدأ من ٣ آلاف."],
    ["world", "🌍", "عالم الجوف صار أكبر", "خريطة الجوف كبرت كثير وفيها أماكن جديدة: الحديثة، العيساوية، الشويحطية، صوير، ميقوع، أبو عجرم، زلوم. ومدن اللاعبين بقت بمكانها."],
    ["both", "🏙️", "مرحلة الحاضرة", "بعد المحافظة صارت فيه «حاضرة» (٩٠٠٠ ساكن)، وبرج سكني يسع ١٢٠، ومستوى رابع للمحلات والمزارع والمسجد والمستشفى."],
    ["both", "🫒", "زيتون الجوف", "مزرعة زيتون ومعصرة تعصر زيت الجوف وتصدّره، ونصب الزيتونة."],
    ["both", "🌬️", "مزرعة رياح", "توربينات مثل دومة الجندل: كهرباء كثيرة ونظيفة بلا دخان."],
    ["both", "🏰", "مشاريع كبرى جديدة", "قلعة مارد، مدينة ألعاب، محطة القطار، استاد الجوف، وأبراج الرافعية. ومكتبة عامة ونافورة راقصة."],
    ["both", "🔌", "عمدان الكهرب", "حط المولد بعيد عن البيوت عشان دخانه، ووصّل الكهرب بعمدان: كل عمود ياخذ من اللي قبله لين ٤ مربعات ويوصل للبيوت حوله."],
    ["both", "👀", "زيارة المدن للفرجة بس", "إذا دخلت مدينة غيرك تتفرج بس: ما تقدر تبني ولا تطوّر ولا تغيّر فيها شي."],
    ["both", "↻", "لفّ المباني", "قبل ما تبني اضغط ↻ وتشوف المبنى يلف قدامك، وبعد ما تبنيه اضغط عليه واختر «لفّ المبنى» ببلاش."],
    ["both", "🌦️", "الجو على حسب الفصل", "المطر بالخريف والشتاء والربيع بس، والصيف حر وغبار وقيلولة، والشتاء برد. ومطر الشتاء هو اللي يخضّر الربيع."],
    ["both", "💬", "ردود ذكية", "الأهالي يردون على حسب السالفة: تشكرهم على المطر بالدعاء، وعلى العيد بالتهنئة، وكل شكوى فيها «وش يبي» واضح."],
    ["both", "ℹ️", "كل مربع فوق يشرح نفسه", "اضغط الميزانية أو السكان أو الرضا أو الماء والكهرب أو الوقت والموسم، ويطلع لك وش وراه وش يصلحه."],
    ["both", "🏞️", "بحيرة السد صارت حقيقية", "ماء بشط ناعم ورمل مبلول حوله وموج يتحرك، والأرض صارت ألوانها تندمج بدل المربعات."],
    ["world", "🤏", "قرّب وبعّد خريطة الجوف", "بإصبعين تقرّب وتبعّد، وبإصبع تسحب، أو بأزرار ＋ و－."],
    ["world", "🌍", "عالم الجوف", "عالم أونلاين واحد لكل اللاعبين على خريطة الجوف: سمّ نفسك، أسس مدينتك، وادخل مدن غيرك. العالم يمشي دايم، ونائب العمدة يمسك مدينتك وأنت طالع."],
    ["solo", "🗺️", "خريطة المنطقة", "أسس الرديفة والأضارع وصفان، ووصّلها بالرافعية بطرق، وصر أمير المنطقة."],
    ["both", "👨‍👩‍👧", "أهل الرافعية", "كل بيت فيه عوايل بأسمائهم ووظايفهم وعيالهم. تابع أي واحد وهو رايح دوامه."],
    ["both", "🚦", "المرور الحقيقي", "الناس يروحون دوامهم بسياراتهم، والطرق تتزحم. شوارع رئيسية ودوارات وإشارات ومواقف."],
    ["both", "🚚", "سلاسل الإنتاج", "شاحنات تنقل التمر والحلال والقمح والحجر من المزارع للمصانع على الطرق."],
    ["both", "🧱", "مواد البناء", "كسارة الحجر تطلّع مواد تحتاجها لتطوير البيوت والمحلات، وإلا تشتريها من برا."],
    ["both", "🤝", "الوعود صارت واضحة", "إذا رجعوا يطالبون تشوف وش طلبوا ووش وعدتهم ومتى، وفي النشرة قائمة «وعودك»."],
    ["both", "🌊", "السدود والماء الجوفي", "السد يحجز السيل ويسوي بحيرة. الماء الجوفي ينقص مع كثرة الآبار ويرجع مع المطر."],
    ["both", "🌾", "المزرعة المحورية", "رشاش دوّار يسقي دايرة قمح: دخل عالي ويسحب من الماء الجوفي."],
    ["both", "🕌", "أوقات الصلاة", "خمس صلوات باليوم. وقت الصلاة الرجال يمشون للمسجد، والمحلات تسكر شوي."],
    ["both", "🐪", "الحلال والإبل", "حظيرة حلال ترعى في الفيضة بالربيع، وسوق الماشية، وميدان مزاين الإبل."],
    ["both", "🏘️", "الحارات", "سمّ حارات ديرتك وتابع رضا كل حارة (من «المجلس»)."],
    ["both", "🗳️", "الانتخابات", "كل سنة يصوت الأهالي عليك: الفوز يجيب دعم، والخسارة تضاعف الرسوم."],
    ["both", "↔️", "نقل المباني", "رتب ديرتك: زر «نقل» تحت، تنقل أي مبنى بمستواه وأهله."],
    ["both", "⬆️", "تطوير المحلات والمزارع", "كل محل ومزرعة وورشة لها ٣ مستويات، دخلها يزيد مع كل مستوى."],
    ["both", "🏦", "البنك ودعم التجارة", "قروض تسددها بالساعة، والمحلات أرخص ٣٠٪ بدعم الدولة."],
    ["both", "❓", "الشرح", "من «القائمة ← الشرح»: كيف تكبر وتصير بلدة ومدينة."],
    ["both", "🎯", "مكافآت المهام", "صارت تغطي تكلفة اللي تطلبه المهمة."],
    ["solo", "⏸️", "البلد تنتظرك", "اللعبة توقف وأنت طالع منها، وترجع تلقاها مثل ما تركتها."]
  ]
};
const wnKey = (m) => `rafaya-news-seen-${m}`;
const wnSeen = (m) => { try { return localStorage.getItem(wnKey(m)) === WHATS_NEW.v[m]; } catch { return true; } };
const wnMark = (m) => { try { localStorage.setItem(wnKey(m), WHATS_NEW.v[m]); } catch { /* fine */ } };
function whatsNewSheet() {
  wnMarkAll("world");
  showWhatsNewDot();
  const list = WHATS_NEW.items.filter(([m]) => m === "world" || m === "both");
  sheet(`<h2>وش الجديد في الرافعية؟</h2>
    <div class="rows">${list.map(([, icon, title, text]) => `<div class="row wn"><b class="wn-i">${icon}</b><span><b>${title}</b><small>${text}</small></span></div>`).join("")}</div>
    <div class="sheet-actions"><button class="btn go block" id="wnOk" type="button">يلا نلعب</button></div>`, "whatsnew");
  $("wnOk").addEventListener("click", closeSheet);
}
/** The "what's new" button on the screen: a red dot until the current mode's update has been read. */
function showWhatsNewDot() {
  const dot = $("wnDot"); if (dot) dot.hidden = wnSeen(worldMode ? "world" : "solo"); // (the chip left the game screen; «وش الجديد» is on the main menu)
}
$("mWhatsNew").addEventListener("click", () => { sfx.tap(); whatsNewSheet(); });
function shareGameSheet() {
  // Invite players to the public home page, even if the current URL carries an account move or backup token.
  const url = "https://rafaya.vamosx.workers.dev/";
  const canShare = typeof navigator.share === "function";
  sheet(`<h2>شارك الرافعية</h2>
    <p>بيض الله وجهك على دعمك! اعزم ربعك يجرّبون الرافعية معك، وخلّ كل واحد يبني مدينته في عالم الجوف.</p>
    <label for="shareGameUrl">رابط اللعبة</label>
    <input class="share-url" id="shareGameUrl" type="text" dir="ltr" readonly value="${url}">
    <div class="sheet-actions">
      ${canShare ? '<button class="btn go block" id="shareGameSend" type="button">مشاركة اللعبة</button>' : ""}
      <button class="btn ${canShare ? "" : "go"} block" id="shareGameCopy" type="button">نسخ الرابط</button>
    </div>
    <p class="hint" id="shareGameStatus" role="status"></p>`, "share-game");
  const input = $("shareGameUrl"), status = $("shareGameStatus"), send = $("shareGameSend");
  if (!input) return;
  $("shareGameCopy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(url);
      status.textContent = "اننسخ الرابط. بيض الله وجهك على دعمك!";
    } catch {
      input.focus();
      input.select();
      status.textContent = "حددنا الرابط لك. انسخه من خيارات المتصفح.";
    }
  });
  send?.addEventListener("click", async () => {
    if (send.disabled) return;
    send.disabled = true;
    try {
      await navigator.share({ title: "الرافعية", text: "تعال جرّب الرافعية معي! ابدأ بخيمة وابنِ مدينتك في عالم الجوف.", url });
      status.textContent = "بيض الله وجهك على دعمك للرافعية!";
    } catch (error) {
      if (error.name !== "AbortError") status.textContent = "تقدر تنسخ الرابط وتشاركه.";
    } finally {
      send.disabled = false;
    }
  });
}
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
/**
 * The main menu shows your own al-Jouf town from the air, the camera drifting slowly over it, with a button to go
 * straight in. Without a town of your own, the menu keeps its usual scene.
 */
const MENU = { town: null, t: 0, cx: 0, cz: 0, pitch: null };
function menuBackdrop() {
  const id = me();
  let town = null;
  if (id?.plot != null) try {
    const saved = unpack(store.get(WORLD_SAVE));
    if (saved.world?.plot === id.plot) town = saved;
  } catch { /* the town can still be loaded from the server after tapping Play */ }
  MENU.town = town;
  const label = $("mPlayLabel"), hint = $("mPlayHint");
  label.textContent = town ? `▶️ كمّل في «${town.name}»` : label.dataset.start || "▶️ ابدأ اللعب";
  hint.textContent = town ? "ادخل مدينتك على طول" : hint.dataset.start || "";
  hint.hidden = !hint.textContent;
  if (!town) return;
  nameLandmarks(worldPlace(id.plot));
  world.newTown(); world.sync(town, { tiles: true, roads: true, buildings: true });
  let sx = 0, sy = 0, n = 0;
  town.tiles.forEach((t, i) => { if (t.b) { sx += i % N; sy += Math.floor(i / N); n++; } });
  const c = n ? [Math.round(sx / n), Math.round(sy / n)] : [N / 2, N / 2];
  MENU.cx = c[0] - N / 2 + 0.5; MENU.cz = c[1] - N / 2 + 0.5;
  MENU.pitch ??= world.view.pitch;
}
showWhatsNewDot();
// What changed since this phone last looked, per mode: the titles already seen are kept, so only the new
// lines show (a phone that knew only the old date stamp gets the newest few).
const wnTitlesKey = (m) => `rafaya-news-titles-${m}`;
function wnTitles(m) { try { return new Set(JSON.parse(localStorage.getItem(wnTitlesKey(m)) || "null") || []); } catch { return new Set(); } }
function wnUnseen(m) {
  const list = WHATS_NEW.items.filter(([x]) => x === m || x === "both"), seen = wnTitles(m);
  if (!seen.size) return wnSeen(m) ? [] : list.slice(0, 5);
  return list.filter(([, , title]) => !seen.has(title));
}
function wnMarkAll(m) {
  try { localStorage.setItem(wnTitlesKey(m), JSON.stringify(WHATS_NEW.items.filter(([x]) => x === m || x === "both").map(([, , t]) => t).slice(0, 300))); } catch { /* fine */ }
  wnMark(m);
}
/** Only what is new since last time, for the mode being played; «كل التحديثات» for the whole list. */
function newSinceSheet(mode) {
  const list = wnUnseen(mode);
  if (!list.length) return false;
  wnMarkAll(mode); showWhatsNewDot();
  sheet(`<h2>✨ الجديد من آخر مرة</h2><p>${mode === "world" ? "بعالم الجوف" : "باللعب الفردي"} تغيّر ${ar(list.length)} ${list.length === 1 ? "شي" : list.length <= 10 ? "أشياء" : "شي"}:</p>
    <div class="rows">${list.map(([, icon, title, text]) => `<div class="row wn"><b class="wn-i">${icon}</b><span><b>${title}</b><small>${text}</small></span></div>`).join("")}</div>
    <div class="sheet-actions two"><button class="btn" id="wnAll" type="button">كل التحديثات</button><button class="btn go" id="wnOk" type="button">تمام 👍</button></div>`, "whatsnew");
  $("wnOk").addEventListener("click", closeSheet);
  $("wnAll").addEventListener("click", whatsNewSheet);
  return true;
}
/** Show updates after entering al-Jouf, once the deputy's report is closed. */
function maybeWhatsNew(tries = 0) {
  if (!worldMode) return;
  if (sheetFor && sheetFor !== "whatsnew") { if (tries < 30) setTimeout(() => maybeWhatsNew(tries + 1), 1500); return; }
  newSinceSheet("world");
}

function spark(values, color) {
  if (values.length < 2) return "<p>الأرقام تبين بعد كم ساعة.</p>";
  const max = Math.max(...values), min = Math.min(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 300},${66 - ((v - min) / span) * 60}`).join(" ");
  return `<svg class="spark" viewBox="0 0 300 70" preserveAspectRatio="none"><polyline points="${pts} 300,70 0,70" fill="${color}22" stroke="none"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="3" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}

const MONEY_MOVES = {
  hour: ["◷", "تشغيل المدينة"], away: ["◷", "تشغيل المدينة وقت غيابك"],
  build: ["🏘️", "بناء"], upgrade: ["⬆️", "تطوير"], materials: ["🏘️", "شراء مواد بناء"],
  land: ["🗺️", "شراء أرض"], fill: ["🛠️", "ردم الوادي"], rock: ["🛠️", "إزالة صخر"],
  move: ["🏘️", "نقل مبنى"], remove: ["🏘️", "مبلغ رجع من إزالة مبنى"],
  repair: ["🔧", "ترميم"], insurance: ["🛡️", "تعويض التأمين"], shield: ["🛡️", "درع الغياب سدّد الدين"],
  loan: ["🏦", "مبلغ القرض"], payoff: ["🏦", "سداد باقي القرض"], research: ["📋", "بحث"],
  decision: ["📋", "قرار البلدية"], investment: ["💼", "عائد استثمار"], goal: ["🎯", "مكافأة مهمة"],
  election: ["🗳️", "دعم الفوز بالانتخابات"], grant: ["🎉", "دعم من المحافظ"],
  fee: ["🏦", "رسوم المحافظة السنوية"], cleaning: ["🛣️", "تنظيف الطرق"],
  citizenSupport: ["💰", "دعم حساب المواطن"], gift: ["🎁", "هدية من إدارة الجوف"], refund: ["↩", "مبلغ رجّعته إدارة الجوف"],
  worldBill: ["📋", "عملية في عالم الجوف"], transfer: ["↔", "تحويل بين المدن"], advisor: ["💼", "المستشار المالي"],
  awayLimit: ["🔒", "خصم كسب الغياب الزايد"], idleLimit: ["🔒", "كسب فوق حدّ الخمول"],
  idleCover: ["🛡️", "تغطية مصروف من كسب الخمول"]
};
const signedMoney = (value) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${fine(Math.abs(value))}`;
const BUDGET_INCOME = {
  tax: "ضريبة الأهالي", shops: "المحلات", farms: "المزارع", industry: "الورش والمصانع", visitors: "الزوار والمشاريع"
};
const BUDGET_EXPENSES = {
  staff: "رواتب البلدية", cleaning: "النظافة", waterNet: "شبكة الماء", roads: "الطرق والإنارة",
  services: "الخدمات", utilities: "تشغيل الماء والكهرباء", business: "تشغيل المحلات والمزارع والمصانع",
  military: "تشغيل وصيانة القيادة", sites: "مواقع الإنشاء", loan: "أقساط القروض",
  insurance: "التأمين", health: "علاج أمراض التلوث", theft: "سرقات المحلات"
};
function moneyMoveRow(entry, open) {
  const { amount, day, detail, operating } = entry;
  const [icon, title] = Object.hasOwn(MONEY_MOVES, entry.kind) ? MONEY_MOVES[entry.kind] : ["📋", "حركة مالية"];
  const dayLabel = ar(dayOf(S.world?.start != null ? day - S.world.start + 3 : day));
  const note = operating
    ? `دخل ${fine(operating.income)} · صرف ${fine(operating.expenses)}${operating.limited ? ` · الخزنة حدّت الكسب بـ${fine(operating.limited)}` : ""}`
    : detail.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const hourKey = `hour-${day}`;
  const breakdown = (labels, values, sign) => Object.entries(labels)
    .filter(([key]) => Number.isFinite(values?.[key]) && values[key] > 0)
    .map(([key, label]) => row(label, `<bdi>${signedMoney(sign * values[key])}</bdi> ريال`, sign > 0 ? "plus" : "minus")).join("");
  const details = operating?.costs ? `<details class="money-hour-details" data-budget-details="${hourKey}" ${open.has(hourKey) ? "open" : ""}>
    <summary>تفاصيل هالساعة</summary><div class="rows">${breakdown(BUDGET_INCOME, operating.revenue, 1)}${breakdown(BUDGET_EXPENSES, operating.costs, -1)}</div>
  </details>` : "";
  return `<div class="money-move">
    <span class="money-symbol" aria-hidden="true">${icon}</span>
    <span class="money-move-info"><b>${title}</b>${note ? `<small>${ar(note)}</small>` : ""}<small>اليوم ${dayLabel}</small></span>
    <b class="${amount > 0 ? "plus" : amount < 0 ? "minus" : ""}"><bdi>${signedMoney(amount)}</bdi> ريال</b>
  </div>${details}`;
}
function budget() {
  const h = S.history;
  const open = new Set(sheetFor === "budget" ? [...$("sheetBody").querySelectorAll("details[open]")].map((part) => part.dataset.budgetDetails) : []);
  const section = (id, title) => `<details class="budget-details" data-budget-details="${id}" ${open.has(id) ? "open" : ""}><summary>${title}</summary>`;
  const entries = (S.moneyLog || []).slice().reverse();
  const income = A.income + A.farmIncome + A.tax, cap = moneyCap(S);
  const nextNet = Math.min(A.net, Math.max(0, cap - S.money));
  sheet(`<h2>الميزانية</h2>
    <div class="budget-balance"><span>الرصيد الحالي</span><strong><bdi>${money(S.money)}</bdi> <small>ريال</small></strong></div>
    <h3>تقدير الساعة الجاية</h3>
    <div class="budget-totals">
      <div><span>↓ يدخل</span><b class="plus"><bdi>${signedMoney(income)}</bdi></b></div>
      <div><span>↑ يطلع</span><b class="minus"><bdi>${signedMoney(-A.upkeep)}</bdi></b></div>
      <div><span>= الصافي</span><b class="${nextNet < 0 ? "minus" : "plus"}"><bdi>${signedMoney(nextNet)}</bdi></b></div>
    </div>
    ${nextNet < A.net ? '<p class="hint">سعة الخزنة تحدّ من المبلغ اللي يزيد على رصيدك.</p>' : ""}
    ${S.broke ? '<p class="need">البلدية مفلسة. بعض الخدمات مقفلة لين يرجع الرصيد فوق الصفر.</p>' : S.money < 0 ? '<p class="need">رصيد البلدية بالسالب. الخدمات تشتغل بنص طاقتها.</p>' : ""}
    <h3>🧾 آخر الحركات</h3>
    ${entries.length ? `<div class="rows">${entries.slice(0, 3).map((entry) => moneyMoveRow(entry, open)).join("")}</div>` : '<p class="hint">تظهر هنا أي مبالغ تدخل أو تنخصم من الآن.</p>'}
    ${entries.length > 3 ? `${section("history", "حركات أقدم")}<div class="rows">${entries.slice(3).map((entry) => moneyMoveRow(entry, open)).join("")}</div></details>` : ""}
    ${section("income", "↓ من وين يجي الدخل؟")}
      <p class="hint">الأرقام تقديرية وتتغيّر مع المبيعات والصلاة والزحمة.</p>
    <div class="rows">
      ${row("الضرائب على الأهالي", `+${fine(A.tax)}`, "plus")}
      ${row("مبيعات المحلات", `+${fine(A.shopIncome)}`, "plus")}
      ${A.shopRaw > A.shopDemand * 1.02 ? `<div class="need">السوق مشبع: الأهالي يصرفون ${fine(A.shopDemand)} بالساعة بس، والمحلات تقدر تبيع ${fine(A.shopRaw)}. محلات زيادة ما تجيب دخل، تحتاج ناس أكثر.</div>` : A.shopRaw > 0 ? `<div class="need ok">السوق فيه مجال: الأهالي يصرفون ${fine(A.shopDemand)} والمحلات تبيع ${fine(A.shopRaw)}.</div>` : ""}
      ${A.visitorIncome ? row("الزوار والمشاريع الكبرى", `+${fine(A.visitorIncome)}`, "plus") : ""}
      ${A.industryIncome ? row("الورش والمصانع", `+${fine(A.industryIncome)}`, "plus") : ""}
      ${A.industryRaw > A.exportDemand * 1.02 ? `<div class="need">التجار يشترون من الورش والمصانع بقيمة ${fine(A.exportDemand)} بالساعة بس. الإنتاج الزايد (${fine(A.industryRaw - A.exportDemand)}) ينباع بثلث السعر. يزيد الطلب كل ما كثر سكان البلد.</div>` : ""}
      ${row("المزارع", `+${fine(A.farmIncome)}`, "plus")}
      ${A.farmRaw > A.farmDemand * 1.02 ? `<div class="need">التجار يشترون من محاصيل المزارع بقيمة ${fine(A.farmDemand)} بالساعة بس. المحصول الزايد (${fine(A.farmRaw - A.farmDemand)}) ينباع بـ٤٠٪ من سعره. يزيد الطلب لما يزيد الناس أو توصّل مدن جارة بطريق.</div>` : ""}
    </div></details>
    ${section("expenses", "↑ وين يروح الصرف؟")}
    <div class="rows">
      ${row("رواتب موظفي البلدية", `−${fine(A.costs.staff)}`, "minus")}
      ${row("النظافة وجمع النفايات", `−${fine(A.costs.cleaning)}`, "minus")}
      ${row("صيانة شبكة الماء", `−${fine(A.costs.waterNet)}`, "minus")}
      ${row("صيانة الطرق والإنارة", `−${fine(A.costs.roads)}`, "minus")}
      ${A.costs.services ? row("رواتب الخدمات (مساجد، مدارس، مستوصفات…)", `−${fine(A.costs.services)}`, "minus") : ""}
      ${A.costs.utilities ? row("تشغيل الآبار والكهرباء", `−${fine(A.costs.utilities)}`, "minus") : ""}
      ${A.costs.business ? row("مصاريف المحلات والمزارع والمصانع", `−${fine(A.costs.business)}`, "minus") : ""}
      ${A.costs.military ? row("القوة العسكرية (تشغيل وصيانة)", `−${fine(A.costs.military)}`, "minus") : ""}
      ${A.costs.sites ? row("مواقع الإنشاء", `−${fine(A.costs.sites)}`, "minus") : ""}
      ${A.costs.loan ? row("أقساط القرض", `−${fine(A.costs.loan)}`, "minus") : ""}
      ${A.costs.insurance ? row("التأمين على المباني", `−${fine(A.costs.insurance)}`, "minus") : ""}
      ${A.costs.health ? row("علاج أمراض التلوث", `−${fine(A.costs.health)}`, "minus") : ""}
      ${A.costs.theft ? row("سرقات من المحلات (حارات بلا شرطة)", `−${fine(A.costs.theft)}`, "minus") : ""}
      ${row("المجموع بالساعة", `−${fine(A.upkeep)}`, "minus")}
      ${provinceFee(S) ? row(`رسوم المحافظة بعد ${ar(Math.ceil(hoursToElection(S) / 24))} يوم`, `تقريبًا −${money(provinceFee(S))} ريال`, "minus") : ""}
    </div></details>
    ${section("manage", "🏦 الخزنة والبنك وإدارة الميزانية")}
    ${S.world ? row("🔒 سعة الخزنة", `${money(Math.max(0, S.money))} من ${money(cap)} ريال`) : ""}
    ${S.staffRaise ? `<p>رواتب البلدية زادت ${ar(Math.round(S.staffRaise * 100))}٪ من العلاوات السنوية. وكل سنة تدفع رسوم المحافظة.</p>` : ""}
    <h3>🚦 المرور</h3><div class="rows">
      ${row("مشاوير الدوام وقت الذروة", `${ar(A.trips || 0)} سيارة`)}
      ${row("طرق مزحومة", ar(A.jammedRoads || 0), A.jammedRoads ? "minus" : "plus")}
      ${A.congestion > 0.02 ? `<div class="need">الزحمة تأخر الموظفين وتبعد الزباين: المحلات تخسر ${ar(Math.round(A.congestion * 100))}٪. سفلت الطرق المزحومة، أو حط شارع رئيسي ودوارات.</div>` : ""}
      <button class="btn block" id="showTraffic" type="button">🚦 اعرض الزحمة على الخريطة</button></div>
    ${productionHtml()}
    <h3>البنك</h3>
    <div class="rows">${(S.loans || []).length ? row("قروض عليك", `${ar(S.loans.length)} · ${fine(S.loans.reduce((n, l) => n + l.per, 0))} بالساعة`, "minus") : row("القروض", "ما عليك قروض")}
      <button class="btn block" id="openBank" type="button">🏦 افتح البنك</button></div>
    <h3>الصيانة</h3>
    <div class="rows">
      ${row("كلفة ترميم كل المباني", A.repairBill ? `${money(A.repairBill)} ريال` : "كلها سليمة", A.repairBill ? "minus" : "plus")}
      ${A.repairBill ? `<button class="btn go block" id="repairAll" type="button">رمّم الكل (الأسوأ أول)</button>` : ""}
    </div>
    <h3>التأمين</h3>
    <p>يكلف ${fine(A.value * 0.0003)} بالساعة، ويعوضك ٧٠٪ من أي مبنى يروح بحريق أو سيل أو انهيار.</p>
    <div class="rows"><label class="row toggle"><span>${S.insured ? "المباني مؤمّنة ✓" : "المباني بدون تأمين"}</span><input type="checkbox" id="insureIn" ${S.insured ? "checked" : ""}></label></div>
    <h3>الضريبة</h3><p>ضريبة أعلى = دخل أكثر بس رضا أقل.</p>
    <div class="tax"><input id="taxIn" type="range" min="0" max="25" step="1" value="${S.tax}" aria-label="نسبة الضريبة"><b id="taxOut">${ar(S.tax)}٪</b></div>
    <h3>الناس</h3>
    <div class="rows">
      ${row("السكان / السعة", `${money(S.pop)} / ${money(A.cap)}`)}
      ${row("الوظائف", `${money(A.employed)} شغالين من ${money(A.workers)}`)}
      ${row("البطالة", `${ar(Math.round(A.unemployment * 100))}٪`, A.unemployment > 0.2 ? "minus" : "")}
      ${row("الماء", `${money(A.waterSupply)} / ${money(A.waterUse)}`, A.waterRatio < 1 ? "minus" : "plus")}
      ${A.grid ? row("الكهرباء", `${money(A.powerSupply)} / ${money(A.powerUse)}`, A.powerRatio < 1 ? "minus" : "plus") : ""}
      ${A.unconnected ? `<div class="need">${ar(A.unconnected)} بيوت ما عندها طريق، فما أحد يسكنها.</div>` : ""}
    </div>
    <h3>السكان</h3>${spark(h.map((x) => x.p), "#2c8a7a")}
    <h3>الميزانية</h3>${spark(h.map((x) => x.m), "#c48a24")}</details>`, "budget");
  $("openBank").addEventListener("click", () => { sfx.tap(); bankSheet(); });
  $("showTraffic").addEventListener("click", () => {
    closeSheet();
    const v = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) if (A.trafficLoad?.[i] > 0) v[i] = Math.max(0.02, Math.min(1, (A.trafficLoad[i] / A.trafficCap[i]) / 2));
    setTimeout(() => world.setOverlay(v, "heat"), 220);
    toast("الأخضر سالك، والأصفر يتزحم، والأحمر زحمة", "");
    setTimeout(() => { if (!tool) world.setOverlay(null); }, 7000);
  });
  $("repairAll")?.addEventListener("click", () => { const r = repairAll(S); if (!r.n) { toast("ما يكفي المال", "bad"); sfx.deny(); return; } sfx.build(); toast(`رممت ${ar(r.n)} مبنى بـ${money(r.spent)} ريال`, "goal"); refresh(); save(); budget(); });
  $("insureIn").addEventListener("change", (e) => { S.insured = e.target.checked; sfx.tap(); refresh(); save(); budget(); });
  $("taxIn").addEventListener("input", (e) => { S.tax = Number(e.target.value); $("taxOut").textContent = `${ar(S.tax)}٪`; refresh(); });
}
// ---------- the people of the house ----------
const kidsWord = (n) => (n === 1 ? "عيل واحد" : n === 2 ? "عيالين" : `${ar(n)} عيال`);
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
function familySheet(i, k) {
  const f = familiesAt(S, i)[k];
  if (!f) return;
  const kids = f.kids.map((c) => `${c.name} (${ar(c.age)})`).join("، ");
  sheet(`<h2>${f.surname}</h2><p>${f.kunya} و${f.mother}${kids ? `، وعيالهم: ${kids}` : ""}. ساكنين ${districtName(S, districtOf(i))}.</p>
    <h3>يومهم</h3><div class="rows">${familyDay(S, A, i, f).map((l) => `<div class="row"><span>${l}</span></div>`).join("")}</div>
    ${wishOf(S, A, i) ? `<div class="need">يتمنون: ${wishOf(S, A, i)}</div>` : `<div class="need ok">مرتاحين في بيتهم.</div>`}
    ${jobOf(S, A, i) ? `<div class="sheet-actions"><button class="btn go block" id="famFollow" type="button">👁️ تابع ${f.kunya} وهو رايح دوامه</button></div>` : ""}`, "family");
  $("famFollow")?.addEventListener("click", () => followFamily(i, k));
}
/** The camera walks with the father from his house to his work. */
function followFamily(i, k) {
  const f = familiesAt(S, i)[k], job = jobOf(S, A, i);
  if (!f || !job) { toast("ما عنده دوام يوصله بطريق", "bad"); return; }
  const path = roadPath(S, doorOf(S, i), doorOf(S, job.tile));
  if (!path) { toast("ما فيه طريق يوصل بيته بدوامه", "bad"); return; }
  closeSheet();
  world.view.zoom = Math.max(world.view.zoom, 1.5);
  world.followPerson(path, { name: `${f.kunya} ${f.surname}`, to: job.name });
  $("followName").textContent = `${f.kunya} ${f.surname}`;
  $("followWhat").textContent = `رايح لدوامه في ${job.name}`;
  $("followTag").hidden = false;
  sfx.tap();
}
$("followStop").addEventListener("click", () => { world.stopFollow(); $("followTag").hidden = true; sfx.tap(); });

/** What an upgrade changes: income and costs an hour, jobs, cheer, reach, homes (before → after). */
function effectHtml(b) {
  const e = upgradeEffect(S, b);
  if (!e) return "";
  const ch = (label, a, z, good = true, unit = "") => {
    const d = z - a; if (!d) return "";
    const up = d > 0, cls = up === good ? "plus" : "minus";
    return `<div class="row eff"><span>${label}</span><b class="${cls}">${fine(a)} ← ${fine(z)}${unit} <small>(${up ? "+" : "−"}${fine(Math.abs(d))})</small></b></div>`;
  };
  if (e.vault) return `<div class="effect"><b>بعد التطوير:</b><div class="rows">${ch("تشيل", e.capNow, e.capNext, true, " ريال")}${ch("المصروف بالساعة", e.upkeepNow, e.upkeepNext, false)}</div></div>`;
  if (e.mil) {
    const n = e.next, stat = n.ops ? `عمليات بالجو: ${ar(n.ops)}` : n.salvo ? `سعة ${ar(n.cap)} · ${ar(n.salvo)} بالعملية · تجهيز ${ar(n.reload)} د` : n.cap ? `صواريخ ${ar(n.cap)} · تجهيز ${ar(n.reload)} د` : n.detect ? `دقة الدفاع ×${ar(n.detect)}` : n.vsDrone ? `ضد المسيّرات ${ar(Math.round(n.vsDrone * 100))}٪ · ضد الصواريخ ${ar(Math.round(n.vsMissile * 100))}٪ · ${ar(n.intc)} اعتراضية` : "";
    return `<div class="effect"><b>بعد التطوير:</b><div class="rows">${ch("المصروف بالساعة", e.upkeepNow, e.upkeepNext, false)}<div class="row eff"><span>القدرة العسكرية</span><b class="plus">${stat}</b></div></div></div>`;
  }
  const rows = e.house
    ? ch("يسكنه", e.capNow, e.capNext, true, " ساكن") + (e.taxGain ? `<div class="row eff"><span>ضريبة زيادة تقريبًا</span><b class="plus">+${fine(e.taxGain)} بالساعة</b></div>` : "")
    : ch("الدخل بالساعة", e.incomeNow, e.incomeNext) + ch("المصروف بالساعة", e.upkeepNow, e.upkeepNext, false) + ch("الوظائف", e.jobsNow, e.jobsNext) + ch("يفرّح اللي حوله", e.happyNow, e.happyNext) + ch("يوصل تأثيره", e.radiusNow, e.radiusNext, true, " مربع");
  const net = e.house ? null : (e.incomeNext - e.upkeepNext) - (e.incomeNow - e.upkeepNow);
  return `<div class="effect"><b>بعد التطوير:</b><div class="rows">${rows}${net != null && (e.incomeNow || e.incomeNext) ? `<div class="row eff"><span>الصافي بالساعة</span><b class="${net >= 0 ? "plus" : "minus"}">${net >= 0 ? "+" : "−"}${fine(Math.abs(net))}</b></div>` : ""}</div><p class="hint">${e.house ? "تقريبي: إذا امتلى البيت، على نسبة الضريبة الحين." : "تقريبي: يعتمد على الموظفين والكهرباء والزباين."}</p></div>`;
}
/** The materials part of an upgrade: from the store, or bought from outside. */
function matsNote(pr) {
  if (!pr.mats) return "";
  return `<p class="hint">🧱 يحتاج ${ar(pr.mats)} مواد بناء${pr.short ? `: عندك ${ar(Math.floor(S.materials || 0))}، والباقي (${ar(pr.short)}) ينشرى من برا بـ${money(pr.short * MAT.price)} ريال (داخل في السعر). كسارة حجر توفر عليك.` : " من مخزونك."}</p>`;
}
/** A factory: how many farms feed it by road. A farm: which factory it sends to. */
function chainInfo(t, x, y) {
  const i = idx(x, y);
  const asFactory = A.chainAt?.get(i);
  if (asFactory) {
    const c = asFactory.chain;
    return `${row(`يجيه من ${B[c.from].name}`, `${ar(asFactory.got)} من ${ar(asFactory.need ?? c.need)}`, asFactory.fill >= 1 ? "plus" : "minus")}<i class="prog"><i style="width:${Math.round(asFactory.fill * 100)}%"></i></i>
      ${asFactory.fill < 1 ? `<p class="hint">🚚 يشتغل بـ${ar(Math.round((0.3 + 1.7 * asFactory.fill) / 2 * 100))}٪. يحتاج ${ar((asFactory.need ?? c.need) - asFactory.got)} ${B[c.from].name} زيادة موصولة به بطريق (المزرعة لازم يكون جنبها طريق يوصل للمصنع).</p>` : `<p class="hint">🚚 الشاحنات توصله كل اللي يحتاجه.</p>`}`;
  }
  const chains = CHAINS.filter((c) => c.from === t.b.id);
  if (!chains.length) return "";
  const link = A.chainLinks?.find((l) => l.from === i);
  if (link) return row("يرسل إنتاجه إلى", `${B[S.tiles[link.to].b.id].name} 🚚`, "plus");
  return `<div class="need">ما فيه ${chains.map((c) => B[c.to].name).join(" ولا ")} موصول بطريق. ${chains.map((c) => B[c.to].name).join(" أو ")} يضاعف قيمة إنتاجه.</div>`;
}
/** Production: each chain, and the building materials. */
function productionHtml() {
  const rows = CHAINS.map((c) => {
    const factories = [...(A.chainAt || new Map()).values()].filter((f) => f.chain.id === c.id);
    const producers = A.count[c.from] || 0;
    if (!factories.length && !producers) return "";
    const linked = factories.reduce((n, f) => n + f.got, 0), want = factories.length * c.need;
    return row(`${c.name}: ${B[c.from].name} ← ${B[c.to].name}`, factories.length ? `${ar(linked)}/${ar(want)} موصولة` : `${ar(producers)} بلا مصنع`, factories.length && linked >= want ? "plus" : "minus");
  }).join("");
  return `<h3>🏭 الإنتاج ومواد البناء</h3><div class="rows">
    ${row("مواد البناء بالمخزن", `${ar(Math.floor(S.materials || 0))} / ${ar(MAT.cap)}`)}
    ${row("تنتج بالساعة", `${ar(Math.round((A.matMade || 0) * 10) / 10)}`, A.matMade ? "plus" : "")}
    ${!A.matMade ? `<p class="hint">ما عندك كسارة: أي مواد تحتاجها للتطوير تنشرى من برا بـ${ar(MAT.price)} ريال للوحدة. الكسارة تنبني على الصخور.</p>` : (S.materials || 0) >= MAT.cap ? `<p class="hint">المخزن مليان: الزايد ينباع بـ${ar(MAT.sell)} للوحدة.</p>` : ""}
    ${rows || `<p class="hint">المزارع ترسل إنتاجها بالشاحنات للمصانع الموصولة فيها بطريق: النخل لمصنع التمور، الحظائر لمصنع الألبان وسوق الماشية، المحورية للصوامع، والكسارة لمصنع البلوك.</p>`}
  </div>`;
}
/** The next level's numbers for a farm, shop or workshop. */
const bizLevelNext = (b) => bizLevel({ id: b.id, lvl: b.lvl + 1 });
/** The bank: loans to take, loans running, and paying them off early. */
function bankSheet() {
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
/** Water and power: how much there is, who it does not reach, and a map of where it goes. */
function utilSheet() {
  sheet(`<h2>الماء والكهرباء</h2><p>كل بئر وخزان ومولد يوصل لمسافة محدودة. البيت اللي برا المسافة ما يجيه شي، حتى لو الكمية تكفي.</p>
    <h3>الماء</h3><div class="rows">
      ${row("المتوفر / المطلوب", `${money(A.waterSupply)} / ${money(A.waterUse)}`, A.waterRatio < 1 ? "minus" : "plus")}
      ${A.dryHomes ? `<div class="need">${ar(A.dryHomes)} بيت ما يوصلها ماء: ابنِ بئر قريب منها.</div>` : `<div class="need ok">الماء واصل لكل البيوت.</div>`}
      ${row("الماء الجوفي", `${ar(Math.round(A.aquifer))}٪`, A.aquifer < GROUND.low ? "minus" : "plus")}<i class="prog"><i style="width:${Math.round(A.aquifer)}%" class="${A.aquifer < GROUND.low ? "low" : ""}"></i></i>
      <p class="hint">الآبار والخزانات تسحب من الماء الجوفي، والمطر والسدود ترجّعه. إذا نزل تحت ${ar(GROUND.low)}٪ الآبار تعطي أقل${A.aquifer < GROUND.low ? ` (الحين ${ar(Math.round(A.groundFactor * 100))}٪ من ماها)` : ""}. التحلية ما تحتاجه.</p>
      ${A.count.dam ? row("بحيرة السد", `${ar(Math.round(S.lake || 0))}٪`, (S.lake || 0) > 10 ? "plus" : "") : ""}
      <button class="btn block" id="showWater" type="button">💧 اعرض وين يوصل الماء</button>
    </div>
    <h3>الكهرباء</h3><div class="rows">
      ${A.grid ? row("المتوفر / المطلوب", `${money(A.powerSupply)} / ${money(A.powerUse)}`, A.powerRatio < 1 ? "minus" : "plus") : `<div class="need">ما فيه كهرباء بالبلد. المولد ينفتح لما تصير بلدة، والفلل تحتاجها.</div>`}
      ${A.grid && A.darkHomes ? `<div class="need">${ar(A.darkHomes)} فيلا وعمارة ما توصلها الكهرباء.</div>` : ""}
      ${A.grid ? `<button class="btn block" id="showPower" type="button">⚡ اعرض وين توصل الكهرباء</button>` : ""}
    </div>`, "util");
  const show = (arr, color) => { const v = new Float32Array(N * N); arr.forEach((x, i) => { v[i] = x; }); closeSheet(); setTimeout(() => world.setOverlay(v, color), 200); setTimeout(() => { if (!tool) world.setOverlay(null); }, 6000); };
  $("showWater").addEventListener("click", () => show(A.watered, "#3b8fd6"));
  $("showPower")?.addEventListener("click", () => show(A.powered, "#9b5cf6"));
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
const advisorFee = () => (S.advisor?.used ? ADVISOR_FEE[Math.min(ADVISOR_FEE.length - 1, S.era)] : 0);
function advisorSheet() {
  if (arrange || visiting) { toast("افتح المستشار من مدينتك بعد ما تخلّص الترتيب", "bad"); return; }
  const age = S.day - S.advisor?.at;
  const fresh = age >= 0 && age < ADVISOR_HOURS;
  if (!fresh) {
    const fee = advisorFee(), poor = fee > 0 && fee > S.money;
    sheet(`<h2>💼 المستشار المالي</h2>
      <p>يقرأ مدينتك كلها: الفلوس، وكل حارة، والماء والكهرب، والوظايف، والزحمة، والمباني الواقفة. ويقول لك إذا كنت رابح أو خسران، ووش أكبر أخطاءك، وكيف تصلحها خطوة خطوة.</p>
      <p class="hint">الاستشارة صالحة ${ar(ADVISOR_HOURS)} ساعة باللعبة. سعرها حسب مرحلة مدينتك.</p>
      <div class="sheet-actions"><button class="btn go block" id="advPay" type="button" ${poor ? "disabled" : ""}>${fee ? `استشره بـ${money(fee)} ريال` : "استشره مجاناً (أول مرة)"}${poor ? " · ما يكفي المال" : ""}</button></div>`, "advisor");
    $("advPay").addEventListener("click", () => {
      const f = advisorFee();
      if (f > 0 && f > S.money) { toast("ما يكفي المال", "bad"); sfx.deny(); return; }
      if (f) changeMoney(S, -f, "advisor", "المستشار المالي");
      S.advisor = { at: S.day, used: true };
      sfx.coin(); refresh(); save(); advisorSheet();
    });
    return;
  }
  const r = advise(S, A), left = ADVISOR_HOURS - age;
  const mood = r.verdict === "مديون" || r.verdict === "خسران" ? "minus" : "plus";
  sheet(`<h2>💼 المستشار المالي</h2>
    <div class="rows">
      <div class="row"><span>وضعك</span><b class="${mood}">${r.verdict}</b></div>
      <div class="row"><span>الصافي بالساعة</span><b class="${r.net >= 0 ? "plus" : "minus"}">${r.net >= 0 ? "+" : "−"}${money(Math.abs(r.net))}</b></div>
    </div>
    ${r.good.length ? `<div class="need ok">👍 ${r.good.join(" ")}</div>` : ""}
    <h3>${r.findings.length ? "اللي يحتاج تصليح، الأهم أول" : "ما لقيت مشاكل تذكر 👏"}</h3>
    ${r.findings.slice(0, 7).map((f, k) => `<div class="adv-item">
      <b>${f.icon} ${ar(k + 1)}. ${f.title}</b>
      <p>${f.why}</p>
      <ol>${f.steps.map((st) => `<li>${st}</li>`).join("")}</ol>
      ${f.at >= 0 ? `<button class="btn small" type="button" data-advgo="${f.at}">📍 وريني</button>` : ""}
    </div>`).join("")}
    <p class="hint">الاستشارة صالحة ${ar(left)} ساعة باقية، والأرقام تتحدث كل ما فتحتها.</p>`, "advisor");
  $("sheetBody").querySelectorAll("[data-advgo]").forEach((b) => b.addEventListener("click", () => {
    const i = Number(b.dataset.advgo);
    closeSheet(); world.focus(i % N, Math.floor(i / N)); world.view.zoom = Math.max(world.view.zoom, 1.4); world.updateCamera();
    setTimeout(() => inspect(i % N, Math.floor(i / N)), 350);
  }));
}
$("advisorBtn").addEventListener("click", () => { sfx.tap(); advisorSheet(); });
$("warBtn").addEventListener("click", async () => { sfx.tap(); sheet(`<h2>⚔️ القيادة العسكرية</h2><p class="hint">نحمّل…</p>`, "war"); await warPoll(true); warSheet(); });
$("warSkip").addEventListener("click", () => { sfx.tap(); WARX.skipFlight = true; world.fx.skip(); });

function goals() {
  const done = GOALS.slice(0, S.goal).map((x) => `<div class="row done"><span>${x.text}</span><b class="plus">✓</b></div>`).join("");
  const early = S.goalsEarly || [];
  const next = GOALS.slice(S.goal, S.goal + 3).map((x, i) => early.includes(S.goal + i) ? `<div class="row done"><span>${x.text}</span><b class="plus">✓ استلمت ${money(x.reward)}</b></div>` : `<div class="row ${i ? "" : "now"}"><span>${x.text}</span><b>${money(x.reward)} ريال</b></div>`).join("");
  sheet(`<h2>المهام</h2><p>كل مهمة تعطيك مكافأة، ولو خلّصت وحدة من اللي تحت قبل اللي فوقها تستلمها على طول. أنجزت ${ar(S.goal + early.length)} من ${ar(GOALS.length)}.</p><div class="rows">${next}${done}</div>`, "goals");
}
$("goal").addEventListener("click", () => { sfx.tap(); goals(); });

// ---------- settings, saving, the main menu ----------

function settingsSheet(fromMenu) {
  const q = settings.quality, pushStatus = pushState();
  const id = me();
  if (pushStatus === "off" && id?.plot != null) pushKey().catch(() => {});
  const deviceCopy = id?.plot != null ? store.get(conflictCopyKey(id)) : null;
  const syncConflict = worldMode && (visiting?.home ?? S).world?.syncConflict;
  sheet(`<h2>الإعدادات</h2>
    <h3>الرسوم</h3><p>«عالية» فيها توهّج الانفجارات والأضواء وأعلى دقة. لو الجوال يسخن أو البطارية تخلص بسرعة، اختر «متوسطة» أو «خفيفة».</p>
    <div class="seg seg-wrap">${[["auto", "✨ تلقائي"], ["saver", "🔋 توفير"], ["low", "خفيفة"], ["medium", "متوازنة"], ["high", "عالية"], ["ultra", "فائقة"]].map(([k, n]) => `<button type="button" class="${q === k ? "on" : ""}" data-q="${k}">${n}</button>`).join("")}</div>
    <p class="hint">${{ auto: "يختار لحاله حسب جوالك، ويخفف إذا الجوال تعب أو سخن، ويرجع يرفع إذا ارتاح.", saver: "أقل استهلاك للبطارية والحرارة: ٣٠ إطار بالكثير، بدون ظلال ولا زحمة سيارات.", low: "للجوالات الضعيفة: بدون ظلال ولا توهج.", medium: "جودة حلوة واستهلاك معتدل.", high: "ظلال ناعمة وتوهج الأضواء بالليل، ٦٠ إطار.", ultra: "أعلى دقة وأنعم ظلال، للجوالات والكمبيوترات القوية." }[q]}</p>
    <div class="rows" style="margin-top:10px">
      ${isAndroid && document.documentElement.requestFullscreen ? `<label class="row toggle"><span>📱 شاشة كاملة <small>(بدون أشرطة المتصفح)</small></span><input type="checkbox" id="setFull" ${store.get("rafaya-fullscreen") !== "0" ? "checked" : ""}></label>` : ""}
      <label class="row toggle"><span>الأصوات</span><input type="checkbox" id="setSound" ${sfx.on ? "checked" : ""}></label>
      <label class="row toggle"><span>أصوات الحرب (إنذار وانفجارات)</span><input type="checkbox" id="setWarSound" ${warSfx.on ? "checked" : ""}></label>
      ${pushStatus !== "no" ? `<label class="row toggle"><span>🔔 التنبيهات على الجوال <small>(عالم الجوف)</small></span><input type="checkbox" id="setPush" ${pushStatus === "on" ? "checked" : pushStatus === "checking" ? "disabled" : ""}></label>` : ""}
    </div>
    ${me()?.plot != null ? `<h3>🔔 تنبيهات الجوف</h3><p>الهجوم والحرب، ولما أحد يذكرك بالشات، ولما مواطنينك يبونك. حتى واللعبة مسكّرة.</p>
    <div class="rows">${(() => { const st = pushStatus; return st === "checking" ? `<p class="hint">نتأكد من اشتراك هالجهاز…</p>` : st === "on" ? `<button class="btn go block" id="pushTest" type="button">📲 جرّب التنبيه</button><div id="pushTestStatus" role="status" aria-live="polite"></div>` : st === "denied" ? `<button class="btn block" id="pushDenied" type="button">🔒 التنبيهات مقفلة: كيف أرجّعها؟</button>` : st === "no" ? `<div class="need">${isIOS ? "تنبيهات الآيفون تحتاج iOS 16.4 أو أحدث، واللعب من أيقونة الشاشة الرئيسية." : "هالمتصفح ما يدعم التنبيهات. جرّب Chrome أو متصفح يدعم إشعارات المواقع."}</div>` : `<p class="hint">شغّلها من «🔔 التنبيهات على الجوال» فوق.</p>`; })()}</div>` : ""}
    ${isIOS && !standalone() && onlineOk() && !globalThis.RAFAYA_PREVIEW ? `<h3>📲 التطبيق</h3><p>حاط اللعبة تطبيق بشاشتك؟ انقل لها لعبتك من هنا.</p><button class="btn block" id="moveCode" type="button">📲 انقل لعبتك للتطبيق</button>` : ""}
    ${me()?.plot != null ? `<h3>🔄 مدينتك بالجوف</h3><p>تبي تبدأ من الصفر؟ نفس الأرض ونفس الاسم، بس كل شي يرجع من أول.</p><button class="btn danger block" id="worldRestart" type="button">🔄 ابدأ مدينتي من جديد</button>` : ""}
    <h3>نسخة احتياطية</h3>
    <p>المدينة تنحفظ لحالها في جوالك. تبي تنقلها لجهاز ثاني؟ اطلع لها كود قصير، واكتبه بالجهاز الثاني. الكود يبقى ٦٠ يوم.</p>
    <div id="backupBox"></div>
    <div class="sheet-actions two"><button class="btn" id="copySave" type="button">🔑 اطلع كود</button><button class="btn" id="loadSave" type="button">استرجع من كود</button></div>
    ${syncConflict ? `<button class="btn block" id="saveConflict" type="button">مزامنة حفظ المدينة</button>` : ""}
    ${deviceCopy ? `<button class="btn block" id="copyDeviceSave" type="button">نسخة الجهاز قبل المزامنة</button>` : ""}
    <h3>عن اللعبة</h3>
    <p>صُنعت في الرافعية بيد Vamos. الرسم ثلاثي الأبعاد بمكتبة three.js (ترخيص MIT)، وكل المباني مصممة داخل اللعبة.</p>`, fromMenu ? "settings-menu" : "settings");
  $("sheetBody").querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => {
    store.set("rafaya-quality", b.dataset.q); save();
    toast("نطبّق الإعداد…"); setTimeout(() => location.reload(), 300);
  }));
  $("moveCode")?.addEventListener("click", () => moveCodeSheet());
  $("worldRestart")?.addEventListener("click", () => restartSheet());
  $("saveConflict")?.addEventListener("click", saveConflictSheet);
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
        const r = await (await fetch(API + "/move/backup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: await gzipText(snapshot), old: store.get("rafaya-backup-code") || "" }) })).json();
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

/** The guide: how to play, how the town grows into a city, and how to upgrade. */
function howTo(fromMenu) {
  const next = ERAS[S.era + 1];
  const pct = next ? Math.min(100, Math.round((S.pop / next.pop) * 100)) : 100;
  const opens = (e) => Object.values(B).filter((d) => d.era === e.id && d.cat !== "road" && d.cat !== "deco").map((d) => d.name).slice(0, 6).join("، ");
  const step = (n, text) => `<div class="row g-step"><b class="g-n">${ar(n)}</b><span>${text}</span></div>`;
  sheet(`<h2>شرح اللعبة</h2>
    <p>أنت عمدة الرافعية. تبدأ بثلاث خيام وبئر جنب الوادي، وهدفك تكبّرها من قرية إلى بلدة ثم مدينة ثم محافظة، وأهلها مبسوطين وميزانيتها سليمة.</p>
    <div class="g-now"><div class="row"><span>الرافعية الحين</span><b>${ERAS[S.era].name}</b></div>
      ${next ? `<div class="row"><span>عشان تصير «${next.name}»</span><b>${money(S.pop)} / ${money(next.pop)} ساكن</b></div><i class="prog"><i style="width:${pct}%"></i></i>` : `<div class="need ok">وصلت أعلى مرحلة 🎉</div>`}</div>

    <details open><summary>البداية خطوة بخطوة</summary><div class="rows">
      ${step(1, "انصب خيام جنب الطريق (من «سكن»). كل خيمة يسكنها ٣.")}
      ${step(2, "احفر بئر قريب منها: البئر يوصل الماء لين ٥ مربعات بس.")}
      ${step(3, "ازرع نخل في الوادي وافتح بقالة: وظائف ودخل.")}
      ${step(4, "طوّر الخيام إلى بيوت طين عشان يسكن ناس أكثر.")}
      ${step(5, "ابنِ مسجد ومدرسة لما يكثر الناس: يرفعون الرضا ويخلون البيوت تتطور.")}
      ${step(6, "تابع «المهمة» فوق: كل مهمة تعطيك مكافأة تغطي تكلفتها.")}
    </div></details>

    <details><summary>كيف تصير بلدة ومدينة؟</summary>
      <p>المرحلة تتحدد بعدد السكان. والسكان يجون إذا فيه بيوت فاضية والناس مبسوطين، ويطلعون إذا زعلوا.</p>
      <div class="rows">${ERAS.map((e) => `<div class="row ${e.id === S.era ? "now" : e.id < S.era ? "done" : ""}"><span><b>${e.name}</b><small>${e.pop ? `من ${money(e.pop)} ساكن` : "البداية"}${opens(e) ? ` · تفتح: ${opens(e)}` : ""}</small></span><b>${e.id < S.era ? "✓" : e.id === S.era ? "الحين" : ""}</b></div>`).join("")}</div>
      <p>عشان يزيد السكان: بيوت أكثر وأكبر، ماء وكهرباء واصلة، وظائف، وخدمات قريبة (مسجد، مدرسة، مستوصف، حديقة)، وضريبة معقولة.</p>
    </details>

    <details><summary>التطوير</summary>
      <p><b>البيوت:</b> اضغط على البيت أو اختر «سكن ← تطوير البيوت». كل مستوى يسكّن ناس أكثر:</p>
      <div class="rows">${B.house.levels.map((l, k) => `<div class="row"><span><b>${l.name}</b><small>${k ? `${money(l.cost)} ريال · يحتاج: ${[l.needs.road && "طريق", l.needs.water && "ماء واصل", l.needs.power && "كهرباء واصلة", l.needs.happy && `رضا ${ar(l.needs.happy)}٪`, l.needs.services && `${ar(l.needs.services)} خدمات قريبة`, l.era && `تكون ${ERAS[l.era].name}`].filter(Boolean).join("، ")}` : "تنصبها من «سكن»"}</small></span><b>${ar(l.cap)} ساكن</b></div>`).join("")}</div>
      <p><b>المحلات والمزارع والورش:</b> لها ٣ مستويات. اضغط عليها أو اختر «تطوير» من قسمها. المستوى الثاني يزيد الدخل ٦٠٪، والثالث يضاعفه، ويحتاج تكون بلدة مع كهرباء (للمحلات) أو ماء (للمزارع).</p>
      <p><b>الأبحاث:</b> من «المجلس» تبحث أشياء تفتح مباني وتزيد الإنتاج.</p>
    </details>

    <details><summary>الفلوس</summary><div class="rows">
      <div class="row"><span>الدخل</span><b>ضرائب، محلات، مزارع، ورش، زوار</b></div>
      <div class="row"><span>المصروف</span><b>رواتب، نظافة، صيانة، تشغيل المباني</b></div>
      <div class="row"><span>المحلات</span><b>تبيع على قد اللي يصرفه أهل البلد</b></div>
      <div class="row"><span>الورش والمصانع</span><b>تبيع لبرا، والزايد بثلث السعر</b></div>
      <div class="row"><span>البنك (من «تجارة»)</span><b>قروض تسددها بالساعة مع فايدة</b></div>
      <div class="row"><span>الضريبة (من «الأرقام»)</span><b>أعلى = دخل أكثر ورضا أقل</b></div>
      </div><div class="need">لو صارت الديون كبيرة تفلس البلدية وتقفل الخدمات. تابع «الأرقام» دايم.</div></details>

    <details><summary>الماء والكهرباء</summary>
      <p>كل بئر وخزان ومولد يوصل لمسافة محدودة. البيت اللي برا المسافة ما يجيه شي. اضغط مربع الماء والكهرباء فوق عشان تشوف وين واصل، ولما تمسك بئر أو مولد يبين لك وين بيوصل.</p></details>

    <details><summary>الخسائر والصيانة</summary>
      <p>المباني تخرب مع الوقت: رمّمها من «الأرقام» أو بالضغط عليها، وإلا تخرب وتطيح. السيل ينزل الوادي وقت المطر ويجرف اللي فيه. التأمين (من «الأرقام») يعوضك ٧٠٪. وكل سنة فيه رسوم للمحافظة وعلاوة للموظفين.</p></details>

    <details><summary>عالم الجوف (أونلاين)</summary>
      <p>من الشاشة الرئيسية «🌍 عالم الجوف»: تختار اسمك (واحفظ كود الاسترجاع)، وتختار أرض في خريطة الجوف وتأسس مدينتك: القريات وطبرجل وسكاكا ودومة الجندل والحماد والنفود الكبير، كل منطقة لها أرضها. وتضغط على أي مدينة بالخريطة وتدخلها وتشوفها وتعلق عليها.</p>
      <p>وقت العالم واحد للكل ويمشي دايم، فما فيه تسريع. وإذا طلعت يمسك مدينتك «نائب العمدة» حسب أوامرك (من القائمة)، ومعه «درع الغياب»: ما تفلس، وما تخسر أكثر من ٥٪ من ناسك باليوم، وبعد أسبوع غياب تنام مدينتك لين ترجع. وأول ما ترجع يعطيك تقريره.</p></details>

    <details><summary>المنطقة والمدن الثانية</summary>
      <p>لما تصير الرافعية بلدة تنفتح «خريطة المنطقة» (اضغط مربع الوقت فوق، أو من القائمة). تأسس فيها مدن المنطقة: «الرديفة» في روضة تخضر بالربيع، و«الأضارع» في أرض جبلية فيها حجر كثير، و«صفان» في النفود: رمل واسع بلا وادي.</p>
      <p>وصّل المدن بطرق: ناسها يتسوقون عند بعض وتجارها يشترون من ورش بعض. وتقدر تحوّل فلوس من مدينة لثانية. المدن اللي ما أنت فيها توقف لين ترجع لها. وإذا صار عندك ٣ مدن صرت «أمير المنطقة».</p></details>

    <details><summary>أهل الرافعية</summary>
      <p>كل بيت ساكنة فيه عوايل حقيقية: أسماءهم، ووين يشتغل الأب، وكم عيل عندهم، ووش يتمنون. اضغط على أي بيت وشوف «العوايل»، واضغط «تابع» تمشي معه وهو رايح دوامه. واللي يكتبون في النشرة ناس من الديرة، وتقدر تروح لبيت أي واحد منهم.</p></details>

    <details><summary>المرور والزحمة</summary>
      <p>الصبح والعصر الناس يطلعون من بيوتهم لدوامهم بسياراتهم. كل طريق يشيل عدد سيارات: الترابي قليل، والمسفلت ضعفه، و«الشارع الرئيسي» أكثر بكثير. التقاطعات تتزحم أكثر، و«الدوار» و«إشارة المرور» يفكونها، و«المواقف» جنب المحلات تخفف الطرق وتزيد البيع.</p>
      <p>الزحمة تأخر الموظفين، وتبعد الزباين، وتزعّل اللي ساكنين على الشارع. شوفها من «الأرقام ← اعرض الزحمة»، أو اضغط على أي طريق.</p></details>

    <details><summary>سلاسل الإنتاج ومواد البناء</summary>
      <p>المزارع ترسل إنتاجها بالشاحنات للمصانع، بس لازم طريق يوصل بينهم: النخل لمصنع التمور، الحظائر لمصنع الألبان وسوق الماشية، المزارع المحورية للصوامع، والكسارات لمصنع البلوك. المصنع يشتغل كامل إذا وصله العدد اللي يحتاجه.</p>
      <p>تطوير البيوت الكبيرة والمحلات يحتاج مواد بناء. «كسارة حجر» تنبني على الصخور وتطلّعها، وإذا ما عندك تنشرى من برا غالي. تابعها في «الأرقام».</p></details>

    <details><summary>السدود والماء الجوفي</summary>
      <p>تحت الرافعية ماء جوفي: الآبار والخزانات والمزارع المحورية تسحب منه، والمطر يرجّعه. إذا نزل كثير الآبار تعطي أقل. تابعه من مربع الماء فوق.</p>
      <p>«السد» (بعد بحث «سدود الأودية») ينبني على الوادي: يحجز السيل عن كل اللي بعده، ويجمع المطر في بحيرة وراه تفرّح الناس حولها وتغذي الماء الجوفي. و«ردم الوادي» يحوّل أرض الوادي لأرض عادية ما يجيها سيل.</p></details>

    <details><summary>الصلاة والحلال</summary>
      <p>خمس صلوات باليوم. وقت الصلاة يطلع لك تنبيه، والرجال يمشون للمسجد، والمحلات تسكر شوي ويقل بيعها. ابنِ مسجد قريب من البيوت.</p>
      <p>«حظيرة حلال» (من «زراعة وصناعة») تجيب دخل، وفي الربيع ترعى في الفيضة القريبة ويزيد دخلها النص. «سوق الماشية» يزيد دخله مع كل حظيرة، و«ميدان مزاين الإبل» مشروع كبير يجيب الزوار.</p></details>

    <details><summary>الحارات والانتخابات</summary>
      <p>من «المجلس ← حارات الرافعية» تشوف كل حارة: كم بيت فيها، ورضا أهلها، وش ناقصها، وتسميها بالاسم اللي تبيه.</p>
      <p>آخر كل سنة فيه انتخابات للمجلس البلدي. الأصوات تجي من رضا الناس وثقتهم والوعود اللي وفيت فيها. إذا فزت تجيك منحة من المحافظة، وإذا خسرت تتضاعف رسومها السنة الجاية. تابع التوقعات في «المجلس».</p></details>

    <details><summary>الناس والنشرة والقرارات</summary>
      <p>في «النشرة» الأهالي يتكلمون عن اللي ناقصهم واللي مبسوطين فيه، وترد عليهم بوعد أو تسكيت أو رفض. الوعد لازم توفي فيه. ومرة كل كم يوم يجيك قرار من المجلس تختار فيه.</p></details>

    <details><summary>الأدوات</summary><div class="rows">
      <div class="row"><span>اسحب بإصبع / بإصبعين</span><b>تتحرك / تكبّر وتصغّر</b></div>
      <div class="row"><span>زر «لفّ»</span><b>تدوّر المنظر</b></div>
      <div class="row"><span>اختر من تحت، اضغط مكانه، ثم ✓</span><b>تبني</b></div>
      <div class="row"><span>اسحب بالطريق ثم ✓</span><b>ترسمه مرة وحدة</b></div>
      <div class="row"><span>«✏️ تعديل»: اختر مبنى واسحبه</span><b>تنقله أو تبادله مع غيره ببلاش، و↻ تلفه</b></div>
      <div class="row"><span>«✏️ تعديل» ← 🗑️</span><b>تشيل المبنى أو الطريق أو الصخر (يرجع لك ثلث سعره)</b></div>
      <div class="row"><span>↶ و ↷، ثم ✓</span><b>ترجع وتعيد، وما ينحسب شي إلا بعد ✓</b></div>
      <div class="row"><span>اضغط على الأرض ورا السياج</span><b>تشتريها وتكبر فيها</b></div>
      <div class="row"><span>اضغط على أي مبنى</span><b>تشوف وش ينقصه</b></div>
      <div class="row"><span>القائمة ← الإنجازات</span><b>تشوف وش حققت</b></div>
    </div></details>`, fromMenu ? "settings-menu" : "how");
}

function pauseMenu() {
  if (visiting) { // looking at someone else's town: a short menu, and the way home
    sheet(`<h2>القائمة</h2><p class="hint">أنت تتفرج على مدينة غيرك. ما تقدر تغيّر فيها شي.</p><div class="rows">
      <button class="row link" id="pmBack" type="button"><span>🏠 ارجع لمدينتك</span><b>←</b></button>
      <button class="row link" id="pmHow" type="button"><span>❓ الشرح</span><b>←</b></button>
      <button class="row link" id="pmResume" type="button"><span>كمّل التفرج</span><b>←</b></button></div>`, "pause");
    $("pmBack").addEventListener("click", () => leaveVisit());
    $("pmHow").addEventListener("click", () => howTo(false));
    $("pmResume").addEventListener("click", closeSheet);
    return;
  }
  sheet(`<h2>القائمة</h2><div class="rows">
    <button class="row link" id="pmResume" type="button"><span>كمّل اللعب</span><b>←</b></button>
    <button class="row link" id="pmHow" type="button"><span>❓ الشرح</span><b>←</b></button>
    <button class="row link" id="pmNew" type="button"><span>وش الجديد؟</span><b>←</b></button>
    ${worldMode ? `<button class="row link" id="pmWorld" type="button"><span>🌍 خريطة عالم الجوف</span><b>←</b></button>
    <button class="row link" id="pmDeputy" type="button"><span>🧑‍💼 أوامر نائب العمدة</span><b>←</b></button>` : `<button class="row link" id="pmRegion" type="button"><span>🗺️ خريطة المنطقة</span><b>←</b></button>`}
    <button class="row link" id="pmAch" type="button"><span>الإنجازات</span><b>${ar(ACHIEVEMENTS.filter((x) => S.ach?.[x.id]).length)}/${ar(ACHIEVEMENTS.length)}</b></button>
    <button class="row link" id="pmSettings" type="button"><span>الإعدادات والنسخة الاحتياطية</span><b>←</b></button>
    <button class="row link" id="pmMain" type="button"><span>القائمة الرئيسية</span><b>←</b></button>
  </div>`, "pause");
  $("pmResume").addEventListener("click", closeSheet);
  $("pmHow").addEventListener("click", () => howTo(false));
  $("pmNew").addEventListener("click", () => whatsNewSheet());
  $("pmRegion")?.addEventListener("click", () => regionSheet());
  $("pmWorld")?.addEventListener("click", () => worldMapSheet());
  $("pmDeputy")?.addEventListener("click", () => deputySheet());
  $("pmAch").addEventListener("click", () => achievementsSheet());
  $("pmSettings").addEventListener("click", () => settingsSheet(false));
  $("pmMain").addEventListener("click", () => { save(); leaveWorld(); closeSheet(); showMenu(); menuBackdrop(); });
}
$("pauseMenuBtn").addEventListener("click", () => { sfx.tap(); pauseMenu(); });

function showMenu() {
  playing = false;
  setTool(null); openCat = null; renderCards();
  document.body.classList.add("at-menu");
}

/** Look at the middle of everything built so far. */
function focusTown() {
  let sx = 0, sy = 0, n = 0;
  S.tiles.forEach((t, i) => { if (t.b) { sx += i % N; sy += Math.floor(i / N); n++; } });
  if (n) world.focus(Math.round(sx / n), Math.round(sy / n)); else world.focus(N / 2, N / 2);
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
// The phone left on all night is "away" too: from the last touch the town gains at most AWAY_CAP for its
// stage, like a mayor who left the game. The money from before is never touched. A touch ends it.
const IDLE_MS = () => globalThis.__idleMs || 15 * 60000; // (tests shorten it)
let lastTouch = Date.now();
function idleCheck() {
  if (!worldMode || visiting || !S.world) return;
  if (!S.idle && Date.now() - lastTouch > IDLE_MS()) {
    S.idle = { money: Math.round(S.money) };
    toast(`😴 ما لمست اللعبة من ربع ساعة: النائب ماسك البلد. أكثر شي تكسبه لين ترجع ${money(idleCap())} ريال`, "season");
  }
}
const idleCap = () => AWAY_CAP[Math.min(AWAY_CAP.length - 1, S.era)] ?? AWAY_CAP[0];
/**
 * Asleep: the balance never goes above where it was plus the cap. What is above is kept aside (pool),
 * and any bill that comes later (the province fee, repairs, war) is paid from it first, so the cap never
 * makes the mayor pay a bill from his own money that the extra income would have paid.
 */
function idleClamp() {
  if (!S?.idle) return;
  const top = S.idle.money + idleCap();
  S.idle.pool ||= 0;
  if (S.money > top) {
    S.idle.pool += S.money - top;
    changeMoney(S, top - S.money, "idleLimit");
  } else if (S.money < top && S.idle.pool > 0) {
    const add = Math.min(S.idle.pool, top - S.money);
    changeMoney(S, add, "idleCover");
    S.idle.pool -= add;
  }
}
function idleWake() {
  lastTouch = Date.now();
  if (!S?.idle) return;
  const gained = Math.round(S.money - S.idle.money);
  S.idle = null;
  if (worldMode) toast(`☀️ هلا بك! وانت غافي ${gained >= 0 ? "كسبت" : "صرفت"} ${money(Math.abs(gained))} ريال`, "goal");
}
for (const ev of ["pointerdown", "keydown", "wheel"]) addEventListener(ev, idleWake, { capture: true, passive: true });
function runHour() {
  idleCheck();
  const { msgs } = step(S);
  idleClamp();
  for (const m of msgs) {
    if (m.kind === "decision") continue; // its own sheet opens
    if (m.kind === "land") continue; // the ground is redrawn by the sync below
    if (m.kind === "ach") { toast(m.text, "ach"); sfx.goal(); continue; }
    if (m.kind === "flood") {
      // look at the wadi where the water comes down, then let it run
      const spots = m.lost.length ? m.lost : m.damaged;
      if (spots.length) { const cx = spots.reduce((n, i) => n + (i % N), 0) / spots.length, cy = spots.reduce((n, i) => n + Math.floor(i / N), 0) / spots.length; world.focus(Math.round(cx), Math.round(cy)); world.view.zoom = Math.min(world.view.zoom, 1.1); world.updateCamera(); }
      world.playFlood(m.lost, m.damaged); sfx.flood(); toast(m.text, "bad"); continue;
    }
    if (m.kind === "collapse") { toast(m.text, "bad"); sfx.remove(); continue; }
    if (m.kind === "bolt") { world.lightning(m.i); sfx.thunder(0.95, 0.05); if (m.text) toast(m.text, "bad"); continue; }
    if (m.kind === "election") { electionSheet(m); continue; }
    toast(m.kind === "season" ? m.text : m.title ? `${m.title}: ${m.text}` : m.text, m.kind === "goal" ? "goal" : m.kind === "era" ? "era" : m.kind === "season" ? `season ${seasonOf(S.day).id}` : "");
    (m.kind === "era" ? sfx.era : m.kind === "goal" ? sfx.goal : m.kind === "event" || m.kind === "season" ? sfx.event : sfx.coin)();
    if (m.kind === "era" && openCat) renderCards();
    if (m.kind === "era" && S.era === REGION.unlockEra && (S.site || "main") === "main") setTimeout(() => toast("🗺️ انفتحت خريطة المنطقة: اضغط على مربع الوقت فوق وأسس الرديفة والأضارع وصفان", "era"), 2500);
  }
  sync(false);
  // Rush hours: the first hours of the morning and the afternoon.
  { const h = hourOf(S.day), D = seasonOf(S.day).daylight * HOURS; world.rush = h <= 2 || (h >= Math.round(D * 0.75) && h <= Math.round(D * 0.75) + 1); world.trafficCong = A.trafficCong;
    // القايلة: in summer the streets empty at midday, everyone stays in from the heat
    world.siesta = seasonOf(S.day).id === "summer" && h >= Math.round(D * 0.4) && h < Math.round(D * 0.7); }
  // Prayer time: a soft call, and the men walk to the mosque.
  const pr = prayerNow(S);
  world.prayer = pr;
  if (pr && speed <= 5) { toast(`🕌 حان وقت صلاة ${pr.name}${A.count.mosque + A.count.bigmosque ? "" : " · وما فيه مسجد بالرافعية"}`, ""); sfx.prayer(); }
  refresh();
  save();
  hourEffects();
  hourNews(msgs);
  if (sheetFor === "budget") budget();
  if (sheetFor === "council") council();
}

/**
 * Phones get hot when a page draws at the screen's full rate (120 a second on newer iPhones) all the time.
 * So the town draws 30 times a second when nothing moves fast, and faster only while a finger is on the
 * screen, the camera turns, or a war scene or a building's rise is playing.
 */
let lastDraw = 0;
/**
 * The adaptive quality. It watches, over seconds and not single frames:
 * - how long the game takes to draw a frame;
 * - how late the frames come against the frame rate asked for (a busy GPU or a hot phone shows as late frames).
 * Phones give no reliable temperature to a web page, so heat is read from sustained slowness.
 * Steps (world.setLevel): 1 a little less sharp, 2 no shadows, 3 less sharp still, 4 at most 30 frames a second.
 * Down after 6 s of trouble; up only after 25 s of ease and never within a minute of going down (no flicker).
 * In «auto» it moves both ways; a fixed choice only takes the first two steps down, as a safety net.
 */
const perf = { cpu: 4, late: 1, since: 0, easy: 0, level: 0, downAt: 0, lastAt: 0, warm: performance.now() + 8000 };
let fpsBusy = RENDER.busy, fpsIdle = RENDER.idle;
function perfSet(level, now) {
  const max = RENDER.adapt ? 4 : 2;
  level = Math.max(0, Math.min(max, level));
  if (level === perf.level) return;
  if (level > perf.level) perf.downAt = now;
  perf.level = level;
  world.setLevel(Math.min(3, level));
  fpsBusy = level >= 4 ? Math.min(30, RENDER.busy) : RENDER.busy;
}
function perfWatch(ms, now, wanted, busy) {
  const gap = perf.lastAt ? now - perf.lastAt : wanted; perf.lastAt = now;
  if (ms > 150 || gap > 1000) perf.warm = now + 4000; // a town being built or opened (one-off work): a few seconds don't count
  if (document.hidden || WARX.scene || now < (perf.warm || 0)) { perf.since = perf.easy = 0; return; } // back from the background, or a war scene: not a measure
  perf.cpu = perf.cpu * 0.95 + ms * 0.05;
  if (busy) perf.late = perf.late * 0.92 + Math.min(4, gap / wanted) * 0.08; // only frames that were meant to come fast say if they are late
  else perf.late = perf.late * 0.995 + 0.005; // calm frames are slow on purpose: lateness fades, so the quality may come back
  const budget = 1000 / RENDER.busy;
  const trouble = perf.cpu > budget * 0.75 || perf.late > 1.35, ease = perf.cpu < budget * 0.35 && perf.late < 1.1;
  if (trouble) { perf.easy = 0; perf.since ||= now; if (now - perf.since > 6000 && now - perf.downAt > 6000) { perf.since = 0; perf.late = 1; perfSet(perf.level + 1, now); } return; } // one step at a time, 6 s apart at least
  perf.since = 0;
  if (!RENDER.adapt || !ease || !perf.level) { perf.easy = 0; return; }
  perf.easy ||= now;
  if (now - perf.easy > 25000 && now - perf.downAt > 60000) { perf.easy = 0; perfSet(perf.level - 1, now); }
}
try { localStorage.removeItem("rafaya-perf-level"); localStorage.removeItem("rafaya-perf-quality"); } catch { /* fine */ }
// the trial copy and ?debug: a small meter in a corner (frames a second, the adaptive step, sharpness, what is drawn)
const perfHud = (globalThis.RAFAYA_PREVIEW || new URLSearchParams(location.search).has("debug")) ? document.body.appendChild(Object.assign(document.createElement("div"), { id: "perfHud" })) : null;
if (perfHud) {
  perfHud.style.cssText = "position:fixed;z-index:50;left:8px;bottom:calc(var(--dock-space,0px) + 8px);padding:4px 8px;border-radius:8px;background:rgba(0,0,0,.62);color:#fff;font:600 11px/1.35 ui-monospace,monospace;direction:ltr;pointer-events:none";
  let frames = 0, t0 = performance.now();
  perfHud.tick = () => { frames++; const t = performance.now(); if (t - t0 < 1000) return;
    const fps = Math.round(frames * 1000 / (t - t0)); frames = 0; t0 = t;
    perfHud.textContent = `${fps} fps · ${settings.quality} L${perf.level} · ${world.renderer.getPixelRatio().toFixed(2)}x · ${world.renderer.shadowMap.enabled ? "shadows" : "no shadows"} · ${world.drawnBuildings ?? 0} bld${world.lodFar ? " far" : ""}`; };
}
function frame(now) {
  const busy = pointers.size > 0 || drag || world.fx?.tasks.length || world.fx?.parts3.length || world.floodAnim || world.anims?.size || Math.abs(world.view.yaw - world.view.yawTarget) > 1e-3 || arrange;
  // behind an open sheet, or on the main menu, the town barely needs to move
  const quiet = !busy && (!playing || (!$("sheet").hidden && !WARX.scene));
  const flying = !playing && MENU.town; // the menu's flight over your town: smooth, not the 15 frames of a still menu
  const wanted = 1000 / (busy ? fpsBusy : (quiet && !flying) || S?.idle ? 15 : fpsIdle);
  if (now - lastDraw < wanted - 2) { requestAnimationFrame(frame); return; } // nobody watching: slow, cool and kind to the battery
  lastDraw = now;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const paused = ["away", "pause", "settings", "how", "decision", "election", "whatsnew", "update"].includes(sheetFor);
  if (arrange || (worldMode && S.world?.syncConflict)) { /* wait for the layout or save to be settled */ } else if (playing && !visiting && worldMode) {
    // the world's clock: one town hour every 50 seconds of real time, for everyone, always
    const wh = worldHourNow();
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
  if (playing && S.decision && $("sheet").hidden) decisionSheet();
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
  else if (playing) {
    refresh();
    if (!sheetFor) saveConflictSheet();
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
