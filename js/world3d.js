// The town in 3D: ground, roads, buildings (instanced), light and shadow, day and night, cars and smoke.
import * as THREE from "three";
import { MAP_SIZE as N, B, ROAD_IDS } from "./data.js";
import { idx, inMap, seasonOf, owns, plotAt, chainLinks, roadNets, springGreen, powerNet } from "./sim.js";
import { model, modelKey, baseKey, makerSeeded, VARIANTS, SETS } from "./models.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";

/**
 * Open assets (see vendor/ASSETS-LICENSE.txt): a Poly Haven sky (CC0) for reflections, and two CC0 normal
 * maps for painted and bare metal. The trial copy carries them inline (globalThis.RAFAYA_ASSETS).
 */
const assetUrl = (name) => globalThis.RAFAYA_ASSETS?.[name] || `./vendor/${name}`;
function normalTex(name, repeat) {
  const t = new THREE.TextureLoader().load(assetUrl(name));
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
  return t;
}

const HALF = N / 2;
export const tileCenter = (x, y) => new THREE.Vector3(x - HALF + 0.5, 0, y - HALF + 0.5);
/** War damage shows in the building's shape: from 25% it sinks (part of it fell in), down to half its height when out of action. */
export const warSquash = (wd) => (!wd || wd < 25 ? 1 : Math.max(0.5, 1 - (wd - 20) * 0.0063));
/** …and from 60% it leans a little, always the same way for the same tile. */
export const warTilt = (wd, x, y) => (wd >= 60 ? [((x * 13 + y * 7) % 5 - 2) * 0.018 * (wd / 100), ((x * 5 + y * 11) % 5 - 2) * 0.018 * (wd / 100)] : [0, 0]);
const roadAt = (t) => t?.b && ROAD_IDS.includes(t.b.id);
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
    this.renderer.shadowMap.autoUpdate = false; // shadows are redrawn every third frame (see frame), not every frame: a big saving on phones
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
      // the town's walls: a fine plaster grain (CC0 normal map) so they read as real surfaces
      matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, normalMap: normalTex("tex/concrete-normal.webp", 1), normalScale: new THREE.Vector2(0.22, 0.22) }),
      shiny: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.35 }),
      lights: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0 }),
      ghost: new THREE.MeshStandardMaterial({ color: "#7ee0b8", transparent: true, opacity: 0.55, roughness: 0.6 }),
      // the realistic sets (military first): painted steel, bare steel, tinted glass, lamps that bloom
      paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.18, normalMap: normalTex("tex/concrete-normal.webp", 1), normalScale: new THREE.Vector2(0.35, 0.35) }),
      metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.75, normalMap: normalTex("tex/grain-normal.webp", 2), normalScale: new THREE.Vector2(0.25, 0.25) }),
      glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.06, metalness: 0.9 }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(7, 7, 7), toneMapped: false }),
      ghostBad: new THREE.MeshStandardMaterial({ color: "#ff7a6a", transparent: true, opacity: 0.55, roughness: 0.6 })
    };

    this.envLevel = { paint: 0.55, metal: 0.9, glass: 1.2, shiny: 0.45 };
    for (const [k, v] of Object.entries(this.envLevel)) this.mats[k].envMapIntensity = v;
    this.loadSky();
    // bloom: only what is really bright glows (lamps, fire, flashes); none on the lowest quality
    if (quality === "high") { // bloom costs several extra passes a frame: only on high (phones default to medium)
      // a multisampled target keeps edges smooth (the bloom pass would otherwise lose the antialiasing)
      this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(256, 256, { type: THREE.HalfFloatType, samples: quality === "high" ? 4 : 2 }));
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), quality === "high" ? 0.55 : 0.45, 0.35, 3.2); // threshold above sunlit sand: only lamps, fire and flashes
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
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

  /** The Poly Haven sky as an environment: metal and glass reflect a real sky (loaded in the background). */
  async loadSky() {
    try {
      const url = assetUrl("hdri/sky.exr");
      const buf = url.startsWith("data:") ? Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (ch) => ch.charCodeAt(0)).buffer : await (await fetch(url)).arrayBuffer();
      const tex = new EXRLoader().parse(buf), dt = new THREE.DataTexture(tex.data, tex.width, tex.height, tex.format, tex.type);
      dt.mapping = THREE.EquirectangularReflectionMapping; dt.colorSpace = THREE.LinearSRGBColorSpace; dt.minFilter = dt.magFilter = THREE.LinearFilter; dt.generateMipmaps = false; dt.needsUpdate = true;
      const pm = new THREE.PMREMGenerator(this.renderer);
      // only the realistic materials reflect it; the rest of the town keeps its own warm light
      const env = pm.fromEquirectangular(dt).texture;
      for (const k of ["paint", "metal", "glass", "shiny"]) { this.mats[k].envMap = env; this.mats[k].needsUpdate = true; }
      pm.dispose(); dt.dispose();
    } catch (e) { console.warn("sky", e); }
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
    const desert = new THREE.Mesh(outer, new THREE.MeshStandardMaterial({ color: "#f1d49c", map: this.sand, roughness: 1, normalMap: normalTex("tex/grain-normal.webp", 1), normalScale: new THREE.Vector2(0.5, 0.5) }));
    desert.receiveShadow = true;
    this.scene.add(desert);
    this.ground = null;

    // Flat-topped mesas of Najd on the horizon.
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + hash(i, 1) * 0.3, r = HALF + 11 + hash(i, 2) * 14;
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
      const x = (hash(i, 11) - 0.5) * (N + 40), z = (hash(i, 12) - 0.5) * (N + 40);
      if (Math.max(Math.abs(x), Math.abs(z)) < HALF + 0.6) continue;
      const pick = hash(i, 13);
      const key = pick < 0.45 ? "grassTuft" : pick < 0.85 ? "shrub" : pick < 0.92 ? "acacia" : "rock";
      out[key].push(this.place(x, z, hash(i, 14) * 6, key === "acacia" ? 0.8 + hash(i, 15) * 0.4 : 0.7 + hash(i, 15) * 0.6));
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
    for (const set of SETS) {
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
    const spring = seasonOf(s.day).id === "spring", c = new THREE.Color();
    // each tile's colour (and how dark it is outside the land the town owns)
    const tileCol = new Float32Array(N * N * 3);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const t = s.tiles[idx(x, y)];
      const n = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      c.set(t.t === "wadi" ? (spring ? "#b8b06c" : "#c6ad72") : t.t === "fayda" ? (spring ? "#a9b866" : "#dcc08a") : t.t === "lake" ? "#b3a173" : t.t === "rock" ? "#e2c793" : "#f1d49c");
      c.offsetHSL(0, 0, ((n % 7) - 3) * 0.006);
      if (!owns(s, x, y)) c.offsetHSL(0, -0.12, -0.06);
      tileCol.set([c.r, c.g, c.b], idx(x, y) * 3);
    }
    // a grid of corners, two triangles per tile; a corner takes the mean of the tiles that touch it,
    // with a little noise so the sand is not flat
    const V = N + 1, pos = new Float32Array(V * V * 3), col = new Float32Array(V * V * 3), uvs = new Float32Array(V * V * 2), index = [];
    for (let y = 0; y <= N; y++) for (let x = 0; x <= N; x++) {
      let r = 0, gg = 0, b = 0, k = 0;
      for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        const tx = x + dx, ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= N || ty >= N) continue;
        const o = idx(tx, ty) * 3; r += tileCol[o]; gg += tileCol[o + 1]; b += tileCol[o + 2]; k++;
      }
      const v = y * V + x, jitter = ((((x * 92821) ^ (y * 68917)) >>> 0) % 9 - 4) * 0.004;
      pos.set([x - HALF, 0, y - HALF], v * 3);
      col.set([r / k + jitter, gg / k + jitter, b / k + jitter * 0.6], v * 3);
      uvs.set([(x - HALF) * 0.3, (y - HALF) * 0.3], v * 2);
    }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const a = y * V + x, b = a + 1, d = a + V, e = d + 1;
      index.push(a, d, e, a, e, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    g.setIndex(index);
    g.computeVertexNormals();
    this.groundNormal ||= normalTex("tex/grain-normal.webp", 1);
    this.ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, map: this.sand, roughness: 1, normalMap: this.groundNormal, normalScale: new THREE.Vector2(0.45, 0.45) }));
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    // A fence along the edge of the land the town owns, and a "for sale" sign on each plot.
    this.removeAll(this.fenceMeshes);
    const posts = [], signs = [], signAt = {};
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!owns(s, x, y)) {
        const p = plotAt(x, y);
        // the sign goes on the plot tile nearest the middle of the map
        const d = Math.hypot(x - HALF + 0.5, y - HALF + 0.5) + Math.abs((p === "n" || p === "s" ? x : y) - HALF) * 0.5;
        if (!signAt[p] || d < signAt[p].d) signAt[p] = { x, y, d };
        continue;
      }
      const c0 = tileCenter(x, y);
      if (inMap(x + 1, y) && !owns(s, x + 1, y)) for (const k of [0, 0.5]) posts.push(this.place(c0.x + 0.5, c0.z - 0.5 + k, -Math.PI / 2));
      if (inMap(x - 1, y) && !owns(s, x - 1, y)) for (const k of [0, 0.5]) posts.push(this.place(c0.x - 0.5, c0.z - 0.5 + k, -Math.PI / 2));
      if (inMap(x, y + 1) && !owns(s, x, y + 1)) for (const k of [0, 0.5]) posts.push(this.place(c0.x - 0.5 + k, c0.z + 0.5, 0));
      if (inMap(x, y - 1) && !owns(s, x, y - 1)) for (const k of [0, 0.5]) posts.push(this.place(c0.x - 0.5 + k, c0.z - 0.5, 0));
    }
    for (const { x, y } of Object.values(signAt)) { const c0 = tileCenter(x, y); signs.push(this.place(c0.x, c0.z, Math.atan2(c0.x, c0.z) + Math.PI / 2, 1.3)); }
    this.fenceMeshes = [...this.addInstances(model("fencePost"), posts), ...this.addInstances(model("saleSign"), signs, true)];

    // After rain the wadi runs: wet dark sand along the bed, and a stream of water with ragged
    // banks and pools that flows (drawn into a soft mask, not tile squares).
    if (this.flood) { this.scene.remove(this.flood); this.flood.traverse((m) => { m.geometry?.dispose(); m.material?.alphaMap?.dispose(); m.material?.map?.dispose(); m.material?.dispose(); }); }
    this.flood = new THREE.Group();
    this.flood.visible = false;
    this.scene.add(this.flood);
    this.streamTex = null;
    const wadi = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (s.tiles[idx(x, y)].t === "wadi") wadi.push([x, y]);
    if (wadi.length) {
      const minX = Math.max(0, Math.min(...wadi.map((p) => p[0])) - 1), maxX = Math.min(N, Math.max(...wadi.map((p) => p[0])) + 2);
      const minY = Math.max(0, Math.min(...wadi.map((p) => p[1])) - 1), maxY = Math.min(N, Math.max(...wadi.map((p) => p[1])) + 2);
      const W = maxX - minX, H = maxY - minY, PX = 28;
      const isW = (x, y) => inMap(x, y) && s.tiles[idx(x, y)].t === "wadi";
      // how deep in the bed a tile is: the middle of the wadi holds the stream, the edges stay damp
      const depth = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].filter(([dx, dy]) => isW(x + dx, y + dy)).length / 8;
      const mask = (size, blur, keep) => {
        const cv = document.createElement("canvas"); cv.width = W * PX; cv.height = H * PX;
        const cx = cv.getContext("2d");
        cx.fillStyle = "#000"; cx.fillRect(0, 0, cv.width, cv.height);
        cx.filter = `blur(${blur}px)`; cx.fillStyle = "#fff";
        for (const [x, y] of wadi) {
          const d = depth(x, y), h = hash(x, y, 41);
          if (d < keep) continue;
          const r = PX * size(d, h);
          if (r <= 0) continue;
          cx.beginPath();
          cx.ellipse((x - minX + 0.5 + (hash(x, y, 42) - 0.5) * 0.4) * PX, (y - minY + 0.5 + (hash(x, y, 43) - 0.5) * 0.4) * PX, r, r * (0.7 + h * 0.5), h * 6, 0, Math.PI * 2);
          cx.fill();
        }
        return new THREE.CanvasTexture(cv);
      };
      const plane = (y, mat) => {
        const pg = new THREE.PlaneGeometry(W, H); pg.rotateX(-Math.PI / 2);
        const m = new THREE.Mesh(pg, mat);
        m.position.set(minX - HALF + W / 2, y, minY - HALF + H / 2);
        m.renderOrder = 1;
        this.flood.add(m);
        return m;
      };
      // damp sand over the whole bed
      plane(0.008, new THREE.MeshStandardMaterial({ color: "#7d6a48", alphaMap: mask(() => 0.75, 10, 0), transparent: true, opacity: 0.5, roughness: 1, depthWrite: false }));
      // the stream: wide in the middle of the bed, pools here and there, nothing on the edges
      const stream = (d, h) => (d > 0.85 ? 0.55 + h * 0.25 : d > 0.6 ? 0.25 + h * 0.35 : h > 0.8 ? 0.3 : 0);
      plane(0.016, new THREE.MeshStandardMaterial({ color: "#4fa3c8", alphaMap: mask(stream, 8, 0.3), transparent: true, opacity: 0.85, roughness: 0.12, metalness: 0.2, depthWrite: false }));
      // the current: light streaks sliding along
      const rc = document.createElement("canvas"); rc.width = rc.height = 128;
      const rx = rc.getContext("2d");
      rx.strokeStyle = "rgba(255,255,255,.55)"; rx.lineWidth = 1.4;
      for (let k = 0; k < 18; k++) { const y0 = (k * 29) % 128, x0 = (k * 47) % 128; rx.beginPath(); rx.moveTo(x0, y0); rx.quadraticCurveTo(x0 + 10, y0 - 3, x0 + 22, y0); rx.stroke(); }
      this.streamTex = new THREE.CanvasTexture(rc); this.streamTex.wrapS = this.streamTex.wrapT = THREE.RepeatWrapping; this.streamTex.repeat.set(W / 2, H / 2);
      plane(0.022, new THREE.MeshBasicMaterial({ map: this.streamTex, alphaMap: mask((d, h) => stream(d, h) * 0.85, 8, 0.3), transparent: true, opacity: 0.4, depthWrite: false }));
    }
    // The dam lake: one body of water with an uneven shore, a band of wet sand around it, and ripples.
    this.removeAll(this.lakeMeshes || []);
    this.lakeMeshes = [];
    const lakeTiles = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (s.tiles[idx(x, y)].t === "lake") lakeTiles.push([x, y]);
    if (lakeTiles.length) {
      const full = (s.lake || 0) > 10, level = Math.min(1, (s.lake || 0) / 100);
      const minX = Math.min(...lakeTiles.map((p) => p[0])) - 1, maxX = Math.max(...lakeTiles.map((p) => p[0])) + 2;
      const minY = Math.min(...lakeTiles.map((p) => p[1])) - 1, maxY = Math.max(...lakeTiles.map((p) => p[1])) + 2;
      const W = maxX - minX, H = maxY - minY, PX = 48;
      // a mask: soft blobs on every lake tile (bigger when the lake is fuller), drawn blurred
      const mask = (grow, blur, alpha) => {
        const cv = document.createElement("canvas"); cv.width = W * PX; cv.height = H * PX;
        const cx = cv.getContext("2d");
        cx.fillStyle = "#000"; cx.fillRect(0, 0, cv.width, cv.height);
        cx.filter = `blur(${blur}px)`;
        cx.fillStyle = `rgba(255,255,255,${alpha})`;
        for (const [x, y] of lakeTiles) {
          const h = hash(x, y, 31);
          cx.beginPath();
          cx.ellipse((x - minX + 0.5) * PX, (y - minY + 0.5) * PX, PX * (0.62 + grow + h * 0.18), PX * (0.58 + grow + hash(x, y, 32) * 0.2), h * 3, 0, Math.PI * 2);
          cx.fill();
        }
        const tex = new THREE.CanvasTexture(cv);
        return tex;
      };
      const plane = (y, mat) => {
        const pg = new THREE.PlaneGeometry(W, H); pg.rotateX(-Math.PI / 2);
        const m = new THREE.Mesh(pg, mat);
        m.position.set(minX - HALF + W / 2, y, minY - HALF + H / 2);
        m.renderOrder = 1;
        this.scene.add(m); this.lakeMeshes.push(m);
        return m;
      };
      // wet, darker sand where the water reaches (also when the lake is low: the mud shows)
      plane(0.006, new THREE.MeshStandardMaterial({ color: "#8f7c55", alphaMap: mask(0.28, 14, 0.9), transparent: true, opacity: 0.55, roughness: 1, depthWrite: false }));
      if (full) {
        // the water itself: deep blue in the middle, light at the shore (two layers)
        plane(0.02, new THREE.MeshStandardMaterial({ color: "#5fa8c4", alphaMap: mask(0.12 * level, 10, 1), transparent: true, opacity: 0.85, roughness: 0.12, metalness: 0.2, depthWrite: false }));
        plane(0.024, new THREE.MeshStandardMaterial({ color: "#2f7fa3", alphaMap: mask(-0.12 + 0.1 * level, 16, 1), transparent: true, opacity: 0.75, roughness: 0.08, metalness: 0.25, depthWrite: false }));
        // ripples: light streaks that drift across the water
        const rc = document.createElement("canvas"); rc.width = rc.height = 128;
        const rx = rc.getContext("2d");
        rx.strokeStyle = "rgba(255,255,255,0.5)"; rx.lineWidth = 1.5;
        for (let k = 0; k < 26; k++) { const x0 = (k * 37) % 128, y0 = (k * 53) % 128; rx.beginPath(); rx.arc(x0, y0, 6 + (k % 5) * 3, 0.2, 1.4); rx.stroke(); }
        const rt = new THREE.CanvasTexture(rc); rt.wrapS = rt.wrapT = THREE.RepeatWrapping; rt.repeat.set(W / 2, H / 2);
        this.ripples = plane(0.03, new THREE.MeshBasicMaterial({ map: rt, alphaMap: mask(0.05, 12, 1), transparent: true, opacity: 0.35, depthWrite: false }));
      } else this.ripples = null;
    } else this.ripples = null;
  }

  /** Plants and pebbles on land nobody has built on yet. */
  syncScenery(s) {
    this.removeAll(this.sceneryMeshes);
    const lists = { shrub: [], grassTuft: [], acacia: [], pebbles: [], bloom: [] };
    const spring = seasonOf(s.day).id === "spring";
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const t = s.tiles[idx(x, y)];
      if (t.b || t.t === "rock" || t.t === "lake") continue;
      const p = tileCenter(x, y), h = hash(x, y, 5), j = (k) => (hash(x, y, k) - 0.5) * 0.6;
      if (t.t === "fayda") {
        if (spring) for (let k = 0; k < Math.round(5 * springGreen(s)); k++) lists.bloom.push(this.place(p.x + j(20 + k), p.z + j(30 + k), hash(x, y, 40 + k) * 6, 0.9 + hash(x, y, 50 + k) * 0.5));
        else if (h < 0.6) lists.grassTuft.push(this.place(p.x + j(6), p.z + j(7), h * 30, 0.7));
      } else if (t.t === "wadi") {
        if (h < 0.08) lists.acacia.push(this.place(p.x + j(6), p.z + j(7), h * 60, 0.8 + h * 2));
        else if (h < 0.55) lists.shrub.push(this.place(p.x + j(6), p.z + j(7), h * 40, 0.8 + h));
        if (hash(x, y, 8) < 0.45) lists.pebbles.push(this.place(p.x + j(9), p.z + j(10), h * 9));
        if (hash(x, y, 11) < 0.5) lists.grassTuft.push(this.place(p.x + j(12), p.z + j(13), h * 7, 0.9));
      } else {
        if (h < 0.03) lists.acacia.push(this.place(p.x + j(6), p.z + j(7), h * 60, 0.8 + h * 5));
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
    const lamps = [], medians = [], islands = [], lights = [];
    this.lampGlows = [];
    const pos = [], col = [], c = new THREE.Color();
    const quad = (x0, z0, x1, z1, y, color) => {
      c.set(color);
      for (const [qx, qz] of [[x0, z0], [x0, z1], [x1, z1], [x0, z0], [x1, z1], [x1, z0]]) { pos.push(qx, y, qz); col.push(c.r, c.g, c.b); }
    };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const t = s.tiles[idx(x, y)];
      if (!roadAt(t)) continue;
      const kind = t.b.id, paved = kind !== "road";
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
      if (kind === "avenue") {
        // a full-width avenue: two lanes each way and a palm median along the way it runs
        quad(cx - 0.5, cz - 0.5, cx + 0.5, cz + 0.5, 0.007, "#45474d");
        const ew = link(1, 0) || link(-1, 0), ns = link(0, 1) || link(0, -1);
        if (ew && !ns) { quad(cx - 0.5, cz - 0.05, cx + 0.5, cz + 0.05, 0.009, "#cdbf9f"); for (const zz of [-0.25, 0.25]) for (const o of [-0.3, 0.05, 0.3]) quad(cx + o - 0.07, cz + zz - 0.01, cx + o + 0.07, cz + zz + 0.01, 0.01, "#f3efe6"); medians.push(this.place(cx, cz, 0)); }
        else if (ns && !ew) { quad(cx - 0.05, cz - 0.5, cx + 0.05, cz + 0.5, 0.009, "#cdbf9f"); for (const xx of [-0.25, 0.25]) for (const o of [-0.3, 0.05, 0.3]) quad(cx + xx - 0.01, cz + o - 0.07, cx + xx + 0.01, cz + o + 0.07, 0.01, "#f3efe6"); medians.push(this.place(cx, cz, 0)); }
      } else if (kind === "roundabout") {
        quad(cx - 0.5, cz - 0.5, cx + 0.5, cz + 0.5, 0.007, "#45474d");
        islands.push(this.place(cx, cz, 0));
      } else if (kind === "signal") {
        quad(cx - 0.5, cz - 0.5, cx + 0.5, cz + 0.5, 0.007, "#45474d");
        // zebra crossings on each arm and a light on two corners
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (link(dx, dy)) for (let k = -2; k <= 2; k++) {
          if (dx) quad(cx + dx * 0.38 - 0.04, cz + k * 0.08 - 0.025, cx + dx * 0.38 + 0.04, cz + k * 0.08 + 0.025, 0.01, "#f3efe6");
          else quad(cx + k * 0.08 - 0.025, cz + dy * 0.38 - 0.04, cx + k * 0.08 + 0.025, cz + dy * 0.38 + 0.04, 0.01, "#f3efe6");
        }
        lights.push(this.place(cx + 0.45, cz + 0.45, Math.PI * 0.75), this.place(cx - 0.45, cz - 0.45, -Math.PI * 0.25));
      } else if (paved) {
        // dashed centre lines and kerbs
        if (link(1, 0) || link(-1, 0)) for (const o of [-0.3, 0.05, 0.3]) quad(cx + o - 0.06, cz - 0.012, cx + o + 0.06, cz + 0.012, 0.008, "#f3d77a");
        if (link(0, 1) || link(0, -1)) for (const o of [-0.3, 0.05, 0.3]) quad(cx - 0.012, cz + o - 0.06, cx + 0.012, cz + o + 0.06, 0.008, "#f3d77a");
      } else {
        // wheel ruts
        if (link(1, 0) || link(-1, 0)) for (const o of [-0.12, 0.12]) quad(cx - 0.5, cz + o - 0.015, cx + 0.5, cz + o + 0.015, 0.007, "#8a6842");
        if (link(0, 1) || link(0, -1)) for (const o of [-0.12, 0.12]) quad(cx + o - 0.015, cz - 0.5, cx + o + 0.015, cz + 0.5, 0.007, "#8a6842");
      }
    }
    this.lampMeshes = [...this.addInstances(model("lamp"), lamps, true), ...this.addInstances(model("medianPalm"), medians, true), ...this.addInstances(model("roundIsland"), islands, true), ...this.addInstances(model("trafficLight"), lights, true)];
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
  /** The way a building on this tile faces by itself: +z of the model toward the first road beside it. */
  faceAngle(s, x, y) {
    const dirs = [[0, 1, 0], [1, 0, Math.PI / 2], [0, -1, Math.PI], [-1, 0, -Math.PI / 2]];
    for (const [dx, dy, a] of dirs) if (inMap(x + dx, y + dy) && roadAt(s.tiles[idx(x + dx, y + dy)])) return a;
    return 0;
  }

  /** Sagging wires from each source or pole to the next pole (live poles only). */
  syncWires(s) {
    if (this.wires) { this.scene.remove(this.wires); this.wires.geometry.dispose(); this.wires = null; }
    const { wires } = powerNet(s);
    if (!wires.length) return;
    const pts = [], top = (i) => { const c = tileCenter(i % N, Math.floor(i / N)); return { x: c.x, z: c.z, y: s.tiles[i].b?.id === "pole" ? 0.9 : 0.55 }; };
    for (const [a, b] of wires) {
      const p = top(a), q = top(b), len = Math.hypot(q.x - p.x, q.z - p.z);
      let prev = p;
      for (let k = 1; k <= 8; k++) {
        const t = k / 8, sag = Math.sin(t * Math.PI) * 0.08 * len / 3;
        const cur = { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t, y: p.y + (q.y - p.y) * t - sag };
        pts.push(prev.x, prev.y, prev.z, cur.x, cur.y, cur.z);
        prev = cur;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.wires = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: "#3a2e26", transparent: true, opacity: 0.8 }));
    this.scene.add(this.wires);
  }

  syncBuildings(s) {
    const groups = new Map();
    // tint: war damage darkens a building (1 = as built)
    const push = (key, ground, m, tint = 1) => { const k = key.startsWith("palms") ? `${key}:${ground}` : key; if (!groups.has(k)) groups.set(k, { key, ground, list: [], tints: [] }); groups.get(k).list.push(m); groups.get(k).tints.push(tint); };
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(1, 1, 1);
    this.smokers = [];
    const seen = new Map(), where = new Map(), glows = [];
    this.anims ||= new Map();
    const feeder = new Map(powerNet(s).wires.map(([from, to]) => [to, from]));
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const t = s.tiles[idx(x, y)];
      const p = tileCenter(x, y);
      if (this.prevKeys?.has(idx(x, y)) && !t.b) this.puff(p, 12);
      if (!t.b) {
        if (t.t === "rock") { q.setFromAxisAngle(up, ((x * 7 + y * 13) % 8) * 0.8); m4.compose(p, q, sc); push("rock", "sand", m4.clone()); }
        continue;
      }
      if (roadAt(t)) continue;
      // Face the road, then any quarter turns the mayor gave it.
      let angle = this.faceAngle(s, x, y) + (t.b.rot || 0) * Math.PI / 2;
      if (t.b.id === "pole") { const f = feeder.get(idx(x, y)); angle = f === undefined ? 0 : Math.atan2((f % N) - x, Math.floor(f / N) - y); } // the cross arm stands across its wire
      if (t.b.id === "dam" || t.b.id === "pivot") angle = 0; // a dam always stands across the wadi
      q.setFromAxisAngle(up, angle);
      if (t.b.wd >= 25) { const [tx, tz] = warTilt(t.b.wd, x, y); q.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(tx, 0, tz))); sc.set(1, warSquash(t.b.wd), 1); }
      m4.compose(p, q, sc);
      sc.set(1, 1, 1);
      // Building sites, and a colour variant per house so streets do not look copied.
      let key = t.b.build > 0 ? "construction" : baseKey(modelKey(t.b.id, t.b.lvl)); // military moving parts are drawn by js/warfx.js
      const variants = VARIANTS[key];
      if (variants) { const v = Math.floor(hash(x, y, 77) * (variants.length + 1)); if (v > 0) key = `${key}~${v - 1}`; }
      const gk = key.startsWith("palms") ? `${key}:${t.t}` : key;
      push(key, t.t, m4.clone(), t.b.wd ? 1 - Math.min(0.5, t.b.wd * 0.006) : 1);
      const i = idx(x, y);
      seen.set(i, gk);
      where.set(i, { k: gk, i: groups.get(gk).list.length - 1, m: m4.clone() });
      if (gk === "tent0") glows.push([p.x + Math.sin(angle) * 0.38 + Math.cos(angle) * 0.33, p.z + Math.cos(angle) * 0.38 - Math.sin(angle) * 0.33, 0.8]);
      else if (gk.startsWith("house") || ["mosque", "grocery", "cafe", "mandi", "souq", "bank", "clinic", "hotel", "mall", "bigmosque", "lantern", "gate", "heritage", "tower", "fountain", "dallah"].includes(gk.replace(/[12]$/, ""))) glows.push([p.x + Math.sin(angle) * 0.42, p.z + Math.cos(angle) * 0.42, 0.75]);
      if (this.prevKeys && this.prevKeys.get(i) !== gk) { this.anims.set(i, this.clock); this.puff(p, 16); }
      if (!t.b.build && ["factory", "generator", "powerplant", "mandi", "datefactory", "incense"].includes(t.b.id)) this.smokers.push(p.clone());
    }
    // Reuse or rebuild the instanced meshes.
    for (const [k, inst] of this.instances) if (!groups.has(k)) { for (const m of Object.values(inst)) if (m?.isMesh) { this.scene.remove(m); m.dispose(); } this.instances.delete(k); }
    const tc = new THREE.Color();
    for (const [k, { key, ground, list, tints }] of groups) {
      let inst = this.instances.get(k);
      if (!inst || inst.capacity < list.length) {
        if (inst) for (const m of Object.values(inst)) if (m?.isMesh) { this.scene.remove(m); m.dispose(); }
        const geo = model(key, ground) || model("construction"); // a missing model must never stop the town from being drawn
        const capacity = Math.max(8, Math.ceil(list.length * 1.5));
        inst = { capacity };
        for (const set of SETS) {
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
      for (const set of SETS) {
        const mesh = inst[set];
        if (!mesh) continue;
        list.forEach((m, i) => mesh.setMatrixAt(i, m));
        mesh.count = list.length;
        mesh.instanceMatrix.needsUpdate = true;
        if (set !== "lights" && set !== "glow" && (mesh.instanceColor || tints.some((v) => v < 1))) {
          tints.forEach((v, i) => mesh.setColorAt(i, tc.setRGB(v, v * 0.96, v * 0.92)));
          mesh.instanceColor.needsUpdate = true;
        }
      }
    }
    this.syncSmoke();
    this.prevKeys = seen;
    this.buildingGlows = glows;
    this.where = where;
    this.homes = [...where.entries()].filter(([, w]) => w.k === "tent0" || w.k.startsWith("house")).map(([i]) => i);
    this.fx?.syncTown(s); // war: moving parts of military buildings, damage smoke and fire
  }

  sync(s, what = { tiles: true, roads: true, buildings: true }) {
    this.shadowDirty = true;
    // While a flood sweeps the wadi the old buildings must stay on screen to be carried away;
    // the town is redrawn once the water has passed.
    if (this.floodAnim) { this.pendingSync = { s, what: { tiles: true, roads: true, buildings: true } }; return; }
    const season = seasonOf(s.day).i;
    if (this.season !== undefined && this.season !== season) what = { ...what, tiles: true, buildings: true };
    this.season = season;
    // the land itself changed (a lake filled or dried, wadi filled in): redraw the ground
    const landKey = s.tiles.map((t) => t.t[0]).join("") + ((s.lake || 0) > 10 ? "w" : "d");
    if (landKey !== this.landKey) { this.landKey = landKey; what = { ...what, tiles: true }; }
    if (what.tiles) this.syncTiles(s);
    if (what.roads) this.syncRoads(s);
    if (what.buildings) { this.syncBuildings(s); this.syncScenery(s); this.syncWires(s); }
    this.roads = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (roadAt(s.tiles[idx(x, y)])) this.roads.push([x, y]);
    this.syncGlows();
    // Event decorations change only when the events do (sync runs every town hour).
    const eventKey = s.events.map((e) => e.id + (e.mazayen ? "m" : "")).join() + this.roads.length;
    if (eventKey !== this.eventKey) { this.eventKey = eventKey; this.syncFestive(s); }
    if (this.flood) this.flood.visible = s.events.some((e) => e.id === "rain");
    this.state = s;
    this.syncCars();
    this.syncTrucks(s);
    this.syncLife(s);
  }

  // ---------- life: cars and smoke ----------

  /** Trucks carry goods along the roads from each farm to its factory, and come back empty. */
  syncTrucks(s) {
    if (this.quality === "low") return;
    if (!this.truckMesh) {
      this.truckMesh = new THREE.InstancedMesh(model("truckBody").matte, this.mats.matte, 24);
      this.truckGlass = model("truckBody").shiny ? new THREE.InstancedMesh(model("truckBody").shiny, this.mats.shiny, 24) : null;
      this.cargoMesh = new THREE.InstancedMesh(model("truckCargo").matte, this.mats.matte, 24);
      for (const m of [this.truckMesh, this.truckGlass, this.cargoMesh].filter(Boolean)) { m.count = 0; m.frustumCulled = false; m.castShadow = this.quality === "high"; this.scene.add(m); }
      this.trucks = [];
    }
    const net = roadNets(s), { links } = chainLinks(s, net);
    const key = links.map((l) => `${l.from}>${l.to}`).join();
    if (key === this.truckKey) return;
    this.truckKey = key;
    const door = (i) => { const x = i % N, y = Math.floor(i / N); for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) if (inMap(x + dx, y + dy) && roadAt(s.tiles[idx(x + dx, y + dy)])) return idx(x + dx, y + dy); return -1; };
    // shortest road path between two road tiles
    const path = (a, b) => {
      const prev = new Int32Array(N * N).fill(-2); prev[a] = -1; const q = [a];
      for (let h = 0; h < q.length; h++) {
        const j = q[h]; if (j === b) break;
        const x = j % N, y = Math.floor(j / N);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (!inMap(xx, yy)) continue; const k = idx(xx, yy); if (prev[k] === -2 && roadAt(s.tiles[k])) { prev[k] = j; q.push(k); } }
      }
      if (prev[b] === -2) return null;
      const out = []; for (let j = b; j !== -1; j = prev[j]) out.push(j); return out.reverse();
    };
    this.trucks = [];
    for (const l of links.slice(0, 24)) {
      const a = door(l.from), b = door(l.to);
      if (a < 0 || b < 0) continue;
      const p = path(a, b);
      if (!p || p.length < 2) continue;
      this.trucks.push({ path: p, k: Math.random() * (p.length - 1), dir: 1, wait: Math.random() * 2, cargo: new THREE.Color(l.cargo) });
    }
    for (const m of [this.truckMesh, this.truckGlass, this.cargoMesh].filter(Boolean)) m.count = this.trucks.length;
  }

  stepTrucks(dt) {
    if (!this.trucks?.length) { if (this.truckMesh) for (const m of [this.truckMesh, this.truckGlass, this.cargoMesh].filter(Boolean)) m.count = 0; return; }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), hide = new THREE.Vector3(0, 0, 0);
    const night = this.nightTime;
    this.trucks.forEach((t, i) => {
      if (t.wait > 0) t.wait -= dt;
      else {
        t.k += dt * 0.9 * t.dir;
        const end = t.path.length - 1;
        if (t.k >= end) { t.k = end; t.dir = -1; t.wait = 1.5; }
        if (t.k <= 0) { t.k = 0; t.dir = 1; t.wait = 1.5; }
      }
      const j = Math.min(t.path.length - 2, Math.floor(t.k)), f = t.k - j;
      const a = tileCenter(t.path[j] % N, Math.floor(t.path[j] / N)), b = tileCenter(t.path[j + 1] % N, Math.floor(t.path[j + 1] / N));
      v.lerpVectors(a, b, f);
      let dx = b.x - a.x, dz = b.z - a.z;
      if (t.dir < 0) { dx = -dx; dz = -dz; }
      v.x += -dz * 0.14; v.z += dx * 0.14; // drive on the right
      q.setFromAxisAngle(up, Math.atan2(-dz, dx));
      sc.setScalar(night ? 0.0001 : 1); // trucks rest at night
      m4.compose(v, q, sc);
      this.truckMesh.setMatrixAt(i, m4);
      this.truckGlass?.setMatrixAt(i, m4);
      // loaded on the way to the factory, empty on the way back
      if (t.dir < 0 || night) m4.compose(hide, q, new THREE.Vector3(0.0001, 0.0001, 0.0001));
      this.cargoMesh.setMatrixAt(i, m4);
      this.cargoMesh.setColorAt(i, t.cargo);
    });
    for (const m of [this.truckMesh, this.truckGlass, this.cargoMesh].filter(Boolean)) m.instanceMatrix.needsUpdate = true;
    if (this.cargoMesh.instanceColor) this.cargoMesh.instanceColor.needsUpdate = true;
  }

  syncCars() {
    const want = this.quality === "low" ? 0 : Math.min(40, Math.floor((this.roads.length / 5) * (this.rush ? 1.8 : 1)));
    if (!this.carMesh) {
      // Pickups (جيب حوض): mostly white, some beige, silver, red and navy. Paint per car, trim shared.
      this.carMesh = new THREE.InstancedMesh(model("pickupBody").matte, this.mats.shiny, 40);
      const colors = ["#f4f4f2", "#f4f4f2", "#e9e1cf", "#c3c6ca", "#f4f4f2", "#a8322a", "#2c3e63", "#d9c39a"];
      for (let i = 0; i < 40; i++) this.carMesh.setColorAt(i, new THREE.Color(colors[i % colors.length]));
      const trim = model("pickupTrim");
      this.carTrim = SETS.filter((k) => trim[k]).map((k) => new THREE.InstancedMesh(trim[k], this.mats[k], 40));
      for (const m of [this.carMesh, ...this.carTrim]) { m.castShadow = m.material !== this.mats.lights && m.material !== this.mats.glow && this.quality !== "low"; m.frustumCulled = false; m.count = 0; this.scene.add(m); }
    }
    this.carsWanted = want;
    while (this.cars.length < want && this.roads.length) {
      const [x, y] = this.roads[Math.floor(Math.random() * this.roads.length)];
      this.cars.push({ x, y, tx: x, ty: y, t: 1, speed: 0.6 + Math.random() * 0.6 });
    }
    this.cars.length = Math.min(this.cars.length, want);
    for (const m of [this.carMesh, ...this.carTrim]) m.count = this.cars.length;
  }

  stepCars(dt) {
    if (!this.carMesh || !this.cars.length) return;
    const s = this.state, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    this.cars.forEach((c, i) => {
      const jam = this.trafficCong ? this.trafficCong[idx(c.x, c.y)] || 0 : 0;
      c.t += (dt * c.speed) / (1 + jam * 2.5);
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
      for (const t of this.carTrim) t.setMatrixAt(i, m4);
    });
    const shown = this.nightTime ? Math.ceil(this.cars.length / 4) : this.cars.length;
    for (const m of [this.carMesh, ...this.carTrim]) { m.count = shown; m.instanceMatrix.needsUpdate = true; }
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

  /** What the season's events look like: lanterns for Ramadan and Eid, rain, a camel fair. */
  syncFestive(s) {
    const has = (id) => s.events.some((e) => e.id === id);
    this.festive = has("ramadan") || has("eid") || has("adha");
    this.eid = has("eid") || has("adha");
    this.dusty = has("dust");
    this.raining = has("rain");
    this.mazayen = s.events.some((e) => e.mazayen);
    this.removeAll(this.festiveMeshes);
    this.festiveMeshes = [];
    if (this.festive) {
      const list = [];
      for (const [x, y] of this.roads) if ((x + y) % 2 === 1) { const p = tileCenter(x, y); list.push(this.place(p.x - 0.44, p.z - 0.44, -Math.PI / 4)); }
      this.festiveMeshes = this.addInstances(model("festive"), list);
    }
  }

  stepWeather(dt) {
    // Rain: streaks falling around the middle of the view.
    if (this.raining && this.quality !== "low") {
      if (!this.rain) {
        const n = 1400, g = new THREE.BufferGeometry(), pos = new Float32Array(n * 6);
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        this.rainDrops = Array.from({ length: n }, () => ({ x: (Math.random() - 0.5) * 30, y: Math.random() * 8, z: (Math.random() - 0.5) * 30 }));
        this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: "#e4f0fa", transparent: true, opacity: 0.75 }));
        this.rain.frustumCulled = false;
        this.scene.add(this.rain);
      }
      this.rain.visible = true;
      const pos = this.rain.geometry.attributes.position, v = this.view;
      this.rainDrops.forEach((d, i) => {
        d.y -= dt * 9; d.x -= dt * 1.2;
        if (d.y < 0) { d.y = 7 + Math.random() * 2; d.x = (Math.random() - 0.5) * 30; d.z = (Math.random() - 0.5) * 30; }
        pos.setXYZ(i * 2, v.x + d.x, d.y, v.z + d.z);
        pos.setXYZ(i * 2 + 1, v.x + d.x + 0.05, d.y + 0.35, v.z + d.z);
      });
      pos.needsUpdate = true;
    } else if (this.rain) this.rain.visible = false;

    // Eid nights: fireworks over the town.
    if (this.eid && this.night > 0.5 && this.quality !== "low") {
      if (!this.fw) {
        const n = 400, g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3).fill(-50), 3));
        g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
        this.fw = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        this.fw.frustumCulled = false;
        this.fwParts = [];
        this.fwNext = 0;
        this.scene.add(this.fw);
      }
      this.fw.visible = true;
      this.fwNext -= dt;
      if (this.fwNext <= 0) {
        this.fwNext = 0.5 + Math.random() * 0.9;
        const c = new THREE.Color().setHSL(Math.random(), 0.9, 0.6), cx = this.view.x + (Math.random() - 0.5) * 10, cz = this.view.z + (Math.random() - 0.5) * 10, cy = 2.2 + Math.random() * 1.4;
        for (let i = 0; i < 60; i++) {
          const a = Math.random() * Math.PI * 2, b = Math.acos(Math.random() * 2 - 1), sp = 1.6 + Math.random() * 0.6;
          this.fwParts.push({ x: cx, y: cy, z: cz, vx: Math.sin(b) * Math.cos(a) * sp, vy: Math.cos(b) * sp, vz: Math.sin(b) * Math.sin(a) * sp, life: 1.2 + Math.random() * 0.5, c });
        }
        if (this.fwParts.length > 400) this.fwParts.splice(0, this.fwParts.length - 400);
      }
      const pos = this.fw.geometry.attributes.position, col = this.fw.geometry.attributes.color;
      this.fwParts = this.fwParts.filter((p) => (p.life -= dt) > 0);
      for (let i = 0; i < 400; i++) {
        const p = this.fwParts[i];
        if (!p) { pos.setXYZ(i, 0, -50, 0); continue; }
        p.vy -= dt * 1.4; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        pos.setXYZ(i, p.x, p.y, p.z);
        const f = Math.min(1, p.life);
        col.setXYZ(i, p.c.r * f, p.c.g * f, p.c.b * f);
      }
      pos.needsUpdate = true; col.needsUpdate = true;
    } else if (this.fw) this.fw.visible = false;
  }

  // ---------- the flash flood ----------

  /**
   * Muddy water rushes down the wadi from west to east, rising as its front passes; buildings it
   * takes tilt, sink and break up; then the water slowly drains away and the town is redrawn.
   * lost: tile indexes carried away; damaged: tile indexes left standing but hurt.
   */
  playFlood(lost, damaged) {
    const s = this.state;
    if (!s) return;
    const tiles = [];
    s.tiles.forEach((t, i) => { if (t.t === "wadi") tiles.push(i); });
    if (!tiles.length) return;
    if (this.floodAnim) this.endFlood();
    const g = new THREE.PlaneGeometry(1.25, 1.25); g.rotateX(-Math.PI / 2);
    // Muddy water with light streaks that flow downstream (the texture slides each frame).
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d");
    x.fillStyle = "#8a7150"; x.fillRect(0, 0, 64, 64);
    x.strokeStyle = "rgba(235, 220, 190, .35)"; x.lineWidth = 2;
    for (let k = 0; k < 5; k++) { x.beginPath(); for (let px = 0; px <= 64; px += 4) x.lineTo(px, k * 13 + 4 + Math.sin(px / 64 * Math.PI * 2 + k) * 3); x.stroke(); }
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
    const water = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.2, metalness: 0.15, transparent: true, opacity: 0.9, depthWrite: false }), tiles.length);
    water.frustumCulled = false; water.renderOrder = 2;
    this.scene.add(water);
    const foamGeo = new THREE.BufferGeometry();
    foamGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(400 * 3).fill(-50), 3));
    const foam = new THREE.Points(foamGeo, new THREE.PointsMaterial({ color: "#f4efe2", size: 0.14, transparent: true, opacity: 0.9, depthWrite: false }));
    foam.frustumCulled = false;
    this.scene.add(foam);
    const xs = tiles.map((i) => i % N), minX = Math.min(...xs), maxX = Math.max(...xs);
    const arrive = (i) => ((i % N) - minX) / Math.max(1, maxX - minX) * 2.6; // seconds for the front to reach a tile
    this.floodAnim = { t: 0, tiles, water, foam, arrive, lost: new Set(lost), damaged: new Set(damaged) };
    for (const i of lost) this.puff(tileCenter(i % N, Math.floor(i / N)), 0);
  }

  stepFlood(dt) {
    const f = this.floodAnim;
    if (!f) return;
    f.t += dt;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3();
    const drain = f.t < 5.5 ? 1 : Math.max(0, 1 - (f.t - 5.5) / 2.5);
    // the water: each tile fills as the front passes, with a little swell
    f.tiles.forEach((i, k) => {
      const c = tileCenter(i % N, Math.floor(i / N));
      const fill = Math.max(0, Math.min(1, (f.t - f.arrive(i)) / 0.45)) * drain;
      const swell = Math.sin(f.t * 6 + i) * 0.015;
      p.set(c.x, 0.02 + 0.16 * fill + swell * fill, c.z);
      sc.set(Math.max(0.001, fill), 1, Math.max(0.001, fill));
      m.compose(p, q.identity(), sc);
      f.water.setMatrixAt(k, m);
    });
    f.water.instanceMatrix.needsUpdate = true;
    f.water.material.opacity = 0.9 * drain;
    f.water.material.map.offset.x -= dt * 1.6; // the current
    // foam on the moving front
    const pos = f.foam.geometry.attributes.position;
    let n = 0;
    for (const i of f.tiles) {
      const d = f.t - f.arrive(i);
      if (d < 0 || d > 0.6 || n >= 400) continue;
      const c = tileCenter(i % N, Math.floor(i / N));
      for (let j = 0; j < 6 && n < 400; j++, n++) pos.setXYZ(n, c.x + (Math.random() - 0.3) * 0.9, 0.2 + Math.random() * 0.15, c.z + (Math.random() - 0.5) * 1);
    }
    for (; n < 400; n++) pos.setXYZ(n, 0, -50, 0);
    pos.needsUpdate = true;
    // buildings the water takes: they lean with the current, sink and break up
    if (this.where) for (const tile of f.lost) {
      const w = this.where.get(tile), inst = w && this.instances.get(w.k);
      if (!inst) continue;
      const g = Math.max(0, Math.min(1, (f.t - f.arrive(tile) - 0.25) / 1.4));
      if (g <= 0) continue;
      if (g < 1 && Math.random() < dt * 8) this.puff(tileCenter(tile % N, Math.floor(tile / N)), 2);
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.7 * g);
      const tilt = new THREE.Matrix4().makeRotationFromQuaternion(q);
      const down = new THREE.Matrix4().makeTranslation(0.25 * g, -0.6 * g, 0);
      const shrink = new THREE.Matrix4().makeScale(1 - 0.5 * g, 1 - 0.7 * g, 1 - 0.5 * g);
      m.copy(w.m).multiply(down).multiply(tilt).multiply(shrink);
      for (const set of SETS) if (inst[set]) { inst[set].setMatrixAt(w.i, m); inst[set].instanceMatrix.needsUpdate = true; }
    }
    // once the water has passed, redraw the town (the lost buildings are gone)
    if (f.t > 5 && !f.synced) {
      f.synced = true;
      const pend = this.pendingSync;
      this.floodAnim = null; this.pendingSync = null;
      this.sync(pend?.s || this.state, pend?.what);
      this.floodAnim = f;
    }
    if (f.t > 8) this.endFlood();
  }

  endFlood() {
    const f = this.floodAnim;
    if (!f) return;
    this.scene.remove(f.water, f.foam);
    f.water.dispose(); f.foam.geometry.dispose();
    this.floodAnim = null;
    if (this.pendingSync) { const p = this.pendingSync; this.pendingSync = null; this.sync(p.s, p.what); }
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
      // men: thobe (coloured per person) + head (red or white shemagh); women in abayas.
      const mk = (k) => { const mesh = new THREE.InstancedMesh(model(k).matte, this.mats.matte, 120); mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = this.quality === "high"; this.scene.add(mesh); return mesh; };
      this.peopleMesh = { body: mk("manBody"), red: mk("manHeadRed"), white: mk("manHeadWhite"), woman: mk("woman") };
      this.camels = [];
      const cg = model("camel").matte;
      this.camelMesh = new THREE.InstancedMesh(cg, this.mats.matte, 16);
      this.camelMesh.count = 0; this.camelMesh.frustumCulled = false; this.camelMesh.castShadow = this.quality !== "low";
      this.scene.add(this.camelMesh);
    }
    // People: more as the town grows, only where there are roads.
    const want = this.quality === "low" || !this.roads.length ? 0 : Math.min(120, Math.round(4 + s.pop / 6));
    while (this.people.length < want) {
      const [x, y] = this.roads[Math.floor(Math.random() * this.roads.length)];
      const n = this.people.length, kind = n % 3 === 2 ? "woman" : n % 5 === 3 ? "kid" : n % 2 ? "red" : "white";
      this.people.push({ x, y, tx: x, ty: y, t: Math.random(), speed: 0.12 + Math.random() * 0.1, side: Math.random() < 0.5 ? 1 : -1, kind, shade: Math.random(), home: !!this.nightTime });
    }
    this.people.length = Math.min(this.people.length, want);
    // Road tiles in front of homes: where people go in at night and come out in the morning.
    this.doorRoads = [];
    this.doorSet = new Set();
    for (const i of this.homes || []) {
      const x = i % N, y = Math.floor(i / N);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inMap(x + dx, y + dy) && roadAt(s.tiles[idx(x + dx, y + dy)]) && !this.doorSet.has(idx(x + dx, y + dy))) { this.doorSet.add(idx(x + dx, y + dy)); this.doorRoads.push([x + dx, y + dy]); }
    }
    // Road tiles by the mosques: where the men go at prayer time.
    this.mosqueRoads = []; this.mosqueSet = new Set();
    s.tiles.forEach((t, i) => {
      if (!["mosque", "bigmosque"].includes(t.b?.id) || t.b.build > 0) return;
      const x = i % N, y = Math.floor(i / N);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inMap(x + dx, y + dy) && roadAt(s.tiles[idx(x + dx, y + dy)]) && !this.mosqueSet.has(idx(x + dx, y + dy))) { this.mosqueSet.add(idx(x + dx, y + dy)); this.mosqueRoads.push([x + dx, y + dy]); }
    });
    for (const p of this.people) if (!roadAt(s.tiles[idx(p.tx, p.ty)]) || !roadAt(s.tiles[idx(p.x, p.y)])) {
      const [x, y] = this.roads[Math.floor(Math.random() * this.roads.length)] || [0, 0]; Object.assign(p, { x, y, tx: x, ty: y, t: 1 });
    }
    // Camels: a small herd while the town is still young, grazing on open land.
    const fair = !!s.events?.some((e) => e.mazayen);
    const pens = s.tiles.reduce((n, t) => n + (t.b?.id === "pen" || t.b?.id === "livestock" ? 1 : 0), 0);
    const herd = Math.min(16, (fair ? 16 : s.era >= 3 ? 0 : s.era === 2 ? 3 : 6) + pens * 2);
    const open = (x, y) => inMap(x, y) && !s.tiles[idx(x, y)].b && s.tiles[idx(x, y)].t !== "rock";
    if (!this.herdHome || !open(this.herdHome[0], this.herdHome[1]) || this.herdSeason !== seasonOf(s.day).i || this.herdFair !== fair) {
      this.herdSeason = seasonOf(s.day).i;
      this.herdFair = fair;
      let best = null, bestScore = -1;
      for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
        if (!open(x, y)) continue;
        let free = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) free += open(x + dx, y + dy) ? 1 : 0;
        const g = s.tiles[idx(x, y)].t;
        const score = free * 10 - Math.hypot(x - HALF, y - HALF - 4) + (g === "wadi" ? 8 : 0) + (g === "fayda" && seasonOf(s.day).id === "spring" ? 60 : 0);
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

  /** Follow one person along the roads from home to work and back, the camera going with them. */
  followPerson(path, label) {
    if (!path || path.length < 1) return;
    this.follow = { path, k: 0, dir: 1, wait: 1, label };
    if (!this.followMesh) {
      const mk = (k) => { const m = new THREE.InstancedMesh(model(k).matte, this.mats.matte, 1); m.frustumCulled = false; this.scene.add(m); return m; };
      this.followMesh = [mk("manBody"), mk("manHeadRed")];
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.15, 24), new THREE.MeshBasicMaterial({ color: "#f3cf7a", transparent: true, opacity: 0.9, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; this.scene.add(ring); this.followRing = ring;
    }
    for (const m of this.followMesh) m.visible = true;
    this.followRing.visible = true;
  }
  stopFollow() {
    this.follow = null;
    if (this.followMesh) for (const m of this.followMesh) m.visible = false;
    if (this.followRing) this.followRing.visible = false;
  }
  stepFollow(dt) {
    const f = this.follow;
    if (!f) return;
    if (f.wait > 0) f.wait -= dt;
    else {
      f.k += dt * 0.7 * f.dir;
      const end = f.path.length - 1;
      if (f.k >= end) { f.k = end; f.dir = -1; f.wait = 4; f.arrived = true; }
      if (f.k <= 0) { f.k = 0; f.dir = 1; f.wait = 4; f.home = true; }
    }
    const j = Math.min(Math.max(0, f.path.length - 2), Math.floor(f.k)), t = f.k - j;
    const a = tileCenter(f.path[j] % N, Math.floor(f.path[j] / N)), b = tileCenter(f.path[Math.min(f.path.length - 1, j + 1)] % N, Math.floor(f.path[Math.min(f.path.length - 1, j + 1)] / N));
    const v = new THREE.Vector3().lerpVectors(a, b, t);
    let dx = b.x - a.x, dz = b.z - a.z;
    if (f.dir < 0) { dx = -dx; dz = -dz; }
    v.x += -dz * 0.35; v.z += dx * 0.35;
    v.y = Math.abs(Math.sin(this.clock * 9)) * 0.012;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-dz, dx));
    const m4 = new THREE.Matrix4().compose(v, q, new THREE.Vector3(1.15, 1.15, 1.15));
    for (const m of this.followMesh) { m.setMatrixAt(0, m4); m.instanceMatrix.needsUpdate = true; }
    this.followRing.position.set(v.x, 0.02, v.z);
    this.followPos = v;
    // the camera keeps them in the middle of the screen
    this.view.x += (v.x - this.view.x) * Math.min(1, dt * 2.5);
    this.view.z += (v.z - this.view.z) * Math.min(1, dt * 2.5);
    this.updateCamera();
  }
  /** A point in the world on the screen. */
  project(v) {
    const p = v.clone().project(this.camera);
    return { sx: (p.x + 1) / 2 * this.w, sy: (1 - p.y) / 2 * this.h };
  }

  stepLife(dt) {
    if (!this.people) return;
    const s = this.state, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    const counts = { body: 0, red: 0, white: 0, woman: 0 }, night = (!!this.nightTime || !!this.siesta) && !this.festive;
    const M = this.peopleMesh, col = new THREE.Color();
    const winter = seasonOf(this.state.day).id === "winter";
    const thobes = winter ? ["#f2efe6", "#c9b79a", "#8a8f94", "#6b5a48", "#ece6d8"] : ["#f6f5f0", "#f1ede2", "#ebe7dc", "#f6f5f0"];
    const pray = !!this.prayer && !night && this.mosqueRoads?.length > 0;
    for (const p of this.people) {
      // After the prayer the men come out of the mosque a few at a time.
      if (p.atMosque) {
        if (!pray && Math.random() < dt * 0.5) { const [x, y] = this.mosqueRoads?.length ? this.mosqueRoads[Math.floor(Math.random() * this.mosqueRoads.length)] : [p.x, p.y]; Object.assign(p, { home: false, atMosque: false, x, y, tx: x, ty: y, t: 1 }); }
        else continue;
      }
      // At night everyone heads home and goes in; in the morning they come out a few at a time.
      if (p.home) {
        if (!night && this.doorRoads.length && Math.random() < dt * 0.08) {
          const [x, y] = this.doorRoads[Math.floor(Math.random() * this.doorRoads.length)];
          Object.assign(p, { home: false, x, y, tx: x, ty: y, t: 1 });
        } else continue;
      }
      const toMosque = pray && p.kind !== "woman";
      p.t += dt * p.speed * (night ? 2.4 : toMosque ? 1.8 : 1);
      if (p.t >= 1) {
        if (night && (this.doorSet.has(idx(p.tx, p.ty)) || !this.doorRoads.length || Math.random() < 0.3)) { p.home = true; continue; }
        if (toMosque && this.mosqueSet.has(idx(p.tx, p.ty))) { p.atMosque = true; p.x = p.tx; p.y = p.ty; continue; }
        p.t = 0; p.px = p.x; p.py = p.y; p.x = p.tx; p.y = p.ty;
        const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => inMap(p.x + dx, p.y + dy) && roadAt(s.tiles[idx(p.x + dx, p.y + dy)]) && !(p.x + dx === p.px && p.y + dy === p.py));
        let pick = opts.length ? opts[Math.floor(Math.random() * opts.length)] : [(p.px ?? p.x) - p.x, (p.py ?? p.y) - p.y];
        // at prayer time, take the step that brings you closest to a mosque (with a little wandering)
        if (toMosque && opts.length && Math.random() < 0.85) {
          const goal = this.mosqueRoads.reduce((best, m) => (Math.abs(m[0] - p.x) + Math.abs(m[1] - p.y) < Math.abs(best[0] - p.x) + Math.abs(best[1] - p.y) ? m : best), this.mosqueRoads[0]);
          pick = opts.reduce((best, o) => (Math.abs(p.x + o[0] - goal[0]) + Math.abs(p.y + o[1] - goal[1]) < Math.abs(p.x + best[0] - goal[0]) + Math.abs(p.y + best[1] - goal[1]) ? o : best), opts[0]);
        }
        p.tx = p.x + pick[0]; p.ty = p.y + pick[1];
        if (!inMap(p.tx, p.ty) || !roadAt(s.tiles[idx(p.tx, p.ty)])) { p.tx = p.x; p.ty = p.y; }
      }
      const a = tileCenter(p.x, p.y), b = tileCenter(p.tx, p.ty);
      v.lerpVectors(a, b, p.t);
      const dx = b.x - a.x, dz = b.z - a.z;
      if (dx || dz) { v.x += -dz * 0.4 * p.side; v.z += dx * 0.4 * p.side; } else { v.x += 0.4 * p.side; }
      v.y = Math.abs(Math.sin(this.clock * 9 + p.speed * 50)) * 0.01;
      q.setFromAxisAngle(up, Math.atan2(-dz, dx) + Math.sin(this.clock * 9 + p.speed * 50) * 0.06);
      const s2 = p.kind === "kid" ? 0.72 : 0.95 + p.shade * 0.12;
      sc.set(s2, s2, s2);
      m4.compose(v, q, sc);
      if (p.kind === "woman") M.woman.setMatrixAt(counts.woman++, m4);
      else {
        const head = p.kind === "red" ? "red" : "white";
        M[head].setMatrixAt(counts[head]++, m4);
        col.set(p.kind === "kid" ? "#f6f5f0" : thobes[Math.floor(p.shade * thobes.length)]);
        M.body.setColorAt(counts.body, col);
        M.body.setMatrixAt(counts.body++, m4);
      }
    }
    sc.set(1, 1, 1);
    for (const [k, m] of Object.entries(M)) { m.count = counts[k]; m.instanceMatrix.needsUpdate = true; }
    if (M.body.instanceColor) M.body.instanceColor.needsUpdate = true;

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
        for (const set of SETS) if (inst[set]) { inst[set].setMatrixAt(w.i, m); inst[set].instanceMatrix.needsUpdate = true; }
        if (t >= 1) this.anims.delete(tile);
      }
    }
    if (this.clouds) {
      const o = this.clouds.material.map.offset;
      o.x = (o.x + dt * 0.004) % 1; o.y = (o.y + dt * 0.0025) % 1;
      this.clouds.material.opacity = (this.raining ? 0.38 : 0.2) * (1 - this.night);
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
    if (this.raining) { sky.lerp(new THREE.Color("#7d8794"), 0.45); this.sun.intensity *= 0.45; this.hemi.intensity *= 0.75; }
    // a dust storm: the sky goes ochre and the light dims
    if (this.dusty) { sky.lerp(new THREE.Color("#c9a46a"), 0.55); this.sun.intensity *= 0.6; this.sun.color.lerp(new THREE.Color("#e0b070"), 0.6); }
    this.scene.background = sky;
    this.scene.fog.color.copy(sky);
    this.hemi.color.set(day > 0.5 ? "#fff4dd" : "#8fa0d8");
    this.mats.lights.opacity = Math.min(1, this.night * 1.4);
    if (this.envNight !== Math.round(this.night * 20)) { this.envNight = Math.round(this.night * 20); for (const [k, v] of Object.entries(this.envLevel)) this.mats[k].envMapIntensity = v * (1 - this.night * 0.8); }
    if (this.glowMesh) this.glowMesh.material.opacity = Math.max(0, this.night * 0.95 - 0.15);
  }

  // ---------- camera ----------

  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    const dpr = Math.min(this.quality === "high" ? 2 : this.quality === "medium" ? 1.5 : 1.25, devicePixelRatio || 1);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    if (this.composer) { this.composer.setPixelRatio(dpr); this.composer.setSize(w, h); }
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
    const lift = v.y || 0, sh = this.shakeOff || { x: 0, z: 0 }; // lift: looking up at something in the air (war scenes); shake: an explosion nearby
    this.camera.position.set(v.x + sh.x + Math.sin(v.yaw) * Math.cos(v.pitch) * dist, lift + Math.sin(v.pitch) * dist, v.z + sh.z + Math.cos(v.yaw) * Math.cos(v.pitch) * dist);
    this.camera.lookAt(v.x + sh.x, lift, v.z + sh.z);
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

  setGhost(tile, key, ok, ground, angle = 0) {
    this.ghost.clear();
    if (!tile || !key) return;
    const geo = model(key, ground);
    if (!geo) return;
    const mesh = new THREE.Mesh(geo.matte, ok ? this.mats.ghost : this.mats.ghostBad);
    mesh.position.copy(tileCenter(tile.x, tile.y));
    mesh.rotation.y = angle;
    this.ghost.add(mesh);
  }

  /** Tint tiles (a service's reach). values: Float32Array(N*N) of strengths, colour: css colour. */
  setOverlay(values, color, opacity = 0.3) {
    if (this.overlay) { this.scene.remove(this.overlay); this.overlay.dispose(); this.overlay = null; }
    if (!values) return;
    const cells = [];
    for (let i = 0; i < N * N; i++) if (values[i] > 0) cells.push(i);
    const g = new THREE.PlaneGeometry(0.96, 0.96); g.rotateX(-Math.PI / 2);
    const heat = color === "heat";
    this.overlay = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: heat ? "#ffffff" : color, transparent: true, opacity: heat ? 0.55 : opacity, depthWrite: false }), Math.max(1, cells.length));
    const m = new THREE.Matrix4(), hc = new THREE.Color();
    cells.forEach((i, k) => {
      const p = tileCenter(i % N, Math.floor(i / N)); m.makeTranslation(p.x, 0.015, p.z); this.overlay.setMatrixAt(k, m);
      if (heat) { const v = Math.min(1, values[i]); hc.setHSL(0.33 * (1 - v), 0.85, 0.5); this.overlay.setColorAt(k, hc); }
    });
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
    this.stepTrucks(dt);
    if (this.streamTex && this.flood?.visible) { this.streamTex.offset.x = (this.streamTex.offset.x - dt * 0.25) % 1; }
    if (this.ripples) { const m = this.ripples.material.map; m.offset.x = (m.offset.x + dt * 0.02) % 1; m.offset.y = (m.offset.y + dt * 0.012) % 1; }
    this.stepFollow(dt);
    this.stepSmoke(dt);
    this.stepLife(dt);
    this.stepEffects(dt);
    this.stepWeather(dt);
    this.stepFlood(dt);
    this.fx?.step(dt);
    this.sun.target.position.set(v.x, 0, v.z);
    this.sun.position.add(this.sun.target.position);
    this.shadowTick = ((this.shadowTick || 0) + 1) % (this.quality === "high" ? 2 : 3);
    if (!this.shadowTick || this.shadowDirty) { this.renderer.shadowMap.needsUpdate = true; this.shadowDirty = false; }
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
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
let thumbMats = null;
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
  thumbMats ||= {
    matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), shiny: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.3 }),
    paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15 }), metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, metalness: 0.5 }), glow: new THREE.MeshBasicMaterial({ vertexColors: true })
  };
  if (geo) for (const [set, mat] of Object.entries(thumbMats)) {
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
