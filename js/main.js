// الرافعية: the game loop, the controls and every screen around the map.
import { B, CATS, TECH, GOALS, ERAS, EVENTS, MAP_SIZE as N } from "./data.js";
import { newGame, step, build, demolish, cantBuild, analyze, houseBlocker, startResearch, catchUp, pack, unpack, idx, inMap, ROCK_CLEAR, techUnlocked } from "./sim.js";
import { draw, pickTile, mapCenter, thumb, mapPreviewColor, iso, TH } from "./render.js";

const $ = (id) => document.getElementById(id);
const AR = "٠١٢٣٤٥٦٧٨٩";
const ar = (n) => String(n).replace(/\d/g, (d) => AR[d]);
const money = (n) => ar(Math.round(n).toLocaleString("en-US"));
const SAVE = "rafaya-save-v1";
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode: the game still runs */ } }
};

// ---------- state ----------

let S = null;
let A = null; // latest analysis
try { const raw = store.get(SAVE); if (raw) S = unpack(raw); } catch { S = null; }
const fresh = !S;
if (!S) S = newGame();
let away = fresh ? null : catchUp(S);
A = analyze(S);

let speed = 1;
let tool = null; // { id } | { id: "bulldoze" } | null (inspect)
let openCat = null;
const DAY_MS = 3000;

function save() { S.savedAt = Date.now(); store.set(SAVE, pack(S)); }

// ---------- canvas and camera ----------

const canvas = $("map");
const g = canvas.getContext("2d");
const view = { cam: S.cam || { ...mapCenter(), zoom: 1 }, w: 0, h: 0, dpr: 1, hover: null, preview: null, overlay: null };
if (!S.cam) view.cam.zoom = Math.min(1.5, Math.max(1, innerWidth / 380));
let dirty = true;

function resize() {
  view.dpr = Math.min(2, devicePixelRatio || 1);
  view.w = innerWidth; view.h = innerHeight;
  canvas.width = Math.round(view.w * view.dpr);
  canvas.height = Math.round(view.h * view.dpr);
  dirty = true;
}
addEventListener("resize", resize);
resize();

const toWorld = (sx, sy) => ({ x: (sx - view.w / 2) / view.cam.zoom + view.cam.x, y: (sy - view.h / 2) / view.cam.zoom + view.cam.y });
const tileAt = (sx, sy) => { const w = toWorld(sx, sy); return pickTile(w.x, w.y); };
function clampCam() {
  const c = mapCenter(), lim = N * 34;
  view.cam.x = Math.max(c.x - lim, Math.min(c.x + lim, view.cam.x));
  view.cam.y = Math.max(c.y - lim * 0.6, Math.min(c.y + lim * 0.6, view.cam.y));
  view.cam.zoom = Math.max(0.45, Math.min(2.6, view.cam.zoom));
}

// ---------- touch and mouse ----------

const pointers = new Map();
let drag = null; // { x, y, camX, camY, moved, painting }
let pinch = null;

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.cam.zoom };
    drag = null;
    return;
  }
  const painting = tool && (tool.id === "road" || tool.id === "asphalt" || tool.id === "bulldoze");
  drag = { x: e.clientX, y: e.clientY, camX: view.cam.x, camY: view.cam.y, moved: false, painting, done: new Set() };
  if (painting) paintAt(e.clientX, e.clientY);
});
canvas.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId)) {
    if (e.pointerType === "mouse" && tool) { const t = tileAt(e.clientX, e.clientY); setHover(t); }
    return;
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    view.cam.zoom = pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d;
    clampCam(); dirty = true;
    return;
  }
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.hypot(dx, dy) > 8) drag.moved = true;
  if (drag.painting) { paintAt(e.clientX, e.clientY); return; }
  if (drag.moved) { view.cam.x = drag.camX - dx / view.cam.zoom; view.cam.y = drag.camY - dy / view.cam.zoom; clampCam(); dirty = true; }
});
const up = (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (drag && !drag.moved && !drag.painting && pointers.size === 0) tap(e.clientX, e.clientY);
  if (pointers.size === 0) { drag = null; S.cam = view.cam; }
};
canvas.addEventListener("pointerup", up);
canvas.addEventListener("pointercancel", (e) => { pointers.delete(e.pointerId); drag = null; pinch = null; });
canvas.addEventListener("wheel", (e) => { e.preventDefault(); view.cam.zoom *= e.deltaY < 0 ? 1.1 : 0.9; clampCam(); dirty = true; }, { passive: false });

