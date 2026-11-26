// Every building as a low-poly 3D model, built from simple shapes in the style of the region:
// goat-hair tents, Najdi mud houses with crenellations, water towers, a Najdi mosque, palms.
// Each model is merged into at most three geometries (matte, shiny, night lights) for fast drawing.
import * as THREE from "three";
import { ISLAND_RADIUS } from "./traffic-path.js";
import { BUILDING_SURFACES } from "./building-surfaces.js";
import { CENTRAL_VAULT_LEVEL, GREATER_CITY_UPGRADES } from "./data.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const C = {
  sand: "#ddba86", mud: "#c27e4f", mudDark: "#94573f", mudLight: "#de9e64", plaster: "#f0dfbd", white: "#f7ebd5",
  stone: "#d2ae80", wood: "#654026", door: "#533622", green: "#286750", teal: "#217d77", glass: "#4f7f99",
  red: "#a12e35", black: "#28232a", gold: "#d5a54e", grey: "#879092", dark: "#333a3d", grass: "#568d5a",
  soil: "#826448", leaf: "#3a7756", leafDark: "#22523f", trunk: "#764f35", cream: "#f1e4c8", blue: "#2f5f9e",
  light: "#ffd27a", water: "#2b9c9a", orange: "#d98239"
};

const tmp = new THREE.Object3D();
/** The window and panel colours of the older models: drawn as real glass. */
const GLASS = new Set(["#4f7f99", "#2d3a46", "#26415e", "#1d3b55", "#1f3f6b", "#2a3a46", "#22303a"]);
/**
 * The material sets a model is split into (one draw each): matte and shiny as before, lights that glow at
 * night, and for the newer, more realistic models: paint (semi-gloss painted metal with a fine normal map),
 * metal (bare steel), glass (dark tinted) and glow (lamps and screens bright enough to bloom).
 */
export const SETS = ["matte", "shiny", "lights", "paint", "metal", "glass", "glow", ...BUILDING_SURFACES];
export const POLE_INSULATORS = [-0.18, 0, 0.18];
export const POLE_WIRE_HEIGHT = 0.955;

/** Collects coloured parts and merges them into one geometry per material. */
class Builder {
  /** The far mesh keeps the assembled building and reduces tessellation on its curved parts. */
  constructor(far = false) { this.sets = Object.fromEntries(SETS.map((k) => [k, []])); this.far = far; }
  add(geo, color, o = {}, set = "matte") {
    if ((set === "matte" || set === "shiny") && GLASS.has(String(color).toLowerCase())) set = "glass"; // windows and solar panels reflect the sky
    if (this.far) geo = farGeo(geo);
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
    if (BUILDING_SURFACES.includes(set)) {
      const projected = new Float32Array(n*2), position = g.attributes.position, normal = g.attributes.normal;
      for (let i=0;i<n;i++) {
        const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
        const side = Math.abs(normal.getX(i)) > Math.abs(normal.getZ(i));
        const top = Math.abs(normal.getY(i)) > .66;
        projected[2*i] = (side && !top ? z : x)*1.13;
        projected[2*i+1] = (top ? z : y)*1.67;
      }
      g.setAttribute("uv",new THREE.BufferAttribute(projected,2));
    }
    const wind = new Float32Array(n);
    if (o.wind) for (let i = 0; i < n; i++) wind[i] = o.wind * Math.max(0, g.attributes.position.getY(i));
    g.setAttribute("leafWind", new THREE.BufferAttribute(wind, 1));
    this.sets[set].push(g);
    return this;
  }
  box(w, h, d, color, o = {}, set) {
    // walls and big blocks get softly rounded edges that catch the light (small parts stay plain boxes: cheaper)
    const lo = Math.min(w, h, d), hi = Math.max(w, h, d);
    const mid = w + h + d - lo - hi;
    if (lo <= 0.006 && mid >= 0.012) { // a pane, never a rod (a rod must stay round from every side)
      // a pane (a window, a lit room, a glass rail): only its two faces can be seen, so it is two faces
      // (4 triangles) instead of a box (12). Thousands of them in a big town: the same look, a third of the work.
      const c = { ...o, y: (o.y || 0) + h / 2 };
      const face = (geoW, geoH, turn, at) => { const g = new THREE.PlaneGeometry(geoW, geoH); turn(g); g.translate(...at); return g; };
      const pair = d === lo ? [face(w, h, () => {}, [0, 0, d / 2]), face(w, h, (g) => g.rotateY(Math.PI), [0, 0, -d / 2])]
        : w === lo ? [face(d, h, (g) => g.rotateY(Math.PI / 2), [w / 2, 0, 0]), face(d, h, (g) => g.rotateY(-Math.PI / 2), [-w / 2, 0, 0])]
          : [face(w, d, (g) => g.rotateX(-Math.PI / 2), [0, h / 2, 0]), face(w, d, (g) => g.rotateX(Math.PI / 2), [0, -h / 2, 0])];
      for (const g of pair) this.add(g, color, c, set);
      return this;
    }
    const geo =!this.far && lo >= 0.1 && hi >= 0.22 ? new RoundedBoxGeometry(w, h, d, 1, Math.min(0.016, lo / 6)) : new THREE.BoxGeometry(w, h, d);
    return this.add(geo, color, { ...o, y: (o.y || 0) + h / 2 }, set);
  }
  cyl(rt, rb, h, color, o = {}, seg = 10, set) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, { ...o, y: (o.y || 0) + h / 2 }, set); }
  dome(r, color, o = {}, set) { return this.add(new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), color, o, set); }
  cone(r, h, color, o = {}, seg = 4, set) { return this.add(new THREE.ConeGeometry(r, h, seg), color, { ...o, y: (o.y || 0) + h / 2 }, set); }
  /** A box with rounded edges (catches the light like real panels). */
  rbox(w, h, d, r, color, o = {}, set = "paint") {
    const radius = Math.min(r, w / 2, h / 2, d / 2);
    const geo = this.far || radius < 0.004 ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, 1, radius);
    return this.add(geo, color, { ...o, y: (o.y || 0) + h / 2 }, set);
  }
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

/** Reduce subdivision while keeping trim, glazing and the full roofline from above. */
function farGeo(geo) {
  const p = geo.parameters || {}, half = (n, min) => Math.min(n, Math.max(min, Math.ceil(n / 2)));
  let g = null;
  switch (geo.type) {
    case "CylinderGeometry": g = new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, half(p.radialSegments, 5), p.heightSegments, p.openEnded, p.thetaStart, p.thetaLength); break;
    case "ConeGeometry": g = new THREE.ConeGeometry(p.radius, p.height, half(p.radialSegments, 4), 1, p.openEnded, p.thetaStart, p.thetaLength); break;
    case "SphereGeometry": g = new THREE.SphereGeometry(p.radius, half(p.widthSegments, 5), half(p.heightSegments, 3), p.phiStart, p.phiLength, p.thetaStart, p.thetaLength); break;
    case "TorusGeometry": g = new THREE.TorusGeometry(p.radius, p.tube, half(p.radialSegments, 3), half(p.tubularSegments, 6), p.arc); break;
    case "CircleGeometry": g = new THREE.CircleGeometry(p.radius, half(p.segments, 6), p.thetaStart, p.thetaLength); break;
    case "LatheGeometry": g = new THREE.LatheGeometry(p.points, half(p.segments, 6), p.phiStart, p.phiLength); break;
  }
  if (g) { geo.dispose(); return g; }
  return geo;
}

function merge(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), wind = new Float32Array(n);
  const withUv = list.every((g) => g.attributes.uv), uv = withUv ? new Float32Array(n * 2) : null;
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    wind.set(g.attributes.leafWind.array, o);
    if (uv) uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
    g.dispose();
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  m.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  m.setAttribute("color", new THREE.BufferAttribute(col, 3));
  m.setAttribute("leafWind", new THREE.BufferAttribute(wind, 1));
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
  const h = 0.68 * s, lx = lean * 0.2;
  b.cyl(0.023 * s, 0.043 * s, h, C.trunk, { x: x + lx / 2, z, rz: -Math.atan2(lx, h) }, 7);
  for (let i = 1; i <= 6; i++) {
    const t = i / 7, r = (0.043 - t * 0.019) * s;
    b.cyl(r, r * 1.05, 0.018 * s, i % 2 ? "#a46a47" : "#513823", { x: x + lx * t, y: h * t, z }, 7);
  }
  const crown = { x: x + lx, y: h, z };
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI * 0.2 + (i % 2) * 0.11;
    const run = (i % 3 === 0 ? 0.32 : 0.45) * s, rise = (i % 3 === 0 ? 0.27 : 0.15) * s;
    const points = (t, side = 0) => {
      const w = Math.sin(t * Math.PI) ** 0.7 * 0.067 * s * side;
      return [t * run, Math.sin(t * Math.PI * 0.95) * rise - t * t * 0.13 * s - Math.abs(w) * 0.42, w];
    };
    for (const side of [-1, 1]) {
      const verts = [];
      for (let k = 0; k < 5; k++) {
        const t = k / 5, u = (k + 1) / 5;
        const middle = points(t), next = points(u);
        const tip = points(Math.min(1, u + 0.07), side), edge = points(t, side * 0.47);
        const tris = [[middle, edge, tip], [middle, tip, next]];
        for (const triangle of tris) {
          const vertices = side > 0 ? triangle : [...triangle].reverse();
          verts.push(...vertices.flat(), ...[...vertices].reverse().flat());
        }
      }
      const leaf = new THREE.BufferGeometry();
      leaf.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      const uv = [];
      for (let j = 0; j < verts.length; j += 3) uv.push(verts[j] / run, verts[j + 2] / s * 5 + 0.5);
      leaf.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      leaf.computeVertexNormals();
      b.add(leaf, side < 0 ? ["#427e4f", "#5a914d", "#287152"][i % 3] : ["#2c6048", "#407848", "#357452"][i % 3], { ...crown, ry: a, wind: 1 });
      leaf.dispose();
    }
  }
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3;
    b.add(new THREE.DodecahedronGeometry(0.031 * s, 0), i === 1 ? "#aa6436" : "#d18f46", { x: crown.x + Math.cos(a) * 0.045 * s, y: h - 0.029 * s, z: z + Math.sin(a) * 0.045 * s, sy: 1.35 });
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

/** Tapered cloth, exposed hands and simplified facial planes for the 3D townspeople. */
function head(b, cloth) {
  const skin = "#bd906f";
  b.add(new THREE.SphereGeometry(.020,10,7),skin,{x:.006,y:.149,sx:1.13,sy:1.23,sz:.89});
  b.add(new THREE.SphereGeometry(.005,6,5),skin,{x:.029,y:.148,sx:1.28});
  b.add(new THREE.SphereGeometry(.023,10,6,0,Math.PI*2,0,Math.PI*.52),cloth,{x:-.002,y:.151,sy:1.08,sz:.96});
  b.box(.017,.054,.042,cloth,{x:-.017,y:.114,rz:-.12,wind:.14});
  for(const side of [-1,1]) {
    b.box(.030,.048,.005,cloth,{x:-.004,y:.117,z:side*.018,rx:side*.19,wind:.16});
    b.box(.007,.006,.004,"#49352c",{x:.019,y:.151,z:side*.016});
    if(cloth === "#a84046") for(let i=0;i<3;i++) b.box(.020,.0038,.005,"#e6ccba",{x:-.006,y:.123+i*.008,z:side*.021,rz:side*.45});
  }
  b.add(new THREE.TorusGeometry(.018,.0033,4,11), "#272528", { y:.172,rx:Math.PI/2 });
}

function robe(b, color, sleeves) {
  b.lathe([[.024,0],[.031,.012],[.023,.061],[.027,.105],[.025,.124],[.013,.133]],color,{sx:.75,sz:1.13},9,"matte");
  b.add(new THREE.SphereGeometry(.026,9,5,0,Math.PI*2,0,Math.PI/2),color,{y:.110,sx:.72,sy:.68,sz:1.14});
  b.box(.004,.079,.012,"#d4cbba",{x:.018,y:.044});
  if(sleeves) for(const side of [-1,1]) b.cyl(.009,.010,.071,color,{x:.004,y:.047,z:side*.031,rx:-side*.14},6);
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
  const g = new Builder(b.far);
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

/** Smooth bodywork from hand-shaped cross sections: x, bottom, shoulder, roof, half-width. */
function vehicleShell(b, bands, color, set) {
  const positions = [], uv = [];
  const section = ([x, floor, shoulder, top, w]) => [
    [x,floor,-w*.78],[x,shoulder,-w],[x,top,-w*.75],[x,top,w*.75],[x,shoulder,w],[x,floor,w*.78],
  ];
  const loft = bands.map(section);
  const tri = (a, c, d) => {
    positions.push(...a,...d,...c);
    for (const p of [a,d,c]) uv.push(p[0]*3+0.5,p[1]*6);
  };
  for (let i=1;i<loft.length;i++) for (let j=0;j<6;j++) {
    const k=(j+1)%6, a=loft[i-1][j], c=loft[i-1][k], d=loft[i][k], e=loft[i][j];
    tri(a,d,c); tri(a,e,d);
  }
  for (let j=1;j<5;j++) { tri(loft[0][0], loft[0][j], loft[0][j+1]); const end=loft.at(-1); tri(end[0],end[j+1],end[j]); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  g.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  g.computeVertexNormals();
  b.add(g,color,{},set);
  g.dispose();
}

function vehiclePane(b, points, dark = "#263b44") {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute([...points[0],...points[1],...points[2],...points[0],...points[2],...points[3],...points[0],...points[2],...points[1],...points[0],...points[3],...points[2]],3));
  g.setAttribute("uv",new THREE.Float32BufferAttribute([0,0,1,0,1,1,0,0,1,1,0,1,0,0,1,1,1,0,0,0,0,1,1,1],2));
  g.computeVertexNormals();
  b.add(g,dark,{},"glass");
  g.dispose();
}

function passengerCar(b, suv, trim) {
  const front = suv ? .057 : .069, back = suv ? -.126 : -.104;
  const roof = suv ? .149 : .121, sill = suv ? .087 : .068, topBack = suv ? -.111 : -.059;
  if (!trim) {
    vehicleShell(b, [[-.157,.035,.062,.075,.043],[-.136,.027,.07,.081,.065],[-.088,.026,.071,.079,.067],[.062,.025,.068,.078,.065],[.117,.025,.064,.072,.064],[.152,.032,.057,.064,.048]], "#fffefd", "matte");
    vehicleShell(b, [[back,sill-.006,sill+.009,sill+.02,.051],[topBack,sill-.008,roof-.013,roof,.055],[front-.041,sill-.008,roof-.011,roof,.053],[front,sill-.008,sill+.009,sill+.012,.051]], "#fffefd", "matte");
    return;
  }
  vehiclePane(b, [[front+.002,sill+.013,-.043],[front+.002,sill+.013,.043],[front-.04,roof-.007,.034],[front-.04,roof-.007,-.034]]);
  vehiclePane(b, [[back-.001,sill+.011,.045],[back-.001,sill+.011,-.045],[topBack-.003,roof-.009,-.035],[topBack-.003,roof-.009,.035]]);
  for (const side of [-1,1]) {
    const z=(n)=>side*n;
    vehiclePane(b, [[back+.006,sill+.009,z(.054)],[front-.007,sill+.009,z(.054)],[front-.04,roof-.011,z(.043)],[topBack+.005,roof-.011,z(.046)]]);
    b.box(.008, roof-sill-.013,.008,"#353b40",{x:-.027,y:sill+.005,z:z(.049)});
    b.box(.018,.007,.007,"#adb0a7",{x:.004,y:sill-.01,z:z(.065)});
    b.rbox(.019,.012,.016,.004,"#333a3a",{x:.046,y:sill+.016,z:z(.068)},"matte");
    if (suv) b.box(.115,.009,.008,"#41494d",{x:-.043,y:roof,z:z(.039)});
    b.box(.008,.010,.023,"#fff5dd",{x:.148,y:.051,z:z(.043)},"glow");
    b.box(.008,.012,.023,"#b3323c",{x:-.154,y:.058,z:z(.042)},"glow");
  }
  b.box(.013,.018,.071,"#373d41",{x:.149,y:.035});
  b.box(.014,.003,.057,"#a0a7a6",{x:.155,y:.049},"metal");
  b.box(.009,.011,.034,"#d9d6c8",{x:-.157,y:.037});
  b.box(.01,.012,.093,"#6e7978",{x:-.149,y:.025},"metal");
}

/** A parked car (the new sedan or SUV, js/models.js passengerCar) at x, z, turned ry, painted color. */
function parkedCar(b, x, z, ry, suv, color) {
  const tmp = new Builder(b.far);
  passengerCar(tmp, suv, false); passengerCar(tmp, suv, true);
  const parts = tmp.done(), m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0.012, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1));
  const paint = new THREE.Color(color), white = new THREE.Color("#fffefd"), c = new THREE.Color();
  for (const [set, g] of Object.entries(parts)) {
    if (!g) continue;
    g.applyMatrix4(m);
    const col = g.attributes.color;
    for (let i = 0; i < col.count; i++) { c.fromBufferAttribute(col, i); if (Math.abs(c.r - white.r) + Math.abs(c.g - white.g) + Math.abs(c.b - white.b) < 0.02) col.setXYZ(i, paint.r, paint.g, paint.b); }
    if (!g.attributes.uv && b.sets[set].length && b.sets[set][0].attributes.uv) g.deleteAttribute("uv");
    b.sets[set].push(g);
  }
}

function adobeDoor(b,x,y,z,w,h,paint) {
  b.box(w+.035,h+.033,.031,"#e3c6a2",{x,y:y-.012,z:z-.002});
  b.box(w,h,.017,"#392e28",{x,y,z:z+.015},"wood");
  for(let i=0;i<5;i++) b.box(w*.186,h*.89,.008,i%2?paint:"#81604a",{x:x+(i-2)*w*.191,y:y+.008,z:z+.026},"wood");
  b.box(w*.85,.012,.012,"#bf8651",{x,y:y+h*.68,z:z+.033});
  b.box(w*.85,.012,.012,"#bf8651",{x,y:y+h*.28,z:z+.033});
  b.box(.012,.015,.016,"#c7aa6a",{x:x+w*.32,y:y+h*.43,z:z+.034});
}

function adobeWall(b,w,h,d,x,z,shade) {
  const g = new THREE.CylinderGeometry(.67,.707,h,4,1,false,Math.PI/4);
  b.add(g,shade,{x,y:h/2,z,sx:w,sz:d},"plaster");
  g.dispose();
  for(let row=0;row<4;row++) {
    const y=.034 + row * h/7;
    const edge=z + d*(.50-y/h*.024);
    for(let j=0;j<5;j++) {
      const xx=x+w*((j-2)*.181 + (row%2-.5)*.07);
      b.box(w*.154,.022,.009,row%2?"#ad7652":"#b1815e",{x:xx,y,z:edge});
    }
  }
}

/** Set the glass behind raised jambs and provide a separate deep sill and interior light. */
// Smooth panels and tinted architectural glazing, kept in the shared geometry batches.
const CITY = { pearl: "#eee9df", silver: "#c8cfca", graphite: "#4a575a", glass: "#618999", bronze: "#b29872", deck: "#c1beb2" };

function glassWall(b, x, z, y, width, height, bays, tint = CITY.glass) {
  b.box(width,height,.022,tint,{x,z,y},"glass");
  const bay = width/bays;
  for(let i=0;i<=bays;i++) b.box(.009,height,.027,CITY.graphite,{x:x-width/2+i*bay,z:z+.008,y},"metal");
  b.box(width,.009,.025,CITY.silver,{x,z:z+.009,y:y+height-.009},"metal");
}

function modernCourt(b) {
  b.box(.958,.022,.951,CITY.deck);
  for(const x of [-.293,0,.293]) b.box(.008,.003,.259,"#969c96",{x,y:.022,z:.333});
}

function deepWindow(b,x,y,z,w,h,finish,lit = true) {
  b.box(w+.032,h+.028,.02,"#302e2b",{x,y:y-.011,z});
  b.box(w-.014,h-.018,.008,"#3b555f",{x,y:y+.008,z:z+.012},"glass");
  for (const side of [-1,1]) b.box(.016,h+.027,.047,finish,{x:x+side*w/2,y:y-.012,z:z+.02},"stone");
  b.box(w+.033,.016,.059,finish,{x,y:y-.019,z:z+.023},"stone");
  b.box(w+.032,.023,.052,finish,{x,y:y+h,z:z+.024},"stone");
  b.box(.007,h-.011,.027,"#4b463c",{x,y:y+.008,z:z+.017});
  if (lit) b.box(w*.43,h*.82,.006,"#e7b877",{x:x+w*.23,y:y+.01,z:z+.017},"lights");
}

function stoneApron(b, color = "#c8bba5", width = .92) {
  b.box(width,.023,.93,color,{y:.002},"stone");
  for(const x of [-1,0,1]) b.box(width*.28,.009,.094,"#b6a994",{x:x*width*.29,z:.377,y:.025},"stone");
}

function entryCanopy(b, x, z, width, y, color, finish = "stone") {
  b.box(width,.026,.162,color,{x,z,y},finish);
  for(const side of [-1,1]) b.box(.028,y-.027,.027,"#716d63",{x:x+side*(width/2-.027),z:z+.063,y:.026},"metal");
  b.box(width*.48,.008,.015,"#ede2b9",{x,z:z+.048,y:y-.009},"lights");
}

function rollerBay(b,x,z,width,height,color) {
  b.box(width+.032,height+.022,.051,"#55514b",{x,z,y:.027});
  b.box(width-.013,height-.018,.014,color,{x,z:z+.027,y:.035},"paint");
  for(let y=.059;y<height-.003;y+=.033) b.box(width-.022,.004,.019,"#686965",{x,z:z+.031,y});
}

/** Rounded process pipes, with the geometry shared through the final instanced building. */
function processPipe(b, points, radius, paint) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x,y,z]) => new THREE.Vector3(x,y,z)));
  const shape = new THREE.TubeGeometry(curve,points.length*3,radius,6,false);
  b.add(shape,paint,{},"paint");
  shape.dispose();
}

function processTank(b,x,z,r,height,color) {
  b.cyl(r,r,height,"#b4bab5",{x,z,y:.036},12,"metal");
  b.dome(r,color,{x,z,y:.036+height,sy:.34},"paint");
  for(const y of [.064,.036+height*.57,.028+height]) b.cyl(r+.007,r+.007,.009,color,{x,z,y},12,"paint");
  b.cyl(.018,.023,.036,"#676e6c",{x,z,y:height+.075},7,"metal");
}

function utilitySlab(b,color="#beb5a3") {
  b.box(.97,.024,.964,color,{},"stone");
  for(const x of [-.408,.408]) b.box(.035,.035,.641,"#aa9e83",{x,z:.056,y:.023},"stone");
}

function yardMark(b,x,z,depth) {
  for(const side of [-1,1]) b.box(.007,.006,depth,"#c4b27a",{x:x+side*.106,z,y:.024});
}

function markedPitch(b,w,d,y) {
  for(let i=0;i<8;i++) b.box(w/8-.001,.005,d,i%2?"#577c51":"#638657",{x:(i-3.5)*w/8,y});
  const line="#dedabd";
  for(const x of [-w*.48,0,w*.48]) b.box(.004,.006,d*.96,line,{x,y:y+.004});
  for(const z of [-d*.48,d*.48]) b.box(w*.96,.006,.004,line,{z,y:y+.004});
  b.add(new THREE.TorusGeometry(d*.157,.003,4,16),line,{y:y+.01,rx:Math.PI/2});
  for(const sign of [-1,1]) {
    const edge=w*.479*sign, box=w*.34*sign;
    b.box(.004,.006,d*.48,line,{x:box,y:y+.007});
    for(const z of [-d*.24,d*.24]) b.box(w*.14,.006,.004,line,{x:(box+edge)/2,y:y+.007,z});
    b.box(.005,.005,.11,"#e8dfc4",{x:edge,y:y+.064});
    for(const z of [-.051,.051]) b.box(.005,.052,.005,"#e8dfc4",{x:edge,y:y+.01,z});
  }
}

