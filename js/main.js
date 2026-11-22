// الرافعية: the game loop, the controls, the main menu and every screen around the 3D town.
import { B, CATS, TECH, GOALS, ERAS, EVENTS, DECISIONS, ACHIEVEMENTS, MAP_SIZE as N, HOURS, SEASON_DAYS, PLOTS, LOANS, SUBSIDY, BIZ_LEVELS, bizLevel, DISTRICT_NAMES, ELECTION_GRANT, PROVINCE_FEES } from "./data.js";
import { newGame, step, build, demolish, cantBuild, analyze, houseBlocker, upgradeHouse, upgradeCost, upgradeAt, upgradeBlocker, upgradable, levelName, decide, optionCost, repair, repairAll, repairCost, condFactor, seasonOf, dayOf, hourOf, owns, plotAt, plotPrice, buyPlot, startResearch, prayerNow, districtOf, districtName, districtStats, voteShare, hoursToElection, moveCost, moveBlocker, moveBuilding, creditLimit, loanBlocker, loanPer, takeLoan, payLoan, payoffCost, catchUp, pack, unpack, idx, inMap, ROCK_CLEAR, techUnlocked } from "./sim.js";
import { World, thumbnail } from "./world3d.js";
import { modelKey } from "./models.js";
import { sfx, ambience } from "./sound.js";
import { writePosts, followUps, decisionReaction, replyOptions, answerPost, moodOf } from "./news.js";

const $ = (id) => document.getElementById(id);
const AR = "٠١٢٣٤٥٦٧٨٩";
const ar = (n) => String(n).replace(/\d/g, (d) => AR[d]);
const money = (n) => ar(Math.round(n).toLocaleString("en-US"));
/** Money with one decimal for small amounts (٠٫٦) and whole numbers otherwise. */
const fine = (n) => (Math.abs(n) < 10 && Math.round(n) !== n ? ar(n.toFixed(1)).replace(".", "٫") : money(n));
const SAVE = "rafaya-save-v1";
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode: the game still runs */ } }
};
const settings = { quality: store.get("rafaya-quality") || (matchMedia("(pointer: coarse)").matches ? "medium" : "high"), daynight: store.get("rafaya-daynight") !== "0" };

// ---------- state ----------

let S = null;
try { const raw = store.get(SAVE); if (raw) S = unpack(raw); } catch { S = null; }
const hadSave = !!S;
if (!S) S = newGame();
let A = analyze(S);
let playing = false;
let speed = 1;
let tool = null; // { id } | { id: "bulldoze" } | null (look around)
let openCat = null;
// A town day is 24 hours and lasts 20 minutes at normal speed (50 seconds an hour).
// The town moves forward one step every hour. Days start at sunrise; how much of the day is
// light depends on the season (spring and autumn 10 min + 10 min, summer 12 + 8, winter 8 + 12).
const HOUR_MS = 50000;
/** Where the sun is (0 midnight … 0.5 noon) for how far we are through the day (p: 0 = sunrise). */
const sunAt = (p, d) => (p < d ? 0.25 + (p / d) * 0.5 : 0.75 + ((p - d) / (1 - d)) * 0.5) % 1;
function partOfDay(p, d) {
  if (p < d) { const q = p / d; return q < 0.15 ? "الصبح" : q < 0.4 ? "الضحى" : q < 0.55 ? "الظهر" : q < 0.85 ? "العصر" : "المغرب"; }
  return (p - d) / (1 - d) < 0.85 ? "الليل" : "الفجر";
}
/** A clock reading such as ٤:٣٠ م. Sunrise is earlier on long summer days. */
function clockAt(p, d) {
  const h = (12 - d * 12 + p * 24) % 24, hh = Math.floor(h), mm = Math.floor((h - hh) * 6) * 10;
  return `${ar(((hh + 11) % 12) + 1)}:${ar(String(mm).padStart(2, "0"))} ${hh < 12 ? "ص" : "م"}`;
}

function save() { S.cam = { x: world.view.x, z: world.view.z, zoom: world.view.zoom, yawTarget: world.view.yawTarget }; S.savedAt = Date.now(); store.set(SAVE, pack(S)); }

// ---------- the 3D town ----------

const canvas = $("map");
const world = new World(canvas, { quality: settings.quality });
world.dayCycle = settings.daynight;
// Only trust a saved 3D camera (saves from the old 2D map used other numbers).
const camOk = (c) => c && [c.x, c.z, c.zoom, c.yawTarget ?? c.yaw].every(Number.isFinite) && Math.abs(c.x) <= N / 2 && Math.abs(c.z) <= N / 2 && c.zoom >= 0.45 && c.zoom <= 3.2;
if (!camOk(S.cam)) S.cam = null;
if (S.cam) Object.assign(world.view, { x: S.cam.x, z: S.cam.z, zoom: S.cam.zoom, yaw: S.cam.yawTarget ?? S.cam.yaw, yawTarget: S.cam.yawTarget ?? S.cam.yaw });
else focusTown();
if (!S.cam) world.view.zoom = 0.9;
world.updateCamera();
world.sync(S);
addEventListener("resize", () => world.resize());

const sync = (roads) => world.sync(S, { tiles: false, roads, buildings: true });

// ---------- touch and mouse ----------

const pointers = new Map();
let drag = null, pinch = null;

canvas.addEventListener("pointerdown", (e) => {
  if (!playing) return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: world.view.zoom, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    drag = null; return;
  }
  const painting = tool && (B[tool.id]?.cat === "road" || tool.id === "bulldoze" || tool.id === "upgrade");
  drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, painting, done: new Set() };
  if (painting) paintAt(e.clientX, e.clientY);
});
canvas.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId)) { if (e.pointerType === "mouse" && tool && playing && !pending.length) hoverAt(world.pick(e.clientX, e.clientY)); return; }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    world.view.zoom = pinch.zoom; world.zoomBy(Math.hypot(a.x - b.x, a.y - b.y) / pinch.d);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    world.pan(mid.x - pinch.mid.x, mid.y - pinch.mid.y); pinch.mid = mid;
    return;
  }
  if (!drag) return;
  if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) drag.moved = true;
  if (drag.painting) { paintAt(e.clientX, e.clientY); return; }
  if (drag.moved) { world.pan(e.clientX - drag.lx, e.clientY - drag.ly); drag.lx = e.clientX; drag.ly = e.clientY; }
});
canvas.addEventListener("pointerup", (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (drag && !drag.moved && !drag.painting && pointers.size === 0) tap(e.clientX, e.clientY);
  if (pointers.size === 0) drag = null;
});
canvas.addEventListener("pointercancel", (e) => { pointers.delete(e.pointerId); drag = null; pinch = null; });
canvas.addEventListener("wheel", (e) => { e.preventDefault(); if (playing) world.zoomBy(e.deltaY < 0 ? 1.12 : 0.89); }, { passive: false });

