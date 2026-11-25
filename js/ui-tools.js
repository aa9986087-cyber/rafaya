// Touch, choosing a spot, painting roads and the fill, road upgrades.
// Moved out of js/main.js as it was (nothing changed in it); main.js and the modules import each other's names.
import { ROCK_CLEAR, buildCost, cantBuild, housePrice, idx, inMap, owns, priceOf, upgradable, upgradeBlocker, upgradeEffect, upgradePrice } from "./sim.js";
import { $, A, S, ar, buildPreview, drag, fine, money, pending, placeRot, roadStroke, tool, world } from "./main.js";
import { B, ERAS, FILL_COST, MAP_SIZE as N, ROAD_IDS } from "./data.js";
import { modelKey } from "./models.js";
import { showMove, showReach } from "./ui-arrange.js";
import { sfx } from "./sound.js";

export const pointers = new Map();
/** Does a drag that starts on tile t paint (true) or move the map (false)? */
export function paintStarts(t) {
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
export const canTurn = (id) => !!B[id] && B[id].cat !== "road" && !["dam", "pivot"].includes(id);
export const ghostAngle = (x, y, id) => (canTurn(id) ? world.faceAngle(S, x, y) + placeRot * Math.PI / 2 : 0);
export function hoverAt(t) {
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
// [{ x, y }]
// "upgrade" is the house-upgrade tool: tap (or drag over) houses that are ready, then ✓.
export const isMulti = () => tool && tool.id !== "move" && (tool.id === "bulldoze" || tool.id === "upgrade" || tool.id === "roadup" || tool.id === "fill" || B[tool.id].cat === "road");
export const tileCost = (x, y) => (tool.lvl ? housePrice(S, tool.lvl).total + (S.tiles[idx(x, y)].t === "rock" ? ROCK_CLEAR : 0) : tool.id === "roadup" ? B[roadNext(S.tiles[idx(x, y)].b)]?.cost || 0 : tool.id === "fill" ? FILL_COST : tool.id === "bulldoze" ? 0 : tool.id === "upgrade" ? upgradePrice(S, S.tiles[idx(x, y)].b).total : buildCost(S, x, y, tool.id));
/** The upgrade tool works on one kind: homes, shops, or farms and workshops. */
export const upFits = (b) => upgradable(b) && (!tool?.cat || B[b.id].cat === tool.cat);
export const upgradeWhy = (x, y) => { const b = S.tiles[idx(x, y)].b; return !upFits(b) ? (tool?.cat === "shop" ? "اضغط على محل" : tool?.cat === "farm" ? "اضغط على مزرعة أو ورشة" : tool?.cat === "serv" ? "اضغط على مسجد أو مستشفى" : "اضغط على بيت") : upgradeBlocker(S, A, x, y); };
export const canDo = (x, y) => { const t = S.tiles[idx(x, y)]; if (tool.id === "roadup") return !!roadNext(t.b) && !roadUpWhy(x, y); if (tool.id === "fill") return owns(S, x, y) && t.t === "wadi" && !t.b; return tool.id === "bulldoze" ? !!(t.b || t.t === "rock") : tool.id === "upgrade" ? !upgradeWhy(x, y) : !cantBuild(S, x, y, tool.id); };
export const whyNot = (x, y) => (tool.id === "roadup" ? roadUpWhy(x, y) : tool.id === "fill" ? (S.tiles[idx(x, y)].t !== "wadi" ? "الردم على أرض الوادي بس" : "شيل اللي عليها أول") : tool.id === "upgrade" ? upgradeWhy(x, y) : cantBuild(S, x, y, tool.id));
/** The next road up from this one: dirt → asphalt (needs the research) → main street. */
export const roadNext = (b) => (b?.id === "road" ? "asphalt" : b?.id === "asphalt" ? "avenue" : null);
export function roadUpWhy(x, y) {
  const b = S.tiles[idx(x, y)].b, next = roadNext(b);
  if (!b || !ROAD_IDS.includes(b.id)) return "اضغط على طريق";
  if (!next) return b.id === "avenue" ? "هذا شارع رئيسي: أعلى مستوى" : "الدوار والإشارة ما تتطور";
  if (B[next].tech && !S.tech[B[next].tech]) return "تحتاج بحث «السفلتة» من المجلس أول";
  if (B[next].era > S.era) return `تحتاج البلد تصير ${ERAS[B[next].era].name}`;
  return cantBuild(S, x, y, next) || "";
}
export function readyRoads() {
  const values = new Float32Array(N * N);
  S.tiles.forEach((t, i) => { if (roadNext(t.b) && !roadUpWhy(i % N, Math.floor(i / N))) values[i] = 1; });
  return values;
}
export function readyHouses() {
  const values = new Float32Array(N * N);
  S.tiles.forEach((t, i) => { if (upFits(t.b) && !upgradeBlocker(S, A, i % N, Math.floor(i / N))) values[i] = 1; });
  return values;
}
export const signed = (v) => `${v >= 0 ? "+" : "−"}${fine(Math.abs(v))}`;
/** The homes (and the people in them) within a building's reach: who it serves, or who its smoke bothers. */
export function reachHomes(spots, rad) {
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
export function reachLine(id, spots, lvlUp = 0) {
  const d = B[id];
  if (!d?.radius || (!d.happy && !d.pollute)) return "";
  const r = reachHomes(spots, d.radius + lvlUp), who = `${ar(r.homes)} ${r.homes >= 3 && r.homes <= 10 ? "بيوت" : "بيت"}${r.people ? ` (${ar(r.people)} ساكن)` : ""}`;
  if (d.pollute) return r.homes ? `⚠️ دخانه وإزعاجه بيزعّل ${who}` : "ما حوله بيوت: ما يزعج أحد ✓";
  if (d.service === "mosque") return `مداه ${ar(d.radius + lvlUp)} مربعات حوله (الأخضر)`;
  return r.homes ? `يخدم ${who}` : "ما حوله بيوت للحين";
}
export function showPending() {
  if (!tool) return;
  if (tool.id === "move") { showMove(); return; }
  if (tool.id === "upgrade" && !pending.length) world.setOverlay(readyHouses(), "#e0a44a");
  else if (tool.id === "roadup" && !pending.length) world.setOverlay(readyRoads(), "#ff9a1f", 0.62, 0.12); // above the road surface (a strong orange: dirt roads are already sandy)
  else if (isMulti()) {
    const values = new Float32Array(N * N);
    for (const p of pending) values[idx(p.x, p.y)] = 1;
    world.setOverlay(pending.length ? values : null, tool.id === "bulldoze" ? "#e0523f" : tool.id === "upgrade" || tool.id === "roadup" ? "#e0a44a" : "#2cb59c", tool.id === "roadup" ? 0.55 : 0.3, tool.id === "roadup" ? 0.12 : tool.id === "fill" ? 0.05 : 0.015); // the fill marks above the wadi's water in rain
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
export function stepTiles(a, b) {
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
export function roadAim(r, t) {
  const last = r.path[r.path.length - 1];
  if (last.x === t.x && last.y === t.y) return r.path;
  for (const p of stepTiles(last, t)) {
    const k = r.path.findIndex((q) => q.x === p.x && q.y === p.y);
    if (k >= 0) r.path = r.path.slice(0, k + 1); else r.path.push(p);
  }
  return r.path;
}
export const roadAimStart = (t) => ({ path: [t] });
export function paintAt(sx, sy) {
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
