// The town in 3D: ground, roads, buildings (instanced), light and shadow, day and night, cars and smoke.
import * as THREE from "three";
import { MAP_SIZE as N, B } from "./data.js";
import { idx, inMap } from "./sim.js";
import { model, modelKey, makerSeeded } from "./models.js";

const HALF = N / 2;
export const tileCenter = (x, y) => new THREE.Vector3(x - HALF + 0.5, 0, y - HALF + 0.5);
const roadAt = (t) => t?.b && (t.b.id === "road" || t.b.id === "asphalt");
/** A steady pseudo-random number in 0..1 for a tile (the same every time). */
const hash = (x, y, k = 0) => {
  let n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(k | 0, 1442695041)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
const easeBack = (t) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

/** Sand with soft wind ripples and grain, drawn once into a small repeating texture. */
function sandTexture() {
  const S = 256, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d"), img = g.createImageData(S, S), TAU = Math.PI * 2;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const warp = Math.sin(TAU * y * 2 / S) * 0.05 + Math.sin(TAU * (y * 5 + x) / S) * 0.012;
    const ripple = Math.sin(TAU * (x * 7 / S + warp)) * 0.5 + 0.5;
    const v = 0.92 + ripple * ripple * 0.05 + (rnd() - 0.5) * 0.06;
    const i = (y * S + x) * 4;
    img.data[i] = Math.min(255, 255 * v); img.data[i + 1] = Math.min(255, 250 * v); img.data[i + 2] = Math.min(255, 240 * v); img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A warm round glow for light pools on the ground at night. */
function glowTexture() {
  const S = 64, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d"), grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, "rgba(255,210,140,1)"); grad.addColorStop(0.4, "rgba(255,180,90,0.45)"); grad.addColorStop(1, "rgba(255,160,60,0)");
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}

/** Soft round cloud shadows that drift over the land. */
function cloudTexture() {
  const S = 256, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9; i++) {
    const cx = rnd() * S, cy = rnd() * S, r = 20 + rnd() * 34;
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S], [S, S], [-S, -S], [S, -S], [-S, S]]) {
      for (let k = 0; k < 4; k++) {
        const x = cx + ox + (k - 1.5) * r * 0.55, y = cy + oy + Math.sin(k * 2) * r * 0.25, rr = r * (0.7 + (k % 2) * 0.3);
        const grad = g.createRadialGradient(x, y, 0, x, y, rr);
        grad.addColorStop(0, "rgba(0,0,0,0.55)"); grad.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grad; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class World {
  constructor(canvas, { quality = "high" } = {}) {
    this.canvas = canvas;
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== "low", powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = quality !== "low";
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog("#f3dcae", 40, 90);

    // Camera: an isometric-style orthographic view that pans, zooms and turns by quarter turns.
    this.view = { x: 0, z: 2, zoom: 1, yaw: Math.PI / 4, yawTarget: Math.PI / 4, pitch: 0.62 };
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);

    // Light: sky and ground fill, plus the sun that casts shadows.
    this.hemi = new THREE.HemisphereLight("#fff4dd", "#c9a46a", 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight("#fff1d6", 2.2);
    this.sun.castShadow = quality !== "low";
    const size = quality === "high" ? 2048 : 1024;
    this.sun.shadow.mapSize.set(size, size);
    Object.assign(this.sun.shadow.camera, { left: -HALF - 2, right: HALF + 2, top: HALF + 2, bottom: -HALF - 2, near: 1, far: 80 });
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    this.mats = {
      matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }),
      shiny: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.35 }),
      lights: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0 }),
      ghost: new THREE.MeshStandardMaterial({ color: "#7ee0b8", transparent: true, opacity: 0.55, roughness: 0.6 }),
      ghostBad: new THREE.MeshStandardMaterial({ color: "#ff7a6a", transparent: true, opacity: 0.55, roughness: 0.6 })
    };

    this.buildGround();
    this.instances = new Map(); // key -> { matte, shiny, lights }
    this.roadMesh = null;
    this.overlay = null;
    this.hover = null;
    this.ghost = new THREE.Group();
    this.scene.add(this.ghost);
    this.cars = [];
    this.smoke = null;
    this.night = 0;
    this.dayCycle = true;
    this.clock = 0;
    this.resize();
  }

  // ---------- ground ----------

  buildGround() {
    // The desert around the town: a wide sand plain with soft dunes.
    const outer = new THREE.PlaneGeometry(140, 140, 70, 70);
    outer.rotateX(-Math.PI / 2);
    const p = outer.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), d = Math.max(Math.abs(x), Math.abs(z));
      const dune = d > HALF + 1 ? (Math.sin(x * 0.35) * Math.cos(z * 0.28) + Math.sin((x + z) * 0.17)) * 0.9 * Math.min(1, (d - HALF - 1) / 6) : 0;
      p.setY(i, dune - 0.02);
    }
    outer.computeVertexNormals();
    const uv = outer.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 0.3, p.getZ(i) * 0.3);
    this.sand = sandTexture();
    const desert = new THREE.Mesh(outer, new THREE.MeshStandardMaterial({ color: "#f1d49c", map: this.sand, roughness: 1 }));
    desert.receiveShadow = true;
    this.scene.add(desert);
    this.ground = null;

    // Flat-topped mesas of Najd on the horizon.
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + hash(i, 1) * 0.3, r = 26 + hash(i, 2) * 14;
      const geo = makerSeeded("mesa", i + 1).matte;
      const m = new THREE.Mesh(geo, this.mats.matte);
      m.position.set(Math.cos(a) * r, -0.1, Math.sin(a) * r);
      m.rotation.y = hash(i, 3) * Math.PI;
      m.receiveShadow = true;
      this.scene.add(m);
    }

    // Desert plants all around the town (outside the buildable land).
    const out = { shrub: [], grassTuft: [], acacia: [], rock: [] };
    for (let i = 0; i < (this.quality === "low" ? 500 : 1100); i++) {
      const x = (hash(i, 11) - 0.5) * 70, z = (hash(i, 12) - 0.5) * 70;
      if (Math.max(Math.abs(x), Math.abs(z)) < HALF + 0.6) continue;
      const pick = hash(i, 13);
      const key = pick < 0.42 ? "grassTuft" : pick < 0.8 ? "shrub" : pick < 0.93 ? "acacia" : "rock";
      out[key].push(this.place(x, z, hash(i, 14) * 6, key === "acacia" ? 0.8 + hash(i, 15) * 0.6 : 0.7 + hash(i, 15) * 0.6));
    }
    for (const [key, list] of Object.entries(out)) this.addInstances(model(key), list, key === "acacia");

    // Drifting cloud shadows.
    if (this.quality !== "low") {
      const g = new THREE.PlaneGeometry(90, 90); g.rotateX(-Math.PI / 2);
      this.clouds = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: "#2a1a08", map: cloudTexture(), transparent: true, opacity: 0.2, depthWrite: false }));
      this.clouds.material.map.repeat.set(2.2, 2.2);
      this.clouds.position.y = 0.03;
      this.clouds.renderOrder = 1;
      this.scene.add(this.clouds);
    }
  }

  /** A transform at a ground point with a turn and a size. */
  place(x, z, ry = 0, s = 1, y = 0) {
    const m = new THREE.Matrix4();
    m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(s, s, s));
    return m;
  }

  /** Instanced meshes for one model at many places. Returns the meshes so they can be removed. */
  addInstances(geo, list, shadow = false) {
    const meshes = [];
    if (!geo || !list.length) return meshes;
    for (const set of ["matte", "shiny", "lights"]) {
      if (!geo[set]) continue;
      const mesh = new THREE.InstancedMesh(geo[set], this.mats[set], list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.castShadow = shadow && set !== "lights" && this.quality !== "low";
      mesh.receiveShadow = set !== "lights";
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      meshes.push(mesh);
    }
    return meshes;
  }

  removeAll(list) { for (const m of list || []) { this.scene.remove(m); m.dispose(); } }

  /** The town's own tiles: sand, wadi, with a little colour noise. Rebuilt when the land changes. */
  syncTiles(s) {
    if (this.ground) { this.scene.remove(this.ground); this.ground.geometry.dispose(); }
    const pos = [], col = [], uvs = [], c = new THREE.Color();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const t = s.tiles[idx(x, y)];
      const n = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      c.set(t.t === "wadi" ? "#c6ad72" : "#f1d49c");
      c.offsetHSL(0, 0, ((n % 7) - 3) * 0.006);
      const x0 = x - HALF, z0 = y - HALF;
      const quad = [[x0, z0], [x0, z0 + 1], [x0 + 1, z0 + 1], [x0, z0], [x0 + 1, z0 + 1], [x0 + 1, z0]];
      for (const [qx, qz] of quad) { pos.push(qx, 0, qz); col.push(c.r, c.g, c.b); uvs.push(qx * 0.3, qz * 0.3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    this.ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, map: this.sand, roughness: 1 }));
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    // After rain the wadi runs: a thin sheet of water along its bed.
    if (this.flood) { this.scene.remove(this.flood); this.flood.geometry.dispose(); }
    const wp = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (s.tiles[idx(x, y)].t === "wadi") {
      const x0 = x - HALF + 0.08, z0 = y - HALF + 0.08, x1 = x0 + 0.84, z1 = z0 + 0.84;
      for (const [qx, qz] of [[x0, z0], [x0, z1], [x1, z1], [x0, z0], [x1, z1], [x1, z0]]) wp.push(qx, 0.012, qz);
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute("position", new THREE.Float32BufferAttribute(wp, 3));
    wg.computeVertexNormals();
    this.flood = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: "#5aa6c4", roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.55, depthWrite: false }));
    this.flood.visible = false;
    this.scene.add(this.flood);
  }

  /** Plants and pebbles on land nobody has built on yet. */
  syncScenery(s) {
    this.removeAll(this.sceneryMeshes);
    const lists = { shrub: [], grassTuft: [], acacia: [], pebbles: [] };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const t = s.tiles[idx(x, y)];
      if (t.b || t.t === "rock") continue;
      const p = tileCenter(x, y), h = hash(x, y, 5), j = (k) => (hash(x, y, k) - 0.5) * 0.6;
      if (t.t === "wadi") {
        if (h < 0.1) lists.acacia.push(this.place(p.x + j(6), p.z + j(7), h * 60, 0.7 + h * 3));
        else if (h < 0.55) lists.shrub.push(this.place(p.x + j(6), p.z + j(7), h * 40, 0.8 + h));
        if (hash(x, y, 8) < 0.45) lists.pebbles.push(this.place(p.x + j(9), p.z + j(10), h * 9));
        if (hash(x, y, 11) < 0.5) lists.grassTuft.push(this.place(p.x + j(12), p.z + j(13), h * 7, 0.9));
      } else {
        if (h < 0.035) lists.acacia.push(this.place(p.x + j(6), p.z + j(7), h * 60, 0.8 + h * 6));
        else if (h < 0.16) lists.shrub.push(this.place(p.x + j(6), p.z + j(7), h * 40, 0.7 + h));
        else if (h < 0.3) lists.grassTuft.push(this.place(p.x + j(6), p.z + j(7), h * 30, 0.8));
      }
    }
    this.sceneryMeshes = Object.entries(lists).flatMap(([k, l]) => this.addInstances(model(k), l, k === "acacia"));
  }

  // ---------- roads ----------

  syncRoads(s) {
    if (this.roadMesh) { this.scene.remove(this.roadMesh); this.roadMesh.geometry.dispose(); }
    this.removeAll(this.lampMeshes);
    const lamps = [];
    this.lampGlows = [];
    const pos = [], col = [], c = new THREE.Color();
    const quad = (x0, z0, x1, z1, y, color) => {
      c.set(color);
      for (const [qx, qz] of [[x0, z0], [x0, z1], [x1, z1], [x0, z0], [x1, z1], [x1, z0]]) { pos.push(qx, y, qz); col.push(c.r, c.g, c.b); }
    };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const t = s.tiles[idx(x, y)];
      if (!roadAt(t)) continue;
      const paved = t.b.id === "asphalt";
      const cx = x - HALF + 0.5, cz = y - HALF + 0.5;
      if (paved) {
        quad(cx - 0.5, cz - 0.5, cx + 0.5, cz + 0.5, 0.004, (x + y) % 2 ? "#d9cfbb" : "#d2c7b1");
        // a street lamp on every other tile, at a corner without a road
        if ((x + y) % 2 === 0) { lamps.push(this.place(cx + 0.44, cz + 0.44, Math.PI * 0.75)); this.lampGlows.push([cx + 0.37, cz + 0.37, 1.1]); }
      }
      const w = paved ? 0.42 : 0.36;
      quad(cx - w, cz - w, cx + w, cz + w, 0.006, paved ? "#4d4f55" : "#a98457");
      const link = (dx, dy) => inMap(x + dx, y + dy) && roadAt(s.tiles[idx(x + dx, y + dy)]);
      if (link(1, 0)) quad(cx + w, cz - w, cx + 0.5, cz + w, 0.006, paved ? "#4d4f55" : "#a98457");
      if (link(-1, 0)) quad(cx - 0.5, cz - w, cx - w, cz + w, 0.006, paved ? "#4d4f55" : "#a98457");
      if (link(0, 1)) quad(cx - w, cz + w, cx + w, cz + 0.5, 0.006, paved ? "#4d4f55" : "#a98457");
      if (link(0, -1)) quad(cx - w, cz - 0.5, cx + w, cz - w, 0.006, paved ? "#4d4f55" : "#a98457");
      if (paved) {
        // dashed centre lines and kerbs
        if (link(1, 0) || link(-1, 0)) for (const o of [-0.3, 0.05, 0.3]) quad(cx + o - 0.06, cz - 0.012, cx + o + 0.06, cz + 0.012, 0.008, "#f3d77a");
        if (link(0, 1) || link(0, -1)) for (const o of [-0.3, 0.05, 0.3]) quad(cx - 0.012, cz + o - 0.06, cx + 0.012, cz + o + 0.06, 0.008, "#f3d77a");
      } else {
        // wheel ruts
        if (link(1, 0) || link(-1, 0)) for (const o of [-0.12, 0.12]) quad(cx - 0.5, cz + o - 0.015, cx + 0.5, cz + o + 0.015, 0.007, "#8a6842");
        if (link(0, 1) || link(0, -1)) for (const o of [-0.12, 0.12]) quad(cx + o - 0.015, cz - 0.5, cx + o + 0.015, cz + 0.5, 0.007, "#8a6842");
      }
    }
    this.lampMeshes = this.addInstances(model("lamp"), lamps, true);
    if (!pos.length) { this.roadMesh = null; return; }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    this.roadMesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    this.roadMesh.receiveShadow = true;
    this.scene.add(this.roadMesh);
  }

  // ---------- buildings ----------

  /** Put every building (and rock) in place. Buildings turn their front to a neighbouring road. */
  syncBuildings(s) {
    const groups = new Map();
    const push = (key, ground, m) => { const k = key === "palms" ? `palms:${ground}` : key; if (!groups.has(k)) groups.set(k, { key, ground, list: [] }); groups.get(k).list.push(m); };
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(1, 1, 1);
    this.smokers = [];
    const seen = new Map(), where = new Map(), glows = [];
    this.anims ||= new Map();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const t = s.tiles[idx(x, y)];
      const p = tileCenter(x, y);
      if (this.prevKeys?.has(idx(x, y)) && !t.b) this.puff(p, 12);
      if (!t.b) {
        if (t.t === "rock") { q.setFromAxisAngle(up, ((x * 7 + y * 13) % 8) * 0.8); m4.compose(p, q, sc); push("rock", "sand", m4.clone()); }
        continue;
      }
      if (roadAt(t)) continue;
      // Face the road: +z of the model points at the first road neighbour.
      let angle = 0;
      const dirs = [[0, 1, 0], [1, 0, Math.PI / 2], [0, -1, Math.PI], [-1, 0, -Math.PI / 2]];
      for (const [dx, dy, a] of dirs) if (inMap(x + dx, y + dy) && roadAt(s.tiles[idx(x + dx, y + dy)])) { angle = a; break; }
      q.setFromAxisAngle(up, angle);
      m4.compose(p, q, sc);
      const key = modelKey(t.b.id, t.b.lvl), gk = key === "palms" ? `palms:${t.t}` : key;
      push(key, t.t, m4.clone());
      const i = idx(x, y);
      seen.set(i, gk);
      where.set(i, { k: gk, i: groups.get(gk).list.length - 1, m: m4.clone() });
      if (gk === "tent0") glows.push([p.x + Math.sin(angle) * 0.38 + Math.cos(angle) * 0.33, p.z + Math.cos(angle) * 0.38 - Math.sin(angle) * 0.33, 0.8]);
      else if (gk.startsWith("house") || ["mosque", "grocery", "cafe", "mandi", "souq", "clinic", "hotel", "mall", "bigmosque"].includes(gk)) glows.push([p.x + Math.sin(angle) * 0.42, p.z + Math.cos(angle) * 0.42, 0.75]);
      if (this.prevKeys && this.prevKeys.get(i) !== gk) { this.anims.set(i, this.clock); this.puff(p, 16); }
      if (["factory", "generator", "powerplant", "mandi", "datefactory"].includes(t.b.id)) this.smokers.push(p.clone());
    }
    // Reuse or rebuild the instanced meshes.
    for (const [k, inst] of this.instances) if (!groups.has(k)) { for (const m of Object.values(inst)) if (m?.isMesh) { this.scene.remove(m); m.dispose(); } this.instances.delete(k); }
    for (const [k, { key, ground, list }] of groups) {
      let inst = this.instances.get(k);
      if (!inst || inst.capacity < list.length) {
        if (inst) for (const m of Object.values(inst)) if (m?.isMesh) { this.scene.remove(m); m.dispose(); }
        const geo = model(key, ground);
        const capacity = Math.max(8, Math.ceil(list.length * 1.5));
        inst = { capacity };
        for (const set of ["matte", "shiny", "lights"]) {
          if (!geo[set]) continue;
          const mesh = new THREE.InstancedMesh(geo[set], this.mats[set], capacity);
          mesh.castShadow = set !== "lights" && this.quality !== "low";
          mesh.receiveShadow = set !== "lights";
          mesh.frustumCulled = false;
          this.scene.add(mesh);
          inst[set] = mesh;
        }
        this.instances.set(k, inst);
      }
      for (const set of ["matte", "shiny", "lights"]) {
        const mesh = inst[set];
        if (!mesh) continue;
        list.forEach((m, i) => mesh.setMatrixAt(i, m));
        mesh.count = list.length;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    this.syncSmoke();
    this.prevKeys = seen;
    this.buildingGlows = glows;
    this.where = where;
    this.homes = [...where.entries()].filter(([, w]) => w.k === "tent0" || w.k.startsWith("house")).map(([i]) => i);
  }

  sync(s, what = { tiles: true, roads: true, buildings: true }) {
    if (what.tiles) this.syncTiles(s);
    if (what.roads) this.syncRoads(s);
    if (what.buildings) { this.syncBuildings(s); this.syncScenery(s); }
    this.syncGlows();
    if (this.flood) this.flood.visible = s.events.some((e) => e.id === "rain");
    this.roads = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (roadAt(s.tiles[idx(x, y)])) this.roads.push([x, y]);
    this.state = s;
    this.syncCars();
    this.syncLife(s);
  }

  // ---------- life: cars and smoke ----------

  syncCars() {
    const want = this.quality === "low" ? 0 : Math.min(40, Math.floor(this.roads.length / 5));
    if (!this.carMesh) {
      const body = new THREE.BoxGeometry(0.2, 0.08, 0.11); body.translate(0, 0.05, 0);
      const cab = new THREE.BoxGeometry(0.11, 0.06, 0.1); cab.translate(-0.01, 0.12, 0);
      const g = mergeTwo(body, cab);
      this.carMesh = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.3 }), 40);
      this.carMesh.castShadow = true;
      this.carMesh.frustumCulled = false;
      const colors = ["#f2f2f2", "#d8d8d8", "#b3261e", "#2f5f9e", "#1d1d1f", "#c9a46a", "#f2f2f2"];
      for (let i = 0; i < 40; i++) this.carMesh.setColorAt(i, new THREE.Color(colors[i % colors.length]));
      this.scene.add(this.carMesh);
    }
    while (this.cars.length < want && this.roads.length) {
      const [x, y] = this.roads[Math.floor(Math.random() * this.roads.length)];
      this.cars.push({ x, y, tx: x, ty: y, t: 1, speed: 0.6 + Math.random() * 0.6 });
    }
    this.cars.length = Math.min(this.cars.length, want);
    this.carMesh.count = this.cars.length;
  }

  stepCars(dt) {
    if (!this.carMesh || !this.cars.length) return;
    const s = this.state, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    this.cars.forEach((c, i) => {
      c.t += dt * c.speed;
      if (c.t >= 1) {
        c.x = c.tx; c.y = c.ty; c.t = 0;
        const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => inMap(c.x + dx, c.y + dy) && roadAt(s.tiles[idx(c.x + dx, c.y + dy)]) && !(c.x + dx === c.px && c.y + dy === c.py));
        const pick = opts.length ? opts[Math.floor(Math.random() * opts.length)] : [c.px - c.x || 0, c.py - c.y || 0];
        c.px = c.x; c.py = c.y; c.tx = c.x + (pick[0] || 0); c.ty = c.y + (pick[1] || 0);
        if (!inMap(c.tx, c.ty) || !roadAt(s.tiles[idx(c.tx, c.ty)])) { c.tx = c.x; c.ty = c.y; }
      }
      const a = tileCenter(c.x, c.y), b = tileCenter(c.tx, c.ty);
      v.lerpVectors(a, b, c.t);
      const dx = b.x - a.x, dz = b.z - a.z;
      // keep to the right-hand side of the road
      if (dx || dz) { v.x += -dz * 0.13; v.z += dx * 0.13; }
      q.setFromAxisAngle(up, Math.atan2(-dz, dx));
      m4.compose(v, q, sc);
      this.carMesh.setMatrixAt(i, m4);
    });
    this.carMesh.instanceMatrix.needsUpdate = true;
  }

  syncSmoke() {
    if (this.smoke) { this.scene.remove(this.smoke); this.smoke.geometry.dispose(); this.smoke = null; }
    if (!this.smokers?.length || this.quality === "low") return;
    const per = 6, n = this.smokers.length * per;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.smokeSeeds = Array.from({ length: n }, (_, i) => ({ src: this.smokers[Math.floor(i / per)], k: (i % per) / per }));
    this.smoke = new THREE.Points(g, new THREE.PointsMaterial({ color: "#e8e4dc", size: 0.22, transparent: true, opacity: 0.45, depthWrite: false }));
    this.scene.add(this.smoke);
  }

  stepSmoke(dt) {
    if (!this.smoke) return;
    const p = this.smoke.geometry.attributes.position;
    this.smokeSeeds.forEach((s, i) => {
      s.k = (s.k + dt * 0.25) % 1;
      p.setXYZ(i, s.src.x + 0.25 + Math.sin(s.k * 6 + i) * 0.05 + s.k * 0.3, 0.7 + s.k * 1.3, s.src.z - 0.1 + s.k * 0.2);
    });
    p.needsUpdate = true;
  }

  /** Pools of warm light under lamps, by doors and around tent hearths. Seen only at night. */
  syncGlows() {
    const all = [...(this.lampGlows || []), ...(this.buildingGlows || [])];
    if (!this.glowMesh || this.glowMesh.instanceMatrix.count < all.length) {
      if (this.glowMesh) { this.scene.remove(this.glowMesh); this.glowMesh.dispose(); }
      const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
      this.glowMesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }), Math.max(64, Math.ceil(all.length * 1.5)));
      this.glowMesh.frustumCulled = false;
      this.glowMesh.renderOrder = 2;
      this.scene.add(this.glowMesh);
    }
    all.forEach(([x, z, r], i) => this.glowMesh.setMatrixAt(i, this.place(x, z, 0, r, 0.02)));
    this.glowMesh.count = all.length;
    this.glowMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- life: people walking, camels grazing, dust when building ----------

  syncLife(s) {
    if (!this.people) {
      this.people = [];
      this.peopleMesh = ["personM", "personF"].map((k) => {
        const mesh = new THREE.InstancedMesh(model(k).matte, this.mats.matte, 60);
        mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = this.quality === "high";
        this.scene.add(mesh); return mesh;
      });
      this.camels = [];
      const cg = model("camel").matte;
      this.camelMesh = new THREE.InstancedMesh(cg, this.mats.matte, 8);
      this.camelMesh.count = 0; this.camelMesh.frustumCulled = false; this.camelMesh.castShadow = this.quality !== "low";
      this.scene.add(this.camelMesh);
    }
    // People: more as the town grows, only where there are roads.
    const want = this.quality === "low" || !this.roads.length ? 0 : Math.min(120, Math.round(4 + s.pop / 6));
    while (this.people.length < want) {
      const [x, y] = this.roads[Math.floor(Math.random() * this.roads.length)];
      this.people.push({ x, y, tx: x, ty: y, t: Math.random(), speed: 0.12 + Math.random() * 0.1, side: Math.random() < 0.5 ? 1 : -1, f: this.people.length % 3 === 2 });
    }
    this.people.length = Math.min(this.people.length, want);
    for (const p of this.people) if (!roadAt(s.tiles[idx(p.tx, p.ty)]) || !roadAt(s.tiles[idx(p.x, p.y)])) {
      const [x, y] = this.roads[Math.floor(Math.random() * this.roads.length)] || [0, 0]; Object.assign(p, { x, y, tx: x, ty: y, t: 1 });
    }
    // Camels: a small herd while the town is still young, grazing on open land.
    const herd = s.era >= 3 ? 0 : s.era === 2 ? 3 : 6;
    const open = (x, y) => inMap(x, y) && !s.tiles[idx(x, y)].b && s.tiles[idx(x, y)].t !== "rock";
    if (!this.herdHome || !open(this.herdHome[0], this.herdHome[1])) {
      let best = null, bestScore = -1;
      for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
        if (!open(x, y)) continue;
        let free = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) free += open(x + dx, y + dy) ? 1 : 0;
        const score = free * 10 - Math.hypot(x - HALF, y - HALF - 4) + (s.tiles[idx(x, y)].t === "wadi" ? 8 : 0);
        if (score > bestScore) { bestScore = score; best = [x, y]; }
      }
      this.herdHome = best || [2, 2];
    }
    while (this.camels.length < herd) {
      const p = tileCenter(this.herdHome[0], this.herdHome[1]);
      this.camels.push({ x: p.x + Math.random() - 0.5, z: p.z + Math.random() - 0.5, tx: p.x, tz: p.z, wait: Math.random() * 4, ry: Math.random() * 6 });
    }
    this.camels.length = herd;
    this.camelMesh.count = herd;
  }

  stepLife(dt) {
    if (!this.people) return;
    const s = this.state, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    const counts = [0, 0];
    for (const p of this.people) {
      p.t += dt * p.speed;
      if (p.t >= 1) {
        p.t = 0; p.px = p.x; p.py = p.y; p.x = p.tx; p.y = p.ty;
        const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => inMap(p.x + dx, p.y + dy) && roadAt(s.tiles[idx(p.x + dx, p.y + dy)]) && !(p.x + dx === p.px && p.y + dy === p.py));
        const pick = opts.length ? opts[Math.floor(Math.random() * opts.length)] : [(p.px ?? p.x) - p.x, (p.py ?? p.y) - p.y];
        p.tx = p.x + pick[0]; p.ty = p.y + pick[1];
        if (!inMap(p.tx, p.ty) || !roadAt(s.tiles[idx(p.tx, p.ty)])) { p.tx = p.x; p.ty = p.y; }
      }
      const a = tileCenter(p.x, p.y), b = tileCenter(p.tx, p.ty);
      v.lerpVectors(a, b, p.t);
      const dx = b.x - a.x, dz = b.z - a.z;
      if (dx || dz) { v.x += -dz * 0.4 * p.side; v.z += dx * 0.4 * p.side; } else { v.x += 0.4 * p.side; }
      v.y = Math.abs(Math.sin(this.clock * 9 + p.speed * 50)) * 0.012;
      q.setFromAxisAngle(up, Math.atan2(-dz, dx));
      m4.compose(v, q, sc);
      const k = p.f ? 1 : 0;
      this.peopleMesh[k].setMatrixAt(counts[k]++, m4);
    }
    this.peopleMesh.forEach((m, k) => { m.count = counts[k]; m.instanceMatrix.needsUpdate = true; });

    if (this.camels.length && this.herdHome) {
      const home = tileCenter(this.herdHome[0], this.herdHome[1]);
      this.camels.forEach((c, i) => {
        const dx = c.tx - c.x, dz = c.tz - c.z, d = Math.hypot(dx, dz);
        if (c.wait > 0) c.wait -= dt;
        else if (d < 0.05) { c.wait = 2 + Math.random() * 6; c.tx = home.x + (Math.random() - 0.5) * 3.2; c.tz = home.z + (Math.random() - 0.5) * 3.2; }
        else { const sp = Math.min(d, dt * 0.22); c.x += dx / d * sp; c.z += dz / d * sp; c.ry = Math.atan2(-dz, dx); }
        const walking = c.wait <= 0 && d >= 0.05;
        v.set(c.x, walking ? Math.abs(Math.sin(this.clock * 5 + i)) * 0.01 : 0, c.z);
        q.setFromAxisAngle(up, c.ry);
        m4.compose(v, q, sc);
        this.camelMesh.setMatrixAt(i, m4);
      });
      this.camelMesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** A burst of dust where something was built or knocked down. */
  puff(p, n) {
    if (this.quality === "low") return;
    if (!this.dust) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(160 * 3).fill(-50), 3));
      this.dust = new THREE.Points(g, new THREE.PointsMaterial({ color: "#e3cfa6", size: 0.2, transparent: true, opacity: 0.7, depthWrite: false }));
      this.dust.frustumCulled = false;
      this.dustParts = [];
      this.scene.add(this.dust);
    }
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 0.8;
      this.dustParts.push({ x: p.x, y: 0.05, z: p.z, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 0.3 + Math.random() * 0.5, life: 0.7 + Math.random() * 0.4 });
    }
    if (this.dustParts.length > 160) this.dustParts.splice(0, this.dustParts.length - 160);
  }

  stepEffects(dt) {
    if (this.dust) {
      const pos = this.dust.geometry.attributes.position;
      this.dustParts = this.dustParts.filter((d) => (d.life -= dt) > 0);
      for (let i = 0; i < 160; i++) {
        const d = this.dustParts[i];
        if (!d) { pos.setXYZ(i, 0, -50, 0); continue; }
        d.x += d.vx * dt; d.z += d.vz * dt; d.y += d.vy * dt; d.vx *= 0.92; d.vz *= 0.92; d.vy *= 0.95;
        pos.setXYZ(i, d.x, d.y, d.z);
      }
      pos.needsUpdate = true;
    }
    // New buildings rise out of the ground with a little bounce.
    if (this.anims?.size && this.where) {
      const m = new THREE.Matrix4(), sc = new THREE.Matrix4();
      for (const [tile, t0] of this.anims) {
        const w = this.where.get(tile), inst = w && this.instances.get(w.k);
        const t = Math.min(1, (this.clock - t0) / 0.55);
        if (!inst) { this.anims.delete(tile); continue; }
        const e = easeBack(t);
        sc.makeScale(0.85 + 0.15 * t, Math.max(0.02, e), 0.85 + 0.15 * t);
        m.multiplyMatrices(w.m, sc);
        for (const set of ["matte", "shiny", "lights"]) if (inst[set]) { inst[set].setMatrixAt(w.i, m); inst[set].instanceMatrix.needsUpdate = true; }
        if (t >= 1) this.anims.delete(tile);
      }
    }
    if (this.clouds) {
      const o = this.clouds.material.map.offset;
      o.x = (o.x + dt * 0.004) % 1; o.y = (o.y + dt * 0.0025) % 1;
      this.clouds.material.opacity = 0.2 * (1 - this.night);
    }
  }

  // ---------- day and night ----------

  /** t in 0..1 over a full day (0 = midnight, 0.5 = noon). */
  setTimeOfDay(t) {
    const sunAngle = (t - 0.25) * Math.PI * 2; // sunrise at 0.25
    const elev = Math.sin(sunAngle);
    const day = Math.max(0, Math.min(1, elev * 3 + 0.25));
    const golden = Math.max(0, 1 - Math.abs(elev) * 4) * (elev > -0.1 ? 1 : 0);
    this.night = 1 - day;
    const dir = new THREE.Vector3(Math.cos(sunAngle) * 0.8, Math.max(0.25, elev + 0.25), 0.55).normalize();
    this.sun.position.copy(dir.multiplyScalar(40));
    this.sun.intensity = 0.55 + day * 1.8;
    this.sun.color.set(day < 0.3 ? "#9fb4ff" : golden > 0.2 ? "#ffcf8a" : "#fff1d6");
    this.hemi.intensity = 0.6 + day * 0.35;
    const sky = new THREE.Color("#22305a").lerp(new THREE.Color("#f6e2b8"), day);
    if (golden > 0.2) sky.lerp(new THREE.Color("#f3b77a"), golden * 0.5);
    this.scene.background = sky;
    this.scene.fog.color.copy(sky);
    this.hemi.color.set(day > 0.5 ? "#fff4dd" : "#8fa0d8");
    this.mats.lights.opacity = Math.min(1, this.night * 1.4);
    if (this.glowMesh) this.glowMesh.material.opacity = Math.max(0, this.night * 0.95 - 0.15);
  }

  // ---------- camera ----------

  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    const dpr = Math.min(this.quality === "high" ? 2 : 1.25, devicePixelRatio || 1);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.aspect = w / h;
    this.w = w; this.h = h;
    this.updateCamera();
  }

  updateCamera() {
    const v = this.view;
    const span = 9 / v.zoom; // world units visible vertically
    this.camera.left = -span * this.aspect / 2; this.camera.right = span * this.aspect / 2;
    this.camera.top = span / 2; this.camera.bottom = -span / 2;
    this.camera.updateProjectionMatrix();
    const dist = 40;
    this.camera.position.set(v.x + Math.sin(v.yaw) * Math.cos(v.pitch) * dist, Math.sin(v.pitch) * dist, v.z + Math.cos(v.yaw) * Math.cos(v.pitch) * dist);
    this.camera.lookAt(v.x, 0, v.z);
  }

  pan(dxPx, dyPx) {
    const span = 9 / this.view.zoom, perPx = span / this.h;
    const right = new THREE.Vector3(Math.cos(this.view.yaw), 0, -Math.sin(this.view.yaw));
    const fwd = new THREE.Vector3(-Math.sin(this.view.yaw), 0, -Math.cos(this.view.yaw));
    const k = perPx / Math.sin(this.view.pitch);
    this.view.x -= right.x * dxPx * perPx - fwd.x * dyPx * k;
    this.view.z -= right.z * dxPx * perPx - fwd.z * dyPx * k;
    this.view.x = Math.max(-HALF, Math.min(HALF, this.view.x));
    this.view.z = Math.max(-HALF, Math.min(HALF, this.view.z));
    this.updateCamera();
  }

  zoomBy(f) { this.view.zoom = Math.max(0.45, Math.min(3.2, this.view.zoom * f)); this.updateCamera(); }
  turn(dir) { this.view.yawTarget += dir * Math.PI / 2; }
  focus(x, y) { const p = tileCenter(x, y); this.view.x = p.x; this.view.z = p.z; this.updateCamera(); }

  /** The tile under a screen point. */
  pick(sx, sy) {
    const ndc = new THREE.Vector2((sx / this.w) * 2 - 1, -(sy / this.h) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return { x: -1, y: -1 };
    return { x: Math.floor(hit.x + HALF), y: Math.floor(hit.z + HALF) };
  }

  /** Where a tile shows on screen (for tests and pointers). */
  toScreen(x, y) {
    const p = tileCenter(x, y).project(this.camera);
    return { sx: (p.x + 1) / 2 * this.w, sy: (1 - p.y) / 2 * this.h };
  }

  // ---------- pointers, previews and overlays ----------

  setHover(tile, ok) {
    if (!this.hoverMesh) {
      const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
      this.hoverMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.35, depthWrite: false }));
      this.hoverMesh.renderOrder = 2;
      this.scene.add(this.hoverMesh);
    }
    this.hoverMesh.visible = !!tile;
    if (!tile) return;
    this.hoverMesh.position.copy(tileCenter(tile.x, tile.y)).setY(0.02);
    this.hoverMesh.material.color.set(ok === false ? "#ff5a4a" : "#ffffff");
  }

  setGhost(tile, key, ok, ground) {
    this.ghost.clear();
    if (!tile || !key) return;
    const geo = model(key, ground);
    if (!geo) return;
    const mesh = new THREE.Mesh(geo.matte, ok ? this.mats.ghost : this.mats.ghostBad);
    mesh.position.copy(tileCenter(tile.x, tile.y));
    this.ghost.add(mesh);
  }

  /** Tint tiles (a service's reach). values: Float32Array(N*N) of strengths, colour: css colour. */
  setOverlay(values, color) {
    if (this.overlay) { this.scene.remove(this.overlay); this.overlay.dispose(); this.overlay = null; }
    if (!values) return;
    const cells = [];
    for (let i = 0; i < N * N; i++) if (values[i] > 0) cells.push(i);
    const g = new THREE.PlaneGeometry(0.96, 0.96); g.rotateX(-Math.PI / 2);
    this.overlay = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false }), Math.max(1, cells.length));
    const m = new THREE.Matrix4();
    cells.forEach((i, k) => { const p = tileCenter(i % N, Math.floor(i / N)); m.makeTranslation(p.x, 0.015, p.z); this.overlay.setMatrixAt(k, m); });
    this.overlay.count = cells.length;
    this.overlay.renderOrder = 1;
    this.scene.add(this.overlay);
  }

  // ---------- frame ----------

  frame(dt, todT) {
    this.clock += dt;
    const v = this.view;
    if (Math.abs(v.yaw - v.yawTarget) > 1e-3) { v.yaw += (v.yawTarget - v.yaw) * Math.min(1, dt * 8); this.updateCamera(); }
    this.setTimeOfDay(this.dayCycle ? todT : 0.42);
    this.stepCars(dt);
    this.stepSmoke(dt);
    this.stepLife(dt);
    this.stepEffects(dt);
    this.sun.target.position.set(v.x, 0, v.z);
    this.sun.position.add(this.sun.target.position);
    this.renderer.render(this.scene, this.camera);
  }
}

