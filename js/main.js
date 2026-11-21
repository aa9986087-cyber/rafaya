// الرافعية: the game loop, the controls, the main menu and every screen around the 3D town.
import { B, CATS, TECH, GOALS, ERAS, EVENTS, MAP_SIZE as N, HOURS, SEASON_DAYS } from "./data.js";
import { newGame, step, build, demolish, cantBuild, analyze, houseBlocker, seasonOf, dayOf, hourOf, startResearch, catchUp, pack, unpack, idx, inMap, ROCK_CLEAR, techUnlocked } from "./sim.js";
import { World, thumbnail } from "./world3d.js";
import { modelKey } from "./models.js";
import { sfx } from "./sound.js";

const $ = (id) => document.getElementById(id);
const AR = "٠١٢٣٤٥٦٧٨٩";
const ar = (n) => String(n).replace(/\d/g, (d) => AR[d]);
const money = (n) => ar(Math.round(n).toLocaleString("en-US"));
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
else world.focus(Math.floor(N / 2), Math.floor(N / 2) + 2);
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
  const painting = tool && (B[tool.id]?.cat === "road" || tool.id === "bulldoze");
  drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, painting, done: new Set() };
  if (painting) paintAt(e.clientX, e.clientY);
});
canvas.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId)) { if (e.pointerType === "mouse" && tool && playing) hoverAt(world.pick(e.clientX, e.clientY)); return; }
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
  const tile = S.tiles[idx(t.x, t.y)];
  const ok = tool.id === "bulldoze" ? !!(tile.b || tile.t === "rock") : !cantBuild(S, t.x, t.y, tool.id);
  world.setHover(t, ok);
  if (tool.id !== "bulldoze" && B[tool.id].cat !== "road" && !tile.b) world.setGhost(t, modelKey(tool.id, 0), ok, tile.t);
  else world.setGhost(null);
  if (tool.id !== "bulldoze" && B[tool.id].radius) showReach(t.x, t.y, B[tool.id]);
}

function paintAt(sx, sy) {
  const t = world.pick(sx, sy);
  if (!inMap(t.x, t.y)) return;
  const key = idx(t.x, t.y);
  if (drag?.done.has(key)) return;
  drag?.done.add(key);
  hoverAt(t);
  apply(t.x, t.y, true);
}

function tap(sx, sy) {
  const t = world.pick(sx, sy);
  if (!inMap(t.x, t.y)) return;
  if (tool) { hoverAt(t); apply(t.x, t.y, false); return; }
  inspect(t.x, t.y);
}

const nearRoad = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inMap(x + dx, y + dy) && ["road", "asphalt"].includes(S.tiles[idx(x + dx, y + dy)].b?.id));