function civicBench(b,x,z,angle=0) {
  for(const side of [-1,1]) {
    b.box(.013,.029,.038,"#6f7064",{x:x+side*.045*Math.cos(angle),z:z-side*.045*Math.sin(angle),y:.035,ry:angle},"metal");
  }
  b.box(.114,.015,.045,"#9b7658",{x,z,y:.063,ry:angle},"wood");
}

export const FAIR_WHEEL = { x: -.144, y: .554, z: -.144, radius: .349, cabins: 8 };

export const STREET_LAMP_HEAD = .172;

const MAKERS = {
  // بيت الشعر: low black tent, three peaks, sadu band, poles and ropes.
  tent0(b) { // بيت الشعر: a black goat-hair tent on poles with guy ropes, a Sadu curtain, the majlis rugs, the fire with the dallah
    b.box(0.92, 0.012, 0.7, "#d9c49a");
    const ridge = (x, h) => b.cyl(0.008, 0.01, h, "#6b4a2e", { x, z: 0 }, 6, "wood");
    // the roof: one woven sheet over three poles, rising to each pole and sagging between (the tent's profile, extruded)
    const prof = [[-0.43, 0], [-0.43, 0.15], [-0.28, 0.29], [-0.14, 0.23], [0, 0.31], [0.14, 0.23], [0.28, 0.29], [0.43, 0.15], [0.43, 0], [0.4, 0], [0.4, 0.14], [0.28, 0.265], [0.14, 0.205], [0, 0.285], [-0.14, 0.205], [-0.28, 0.265], [-0.4, 0.14], [-0.4, 0]];
    b.plate(prof, 0.52, "#231c18", { z: 0 }, "plaster");
    for (let i = 0; i < 5; i++) b.plate(prof.slice(0, 9).map(([x, y]) => [x, y + 0.002]).concat(prof.slice(9).map(([x, y]) => [x, y + 0.002])), 0.012, "#3a302a", { z: -0.2 + i * 0.1 }, "plaster"); // the woven strips' seams
    for (const x of [-0.28, 0, 0.28]) ridge(x, x ? 0.29 : 0.31);
    b.box(0.84, 0.14, 0.012, "#2a221d", { y: 0.02, z: -0.255 }, "plaster");             // the back wall
    for (const x of [-0.42, 0.42]) b.box(0.012, 0.16, 0.5, "#2a221d", { x, y: 0.02 }, "plaster");
    for (let i = 0; i < 9; i++) b.box(0.08, 0.13, 0.006, ["#b3261e", "#f2ece0", "#2a221d", "#d9822b"][i % 4], { x: -0.32 + i * 0.08, y: 0.03, z: -0.03 }); // the Sadu curtain (the ladies' side)
    for (const [x, z] of [[-0.44, 0.32], [0.44, 0.32], [-0.44, -0.32], [0.44, -0.32]]) { b.add(new THREE.CylinderGeometry(0.002, 0.002, 0.3, 4), "#c9b38a", { x: x * 0.8, y: 0.12, z: z * 0.8, rx: z > 0 ? 0.9 : -0.9 }); b.cyl(0.006, 0.006, 0.03, "#6b4a2e", { x, z }, 5, "wood"); }
    // the majlis in front: rugs, cushions along the side, the fire pit and coffee things
    b.box(0.56, 0.006, 0.22, "#9c2f28", { z: 0.12 }); b.box(0.5, 0.007, 0.16, "#c9a24a", { z: 0.12 });
    for (let i = 0; i < 4; i++) b.rbox(0.11, 0.035, 0.05, 0.01, i % 2 ? "#7a1f1a" : "#24425e", { x: -0.2 + i * 0.13, z: 0.03 }, "matte");
    b.cyl(0.05, 0.055, 0.02, "#8a8378", { x: 0.3, z: 0.3 }, 10, "stone"); b.add(new THREE.ConeGeometry(0.022, 0.05, 6), "#ff8a2a", { x: 0.3, y: 0.045, z: 0.3 }, "glow");
    b.lathe([[0, 0], [0.018, 0.005], [0.02, 0.025], [0.008, 0.04], [0.012, 0.055], [0, 0.06]], "#d4a53a", { x: 0.36, y: 0.007, z: 0.24 }, 10, "metal"); // the dallah
    b.box(0.05, 0.02, 0.03, "#6b4a2e", { x: -0.34, z: 0.28 }, "wood");
  },
  house1(b) {
    const w=.69,d=.58,z=-.095;
    b.box(.93,.026,.89,"#c1a080",{z:.026});
    adobeWall(b,w,.33,d,-.05,z,"#b98a65");
    b.box(.46,.13,.34,"#9b785b",{x:-.09,y:.33,z:-.17},"plaster");
    for(const side of [-1,1]) {
      b.box(.047,.156,.54,"#bf9e79",{x:side*.41,z:.16},"stone");
      b.box(.052,.022,.55,"#d7b38e",{x:side*.41,y:.156,z:.16});
    }
    crenels(b,.46,.34,.46,"#cb9a70",.039);
    b.box(.73,.028,.62,"#c79972",{x:-.05,y:.326,z});
    beams(b,.67,.285,.192,5);
    adobeDoor(b,-.105,.023,.192,.151,.23,"#526950");
    b.box(.147,.064,.018,"#4c3b2e",{x:.15,y:.145,z:.193});
    for(const x of [.102,.147,.192]) b.box(.013,.058,.023,"#ae916f",{x,y:.148,z:.201});
    b.box(.12,.011,.10,"#d4b48f",{x:-.10,y:.023,z:.276});
    b.box(.42,.025,.043,"#bb8f69",{x:-.18,y:.13,z:.423});
    b.box(.045,.133,.04,"#a67753",{x:-.37,z:.423});
    b.box(.20,.015,.15,"#8b5547",{x:-.18,y:.029,z:.34});
    for(const x of [-.25,-.17,-.09]) b.box(.023,.006,.129,"#d0a276",{x,y:.044,z:.34,ry:.43});
    b.cyl(.033,.043,.088,"#a96749",{x:.33,y:.028,z:.28},8);
    b.cyl(.037,.037,.012,"#ce9570",{x:.33,y:.109,z:.28},8);
    b.box(.067,.045,.019,C.light,{x:.15,y:.151,z:.207},"lights");
  },
  house2(b) {
    b.box(.94,.029,.94,"#c2aa87");
    wallAround(b,.92,.153,"#b6a385");
    b.box(.56,.39,.49,"#dfceb6",{x:-.091,y:.029,z:-.122},"plaster");
    b.box(.38,.25,.39,"#c6ab8e",{x:.13,y:.029,z:-.105},"stone");
    b.box(.44,.34,.34,"#e9dbc5",{x:-.12,y:.419,z:-.160},"plaster");
    b.box(.493,.023,.391,"#bfa98c",{x:-.12,y:.756,z:-.16});
    b.box(.60,.028,.533,"#c4ad86",{x:-.091,y:.415,z:-.122});
    for(const x of [-.26,-.10]) deepWindow(b,x,.55,.013,.095,.105,"#ceb797",x<-.2);
    for(const x of [-.27,-.14]) deepWindow(b,x,.177,.125,.075,.105,"#bba287");
    adobeDoor(b,.12,.028,.091,.139,.211,"#4b695d");
    b.box(.257,.018,.201,"#c1a07a",{x:.235,y:.052,z:.286});
    for(let i=0;i<4;i++) {
      const x=.134+i*.069;
      b.box(.009,.205,.01,"#654b39",{x,y:.055,z:.368});
      b.box(.009,.205,.01,"#654b39",{x,y:.055,z:.202});
      b.box(.038,.018,.197,"#81614a",{x,y:.25,z:.287});
    }
    b.box(.29,.02,.034,"#84624a",{x:.238,y:.255,z:.348});
    pot(b,-.35,.32,1.09); roofTank(b,.18,.301,-.211,.061,"#dccab5");
    acUnit(b,-.25,.43,-.045);
    b.box(.156,.011,.129,"#c6b59c",{x:.121,y:.031,z:.396});
  },
  house3(b) {
    modernCourt(b);
    const wall="#f5f0e7", frame="#4e5e63";
    b.box(.729,.275,.506,wall,{z:-.13,y:.023},"plaster");
    b.box(.49,.253,.362,wall,{x:.13,z:-.168,y:.311},"plaster");
    b.box(.518,.04,.401,wall,{x:.13,z:-.17,y:.562},"paint");
    b.box(.273,.61,.425,frame,{x:-.248,z:-.169,y:.023},"paint");
    glassWall(b,-.251,.053,.087,.201,.483,2,"#678b96");
    b.box(.516,.036,.407,wall,{x:.133,z:-.003,y:.283},"paint");
    glassWall(b,.132,.024,.36,.355,.176,3);
    glassWall(b,.122,.133,.053,.437,.19,4);
    b.box(.472,.063,.012,"#a1bdc1",{x:.138,z:.19,y:.321},"glass");
    b.box(.485,.01,.018,frame,{x:.136,z:.19,y:.384},"metal");
    b.box(.32,.019,.217,frame,{x:.192,z:.237,y:.237},"metal");
    b.box(.019,.206,.025,frame,{x:.336,z:.333,y:.032},"metal");
    b.box(.224,.008,.016,"#ffe8b3",{x:.17,z:.323,y:.232},"lights");
    for(let i=0;i<6;i++) b.box(.015,.229,.021,CITY.bronze,{x:.194+i*.023,z:.145,y:.051},"metal");
    b.box(.217,.038,.129,"#8d9b7c",{x:-.282,z:.34,y:.022});
    oliveTree(b,-.275,.339,.87);
  },
  house4(b) {
    modernCourt(b);
    const pearl="#ddd8ce", spine="#395259";
    b.box(.809,.223,.698,pearl,{z:-.081,y:.022},"plaster");
    b.box(.599,1.353,.603,"#818b8a",{x:-.039,z:-.119,y:.239},"paint");
    b.box(.143,1.432,.477,spine,{x:.304,z:-.183,y:.246},"glass");
    b.box(.655,.046,.643,pearl,{x:-.032,z:-.113,y:1.584},"paint");
    b.box(.631,.033,.617,"#9b9d97",{x:-.039,z:-.119,y:1.629},"metal");
    glassWall(b,-.088,.277,.049,.526,.149,5,"#637e84");
    b.box(.465,.026,.201,CITY.graphite,{x:-.038,z:.313,y:.207},"metal");
    for(let f=0;f<5;f++) {
      const y=.287+f*.254;
      glassWall(b,-.035,.189,y+.045,.497,.157,4);
      const offset=f%2 ? -.049 : .034;
      b.box(.65,.035,.216,pearl,{x:-.029+offset,z:.228,y},"paint");
      b.box(.565,.063,.012,"#8caeb2",{x:-.028+offset,z:.331,y:y+.035},"glass");
      b.box(.576,.009,.014,CITY.graphite,{x:-.028+offset,z:.334,y:y+.097},"metal");
      b.box(.038,.204,.029,CITY.bronze,{x:-.297+offset,z:.325,y:y+.034},"metal");
      if(f%2===0) b.box(.108,.052,.021,"#e9c696",{x:.038,z:.211,y:y+.093},"lights");
    }
    b.box(.153,.044,.489,pearl,{x:.304,z:-.181,y:1.681},"paint");
    for(const x of [-.372,.365]) pot(b,x,.405,.77);
  },

  grocery(b) {
    const stone="#c7b599", green="#526659";
    b.box(.94,.028,.9,"#bba98f",{},"stone");
    b.box(.754,.397,.62,"#cebd9f",{y:.024,z:-.084},"plaster");
    b.box(.783,.035,.662,stone,{y:.411,z:-.08},"stone");
    b.box(.494,.05,.042,green,{x:-.012,y:.362,z:.246},"wood");
    b.box(.335,.015,.043,"#d1c4aa",{x:-.015,y:.371,z:.247});
    for(const x of [-.214,.012,.229]) deepWindow(b,x,.048,.23,.158,.216,stone,x!==.012);
    for(const x of [-.311,.303]) b.box(.043,.268,.174,stone,{x,y:.032,z:.293},"stone");
    b.box(.683,.028,.217,"#6d7662",{y:.308,z:.315},"paint");
    for(const z of [.296,.351,.404]) b.box(.66,.006,.014,"#b1af96",{y:.334,z});
    b.box(.551,.019,.09,stone,{y:.031,z:.421},"stone");
    for(let i=0;i<4;i++) b.box(.077,.048,.068,i%2?"#806a4e":"#a48154",{x:-.32+i*.077,y:.049,z:.388},"wood");
    roofTank(b,-.242,.449,-.203,.066,"#b4afa0");
    acUnit(b,.213,.448,-.236);
  },
  cafe(b) {
    stoneApron(b,"#c8ad85");
    b.box(.63,.36,.523,"#cdb591",{y:.025,z:-.125},"plaster");
    b.box(.66,.027,.556,"#baa081",{y:.377,z:-.123},"stone");
    crenels(b,.62,.52,.402,"#bd9c72",.028);
    deepWindow(b,-.16,.073,.142,.182,.216,"#ba9e79");
    adobeDoor(b,.15,.028,.144,.126,.239,"#775c45");
    b.box(.64,.018,.193,"#817164",{y:.305,z:.235},"wood");
    for(const x of [-.275,.275]) b.box(.021,.286,.021,"#745742",{x,z:.317,y:.027},"wood");
    for(const x of [-.205,.181]) {
      b.cyl(.062,.064,.013,"#a08265",{x,z:.382,y:.111},8,"wood");
      b.cyl(.006,.009,.087,"#61574b",{x,z:.382,y:.026},5,"metal");
      for(const dx of [-.081,.081]) b.box(.041,.031,.044,"#907054",{x:x+dx,z:.384,y:.026},"wood");
      b.cyl(.015,.011,.016,"#e1cbb4",{x,z:.38,y:.124},6);
    }
  },
  // the town's vault: a stone strongroom with a steel door; bigger and grander as it is upgraded
  vault(b) { vaultParts(b, 0); }, vault1(b) { vaultParts(b, 1); }, vault2(b) { vaultParts(b, 2); },
  bank(b) {
    stoneApron(b,"#bab3a6");
    const stone = "#b6aa97";
    b.box(.765,.419,.59,"#d4cbb8",{y:.03,z:-.109},"stone");
    b.box(.826,.071,.635,stone,{y:.443,z:-.1},"stone");
    b.box(.313,.378,.096,"#5a6a66",{y:.053,z:.225},"glass");
    for (const x of [-.319,-.173,.173,.319]) {
      b.box(.048,.351,.078,"#dfd4bf",{x,y:.083,z:.229},"stone");
      b.box(.087,.025,.103,stone,{x,z:.241,y:.06},"stone");
    }
    for(const x of [-.218,.218]) deepWindow(b,x,.105,.19,.089,.139,stone,false);
    b.box(.115,.053,.019,"#5b7264",{x:.281,y:.11,z:.281},"paint");
    b.box(.043,.023,.021,"#a8c3b3",{x:.281,y:.143,z:.292},"glass");
    entryCanopy(b,0,.284,.638,.407,stone);
    b.box(.538,.034,.131,stone,{y:.026,z:.386},"stone");
  },
  souq(b) {
    const stone = "#bda484", wall="#d1b995", timber="#785940";
    b.box(.96,.024,.946,stone,{},"stone");
    b.box(.924,.23,.076,wall,{z:-.407,y:.024},"stone");
    for (const x of [-.396,.394]) b.box(.08,.252,.72,wall,{x,z:-.048,y:.024},"stone");
    for (const z of [-.236,.071]) for(let j=0;j<3;j++) {
      const x=-.258+j*.259, stallColors=["#965e50","#5b7266","#af8963"], cloth=stallColors[(j+(z>0?1:0))%3];
      b.box(.201,.101,.131,timber,{x,y:.028,z:z+.015},"wood");
      b.box(.22,.018,.144,"#b09270",{x,y:.129,z:z+.016},"wood");
      const shade = new THREE.BoxGeometry(.224,.014,.231);
      b.add(shade,cloth,{x,y:.274,z,rx:.092,wind:.31}); shade.dispose();
      for(const dx of [-.107,.107]) {
        b.box(.013,.259,.013,timber,{x:x+dx,y:.026,z:z+.118},"wood");
        b.box(.013,.262,.013,timber,{x:x+dx,y:.026,z:z-.118},"wood");
      }
      for(let i=0;i<4;i++) b.box(.046,.024,.014,i%2 ? cloth : "#d0b98b",{x:x+(i-1.5)*.056,y:.252,z:z+.117,wind:.26});
      for(let i=0;i<3;i++) {
        const gx=x+(i-1)*.058;
        b.box(.054,.024,.051,"#a5815b",{x:gx,y:.147,z:z+.028},"wood");
        b.add(new THREE.IcosahedronGeometry(.019,0),["#bb843c","#968559","#a65a40"][i],{x:gx,y:.173,z:z+.028,sy:.58});
      }
      b.box(.024,.018,.022,"#eacf9e",{x,y:.221,z:z+.099},"lights");
    }
    b.box(.67,.015,.238,"#c6af8d",{y:.026,z:.328},"stone");
    for(const x of [-.392,.392]) b.box(.052,.32,.055,wall,{x,z:.391,y:.024},"stone");
    pot(b,-.343,.394,1.05); pot(b,.297,.391,.79);
  },
  mandi(b) {
    stoneApron(b,"#d3b995");
    b.box(.729,.339,.587,"#dbc7a7",{y:.025,z:-.096},"plaster");
    b.box(.778,.043,.635,"#ab7559",{y:.354,z:-.094},"stone");
    deepWindow(b,-.199,.077,.204,.187,.169,"#bda58a");
    deepWindow(b,.202,.077,.204,.171,.169,"#bda58a");
    adobeDoor(b,.016,.028,.199,.131,.207,"#744834");
    b.box(.303,.045,.02,"#945c49",{y:.277,z:.227},"wood");
    b.box(.196,.018,.023,"#d4bb8e",{y:.288,z:.238});
    entryCanopy(b,.025,.281,.602,.245,"#bea084");
    for(const x of [-.28,.298]) pot(b,x,.418,1);
    for(const x of [-.193,.267]) {
      b.cyl(.036,.047,.171,"#74786c",{x,z:-.239,y:.398},8,"metal");
      b.cyl(.05,.05,.013,"#535c59",{x,z:-.239,y:.569},8,"metal");
    }
  },
  hotel(b) {
    modernCourt(b);
    const bronze="#b39d77", blue="#5e8896";
    b.rbox(.84,.237,.667,.039,CITY.graphite,{y:.023,z:-.044},"paint");
    glassWall(b,0,.295,.053,.691,.155,6,blue);
    b.rbox(.537,1.456,.552,.05,blue,{x:-.056,y:.26,z:-.117},"glass");
    b.rbox(.218,1.3,.474,.029,"#496c7a",{x:.245,y:.26,z:-.132},"glass");
    for(let f=0;f<8;f++) {
      const y=.29+f*.169;
      b.rbox(.56,.013,.567,.006,bronze,{x:-.057,y,z:-.114},"metal");
      for(const x of [-.21,-.062,.086]) {
        b.box(.016,.155,.027,CITY.silver,{x,y,z:.159},"metal");
        if((f+Math.floor(x*20))%3===0) b.box(.075,.061,.013,"#f0d29e",{x:x+.049,y:y+.039,z:.169},"lights");
      }
    }
    b.rbox(.594,.043,.591,.018,CITY.pearl,{x:-.055,y:1.716,z:-.12},"paint");
    b.rbox(.548,.021,.547,.01,"#d8b77d",{x:-.055,y:1.718,z:-.12},"lights");
    entryCanopy(b,0,.36,.663,.251,bronze,"metal");
    for(const x of [-.367,.366]) pot(b,x,.369,.78);
  },
  mall(b) {
    modernCourt(b);
    b.rbox(.905,.355,.704,.045,CITY.pearl,{z:-.117,y:.024},"paint");
    b.rbox(.756,.129,.58,.05,"#9daaa9",{z:-.121,y:.379},"metal");
    b.rbox(.784,.063,.603,.029,CITY.pearl,{z:-.122,y:.506},"paint");
    glassWall(b,0,.243,.053,.756,.305,8,"#6c99a2");
    b.rbox(.839,.048,.196,.021,"#a1957d",{y:.359,z:.294},"metal");
    b.rbox(.73,.011,.138,.005,"#e6c995",{y:.351,z:.301},"lights");
    for(const x of [-.368,.368]) b.box(.043,.325,.049,CITY.graphite,{x,z:.329,y:.029},"metal");
    b.rbox(.372,.018,.29,.008,"#7798a0",{y:.572,z:-.14},"glass");
    b.box(.385,.011,.016,CITY.silver,{y:.58,z:-.058},"metal");
    for(const x of [-.383,.382]) oliveTree(b,x,.405,.59);
  },

  palms(b, ground) {
    b.box(.95,.019,.945,ground === "wadi" ? "#867854" : "#9c825b");
    for (const x of [-.438,.438]) b.box(.05,.067,.91,"#b49b74",{x},"stone");
    for(const z of [-.398,.346]) {
      b.box(.8,.028,.093,"#b5a17e",{y:.017,z},"stone");
      b.box(.755,.008,.038,"#54857f",{y:.044,z},"shiny");
    }
    for(const [x,z,h] of [[-.224,-.216,.95],[.216,-.232,1.04],[-.222,.16,.83],[.232,.148,.97]]) {
      b.cyl(.104,.122,.023,"#786244",{x,z,y:.017},10);
      palm(b,x,z,h,x*.95);
    }
    b.box(.13,.1,.116,"#afae9b",{x:.32,y:.02,z:.303},"plaster");
  },
  veg(b) {
    stoneApron(b,"#aa8d63");
    for(let row=0;row<6;row++) {
      const z=-.34+row*.13;
      b.box(.756,.029,.094,"#866944",{z,y:.022});
      b.box(.744,.011,.013,"#4a4a3c",{z:z+.034,y:.048});
      for(let i=0;i<9;i++) {
        const x=(i-4)*.082;
        b.add(new THREE.DodecahedronGeometry(.037,0),["#798d48","#60794b","#91a253"][row%3],{x,y:.07,z:z+(i%2-.5)*.015,sy:.68,wind:.14});
      }
    }
    b.box(.12,.152,.117,"#c9b599",{x:.391,y:.02,z:.349},"plaster");
    b.box(.146,.034,.142,"#6e7e68",{x:.39,y:.167,z:.348},"paint");
    processPipe(b,[[.391,.093,.287],[.391,.067,.243],[.361,.053,.227]],.009,"#969983");
  },
  roundIsland(b) {
    b.cyl(ISLAND_RADIUS-.011, ISLAND_RADIUS, .037, "#a59b88", {},24,"stone");
    b.cyl(.227,.233,.012,"#9d835c",{y:.035},22);
    for(let i=0;i<8;i++) {
      const a=i*Math.PI/4, x=Math.cos(a)*.158, z=Math.sin(a)*.158;
      b.add(new THREE.DodecahedronGeometry(.052,0),i%2?"#6f7d55":"#778b5c",{x,z,y:.061,sy:.63});
    }
    palm(b, 0, 0, 0.6, 0);
  },
  trafficLight(b) { // a mast-arm signal: a galvanised pole on a concrete foot, the arm over the junction, three-lamp heads, a pedestrian box
    b.cyl(0.03, 0.036, 0.04, "#bdb6a8", {}, 10, "stone");
    b.cyl(0.011, 0.015, 0.56, "#8f969b", { y: 0.04 }, 10, "metal");
    b.add(new THREE.CylinderGeometry(0.007, 0.009, 0.34, 8), "#8f969b", { x: 0.17, y: 0.56, rz: Math.PI / 2 - 0.08 }, "metal");
    b.add(new THREE.CylinderGeometry(0.003, 0.003, 0.2, 5), "#8f969b", { x: 0.09, y: 0.5, rz: Math.PI / 2 - 0.62 }, "metal"); // the brace
    for (const [x, y, z] of [[0.3, 0.47, 0], [0.16, 0.48, 0], [0.02, 0.3, 0.02]]) {
      b.rbox(0.034, 0.1, 0.03, 0.006, "#1f2326", { x, y, z }, "paint");
      b.box(0.04, 0.106, 0.004, "#f2c230", { x, y: y - 0.003, z: z - 0.017 });          // the yellow back plate
      for (let k = 0; k < 3; k++) { b.box(0.018, 0.004, 0.012, "#1f2326", { x, y: y + 0.08 - k * 0.03, z: z + 0.021 }); b.cyl(0.009, 0.009, 0.004, ["#e0523f", "#f0b43a", "#3fbf5f"][k], { x, y: y + 0.07 - k * 0.03, z: z + 0.016, rx: Math.PI / 2 }, 10, "lights"); }
    }
    b.rbox(0.03, 0.04, 0.026, 0.005, "#2c3034", { x: -0.002, y: 0.2, z: 0.02 }, "paint"); b.box(0.016, 0.016, 0.004, "#e8e8e6", { y: 0.215, z: 0.034 }, "lights");
    b.box(0.07, 0.04, 0.004, "#1f6f3f", { x: 0.1, y: 0.6, z: 0.008 }); b.box(0.05, 0.006, 0.005, "#f2f2ee", { x: 0.1, y: 0.605, z: 0.011 }); // the street name sign
  },
  medianPalm(b) { // a planted median: stone kerbs, red earth with ground cover, a date palm with its uplight
    b.box(0.2, 0.035, 0.12, "#d6ccb8", {}, "stone");
    b.box(0.18, 0.01, 0.1, "#8a5d3e", { y: 0.035 });
    for (const [x, z] of [[-0.06, -0.03], [0.06, 0.03], [-0.07, 0.035], [0.07, -0.03]]) b.add(new THREE.IcosahedronGeometry(0.022, 0), "#6f8f4a", { x, y: 0.05, z, sy: 0.6 });
    palm(b, 0, 0, 0.5, 0.04);
    b.box(0.014, 0.01, 0.014, "#fff0c0", { x: 0.04, y: 0.045, z: 0 }, "lights");
  },
  parking(b) { // a Saudi car park: kerbed asphalt, marked bays with wheel stops, a fabric car shade over one row, parked sedans and SUVs
    b.box(0.98, 0.01, 0.98, "#5a5c5f");
    for (const [x, z, w, d] of [[0, -0.475, 0.98, 0.03], [0, 0.475, 0.98, 0.03], [-0.475, 0, 0.03, 0.98], [0.475, 0, 0.03, 0.98]]) b.box(w, 0.026, d, "#d4cab6", { x, z }, "stone");
    b.box(0.86, 0.014, 0.1, "#cbbfa7", { y: 0.01 }, "stone");                                     // the planted median
    for (const x of [-0.3, 0.3]) b.add(new THREE.IcosahedronGeometry(0.05, 0), "#6f8f4a", { x, y: 0.07, z: 0, sy: 0.8 });
    palm(b, 0, 0, 0.42);
    for (const row of [-1, 1]) {
      const z = row * 0.27;
      for (let k = 0; k <= 5; k++) b.box(0.008, 0.003, 0.3, "#f1ede4", { x: -0.42 + k * 0.168, y: 0.011, z });
      for (let k = 0; k < 5; k++) b.box(0.07, 0.012, 0.016, "#c9c3b4", { x: -0.336 + k * 0.168, y: 0.011, z: z + row * 0.13 });
    }
    // the shade: steel posts and beams, a sand-coloured fabric pitched over the back row
    for (let k = 0; k < 4; k++) { const x = -0.38 + k * 0.253; b.cyl(0.009, 0.011, 0.25, "#8d9396", { x, z: -0.43 }, 8, "metal"); b.add(new THREE.BoxGeometry(0.01, 0.01, 0.3), "#8d9396", { x, y: 0.25, z: -0.3, rx: -0.18 }, "metal"); }
    b.add(new THREE.BoxGeometry(0.84, 0.006, 0.32), "#e9e1cf", { y: 0.235, z: -0.29, rx: -0.18 });
    b.add(new THREE.BoxGeometry(0.84, 0.004, 0.33), "#cfc4ac", { y: 0.231, z: -0.29, rx: -0.18 });
    const cars = [[-0.336, -0.27, false, "#f4f4f1"], [-0.168, -0.27, true, "#2b2f33"], [0.168, -0.27, false, "#b9bdc0"], [0.336, -0.27, true, "#f4f4f1"], [-0.336, 0.27, true, "#7d1f26"], [0, 0.27, false, "#1f3354"], [0.336, 0.27, false, "#d9cfb6"]];
    for (const [x, z, suv, color] of cars) parkedCar(b, x, z, z < 0 ? -Math.PI / 2 : Math.PI / 2, suv, color);
    b.cyl(0.008, 0.01, 0.42, "#5b6065", { x: 0.44, z: 0.04 }, 6, "metal"); b.box(0.09, 0.012, 0.03, "#5b6065", { x: 0.41, y: 0.42, z: 0.04 }); b.box(0.06, 0.006, 0.022, "#fff2d0", { x: 0.4, y: 0.414, z: 0.04 }, "glow");
    b.cyl(0.006, 0.006, 0.2, "#5b6065", { x: -0.44, z: 0.44 }, 5); b.box(0.08, 0.08, 0.008, "#1f5fa8", { x: -0.44, y: 0.2, z: 0.445 }); b.box(0.03, 0.05, 0.01, "#f4f4f2", { x: -0.44, y: 0.215, z: 0.45 });
  },
  avenue(b) { // the boulevard (its card): two carriageways, dashed lanes, a kerbed median with palms and a lamp
    b.box(0.98, 0.01, 0.98, "#55575b");
    for (const z of [-0.25, 0.25]) for (let k = 0; k < 4; k++) b.box(0.12, 0.004, 0.014, "#f3efe6", { x: -0.36 + k * 0.24, y: 0.01, z });
    for (const z of [-0.47, 0.47]) b.box(0.98, 0.04, 0.05, "#e2b52c", { z });
    MAKERS.medianPalm(b); b.box(0.98, 0.035, 0.12, "#d6ccb8", {}, "stone");
    b.cyl(0.006, 0.008, 0.4, "#5b6065", { x: 0.3 }, 6, "metal"); b.box(0.1, 0.01, 0.02, "#5b6065", { x: 0.3, y: 0.4 }); b.box(0.06, 0.006, 0.02, "#fff2d0", { x: 0.3, y: 0.394 }, "lights");
  },
  roundabout(b) { b.box(0.98, 0.01, 0.98, "#4d4f55"); b.cyl(ISLAND_RADIUS-.02, ISLAND_RADIUS, 0.05, C.stone); b.cyl(0.22, 0.22, 0.012, "#7fae4c", { y: 0.05 }, 20); },
  signal(b) { // the signalled junction (its card): zebra crossings, stop lines, a mast-arm signal on the corner
    b.box(0.98, 0.01, 0.98, "#55575b");
    for (let k = 0; k < 6; k++) { b.box(0.05, 0.004, 0.16, "#f3efe6", { x: -0.3 + k * 0.12, y: 0.01, z: 0.38 }); b.box(0.16, 0.004, 0.05, "#f3efe6", { x: 0.38, y: 0.01, z: -0.3 + k * 0.12 }); }
    b.box(0.4, 0.004, 0.02, "#f3efe6", { x: -0.2, y: 0.011, z: 0.26 });
    MAKERS.trafficLight(b);
  },
  quarry(b) {
    utilitySlab(b,"#b59d7d");
    for(const [x,z,r,h] of [[-.27,-.249,.18,.212],[-.089,-.313,.12,.143],[.254,.186,.127,.112],[-.277,.262,.111,.085]])
      b.add(new THREE.DodecahedronGeometry(r,0),"#afa18a",{x,z,y:h*.41,sy:h/r*.63,rz:.31},"stone");
    b.box(.24,.048,.125,"#70665a",{x:.222,z:-.173,y:.028},"metal");
    b.box(.111,.137,.108,"#b39462",{x:.241,z:-.177,y:.073},"paint");
    b.box(.076,.063,.009,"#5a6b69",{x:.246,z:-.121,y:.133},"glass");
    b.box(.229,.022,.033,"#9c8156",{x:.125,y:.217,z:-.179,rz:.57},"paint");
    b.box(.136,.019,.031,"#9c8156",{x:.013,y:.204,z:-.178,rz:-.77},"paint");
    b.box(.069,.036,.071,"#787269",{x:-.046,y:.136,z:-.178},"metal");
    b.box(.206,.05,.104,"#a1a194",{x:.021,z:.369,y:.023},"stone");
  },
  blockfactory(b) {
    utilitySlab(b);
    b.box(.682,.281,.461,"#b8b7a7",{x:-.064,z:-.208,y:.025},"plaster");
    b.box(.719,.039,.499,"#8f9a92",{x:-.067,z:-.208,y:.302},"paint");
    processTank(b,.335,-.226,.091,.443,"#a5a697");
    rollerBay(b,-.124,.026,.27,.204,"#7a8180");
    for(let j=0;j<3;j++) for(let i=0;i<3;i++)
      b.box(.089,.028,.078, j%2?"#a6a599":"#bbb8a8",{x:-.343+i*.102+(j%2)*.016,z:.311,y:.026+j*.03},"stone");
    yardMark(b,.22,.308,.236);
    b.box(.195,.019,.112,"#6f766b",{x:.245,z:.112,y:.11},"metal");
  },
  dairy(b) {
    utilitySlab(b,"#c8c4b3");
    b.box(.758,.321,.489,"#e0ded0",{z:-.187,y:.026},"plaster");
    b.box(.799,.036,.521,"#9bb0ae",{z:-.19,y:.346},"paint");
    rollerBay(b,-.229,.071,.183,.194,"#7d9495");
    deepWindow(b,.123,.102,.067,.139,.125,"#b1b7ab");
    processTank(b,.269,.272,.088,.365,"#aebbb5");
    processTank(b,.044,.266,.088,.365,"#9eaca9");
    processPipe(b,[[.278,.399,.265],[.213,.446,.266],[.081,.444,.266],[.044,.402,.265]],.012,"#879b98");
    yardMark(b,-.233,.287,.271);
    b.box(.18,.03,.202,"#a7aca2",{x:-.231,z:.185,y:.026},"stone");
  },
  mill(b) {
    utilitySlab(b);
    for(const x of [-.28,-.018,.248]) processTank(b,x,-.217,.104,.563,"#aaa99a");
    b.box(.824,.045,.107,"#7d8378",{x:-.012,z:-.217,y:.639},"metal");
    for(const z of [-.281,-.152]) b.box(.809,.018,.011,"#bab29a",{x:-.016,z,y:.682},"metal");
    b.box(.454,.255,.344,"#c5b294",{x:-.117,z:.201,y:.026},"stone");
    b.box(.483,.036,.365,"#a68d65",{x:-.119,z:.201,y:.278},"paint");
    rollerBay(b,-.122,.378,.222,.173,"#9d926f");
    b.box(.236,.033,.064,"#969983",{x:.282,z:.087,y:.187,rx:.71},"metal");
    yardMark(b,.252,.354,.169);
  },
  truckBody(b) {
    b.rbox(0.135, 0.118, 0.137, 0.014, "#eee6d4", { x: 0.119, y: 0.035 }, "matte");
    b.box(0.015, 0.041, 0.11, C.glass, { x: 0.184, y: 0.103 }, "glass");
    b.box(0.35, 0.031, 0.14, C.dark, { x: -0.021, y: 0.028 });
    b.box(0.012, 0.032, 0.098, "#354346", { x: 0.186, y: 0.048 });
    for (const z of [-0.068, 0.068]) {
      b.box(0.078, 0.029, 0.005, "#304954", { x: 0.128, y: 0.105, z }, "glass");
      b.box(0.057, 0.039, 0.007, "#b56948", { x: 0.12, y: 0.053, z });
      b.box(0.012, 0.013, 0.02, "#ffe2ab", { x: 0.189, y: 0.056, z: z * 0.79 });
      for (const x of [0.123, -0.135, -0.06]) {
        b.add(new THREE.CylinderGeometry(0.028, 0.028, 0.023, 10), C.black, { x, y: 0.026, z, rx: Math.PI / 2 });
        b.add(new THREE.CylinderGeometry(0.015, 0.015, 0.025, 8), "#a69e8b", { x, y: 0.026, z, rx: Math.PI / 2 });
      }
    }
  },
  truckCargo(b) {
    b.rbox(0.24, 0.093, 0.132, 0.008, "#ffffff", { x: -0.07, y: 0.057 }, "matte");
    for (const z of [-0.067, 0.067]) {
      for (const x of [-0.158, -0.11, -0.062, -0.014, 0.034]) b.box(0.006, 0.074, 0.004, "#beb2a0", { x, y: 0.061, z });
    }
  },
  dam(b) {
    b.box(.395,.036,.991,"#b4a58c",{},"stone");
    b.add(new THREE.BoxGeometry(.276,.434,.985),"#bfb9a8",{x:-.053,y:.229,z:0,rz:-.17},"plaster");
    b.box(.239,.032,.998,"#c9bfa6",{x:-.096,y:.444},"stone");
    for(const z of [-.437,-.259,-.083,.083,.259,.437]) {
      b.box(.026,.38,.042,"#a89d89",{x:.08,y:.037,z},"stone");
      b.box(.013,.077,.014,"#7d8277",{x:.016,y:.477,z},"metal");
    }
    for(const y of [.495,.544]) b.box(.011,.009,.91,"#7c8074",{x:.016,y},"metal");
    for(const z of [-.172,.172]) {
      b.box(.219,.145,.219,"#a69e8a",{x:.127,z,y:.023},"stone");
      b.box(.009,.089,.153,"#67746b",{x:.238,z,y:.051},"paint");
      b.box(.185,.007,.113,"#598c84",{x:.322,z,y:.019},"shiny");
    }
    b.box(.148,.104,.197,"#bcb4a1",{x:-.086,z:-.356,y:.477},"plaster");
  },
  pivot_b(b) {
    b.box(.97,.016,.967,"#b09a72");
    for(let i=0;i<13;i++) {
      const r=.466-i*.031;
      b.cyl(r,r,.008,i%2 ? "#7a8950" : "#85965a",{y:.02+i*.0012},24);
    }
    b.cyl(.048,.069,.034,"#a5a497",{y:.038},9,"stone");
    b.cyl(.025,.031,.137,"#7f8582",{y:.057},7,"metal");
  },
  pivot(b) { MAKERS.pivot_b(b); MAKERS.irrigationArm(b); },
  irrigationArm(b) {
    for(const z of [-.017,.017]) {
      b.box(.446,.011,.014,"#aec1b7",{x:.227,y:.167,z},"metal");
      b.box(.446,.009,.01,"#778a81",{x:.227,y:.129,z},"metal");
      for(let i=0;i<6;i++) b.add(new THREE.BoxGeometry(.081,.006,.006),"#a3ac9b",{x:.036+i*.072,y:.149,z,rz:(i%2?1:-1)*.41},"metal");
    }
    for(const x of [.134,.286,.428]) {
      for(const z of [-.031,.031]) {
        b.box(.014,.108,.018,"#74837a",{x,z,y:.047},"metal");
        b.cyl(.024,.024,.017,"#41433b",{x,z,y:.036,rx:Math.PI/2},9);
      }
    }
  },
  pen(b) {
    b.box(0.94, 0.015, 0.94, "#c9ad7c");
    fenceRing(b, 0.44);
    b.box(.74,.024,.235,"#b0956d",{z:-.31},"stone");
    shade(b,-.14,-.287,.49,.24);
    for(const x of [-.31,-.21,-.11]) b.box(.075,.054,.063,"#c8ad6c",{x,y:.025,z:-.343},"wood");
    b.box(.018,.096,.171,"#8b7460",{x:.415,z:.25},"wood");
    b.box(0.3, 0.05, 0.08, "#8a8f94", { x: 0.18, y: 0.015, z: 0.3 }); b.box(0.26, 0.01, 0.05, C.water, { x: 0.18, y: 0.06, z: 0.3 }, "shiny");
    sheep(b, -0.22, 0.12, 0.4); sheep(b, 0.02, 0.06, -0.3); sheep(b, -0.1, 0.28, 1.2);
    camelSmall(b, 0.24, -0.04, 0.3);
  },
  livestock(b) {
    b.box(0.94, 0.015, 0.94, "#cdb48a");
    for (const [x, z] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.1], [0.42, 0.1]]) b.cyl(0.018, 0.018, 0.4, C.wood, { x, z }, 5);
    b.box(.915,.028,.599,"#bbb69d",{y:.4,z:-.16},"metal");
    for(const z of [-.431,-.325,-.219,-.113,-.007,.099]) b.box(.92,.009,.018,"#888d7d",{y:.426,z},"metal");
    for(const x of [-.398,.398]) b.box(.073,.024,.55,"#ad9877",{x,y:.016,z:.15},"stone");
    b.box(0.92, 0.04, 0.02, C.red, { y: 0.38, z: 0.14 });
    for (const x of [-0.25, 0.25]) { b.box(0.36, 0.06, 0.02, C.wood, { x, y: 0.1, z: -0.02 }); b.box(0.02, 0.12, 0.3, C.wood, { x: x - 0.18, y: 0.015, z: -0.17 }); }
    sheep(b, -0.32, -0.2, 0); sheep(b, -0.18, -0.3, 2); sheep(b, -0.24, -0.08, 1);
    camelSmall(b, 0.22, -0.2, 1.5); camelSmall(b, 0.3, 0.3, 0.2);
    b.box(0.26, 0.08, 0.16, C.stone, { x: -0.22, z: 0.3 }); b.box(0.04, 0.1, 0.04, C.dark, { x: -0.22, y: 0.08, z: 0.3 });
  },
  mazayen(b) {
    b.box(0.98, 0.015, 0.98, "#d8bf8c");
    const ring = new THREE.CylinderGeometry(0.4, 0.4, 0.07, 28, 1, true);
    b.add(ring,"#b5a68d",{y:.047},"stone");
    b.add(new THREE.TorusGeometry(.402,.014,5,28),"#e0ccb0",{y:.084,rx:Math.PI/2},"stone");
    for(const sign of [-1,1]) for(let i=0;i<8;i++) {
      const x=sign*(.12+i*.044);
      b.box(.04,.011,.055,i%2?"#b88e60":"#cdab77",{x,y:.023,z:.423},"stone");
    }
    b.add(new THREE.CylinderGeometry(0.39, 0.39, 0.004, 28), "#cfae74", { y: 0.016 });
    for (let k = 0; k < 3; k++) b.box(0.9, 0.06 * (3 - k), 0.06, k % 2 ? C.stone : "#e4d6b8", { z: -0.46 + k * 0.06 });
    for (let k = 0; k < 4; k++) b.cyl(0.008, 0.008, 0.3, C.dark, { x: -0.42 + k * 0.28, z: -0.48 }, 4);
    b.box(.92,.022,.143,"#587363",{y:.3,z:-.427},"paint");
    b.box(.913,.036,.016,"#bcb491",{y:.282,z:-.348},"wood");
    for(const x of [-.327,-.109,.109,.327]) b.box(.053,.009,.024,C.light,{x,y:.274,z:-.34},"lights");
    for (const x of [-0.44, 0.44]) { b.cyl(0.01, 0.01, 0.45, C.dark, { x, z: 0.44 }, 4); b.box(0.12, 0.07, 0.006, C.green, { x: x + (x < 0 ? 0.06 : -0.06), y: 0.4, z: 0.44 }); }
    camelSmall(b, -0.12, 0.02, 0.5); camelSmall(b, 0.14, 0.12, 2.6); camelSmall(b, 0.02, -0.2, 1.4);
    b.box(0.2, 0.02, 0.12, C.red, { x: 0.36, z: 0.3 });
  },
  workshop(b) {
    utilitySlab(b);
    b.box(.741,.283,.497,"#b2a99a",{z:-.157,y:.027},"stone");
    for(const x of [-.215,.209]) {
      const roof = new THREE.CylinderGeometry(.22,.22,.361,9,1,false,0,Math.PI);
      b.add(roof,"#989f93",{x,y:.302,z:-.150,rz:Math.PI/2,sz:1.06,sy:.58},"paint");
      roof.dispose();
      rollerBay(b,x,.094,.229,.222,"#7f8b81");
    }
    b.box(.77,.032,.146,"#a3957c",{z:.199,y:.261},"stone");
    for(const x of [-.205,.206]) yardMark(b,x,.367,.188);
    b.box(.113,.083,.095,"#a38361",{x:.309,z:.314,y:.027},"wood");
  },
  datefactory(b) {
    utilitySlab(b,"#c7b69b");
    b.box(.851,.365,.59,"#c8b69a",{z:-.144,y:.026},"plaster");
    b.box(.872,.036,.62,"#967f64",{z:-.141,y:.389},"stone");
    b.box(.438,.035,.142,"#aa9072",{x:-.111,z:.188,y:.307},"stone");
    rollerBay(b,-.176,.152,.251,.241,"#8d846d");
    deepWindow(b,.211,.136,.155,.126,.093,"#b6a484",true);
    for(let k=0;k<6;k++) b.box(.071,.039,.071,"#b7956c",{x:-.347+(k%3)*.083,z:.377,y:.027+Math.floor(k/3)*.042},"wood");
    processTank(b,.306,-.279,.082,.441,"#b1b1a5");
    yardMark(b,.189,.356,.216);
  },
  factory(b) {
    utilitySlab(b);
    b.box(.889,.361,.656,"#aabbaf",{z:-.136,y:.027},"plaster");
    for(let i=0;i<3;i++) {
      const x=-.296+i*.293;
      b.plate([[-.143,0],[-.143,.023],[.141,.148],[.141,0]],.661,"#89978d",{x,y:.385,z:-.137},"paint");
      b.box(.126,.024,.561,"#76888a",{x:x+.075,y:.443,z:-.14,rz:.382},"glass");
    }
    for(const x of [-.259,.01]) rollerBay(b,x,.202,.19,.198,"#788981");
    for(const x of [.257,.385]) {
      b.cyl(.032,.049,.636,"#817e71",{x,z:.095,y:.024},9,"metal");
      b.cyl(.035,.035,.021,"#b17460",{x,z:.095,y:.626},9,"paint");
    }
    for(const x of [-.255,.009]) yardMark(b,x,.361,.181);
  },

  well(b) {
    stoneApron(b,"#b09a7b");
    b.lathe([[.23,.023],[.22,.166],[.205,.177],[.158,.175],[.148,.153],[.147,.06]],
      "#b89b77",{},15,"stone");
    b.cyl(.151,.151,.008,"#437c76",{y:.074},14,"shiny");
    for(const x of [-.204,.204]) b.box(.039,.392,.04,"#79614a",{x,z:-.019,y:.028},"wood");
    for(const x of [-.154,.154]) b.box(.09,.019,.034,"#6b5842",{x,y:.325,z:-.019,rz:x>0?.56:-.56},"wood");
    b.box(.481,.041,.043,"#79614a",{y:.416,z:-.019},"wood");
    b.cyl(.02,.02,.315,"#a78965",{y:.353,z:-.02,x:.153,rz:Math.PI/2},8,"wood");
    b.cyl(.006,.006,.172,"#625641",{x:.034,y:.173,z:.022},5);
    b.lathe([[.023,.142],[.04,.15],[.045,.202],[.037,.203],[.031,.169]],"#827259",{x:.034,z:.022},9,"wood");
    b.box(.208,.033,.117,"#a58b69",{x:.303,z:.157,y:.025},"stone");
    b.box(.162,.007,.086,"#6d8b78",{x:.301,z:.157,y:.054},"shiny");
  },
  // The mushroom water tower seen in towns across the Kingdom.
  tank(b) {
    utilitySlab(b);
    b.cyl(.10,.134,.049,"#a7a188",{y:.024},12,"stone");
    b.cyl(.061,.077,.711,"#c1bdad",{y:.069},12,"plaster");
    b.lathe([[.068,0],[.123,.053],[.257,.117],[.274,.147],[.274,.242],[.231,.267],[.067,.283],[0,.287]],
      "#bfd2d0",{y:.763},18,"paint");
    for(const y of [.906,.981]) b.cyl(.277,.277,.013,"#79959a",{y},18,"paint");
    processPipe(b,[[.051,.026,.032],[.106,.087,.037],[.107,.71,.037],[.115,.805,.031]],.011,"#688389");
    for(const z of [-.022,.029]) b.box(.006,.68,.006,"#666c60",{x:.079,z,y:.066},"metal");
    for(let i=0;i<12;i++) b.box(.005,.005,.054,"#777c6e",{x:.079,z:.005,y:.108+i*.053},"metal");
    b.cyl(.03,.034,.021,"#a5ad9f",{y:1.049},10,"metal");
    b.cyl(.008,.008,.037,"#b46556",{x:-.108,y:1.049,z:-.053},6,"lights");
  },
  desal(b) {
    utilitySlab(b,"#c2beb0");
    b.box(.466,.307,.486,"#dad9c7",{x:-.213,y:.024,z:-.159},"plaster");
    b.box(.497,.033,.52,"#a9afa1",{x:-.213,y:.327,z:-.159},"paint");
    rollerBay(b,-.221,.104,.235,.186,"#738888");
    for(const [x,z] of [[.212,-.248],[.212,.033],[.258,.314]]) processTank(b,x,z,.104,.273,"#aab8b3");
    processPipe(b,[[-.292,.102,.307],[-.136,.11,.315],[-.074,.174,.282],[-.031,.308,.212],[.218,.35,.142],[.219,.331,-.241]],.017,"#668a8c");
    processPipe(b,[[-.167,.106,.199],[.092,.116,.208],[.191,.131,.209],[.255,.198,.27],[.259,.306,.306]],.013,"#b29768");
    for(const x of [-.307,-.09,.397]) b.box(.029,.065,.034,"#a98e62",{x,y:.024,z:.407},"metal");
  },
  generator(b) {
    utilitySlab(b,"#b1ad9b");
    b.box(.766,.036,.424,"#5c615c",{y:.033,z:-.031},"metal");
    b.rbox(.681,.249,.366,.013,"#8e9882",{y:.065,z:-.035},"paint");
    b.box(.522,.019,.238,"#a6ad99",{x:-.028,y:.311,z:-.037},"paint");
    deepWindow(b,-.192,.116,.148,.103,.109,"#666e67",false);
    b.box(.328,.141,.016,"#505b55",{x:.125,y:.104,z:.154},"metal");
    for(let i=0;i<7;i++) b.box(.29,.006,.022,"#879487",{x:.127,y:.118+i*.017,z:.161},"metal");
    processPipe(b,[[.241,.313,-.167],[.246,.393,-.164],[.201,.455,-.162],[.148,.465,-.16]],.027,"#786b56");
    b.box(.124,.012,.071,"#b49b69",{x:.318,z:.306,y:.029});
    b.box(.014,.015,.02,"#d9a268",{x:-.262,y:.208,z:.168},"lights");
  },
  solar(b) {
    utilitySlab(b,"#c5b393");
    for(let rz=0;rz<3;rz++) for(let cx=0;cx<2;cx++) {
      const x=-.232+cx*.455,z=-.315+rz*.296;
      for(const side of [-1,1]) b.box(.011,.111,.012,"#777b72",{x:x+side*.118,z:z-.055},"metal");
      b.box(.356,.015,.196,"#a8b0aa",{x,y:.121,z,rx:-.35},"metal");
      b.box(.338,.008,.177,"#394f65",{x,y:.129,z,rx:-.35},"glass");
      for(let i=0;i<6;i++) b.box(.0028,.003,.175,"#839898",{x:x-.143+i*.057,y:.132,z,rx:-.35});
      for (const offset of [-.049,.019,.079]) b.box(.337,.003,.0022,"#839898",{x,y:.132+offset*.349,z:z+offset,rx:-.35});
    }
    b.box(.111,.109,.086,"#9c9f91",{x:.027,z:.414,y:.024},"paint");
  },
  powerplant(b) {
    utilitySlab(b,"#b6b09e");
    b.box(.593,.341,.44,"#b6bab1",{x:-.173,z:.149,y:.028},"plaster");
    b.box(.633,.038,.485,"#989e92",{x:-.174,z:.15,y:.364},"paint");
    rollerBay(b,-.183,.362,.248,.231,"#7b877e");
    for(const x of [-.275,.174]) {
      b.lathe([[.133,0],[.11,.14],[.082,.307],[.085,.42],[.11,.501],[.091,.506],[.072,.455]],
        "#b8beb6",{x,z:-.271,y:.026},14,"plaster");
      b.cyl(.069,.069,.007,"#66726a",{x,z:-.271,y:.46},12);
    }
    processPipe(b,[[.26,.04,.376],[.264,.09,.292],[.305,.145,.076],[.246,.145,-.088],[.174,.112,-.178]],.018,"#a39d77");
    b.cyl(.023,.034,.84,"#9b8b7a",{x:.361,z:.237,y:.026},9,"metal");
    for(const y of [.47,.61,.745]) b.cyl(.026,.028,.048,"#a16154",{x:.361,z:.237,y},9,"paint");
    b.box(.018,.018,.019,"#c8745a",{x:.363,z:.237,y:.87},"lights");
  },

  // Najdi mosque: mud walls, crenellations and a square, tapering minaret.
  mosque(b) {
    b.box(.795,.035,.696,"#ad8d66",{z:-.045},"stone");
    b.box(.76,.302,.66,"#c7a17b",{y:.019,z:-.05},"plaster");
    b.box(.208,.199,.022,"#b69c77",{y:.023,z:.283},"stone");
    b.box(.176,.019,.076,"#cab398",{y:.014,z:.31},"stone");
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
    const stone="#bac1b6", plaster="#ece9de", lime="#f5f0e5", dark="#627677";
    b.box(.98,.04,.98,stone);
    b.box(.81,.39,.64,plaster,{y:.035,z:-.13},"plaster");
    for(const u of [-1,1]) {
      b.box(.074,.432,.67,stone,{x:u*.385,z:-.117},"paint");
      b.box(.067,.02,.69,lime,{x:u*.386,y:.431,z:-.118});
      b.box(.073,.125,.38,stone,{x:u*.451,z:.258},"paint");
      b.box(.083,.017,.39,lime,{x:u*.451,y:.125,z:.258});
    }
    b.box(.865,.04,.69,stone,{y:.399,z:-.113});
    b.box(.812,.033,.647,lime,{y:.444,z:-.13});
    crenels(b,.83,.68,.46,plaster,.032);
    b.cyl(.222,.244,.093,stone,{y:.459,z:-.159},12);
    b.lathe([[.23,0],[.231,.047],[.211,.108],[.167,.163],[.097,.207],[.032,.222],[.004,.237]],"#467a76",{y:.542,z:-.159},18,"shiny");
    for (let i=0;i<12;i++) {
      const a=i*Math.PI/6, x=Math.sin(a)*.225,z=Math.cos(a)*.225-.159;
      b.box(.027,.022,.016,"#6c5643",{x,y:.50,z,ry:a});
      b.box(.018,.016,.017,C.light,{x,y:.504,z,ry:a},"lights");
    }
    b.cyl(.008,.014,.055,C.gold,{y:.775,z:-.159},6);
    b.add(new THREE.TorusGeometry(.025,.005,5,13,Math.PI*1.57),C.gold,{y:.848,z:-.159,rz:.75},"shiny");
    for(const x of [-.36,.36]) {
      b.cyl(.048,.085,.92,stone,{x,z:.268,ry:Math.PI/4},4,"paint");
      for(const y of [.08,.151,.407,.58,.876]) b.cyl(.062,.076,.026,lime,{x,y,z:.268,ry:Math.PI/4},4);
      b.box(.042,.09,.025,dark,{x,y:.734,z:.303});
      b.cyl(.049,.063,.058,plaster,{x,y:.892,z:.268},8);
      b.cone(.063,.123,"#507d78",{x,y:.95,z:.268},8,"shiny");
      b.box(.024,.049,.016,C.light,{x,y:.915,z:.319},"lights");
    }
    // Four plaster arches frame the covered walk and the square stone forecourt.
    for(const x of [-.244,-.081,.081,.244]) {
      const z=.214, span=.079;
      for(const dx of [-span,span]) b.box(.022,.19,.046,stone,{x:x+dx,y:.042,z},"paint");
      b.add(new THREE.TorusGeometry(span,.011,5,14,Math.PI),lime,{x,y:.229,z});
      b.add(new THREE.CircleGeometry(.061,10,0,Math.PI),dark,{x,y:.225,z:.191});
      b.box(.12,.151,.018,dark,{x,y:.064,z:.19},"glass");
      b.box(.088,.133,.021,C.light,{x,y:.075,z:.201},"lights");
    }
    b.box(.68,.026,.078,stone,{y:.35,z:.202});
    b.box(.68,.029,.1,lime,{y:.035,z:.433});
    for(let z=.294;z<.42;z+=.054) for(let i=0;i<7;i++) {
      b.box(.085,.004,.048,(i+Math.round(z*20))%2?"#c4c6bf":"#d7d6cd",{x:(i-3)*.088,y:.041,z});
    }
  },
  school(b) {
    const stone = "#bcac8d", wall="#ddd0b6";
    stoneApron(b,"#c2b59a");
    b.box(.853,.458,.471,wall,{y:.028,z:-.205},"plaster");
    b.box(.888,.036,.51,stone,{y:.478,z:-.205},"stone");
    b.box(.174,.291,.315,stone,{x:-.374,y:.027,z:.101},"stone");
    for (const x of [-.268,-.09,.088,.27]) for(const y of [.081,.291])
      deepWindow(b,x,y,.047,.104,.109,stone,(x===-.09&&y<.1));
    b.box(.47,.017,.301,"#878c73",{x:.18,y:.029,z:.24});
    for(const x of [-.037,.402]) b.box(.013,.007,.296,"#d5d4b9",{x,y:.046,z:.239});
    for(const z of [.1,.24,.38]) b.box(.433,.007,.009,"#d5d4b9",{x:.181,y:.047,z});
    b.cyl(.007,.007,.481,"#77796b",{x:-.402,z:.315,y:.025},5,"metal");
    b.box(.102,.065,.006,"#567564",{x:-.353,z:.319,y:.426,wind:.25});
    entryCanopy(b,-.116,.153,.246,.257,stone);
  },
  clinic(b) {
    const stone="#ccc4af", accent="#5d796e";
    stoneApron(b,"#bdb6a3");
    b.box(.637,.379,.514,"#e5dfcc",{x:-.09,y:.027,z:-.159},"plaster");
    b.box(.613,.052,.522,stone,{x:-.103,y:.402,z:-.158},"stone");
    b.box(.291,.256,.49,stone,{x:.269,y:.026,z:-.093},"stone");
    b.box(.281,.024,.493,accent,{x:.275,y:.277,z:-.09},"paint");
    deepWindow(b,-.269,.099,.106,.117,.162,stone,true);
    deepWindow(b,-.081,.101,.106,.118,.163,stone,false);
    deepWindow(b,.21,.048,.154,.138,.171,stone,true);
    crescent(b,.213,.324,.161);
    entryCanopy(b,.169,.248,.339,.257,stone);
    for (let i=0;i<4;i++) b.box(.185,.006,.009,"#c8bd9f",{x:.171,y:.031,z:.343+i*.027});
  },
  hospital(b) {
    const limestone="#e1e5e3", panel="#809296", glass="#67929f";
    modernCourt(b);
    b.box(.614,.792,.636,"#e7ebeb",{x:-.14,y:.027,z:-.137},"plaster");
    b.box(.34,.872,.483,glass,{x:.277,y:.03,z:-.176},"glass");
    b.box(.196,.637,.03,panel,{x:.294,y:.098,z:.071},"paint");
    b.box(.64,.035,.653,limestone,{x:-.139,y:.81,z:-.134},"paint");
    for(const y of [.089,.276,.46,.645]) {
      glassWall(b,-.14,.187,y,.52,.113,5,"#7298a3");
      if(y===.089 || y===.46) b.box(.089,.044,.009,"#ead8aa",{x:-.18,z:.212,y:y+.023},"lights");
      b.box(.346,.012,.499,panel,{x:.275,y:y+.041,z:-.175},"paint");
    }
    b.cyl(.168,.168,.009,"#6d766a",{x:-.167,y:.847,z:-.151},18);
    b.add(new THREE.TorusGeometry(.134,.005,4,18),"#dfce97",{x:-.167,y:.859,z:-.151,rx:Math.PI/2});
    for (const x of [-.204,-.137]) b.box(.016,.005,.115,"#e6dcb8",{x,y:.856,z:-.151});
    b.box(.069,.006,.019,"#e6dcb8",{x:-.169,y:.857,z:-.151});
    crescent(b,.287,.746,.083);
    entryCanopy(b,-.012,.277,.559,.298,limestone,"metal");
    b.box(.666,.022,.145,panel,{x:-.03,y:.034,z:.383},"paint");
  },
  park(b) {
    b.box(0.97, 0.022, 0.97, C.stone);
    for (const x of [-0.29, 0.29]) for (const z of [-0.29, 0.29]) {
      b.box(0.336, 0.017, 0.336, (x > 0) === (z > 0) ? "#59794f" : "#6e8751", { x, y: 0.023, z });
      for (const offset of [-0.09, 0.09]) b.add(new THREE.IcosahedronGeometry(0.037, 0), offset > 0 ? "#b55f43" : "#e3b65e", { x: x + offset, y: 0.05, z: z + 0.115, wind: 0.6 });
    }
    b.cyl(0.17, 0.18, 0.03, "#dfc6a0", { y: 0.017 }, 8);
    b.cyl(0.115, 0.125, 0.059, C.plaster, { y: 0.021 }, 9);
    b.cyl(0.09, 0.09, 0.009, C.water, { y: 0.076 }, 10, "shiny");
    oliveTree(b, -0.29, -0.29, 1.16); tree(b, 0.29, -0.29, 0.82); tree(b, -0.29, 0.29, 0.88); palm(b, 0.29, 0.29, 0.74);
    for(const x of [-.37,.37]) civicBench(b,x,0,Math.PI/2);
    for(const z of [-.31,-.217,.217,.31]) b.box(.172,.005,.01,"#b4a996",{y:.023,z},"stone");
  },
  police(b) {
    const stone="#bbb19e", accent="#636f79";
    stoneApron(b,"#c1b7a4");
    b.box(.752,.421,.623,"#d8d1be",{y:.029,z:-.156},"plaster");
    b.box(.771,.038,.641,stone,{y:.444,z:-.156},"stone");
    b.box(.436,.031,.019,accent,{y:.352,z:.17},"paint");
    deepWindow(b,-.253,.096,.165,.122,.154,stone,false);
    deepWindow(b,.239,.099,.165,.119,.15,stone,false);
    b.box(.164,.198,.014,"#475b66",{y:.03,z:.169},"glass");
    entryCanopy(b,0,.246,.272,.258,stone);
    sedan(b,.251,.354,-Math.PI/2,"#e2e1d6");
    b.box(.042,.021,.013,accent,{x:.257,y:.128,z:.354},"lights");
    for (const x of [-.36,-.26]) b.cyl(.014,.017,.081,"#827c69",{x,z:.386,y:.026},6,"metal");
  },
  civil(b) {
    const red="#9f5147", stone="#c5b49a";
    stoneApron(b,"#b4a992");
    b.box(.871,.376,.651,"#c6b49b",{y:.027,z:-.139},"stone");
    b.box(.887,.042,.671,stone,{y:.403,z:-.139},"plaster");
    b.box(.86,.032,.02,red,{y:.325,z:.199},"paint");
    for(const x of [-.258,.03]) rollerBay(b,x,.197,.212,.231,red);
    deepWindow(b,.288,.086,.196,.112,.147,stone,true);
    b.box(.727,.028,.125,"#aca891",{y:.297,z:.25},"stone");
    for(let i=0;i<4;i++) b.box(.158,.006,.01,"#b0a185",{x:.025,y:.025,z:.306+i*.04});
    b.cyl(.009,.01,.133,"#747e78",{x:.359,z:-.30,y:.441},6,"metal");
    b.box(.023,.019,.023,"#b35d4d",{x:.359,z:-.3,y:.562},"lights");
  },
  stadium(b) {
    stoneApron(b,"#b8ab94",.963);
    markedPitch(b,.696,.518,.027);
    for(const side of [-1,1]) {
      for(let step=0;step<4;step++) b.box(.817,.025,.047,step%2?"#b3a58d":"#aa9c83",{z:side*(.286+step*.043),y:.026+step*.028},"stone");
      b.box(.799,.016,.133,"#979f8f",{z:side*.387,y:.236},"paint");
      for(const x of [-.37,0,.37]) b.box(.012,.122,.012,"#898c7f",{x,z:side*.45,y:.111},"metal");
    }
    for(const [x,z] of [[-.431,-.315],[.43,.315]]) {
      b.cyl(.009,.013,.61,"#858a7f",{x,z,y:.025},6,"metal");
      b.box(.09,.033,.025,"#7a8279",{x,z,y:.614},"metal");
      b.box(.077,.018,.026,C.light,{x,z:z+.005,y:.621},"lights");
    }
  },
  university(b) {
    const wall="#e9e7dd", limestone="#c6cfcc", trim="#66838d";
    modernCourt(b);
    for(const x of [-.282,.283]) {
      b.box(.297,.486,.629,wall,{x,y:.027,z:-.151},"plaster");
      b.box(.317,.041,.655,limestone,{x,y:.51,z:-.15},"paint");
      for(const y of [.111,.338]) glassWall(b,x,.175,y,.218,.115,3,"#748f9e");
    }
    b.box(.277,.292,.467,trim,{z:-.238,y:.03},"paint");
    b.box(.219,.203,.018,"#455d65",{z:.009,y:.059},"glass");
    for(const x of [-.163,0,.163]) b.box(.039,.301,.049,limestone,{x,y:.03,z:.257},"paint");
    b.box(.419,.032,.414,limestone,{y:.328,z:.141},"paint");
    b.box(.255,.051,.249,"#809394",{y:.362,z:.077},"glass");
    for(const x of [-.378,.381]) oliveTree(b,x,.354,.9);
    b.box(.296,.013,.148,wall,{y:.038,z:.368},"paint");
  },

  // ---------- decorations ----------
  streetpalm(b) { // straight out of the sand (no planter: the owner wants no kerb under them)
    b.cyl(0.07, 0.09, 0.012, C.soil, {}, 9);
    palm(b, 0, 0, 0.95, 0);
  },
  flowers(b) {
    b.box(.552,.018,.357,"#ac9d86",{},"stone");
    b.box(.516,.045,.312,"#bdab90",{y:.015},"stone");
    for(const z of [-.147,.147]) b.box(.524,.014,.022,"#e0ccad",{y:.056,z},"stone");
    b.box(0.46, 0.02, 0.26, C.soil, { y: 0.06 });
    const cols = ["#e74c3c", "#f4d03f", "#ffffff", "#e8a0b4", "#a77bca"];
    for (let i = 0; i < 14; i++) { const x = -0.19 + (i % 7) * 0.063, z = -0.07 + Math.floor(i / 7) * 0.14; b.add(new THREE.IcosahedronGeometry(0.028, 0), C.leaf, { x, y: 0.09, z }); b.add(new THREE.SphereGeometry(0.018, 5, 4), cols[i % cols.length], { x, y: 0.12, z }); }
  },
  // A wooden power pole with a cross arm; the wires are drawn between poles by the world.
  pole(b) {
    b.box(0.12, 0.03, 0.12, C.stone);
    b.cyl(.028,.038,.95,"#81674c",{y:.03},7,"wood");
    b.box(.078,.055,.067,"#807f71",{y:.214},"paint");
    b.cyl(.04,.04,.011,"#53534a",{y:.298},8,"metal");
    b.cyl(.033,.033,.01,"#53534a",{y:.845},8,"metal");
    b.box(0.42, 0.035, 0.05, "#6b4e33", { y: 0.88 });
    for (const x of POLE_INSULATORS) b.cyl(0.014, 0.014, 0.05, "#e9e4d8", { x, y: POLE_WIRE_HEIGHT - 0.05 }, 5, "shiny");
  },
  lantern(b) {
    b.lathe([[.032,0],[.03,.06],[.024,.115],[.015,.389],[.026,.409],[.044,.425]],"#564d40",{},9,"metal"); // the post stands in the ground, no stone base
    b.cyl(.051,.046,.02,"#766049",{y:.42},8,"metal");
    b.cyl(.033,.026,.1,"#d3b48b",{y:.439},8,"matte");
    b.cyl(.034,.029,.102,"#ffd197",{y:.438},8,"lights");
    for(let i=0;i<4;i++) {
      const a=i*Math.PI/2+Math.PI/4;
      b.add(new THREE.BoxGeometry(.008,.116,.008),"#574639",{x:Math.cos(a)*.047,z:Math.sin(a)*.047,y:.492,rz:.029},"metal");
    }
    b.cyl(.063,.059,.018,"#6e5946",{y:.536},8,"metal");
    b.lathe([[.06,0],[.049,.023],[.032,.04],[.013,.058]],"#6e5946",{y:.551},8,"paint");
    b.add(new THREE.SphereGeometry(.013,6,4),"#a9845c",{y:.615},"metal");
  },
  fountain(b) { // (no paved square under a decoration: it takes only its own size on the ground)
    b.lathe([[.364,.029],[.365,.096],[.349,.108],[.315,.11],[.303,.054]],"#b9a78c",{},20,"stone");
    b.cyl(.308,.308,.008,"#4b8d83",{y:.068},20,"shiny");
    b.lathe([[.089,.077],[.063,.159],[.031,.223],[.04,.276],[.114,.306],[.128,.332],[.12,.342],[.082,.339]],
      "#d0c3a9",{},15,"stone");
    b.cyl(.093,.093,.006,"#4b8d83",{y:.333},12,"shiny");
    for(let i=0;i<8;i++) {
      const a=i*Math.PI/4,x=Math.sin(a)*.359,z=Math.cos(a)*.359;
      b.box(.019,.025,.011,"#a3967c",{x,z,y:.083,ry:a},"stone");
    }
  },
  // A roundabout with a giant dallah (Arabic coffee pot) on a plinth.
  dallah(b) {
    b.lathe([[.39,.026],[.398,.06],[.38,.079],[.353,.085]],"#d1c1a7",{},20,"stone");
    b.cyl(.339,.339,.012,"#808b63",{y:.072},20);
    b.cyl(.131,.158,.11,"#b8a88c",{y:.081},12,"stone");
    b.lathe([[.035,0],[.074,.022],[.107,.076],[.104,.143],[.066,.184],[.048,.218],[.053,.231],[.083,.24],[.056,.276],[.02,.29],[0,.31]],
      "#b38b50",{y:.193},16,"metal");
    processPipe(b,[[.085,.318,0],[.124,.357,0],[.16,.418,0],[.214,.451,0]],.018,"#b58d53");
    processPipe(b,[[-.051,.414,0],[-.136,.415,0],[-.151,.356,0],[-.109,.3,0]],.014,"#b58d53");
    for(const x of [-.276,.276]) b.box(.027,.016,.027,"#dfbc76",{x,z:.114,y:.085},"lights");
  },
  // A giant mabkhara (incense burner) with a wisp of smoke.
  incense(b) {
    b.box(.342,.061,.342,"#b4a387",{y:.026},"stone");
    b.lathe([[.101,0],[.091,.067],[.056,.153],[.065,.208],[.128,.26],[.143,.302],[.132,.32],[.097,.307],[.08,.265]],
      "#92745a",{y:.086,ry:.79},4,"wood");
    for(const [x,z] of [[-.126,0],[.126,0],[0,-.126],[0,.126]])
      b.box(x?.011:.136,.025,x?.136:.011,"#c89e63",{x,z,y:.341},"metal");
    b.cyl(.074,.08,.012,"#524036",{y:.359},9);
    for(const [x,z] of [[-.038,.011],[.025,.028],[.014,-.034]]) b.add(new THREE.IcosahedronGeometry(.021,0),"#ba6a46",{x,z,y:.377},"lights");
  },

  // ---------- grand projects ----------
  gate(b) {
    const wall="#ba9d77", cap="#d4bd95";
    b.box(.972,.018,.628,"#b2a183",{},"stone");
    for (const x of [-.344,.344]) {
      b.box(.246,.098,.434,"#a58a67",{x},"stone");
      b.box(.195,.59,.327,wall,{x,y:.095},"stone");
      b.box(.218,.035,.355,cap,{x,y:.681},"stone");
      b.box(.076,.122,.016,"#5e5040",{x,y:.46,z:.168},"wood");
      b.box(.031,.064,.022,C.light,{x,y:.474,z:.178},"lights");
      graft(b,g=>crenels(g,.211,.339,.717,cap,.025),{x});
    }
    for(const x of [-.181,.181]) b.box(.09,.393,.265,wall,{x,y:.018},"stone");
    for(let i=0;i<13;i++) {
      const a=(i+.5)*Math.PI/13;
      b.box(.054,.072,.281,i%2 ? cap : "#c4aa85",{x:Math.cos(a)*.177,y:.365+Math.sin(a)*.177,z:0,rz:a-Math.PI/2},"stone");
    }
    b.box(.493,.092,.31,wall,{y:.524},"stone");
    b.box(.513,.024,.334,cap,{y:.614},"stone");
    b.box(.222,.039,.015,"#5f7867",{y:.549,z:.165},"paint");
    for(const x of [-.141,.141]) b.box(.024,.048,.014,C.light,{x,y:.55,z:.177},"lights");
    for(let i=0;i<7;i++) b.box(.058,.009,.199,i%2?"#c1ac89":"#d3bb95",{x:(i-3)*.06,y:.018,z:.232},"stone");
  },
  heritage(b) {
    b.box(0.96, 0.012, 0.96, "#d8bf8f");
    const blocks = [[-0.25, -0.25, 0.42, 0.36, 0.34], [0.22, -0.28, 0.4, 0.3, 0.3], [-0.28, 0.2, 0.34, 0.28, 0.4], [0.24, 0.2, 0.36, 0.26, 0.36]];
    for (const [x, z, w, h, d] of blocks) {
      b.box(w+.02,.05,d+.02,"#9e8269",{x,z},"stone");
      b.box(w,h,d,"#c09b77",{x,z,y:.03},"plaster");
      b.box(w + 0.02, 0.025, d + 0.02, C.mudDark, { x, y: h, z });
      graft(b,g=>crenels(g,w,d,h+.03,"#cdb291",.03),{x,z});
      b.box(0.07, 0.12, 0.01, C.door, { x, z: z + d / 2 + 0.005 });
      b.box(0.05, 0.04, 0.012, C.light, { x: x + w * 0.3, y: h * 0.55, z: z + d / 2 + 0.006 }, "lights");
    }
    for (const [x,color] of [[-.13,"#9e6050"],[0,"#6a8171"],[.13,"#b79c6b"]]) {
      b.box(.117,.022,.369,color,{x,y:.216,z:.092,rx:.19},"matte");
      b.box(.112,.034,.028,"#87715a",{x,y:.205,z:.284},"wood");
      b.box(.073,.061,.042,"#977658",{x,y:.026,z:.296},"wood");
    }
    for (let i = 0; i < 4; i++) b.box(0.012, 0.012, 0.6, "#3b2a1c", { x: -0.3 + i * 0.2, y: 0.32 });
    for (let i = 0; i < 5; i++) b.add(new THREE.SphereGeometry(0.018, 5, 4), C.light, { x: -0.3 + i * 0.15, y: 0.3, z: (i % 2) * 0.1 - 0.05 }, "lights");
    b.cyl(0.03, 0.05, 0.06, C.gold, { x: 0.02, z: 0.05 }, 8, "shiny");
  },
  tower(b) { civicTower(b); },
  airport(b) { airportTerminal(b); },

  // ---------- the big expansion: al-Jouf's olives, wind, heritage, and a skyline ----------
  olive(b) {
    b.box(.94,.017,.94,"#ad936d");
    for(const z of [-.277,0,.277]) {
      b.box(.863,.015,.137,"#987b58",{y:.015,z});
      b.box(.826,.007,.01,"#615e50",{y:.031,z:z+.06});
    }
    for (const [w, d, x, z] of [[0.94, 0.03, 0, -0.46], [0.94, 0.03, 0, 0.46], [0.03, 0.94, -0.46, 0], [0.03, 0.94, 0.46, 0]]) b.box(w, 0.05, d, "#c9b48a", { x, z });
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) oliveTree(b, -0.28 + c * 0.28, -0.28 + r * 0.28, 0.8 + ((r + c) % 3) * 0.08);
    b.box(0.8, 0.008, 0.012, "#3b3f44", { y: 0.016, z: 0.14 }); b.box(0.8, 0.008, 0.012, "#3b3f44", { y: 0.016, z: -0.14 });
  },
  oilpress(b) {
    utilitySlab(b,"#c0b69f");
    b.box(.624,.312,.488,"#d5c8ad",{x:-.12,z:-.17,y:.026},"stone");
    b.box(.671,.043,.516,"#838e65",{x:-.126,z:-.169,y:.334},"paint");
    rollerBay(b,-.157,.081,.229,.186,"#77816a");
    for(const z of [-.265,.015]) processTank(b,.275,z,.099,.379,"#aab1a4");
    processPipe(b,[[.295,.33,-.267],[.302,.41,-.161],[.303,.408,-.049],[.277,.367,.035]],.014,"#9e9366");
    for(let i=0;i<4;i++) b.cyl(.03,.03,.073,i%2?"#8e975d":"#717e50",{x:-.294+i*.088,z:.323,y:.029},9,"paint");
    oliveTree(b,.324,.311,.83);
  },
  windfarm(b) {
    b.box(.96,.012,.96,"#bba986");
    b.box(.155,.018,.91,"#c9c0ac",{x:.026,z:0},"stone");
    for (const [x, z, s] of WIND_TOWERS) {
      b.cyl(.085*s,.107*s,.031,"#9f9d8d",{x,z},10,"stone");
      b.cyl(.018*s,.032*s,1.5*s,"#e0e1d9",{x,z},10,"paint");
      b.cyl(.033*s,.033*s,.033,"#81897c",{x,z,y:.034},9,"metal");
      b.box(.026,.071,.011,"#7b8b86",{x,z:z+.033,y:.04},"metal");
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
    const wall="#dde3df", stone="#a2b5b5";
    modernCourt(b);
    b.box(.785,.382,.652,wall,{y:.025,z:-.131},"paint");
    b.box(.821,.039,.663,stone,{y:.401,z:-.13},"paint");
    b.box(.38,.225,.015,"#627a76",{y:.069,z:.199},"glass");
    for(const x of [-.285,-.173,-.061,.061,.173,.285]) b.box(.019,.232,.034,"#64777a",{x,y:.068,z:.216},"metal");
    b.box(.563,.03,.146,stone,{y:.313,z:.275},"paint");
    for(const x of [-.254,.257]) b.box(.024,.284,.024,"#786f60",{x,y:.028,z:.323});
    b.box(.355,.041,.273,"#798a83",{x:-.129,y:.441,z:-.193},"glass");
    oliveTree(b,-.344,.359,.8); pot(b,.354,.357,.85);
    for (const x of [-.142,.142]) b.box(.084,.03,.015,"#e7ce9b",{x,y:.144,z:.211},"lights");
  },
  olivetree(b) {
    b.cyl(.4,.423,.06,"#b6a287",{},18,"stone");
    b.add(new THREE.TorusGeometry(.385,.017,5,18),"#d6c2a3",{y:.069,rx:Math.PI/2},"stone");
    b.cyl(0.36, 0.36, 0.02, "#7db35a", { y: 0.06 }, 18);
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; b.add(new THREE.SphereGeometry(0.025, 5, 4), i % 2 ? "#f4d03f" : "#ffffff", { x: Math.cos(a) * 0.3, y: 0.09, z: Math.sin(a) * 0.3 }); }
    oliveTree(b, 0, 0, 2.2);
  },
  bigfountain(b) {
    b.lathe([[.44,.027],[.447,.094],[.425,.119],[.388,.117],[.375,.063]],"#c8b497",{},24,"stone");
    b.cyl(.387,.387,.008,"#498f84",{y:.081},24,"shiny");
    for(let i=0;i<8;i++) {
      const a=i*Math.PI/4,x=Math.cos(a)*.29,z=Math.sin(a)*.29;
      b.cyl(.016,.021,.02,"#827867",{x,z,y:.081},8,"metal");
      b.cyl(.013,.016,.008,i%2?"#81c7cb":"#eac679",{x:x*1.13,z:z*1.13,y:.083},7,"lights");
    }
    b.lathe([[.111,.081],[.08,.151],[.064,.289],[.112,.348],[.151,.376],[.166,.41],[.149,.43],[.102,.428]],
      "#cbb89d",{},18,"stone");
    b.cyl(.124,.124,.009,"#4d9084",{y:.418},18,"shiny");
  },
  marid(b) {
    stoneApron(b,"#af9775");
    b.add(new THREE.CylinderGeometry(.386,.459,.166,9),"#a89072",{y:.097,ry:.245},"stone");
    const masonry="#b3946c", rim="#c7ad87";
    b.box(.675,.263,.649,masonry,{y:.175,z:-.025},"stone");
    for(const [x,z] of [[-.308,-.286],[.308,-.286],[-.308,.274],[.308,.274]]) {
      b.cyl(.071,.11,.53,masonry,{x,z,y:.144},10,"stone");
      b.cyl(.089,.079,.025,rim,{x,z,y:.662},10,"stone");
      for(let i=0;i<6;i++) {
        const a=i*Math.PI/3;
        b.box(.03,.041,.029,rim,{x:x+Math.cos(a)*.077,z:z+Math.sin(a)*.077,y:.686});
      }
    }
    b.box(.592,.077,.53,"#b99b73",{y:.437,z:-.047},"stone");
    crenels(b,.615,.548,.501,"#bda27b",.037);
    adobeDoor(b,.014,.198,.296,.133,.168,"#755b43");
    for(let i=0;i<4;i++) b.box(.193,.023,.046,rim,{x:.014,z:.373+i*.024,y:.146-i*.031},"stone");
    for(const x of [-.213,.219]) b.box(.022,.028,.012,"#dfba80",{x,z:.311,y:.329},"lights");
    b.cyl(.007,.007,.176,"#80725b",{x:.308,z:.272,y:.724},6,"metal");
    b.box(.094,.043,.004,"#6c876d",{x:.352,z:.273,y:.855,wind:.26});
  },
  themepark_b(b) {
    stoneApron(b,"#c5b493",.966);
    const {x,y,z}=FAIR_WHEEL;
    for(const dz of [-.071,.071]) for(const side of [-1,1]) {
      b.add(new THREE.BoxGeometry(.031,y,.034),"#a59e89",{x:x+side*.12,y:y*.5,z:z+dz,rz:side*.45},"metal");
      b.box(.088,.035,.063,"#a69e8a",{x:x+side*.222,y:.025,z:z+dz},"stone");
    }
    b.cyl(.031,.031,.192,"#6b7775",{x,y:y-.091,z,rx:Math.PI/2},8,"metal");
    b.cyl(.169,.177,.035,"#bdab8a",{x:.274,z:.263,y:.028},16,"stone");
    b.cyl(.14,.149,.014,"#687c6c",{x:.274,z:.263,y:.06},16,"paint");
    for(let i=0;i<6;i++) {
      const a=i*Math.PI/3, x=.274+Math.cos(a)*.11, z=.263+Math.sin(a)*.11;
      b.cyl(.008,.008,.157,"#8f7b53",{x,z,y:.073},5,"metal");
      b.add(new THREE.SphereGeometry(.028,8,5),i%2?"#a16855":"#afb393",{x,z,y:.112,sy:.64});
    }
    b.cone(.166,.111,"#a76050",{x:.274,z:.263,y:.223},12,"paint");
    b.cyl(.167,.167,.02,"#dfc9a3",{x:.274,z:.263,y:.211},12,"stone");
    for(const x of [-.356,-.194]) civicBench(b,x,.379);
    b.box(.169,.112,.131,"#baaa8e",{x:-.355,z:.189,y:.026},"stone");
    b.box(.181,.022,.15,"#6b8170",{x:-.355,z:.19,y:.137},"paint");
    b.box(.093,.052,.014,"#bbcead",{x:-.355,z:.26,y:.073},"lights");
  },
  themepark(b) {
    MAKERS.themepark_b(b);
    const {x,y,z,radius,cabins}=FAIR_WHEEL;
    graft(b,MAKERS.fairWheel,{x,y,z});
    for(let i=0;i<cabins;i++) {
      const a=i*Math.PI*2/cabins;
      graft(b,MAKERS.fairCabin,{x:x+Math.cos(a)*radius,y:y+Math.sin(a)*radius,z});
    }
  },
  fairWheel(b) {
    const {radius,cabins}=FAIR_WHEEL;
    for(const z of [-.032,.032]) {
      b.add(new THREE.TorusGeometry(radius,.012,5,28),"#aa6855",{z},"paint");
      for(let i=0;i<cabins;i++) {
        const a=i*Math.PI*2/cabins, x=Math.cos(a), y=Math.sin(a);
        b.add(new THREE.BoxGeometry(.01,radius,.011),"#bcc0ad",{x:x*radius*.5,y:y*radius*.5,z,rz:a-Math.PI/2},"metal");
      }
    }
    b.cyl(.042,.042,.083,"#838e82",{y:-.042,rx:Math.PI/2},10,"metal");
  },
  fairCabin(b) {
    b.box(.014,.039,.019,"#8b8a77",{y:-.041},"metal");
    b.box(.066,.039,.065,"#4e8278",{y:-.079},"paint");
    b.box(.056,.019,.067,"#819c91",{y:-.064},"glass");
    b.box(.07,.012,.07,"#d2ad76",{y:-.042},"paint");
  },
  station(b) {
    utilitySlab(b,"#c2b6a0");
    b.box(.95,.014,.216,"#7e6d59",{z:.322,y:.027},"paint");
    for(let i=0;i<12;i++) b.box(.026,.009,.184,"#79634e",{x:-.448+i*.081,z:.32,y:.041},"wood");
    for(const z of [.269,.371]) b.box(.95,.009,.009,"#a4a8a2",{z,y:.048},"metal");
    b.box(.849,.311,.371,"#cfc4ac",{z:-.23,y:.026},"paint");
    b.box(.887,.024,.497,"#b4b4a3",{z:-.17,y:.342},"paint");
    for(const x of [-.375,-.206,-.038,.13,.298]) deepWindow(b,x,.112,-.039,.103,.092,"#b5a991");
    b.box(.919,.037,.154,"#cbbfa8",{z:.131,y:.027},"paint");
    b.box(.821,.008,.011,"#c5ad66",{z:.191,y:.064});
    for(const x of [-.362,-.122,.119,.36]) b.box(.018,.212,.02,"#777c6e",{x,z:.107,y:.062},"metal");
    b.box(.889,.021,.178,"#9baba4",{z:.084,y:.273},"paint");
    for(const x of [-.242,.163]) {
      b.rbox(.378,.091,.105,.012,"#dbdfd0",{x,z:.319,y:.053},"paint");
      b.box(.362,.027,.109,"#658682",{x,z:.319,y:.085},"paint");
      for(const dx of [-.115,0,.115]) b.box(.064,.023,.11,"#455d64",{x:x+dx,z:.319,y:.112},"glass");
    }
    b.add(new THREE.SphereGeometry(.048,9,6),"#dcdfd1",{x:.36,y:.096,z:.319,sx:.92,sy:.84},"paint");
    b.box(.01,.027,.071,"#51686c",{x:.397,z:.32,y:.104},"glass");
  },
  bigstadium(b) {
    stoneApron(b,"#b9ae98",.978);
    markedPitch(b,.592,.384,.027);
    for(let step=0;step<4;step++) {
      const r=.34+step*.029;
      const g=new THREE.CylinderGeometry(r+.024,r,.048,28,1,true);
      b.add(g,step%2?"#a1947b":"#87917b",{y:.066+step*.047,sz:.84},"paint"); g.dispose();
    }
    for(const x of [-.446,.446]) b.box(.096,.075,.154,"#ad9b80",{x,y:.025,z:.034},"paint");
    for(let i=0;i<12;i++) {
      const a=i*Math.PI/6,x=Math.cos(a)*.454,z=Math.sin(a)*.39;
      b.box(.022,.211,.027,"#9e9d8c",{x,z,y:.067,ry:-a},"metal");
      if(i%3!==1) b.box(.132,.021,.105,"#b8bcac",{x:x*.94,z:z*.94,y:.29,ry:-a},"paint");
    }
    for(const x of [-.428,.429]) for(const z of [-.303,.303]){
      b.cyl(.008,.01,.501,"#8c9386",{x,z,y:.023},5,"metal");
      b.box(.056,.02,.023,"#e2d2a3",{x,z,y:.517},"lights");
    }
  },
  skyline(b) { officeQuarter(b); },

  // A contemporary residential tower steps back near its illuminated crown.
  house5(b) {
    modernCourt(b);
    b.rbox(.84,.249,.68,.039,"#bcb9af",{z:-.065,y:.022},"paint");
    glassWall(b,0,.279,.054,.719,.154,7,"#729199");
    b.box(.784,.028,.229,CITY.graphite,{z:.304,y:.235},"metal");
    b.box(.703,.008,.014,"#e7c798",{z:.416,y:.237},"lights");
    const tiers = [
      {x:-.077,z:-.081,y:.271,width:.648,depth:.554,height:1.694},
      {x:.067,z:-.122,y:1.963,width:.462,depth:.438,height:.691}
    ];
    for(const {x,z,y,width,depth,height} of tiers) {
      b.rbox(width,height,depth,.039,"#507586",{x,y,z},"glass");
      for(const side of [-1,1]) {
        b.box(.022,height,.022,CITY.bronze,{x:x+side*(width/2-.018),y,z:z+depth/2-.01},"metal");
        b.box(.035,height,.028,"#b1b5b1",{x:x+side*(width/2-.022),y,z:z-depth/2+.014},"metal");
      }
      for(let level=.119;level<height;level+=.156) {
        b.rbox(width+.018,.013,depth+.016,.007,"#a1acac",{x,y:y+level,z},"metal");
        if(Math.round(level/.156)%3===0) b.box(width*.35,.042,.014,"#f0cd9a",{x:x+.03,y:y+level+.027,z:z+depth/2},"lights");
      }
      b.rbox(width+.06,.046,depth+.048,.019,CITY.pearl,{x,y:y+height,z},"paint");
      b.rbox(width+.045,.01,depth+.036,.005,"#e6c38b",{x,y:y+height+.019,z},"lights");
    }
    const wingX=.304;
    b.rbox(.173,1.525,.363,.023,"#3d535b",{x:wingX,y:.267,z:-.036},"glass");
    for(let f=0;f<8;f++) {
      const y=.347+f*.178;
      b.box(.167,.016,.1,CITY.pearl,{x:wingX,y,z:.179},"paint");
      b.box(.161,.041,.012,"#7c9da9",{x:wingX,y:y+.016,z:.224},"glass");
    }
    for(const x of [-.355,.346]) b.box(.107,.028,.117,"#6f886e",{x,z:.364,y:.022});
    oliveTree(b,-.352,.359,.63);
  },

  buildFx(b) { // the quick build animation's site (js/world3d.js): a hoarding, steel scaffolding with planks and green netting around the footprint
    for (const [x, z, w, d] of [[0, -0.44, 0.88, 0.01], [-0.44, 0, 0.01, 0.88], [0.44, 0, 0.01, 0.88], [-0.25, 0.44, 0.38, 0.01], [0.25, 0.44, 0.38, 0.01]]) { b.box(w, 0.09, d, "#f1eee6", { x, z }); b.box(w + 0.002, 0.022, d + 0.002, "#2f7d5b", { x, y: 0.045, z }); }
    const H = 0.62, R = 0.37;
    for (const [x, z] of [[-R, -R], [R, -R], [-R, R], [R, R], [0, -R], [0, R], [-R, 0], [R, 0]]) b.box(0.008, H, 0.008, "#c9a24a", { x, z }, "metal");
    for (let k = 1; k <= 4; k++) {
      const y = k * H / 4.3;
      for (const [x, z, w, d] of [[0, -R, 2 * R, 0.006], [0, R, 2 * R, 0.006], [-R, 0, 0.006, 2 * R], [R, 0, 0.006, 2 * R]]) b.box(w, 0.006, d, "#c9a24a", { x, y, z }, "metal");
      for (const [x, z, w, d] of [[0, -R - 0.03, 2 * R, 0.05], [0, R + 0.03, 2 * R, 0.05]]) b.box(w, 0.006, d, "#a0783a", { x, y: y - 0.008, z }, "wood");
    }
    for (const side of [-1, 1]) b.box(2 * R * 0.9, H * 0.55, 0.004, "#3f7a52", { y: H * 0.35, z: side * (R + 0.006) });   // green safety netting
    b.box(0.004, H * 0.55, 2 * R * 0.9, "#3f7a52", { x: R + 0.006, y: H * 0.35 });
  },
  construction(b) { // a building site: a hoarded fence, a slab with rebar and scaffolding, a tower crane, a mixer, pallets of block, the site cabin
    b.box(0.94, 0.008, 0.94, "#bfae8a");
    for (const [x, z, w, d] of [[0, -0.46, 0.94, 0.012], [-0.46, 0, 0.012, 0.94], [0.46, 0, 0.012, 0.94], [-0.28, 0.46, 0.38, 0.012], [0.28, 0.46, 0.38, 0.012]]) { b.box(w, 0.12, d, "#f1eee6", { x, z }); b.box(w + 0.002, 0.03, d + 0.002, "#2f7d5b", { x, y: 0.06, z }); }
    b.box(0.5, 0.03, 0.42, "#c9c4b8", { x: -0.08, z: -0.08 }, "stone");                     // the slab
    for (const [x, z] of [[-0.3, -0.26], [-0.08, -0.26], [0.14, -0.26], [-0.3, 0.1], [-0.08, 0.1], [0.14, 0.1]]) { b.box(0.03, 0.24, 0.03, "#bdb7ab", { x, y: 0.03, z }, "stone"); for (const dx of [-0.008, 0.008]) b.box(0.003, 0.08, 0.003, "#7a4a2a", { x: x + dx, y: 0.27, z }, "metal"); }
    for (let k = 0; k < 4; k++) b.box(0.52, 0.006, 0.008, "#c9a24a", { x: -0.08, y: 0.08 + k * 0.06, z: 0.15 }, "metal"); // scaffold ledgers
    for (const x of [-0.32, -0.08, 0.16]) b.box(0.006, 0.26, 0.006, "#c9a24a", { x, y: 0.03, z: 0.15 }, "metal");
    b.box(0.5, 0.008, 0.05, "#a0783a", { x: -0.08, y: 0.2, z: 0.17 }, "wood");             // planks
    // the tower crane: a yellow lattice mast, the jib, the counterweight, a hook
    const mx = 0.33, mz = -0.32;
    for (const [dx, dz] of [[-0.02, -0.02], [0.02, -0.02], [-0.02, 0.02], [0.02, 0.02]]) b.box(0.006, 0.9, 0.006, "#e2b52c", { x: mx + dx, z: mz + dz }, "paint");
    for (let k = 0; k < 9; k++) b.add(new THREE.BoxGeometry(0.004, 0.06, 0.004), "#e2b52c", { x: mx, y: 0.05 + k * 0.1, z: mz + 0.02, rx: 0.6 }, "paint");
    b.box(0.07, 0.05, 0.06, "#e2b52c", { x: mx, y: 0.9, z: mz }, "paint"); b.box(0.04, 0.03, 0.03, "#2a3036", { x: mx, y: 0.905, z: mz + 0.03 }, "glass");
    b.box(0.68, 0.02, 0.02, "#e2b52c", { x: mx - 0.3, y: 0.96, z: mz }, "paint"); b.box(0.12, 0.05, 0.05, "#7d8288", { x: mx + 0.1, y: 0.94, z: mz }, "metal");
    b.cyl(0.002, 0.002, 0.4, "#3a3a3a", { x: mx - 0.5, y: 0.56, z: mz }, 4); b.box(0.02, 0.02, 0.02, "#e0523f", { x: mx - 0.5, y: 0.55, z: mz });
    b.box(0.02, 0.02, 0.02, "#ff3b30", { x: mx - 0.62, y: 0.98, z: mz }, "lights");
    // the mixer, block pallets, sand, the cabin
    b.add(new THREE.CylinderGeometry(0.035, 0.05, 0.09, 10), "#e8e6e0", { x: 0.3, y: 0.07, z: 0.2, rz: 0.7 }, "paint"); b.box(0.08, 0.03, 0.06, "#c43c3c", { x: 0.32, z: 0.2 });
    for (let i = 0; i < 3; i++) b.box(0.08, 0.05, 0.08, "#b9b3a6", { x: -0.36 + i * 0.1, z: 0.34 }, "stone");
    b.cone(0.08, 0.06, "#d8c69a", { x: 0.06, z: 0.34 }, 10);
    b.box(0.2, 0.1, 0.1, "#e8e4da", { x: 0.3, z: 0.36 }); b.box(0.06, 0.03, 0.004, "#4f7f99", { x: 0.26, y: 0.05, z: 0.412 }, "glass"); b.box(0.21, 0.01, 0.11, "#2f7d5b", { x: 0.3, y: 0.1, z: 0.36 });
  },
  camel(b) {
    const hide = "#c99a5e", dark = "#a77a45";
    b.add(new THREE.SphereGeometry(0.1, 8, 6), hide, { y: 0.24, sx: 1.5, sy: 0.8, sz: 0.85 });
    b.add(new THREE.SphereGeometry(0.06, 7, 5), hide, { x: -0.01, y: 0.32, sx: 1.2 });
    b.add(new THREE.CylinderGeometry(0.022, 0.03, 0.18, 6), hide, { x: 0.18, y: 0.31, rz: -0.75 });
    b.add(new THREE.BoxGeometry(0.08, 0.04, 0.04), hide, { x: 0.25, y: 0.38 });
    b.add(new THREE.BoxGeometry(0.02, 0.05, 0.01), dark, { x: -0.16, y: 0.22, rz: 0.4 });
    b.box(0.08, 0.012, 0.13, C.red, { x: -0.01, y: 0.355 });
    b.box(0.078, 0.013, 0.035, C.gold, { x: -0.01, y: 0.355 });
  },
  camelLeg(b) {
    b.cyl(0.013, 0.009, 0.104, "#b98255", { y: -0.104 }, 5);
    b.cyl(0.009, 0.006, 0.085, "#956741", { x: 0.009, y: -0.183, rz: 0.17 }, 5);
    b.box(0.031, 0.024, 0.025, "#5c4738", { x: 0.012, y: -0.202 });
  },
  walkingSandal(b) { b.box(0.033, 0.013, 0.022, "#443a30", { x: 0.004 }); },
  // ---- people: a man in a thobe (the thobe takes the per-person colour), his shemagh and face apart ----
  manBody(b) { robe(b,C.white,true); },
  citizenThobe(b) { robe(b,"#f1ece3",false); },
  manHeadRed(b) { head(b,"#a84046"); },
  manHeadWhite(b) { head(b,"#ede8d9"); },
  woman(b) {
    const abaya="#272329";
    robe(b,abaya,false);
    b.add(new THREE.SphereGeometry(.023,10,7),abaya,{x:-.004,y:.15,sy:1.17});
    b.add(new THREE.SphereGeometry(.014,8,5),"#bb8d6a",{x:.015,y:.149,sx:.72,sy:1.21});
    b.cyl(.019,.028,.041,"#312b33",{x:-.004,y:.107},9);
    b.box(.013,.048,.014,"#362d34",{x:-.017,y:.089,z:.007,rz:-.16,wind:.13});
    b.box(.021,.019,.011,"#866450",{x:-.015,y:.057,z:.039});
  },
  citizenSleeve(b) {
    b.cyl(.007,.011,.071,"#f8f4e8",{y:-.073},6);
    b.cyl(.007,.007,.014,"#bd906f",{x:.003,y:-.085},5);
  },
  rainUmbrella(b) {
    b.cyl(.0018,.0018,.088,"#525554",{y:-.062},5);
    b.add(new THREE.ConeGeometry(.071,.035,8),"#8d938c",{y:.034,sy:.83}, "matte");
    for(let i=0;i<8;i+=2) {
      const a=i*Math.PI/4;
      b.box(.063,.0017,.002,"#5c6162",{x:Math.cos(a)*.034,y:.032,z:Math.sin(a)*.034,ry:-a,rz:-.18});
    }
  },
  // ---- the pickup (جيب حوض): body takes the per-car colour; trim keeps its own ----
  // A pickup (جيب حوض) along +x: a rounded body with a sloped bonnet and wheel arches (painted per car),
  // and its trim: tyres with rims, glass, lamps, bumpers and the bed.
  pickupBody(b) {
    vehicleShell(b, [[-.153,.031,.06,.07,.052],[-.129,.026,.066,.074,.066],[-.01,.025,.068,.075,.07],[.091,.026,.068,.079,.066],[.151,.034,.06,.069,.048]],C.white,"matte");
    vehicleShell(b, [[-.053,.071,.093,.116,.055],[-.039,.07,.113,.125,.061],[.033,.07,.113,.125,.059],[.07,.069,.088,.096,.052]],C.white,"matte");
    for(const z of [-.059,.059]) b.box(.104,.027,.009,C.white,{x:-.095,y:.066,z});
    b.box(.009,.026,.119,C.white,{x:-.145,y:.066});
  },
  pickupTrim(b) {
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
  suvBody(b) { passengerCar(b, true, false); },
  suvTrim(b) { passengerCar(b, true, true); },
  sedanBody(b) { passengerCar(b, false, false); },
  sedanTrim(b) { passengerCar(b, false, true); },
  carWheel(b) {
    b.add(new THREE.CylinderGeometry(0.025, 0.025, 0.019, 10), "#24272a", { rx: Math.PI / 2 });
    b.add(new THREE.CylinderGeometry(0.015, 0.015, 0.021, 8), "#8b999d", { rx: Math.PI / 2 });
    for (const a of [0, Math.PI / 3, Math.PI * 2 / 3]) {
      b.add(new THREE.BoxGeometry(0.027, 0.003, 0.023), "#d8d9cf", { rz: a });
    }
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
    const steel="#485659", x=STREET_LAMP_HEAD;
    b.box(.082,.017,.082,"#9e9b90",{},"plaster");
    b.cyl(.016,.021,.032,steel,{y:.015},8,"metal");
    b.cyl(.008,.014,.48,steel,{y:.032},8,"paint");
    processPipe(b,[[0,.487,0],[.017,.533,0],[.054,.554,0],[.112,.557,0],[x-.033,.552,0]],.009,steel);
    b.rbox(.119,.025,.047,.007,steel,{x,y:.531},"paint");
    b.rbox(.091,.008,.036,.004,"#d0d6cd",{x:x+.007,y:.524},"matte");
    b.box(.086,.005,.032,"#fff3db",{x:x+.007,y:.521},"lights");
    b.box(.031,.007,.031,"#b2b7af",{x,y:.555},"metal");
  },
  mesa(b, ground, seed = 1) {
    const r = (k) => ((Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
    const w = 3 + r(1) * 4, d = 2 + r(2) * 3, h = 1.2 + r(3) * 1.8;
    b.add(new THREE.CylinderGeometry(0.7, 1, h, 7), "#c49562", { y: h / 2, sx: w, sz: d });
    b.add(new THREE.CylinderGeometry(0.72, 0.74, h * 0.12, 7), "#b07f4f", { y: h * 0.55, sx: w, sz: d });
    b.add(new THREE.CylinderGeometry(0.6, 0.7, h * 0.25, 7), "#d7ab74", { y: h + h * 0.12, sx: w, sz: d });
  },

  rock(b, ground, seed = 1) {
    const noise = (a) => (Math.sin(a*483.8 + seed*71.13)*9183.7)%1*.5+.5;
    const stones = [[-.105,-.06,.227,.30],[.17,.11,.142,.135],[-.20,.20,.083,.067]];
    const levels = [[0,.97],[.25,1],[.52,.90],[.68,.75],[1,.53]];
    const shades = ["#74583f","#967057","#c09a74","#ad825f"];
    for(const [x,z,r,h] of stones) {
      const g = new THREE.BufferGeometry(), verts=[], uv=[], colors=[];
      const shade = new THREE.Color();
      const ring = levels.map(([y,radius],l) => Array.from({length:7},(_,j) => {
        const a = j*Math.PI*2/7 + seed*.74;
        const spread = r*radius*(.78+noise(j + (l%2)*.21)*.49);
        return [x + Math.cos(a)*spread + l*.009,y*h+(l === 0 ? 0 : (noise(j+8)-.5)*.027),z + Math.sin(a)*spread*.83];
      }));
      function face(a,c,d,color,variation) {
        verts.push(...a,...c,...d);
        shade.set(color).multiplyScalar(variation);
        for(const v of [a,c,d]) { uv.push(v[0]*2+.48,v[1]*2+.48); colors.push(shade.r,shade.g,shade.b); }
      }
      for(let l=1;l<levels.length;l++) for(let i=0;i<7;i++) {
        const j=(i+1)%7, v=.78+noise(i+5)*.31;
        face(ring[l-1][i],ring[l][i],ring[l][j],shades[l-1],v);
        face(ring[l-1][i],ring[l][j],ring[l-1][j],shades[l-1],v*.98);
      }
      for(let i=0;i<7;i++) face([x+.038,h+.012,z],ring[4][(i+1)%7],ring[4][i],"#c69d75",.88+noise(i+3)*.13);
      g.setAttribute("position",new THREE.Float32BufferAttribute(verts,3));
      g.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
      g.computeVertexNormals();
      b.add(g,"#ffffff");
      b.sets.matte.at(-1).setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
      g.dispose();
    }

  }
};

const cache = new Map();

/** Colour swaps that make the same house look different from its neighbours ("house2~1"). */
export const VARIANTS = {
  house1: [{ "#b98a65": "#a97954", "#bf9e79": "#b59570" }, { "#b98a65": "#d1a578", "#9b785b": "#bb8e64" }],
  house2: [{ "#dfceb6": "#dbc4a1", "#c6ab8e": "#aa9277" }, { "#e9dbc5": "#e6e1d6", "#c6ab8e": "#bbafa1" }],
  house3: [{ "#f5f0e7": "#e3ddd2" }, { "#f5f0e7": "#ecece7" }],
  house4: [{ "#ddd8ce": "#e6e2d8" }, { "#ddd8ce": "#bfcac7" }],
  // الحاضرة الكبرى: the towers take other glass and cladding, so a district of them is never all one blue
  house6: [
    { "#3f6f80": "#8a7a55", "#2e5566": "#6e6040", "#7fa3ad": "#b3a27a", "#f1ece2": "#dccab0" },
    { "#3f6f80": "#3f7468", "#2e5566": "#2c5a52", "#7fa3ad": "#86aea2", "#f1ece2": "#e6e2d8" },
    { "#3f6f80": "#76858b", "#2e5566": "#55636a", "#7fa3ad": "#a9b5b8", "#f1ece2": "#b08d5b" }
  ],
  house7: [
    { "#3f6f80": "#7d8f96", "#2e5566": "#5c6e75", "#7fa3ad": "#b8c4c6", "#f1ece2": "#b08d5b" },
    { "#3f6f80": "#8a7a55", "#2e5566": "#6e6040", "#7fa3ad": "#b3a27a", "#f1ece2": "#e9dfcb" },
    { "#3f6f80": "#3a6a7e", "#2e5566": "#22465a", "#7fa3ad": "#6f97a8", "#f1ece2": "#cfc3ad" }
  ],
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
      cache.set(k,Object.fromEntries(SETS.map((set) => [set,["matte","shiny","glass","metal","paint",...BUILDING_SURFACES].includes(set)
        ? recolor(src[set],swaps) : src[set]])));
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

/** The far version of a model (fewer faces, same look from afar), built once like model(). */
export function modelFar(key, ground = "sand") {
  const k = `far:${key.startsWith("palms") ? `${key}:${ground}` : key}`;
  if (!cache.has(k)) {
    const [base, v] = key.split("~");
    if (v !== undefined) {
      const src = modelFar(base, ground), swaps = VARIANTS[base]?.[Number(v)];
      if (!src || !swaps) return src;
      cache.set(k, Object.fromEntries(Object.entries(src).map(([set, g]) => [set, g && (["matte", "shiny", "glass", "metal", "paint"].includes(set) || BUILDING_SURFACES.includes(set)) ? recolor(g, swaps) : g])));
      return cache.get(k);
    }
    const maker = MAKERS[key];
    if (!maker) return null;
    const b = new Builder(true);
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
const SHOP_PANELS = {
  grocery: { accent: "#426e60", roof: "#d4d7cc", height: .28 },
  cafe: { accent: "#967451", roof: "#d3c5af", height: .32 },
  mandi: { accent: "#973f33", roof: "#ded3c6", height: .27 },
  souq: { accent: "#46646a", roof: "#c7c8bb", height: .33 }
};
function modernShop(b,id,lvl) {
  const {accent,roof,height} = SHOP_PANELS[id], wide = lvl===3;
  const width = wide ? .871 : .751;
  modernCourt(b);
  b.box(width,height,.577,CITY.pearl,{y:.023,z:-.154},"plaster");
  glassWall(b,0,.14,.055,width-.111,height*.71,wide?7:5,"#739496");
  b.box(width+.016,.074,.104,accent,{y:height-.018,z:.159},"metal");
  b.box(width*.54,.013,.016,"#e1cbaa",{y:height+.009,z:.216},"lights");
  b.box(width+.05,.025,.635,roof,{y:height+.047,z:-.123},"paint");
  if(wide) b.rbox(width*.61,.148,.281, .025,CITY.graphite,{x:-.052,y:height+.072,z:-.214},"paint");
  if(id==="cafe" || id==="mandi") {
    const awning = new THREE.BoxGeometry(width*.68,.018,.203);
    b.add(awning,accent,{z:.263,y:height-.017,rx:.113},"paint");
    awning.dispose();
    for(const x of [-.228,.228]) civicBench(b,x,.353);
  } else {
    b.box(width*.8,.018,.179,"#78969a",{y:height-.034,z:.268},"glass");
    for(const x of [-.32,.32]) b.box(.021,height-.064,.024,CITY.graphite,{x,z:.335,y:.024},"metal");
  }
}
for (const id of BIZ) for (const lvl of [1, 2, 3]) {
  MAKERS[`${id}${lvl}`] = (b, ground, seed) => {
    if (lvl >= 2 && SHOP_PANELS[id]) modernShop(b,id,lvl);
    else if (lvl >= 2 && id === "mosque") {
      MAKERS.bigmosque(b);
      if (lvl === 3) for (const x of [-.337,.337]) civicBench(b,x,.385);
    }
    else { MAKERS[id](b, ground, seed); bizExtras(b, id, lvl); }
  };
}

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
  const g = new Builder(b.far); draw(g);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(s, s, s));
  for (const set of SETS) for (const part of g.sets[set]) { part.applyMatrix4(m); b.sets[set].push(part); }
}
function pad(b, w = 0.96, d = 0.96, marks = true) {
  b.rbox(w,.03,d,.008,MC.concrete,{},"stone");
  for(const side of [-1,1]) {
    b.box(.037,.016,d-.093,"#9a9280",{x:side*(w/2-.025),y:.026},"stone");
    for(const z of [-.34,.325]) b.box(.023,.007,.043,"#64645d",{x:side*(w/2-.048),y:.031,z},"metal");
  }
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
  stoneApron(b,"#beb09a",.935);
  b.rbox(w,h,d,.02,k ? "#cbbfa6" : "#d8c9a6",{z:-.04,y:.018},"stone");
  for(const x of [-w*.39,w*.39]) {
    b.box(.049,h*.69,.042,"#aa9d85",{x,y:.025,z:d/2-.03},"stone");
    b.box(.037,.062,.024,"#7c7568",{x:x*.79,y:.089,z:d/2-.024},"metal");
    b.box(.015,.02,.016,C.light,{x:x*.79,y:.127,z:d/2-.006},"lights");
  }
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
export const PLACE_STYLE = { "دومة الجندل": "jandal", "سكاكا": "zabal", "ميقوع": "zabal", "القريات": "kaf", "الحديثة": "kaf", "العيساوية": "kaf", "الحماد": "kaf", "الشويحطية": "kaf", "زلوم": "kaf", "طبرجل": "rawda", "روضات الجوف": "rawda", "صوير": "rawda", "النفود الكبير": "nafud", "أبو عجرم": "nafud", "الأضارع": "kaf", "الرديفة": "rawda" };
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
    b.box(0.98, 0.012, 0.6, k.ground, {}, "stone");
    b.add(new THREE.CylinderGeometry(0.5, 0.52, 0.08, 10), "#b99a6c", { y: 0.04, sz: 0.45 });
    for (const x of [-0.34, 0.34]) {
      b.cyl(0.11, 0.15, 0.78, k.wall, { x, y: 0.06 }, 12,"stone");
      b.cyl(0.12, 0.12, 0.04, k.trim, { x, y: 0.84 }, 12);
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; b.box(0.035, 0.05, 0.035, k.dark, { x: x + Math.cos(a) * 0.1, y: 0.88, z: Math.sin(a) * 0.1 }); }
      b.box(0.03, 0.07, 0.01, "#3b2a1c", { x, y: 0.55, z: 0.13 });
    }
    b.box(0.5, 0.5, 0.26, k.wall, { y: 0.06 },"stone");
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
    b.box(0.46, 0.3, 0.36, k.wall, { y: 0.26, z: -0.04 },"plaster");
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
      b.box(0.24, 0.66, 0.3, k.wall, { x },"stone");
      b.box(0.26, 0.04, 0.32, k.trim, { x, y: 0.66 });
      for (const y of [0.3, 0.48]) b.box(0.05, 0.05, 0.01, k.dark, { x, y, z: 0.155 });
      b.box(0.04, 0.04, 0.012, C.light, { x, y: 0.48, z: 0.156 }, "lights");
      for (let i = 0; i < 4; i++) b.box(0.25, 0.006, 0.305, k.dark, { x, y: 0.12 + i * 0.13 });
    }
    b.box(0.44, 0.5, 0.3, k.wall, { y: 0.08 },"stone");
    b.box(0.46, 0.04, 0.32, k.trim, { y: 0.58 });
    b.add(new THREE.CylinderGeometry(0.15, 0.15, 0.31, 16, 1, false, 0, Math.PI), "#1e1d1b", { y: 0.28, rx: Math.PI / 2, rz: Math.PI / 2, sz: 0.01 });
    b.box(0.3, 0.2, 0.31, "#1e1d1b", { y: 0.08, sz: 0.01 });
    b.add(new THREE.TorusGeometry(0.16, 0.018, 6, 16, Math.PI), k.trim, { y: 0.28, z: 0.152 });
    b.box(0.5, 0.08, 0.02, k.accent, { y: 0.46, z: 0.152 });
    for (const x of [-0.46, 0.46]) oliveTree(b, x, 0.24, 0.9);
  },
  rawda(b, k) { // the olive country: a white limestone arcade (three open arches), green trim, olive trees along it
    b.box(0.98, 0.012, 0.6, k.ground);
    b.box(0.86, 0.58, 0.22, k.wall, { y: 0.02 },"stone");
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
      b.box(0.16, 0.6, 0.16, k.wall, { x },"stone");
      b.box(0.18, 0.05, 0.18, k.dark, { x, y: 0.6 });
      b.cone(0.07, 0.12, k.dark, { x, y: 0.65 }, 4);
      saduBand(b, 0.16, 0.35, 0.085, 0.03, x);
      b.box(0.04, 0.04, 0.012, C.light, { x, y: 0.5, z: 0.086 }, "lights");
    }
    b.add(new THREE.PlaneGeometry(0.56, 0.36), k.trim, { y: 0.56, rx: -Math.PI / 2 + 0.25 });
    b.box(0.56, 0.02, 0.36, k.trim, { y: 0.5 },"matte");
    for (const x of [-0.18, 0, 0.18]) b.cyl(0.008, 0.008, 0.5, "#6b4426", { x, z: 0.12 }, 5);
    saduBand(b, 0.56, 0.48, 0.19, 0.04);
    for (let i = 0; i < 3; i++) b.cyl(0.04, 0.05, 0.03, ["#b3261e", "#2c8a7a", "#d4a53a"][i], { x: -0.12 + i * 0.12, z: -0.05 }, 8);
  }
};
const RAFAYA_STYLE={wall:"#d7ccba",dark:"#978979",trim:"#b4a98e",glass:"#6f98a2",ground:"#c3b6a0",accent:"#5d8379"};

