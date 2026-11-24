// Every building as a low-poly 3D model, built from simple shapes in the style of the region:
// goat-hair tents, Najdi mud houses with crenellations, water towers, a Najdi mosque, palms.
// Each model is merged into at most three geometries (matte, shiny, night lights) for fast drawing.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const C = {
  sand: "#e8cf9a", mud: "#c9935a", mudDark: "#a9744a", mudLight: "#d8a96e", plaster: "#efe3cc", white: "#f5f2ea",
  stone: "#d9c3a0", wood: "#6b4426", door: "#5a3a22", green: "#2f7d5b", teal: "#2c8a7a", glass: "#4f7f99",
  red: "#b3261e", black: "#2a221d", gold: "#d4a53a", grey: "#8e959a", dark: "#3b3f44", grass: "#79b35a",
  soil: "#8a6a43", leaf: "#3f8a3c", leafDark: "#2f6f31", trunk: "#7a5530", cream: "#f1e4c8", blue: "#2f5f9e",
  light: "#ffd27a", water: "#4f9fc0", orange: "#d9822b"
};

const tmp = new THREE.Object3D();
/** The window and panel colours of the older models: drawn as real glass. */
const GLASS = new Set(["#4f7f99", "#2d3a46", "#26415e", "#1d3b55", "#1f3f6b", "#2a3a46", "#22303a"]);
/**
 * The material sets a model is split into (one draw each): matte and shiny as before, lights that glow at
 * night, and for the newer, more realistic models: paint (semi-gloss painted metal with a fine normal map),
 * metal (bare steel), glass (dark tinted) and glow (lamps and screens bright enough to bloom).
 */
export const SETS = ["matte", "shiny", "lights", "paint", "metal", "glass", "glow"];

/** Collects coloured parts and merges them into one geometry per material. */
class Builder {
  constructor() { this.sets = Object.fromEntries(SETS.map((k) => [k, []])); }
  add(geo, color, o = {}, set = "matte") {
    if ((set === "matte" || set === "shiny") && GLASS.has(String(color).toLowerCase())) set = "glass"; // windows and solar panels reflect the sky
    tmp.position.set(o.x || 0, o.y || 0, o.z || 0);
    tmp.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
    tmp.scale.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
    tmp.updateMatrix();
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(tmp.matrix);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "color", "uv"].includes(k)) g.deleteAttribute(k);
    this.sets[set].push(g);
    return this;
  }
  box(w, h, d, color, o = {}, set) {
    // walls and big blocks get softly rounded edges that catch the light (small parts stay plain boxes: cheaper)
    const lo = Math.min(w, h, d), hi = Math.max(w, h, d);
    const geo = lo >= 0.1 && hi >= 0.22 ? new RoundedBoxGeometry(w, h, d, 1, Math.min(0.016, lo / 6)) : new THREE.BoxGeometry(w, h, d);
    return this.add(geo, color, { ...o, y: (o.y || 0) + h / 2 }, set);
  }
  cyl(rt, rb, h, color, o = {}, seg = 10, set) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, { ...o, y: (o.y || 0) + h / 2 }, set); }
  dome(r, color, o = {}, set) { return this.add(new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), color, o, set); }
  cone(r, h, color, o = {}, seg = 4, set) { return this.add(new THREE.ConeGeometry(r, h, seg), color, { ...o, y: (o.y || 0) + h / 2 }, set); }
  /** A box with rounded edges (catches the light like real panels). */
  rbox(w, h, d, r, color, o = {}, set = "paint") { return this.add(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)), color, { ...o, y: (o.y || 0) + h / 2 }, set); }
  /** A turned shape from a profile [[radius, y], ...] (noses, nozzles, domes). */
  lathe(points, color, o = {}, seg = 16, set = "paint") { return this.add(new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg), color, o, set); }
  /** A flat shape extruded thin (fins, wings, blades). pts: [[x, y], ...] in the shape's plane. */
  plate(pts, depth, color, o = {}, set = "paint") {
    const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false });
    g.translate(0, 0, -depth / 2);
    return this.add(g, color, o, set);
  }
  done() {
    const out = {};
    for (const [k, list] of Object.entries(this.sets)) out[k] = list.length ? merge(list) : null;
    return out;
  }
}

function merge(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const withUv = list.every((g) => g.attributes.uv), uv = withUv ? new Float32Array(n * 2) : null;
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    if (uv) uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
    g.dispose();
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  m.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  m.setAttribute("color", new THREE.BufferAttribute(col, 3));
  if (uv) m.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  m.computeBoundingSphere();
  return m;
}

// ---------- shared pieces ----------

/** Najdi crenellations: little stepped teeth along the roof edge. */
function crenels(b, w, d, y, color, size = 0.07) {
  const step = size * 2.2;
  for (let x = -w / 2 + size; x <= w / 2 - size + 1e-6; x += step) {
    b.cone(size * 0.9, size * 1.6, color, { x, y, z: d / 2 - size * 0.3, ry: Math.PI / 4 });
    b.cone(size * 0.9, size * 1.6, color, { x, y, z: -d / 2 + size * 0.3, ry: Math.PI / 4 });
  }
  for (let z = -d / 2 + size + step; z <= d / 2 - size - step + 1e-6; z += step) {
    b.cone(size * 0.9, size * 1.6, color, { x: w / 2 - size * 0.3, y, z, ry: Math.PI / 4 });
    b.cone(size * 0.9, size * 1.6, color, { x: -w / 2 + size * 0.3, y, z, ry: Math.PI / 4 });
  }
}

/** Wooden beam ends sticking out of a mud wall (front face). */
function beams(b, w, y, z, n = 4) {
  for (let i = 0; i < n; i++) b.cyl(0.018, 0.018, 0.12, C.wood, { x: -w / 2 + (i + 0.5) * w / n, y, z: z + 0.04, rx: Math.PI / 2 }, 5);
}

function windowsRow(b, w, y, z, n, h = 0.08, color = C.glass, side = "front") {
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (i + 0.5) * w / n;
    if (side === "front") b.box(w / n * 0.45, h, 0.02, color, { x, y, z }, "shiny");
    else b.box(0.02, h, w / n * 0.45, color, { x: z, y, z: x }, "shiny");
  }
}

function nightWindows(b, w, y, z, n, h = 0.07) {
  for (let i = 0; i < n; i++) b.box(w / n * 0.4, h, 0.022, C.light, { x: -w / 2 + (i + 0.5) * w / n, y, z }, "lights");
}

/** An olive tree: a gnarled grey trunk and a round silvery-green crown. */
export function oliveTree(b, x, z, s = 1) {
  b.cyl(0.018 * s, 0.03 * s, 0.14 * s, "#7d6a55", { x, z }, 6);
  b.add(new THREE.CylinderGeometry(0.012 * s, 0.02 * s, 0.1 * s, 5), "#7d6a55", { x: x + 0.02 * s, y: 0.17 * s, z, rz: -0.5 });
  b.add(new THREE.IcosahedronGeometry(0.1 * s, 0), "#7f9a5c", { x, y: 0.22 * s, z, sy: 0.75 });
  b.add(new THREE.IcosahedronGeometry(0.07 * s, 0), "#94ab6e", { x: x + 0.06 * s, y: 0.2 * s, z: z + 0.03 * s, sy: 0.8 });
  b.add(new THREE.IcosahedronGeometry(0.065 * s, 0), "#6e8a4e", { x: x - 0.05 * s, y: 0.19 * s, z: z - 0.04 * s, sy: 0.8 });
}
export function palm(b, x, z, s = 1, lean = 0) {
  // a date palm: a ringed trunk (the old frond bases), a crown of arching fronds with leaflets, dates under it
  const segs = 7, h = 0.62 * s;
  for (let i = 0; i < segs; i++) {
    const t = i / segs, r = 0.032 * s * (1 - t * 0.3);
    b.cyl(r * 0.9, r * 1.05, h / segs + 0.006, i % 2 ? C.trunk : "#6b4a2b", { x: x + lean * t * t * 0.2, y: t * h, z }, 7);
    b.cyl(r * 1.12, r * 1.12, 0.012, "#5c3f24", { x: x + lean * t * t * 0.2, y: t * h + h / segs - 0.006, z }, 7);
  }
  const top = { x: x + lean * 0.2, y: h, z };
  const fronds = 11;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + (i % 2) * 0.15, up = i % 3 === 0 ? 0.25 : 0; // a few young fronds stand up
    // e: how steeply each part of the frond points up (it rises a little, then arches over and down)
    let px = top.x, py = top.y + 0.01, pz = top.z, e = 0.55 + up;
    for (let k = 0; k < 3; k++) {
      const len = 0.13 * s, cx = Math.cos(a), cz = Math.sin(a);
      const dx = cx * Math.cos(e) * len, dy = Math.sin(e) * len, dz = cz * Math.cos(e) * len;
      const shade = k === 2 ? C.leafDark : i % 2 ? C.leaf : "#357d38";
      b.add(new THREE.BoxGeometry(len, 0.006, 0.012 * s), "#6f8f3a", { x: px + dx / 2, y: py + dy / 2, z: pz + dz / 2, ry: -a, rz: e });
      b.add(new THREE.BoxGeometry(len * 1.02, 0.004, (0.075 - k * 0.018) * s), shade, { x: px + dx / 2, y: py + dy / 2 - 0.004, z: pz + dz / 2, ry: -a, rz: e, rx: 0.35 });
      px += dx; py += dy; pz += dz;
      e -= 0.55; // each part bends further down
    }
  }
  for (let i = 0; i < 4; i++) {
    const a = i * 1.6 + 0.4;
    for (let k = 0; k < 3; k++) b.add(new THREE.SphereGeometry(0.02 * s, 6, 4), k ? "#c46a1c" : C.orange, { x: top.x + Math.cos(a) * 0.05 * s + (k - 1) * 0.012, y: top.y - 0.05 * s - k * 0.018, z: top.z + Math.sin(a) * 0.05 * s });
  }
}

function tree(b, x, z, s = 1) {
  b.cyl(0.025 * s, 0.03 * s, 0.22 * s, C.trunk, { x, z }, 5);
  b.add(new THREE.IcosahedronGeometry(0.15 * s, 0), C.leaf, { x, y: 0.3 * s, z });
  b.add(new THREE.IcosahedronGeometry(0.1 * s, 0), C.grass, { x: x + 0.06 * s, y: 0.38 * s, z: z - 0.03 * s });
}

function wallAround(b, size, h, color, gate = true) {
  const t = 0.04, half = size / 2;
  b.box(size, h, t, color, { z: -half });
  b.box(t, h, size, color, { x: -half });
  b.box(t, h, size, color, { x: half });
  if (gate) { b.box(size * 0.35, h, t, color, { x: -half + size * 0.175, z: half }); b.box(size * 0.35, h, t, color, { x: half - size * 0.175, z: half }); }
  else b.box(size, h, t, color, { z: half });
}

function awning(b, w, y, z, color) {
  b.add(new THREE.BoxGeometry(w, 0.02, 0.18), color, { y, z: z + 0.08, rx: 0.35 });
}

function sign(b, w, y, z, color) { b.box(w, 0.07, 0.02, color, { y, z }); }

function crescent(b, x, y, z, color = C.red) {
  b.add(new THREE.TorusGeometry(0.05, 0.016, 5, 12, Math.PI * 1.3), color, { x, y, z, rz: 0.9 });
}

/** A face with a shemagh (red-and-white or white) and the black iqal on top. */
function head(b, cloth) {
  b.add(new THREE.SphereGeometry(0.019, 12, 9), "#b98a63", { y: 0.132 });
  b.add(new THREE.SphereGeometry(0.023, 14, 8, 0, Math.PI * 2, 0, Math.PI / 1.7), cloth, { x: -0.003, y: 0.136 });
  b.add(new THREE.BoxGeometry(0.008, 0.05, 0.05), cloth, { x: -0.019, y: 0.115 });                 // falls down the back
  for (const z of [0.021, -0.021]) b.add(new THREE.BoxGeometry(0.02, 0.04, 0.005), cloth, { x: 0.001, y: 0.118, z });
  b.add(new THREE.TorusGeometry(0.018, 0.0045, 6, 16), "#111", { y: 0.15, rx: Math.PI / 2 });
}

/** A box-shaped AC unit on a wall or roof. */
function acUnit(b, x, y, z, ry = 0) {
  b.box(0.08, 0.06, 0.05, "#e7e7e2", { x, y, z, ry });
  b.cyl(0.018, 0.018, 0.004, C.dark, { x: x + Math.sin(ry) * 0.026, y: y + 0.03, z: z + Math.cos(ry) * 0.026, rx: Math.PI / 2, ry }, 8);
}
function dish(b, x, y, z) {
  b.cyl(0.004, 0.004, 0.05, C.grey, { x, y, z }, 4);
  b.add(new THREE.SphereGeometry(0.04, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2.4), "#ececec", { x, y: y + 0.06, z, rx: -1.1 });
}
function pot(b, x, z, s = 1) {
  b.cyl(0.03 * s, 0.022 * s, 0.05 * s, "#b5683c", { x, z }, 7);
  b.add(new THREE.IcosahedronGeometry(0.045 * s, 0), C.leaf, { x, y: 0.08 * s, z });
}
/** Sadu weaving: the red, black and white bands of Bedouin rugs. */
function sadu(b, w, d, x, z) {
  b.box(w, 0.008, d, "#8f1f1a", { x, z });
  for (let i = 0; i < 5; i++) b.box(w * 0.94, 0.01, d * 0.08, i % 2 ? C.cream : "#1f1915", { x, z: z - d * 0.38 + i * d * 0.19 });
  for (let i = 0; i < 4; i++) b.box(w * 0.08, 0.012, d * 0.08, C.gold, { x: x - w * 0.3 + i * w * 0.2, z });
}

/** A window with a dark frame and glass (and a warm glow at night when lit). */
function frameWin(b, x, y, z, w, h, lit = false, side = false) {
  const o = side ? { x: z, y, z: x, ry: Math.PI / 2 } : { x, y, z };
  b.box(w + 0.016, h + 0.016, 0.012, "#3a3733", { ...o, y: y - 0.008 });
  b.box(w, h, 0.014, "#22303a", { ...o, y }, "glass");
  if (lit) b.box(w * 0.92, h * 0.9, 0.016, C.light, { ...o, y: y + h * 0.05 }, "lights");
}
/** A split AC unit hung on a facade. */
function splitAC(b, x, y, z) { b.box(0.07, 0.045, 0.025, "#ecebe6", { x, y, z }); b.box(0.05, 0.004, 0.026, "#9aa0a6", { x, y: y + 0.01, z: z + 0.001 }); }
/** A rooftop water tank (the white or black plastic tanks on every Saudi roof). */
function roofTank(b, x, y, z, r = 0.055, color = C.white) { b.cyl(r, r, r * 1.6, color, { x, y, z }, 14); b.cyl(r * 0.35, r * 0.35, 0.012, color, { x, y: y + r * 1.6, z }, 10); }
/** A small modern car (sedan). */
function sedan(b, x, z, ry, color) {
  const g = new Builder();
  g.rbox(0.22, 0.05, 0.1, 0.014, color, { y: 0.018 }, "matte");
  g.rbox(0.12, 0.045, 0.092, 0.018, color, { x: -0.01, y: 0.06 }, "matte");
  g.box(0.11, 0.035, 0.094, "#22303a", { x: -0.01, y: 0.066 }, "glass");
  for (const [wx, wz] of [[0.07, 0.05], [0.07, -0.05], [-0.07, 0.05], [-0.07, -0.05]]) g.add(new THREE.CylinderGeometry(0.022, 0.022, 0.018, 12), "#1b1b1d", { x: wx, y: 0.022, z: wz, rx: Math.PI / 2 }, "matte");
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0.004, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1));
  for (const set of SETS) for (const part of g.sets[set]) { part.applyMatrix4(m); b.sets[set].push(part); }
}

function car(b, x, z, ry, color) {
  b.box(0.2, 0.06, 0.1, color, { x, y: 0.03, z, ry });
  b.box(0.11, 0.05, 0.09, C.glass, { x: x - Math.cos(ry) * 0.01, y: 0.09, z: z + Math.sin(ry) * 0.01, ry }, "shiny");
}

// ---------- the buildings ----------

/** A sheep: a wool body and a dark head. */
function sheep(b, x, z, ry = 0) {
  const c = Math.cos(ry), s = Math.sin(ry);
  b.box(0.11, 0.07, 0.07, "#f1ece0", { x, y: 0.05, z, ry });
  b.box(0.04, 0.045, 0.045, C.black, { x: x + c * 0.07, y: 0.075, z: z - s * 0.07, ry });
  for (const [lx, lz] of [[0.035, 0.022], [-0.035, 0.022], [0.035, -0.022], [-0.035, -0.022]]) b.box(0.015, 0.03, 0.015, C.black, { x: x + c * lx + s * lz, y: 0.015, z: z - s * lx + c * lz });
}
/** A small seated-height camel for pens and markets. */
function camelSmall(b, x, z, ry = 0) {
  const c = Math.cos(ry), s = Math.sin(ry), at = (dx, dz) => ({ x: x + c * dx + s * dz, z: z - s * dx + c * dz });
  const col = "#c49a63";
  b.box(0.2, 0.09, 0.08, col, { ...at(0, 0), y: 0.15, ry });
  b.box(0.08, 0.06, 0.06, col, { ...at(-0.01, 0), y: 0.21, ry });
  b.box(0.04, 0.12, 0.04, col, { ...at(0.11, 0), y: 0.18, ry, rz: -0.5 });
  b.box(0.07, 0.04, 0.04, col, { ...at(0.15, 0), y: 0.27, ry });
  for (const [lx, lz] of [[0.07, 0.03], [0.07, -0.03], [-0.07, 0.03], [-0.07, -0.03]]) b.box(0.02, 0.15, 0.02, "#a87f4d", { ...at(lx, lz), y: 0.015, ry });
}
/** Wooden posts and rails round the edge of a tile. */
function fenceRing(b, r) {
  for (let k = -4; k <= 4; k++) for (const [x, z] of [[k * r / 4, -r], [k * r / 4, r], [-r, k * r / 4], [r, k * r / 4]]) b.box(0.025, 0.14, 0.025, C.wood, { x, y: 0.015, z });
  for (const [w, d, x, z] of [[2 * r, 0.015, 0, -r], [2 * r, 0.015, 0, r], [0.015, 2 * r, -r, 0], [0.015, 2 * r, r, 0]]) { b.box(w, 0.015, d, C.wood, { x, y: 0.12, z }); b.box(w, 0.015, d, C.wood, { x, y: 0.07, z }); }
}
/** A shade on four poles. */
function shade(b, x, z, w, d) {
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.cyl(0.012, 0.012, 0.26, C.wood, { x: x + sx * w / 2, z: z + sz * d / 2 }, 4);
  b.box(w + 0.04, 0.015, d + 0.04, "#e6d6b0", { x, y: 0.26, z });
}