function setHover(t) {
  if (!tool || !inMap(t.x, t.y)) { view.hover = null; view.preview = null; dirty = true; return; }
  const ok = tool.id === "bulldoze" ? !!(S.tiles[idx(t.x, t.y)].b || S.tiles[idx(t.x, t.y)].t === "rock") : !cantBuild(S, t.x, t.y, tool.id);
  view.hover = { ...t, ok };
  view.preview = tool.id !== "bulldoze" && ok ? { ...t, id: tool.id } : null;
  if (tool.id !== "bulldoze" && B[tool.id].radius) view.overlay = radiusOverlay(t.x, t.y, B[tool.id]);
  dirty = true;
}

/** Roads (and the bulldozer) paint along the finger. */
function paintAt(sx, sy) {
  const t = tileAt(sx, sy);
  if (!inMap(t.x, t.y)) return;
  const key = idx(t.x, t.y);
  if (drag?.done.has(key)) return;
  drag?.done.add(key);
  setHover(t);
  apply(t.x, t.y, true);
}

function tap(sx, sy) {
  const t = tileAt(sx, sy);
  if (!inMap(t.x, t.y)) return;
  if (tool) { setHover(t); apply(t.x, t.y, false); return; }
  inspect(t.x, t.y);
}

function apply(x, y, quiet) {
  if (tool.id === "bulldoze") {
    const tile = S.tiles[idx(x, y)];
    if (!tile.b && tile.t !== "rock") return;
    const why = demolish(S, x, y);
    if (why) { if (!quiet) toast(why, "bad"); return; }
  } else {
    const why = build(S, x, y, tool.id);
    if (why) { if (!quiet || why === "ما يكفي المال") toast(why, "bad"); return; }
    if (B[tool.id].cat !== "road" && B[tool.id].cat !== "util" && B[tool.id].cat !== "farm" && !nearRoad(x, y)) toast("يحتاج طريق جنبه عشان يشتغل", "bad");
  }
  refresh();
  dirty = true;
}

const nearRoad = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inMap(x + dx, y + dy) && ["road", "asphalt"].includes(S.tiles[idx(x + dx, y + dy)].b?.id));

function radiusOverlay(x, y, def) {
  const values = new Float32Array(N * N);
  for (let yy = y - def.radius; yy <= y + def.radius; yy++) for (let xx = x - def.radius; xx <= x + def.radius; xx++) {
    if (inMap(xx, yy) && Math.abs(xx - x) + Math.abs(yy - y) <= def.radius) values[idx(xx, yy)] = def.happy || def.pollute || 5;
  }
  return { values, color: mapPreviewColor(Object.keys(B).find((k) => B[k] === def)) };
}

// ---------- build dock ----------

const toolsBar = [...CATS.map((c) => ({ id: c.id, name: c.name })), { id: "bulldoze", name: "إزالة" }];
function renderCats() {
  $("cats").innerHTML = toolsBar.map((c) => `<button type="button" class="cat ${c.id === "bulldoze" ? "danger" : ""} ${(openCat === c.id || tool?.id === c.id) ? "on" : ""}" data-cat="${c.id}">${c.name}</button>`).join("");
  $("cats").querySelectorAll("[data-cat]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.cat;
    if (id === "bulldoze") { openCat = null; setTool(tool?.id === "bulldoze" ? null : { id: "bulldoze" }); return; }
    openCat = openCat === id ? null : id;
    renderCats(); renderCards();
  }));
}

function lockReason(id) {
  const d = B[id];
  if (d.era > S.era) return `تفتح لما تصير ${ERAS[d.era].name}`;
  if (!techUnlocked(S, d)) return `تحتاج بحث «${TECH[d.tech].name}»`;
  return "";
}