function civicTower(b,style) {
  const k=ST[style] || RAFAYA_STYLE;
  stoneApron(b,k.ground);
  b.cyl(.292,.355,.128,k.wall,{y:.025},10,"stone");
  if(style==="jandal" || style==="zabal") crenels(b,.54,.54,.139,k.dark,.028);
  if(style==="nafud") saduBand(b,.41,.079,.287,.027);
  const shaft=2.48, shoulder=1.97;
  b.cyl(.096,.164,shaft,k.wall,{y:.13},10,style==="zabal"?"plaster":"stone");
  for(let d=0;d<8;d++) {
    const a=d*Math.PI/4;
    b.box(.016,1.7,.017,k.dark,{x:.12*Math.cos(a),y:.253,z:.12*Math.sin(a)},"stone");
  }
  b.cyl(.233,.129,.137,k.trim,{y:shoulder},12,"metal");
  b.cyl(.222,.23,.097,k.glass,{y:shoulder+.137},12,"glass");
  for(let i=0;i<12;i++) {
    const a=i*Math.PI/6;
    b.box(.012,.099,.015,k.trim,{x:.223*Math.cos(a),z:.223*Math.sin(a),y:shoulder+.138,ry:-a},"metal");
  }
  b.cyl(.176,.242,.06,k.wall,{y:shoulder+.229},12,"stone");
  b.cyl(.216,.217,.009,"#e5cea2",{y:shoulder+.166},12,"lights");
  b.cyl(.054,.106,.19,style==="rawda"?k.accent:k.trim,{y:2.6},9,"metal");
  b.cyl(.013,.019,.265,k.dark,{y:2.78},7,"metal");
  b.cyl(.021,.021,.033,"#d46452",{y:3.036},7,"lights");
  for(const x of [-.353,.353]) civicBench(b,x,.315);
}

