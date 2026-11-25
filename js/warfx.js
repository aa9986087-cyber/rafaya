// «صراع الجوف» on screen: the moving parts of military buildings (radar dishes, air defence launchers,
// missile erectors, drones on their pads), war damage that stays (scorch, smoke, fire, a darker
// building, the repair sign), and the scenes of an operation: getting ready, the launch, the
// approach, the air defence trying to stop it, the air burst or the hit. Scenes only SHOW a result
// the server already decided; nothing here changes the town.
import * as THREE from "three";
import { MAP_SIZE } from "./data.js";
import { idx } from "./sim.js";
import { model, SETS, MIL_LAYOUT, WIND_TOWERS } from "./models.js";
import { iconImage } from "./icons.js";
import { tileCenter, warSquash, warTilt } from "./world3d.js";

const FX_N = MAP_SIZE;
const fxEase = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const fxEaseIn = (k) => k * k * k;
const fxLerp = (a, b, k) => a + (b - a) * k;

/** Soft round sprite textures, drawn once. */
const FX_TEX = {};
function fxTexture(kind) {
  if (FX_TEX[kind]) return FX_TEX[kind];
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  if (kind === "ring") {
    g.strokeStyle = "#fff"; g.lineWidth = 9; g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 6; for (const a of [0, 1, 2, 3]) { const r = a * Math.PI / 2; g.beginPath(); g.moveTo(64 + Math.cos(r) * 30, 64 + Math.sin(r) * 30); g.lineTo(64 + Math.cos(r) * 62, 64 + Math.sin(r) * 62); g.stroke(); }
  } else if (kind === "scorch") {
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, "rgba(20,16,12,0.85)"); gr.addColorStop(0.55, "rgba(35,28,20,0.5)"); gr.addColorStop(1, "rgba(40,30,20,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 14; i++) { g.fillStyle = "rgba(15,12,10,0.35)"; g.beginPath(); g.arc(64 + (Math.random() - 0.5) * 80, 64 + (Math.random() - 0.5) * 80, 4 + Math.random() * 9, 0, Math.PI * 2); g.fill(); }
  } else if (kind === "smoke" || kind === "fire") {
    // a soft puff with a cloudy edge: a few layers of value noise, cut by a round falloff
    const img = g.createImageData(128, 128), d = img.data;
    const rnd = (x, y, s) => { const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return n - Math.floor(n); };
    const noise = (x, y, s) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      return fxLerp(fxLerp(rnd(xi, yi, s), rnd(xi + 1, yi, s), u), fxLerp(rnd(xi, yi + 1, s), rnd(xi + 1, yi + 1, s), u), v); };
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      let f = 0, amp = 0.55, fr = 4 / 128;
      for (let o = 0; o < 4; o++) { f += noise(x * fr, y * fr, o) * amp; amp *= 0.5; fr *= 2; }
      const r = Math.hypot(x - 64, y - 64) / 64, fall = Math.max(0, 1 - r * r * (1.1 + (f - 0.5) * 0.9));
      const a = Math.max(0, Math.min(1, fall * (0.55 + f * 0.8)));
      const i = (y * 128 + x) * 4, shade = kind === "fire" ? 255 : Math.round(170 + f * 85);
      d[i] = shade; d[i + 1] = shade; d[i + 2] = shade; d[i + 3] = Math.round(a * 255);
    }
    g.putImageData(img, 0, 0);
  } else if (kind === "flare") {
    // the flash of a blast: a bright core and a few long rays
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.15, "rgba(255,255,255,0.9)"); gr.addColorStop(0.45, "rgba(255,255,255,0.25)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    g.globalCompositeOperation = "lighter";
    for (let k = 0; k < 6; k++) { g.save(); g.translate(64, 64); g.rotate(k * Math.PI / 6 + 0.3); const lg = g.createLinearGradient(-64, 0, 64, 0); lg.addColorStop(0, "rgba(255,255,255,0)"); lg.addColorStop(0.5, "rgba(255,255,255,0.55)"); lg.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = lg; g.fillRect(-64, -1.5, 128, 3); g.restore(); }
  } else if (kind === "shock") {
    const gr = g.createRadialGradient(64, 64, 40, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.7, "rgba(255,255,255,0.8)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  } else if (kind === "wrench" || kind === "warn") {
    // a round sign with the icon (Lucide), drawn once its picture has loaded
    g.fillStyle = kind === "wrench" ? "rgba(31,122,70,0.92)" : "rgba(214,120,20,0.95)"; g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "rgba(255,255,255,0.9)"; g.lineWidth = 5; g.stroke();
    const img = iconImage(kind === "wrench" ? "🔧" : "⚠️");
    img.onload = () => { g.drawImage(img, 22, 22, 84, 84); if (FX_TEX[kind]) FX_TEX[kind].needsUpdate = true; };
  } else {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,0.7)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (FX_TEX[kind] = t);
}

