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

function car(b, x, z, ry, color) {
  b.box(0.2, 0.06, 0.1, color, { x, y: 0.03, z, ry });
  b.box(0.11, 0.05, 0.09, C.glass, { x: x - Math.cos(ry) * 0.01, y: 0.09, z: z + Math.sin(ry) * 0.01, ry }, "shiny");
}

// ---------- the buildings ----------

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

  rock(b, ground, seed = 1) {
    const r = (k) => ((Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
    for (let i = 0; i < 3; i++) b.add(new THREE.DodecahedronGeometry(0.1 + r(i) * 0.1, 0), i % 2 ? "#a99a85" : "#beae96", { x: (r(i + 3) - 0.5) * 0.5, y: 0.05, z: (r(i + 6) - 0.5) * 0.5, sy: 0.6 + r(i + 9) * 0.4, ry: r(i) * 3 });
  }
};

const cache = new Map();

/** The model for a building (key like "house3", "mosque", "rock"); built once, then reused. */
export function model(key, ground = "sand") {
  const k = key === "palms" ? `palms:${ground}` : key;
  if (!cache.has(k)) {
    const b = new Builder();
    const maker = MAKERS[key];
    if (!maker) return null;
    maker(b, ground);
    cache.set(k, b.done());
  }
  return cache.get(k);
}

export function modelKey(id, lvl) {
  if (id === "house") return lvl === 0 ? "tent0" : `house${lvl}`;
  return id;
}

export const COLORS = C;