function officeQuarter(b,style) {
  const k=ST[style] || RAFAYA_STYLE;
  modernCourt(b);
  b.box(.891,.145,.617,k.wall,{z:-.127,y:.02},"paint");
  b.box(.816,.073,.018,k.glass,{y:.061,z:.185},"glass");
  b.box(.894,.04,.67,k.trim,{y:.16,z:-.119},"metal");
  const towers=[[-.207,-.192,.275,2.27],[.208,-.169,.241,1.82],[.003,.183,.208,1.32]];
  for(const [x,z,w,h] of towers) {
    b.box(w,h,w*.9,k.glass,{x,z,y:.18},"glass");
    for(const dx of [-.46,.46]) for(const dz of [-.416,.416])
      b.box(.019,h+.057,.022,k.wall,{x:x+w*dx,z:z+w*dz,y:.172},"paint");
    for(let f=.32;f<h+.17;f+=.12) {
      b.box(w+.006,.012,w*.91,k.trim,{x,y:f,z},"metal");
      if(f%.24<.12) b.box(w*.37,.028,.006,"#eac990",{x:x-.032,y:f+.041,z:z+w*.453},"lights");
    }
    b.box(w+.019,.062,w*.925,k.wall,{x,y:h+.177,z},"paint");
    b.box(w*.59,.132,w*.55,k.dark,{x:x+.018,y:h+.237,z},"metal");
  }
  const [x,z,w,h]=towers[0], y=h+.37;
  if(style==="jandal" || style==="zabal") graft(b,g=>crenels(g,w,w*.87,y-.054,k.dark,.025),{x,z});
  if(style==="rawda") b.dome(.094,k.accent,{x,y,z},"metal");
  if(style==="nafud") b.cone(.113,.113,k.trim,{x,y,z},4,"metal");
  b.cyl(.011,.022,.28,k.accent,{x,y,z},8,"metal");
  b.box(.019,.019,.019,"#e6855f",{x,y:y+.278,z},"lights");
  for(const x of [-.36,.35]) {
    b.box(.17,.043,.126,k.wall,{x,z:.372},"paint");
    oliveTree(b,x,.375,.57);
  }
}