const MAKERS = {
  // بيت الشعر: low black tent, three peaks, sadu band, poles and ropes.
  tent0(b) {
    b.box(0.86, 0.02, 0.62, C.sand, {});
    const shape = new THREE.Shape();
    shape.moveTo(-0.42, 0); shape.lineTo(-0.42, 0.14); shape.lineTo(-0.27, 0.27); shape.lineTo(-0.12, 0.22); shape.lineTo(0, 0.3);
    shape.lineTo(0.12, 0.22); shape.lineTo(0.27, 0.27); shape.lineTo(0.42, 0.14); shape.lineTo(0.42, 0); shape.lineTo(-0.42, 0);
    const roof = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false });
    b.add(roof, C.black, { z: -0.25 });
    for (let i = 0; i < 8; i++) b.box(0.105, 0.05, 0.01, i % 2 ? C.cream : C.red, { x: -0.37 + i * 0.105, y: 0.03, z: 0.256 });
    b.box(0.3, 0.12, 0.01, "#1a1411", { x: 0.05, y: 0.07, z: 0.262 });
    for (const x of [-0.27, 0, 0.27]) b.cyl(0.01, 0.01, 0.3, C.wood, { x, z: 0.27 }, 4);
    for (const s of [-1, 1]) b.add(new THREE.BoxGeometry(0.2, 0.006, 0.006), "#8a7458", { x: s * 0.5, y: 0.08, z: 0, rz: s * 0.6 });
    b.add(new THREE.BoxGeometry(0.12, 0.05, 0.12), C.red, { x: -0.33, y: 0.025, z: 0.38 });
    // A sadu rug in front, a hearth ringed with stones, a dallah and a saddle.
    sadu(b, 0.34, 0.16, 0.04, 0.37);
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; b.add(new THREE.DodecahedronGeometry(0.018, 0), "#8d8174", { x: 0.33 + Math.cos(a) * 0.055, y: 0.012, z: 0.38 + Math.sin(a) * 0.055 }); }
    b.add(new THREE.ConeGeometry(0.03, 0.06, 5), "#ff8a2a", { x: 0.33, y: 0.03, z: 0.38 }, "lights");
    b.add(new THREE.BoxGeometry(0.05, 0.012, 0.012), "#3b2a1c", { x: 0.33, y: 0.01, z: 0.38, ry: 0.5 });
    b.cyl(0.012, 0.022, 0.04, C.gold, { x: 0.26, z: 0.44 }, 8, "shiny");
    b.cone(0.012, 0.02, C.gold, { x: 0.26, y: 0.04, z: 0.44 }, 8, "shiny");
    b.add(new THREE.BoxGeometry(0.02, 0.006, 0.006), C.gold, { x: 0.28, y: 0.035, z: 0.44, rz: 0.5 }, "shiny");
    b.add(new THREE.TorusGeometry(0.04, 0.012, 4, 8, Math.PI), C.wood, { x: -0.36, y: 0.0, z: 0.25, ry: Math.PI / 2 });
  },
  // Najdi mud house: thick walls, crenellations, beam ends, a carved door.
  house1(b) {
    b.box(0.7, 0.34, 0.6, C.mud);
    b.box(0.72, 0.03, 0.62, C.mudDark, { y: 0.34 });
    crenels(b, 0.7, 0.6, 0.37, C.mudLight, 0.05);
    beams(b, 0.7, 0.3, 0.3, 5);
    b.box(0.13, 0.2, 0.02, C.door, { x: 0.12, z: 0.3 });
    b.add(new THREE.ConeGeometry(0.035, 0.05, 3), C.mudDark, { x: -0.18, y: 0.24, z: 0.305, rz: Math.PI });
    b.add(new THREE.ConeGeometry(0.035, 0.05, 3), C.mudDark, { x: -0.06, y: 0.24, z: 0.305, rz: Math.PI });
    b.box(0.08, 0.06, 0.022, C.light, { x: -0.12, y: 0.15, z: 0.3 }, "lights");
    // white lime trim around the door, a corner buttress, a small yard with a water jar
    b.box(0.17, 0.02, 0.025, C.plaster, { x: 0.12, y: 0.2, z: 0.3 });
    b.box(0.02, 0.2, 0.025, C.plaster, { x: 0.035, z: 0.3 }); b.box(0.02, 0.2, 0.025, C.plaster, { x: 0.205, z: 0.3 });
    b.box(0.1, 0.4, 0.1, C.mudDark, { x: -0.33, z: -0.28 });
    b.box(0.06, 0.05, 0.02, C.wood, { x: -0.18, y: 0.15, z: 0.305 });
    b.box(0.3, 0.1, 0.03, C.mud, { x: 0.22, z: 0.44 }); b.box(0.03, 0.1, 0.14, C.mud, { x: 0.36, z: 0.37 });
    b.add(new THREE.SphereGeometry(0.035, 7, 5), "#b5683c", { x: -0.3, y: 0.035, z: 0.4, sy: 1.2 });
    b.box(0.6, 0.006, 0.2, "#d8b583", { x: 0, z: 0.4 });
  },
  // شعبي: two floors of plaster, a roof tank, an AC box, a small yard wall.
  house2(b) {
    wallAround(b, 0.92, 0.14, C.stone);
    b.box(0.66, 0.5, 0.56, C.plaster, { z: -0.06 });
    b.box(0.68, 0.035, 0.58, C.stone, { y: 0.5, z: -0.06 });
    b.box(0.68, 0.04, 0.58, C.stone, { y: 0.25, z: -0.06 });
    windowsRow(b, 0.66, 0.14, 0.225, 3);
    windowsRow(b, 0.66, 0.38, 0.225, 3);
    nightWindows(b, 0.66, 0.38, 0.226, 3);
    b.box(0.12, 0.17, 0.02, C.teal, { x: 0.2, z: 0.225 });
    b.cyl(0.07, 0.07, 0.1, C.white, { x: -0.18, y: 0.53, z: -0.15 }, 10);
    b.box(0.1, 0.07, 0.06, C.grey, { x: 0.33, y: 0.3, z: 0.05 });
    acUnit(b, -0.25, 0.3, 0.24); acUnit(b, 0.05, 0.3, 0.24);
    dish(b, 0.18, 0.53, -0.2);
    b.box(0.7, 0.05, 0.6, C.plaster, { y: 0.53, z: -0.06, sx: 1, sy: 1 });
    b.box(0.2, 0.13, 0.02, "#2f6d6a", { x: 0.2, z: 0.46 });
    pot(b, -0.36, 0.38); pot(b, -0.25, 0.38, 0.8);
    b.box(0.9, 0.006, 0.9, "#d9cdb3");
  },
  // فيلا: white villa, sand-stone trim, palm in the yard, gate and a car.
  // فيلا: a modern Saudi villa: stone base and cladding, framed windows, an entrance with columns, a glass
  // balcony, a roof annex with water tanks, a decorative wall with a metal gate, a tensile car shade, a garden.
  house3(b) {
    b.box(0.94, 0.006, 0.94, "#ddd3bd");
    b.box(0.36, 0.008, 0.26, "#7fae5a", { x: -0.24, z: 0.28 });
    // the boundary wall with its stone cap, and the big metal gate
    for (const [w, d, x, z] of [[0.96, 0.035, 0, -0.465], [0.035, 0.96, -0.465, 0], [0.035, 0.96, 0.465, 0], [0.42, 0.035, -0.27, 0.465], [0.2, 0.035, 0.37, 0.465]]) {
      b.box(w, 0.17, d, "#ece3d1", { x, z }); b.box(w + 0.012, 0.016, d + 0.012, "#c8b38c", { x, y: 0.17, z });
    }
    b.box(0.3, 0.15, 0.02, "#4b4038", { x: 0.12, z: 0.47 }, "metal");
    for (let i = 0; i < 6; i++) b.box(0.006, 0.13, 0.024, "#6b5b4b", { x: -0.01 + i * 0.05, y: 0.01, z: 0.47 }, "metal");
    for (const x of [-0.05, 0.29]) { b.box(0.05, 0.22, 0.05, "#c8b38c", { x, z: 0.465 }); b.box(0.03, 0.03, 0.03, C.light, { x, y: 0.22, z: 0.465 }, "lights"); }
    // the house: a stone base, two floors, a set-back upper block
    b.box(0.62, 0.07, 0.48, "#cdb894", { x: -0.04, z: -0.12 });
    b.box(0.6, 0.48, 0.46, "#f3eee4", { x: -0.04, y: 0.07, z: -0.12 });
    b.box(0.64, 0.025, 0.5, "#cdb894", { x: -0.04, y: 0.3, z: -0.12 });
    b.box(0.64, 0.03, 0.5, "#cdb894", { x: -0.04, y: 0.55, z: -0.12 });
    for (const x of [-0.27, -0.13]) { frameWin(b, x, 0.14, 0.113, 0.08, 0.12, x === -0.27); frameWin(b, x, 0.38, 0.113, 0.08, 0.12, x === -0.13); }
    frameWin(b, 0.13, 0.38, 0.113, 0.1, 0.12, true);
    // the entrance: two columns, a canopy and a wooden door
    for (const x of [0.06, 0.2]) b.cyl(0.018, 0.02, 0.27, "#e9dfcc", { x, z: 0.17 }, 12);
    b.box(0.2, 0.025, 0.12, "#cdb894", { x: 0.13, y: 0.27, z: 0.13 });
    b.box(0.09, 0.2, 0.014, "#6b4426", { x: 0.13, y: 0.07, z: 0.113 });
    b.box(0.01, 0.01, 0.01, C.gold, { x: 0.16, y: 0.17, z: 0.122 }, "metal");
    b.box(0.03, 0.03, 0.03, C.light, { x: 0.13, y: 0.24, z: 0.122 }, "lights");
    // a glass balcony on the upper floor
    b.box(0.18, 0.012, 0.08, "#cdb894", { x: 0.13, y: 0.31, z: 0.15 });
    b.box(0.18, 0.06, 0.006, "#9ec3d6", { x: 0.13, y: 0.322, z: 0.188 }, "glass");
    // on the roof: an annex, water tanks, AC units, a dish
    b.box(0.2, 0.14, 0.16, "#f3eee4", { x: -0.22, y: 0.58, z: -0.22 });
    b.box(0.22, 0.015, 0.18, "#cdb894", { x: -0.22, y: 0.72, z: -0.22 });
    roofTank(b, 0.0, 0.58, -0.25); roofTank(b, 0.11, 0.58, -0.25, 0.05, "#2b2b2e");
    acUnit(b, 0.12, 0.58, -0.06); acUnit(b, 0.0, 0.58, -0.06); dish(b, -0.3, 0.72, -0.15);
    // the car shade (مظلة): steel posts and a tensile sail, with the family car under it
    for (const [x, z] of [[0.27, 0.12], [0.43, 0.12], [0.27, 0.42], [0.43, 0.42]]) b.cyl(0.008, 0.008, 0.2, "#8f969c", { x, z }, 6, "metal");
    b.add(new THREE.BoxGeometry(0.2, 0.006, 0.34), "#f2efe6", { x: 0.35, y: 0.2, z: 0.27, rx: 0.12 }, "paint");
    sedan(b, 0.35, 0.27, Math.PI / 2, ["#f4f4f2", "#2a2c30", "#c9c3b5", "#7a1f1f"][0]);
    // the garden: a palm, small trees and pots
    palm(b, -0.36, 0.3, 0.7);
    tree(b, -0.12, 0.36, 0.6);
    pot(b, 0.04, 0.24, 0.7); pot(b, 0.22, 0.24, 0.7);
  },
  // عمارة: a tall block with glass bands and roof tanks.
  // عمارة: an apartment block: shops on the ground floor, then floors of flats with balconies and split AC
  // units on the facade, stone bands, and on the roof a stair room, water tanks and dishes.
  house4(b) {
    const h = 1.6, floors = 6;
    b.box(0.94, 0.006, 0.94, "#d6cfc0");
    // ground floor: shopfronts under a sign band
    b.box(0.8, 0.22, 0.72, "#d9cfbb");
    b.box(0.82, 0.05, 0.74, "#bba882", { y: 0.22 });
    for (const x of [-0.24, 0.0, 0.24]) {
      b.box(0.2, 0.16, 0.014, "#22303a", { x, y: 0.02, z: 0.362 }, "glass");
      b.box(0.19, 0.12, 0.016, C.light, { x, y: 0.04, z: 0.364 }, "lights");
      b.box(0.2, 0.04, 0.02, ["#1f6f5c", "#b3261e", "#2f5f9e"][Math.round(x / 0.24) + 1], { x, y: 0.225, z: 0.372 });
      b.box(0.14, 0.016, 0.022, "#fff6d8", { x, y: 0.237, z: 0.374 }, "glow");
    }
    // the flats
    b.box(0.76, h - 0.27, 0.68, "#ece4d3", { y: 0.27 });
    for (let f = 0; f < floors; f++) {
      const y = 0.32 + f * 0.21;
      b.box(0.78, 0.018, 0.7, "#c9b896", { y: y - 0.05 });
      for (const x of [-0.27, -0.09, 0.09, 0.27]) frameWin(b, x, y + 0.02, 0.343, 0.09, 0.12, (f + Math.round(x * 10)) % 3 === 0);
      for (const z of [-0.18, 0.12]) frameWin(b, z, y + 0.02, 0.383, 0.1, 0.11, false, true);
      for (const x of [-0.18, 0.18]) {
        b.box(0.2, 0.012, 0.09, "#c9b896", { x, y: y - 0.04, z: 0.39 });
        b.box(0.2, 0.05, 0.006, "#d6d1c6", { x, y: y - 0.03, z: 0.432 });
        splitAC(b, x + 0.12, y + 0.08, 0.35);
      }
    }
    // the roof: parapet, stair room, tanks, dishes
    b.box(0.8, 0.05, 0.72, "#c9b896", { y: h });
    b.box(0.2, 0.18, 0.18, "#ece4d3", { x: 0.22, y: h + 0.05, z: -0.18 });
    b.box(0.22, 0.015, 0.2, "#c9b896", { x: 0.22, y: h + 0.23, z: -0.18 });
    for (const [x, z, c] of [[-0.25, -0.2, C.white], [-0.12, -0.2, C.white], [-0.25, 0.0, "#2b2b2e"], [-0.12, 0.0, C.white]]) roofTank(b, x, h + 0.05, z, 0.05, c);
    dish(b, 0.25, h + 0.05, 0.18); dish(b, 0.1, h + 0.05, 0.2);
  },

  grocery(b) {
    b.box(0.66, 0.34, 0.54, C.plaster);
    b.box(0.68, 0.03, 0.56, C.stone, { y: 0.34 });
    b.box(0.46, 0.2, 0.02, C.glass, { z: 0.271 }, "shiny");
    b.box(0.4, 0.15, 0.022, C.light, { z: 0.272, y: 0.02 }, "lights");
    awning(b, 0.66, 0.27, 0.27, C.green);
    sign(b, 0.5, 0.36, 0.28, C.green);
    for (let i = 0; i < 3; i++) b.box(0.08, 0.06, 0.08, i % 2 ? C.orange : C.red, { x: -0.25 + i * 0.1, z: 0.38 });
  },
  cafe(b) {
    b.box(0.6, 0.32, 0.46, C.mudLight, { z: -0.08 });
    crenels(b, 0.6, 0.46, 0.33, C.mud, 0.035);
    b.box(0.4, 0.18, 0.02, C.glass, { z: 0.151 }, "shiny");
    b.box(0.36, 0.14, 0.022, C.light, { z: 0.152 }, "lights");
    awning(b, 0.6, 0.27, 0.15, "#7a3b1f");
    for (const x of [-0.2, 0.18]) { b.cyl(0.07, 0.07, 0.015, C.white, { x, y: 0.1, z: 0.33 }, 10); b.cyl(0.012, 0.012, 0.1, C.dark, { x, z: 0.33 }, 5); b.cyl(0.11, 0.004, 0.02, "#e9dcc0", { x, y: 0.32, z: 0.33 }, 10); b.cyl(0.006, 0.006, 0.32, C.dark, { x, z: 0.33 }, 4); }
  },
  // the town's vault: a stone strongroom with a steel door; bigger and grander as it is upgraded
  vault(b) { vaultParts(b, 0); }, vault1(b) { vaultParts(b, 1); }, vault2(b) { vaultParts(b, 2); },
  bank(b) {
    b.box(0.92, 0.02, 0.92, C.stone);
    b.box(0.74, 0.44, 0.56, "#e9e2d2", { z: -0.06 });
    b.box(0.8, 0.05, 0.62, C.stone, { y: 0.44, z: -0.06 });
    b.box(0.6, 0.04, 0.12, C.stone, { y: 0.02, z: 0.28 });
    for (const x of [-0.24, -0.08, 0.08, 0.24]) b.cyl(0.03, 0.03, 0.4, C.white, { x, y: 0.04, z: 0.28 }, 8);
    b.box(0.66, 0.05, 0.16, C.stone, { y: 0.42, z: 0.28 });
    b.box(0.16, 0.22, 0.02, C.glass, { z: 0.221, y: 0.02 }, "shiny");
    b.box(0.4, 0.07, 0.02, "#1f6f5c", { y: 0.33, z: 0.222 });
    b.box(0.2, 0.025, 0.022, C.gold, { y: 0.335, z: 0.234 });
    b.box(0.03, 0.1, 0.03, C.gold, { x: -0.3, y: 0.49, z: -0.2 });
  },
  souq(b) {
    b.box(0.92, 0.02, 0.92, C.stone);
    const cloth = [C.red, C.teal, C.gold, "#7a3b1f"];
    for (let i = 0; i < 4; i++) {
      const x = -0.3 + (i % 2) * 0.6, z = -0.25 + Math.floor(i / 2) * 0.5;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.01, 0.01, 0.24, C.wood, { x: x + sx * 0.16, z: z + sz * 0.12 }, 4);
      b.add(new THREE.ConeGeometry(0.25, 0.1, 4), cloth[i], { x, y: 0.29, z, ry: Math.PI / 4, sx: 1.2, sz: 0.9 });
      b.box(0.3, 0.1, 0.18, C.wood, { x, z });
      for (let k = 0; k < 3; k++) b.add(new THREE.SphereGeometry(0.03, 5, 4), [C.orange, C.red, C.gold][k], { x: x - 0.08 + k * 0.08, y: 0.12, z });
    }
  },
  mandi(b) {
    b.box(0.7, 0.36, 0.54, C.plaster);
    b.box(0.72, 0.03, 0.56, "#9c3b22", { y: 0.36 });
    b.box(0.46, 0.2, 0.02, C.glass, { z: 0.271 }, "shiny");
    b.box(0.42, 0.16, 0.022, C.light, { z: 0.272, y: 0.02 }, "lights");
    awning(b, 0.7, 0.28, 0.27, C.red);
    sign(b, 0.5, 0.38, 0.28, C.red);
    b.cyl(0.04, 0.04, 0.22, C.grey, { x: 0.25, y: 0.36, z: -0.15 }, 6);
  },
  hotel(b) {
    const h = 1.9;
    b.box(0.82, h, 0.62, "#e7dcc6");
    for (let f = 0; f < 9; f++) { windowsRow(b, 0.82, 0.25 + f * 0.19, 0.312, 5, 0.1); if (f % 3 === 1) nightWindows(b, 0.82, 0.25 + f * 0.19, 0.314, 5, 0.08); }
    b.box(0.86, 0.08, 0.66, C.stone, { y: h });
    b.box(0.5, 0.1, 0.03, C.red, { y: h - 0.2, z: 0.32 });
    b.box(0.5, 0.03, 0.3, C.stone, { y: 0.24, z: 0.42 });
    for (const x of [-0.22, 0.22]) b.cyl(0.015, 0.015, 0.24, C.stone, { x, z: 0.55 }, 5);
  },
  mall(b) {
    b.box(0.94, 0.56, 0.84, "#d9e4e6");
    b.box(0.94, 0.3, 0.02, C.glass, { y: 0.06, z: 0.421 }, "shiny");
    b.box(0.9, 0.26, 0.022, C.light, { y: 0.08, z: 0.422 }, "lights");
    b.box(0.96, 0.05, 0.86, C.stone, { y: 0.56 });
    b.box(0.5, 0.1, 0.03, C.teal, { y: 0.44, z: 0.43 });
    b.add(new THREE.BoxGeometry(0.4, 0.02, 0.22), C.white, { y: 0.3, z: 0.52 });
    b.dome(0.16, C.glass, { y: 0.6 }, "shiny");
  },

  palms(b, ground) {
    b.box(0.94, 0.015, 0.94, ground === "wadi" ? "#9a8a55" : "#a99064");
    b.box(0.94, 0.06, 0.03, C.mud, { z: -0.46 }); b.box(0.03, 0.06, 0.94, C.mud, { x: -0.46 }); b.box(0.03, 0.06, 0.94, C.mud, { x: 0.46 });
    b.box(0.7, 0.012, 0.05, C.water, { y: 0.015, z: 0.4 }, "shiny");
    palm(b, -0.22, -0.2, 1, 0.3); palm(b, 0.22, -0.22, 0.9, -0.2); palm(b, -0.2, 0.2, 0.85, -0.1); palm(b, 0.24, 0.18, 1.05, 0.2);
  },
  veg(b) {
    b.box(0.94, 0.015, 0.94, C.soil);
    for (let i = 0; i < 6; i++) b.box(0.84, 0.05, 0.07, i % 2 ? C.grass : "#5fa34a", { z: -0.36 + i * 0.14, y: 0.015 });
    b.box(0.16, 0.18, 0.16, C.plaster, { x: 0.36, z: -0.36 });
    b.cyl(0.05, 0.05, 0.08, C.white, { x: 0.36, y: 0.18, z: -0.36 }, 8);
  },
  roundIsland(b) {
    b.cyl(0.24, 0.26, 0.05, C.stone);
    b.cyl(0.22, 0.22, 0.012, "#7fae4c", { y: 0.05 }, 20);
    palm(b, 0, 0, 0.6, 0);
  },
  trafficLight(b) {
    b.cyl(0.012, 0.012, 0.36, C.dark, {}, 6);
    b.box(0.05, 0.12, 0.05, C.black, { y: 0.32 });
    b.box(0.03, 0.03, 0.01, "#e0523f", { y: 0.41, z: 0.026 }, "lights");
    b.box(0.03, 0.03, 0.01, "#3fbf5f", { y: 0.35, z: 0.026 }, "lights");
  },
  medianPalm(b) { b.box(0.12, 0.03, 0.12, C.stone); palm(b, 0, 0, 0.45, 0.05); },
  parking(b) {
    b.box(0.98, 0.01, 0.98, "#55585e");
    for (let k = -2; k <= 2; k++) b.box(0.012, 0.004, 0.36, "#f3efe6", { x: k * 0.18, y: 0.01, z: -0.26 });
    for (let k = -2; k <= 2; k++) b.box(0.012, 0.004, 0.36, "#f3efe6", { x: k * 0.18, y: 0.01, z: 0.26 });
    for (const [x, z, c] of [[-0.27, -0.26, "#f4f4f2"], [0.09, -0.26, "#a8322a"], [-0.09, 0.26, "#c3c6ca"], [0.27, 0.26, "#2c3e63"]]) { b.box(0.13, 0.07, 0.26, c, { x, y: 0.01, z }); b.box(0.11, 0.05, 0.12, C.glass, { x, y: 0.07, z }, "shiny"); }
    b.cyl(0.01, 0.01, 0.4, C.dark, { x: 0.46, z: 0.46 }, 5); b.box(0.12, 0.12, 0.02, "#2f5f9e", { x: 0.46, y: 0.38, z: 0.46 });
  },
  avenue(b) { b.box(0.98, 0.01, 0.98, "#4d4f55"); b.box(0.98, 0.02, 0.12, "#cdbf9f", { y: 0.01 }); palm(b, 0, 0, 0.45, 0); },
  roundabout(b) { b.box(0.98, 0.01, 0.98, "#4d4f55"); b.cyl(0.24, 0.26, 0.05, C.stone); b.cyl(0.22, 0.22, 0.012, "#7fae4c", { y: 0.05 }, 20); },
  signal(b) { b.box(0.98, 0.01, 0.98, "#4d4f55"); b.cyl(0.02, 0.02, 0.5, C.dark, { x: 0.3, z: 0.3 }, 6); b.box(0.08, 0.2, 0.08, C.black, { x: 0.3, y: 0.42, z: 0.3 }); b.box(0.05, 0.05, 0.01, "#e0523f", { x: 0.3, y: 0.56, z: 0.345 }, "lights"); b.box(0.05, 0.05, 0.01, "#3fbf5f", { x: 0.3, y: 0.46, z: 0.345 }, "lights"); },
  quarry(b) {
    b.box(0.98, 0.012, 0.98, "#bfb6a5");
    b.add(new THREE.DodecahedronGeometry(0.2, 0), "#a39b8c", { x: -0.22, y: 0.12, z: -0.22, sy: 0.7 });
    b.add(new THREE.DodecahedronGeometry(0.14, 0), "#b5ad9e", { x: 0.05, y: 0.08, z: -0.3, sy: 0.6 });
    b.cone(0.16, 0.16, "#cfc7b8", { x: 0.25, z: 0.22 }, 8);
    b.cone(0.1, 0.1, "#9b9384", { x: -0.05, z: 0.3 }, 8);
    b.box(0.08, 0.3, 0.08, C.orange, { x: 0.25, z: -0.2 });
    b.box(0.32, 0.03, 0.06, C.orange, { x: 0.12, y: 0.28, z: -0.2, rz: 0.4 });
    b.box(0.14, 0.08, 0.1, "#d9a21c", { x: -0.25, y: 0.02, z: 0.22 });
  },
  blockfactory(b) {
    b.box(0.7, 0.3, 0.5, "#c4c0b6", { z: -0.18 });
    b.box(0.72, 0.03, 0.52, C.grey, { y: 0.3, z: -0.18 });
    b.cyl(0.08, 0.08, 0.5, "#d8d4cc", { x: 0.3, z: -0.3 }, 10);
    for (let k = 0; k < 6; k++) b.box(0.12, 0.06, 0.1, "#9c9a94", { x: -0.32 + (k % 3) * 0.14, y: Math.floor(k / 3) * 0.06, z: 0.3 });
    b.box(0.2, 0.16, 0.02, C.dark, { x: -0.1, z: 0.071 });
  },
  dairy(b) {
    b.box(0.76, 0.32, 0.5, C.white, { z: -0.16 });
    b.box(0.78, 0.03, 0.52, "#2f6f9e", { y: 0.32, z: -0.16 });
    for (const x of [-0.25, 0.25]) b.cyl(0.08, 0.08, 0.46, "#e9eef0", { x, z: 0.26 }, 12);
    for (const x of [-0.25, 0.25]) b.dome(0.08, "#e9eef0", { x, y: 0.46, z: 0.26 });
    b.box(0.22, 0.16, 0.02, "#2f6f9e", { x: 0, z: 0.091 });
    b.box(0.28, 0.06, 0.022, C.light, { y: 0.22, z: 0.092 }, "lights");
  },
  mill(b) {
    for (const [x, z] of [[-0.24, -0.2], [0.02, -0.2], [0.28, -0.2]]) { b.cyl(0.11, 0.11, 0.62, "#d7d2c7", { x, z }, 12); b.cone(0.12, 0.08, "#b7b1a5", { x, y: 0.62, z }, 12); }
    b.box(0.86, 0.06, 0.06, C.grey, { y: 0.66, z: -0.2 });
    b.box(0.42, 0.24, 0.26, "#e4d8b8", { x: -0.12, z: 0.24 });
    b.box(0.44, 0.03, 0.28, "#b88a3a", { x: -0.12, y: 0.24, z: 0.24 });
    b.box(0.14, 0.1, 0.12, "#d9b54a", { x: 0.3, z: 0.3 });
  },
  truckBody(b) {
    b.box(0.13, 0.11, 0.13, "#f4f4f2", { x: 0.12, y: 0.03 });
    b.box(0.02, 0.05, 0.11, C.glass, { x: 0.185, y: 0.08 }, "shiny");
    b.box(0.26, 0.03, 0.14, C.dark, { x: -0.07, y: 0.03 });
    for (const [x, z] of [[0.12, 0.07], [0.12, -0.07], [-0.12, 0.07], [-0.12, -0.07], [-0.02, 0.07], [-0.02, -0.07]]) b.cyl(0.028, 0.028, 0.025, C.black, { x, y: 0.0, z, rx: Math.PI / 2 }, 8);
  },
  truckCargo(b) { b.box(0.24, 0.08, 0.13, "#ffffff", { x: -0.07, y: 0.06 }); },
  dam(b) {
    // a concrete wall across the wadi (the water comes from the west, -x)
    b.box(0.26, 0.42, 1.0, "#c9c3b6");
    b.box(0.3, 0.04, 1.02, "#b3ad9f", { y: 0.42 });
    for (const z of [-0.47, 0.47]) b.box(0.3, 0.06, 0.02, C.grey, { y: 0.46, z });
    b.box(0.08, 0.3, 0.22, "#a8a294", { x: 0.16, z: 0 });
    b.box(0.3, 0.01, 0.2, C.water, { x: 0.3, y: 0.01, z: 0 }, "shiny");
    for (const z of [-0.3, 0.3]) b.box(0.04, 0.28, 0.06, "#b3ad9f", { x: -0.15, z });
  },
  pivot(b) {
    b.box(0.98, 0.012, 0.98, "#c9ad7c");
    b.add(new THREE.CylinderGeometry(0.47, 0.47, 0.02, 32), "#7fae4c", { y: 0.012 });
    b.add(new THREE.CylinderGeometry(0.33, 0.33, 0.022, 28), "#8fbd57", { y: 0.013 });
    b.add(new THREE.CylinderGeometry(0.16, 0.16, 0.024, 20), "#6e9e42", { y: 0.014 });
    b.cyl(0.03, 0.03, 0.14, C.grey, { y: 0.02 }, 8);
    b.box(0.46, 0.012, 0.014, "#9aa0a4", { x: 0.23, y: 0.14 });
    for (const x of [0.15, 0.3, 0.44]) { b.box(0.012, 0.13, 0.012, C.grey, { x, y: 0.02 }); b.box(0.04, 0.02, 0.04, C.dark, { x, y: 0.015 }); }
  },
  pen(b) {
    b.box(0.94, 0.015, 0.94, "#c9ad7c");
    fenceRing(b, 0.44);
    shade(b, -0.1, -0.26, 0.5, 0.26);
    b.box(0.3, 0.05, 0.08, "#8a8f94", { x: 0.18, y: 0.015, z: 0.3 }); b.box(0.26, 0.01, 0.05, C.water, { x: 0.18, y: 0.06, z: 0.3 }, "shiny");
    sheep(b, -0.22, 0.12, 0.4); sheep(b, 0.02, 0.06, -0.3); sheep(b, -0.1, 0.28, 1.2);
    camelSmall(b, 0.24, -0.04, 0.3);
  },
  livestock(b) {
    b.box(0.94, 0.015, 0.94, "#cdb48a");
    for (const [x, z] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.1], [0.42, 0.1]]) b.cyl(0.018, 0.018, 0.4, C.wood, { x, z }, 5);
    b.box(0.92, 0.02, 0.6, "#e9dcc0", { y: 0.4, z: -0.16 });
    b.box(0.92, 0.04, 0.02, C.red, { y: 0.38, z: 0.14 });
    for (const x of [-0.25, 0.25]) { b.box(0.36, 0.06, 0.02, C.wood, { x, y: 0.1, z: -0.02 }); b.box(0.02, 0.12, 0.3, C.wood, { x: x - 0.18, y: 0.015, z: -0.17 }); }
    sheep(b, -0.32, -0.2, 0); sheep(b, -0.18, -0.3, 2); sheep(b, -0.24, -0.08, 1);
    camelSmall(b, 0.22, -0.2, 1.5); camelSmall(b, 0.3, 0.3, 0.2);
    b.box(0.26, 0.08, 0.16, C.stone, { x: -0.22, z: 0.3 }); b.box(0.04, 0.1, 0.04, C.dark, { x: -0.22, y: 0.08, z: 0.3 });
  },
  mazayen(b) {
    b.box(0.98, 0.015, 0.98, "#d8bf8c");
    const ring = new THREE.CylinderGeometry(0.4, 0.4, 0.07, 28, 1, true);
    b.add(ring, C.white, { y: 0.015 });
    b.add(new THREE.CylinderGeometry(0.39, 0.39, 0.004, 28), "#cfae74", { y: 0.016 });
    for (let k = 0; k < 3; k++) b.box(0.9, 0.06 * (3 - k), 0.06, k % 2 ? C.stone : "#e4d6b8", { z: -0.46 + k * 0.06 });
    for (let k = 0; k < 4; k++) b.cyl(0.008, 0.008, 0.3, C.dark, { x: -0.42 + k * 0.28, z: -0.48 }, 4);
    b.box(0.92, 0.015, 0.14, C.green, { y: 0.3, z: -0.44 });
    for (const x of [-0.44, 0.44]) { b.cyl(0.01, 0.01, 0.45, C.dark, { x, z: 0.44 }, 4); b.box(0.12, 0.07, 0.006, C.green, { x: x + (x < 0 ? 0.06 : -0.06), y: 0.4, z: 0.44 }); }
    camelSmall(b, -0.12, 0.02, 0.5); camelSmall(b, 0.14, 0.12, 2.6); camelSmall(b, 0.02, -0.2, 1.4);
    b.box(0.2, 0.02, 0.12, C.red, { x: 0.36, z: 0.3 });
  },
  workshop(b) {
    b.box(0.74, 0.32, 0.6, "#a7a49b");
    const roof = new THREE.CylinderGeometry(0.31, 0.31, 0.76, 8, 1, false, 0, Math.PI);
    b.add(roof, "#8d8a82", { y: 0.32, rz: Math.PI / 2, ry: 0 });
    b.box(0.3, 0.24, 0.02, "#5c564d", { z: 0.301 });
    for (let i = 0; i < 3; i++) b.box(0.12, 0.1, 0.1, C.wood, { x: -0.3 + i * 0.14, z: 0.4 });
  },
  datefactory(b) {
    b.box(0.86, 0.38, 0.6, "#d6b27a", { z: -0.1 });
    b.box(0.88, 0.03, 0.62, C.mudDark, { y: 0.38, z: -0.1 });
    b.cyl(0.12, 0.12, 0.5, C.white, { x: 0.32, z: 0.28 }, 10);
    b.dome(0.12, C.white, { x: 0.32, y: 0.5, z: 0.28 });
    b.box(0.3, 0.22, 0.02, "#7a4a1f", { x: -0.15, z: 0.201 });
    for (let i = 0; i < 4; i++) b.box(0.1, 0.07, 0.1, C.orange, { x: -0.35 + (i % 2) * 0.12, y: Math.floor(i / 2) * 0.07, z: 0.34 });
    b.box(0.5, 0.12, 0.022, C.light, { x: -0.1, y: 0.18, z: 0.202 }, "lights");
  },
  factory(b) {
    b.box(0.9, 0.42, 0.66, "#8f969c", { z: -0.08 });
    for (let i = 0; i < 3; i++) b.add(new THREE.BoxGeometry(0.3, 0.12, 0.66), "#7d838a", { x: -0.3 + i * 0.3, y: 0.46, z: -0.08, rz: 0.4 });
    for (const x of [0.25, 0.4]) b.cyl(0.05, 0.065, 0.9, "#6b6f73", { x, z: 0.3 }, 8);
    b.box(0.3, 0.26, 0.02, C.dark, { x: -0.2, z: 0.251 });
    b.box(0.6, 0.06, 0.022, C.light, { x: -0.1, y: 0.32, z: 0.252 }, "lights");
  },

  well(b) {
    b.cyl(0.2, 0.22, 0.16, C.stone, {}, 12);
    b.cyl(0.15, 0.15, 0.02, C.water, { y: 0.15 }, 12, "shiny");
    for (const x of [-0.2, 0.2]) b.box(0.03, 0.42, 0.03, C.wood, { x });
    b.box(0.46, 0.03, 0.03, C.wood, { y: 0.42 });
    b.cyl(0.035, 0.035, 0.08, C.wood, { y: 0.4, rz: Math.PI / 2 }, 6);
    b.cyl(0.04, 0.05, 0.08, C.wood, { x: 0.05, y: 0.2 }, 6);
  },
  // The mushroom water tower seen in towns across the Kingdom.
  tank(b) {
    b.cyl(0.06, 0.09, 0.9, C.white, {}, 10);
    b.cyl(0.32, 0.08, 0.22, "#d6e7ea", { y: 0.88 }, 16);
    b.cyl(0.32, 0.32, 0.08, "#c4dbe0", { y: 1.1 }, 16);
    b.dome(0.32, "#e4f0f2", { y: 1.18 });
    b.box(0.03, 0.02, 0.03, C.red, { y: 1.5 }, "lights");
  },
  desal(b) {
    b.box(0.5, 0.3, 0.4, C.white, { x: -0.2, z: -0.2 });
    for (const [x, z] of [[0.25, -0.2], [0.25, 0.22], [-0.2, 0.25]]) { b.cyl(0.14, 0.14, 0.28, "#cfe3ea", { x, z }, 12); b.dome(0.14, "#b9d6df", { x, y: 0.28, z }); }
    b.cyl(0.02, 0.02, 0.6, C.blue, { x: 0, y: 0.12, z: 0, rz: Math.PI / 2 }, 6);
  },
  generator(b) {
    b.box(0.62, 0.26, 0.34, "#7d8288");
    for (let i = 0; i < 5; i++) b.box(0.02, 0.2, 0.01, C.dark, { x: -0.25 + i * 0.12, y: 0.03, z: 0.175 });
    b.cyl(0.04, 0.04, 0.3, C.dark, { x: 0.22, y: 0.26 }, 6);
    b.box(0.1, 0.06, 0.02, C.gold, { x: -0.2, y: 0.18, z: 0.18 });
  },
  solar(b) {
    b.box(0.94, 0.012, 0.94, "#d9c89f");
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
      const x = -0.22 + c * 0.44, z = -0.3 + r * 0.3;
      b.box(0.02, 0.1, 0.02, C.grey, { x, z });
      b.add(new THREE.BoxGeometry(0.4, 0.018, 0.22), "#1f3f6b", { x, y: 0.12, z, rx: -0.45 }, "shiny");
    }
  },
  powerplant(b) {
    b.box(0.6, 0.36, 0.5, "#9aa1a6", { x: -0.15, z: 0.1 });
    for (const [x, z] of [[0.28, -0.25], [-0.2, -0.3]]) b.cyl(0.13, 0.19, 0.7, "#c9cfd3", { x, z }, 14);
    b.cyl(0.035, 0.035, 0.9, C.red, { x: 0.35, z: 0.3 }, 6);
    b.box(0.03, 0.03, 0.03, C.red, { x: 0.35, y: 0.92, z: 0.3 }, "lights");
  },

  // Najdi mosque: mud walls, crenellations and a square, tapering minaret.
  mosque(b) {
    b.box(0.76, 0.32, 0.66, C.mudLight, { z: -0.05 });
    b.box(0.78, 0.03, 0.68, C.mud, { y: 0.32, z: -0.05 });
    crenels(b, 0.76, 0.66, 0.35, C.mud, 0.04);
    beams(b, 0.76, 0.28, 0.28, 6);
    b.box(0.15, 0.2, 0.02, C.door, { z: 0.281 });
    b.add(new THREE.CylinderGeometry(0.06, 0.1, 0.62, 4), C.mudLight, { x: 0.3, y: 0.31 + 0.31, z: 0.22, ry: Math.PI / 4 });
    b.add(new THREE.ConeGeometry(0.07, 0.1, 4), C.mud, { x: 0.3, y: 0.98, z: 0.22, ry: Math.PI / 4 });
    b.box(0.04, 0.05, 0.02, C.light, { x: 0.3, y: 0.8, z: 0.28 }, "lights");
    b.box(0.3, 0.05, 0.022, C.light, { x: -0.18, y: 0.2, z: 0.281 }, "lights");
    b.box(0.92, 0.006, 0.3, "#e3c9a0", { z: 0.36 });
    b.box(0.03, 0.1, 0.3, C.mud, { x: -0.45, z: 0.36 }); b.box(0.03, 0.1, 0.3, C.mud, { x: 0.45, z: 0.36 });
    for (const x of [-0.3, -0.1]) b.box(0.03, 0.04, 0.03, C.light, { x, y: 0.26, z: 0.3 }, "lights");
    for (let i = 0; i < 3; i++) b.box(0.18, 0.008, 0.08, ["#8f1f1a", "#2f6d6a", "#8f1f1a"][i], { x: -0.3 + i * 0.2, z: 0.36 });
  },
  bigmosque(b) {
    b.box(0.92, 0.42, 0.84, C.white);
    b.box(0.94, 0.04, 0.86, C.stone, { y: 0.42 });
    b.cyl(0.22, 0.22, 0.12, C.white, { y: 0.44 }, 16);
    b.dome(0.24, C.gold, { y: 0.56 }, "shiny");
    b.cone(0.02, 0.08, C.gold, { y: 0.8 }, 6);
    for (const x of [-0.4, 0.4]) {
      b.cyl(0.05, 0.06, 1.15, C.white, { x, z: 0.36 }, 8);
      b.cyl(0.08, 0.08, 0.04, C.stone, { x, y: 0.8, z: 0.36 }, 8);
      b.cone(0.055, 0.14, C.gold, { x, y: 1.15, z: 0.36 }, 8);
      b.box(0.03, 0.04, 0.03, C.light, { x, y: 0.85, z: 0.4 }, "lights");
    }
    for (let i = 0; i < 4; i++) b.add(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 10, 1, false, 0, Math.PI), C.glass, { x: -0.27 + i * 0.18, y: 0.24, z: 0.425, rx: Math.PI / 2 }, "shiny");
  },
  school(b) {
    b.box(0.9, 0.42, 0.4, "#ead9a8", { z: -0.2 });
    b.box(0.92, 0.04, 0.42, C.green, { y: 0.42, z: -0.2 });
    windowsRow(b, 0.9, 0.14, 0.001, 5); windowsRow(b, 0.9, 0.3, 0.001, 5);
    b.box(0.92, 0.01, 0.48, "#c9b98f", { z: 0.24 });
    b.cyl(0.01, 0.01, 0.45, C.grey, { x: -0.36, z: 0.36 }, 4);
    b.box(0.14, 0.08, 0.008, C.green, { x: -0.29, y: 0.37, z: 0.36 });
    for (const x of [0.1, 0.3]) { b.box(0.02, 0.18, 0.02, C.white, { x: x - 0.06, z: 0.42 }); b.box(0.02, 0.18, 0.02, C.white, { x: x + 0.06, z: 0.42 }); b.box(0.14, 0.02, 0.02, C.white, { x, y: 0.18, z: 0.42 }); }
  },
  clinic(b) {
    b.box(0.68, 0.36, 0.52, C.white);
    b.box(0.7, 0.04, 0.54, C.green, { y: 0.36 });
    b.box(0.2, 0.2, 0.02, C.glass, { z: 0.261 }, "shiny");
    crescent(b, 0.2, 0.25, 0.27);
    b.box(0.5, 0.06, 0.022, C.light, { y: 0.27, z: 0.262, x: -0.08 }, "lights");
  },
  hospital(b) {
    b.box(0.9, 0.9, 0.62, C.white, { z: -0.1 });
    for (let f = 0; f < 4; f++) { windowsRow(b, 0.9, 0.15 + f * 0.2, 0.211, 6, 0.09); if (f % 2 === 0) nightWindows(b, 0.9, 0.15 + f * 0.2, 0.213, 6, 0.07); }
    b.box(0.92, 0.04, 0.64, C.green, { y: 0.9, z: -0.1 });
    b.cyl(0.2, 0.2, 0.01, "#d1421f", { y: 0.94, z: -0.1 }, 16);
    b.box(0.03, 0.012, 0.16, C.white, { x: -0.05, y: 0.95, z: -0.1 }); b.box(0.03, 0.012, 0.16, C.white, { x: 0.05, y: 0.95, z: -0.1 }); b.box(0.1, 0.012, 0.03, C.white, { y: 0.95, z: -0.1 });
    crescent(b, 0.3, 0.75, 0.22);
    b.box(0.4, 0.03, 0.2, C.white, { y: 0.22, z: 0.3 });
  },
  park(b) {
    b.box(0.96, 0.02, 0.96, C.grass);
    b.box(0.6, 0.022, 0.12, "#e3d4ae", {}); b.box(0.12, 0.022, 0.6, "#e3d4ae", {});
    b.cyl(0.12, 0.13, 0.06, C.stone, {}, 12); b.cyl(0.09, 0.09, 0.02, C.water, { y: 0.06 }, 12, "shiny");
    tree(b, -0.3, -0.3); tree(b, 0.3, -0.3, 0.9); tree(b, -0.3, 0.3, 1.1); palm(b, 0.32, 0.3, 0.7);
    b.box(0.14, 0.03, 0.05, C.wood, { x: -0.12, y: 0.05, z: 0.32 });
  },
  police(b) {
    b.box(0.7, 0.4, 0.52, C.white);
    b.box(0.72, 0.06, 0.54, C.blue, { y: 0.22 });
    b.box(0.72, 0.04, 0.54, C.blue, { y: 0.4 });
    b.box(0.2, 0.2, 0.02, C.glass, { z: 0.261 }, "shiny");
    b.box(0.08, 0.04, 0.04, C.blue, { x: -0.2, y: 0.44 }, "lights");
    car(b, 0.2, 0.4, 0, C.white);
  },
  civil(b) {
    b.box(0.72, 0.42, 0.52, "#ece4d6");
    b.box(0.74, 0.05, 0.54, "#d1421f", { y: 0.42 });
    for (const x of [-0.18, 0.18]) b.box(0.26, 0.26, 0.02, "#b3261e", { x, z: 0.261 });
    b.box(0.08, 0.04, 0.04, "#ff5a2a", { y: 0.47 }, "lights");
  },
  stadium(b) {
    b.box(0.96, 0.02, 0.96, "#bdb3a0");
    b.box(0.66, 0.025, 0.46, "#4fa64a");
    b.box(0.01, 0.027, 0.46, C.white); b.cyl(0.08, 0.08, 0.027, C.white, {}, 14);
    for (const z of [-0.36, 0.36]) b.add(new THREE.BoxGeometry(0.9, 0.16, 0.14), "#c9c2b4", { y: 0.08, z, rx: z > 0 ? -0.4 : 0.4 });
    for (const [x, z] of [[-0.45, -0.45], [0.45, 0.45]]) { b.cyl(0.012, 0.012, 0.8, C.grey, { x, z }, 4); b.box(0.12, 0.06, 0.03, C.light, { x, y: 0.8, z }, "lights"); }
  },
  university(b) {
    b.box(0.92, 0.5, 0.6, "#e2cfa8", { z: -0.12 });
    b.box(0.94, 0.04, 0.62, C.stone, { y: 0.5, z: -0.12 });
    b.cyl(0.18, 0.18, 0.12, "#e2cfa8", { y: 0.52, z: -0.12 }, 14);
    b.dome(0.19, "#2c6d8a", { y: 0.64, z: -0.12 }, "shiny");
    for (let i = 0; i < 6; i++) b.cyl(0.025, 0.025, 0.4, C.white, { x: -0.38 + i * 0.152, z: 0.22 }, 8);
    b.box(0.92, 0.05, 0.12, C.stone, { y: 0.4, z: 0.22 });
    windowsRow(b, 0.92, 0.24, 0.181, 6); nightWindows(b, 0.92, 0.24, 0.183, 6);
  },

  // ---------- decorations ----------
  streetpalm(b) {
    b.cyl(0.13, 0.14, 0.04, C.stone, {}, 10);
    b.cyl(0.11, 0.11, 0.01, C.soil, { y: 0.04 }, 10);
    palm(b, 0, 0, 0.95, 0.15);
  },
  flowers(b) {
    b.box(0.5, 0.06, 0.3, C.stone);
    b.box(0.46, 0.02, 0.26, C.soil, { y: 0.06 });
    const cols = ["#e74c3c", "#f4d03f", "#ffffff", "#e8a0b4", "#a77bca"];
    for (let i = 0; i < 14; i++) { const x = -0.19 + (i % 7) * 0.063, z = -0.07 + Math.floor(i / 7) * 0.14; b.add(new THREE.IcosahedronGeometry(0.028, 0), C.leaf, { x, y: 0.09, z }); b.add(new THREE.SphereGeometry(0.018, 5, 4), cols[i % cols.length], { x, y: 0.12, z }); }
  },
  // A wooden power pole with a cross arm; the wires are drawn between poles by the world.
  pole(b) {
    b.box(0.12, 0.03, 0.12, C.stone);
    b.cyl(0.028, 0.038, 0.95, "#7a5a3a", { y: 0.03 }, 6);
    b.box(0.42, 0.035, 0.05, "#6b4e33", { y: 0.88 });
    for (const x of [-0.18, 0, 0.18]) b.cyl(0.014, 0.014, 0.05, "#e9e4d8", { x, y: 0.905 }, 5, "shiny");
  },
  lantern(b) {
    b.box(0.14, 0.04, 0.14, C.stone);
    b.cyl(0.02, 0.025, 0.4, "#2b2b2e", { y: 0.04 }, 6);
    b.cyl(0.055, 0.04, 0.12, "#b8862b", { y: 0.44 }, 6, "shiny");
    b.cyl(0.045, 0.035, 0.1, "#ffd27a", { y: 0.45 }, 6, "lights");
    b.cone(0.06, 0.07, "#b8862b", { y: 0.56 }, 6, "shiny");
    b.add(new THREE.SphereGeometry(0.015, 5, 4), "#b8862b", { y: 0.64 }, "shiny");
  },
  fountain(b) {
    b.box(0.92, 0.012, 0.92, "#e3d4ae");
    b.cyl(0.36, 0.38, 0.08, C.stone, {}, 16);
    b.cyl(0.33, 0.33, 0.02, C.water, { y: 0.07 }, 16, "shiny");
    b.cyl(0.06, 0.08, 0.22, C.stone, { y: 0.08 }, 10);
    b.cyl(0.14, 0.1, 0.04, C.stone, { y: 0.28 }, 12);
    b.cyl(0.11, 0.11, 0.01, C.water, { y: 0.32 }, 12, "shiny");
    b.cone(0.03, 0.12, "#bfe6f2", { y: 0.32 }, 8, "shiny");
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; b.add(new THREE.IcosahedronGeometry(0.05, 0), C.leaf, { x: Math.cos(a) * 0.4, y: 0.04, z: Math.sin(a) * 0.4 }); }
  },
  // A roundabout with a giant dallah (Arabic coffee pot) on a plinth.
  dallah(b) {
    b.box(0.96, 0.01, 0.96, "#4d4f55");
    b.cyl(0.4, 0.42, 0.05, "#e7e2d6", {}, 20);
    b.cyl(0.36, 0.36, 0.02, C.grass, { y: 0.05 }, 20);
    b.cyl(0.1, 0.12, 0.12, C.stone, { y: 0.06 }, 8);
    const gold = C.gold;
    b.cyl(0.07, 0.12, 0.16, gold, { y: 0.18 }, 12, "shiny");
    b.cyl(0.05, 0.07, 0.05, gold, { y: 0.34 }, 12, "shiny");
    b.cone(0.07, 0.14, gold, { y: 0.39 }, 12, "shiny");
    b.add(new THREE.SphereGeometry(0.02, 6, 4), gold, { y: 0.54 }, "shiny");
    b.add(new THREE.CylinderGeometry(0.012, 0.02, 0.18, 6), gold, { x: 0.12, y: 0.32, rz: -0.9 }, "shiny");
    b.add(new THREE.TorusGeometry(0.06, 0.012, 5, 10, Math.PI), gold, { x: -0.1, y: 0.3, rz: Math.PI / 2 }, "shiny");
  },
  // A giant mabkhara (incense burner) with a wisp of smoke.
  incense(b) {
    b.box(0.6, 0.04, 0.6, C.stone);
    b.box(0.2, 0.1, 0.2, "#7a3b1f", { y: 0.04 });
    b.cyl(0.06, 0.13, 0.12, "#7a3b1f", { y: 0.14 }, 4);
    b.box(0.26, 0.12, 0.26, "#8f4a24", { y: 0.26 });
    for (const [x, z] of [[0.13, 0], [-0.13, 0], [0, 0.13], [0, -0.13]]) b.box(x ? 0.01 : 0.18, 0.08, x ? 0.18 : 0.01, C.gold, { x: x * 1.03, y: 0.28, z: z * 1.03 }, "shiny");
    b.cyl(0.1, 0.13, 0.06, "#8f4a24", { y: 0.38 }, 4);
    b.add(new THREE.ConeGeometry(0.05, 0.1, 6), "#ff8a2a", { y: 0.47 }, "lights");
    for (let i = 0; i < 3; i++) b.add(new THREE.SphereGeometry(0.04 + i * 0.015, 6, 4), "#e8e4dc", { x: i * 0.03, y: 0.55 + i * 0.09, z: -i * 0.02 });
  },

  // ---------- grand projects ----------
  gate(b) {
    for (const x of [-0.36, 0.36]) {
      b.box(0.2, 0.7, 0.3, C.mudLight, { x });
      b.box(0.22, 0.04, 0.32, C.mud, { x, y: 0.7 });
      crenels(b, 0.2, 0.3, 0.74, C.mud, 0.035);
      b.box(0.05, 0.1, 0.02, C.door, { x, y: 0.45, z: 0.16 });
      b.box(0.04, 0.06, 0.022, C.light, { x, y: 0.47, z: 0.161 }, "lights");
    }
    b.box(0.56, 0.18, 0.3, C.mudLight, { y: 0.4 });
    b.box(0.58, 0.03, 0.32, C.mud, { y: 0.58 });
    crenels(b, 0.56, 0.3, 0.61, C.mud, 0.035);
    b.add(new THREE.CylinderGeometry(0.26, 0.26, 0.3, 14, 1, false, 0, Math.PI), C.mudLight, { y: 0.4, rx: Math.PI / 2, rz: Math.PI / 2, sz: 0.01 });
    beams(b, 0.56, 0.52, 0.15, 6);
    b.box(0.5, 0.06, 0.022, "#2c8a7a", { y: 0.5, z: 0.152 });
    b.box(0.96, 0.01, 0.4, "#c9b48a");
    for (const x of [-0.46, 0.46]) palm(b, x, 0.3, 0.8);
  },
  heritage(b) {
    b.box(0.96, 0.012, 0.96, "#d8bf8f");
    const blocks = [[-0.25, -0.25, 0.42, 0.36, 0.34], [0.22, -0.28, 0.4, 0.3, 0.3], [-0.28, 0.2, 0.34, 0.28, 0.4], [0.24, 0.2, 0.36, 0.26, 0.36]];
    for (const [x, z, w, h, d] of blocks) {
      b.box(w, h, d, C.mud, { x, z });
      b.box(w + 0.02, 0.025, d + 0.02, C.mudDark, { x, y: h, z });
      crenels(b, w, d, h + 0.03, C.mudLight, 0.03);
      b.box(0.07, 0.12, 0.01, C.door, { x, z: z + d / 2 + 0.005 });
      b.box(0.05, 0.04, 0.012, C.light, { x: x + w * 0.3, y: h * 0.55, z: z + d / 2 + 0.006 }, "lights");
    }
    for (let i = 0; i < 3; i++) b.add(new THREE.ConeGeometry(0.12, 0.06, 4), [C.red, C.teal, C.gold][i], { x: -0.1 + i * 0.1, y: 0.26, z: 0, ry: Math.PI / 4 });
    for (let i = 0; i < 4; i++) b.box(0.012, 0.012, 0.6, "#3b2a1c", { x: -0.3 + i * 0.2, y: 0.32 });
    for (let i = 0; i < 5; i++) b.add(new THREE.SphereGeometry(0.018, 5, 4), C.light, { x: -0.3 + i * 0.15, y: 0.3, z: (i % 2) * 0.1 - 0.05 }, "lights");
    b.cyl(0.03, 0.05, 0.06, C.gold, { x: 0.02, z: 0.05 }, 8, "shiny");
  },
  tower(b) {
    b.box(0.9, 0.015, 0.9, "#d6cfc0");
    b.cyl(0.3, 0.36, 0.12, C.stone, {}, 8);
    const h = 2.6;
    b.add(new THREE.CylinderGeometry(0.11, 0.2, h, 8), "#e9e4d8", { y: 0.12 + h / 2 });
    for (let i = 0; i < 12; i++) b.add(new THREE.CylinderGeometry(0.115 - i * 0.0072 + 0.01, 0.12 - i * 0.0072 + 0.01, 0.012, 8), C.glass, { y: 0.3 + i * 0.2 }, "shiny");
    b.add(new THREE.CylinderGeometry(0.22, 0.14, 0.14, 12), "#e9e4d8", { y: 0.12 + h * 0.78 });
    b.add(new THREE.CylinderGeometry(0.225, 0.225, 0.06, 12), C.glass, { y: 0.12 + h * 0.78 + 0.07 }, "shiny");
    b.add(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 12), C.light, { y: 0.12 + h * 0.78 + 0.075 }, "lights");
    b.cone(0.06, 0.4, C.gold, { y: 0.12 + h }, 8, "shiny");
    b.box(0.03, 0.03, 0.03, "#ff3b30", { y: 0.12 + h + 0.4 }, "lights");
  },
  airport(b) {
    b.box(0.98, 0.01, 0.98, "#c9bc9c");
    b.box(0.98, 0.012, 0.26, "#3d3f44", { z: 0.22 });
    for (let i = 0; i < 6; i++) b.box(0.08, 0.014, 0.015, "#f2f2f2", { x: -0.42 + i * 0.17, z: 0.22 });
    b.box(0.5, 0.14, 0.24, "#e9e4d8", { x: -0.18, z: -0.26 });
    b.box(0.5, 0.06, 0.02, C.glass, { x: -0.18, y: 0.05, z: -0.139 }, "shiny");
    b.box(0.46, 0.04, 0.022, C.light, { x: -0.18, y: 0.06, z: -0.138 }, "lights");
    b.cyl(0.035, 0.05, 0.42, "#e9e4d8", { x: 0.3, z: -0.3 }, 8);
    b.cyl(0.08, 0.06, 0.08, C.glass, { x: 0.3, y: 0.42, z: -0.3 }, 8, "shiny");
    b.cyl(0.085, 0.085, 0.02, "#e9e4d8", { x: 0.3, y: 0.5, z: -0.3 }, 8);
    // a small plane on the runway
    b.add(new THREE.CylinderGeometry(0.025, 0.02, 0.36, 8), "#f6f6f6", { x: 0.05, y: 0.05, z: 0.22, rz: Math.PI / 2 }, "shiny");
    b.add(new THREE.ConeGeometry(0.025, 0.06, 8), "#f6f6f6", { x: 0.26, y: 0.05, z: 0.22, rz: -Math.PI / 2 }, "shiny");
    b.box(0.08, 0.008, 0.34, "#f6f6f6", { x: 0.06, y: 0.045, z: 0.22 }, "shiny");
    b.box(0.05, 0.07, 0.008, "#2c8a7a", { x: -0.11, y: 0.05, z: 0.22 });
    b.box(0.04, 0.006, 0.12, "#f6f6f6", { x: -0.11, y: 0.08, z: 0.22 }, "shiny");
  },
  // ---------- the big expansion: al-Jouf's olives, wind, heritage, and a skyline ----------
  olive(b) {
    b.box(0.94, 0.015, 0.94, "#b59a6a");
    for (const [w, d, x, z] of [[0.94, 0.03, 0, -0.46], [0.94, 0.03, 0, 0.46], [0.03, 0.94, -0.46, 0], [0.03, 0.94, 0.46, 0]]) b.box(w, 0.05, d, "#c9b48a", { x, z });
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) oliveTree(b, -0.28 + c * 0.28, -0.28 + r * 0.28, 0.8 + ((r + c) % 3) * 0.08);
    b.box(0.8, 0.008, 0.012, "#3b3f44", { y: 0.016, z: 0.14 }); b.box(0.8, 0.008, 0.012, "#3b3f44", { y: 0.016, z: -0.14 });
  },
  oilpress(b) {
    b.box(0.94, 0.012, 0.94, "#cfc3a6");
    b.box(0.62, 0.34, 0.44, "#e6dcc4", { x: -0.12, z: -0.16 });
    b.box(0.66, 0.04, 0.48, "#7c8a3a", { x: -0.12, y: 0.34, z: -0.16 });
    windowsRow(b, 0.62, 0.16, 0.061, 4);
    for (const x of [0.26, 0.4]) { b.cyl(0.07, 0.07, 0.46, "#b9bfc4", { x, z: -0.22 }, 12, "shiny"); b.dome(0.07, "#b9bfc4", { x, y: 0.46, z: -0.22 }, "shiny"); }
    for (let i = 0; i < 4; i++) b.cyl(0.035, 0.035, 0.09, i % 2 ? "#6b7a2a" : "#4d5a1c", { x: -0.3 + i * 0.09, z: 0.3 }, 8, "shiny");
    b.box(0.3, 0.14, 0.03, "#5a6b22", { x: -0.12, y: 0.22, z: 0.065 }); b.cyl(0.04, 0.04, 0.01, C.gold, { x: -0.12, y: 0.28, z: 0.08, rx: Math.PI / 2 }, 10);
    oliveTree(b, 0.32, 0.3, 0.7);
  },
  windfarm(b) {
    b.box(0.96, 0.012, 0.96, "#d9c9a2");
    for (const [x, z, s] of WIND_TOWERS) {
      b.cyl(0.018 * s, 0.032 * s, 1.5 * s, "#f2f2f0", { x, z }, 10, "shiny");
      b.box(0.06 * s, 0.06 * s, 0.14 * s, "#f2f2f0", { x, y: 1.5 * s, z }, "shiny");
      b.box(0.02, 0.02, 0.02, "#ff3b30", { x, y: 1.6 * s, z }, "lights");
    }
    b.box(0.16, 0.12, 0.12, "#c7c3ba", { x: 0.3, z: -0.32 });
  },
  // the blades and hub of one turbine, turning about its own middle (placed and spun by js/warfx.js)
  windRotor(b) {
    for (let k = 0; k < 3; k++) {
      const a = k * (Math.PI * 2 / 3);
      b.add(new THREE.BoxGeometry(0.035, 0.62, 0.012), "#fbfbfa", { x: Math.sin(a) * 0.3, y: Math.cos(a) * 0.3, rz: -a }, "shiny");
    }
    b.add(new THREE.SphereGeometry(0.03, 8, 6), "#e8e8e6", {}, "shiny");
  },
  library(b) {
    b.box(0.86, 0.36, 0.62, "#e9dfcb", { z: -0.08 });
    b.box(0.9, 0.04, 0.66, C.stone, { y: 0.36, z: -0.08 });
    for (let i = 0; i < 5; i++) b.box(0.1, 0.26, 0.012, i % 2 ? "#4f7f99" : "#3d6b84", { x: -0.32 + i * 0.16, y: 0.06, z: 0.235 }, "shiny");
    b.box(0.5, 0.06, 0.16, C.stone, { y: 0.26, z: 0.3 });
    for (const x of [-0.22, 0, 0.22]) b.cyl(0.018, 0.018, 0.26, C.white, { x, z: 0.36 }, 8);
    // an open book on the roof sign
    b.add(new THREE.BoxGeometry(0.16, 0.012, 0.11), "#f8f4ea", { x: -0.09, y: 0.42, z: -0.08, rz: 0.25 });
    b.add(new THREE.BoxGeometry(0.16, 0.012, 0.11), "#f8f4ea", { x: 0.09, y: 0.42, z: -0.08, rz: -0.25 });
    nightWindows(b, 0.86, 0.12, 0.237, 5, 0.18);
  },
  olivetree(b) {
    b.cyl(0.4, 0.42, 0.06, C.stone, {}, 18);
    b.cyl(0.36, 0.36, 0.02, "#7db35a", { y: 0.06 }, 18);
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; b.add(new THREE.SphereGeometry(0.025, 5, 4), i % 2 ? "#f4d03f" : "#ffffff", { x: Math.cos(a) * 0.3, y: 0.09, z: Math.sin(a) * 0.3 }); }
    oliveTree(b, 0, 0, 2.2);
  },
  bigfountain(b) {
    b.box(0.96, 0.012, 0.96, "#e3d4ae");
    b.cyl(0.44, 0.46, 0.08, C.stone, {}, 24);
    b.cyl(0.41, 0.41, 0.02, C.water, { y: 0.07 }, 24, "shiny");
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; b.cone(0.025, 0.22 + (i % 2) * 0.1, "#cfeef7", { x: Math.cos(a) * 0.28, y: 0.08, z: Math.sin(a) * 0.28 }, 8, "shiny"); b.cyl(0.02, 0.02, 0.01, i % 2 ? "#7ad0ff" : "#ffd27a", { x: Math.cos(a) * 0.34, y: 0.08, z: Math.sin(a) * 0.34 }, 6, "lights"); }
    b.cyl(0.08, 0.1, 0.3, C.stone, { y: 0.08 }, 12);
    b.cyl(0.18, 0.12, 0.05, C.stone, { y: 0.38 }, 16);
    b.cone(0.04, 0.32, "#cfeef7", { y: 0.42 }, 10, "shiny");
  },
  marid(b) {
    b.box(0.98, 0.02, 0.98, "#cdb58a");
    // a rocky mound, then a stone castle with leaning walls and round towers
    b.add(new THREE.CylinderGeometry(0.4, 0.48, 0.16, 9), "#b99a6c", { y: 0.08 });
    b.add(new THREE.CylinderGeometry(0.26, 0.34, 0.34, 4), "#a98a5e", { y: 0.33, ry: Math.PI / 4 });
    for (const [x, z] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]]) {
      b.cyl(0.07, 0.09, 0.5, "#9f8158", { x, y: 0.16, z }, 10);
      b.cyl(0.075, 0.075, 0.03, "#8d7049", { x, y: 0.66, z }, 10);
    }
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; b.box(0.04, 0.04, 0.04, "#9f8158", { x: Math.cos(a) * 0.2, y: 0.5, z: Math.sin(a) * 0.2 }); }
    b.box(0.08, 0.12, 0.02, "#4a3523", { y: 0.17, z: 0.335 });
    b.cyl(0.01, 0.01, 0.22, C.dark, { x: 0.22, y: 0.69, z: 0.22 }, 4);
    b.box(0.1, 0.06, 0.005, "#2f7d5b", { x: 0.27, y: 0.86, z: 0.22 });
    for (const x of [-0.3, 0.3]) b.box(0.04, 0.03, 0.04, C.light, { x, y: 0.17, z: 0.38 }, "lights");
  },
  themepark(b) {
    b.box(0.98, 0.012, 0.98, "#d8cdb2");
    // a ferris wheel
    const cx = -0.18, cy = 0.62, r = 0.42;
    for (const z of [-0.06, 0.06]) { b.add(new THREE.TorusGeometry(r, 0.012, 6, 28), "#d9534f", { x: cx, y: cy, z }, "shiny"); for (const s of [-1, 1]) b.add(new THREE.BoxGeometry(0.02, 0.66, 0.02), "#9aa0a6", { x: cx + s * 0.16, y: 0.3, z, rz: s * 0.25 }); }
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; b.add(new THREE.BoxGeometry(0.012, r, 0.012), "#e6e6e6", { x: cx + Math.cos(a) * r / 2, y: cy + Math.sin(a) * r / 2, z: 0, rz: a - Math.PI / 2 }); b.box(0.06, 0.05, 0.08, ["#f4d03f", "#2c8a7a", "#2f5f9e", "#d9822b"][i % 4], { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r - 0.06, z: 0 }); b.box(0.015, 0.015, 0.015, C.light, { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, z: 0.07 }, "lights"); }
    // a carousel and a little coaster
    b.cyl(0.16, 0.16, 0.03, "#f3e6c4", { x: 0.28, z: 0.26 }, 16); b.cone(0.18, 0.12, "#d9534f", { x: 0.28, y: 0.18, z: 0.26 }, 12);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; b.cyl(0.006, 0.006, 0.15, C.gold, { x: 0.28 + Math.cos(a) * 0.12, y: 0.03, z: 0.26 + Math.sin(a) * 0.12 }, 4, "shiny"); }
    for (let i = 0; i < 9; i++) { const x = 0.1 + i * 0.045, y = 0.1 + Math.sin(i / 8 * Math.PI) * 0.3; b.box(0.05, 0.015, 0.06, "#2f5f9e", { x, y, z: -0.3 }); b.box(0.01, y, 0.01, "#9aa0a6", { x, z: -0.3 }); }
    b.box(0.3, 0.08, 0.02, "#2c8a7a", { x: 0.2, y: 0.02, z: 0.47 });
  },
  station(b) {
    b.box(0.98, 0.012, 0.98, "#cbbf9f");
    b.box(0.98, 0.012, 0.2, "#6b5a48", { z: 0.3 });
    for (const z of [0.25, 0.35]) b.box(0.98, 0.012, 0.015, "#8e959a", { y: 0.012, z }, "shiny");
    for (let i = 0; i < 10; i++) b.box(0.03, 0.006, 0.18, "#4a3b2c", { x: -0.45 + i * 0.1, y: 0.012, z: 0.3 });
    b.box(0.86, 0.06, 0.18, "#e7e2d6", { z: 0.08 });
    b.add(new THREE.CylinderGeometry(0.3, 0.3, 0.86, 16, 1, true, 0, Math.PI), "#e9e4d8", { y: 0.06, z: -0.18, rz: Math.PI / 2, sz: 0.55 }, "shiny");
    b.box(0.86, 0.22, 0.3, "#ece6d8", { y: 0.06, z: -0.2 });
    windowsRow(b, 0.8, 0.12, -0.049, 7, 0.08);
    // a train at the platform
    b.box(0.82, 0.12, 0.12, "#f4f4f2", { y: 0.02, z: 0.3 }, "shiny");
    b.box(0.82, 0.04, 0.124, "#2c8a7a", { y: 0.07, z: 0.3 });
    b.box(0.8, 0.03, 0.126, C.glass, { y: 0.1, z: 0.3 }, "shiny");
    b.add(new THREE.SphereGeometry(0.07, 10, 6, 0, Math.PI), "#f4f4f2", { x: 0.41, y: 0.08, z: 0.3, ry: Math.PI / 2, sx: 1.4 }, "shiny");
    b.cyl(0.015, 0.015, 0.5, C.dark, { x: -0.4, z: -0.42 }, 6); b.box(0.12, 0.1, 0.02, C.dark, { x: -0.4, y: 0.5, z: -0.42 }); b.box(0.1, 0.07, 0.022, C.light, { x: -0.4, y: 0.515, z: -0.42 }, "lights");
  },
  bigstadium(b) {
    b.box(0.98, 0.012, 0.98, "#c9c0ad");
    b.add(new THREE.CylinderGeometry(0.47, 0.44, 0.26, 28, 1, true), "#e9e4d8", { y: 0.13, sz: 0.8 });
    b.add(new THREE.CylinderGeometry(0.44, 0.3, 0.2, 28, 1, true), "#c94f45", { y: 0.14, sz: 0.8 });
    b.add(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 28), "#4fa64a", { y: 0.02, sz: 0.8 });
    b.box(0.3, 0.025, 0.003, C.white, { y: 0.03 }); b.cyl(0.05, 0.05, 0.025, "#5bb655", { y: 0.025 }, 14);
    b.add(new THREE.TorusGeometry(0.46, 0.03, 6, 32), "#f2f2f0", { y: 0.28, rx: Math.PI / 2, sy: 0.8 }, "shiny");
    for (const [x, z] of [[-0.42, -0.3], [0.42, -0.3], [-0.42, 0.3], [0.42, 0.3]]) { b.cyl(0.012, 0.012, 0.6, C.grey, { x, z }, 4); b.box(0.1, 0.05, 0.03, C.light, { x, y: 0.6, z }, "lights"); }
  },
  skyline(b) {
    b.box(0.98, 0.015, 0.98, "#d6cfc0");
    const towers = [[-0.22, -0.2, 0.26, 2.6, "#5d88a3"], [0.22, -0.18, 0.22, 2.0, "#6f9cb5"], [0.0, 0.24, 0.24, 1.5, "#4f7f99"], [-0.3, 0.28, 0.14, 0.9, "#87a9bd"], [0.32, 0.3, 0.14, 1.1, "#5d88a3"]];
    for (const [x, z, w, h, c] of towers) {
      b.box(w, h, w, c, { x, z }, "shiny");
      for (let f = 1; f < h / 0.12; f++) b.box(w + 0.004, 0.008, w + 0.004, "#dfe7ec", { x, y: f * 0.12, z });
      for (let f = 1; f < h / 0.24; f += 2) b.box(w * 0.7, 0.03, w + 0.006, C.light, { x, y: f * 0.24 + 0.05, z }, "lights");
    }
    b.cone(0.05, 0.5, "#dfe7ec", { x: -0.22, y: 2.6, z: -0.2 }, 6, "shiny");
    b.box(0.02, 0.02, 0.02, "#ff3b30", { x: -0.22, y: 3.1, z: -0.2 }, "lights");
    b.box(0.9, 0.06, 0.12, "#e9e4d8", { z: 0.45 });
  },
  // برج سكني: a residential tower: a stone podium with an entrance canopy, a glass facade between stone
  // fins, balconies on the corners, and a lit crown on top.
  house5(b) {
    const h = 2.4, floors = 13;
    b.box(0.94, 0.006, 0.94, "#d6cfc0");
    b.box(0.76, 0.26, 0.76, "#cdbf9f");
    b.box(0.36, 0.18, 0.014, "#22303a", { y: 0.02, z: 0.382 }, "glass");
    b.box(0.34, 0.14, 0.016, C.light, { y: 0.04, z: 0.384 }, "lights");
    b.box(0.44, 0.02, 0.16, "#8f969c", { y: 0.24, z: 0.44 }, "metal");
    for (const x of [-0.2, 0.2]) b.cyl(0.012, 0.012, 0.24, "#8f969c", { x, z: 0.5 }, 8, "metal");
    // the tower: glass, with stone fins and floor slabs
    b.box(0.64, h, 0.6, "#46677a", { y: 0.26 }, "glass");
    for (const x of [-0.32, -0.16, 0, 0.16, 0.32]) b.box(0.03, h, 0.04, "#e8e2d4", { x, y: 0.26, z: 0.3 });
    for (const z of [-0.3, -0.1, 0.1, 0.3]) b.box(0.04, h, 0.03, "#e8e2d4", { x: 0.32, y: 0.26, z });
    for (let f = 0; f < floors; f++) {
      const y = 0.3 + f * 0.17;
      b.box(0.66, 0.016, 0.62, "#e8e2d4", { y });
      if (f % 2 === 0) for (const x of [-0.24, 0.24]) { b.box(0.14, 0.012, 0.08, "#e8e2d4", { x, y, z: 0.34 }); b.box(0.14, 0.04, 0.005, "#9ec3d6", { x, y: y + 0.012, z: 0.378 }, "glass"); }
      if ((f * 7) % 5 < 2) b.box(0.12, 0.1, 0.004, C.light, { x: ((f * 37) % 3 - 1) * 0.16, y: y + 0.04, z: 0.303 }, "lights");
    }
    // the crown: a set-back top with a light band, and the plant on the roof
    b.box(0.56, 0.16, 0.52, "#e8e2d4", { y: 0.26 + h });
    b.box(0.58, 0.02, 0.54, "#fff3d6", { y: 0.33 + h }, "glow");
    roofTank(b, -0.15, 0.42 + h, -0.1, 0.05); roofTank(b, 0.0, 0.42 + h, -0.1, 0.05);
    b.box(0.03, 0.03, 0.03, "#ff3b30", { y: 0.55 + h, x: 0.2, z: 0.15 }, "glow");
    b.cyl(0.006, 0.006, 0.13, "#8f969c", { x: 0.2, y: 0.42 + h, z: 0.15 }, 6, "metal");
  },
  // A building site: fence, sand piles, a frame going up and a crane.
  construction(b) {
    b.box(0.94, 0.008, 0.94, "#cdb68a");
    for (const [x, z, w, d] of [[0, -0.46, 0.94, 0.02], [0, 0.46, 0.94, 0.02], [-0.46, 0, 0.02, 0.94], [0.46, 0, 0.02, 0.94]]) b.box(w, 0.1, d, "#e8d9b5", { x, z });
    for (const [x, z] of [[-0.25, -0.2], [0.25, -0.2], [-0.25, 0.15], [0.25, 0.15]]) b.box(0.03, 0.5, 0.03, "#9aa0a6", { x, z });
    for (const y of [0.18, 0.36, 0.5]) { b.box(0.53, 0.02, 0.03, "#9aa0a6", { y, z: -0.2 }); b.box(0.53, 0.02, 0.03, "#9aa0a6", { y, z: 0.15 }); }
    b.box(0.5, 0.02, 0.38, "#bfbab0", { y: 0.18, z: -0.02 });
    b.cone(0.12, 0.1, "#d9b77a", { x: 0.3, z: 0.32 }, 7);
    b.cyl(0.012, 0.012, 1.1, "#e0b02a", { x: -0.35, z: 0.3 }, 4);
    b.box(0.6, 0.03, 0.03, "#e0b02a", { x: -0.15, y: 1.1, z: 0.3 });
    b.box(0.08, 0.06, 0.06, "#e0b02a", { x: -0.38, y: 1.06, z: 0.3 });
    b.box(0.004, 0.4, 0.004, "#333", { x: 0.1, y: 0.7, z: 0.3 });
  },

  // ---------- life and scenery (used by the world, not by the build menu) ----------

  camel(b) {
    const hide = "#c99a5e", dark = "#a77a45";
    b.add(new THREE.SphereGeometry(0.1, 8, 6), hide, { y: 0.24, sx: 1.5, sy: 0.8, sz: 0.85 });
    b.add(new THREE.SphereGeometry(0.06, 7, 5), hide, { x: -0.01, y: 0.32, sx: 1.2 });
    for (const [x, z] of [[0.09, 0.04], [0.09, -0.04], [-0.09, 0.04], [-0.09, -0.04]]) b.cyl(0.012, 0.014, 0.2, dark, { x, z }, 5);
    b.add(new THREE.CylinderGeometry(0.022, 0.03, 0.18, 6), hide, { x: 0.18, y: 0.31, rz: -0.75 });
    b.add(new THREE.BoxGeometry(0.08, 0.04, 0.04), hide, { x: 0.25, y: 0.38 });
    b.add(new THREE.BoxGeometry(0.02, 0.05, 0.01), dark, { x: -0.16, y: 0.22, rz: 0.4 });
    b.box(0.08, 0.012, 0.13, C.red, { x: -0.01, y: 0.355 });
  },
  // ---- people: a man in a thobe (the thobe takes the per-person colour), his shemagh and face apart ----
  manBody(b) {
    b.cyl(0.027, 0.036, 0.1, C.white, {}, 14);                       // thobe, flaring to the ankles
    b.add(new THREE.SphereGeometry(0.03, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), C.white, { y: 0.098, sy: 0.55 }); // shoulders
    for (const z of [-0.031, 0.031]) b.add(new THREE.CylinderGeometry(0.009, 0.011, 0.065, 8), C.white, { x: 0.002, y: 0.066, z, rx: z > 0 ? -0.12 : 0.12 }); // arms
  },
  manHeadRed(b) { head(b, "#c8323a"); },
  manHeadWhite(b) { head(b, "#f6f4ee"); },
  woman(b) {
    const abaya = "#17151a";
    b.cyl(0.026, 0.04, 0.105, abaya, {}, 14);
    b.add(new THREE.SphereGeometry(0.03, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), abaya, { y: 0.1, sy: 0.55 });
    for (const z of [-0.03, 0.03]) b.add(new THREE.CylinderGeometry(0.009, 0.012, 0.065, 8), abaya, { y: 0.067, z });
    b.add(new THREE.SphereGeometry(0.021, 12, 9), abaya, { y: 0.135 });
    b.add(new THREE.SphereGeometry(0.011, 6, 4), "#c99a72", { x: 0.016, y: 0.137, sx: 0.5 });  // face
    b.add(new THREE.ConeGeometry(0.026, 0.05, 14), abaya, { y: 0.14, rx: Math.PI, sy: 0.6 });      // shayla falling to the shoulders
    b.box(0.018, 0.02, 0.008, "#a3542e", { x: -0.004, y: 0.05, z: 0.043 });                        // a handbag
  },
  // ---- the pickup (جيب حوض): body takes the per-car colour; trim keeps its own ----
  // A pickup (جيب حوض) along +x: a rounded body with a sloped bonnet and wheel arches (painted per car),
  // and its trim: tyres with rims, glass, lamps, bumpers and the bed.
  pickupBody(b) {
    b.rbox(0.27, 0.04, 0.122, 0.012, C.white, { y: 0.026 }, "matte");                      // the body
    b.rbox(0.075, 0.03, 0.118, 0.01, C.white, { x: 0.096, y: 0.056 }, "matte");            // bonnet
    b.add(new THREE.BoxGeometry(0.03, 0.02, 0.116), C.white, { x: 0.065, y: 0.078, rz: -0.5 }); // windscreen frame
    b.rbox(0.1, 0.058, 0.118, 0.016, C.white, { x: 0.012, y: 0.06 }, "matte");             // the cab
    for (const z of [0.058, -0.058]) b.rbox(0.105, 0.032, 0.008, 0.003, C.white, { x: -0.083, y: 0.062, z }, "matte"); // bed sides
    b.rbox(0.008, 0.032, 0.12, 0.003, C.white, { x: -0.133, y: 0.062 }, "matte");         // tailgate
  },
  pickupTrim(b) {
    for (const [x, z] of [[0.085, 0.058], [0.085, -0.058], [-0.08, 0.058], [-0.08, -0.058]]) {
      b.add(new THREE.CylinderGeometry(0.026, 0.026, 0.024, 14), "#1b1b1d", { x, y: 0.024, z, rx: Math.PI / 2 }, "matte");
      b.add(new THREE.CylinderGeometry(0.014, 0.014, 0.026, 10), "#c9ccd0", { x, y: 0.024, z, rx: Math.PI / 2 }, "metal");
    }
    b.add(new THREE.BoxGeometry(0.004, 0.044, 0.104), "#22303a", { x: 0.066, y: 0.1, rz: 0.4 }, "glass");   // windscreen
    for (const z of [0.0595, -0.0595]) b.box(0.07, 0.03, 0.003, "#22303a", { x: 0.014, y: 0.078, z }, "glass"); // side windows
    b.box(0.004, 0.028, 0.1, "#22303a", { x: -0.039, y: 0.078 }, "glass");                                       // back window
    b.box(0.1, 0.004, 0.104, "#3a3632", { x: -0.083, y: 0.048 });                                                // bed floor
    b.box(0.006, 0.022, 0.07, "#2b2b2e", { x: 0.135, y: 0.034 }, "metal");                                       // grille
    for (const z of [0.045, -0.045]) { b.box(0.004, 0.012, 0.022, "#fff6d8", { x: 0.137, y: 0.042, z }, "glow"); b.box(0.004, 0.016, 0.012, "#d23a2a", { x: -0.137, y: 0.064, z }, "glow"); }
    b.box(0.008, 0.014, 0.126, "#9a9da1", { x: 0.139, y: 0.016 }, "metal");                                      // bumpers
    b.box(0.008, 0.014, 0.126, "#9a9da1", { x: -0.139, y: 0.016 }, "metal");
    for (const z of [0.062, -0.062]) b.box(0.008, 0.006, 0.01, "#1b1b1d", { x: 0.058, y: 0.082, z });           // mirrors
  },
  // A small desert acacia (طلح/سمر): low, wide and close to the ground, as in the Rafaya plains.
  acacia(b) {
    b.cyl(0.016, 0.024, 0.08, "#6e5133", {}, 5);
    for (const [x, z, r] of [[0.03, 0.01, 1], [-0.03, -0.01, -1], [0, 0.03, 0]]) b.add(new THREE.CylinderGeometry(0.006, 0.01, 0.08, 4), "#6e5133", { x, y: 0.1, z, rz: r * 0.6, rx: r === 0 ? 0.6 : 0 });
    b.add(new THREE.CylinderGeometry(0.13, 0.1, 0.04, 7), "#7f9a4a", { y: 0.13, sz: 0.85 });
    b.add(new THREE.CylinderGeometry(0.08, 0.08, 0.035, 6), "#93ad58", { x: 0.02, y: 0.155, z: 0.01 });
  },
  // Spring on the faydah: green tufts and flowers (yellow, purple khuzama, white).
  bloom(b) {
    for (let i = 0; i < 4; i++) b.add(new THREE.IcosahedronGeometry(0.03, 0), i % 2 ? "#7fb04a" : "#94c257", { x: Math.cos(i * 1.7) * 0.06, y: 0.012, z: Math.sin(i * 1.7) * 0.06, sy: 0.5 });
    const colors = ["#f4d03f", "#a77bca", "#f7f4ec", "#f4d03f", "#e8a0b4", "#a77bca"];
    for (let i = 0; i < 6; i++) {
      const x = Math.cos(i * 2.4) * 0.09, z = Math.sin(i * 2.4) * 0.09;
      b.cyl(0.003, 0.003, 0.04, "#5f8f3a", { x, z }, 3);
      b.add(new THREE.SphereGeometry(0.014, 5, 4), colors[i], { x, y: 0.045, z });
    }
  },
  shrub(b) {
    for (let i = 0; i < 3; i++) b.add(new THREE.IcosahedronGeometry(0.045 + i * 0.012, 0), i % 2 ? "#a3a35c" : "#8c9550", { x: Math.cos(i * 2.2) * 0.04, y: 0.03, z: Math.sin(i * 2.2) * 0.04, sy: 0.7 });
  },
  grassTuft(b) {
    for (let i = 0; i < 5; i++) b.add(new THREE.ConeGeometry(0.008, 0.09, 3), "#b9a865", { x: Math.cos(i * 1.3) * 0.02, y: 0.04, z: Math.sin(i * 1.3) * 0.02, rx: Math.cos(i) * 0.3, rz: Math.sin(i) * 0.3 });
  },
  pebbles(b) {
    for (let i = 0; i < 5; i++) b.add(new THREE.DodecahedronGeometry(0.02 + (i % 3) * 0.01, 0), i % 2 ? "#a89b86" : "#c2b49c", { x: Math.cos(i * 2.6) * 0.12, y: 0.005, z: Math.sin(i * 1.7) * 0.12, sy: 0.5 });
  },
  // Ramadan and Eid: a pole with a crescent and glowing lanterns hanging off a line.
  festive(b) {
    b.cyl(0.008, 0.01, 0.5, "#d4a53a", {}, 5, "shiny");
    b.add(new THREE.TorusGeometry(0.035, 0.009, 5, 12, Math.PI * 1.35), "#f3cf7a", { y: 0.55, rz: 0.9 }, "lights");
    b.box(0.5, 0.004, 0.004, "#3b2a1c", { x: -0.25, y: 0.46 });
    const cols = ["#ffd27a", "#ff9f5a", "#9fe3c1", "#ffd27a"];
    for (let i = 0; i < 4; i++) {
      const x = -0.08 - i * 0.12;
      b.box(0.002, 0.04, 0.002, "#3b2a1c", { x, y: 0.42 });
      b.cyl(0.018, 0.014, 0.045, cols[i], { x, y: 0.375 }, 6, "lights");
      b.cone(0.02, 0.02, "#b8862b", { x, y: 0.42 }, 6);
    }
  },
  fencePost(b) {
    b.cyl(0.014, 0.018, 0.12, "#7a5a3a", {}, 5);
    b.box(0.5, 0.012, 0.012, "#9a7a52", { x: 0.25, y: 0.085 });
    b.box(0.5, 0.012, 0.012, "#9a7a52", { x: 0.25, y: 0.045 });
  },
  saleSign(b) {
    for (const z of [-0.1, 0.1]) b.cyl(0.012, 0.012, 0.3, "#6e5133", { z }, 5);
    b.box(0.02, 0.14, 0.28, "#f6f1e4", { y: 0.2 });
    b.box(0.022, 0.04, 0.28, "#c0392b", { y: 0.29 });
    b.box(0.023, 0.012, 0.18, "#2c8a7a", { y: 0.2 });
  },
  lamp(b) {
    b.cyl(0.008, 0.012, 0.42, C.dark, {}, 5);
    b.box(0.12, 0.012, 0.012, C.dark, { x: 0.05, y: 0.42 });
    b.box(0.04, 0.012, 0.03, C.grey, { x: 0.1, y: 0.405 });
    b.box(0.036, 0.008, 0.026, "#fff1b8", { x: 0.1, y: 0.398 }, "lights");
  },
  mesa(b, ground, seed = 1) {
    const r = (k) => ((Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
    const w = 3 + r(1) * 4, d = 2 + r(2) * 3, h = 1.2 + r(3) * 1.8;
    b.add(new THREE.CylinderGeometry(0.7, 1, h, 7), "#c49562", { y: h / 2, sx: w, sz: d });
    b.add(new THREE.CylinderGeometry(0.72, 0.74, h * 0.12, 7), "#b07f4f", { y: h * 0.55, sx: w, sz: d });
    b.add(new THREE.CylinderGeometry(0.6, 0.7, h * 0.25, 7), "#d7ab74", { y: h + h * 0.12, sx: w, sz: d });
  },

  rock(b, ground, seed = 1) {
    const r = (k) => ((Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
    for (let i = 0; i < 3; i++) b.add(new THREE.DodecahedronGeometry(0.1 + r(i) * 0.1, 0), i % 2 ? "#a99a85" : "#beae96", { x: (r(i + 3) - 0.5) * 0.5, y: 0.05, z: (r(i + 6) - 0.5) * 0.5, sy: 0.6 + r(i + 9) * 0.4, ry: r(i) * 3 });
  }
};

const cache = new Map();

/** Colour swaps that make the same house look different from its neighbours ("house2~1"). */
export const VARIANTS = {
  house1: [{ [C.mud]: "#b8834e", [C.mudLight]: "#c99a62" }, { [C.mud]: "#d4a46a", [C.mudDark]: "#b38250" }],
  house2: [{ [C.plaster]: "#ecdcbc", [C.teal]: "#7a3b1f" }, { [C.plaster]: "#f2e2d4", [C.teal]: "#2f5f9e", [C.stone]: "#cdb48e" }],
  house3: [{ "#f3eee4": "#efe4cc", "#cdb894": "#b89b72", "#ece3d1": "#e6d6b6" }, { "#f3eee4": "#f6f3ee", "#cdb894": "#8e959a", "#ece3d1": "#e2e0db" }],
  house4: [{ "#ece4d3": "#e2d6c4", "#c9b896": "#b9a888" }, { "#ece4d3": "#d9ccb2", "#c9b896": "#9aa1a6" }]
};

function recolor(geo, swaps) {
  if (!geo) return geo;
  const g = geo.clone(), col = g.attributes.color, c = new THREE.Color();
  const table = Object.entries(swaps).map(([from, to]) => [new THREE.Color(from), new THREE.Color(to)]);
  for (let i = 0; i < col.count; i++) {
    c.fromBufferAttribute(col, i);
    for (const [from, to] of table) if (Math.abs(c.r - from.r) + Math.abs(c.g - from.g) + Math.abs(c.b - from.b) < 0.01) { col.setXYZ(i, to.r, to.g, to.b); break; }
  }
  return g;
}

/** The model for a building (key like "house3", "mosque", "rock", or a variant "house3~1"); built once, then reused. */
export function model(key, ground = "sand") {
  const k = key.startsWith("palms") ? `${key}:${ground}` : key;
  if (!cache.has(k)) {
    const [base, v] = key.split("~");
    if (v !== undefined) {
      const src = model(base, ground), swaps = VARIANTS[base]?.[Number(v)];
      if (!src || !swaps) return src;
      cache.set(k, { ...src, matte: recolor(src.matte, swaps), shiny: recolor(src.shiny, swaps) });
      return cache.get(k);
    }
    const b = new Builder();
    const maker = MAKERS[key];
    if (!maker) return null;
    maker(b, ground);
    cache.set(k, b.done());
  }
  return cache.get(k);
}

/** Build a one-off merged model from a function that places parts with the Builder. */
export function compose(fn) { const b = new Builder(); fn(b, MAKERS); return b.done(); }
export function makerSeeded(key, seed) { const b = new Builder(); MAKERS[key](b, "sand", seed); return b.done(); }

// Upgraded farms, shops and workshops: the same building with more added on at each level.
const BIZ = ["palms", "veg", "olive", "grocery", "cafe", "souq", "mandi", "workshop", "pen", "mosque", "hospital", "oilpress"];
function bizExtras(b, id, lvl) {
  if (lvl >= 3) bigTime(b, id); // the fourth level: a company sign, solar roof and lights
  if (id === "olive") {
    b.box(0.12, 0.12, 0.12, C.plaster, { x: 0.38, z: 0.38 }); b.box(0.13, 0.02, 0.13, "#7c8a3a", { x: 0.38, y: 0.12, z: 0.38 });
    if (lvl >= 2) { for (const z of [-0.42, 0.42]) for (let i = 0; i < 4; i++) oliveTree(b, -0.36 + i * 0.24, z, 0.55); }
    return;
  }
  if (id === "oilpress") {
    b.cyl(0.07, 0.07, 0.46, "#b9bfc4", { x: 0.12, z: -0.22 }, 12, "shiny");
    if (lvl >= 2) { b.box(0.34, 0.2, 0.2, "#e6dcc4", { x: 0.28, z: 0.24 }); b.box(0.36, 0.02, 0.22, "#7c8a3a", { x: 0.28, y: 0.2, z: 0.24 }); }
    return;
  }
  if (id === "palms") {
    for (const z of [-0.2, 0.2]) b.box(0.8, 0.012, 0.014, "#3b3f44", { y: 0.018, z }); // drip lines
    b.box(0.12, 0.12, 0.12, C.plaster, { x: 0.38, z: 0.3 }); b.box(0.13, 0.02, 0.13, C.stone, { x: 0.38, y: 0.12, z: 0.3 });
    if (lvl >= 2) { palm(b, 0, 0, 0.8, 0.15); b.cyl(0.07, 0.07, 0.2, C.white, { x: -0.36, z: 0.32 }, 10); b.cyl(0.075, 0.075, 0.02, C.grey, { x: -0.36, y: 0.2, z: 0.32 }, 10); }
    return;
  }
  if (id === "veg") {
    const tunnel = (z) => b.add(new THREE.CylinderGeometry(0.17, 0.17, 0.84, 10, 1, true, 0, Math.PI), "#cfe3ea", { y: 0.015, z, rz: Math.PI / 2 }, "shiny");
    tunnel(0.24);
    if (lvl >= 2) { tunnel(-0.12); b.cyl(0.07, 0.07, 0.22, C.white, { x: -0.38, z: -0.38 }, 10); }
    return;
  }
  if (id === "mosque") {
    // a second minaret, then a walled courtyard with a shaded arcade
    b.box(0.1, 0.62, 0.1, C.white, { x: 0.36, z: -0.36 }); b.cone(0.07, 0.12, C.green, { x: 0.36, y: 0.62, z: -0.36 }, 8);
    b.box(0.08, 0.03, 0.08, C.gold, { x: 0.36, y: 0.5, z: -0.36 }, "lights");
    if (lvl >= 2) { for (const [w, d, x, z] of [[0.94, 0.04, 0, 0.46], [0.04, 0.94, -0.46, 0], [0.04, 0.94, 0.46, 0]]) b.box(w, 0.12, d, "#e8dcc4", { x, z }); b.box(0.5, 0.02, 0.14, "#d9c3a0", { y: 0.2, z: 0.38 }); for (const x of [-0.2, 0, 0.2]) b.cyl(0.015, 0.015, 0.2, C.white, { x, z: 0.42 }, 6); }
    return;
  }
  if (id === "hospital") {
    // a new wing, then a helicopter pad on the roof and an ambulance bay
    b.box(0.3, 0.32, 0.36, "#eef2f4", { x: -0.32, z: 0.24 }); b.box(0.08, 0.02, 0.24, "#c33", { x: -0.32, y: 0.33, z: 0.24 }); b.box(0.24, 0.02, 0.08, "#c33", { x: -0.32, y: 0.33, z: 0.24 });
    if (lvl >= 2) { b.cyl(0.18, 0.18, 0.02, "#3b3f44", { x: 0.15, y: 0.9, z: -0.1 }, 16); b.box(0.12, 0.004, 0.02, "#f3efe6", { x: 0.15, y: 0.925, z: -0.1 }); b.box(0.02, 0.004, 0.1, "#f3efe6", { x: 0.1, y: 0.925, z: -0.1 }); b.box(0.02, 0.004, 0.1, "#f3efe6", { x: 0.2, y: 0.925, z: -0.1 }); b.box(0.16, 0.09, 0.08, "#f4f4f2", { x: 0.34, z: 0.4 }); b.box(0.16, 0.02, 0.02, "#c33", { x: 0.34, y: 0.06, z: 0.441 }); }
    return;
  }
  if (id === "pen") {
    sheep(b, 0.12, 0.16, 2.2); camelSmall(b, -0.28, 0.02, 1.8);
    if (lvl >= 2) { b.box(0.22, 0.2, 0.18, C.mudLight, { x: 0.3, z: -0.3 }); b.box(0.24, 0.02, 0.2, C.mud, { x: 0.3, y: 0.2, z: -0.3 }); b.cyl(0.05, 0.05, 0.16, C.white, { x: 0.36, z: 0.36 }, 8); }
    return;
  }
  if (id === "workshop") {
    b.cyl(0.035, 0.035, 0.55, C.grey, { x: 0.3, z: -0.22 }, 8);
    for (let i = 0; i < 3; i++) b.box(0.1, 0.08, 0.1, i % 2 ? C.orange : C.wood, { x: 0.12 + i * 0.12, z: 0.42 });
    if (lvl >= 2) { b.box(0.7, 0.2, 0.16, "#9a978f", { z: -0.39 }); b.box(0.72, 0.02, 0.18, C.grey, { y: 0.2, z: -0.39 }); }
    return;
  }
  // shops: a tall sign with a gold star per level, a side room, and at the top level a store room and lights
  b.cyl(0.012, 0.012, 0.52, C.dark, { x: 0.42, z: 0.42 }, 5);
  b.box(0.22, 0.12, 0.03, "#1f6f5c", { x: 0.42, y: 0.5, z: 0.42 });
  for (let i = 0; i < lvl; i++) b.box(0.035, 0.035, 0.034, C.gold, { x: 0.42 - (lvl - 1) * 0.03 + i * 0.06, y: 0.54, z: 0.42 });
  b.box(0.16, 0.03, 0.032, C.light, { x: 0.42, y: 0.5, z: 0.43 }, "lights");
  if (id !== "souq") { b.box(0.14, 0.24, 0.36, C.plaster, { x: -0.42, z: 0.02 }); b.box(0.16, 0.02, 0.38, C.stone, { x: -0.42, y: 0.24, z: 0.02 }); }
  else for (const x of [-0.3, 0.3]) b.box(0.32, 0.006, 0.02, C.light, { x, y: 0.3, z: 0 }, "lights");
  if (lvl >= 2) {
    if (id !== "souq") b.box(0.56, 0.2, 0.14, "#d8ccb4", { z: -0.41 });
    else b.add(new THREE.BoxGeometry(0.92, 0.015, 0.92), "#e6d3a8", { y: 0.36 });
  }
}
/** Every building at its fourth level gets a lit company sign and solar panels. */
function bigTime(b, id) {
  b.cyl(0.012, 0.012, 0.7, C.dark, { x: -0.42, z: 0.42 }, 5);
  b.box(0.26, 0.12, 0.03, "#1d3b55", { x: -0.42, y: 0.7, z: 0.42 });
  b.box(0.22, 0.06, 0.032, C.light, { x: -0.42, y: 0.73, z: 0.43 }, "lights");
  for (let i = 0; i < 3; i++) b.box(0.035, 0.035, 0.034, C.gold, { x: -0.48 + i * 0.06, y: 0.79, z: 0.42 }, "shiny");
  if (!["palms", "veg", "olive", "pen"].includes(id)) for (const x of [-0.15, 0.15]) b.add(new THREE.BoxGeometry(0.22, 0.012, 0.14), "#26415e", { x, y: 0.03, z: -0.44, rx: -0.4 }, "shiny");
}
for (const id of BIZ) for (const lvl of [1, 2, 3]) MAKERS[`${id}${lvl}`] = (b, ground, seed) => { MAKERS[id](b, ground, seed); bizExtras(b, id, lvl); };

// ---------- «صراع الجوف»: military buildings (world of al-Jouf only) and what flies ----------
// Realistic, still light for phones: painted steel with a fine normal map, bare metal, tinted glass and
// lamps that glow (they bloom). Each building has a level 0/1/2 model ("radar", "radar1", "radar2").
// The parts that move (the radar's reflector, the air defence launcher, the missile erector, the
// drones) are separate small models that js/warfx.js places and moves on top of the "…_b" base, at the
// spots given by MIL_LAYOUT, so only one copy of them shows in the town.
const MC = {
  tan: "#b9a47b", tanDark: "#9a875f", tanLight: "#cdbb93", olive: "#5d6045", oliveDark: "#474a34", concrete: "#bdb7aa", concreteDark: "#a19c90",
  asphalt: "#4a4c4f", steel: "#9aa1a6", steelDark: "#6b7278", rubber: "#232326", white: "#e9e8e2", glass: "#2a3a46", yellow: "#e0b23a",
  red: "#b3261e", black: "#1f2022", flag: "#1f7a46", earth: "#b49c71"
};
/** Where the moving parts sit on each building (shared with js/warfx.js). */
/** The wind farm's two turbines: x, z and size (the rotor sits at the top of each, a little in front). */
export const WIND_TOWERS = [[-0.24, -0.22, 1], [0.26, 0.2, 0.9]];
export const MIL_LAYOUT = {
  radar: { x: -0.06, z: -0.06, h: [0.5, 0.72, 0.92] },
  airdef: { x: 0.02, y: 0.12, z: -0.04 },
  pad: { pivot: [0, 0.2, -0.3], arm: 0.3, n: [1, 2, 3], slot: (lvl, i) => [(i - ([1, 2, 3][lvl] - 1) / 2) * 0.095, 0.075, 0.0] },
  drones: [[-0.16, 0.3], [0.15, 0.3]]
};
/** Place everything another builder drew into this one (moved, turned and scaled). */
function graft(b, draw, { x = 0, y = 0, z = 0, ry = 0, s = 1 } = {}) {
  const g = new Builder(); draw(g);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(s, s, s));
  for (const set of SETS) for (const part of g.sets[set]) { part.applyMatrix4(m); b.sets[set].push(part); }
}
function pad(b, w = 0.96, d = 0.96, marks = true) {
  b.rbox(w, 0.03, d, 0.008, MC.concrete, {}, "paint");
  for (const t of [-1 / 3, 1 / 3]) { b.box(w - 0.02, 0.002, 0.006, MC.concreteDark, { y: 0.03, z: t * d }); b.box(0.006, 0.002, d - 0.02, MC.concreteDark, { y: 0.03, x: t * w }); }
  if (marks) b.box(w - 0.08, 0.002, 0.014, MC.yellow, { y: 0.031, z: d / 2 - 0.05 });
}
function tWalls(b, x, z, ry, n) {
  graft(b, (g) => { for (let i = 0; i < n; i++) { g.rbox(0.1, 0.22, 0.035, 0.006, MC.concrete, { x: (i - (n - 1) / 2) * 0.105 }); g.rbox(0.1, 0.025, 0.08, 0.006, MC.concreteDark, { x: (i - (n - 1) / 2) * 0.105 }); } }, { x, z, ry });
}
function sandbags(b, r, n, y = 0, ox = 0, oz = 0, arc = Math.PI * 2, a0 = 0) {
  for (let i = 0; i < n; i++) { const a = a0 + (i / n) * arc; for (const k of [0, 1]) b.add(new THREE.SphereGeometry(0.042, 8, 5), k ? "#a89366" : "#b59f72", { x: ox + Math.cos(a + k * 0.12) * r, y: y + 0.025 + k * 0.04, z: oz + Math.sin(a + k * 0.12) * r, sy: 0.55, sx: 1.5, ry: -a }); }
}
function flag(b, x, z, h = 0.7) {
  b.cyl(0.008, 0.01, h, MC.steel, { x, z }, 8, "metal");
  b.add(new THREE.SphereGeometry(0.014, 8, 6), MC.yellow, { x, y: h + 0.01, z }, "metal");
  b.box(0.2, 0.12, 0.006, MC.flag, { x: x + 0.105, y: h - 0.14, z });
  b.box(0.1, 0.018, 0.008, "#ffffff", { x: x + 0.1, y: h - 0.085, z });
}
function mast(b, x, z, h, beacon = true) {
  b.cyl(0.006, 0.012, h, MC.steel, { x, z }, 6, "metal");
  for (let y = 0.15; y < h - 0.05; y += 0.18) b.box(0.08, 0.006, 0.006, MC.steelDark, { x, y, z }, "metal");
  if (beacon) b.add(new THREE.SphereGeometry(0.014, 8, 6), "#ff3b30", { x, y: h + 0.01, z }, "glow");
}
function satDish(b, x, y, z, r = 0.07, ry = 0) {
  graft(b, (g) => {
    g.cyl(0.01, 0.012, 0.05, MC.steelDark, {}, 8, "metal");
    g.lathe([[0, 0], [r * 0.4, 0.004], [r * 0.8, 0.015], [r, 0.03], [r * 0.98, 0.034], [0, 0.012]], MC.white, { y: 0.06, rx: -1.0 }, 18, "paint");
    g.box(0.006, 0.006, r * 1.1, MC.steelDark, { y: 0.09, z: r * 0.35, rx: -0.6 }, "metal");
  }, { x, y, z, ry });
}
function milAc(b, x, y, z) { b.rbox(0.08, 0.06, 0.05, 0.006, "#d9d6cd", { x, y, z }, "paint"); b.cyl(0.018, 0.018, 0.004, MC.steelDark, { x, y: y + 0.03, z: z + 0.026, rx: Math.PI / 2 }, 12, "metal"); }
function windows(b, x0, y, z, n, w, h, gap) { for (let i = 0; i < n; i++) b.box(w, h, 0.006, MC.glass, { x: x0 + i * gap, y, z }, "glass"); }
function wheel(b, x, y, z, r = 0.05, w = 0.04) {
  b.add(new THREE.CylinderGeometry(r, r, w, 16), MC.rubber, { x, y, z, rz: Math.PI / 2 }, "matte");
  b.add(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.004, 12), MC.steelDark, { x, y, z, rz: Math.PI / 2 }, "metal");
}
function windsock(b, x, z) { b.cyl(0.006, 0.006, 0.3, MC.steel, { x, z }, 6, "metal"); b.add(new THREE.ConeGeometry(0.025, 0.1, 10, 1, true), "#ff7a1a", { x: x + 0.05, y: 0.29, z, rz: Math.PI / 2 }, "paint"); }

// ---------- the moving parts ----------
function radarDishParts(b, s = 1) {
  // a turning pedestal and a curved slatted reflector (air surveillance style), with its feed horn
  b.cyl(0.04 * s, 0.05 * s, 0.06 * s, MC.steelDark, {}, 14, "metal");
  b.rbox(0.1 * s, 0.06 * s, 0.08 * s, 0.01, MC.tanLight, { y: 0.06 * s }, "paint");
  const slats = 9, arc = 1.25, R = 0.42 * s;
  for (let i = 0; i < slats; i++) {
    const a = -arc / 2 + (i / (slats - 1)) * arc;
    b.box(0.052 * s, 0.22 * s, 0.012 * s, MC.white, { x: Math.sin(a) * R, y: 0.21 * s, z: -0.1 * s + (R - Math.cos(a) * R) - 0.0, ry: -a, rx: 0.12 }, "paint");
  }
  b.box(0.36 * s, 0.012 * s, 0.012 * s, MC.steel, { y: 0.11 * s, z: -0.07 * s }, "metal");
  b.box(0.36 * s, 0.012 * s, 0.012 * s, MC.steel, { y: 0.3 * s, z: -0.08 * s }, "metal");
  for (const x of [-0.12, 0, 0.12]) b.box(0.01 * s, 0.2 * s, 0.01 * s, MC.steel, { x: x * s, y: 0.11 * s, z: -0.06 * s }, "metal");
  b.box(0.012 * s, 0.012 * s, 0.24 * s, MC.steel, { y: 0.14 * s, z: 0.05 * s, rx: -0.15 }, "metal");
  b.rbox(0.05 * s, 0.04 * s, 0.05 * s, 0.006, MC.steelDark, { y: 0.15 * s, z: 0.17 * s }, "metal");
  b.add(new THREE.SphereGeometry(0.014, 8, 6), "#ff3b30", { y: 0.35 * s, z: -0.08 * s }, "glow");
}
function airdefTurretParts(b, lvl) {
  // a turntable and a launcher box of sealed canisters (2 × 2, 2 × 3, 2 × 4) that tilts up to fire
  const cols = [2, 3, 4][lvl];
  b.cyl(0.13, 0.14, 0.03, MC.steelDark, {}, 20, "metal");
  b.rbox(0.18, 0.06, 0.16, 0.01, MC.olive, { y: 0.03 }, "paint");
  for (const x of [-0.11, 0.11]) b.rbox(0.03, 0.12, 0.08, 0.006, MC.oliveDark, { x, y: 0.03 }, "paint");
  const w = cols * 0.07 + 0.02;
  b.rbox(w, 0.16, 0.42, 0.012, MC.olive, { y: 0.1, z: 0.02 }, "paint");
  for (let r = 0; r < 2; r++) for (let c = 0; c < cols; c++) {
    const x = (c - (cols - 1) / 2) * 0.07, y = 0.145 + (r - 0.5) * 0.07;
    b.box(0.058, 0.058, 0.006, MC.oliveDark, { x, y: y - 0.029, z: 0.233 }, "paint");
    b.cyl(0.02, 0.02, 0.004, "#c9a43a", { x, y, z: 0.237, rx: Math.PI / 2 }, 12, "paint");
  }
  b.box(w + 0.004, 0.01, 0.43, MC.oliveDark, { y: 0.26, z: 0.02 }, "paint");
  if (lvl >= 1) b.rbox(0.06, 0.05, 0.06, 0.008, MC.steelDark, { x: w / 2 + 0.03, y: 0.12, z: -0.08 }, "metal");
  if (lvl >= 2) b.box(0.012, 0.012, 0.012, "#38d26b", { x: -w / 2 - 0.005, y: 0.2, z: 0.2 }, "glow");
}
function padArmParts(b, lvl, loaded = true) {
  // the erector: a steel frame along +z (its pivot at the back) carrying sealed missile canisters
  const n = [1, 2, 3][lvl], L = MIL_LAYOUT.pad;
  b.box(n * 0.095 + 0.04, 0.025, 0.62, MC.steelDark, { y: 0.0, z: 0 }, "metal");
  for (const x of [-1, 1]) b.box(0.012, 0.05, 0.6, MC.steel, { x: x * (n * 0.095 / 2 + 0.02), y: 0.0, z: 0 }, "metal");
  for (let i = 0; i < n; i++) {
    const [x, y] = L.slot(lvl, i);
    b.rbox(0.085, 0.085, 0.58, 0.01, MC.olive, { x, y: y - 0.0425, z: 0 }, "paint");
    for (const z of [-0.2, 0, 0.2]) b.box(0.088, 0.01, 0.012, MC.oliveDark, { x, y: y + 0.04, z }, "paint");
    b.box(0.07, 0.07, 0.006, loaded ? "#c9542a" : MC.black, { x, y: y - 0.035, z: 0.292 }, "paint");
    if (loaded) b.box(0.03, 0.03, 0.004, MC.white, { x, y: y - 0.015, z: 0.297 }, "paint");
  }
}
function missileParts(b, adv) {
  // along +z (the nose), centred on its middle: a turned body with an ogive nose, a nozzle and fins
  const L = adv ? 0.62 : 0.5, R = adv ? 0.042 : 0.034, h = L / 2;
  const body = adv ? "#d9d8d2" : MC.white;
  b.lathe([[0, -h], [R * 0.75, -h], [R, -h + 0.02], [R, h - 0.13], [R * 0.93, h - 0.09], [R * 0.72, h - 0.05], [R * 0.4, h - 0.015], [0, h]], body, { rx: Math.PI / 2 }, 18, "paint");
  b.lathe([[0, h - 0.06], [R * 0.85, h - 0.06], [R * 0.6, h - 0.025], [R * 0.3, h - 0.008], [0, h + 0.002]], adv ? MC.black : "#8e959a", { rx: Math.PI / 2 }, 16, adv ? "paint" : "metal");
  b.add(new THREE.CylinderGeometry(R * 1.01, R * 1.01, 0.03, 18), adv ? MC.red : MC.flag, { z: h - 0.15, rx: Math.PI / 2 }, "paint");
  b.add(new THREE.CylinderGeometry(R * 0.7, R * 0.85, 0.035, 16, 1, true), MC.steelDark, { z: -h - 0.012, rx: Math.PI / 2 }, "metal");
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + Math.PI / 4;
    b.plate([[0, 0], [0.07, 0], [0.07, 0.035], [0.02, 0.06]], 0.006, MC.steelDark, { x: Math.cos(a) * R, y: Math.sin(a) * R, z: -h + 0.01, rz: a, ry: -Math.PI / 2 }, "metal");
    if (adv) b.plate([[0, 0], [0.18, 0], [0.16, 0.012], [0.02, 0.012]], 0.004, "#b8b7b0", { x: Math.cos(a) * R, y: Math.sin(a) * R, z: -0.05, rz: a, ry: -Math.PI / 2 }, "paint");
  }
}
function interceptorParts(b) {
  const L = 0.34, R = 0.02, h = L / 2;
  b.lathe([[0, -h], [R, -h], [R, h - 0.07], [R * 0.6, h - 0.025], [0, h]], MC.white, { rx: Math.PI / 2 }, 12, "paint");
  b.lathe([[0, h - 0.05], [R * 0.82, h - 0.05], [R * 0.45, h - 0.018], [0, h + 0.002]], MC.black, { rx: Math.PI / 2 }, 12, "paint");
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; b.plate([[0, 0], [0.05, 0], [0.05, 0.022], [0.015, 0.04]], 0.004, MC.steelDark, { x: Math.cos(a) * R, y: Math.sin(a) * R, z: -h + 0.005, rz: a, ry: -Math.PI / 2 }, "metal"); }
}
function droneParts(b, adv) {
  if (adv) {
    // a long-endurance drone: slim fuselage, long straight wings, V-tail, a sensor ball under the nose
    b.lathe([[0, -0.24], [0.022, -0.22], [0.032, -0.12], [0.036, 0.08], [0.03, 0.17], [0.016, 0.22], [0, 0.235]], "#c9cbc6", { rx: Math.PI / 2 }, 14, "paint");
    b.plate([[-0.34, 0], [0.34, 0], [0.32, 0.05], [-0.32, 0.05]], 0.008, "#bfc1bc", { y: 0.012, z: 0.01, rx: Math.PI / 2 }, "paint");
    for (const s of [-1, 1]) b.plate([[0, 0], [0.12, 0], [0.11, 0.045], [0.02, 0.045]], 0.005, "#bfc1bc", { x: s * 0.012, y: 0.02, z: -0.19, rz: s * 0.7, ry: -Math.PI / 2 }, "paint");
    b.add(new THREE.SphereGeometry(0.022, 12, 8), MC.steelDark, { y: -0.032, z: 0.13 }, "metal");
    b.add(new THREE.SphereGeometry(0.012, 10, 8), MC.glass, { y: -0.036, z: 0.148 }, "glass");
    b.cyl(0.012, 0.016, 0.03, MC.steelDark, { z: -0.245, rx: Math.PI / 2 }, 10, "metal");
    for (const s of [-1, 1]) b.add(new THREE.SphereGeometry(0.006, 6, 5), s > 0 ? "#38d26b" : "#ff3b30", { x: s * 0.34, y: 0.012, z: 0.03 }, "glow");
  } else {
    // a four-rotor drone: carbon body, a sand-coloured shell, arms, motors and a camera gimbal
    b.rbox(0.12, 0.04, 0.16, 0.012, "#2b2e30", { y: -0.03 }, "paint");
    b.rbox(0.09, 0.022, 0.12, 0.01, MC.tanLight, { y: 0.008 }, "paint");
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      b.box(0.17, 0.012, 0.018, "#2b2e30", { x: x * 0.075, y: -0.012, z: z * 0.075, ry: x * z > 0 ? -Math.PI / 4 : Math.PI / 4 }, "paint");
      b.cyl(0.018, 0.02, 0.03, MC.steelDark, { x: x * 0.14, y: -0.02, z: z * 0.14 }, 12, "metal");
      b.cyl(0.006, 0.006, 0.05, MC.black, { x: x * 0.1, y: -0.07, z: z * 0.11 }, 6, "matte");
    }
    b.add(new THREE.SphereGeometry(0.022, 12, 8), MC.steelDark, { y: -0.06, z: 0.07 }, "metal");
    b.add(new THREE.SphereGeometry(0.012, 10, 8), MC.glass, { y: -0.064, z: 0.088 }, "glass");
    b.box(0.012, 0.012, 0.012, "#ff3b30", { x: -0.05, y: 0.0, z: 0.08 }, "glow");
    b.box(0.012, 0.012, 0.012, "#38d26b", { x: 0.05, y: 0.0, z: 0.08 }, "glow");
  }
}
function rotorParts(b, adv) {
  if (adv) { b.cyl(0.01, 0.01, 0.02, MC.steelDark, { rx: Math.PI / 2 }, 8, "metal"); for (const a of [0, Math.PI]) b.box(0.16, 0.004, 0.02, "#2b2e30", { x: Math.cos(a) * 0.04, y: Math.sin(a) * 0.04, rz: a, rx: 0.2 }, "paint"); return; }
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) for (const a of [0, Math.PI / 2]) b.box(0.15, 0.003, 0.014, "#d4d4cc", { x: x * 0.14, y: 0.0, z: z * 0.14, ry: a + (x + z) * 0.4, rz: 0.06 }, "paint");
}
function hangar(b, x, z, w, d, color = MC.tan) {
  // a corrugated steel arch, its door facing +z, half open
  const r = w / 2;
  b.add(new THREE.CylinderGeometry(r, r, d, 24, 1, false, Math.PI / 2, Math.PI), color, { x, z, rx: Math.PI / 2 }, "paint");
  const ribs = Math.round(d / 0.035);
  for (let k = 0; k <= ribs; k++) b.add(new THREE.CylinderGeometry(r * 1.012, r * 1.012, 0.008, 24, 1, false, Math.PI / 2, Math.PI), MC.tanDark, { x, z: z - d / 2 + (d * k) / ribs, rx: Math.PI / 2 }, "paint");
  b.add(new THREE.CylinderGeometry(r * 0.9, r * 0.9, 0.006, 18, 1, false, Math.PI / 2, Math.PI), "#141414", { x, z: z + d / 2 + 0.003, rx: Math.PI / 2 }, "matte");
  b.box(r * 0.95, r * 0.86, 0.012, MC.steel, { x: x - r * 0.42, z: z + d / 2 + 0.01 }, "metal");
  b.box(r * 1.9, 0.012, 0.016, MC.yellow, { x, z: z + d / 2 + 0.03, y: 0.002 }, "paint");
}
function truck(b, lvl) {
  // an 8 × 8 launcher truck along z: cab at the front (+z), chassis, wheels, equipment boxes
  b.box(0.24, 0.05, 0.78, MC.steelDark, { y: 0.075 }, "metal");
  for (const z of [-0.3, -0.16, 0.1, 0.24]) for (const s of [-1, 1]) wheel(b, s * 0.13, 0.055, z, 0.055, 0.045);
  b.rbox(0.26, 0.1, 0.18, 0.02, MC.olive, { y: 0.1, z: 0.3 }, "paint");
  b.rbox(0.24, 0.06, 0.1, 0.015, MC.olive, { y: 0.2, z: 0.31 }, "paint");
  b.box(0.2, 0.045, 0.006, MC.glass, { y: 0.225, z: 0.362 }, "glass");
  for (const s of [-1, 1]) { b.box(0.006, 0.04, 0.06, MC.glass, { x: s * 0.121, y: 0.225, z: 0.31 }, "glass"); b.box(0.012, 0.03, 0.01, MC.black, { x: s * 0.145, y: 0.22, z: 0.37 }, "matte"); }
  for (const s of [-1, 1]) b.box(0.03, 0.012, 0.012, "#fff3d6", { x: s * 0.09, y: 0.13, z: 0.392 }, "glow");
  for (const s of [-1, 1]) b.rbox(0.04, 0.06, 0.2, 0.008, MC.oliveDark, { x: s * 0.13, y: 0.1, z: -0.05 }, "paint");
  for (const s of [-1, 1]) b.box(0.05, 0.12, 0.012, MC.steel, { x: s * 0.13, y: 0.06, z: -0.39 }, "metal");
}