function hoverAt(t) {
  if (!tool || !inMap(t.x, t.y)) { world.setHover(null); world.setGhost(null); return; }
  if (tool.id === "upgrade") { world.setHover(t, canDo(t.x, t.y)); return; }
  if (tool.id === "move") return; // the move tool shows its own preview
  const tile = S.tiles[idx(t.x, t.y)];
  const ok = tool.id === "bulldoze" ? !!(tile.b || tile.t === "rock") : !cantBuild(S, t.x, t.y, tool.id);
  world.setHover(t, ok);
  if (tool.id !== "bulldoze" && B[tool.id].cat !== "road" && !tile.b) world.setGhost(t, modelKey(tool.id, 0), ok, tile.t);
  else world.setGhost(null);
  if (tool.id !== "bulldoze" && (B[tool.id].radius || B[tool.id].reach)) showReach(t.x, t.y, B[tool.id]);
}

// ---------- choosing a spot, then confirming ----------
// Nothing is built on a tap. The tap (or a drag, for roads and removal) marks the spot,
// a preview shows it, and the ✓ button builds it.
let pending = []; // [{ x, y }]
// "upgrade" is the house-upgrade tool: tap (or drag over) houses that are ready, then ✓.
const isMulti = () => tool && tool.id !== "move" && (tool.id === "bulldoze" || tool.id === "upgrade" || B[tool.id].cat === "road");
const tileCost = (x, y) => (tool.id === "bulldoze" ? 0 : tool.id === "upgrade" ? upgradeCost(S.tiles[idx(x, y)].b) : B[tool.id].cost + (S.tiles[idx(x, y)].t === "rock" ? ROCK_CLEAR : 0));
/** The upgrade tool works on one kind: homes, shops, or farms and workshops. */
const upFits = (b) => upgradable(b) && (!tool?.cat || B[b.id].cat === tool.cat);
const upgradeWhy = (x, y) => { const b = S.tiles[idx(x, y)].b; return !upFits(b) ? (tool?.cat === "shop" ? "اضغط على محل" : tool?.cat === "farm" ? "اضغط على مزرعة أو ورشة" : "اضغط على بيت") : upgradeBlocker(S, A, x, y); };
const canDo = (x, y) => { const t = S.tiles[idx(x, y)]; return tool.id === "bulldoze" ? !!(t.b || t.t === "rock") : tool.id === "upgrade" ? !upgradeWhy(x, y) : !cantBuild(S, x, y, tool.id); };
const whyNot = (x, y) => (tool.id === "upgrade" ? upgradeWhy(x, y) : cantBuild(S, x, y, tool.id));
/** Buildings ready to move up a level right now (lit up while the upgrade tool is in hand). */
function readyHouses() {
  const values = new Float32Array(N * N);
  S.tiles.forEach((t, i) => { if (upFits(t.b) && !upgradeBlocker(S, A, i % N, Math.floor(i / N))) values[i] = 1; });
  return values;
}

function showPending() {
  if (!tool) return;
  if (tool.id === "move") { showMove(); return; }
  if (tool.id === "upgrade" && !pending.length) world.setOverlay(readyHouses(), "#e0a44a");
  else if (isMulti()) {
    const values = new Float32Array(N * N);
    for (const p of pending) values[idx(p.x, p.y)] = 1;
    world.setOverlay(pending.length ? values : null, tool.id === "bulldoze" ? "#e0523f" : tool.id === "upgrade" ? "#e0a44a" : "#2cb59c");
    world.setHover(pending.length ? pending[pending.length - 1] : null, true);
  } else if (pending.length) hoverAt(pending[0]);
  else { world.setHover(null); world.setGhost(null); world.setOverlay(null); }
  const d = B[tool.id];
  const ok = pending.filter((p) => canDo(p.x, p.y));
  const cost = ok.reduce((a, p) => a + tileCost(p.x, p.y), 0);
  $("toolOk").hidden = !pending.length;
  $("toolOk").textContent = tool.id === "bulldoze" ? "✓ أزل" : tool.id === "upgrade" ? "✓ طوّر" : "✓ ابنِ";
  $("toolOk").disabled = !ok.length || cost > S.money;
  if (tool.id === "upgrade") {
    const ready = readyHouses().reduce((n, v) => n + v, 0);
    const what = tool.cat === "shop" ? "محل" : tool.cat === "farm" ? "مزرعة وورشة" : "بيت";
    $("toolName").textContent = !pending.length ? (ready ? `تطوير: ${ar(ready)} ${what} جاهز (بالذهبي) · اضغط عليها` : `ما فيه ${what} جاهز للتطوير الحين: اضغط على واحد تشوف وش ينقصه`)
      : !ok.length ? upgradeWhy(pending[0].x, pending[0].y) : `تطوير ${ar(ok.length)} · ${money(cost)} ريال${cost > S.money ? " · ما يكفي المال" : ""}`;
    return;
  }
  if (!pending.length) $("toolName").textContent = tool.id === "bulldoze" ? "إزالة: اضغط أو اسحب على اللي تبي تشيله" : `${d.name} · ${money(d.cost)} ريال${d.cat === "road" ? " · اسحب لترسم" : " · اضغط مكانه"}`;
  else if (tool.id === "bulldoze") $("toolName").textContent = `إزالة ${ar(ok.length)} ${ok.length === 1 ? "شي" : "أشياء"}؟`;
  else if (!ok.length) $("toolName").textContent = cantBuild(S, pending[0].x, pending[0].y, tool.id) || "ما ينفع هنا";
  else $("toolName").textContent = `${isMulti() ? `${ar(ok.length)} مربع` : d.name} · ${money(cost)} ريال${cost > S.money ? " · ما يكفي المال" : ""}`;
}

function paintAt(sx, sy) {
  const t = world.pick(sx, sy);
  if (!inMap(t.x, t.y)) return;
  const key = idx(t.x, t.y);
  if (drag?.done.has(key)) return;
  drag?.done.add(key);
  if (!pending.some((p) => p.x === t.x && p.y === t.y) && canDo(t.x, t.y)) { pending.push(t); sfx.road(); }
  showPending();
}

function tap(sx, sy) {
  const t = world.pick(sx, sy);
  if (!inMap(t.x, t.y)) return;
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
  pending = [];
  world.setHover(null); world.setGhost(null); world.setOverlay(null);
  showPending();
}