function renderCards() {
  const box = $("cards");
  if (!openCat) { box.hidden = true; return; }
  const ids = Object.keys(B).filter((k) => B[k].cat === openCat);
  box.hidden = false;
  box.innerHTML = ids.map((id) => {
    const lock = lockReason(id);
    return `<button type="button" class="card ${tool?.id === id ? "on" : ""} ${lock ? "locked" : ""}" data-build="${id}">
      <canvas data-thumb="${id}"></canvas><b>${B[id].name}</b>
      ${lock ? `<span class="lock">${lock}</span>` : `<span class="price">${money(B[id].cost)} ريال</span>`}</button>`;
  }).join("");
  box.querySelectorAll("canvas[data-thumb]").forEach((c) => thumb(c, c.dataset.thumb));
  box.querySelectorAll("[data-build]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.build, lock = lockReason(id);
    if (lock) { toast(lock, "bad"); return; }
    setTool(tool?.id === id ? null : { id });
  }));
}

function setTool(t) {
  tool = t;
  if (t) openCat = null; // the map stays clear while building
  view.hover = null; view.preview = null; view.overlay = null;
  $("toolChip").hidden = !t;
  if (t) {
    const d = B[t.id];
    $("toolName").textContent = t.id === "bulldoze" ? "إزالة: اضغط على مبنى أو صخرة" : `تبني: ${d.name} · ${money(d.cost)} ريال${d.cat === "road" ? " · اسحب لترسم الطريق" : ""}`;
  }
  renderCats(); renderCards();
  dirty = true;
}
$("toolCancel").addEventListener("click", () => setTool(null));

// ---------- HUD ----------

function refresh() {
  A = analyze(S);
  $("sMoney").textContent = money(S.money);
  $("sNet").textContent = `${A.net >= 0 ? "+" : "−"}${money(Math.abs(A.net))} باليوم`;
  $("sNet").className = A.net >= 0 ? "up" : "down";
  $("sPop").textContent = money(S.pop);
  const gr = S.lastGrowth || 0;
  $("sGrow").textContent = gr ? `${gr > 0 ? "+" : "−"}${ar(Math.abs(gr))} اليوم` : `السعة ${money(A.cap)}`;
  $("sGrow").className = gr > 0 ? "up" : gr < 0 ? "down" : "";
  $("sHappy").textContent = `${ar(Math.round(S.happy))}٪`;
  const set = (el, r, show) => { el.style.width = `${Math.round((show ? r : 1) * 100)}%`; el.classList.toggle("low", show && r < 0.95); };
  set($("sWater"), A.waterRatio, true);
  set($("sPower"), A.powerRatio, A.grid);
  $("sEra").textContent = ERAS[S.era].name;
  $("sDay").textContent = `اليوم ${ar(S.day)}`;
  const goal = GOALS[S.goal];
  $("goal").innerHTML = goal ? `<b>المهمة:</b> ${goal.text} · ${money(goal.reward)} ريال` : "<b>أنجزت كل المهام.</b> كمّل تكبير الرافعية!";
  const ev = S.events[0] && EVENTS.find((e) => e.id === S.events[0].id);
  $("event").hidden = !ev;
  if (ev) $("event").innerHTML = `<b>${ev.name}:</b> ${ev.text}`;
  document.querySelectorAll("[data-speed]").forEach((b) => b.classList.toggle("on", Number(b.dataset.speed) === speed));
  if (openCat) renderCards();
}

document.querySelectorAll("[data-speed]").forEach((b) => b.addEventListener("click", () => { speed = Number(b.dataset.speed); refresh(); }));

// ---------- toasts and sheets ----------

function toast(text, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = text;
  $("toasts").append(el);
  setTimeout(() => el.remove(), kind === "era" ? 4200 : 2600);
  while ($("toasts").children.length > 3) $("toasts").firstChild.remove();
}

let sheetFor = null;
let sheetAt = 0;
function sheet(html, kind) {
  sheetFor = kind;
  sheetAt = performance.now();
  $("sheetBody").innerHTML = html;
  $("sheet").hidden = false;
}
function closeSheet() { $("sheet").hidden = true; sheetFor = null; view.overlay = null; dirty = true; }
$("sheetClose").addEventListener("click", closeSheet);
// A tap on the dark backdrop closes the sheet, except the click that comes from the same tap that opened it.
$("sheet").addEventListener("click", (e) => { if (e.target === $("sheet") && performance.now() - sheetAt > 400) closeSheet(); });

