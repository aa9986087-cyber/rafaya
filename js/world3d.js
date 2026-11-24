// The town in 3D: ground, roads, buildings (instanced), light and shadow, day and night, cars and smoke.
import * as THREE from "three";
import { MAP_SIZE as N, B, ROAD_IDS } from "./data.js";
import { idx, inMap, seasonOf, owns, plotAt, chainLinks, roadNets, springGreen, powerNet } from "./sim.js";
import { buildingMaterials } from "./building-surfaces.js";
import { tileLane, lanePosition, ISLAND_RADIUS } from "./traffic-path.js";
import { worldWater, rainField, wetSurface } from "./world-weather.js";
import { model, modelFar, modelKey, baseKey, makerSeeded, VARIANTS, SETS, FAIR_WHEEL } from "./models.js";
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

/**
 * RAFAYA REMASTERED, the realism layer: a tileable detail texture made once in the page.
 * - R: a fine grain (sand in the plaster, the asphalt's aggregate).
 * - G: broad stains and sun-bleached patches.
 * - B: vertical streaks (where rain and dust ran down a wall).
 * Materials read it in world space (see addDetail), so no two walls repeat the same marks and nothing needs UVs.
 */
function detailTexture() {
  const S = 256, img = new ImageData(S, S);
  const rnd = (i, j, k) => { const h = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453; return h - Math.floor(h); };
  const vnoise = (x, y, f, k) => { // value noise that wraps every f cells (tileable)
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = rnd(xi % f, yi % f, k), b = rnd((xi + 1) % f, yi % f, k), c = rnd(xi % f, (yi + 1) % f, k), d = rnd((xi + 1) % f, (yi + 1) % f, k);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, y, f, k, oct) => { let t = 0, amp = 0.5, n = 0; for (let o = 0; o < oct; o++) { t += vnoise(x * (f << o) / S, y * (f << o) / S, f << o, k + o) * amp; n += amp; amp *= 0.5; } return t / n; };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    img.data[i] = Math.round(fbm(x, y, 32, 1, 3) * 255);
    img.data[i + 1] = Math.round(fbm(x, y, 4, 7, 4) * 255);
    img.data[i + 2] = Math.round(Math.pow(fbm(x, y * 0.0625, 16, 13, 2), 2.2) * 255); // stretched tall: streaks
    img.data[i + 3] = 255;
  }
  const c = document.createElement("canvas"); c.width = c.height = S; c.getContext("2d").putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4;
  return t;
}
/**
 * Give a material real surfaces: its colour varies with a grain and with stains, and walls carry faint streaks.
 * The texture is projected from three sides in world space (triplanar), at "scale" repeats per tile.
 * One texture, three reads per pixel: on the lowest quality the materials stay as they were.
 */
function addDetail(mat, tex, { grain = 0.14, stain = 0.12, streak = 0.1, scale = 1.6, rough = 0.12 } = {}) {
  const before = mat.onBeforeCompile; // another change to the shader (the breeze on leaves) comes first
  mat.onBeforeCompile = (sh, r) => {
    before?.call(mat, sh, r);
    sh.uniforms.dMap = { value: tex };
    sh.uniforms.dK = { value: new THREE.Vector4(grain, stain, streak, scale) };
    sh.uniforms.dRough = { value: rough };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vDWp; varying vec3 vDWn;").replace("#include <begin_vertex>", `#include <begin_vertex>
      vec4 dWp = vec4(transformed, 1.0); vec3 dN = objectNormal;
      #ifdef USE_INSTANCING
        dWp = instanceMatrix * dWp; dN = mat3(instanceMatrix) * dN;
      #endif
      vDWp = (modelMatrix * dWp).xyz; vDWn = normalize(mat3(modelMatrix) * dN);`);
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vDWp; varying vec3 vDWn; uniform sampler2D dMap; uniform vec4 dK; uniform float dRough;").replace("#include <color_fragment>", `#include <color_fragment>
      vec3 dW = pow(abs(vDWn), vec3(4.0)); dW /= (dW.x + dW.y + dW.z + 1e-5);
      vec3 dP = vDWp * dK.w;
      vec4 dT = texture2D(dMap, dP.zy) * dW.x + texture2D(dMap, dP.xz) * dW.y + texture2D(dMap, dP.xy) * dW.z;
      float dWall = 1.0 - dW.y; // streaks run down walls, not across roofs
      float dShade = 1.0 + (dT.r - 0.5) * 2.0 * dK.x + (dT.g - 0.5) * 2.0 * dK.y - dT.b * dK.z * dWall;
      diffuseColor.rgb *= clamp(dShade, 0.6, 1.25);`).replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor + (dT.g - 0.5) * dRough, 0.04, 1.0);`);
  };
  mat.customProgramCacheKey = () => "rafaya-detail";
  mat.needsUpdate = true;
}