Object.assign(MAKERS, {
  milhq_any(b, lvl = 0) {
    pad(b);
    if (lvl === 0) {
      b.rbox(0.5, 0.24, 0.36, 0.015, MC.tan, { x: -0.1, z: -0.12 }, "paint");
      b.box(0.52, 0.03, 0.38, MC.tanDark, { x: -0.1, y: 0.24, z: -0.12 }, "paint");
      windows(b, -0.3, 0.14, 0.063, 4, 0.07, 0.05, 0.12);
      b.box(0.09, 0.15, 0.008, MC.steelDark, { x: 0.08, z: 0.063 }, "metal");
      b.box(0.012, 0.012, 0.012, "#fff3d6", { x: 0.08, y: 0.17, z: 0.07 }, "glow");
      satDish(b, -0.25, 0.27, -0.2, 0.06, 0.6); milAc(b, 0.05, 0.27, -0.2);
      mast(b, -0.02, -0.25, 0.75);
      sandbags(b, 0.1, 8, 0, 0.3, 0.3);
      flag(b, 0.3, 0.3, 0.55);
      tWalls(b, -0.25, 0.36, 0, 3);
    } else if (lvl === 1) {
      b.rbox(0.62, 0.42, 0.42, 0.02, MC.tan, { x: -0.06, z: -0.12 }, "paint");
      b.box(0.64, 0.03, 0.44, MC.tanDark, { x: -0.06, y: 0.42, z: -0.12 }, "paint");
      for (const y of [0.1, 0.27]) b.box(0.56, 0.06, 0.006, MC.glass, { x: -0.06, y, z: 0.093 }, "glass");
      b.box(0.18, 0.012, 0.08, MC.tanDark, { x: 0.12, y: 0.19, z: 0.13 }, "paint");
      b.box(0.1, 0.16, 0.008, MC.glass, { x: 0.12, z: 0.093 }, "glass");
      satDish(b, -0.28, 0.45, -0.22, 0.08, 0.5); satDish(b, -0.12, 0.45, -0.24, 0.06, 1.1); milAc(b, 0.1, 0.45, -0.2);
      mast(b, 0.18, -0.26, 1.0);
      b.cyl(0.15, 0.15, 0.006, "#6d6f70", { x: 0.28, y: 0.03, z: 0.27 }, 24, "paint");
      b.box(0.12, 0.004, 0.022, MC.white, { x: 0.28, y: 0.036, z: 0.27 }, "paint"); for (const s of [-1, 1]) b.box(0.022, 0.004, 0.11, MC.white, { x: 0.28 + s * 0.05, y: 0.036, z: 0.27 }, "paint");
      flag(b, -0.38, 0.3, 0.75);
      tWalls(b, -0.2, 0.38, 0, 3);
    } else {
      for (const [x, z, ry, n] of [[0, 0.44, 0, 8], [0, -0.44, 0, 8], [0.44, 0, Math.PI / 2, 6], [-0.44, 0, Math.PI / 2, 6]]) tWalls(b, x, z, ry, n);
      b.rbox(0.56, 0.5, 0.36, 0.02, MC.tan, { x: -0.12, z: -0.12 }, "paint");
      b.box(0.58, 0.03, 0.38, MC.tanDark, { x: -0.12, y: 0.5, z: -0.12 }, "paint");
      for (const y of [0.08, 0.22, 0.36]) b.box(0.5, 0.06, 0.006, MC.glass, { x: -0.12, y, z: 0.063 }, "glass");
      b.rbox(0.22, 0.82, 0.2, 0.02, MC.tanLight, { x: 0.22, z: -0.2 }, "paint");
      b.box(0.24, 0.1, 0.22, MC.glass, { x: 0.22, y: 0.7, z: -0.2 }, "glass");
      b.box(0.24, 0.02, 0.22, MC.tanDark, { x: 0.22, y: 0.82, z: -0.2 }, "paint");
      mast(b, 0.22, -0.2, 1.3);
      b.add(new THREE.SphereGeometry(0.09, 18, 12, 0, Math.PI * 2, 0, Math.PI / 1.8), MC.white, { x: -0.3, y: 0.53, z: -0.2 }, "paint");
      satDish(b, -0.08, 0.53, -0.22, 0.08, 0.4);
      b.cyl(0.13, 0.13, 0.006, "#6d6f70", { x: 0.22, y: 0.03, z: 0.24 }, 24, "paint");
      b.box(0.1, 0.004, 0.02, MC.white, { x: 0.22, y: 0.036, z: 0.24 }, "paint"); for (const s of [-1, 1]) b.box(0.02, 0.004, 0.09, MC.white, { x: 0.22 + s * 0.04, y: 0.036, z: 0.24 }, "paint");
      flag(b, -0.36, 0.3, 0.85); flag(b, -0.2, 0.3, 0.85);
    }
  },
  milhq(b) { MAKERS.milhq_any(b, 0); }, milhq1(b) { MAKERS.milhq_any(b, 1); }, milhq2(b) { MAKERS.milhq_any(b, 2); },

  dronebase_any(b, lvl = 0, withDrones = true) {
    pad(b, 0.96, 0.96, false);
    b.box(0.86, 0.003, 0.014, MC.yellow, { y: 0.031, z: 0.12 });
    hangar(b, -0.18, -0.15, 0.42, 0.46);
    if (lvl >= 1) hangar(b, 0.25, -0.2, 0.32, 0.36, "#c4b089");
    for (const [x, z] of MIL_LAYOUT.drones) {
      b.cyl(0.12, 0.12, 0.004, "#7d7a72", { x, y: 0.03, z }, 24, "paint");
      b.box(0.1, 0.002, 0.014, MC.white, { x, y: 0.035, z }, "paint"); for (const s of [-1, 1]) b.box(0.014, 0.002, 0.08, MC.white, { x: x + s * 0.04, y: 0.035, z }, "paint");
    }
    b.rbox(0.18, 0.1, 0.09, 0.008, "#d8d3c6", { x: 0.32, z: 0.08 }, "paint"); windows(b, 0.27, 0.06, 0.126, 2, 0.04, 0.035, 0.07); milAc(b, 0.32, 0.1, 0.06);
    windsock(b, 0.42, 0.42);
    if (lvl >= 2) { b.rbox(0.1, 0.48, 0.1, 0.01, MC.tanLight, { x: -0.38, z: 0.36 }, "paint"); b.box(0.14, 0.08, 0.14, MC.glass, { x: -0.38, y: 0.48, z: 0.36 }, "glass"); b.box(0.15, 0.015, 0.15, MC.tanDark, { x: -0.38, y: 0.56, z: 0.36 }, "paint"); mast(b, -0.38, 0.36, 0.75); }
    if (withDrones) for (const [x, z] of MIL_LAYOUT.drones.slice(0, Math.min(2, lvl + 1))) graft(b, (g) => { droneParts(g, false); rotorParts(g, false); }, { x, y: 0.1, z, s: 0.8 });
  },
  dronebase(b) { MAKERS.dronebase_any(b, 0); }, dronebase1(b) { MAKERS.dronebase_any(b, 1); }, dronebase2(b) { MAKERS.dronebase_any(b, 2); },
  dronebase_b(b) { MAKERS.dronebase_any(b, 0, false); }, dronebase1_b(b) { MAKERS.dronebase_any(b, 1, false); }, dronebase2_b(b) { MAKERS.dronebase_any(b, 2, false); },

  missilepad_any(b, lvl = 0, withArm = true) {
    pad(b);
    // the blast deflector behind the launcher
    b.rbox(0.9, 0.24, 0.07, 0.01, MC.concrete, { z: -0.44 }, "paint");
    b.box(0.9, 0.012, 0.11, MC.concreteDark, { y: 0.24, z: -0.43 }, "paint");
    for (let k = 0; k < 6; k++) b.box(0.01, 0.2, 0.004, "#2e2b26", { x: -0.35 + k * 0.14, y: 0.02, z: -0.403 }, "matte");
    graft(b, (g) => truck(g, lvl), { x: 0, z: 0.03 });
    b.rbox(0.16, 0.12, 0.12, 0.01, MC.tanLight, { x: -0.38, z: 0.36 }, "paint"); windows(b, -0.42, 0.07, 0.421, 2, 0.04, 0.03, 0.07);
    b.box(0.012, 0.012, 0.012, "#38d26b", { x: -0.32, y: 0.11, z: 0.42 }, "glow");
    if (lvl >= 1) mast(b, 0.42, 0.4, 0.5);
    if (lvl >= 2) graft(b, (g) => { g.box(0.16, 0.012, 0.16, MC.steelDark, { y: 0.0 }, "metal"); for (const x of [-0.07, 0.07]) for (const z of [-0.07, 0.07]) g.cyl(0.006, 0.006, 0.3, MC.steel, { x, z }, 6, "metal"); g.box(0.2, 0.004, 0.2, "#6b6a45", { y: 0.3 }, "paint"); }, { x: 0.36, z: -0.28 });
    if (withArm) graft(b, (g) => padArmParts(g, lvl, true), { x: MIL_LAYOUT.pad.pivot[0], y: MIL_LAYOUT.pad.pivot[1], z: MIL_LAYOUT.pad.pivot[2] + MIL_LAYOUT.pad.arm });
  },
  missilepad(b) { MAKERS.missilepad_any(b, 0); }, missilepad1(b) { MAKERS.missilepad_any(b, 1); }, missilepad2(b) { MAKERS.missilepad_any(b, 2); },
  missilepad_b(b) { MAKERS.missilepad_any(b, 0, false); }, missilepad1_b(b) { MAKERS.missilepad_any(b, 1, false); }, missilepad2_b(b) { MAKERS.missilepad_any(b, 2, false); },

  radar_any(b, lvl = 0, withDish = true) {
    pad(b);
    const { x: rx, z: rz, h: hs } = MIL_LAYOUT.radar, h = hs[lvl];
    b.rbox(0.3, 0.2, 0.22, 0.012, MC.tanLight, { x: 0.25, z: 0.26 }, "paint");
    b.box(0.06, 0.12, 0.006, MC.steelDark, { x: 0.18, z: 0.372 }, "metal"); milAc(b, 0.32, 0.12, 0.38);
    b.box(0.012, 0.012, 0.012, "#38d26b", { x: 0.3, y: 0.17, z: 0.372 }, "glow");
    // the lattice tower with its braces and a railed platform
    const s = 0.08;
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(0.016, h, 0.016, MC.steel, { x: rx + dx * s, z: rz + dz * s }, "metal");
    for (let y = 0.08; y < h - 0.04; y += 0.12) for (const [ax, az, ry] of [[0, -s, 0], [0, s, 0], [-s, 0, Math.PI / 2], [s, 0, Math.PI / 2]]) {
      b.box(s * 2, 0.008, 0.008, MC.steelDark, { x: rx + ax, y, z: rz + az, ry }, "metal");
      b.box(s * 2.6, 0.006, 0.006, MC.steelDark, { x: rx + ax, y: y + 0.06, z: rz + az, ry, rz: ry ? 0 : 0.42, rx: ry ? 0.42 : 0 }, "metal");
    }
    b.rbox(0.24, 0.02, 0.24, 0.004, MC.steelDark, { x: rx, y: h, z: rz }, "metal");
    for (const [ax, az, ry] of [[0, -0.12, 0], [0, 0.12, 0], [-0.12, 0, Math.PI / 2], [0.12, 0, Math.PI / 2]]) b.box(0.24, 0.006, 0.006, MC.yellow, { x: rx + ax, y: h + 0.06, z: rz + az, ry }, "paint");
    if (lvl >= 2) { b.add(new THREE.SphereGeometry(0.12, 20, 14, 0, Math.PI * 2, 0, Math.PI / 1.7), MC.white, { x: -0.3, y: 0.18, z: 0.3 }, "paint"); b.cyl(0.12, 0.12, 0.18, MC.tanLight, { x: -0.3, z: 0.3 }, 20, "paint"); }
    if (withDish) graft(b, (g) => radarDishParts(g, 0.8 + lvl * 0.12), { x: rx, y: h + 0.02, z: rz });
  },
  radar(b) { MAKERS.radar_any(b, 0); }, radar1(b) { MAKERS.radar_any(b, 1); }, radar2(b) { MAKERS.radar_any(b, 2); },
  radar_b(b) { MAKERS.radar_any(b, 0, false); }, radar1_b(b) { MAKERS.radar_any(b, 1, false); }, radar2_b(b) { MAKERS.radar_any(b, 2, false); },

  airdef_any(b, lvl = 0, withTurret = true) {
    pad(b);
    sandbags(b, 0.4, 16, 0, 0, 0, Math.PI * 1.4, Math.PI * 0.8);
    const L = MIL_LAYOUT.airdef;
    // the trailer under the launcher: frame, wheels and outrigger feet
    b.box(0.3, 0.04, 0.44, MC.steelDark, { x: L.x, y: 0.06, z: L.z }, "metal");
    for (const z of [-0.12, 0.0]) for (const s of [-1, 1]) wheel(b, L.x + s * 0.17, 0.05, L.z + z, 0.05, 0.04);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { b.box(0.012, 0.012, 0.12, MC.steel, { x: L.x + dx * 0.2, y: 0.07, z: L.z + dz * 0.2, ry: dx * dz * 0.8 }, "metal"); b.cyl(0.025, 0.025, 0.012, MC.steelDark, { x: L.x + dx * 0.25, y: 0.03, z: L.z + dz * 0.25 }, 10, "metal"); }
    b.cyl(0.03, 0.03, 0.06, MC.steelDark, { x: L.x, y: 0.06, z: L.z }, 12, "metal");
    // the fire control radar: a flat panel on a small truck (from the second level), a mast radar before that
    if (lvl >= 1) graft(b, (g) => { g.box(0.14, 0.04, 0.26, MC.steelDark, { y: 0.05 }, "metal"); for (const z of [-0.08, 0.08]) for (const s of [-1, 1]) wheel(g, s * 0.075, 0.04, z, 0.04, 0.03); g.rbox(0.14, 0.08, 0.1, 0.01, MC.olive, { y: 0.08, z: 0.08 }, "paint"); g.box(0.1, 0.03, 0.005, MC.glass, { y: 0.14, z: 0.131 }, "glass"); g.rbox(0.16, 0.16, 0.03, 0.01, MC.olive, { y: 0.1, z: -0.06, rx: -0.35 }, "paint"); g.box(0.13, 0.13, 0.004, "#3d4430", { y: 0.12, z: -0.04, rx: -0.35 }, "paint"); }, { x: -0.32, z: 0.3, ry: 0.5 });
    else { mast(b, -0.34, 0.32, 0.4, false); satDish(b, -0.34, 0.4, 0.32, 0.06, 0.8); }
    b.rbox(0.16, 0.1, 0.12, 0.01, MC.olive, { x: 0.32, z: 0.32 }, "paint"); b.box(0.012, 0.012, 0.012, "#38d26b", { x: 0.32, y: 0.1, z: 0.381 }, "glow");
    if (withTurret) graft(b, (g) => airdefTurretParts(g, lvl), { x: L.x, y: L.y, z: L.z });
  },
  airdef(b) { MAKERS.airdef_any(b, 0); }, airdef1(b) { MAKERS.airdef_any(b, 1); }, airdef2(b) { MAKERS.airdef_any(b, 2); },
  airdef_b(b) { MAKERS.airdef_any(b, 0, false); }, airdef1_b(b) { MAKERS.airdef_any(b, 1, false); }, airdef2_b(b) { MAKERS.airdef_any(b, 2, false); },

  armory(b) {
    pad(b);
    b.add(new THREE.SphereGeometry(0.44, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), MC.earth, { sy: 0.45, z: -0.08 }, "matte");
    b.rbox(0.42, 0.26, 0.08, 0.012, MC.concrete, { z: 0.27 }, "paint");
    b.box(0.26, 0.18, 0.012, MC.steel, { z: 0.315 }, "metal");
    b.box(0.004, 0.18, 0.014, MC.steelDark, { z: 0.317 }, "metal");
    for (let k = 0; k < 7; k++) b.box(0.035, 0.018, 0.006, k % 2 ? MC.black : MC.yellow, { x: -0.105 + k * 0.035, y: 0.2, z: 0.32 }, "paint");
    b.box(0.014, 0.014, 0.014, "#fff3d6", { y: 0.235, z: 0.32 }, "glow");
    for (const x of [-0.18, 0.18]) { b.cyl(0.018, 0.018, 0.08, MC.steel, { x, y: 0.18, z: -0.1 }, 10, "metal"); b.cone(0.03, 0.03, MC.steelDark, { x, y: 0.26, z: -0.1 }, 10, "metal"); }
    for (let i = 0; i < 3; i++) b.rbox(0.1, 0.07, 0.07, 0.008, MC.olive, { x: 0.33, y: i * 0.07, z: 0.36 - (i % 2) * 0.02 }, "paint");
    flag(b, -0.36, 0.34, 0.55);
  },

  // the moving parts and what flies (placed and moved by js/warfx.js)
  radarDish(b) { radarDishParts(b, 0.8); }, radarDish1(b) { radarDishParts(b, 0.92); }, radarDish2(b) { radarDishParts(b, 1.04); },
  airdefTurret(b) { airdefTurretParts(b, 0); }, airdefTurret1(b) { airdefTurretParts(b, 1); }, airdefTurret2(b) { airdefTurretParts(b, 2); },
  padArm(b) { padArmParts(b, 0, false); }, padArm1(b) { padArmParts(b, 1, false); }, padArm2(b) { padArmParts(b, 2, false); },
  padArmL(b) { padArmParts(b, 0, true); }, padArmL1(b) { padArmParts(b, 1, true); }, padArmL2(b) { padArmParts(b, 2, true); },
  wMissile(b) { missileParts(b, false); }, wMissile2(b) { missileParts(b, true); },
  wDrone(b) { droneParts(b, false); }, wDrone2(b) { droneParts(b, true); },
  wRotor(b) { rotorParts(b, false); }, wRotor2(b) { rotorParts(b, true); },
  wInterceptor(b) { interceptorParts(b); }
});
const MIL_MODELS = ["milhq", "dronebase", "missilepad", "radar", "airdef"];
/** The base of a military building without its moving parts, when it has them (else the full model). */
export const baseKey = (key) => (MAKERS[`${key}_b`] ? `${key}_b` : key);