function inspect(x, y) {
  const t = S.tiles[idx(x, y)];
  if (!t.b) {
    if (t.t === "rock") sheet(`<h2>صخور</h2><p>تقدر تشيلها بـ${money(ROCK_CLEAR)} ريال، أو تبني فوقها مباشرة والإزالة تنحسب مع السعر.</p>`);
    else if (t.t === "wadi") sheet(`<h2>أرض الوادي</h2><p>أرض خصبة: مزارع النخل والخضار هنا تنتج ٥٠٪ أكثر.</p>`);
    return;
  }
  const d = B[t.b.id];
  const works = t.b.works !== false;
  let html = `<h2>${t.b.id === "house" ? d.levels[t.b.lvl].name : d.name}</h2><p>${d.text}</p><div class="rows">`;
  if (!works) html += `<div class="need">ما يشتغل: يحتاج طريق جنبه.</div>`;
  if (t.b.id === "house") {
    const cap = Math.round(d.levels[t.b.lvl].cap * (S.tech.concrete ? 1.25 : 1));
    html += row("السكان", `${ar(t.b.res || 0)} من ${ar(cap)}`);
    const block = houseBlocker(S, A, x, y);
    html += block === "أعلى مستوى" ? `<div class="need ok">وصل أعلى مستوى.</div>` : `<div class="need ${block ? "" : "ok"}">${block ? `عشان يصير «${d.levels[t.b.lvl + 1].name}»: ${block}` : `بيتطور قريب إلى «${d.levels[t.b.lvl + 1].name}»`}</div>`;
    const local = Math.round(t.b.local || 0);
    html += row("الخدمات القريبة", local > 0 ? `+${ar(local)}` : ar(local));
  }
  if (d.jobs) html += row("الوظائف", ar(d.jobs));
  if (d.income) html += row("الدخل اليومي (تقريبًا)", `${money(d.income)} ريال`, "plus");
  if (d.upkeep) html += row("المصروف اليومي", `${money(d.upkeep)} ريال`, "minus");
  if (d.water > 0) html += row("يعطي ماء", ar(d.water), "plus");
  if (d.power > 0) html += row("يعطي كهرباء", ar(d.power), "plus");
  if (d.radius) html += row("يوصل تأثيره لمسافة", `${ar(d.radius)} مربعات`);
  html += `</div><div style="margin-top:12px"><button class="btn danger block" id="demolish" type="button">أزل المبنى (يرجع لك ${money(Math.floor(d.cost / 3))} ريال)</button></div>`;
  sheet(html, "inspect");
  if (d.radius) { view.overlay = radiusOverlay(x, y, d); dirty = true; }
  $("demolish").addEventListener("click", () => { demolish(S, x, y); closeSheet(); refresh(); dirty = true; });
}
const row = (k, v, cls = "") => `<div class="row"><span>${k}</span><b class="${cls}">${v}</b></div>`;

function council() {
  const list = Object.entries(TECH).map(([id, t]) => {
    const done = S.tech[id], going = S.research?.id === id, locked = t.era > S.era;
    return `<div class="tech ${done ? "done" : going ? "going" : ""}"><div class="tech-top"><b>${t.name}</b>
      ${done ? "<span>✓ تم</span>" : going ? `<span>باقي ${ar(S.research.left)} يوم</span>` : locked ? `<span class="lock">يفتح في ${ERAS[t.era].name}</span>` : `<button class="btn go" data-tech="${id}" type="button" ${S.research || S.money < t.cost ? "disabled" : ""}>${money(t.cost)} ريال · ${ar(t.days)} يوم</button>`}
      </div><p>${t.text}</p></div>`;
  }).join("");
  sheet(`<h2>المجلس البلدي</h2><p>أبحاث تطوّر الرافعية. بحث واحد في كل مرة، ويبقى للأبد.</p><div class="rows">${list}</div>`, "council");
  $("sheetBody").querySelectorAll("[data-tech]").forEach((b) => b.addEventListener("click", () => {
    const why = startResearch(S, b.dataset.tech);
    if (why) toast(why, "bad"); else toast(`بدأ بحث «${TECH[b.dataset.tech].name}»`);
    refresh(); council();
  }));
}
$("councilBtn").addEventListener("click", council);