// ---------- moving buildings (tap one, tap where it goes, then ✓) ----------
function moveTap(t) {
  const b = S.tiles[idx(t.x, t.y)].b;
  const from = tool.from;
  if (from && from.x === t.x && from.y === t.y) { tool.from = null; pending = []; sfx.tap(); showMove(); return; }
  if (b) {
    const why = ["road", "asphalt"].includes(b.id) ? "الطرق ما تنقل: أزلها وارسمها من جديد" : b.build > 0 ? "تحت الإنشاء: انتظر لين يخلص" : "";
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

const nearRoad = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inMap(x + dx, y + dy) && ["road", "asphalt"].includes(S.tiles[idx(x + dx, y + dy)].b?.id));

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
  if (tool.id === "bulldoze") {
    if (!tile.b && tile.t !== "rock") return;
    const wasRoad = ["road", "asphalt"].includes(tile.b?.id);
    const why = demolish(S, x, y);
    if (why) { if (!quiet) { toast(why, "bad"); sfx.deny(); } return; }
    sfx.remove(); sync(wasRoad);
    clearPreview(quiet);
  } else {
    const why = build(S, x, y, tool.id);
    if (why) { if (!quiet || why === "ما يكفي المال") { toast(why, "bad"); sfx.deny(); } return; }
    const road = B[tool.id].cat === "road";
    road ? sfx.road() : sfx.build();
    sync(road);
    clearPreview(quiet);
    if (!road && !["util", "farm"].includes(B[tool.id].cat) && !nearRoad(x, y)) toast("يحتاج طريق جنبه عشان يشتغل", "bad");
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
  world.setOverlay(values, def.reach ? (def.water > 0 ? "#3b8fd6" : "#e8b730") : def.pollute ? "#e0523f" : "#2cb59c");
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
  move: `<path d="M12 3v18M3 12h18M12 3 9 6M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>`,
  road: `<path ${F} d="M8 3h8l4 18H4z"/><path d="M8 3 4 21M16 3l4 18M12 4v3M12 10v3M12 16v3"/>`,
  bulldoze: `<path ${F} d="M3 13h9v4H3zM5 9h5v4H5z"/><path d="M3 13h9v4H3zM5 9h5v4H5zM12 14l4-3 2 1-1 5h-5M18 12l3 5M4 19.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0M9 19.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0"/>`
};
const toolsBar = [...CATS.map((c) => ({ id: c.id, name: c.name })), { id: "move", name: "نقل" }, { id: "bulldoze", name: "إزالة" }];
function renderCats() {
  $("cats").innerHTML = toolsBar.map((c) => `<button type="button" class="cat ${c.id === "bulldoze" ? "danger" : ""} ${(openCat === c.id || tool?.id === c.id) ? "on" : ""}" data-cat="${c.id}"><svg viewBox="0 0 24 24">${ICONS[c.id]}</svg><span>${c.name}</span></button>`).join("");
  $("cats").querySelectorAll("[data-cat]").forEach((b) => b.addEventListener("click", () => {
    sfx.tap();
    const id = b.dataset.cat;
    if (id === "bulldoze") { openCat = null; setTool(tool?.id === "bulldoze" ? null : { id: "bulldoze" }); return; }
    if (id === "move") { openCat = null; setTool(tool?.id === "move" ? null : { id: "move", from: null }); return; }
    openCat = openCat === id ? null : id;
    renderCats(); renderCards();
  }));
}

function lockReason(id) {
  if (id === "upgrade") return "";
  const d = B[id];
  if (d.unique && S.tiles.some((t) => t.b?.id === id)) return "عندك واحد منه";
  if (d.era > S.era) return `تنفتح لما تصير ${ERAS[d.era].name}`;
  if (!techUnlocked(S, d)) return `تحتاج بحث «${TECH[d.tech].name}»`;
  return "";
}

function renderCards() {
  const box = $("cards");
  if (!openCat) { box.hidden = true; return; }
  const ids = Object.keys(B).filter((k) => B[k].cat === openCat);
  box.hidden = false;
  const UP_CARDS = {
    home: { key: modelKey("house", 2), name: "تطوير البيوت", from: B.house.levels[1].cost, path: "خيمة ← طين ← شعبي ← فيلا ← عمارة" },
    shop: { key: modelKey("grocery", 2), name: "تطوير المحلات", from: upgradeCost({ id: "grocery", lvl: 0 }), path: "بقالة ← تموينات ← سوبرماركت" },
    farm: { key: modelKey("palms", 2), name: "تطوير المزارع والورش", from: upgradeCost({ id: "palms", lvl: 0 }), path: "مزرعة ← بالري ← كبرى" }
  };
  const uc = UP_CARDS[openCat];
  const upgradeCard = uc ? `<button type="button" class="card ${tool?.id === "upgrade" && tool.cat === openCat ? "on" : ""}" data-build="upgrade" style="--i:0">
      <img alt="" src="${thumbnail(uc.key)}"><b>${uc.name}</b><span class="price">من ${money(uc.from)} ريال</span><span class="hours">${uc.path}</span></button>` : "";
  box.innerHTML = upgradeCard + ids.map((id, i) => {
    const lock = lockReason(id);
    const afford = S.money >= B[id].cost;
    return `<button type="button" class="card ${tool?.id === id ? "on" : ""} ${lock ? "locked" : ""} ${!lock && !afford ? "poor" : ""}" data-build="${id}" style="--i:${i}">
      <img alt="" src="${thumbnail(modelKey(id, 0))}"><b>${B[id].name}</b>
      ${lock ? `<span class="lock">${lock}</span>` : `<span class="price">${B[id].fullCost ? `<s>${money(B[id].fullCost)}</s> ` : ""}${money(B[id].cost)} ريال</span>`}
      ${B[id].fullCost && !lock ? `<span class="hours">دعم الدولة −${ar(Math.round(SUBSIDY[B[id].cat] * 100))}٪</span>` : ""}
      ${B[id].buildHours && !lock ? `<span class="hours">يُبنى في ${ar(B[id].buildHours / 24)} أيام</span>` : ""}</button>`;
  }).join("");
  box.querySelectorAll("[data-build]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.build, lock = lockReason(id);
    if (lock) { toast(lock, "bad"); sfx.deny(); return; }
    sfx.tap();
    const cat = id === "upgrade" ? openCat : undefined;
    setTool(tool?.id === id && tool.cat === cat ? null : { id, cat });
  }));
}