function airportTerminal(b,style) {
  const k=ST[style] || RAFAYA_STYLE;
  modernCourt(b);
  b.box(.972,.01,.293,"#504f4d",{y:.026,z:.298});
  for(const z of [.159,.436]) b.box(.933,.004,.009,"#e4dfd0",{y:.037,z});
  for(let i=0;i<7;i++) b.box(.077,.005,.01,"#d4d2c1",{x:(i-3)*.133,y:.037,z:.299});
  for(const z of [.203,.233,.363,.393]) for(const x of [-.446,.446]) b.box(.053,.006,.013,"#dfd9c4",{x,y:.038,z});
  b.box(.532,.196,.261,k.wall,{x:-.17,z:-.289,y:.027},"paint");
  glassWall(b,-.17,-.154,.087,.46,.11,5,k.glass);
  for(let i=0;i<6;i++) {
    const x=-.394+i*.088;
    b.box(.013,.109,.026,k.trim,{x,y:.087,z:-.151},"metal");
    if(i%2) b.box(.062,.028,.01,C.light,{x:x-.043,y:.121,z:-.139},"lights");
  }
  entryCanopy(b,-.17,-.102,.563,.223,k.accent,"metal");
  if(style==="zabal") graft(b,g=>crenels(g,.5,.243,.23,k.dark,.024),{x:-.17,z:-.289});
  if(style==="jandal") for(const x of [-.427,.085]) b.cyl(.038,.055,.234,k.dark,{x,z:-.29,y:.023},10,"paint");
  if(style==="kaf") for(let i=0;i<5;i++) b.add(new THREE.TorusGeometry(.031,.008,5,10,Math.PI),k.trim,{x:-.369+i*.097,y:.177,z:-.139},"paint");
  if(style==="rawda") oliveTree(b,-.416,-.043,.57);
  if(style==="nafud") for(let i=0;i<3;i++) b.cone(.091,.097,"#e7dfcd",{x:-.331+i*.164,y:.227,z:-.286},4,"matte");
  b.cyl(.038,.068,.392,k.wall,{x:.327,y:.027,z:-.296},8,"paint");
  b.cyl(.082,.061,.069,k.glass,{x:.327,y:.419,z:-.296},10,"glass");
  b.cyl(.086,.09,.021,k.dark,{x:.327,y:.486,z:-.296},10,"metal");
  b.cyl(.011,.013,.113,k.trim,{x:.327,y:.501,z:-.296},5,"metal");
  b.box(.017,.016,.017,"#d77659",{x:.327,y:.608,z:-.296},"lights");
  const x=.072,z=.295;
  b.add(new THREE.CylinderGeometry(.027,.022,.333,10),"#deded0",{x,y:.089,z,rz:-Math.PI/2},"paint");
  b.add(new THREE.ConeGeometry(.026,.064,10),"#daddd7",{x:x+.183,y:.089,z,rz:-Math.PI/2},"paint");
  b.plate([[-.161,-.026],[-.046,-.157],[.023,-.157],[-.018,-.026],[-.018,.026],[.023,.157],[-.046,.157],[-.161,.026]],.008,"#cfcec2",{x:x+.101,y:.082,z,rx:-Math.PI/2},"paint");
  b.plate([[-.17,0],[-.185,.086],[-.144,.076],[-.104,0]],.012,k.accent,{x,y:.102,z},"paint");
  for(const off of [-.061,.061]) b.add(new THREE.CylinderGeometry(.016,.018,.068,9),"#a2a8a4",{x:x+.03,y:.067,z:z+off,rz:Math.PI/2},"metal");
  b.box(.031,.017,.044,k.glass,{x:x+.139,y:.105,z},"glass");
}
for (const style of Object.keys(ST)) {
  MAKERS[`gate_${style}`] = (b) => GATES[style](b, ST[style]);
  MAKERS[`tower_${style}`] = (b) => civicTower(b, style);
  MAKERS[`skyline_${style}`] = (b) => officeQuarter(b, style);
  MAKERS[`airport_${style}`] = (b) => airportTerminal(b, style);
}