function spark(values, color) {
  if (values.length < 2) return "";
  const max = Math.max(...values), min = Math.min(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 300},${66 - ((v - min) / span) * 60}`).join(" ");
  return `<svg class="spark" viewBox="0 0 300 70" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="3" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}

function budget() {
  const h = S.history;
  sheet(`<h2>الميزانية والإحصائيات</h2>
    <div class="rows">
      ${row("الضرائب", `+${money(A.tax)}`, "plus")}
      ${row("المحلات والمصانع", `+${money(A.income)}`, "plus")}
      ${row("المزارع", `+${money(A.farmIncome)}`, "plus")}
      ${row("مصاريف المباني", `−${money(A.upkeep)}`, "minus")}
      ${row("الصافي باليوم", `${A.net >= 0 ? "+" : "−"}${money(Math.abs(A.net))}`, A.net >= 0 ? "plus" : "minus")}
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
    <h3>السكان آخر ${ar(h.length)} يوم</h3>${spark(h.map((x) => x.p), "#2c8a7a")}
    <h3>الميزانية آخر ${ar(h.length)} يوم</h3>${spark(h.map((x) => x.m), "#d9a540")}`, "budget");
  $("taxIn").addEventListener("input", (e) => { S.tax = Number(e.target.value); $("taxOut").textContent = `${ar(S.tax)}٪`; refresh(); });
}
$("budgetBtn").addEventListener("click", budget);

function menu() {
  sheet(`<h2>القائمة</h2>
    <h3>طريقة اللعب</h3>
    <p>ابنِ بيوتًا جنب الطرق، واحفر آبارًا للماء، وابنِ محلات ومزارع عشان الوظائف. المساجد والمدارس والحدائق تفرّح الناس، والبيوت تتطور لحالها لما يتوفر لها الماء والكهرباء والخدمات. اضغط على أي مبنى تشوف وش ينقصه.</p>
    <h3>نسخة احتياطية</h3>
    <p>اللعبة تنحفظ لحالها في جوالك. انسخ هذا الكود واحفظه لو تبي تنقل مدينتك لجهاز ثاني.</p>
    <textarea id="saveCode" readonly></textarea>
    <div style="display:flex;gap:8px;margin-top:8px"><button class="btn" id="copySave" type="button">انسخ الكود</button><button class="btn" id="loadSave" type="button">استرجع من كود</button></div>
    <h3>بداية جديدة</h3>
    <button class="btn danger block" id="restart" type="button">ابدأ قرية جديدة (تنمسح مدينتك)</button>`, "menu");
  const code = btoa(unescape(encodeURIComponent(pack(S))));
  $("saveCode").value = code;
  $("copySave").addEventListener("click", async () => { try { await navigator.clipboard.writeText(code); toast("انسخ الكود."); } catch { $("saveCode").select(); } });
  $("loadSave").addEventListener("click", () => {
    $("saveCode").readOnly = false; $("saveCode").value = ""; $("saveCode").focus();
    $("loadSave").textContent = "استرجع الحين";
    $("loadSave").onclick = () => {
      try { S = unpack(decodeURIComponent(escape(atob($("saveCode").value.trim())))); save(); refresh(); closeSheet(); toast("رجعت مدينتك!", "goal"); dirty = true; }
      catch { toast("الكود غير صحيح", "bad"); }
    };
  });
  $("restart").addEventListener("click", () => {
    const b = $("restart");
    if (b.dataset.sure) { S = newGame(); view.cam = { ...mapCenter(), zoom: view.cam.zoom }; save(); refresh(); closeSheet(); dirty = true; toast("قرية جديدة. بالتوفيق يا العمدة!"); }
    else { b.dataset.sure = "1"; b.textContent = "متأكد؟ اضغط مرة ثانية"; }
  });
}
$("menuBtn").addEventListener("click", menu);
$("goal").addEventListener("click", () => {
  const done = GOALS.slice(0, S.goal).map((x) => `<div class="row"><span>${x.text}</span><b class="plus">✓</b></div>`).join("");
  const next = GOALS.slice(S.goal, S.goal + 3).map((x, i) => `<div class="row"><span>${x.text}</span><b>${i ? "" : "← الحالية "}${money(x.reward)}</b></div>`).join("");
  sheet(`<h2>المهام</h2><p>كل مهمة تعطيك مكافأة.</p><div class="rows">${next}${done}</div>`, "goals");
});