function setTool(t) {
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

// ---------- HUD ----------

const MOUTHS = ["M8.5 16.5c1.8-2 5.2-2 7 0", "M9 15.5h6", "M8.5 14.5c1.8 2 5.2 2 7 0", "M8 13.5c2 3.5 6 3.5 8 0z"];
const FACE_COLORS = ["#d9573f", "#d9a540", "#7cb342", "#3f9a5c"];
const face = (k) => `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="${FACE_COLORS[k]}"/><circle cx="9" cy="10" r="1.3" fill="#2f2114"/><circle cx="15" cy="10" r="1.3" fill="#2f2114"/><path d="${MOUTHS[k]}" stroke="#2f2114" stroke-width="1.6" fill="${k === 3 ? "#2f2114" : "none"}" stroke-linecap="round"/></svg>`;
function refresh() {
  A = analyze(S);
  $("sMoney").textContent = money(S.money);
  $("sNet").textContent = `${A.net >= 0 ? "+" : "−"}${money(Math.abs(A.net))} بالساعة`;
  $("sNet").className = A.net >= 0 ? "up" : "down";
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
  $("sEra").textContent = ERAS[S.era].name;
  const se = seasonOf(S.day);
  $("sDay").textContent = `اليوم ${ar(dayOf(S.day))}`;
  $("sSeason").textContent = `${se.name} · اليوم ${ar(se.dayIn)} من ${ar(SEASON_DAYS)}`;
  $("sSeason").dataset.s = se.id;
  $("sSeasonBar").style.width = `${Math.round(se.progress * 100)}%`;
  $("sSeasonBar").dataset.s = se.id;
  const goal = GOALS[S.goal];
  $("goal").innerHTML = goal ? `<i>المهمة</i> ${goal.text} <b>${money(goal.reward)}</b>` : "<i>أنجزت كل المهام</i> كمّل تكبير الرافعية!";
  // The banner shows the main event, or else the strongest boost from a decision.
  const main = S.events.find((e) => e.id !== "boost"), boost = S.events.find((e) => e.id === "boost");
  const ev = main ? EVENTS.find((e) => e.id === main.id) : boost ? { name: boost.name, text: `${boost.happy > 0 ? "الناس مبسوطين" : boost.happy < 0 ? "الناس متضايقين" : "شغّال"} · باقي ${ar(boost.left)} ساعة` } : null;
  $("event").hidden = !ev;
  if (ev) $("event").innerHTML = `<b>${ev.name}</b> ${ev.text}`;
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
  el.textContent = ar(text);
  $("toasts").append(el);
  const long = kind === "era" || kind.startsWith("season");
  setTimeout(() => el.classList.add("out"), long ? 4200 : 2300);
  setTimeout(() => el.remove(), long ? 4600 : 2700);
  while ($("toasts").children.length > 3) $("toasts").firstChild.remove();
}

let sheetFor = null, sheetAt = 0;
function sheet(html, kind) {
  sheetFor = kind; sheetAt = performance.now();
  $("sheetBody").innerHTML = html;
  $("sheet").hidden = false;
  $("sheet").classList.remove("closing");
}
function closeSheet() {
  if ($("sheet").hidden) return;
  $("sheet").classList.add("closing");
  setTimeout(() => { $("sheet").hidden = true; $("sheet").classList.remove("closing"); }, 180);
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
  const n = S.newsUnread || 0;
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
function postHtml(p) {
  const r = personOf(p);
  const when = `اليوم ${ar(dayOf(p.day))} · ${ar(hourOf(p.day))}:٠٠`;
  return `<article class="post" data-post="${p.id}">
    <div class="post-head"><div><b>${r.name}</b><small>${[r.role, r.area, when].filter(Boolean).join(" · ")}</small></div>${moodTag(p.mood)}</div>
    <p>${p.text}</p>
    ${(p.replies || []).map((m) => `<div class="reply ${m.from}"><b>${m.from === "mayor" ? "العمدة" : m.person ? m.person.name : r.name}</b>${m.person?.role ? `<small> (${m.person.role})</small>` : ""} ${m.text}</div>`).join("")}
    <div class="post-foot"><span>👥 ${ar(p.likes || 1)} ${(p.likes || 1) > 10 ? "من الأهالي" : ""} يوافقونه</span>${p.answered ? `<span class="answered ${p.change > 0 ? "up" : p.change < 0 ? "down" : ""}">${p.change > 0 ? "الناس ارتاحوا" : p.change < 0 ? "الناس زعلوا" : "بيرجع لك بكرة"}</span>` : ""}</div>
    ${p.answered || p.id.startsWith("d-") ? "" : `<div class="answers">${replyOptions(p).map((o) => `<button type="button" class="ans ${o.kind}" data-post="${p.id}" data-kind="${o.kind}">${o.label}</button>`).join("")}</div>`}
  </article>`;
}

function newsSheet() {
  S.newsUnread = 0; showNewsCount();
  const posts = S.news || [];
  const trust = Math.round(moodOf(S, null));
  sheet(`<div class="news-head"><h2>نشرة الرافعية</h2><p>وش يقولون أهل الرافعية عن بلدهم. اختار ردك: الوعد يريّحهم بس لازم توفي، و«نشوف» يرجعون لك بعدها، والرفض يزعّلهم.</p>
    <div class="trust"><span>ثقة الأهالي بالعمدة</span><i class="bar"><i style="width:${trust}%" class="${trust < 45 ? "low" : ""}"></i></i><b>${ar(trust)}٪</b></div></div>
    <div class="feed">${posts.length ? posts.map(postHtml).join("") : `<p class="empty">للحين ما أحد كتب شي. الناس يتكلمون كل كم ساعة.</p>`}</div>`, "news");
  $("sheetBody").querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => answer(b.dataset.post, b.dataset.kind)));
}
$("newsBtn").addEventListener("click", () => { sfx.tap(); newsSheet(); });

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
  sheet(`<div class="decision"><span class="badge">قرار</span><h2>${d.title}</h2><p>${d.text}</p>
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
  const t = S.tiles[idx(x, y)];
  if (!owns(S, x, y)) { sfx.tap(); plotSheet(plotAt(x, y)); return; }
  if (t.b?.id === "bank" && !t.b.build) { sfx.tap(); bankSheet(); return; }
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
    html += `<div class="sheet-actions"><button class="btn go block" id="repairOne" type="button" ${S.money < cost ? "disabled" : ""}>رمّمه بـ${money(cost)} ريال</button></div>`;
  }
  if (t.b.build > 0) {
    const pct = Math.round((1 - t.b.build / d.buildHours) * 100);
    html += `<div class="need ok">تحت الإنشاء: باقي ${ar(t.b.build)} ساعة (${ar(Math.ceil(t.b.build / 24))} يوم)</div><i class="prog"><i style="width:${pct}%"></i></i>`;
  } else if (!works) html += `<div class="need">ما يشتغل: يحتاج طريق جنبه.</div>`;
  if (t.b.id === "house") {
    const cap = Math.round(d.levels[t.b.lvl].cap * (S.tech.concrete ? 1.25 : 1));
    html += row("السكان", `${ar(t.b.res || 0)} من ${ar(cap)}`);
    html += row("الحارة", districtName(S, districtOf(idx(x, y))));
    const i = idx(x, y);
    html += row("الماء", A.watered[i] ? "واصل ✓" : "ما يوصله ✕", A.watered[i] ? "plus" : "minus");
    if (A.grid || t.b.lvl >= 2) html += row("الكهرباء", A.powered[i] ? "واصلة ✓" : "ما توصله ✕", A.powered[i] ? "plus" : "minus");
    const levels = d.levels.map((l, k) => `<i class="${k <= t.b.lvl ? "on" : ""}">${l.name}</i>`).join("");
    html += `<div class="ladder">${levels}</div>`;
    const block = houseBlocker(S, A, x, y), next = d.levels[t.b.lvl + 1];
    if (block === "أعلى مستوى") html += `<div class="need ok">وصل أعلى مستوى.</div>`;
    else if (block) html += `<div class="need">عشان تطوره «${next.name}»: ${block}</div>`;
    else html += `<div class="sheet-actions"><button class="btn go block" id="upgradeOne" type="button" ${S.money < next.cost ? "disabled" : ""}>طوّره إلى «${next.name}» بـ${money(next.cost)} ريال</button></div>`;
  }
  if (BIZ_LEVELS[t.b.id] && !t.b.build) {
    const names = BIZ_LEVELS[t.b.id], next = names[t.b.lvl + 1];
    html += `<div class="ladder">${names.map((n, k) => `<i class="${k <= t.b.lvl ? "on" : ""}">${n}</i>`).join("")}</div>`;
    const block = upgradeBlocker(S, A, x, y), cost = upgradeCost(t.b);
    if (block === "أعلى مستوى") html += `<div class="need ok">وصل أعلى مستوى.</div>`;
    else if (block) html += `<div class="need">عشان تطوره «${next}»: ${block}</div>`;
    else html += `<div class="sheet-actions"><button class="btn go block" id="upgradeOne" type="button" ${S.money < cost ? "disabled" : ""}>طوّره إلى «${next}» بـ${money(cost)} ريال</button></div>
      <p class="hint">يزيد دخله ${ar(Math.round((bizLevelNext(t.b).income / up.income - 1) * 100))}٪، ويحتاج موظفين ومصروف أكثر.</p>`;
  }
  if (d.jobs) html += row("الوظائف", ar(Math.round(d.jobs * up.jobs)));
  if (d.income) html += row("الدخل بالساعة (تقريبًا)", `${money(Math.round(d.income * up.income))} ريال`, "plus");
  if (d.upkeep) html += row("المصروف بالساعة", `${money(Math.round(d.upkeep * up.upkeep))} ريال`, "minus");
  if (d.water > 0) html += row("يعطي ماء", ar(d.water), "plus");
  if (d.power > 0) html += row("يعطي كهرباء", ar(d.power), "plus");
  if (d.radius) html += row("يوصل تأثيره", `${ar(d.radius)} مربعات`);
  html += `</div><div class="sheet-actions"><button class="btn danger block" id="demolish" type="button">أزل المبنى (يرجع لك ${money(Math.floor(d.cost / 3))} ريال)</button></div>`;
  sheet(html, "inspect");
  if (d.radius) showReach(x, y, d);
  $("upgradeOne")?.addEventListener("click", () => {
    const why = upgradeAt(S, x, y, A);
    if (why) { toast(why, "bad"); sfx.deny(); return; }
    sfx.levelUp(); A = analyze(S); sync(false); refresh(); save();
    floatAt(x, y, `⬆ ${levelName(S.tiles[idx(x, y)].b)}`, "up");
    inspect(x, y);
  });
  $("repairOne")?.addEventListener("click", () => { const why = repair(S, x, y); if (why) { toast(why, "bad"); sfx.deny(); return; } sfx.build(); toast("رجع المبنى جديد 🔧", "goal"); refresh(); save(); inspect(x, y); });
  $("demolish").addEventListener("click", () => { demolish(S, x, y); sfx.remove(); closeSheet(); sync(["road", "asphalt"].includes(t.b?.id)); refresh(); });
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
  $("sheetBody").querySelectorAll("[data-qshow]").forEach((b) => b.addEventListener("click", () => {
    const d = Number(b.dataset.qshow), values = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) if (districtOf(i) === d) values[i] = 1;
    let cx = 0, cy = 0, n = 0;
    S.tiles.forEach((t, i) => { if (t.b?.id === "house" && districtOf(i) === d) { cx += i % N; cy += Math.floor(i / N); n++; } });
    closeSheet();
    if (n) { world.focus(Math.round(cx / n), Math.round(cy / n)); world.updateCamera(); }
    setTimeout(() => world.setOverlay(values, "#7b5cc4"), 220);
    setTimeout(() => { if (!tool) world.setOverlay(null); }, 5000);
  }));
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
const WHATS_NEW = {
  v: "2026-11-22",
  items: [
    ["🕌", "أوقات الصلاة", "خمس صلوات باليوم. وقت الصلاة الرجال يمشون للمسجد، والمحلات تسكر شوي."],
    ["🐪", "الحلال والإبل", "حظيرة حلال ترعى في الفيضة بالربيع، وسوق الماشية، وميدان مزاين الإبل."],
    ["🏘️", "الحارات", "سمّ حارات ديرتك وتابع رضا كل حارة (من «المجلس»)."],
    ["🗳️", "الانتخابات", "كل سنة يصوت الأهالي عليك: الفوز يجيب دعم، والخسارة تضاعف الرسوم."],
    ["↔️", "نقل المباني", "رتب ديرتك: زر «نقل» تحت، تنقل أي مبنى بمستواه وأهله."],
    ["⬆️", "تطوير المحلات والمزارع", "كل محل ومزرعة وورشة لها ٣ مستويات، دخلها يزيد مع كل مستوى."],
    ["🏦", "البنك ودعم التجارة", "قروض تسددها بالساعة، والمحلات أرخص ٣٠٪ بدعم الدولة."],
    ["❓", "الشرح", "زر «الشرح» على اليسار: كيف تكبر وتصير بلدة ومدينة."],
    ["🎯", "مكافآت المهام", "صارت تغطي تكلفة اللي تطلبه المهمة."],
    ["⏸️", "البلد تنتظرك", "اللعبة توقف وأنت طالع منها، وترجع تلقاها مثل ما تركتها."]
  ]
};
function whatsNewSheet() {
  try { localStorage.setItem("rafaya-news-seen", WHATS_NEW.v); } catch { /* fine */ }
  sheet(`<h2>وش الجديد في الرافعية؟</h2><p>تحديث جديد وصل! هذي أهم الإضافات:</p>
    <div class="rows">${WHATS_NEW.items.map(([icon, title, text]) => `<div class="row wn"><b class="wn-i">${icon}</b><span><b>${title}</b><small>${text}</small></span></div>`).join("")}</div>
    <div class="sheet-actions"><button class="btn go block" id="wnOk" type="button">يلا نلعب</button></div>`, "whatsnew");
  $("wnOk").addEventListener("click", closeSheet);
}
function maybeWhatsNew() {
  let seen = null;
  try { seen = localStorage.getItem("rafaya-news-seen"); } catch { /* fine */ }
  if (seen !== WHATS_NEW.v) whatsNewSheet();
}

function spark(values, color) {
  if (values.length < 2) return "<p>الأرقام تبين بعد كم ساعة.</p>";
  const max = Math.max(...values), min = Math.min(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 300},${66 - ((v - min) / span) * 60}`).join(" ");
  return `<svg class="spark" viewBox="0 0 300 70" preserveAspectRatio="none"><polyline points="${pts} 300,70 0,70" fill="${color}22" stroke="none"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="3" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}

function budget() {
  const h = S.history;
  sheet(`<h2>الأرقام</h2>
    <div class="rows">
      ${row("الصافي بالساعة", `${A.net >= 0 ? "+" : "−"}${money(Math.abs(A.net))}`, A.net >= 0 ? "plus" : "minus")}
      ${row("يعني باليوم (٢٤ ساعة)", `${A.net >= 0 ? "+" : "−"}${money(Math.abs(A.net * 24))}`, A.net >= 0 ? "plus" : "minus")}
      ${A.net < 0 && S.money > 0 ? `<div class="need">تخسر كل ساعة. بعد ${ar(Math.max(1, Math.floor(S.money / -A.net)))} ساعة تصير الميزانية بالسالب.</div>` : ""}
      ${S.broke ? `<div class="need">البلدية مفلسة: المساجد والمدارس والمستوصفات مقفلة لين ترجع الميزانية فوق الصفر.</div>` : S.money < 0 ? `<div class="need">الميزانية بالسالب: الرواتب متأخرة، والخدمات تشتغل بنص طاقتها، والناس زعلانين. لو زادت الديون عن ${money(1500 + A.upkeep * 12)} تفلس البلدية.</div>` : ""}
    </div>
    <h3>الدخل بالساعة</h3>
    <div class="rows">
      ${row("الضرائب على الأهالي", `+${fine(A.tax)}`, "plus")}
      ${row("مبيعات المحلات", `+${fine(A.shopIncome)}`, "plus")}
      ${A.shopRaw > A.shopDemand * 1.02 ? `<div class="need">السوق مشبع: الأهالي يصرفون ${fine(A.shopDemand)} بالساعة بس، والمحلات تقدر تبيع ${fine(A.shopRaw)}. محلات زيادة ما تجيب دخل، تحتاج ناس أكثر.</div>` : A.shopRaw > 0 ? `<div class="need ok">السوق فيه مجال: الأهالي يصرفون ${fine(A.shopDemand)} والمحلات تبيع ${fine(A.shopRaw)}.</div>` : ""}
      ${A.visitorIncome ? row("الزوار والمشاريع الكبرى", `+${fine(A.visitorIncome)}`, "plus") : ""}
      ${A.industryIncome ? row("الورش والمصانع", `+${fine(A.industryIncome)}`, "plus") : ""}
      ${A.industryRaw > A.exportDemand * 1.02 ? `<div class="need">التجار يشترون من الورش والمصانع بقيمة ${fine(A.exportDemand)} بالساعة بس. الإنتاج الزايد (${fine(A.industryRaw - A.exportDemand)}) ينباع بثلث السعر. يزيد الطلب كل ما كثر سكان البلد.</div>` : ""}
      ${row("المزارع", `+${fine(A.farmIncome)}`, "plus")}
    </div>
    <h3>المصاريف بالساعة</h3>
    <div class="rows">
      ${row("رواتب موظفي البلدية", `−${fine(A.costs.staff)}`, "minus")}
      ${row("النظافة وجمع النفايات", `−${fine(A.costs.cleaning)}`, "minus")}
      ${row("صيانة شبكة الماء", `−${fine(A.costs.waterNet)}`, "minus")}
      ${row("صيانة الطرق والإنارة", `−${fine(A.costs.roads)}`, "minus")}
      ${A.costs.services ? row("رواتب الخدمات (مساجد، مدارس، مستوصفات…)", `−${fine(A.costs.services)}`, "minus") : ""}
      ${A.costs.utilities ? row("تشغيل الآبار والكهرباء", `−${fine(A.costs.utilities)}`, "minus") : ""}
      ${A.costs.business ? row("مصاريف المحلات والمزارع والمصانع", `−${fine(A.costs.business)}`, "minus") : ""}
      ${A.costs.sites ? row("مواقع الإنشاء", `−${fine(A.costs.sites)}`, "minus") : ""}
      ${A.costs.loan ? row("أقساط القرض", `−${fine(A.costs.loan)}`, "minus") : ""}
      ${A.costs.insurance ? row("التأمين على المباني", `−${fine(A.costs.insurance)}`, "minus") : ""}
      ${A.costs.health ? row("علاج أمراض التلوث", `−${fine(A.costs.health)}`, "minus") : ""}
      ${A.costs.theft ? row("سرقات من المحلات (حارات بلا شرطة)", `−${fine(A.costs.theft)}`, "minus") : ""}
      ${row("المجموع", `−${fine(A.upkeep)}`, "minus")}
    </div>
    ${S.staffRaise ? `<p>رواتب البلدية زادت ${ar(Math.round(S.staffRaise * 100))}٪ من العلاوات السنوية. وكل سنة تدفع رسوم المحافظة.</p>` : ""}
    ${A.congestion > 0.02 ? `<div class="need">زحمة بالطرق الترابية: المحلات تخسر ${ar(Math.round(A.congestion * 100))}٪ من زباينها. سفلت الطرق أو زد عددها.</div>` : ""}
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
    <h3>الميزانية</h3>${spark(h.map((x) => x.m), "#c48a24")}`, "budget");
  $("openBank").addEventListener("click", () => { sfx.tap(); bankSheet(); });
  $("repairAll")?.addEventListener("click", () => { const r = repairAll(S); if (!r.n) { toast("ما يكفي المال", "bad"); sfx.deny(); return; } sfx.build(); toast(`رممت ${ar(r.n)} مبنى بـ${money(r.spent)} ريال`, "goal"); refresh(); save(); budget(); });
  $("insureIn").addEventListener("change", (e) => { S.insured = e.target.checked; sfx.tap(); refresh(); save(); budget(); });
  $("taxIn").addEventListener("input", (e) => { S.tax = Number(e.target.value); $("taxOut").textContent = `${ar(S.tax)}٪`; refresh(); });
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
      <button class="btn block" id="showWater" type="button">💧 اعرض وين يوصل الماء</button>
    </div>
    <h3>الكهرباء</h3><div class="rows">
      ${A.grid ? row("المتوفر / المطلوب", `${money(A.powerSupply)} / ${money(A.powerUse)}`, A.powerRatio < 1 ? "minus" : "plus") : `<div class="need">ما فيه كهرباء بالبلد. المولد ينفتح لما تصير بلدة، والفلل تحتاجها.</div>`}
      ${A.grid && A.darkHomes ? `<div class="need">${ar(A.darkHomes)} فيلا وعمارة ما توصلها الكهرباء.</div>` : ""}
      ${A.grid ? `<button class="btn block" id="showPower" type="button">⚡ اعرض وين توصل الكهرباء</button>` : ""}
    </div>`, "util");
  const show = (arr, color) => { const v = new Float32Array(N * N); arr.forEach((x, i) => { v[i] = x; }); closeSheet(); setTimeout(() => world.setOverlay(v, color), 200); setTimeout(() => { if (!tool) world.setOverlay(null); }, 6000); };
  $("showWater").addEventListener("click", () => show(A.watered, "#3b8fd6"));
  $("showPower")?.addEventListener("click", () => show(A.powered, "#e8b730"));
}
$("statUtil").addEventListener("click", () => { sfx.tap(); utilSheet(); });

