// Every building as a low-poly 3D model, built from simple shapes in the style of the region:
// goat-hair tents, Najdi mud houses with crenellations, water towers, a Najdi mosque, palms.
// Each model is merged into at most three geometries (matte, shiny, night lights) for fast drawing.
import * as THREE from "three";

const C = {
  sand: "#e8cf9a", mud: "#c9935a", mudDark: "#a9744a", mudLight: "#d8a96e", plaster: "#efe3cc", white: "#f5f2ea",
  stone: "#d9c3a0", wood: "#6b4426", door: "#5a3a22", green: "#2f7d5b", teal: "#2c8a7a", glass: "#4f7f99",
  red: "#b3261e", black: "#2a221d", gold: "#d4a53a", grey: "#8e959a", dark: "#3b3f44", grass: "#79b35a",
  soil: "#8a6a43", leaf: "#3f8a3c", leafDark: "#2f6f31", trunk: "#7a5530", cream: "#f1e4c8", blue: "#2f5f9e",
  light: "#ffd27a", water: "#4f9fc0", orange: "#d9822b"
};

const tmp = new THREE.Object3D();

/** Collects coloured parts and merges them into one geometry per material. */
class Builder {
  constructor() { this.sets = { matte: [], shiny: [], lights: [] }; }
  add(geo, color, o = {}, set = "matte") {
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
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "color"].includes(k)) g.deleteAttribute(k);
    this.sets[set].push(g);
    return this;
  }
  box(w, h, d, color, o = {}, set) { return this.add(new THREE.BoxGeometry(w, h, d), color, { ...o, y: (o.y || 0) + h / 2 }, set); }
  cyl(rt, rb, h, color, o = {}, seg = 10, set) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, { ...o, y: (o.y || 0) + h / 2 }, set); }
  dome(r, color, o = {}, set) { return this.add(new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), color, o, set); }
  cone(r, h, color, o = {}, seg = 4, set) { return this.add(new THREE.ConeGeometry(r, h, seg), color, { ...o, y: (o.y || 0) + h / 2 }, set); }
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
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  m.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  m.setAttribute("color", new THREE.BufferAttribute(col, 3));
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