// ---------- the clock ----------

let last = performance.now(), acc = 0, animT = 0;
function frame(now) {
  const dt = Math.min(250, now - last);
  last = now;
  // Time stops while the welcome, the menu or the "while you were away" note is open.
  if (speed > 0 && !["welcome", "menu", "away"].includes(sheetFor)) {
    acc += dt * speed;
    while (acc >= DAY_MS) {
      acc -= DAY_MS;
      const { msgs } = step(S);
      for (const m of msgs) toast(m.title ? `${m.title}: ${m.text}` : m.text, m.kind === "goal" ? "goal" : m.kind === "era" ? "era" : "");
      refresh();
      save();
      if (sheetFor === "budget") budget();
      if (sheetFor === "council") council();
      dirty = true;
    }
  }
  // Gentle motion (palms, smoke) a few times a second; full redraws when something changed.
  animT += dt;
  if (dirty || animT > 90) {
    animT = 0;
    draw(g, S, view, now / 1000);
    dirty = false;
  }
  requestAnimationFrame(frame);
}

// ---------- iPhone Safari and leaving the page ----------

for (const ev of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
document.addEventListener("touchmove", (e) => { if (e.touches.length > 1 && e.target !== canvas) e.preventDefault(); }, { passive: false });
let lastTouchEnd = 0;
document.addEventListener("touchend", (e) => {
  const t = Date.now();
  if (t - lastTouchEnd < 320 && e.target !== canvas && e.target.tagName !== "TEXTAREA" && e.target.tagName !== "INPUT" && e.cancelable) {
    e.preventDefault(); e.target.closest?.("button:not([disabled])")?.click();
  }
  lastTouchEnd = t;
}, { passive: false });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { S.cam = view.cam; save(); }
  else { const r = catchUp(S); if (r) showAway(r); refresh(); dirty = true; }
});
addEventListener("pagehide", () => { S.cam = view.cam; save(); });

function showAway(r) {
  sheet(`<h2>وأنت غايب…</h2><p>مرّ على الرافعية ${ar(r.days)} يوم.</p><div class="rows">
    ${row("السكان", `${r.pop >= 0 ? "+" : "−"}${money(Math.abs(r.pop))}`, r.pop >= 0 ? "plus" : "minus")}
    ${row("الميزانية", `${r.money >= 0 ? "+" : "−"}${money(Math.abs(r.money))} ريال`, r.money >= 0 ? "plus" : "minus")}
    ${r.msgs.filter((m) => m.kind !== "event").slice(-4).map((m) => `<div class="row"><span>${m.text}</span></div>`).join("")}</div>`, "away");
}

// For tests and curious players: the live game in the console.
Object.defineProperty(window, "__S", { get: () => S });
window.__view = view;

// ---------- start ----------

renderCats();
refresh();
if (fresh) {
  sheet(`<h2>هلا بالعمدة!</h2><p>الرافعية مضارب صغيرة: كم خيمة، وبئر، ونخل على الوادي. مهمتك تكبّرها لين تصير محافظة.</p>
    <div class="rows">
      <div class="row"><span>اسحب بإصبعك</span><b>تتحرك في الخريطة</b></div>
      <div class="row"><span>بإصبعين</span><b>تكبّر وتصغّر</b></div>
      <div class="row"><span>اختر من تحت</span><b>وابنِ بضغطة</b></div>
      <div class="row"><span>اضغط على أي مبنى</span><b>تشوف وش ينقصه</b></div>
    </div><div style="margin-top:12px"><button class="btn go block" type="button" id="startBtn">يلا نبدأ</button></div>`, "welcome");
  $("startBtn").addEventListener("click", closeSheet);
  save();
} else if (away) showAway(away);
requestAnimationFrame(frame);