/** The vault at three sizes: 0 a small strongroom, 1 iron-clad, 2 the treasury house with a dome. */
function vaultParts(b, k) {
  const w = 0.56 + k * 0.1, h = 0.3 + k * 0.08, d = 0.5 + k * 0.08;
  b.box(0.92, 0.02, 0.92, C.stone);
  b.rbox(w, h, d, 0.02, k ? "#cbbfa6" : "#d8c9a6", { z: -0.04 }, "paint");
  b.box(w + 0.06, 0.04, d + 0.06, C.stone, { y: h, z: -0.04 });
  // the steel door with its wheel
  b.rbox(0.2, 0.22, 0.03, 0.01, k ? "#7d8691" : "#8a7a5c", { y: 0.02, z: -0.04 + d / 2 + 0.005 }, "metal");
  b.cyl(0.05, 0.05, 0.012, C.gold, { y: 0.13, z: -0.04 + d / 2 + 0.03, rx: Math.PI / 2 }, 12, "metal");
  for (const r of [0, Math.PI / 2]) b.box(0.08, 0.008, 0.008, C.gold, { y: 0.13, z: -0.04 + d / 2 + 0.035, rz: r }, "metal");
  // iron bands, then a dome and gold for the treasury
  if (k >= 1) for (const y of [0.08, h - 0.06]) b.box(w + 0.01, 0.025, d + 0.01, "#6f757c", { y, z: -0.04 }, "metal");
  if (k >= 2) { b.dome(0.16, "#d9b55a", { y: h + 0.04, z: -0.04 }, "metal"); b.cyl(0.012, 0.012, 0.12, C.gold, { y: h + 0.2, z: -0.04 }, 6, "metal"); }
  b.box(0.16, 0.04, 0.02, "#1f6f5c", { y: h - 0.03, z: -0.04 + d / 2 + 0.006 });
}
// ---------- each place of al-Jouf builds its landmarks in its own way ----------
// The gate, the TV tower, the skyline and the airport of a town take the style of the place it stands by on
// al-Jouf's map (js/main.js sets it when the town opens): الرافعية keeps the models above.
//   jandal: دومة الجندل, the golden stone of Marid castle, round towers with leaning walls
//   zabal:  سكاكا and ميقوع, red mud like Za'bal castle on its hill, square towers and Najdi teeth
//   kaf:    القريات, الحديثة, العيساوية, الحماد, الشويحطية, زلوم: black basalt of the harra, arched doors (Qasr Kaf)
//   rawda:  طبرجل, روضات الجوف, صوير: white limestone arcades among olive groves
//   nafud:  النفود الكبير, أبو عجرم: sand pillars under a black goat-hair tent with Sadu stripes
export const PLACE_STYLE = { "دومة الجندل": "jandal", "سكاكا": "zabal", "ميقوع": "zabal", "القريات": "kaf", "الحديثة": "kaf", "العيساوية": "kaf", "الحماد": "kaf", "الشويحطية": "kaf", "زلوم": "kaf", "طبرجل": "rawda", "روضات الجوف": "rawda", "صوير": "rawda", "النفود الكبير": "nafud", "أبو عجرم": "nafud" };
const STYLED = ["gate", "tower", "skyline", "airport"];
let landStyle = "";
/** The style of the landmarks being drawn: a PLACE_STYLE value, or "" for الرافعية's own. */
export function setLandStyle(style) { landStyle = MAKERS[`gate_${style}`] ? style : ""; }
const ST = {
  jandal: { wall: "#c4a271", dark: "#9f8158", trim: "#8d7049", glass: "#9c7a4e", ground: "#d6c29c", accent: "#2f7d5b" },
  zabal: { wall: "#c98f5e", dark: "#a9744a", trim: "#8e5d38", glass: "#a8694a", ground: "#dcb98d", accent: "#b3261e" },
  kaf: { wall: "#4a4845", dark: "#363431", trim: "#8a857c", glass: "#3f4a52", ground: "#8f8a80", accent: "#c9a14a" },
  rawda: { wall: "#efe9dc", dark: "#d9d0bd", trim: "#6e8a4e", glass: "#5f8f6a", ground: "#d9d4c2", accent: "#3f7a46" },
  nafud: { wall: "#e2c28c", dark: "#c9a46a", trim: "#2d2620", glass: "#c9a46a", ground: "#ead6ad", accent: "#b3261e" }
};
/** A Sadu band: red, white and black stripes along a face (the Bedouin weave). */
function saduBand(b, w, y, z, h = 0.03, x0 = 0) {
  const cols = ["#b3261e", "#f2ece0", "#2a221d", "#f2ece0"];
  const n = Math.max(4, Math.round(w / 0.04));
  for (let i = 0; i < n; i++) b.box(w / n, h, 0.012, cols[i % cols.length], { x: x0 - w / 2 + (i + 0.5) * w / n, y, z });
}
const GATES = {
  jandal(b, k) { // Marid: two round, leaning stone towers on a rocky base, an arch between, battlements
    b.box(0.98, 0.012, 0.6, k.ground);
    b.add(new THREE.CylinderGeometry(0.5, 0.52, 0.08, 10), "#b99a6c", { y: 0.04, sz: 0.45 });
    for (const x of [-0.34, 0.34]) {
      b.cyl(0.11, 0.15, 0.78, k.wall, { x, y: 0.06 }, 12);
      b.cyl(0.12, 0.12, 0.04, k.trim, { x, y: 0.84 }, 12);
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; b.box(0.035, 0.05, 0.035, k.dark, { x: x + Math.cos(a) * 0.1, y: 0.88, z: Math.sin(a) * 0.1 }); }
      b.box(0.03, 0.07, 0.01, "#3b2a1c", { x, y: 0.55, z: 0.13 });
    }
    b.box(0.5, 0.5, 0.26, k.wall, { y: 0.06 });
    b.box(0.52, 0.04, 0.28, k.trim, { y: 0.56 });
    for (let i = 0; i < 6; i++) b.box(0.05, 0.05, 0.05, k.dark, { x: -0.22 + i * 0.088, y: 0.6, z: 0.11 });
    b.add(new THREE.CylinderGeometry(0.13, 0.13, 0.28, 14, 1, false, 0, Math.PI), "#3b2a1c", { y: 0.3, rx: Math.PI / 2, rz: Math.PI / 2, sz: 0.01 });
    b.box(0.26, 0.24, 0.27, "#3b2a1c", { y: 0.06, sz: 0.01 });
    for (const x of [-0.12, 0.12]) b.box(0.03, 0.03, 0.02, C.light, { x, y: 0.42, z: 0.14 }, "lights");
    for (const x of [-0.47, 0.47]) palm(b, x, 0.22, 0.7);
  },
  zabal(b, k) { // Za'bal: a mud fort on a hill, square towers, Najdi teeth, a gate in the wall below
    b.box(0.98, 0.012, 0.98, k.ground);
    b.add(new THREE.CylinderGeometry(0.34, 0.5, 0.26, 7), "#b48a5e", { y: 0.13 });
    b.box(0.46, 0.3, 0.36, k.wall, { y: 0.26, z: -0.04 });
    crenels(b, 0.46, 0.36, 0.59, k.dark, 0.03);
    for (const [x, z] of [[-0.24, -0.2], [0.24, -0.2], [-0.24, 0.13], [0.24, 0.13]]) { b.box(0.12, 0.46, 0.12, k.dark, { x, y: 0.26, z }); crenels(b, 0.12, 0.12, 0.75, k.trim, 0.025); }
    beams(b, 0.46, 0.46, 0.14, 5);
    b.box(0.9, 0.16, 0.06, k.wall, { z: 0.42 });
    b.box(0.16, 0.13, 0.065, "#3b2a1c", { z: 0.42 });
    crenels(b, 0.9, 0.06, 0.17, k.dark, 0.025);
    b.box(0.12, 0.04, 0.02, C.light, { y: 0.4, z: 0.15 }, "lights");
    flag(b, 0.24, -0.2, 1.0);
  },
  kaf(b, k) { // Qasr Kaf: thick basalt blocks, a round-arched door, small square windows, a flat parapet
    b.box(0.98, 0.012, 0.6, k.ground);
    for (const x of [-0.33, 0.33]) {
      b.box(0.24, 0.66, 0.3, k.wall, { x });
      b.box(0.26, 0.04, 0.32, k.trim, { x, y: 0.66 });
      for (const y of [0.3, 0.48]) b.box(0.05, 0.05, 0.01, k.dark, { x, y, z: 0.155 });
      b.box(0.04, 0.04, 0.012, C.light, { x, y: 0.48, z: 0.156 }, "lights");
      for (let i = 0; i < 4; i++) b.box(0.25, 0.006, 0.305, k.dark, { x, y: 0.12 + i * 0.13 });
    }
    b.box(0.44, 0.5, 0.3, k.wall, { y: 0.08 });
    b.box(0.46, 0.04, 0.32, k.trim, { y: 0.58 });
    b.add(new THREE.CylinderGeometry(0.15, 0.15, 0.31, 16, 1, false, 0, Math.PI), "#1e1d1b", { y: 0.28, rx: Math.PI / 2, rz: Math.PI / 2, sz: 0.01 });
    b.box(0.3, 0.2, 0.31, "#1e1d1b", { y: 0.08, sz: 0.01 });
    b.add(new THREE.TorusGeometry(0.16, 0.018, 6, 16, Math.PI), k.trim, { y: 0.28, z: 0.152 });
    b.box(0.5, 0.08, 0.02, k.accent, { y: 0.46, z: 0.152 });
    for (const x of [-0.46, 0.46]) oliveTree(b, x, 0.24, 0.9);
  },
  rawda(b, k) { // the olive country: a white limestone arcade (three open arches), green trim, olive trees along it
    b.box(0.98, 0.012, 0.6, k.ground);
    b.box(0.86, 0.58, 0.22, k.wall, { y: 0.02 });
    for (let i = 0; i < 3; i++) { // each arch: a dark opening topped by a half circle, framed by a stone ring
      const x = -0.26 + i * 0.26;
      b.box(0.16, 0.26, 0.012, "#3a3a30", { x, y: 0.02, z: 0.111 });
      b.add(new THREE.CircleGeometry(0.08, 14, 0, Math.PI), "#3a3a30", { x, y: 0.28, z: 0.118 });
      b.add(new THREE.TorusGeometry(0.09, 0.014, 5, 14, Math.PI), k.dark, { x, y: 0.28, z: 0.115 });
      b.box(0.03, 0.03, 0.02, C.light, { x, y: 0.36, z: 0.12 }, "lights");
    }
    b.box(0.9, 0.04, 0.26, k.trim, { y: 0.6 });
    for (let i = 0; i < 9; i++) b.box(0.05, 0.05, 0.05, k.wall, { x: -0.4 + i * 0.1, y: 0.64, z: 0.1 });
    b.box(0.3, 0.06, 0.02, k.accent, { y: 0.48, z: 0.115 });
    for (const x of [-0.46, -0.3, 0.3, 0.46]) oliveTree(b, x, 0.22, 0.7);
  },
  nafud(b, k) { // the sands: two sand pillars and a black goat-hair tent stretched between them, Sadu bands
    b.box(0.98, 0.012, 0.98, k.ground);
    for (let i = 0; i < 5; i++) b.add(new THREE.SphereGeometry(0.16, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), "#e6c993", { x: -0.4 + i * 0.2, z: -0.38 + (i % 2) * 0.06, sy: 0.35 });
    for (const x of [-0.36, 0.36]) {
      b.box(0.16, 0.6, 0.16, k.wall, { x });
      b.box(0.18, 0.05, 0.18, k.dark, { x, y: 0.6 });
      b.cone(0.07, 0.12, k.dark, { x, y: 0.65 }, 4);
      saduBand(b, 0.16, 0.35, 0.085, 0.03, x);
      b.box(0.04, 0.04, 0.012, C.light, { x, y: 0.5, z: 0.086 }, "lights");
    }
    b.add(new THREE.PlaneGeometry(0.56, 0.36), k.trim, { y: 0.56, rx: -Math.PI / 2 + 0.25 });
    b.box(0.56, 0.02, 0.36, k.trim, { y: 0.5 });
    for (const x of [-0.18, 0, 0.18]) b.cyl(0.008, 0.008, 0.5, "#6b4426", { x, z: 0.12 }, 5);
    saduBand(b, 0.56, 0.48, 0.19, 0.04);
    for (let i = 0; i < 3; i++) b.cyl(0.04, 0.05, 0.03, ["#b3261e", "#2c8a7a", "#d4a53a"][i], { x: -0.12 + i * 0.12, z: -0.05 }, 8);
  }
};
/** The TV tower: the same tall shaft, dressed in the place's stone and crowned its own way. */
function styledTower(b, style) {
  const k = ST[style], h = 2.6;
  b.box(0.9, 0.015, 0.9, k.ground);
  if (style === "jandal" || style === "zabal") { b.box(0.62, 0.2, 0.62, k.wall); crenels(b, 0.62, 0.62, 0.22, k.dark, 0.035); }
  else if (style === "nafud") { b.cyl(0.36, 0.42, 0.14, k.wall, {}, 8); saduBand(b, 0.5, 0.06, 0.38); }
  else b.cyl(0.3, 0.36, 0.14, k.wall, {}, 8);
  b.add(new THREE.CylinderGeometry(0.11, 0.2, h, 8), style === "kaf" ? "#5a5753" : k.wall, { y: 0.12 + h / 2 });
  for (let i = 0; i < 12; i++) b.add(new THREE.CylinderGeometry(0.125 - i * 0.0072, 0.13 - i * 0.0072, 0.012, 8), k.glass, { y: 0.3 + i * 0.2 }, "shiny");
  const top = 0.12 + h * 0.78;
  b.add(new THREE.CylinderGeometry(0.22, 0.14, 0.14, 12), k.dark, { y: top });
  b.add(new THREE.CylinderGeometry(0.225, 0.225, 0.06, 12), k.glass, { y: top + 0.07 }, "shiny");
  b.add(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 12), C.light, { y: top + 0.075 }, "lights");
  if (style === "jandal") for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; b.box(0.04, 0.05, 0.04, k.dark, { x: Math.cos(a) * 0.2, y: top + 0.11, z: Math.sin(a) * 0.2 }); }
  if (style === "zabal") for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; b.cone(0.03, 0.06, k.trim, { x: Math.cos(a) * 0.2, y: top + 0.1, z: Math.sin(a) * 0.2, ry: a }); }
  if (style === "nafud") b.cone(0.24, 0.1, k.trim, { y: top + 0.1 }, 12);
  if (style === "rawda") b.dome(0.16, k.accent, { y: top + 0.1 }, "shiny");
  b.cone(0.06, 0.4, style === "kaf" ? k.accent : C.gold, { y: 0.12 + h }, 8, "shiny");
  b.box(0.03, 0.03, 0.03, "#ff3b30", { y: 0.12 + h + 0.4 }, "lights");
}
/** The skyline: the place's glass and stone, and its own crown on the tallest tower. */
function styledSkyline(b, style) {
  const k = ST[style];
  b.box(0.98, 0.015, 0.98, k.ground);
  const towers = [[-0.22, -0.2, 0.26, 2.6], [0.22, -0.18, 0.22, 2.0], [0.0, 0.24, 0.24, 1.5], [-0.3, 0.28, 0.14, 0.9], [0.32, 0.3, 0.14, 1.1]];
  towers.forEach(([x, z, w, h], i) => {
    b.box(w, h, w, i % 2 ? k.glass : k.wall === "#efe9dc" ? "#cfe0d2" : k.glass, { x, z }, "shiny");
    for (let f = 1; f < h / 0.12; f++) b.box(w + 0.004, 0.008, w + 0.004, style === "kaf" ? "#5a5753" : k.wall, { x, y: f * 0.12, z });
    for (let f = 1; f < h / 0.24; f += 2) b.box(w * 0.7, 0.03, w + 0.006, C.light, { x, y: f * 0.24 + 0.05, z }, "lights");
    b.box(w + 0.03, 0.12, w + 0.03, k.wall, { x, z }); // a stone base
  });
  const [x, z, w, h] = towers[0];
  if (style === "jandal" || style === "zabal") crenels(b, w, w, h, k.dark, 0.03);
  if (style === "nafud") { b.cone(w * 0.75, 0.2, k.trim, { x, y: h, z }, 4); saduBand(b, w, h - 0.15, z + w / 2 + 0.008, 0.03, x); }
  if (style === "rawda") b.dome(w * 0.45, k.accent, { x, y: h, z }, "shiny");
  if (style === "kaf") b.box(w * 0.5, 0.2, w * 0.5, k.accent, { x, y: h, z }, "shiny");
  b.cone(0.05, 0.5, k.dark, { x, y: h + (style === "nafud" ? 0.2 : 0.1), z }, 6, "shiny");
  b.box(0.02, 0.02, 0.02, "#ff3b30", { x, y: h + 0.62, z }, "lights");
  b.box(0.9, 0.06, 0.12, k.wall, { z: 0.45 });
}
/** The airport: the same runway and plane, the terminal in the place's style. */
function styledAirport(b, style) {
  const k = ST[style];
  b.box(0.98, 0.01, 0.98, k.ground);
  b.box(0.98, 0.012, 0.26, "#3d3f44", { z: 0.22 });
  for (let i = 0; i < 6; i++) b.box(0.08, 0.014, 0.015, "#f2f2f2", { x: -0.42 + i * 0.17, z: 0.22 });
  b.box(0.5, 0.14, 0.24, k.wall, { x: -0.18, z: -0.26 });
  b.box(0.5, 0.06, 0.02, C.glass, { x: -0.18, y: 0.05, z: -0.139 }, "shiny");
  b.box(0.46, 0.04, 0.022, C.light, { x: -0.18, y: 0.06, z: -0.138 }, "lights");
  if (style === "jandal") for (const x of [-0.43, 0.07]) { b.cyl(0.05, 0.06, 0.2, k.dark, { x, z: -0.26 }, 10); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; b.box(0.02, 0.025, 0.02, k.trim, { x: x + Math.cos(a) * 0.045, y: 0.2, z: -0.26 + Math.sin(a) * 0.045 }); } }
  if (style === "zabal") crenels(b, 0.5, 0.24, 0.15, k.dark, 0.022);
  if (style === "kaf") for (let i = 0; i < 4; i++) b.add(new THREE.TorusGeometry(0.04, 0.008, 5, 10, Math.PI), k.trim, { x: -0.36 + i * 0.12, y: 0.09, z: -0.137 });
  if (style === "rawda") { b.box(0.54, 0.02, 0.3, k.accent, { x: -0.18, y: 0.14, z: -0.26 }); for (const x of [-0.46, 0.1]) oliveTree(b, x, -0.05, 0.5); }
  if (style === "nafud") for (let i = 0; i < 4; i++) b.cone(0.07, 0.1, "#f6f2e8", { x: -0.36 + i * 0.12, y: 0.14, z: -0.26 }, 4, "shiny");
  b.cyl(0.035, 0.05, 0.42, k.wall, { x: 0.3, z: -0.3 }, 8);
  b.cyl(0.08, 0.06, 0.08, C.glass, { x: 0.3, y: 0.42, z: -0.3 }, 8, "shiny");
  b.cyl(0.085, 0.085, 0.02, k.dark, { x: 0.3, y: 0.5, z: -0.3 }, 8);
  b.add(new THREE.CylinderGeometry(0.025, 0.02, 0.36, 8), "#f6f6f6", { x: 0.05, y: 0.05, z: 0.22, rz: Math.PI / 2 }, "shiny");
  b.add(new THREE.ConeGeometry(0.025, 0.06, 8), "#f6f6f6", { x: 0.26, y: 0.05, z: 0.22, rz: -Math.PI / 2 }, "shiny");
  b.box(0.08, 0.008, 0.34, "#f6f6f6", { x: 0.06, y: 0.045, z: 0.22 }, "shiny");
  b.box(0.05, 0.07, 0.008, "#2c8a7a", { x: -0.11, y: 0.05, z: 0.22 });
  b.box(0.04, 0.006, 0.12, "#f6f6f6", { x: -0.11, y: 0.08, z: 0.22 }, "shiny");
}
for (const style of Object.keys(ST)) {
  MAKERS[`gate_${style}`] = (b) => GATES[style](b, ST[style]);
  MAKERS[`tower_${style}`] = (b) => styledTower(b, style);
  MAKERS[`skyline_${style}`] = (b) => styledSkyline(b, style);
  MAKERS[`airport_${style}`] = (b) => styledAirport(b, style);
}
export function modelKey(id, lvl) {
  if (landStyle && STYLED.includes(id)) return `${id}_${landStyle}`;
  if (id === "vault") return lvl >= 3 ? "vault2" : lvl >= 1 ? "vault1" : "vault";
  if (id === "house") return lvl === 0 ? "tent0" : `house${lvl}`;
  if (lvl > 0 && BIZ.includes(id)) return `${id}${lvl}`;
  if (lvl > 0 && MIL_MODELS.includes(id)) return `${id}${Math.min(2, lvl)}`;
  return id;
}

export const COLORS = C;