export function palm(b, x, z, s = 1, lean = 0) {
  const segs = 6, h = 0.62 * s;
  for (let i = 0; i < segs; i++) {
    const t = i / segs, r = 0.03 * s * (1 - t * 0.35);
    b.cyl(r * 0.92, r, h / segs + 0.01, i % 2 ? C.trunk : "#6b4a2b", { x: x + lean * t * t * 0.2, y: t * h, z }, 6);
  }
  const top = { x: x + lean * 0.2, y: h, z };
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2, droop = 0.55 + (i % 3) * 0.12;
    b.add(new THREE.BoxGeometry(0.34 * s, 0.012, 0.07 * s), i % 2 ? C.leaf : C.leafDark,
      { x: top.x + Math.cos(a) * 0.15 * s, y: top.y - 0.04 * s, z: top.z + Math.sin(a) * 0.15 * s, ry: -a, rz: -droop });
  }
  for (let i = 0; i < 3; i++) b.add(new THREE.SphereGeometry(0.035 * s, 5, 4), C.orange, { x: top.x + Math.cos(i * 2.1) * 0.05 * s, y: top.y - 0.06 * s, z: top.z + Math.sin(i * 2.1) * 0.05 * s });
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
  b.add(new THREE.SphereGeometry(0.019, 8, 6), "#b98a63", { y: 0.132 });
  b.add(new THREE.SphereGeometry(0.023, 8, 6, 0, Math.PI * 2, 0, Math.PI / 1.7), cloth, { x: -0.003, y: 0.136 });
  b.add(new THREE.BoxGeometry(0.008, 0.05, 0.05), cloth, { x: -0.019, y: 0.115 });                 // falls down the back
  for (const z of [0.021, -0.021]) b.add(new THREE.BoxGeometry(0.02, 0.04, 0.005), cloth, { x: 0.001, y: 0.118, z });
  b.add(new THREE.TorusGeometry(0.018, 0.0045, 4, 12), "#111", { y: 0.15, rx: Math.PI / 2 });
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
  house3(b) {
    wallAround(b, 0.96, 0.17, C.cream);
    b.box(0.6, 0.56, 0.48, C.white, { x: -0.04, z: -0.12 });
    b.box(0.32, 0.36, 0.3, C.white, { x: 0.24, z: -0.02 });
    b.box(0.62, 0.04, 0.5, C.stone, { x: -0.04, y: 0.56, z: -0.12 });
    b.box(0.34, 0.04, 0.32, C.stone, { x: 0.24, y: 0.36, z: -0.02 });
    crenels(b, 0.6, 0.48, 0.6, C.stone, 0.035);
    windowsRow(b, 0.6, 0.18, 0.125, 2, 0.12);
    windowsRow(b, 0.6, 0.42, 0.125, 3, 0.1);
    nightWindows(b, 0.6, 0.42, 0.126, 3, 0.09);
    b.box(0.12, 0.2, 0.02, C.wood, { x: 0.24, z: 0.135 });
    palm(b, -0.36, 0.3, 0.75);
    car(b, 0.22, 0.32, 0, "#e6e6e6");
    b.box(0.94, 0.006, 0.94, "#ded4bf");
    b.box(0.3, 0.008, 0.2, C.grass, { x: -0.25, z: 0.3 });
    acUnit(b, -0.3, 0.6, -0.25); acUnit(b, -0.15, 0.6, -0.25); dish(b, 0.1, 0.6, -0.3);
    for (const x of [-0.16, 0.16]) { b.box(0.04, 0.22, 0.04, C.stone, { x: x * 0.95 + 0.22 - 0.22, z: 0.48 }); b.box(0.03, 0.03, 0.03, C.light, { x: x * 0.95, y: 0.22, z: 0.48 }, "lights"); }
    b.box(0.22, 0.012, 0.18, C.wood, { x: 0.24, y: 0.36, z: 0.1 });
  },
  // عمارة: a tall block with glass bands and roof tanks.
  house4(b) {
    const h = 1.6;
    b.box(0.78, h, 0.7, C.cream);
    for (let f = 0; f < 7; f++) {
      const y = 0.12 + f * 0.21;
      b.box(0.8, 0.02, 0.72, C.stone, { y: y - 0.04 });
      windowsRow(b, 0.78, y + 0.03, 0.352, 4, 0.1);
      b.box(0.022, 0.1, 0.5, C.glass, { x: 0.392, y: y + 0.03 }, "shiny");
      if (f % 2) nightWindows(b, 0.78, y + 0.03, 0.354, 4, 0.08);
    }
    b.box(0.82, 0.04, 0.74, C.stone, { y: h });
    for (const x of [-0.2, 0.1]) b.cyl(0.06, 0.06, 0.1, C.white, { x, y: h + 0.04, z: -0.15 }, 10);
    b.box(0.2, 0.14, 0.03, C.glass, { y: 0, z: 0.355 }, "shiny");
    for (let f = 1; f < 7; f++) for (const x of [-0.24, 0.24]) { b.box(0.22, 0.012, 0.08, C.stone, { x, y: 0.08 + f * 0.21, z: 0.39 }); b.box(0.22, 0.05, 0.008, "#d6d1c6", { x, y: 0.09 + f * 0.21, z: 0.43 }); }
    b.box(0.36, 0.02, 0.16, C.stone, { y: 0.2, z: 0.43 });
    dish(b, 0.25, h + 0.04, 0.2); acUnit(b, -0.3, h + 0.04, 0.2); acUnit(b, 0.3, h + 0.04, -0.25);
    b.box(0.94, 0.006, 0.94, "#d6cfc0");
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
    b.cyl(0.027, 0.036, 0.1, C.white, {}, 8);                       // thobe, flaring to the ankles
    b.add(new THREE.SphereGeometry(0.03, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), C.white, { y: 0.098, sy: 0.55 }); // shoulders
    for (const z of [-0.031, 0.031]) b.add(new THREE.CylinderGeometry(0.009, 0.011, 0.065, 5), C.white, { x: 0.002, y: 0.066, z, rx: z > 0 ? -0.12 : 0.12 }); // arms
  },
  manHeadRed(b) { head(b, "#c8323a"); },
  manHeadWhite(b) { head(b, "#f6f4ee"); },
  woman(b) {
    const abaya = "#17151a";
    b.cyl(0.026, 0.04, 0.105, abaya, {}, 8);
    b.add(new THREE.SphereGeometry(0.03, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), abaya, { y: 0.1, sy: 0.55 });
    for (const z of [-0.03, 0.03]) b.add(new THREE.CylinderGeometry(0.009, 0.012, 0.065, 5), abaya, { y: 0.067, z });
    b.add(new THREE.SphereGeometry(0.021, 8, 6), abaya, { y: 0.135 });
    b.add(new THREE.SphereGeometry(0.011, 6, 4), "#c99a72", { x: 0.016, y: 0.137, sx: 0.5 });  // face
    b.add(new THREE.ConeGeometry(0.026, 0.05, 8), abaya, { y: 0.14, rx: Math.PI, sy: 0.6 });      // shayla falling to the shoulders
    b.box(0.018, 0.02, 0.008, "#a3542e", { x: -0.004, y: 0.05, z: 0.043 });                        // a handbag
  },
  // ---- the pickup (جيب حوض): body takes the per-car colour; trim keeps its own ----
  pickupBody(b) {
    b.box(0.27, 0.045, 0.12, C.white, { y: 0.022 });                          // chassis and sides
    b.box(0.07, 0.022, 0.118, C.white, { x: 0.1, y: 0.066 });                 // bonnet
    b.box(0.095, 0.058, 0.116, C.white, { x: 0.02, y: 0.066 });               // cab
    b.box(0.1, 0.03, 0.008, C.white, { x: -0.083, y: 0.066, z: 0.056 });       // bed sides
    b.box(0.1, 0.03, 0.008, C.white, { x: -0.083, y: 0.066, z: -0.056 });
    b.box(0.008, 0.03, 0.12, C.white, { x: -0.131, y: 0.066 });                // tailgate
  },
  pickupTrim(b) {
    for (const [x, z] of [[0.085, 0.058], [0.085, -0.058], [-0.08, 0.058], [-0.08, -0.058]]) {
      b.cyl(0.026, 0.026, 0.022, "#1d1d1f", { x, y: 0.026 - 0.011, z, rx: Math.PI / 2 }, 10);
      b.cyl(0.012, 0.012, 0.024, "#b9bcc0", { x, y: 0.026 - 0.012, z, rx: Math.PI / 2 }, 8);
    }
    b.add(new THREE.BoxGeometry(0.004, 0.042, 0.104), "#2a3b47", { x: 0.069, y: 0.098, rz: 0.35 }, "shiny");   // windscreen
    for (const z of [0.0585, -0.0585]) b.box(0.06, 0.03, 0.003, "#2a3b47", { x: 0.02, y: 0.078, z }, "shiny"); // side windows
    b.box(0.004, 0.028, 0.1, "#2a3b47", { x: -0.028, y: 0.078 }, "shiny");                                       // back window
    b.box(0.098, 0.004, 0.104, "#3a3632", { x: -0.083, y: 0.046 });                                              // bed floor
    b.box(0.006, 0.02, 0.07, "#2b2b2e", { x: 0.136, y: 0.03 });                                                 // grille
    for (const z of [0.045, -0.045]) { b.box(0.004, 0.012, 0.02, "#fff6d8", { x: 0.137, y: 0.034, z }, "lights"); b.box(0.004, 0.014, 0.012, "#d23a2a", { x: -0.136, y: 0.06, z }); }
    b.box(0.006, 0.012, 0.124, "#9a9da1", { x: 0.138, y: 0.012 });                                              // bumpers
    b.box(0.006, 0.012, 0.124, "#9a9da1", { x: -0.137, y: 0.012 });
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
  house3: [{ [C.white]: "#efe4cc", [C.stone]: "#b89b72", [C.cream]: "#e6d6b6" }, { [C.white]: "#f3efe9", [C.stone]: "#8e959a" }],
  house4: [{ [C.cream]: "#e2d6c4", [C.stone]: "#b9a888" }, { [C.cream]: "#d9ccb2", [C.stone]: "#9aa1a6" }]
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
      cache.set(k, { matte: recolor(src.matte, swaps), shiny: recolor(src.shiny, swaps), lights: src.lights });
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
const BIZ = ["palms", "veg", "grocery", "cafe", "souq", "mandi", "workshop", "pen"];
function bizExtras(b, id, lvl) {
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
for (const id of BIZ) for (const lvl of [1, 2]) MAKERS[`${id}${lvl}`] = (b, ground, seed) => { MAKERS[id](b, ground, seed); bizExtras(b, id, lvl); };

export function modelKey(id, lvl) {
  if (id === "house") return lvl === 0 ? "tent0" : `house${lvl}`;
  if (lvl > 0 && BIZ.includes(id)) return `${id}${lvl}`;
  return id;
}

export const COLORS = C;