// ---------- الحاضرة الكبرى: the last stage of al-Jouf ----------
// Contemporary Saudi architecture with touches of al-Jouf: tinted glass, bronze and pearl metal cladding,
// smooth sand concrete, mashrabiya fins that cast shade, Najdi triangles cut in metal at the crowns, and
// stone only at entrances and squares. Every landmark has its own silhouette, so the town reads as the
// top stage from afar; at night the entrances, the squares and the crowns light up.
const GC = {
  pearl: "#f1ece2", sand: "#dccab0", sandDark: "#bfa98a", bronze: "#b08d5b", bronzeDark: "#8a6c45",
  graphite: "#3d4649", glass: "#3f6f80", glassDeep: "#2e5566", glassLight: "#7fa3ad", glassGold: "#8a7a55",
  green: "#5f7f4c", water: "#3b8aa3", lamp: "#ffe2a6", stone: "#cdbb9c", paving: "#d6cbb7", pavingDark: "#b9ad97"
};
/** A paved civic deck with a woven pattern of darker stone and planters at the edges. */
function gcPlaza(b, { w = .96, d = .96, color = GC.paving } = {}) {
  b.box(w, .024, d, color, {}, "stone");
  for (let i = -3; i <= 3; i++) {
    b.box(.006, .004, d * .96, GC.pavingDark, { x: i * w / 8, y: .024 });
    b.box(w * .96, .004, .006, GC.pavingDark, { z: i * d / 8, y: .024 });
  }
}
/** Small round lights set into the ground: pools of light on the pavement at night. */
function gcGroundLights(b, points) {
  for (const [x, z] of points) {
    b.cyl(.018, .018, .006, "#f5e7c4", { x, z, y: .024 }, 8, "lights");
    b.cyl(.05, .05, .002, "#a8875a", { x, z, y: .025 }, 12, "lights");
  }
}
/** A slim lamp post with a warm head. */
function gcLamp(b, x, z, h = .2) {
  b.cyl(.006, .008, h, GC.graphite, { x, z, y: .024 }, 6, "metal");
  b.box(.03, .012, .03, GC.graphite, { x, z, y: .024 + h }, "metal");
  b.box(.024, .006, .024, GC.lamp, { x, z, y: .02 + h }, "lights");
}
/** A planter box with a small tree (olive, the tree of al-Jouf). */
function gcPlanter(b, x, z, s = .5) {
  b.box(.11 * s * 2, .04, .11 * s * 2, GC.sandDark, { x, z, y: .024 }, "stone");
  oliveTree(b, x, z, s);
}
/** Vertical bronze fins over a facade (a modern mashrabiya): face +z, or +x when side. */
function gcFins(b, { x = 0, z = 0, y = 0, w, h, n, side = false, color = GC.bronze, depth = .03 }) {
  for (let i = 0; i < n; i++) {
    const u = -w / 2 + (i + .5) * w / n;
    b.box(side ? depth : .012, h, side ? .012 : depth, color, side ? { x, z: z + u, y } : { x: x + u, z, y }, "metal");
  }
}
/** Najdi triangles cut in metal: a crown line of small pyramids. */
function gcTriangles(b, { x = 0, z = 0, y, w, d, size = .045, color = GC.bronze }) {
  const nx = Math.max(2, Math.round(w / (size * 1.6))), nz = Math.max(2, Math.round(d / (size * 1.6)));
  for (let i = 0; i < nx; i++) for (const s of [-1, 1]) b.cone(size * .62, size, color, { x: x - w / 2 + (i + .5) * w / nx, z: z + s * d / 2, y, ry: Math.PI / 4 }, 4, "metal");
  for (let i = 1; i < nz - 1; i++) for (const s of [-1, 1]) b.cone(size * .62, size, color, { x: x + s * w / 2, z: z - d / 2 + (i + .5) * d / nz, y, ry: Math.PI / 4 }, 4, "metal");
}
/**
 * A tower shaft: glass between pearl floor bands, lit windows in a pattern that varies by floor
 * (never a flat grid), optional balconies with glass rails on the front, a parapet on top.
 */