function apply(x, y, quiet) {
  const tile = S.tiles[idx(x, y)];
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

function showReach(x, y, def) {
  const values = new Float32Array(N * N);
  for (let yy = y - def.radius; yy <= y + def.radius; yy++) for (let xx = x - def.radius; xx <= x + def.radius; xx++)
    if (inMap(xx, yy) && Math.abs(xx - x) + Math.abs(yy - y) <= def.radius) values[idx(xx, yy)] = 1;
  world.setOverlay(values, def.pollute ? "#e0523f" : "#2cb59c");
}

// ---------- build dock ----------

const F = 'fill="currentColor" fill-opacity=".2"';
const ICONS = {
  home: `<path ${F} d="M4 20V10h16v10z"/><path d="M3 20h18M4 20V10h16v10M4 10l1.6-2.5L7.2 10l1.6-2.5L10.4 10 12 7.5l1.6 2.5 1.6-2.5 1.6 2.5 1.6-2.5L20 10M10.5 20v-4.5a1.5 1.5 0 0 1 3 0V20M6.5 13h2M15.5 13h2"/>`,
  shop: `<path ${F} d="M3 9h18l-2-5H5z"/><path d="M3 9h18l-2-5H5zM3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 11.5V20h14v-8.5M10 20v-5h4v5M3 20h18"/>`,
  farm: `<path d="M12.5 21c-.3-4 .2-8-.5-11.5"/><path ${F} d="M12 9.5C9 6.5 5.5 6.5 3 8c3.5-.3 6 .5 9 1.5zM12 9.5c3-3 6.5-3 9-1.5-3.5-.3-6 .5-9 1.5zM12 9.5c-2-3.5-1-6 1-7.5-1 2.5-1 5-1 7.5zM12 9.5c-3.5 0-6 2-7 5 2-2 4.5-3.5 7-5zM12 9.5c3.5 0 6 2 7 5-2-2-4.5-3.5-7-5z"/><path d="M12 9.5C9 6.5 5.5 6.5 3 8c3.5-.3 6 .5 9 1.5zM12 9.5c3-3 6.5-3 9-1.5-3.5-.3-6 .5-9 1.5zM12 9.5c-3.5 0-6 2-7 5 2-2 4.5-3.5 7-5zM12 9.5c3.5 0 6 2 7 5-2-2-4.5-3.5-7-5z"/><path d="M7 21h11"/>`,
  util: `<path ${F} d="M9 3s5.5 6.2 5.5 10.2a5.5 5.5 0 0 1-11 0C3.5 9.2 9 3 9 3z"/><path d="M9 3s5.5 6.2 5.5 10.2a5.5 5.5 0 0 1-11 0C3.5 9.2 9 3 9 3z"/><path d="m18.5 6-2.5 5h3.5L17 17" stroke-width="2.1"/>`,
  serv: `<path ${F} d="M5 20v-6h10v6zM6 14c0-3 1.8-5 4-6.2 2.2 1.2 4 3.2 4 6.2z"/><path d="M3 20h18M5 20v-6h10v6M6 14c0-3 1.8-5 4-6.2 2.2 1.2 4 3.2 4 6.2M10 7.8V5.5M18 20V9l1-2.5L20 9v11M8.5 20v-2.5a1.5 1.5 0 0 1 3 0V20"/>`,
  road: `<path ${F} d="M8 3h8l4 18H4z"/><path d="M8 3 4 21M16 3l4 18M12 4v3M12 10v3M12 16v3"/>`,
  bulldoze: `<path ${F} d="M3 13h9v4H3zM5 9h5v4H5z"/><path d="M3 13h9v4H3zM5 9h5v4H5zM12 14l4-3 2 1-1 5h-5M18 12l3 5M4 19.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0M9 19.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0"/>`
};
const toolsBar = [...CATS.map((c) => ({ id: c.id, name: c.name })), { id: "bulldoze", name: "إزالة" }];
function renderCats() {
  $("cats").innerHTML = toolsBar.map((c) => `<button type="button" class="cat ${c.id === "bulldoze" ? "danger" : ""} ${(openCat === c.id || tool?.id === c.id) ? "on" : ""}" data-cat="${c.id}"><svg viewBox="0 0 24 24">${ICONS[c.id]}</svg><span>${c.name}</span></button>`).join("");
  $("cats").querySelectorAll("[data-cat]").forEach((b) => b.addEventListener("click", () => {
    sfx.tap();
    const id = b.dataset.cat;
    if (id === "bulldoze") { openCat = null; setTool(tool?.id === "bulldoze" ? null : { id: "bulldoze" }); return; }
    openCat = openCat === id ? null : id;
    renderCats(); renderCards();
  }));
}

function lockReason(id) {
  const d = B[id];
  if (d.era > S.era) return `تنفتح لما تصير ${ERAS[d.era].name}`;
  if (!techUnlocked(S, d)) return `تحتاج بحث «${TECH[d.tech].name}»`;
  return "";
}

function renderCards() {
  const box = $("cards");
  if (!openCat) { box.hidden = true; return; }
  const ids = Object.keys(B).filter((k) => B[k].cat === openCat);
  box.hidden = false;
  box.innerHTML = ids.map((id, i) => {
    const lock = lockReason(id);
    const afford = S.money >= B[id].cost;
    return `<button type="button" class="card ${tool?.id === id ? "on" : ""} ${lock ? "locked" : ""} ${!lock && !afford ? "poor" : ""}" data-build="${id}" style="--i:${i}">
      <img alt="" src="${thumbnail(modelKey(id, 0))}"><b>${B[id].name}</b>
      ${lock ? `<span class="lock">${lock}</span>` : `<span class="price">${money(B[id].cost)} ريال</span>`}</button>`;
  }).join("");
  box.querySelectorAll("[data-build]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.build, lock = lockReason(id);
    if (lock) { toast(lock, "bad"); sfx.deny(); return; }
    sfx.tap();
    setTool(tool?.id === id ? null : { id });
  }));
}

