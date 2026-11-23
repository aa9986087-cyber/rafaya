// «صراع الجوف» on screen: the moving parts of military buildings (radar dishes, air defence launchers,
// missile erectors, drones on their pads), war damage that stays (scorch, smoke, fire, a darker
// building, the repair sign), and the scenes of an operation: getting ready, the launch, the
// approach, the air defence trying to stop it, the air burst or the hit. Scenes only SHOW a result
// the server already decided; nothing here changes the town.
import * as THREE from "three";
import { MAP_SIZE } from "./data.js";
import { idx } from "./sim.js";
import { model } from "./models.js";
import { tileCenter } from "./world3d.js";

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
  } else if (kind === "wrench" || kind === "warn") {
    g.font = "92px serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(kind === "wrench" ? "🔧" : "⚠️", 64, 70);
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
    this.clockOffset = 0;     // server time − this device's time
  }

  /** A small model as meshes (matte, shiny, lights) in a group. */
  mesh(key) {
    const geo = model(key), g = new THREE.Group();
    if (!geo) return g;
    for (const set of ["matte", "shiny", "lights"]) {
      if (!geo[set]) continue;
      const m = new THREE.Mesh(geo[set], set === "lights" ? new THREE.MeshBasicMaterial({ vertexColors: true }) : this.w.mats[set]);
      m.castShadow = set !== "lights" && this.w.quality !== "low";
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
    this.marks.clear();
    this.burning = [];
    for (let y = 0; y < FX_N; y++) for (let x = 0; x < FX_N; x++) {
      const t = s.tiles[idx(x, y)], b = t.b;
      if (!b || b.build > 0) continue;
      const c = tileCenter(x, y);
      if (["radar", "airdef", "missilepad", "dronebase"].includes(b.id)) {
        const g = new THREE.Group();
        g.position.copy(c);
        g.rotation.y = this.w.faceAngle(s, x, y) + (b.rot || 0) * Math.PI / 2;
        const lvl = Math.min(2, b.lvl || 0), sfx = lvl ? String(lvl) : "", part = { kind: b.id, group: g, x, y, wd: b.wd || 0, lvl };
        if (b.id === "radar") {
          const h = [0.45, 0.7, 0.9][lvl], dish = this.mesh(`radarDish${sfx}`);
          dish.position.set(-0.04, h + 0.03, -0.04); dish.rotation.y = Math.random() * 6;
          g.add(dish); part.dish = dish;
        } else if (b.id === "airdef") {
          const turret = this.mesh(`airdefTurret${sfx}`);
          turret.position.set(0, 0.03, -0.02); turret.rotation.y = Math.random() * 6;
          g.add(turret); part.turret = turret;
        } else if (b.id === "missilepad") {
          const pivot = new THREE.Group(), arm = this.mesh(`padArm${sfx}`);
          pivot.position.set(0, 0.17, -0.33); arm.position.set(0, 0, 0.31);
          pivot.add(arm); g.add(pivot);
          const n = [1, 2, 3][lvl], show = this.missileStock == null ? n : Math.min(n, this.missileStock);
          part.missiles = [];
          for (let i = 0; i < n; i++) {
            const m = this.mesh("wMissile");
            m.position.set((i - (n - 1) / 2) * 0.1, 0.075, 0.33);
            m.visible = i < show;
            pivot.add(m); part.missiles.push(m);
          }
          part.pivot = pivot;
        } else if (b.id === "dronebase") {
          const spots = [[-0.15, 0.3], [0.14, 0.3]].slice(0, Math.min(2, lvl + 1));
          const show = this.droneStock == null ? spots.length : Math.min(spots.length, this.droneStock);
          part.drones = spots.slice(0, show).map(([dx, dz]) => {
            const d = new THREE.Group(), body = this.mesh("wDrone"), rotor = this.mesh("wRotor");
            d.add(body, rotor); d.position.set(dx, 0.07, dz); d.scale.setScalar(0.7); g.add(d);
            return { g: d, rotor, spin: 0 };
          });
        }
        this.root.add(g);
        this.parts.set(idx(x, y), part);
      }
      if (b.wd > 0) this.addDamage(x, y, b.wd);
      const rep = this.repairs.get(`${x}:${y}`);
      if (rep) this.addRepairSign(x, y);
    }
    if (this.targets) this.showTargets(this.targets.list, this.targets.sel);
  }

  addDamage(x, y, wd) {
    const c = tileCenter(x, y);
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.15), new THREE.MeshBasicMaterial({ map: fxTexture("scorch"), transparent: true, depthWrite: false, opacity: Math.min(0.95, 0.35 + wd / 120) }));
    decal.rotation.x = -Math.PI / 2; decal.position.set(c.x, 0.03, c.z); decal.renderOrder = 2;
    this.marks.add(decal);
    this.burning.push({ p: c, wd, t: Math.random() });
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

  // ---------- particles (sprites, so they keep their size in the flat camera) ----------
  sprite(kind, color, blending = THREE.NormalBlending) {
    let sp = this.pool.pop();
    if (!sp) { sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: fxTexture("soft"), transparent: true, depthWrite: false })); sp.renderOrder = 5; }
    sp.material.color.set(color); sp.material.blending = blending; sp.material.opacity = 1; sp.visible = true;
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
      grow: o.grow ?? { smoke: 1.6, dust: 1.2, fire: 0.6, flash: 0.8, spark: 0, flame: -0.5, trail: 1.4 }[kind], size, alpha: o.alpha ?? (kind === "smoke" ? 0.75 : kind === "trail" ? 0.55 : 1), gravity: kind === "spark" ? -4 : 0
    });
  }
  explode(p, big = 1, air = false) {
    const n = this.w.quality === "low" ? 0.5 : 1;
    this.emit("flash", p, { size: 1.1 * big, life: 0.28 });
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
      const missiles = (part?.missiles || []).filter((m) => m.visible).slice(0, Math.max(1, o.n || 1));
      const flying = [];
      if (!missiles.length) missiles.push(null);
      for (const [i, m] of missiles.entries()) {
        // the missile leaves its rail: from the arm to the world
        const fly = this.mesh(o.wid === "missile2" ? "wMissile2" : "wMissile");
        const start = new THREE.Vector3(), q = new THREE.Quaternion();
        if (m) { m.getWorldPosition(start); m.getWorldQuaternion(q); m.visible = false; } else { start.set(c.x, 0.4, c.z); q.setFromEuler(new THREE.Euler(-1.2, 0, 0)); }
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
          this.emit("flame", back, { v: dir.clone().multiplyScalar(-1.5), size: 0.32 });
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
    const c = tileCenter(o.x, o.y), top = c.clone().setY(0.45);
    await this.camTo({ x: c.x, z: c.z, zoom: 1.45, y: 0.3 }, 1.0);
    if (o.detected) {
      o.banner?.("⚠️ تم رصد هدف جوي", "warn");
      o.sfx?.alarm();
      this.alertT = 6;
      for (const r of o.radars || []) {
        const p = tileCenter(r.x, r.y), sp = this.sprite("flash", "#ff3b30", THREE.AdditiveBlending);
        sp.position.set(p.x, 0.9, p.z);
        this.tween(2.4, (k) => { sp.scale.setScalar(0.4 + (k * 6 % 1) * 0.9); sp.material.opacity = 1 - (k * 6 % 1); if (k >= 1) { this.flyers.remove(sp); this.pool.push(sp); } });
      }
      await this.wait(1.0);
    }
    const dir = new THREE.Vector3(o.dir?.x ?? 1, 0, o.dir?.z ?? 0).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    let hits = 0;
    const one = async (h, k) => {
      const missile = h.kind === "missile", dur = missile ? 2.0 : 3.8;
      const lateral = (k - (o.weapons.length - 1) / 2) * 1.6;
      const from = c.clone().addScaledVector(dir, missile ? 13 : 10).addScaledVector(side, lateral).setY(missile ? 9 : 3.2);
      const fly = this.mesh({ missile: "wMissile", missile2: "wMissile2", drone: "wDrone", drone2: "wDrone2" }[h.w] || "wMissile");
      const rotor = !missile ? this.mesh(h.w === "drone2" ? "wRotor2" : "wRotor") : null;
      if (rotor) fly.add(rotor);
      fly.position.copy(from); this.flyers.add(fly);
      const at = (kk) => {
        const e = missile ? fxEaseIn(kk) * 0.35 + kk * 0.65 : kk;
        const p = from.clone().lerp(top, e);
        if (!missile) p.y += Math.sin(kk * Math.PI) * 0.6 + Math.sin(kk * 20) * 0.03;
        return p;
      };
      const ad = (o.airdefs || []).map((a) => ({ ...a, p: tileCenter(a.x, a.y) })).sort((p, q) => p.p.distanceTo(c) - q.p.distanceTo(c))[0];
      const meet = 0.7, fireAt = 0.32;
      let inter = null, gone = false;
      o.sfx?.whoosh();
      await this.tween(dur, (kk) => {
        if (gone) return;
        const p = at(kk), next = at(Math.min(1, kk + 0.01));
        fly.position.copy(p);
        if (missile) fly.lookAt(next); else { fly.lookAt(new THREE.Vector3(next.x, p.y, next.z)); rotor.rotation.y += 0.9; }
        if (missile) { this.emit("flame", p.clone().add(p.clone().sub(next).normalize().multiplyScalar(0.3)), { size: 0.3 }); if (Math.random() < 0.7) this.emit("trail", p, {}); }
        else if (Math.random() < 0.25) this.emit("trail", p, { size: 0.12, alpha: 0.3 });
        // the air defence: turn to it, fire, and meet it
        if (h.tried && ad) {
          const part = this.parts.get(idx(ad.x, ad.y));
          if (part?.turret) { const want = Math.atan2(p.x - ad.p.x, p.z - ad.p.z) - part.group.rotation.y; part.turret.rotation.y += (want - part.turret.rotation.y) * 0.2; part.turret.rotation.x = -Math.min(0.7, kk * 2); }
          if (kk >= fireAt && !inter) {
            const src = ad.p.clone().setY(0.4), aim = at(meet);
            const miss = !h.intercepted ? side.clone().multiplyScalar(0.9).add(new THREE.Vector3(0, 0.5, 0)) : new THREE.Vector3();
            inter = { m: this.mesh("wInterceptor"), src, aim: aim.add(miss), done: false };
            inter.m.position.copy(src); this.flyers.add(inter.m);
            this.emit("flash", src, { size: 0.8, life: 0.2 }); for (let j = 0; j < 4; j++) this.emit("smoke", src, { color: "#d8d2c6", size: 0.4 });
            o.sfx?.intercept();
          }
          if (inter && !inter.done) {
            const q = Math.min(1, (kk - fireAt) / (meet - fireAt));
            const ip = inter.src.clone().lerp(inter.aim, fxEase(q)); ip.y += Math.sin(q * Math.PI) * 0.8;
            inter.m.lookAt(ip.clone().add(ip.clone().sub(inter.m.position)));
            inter.m.position.copy(ip);
            if (Math.random() < 0.9) this.emit("trail", ip, { size: 0.16, color: "#f1efe8" });
            if (q >= 1) {
              inter.done = true; this.flyers.remove(inter.m);
              if (h.intercepted) {
                gone = true; this.flyers.remove(fly);
                this.explode(p, missile ? 1.1 : 0.8, true); this.shake(0.05, 0.4);
                o.sfx?.airBurst(); o.banner?.("✅ تم اعتراض الهجوم", "ok");
              } else {
                this.emit("flash", ip, { size: 0.6 }); for (let j = 0; j < 6; j++) this.emit("spark", ip);
                o.banner?.("❌ فشل الاعتراض: الهجوم مكمّل", "bad");
              }
            }
          }
        }
      });
      if (gone) return;
      this.flyers.remove(fly);
      // the hit: the flash first, then the blast, the debris and the smoke
      this.explode(top.clone().setY(0.35), missile ? 1.5 : 1, false);
      this.w.puff?.(c, 14);
      this.shake(missile ? 0.18 : 0.1, 0.6);
      o.sfx?.boom();
      hits++;
      o.onHit?.(h.dmg, k);
    };
    const runs = o.weapons.map((h, k) => this.wait(k * 0.9).then(() => one(h, k)));
    await Promise.all(runs);
    await this.wait(hits ? 1.6 : 0.8);
    this.skipping = false;
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
    }
    // damage: smoke rising, fire flickering on the worst ones
    for (const b of this.burning) {
      b.t -= dt;
      if (b.t > 0) continue;
      b.t = Math.max(0.12, 0.7 - b.wd * 0.005) * (this.w.quality === "low" ? 2 : 1);
      this.emit("smoke", b.p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.45, (Math.random() - 0.5) * 0.4)), { size: 0.3 + b.wd * 0.004, life: 2.2 + b.wd * 0.01, color: b.wd >= 60 ? "#2f2b27" : "#6b665f", alpha: 0.35 + b.wd * 0.004, v: new THREE.Vector3(0.12, 0.35 + Math.random() * 0.2, 0.05) });
      if (b.wd >= 60) this.emit("fire", b.p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.35, 0.35 + Math.random() * 0.15, (Math.random() - 0.5) * 0.35)), { size: 0.22 + Math.random() * 0.12, life: 0.45, v: new THREE.Vector3(0, 0.6, 0) });
    }
    // marks: target rings turn, signs bob
    for (const m of this.marks.children) {
      if (m.userData.spin) m.rotation.z += dt * m.userData.spin;
      if (m.isSprite && m.userData.bob !== undefined) { m.userData.bob += dt * 3; m.position.y = (m.userData.target ? 1.25 : 1.1) + Math.sin(m.userData.bob) * 0.08; }
    }
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
        if (q.kind === "fire") q.sp.material.color.setHSL(0.08 - k * 0.06, 1, 0.55 - k * 0.25);
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