function gcShaft(b, { x = 0, z = 0, y = 0, w, d, h, floors, glass = GC.glass, balconies = false, band = GC.pearl, seed = 1 }) {
  b.box(w, h, d, glass, { x, z, y }, "glass");
  const fh = h / floors;
  let r = seed * 9301 + 49297;
  const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let i = 1; i <= floors; i++) {
    const yy = y + fh * i - .006;
    b.box(w + .016, .012, d + .016, band, { x, z, y: yy }, "metal");
    if (balconies && i < floors) {
      b.box(w * .82, .01, .06, band, { x, z: z + d / 2 + .03, y: yy }, "paint");
      b.box(w * .82, .028, .004, GC.glassLight, { x, z: z + d / 2 + .058, y: yy + .01 }, "glass");
    }
    // lit rooms: a few windows on two faces, a different set each floor
    if (i < floors) for (let k = 0; k < 3; k++) {
      const u = (rand() - .5) * w * .8, lit = rand() > .45;
      if (lit) b.box(w * .16, fh * .55, .004, "#f4d39a", { x: x + u, z: z + d / 2 + .003, y: yy - fh * .75 }, "lights");
      const v = (rand() - .5) * d * .8;
      if (rand() > .5) b.box(.004, fh * .55, d * .16, "#f4d39a", { x: x + w / 2 + .003, z: z + v, y: yy - fh * .75 }, "lights");
    }
  }
  b.box(w + .02, .05, d + .02, band, { x, z, y: y + h }, "paint");
}
/** A building's base on the street: sand concrete podium, a glazed lobby and a lit canopy over the door. */
function gcLobby(b, { x = 0, z = 0, w, d, h = .17, front = .02 }) {
  b.box(w, h, d, GC.sand, { x, z, y: .024 }, "stone");
  b.box(w * .7, h * .72, .012, GC.glassDeep, { x, z: z + d / 2 + .004, y: .03 }, "glass");
  b.box(w * .5, h * .5, .006, "#f2cf8c", { x, z: z + d / 2 + .008, y: .036 }, "lights");
  b.box(w * .62, .018, .12 + front, GC.bronze, { x, z: z + d / 2 + .06, y: h * .82 }, "metal");
  b.box(w * .4, .004, .08, "#ffe5ae", { x, z: z + d / 2 + .06, y: h * .82 - .004 }, "lights");
}
/** A short beacon on top (aircraft red light). */
function gcBeacon(b, x, y, z, h = .22) {
  b.cyl(.006, .014, h, GC.graphite, { x, z, y }, 6, "metal");
  b.box(.018, .018, .018, "#ff6a4d", { x, z, y: y + h }, "lights");
}