function setTool(t) {
  tool = t;
  if (t) openCat = null;
  world.setHover(null); world.setGhost(null); world.setOverlay(null);
  $("toolChip").hidden = !t;
  if (t) {
    const d = B[t.id];
    $("toolName").textContent = t.id === "bulldoze" ? "إزالة: اضغط أو اسحب على المباني والصخور" : `${d.name} · ${money(d.cost)} ريال${d.cat === "road" ? " · اسحب لترسم" : " · اضغط مكانه"}`;
  }
  renderCats(); renderCards();
}
$("toolCancel").addEventListener("click", () => { sfx.tap(); setTool(null); });

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
  set($("sPower"), A.powerRatio, A.grid);
  $("sEra").textContent = ERAS[S.era].name;
  const se = seasonOf(S.day);
  $("sDay").textContent = `اليوم ${ar(dayOf(S.day))}`;
  $("sSeason").textContent = `${se.name} · اليوم ${ar(se.dayIn)} من ${ar(SEASON_DAYS)}`;
  $("sSeason").dataset.s = se.id;
  $("sSeasonBar").style.width = `${Math.round(se.progress * 100)}%`;
  $("sSeasonBar").dataset.s = se.id;
  const goal = GOALS[S.goal];
  $("goal").innerHTML = goal ? `<i>المهمة</i> ${goal.text} <b>${money(goal.reward)}</b>` : "<i>أنجزت كل المهام</i> كمّل تكبير الرافعية!";
  const ev = S.events[0] && EVENTS.find((e) => e.id === S.events[0].id);
  $("event").hidden = !ev;
  if (ev) $("event").innerHTML = `<b>${ev.name}</b> ${ev.text}`;
  $("councilDot").hidden = !!S.research || !Object.entries(TECH).some(([id, t]) => !S.tech[id] && t.era <= S.era && S.money >= t.cost);
  document.querySelectorAll("[data-speed]").forEach((b) => b.classList.toggle("on", Number(b.dataset.speed) === speed));
  if (openCat) renderCards();
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
$("sheet").addEventListener("click", (e) => { if (e.target === $("sheet") && performance.now() - sheetAt > 400) closeSheet(); });

const row = (k, v, cls = "") => `<div class="row"><span>${k}</span><b class="${cls}">${v}</b></div>`;