export class WarFX {
  constructor(world) {
    this.w = world;
    this.root = new THREE.Group(); world.scene.add(this.root);       // moving parts of buildings
    this.marks = new THREE.Group(); world.scene.add(this.marks);     // damage decals, target markers, repair signs
    this.flyers = new THREE.Group(); world.scene.add(this.flyers);   // what is in the air during a scene
    this.parts = new Map();   // tile index → { kind, group, pivot?, dish?, turret?, drones?, missiles? }
    this.burning = [];        // [{ p, wd, t }]
    this.parts3 = [];         // live sprite particles
    this.pool = [];
    this.tasks = [];          // running tweens
    this.skipping = false;
    this.droneStock = null;   // how many drones to park on the pads (null: by level)
    this.missileStock = null;
    this.alertT = 0;
    this.reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.maxParts = world.quality === "low" ? 50 : world.quality === "medium" ? 110 : 180;
    this.repairs = new Map(); // "x:y" → { start, end } (from the server)
    // one light for blasts and rocket flames (always in the scene, so nothing recompiles when it shines)
    this.light = new THREE.PointLight("#ffa04a", 0, 7, 1.6); this.light.position.set(0, -50, 0); world.scene.add(this.light);
    this.lightT = 0;
    // debris thrown by a hit, and the blast's ring on the ground
    this.debris = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.035, 0.04), new THREE.MeshStandardMaterial({ color: "#3b352e", roughness: 0.9 }), 60);
    this.debris.count = 0; this.debris.frustumCulled = false; this.debris.castShadow = world.quality !== "low"; world.scene.add(this.debris);
    this.chunks = [];
    this.rings = [];
    this.clockOffset = 0;     // server time − this device's time
  }

  /** A small model as meshes (matte, shiny, lights) in a group. */
  mesh(key) {
    const geo = model(key), g = new THREE.Group();
    if (!geo) return g;
    for (const set of SETS) {
      if (!geo[set]) continue;
      const m = new THREE.Mesh(geo[set], set === "lights" ? new THREE.MeshBasicMaterial({ vertexColors: true }) : this.w.mats[set]);
      m.castShadow = set !== "lights" && set !== "glow" && this.w.quality !== "low";
      g.add(m);
    }
    return g;
  }

  // ---------- the town: moving parts and damage ----------
  /** Called after the buildings are redrawn. */
  syncTown(s) {
    this.state = s;
    for (const p of this.parts.values()) this.root.remove(p.group);
    this.parts.clear();
    for (const m of this.marks.children) if (m.userData.rubble) { m.geometry.dispose(); m.material.dispose(); }
    this.marks.clear();
    this.burning = [];
    this.rubble = [];
    for (let y = 0; y < FX_N; y++) for (let x = 0; x < FX_N; x++) {
      const t = s.tiles[idx(x, y)], b = t.b;
      if (!b || b.build > 0) continue;
      const c = tileCenter(x, y);
      if (b.id === "windfarm") {
        // the turbines' blades turn (slower when damaged, still when wrecked)
        const g = new THREE.Group();
        g.position.copy(c);
        g.rotation.y = this.w.faceAngle(s, x, y) + (b.rot || 0) * Math.PI / 2;
        const part = { kind: "wind", group: g, x, y, wd: b.wd || 0, rotors: [] };
        for (const [wx, wz, sz] of WIND_TOWERS) {
          const r = this.mesh("windRotor");
          r.position.set(wx, 1.5 * sz + 0.03, wz + 0.08 * sz); r.scale.setScalar(sz); r.rotation.z = Math.random() * 6;
          g.add(r); part.rotors.push({ r, speed: 1.4 + Math.random() * 0.5 });
        }
        if (b.wd >= 25) { const [tx, tz] = warTilt(b.wd, x, y); g.scale.y = warSquash(b.wd); g.rotation.x = tx; g.rotation.z = tz; }
        this.root.add(g);
        this.parts.set(idx(x, y), part);
      }
      if (["radar", "airdef", "missilepad", "dronebase"].includes(b.id)) {
        const g = new THREE.Group();
        g.position.copy(c);
        g.rotation.y = this.w.faceAngle(s, x, y) + (b.rot || 0) * Math.PI / 2;
        const lvl = Math.min(2, b.lvl || 0), sfx = lvl ? String(lvl) : "", part = { kind: b.id, group: g, x, y, wd: b.wd || 0, lvl };
        if (b.id === "radar") {
          const L = MIL_LAYOUT.radar, dish = this.mesh(`radarDish${sfx}`);
          dish.position.set(L.x, L.h[lvl] + 0.02, L.z); dish.rotation.y = Math.random() * 6;
          g.add(dish); part.dish = dish;
        } else if (b.id === "airdef") {
          const turret = this.mesh(`airdefTurret${sfx}`);
          turret.position.set(MIL_LAYOUT.airdef.x, MIL_LAYOUT.airdef.y, MIL_LAYOUT.airdef.z); turret.rotation.y = Math.random() * 0.6 - 0.3;
          g.add(turret); part.turret = turret;
        } else if (b.id === "missilepad") {
          // the erector: sealed canisters (a coloured cap when loaded); the missile waits inside, unseen
          const P = MIL_LAYOUT.pad, n = P.n[lvl], show = this.missileStock == null ? n : Math.min(n, this.missileStock);
          const pivot = new THREE.Group(), arm = this.mesh(`padArm${show ? "L" : ""}${sfx}`);
          pivot.position.set(...P.pivot); arm.position.set(0, 0, P.arm);
          pivot.add(arm); g.add(pivot);
          part.missiles = [];
          for (let i = 0; i < n; i++) {
            const m = this.mesh("wMissile"), [sx, sy] = P.slot(lvl, i);
            m.position.set(sx, sy - 0.04, P.arm - 0.02);
            m.visible = false; m.userData.loaded = i < show;
            pivot.add(m); part.missiles.push(m);
          }
          part.pivot = pivot;
        } else if (b.id === "dronebase") {
          const spots = MIL_LAYOUT.drones.slice(0, Math.min(2, lvl + 1));
          const show = this.droneStock == null ? spots.length : Math.min(spots.length, this.droneStock);
          part.drones = spots.slice(0, show).map(([dx, dz]) => {
            const d = new THREE.Group(), body = this.mesh("wDrone"), rotor = this.mesh("wRotor");
            d.add(body, rotor); d.position.set(dx, 0.1, dz); d.scale.setScalar(0.8); g.add(d);
            return { g: d, rotor, spin: 0 };
          });
        }
        if (b.wd >= 25) { const [tx, tz] = warTilt(b.wd, x, y); g.scale.y = warSquash(b.wd); g.rotation.x = tx; g.rotation.z = tz; } // the moving parts sink and lean with the building
        this.root.add(g);
        this.parts.set(idx(x, y), part);
      }
      if (b.wd > 0) this.addDamage(x, y, b.wd, b);
      const rep = this.repairs.get(`${x}:${y}`);
      if (rep) this.addRepairSign(x, y);
    }
    this.buildRubble();
    if (this.targets) this.showTargets(this.targets.list, this.targets.sel);
  }

  /** How tall a building stands (its model's top), for the broken top and the fire. */
  topOf(i) {
    const w = this.w.where?.get(i), geo = w && model(w.k.split(":")[0]);
    if (!geo) return 0.4;
    let top = 0.2;
    for (const set of SETS) if (geo[set]) { if (!geo[set].boundingBox) geo[set].computeBoundingBox(); top = Math.max(top, geo[set].boundingBox.max.y); }
    return Math.min(1.4, top);
  }
  /** Broken concrete round the building and on its broken top, bent steel bars sticking out: one draw for all. */
  buildRubble() {
    const list = this.rubble;
    if (!list.length) return;
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.05, 0), new THREE.MeshStandardMaterial({ roughness: 0.95, color: "#ffffff" }), list.filter((r) => !r.bar).length);
    const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.008, 0.16, 0.008), new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.4, color: "#5b3a26" }), Math.max(1, list.filter((r) => r.bar).length));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
    let ri = 0, bi = 0;
    for (const r of list) {
      q.setFromEuler(e.set(r.rx, r.ry, r.rz));
      m4.compose(r.p, q, new THREE.Vector3(r.s, r.s * (r.bar ? 1 : 0.7), r.s));
      if (r.bar) bars.setMatrixAt(bi++, m4);
      else { rocks.setMatrixAt(ri, m4); rocks.setColorAt(ri++, c.set(r.c)); }
    }
    bars.count = bi;
    for (const m of [rocks, bars]) { m.castShadow = this.w.quality !== "low"; m.receiveShadow = true; m.userData.rubble = true; m.frustumCulled = false; this.marks.add(m); }
  }

  addDamage(x, y, wd, b) {
    const c = tileCenter(x, y), i = idx(x, y);
    // a seeded scatter, so the same damage looks the same each time it is drawn
    let seed = (x * 73856093) ^ (y * 19349663) ^ Math.round(wd);
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const top = this.topOf(i) * warSquash(wd);
    const greys = ["#8f877b", "#a49b8c", "#6f685e", "#b8ae9c", "#5a544c"];
    // rubble on the ground: more and further out the worse it is
    const n = Math.round(4 + wd * 0.32);
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2, d = 0.28 + rnd() * (0.15 + wd * 0.003);
      this.rubble.push({ p: new THREE.Vector3(c.x + Math.cos(a) * d, 0.02 + rnd() * 0.02, c.z + Math.sin(a) * d), rx: rnd() * 3, ry: rnd() * 3, rz: rnd() * 3, s: 0.45 + rnd() * (0.5 + wd * 0.008), c: greys[Math.floor(rnd() * greys.length)] });
    }
    // the broken top: blackened chunks where the roof was, and bent bars from 50%
    if (wd >= 35) for (let k = 0; k < Math.round(wd * 0.08); k++) this.rubble.push({ p: new THREE.Vector3(c.x + (rnd() - 0.5) * 0.4, top + rnd() * 0.03, c.z + (rnd() - 0.5) * 0.4), rx: rnd() * 3, ry: rnd() * 3, rz: rnd() * 3, s: 0.6 + rnd() * 0.6, c: rnd() < 0.5 ? "#2e2a26" : "#4a443d" });
    if (wd >= 50) for (let k = 0; k < Math.round((wd - 40) * 0.12); k++) this.rubble.push({ bar: true, p: new THREE.Vector3(c.x + (rnd() - 0.5) * 0.45, top + 0.05, c.z + (rnd() - 0.5) * 0.45), rx: (rnd() - 0.5) * 1.4, ry: rnd() * 3, rz: (rnd() - 0.5) * 1.4, s: 0.6 + rnd() * 0.7 });
    void b;
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.15), new THREE.MeshBasicMaterial({ map: fxTexture("scorch"), transparent: true, depthWrite: false, opacity: Math.min(0.95, 0.35 + wd / 120) }));
    decal.rotation.x = -Math.PI / 2; decal.position.set(c.x, 0.03, c.z); decal.renderOrder = 2;
    this.marks.add(decal);
    this.burning.push({ p: c, wd, t: Math.random(), top });
  }
  addRepairSign(x, y) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: fxTexture("wrench"), depthTest: false, transparent: true }));
    const c = tileCenter(x, y); sp.position.set(c.x, 1.1, c.z); sp.scale.set(0.45, 0.45, 1); sp.renderOrder = 6;
    sp.userData.bob = Math.random() * 6;
    this.marks.add(sp);
  }

  /** Target mode: rings on what may be hit, a big sight on the chosen one. list: [{ x, y }]. */
  showTargets(list, sel) {
    this.targets = list ? { list, sel } : null;
    for (const m of [...this.marks.children]) if (m.userData.target) this.marks.remove(m);
    if (!list) return;
    for (const t of list) {
      const c = tileCenter(t.x, t.y), on = sel && sel.x === t.x && sel.y === t.y;
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(on ? 1.35 : 1.05, on ? 1.35 : 1.05), new THREE.MeshBasicMaterial({ map: fxTexture("ring"), color: on ? "#ff3b30" : "#ffb347", transparent: true, depthWrite: false, opacity: on ? 0.95 : 0.6 }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(c.x, 0.05, c.z); ring.renderOrder = 3;
      ring.userData = { target: true, spin: on ? 1.2 : 0.4 };
      this.marks.add(ring);
      if (on) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: fxTexture("ring"), color: "#ff3b30", depthTest: false, transparent: true }));
        sp.position.set(c.x, 1.25, c.z); sp.scale.set(0.5, 0.5, 1); sp.renderOrder = 7; sp.userData = { target: true, bob: 0 };
        this.marks.add(sp);
      }
    }
  }

  /**
   * Choosing where to strike: for every spot a ring as wide as the weapon's blast, a crosshair, a beam of
   * light standing over it with its number, and the buildings the blast would reach glowing red.
   * points: [{ x, y, r, on }], hit: [{ x, y, f }] (f: how hard, 0 … 1).
   */
  showStrike(points, hit) {
    for (const m of [...this.marks.children]) if (m.userData.strike) { this.marks.remove(m); m.geometry?.dispose(); if (m.userData.own) m.material.dispose(); }
    if (!points) return;
    const flat = (w, h, color, opacity, map = null, add = true) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map, color, transparent: true, depthWrite: false, opacity, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false }));
      m.rotation.x = -Math.PI / 2; m.renderOrder = 4; m.userData = { strike: true, own: true }; return m;
    };
    for (const h of hit || []) {
      const c = tileCenter(h.x, h.y), m = flat(0.9, 0.9, new THREE.Color(1.5, 0.2, 0.12), 0.15 + h.f * 0.2);
      m.position.set(c.x, 0.04, c.z); m.userData.pulse = 0.15 + h.f * 0.2; this.marks.add(m);
    }
    points.forEach((p, i) => {
      const c = tileCenter(p.x, p.y), R = p.r + 0.5, on = p.on;
      const col = on ? new THREE.Color(2.6, 0.35, 0.25) : new THREE.Color(1.9, 1.2, 0.45);
      // a thin ring where the blast reaches, a faint disc inside it, four ticks and a dot at the centre
      const ring = new THREE.Mesh(new THREE.RingGeometry(R - (on ? 0.07 : 0.045), R, 48), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: on ? 0.95 : 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(c.x, 0.07, c.z); ring.renderOrder = 4; ring.userData = { strike: true, own: true, pulse: on ? 0.95 : 0 };
      this.marks.add(ring);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 40), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: on ? 0.1 : 0.05, depthWrite: false, toneMapped: false }));
      disc.rotation.x = -Math.PI / 2; disc.position.set(c.x, 0.05, c.z); disc.renderOrder = 3; disc.userData = { strike: true, own: true };
      this.marks.add(disc);
      for (let k = 0; k < 4; k++) { const t = flat(0.28, 0.04, col, on ? 0.9 : 0.5); const a = k * Math.PI / 2; t.position.set(c.x + Math.cos(a) * (R - 0.14), 0.075, c.z + Math.sin(a) * (R - 0.14)); t.rotation.z = -a; this.marks.add(t); }
      const dot = flat(0.16, 0.16, col, 0.95, fxTexture("ring")); dot.position.set(c.x, 0.08, c.z); dot.userData.spin = -2; this.marks.add(dot);
      // the chosen one stands out: a beam of light over it, the others a short marker
      const h = on ? 2.4 : 0.9;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, on ? 0.06 : 0.035, h, 8, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: on ? 0.55 : 0.35, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }));
      beam.position.set(c.x, h / 2, c.z); beam.renderOrder = 6; beam.userData = { strike: true, own: true, pulse: on ? 0.55 : 0 }; this.marks.add(beam);
      const cv = document.createElement("canvas"); cv.width = cv.height = 64;
      const g = cv.getContext("2d"); g.fillStyle = on ? "#d63b2f" : "#8f6a24"; g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "#fff"; g.lineWidth = 4; g.stroke(); g.fillStyle = "#fff"; g.font = "bold 34px system-ui"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(i + 1).replace(/\d/g, (x) => "٠١٢٣٤٥٦٧٨٩"[x]), 32, 34);
      const tex = new THREE.CanvasTexture(cv), sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      sp.position.set(c.x, h + 0.2, c.z); sp.scale.set(on ? 0.46 : 0.34, on ? 0.46 : 0.34, 1); sp.renderOrder = 8; sp.userData = { strike: true, own: true, bob: Math.random() * 6, target: true, high: h + 0.2 };
      this.marks.add(sp);
    });
  }

  // ---------- particles (sprites, so they keep their size in the flat camera) ----------
  sprite(kind, color, blending = THREE.NormalBlending) {
    let sp = this.pool.pop();
    if (!sp) { sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: fxTexture("soft"), transparent: true, depthWrite: false })); sp.renderOrder = 5; }
    const tex = { smoke: "smoke", dust: "smoke", trail: "smoke", fire: "fire", flame: "fire", flash: "flare" }[kind] || "soft";
    sp.material.map = fxTexture(tex);
    const hot = blending === THREE.AdditiveBlending && kind !== "fire"; // fire stays orange (tone mapped); flames, flashes and sparks bloom
    sp.material.toneMapped = !hot;
    sp.material.color.set(color);
    if (hot) sp.material.color.multiplyScalar(kind === "flash" ? 3.4 : kind === "flame" ? 3.6 : kind === "spark" ? 3.4 : 1); // bright enough to bloom
    sp.material.rotation = Math.random() * Math.PI * 2;
    sp.material.blending = blending; sp.material.opacity = 1; sp.visible = true;
    this.flyers.add(sp);
    return sp;
  }
  emit(kind, p, o = {}) {
    if (this.parts3.length >= this.maxParts && kind !== "flash") return;
    const fire = kind === "fire" || kind === "flash" || kind === "spark" || kind === "flame";
    const color = o.color || { smoke: "#5a554f", dust: "#d8c39a", fire: "#ff8a2a", flash: "#fff3c4", spark: "#ffd27a", flame: "#ffb347", trail: "#d9d6cf" }[kind];
    const sp = this.sprite(kind, color, fire ? THREE.AdditiveBlending : THREE.NormalBlending);
    sp.position.copy(p);
    const size = o.size ?? { smoke: 0.5, dust: 0.4, fire: 0.35, flash: 1.6, spark: 0.09, flame: 0.28, trail: 0.22 }[kind];
    sp.scale.set(size, size, 1);
    this.parts3.push({
      sp, kind, life: 0, max: o.life ?? { smoke: 2.6, dust: 1.4, fire: 0.6, flash: 0.35, spark: 0.9, flame: 0.12, trail: 1.4 }[kind],
      v: o.v || new THREE.Vector3((Math.random() - 0.5) * 0.3, kind === "smoke" ? 0.5 : kind === "spark" ? 2 : 0.2, (Math.random() - 0.5) * 0.3),
      grow: o.grow ?? { smoke: 1.6, dust: 1.2, fire: 0.6, flash: 0.8, spark: 0, flame: -0.5, trail: 1.4 }[kind], size, alpha: o.alpha ?? (kind === "smoke" ? 0.85 : kind === "trail" ? 0.6 : 1), gravity: kind === "spark" ? -4 : 0,
      spin: (Math.random() - 0.5) * (kind === "smoke" || kind === "trail" ? 0.8 : 2), hot: kind === "fire"
    });
  }
  explode(p, big = 1, air = false) {
    const n = this.w.quality === "low" ? 0.5 : 1;
    // light on everything around, the ring on the ground, the debris
    this.light.position.copy(p).setY(Math.max(0.5, p.y + 0.3)); this.light.intensity = 4 * big; this.lightT = 0.5;
    if (!air) {
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: fxTexture("shock"), color: new THREE.Color(1.6, 1.25, 0.9), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, 0.06, p.z); ring.renderOrder = 4;
      this.flyers.add(ring); this.rings.push({ m: ring, t: 0, size: 3.2 * big });
      for (let i = 0; i < Math.round(22 * big * n) && this.chunks.length < 60; i++) {
        const a = Math.random() * Math.PI * 2, sp = 0.8 + Math.random() * 2.2;
        this.chunks.push({ p: p.clone().setY(Math.max(0.2, p.y)), v: new THREE.Vector3(Math.cos(a) * sp, 2 + Math.random() * 3, Math.sin(a) * sp), r: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0), w: (Math.random() - 0.5) * 12, s: 0.5 + Math.random() * 1.1, life: 0 });
      }
    }
    for (let i = 0; i < Math.round(5 * big * n); i++) this.emit("fire", p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.25, 0.1 + Math.random() * 0.25, (Math.random() - 0.5) * 0.25)), { size: (0.5 + Math.random() * 0.4) * big, life: 0.9 + Math.random() * 0.5, grow: 1.2, v: new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.9 + Math.random() * 0.6, (Math.random() - 0.5) * 0.5) });
    this.emit("flash", p, { size: 0.9 * big, life: 0.22, alpha: 0.85 });
    for (let i = 0; i < Math.round(6 * big * n); i++) this.emit("fire", p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, Math.random() * 0.3, (Math.random() - 0.5) * 0.4)), { size: (0.4 + Math.random() * 0.5) * big, life: 0.5 + Math.random() * 0.4, v: new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.6 + Math.random(), (Math.random() - 0.5) * 1.2) });
    for (let i = 0; i < Math.round(18 * big * n); i++) { const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 2.5; this.emit("spark", p, { v: new THREE.Vector3(Math.cos(a) * sp, 1 + Math.random() * 3, Math.sin(a) * sp) }); }
    for (let i = 0; i < Math.round(8 * big * n); i++) this.emit("smoke", p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.1, (Math.random() - 0.5) * 0.6)), { size: 0.35 + Math.random() * 0.3, life: 2.2 + Math.random() * 1.2, color: air ? "#8a8580" : "#3f3a35", v: new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.4 + Math.random() * 0.5, (Math.random() - 0.5) * 0.5) });
    if (!air) { for (let i = 0; i < Math.round(10 * n); i++) { const a = Math.random() * Math.PI * 2; this.emit("dust", new THREE.Vector3(p.x, 0.05, p.z), { v: new THREE.Vector3(Math.cos(a) * 1.4, 0.15, Math.sin(a) * 1.4), size: 0.35 }); } }
  }
  shake(amount = 0.12, dur = 0.5) { if (!this.reduced) this.shakeT = { amount, dur, t: 0 }; }

  // ---------- tweens: every scene is a chain of these; "skip" finishes them all at once ----------
  tween(dur, fn) {
    return new Promise((res) => {
      if (this.skipping || dur <= 0) { fn(1); res(); return; }
      this.tasks.push({ t: 0, dur: this.reduced ? dur * 0.6 : dur, fn, res });
    });
  }
  wait(sec) { return this.tween(sec, () => {}); }
  skip() { this.skipping = true; for (const t of this.tasks) { t.fn(1); t.res(); } this.tasks = []; }
  camTo(to, dur = 1) {
    const v = this.w.view, from = { x: v.x, z: v.z, zoom: v.zoom, y: v.y || 0 };
    return this.tween(dur, (k) => {
      const e = fxEase(k);
      v.x = fxLerp(from.x, to.x ?? from.x, e); v.z = fxLerp(from.z, to.z ?? from.z, e);
      v.zoom = fxLerp(from.zoom, to.zoom ?? from.zoom, e); v.y = fxLerp(from.y, to.y ?? 0, e);
      this.w.updateCamera();
    });
  }
  follow(obj, k = 0.12, zoom) {
    const v = this.w.view, p = new THREE.Vector3(); obj.getWorldPosition(p);
    v.x += (p.x - v.x) * k; v.z += (p.z - v.z) * k; v.y = (v.y || 0) + (p.y * 0.75 - (v.y || 0)) * k;
    if (zoom) v.zoom += (zoom - v.zoom) * k * 0.5;
    this.w.updateCamera();
  }

  // ---------- scenes ----------
  /**
   * Getting ready and the launch, in the attacker's own town.
   * o: { x, y (the pad or base tile), kind: "missile" | "drone", wid, n, dir: Vector3 on the ground toward the target }
   */
  async playLaunch(o) {
    this.skipping = false;
    const part = this.parts.get(idx(o.x, o.y)), c = tileCenter(o.x, o.y);
    await this.camTo({ x: c.x, z: c.z, zoom: 2.4, y: 0.2 }, 1.1);
    if (o.kind === "missile") {
      const pivot = part?.pivot;
      o.sfx?.prep();
      // the warning light blinks while the erector rises
      const lamp = this.sprite("flash", "#ff3b30", THREE.AdditiveBlending); lamp.position.set(c.x + 0.3, 0.45, c.z + 0.3); lamp.scale.set(0.35, 0.35, 1);
      await this.tween(1.8, (k) => { if (pivot) pivot.rotation.x = -1.2 * fxEase(k); lamp.material.opacity = 0.4 + 0.6 * (Math.sin(k * 30) > 0 ? 1 : 0); });
      this.flyers.remove(lamp); this.pool.push(lamp);
      await this.wait(0.35);
      // the tubes it fires from: loaded ones first, then any (the store may already count them as gone)
      const all = part?.missiles || [], want = Math.max(1, Math.min(o.n || 1, all.length || 1));
      const missiles = [...all.filter((m) => m.userData.loaded), ...all.filter((m) => !m.userData.loaded)].slice(0, want);
      const flying = [];
      if (!missiles.length) missiles.push(null);
      // each canister fires in turn: its cap blows off, fire and smoke burst at the mouth, the back blast
      // comes out of its rear, and the missile slides out of the tube
      const live = missiles.filter(Boolean);
      const at = (m, z) => m.localToWorld(new THREE.Vector3(0, 0, z));
      if (live.length) {
        for (const m of live) { m.visible = true; m.userData.z0 = m.position.z; }
        for (const m of live) {
          const mouth = at(m, 0.3), rear = at(m, -0.3), out = mouth.clone().sub(rear).normalize();
          this.emit("flash", mouth, { size: 0.8, life: 0.18 });
          for (let j = 0; j < 4; j++) this.emit("fire", mouth.clone(), { size: 0.22, life: 0.3, v: out.clone().multiplyScalar(0.8 + Math.random()) });
          for (let j = 0; j < 6; j++) this.emit("smoke", rear.clone(), { color: "#e3ddd1", size: 0.4, life: 1.8, v: out.clone().multiplyScalar(-1.2 - Math.random()).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.2, (Math.random() - 0.5) * 0.6)) });
          for (let j = 0; j < 3; j++) this.emit("smoke", mouth.clone(), { color: "#ece7dc", size: 0.3, v: out.clone().multiplyScalar(0.4) });
        }
        this.light.position.copy(at(live[0], 0.3)); this.light.intensity = 3.2; this.lightT = 0.3;
        await this.tween(0.45, (k) => { for (const m of live) { m.position.z = m.userData.z0 + fxEaseIn(k) * 0.32; if (Math.random() < 0.6) this.emit("flame", at(m, -0.25), { size: 0.22, life: 0.08 }); } });
      }
      for (const [i, m] of missiles.entries()) {
        // the missile leaves its rail: from the arm to the world
        const fly = this.mesh(o.wid === "missile2" ? "wMissile2" : "wMissile");
        const start = new THREE.Vector3(), q = new THREE.Quaternion();
        if (m) { m.getWorldPosition(start); m.getWorldQuaternion(q); m.visible = false; m.position.z = m.userData.z0 ?? m.position.z; m.userData.loaded = false; } else { start.set(c.x, 0.4, c.z); q.setFromEuler(new THREE.Euler(-1.2, 0, 0)); }
        fly.position.copy(start); fly.quaternion.copy(q);
        this.flyers.add(fly);
        flying.push({ fly, start, delay: i * 0.45, dirUp: new THREE.Vector3(0, 0, 1).applyQuaternion(q) });
      }
      o.sfx?.launch();
      this.shake(0.05, 0.6);
      await this.tween(2.6, (k) => {
        const t = k * 2.6;
        for (const f of flying) {
          const tt = Math.max(0, t - f.delay);
          if (tt <= 0) continue;
          const d = 0.6 * tt * tt * 2.2 + tt * 0.3;               // accelerating
          const bend = Math.min(1, tt / 1.2);                          // turns toward straight up
          const dir = f.dirUp.clone().lerp(new THREE.Vector3(o.dir?.x * 0.25 || 0, 1, o.dir?.z * 0.25 || 0), bend).normalize();
          f.fly.position.copy(f.start).addScaledVector(dir, d);
          f.fly.lookAt(f.fly.position.clone().add(dir));
          const back = f.fly.position.clone().addScaledVector(dir, -0.32);
          this.emit("flame", back, { v: dir.clone().multiplyScalar(-1.5), size: 0.34 });
          this.emit("flame", back.clone().addScaledVector(dir, -0.08), { v: dir.clone().multiplyScalar(-2.5), size: 0.22, life: 0.1 });
          if (f === flying[0]) { this.light.position.copy(back); this.light.intensity = 4; this.lightT = 0.15; }
          if (Math.random() < 0.8) this.emit("trail", back, { v: new THREE.Vector3((Math.random() - 0.5) * 0.15, 0.05, (Math.random() - 0.5) * 0.15) });
          if (tt < 0.25) for (let j = 0; j < 2; j++) this.emit("smoke", new THREE.Vector3(c.x + (Math.random() - 0.5) * 0.6, 0.1, c.z + (Math.random() - 0.5) * 0.6), { color: "#d8d2c6", v: new THREE.Vector3((Math.random() - 0.5) * 1.6, 0.3, (Math.random() - 0.5) * 1.6), size: 0.6 });
        }
        this.follow(flying[0].fly, 0.08, 1.1);
      });
      for (const f of flying) this.flyers.remove(f.fly);
      if (part?.pivot) await this.tween(0.6, (k) => { part.pivot.rotation.x = -1.2 * (1 - k); });
    } else {
      // drones: rotors spin up, they lift off, turn toward the target and go
      o.sfx?.drone();
      const ds = (part?.drones || []).slice(0, Math.max(1, o.n || 1));
      const flying = ds.length ? ds.map((d, i) => {
        const fly = this.mesh(o.wid === "drone2" ? "wDrone2" : "wDrone"), rotor = this.mesh(o.wid === "drone2" ? "wRotor2" : "wRotor");
        fly.add(rotor);
        const p = new THREE.Vector3(); d.g.getWorldPosition(p); d.g.visible = false;
        fly.position.copy(p); this.flyers.add(fly);
        return { fly, rotor, start: p, delay: i * 0.4 };
      }) : [(() => { const fly = this.mesh("wDrone"), rotor = this.mesh("wRotor"); fly.add(rotor); fly.position.set(c.x, 0.1, c.z); this.flyers.add(fly); return { fly, rotor, start: fly.position.clone(), delay: 0 }; })()];
      const dir = o.dir ? new THREE.Vector3(o.dir.x, 0, o.dir.z).normalize() : new THREE.Vector3(0, 0, 1);
      await this.tween(3.4, (k) => {
        const t = k * 3.4;
        for (const f of flying) {
          const tt = Math.max(0, t - f.delay);
          f.rotor.rotation.y += 0.9;
          const up = Math.min(1, tt / 1.2), go = Math.max(0, tt - 1.2);
          f.fly.position.set(f.start.x + dir.x * go * go * 0.9, f.start.y + fxEase(up) * 1.4 + go * 0.4 + Math.sin(tt * 6) * 0.02, f.start.z + dir.z * go * go * 0.9);
          f.fly.rotation.y = Math.atan2(dir.x, dir.z) * Math.min(1, go * 2);
          f.fly.rotation.x = Math.min(0.35, go * 0.4);
          if (tt < 0.6 && Math.random() < 0.5) this.emit("dust", new THREE.Vector3(f.start.x, 0.05, f.start.z), { v: new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.1, (Math.random() - 0.5) * 1.2), size: 0.25 });
        }
        this.follow(flying[0].fly, 0.08, 1.4);
      });
      for (const f of flying) this.flyers.remove(f.fly);
    }
  }

  /**
   * The attack arriving at the target town, as the server decided it.
   * o: { x, y, dir (toward where it came from), weapons: [{ w, kind, tried, intercepted, dmg }], detected,
   *      airdefs: [{ x, y }], radars: [{ x, y }], banner(text, cls), onHit(dmg), sfx }
   */
  async playIncoming(o) {
    this.skipping = false;
    // one strike, or a salvo of them: each falls on its own spot, all of them together
    const strikes = (o.strikes || [{ x: o.x, y: o.y, r: 0.7, weapons: o.weapons, area: [], onHit: o.onHit }]).map((st) => ({ ...st, c: tileCenter(st.x, st.y) }));
    strikes.forEach((st) => { st.top = st.c.clone().setY(0.45); });
    const ads = (o.airdefs || []).map((a) => ({ ...a, p: tileCenter(a.x, a.y), used: 0 }));
    const defends = ads.length > 0 && strikes.some((st) => st.weapons.some((h) => h.tried));
    // the camera takes in every spot (and the batteries that fire)
    const pts = [...strikes.map((st) => st.c), ...(defends ? ads.map((a) => a.p) : [])];
    const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x)), minZ = Math.min(...pts.map((p) => p.z)), maxZ = Math.max(...pts.map((p) => p.z));
    const span = Math.max(maxX - minX, maxZ - minZ) + (strikes.length > 1 ? 3 : 2);
    await this.camTo({ x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, zoom: Math.max(0.95, Math.min(1.5, 10 / span)), y: 0.5 }, 1.0);
    if (ads.length && !defends && o.noAmmo) { o.banner?.("🛡️ الدفاع الجوي بلا صواريخ اعتراضية!", "bad"); await this.wait(1.2); }
    if (o.detected) {
      o.banner?.(strikes.length > 1 ? `⚠️ تم رصد ${strikes.reduce((n, st) => n + st.weapons.length, 0)} أهداف جوية` : "⚠️ تم رصد هدف جوي", "warn");
      o.sfx?.alarm();
      this.alertT = 6;
      for (const r of o.radars || []) {
        const p = tileCenter(r.x, r.y), sp = this.sprite("flash", "#ff3b30", THREE.AdditiveBlending);
        sp.position.set(p.x, 0.9, p.z);
        this.tween(2.4, (k) => { sp.scale.setScalar(0.4 + (k * 6 % 1) * 0.9); sp.material.opacity = 1 - (k * 6 % 1); if (k >= 1) { this.flyers.remove(sp); this.pool.push(sp); } });
      }
      // where they are going: a red lock over every spot
      this.showStrike(strikes.map((st) => ({ x: st.x, y: st.y, r: st.r, on: true })), []);
      await this.wait(1.0);
    }
    const dir = new THREE.Vector3(o.dir?.x ?? 1, 0, o.dir?.z ?? 0).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const total = strikes.reduce((n, st) => n + st.weapons.length, 0);
    let hits = 0, n = 0;
    const one = async (h, k, st) => {
      const missile = h.kind === "missile", dur = (missile ? 2.2 : 3.8) * (h.tried ? 1.3 : 1);
      const lateral = (k - (total - 1) / 2) * 1.1;
      const from = st.c.clone().addScaledVector(dir, missile ? 13 : 10).addScaledVector(side, lateral).setY(missile ? 9 : 3.2);
      const fly = this.mesh({ missile: "wMissile", missile2: "wMissile2", drone: "wDrone", drone2: "wDrone2" }[h.w] || "wMissile");
      const rotor = !missile ? this.mesh(h.w === "drone2" ? "wRotor2" : "wRotor") : null;
      if (rotor) fly.add(rotor);
      fly.position.copy(from); fly.scale.setScalar(strikes.length > 1 ? 1.5 : 1.25); this.flyers.add(fly);
      const top = st.top;
      let framed = false;
      // a missile comes in high and dives at the end; a drone flies low and steady, then drops on it
      const at = (kk) => {
        if (missile) { const p = from.clone().lerp(top, kk); p.y = fxLerp(from.y, top.y, Math.pow(kk, 2.2)) + Math.sin(kk * Math.PI) * 1.2 * (1 - kk); return p; }
        const p = from.clone().lerp(top, kk); p.y = fxLerp(from.y, top.y + 0.6, kk) - (kk > 0.85 ? (kk - 0.85) / 0.15 * 0.6 : 0) + Math.sin(kk * 20) * 0.025; return p;
      };
      // the battery: the nearest one to this spot that fired least (so several batteries share the work)
      const ad = h.tried ? ads.slice().sort((p, q) => (p.used - q.used) * 3 + p.p.distanceTo(st.c) - q.p.distanceTo(st.c))[0] : null;
      if (ad) ad.used++;
      const meet = 0.78, fireAt = 0.28 + (ad ? (ad.used - 1) * 0.05 : 0);
      let inter = null, gone = false;
      o.sfx?.whoosh();
      await this.tween(dur, (kk) => {
        if (gone) return;
        const p = at(kk), next = at(Math.min(1, kk + 0.01));
        fly.position.copy(p);
        // a salvo: the camera glides to each spot as its weapon comes down (one after another)
        if (strikes.length > 1 && !framed && kk >= 0.55) { framed = true; this.camTo({ x: st.c.x, z: st.c.z, zoom: 1.45, y: 0.45 }, 0.7); }
        if (missile) fly.lookAt(next); else { fly.lookAt(new THREE.Vector3(next.x, p.y, next.z)); rotor.rotation.y += 0.9; }
        if (missile) {
          const back = p.clone().add(p.clone().sub(next).normalize().multiplyScalar(0.3));
          this.emit("flame", back, { size: 0.34 }); this.emit("flame", back.clone().add(p.clone().sub(next).normalize().multiplyScalar(0.1)), { size: 0.2, life: 0.08 });
          if (Math.random() < 0.85) this.emit("trail", back, { size: 0.28, life: 1.8 });
          if (k === 0) { this.light.position.copy(back); this.light.intensity = 3; this.lightT = 0.12; }
        } else {
          if (Math.random() < 0.3) this.emit("trail", p, { size: 0.12, alpha: 0.3 });
          if (Math.random() < 0.2) this.emit("flash", p.clone().add(new THREE.Vector3(0, 0.05, 0)), { size: 0.12, life: 0.08, color: kk * 10 % 2 < 1 ? "#ff4d3a" : "#5ad1ff" }); // its navigation lights
        }
        if (h.tried && ad) {
          const part = this.parts.get(idx(ad.x, ad.y));
          if (part?.turret) { const want = Math.atan2(p.x - ad.p.x, p.z - ad.p.z) - part.group.rotation.y; part.turret.rotation.y += (want - part.turret.rotation.y) * 0.15; part.turret.rotation.x = -Math.min(0.75, kk * 2.5); }
          if (kk >= fireAt && !inter) {
            const src = ad.p.clone().setY(0.45), aim = at(meet);
            const miss = !h.intercepted ? side.clone().multiplyScalar(0.9).add(new THREE.Vector3(0, 0.5, 0)) : new THREE.Vector3();
            inter = { m: this.mesh("wInterceptor"), src, aim: aim.add(miss), done: false, last: src.clone() };
            inter.m.scale.setScalar(1.8);
            inter.m.position.copy(src); this.flyers.add(inter.m);
            this.emit("flash", src, { size: 1.1, life: 0.25 });
            for (let j = 0; j < 10; j++) this.emit("smoke", src.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, -0.2, (Math.random() - 0.5) * 0.3)), { color: "#ece7dc", size: 0.45, v: new THREE.Vector3((Math.random() - 0.5) * 1.6, 0.4, (Math.random() - 0.5) * 1.6) });
            this.light.position.copy(src); this.light.intensity = 3.5; this.lightT = 0.4;
            if (n++ % 2 === 0) o.banner?.(total > 1 ? "🚀 الدفاع الجوي يطلق الاعتراضات" : "🚀 الدفاع الجوي أطلق صاروخ اعتراضي", "warn");
            o.sfx?.intercept();
          }
          if (inter && !inter.done) {
            const q = Math.min(1, (kk - fireAt) / (meet - fireAt));
            const ip = inter.src.clone().lerp(inter.aim, fxEase(q)); ip.y += Math.sin(q * Math.PI) * 1.0;
            inter.m.lookAt(ip.clone().add(ip.clone().sub(inter.last)));
            inter.m.position.copy(ip);
            const back = ip.clone().add(inter.last.clone().sub(ip).normalize().multiplyScalar(0.3));
            this.emit("flame", back, { size: 0.3 });
            this.emit("trail", back, { size: 0.24, color: "#f4f1ea", alpha: 0.8, life: 2.2 });
            inter.last.copy(ip);
            if (q >= 1) {
              inter.done = true; this.flyers.remove(inter.m);
              if (h.intercepted) {
                gone = true; this.flyers.remove(fly);
                this.airBurst(p, missile ? 1.15 : 0.8);
                o.sfx?.airBurst(); o.banner?.("✅ تم اعتراض هدف", "ok");
              } else {
                this.emit("flash", ip, { size: 0.6 }); for (let j = 0; j < 8; j++) this.emit("spark", ip);
                o.banner?.("❌ فشل اعتراض: الهدف مكمّل", "bad");
              }
            }
          }
        }
      });
      if (gone) return;
      this.flyers.remove(fly);
      this.blast(st, missile, h);
      o.sfx?.boom();
      hits++;
      st.onHit?.(h.dmg, k);
    };
    let k = 0;
    const runs = [];
    for (const st of strikes) for (const h of st.weapons) { const kk = k++; runs.push(this.wait(kk * (strikes.length > 1 ? 1.5 : 0.9)).then(() => one(h, kk, st))); }
    await Promise.all(runs);
    this.showStrike(null);
    await this.wait(hits ? 1.8 : 0.8);
    this.skipping = false;
  }

  /** An interceptor meets its target in the air: a white puff, a ring of fragments, the wreck falling. */
  airBurst(p, big = 1) {
    this.explode(p, big, true); this.shake(0.05, 0.4);
    for (let i = 0; i < 24; i++) { const a = Math.random() * Math.PI * 2, b = (Math.random() - 0.5) * Math.PI; this.emit("spark", p, { v: new THREE.Vector3(Math.cos(a) * Math.cos(b) * 3, Math.sin(b) * 3 + 0.5, Math.sin(a) * Math.cos(b) * 3), size: 0.07 }); }
    for (let i = 0; i < 6; i++) this.emit("smoke", p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3)), { color: "#d9d4cc", size: 0.5, life: 3, v: new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.1, (Math.random() - 0.5) * 0.4) });
    for (let i = 0; i < 4; i++) this.emit("trail", p.clone(), { color: "#3e3a35", size: 0.1, life: 1.6, v: new THREE.Vector3((Math.random() - 0.5) * 0.8, -1.4, (Math.random() - 0.5) * 0.8) });
  }
  /**
   * A hit: the blast at the spot as wide as the weapon reaches (a ground ring that size), the flash and
   * fireball, and smaller bursts on the buildings around it that the blast reached.
   */
  blast(st, missile, h) {
    const r = Math.max(0.7, st.r || 0.7), big = missile ? 0.9 + r * 0.35 : 0.7 + r * 0.3;
    this.explode(st.top.clone().setY(0.35), big, false);
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: fxTexture("shock"), color: new THREE.Color(1.8, 1.1, 0.7), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(st.c.x, 0.07, st.c.z); ring.renderOrder = 4;
    this.flyers.add(ring); this.rings.push({ m: ring, t: 0, size: (r * 2 + 1) * 1.15 });
    // a column of fire and dark smoke rising after a heavy missile
    if (missile && r > 1.2) for (let i = 0; i < 10; i++) this.emit("fire", st.c.clone().setY(0.3 + i * 0.12), { size: 0.5 + Math.random() * 0.3, life: 1 + Math.random() * 0.6, v: new THREE.Vector3((Math.random() - 0.5) * 0.3, 1.4 + i * 0.1, (Math.random() - 0.5) * 0.3) });
    for (const a of st.area || []) {
      if (a.x === st.x && a.y === st.y) continue;
      const p = tileCenter(a.x, a.y).setY(0.3), delay = 0.08 + Math.hypot(a.x - st.x, a.y - st.y) * 0.09;
      this.wait(delay).then(() => { this.explode(p, 0.35 + Math.min(0.5, (a.dmg || 10) / 80), false); for (let j = 0; j < 4; j++) this.emit("dust", p.clone().setY(0.05), { size: 0.4, v: new THREE.Vector3((Math.random() - 0.5) * 1.4, 0.2, (Math.random() - 0.5) * 1.4) }); });
    }
    this.w.puff?.(st.c, 14 + Math.round(r * 6));
    this.shake(missile ? 0.12 + r * 0.05 : 0.08, 0.7);
    void h;
  }

  // ---------- every frame ----------
  step(dt) {
    const now = Date.now() + this.clockOffset;
    // tweens
    if (this.tasks.length) {
      const done = [];
      for (const t of this.tasks) { t.t += dt; const k = Math.min(1, t.t / t.dur); t.fn(k); if (k >= 1) done.push(t); }
      if (done.length) { this.tasks = this.tasks.filter((t) => !done.includes(t)); for (const t of done) t.res(); }
    }
    // moving parts
    this.alertT = Math.max(0, this.alertT - dt);
    for (const p of this.parts.values()) {
      const works = p.wd < 85, slow = 1 - Math.min(0.8, p.wd / 100);
      if (p.dish && works) p.dish.rotation.y += dt * (this.alertT > 0 ? 4.5 : 0.9) * slow;
      if (p.turret && works && !this.tasks.length) p.turret.rotation.y += Math.sin(this.w.clock * 0.4 + p.x) * dt * 0.25;
      if (p.drones) for (const d of p.drones) d.rotor.rotation.y += dt * (works ? 1.2 : 0);
      if (p.rotors && works) for (const w of p.rotors) w.r.rotation.z -= dt * w.speed * slow;
    }
    // damage: smoke rising, fire flickering on the worst ones
    for (const b of this.burning) {
      b.t -= dt;
      if (b.t > 0) continue;
      b.t = Math.max(0.12, 0.7 - b.wd * 0.005) * (this.w.quality === "low" ? 2 : 1);
      this.emit("smoke", b.p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, (b.top ?? 0.45) + 0.05, (Math.random() - 0.5) * 0.4)), { size: 0.3 + b.wd * 0.004, life: 2.2 + b.wd * 0.01, color: b.wd >= 60 ? "#2f2b27" : "#6b665f", alpha: 0.35 + b.wd * 0.004, v: new THREE.Vector3(0.12, 0.35 + Math.random() * 0.2, 0.05) });
      if (b.wd >= 45) this.emit("fire", b.p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.35, (b.top ?? 0.35) + Math.random() * 0.08, (Math.random() - 0.5) * 0.35)), { size: 0.22 + Math.random() * 0.12, life: 0.45, v: new THREE.Vector3(0, 0.6, 0) });
    }
    // marks: target rings turn, signs bob
    for (const m of this.marks.children) {
      if (m.userData.spin) m.rotation.z += dt * m.userData.spin;
      if (m.isSprite && m.userData.bob !== undefined) { m.userData.bob += dt * 3; m.position.y = (m.userData.high ?? (m.userData.target ? 1.25 : 1.1)) + Math.sin(m.userData.bob) * 0.08; }
      if (m.userData.pulse) m.material.opacity = m.userData.pulse * (0.65 + 0.35 * Math.sin(this.w.clock * 5 + m.position.x));
    }
    // the blast light fades; rings spread; debris falls and bounces
    if (this.lightT > 0) { this.lightT -= dt; if (this.lightT <= 0) this.light.intensity = 0; else this.light.intensity *= Math.pow(0.02, dt); }
    if (this.rings.length) this.rings = this.rings.filter((r) => { r.t += dt; const k = r.t / 0.55; if (k >= 1) { this.flyers.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); return false; } const sc = 0.3 + r.size * Math.pow(k, 0.6); r.m.scale.set(sc, sc, 1); r.m.material.opacity = 1 - k; return true; });
    if (this.chunks.length) {
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      this.chunks = this.chunks.filter((c) => (c.life += dt) < 3.5);
      this.chunks.forEach((c, i) => {
        c.v.y -= 9 * dt; c.p.addScaledVector(c.v, dt);
        if (c.p.y < 0.03) { c.p.y = 0.03; c.v.y *= -0.3; c.v.x *= 0.6; c.v.z *= 0.6; c.w *= 0.6; }
        c.r.x += c.w * dt; c.r.y += c.w * 0.7 * dt;
        const fade = c.life > 2.8 ? 1 - (c.life - 2.8) / 0.7 : 1;
        this.debris.setMatrixAt(i, m4.compose(c.p, q.setFromEuler(c.r), sc.setScalar(c.s * fade)));
        if (c.life < 0.6 && Math.random() < 0.3) this.emit("trail", c.p.clone(), { size: 0.1, color: "#4a443d", life: 0.8, alpha: 0.5 });
      });
      this.debris.count = this.chunks.length; this.debris.instanceMatrix.needsUpdate = true;
    } else if (this.debris.count) this.debris.count = 0;
    // particles
    if (this.parts3.length) {
      const keep = [];
      for (const q of this.parts3) {
        q.life += dt;
        const k = q.life / q.max;
        if (k >= 1) { this.flyers.remove(q.sp); this.pool.push(q.sp); continue; }
        q.v.y += q.gravity * dt;
        q.sp.position.addScaledVector(q.v, dt);
        if (q.kind === "smoke" || q.kind === "trail") q.v.multiplyScalar(0.985);
        const s = Math.max(0.01, q.size * (1 + q.grow * k));
        q.sp.scale.set(s, s, 1);
        q.sp.material.opacity = q.alpha * (q.kind === "flash" ? 1 - k : k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85);
        q.sp.material.rotation += q.spin * dt;
        if (q.kind === "fire") { q.sp.material.color.setHSL(0.09 - k * 0.07, 1, 0.6 - k * 0.35).multiplyScalar(1.1 * (1 - k) + 0.25); }
        keep.push(q);
      }
      this.parts3 = keep;
    }
    // the camera shakes after a blast
    if (this.shakeT) {
      const s = this.shakeT; s.t += dt;
      const a = s.amount * Math.max(0, 1 - s.t / s.dur);
      this.w.shakeOff = { x: (Math.random() - 0.5) * a, z: (Math.random() - 0.5) * a };
      if (s.t >= s.dur) { this.shakeT = null; this.w.shakeOff = null; }
      this.w.updateCamera();
    }
    // repairs finish on their own (the server holds the times)
    if (this.repairs.size && this.state) for (const [k, r] of this.repairs) if (now >= r.end) { this.repairs.delete(k); this.onRepairDone?.(k); }
  }

  /** Drop the scene's flyers and particles (leaving a scene early). */
  clear() {
    this.skip(); this.skipping = false;
    for (const q of this.parts3) { this.flyers.remove(q.sp); this.pool.push(q.sp); }
    this.parts3 = [];
    for (const m of [...this.flyers.children]) if (!m.isSprite) this.flyers.remove(m);
    this.w.shakeOff = null; this.shakeT = null;
    this.w.view.y = 0; this.w.updateCamera();
  }
}