Object.assign(MAKERS, {
  // برج سكني شاهق: a slim tower that steps back twice, balconies on its face, a crown of Najdi triangles
  house6(b) {
    gcPlaza(b);
    gcLobby(b, { x: -.02, z: .02, w: .62, d: .5 });
    gcShaft(b, { x: -.02, z: -.02, y: .19, w: .5, d: .46, h: 1.45, floors: 10, balconies: true, seed: 6 });
    gcShaft(b, { x: -.02, z: -.04, y: 1.69, w: .42, d: .38, h: .95, floors: 7, balconies: true, seed: 16, glass: GC.glassDeep });
    gcShaft(b, { x: -.02, z: -.06, y: 2.69, w: .32, d: .3, h: .62, floors: 4, seed: 26 });
    gcFins(b, { x: -.02 + .25, z: -.02, y: .19, w: .4, h: 1.45, n: 7, side: true });
    gcTriangles(b, { x: -.02, z: -.06, y: 3.36, w: .32, d: .3, size: .04 });
    b.box(.2, .014, .18, GC.lamp, { x: -.02, z: -.06, y: 3.35 }, "lights");
    gcBeacon(b, -.02, 3.36, -.06, .24);
    for (const [x, z] of [[-.4, .4], [.38, .4], [.4, -.38]]) gcPlanter(b, x, z, .5);
    civicBench(b, .3, .36);
    gcGroundLights(b, [[-.15, .42], [.12, .42]]);
  },
  // مجمّع أبراج سكنية: three towers of different heights round a garden court with a pool, a sky bridge between two
  house7(b) {
    gcPlaza(b, { color: "#d9cfbd" });
    // the court: a lawn, a pool and palms, framed by a low podium on three sides
    b.box(.4, .012, .34, "#6b8f55", { x: .05, z: .12, y: .024 }, "matte");
    b.box(.2, .014, .11, GC.water, { x: .07, z: .14, y: .03 }, "glass");
    b.box(.22, .01, .13, GC.pearl, { x: .07, z: .14, y: .024 }, "paint");
    for (const [x, z] of [[-.1, .26], [.22, .02]]) palm(b, x, z, .45);
    b.box(.92, .14, .2, GC.sand, { z: -.36, y: .024 }, "stone");
    b.box(.2, .14, .55, GC.sand, { x: -.36, z: .02, y: .024 }, "stone");
    b.box(.7, .1, .012, GC.glassDeep, { x: .05, z: -.255, y: .04 }, "glass");
    // the towers
    gcShaft(b, { x: -.29, z: -.27, y: .16, w: .3, d: .32, h: 3.0, floors: 20, balconies: true, seed: 7 });
    gcShaft(b, { x: .28, z: -.28, y: .16, w: .3, d: .3, h: 2.25, floors: 15, balconies: true, seed: 17, glass: GC.glassDeep });
    gcShaft(b, { x: -.32, z: .2, y: .16, w: .26, d: .26, h: 1.55, floors: 10, balconies: true, seed: 27, glass: GC.glassLight });
    // terraces with planters on the setbacks
    for (const [x, z, y] of [[-.29, -.27, 3.21], [.28, -.28, 2.46], [-.32, .2, 1.76]]) {
      b.box(.18, .03, .18, GC.green, { x, z, y }, "matte");
      gcLamp(b, x + .06, z + .06, .06);
    }
    // the sky bridge, lit underneath
    b.box(.34, .09, .1, GC.pearl, { x: 0, z: -.28, y: 1.62 }, "paint");
    b.box(.32, .05, .104, GC.glassLight, { x: 0, z: -.28, y: 1.64 }, "glass");
    b.box(.28, .004, .07, GC.lamp, { x: 0, z: -.28, y: 1.615 }, "lights");
    gcTriangles(b, { x: -.29, z: -.27, y: 3.24, w: .3, d: .32, size: .035 });
    gcBeacon(b, -.29, 3.25, -.27);
    gcGroundLights(b, [[.3, .4], [-.05, .42], [.4, .2]]);
    gcLamp(b, .42, .42);
  },
  // الخزنة المركزية: a polished granite strongroom wrapped in a bronze lattice, gold at the door
  vaultCentral(b) {
    gcPlaza(b, { color: "#cfc4b1" });
    b.rbox(.7, .42, .56, .02, "#4a4644", { z: -.06, y: .024 }, "stone");
    gcFins(b, { z: -.06 + .29, y: .04, w: .66, h: .36, n: 15 });
    gcFins(b, { x: .36, z: -.06, y: .04, w: .52, h: .36, n: 11, side: true });
    gcFins(b, { x: -.36, z: -.06, y: .04, w: .52, h: .36, n: 11, side: true });
    b.box(.76, .05, .62, GC.bronzeDark, { z: -.06, y: .44 }, "metal");
    gcTriangles(b, { z: -.06, y: .49, w: .7, d: .56, size: .045, color: "#d6b464" });
    b.rbox(.2, .25, .03, .01, "#d6b464", { z: .235, y: .024 }, "metal");
    b.cyl(.055, .055, .012, "#f0cf73", { y: .15, z: .26, rx: Math.PI / 2 }, 14, "metal");
    b.box(.3, .006, .05, GC.lamp, { z: .27, y: .3 }, "lights");
    for (const x of [-.3, .3]) b.box(.05, .5, .05, GC.pearl, { x, z: .26, y: .024 }, "stone");
    gcGroundLights(b, [[-.2, .4], [.2, .4]]);
  },
  // مجمّع الأعمال: three glass headquarters joined by bridges round a shaded reception plaza
  civic_offices(b) {
    gcPlaza(b);
    gcShaft(b, { x: -.27, z: -.2, y: .024, w: .34, d: .46, h: 1.35, floors: 9, seed: 31, glass: GC.glassLight });
    gcShaft(b, { x: .2, z: -.26, y: .024, w: .44, d: .38, h: 2.05, floors: 13, seed: 32 });
    gcShaft(b, { x: .26, z: .18, y: .024, w: .32, d: .3, h: .95, floors: 6, seed: 33, glass: GC.glassDeep });
    gcFins(b, { x: .2, z: -.26 + .2, y: .03, w: .42, h: 2.0, n: 9 });
    for (const [x, z, y, w] of [[-.02, -.22, .95, .15], [.25, -.03, .62, .1]]) {
      b.box(w, .08, .08, GC.pearl, { x, z, y }, "paint");
      b.box(w * .9, .004, .06, GC.lamp, { x, z, y: y - .004 }, "lights");
    }
    // the shaded reception: a thin slatted roof on slender columns
    for (const [x, z] of [[-.38, .12], [-.06, .12], [-.38, .4], [-.06, .4]]) b.cyl(.008, .008, .26, GC.graphite, { x, z, y: .024 }, 6, "metal");
    b.box(.38, .012, .34, GC.pearl, { x: -.22, z: .26, y: .28 }, "paint");
    for (let i = 0; i < 9; i++) b.box(.36, .01, .012, GC.bronze, { x: -.22, z: .1 + i * .04, y: .27 }, "metal");
    b.box(.26, .004, .2, GC.lamp, { x: -.22, z: .26, y: .262 }, "lights");
    b.box(.12, .03, .06, "#1f5f4f", { x: -.22, z: .26, y: .024 }, "paint");
    gcBeacon(b, .2, 2.1, -.26);
    gcGroundLights(b, [[-.3, .3], [-.12, .3], [.1, .42]]);
    gcPlanter(b, .02, .4, .45);
  },
  // مركز معارض الجوف: two wide halls under a folded roof like the ridges of a Bedouin tent, a glass hall across the front
  civic_expo(b) {
    gcPlaza(b);
    b.box(.9, .2, .56, GC.sand, { z: -.16, y: .024 }, "stone");
    b.box(.84, .1, .012, GC.glassDeep, { z: .124, y: .05 }, "glass");
    // the folded roof: ridges and valleys (a tent's peaks), pearl metal with bronze edges
    for (let i = 0; i < 6; i++) {
      const x = -.375 + i * .15;
      for (const s of [-1, 1]) b.box(.082, .012, .6, GC.pearl, { x: x + s * .036, z: -.16, y: .25, rz: -s * .45 }, "paint");
      b.box(.008, .012, .6, GC.bronze, { x, z: -.16, y: .282 }, "metal");
      b.box(.05, .004, .5, GC.lamp, { x, z: -.16, y: .22 }, "lights");
    }
    // the lobby across the front: a tall glass hall with a bronze frame and the name
    b.box(.34, .3, .2, "#5d8e9c", { z: .17, y: .024 }, "glass");
    for (let i = 0; i <= 6; i++) b.box(.006, .3, .006, GC.pearl, { x: -.17 + i * .0567, z: .272, y: .024 }, "metal");
    for (const y of [.12, .22]) b.box(.34, .006, .006, GC.pearl, { z: .272, y }, "metal");
    b.box(.38, .025, .24, GC.pearl, { z: .17, y: .324 }, "paint");
    b.box(.3, .004, .18, GC.lamp, { z: .17, y: .32 }, "lights");
    b.box(.24, .18, .004, "#f4d6a0", { z: .266, y: .05 }, "lights");
    b.box(.26, .045, .012, GC.bronze, { z: .29, y: .35 }, "metal");
    // flags of the exhibitors
    for (let i = 0; i < 5; i++) {
      const x = -.4 + i * .2;
      b.cyl(.004, .004, .3, GC.pearl, { x, z: .44, y: .024 }, 5, "metal");
      b.box(.05, .03, .003, ["#1f7a52", "#b2453a", "#2c5d8f", "#c79a3b", "#1f7a52"][i], { x: x + .025, z: .44, y: .28 }, "paint");
    }
    gcGroundLights(b, [[-.25, .36], [0, .38], [.25, .36]]);
  },
  // مركز شحن الجوف: warehouses with numbered doors, a container yard under a gantry crane, a teal roof seen from afar
  civic_freight(b) {
    b.box(.97, .02, .97, "#6a6a66", {}, "stone");
    for (let i = 0; i < 5; i++) b.box(.004, .004, .3, "#e3d28a", { x: -.4 + i * .2, z: .28, y: .022 });
    // the warehouse with its dock
    b.box(.9, .26, .34, "#c9ccc6", { z: -.3, y: .02 }, "paint");
    b.box(.92, .03, .36, "#2b8a8a", { z: -.3, y: .28 }, "paint");
    b.box(.3, .004, .2, "#f1f1e8", { x: -.2, z: -.3, y: .312 });
    for (let i = 0; i < 4; i++) {
      const x = -.33 + i * .22;
      rollerBay(b, x, -.13, .14, .15, ["#2b8a8a", "#c76a2e", "#2b8a8a", "#c76a2e"][i]);
      b.box(.05, .04, .004, GC.pearl, { x, z: -.11, y: .21 }, "paint");
      b.box(.04, .025, .002, "#1d1d1d", { x, z: -.106, y: .218 });
      b.box(.12, .006, .05, GC.lamp, { x, z: -.1, y: .22 }, "lights");
    }
    b.box(.92, .03, .06, "#7f7f7a", { z: -.1, y: .02 }, "stone");
    // the container yard and its gantry
    const box = ["#b2453a", "#2c5d8f", "#c79a3b", "#2b8a8a", "#6a7d45", "#d9d4c6"];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < (i + j) % 3 + 1; k++)
      b.box(.17, .07, .07, box[(i * 3 + j + k) % 6], { x: -.33 + i * .2, z: .12 + j * .09, y: .022 + k * .072 }, "paint");
    for (const x of [-.44, .44]) for (const z of [.04, .34]) b.box(.025, .36, .025, "#e0a530", { x, z, y: .02 }, "paint");
    for (const z of [.04, .34]) b.box(.92, .04, .03, "#e0a530", { z, y: .37 }, "paint");
    b.box(.06, .06, .34, "#d29622", { x: .05, z: .19, y: .33 }, "paint");
    b.box(.02, .14, .02, GC.graphite, { x: .05, z: .19, y: .19 }, "metal");
    for (const x of [-.44, .44]) b.box(.02, .012, .02, "#ff6a4d", { x, z: .04, y: .4 }, "lights");
    for (const x of [-.3, .2]) gcLamp(b, x, .44, .3);
  },
  // مجمّع المياه: round clarifiers full of water with their bridges, a mushroom water tower in the Saudi way, pipes and a plant hall
  civic_water(b) {
    gcPlaza(b, { color: "#cfc6b2" });
    for (const [x, z, r] of [[-.25, .2, .2], [.2, .25, .17]]) {
      b.cyl(r + .02, r + .025, .09, "#d9d4c4", { x, z, y: .024 }, 20, "stone");
      b.cyl(r, r, .006, GC.water, { x, z, y: .108 }, 20, "glass");
      b.cyl(.03, .03, .12, GC.pearl, { x, z, y: .024 }, 10, "paint");
      b.box(r * 2, .014, .02, "#9aa3a3", { x, z, y: .13 }, "metal");
      b.box(r * 1.6, .004, .012, GC.lamp, { x, z, y: .124 }, "lights");
    }
    // the water tower: a slender shaft and a bulb, a band of light under the rim
    b.cyl(.04, .06, .9, GC.pearl, { x: .26, z: -.24, y: .024 }, 14, "paint");
    b.lathe([[0, 0], [.08, .01], [.2, .1], [.22, .17], [.19, .24], [.08, .28], [0, .29]], "#e9e4d8", { x: .26, z: -.24, y: .9 }, 20, "paint");
    b.cyl(.205, .205, .02, "#2e7c94", { x: .26, z: -.24, y: 1.05 }, 20, "glass");
    b.cyl(.208, .208, .008, GC.lamp, { x: .26, z: -.24, y: 1.03 }, 20, "lights");
    gcBeacon(b, .26, 1.19, -.24, .1);
    // the plant hall with pipes into the basins
    b.box(.36, .22, .3, GC.sand, { x: -.24, z: -.26, y: .024 }, "stone");
    glassWall(b, -.24, -.105, .05, .3, .12, 4, GC.glassDeep);
    gcFins(b, { x: -.24, z: -.1, y: .19, w: .34, h: .05, n: 10 });
    processPipe(b, [[-.1, .1, -.2], [0, .1, -.05], [-.1, .1, .1], [-.2, .1, .2]], .014, "#3e8fb0");
    processPipe(b, [[-.08, .08, -.22], [.1, .08, -.08], [.2, .08, .1], [.2, .08, .22]], .012, "#3e8fb0");
    gcGroundLights(b, [[0, .42], [-.42, .0]]);
  },
  // مجمّع الطاقة: a substation yard with transformers, a lattice pylon, battery halls and a field of solar panels
  civic_energy(b) {
    b.box(.97, .02, .97, "#a9a294", {}, "stone");
    // solar rows
    for (let i = 0; i < 4; i++) for (const x of [-.25, .1]) {
      b.box(.01, .05, .01, GC.graphite, { x, z: .1 + i * .1, y: .02 }, "metal");
      b.box(.32, .01, .07, "#25435a", { x, z: .1 + i * .1, y: .07, rx: -.35 }, "glass");
    }
    // transformers with cooling fins and the yard fence
    for (const x of [-.3, -.08]) {
      b.box(.14, .14, .12, "#8f9895", { x, z: -.2, y: .02 }, "metal");
      for (let k = 0; k < 5; k++) b.box(.004, .1, .13, "#717a77", { x: x - .06 + k * .03, z: -.2, y: .04 }, "metal");
      for (const dx of [-.03, .03]) b.cyl(.01, .014, .08, "#e8e2d2", { x: x + dx, z: -.2, y: .16 }, 6, "paint");
    }
    // the lattice pylon carrying the lines away
    const px = .3, pz = -.25;
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(.012, 1.0, .012, "#9aa0a0", { x: px + dx * .06, z: pz + dz * .06, y: .02, rx: -dz * .05, rz: dx * .05 }, "metal");
    for (const y of [.25, .5, .75]) b.box(.13 - y * .06, .008, .13 - y * .06, "#9aa0a0", { x: px, z: pz, y }, "metal");
    for (const y of [.8, .95]) b.box(.4, .014, .02, "#9aa0a0", { x: px, z: pz, y }, "metal");
    for (const y of [.8, .95]) for (const dx of [-.18, .18]) b.cyl(.008, .008, .05, "#e8e2d2", { x: px + dx, z: pz, y: y - .05 }, 6, "paint");
    b.box(.014, .014, .014, "#ff6a4d", { x: px, z: pz, y: 1.03 }, "lights");
    // battery halls in white with a green band (the energy is stored here)
    for (const z of [-.4, -.02]) {
      b.box(.16, .12, .14, "#eeeee8", { x: .32, z: z + .2, y: .02 }, "paint");
      b.box(.162, .02, .142, "#2b9a5e", { x: .32, z: z + .2, y: .1 }, "paint");
    }
    // the control building: bronze fins over glass
    b.box(.3, .2, .16, GC.sand, { x: -.2, z: -.4, y: .02 }, "stone");
    glassWall(b, -.2, -.315, .05, .26, .11, 4, GC.glassDeep);
    gcFins(b, { x: -.2, z: -.31, y: .05, w: .26, h: .14, n: 9 });
    b.box(.2, .004, .05, GC.lamp, { x: -.2, z: -.3, y: .2 }, "lights");
    for (const x of [-.44, .44]) gcLamp(b, x, .44, .26);
  },
  // برج الحاضرة: a twisting tower of glass plates that turns as it rises, an open crown and a spire, a square with a fountain
  civic_tower(b) {
    gcPlaza(b, { color: "#ddd2bd" });
    b.cyl(.36, .38, .06, GC.sand, { z: -.05, y: .024 }, 24, "stone");
    const floors = 34, top = 4.2;
    for (let i = 0; i < floors; i++) {
      const t = i / floors, s = .44 - t * .17, y = .084 + i * (top / floors), a = t * Math.PI * .5;
      b.box(s, top / floors - .012, s, i % 6 === 5 ? GC.glassGold : GC.glass, { z: -.05, y, ry: a }, "glass");
      b.box(s + .022, .012, s + .022, GC.pearl, { z: -.05, y: y + top / floors - .012, ry: a }, "metal");
      if (i % 3 === 1) b.box(s * .5, .05, .004, "#f4d39a", { z: -.05 + Math.cos(a) * (s / 2 + .002), x: Math.sin(a) * (s / 2 + .002), y: y + .02, ry: a }, "lights");
    }
    // the crown: four leaning blades round an open lantern, and the spire
    const cy = .084 + top;
    for (let k = 0; k < 4; k++) {
      const a = Math.PI * .5 + k * Math.PI / 2;
      b.box(.03, .55, .1, GC.bronze, { x: Math.sin(a) * .1, z: -.05 + Math.cos(a) * .1, y: cy, ry: a, rx: Math.cos(a) * -.12, rz: Math.sin(a) * .12 }, "metal");
    }
    b.cyl(.07, .1, .3, "#f6e3b5", { z: -.05, y: cy }, 12, "lights");
    b.cyl(.004, .02, .7, GC.pearl, { z: -.05, y: cy + .3 }, 8, "metal");
    b.box(.02, .02, .02, "#ff6a4d", { z: -.05, y: cy + 1.0 }, "lights");
    // the square: a fountain, palms, benches and a lit ring
    b.cyl(.08, .09, .03, GC.stone, { x: .3, z: .32, y: .024 }, 14, "stone");
    b.cyl(.065, .065, .004, GC.water, { x: .3, z: .32, y: .055 }, 14, "glass");
    b.cyl(.01, .01, .08, "#d8eef2", { x: .3, z: .32, y: .055 }, 6, "glass");
    for (const [x, z] of [[-.38, .38], [.4, -.36], [-.4, -.36]]) palm(b, x, z, .5);
    civicBench(b, .05, .4); civicBench(b, -.18, .4);
    b.add(new THREE.TorusGeometry(.37, .006, 4, 40), "#e9c88a", { z: -.05, y: .087, rx: Math.PI / 2 }, "lights");
    gcGroundLights(b, [[.15, .42], [-.3, .42], [.42, .1]]);
  },
  // المجمّع الثقافي: a civic square framed by a round theatre, a stepped museum and a hall under a lattice dome
  civic_culture(b) {
    gcPlaza(b, { color: "#ddd1b9" });
    // the theatre: a drum of sand concrete with a band of glass and a bronze ring
    b.cyl(.22, .24, .3, GC.sand, { x: -.24, z: -.22, y: .024 }, 24, "stone");
    b.cyl(.225, .225, .07, GC.glassDeep, { x: -.24, z: -.22, y: .2 }, 24, "glass");
    b.cyl(.245, .245, .025, GC.bronze, { x: -.24, z: -.22, y: .325 }, 24, "metal");
    b.cyl(.235, .2, .05, GC.pearl, { x: -.24, z: -.22, y: .35 }, 24, "paint");
    b.cyl(.2, .2, .006, "#f2d39b", { x: -.24, z: -.22, y: .21 }, 24, "lights");
    // the museum: stepped terraces with planting, a tall glass slot as its door
    for (let i = 0; i < 4; i++) {
      b.box(.4 - i * .07, .1, .36 - i * .06, i % 2 ? "#e6d8bf" : GC.sand, { x: .22, z: -.2 - i * .015, y: .024 + i * .1 }, "stone");
      b.box(.4 - i * .07, .012, .02, GC.green, { x: .22, z: -.2 - i * .015 + (.36 - i * .06) / 2, y: .124 + i * .1 }, "matte");
    }
    b.box(.06, .3, .01, GC.glassLight, { x: .22, z: -.015, y: .024 }, "glass");
    b.box(.04, .26, .004, "#f4d6a0", { x: .22, z: -.008, y: .03 }, "lights");
    // the hall under a lattice dome: a canopy of bronze arcs on a ring
    b.cyl(.16, .16, .14, "#efe3cc", { x: .05, z: .22, y: .024 }, 18, "stone");
    b.add(new THREE.SphereGeometry(.25, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), GC.pearl, { x: .05, z: .22, y: .12, sy: .55 }, "paint");
    for (let k = 0; k < 12; k++) b.add(new THREE.TorusGeometry(.252, .006, 4, 20, Math.PI / 2.4), GC.bronze, { x: .05, z: .22, y: .12, ry: k * Math.PI / 6, rz: Math.PI / 2 - Math.PI / 2.4 + .0, sy: .55 }, "metal");
    b.cyl(.27, .27, .012, GC.pearl, { x: .05, z: .22, y: .12 }, 24, "paint");
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; b.cyl(.006, .006, .12, GC.graphite, { x: .05 + Math.cos(a) * .25, z: .22 + Math.sin(a) * .25, y: .02 }, 5, "metal"); }
    b.cyl(.15, .15, .005, "#f3dcab", { x: .05, z: .22, y: .02 }, 18, "lights");
    // the square: lanterns, olive trees, a lit line to the doors
    for (const [x, z] of [[-.42, .1], [-.42, .42], [.42, .42]]) gcPlanter(b, x, z, .45);
    for (const [x, z] of [[-.25, .1], [-.05, -.02], [.3, .1]]) gcLamp(b, x, z, .18);
    gcGroundLights(b, [[-.24, .04], [.22, .02], [.05, .44], [-.2, .3]]);
  }
});

/**
 * The upgrades of الحاضرة الكبرى: each one changes the building itself, so it reads as the big version
 * from afar (the base model is drawn a little smaller, and the new parts stand round and on top of it).
 */
const GC_UPGRADE = {
  // مول الجوف الكبير: a glass atrium roof, a grand canopy over the doors and a parking deck
  mall(b) {
    b.box(.5, .1, .3, GC.glassLight, { z: -.05, y: .52 }, "glass");
    for (let i = 0; i < 6; i++) b.box(.008, .1, .3, GC.bronze, { x: -.22 + i * .088, z: -.05, y: .52 }, "metal");
    b.box(.52, .01, .32, GC.lamp, { z: -.05, y: .5 }, "lights");
    b.box(.7, .016, .16, GC.pearl, { z: .38, y: .2 }, "paint");
    for (const x of [-.33, .33]) b.cyl(.01, .01, .18, GC.graphite, { x, z: .44, y: .02 }, 6, "metal");
    b.box(.5, .004, .12, GC.lamp, { z: .38, y: .196 }, "lights");
  },
  // مستشفى إقليمي: a new glass wing, a helipad on the roof and an ambulance canopy
  hospital(b) {
    b.box(.2, .55, .3, GC.glassLight, { x: .36, z: -.1, y: .02 }, "glass");
    for (let y = .1; y < .56; y += .09) b.box(.21, .01, .31, GC.pearl, { x: .36, z: -.1, y }, "metal");
    b.cyl(.13, .13, .02, "#4a4f52", { x: .36, z: -.1, y: .58 }, 16, "paint");
    b.box(.1, .004, .018, "#f2f2ea", { x: .36, z: -.1, y: .601 });
    for (const dx of [-.04, .04]) b.box(.018, .004, .09, "#f2f2ea", { x: .36 + dx, z: -.1, y: .601 });
    b.cyl(.13, .13, .004, "#f3dcab", { x: .36, z: -.1, y: .6 }, 16, "lights");
    b.box(.26, .014, .14, "#c33a32", { x: -.25, z: .4, y: .18 }, "paint");
    b.box(.2, .004, .1, GC.lamp, { x: -.25, z: .4, y: .176 }, "lights");
  },
  // جامعة الجوف البحثية: a research tower with an observatory dome and a solar canopy over the yard
  university(b) {
    b.box(.18, .9, .18, GC.sand, { x: .34, z: -.32, y: .02 }, "stone");
    gcFins(b, { x: .34, z: -.32 + .095, y: .05, w: .16, h: .8, n: 6 });
    b.dome(.1, "#e8e8e0", { x: .34, z: -.32, y: .92 }, "metal");
    b.box(.02, .06, .14, GC.graphite, { x: .34, z: -.32, y: .95, ry: .5 }, "metal");
    b.box(.46, .012, .18, "#25435a", { x: -.1, z: .38, y: .24, rx: -.2 }, "glass");
    for (const x of [-.3, .1]) b.cyl(.008, .008, .22, GC.graphite, { x, z: .38, y: .02 }, 6, "metal");
  },
  // مدينة ألعاب كبرى: a roller coaster loop and a drop tower over the park
  themepark(b) {
    b.add(new THREE.TorusGeometry(.2, .012, 6, 28), "#c0392b", { x: .25, z: .2, y: .26, ry: .6 }, "paint");
    b.add(new THREE.TorusGeometry(.2, .004, 4, 28), GC.lamp, { x: .25, z: .2, y: .26, ry: .6 }, "lights");
    for (const s of [-1, 1]) b.box(.012, .26, .012, "#7a7a7a", { x: .25 + s * .1, z: .2 - s * .07, y: .02 }, "metal");
    b.cyl(.03, .035, 1.0, "#e9e4d8", { x: -.35, z: .35, y: .02 }, 10, "paint");
    b.cyl(.07, .07, .06, "#2c5d8f", { x: -.35, z: .35, y: .6 }, 12, "paint");
    b.box(.02, .02, .02, "#ff6a4d", { x: -.35, z: .35, y: 1.03 }, "lights");
    for (let y = .15; y < 1; y += .2) b.cyl(.036, .036, .01, GC.lamp, { x: -.35, z: .35, y }, 10, "lights");
  },
  // مطار دولي: a control tower, a long wave roof over the terminal and jet bridges
  airport(b) {
    b.cyl(.025, .035, .9, GC.pearl, { x: .38, z: -.38, y: .02 }, 10, "paint");
    b.cyl(.075, .05, .08, GC.glassDeep, { x: .38, z: -.38, y: .92 }, 12, "glass");
    b.cyl(.085, .085, .02, GC.pearl, { x: .38, z: -.38, y: 1.0 }, 12, "paint");
    b.cyl(.07, .07, .006, GC.lamp, { x: .38, z: -.38, y: .94 }, 12, "lights");
    gcBeacon(b, .38, 1.02, -.38, .1);
    for (let i = 0; i < 8; i++) b.box(.11, .014, .4, GC.pearl, { x: -.4 + i * .1, z: -.25, y: .3 + Math.sin(i * .8) * .03, rz: Math.cos(i * .8) * .25 }, "paint");
    b.box(.78, .004, .3, GC.lamp, { x: -.05, z: -.25, y: .28 }, "lights");
    for (const x of [-.3, -.05, .2]) b.box(.04, .04, .18, "#d9d9d2", { x, z: -.02, y: .12 }, "paint");
  },
  // محطة قطار الجوف الكبرى: long curved canopies over the platforms and tracks
  station(b) {
    // gull-wing canopies on a row of columns over two platforms, a train waiting between them
    for (const z of [.2, .42]) {
      for (let i = 0; i < 5; i++) b.cyl(.008, .008, .19, GC.graphite, { x: -.4 + i * .2, z, y: .024 }, 6, "metal");
      b.box(.94, .014, .02, GC.bronze, { z, y: .21 }, "metal");
      for (const sd of [-1, 1]) b.box(.94, .008, .07, GC.pearl, { z: z + sd * .036, y: .215 + .012, rx: sd * .22 }, "paint");
      b.box(.88, .004, .05, GC.lamp, { z, y: .205 }, "lights");
      b.box(.94, .03, .06, "#cfc6b4", { z, y: .024 }, "stone");
    }
    for (const dz of [-.02, .02]) b.box(.96, .006, .006, "#8d8d88", { z: .31 + dz, y: .025 }, "metal");
    b.rbox(.8, .07, .06, .02, "#f1efe8", { x: -.05, z: .31, y: .03 }, "paint");
    b.box(.78, .025, .062, "#2b5d73", { x: -.05, z: .31, y: .06 }, "glass");
    b.box(.8, .008, .062, "#1f7a52", { x: -.05, z: .31, y: .04 }, "paint");
    b.box(.7, .012, .004, GC.lamp, { x: -.05, z: .342, y: .068 }, "lights");
  },

  // استاد الجوف الكبير: a ring roof over the stands and four floodlight masts
  bigstadium(b) {
    b.add(new THREE.TorusGeometry(.38, .045, 6, 32), GC.pearl, { y: .34, rx: Math.PI / 2, sy: 1, sz: .25 }, "paint");
    b.add(new THREE.TorusGeometry(.38, .008, 4, 32), GC.lamp, { y: .32, rx: Math.PI / 2 }, "lights");
    for (const [x, z] of [[-.44, -.44], [.44, -.44], [-.44, .44], [.44, .44]]) {
      b.cyl(.01, .014, .55, GC.graphite, { x, z, y: .02 }, 6, "metal");
      b.box(.08, .05, .02, "#f6f2df", { x, z, y: .56, ry: Math.atan2(x, z) }, "lights");
    }
  },
  // أبراج الرافعية الكبرى: the towers take crowns of bronze triangles, a sky bridge and a lit spire
  skyline(b) {
    b.box(.4, .08, .1, GC.pearl, { x: 0, z: -.18, y: 1.5 }, "paint");
    b.box(.38, .04, .102, GC.glassLight, { x: 0, z: -.18, y: 1.52 }, "glass");
    b.box(.34, .004, .08, GC.lamp, { x: 0, z: -.18, y: 1.497 }, "lights");
    gcTriangles(b, { x: -.2, z: -.19, y: 2.48, w: .26, d: .24, size: .035 });
    gcTriangles(b, { x: .2, z: -.17, y: 2.03, w: .23, d: .21, size: .03 });
    b.cyl(.004, .016, .6, GC.bronze, { x: -.2, z: -.19, y: 2.5 }, 8, "metal");
    b.box(.02, .02, .02, "#ff6a4d", { x: -.2, z: -.19, y: 3.1 }, "lights");
  },
  // محطة تحلية كبرى: a row of big storage tanks and a pipe rack
  desal(b) {
    for (const x of [-.32, -.1, .12]) {
      b.cyl(.09, .09, .22, "#e8e4d8", { x, z: .36, y: .02 }, 14, "paint");
      b.cyl(.092, .092, .02, "#2e7c94", { x, z: .36, y: .16 }, 14, "paint");
    }
    processPipe(b, [[-.42, .26, .26], [.4, .26, .26]], .012, "#3e8fb0");
    for (const x of [-.4, 0, .4]) b.box(.012, .26, .012, GC.graphite, { x, z: .26, y: .02 }, "metal");
  },
  // محطة كهرباء كبرى: a cooling tower with its plume of white and a second tall stack
  powerplant(b) {
    b.lathe([[.16, 0], [.12, .2], [.1, .35], [.115, .48]], "#dcd8cc", { x: .3, z: .3, y: .02 }, 22, "paint");
    b.cyl(.12, .12, .01, "#f3dcab", { x: .3, z: .3, y: .5 }, 16, "lights");
    b.cyl(.03, .035, .95, "#d9d4c8", { x: -.38, z: .38, y: .02 }, 10, "paint");
    for (const y of [.75, .85]) b.cyl(.036, .036, .03, "#c0392b", { x: -.38, z: .38, y }, 10, "paint");
    b.box(.02, .02, .02, "#ff6a4d", { x: -.38, z: .38, y: .98 }, "lights");
  }
};
for (const [id, upgrade] of Object.entries(GREATER_CITY_UPGRADES)) {
  if (id === "avenue") continue; // the boulevard is drawn as a road: its upgrade shows on the road itself
  MAKERS[`civic_up_${id}`] = (b, ground, seed) => {
    const draw = MAKERS[modelKey(id, upgrade.from)];
    graft(b, (base) => draw(base, ground, seed), { s: .9, z: -.02 });
    GC_UPGRADE[id]?.(b);
  };
}
export function modelKey(id, lvl) {
  if (id !== "avenue" && lvl > GREATER_CITY_UPGRADES[id]?.from) return `civic_up_${id}`;
  if (landStyle && STYLED.includes(id)) return `${id}_${landStyle}`;
  if (id === "vault") return lvl >= CENTRAL_VAULT_LEVEL ? "vaultCentral" : lvl >= 3 ? "vault2" : lvl >= 1 ? "vault1" : "vault";
  if (id === "house") return lvl === 0 ? "tent0" : `house${lvl}`;
  if (lvl > 0 && BIZ.includes(id)) return `${id}${lvl}`;
  if (lvl > 0 && MIL_MODELS.includes(id)) return `${id}${Math.min(2, lvl)}`;
  return id;
}

export const COLORS = C;