function inspect(x, y) {
  const t = S.tiles[idx(x, y)];
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
  const title = t.b.id === "house" ? d.levels[t.b.lvl].name : d.name;
  let html = `<div class="ins-head"><img alt="" src="${thumbnail(modelKey(t.b.id, t.b.lvl), t.t)}"><div><h2>${title}</h2><p>${d.text}</p></div></div><div class="rows">`;
  if (!works) html += `<div class="need">ما يشتغل: يحتاج طريق جنبه.</div>`;
  if (t.b.id === "house") {
    const cap = Math.round(d.levels[t.b.lvl].cap * (S.tech.concrete ? 1.25 : 1));
    html += row("السكان", `${ar(t.b.res || 0)} من ${ar(cap)}`);
    const block = houseBlocker(S, A, x, y);
    html += block === "أعلى مستوى" ? `<div class="need ok">وصل أعلى مستوى.</div>` : `<div class="need ${block ? "" : "ok"}">${block ? `عشان يصير «${d.levels[t.b.lvl + 1].name}»: ${block}` : `بيتطور قريب إلى «${d.levels[t.b.lvl + 1].name}»`}</div>`;
    const levels = d.levels.map((l, i) => `<i class="${i <= t.b.lvl ? "on" : ""}">${l.name}</i>`).join("");
    html += `<div class="ladder">${levels}</div>`;
  }
  if (d.jobs) html += row("الوظائف", ar(d.jobs));
  if (d.income) html += row("الدخل بالساعة (تقريبًا)", `${money(d.income)} ريال`, "plus");
  if (d.upkeep) html += row("المصروف بالساعة", `${money(d.upkeep)} ريال`, "minus");
  if (d.water > 0) html += row("يعطي ماء", ar(d.water), "plus");
  if (d.power > 0) html += row("يعطي كهرباء", ar(d.power), "plus");
  if (d.radius) html += row("يوصل تأثيره", `${ar(d.radius)} مربعات`);
  html += `</div><div class="sheet-actions"><button class="btn danger block" id="demolish" type="button">أزل المبنى (يرجع لك ${money(Math.floor(d.cost / 3))} ريال)</button></div>`;
  sheet(html, "inspect");
  if (d.radius) showReach(x, y, d);
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
  sheet(`<h2>المجلس البلدي</h2><p>أبحاث تطوّر الرافعية. بحث واحد في كل مرة، ويبقى للأبد.</p><div class="rows">${list}</div>`, "council");
  $("sheetBody").querySelectorAll("[data-tech]").forEach((b) => b.addEventListener("click", () => {
    const why = startResearch(S, b.dataset.tech);
    if (why) { toast(why, "bad"); sfx.deny(); } else { toast(`بدأ بحث «${TECH[b.dataset.tech].name}»`); sfx.coin(); }
    refresh(); council();
  }));
}
$("councilBtn").addEventListener("click", () => { sfx.tap(); council(); });

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
      ${row("الضرائب", `+${money(A.tax)}`, "plus")}
      ${row("المحلات والمصانع", `+${money(A.income)}`, "plus")}
      ${row("المزارع", `+${money(A.farmIncome)}`, "plus")}
      ${row("مصاريف المباني", `−${money(A.upkeep)}`, "minus")}
      ${row("الصافي بالساعة", `${A.net >= 0 ? "+" : "−"}${money(Math.abs(A.net))}`, A.net >= 0 ? "plus" : "minus")}
    </div>
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
  $("taxIn").addEventListener("input", (e) => { S.tax = Number(e.target.value); $("taxOut").textContent = `${ar(S.tax)}٪`; refresh(); });
}
for (const id of ["budgetBtn", "statMoney", "statPop", "statHappy"]) $(id).addEventListener("click", () => { sfx.tap(); budget(); });

$("turnBtn").addEventListener("click", () => { sfx.tap(); world.turn(1); });

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

function howTo(fromMenu) {
  sheet(`<h2>طريقة اللعب</h2>
    <div class="rows">
      <div class="row"><span>اسحب بإصبع</span><b>تتحرك في الخريطة</b></div>
      <div class="row"><span>بإصبعين</span><b>تكبّر وتصغّر</b></div>
      <div class="row"><span>زر «لفّ»</span><b>تدوّر المنظر</b></div>
      <div class="row"><span>اختر من تحت واضغط مكانه</span><b>تبني</b></div>
      <div class="row"><span>اسحب بالطريق</span><b>ترسمه مرة وحدة</b></div>
      <div class="row"><span>اضغط على أي مبنى</span><b>تشوف وش ينقصه</b></div>
    </div>
    <h3>كيف تكبر الرافعية؟</h3>
    <p>انصب خيام جنب الطرق، واحفر آبار للماء، وابنِ مزارع ومحلات عشان الوظائف. المساجد والمدارس والحدائق تفرّح الناس. البيوت تتطور لحالها: خيمة، طين، شعبي، فيلا، عمارة. وكل ما كبر عدد السكان، تصير بلدة ثم مدينة ثم محافظة، وتنفتح مباني جديدة.</p>`, fromMenu ? "settings-menu" : "how");
}

