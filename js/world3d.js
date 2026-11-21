// The town in 3D: ground, roads, buildings (instanced), light and shadow, day and night, cars and smoke.
import * as THREE from "three";
import { MAP_SIZE as N, B } from "./data.js";
import { idx, inMap } from "./sim.js";
import { model, modelKey } from "./models.js";

const HALF = N / 2;
export const tileCenter = (x, y) => new THREE.Vector3(x - HALF + 0.5, 0, y - HALF + 0.5);
const roadAt = (t) => t?.b && (t.b.id === "road" || t.b.id === "asphalt");

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
    const desert = new THREE.Mesh(outer, new THREE.MeshStandardMaterial({ color: "#e6c98f", roughness: 1 }));
    desert.receiveShadow = true;
    this.scene.add(desert);
    this.ground = null;
  }

  /** The town's own tiles: sand, wadi, with a little colour noise. Rebuilt when the land changes. */
  syncTiles(s) {
    if (this.ground) { this.scene.remove(this.ground); this.ground.geometry.dispose(); }
    const pos = [], col = [], c = new THREE.Color();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const t = s.tiles[idx(x, y)];
      const n = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      c.set(t.t === "wadi" ? "#c8b277" : "#ecd3a0");
      c.offsetHSL(0, 0, ((n % 7) - 3) * 0.008);
      const x0 = x - HALF, z0 = y - HALF;
      const quad = [[x0, z0], [x0 + 1, z0], [x0 + 1, z0 + 1], [x0, z0], [x0 + 1, z0 + 1], [x0, z0 + 1]];
      for (const [qx, qz] of quad) { pos.push(qx, 0, qz); col.push(c.r, c.g, c.b); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    this.ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    // Wadi scrub: little green tufts on fertile ground.
    if (!this.scrub) {
      const tuft = new THREE.IcosahedronGeometry(0.06, 0);
      const pts = [];
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (s.tiles[idx(x, y)].t === "wadi") for (let k = 0; k < 2; k++) {
        const n = ((x * 92821 + y * 68917 + k * 31) % 1000) / 1000;
        pts.push([x - HALF + 0.2 + n * 0.6, y - HALF + 0.2 + ((n * 7) % 1) * 0.6]);
      }
      this.scrub = new THREE.InstancedMesh(tuft, new THREE.MeshStandardMaterial({ color: "#7d9a4a", roughness: 1 }), pts.length);
      const m = new THREE.Matrix4();
      pts.forEach(([x, z], i) => { m.makeScale(1, 0.6, 1); m.setPosition(x, 0.02, z); this.scrub.setMatrixAt(i, m); });
      this.scene.add(this.scrub);
    }
  }

  // ---------- roads ----------

  syncRoads(s) {
    if (this.roadMesh) { this.scene.remove(this.roadMesh); this.roadMesh.geometry.dispose(); }
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
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const t = s.tiles[idx(x, y)];
      const p = tileCenter(x, y);
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
      push(modelKey(t.b.id, t.b.lvl), t.t, m4.clone());
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
  }

  sync(s, what = { tiles: true, roads: true, buildings: true }) {
    if (what.tiles) this.syncTiles(s);
    if (what.roads) this.syncRoads(s);
    if (what.buildings) this.syncBuildings(s);
    this.roads = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (roadAt(s.tiles[idx(x, y)])) this.roads.push([x, y]);
    this.state = s;
    this.syncCars();
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
    this.sun.intensity = 0.25 + day * 2.1;
    this.sun.color.set(golden > 0.2 ? "#ffcf8a" : "#fff1d6");
    this.hemi.intensity = 0.35 + day * 0.6;
    const sky = new THREE.Color("#1b2645").lerp(new THREE.Color("#f6e2b8"), day);
    if (golden > 0.2) sky.lerp(new THREE.Color("#f3b77a"), golden * 0.5);
    this.scene.background = sky;
    this.scene.fog.color.copy(sky);
    this.hemi.color.set(day > 0.5 ? "#fff4dd" : "#8fa0d8");
    this.mats.lights.opacity = Math.min(1, this.night * 1.4);
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