const HALF = N / 2;
const CAR_LIMIT = { low: 8, medium: 18, high: 32 };
const TRUCK_LIMIT = 24;
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
function sandTexture(gravel = false) {
  const S = 256, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d"), img = g.createImageData(S, S), TAU = Math.PI * 2;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const a = x / S * TAU, b = y / S * TAU;
    const dune = Math.sin(a + b * 2 + Math.sin(b) * 1.6) * Math.sin(b - a * 2);
    const warp = Math.sin(b * 2 + a) * 1.4 + Math.sin(b * 3 - a * 2) * 0.43;
    const ripple = Math.sin(a * 9 + b * 5 + warp + dune * 1.8) * 0.5 + 0.5;
    const grain = rnd(), stone = Math.sin(a * 24 + b * 16) * Math.cos(b * 23 - a * 14);
    const v = gravel ? 0.89 + dune * 0.017 + stone * 0.032 + (grain - 0.5) * 0.12
      : 0.9 + ripple ** 3 * 0.054 + dune * 0.043 + stone * 0.011 + (grain - 0.5) * 0.075;
    const i = (y * S + x) * 4;
    img.data[i] = Math.min(255, 255 * v); img.data[i + 1] = Math.min(255, (gravel ? 254 : 251) * v); img.data[i + 2] = Math.min(255, (gravel ? 252 : 246) * v); img.data[i + 3] = 255;
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
  constructor(canvas, { quality = "high", ultra = false } = {}) {
    this.ultra = ultra; // «فائقة»: high, with a sharper picture and finer shadows
    this.canvas = canvas;
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== "low", powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = quality !== "low";
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false; // shadows are redrawn every third frame (see frame), not every frame: a big saving on phones
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog("#f3dcae", 40, 90);

    // Camera: an isometric-style orthographic view that pans, zooms and turns by quarter turns.
    this.view = { x: 0, z: 2, zoom: 1, yaw: Math.PI / 4, yawTarget: Math.PI / 4, pitch: 0.60 };
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);

    // Light: sky and ground fill, plus the sun that casts shadows.
    this.hemi = new THREE.HemisphereLight("#d6e4f2", "#c4b394", 0.9); // the sky's cool fill above, the pale sand's bounce below
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight("#fff1d6", 2.2);
    this.sun.castShadow = quality !== "low";
    const size = ultra ? 4096 : quality === "high" ? 2048 : 1024;
    this.sun.shadow.mapSize.set(size, size);
    Object.assign(this.sun.shadow.camera, { left: -HALF - 2, right: HALF + 2, top: HALF + 2, bottom: -HALF - 2, near: 1, far: 80 });
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    const plasterNormal = quality === "high" ? normalTex("tex/concrete-normal.webp", 1) : null;
    this.mats = {
      ...buildingMaterials(quality),
      // the town's walls: a fine plaster grain (CC0 normal map) so they read as real surfaces
      matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, normalMap: plasterNormal, normalScale: new THREE.Vector2(0.22, 0.22) }),
      shiny: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.35 }),
      lights: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0 }),
      ghost: new THREE.MeshStandardMaterial({ color: "#7ee0b8", transparent: true, opacity: 0.55, roughness: 0.6 }),
      // the realistic sets (military first): painted steel, bare steel, tinted glass, lamps that bloom
      paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.18, normalMap: plasterNormal, normalScale: new THREE.Vector2(0.35, 0.35) }),
      carPaint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.27, metalness: 0.28 }),
      metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.75, normalMap: quality === "high" ? normalTex("tex/grain-normal.webp", 2) : null, normalScale: new THREE.Vector2(0.25, 0.25) }),
      glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: quality === "low" ? .28 : .14, metalness: quality === "low" ? .23 : .64 }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(7, 7, 7), toneMapped: false }),
      ghostBad: new THREE.MeshStandardMaterial({ color: "#ff7a6a", transparent: true, opacity: 0.55, roughness: 0.6 })
    };

    this.envLevel = { paint: 0.55, carPaint: 0.83, metal: 0.9, glass: 1.2, shiny: 0.45 };
    this.breeze = { value: 0 };
    this.breezeStrength = { value: quality === "low" ? 0 : 0.025 };
    if (quality !== "low") this.mats.matte.onBeforeCompile = (shader) => {
      shader.uniforms.rafayaWind = this.breeze;
      shader.uniforms.rafayaWindStrength = this.breezeStrength;
      shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>
        attribute float leafWind;
        uniform float rafayaWind, rafayaWindStrength;`).replace("#include <begin_vertex>", `#include <begin_vertex>
        if (leafWind > 0.0) {
          float phase = position.x * 2.0 + position.z * 1.8;
          #ifdef USE_INSTANCING
            phase += dot(instanceMatrix[3].xz, vec2(0.9, 1.15));
          #endif
          transformed.xz += vec2(1.0, 0.48) * sin(rafayaWind * 1.65 + phase) * leafWind * rafayaWindStrength;
        }`);
    };
    // the realism layer (above): grain, stains and streaks on the plain walls, painted panels and steel (the remodelled
    // buildings' stone, plaster and timber carry their own textures). It wraps the breeze above. Not on the lowest quality.
    if (quality !== "low") {
      this.detailTex = detailTexture();
      addDetail(this.mats.matte, this.detailTex, { grain: 0.12, stain: 0.12, streak: 0.1, scale: 1.7 });
      addDetail(this.mats.paint, this.detailTex, { grain: 0.06, stain: 0.07, streak: 0.06, scale: 2.2, rough: 0.2 });
      addDetail(this.mats.metal, this.detailTex, { grain: 0.05, stain: 0.08, streak: 0.1, scale: 2.5, rough: 0.25 });
    }
    for (const [k, v] of Object.entries(this.envLevel)) this.mats[k].envMapIntensity = v;
    if (quality !== "low") this.loadSky();
    // bloom: only what is really bright glows (lamps, fire, flashes); none on the lowest quality
    if (quality === "high") { // bloom costs several extra passes a frame: only on high (phones default to medium)
      // a multisampled target keeps edges smooth (the bloom pass would otherwise lose the antialiasing)
      this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(256, 256, { type: THREE.HalfFloatType, samples: quality === "high" ? 4 : 2 }));
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), quality === "high" ? 0.55 : 0.45, 0.35, 3.2); // threshold above sunlit sand: only lamps, fire and flashes
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.waterWeather = { time: { value: 0 }, rain: { value: 0 }, wet: { value: 0 }, day: { value: 1 } };
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
      for (const k of Object.keys(this.envLevel)) { this.mats[k].envMap = env; this.mats[k].needsUpdate = true; }
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
    this.aggregate = sandTexture(true);
    this.groundNormal = this.quality !== "low" ? normalTex("tex/grain-normal.webp", 1) : null;
    const desert = new THREE.Mesh(outer, wetSurface(new THREE.MeshStandardMaterial({ color: "#d3a577", map: this.sand, roughness: 1, normalMap: this.groundNormal, normalScale: new THREE.Vector2(0.25, 0.25) }), this.waterWeather, 0.32));
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
    const out = new Map();
    for (let i = 0; i < (this.quality === "low" ? 360 : 760); i++) {
      const x = (hash(i, 11) - 0.5) * (N + 40), z = (hash(i, 12) - 0.5) * (N + 40);
      if (Math.max(Math.abs(x), Math.abs(z)) < HALF + 0.6) continue;
      const pick = hash(i, 13);
      const key = pick < 0.45 ? "grassTuft" : pick < 0.85 ? "shrub" : pick < 0.92 ? "acacia" : "rock";
      const chunk = `${Math.floor(x / 14)}:${Math.floor(z / 14)}:${key}`;
      if (!out.has(chunk)) out.set(chunk, { key, list: [] });
      out.get(chunk).list.push(this.place(x, z, hash(i, 14) * 6, key === "acacia" ? 0.8 + hash(i, 15) * 0.4 : 0.7 + hash(i, 15) * 0.6));
    }
    for (const { key, list } of out.values()) this.addInstances(model(key), list);

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
      mesh.computeBoundingSphere();
      mesh.boundingSphere.radius += 0.1; // allow the fronds to bend outside their rest bounds
      this.scene.add(mesh);
      meshes.push(mesh);
    }
    return meshes;
  }

  removeAll(list) { for (const m of list || []) { this.scene.remove(m); m.dispose(); } }

  sceneryInstances(lists) {
    const meshes = [];
    for (const [key, list] of Object.entries(lists)) {
      const chunks = new Map();
      for (const matrix of list) {
        const tile = `${Math.floor(matrix.elements[12] / 12)}:${Math.floor(matrix.elements[14] / 12)}`;
        if (!chunks.has(tile)) chunks.set(tile, []);
        chunks.get(tile).push(matrix);
      }
      const geometry = model(key);
      for (const chunk of chunks.values()) {
        meshes.push(...this.addInstances(geometry, chunk, key === "acacia" && this.quality === "high"));
      }
    }
    return meshes;
  }

  /** The town's own tiles: sand, wadi, with a little colour noise. Rebuilt when the land changes. */
  syncTiles(s) {
    if (this.ground) { this.scene.remove(this.ground); this.ground.geometry.dispose(); this.ground.material.dispose(); }
    const spring = seasonOf(s.day).id === "spring", c = new THREE.Color();
    // each tile's colour (and how dark it is outside the land the town owns)
    const tileCol = new Float32Array(N * N * 3);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const t = s.tiles[idx(x, y)];
      const n = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      c.set(t.t === "wadi" ? (spring ? "#8f895c" : "#a27c53") : t.t === "fayda" ? (spring ? "#92935f" : "#c6a373") : t.t === "lake" ? "#786f52" : t.t === "rock" ? "#bc8d69" : "#d8ad7e");
      const broadDunes = Math.sin(x * 0.45 + y * 0.16) * Math.sin(y * 0.29 - x * 0.1);
      c.offsetHSL(broadDunes * 0.006, 0, ((n % 7) - 3) * 0.004 + broadDunes * 0.053);
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
    this.ground = new THREE.Mesh(g, wetSurface(new THREE.MeshStandardMaterial({ vertexColors: true, map: this.sand, roughness: 1, normalMap: this.groundNormal, normalScale: new THREE.Vector2(0.29, 0.29) }), this.waterWeather, 0.38));
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
    if (this.flood) { this.scene.remove(this.flood); this.flood.traverse((m) => { m.geometry?.dispose(); m.material?.alphaMap?.dispose(); m.material?.uniforms?.shapeMap?.value?.dispose(); m.material?.dispose(); }); }
    this.flood = new THREE.Group();
    this.flood.visible = false;
    this.scene.add(this.flood);
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
      plane(0.018, worldWater(this.waterWeather, { mask: mask(stream, 8, 0.3), current: 0.32 }));
    }
    // The dam lake: one body of water with an uneven shore, a band of wet sand around it, and ripples.
    for (const mesh of this.lakeMeshes || []) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.alphaMap?.dispose();
      mesh.material.uniforms?.shapeMap?.value?.dispose();
      mesh.material.dispose();
    }
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
      if (full) plane(0.024, worldWater(this.waterWeather, { mask: mask(0.10 * level, 9, 1), current: 0.045 }));
    }
  }

  /** Pool locations depend on surfaces; a single batched geometry covers all of them. */
  syncRainPools(s) {
    this.rainPoolsDirty = false;
    if (this.rainPools) { this.scene.remove(this.rainPools); this.rainPools.geometry.dispose(); this.rainPools.material.dispose(); }
    const pos = [], uv = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const tile = s.tiles[idx(x,y)], kind = tile.b?.id, h = hash(x,y,88);
      const dirt = kind === "road", paved = kind === "asphalt" || kind === "avenue";
      if (!owns(s,x,y) || tile.t === "rock" || tile.t === "lake" || (!dirt && !paved && tile.b)) continue;
      const limit = paved ? 0.47 : dirt ? 0.33 : tile.t === "wadi" ? 0.6 : 0.029;
      if (h > limit) continue;
      const p = tileCenter(x,y);
      const ew = (x > 0 && roadAt(s.tiles[idx(x - 1,y)])) || (x + 1 < N && roadAt(s.tiles[idx(x + 1,y)]));
      const side = (h < limit * 0.5 ? -1 : 1) * (paved ? 0.28 : 0.15);
      if (paved || dirt) { if (ew) p.z += side; else p.x += side; }
      else { p.x += (hash(x,y,90) - 0.5) * 0.25; p.z += (hash(x,y,92) - 0.5) * 0.25; }
      const long = (paved ? 0.31 : 0.35) + h * 0.13, short = paved ? 0.14 : 0.23;
      const rx = !paved || ew ? long : short, rz = !paved || ew ? short : long;
      for (const [u,v] of [[0,0],[0,1],[1,1],[0,0],[1,1],[1,0]]) {
        pos.push(p.x + (2*u-1)*rx,0.017,p.z + (2*v-1)*rz);
        uv.push(u,v);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos,3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv,2));
    this.rainPools = new THREE.Mesh(geometry, worldWater(this.waterWeather, { puddle: true }));
    this.rainPools.renderOrder = 2;
    this.rainPools.visible = this.waterWeather.wet.value > 0.1;
    this.scene.add(this.rainPools);
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
    this.sceneryMeshes = this.sceneryInstances(lists);
  }

  // ---------- roads ----------

  /** Kerbs: a raised concrete edge wherever a road meets land that is not road (one draw for all). */
  syncKerbs(s) {
    if (this.kerbs) { this.scene.remove(this.kerbs); this.kerbs.geometry.dispose(); this.kerbs.material.dispose(); this.kerbs.dispose(); this.kerbs = null; }
    const list = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const t = s.tiles[idx(x, y)];
      if (!roadAt(t) || t.b.id === "road") continue;
      const p = tileCenter(x, y);
      for (const [dx, dy, a] of [[0, 1, 0], [0, -1, 0], [1, 0, Math.PI / 2], [-1, 0, Math.PI / 2]]) {
        if (inMap(x + dx, y + dy) && roadAt(s.tiles[idx(x + dx, y + dy)])) continue;
        m.compose(new THREE.Vector3(p.x + dx * 0.465, 0.0225, p.z + dy * 0.465), q.setFromAxisAngle(up, a), one);
        list.push(m.clone());
      }
    }
    if (!list.length) return;
    // the kerbstones of a Saudi street: a raised concrete edge painted in yellow and black blocks (one striped texture)
    if (!this.kerbTex) {
      const c = document.createElement("canvas"); c.width = 128; c.height = 8;
      const x = c.getContext("2d");
      for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? "#2c2b29" : "#e2b52c"; x.fillRect(i * 16, 0, 16, 8); }
      x.fillStyle = "rgba(255,255,255,.08)"; x.fillRect(0, 0, 128, 2);                     // the worn top edge
      this.kerbTex = new THREE.CanvasTexture(c); this.kerbTex.colorSpace = THREE.SRGBColorSpace; this.kerbTex.anisotropy = 4;
    }
    const g = new THREE.BoxGeometry(1, 0.045, 0.07);
    this.kerbs = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ map: this.kerbTex, roughness: 0.8 }), list.length);
    list.forEach((mm, i) => this.kerbs.setMatrixAt(i, mm));
    this.kerbs.receiveShadow = true; this.kerbs.frustumCulled = false;
    this.scene.add(this.kerbs);
  }

  /** A soft dark patch under every building where it meets the ground (fake ambient occlusion: buildings sit, not float). */
  syncContact(s) {
    if (this.contact) { this.scene.remove(this.contact); this.contact.geometry.dispose(); this.contact.material.dispose(); this.contact.dispose(); this.contact = null; }
    const list = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const b = s.tiles[idx(x, y)].b;
      if (!b || roadAt(s.tiles[idx(x, y)]) || ["parking", "pole", "streetpalm", "flowers", "lantern"].includes(b.id)) continue;
      list.push(tileCenter(x, y));
    }
    if (!list.length) return;
    if (!this.contactTex) {
      const c = document.createElement("canvas"); c.width = c.height = 64;
      const g = c.getContext("2d"), img = g.createImageData(64, 64);
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const d = Math.max(Math.abs(x - 31.5), Math.abs(y - 31.5)) / 32; // a rounded square, darkest at the walls
        const a = Math.max(0, Math.min(1, (1 - d) * 3.2)) * Math.max(0, 1 - Math.max(0, 0.55 - d) * 2.6);
        img.data[(y * 64 + x) * 4 + 3] = Math.round(a * 120);
      }
      g.putImageData(img, 0, 0);
      this.contactTex = new THREE.CanvasTexture(c);
    }
    const geo = new THREE.PlaneGeometry(1.12, 1.12); geo.rotateX(-Math.PI / 2);
    this.contact = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: this.contactTex, color: "#2a1d10", transparent: true, depthWrite: false }), list.length);
    const m = new THREE.Matrix4();
    list.forEach((p, i) => this.contact.setMatrixAt(i, m.makeTranslation(p.x, 0.008, p.z)));
    this.contact.renderOrder = 1; this.contact.frustumCulled = false;
    this.scene.add(this.contact);
  }

  syncRoads(s) {
    const topology = s.tiles.map((tile) => roadAt(tile) ? "1" : "0").join("");
    if (this.roadTopology !== topology) this.truckKey = null;
    this.roadTopology = topology;
    this.syncKerbs(s);
    if (this.roadMesh) { this.scene.remove(this.roadMesh); this.roadMesh.geometry.dispose(); this.roadMesh.material.dispose(); }
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
        quad(cx - 0.5, cz - 0.5, cx + 0.5, cz + 0.5, 0.004, (x + y) % 2 ? "#d9c7a8" : "#cfb896");
        // a street lamp on every other tile, at a corner without a road
        if ((x + y) % 3 === 0) { lamps.push(this.place(cx + 0.44, cz + 0.44, Math.PI * 0.75)); this.lampGlows.push([cx + 0.37, cz + 0.37, 1.1]); }
      }
      const w = paved ? 0.42 : 0.36;
      quad(cx - w, cz - w, cx + w, cz + w, 0.006, paved ? "#55575b" : "#b4a07c");
      const link = (dx, dy) => inMap(x + dx, y + dy) && roadAt(s.tiles[idx(x + dx, y + dy)]);
      if (paved && kind === "asphalt") {
        if (link(1, 0) && link(-1, 0) && !link(0, 1) && !link(0, -1)) {
          for (const side of [-1, 1]) quad(cx - 0.49, cz + side * 0.352 - 0.007, cx + 0.49, cz + side * 0.352 + 0.007, 0.008, "#d1c8b2");
        }
        if (link(0, 1) && link(0, -1) && !link(1, 0) && !link(-1, 0)) {
          for (const side of [-1, 1]) quad(cx + side * 0.352 - 0.007, cz - 0.49, cx + side * 0.352 + 0.007, cz + 0.49, 0.008, "#d1c8b2");
        }
      }
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
        const ringPoint = (r,a) => [cx + Math.cos(a)*r, cz + Math.sin(a)*r];
        const mark = (a,b,d) => {
          c.set("#ded5bb");
          for (const [x,z] of [a,b,d]) { pos.push(x,0.009,z); col.push(c.r,c.g,c.b); }
        };
        for (let i = 0; i < 32; i++) {
          const a = i*Math.PI/16, b = (i+1)*Math.PI/16;
          const inner = ISLAND_RADIUS + .008, outer = inner + .012;
          mark(ringPoint(inner,a),ringPoint(inner,b),ringPoint(outer,b));
          mark(ringPoint(inner,a),ringPoint(outer,b),ringPoint(outer,a));
        }
        for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) if (link(dx,dy)) {
          const at = (along,across) => [cx + dx*along - dy*across, cz + dy*along + dx*across];
          for (const o of [-.234,-.168,-.102]) mark(at(.461,o-.022),at(.408,o),at(.461,o+.022));
        }
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
        if (link(1, 0) || link(-1, 0)) for (const o of [-0.16, 0.16]) quad(cx - 0.5, cz + o - 0.035, cx + 0.5, cz + o + 0.035, 0.007, "#99724f");
        if (link(0, 1) || link(0, -1)) for (const o of [-0.16, 0.16]) quad(cx + o - 0.035, cz - 0.5, cx + o + 0.035, cz + 0.5, 0.007, "#99724f");
      }
    }
    this.lampMeshes = [...this.addInstances(model("lamp"), lamps, true), ...this.addInstances(model("medianPalm"), medians, true), ...this.addInstances(model("roundIsland"), islands, true), ...this.addInstances(model("trafficLight"), lights, true)];
    if (!pos.length) { this.roadMesh = null; return; }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const uv = new Float32Array(pos.length / 3 * 2);
    for (let i = 0; i < pos.length / 3; i++) {
      uv[i * 2] = pos[i * 3] * 0.55;
      uv[i * 2 + 1] = pos[i * 3 + 2] * 0.55;
    }
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.computeVertexNormals();
    this.roadMesh = new THREE.Mesh(g, wetSurface(new THREE.MeshStandardMaterial({ vertexColors: true, map: this.aggregate, roughness: 0.92 }), this.waterWeather, 0.48));
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
    const push = (key, ground, m, tint = 1, tile = -1) => { const k = key.startsWith("palms") ? `${key}:${ground}` : key; if (!groups.has(k)) groups.set(k, { key, ground, list: [], tints: [], tiles: [] }); const g = groups.get(k); g.list.push(m); g.tints.push(tint); g.tiles.push(tile); };
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(1, 1, 1);
    this.smokers = [];
    this.fountains = [];
    this.siteMotion = { pivot_b: [], themepark_b: [] };
    const seen = new Map(), where = new Map(), glows = [];
    this.anims ||= new Map();
    const feeder = new Map(powerNet(s).wires.map(([from, to]) => [to, from]));
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const t = s.tiles[idx(x, y)];
      const p = tileCenter(x, y);
      if (this.prevKeys?.has(idx(x, y)) && !t.b) this.puff(p, 12);
      if (!t.b) {
        if (t.t === "rock") { q.setFromAxisAngle(up, ((x * 7 + y * 13) % 8) * 0.8); m4.compose(p, q, sc); push("rock", "sand", m4.clone(), 1, idx(x, y)); }
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
      let key = t.b.build > 0 ? "construction" : baseKey(modelKey(t.b.id, t.b.lvl));
      const variants = VARIANTS[key];
      if (variants) { const v = Math.floor(hash(x, y, 77) * (variants.length + 1)); if (v > 0) key = `${key}~${v - 1}`; }
      const gk = key.startsWith("palms") ? `${key}:${t.t}` : key;
      push(key, t.t, m4.clone(), t.b.wd ? 1 - Math.min(0.5, t.b.wd * 0.006) : 1, idx(x, y));
      const i = idx(x, y);
      seen.set(i, gk);
      where.set(i, { k: gk, i: groups.get(gk).list.length - 1, m: m4.clone() });
      this.siteMotion[key]?.push({ pose: m4.clone(), x: p.x, z: p.z, phase: hash(x, y, 63) * Math.PI * 2 });
      if (gk === "tent0") glows.push([p.x + Math.sin(angle) * 0.38 + Math.cos(angle) * 0.33, p.z + Math.cos(angle) * 0.38 - Math.sin(angle) * 0.33, 0.8]);
      else if (gk.startsWith("house") || ["mosque", "grocery", "cafe", "mandi", "souq", "bank", "clinic", "hotel", "mall", "bigmosque", "lantern", "gate", "heritage", "tower", "fountain", "dallah"].includes(gk.replace(/[12]$/, ""))) glows.push([p.x + Math.sin(angle) * 0.42, p.z + Math.cos(angle) * 0.42, 0.75]);
      if (this.prevKeys && this.prevKeys.get(i) !== gk) { this.anims.set(i, this.clock); this.puff(p, 16); }
      if (!t.b.build && ["factory", "generator", "powerplant", "mandi", "datefactory", "incense"].includes(t.b.id)) this.smokers.push(p.clone());
      if (!t.b.build && !(t.b.wd >= 80) && ["fountain", "bigfountain", "park"].includes(t.b.id)) {
        const height = { fountain: 0.34, bigfountain: 0.43, park: 0.08 }[t.b.id];
        this.fountains.push({ x: p.x, z: p.z, height, ring: t.b.id === "bigfountain" });
      }
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
        inst = { capacity, key: model(key, ground) ? key : "construction", ground, far: false };
        for (const set of SETS) {
          if (!geo[set]) continue;
          const mesh = new THREE.InstancedMesh(geo[set], this.mats[set], capacity);
          mesh.castShadow = set !== "lights" && this.quality !== "low";
          mesh.receiveShadow = set !== "lights";
          this.scene.add(mesh);
          inst[set] = mesh;
        }
        this.instances.set(k, inst);
      }
      inst.tinted = tints.some((v) => v < 1) || SETS.some((set) => inst[set]?.instanceColor); // once coloured, always written (a repaired building goes back to white)
      if (inst.tinted) for (const set of SETS) if (inst[set] && set !== "lights" && set !== "glow") inst[set].setColorAt(0, tc.setRGB(1, 1, 1)); // makes the colour buffer (filled by cull)
    }
    this.groups = groups;
    this.syncSmoke();
    this.prevKeys = seen;
    this.buildingGlows = glows;
    this.where = where;
    this.cull(true); // only what the camera sees (and a margin) is drawn
    this.homes = [...where.entries()].filter(([, w]) => w.k === "tent0" || w.k.startsWith("house")).map(([i]) => i);
    this.syncContact(s);
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
    if (this.waterWeather.wet.value > 0.1 && (what.roads || what.tiles || what.buildings)) this.syncRainPools(s);
    else if (what.roads || what.tiles || what.buildings) this.rainPoolsDirty = true;
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

  /** A single soft contact shadow per vehicle, updated with its pose every rendered frame. */
  initVehicleShadows() {
    const size = 32, data = new Uint8Array(size * size * 4).fill(255);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = Math.abs(x * 2 / (size - 1) - 1), v = Math.abs(y * 2 / (size - 1) - 1);
      const t = 1 - THREE.MathUtils.smoothstep(u ** 4 + v ** 4, .1, .94);
      data[(y * size + x) * 4 + 3] = Math.round(t * 255);
    }
    const map = new THREE.DataTexture(data, size, size);
    map.minFilter = map.magFilter = THREE.LinearFilter;
    map.needsUpdate = true;
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({ map, color: "#251d1a", transparent: true, depthWrite: false });
    const capacity = (CAR_LIMIT[this.quality] || CAR_LIMIT.medium) + (this.quality === "low" ? 0 : TRUCK_LIMIT);
    const mesh = this.vehicleShadows = new THREE.InstancedMesh(geo, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 3; // blend over road puddles without writing to the depth buffer
    this.vehicleShadowPose = new THREE.Matrix4();
    this.scene.add(mesh);
  }

  putVehicleShadow(pose, length, width) {
    const mesh = this.vehicleShadows;
    if (mesh.count >= mesh.instanceMatrix.count) return;
    const matrix = this.vehicleShadowPose.copy(pose), m = matrix.elements;
    // Use the vehicle's heading and position, but keep the shadow flat on the road.
    m[0] *= length; m[2] *= length;
    m[8] *= width; m[10] *= width;
    m[12] -= this.sun.position.x * .0008;
    m[13] = .019;
    m[14] -= this.sun.position.z * .0008;
    mesh.setMatrixAt(mesh.count++, matrix);
  }

  /** Trucks carry goods along the roads from each farm to its factory, and come back empty. */
  syncTrucks(s) {
    if (this.quality === "low") return;
    if (!this.truckMesh) {
      this.truckMesh = new THREE.InstancedMesh(model("truckBody").matte, this.mats.matte, TRUCK_LIMIT);
      this.truckGlass = new THREE.InstancedMesh(model("truckBody").glass, this.mats.glass, TRUCK_LIMIT);
      this.cargoMesh = new THREE.InstancedMesh(model("truckCargo").matte, this.mats.matte, TRUCK_LIMIT);
      for (const m of [this.truckMesh, this.truckGlass, this.cargoMesh]) { m.count = 0; m.frustumCulled = false; this.scene.add(m); }
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
    for (const l of links.slice(0, TRUCK_LIMIT)) {
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
    const night = this.previewNight ?? this.nightTime;
    this.trucks.forEach((t, i) => {
      if (t.wait > 0) t.wait -= dt;
      else {
        const j = Math.round(t.k), nextTile = t.path[j+t.dir], tile = t.path[j];
        const round = this.isRoundabout(nextTile), advance = dt*0.9;
        const blocked = round && !this.isRoundabout(tile) && this.roundTraffic.has(nextTile);
        t.k += t.dir * (blocked ? Math.min(advance, Math.max(0,.34-(t.k-j)*t.dir)) : advance);
        if (round && Math.round(t.k) !== j) this.roundTraffic.add(nextTile);
        const end = t.path.length - 1;
        if (t.k >= end) { t.k = end; t.dir = -1; t.wait = 1.5; }
        if (t.k <= 0) { t.k = 0; t.dir = 1; t.wait = 1.5; }
      }
      const j = Math.round(t.k), i0 = t.path[j];
      const previous = t.path[j-t.dir] ?? t.path[j+t.dir], next = t.path[j+t.dir] ?? previous;
      const x = i0 % N, y = Math.floor(i0 / N);
      const lane = tileLane(x-previous%N,y-Math.floor(previous/N),next%N-x,Math.floor(next/N)-y,
        this.state.tiles[i0]?.b?.id === "roundabout");
      const pose = lanePosition(lane, 0.5+(t.k-j)*t.dir, this.truckLanePose ||= {});
      v.set(x-HALF+0.5+pose.x,0,y-HALF+0.5+pose.z);
      q.setFromAxisAngle(up,Math.atan2(-pose.dz,pose.dx));
      sc.setScalar(night ? 0.0001 : 1); // trucks rest at night
      m4.compose(v, q, sc);
      this.truckMesh.setMatrixAt(i, m4);
      this.truckGlass?.setMatrixAt(i, m4);
      if (!night) this.putVehicleShadow(m4, .51, .24);
      // loaded on the way to the factory, empty on the way back
      if (t.dir < 0 || night) m4.compose(hide, q, new THREE.Vector3(0.0001, 0.0001, 0.0001));
      this.cargoMesh.setMatrixAt(i, m4);
      this.cargoMesh.setColorAt(i, t.cargo);
    });
    for (const m of [this.truckMesh, this.truckGlass, this.cargoMesh].filter(Boolean)) m.instanceMatrix.needsUpdate = true;
    if (this.cargoMesh.instanceColor) this.cargoMesh.instanceColor.needsUpdate = true;
  }

  routeCar(car) {
    const choices = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = car.x + dx, y = car.y + dy;
      if (inMap(x, y) && roadAt(this.state.tiles[idx(x, y)]) && (x !== car.px || y !== car.py)) choices.push([x, y]);
    }
    [car.tx, car.ty] = choices[Math.floor(Math.random() * choices.length)] || [car.px, car.py];
  }

  isRoundabout(i) { return this.state.tiles[i]?.b?.id === "roundabout"; }

  carLane(car, round) { return tileLane(car.x-car.px,car.y-car.py,car.tx-car.x,car.ty-car.y,round); }

  syncCars() {
    const limit = CAR_LIMIT[this.quality] || CAR_LIMIT.medium;
    const want = Math.min(limit, Math.floor((this.roads.length / 4) * (this.rush ? 1.45 : 1)));
    if (!this.carFleet) {
      const batch = (geometry, material, capacity) => {
        const mesh = new THREE.InstancedMesh(geometry, material, capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        mesh.frustumCulled = false;
        this.scene.add(mesh);
        return mesh;
      };
      this.carFleet = ["pickup", "suv", "sedan"].map((key) => {
        const paint = batch(model(`${key}Body`).matte, this.mats.carPaint, limit);
        const trim = model(`${key}Trim`);
        return [paint, ...SETS.filter((set) => trim[set]).map((set) => batch(trim[set], this.mats[set], limit))];
      });
      this.carWheels = batch(model("carWheel").matte, this.mats.matte, limit * 4);
      this.initVehicleShadows();
      this.carPose = { matrix: new THREE.Matrix4(), child: new THREE.Matrix4(), wheel: new THREE.Matrix4(), q: new THREE.Quaternion(), up: new THREE.Vector3(0, 1, 0), point: new THREE.Vector3(), scale: new THREE.Vector3(1, 1, 1) };
      this.carColors = ["#e5e4d9", "#275e61", "#a84a3f", "#d5b16c", "#879397", "#334052", "#f4e4cb"].map((color) => new THREE.Color(color));
    }
    const isRoad = (x, y) => inMap(x, y) && roadAt(this.state.tiles[idx(x, y)]);
    this.cars = this.cars.filter((c) => isRoad(c.x, c.y) && isRoad(c.tx, c.ty) && isRoad(c.px, c.py));
    while (this.cars.length < want && this.roads.length) {
      const [x, y] = this.roads[Math.floor(Math.random() * this.roads.length)];
      const i = this.cars.length;
      const car = { x, y, px: x, py: y, t: Math.random(), speed: 0.55 + Math.random() * 0.47, kind: i % 3, color: i % this.carColors.length, spin: 0 };
      this.routeCar(car);
      const oppositeX = 2 * x - car.tx, oppositeY = 2 * y - car.ty;
      [car.px, car.py] = isRoad(oppositeX, oppositeY) ? [oppositeX, oppositeY] : [car.tx, car.ty];
      this.cars.push(car);
    }
    this.cars.length = Math.min(this.cars.length, want);
  }

  stepCars(dt) {
    if (!this.carFleet) return;
    const { matrix, child, wheel, q, up, point, scale } = this.carPose;
    const counts = [0, 0, 0], shown = (this.previewNight ?? this.nightTime) ? Math.ceil(this.cars.length / 3) : this.cars.length;
    this.roundTraffic ||= new Set();
    const occupied = this.roundTraffic;
    occupied.clear();
    for (let i = 0; i < shown; i++) {
      const car = this.cars[i], tile = idx(car.x,car.y);
      if (this.isRoundabout(tile)) occupied.add(tile);
    }
    if (!(this.previewNight ?? this.nightTime)) for (const truck of this.trucks || []) {
      const tile = truck.path[Math.round(truck.k)];
      if (this.isRoundabout(tile)) occupied.add(tile);
    }
    const wet = this.waterWeather.wet.value;
    if (wet > 0.32 && !this.tyreMist && this.quality !== "low") {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(32 * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage));
      this.tyreMist = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.023, color: "#bdc9c9", depthWrite: false, transparent: true, opacity: 0 }));
      this.tyreMist.frustumCulled = false;
      this.scene.add(this.tyreMist);
    }
    const spray = this.tyreMist?.geometry.attributes.position;
    let sprayCount = 0;
    let wheels = 0;
    for (let i = 0; i < shown; i++) {
      const car = this.cars[i];
      const jam = this.trafficCong?.[idx(car.x, car.y)] || 0;
      const tileIndex = idx(car.x,car.y);
      const round = this.isRoundabout(tileIndex), nextTile = idx(car.tx,car.ty);
      let lane = this.carLane(car,round);
      let travel = dt * car.speed / (1 + jam * 2.5 + (round ? 0.4 : 0));
      if (!round && this.isRoundabout(nextTile) && occupied.has(nextTile)) {
        travel = Math.min(travel,Math.max(0,(.835-car.t)*lane.length));
      }
      car.t += travel / Math.max(0.45,lane.length);
      if (car.t >= 1) {
        car.t -= 1;
        car.px = car.x; car.py = car.y;
        car.x = car.tx; car.y = car.ty;
        this.routeCar(car);
        lane = this.carLane(car,this.isRoundabout(nextTile));
        if (this.isRoundabout(nextTile)) occupied.add(nextTile);
      }
      const pose = lanePosition(lane,car.t,this.carLanePose ||= {});
      point.set(car.x-HALF+0.5+pose.x,0.012,car.y-HALF+0.5+pose.z);
      const tx = pose.dx, tz = pose.dz;
      q.setFromAxisAngle(up, Math.atan2(-tz, tx));
      matrix.compose(point, q, scale);
      this.putVehicleShadow(matrix, car.kind === 0 ? .35 : .33, .206);
      const fleet = this.carFleet[car.kind], slot = counts[car.kind]++;
      fleet[0].setColorAt(slot, this.carColors[car.color]);
      for (const mesh of fleet) mesh.setMatrixAt(slot, matrix);
      car.spin = (car.spin - travel * 39) % (Math.PI * 2);
      for (const x of [-0.081, 0.085]) for (const z of [-0.059, 0.059]) {
        child.makeRotationZ(car.spin).setPosition(x, 0.024, z);
        wheel.multiplyMatrices(matrix, child);
        this.carWheels.setMatrixAt(wheels++, wheel);
      }
      if (spray && wet > 0.32 && Math.abs(point.x - this.view.x) + Math.abs(point.z - this.view.z) < 12) {
        const d = Math.hypot(tx,tz) || 1, ux = tx / d, uz = tz / d;
        for (let k = 0; k < 4; k++) {
          const age = (this.clock * 7.5 + (i * 7 + k * 13) * 0.073) % 1;
          const side = (k % 2 ? -1 : 1) * (0.06 + age * 0.043), trail = 0.078 + age * 0.19;
          spray.setXYZ(sprayCount++, point.x - ux * trail - uz * side,
            0.015 + Math.sin(age * Math.PI) * 0.043, point.z - uz * trail + ux * side);
        }
      }
    }
    for (let i = 0; i < this.carFleet.length; i++) for (const mesh of this.carFleet[i]) {
      mesh.count = counts[i];
      mesh.instanceMatrix.needsUpdate = !!counts[i];
      if (mesh.instanceColor && counts[i]) mesh.instanceColor.needsUpdate = true;
    }
    this.carWheels.count = wheels;
    if (wheels) this.carWheels.instanceMatrix.needsUpdate = true;
    if (spray) {
      this.tyreMist.visible = sprayCount > 0;
      this.tyreMist.geometry.setDrawRange(0, sprayCount);
      this.tyreMist.material.opacity = 0.54 * wet;
      if (sprayCount) spray.needsUpdate = true;
    }
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
    const { rain, wet } = this.waterWeather;
    if (rain.value > 0.014 && !this.rain) {
      this.rain = rainField(this.waterWeather, this.quality === "high" ? 850 : this.quality === "medium" ? 480 : 235);
      this.rain.renderOrder = 4;
      this.scene.add(this.rain);
    }
    if (this.rain) {
      this.rain.visible = rain.value > 0.014;
      this.rain.position.set(this.view.x,0,this.view.z);
      this.rain.material.uniforms.fieldSize.value = Math.max(15,Math.min(37, 13 * this.aspect / this.view.zoom));
    }
    if (wet.value > 0.1 && (!this.rainPools || this.rainPoolsDirty) && this.state) {
      this.syncRainPools(this.state);
    }
    if (this.rainPools) this.rainPools.visible = wet.value > 0.1;
    if (this.flood && this.previewStorm != null) this.flood.visible = rain.value > 0.3;

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
      if (!inst || w.i < 0) continue;
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
      this.peopleMesh = { body: mk("citizenThobe"), red: mk("manHeadRed"), white: mk("manHeadWhite"), woman: mk("woman") };
      this.camels = [];
      const cg = model("camel").matte;
      this.camelMesh = new THREE.InstancedMesh(cg, this.mats.matte, 16);
      this.camelMesh.count = 0; this.camelMesh.frustumCulled = false; this.camelMesh.castShadow = this.quality !== "low";
      this.scene.add(this.camelMesh);
      this.camelLegs = new THREE.InstancedMesh(model("camelLeg").matte, this.mats.matte, 64);
      this.sandals = new THREE.InstancedMesh(model("walkingSandal").matte, this.mats.matte, 144);
      this.sleeves = new THREE.InstancedMesh(model("citizenSleeve").matte, this.mats.matte, 144);
      this.canopies = new THREE.InstancedMesh(model("rainUmbrella").matte, this.mats.matte, 30);
      for (const mesh of [this.camelLegs, this.sandals, this.sleeves, this.canopies]) {
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.scene.add(mesh);
      }
    }
    // People: more as the town grows, only where there are roads.
    const want = this.quality === "low" || !this.roads.length ? 0 : Math.min(this.quality === "high" ? 72 : 48, Math.round(4 + s.pop / 6));
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
    const counts = { body: 0, red: 0, white: 0, woman: 0 }, night = (this.previewNight ?? (!!this.nightTime || !!this.siesta)) && !this.festive;
    const M = this.peopleMesh, col = new THREE.Color();
    const part = new THREE.Matrix4(), pose = new THREE.Matrix4();
    let shoes = 0, legs = 0, hands = 0, umbrellas = 0;
    const coat = new THREE.Color(), storm = this.waterWeather.rain.value > .52;
    const winter = seasonOf(this.state.day).id === "winter";
    const canopyColors = this.canopyColors ||= ["#344c55","#a0654f","#716249","#4e7565"].map((c) => new THREE.Color(c));
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
      const stride = Math.sin(this.clock * (7 + p.speed * 14) + p.shade * 35);
      v.y = Math.abs(stride) * 0.011 + 0.008;
      const bearing = Math.atan2(-dz,dx);
      p.yaw ??= bearing;
      p.yaw += Math.atan2(Math.sin(bearing - p.yaw),Math.cos(bearing - p.yaw)) * Math.min(1,dt*6);
      q.setFromAxisAngle(up,p.yaw + stride*.044);
      const umbrella = storm && p.shade < .67 && umbrellas < 30;
      const s2 = p.kind === "kid" ? 0.72 : 0.95 + p.shade * 0.12;
      sc.set(s2, s2, s2);
      m4.compose(v, q, sc);
      for (const side of [-1, 1]) {
        part.makeTranslation(stride * side * 0.027, Math.max(0, stride * side) * 0.012 - 0.007, side * 0.014);
        pose.multiplyMatrices(m4, part);
        this.sandals.setMatrixAt(shoes++, pose);
      }
      coat.set(p.kind === "woman" ? "#39323c" : thobes[Math.floor(p.shade * thobes.length)]);
      for (const side of [-1, 1]) {
        const swing = umbrella && side > 0 ? .92 : stride * side * .33;
        part.makeRotationZ(swing).setPosition(.001,.124,side*.035);
        pose.multiplyMatrices(m4,part);
        this.sleeves.setMatrixAt(hands,pose);
        this.sleeves.setColorAt(hands++,coat);
      }
      if (umbrella) {
        part.makeRotationX(.105 + stride*.045).setPosition(.025,.198,.019);
        pose.multiplyMatrices(m4,part);
        this.canopies.setMatrixAt(umbrellas,pose);
        this.canopies.setColorAt(umbrellas++,canopyColors[Math.floor(p.shade*21)%canopyColors.length]);
      }
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
    this.sleeves.count = hands; this.canopies.count = umbrellas;
    for (const mesh of [this.sleeves,this.canopies]) if (mesh.count) {
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    }
    this.sandals.count = shoes;
    if (shoes) this.sandals.instanceMatrix.needsUpdate = true;

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
        for (const x of [-0.089, 0.089]) for (const z of [-0.047, 0.047]) {
          const swing = walking ? Math.sin(this.clock * 5 + i + (z < 0 ? Math.PI : 0) + (x < 0 ? 0.63 : 0)) * 0.25 : 0;
          part.makeRotationZ(swing).setPosition(x, 0.204, z);
          pose.multiplyMatrices(m4, part);
          this.camelLegs.setMatrixAt(legs++, pose);
        }
      });
      this.camelMesh.instanceMatrix.needsUpdate = true;
    }
    this.camelLegs.count = legs;
    if (legs) this.camelLegs.instanceMatrix.needsUpdate = true;
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
    this.stepFountains();
    this.stepSiteMotion();
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
        if (w.i < 0) { if (t >= 1) this.anims.delete(tile); continue; } // off screen: nothing to animate
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

  /** Shared, shadow-free batches for the moving parts of the amusement park and farm. */
  stepSiteMotion() {
    const sites = this.siteMotion;
    if (!sites) return;
    const cap = this.quality === "low" ? 16 : 24;
    const { x, y, z, radius, cabins } = FAIR_WHEEL;
    if (!this.siteParts) {
      if (!sites.pivot_b.length && !sites.themepark_b.length) return;
      const makeBatch = (key, capacity) => Object.entries(model(key)).flatMap(([set, geo]) => {
        if (!geo) return [];
        const mesh = new THREE.InstancedMesh(geo, this.mats[set], capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.count = 0;
        this.scene.add(mesh);
        return [mesh];
      });
      this.siteParts = {
        arm: makeBatch("irrigationArm", cap),
        wheel: makeBatch("fairWheel", 1),
        cabin: makeBatch("fairCabin", cabins)
      };
      this.siteLocal = new THREE.Matrix4();
      this.sitePose = new THREE.Matrix4();
    }
    const { arm, wheel, cabin } = this.siteParts;
    const local = this.siteLocal, pose = this.sitePose;
    const range = 5 / this.view.zoom * Math.max(1, this.aspect) + 2;
    const inView = (s) => Math.abs(s.x - this.view.x) <= range && Math.abs(s.z - this.view.z) <= range;
    let arms = 0, wheels = 0, seats = 0;
    for (const s of sites.pivot_b) {
      if (!inView(s)) continue;
      pose.multiplyMatrices(s.pose, local.makeRotationY(this.clock * .19 + s.phase));
      for (const mesh of arm) mesh.setMatrixAt(arms, pose);
      if (++arms === cap) break;
    }
    const park = sites.themepark_b.find(inView);
    if (park) {
      const turn = this.clock * .32 + park.phase;
      pose.multiplyMatrices(park.pose, local.makeRotationZ(turn).setPosition(x, y, z));
      for (const mesh of wheel) mesh.setMatrixAt(wheels, pose);
      wheels++;
      for (let i = 0; i < cabins; i++) {
        const a = turn + i * Math.PI * 2 / cabins;
        pose.multiplyMatrices(park.pose, local.makeTranslation(x + Math.cos(a) * radius, y + Math.sin(a) * radius, z));
        for (const mesh of cabin) mesh.setMatrixAt(seats, pose);
        seats++;
      }
    }
    for (const [parts, count] of [[arm, arms], [wheel, wheels], [cabin, seats]]) for (const mesh of parts) {
      mesh.count = count;
      if (count) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  stepFountains() {
    if (this.quality === "low" || !this.fountains?.length) {
      if (this.waterDrops) this.waterDrops.count = 0;
      return;
    }
    const cap = this.quality === "high" ? 12 : 6, perJet = 12;
    if (!this.waterDrops) {
      this.waterDrops = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.015, 0),
        new THREE.MeshBasicMaterial({ color: "#b8e6da" }), cap * perJet);
      this.waterDrops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.waterDrops.frustumCulled = false;
      this.scene.add(this.waterDrops);
      this.dropMatrix = new THREE.Matrix4();
    }
    let count = 0;
    const range = 7 / this.view.zoom + 3;
    for (const { x, z, height, ring } of this.fountains) {
      if (Math.abs(x - this.view.x) + Math.abs(z - this.view.z) > range * 1.8) continue;
      for (let i = 0; i < perJet; i++) {
        const sideJet = ring && i >= 4;
        const t = (this.clock * 1.25 + i / perJet) % 1;
        const angle = sideJet ? (i - 4) * Math.PI / 4 : i * 2.39996;
        const radius = sideJet ? .289 - t * .155 : t * (height > .1 ? .23 : .08);
        const y = sideJet ? .108 + t * (1 - t) * (.7 + Math.sin(this.clock * 3 + i) * .25)
          : Math.max(.075, height + t * (.66 - t * .91));
        this.dropMatrix.makeTranslation(x + Math.cos(angle) * radius, y, z + Math.sin(angle) * radius);
        this.waterDrops.setMatrixAt(count++, this.dropMatrix);
      }
      if (count >= cap * perJet) break;
    }
    this.waterDrops.count = count;
    if (count) this.waterDrops.instanceMatrix.needsUpdate = true;
  }

  // ---------- day and night ----------

  /** t in 0..1 over a full day (0 = midnight, 0.5 = noon). */
  setTimeOfDay(t) {
    const sunAngle = (t - 0.25) * Math.PI * 2; // sunrise at 0.25
    const elev = Math.sin(sunAngle);
    const day = Math.max(0, Math.min(1, elev * 3 + 0.25));
    const golden = Math.max(0, 1 - Math.abs(elev) * 4) * (elev > -0.1 ? 1 : 0);
    this.night = 1 - day;
    this.waterWeather.day.value = day;
    this.sun.position.set(Math.cos(sunAngle) * 0.86, Math.max(0.22, elev * 0.8 + 0.23), 0.61).normalize().multiplyScalar(40);
    this.sun.intensity = 0.35 + day * 1.88;
    this.sun.color.set(day < 0.3 ? "#92b5ee" : golden > 0.2 ? "#ffc17c" : "#fff2db");
    this.hemi.intensity = 0.48 + day * 0.42;
    const sky = (this.skyColor ||= new THREE.Color()).set("#1b2c43").lerp(this.daySky ||= new THREE.Color("#ecd2ad"), day);
    if (golden > 0.2) sky.lerp(new THREE.Color("#f3b77a"), golden * 0.5);
    const storm = this.waterWeather.rain.value;
    if (storm > 0.01) {
      sky.lerp(this.stormSky ||= new THREE.Color("#798c9b"), 0.65 * storm);
      this.sun.intensity *= 1 - 0.73 * storm;
      this.hemi.intensity *= 1 - 0.21 * storm;
      this.sun.color.lerp(this.stormLight ||= new THREE.Color("#d1e2ef"),storm);
    }
    // a dust storm: the sky goes ochre and the light dims
    if (this.dusty) { sky.lerp(new THREE.Color("#c9a46a"), 0.55); this.sun.intensity *= 0.6; this.sun.color.lerp(new THREE.Color("#e0b070"), 0.6); }
    this.scene.background = sky;
    this.scene.fog.color.copy(sky);
    this.hemi.color.set(day > 0.5 ? (golden > 0.2 ? "#f2d9bd" : "#d6e4f2") : "#8fa0d8");
    this.mats.lights.opacity = Math.min(1, this.night * 1.4);
    if (this.envNight !== Math.round(this.night * 20)) { this.envNight = Math.round(this.night * 20); for (const [k, v] of Object.entries(this.envLevel)) this.mats[k].envMapIntensity = v * (1 - this.night * 0.8); }
    if (this.glowMesh) this.glowMesh.material.opacity = Math.max(0, this.night * 0.95 - 0.15);
    // lamps and headlights shine at night; by day they are plain colours, and only fire and flashes bloom
    // (by day the sun on water and car paint was blooming into white halos)
    this.mats.glow.color.setScalar(1.2 + 5.8 * this.night);
    if (this.bloom) this.bloom.threshold = this.fx?.tasks?.length ? 3.2 : 3.2 + 3.3 * (1 - this.night); // a war scene keeps its flashes
  }

  // ---------- camera ----------

  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    let dpr = Math.min(this.ultra ? 2.5 : this.quality === "high" ? 2 : this.quality === "medium" ? 1.5 : 1.25, devicePixelRatio || 1);
    // the adaptive steps (see setLevel): a little less sharp first, never below 1
    if (this.perfLevel >= 3) dpr = Math.max(1, dpr * 0.7); else if (this.perfLevel >= 1) dpr = Math.max(1, dpr * 0.85);
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.dpr = dpr;
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
  setOverlay(values, color, opacity = 0.3, lift = 0.015) { // lift: above the roads, for the road tools
    if (this.overlay) { this.scene.remove(this.overlay); this.overlay.dispose(); this.overlay = null; }
    if (!values) return;
    const cells = [];
    for (let i = 0; i < N * N; i++) if (values[i] > 0) cells.push(i);
    const g = new THREE.PlaneGeometry(0.96, 0.96); g.rotateX(-Math.PI / 2);
    const heat = color === "heat";
    this.overlay = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: heat ? "#ffffff" : color, transparent: true, opacity: heat ? 0.55 : opacity, depthWrite: false }), Math.max(1, cells.length));
    const m = new THREE.Matrix4(), hc = new THREE.Color();
    cells.forEach((i, k) => {
      const p = tileCenter(i % N, Math.floor(i / N)); m.makeTranslation(p.x, lift, p.z); this.overlay.setMatrixAt(k, m);
      if (heat) { const v = Math.min(1, values[i]); hc.setHSL(0.33 * (1 - v), 0.85, 0.5); this.overlay.setColorAt(k, hc); }
    });
    this.overlay.count = cells.length;
    this.overlay.renderOrder = 1;
    this.scene.add(this.overlay);
  }

  // ---------- frame ----------

  /**
   * The adaptive quality's steps (js/main.js decides when), up or down, for this visit only:
   * 0 as chosen in the settings; 1 a slightly lower resolution; 2 no shadows; 3 a lower resolution still.
   * The buildings and the screen's text are never touched: the costly extras go first.
   */
  setLevel(level) {
    level = Math.max(0, Math.min(3, level));
    if (level === this.perfLevel) return;
    this.perfLevel = level;
    const shadows = this.quality !== "low" && level < 2;
    if (shadows !== this.renderer.shadowMap.enabled) {
      this.renderer.shadowMap.enabled = shadows; this.sun.castShadow = shadows; this.shadowDirty = true;
      this.scene.traverse((o) => { for (const m of [].concat(o.material || [])) m.needsUpdate = true; });
    }
    this.resize();
  }
  degrade(level) { this.setLevel(level); }

  /**
   * Draw only the buildings the camera can see, with a margin, and the far models when zoomed out.
   * The town used to draw every building of the map every frame, even the ones off screen, at full detail.
   * Each building's slot in its instanced mesh changes here, so the anims and the flood look it up in where.
   */
  cull(force = false) {
    if (!this.groups) return;
    const v = this.view;
    // zoomed out past this, the far models (fewer faces); a gap between the two edges so it doesn't flicker
    const far = this.lodOff ? false : this.lodFar ? v.zoom < 0.8 : v.zoom < 0.7;
    const farChanged = far !== this.lodFar;
    this.lodFar = far;
    const key = `${v.x.toFixed(1)}|${v.z.toFixed(1)}|${v.zoom.toFixed(2)}|${v.yaw.toFixed(2)}|${this.w}|${this.h}`;
    if (!force && !farChanged && key === this.cullKey) return;
    this.cullKey = key;
    // the ground the camera sees (at the ground and at a tall tower's top), as a box, plus a margin for shadows and pans
    const cam = this.camera, dir = new THREE.Vector3(), pt = new THREE.Vector3();
    cam.getWorldDirection(dir);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [nx, ny] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) for (const h of [0, 3]) {
      pt.set(nx, ny, -1).unproject(cam);
      const t = (h - pt.y) / dir.y;
      const gx = pt.x + dir.x * t, gz = pt.z + dir.z * t;
      x0 = Math.min(x0, gx); x1 = Math.max(x1, gx); z0 = Math.min(z0, gz); z1 = Math.max(z1, gz);
    }
    const M = this.cullMargin ?? 2;
    x0 -= M; x1 += M; z0 -= M; z1 += M;
    const tc = new THREE.Color(), pos = new THREE.Vector3();
    let drawn = 0;
    for (const [k, g] of this.groups) {
      const inst = this.instances.get(k);
      if (!inst) continue;
      if (inst.far !== far) { // the far or the near model for this key
        const geo = (far ? modelFar(inst.key, inst.ground) : model(inst.key, inst.ground)) || {};
        for (const set of SETS) if (inst[set]) {
          if (geo[set]) { inst[set].geometry = geo[set]; inst[set].visible = true; } else inst[set].visible = false;
          inst[set].castShadow = !far && set !== "lights" && this.quality !== "low"; // a whole town seen from afar: its shadows are specks, and drawing them again doubles the cost
        }
        inst.far = far;
      }
      let n = 0;
      for (let i = 0; i < g.list.length; i++) {
        const m = g.list[i], tile = g.tiles[i];
        pos.setFromMatrixPosition(m);
        const w = tile >= 0 ? this.where?.get(tile) : null;
        if (pos.x < x0 || pos.x > x1 || pos.z < z0 || pos.z > z1) { if (w && w.k === k) w.i = -1; continue; }
        for (const set of SETS) {
          const mesh = inst[set];
          if (!mesh) continue;
          mesh.setMatrixAt(n, m);
          if (inst.tinted && set !== "lights" && set !== "glow") { const t = g.tints[i]; mesh.setColorAt(n, tc.setRGB(t, t * 0.96, t * 0.92)); }
        }
        if (w && w.k === k) w.i = n;
        n++;
      }
      for (const set of SETS) {
        const mesh = inst[set];
        if (!mesh) continue;
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor && inst.tinted) mesh.instanceColor.needsUpdate = true;
      }
      drawn += n;
    }
    this.drawnBuildings = drawn;
    this.shadowDirty = true;
  }

  frame(dt, todT) {
    this.clock += dt;
    this.breeze.value = this.clock;
    const weather = this.waterWeather, rain = this.previewStorm ?? Number(!!this.raining);
    weather.time.value = this.clock;
    weather.rain.value += (rain - weather.rain.value) * (1 - Math.exp(-dt * 1.9));
    const wet = this.previewWet ?? rain;
    weather.wet.value += (wet - weather.wet.value) * (1 - Math.exp(-dt * (wet > weather.wet.value ? 0.29 : 0.043)));
    this.breezeStrength.value = this.quality === "low" ? 0 : 0.026 + weather.rain.value * 0.036;
    const v = this.view;
    if (this.groups && this.clock - (this.cullAt || 0) > 0.12) { this.cullAt = this.clock; this.cull(); } // what the camera sees, a few times a second
    if (Math.abs(v.yaw - v.yawTarget) > 1e-3) { v.yaw += (v.yawTarget - v.yaw) * Math.min(1, dt * 8); this.updateCamera(); }
    this.setTimeOfDay(this.dayCycle ? todT : 0.42);
    const shadows = this.vehicleShadows;
    if (shadows) shadows.count = 0;
    this.stepCars(dt);
    this.stepTrucks(dt);
    if (shadows?.count) {
      shadows.material.opacity = .52 - this.night * .31;
      shadows.instanceMatrix.needsUpdate = true;
    }
    this.stepFollow(dt);
    this.stepSmoke(dt);
    this.stepLife(dt);
    this.stepEffects(dt);
    this.stepWeather(dt);
    this.stepFlood(dt);
    this.fx?.step(dt);
    this.sun.target.position.set(v.x, 0, v.z);
    this.sun.position.add(this.sun.target.position);
    if (this.renderer.shadowMap.enabled && (this.shadowDirty || this.clock >= (this.nextShadow || 0))) {
      const r = Math.max(13, 9 / v.zoom * Math.max(1.6, this.aspect * 0.85));
      const camera = this.sun.shadow.camera;
      if (camera.right !== r) { Object.assign(camera, { left: -r, right: r, top: r, bottom: -r }); camera.updateProjectionMatrix(); }
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowDirty = false;
      this.nextShadow = this.clock + (this.quality === "high" ? 0.12 : 0.22);
    }
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
    ...buildingMaterials("medium"),
    matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), shiny: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.3 }),
    paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15 }), metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, metalness: 0.5 }), glow: new THREE.MeshBasicMaterial({ vertexColors: true }), ...buildingMaterials("medium")
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