function pauseMenu() {
  sheet(`<h2>القائمة</h2><div class="rows">
    <button class="row link" id="pmResume" type="button"><span>كمّل اللعب</span><b>←</b></button>
    <button class="row link" id="pmHow" type="button"><span>طريقة اللعب</span><b>←</b></button>
    <button class="row link" id="pmSettings" type="button"><span>الإعدادات والنسخة الاحتياطية</span><b>←</b></button>
    <button class="row link" id="pmMain" type="button"><span>القائمة الرئيسية</span><b>←</b></button>
  </div>`, "pause");
  $("pmResume").addEventListener("click", closeSheet);
  $("pmHow").addEventListener("click", () => howTo(false));
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

function startPlaying() {
  document.body.classList.remove("at-menu");
  playing = true;
  refresh();
}

$("mContinue").addEventListener("click", () => { sfx.goal(); startPlaying(); const r = away; away = null; if (r) showAway(r); });
$("mNew").addEventListener("click", () => {
  sfx.tap();
  const b = $("mNew");
  if ((hadSave || S.day > 3) && !b.dataset.sure) { b.dataset.sure = "1"; b.querySelector("small").textContent = "مدينتك الحالية بتنمسح. اضغط مرة ثانية للتأكيد"; return; }
  delete b.dataset.sure;
  S = newGame(); save(); world.sync(S); world.focus(Math.floor(N / 2), Math.floor(N / 2) + 2); world.view.zoom = 0.9; world.updateCamera();
  sfx.goal(); startPlaying();
  sheet(`<h2>هلا بالعمدة!</h2><p>الرافعية الحين ثلاث خيام بس، وبئر، ونخل على الوادي. مهمتك تكبّرها لين تصير محافظة.</p>
    <div class="rows"><div class="row"><span>أول خطوة</span><b>اتبع المهمة اللي فوق</b></div><div class="row"><span>البناء</span><b>من الأزرار اللي تحت</b></div></div>
    <div class="sheet-actions"><button class="btn go block" id="letsGo" type="button">يلا نبدأ</button></div>`, "welcome");
  $("letsGo").addEventListener("click", closeSheet);
});
$("mHow").addEventListener("click", () => { sfx.tap(); howTo(true); });
$("mSettings").addEventListener("click", () => { sfx.tap(); settingsSheet(true); });

let away = hadSave ? catchUp(S) : null;
function showAway(r) {
  sheet(`<h2>وأنت غايب…</h2><p>مرّ على الرافعية ${ar(r.days)} ساعة.</p><div class="rows">
    ${row("السكان", `${r.pop >= 0 ? "+" : "−"}${money(Math.abs(r.pop))}`, r.pop >= 0 ? "plus" : "minus")}
    ${row("الميزانية", `${r.money >= 0 ? "+" : "−"}${money(Math.abs(r.money))} ريال`, r.money >= 0 ? "plus" : "minus")}
    ${r.msgs.filter((m) => m.kind !== "event").slice(-4).map((m) => `<div class="row"><span>${m.text}</span></div>`).join("")}</div>`, "away");
  world.sync(S);
}

// ---------- the clock ----------

let last = performance.now(), acc = 0, tod = 0.36, shownTime = "";
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (playing && speed > 0 && !["welcome", "away", "pause", "settings", "how"].includes(sheetFor)) {
    acc += dt * 1000 * speed;
    while (acc >= HOUR_MS) {
      acc -= HOUR_MS;
      const { msgs } = step(S);
      for (const m of msgs) {
        toast(m.kind === "season" ? m.text : m.title ? `${m.title}: ${m.text}` : m.text, m.kind === "goal" ? "goal" : m.kind === "era" ? "era" : m.kind === "season" ? `season ${seasonOf(S.day).id}` : "");
        (m.kind === "era" ? sfx.era : m.kind === "goal" ? sfx.goal : m.kind === "event" || m.kind === "season" ? sfx.event : sfx.coin)();
        if (m.kind === "era" && openCat) renderCards();
      }
      sync(false);
      refresh();
      save();
      if (sheetFor === "budget") budget();
      if (sheetFor === "council") council();
    }
  }
  if (playing) {
    const d = seasonOf(S.day).daylight, p = (hourOf(S.day) + acc / HOUR_MS) / HOURS;
    tod = sunAt(p, d);
    const part = partOfDay(p, d), text = `${part} ${clockAt(p, d)}`;
    if (text !== shownTime) { shownTime = text; $("sTime").textContent = text; $("sTime").dataset.p = part; world.nightTime = part === "الليل" || part === "الفجر"; }
  }
  if (!playing) { world.view.yawTarget += dt * 0.06; world.view.yaw = world.view.yawTarget; world.updateCamera(); tod = (tod + dt / 300) % 1; }
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
  else if (playing) { const r = catchUp(S); if (r) showAway(r); refresh(); }
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