for (const id of ["budgetBtn", "statMoney", "statPop", "statHappy"]) $(id).addEventListener("click", () => { sfx.tap(); budget(); });

$("turnBtn").addEventListener("click", () => { sfx.tap(); world.turn(1); });
$("guideBtn").addEventListener("click", () => { sfx.tap(); howTo(false); });

function goals() {
  const done = GOALS.slice(0, S.goal).map((x) => `<div class="row done"><span>${x.text}</span><b class="plus">✓</b></div>`).join("");
  const next = GOALS.slice(S.goal, S.goal + 3).map((x, i) => `<div class="row ${i ? "" : "now"}"><span>${x.text}</span><b>${money(x.reward)} ريال</b></div>`).join("");
  sheet(`<h2>المهام</h2><p>كل مهمة تعطيك مكافأة. أنجزت ${ar(S.goal)} من ${ar(GOALS.length)}.</p><div class="rows">${next}${done}</div>`, "goals");
}
$("goal").addEventListener("click", () => { sfx.tap(); goals(); });

// ---------- settings, saving, the main menu ----------

function settingsSheet(fromMenu) {
  const q = settings.quality;
  sheet(`<h2>الإعدادات</h2>
    <h3>الرسوم</h3><p>لو الجوال يسخن أو يعلّق، اختر «خفيفة».</p>
    <div class="seg">${[["high", "عالية"], ["medium", "متوسطة"], ["low", "خفيفة"]].map(([k, n]) => `<button type="button" class="${q === k ? "on" : ""}" data-q="${k}">${n}</button>`).join("")}</div>
    <div class="rows" style="margin-top:10px">
      <label class="row toggle"><span>الليل والنهار</span><input type="checkbox" id="setDay" ${settings.daynight ? "checked" : ""}></label>
      <label class="row toggle"><span>الأصوات</span><input type="checkbox" id="setSound" ${sfx.on ? "checked" : ""}></label>
    </div>
    <h3>نسخة احتياطية</h3>
    <p>المدينة تنحفظ لحالها في جوالك. انسخ الكود لو تبي تنقلها لجهاز ثاني.</p>
    <textarea id="saveCode" readonly></textarea>
    <div class="sheet-actions two"><button class="btn" id="copySave" type="button">انسخ الكود</button><button class="btn" id="loadSave" type="button">استرجع من كود</button></div>
    <h3>عن اللعبة</h3>
    <p>صُنعت في الرافعية بيد Vamos. الرسم ثلاثي الأبعاد بمكتبة three.js (ترخيص MIT)، وكل المباني مصممة داخل اللعبة.</p>`, fromMenu ? "settings-menu" : "settings");
  $("sheetBody").querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => {
    store.set("rafaya-quality", b.dataset.q); save();
    toast("نطبّق الإعداد…"); setTimeout(() => location.reload(), 300);
  }));
  $("setDay").addEventListener("change", (e) => { settings.daynight = e.target.checked; world.dayCycle = e.target.checked; store.set("rafaya-daynight", e.target.checked ? "1" : "0"); });
  $("setSound").addEventListener("change", (e) => { sfx.set(e.target.checked); sfx.tap(); });
  const code = btoa(unescape(encodeURIComponent(pack(S))));
  $("saveCode").value = code;
  $("copySave").addEventListener("click", async () => { try { await navigator.clipboard.writeText(code); toast("انسخ الكود."); } catch { $("saveCode").select(); } });
  $("loadSave").addEventListener("click", () => {
    $("saveCode").readOnly = false; $("saveCode").value = ""; $("saveCode").focus();
    $("loadSave").textContent = "استرجع الحين";
    $("loadSave").onclick = () => {
      try { S = unpack(decodeURIComponent(escape(atob($("saveCode").value.trim())))); save(); world.sync(S); refresh(); closeSheet(); toast("رجعت مدينتك!", "goal"); }
      catch { toast("الكود غير صحيح", "bad"); }
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
      <div class="row"><span>«نقل»: اضغط المبنى ثم مكانه الجديد</span><b>ترتب ديرتك (أجرة ١٠٪)</b></div>
      <div class="row"><span>«إزالة»</span><b>تشيل المبنى ويرجع لك ثلث سعره</b></div>
      <div class="row"><span>اضغط على الأرض ورا السياج</span><b>تشتريها وتكبر فيها</b></div>
      <div class="row"><span>اضغط على أي مبنى</span><b>تشوف وش ينقصه</b></div>
      <div class="row"><span>القائمة ← الإنجازات</span><b>تشوف وش حققت</b></div>
    </div></details>`, fromMenu ? "settings-menu" : "how");
}

function pauseMenu() {
  sheet(`<h2>القائمة</h2><div class="rows">
    <button class="row link" id="pmResume" type="button"><span>كمّل اللعب</span><b>←</b></button>
    <button class="row link" id="pmHow" type="button"><span>طريقة اللعب</span><b>←</b></button>
    <button class="row link" id="pmNew" type="button"><span>وش الجديد؟</span><b>←</b></button>
    <button class="row link" id="pmAch" type="button"><span>الإنجازات</span><b>${ar(ACHIEVEMENTS.filter((x) => S.ach?.[x.id]).length)}/${ar(ACHIEVEMENTS.length)}</b></button>
    <button class="row link" id="pmSettings" type="button"><span>الإعدادات والنسخة الاحتياطية</span><b>←</b></button>
    <button class="row link" id="pmMain" type="button"><span>القائمة الرئيسية</span><b>←</b></button>
  </div>`, "pause");
  $("pmResume").addEventListener("click", closeSheet);
  $("pmHow").addEventListener("click", () => howTo(false));
  $("pmNew").addEventListener("click", () => whatsNewSheet());
  $("pmAch").addEventListener("click", () => achievementsSheet());
  $("pmSettings").addEventListener("click", () => settingsSheet(false));
  $("pmMain").addEventListener("click", () => { save(); closeSheet(); showMenu(); });
}
$("pauseMenuBtn").addEventListener("click", () => { sfx.tap(); pauseMenu(); });

function showMenu() {
  playing = false;
  setTool(null); openCat = null; renderCards();
  document.body.classList.add("at-menu");
  const has = hadSave || S.day > 3;
  $("mContinue").hidden = !has;
  if (has) $("mContinueInfo").textContent = `${ERAS[S.era].name} · ${money(S.pop)} نسمة · اليوم ${ar(dayOf(S.day))}`;
}

/** Look at the middle of everything built so far. */
function focusTown() {
  let sx = 0, sy = 0, n = 0;
  S.tiles.forEach((t, i) => { if (t.b) { sx += i % N; sy += Math.floor(i / N); n++; } });
  if (n) world.focus(Math.round(sx / n), Math.round(sy / n)); else world.focus(N / 2, N / 2);
}

function startPlaying() {
  document.body.classList.remove("at-menu");
  playing = true;
  refresh();
}

$("mContinue").addEventListener("click", () => { sfx.goal(); startPlaying(); const r = away; away = null; if (r) showAway(r); else maybeWhatsNew(); });
$("mNew").addEventListener("click", () => {
  sfx.tap();
  const b = $("mNew");
  if ((hadSave || S.day > 3) && !b.dataset.sure) { b.dataset.sure = "1"; b.querySelector("small").textContent = "مدينتك الحالية بتنمسح. اضغط مرة ثانية للتأكيد"; return; }
  delete b.dataset.sure;
  S = newGame(); save(); world.sync(S); focusTown(); world.view.zoom = 0.9; world.updateCamera();
  try { localStorage.setItem("rafaya-news-seen", WHATS_NEW.v); } catch { /* fine */ }
  sfx.goal(); startPlaying();
  sheet(`<h2>هلا بالعمدة!</h2><p>الرافعية الحين ثلاث خيام بس، وبئر، ونخل على الوادي. مهمتك تكبّرها لين تصير محافظة.</p>
    <div class="rows"><div class="row"><span>أول خطوة</span><b>اتبع المهمة اللي فوق</b></div><div class="row"><span>البناء</span><b>من الأزرار اللي تحت</b></div></div>
    <div class="sheet-actions"><button class="btn go block" id="letsGo" type="button">يلا نبدأ</button></div>`, "welcome");
  $("letsGo").addEventListener("click", closeSheet);
});
$("mHow").addEventListener("click", () => { sfx.tap(); howTo(true); });
$("mSettings").addEventListener("click", () => { sfx.tap(); settingsSheet(true); });

let away = null; // the town waits while you are away (nothing runs until you come back)
function showAway(r) {
  sheet(`<h2>وأنت غايب…</h2><p>مرّ على الرافعية ${ar(r.days)} ساعة.</p><div class="rows">
    ${row("السكان", `${r.pop >= 0 ? "+" : "−"}${money(Math.abs(r.pop))}`, r.pop >= 0 ? "plus" : "minus")}
    ${row("الميزانية", `${r.money >= 0 ? "+" : "−"}${money(Math.abs(r.money))} ريال`, r.money >= 0 ? "plus" : "minus")}
    ${r.msgs.filter((m) => m.kind !== "event").slice(-4).map((m) => `<div class="row"><span>${m.text}</span></div>`).join("")}</div>`, "away");
  world.sync(S);
}

// ---------- the clock ----------

let ambT = 0;
let last = performance.now(), acc = 0, tod = 0.36, shownTime = "";
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (playing && speed > 0 && !["welcome", "away", "pause", "settings", "how", "decision", "election", "whatsnew"].includes(sheetFor)) {
    acc += dt * 1000 * speed;
    while (acc >= HOUR_MS) {
      acc -= HOUR_MS;
      const { msgs } = step(S);
      for (const m of msgs) {
        if (m.kind === "decision") continue; // its own sheet opens
        if (m.kind === "ach") { toast(m.text, "ach"); sfx.goal(); continue; }
        if (m.kind === "flood") {
          // look at the wadi where the water comes down, then let it run
          const spots = m.lost.length ? m.lost : m.damaged;
          if (spots.length) { const cx = spots.reduce((n, i) => n + (i % N), 0) / spots.length, cy = spots.reduce((n, i) => n + Math.floor(i / N), 0) / spots.length; world.focus(Math.round(cx), Math.round(cy)); world.view.zoom = Math.min(world.view.zoom, 1.1); world.updateCamera(); }
          world.playFlood(m.lost, m.damaged); sfx.flood(); toast(m.text, "bad"); continue;
        }
        if (m.kind === "collapse") { toast(m.text, "bad"); sfx.remove(); continue; }
        if (m.kind === "election") { electionSheet(m); continue; }
        toast(m.kind === "season" ? m.text : m.title ? `${m.title}: ${m.text}` : m.text, m.kind === "goal" ? "goal" : m.kind === "era" ? "era" : m.kind === "season" ? `season ${seasonOf(S.day).id}` : "");
        (m.kind === "era" ? sfx.era : m.kind === "goal" ? sfx.goal : m.kind === "event" || m.kind === "season" ? sfx.event : sfx.coin)();
        if (m.kind === "era" && openCat) renderCards();
      }
      sync(false);
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
  }
  if (playing) {
    const d = seasonOf(S.day).daylight, p = (hourOf(S.day) + acc / HOUR_MS) / HOURS;
    tod = sunAt(p, d);
    const part = partOfDay(p, d), text = `${part} ${clockAt(p, d)}${world.prayer ? " · 🕌" : ""}`;
    if (text !== shownTime) { shownTime = text; $("sTime").textContent = text; $("sTime").dataset.p = part; world.nightTime = part === "الليل" || part === "الفجر"; }
  }
  if (!playing) { world.view.yawTarget += dt * 0.06; world.view.yaw = world.view.yawTarget; world.updateCamera(); tod = (tod + dt / 300) % 1; }
  if (playing && S.decision && $("sheet").hidden) decisionSheet();
  ambT -= dt;
  if (ambT <= 0) { ambT = 0.5; ambience.update({ playing, night: world.nightTime, raining: world.raining }); }
  world.frame(dt, tod);
  requestAnimationFrame(frame);
}

// ---------- iPhone Safari and leaving the page ----------

for (const ev of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
document.addEventListener("touchmove", (e) => { if (e.touches.length > 1 && e.target !== canvas) e.preventDefault(); }, { passive: false });
let lastTouchEnd = 0;
document.addEventListener("touchend", (e) => {
  const t = Date.now();
  if (t - lastTouchEnd < 320 && e.target !== canvas && !["TEXTAREA", "INPUT"].includes(e.target.tagName) && e.cancelable) {
    e.preventDefault(); e.target.closest?.("button:not([disabled])")?.click();
  }
  lastTouchEnd = t;
}, { passive: false });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) save();
  else if (playing) refresh();
});
addEventListener("pagehide", save);

// For tests and curious players.
Object.defineProperty(window, "__S", { get: () => S });
window.__world = world;
window.__play = startPlaying;
window.__tod = (t) => { tod = t; playing = false; };

// ---------- start ----------

renderCats();
refresh();
showMenu();
$("loading").classList.add("done");
setTimeout(() => $("loading").remove(), 700);
requestAnimationFrame(frame);