function mergeTwo(a, b) {
  const x = a.toNonIndexed(), y = b.toNonIndexed();
  const g = new THREE.BufferGeometry();
  for (const k of ["position", "normal"]) {
    const arr = new Float32Array(x.attributes[k].array.length + y.attributes[k].array.length);
    arr.set(x.attributes[k].array); arr.set(y.attributes[k].array, x.attributes[k].array.length);
    g.setAttribute(k, new THREE.BufferAttribute(arr, 3));
  }
  return g;
}

/** A small rendered picture of a model, for the build cards. Uses its own tiny renderer. */
let thumbRenderer = null;
const thumbCache = new Map();
export function thumbnail(key, ground = "sand") {
  if (thumbCache.has(key)) return thumbCache.get(key);
  if (!thumbRenderer) {
    thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbRenderer.setSize(220, 160, false);
    thumbRenderer.outputColorSpace = THREE.SRGBColorSpace;
    thumbRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  }
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#fff4dd", "#c9a46a", 1.1));
  const sun = new THREE.DirectionalLight("#fff1d6", 2.2); sun.position.set(3, 6, 4); scene.add(sun);
  const base = new THREE.Mesh(new THREE.BoxGeometry(1, 0.04, 1), new THREE.MeshStandardMaterial({ color: "#ead4a4" }));
  base.position.y = -0.02; scene.add(base);
  const geo = model(key, ground);
  let top = 0.5;
  if (geo) for (const [set, mat] of [["matte", new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })], ["shiny", new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.3 })]]) {
    if (!geo[set]) continue;
    scene.add(new THREE.Mesh(geo[set], mat));
    geo[set].computeBoundingBox();
    top = Math.max(top, geo[set].boundingBox.max.y);
  }
  if (key === "road" || key === "asphalt") { base.material.color.set(key === "asphalt" ? "#4d4f55" : "#a98457"); }
  const span = Math.max(1.5, top * 1.25 + 0.6);
  const cam = new THREE.OrthographicCamera(-span * 0.69, span * 0.69, span / 2, -span / 2, 0.1, 50);
  cam.position.set(6, 5.2, 6); cam.lookAt(0, top * 0.38, 0);
  thumbRenderer.render(scene, cam);
  const url = thumbRenderer.domElement.toDataURL();
  thumbCache.set(key, url);
  return url;
}

export const BUILDING_KEY = (id) => (id === "house" ? "tent0" : id);
export { B };
