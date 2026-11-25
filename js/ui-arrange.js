// The layout editor «✏️ تعديل» and moving buildings.
// Moved out of js/main.js as it was (nothing changed in it); main.js and the modules import each other's names.
import { $, S, ar, arrSync, arrange, closeSheet, drag, money, pending, setTool, sheet, tool, world } from "./main.js";
import { ROCK_CLEAR, idx, inMap, layoutBlocker, levelName, moveBlocker, moveCost, upgradeEffect } from "./sim.js";
import { B, MAP_SIZE as N, ROAD_IDS } from "./data.js";
import { sfx } from "./sound.js";
import { canTurn, roadAim, roadAimStart } from "./ui-tools.js";
import { lockReason, row, toast } from "./ui-build.js";
import { modelKey } from "./models.js";
import { thumbnail } from "./world3d.js";

// Touch a building and drag it; drop it on an empty tile, or on another building to swap them.
// A tap selects one (↻ turns it). «شيل الكل» lifts every building into the tray at the bottom; a tap
// on the tray picks one up, a tap on the land puts it down. ↶ undoes, ✕ puts everything back as it was,
// ✓ keeps it (once the tray is empty). The town waits while you arrange; roads stay where they are.
export const arrMovable = (b) => !!b && !(b.build > 0) && !(b.wd > 0) && !b.span && b.id !== "decopart";
/** Lay the next one of the same kind from the tray (roads are laid by dragging a finger along). */
export function arrNext(id) {
  const k = arrange.tray.findIndex((b) => b.id === id);
  if (k < 0) { arrange.held = null; return; }
  arrange.held = { b: arrange.tray[k], from: -1 };
  arrange.tray.splice(k, 1);
}
/** Every tile on the line from the last one the finger was on to this one (a fast finger skips tiles). */
export function arrLine(t) {
  const a = drag.last || t, n = Math.max(Math.abs(t.x - a.x), Math.abs(t.y - a.y)), out = [];
  for (let k = 1; k <= n; k++) out.push({ x: Math.round(a.x + (t.x - a.x) * k / n), y: Math.round(a.y + (t.y - a.y) * k / n) });
  if (!n) out.push(t);
  drag.last = t;
  return out;
}
/** The road eraser: roads under the finger go back to the store, to be drawn again somewhere else. */
export function arrErase(t) {
  for (const c of arrLine(t)) {
    if (!inMap(c.x, c.y)) continue;
    const i = idx(c.x, c.y), b = S.tiles[i].b;
    if (!b || B[b.id].cat !== "road" || !arrMovable(b)) continue;
    if (!drag.pushed) { arrPush(); drag.pushed = true; }
    arrange.tray.push(b); S.tiles[i].b = null; sfx.road();
  }
  arrSync(); arrRender();
}
export function arrPaint(t) {
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
export function arrPaintOne(t) {
  const h = arrange.held;
  if (!h || !inMap(t.x, t.y) || drag.done.has(idx(t.x, t.y))) return;
  drag.done.add(idx(t.x, t.y));
  if (layoutBlocker(S, t.x, t.y, h.b)) return;
  if (!drag.pushed) { arrPush(); drag.pushed = true; }
  S.tiles[idx(t.x, t.y)].b = h.b;
  sfx.road();
  arrNext(h.b.id);
}
export function arrSnapshot() {
  const tray = arrange ? [...arrange.tray] : [];
  if (arrange?.held?.from < 0) tray.push(arrange.held.b); // a road in hand from the store goes back with ↶, never lost
  return { b: S.tiles.map((t) => t.b), rot: S.tiles.map((t) => t.b?.rot || 0), tt: S.tiles.map((t) => t.t),
    tray, gone: arrange ? [...arrange.gone] : [], rocks: arrange ? [...arrange.rocks] : [] };
}
export function arrRestore(snap) {
  S.tiles.forEach((t, i) => { t.b = snap.b[i]; t.t = snap.tt[i]; if (t.b) { if (snap.rot[i]) t.b.rot = snap.rot[i]; else delete t.b.rot; } });
  arrange.tray = [...snap.tray]; arrange.gone = [...snap.gone]; arrange.rocks = [...snap.rocks];
}
/** What the removals give back (a third of each price) and what the cleared rocks cost, settled on ✓. */
export function arrBill() {
  let back = 0, people = 0;
  for (const { b } of arrange.gone) { back += Math.floor(((B[b.id]?.cost || 0) * (b.n || 1) + (B[b.monument]?.cost || 0)) / 3); people += b.res || 0; }
  return { back, people, rocks: arrange.rocks.length * ROCK_CLEAR };
}
/** Remove what stands on tile i (a big decoration with all its tiles), or clear a rock. Callers take the snapshot. */
export function arrRemove(i) {
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
export const arrPush = () => { arrange.hist.push(arrSnapshot()); arrange.future = []; if (arrange.hist.length > 40) arrange.hist.shift(); };
/** Lift a building: off its tile (or out of the tray), into the hand. */
export function arrLift(i) {
  const b = S.tiles[i].b;
  arrPush();
  S.tiles[i].b = null;
  arrange.held = { b, from: i };
  arrange.sel = null;
  arrSync();
}
/** Put what is in the hand down on tile t (or back where it came from); a building there swaps. */
export function arrDrop(t) {
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
/** One step of the editor's finger tools at tile t (the stroke has begun). */
export function arrStroke(t) {
  if (drag.mode === "erase") { arrErase(t); return; }
  if (drag.mode === "paint") { arrPaint(t); return; }
  let any = false;
  for (const c of arrLine(t)) if (inMap(c.x, c.y) && arrRemove(idx(c.x, c.y))) any = true;
  if (any) { sfx.remove(); arrSync(); arrRender(); }
}
export function arrBegin() {
  drag.started = true; drag.pushed = true; arrPush(); // one ↶ takes the whole stroke back
  drag.last = drag.start;
  if (drag.mode === "paint") drag.paint = true;
  if (drag.mode === "erase") drag.erase = true;
  if (drag.mode === "del") { drag.del = true; if (arrRemove(idx(drag.start.x, drag.start.y))) { sfx.remove(); arrSync(); } }
  else arrStroke(drag.start);
}
/** A second finger landed: take back what this stroke did. */
export function arrUnstroke() {
  if (!arrange || !drag?.mode || !drag.started || !arrange.hist.length) return;
  arrRestore(arrange.hist.pop()); arrange.held = drag.heldBefore;
  if (arrange.held) { const k = arrange.tray.lastIndexOf(arrange.held.b); if (k >= 0) arrange.tray.splice(k, 1); }
  arrSync(); arrRender();
}
/** While a finger moves: a building under it at the start is dragged; otherwise the land pans. */
export function arrMove(e) {
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
export function arrUp(e) {
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
export function arrRender() {
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
export function showMove() {
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
export const nearRoad = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inMap(x + dx, y + dy) && ROAD_IDS.includes(S.tiles[idx(x + dx, y + dy)].b?.id));
/** Once something is placed, the green preview goes so the real building shows straight away. */
export function clearPreview(painting) {
  world.setGhost(null);
  if (!painting) { world.setHover(null); world.setOverlay(null); }
}
/** Shows how far a building reaches: water in blue, power in gold, cheer in green, nuisance in red. */
export function showReach(x, y, def) {
  const r = def.reach || def.radius;
  const values = new Float32Array(N * N);
  for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++)
    if (inMap(xx, yy) && Math.abs(xx - x) + Math.abs(yy - y) <= r) values[idx(xx, yy)] = 1;
  world.setOverlay(values, def.reach ? (def.water > 0 ? "#3b8fd6" : "#9b5cf6") : def.pollute ? "#e0523f" : "#2cb59c");
}
/** The homes no mosque reaches. */
/** Buildings that serve the same need cover for each other (a mosque and a big mosque, a clinic and a hospital…). */
export const SERVICE_GROUP = { mosque: "المساجد", school: "المدارس", health: "المستوصفات والمستشفيات", safety: "الشرطة والدفاع المدني" };
export const sameNeed = (a, b) => (B[a].service ? B[a].service === B[b]?.service : a === b);
export const needName = (id) => SERVICE_GROUP[B[id].service] || { park: "الحدائق", stadium: "الملاعب" }[id] || B[id].name;
/** Every tile some working building of this need reaches (with its upgrades). */
export function needCover(id) {
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
export function needGaps(id, cover = needCover(id)) {
  let n = 0;
  for (let i = 0; i < N * N; i++) if (S.tiles[i].b?.id === "house" && !cover[i]) n++;
  return n;
}
export const mosqueGaps = () => needGaps("mosque");
/** Like the water and power maps: where this need is met in green, the homes outside it in red. */
export function needMap(id) {
  const cover = needCover(id), v = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) { if (cover[i]) v[i] = 0.01; else if (S.tiles[i].b?.id === "house") v[i] = 1; }
  closeSheet();
  setTimeout(() => world.setOverlay(v, "heat"), 200);
  clearTimeout(needMap.t); needMap.t = setTimeout(() => { if (!tool) world.setOverlay(null); }, 7000);
  const u = needGaps(id, cover), has = cover.some((c) => c);
  toast(!has ? `ما عندك ${needName(id)} للحين: كل البيوت بالأحمر` : u ? `الأخضر يوصله ${needName(id)}، والأحمر ${ar(u)} بيت برا المدى` : `الأخضر يوصله ${needName(id)}: كل البيوت داخل المدى ✓`);
}
export const mosqueMap = () => needMap("mosque");
/** A service's card in the build dock: what it does, what it costs and how far it reaches, then build it or see its reach. */
export function serviceInfo(id) {
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
