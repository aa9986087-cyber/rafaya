// Small sounds made in the browser (no files): taps, building, coins, a fanfare for a new stage.
import { rainLoop, thunder } from "./rain-sound.js";
/** If a recording cannot load, the rain made in code (js/rain-sound.js RAIN_KINDS) stands in. */
const RAIN_KIND = "soft";
// The owner's own recordings (vendor/sound/): rain looping, a near clap for a strike, far rumbles. Loaded when first needed.
const soundUrl = (name) => globalThis.RAFAYA_ASSETS?.[name] || `./vendor/${name}`;
const recs = {};
function recording(name) {
  return (recs[name] ||= (async () => {
    const a = ac(), url = soundUrl(name);
    const buf = url.startsWith("data:") ? Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (c) => c.charCodeAt(0)).buffer : await (await fetch(url)).arrayBuffer();
    return await new Promise((res, rej) => a.decodeAudioData(buf, res, rej));
  })().catch(() => null));
}
let ctx = null;
let on = true;
try { on = localStorage.getItem("rafaya-sound") !== "0"; } catch { /* default on */ }

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state !== "running") ctx.resume().catch(() => {});
  return ctx;
}
addEventListener("pointerdown", () => { if (ctx && ctx.state !== "running") ctx.resume().catch(() => {}); }, { passive: true });

function tone(f, dur, { type = "sine", vol = 0.1, at = 0, slide = 0 } = {}) {
  if (!on) return;
  if (warTheme.src) vol *= 0.4; // the war theme playing: the game's small sounds stay under it (war sounds keep their own: wtone)
  try {
    const a = ac(), t = a.currentTime + at, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.05);
  } catch { /* no audio */ }
}

// ---------- ambience: wind by day, crickets at night, rain ----------
let amb = null;
function noiseBuffer(a) {
  const b = a.createBuffer(1, a.sampleRate * 2, a.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
  return b;
}
function startAmbience() {
  const a = ac();
  const make = (type, freq, q) => {
    const src = a.createBufferSource(); src.buffer = noiseBuffer(a); src.loop = true;
    const f = a.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = a.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(a.destination); src.start();
    return g;
  };
  // the rain: the owner's recording, looped (the rain made in code while it loads, or if it cannot)
  const rg = a.createGain(); rg.gain.value = 0; rg.connect(a.destination);
  const play = (buf) => { const rs = a.createBufferSource(); rs.buffer = buf; rs.loop = true; rs.connect(rg); rs.start(); return rs; };
  const made = rainLoop(a.sampleRate, RAIN_KIND), mb = a.createBuffer(2, made.left.length, a.sampleRate);
  mb.getChannelData(0).set(made.left); mb.getChannelData(1).set(made.right);
  const first = play(mb);
  recording("sound/rain.mp3").then((buf) => { if (buf) { first.stop(); play(buf); } });
  amb = { wind: make("bandpass", 420, 0.6), rain: rg, nextChirp: 0 };
}
export const ambience = {
  /** Call a few times a second with what is going on. */
  update({ playing, night, raining, season, dusty }) {
    if (!on || !playing) { if (amb) { const t = ctx.currentTime; amb.wind.gain.setTargetAtTime(0, t, 0.3); amb.rain.gain.setTargetAtTime(0, t, 0.3); } return; }
    try {
      if (!amb) startAmbience();
      const t = ctx.currentTime;
      // wind: strong in a dust storm, cold and loud on winter nights
      const duck = warTheme.src ? 0.3 : 1; // the war theme playing: the rain and the wind stay under it (the owner)
      amb.wind.gain.setTargetAtTime((dusty ? 0.08 : season === "winter" ? (night ? 0.03 : 0.04) : night ? 0.012 : 0.03) * duck, t, 1.5);
      amb.rain.gain.setTargetAtTime((raining ? 0.2 : 0) * (warTheme.src ? 0.15 : 1), t, 1); // the rain softer, and well under the war theme (the owner)
      if (night && !raining && season !== "winter" && t > amb.nextChirp) { // no crickets in the winter cold // crickets: three quick high chirps
        for (let i = 0; i < 3; i++) tone(4300 + Math.random() * 300, 0.035, { type: "sine", vol: 0.012, at: i * 0.06 });
        amb.nextChirp = t + 0.6 + Math.random() * 1.6;
      }
    } catch { /* no audio */ }
  }
};

// ---------- «موسيقى الحرب»: the owner's theme, always playing in the background (over and over); its own volume in the settings ----------
// Played through the Web Audio gain (an <audio> element's volume cannot be set on an iPhone), faded in and out.
let warVol = 0.5; try { const v = Number(localStorage.getItem("rafaya-war-vol-v2")); if (Number.isFinite(v) && localStorage.getItem("rafaya-war-vol-v2") !== null) warVol = Math.max(0, Math.min(1, v)); } catch { /* default */ }
/** The theme is switched off for now (the owner, 27 Nov 2026): nothing plays and the settings show no slider. */
export const WAR_MUSIC_ON = false;
const warTheme = { src: null, gain: null, until: 0, listeners: new Set() };
const warTell = () => { for (const f of warTheme.listeners) try { f(warMusic.playing); } catch { /* a screen gone */ } };
export const warMusic = {
  get volume() { return warVol; },
  get playing() { return !!warTheme.src; },
  onChange(f) { warTheme.listeners.add(f); return () => warTheme.listeners.delete(f); },
  setVolume(v) {
    warVol = Math.max(0, Math.min(1, Number(v) || 0));
    try { localStorage.setItem("rafaya-war-vol-v2", String(warVol)); } catch { /* fine */ }
    if (warVol <= 0) { warMusic.stop(); return; }
    if (!warTheme.src) { warMusic.play(); return; }
    if (warTheme.gain) { const a = ac(), g = warTheme.gain.gain; g.cancelScheduledValues(a.currentTime); g.setTargetAtTime(warVol * 0.9, a.currentTime, 0.08); }
  },
  async play() {
    if (!WAR_MUSIC_ON || !on || warVol <= 0 || warMusic.playing) return;
    const buf = await recording("sound/war-theme.mp3"); if (!buf) return;
    try {
      const a = ac(), src = a.createBufferSource(), g = a.createGain(), t = a.currentTime;
      src.buffer = buf; src.loop = true; // it plays over and over while the war lasts (the owner)
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.001, warVol * 0.9), t + 2.5);
      src.connect(g).connect(a.destination); src.start(t);
      warTheme.src = src; warTheme.gain = g; warTheme.until = Infinity;
      src.onended = () => { if (warTheme.src === src) { warTheme.src = null; warTheme.gain = null; warTheme.until = 0; warTell(); } };
      warTell();
    } catch { /* no audio */ }
  },
  stop() {
    const s = warTheme.src, g = warTheme.gain; if (!s) return;
    try { const a = ac(); g.gain.cancelScheduledValues(a.currentTime); g.gain.setTargetAtTime(0.0001, a.currentTime, 0.35); s.stop(a.currentTime + 1.6); } catch { /* gone */ }
    warTheme.src = null; warTheme.gain = null; warTheme.until = 0; warTell();
  }
};

export const sfx = {
  get on() { return on; },
  set(v) { on = v; try { localStorage.setItem("rafaya-sound", v ? "1" : "0"); } catch { /* fine */ } if (!v) warMusic.stop(); else warMusic.play(); },
  tap() { tone(620, 0.05, { type: "triangle", vol: 0.05 }); },
  build() { tone(180, 0.12, { type: "square", vol: 0.05, slide: -60 }); tone(330, 0.1, { type: "triangle", vol: 0.06, at: 0.06 }); },
  road() { tone(260, 0.04, { type: "triangle", vol: 0.03 }); },
  remove() { tone(220, 0.18, { type: "sawtooth", vol: 0.04, slide: -120 }); },
  deny() { tone(160, 0.16, { type: "square", vol: 0.04 }); },
  coin() { tone(988, 0.08, { type: "triangle", vol: 0.06 }); tone(1319, 0.14, { type: "triangle", vol: 0.06, at: 0.07 }); },
  goal() { [659, 784, 988].forEach((f, i) => tone(f, 0.16, { type: "triangle", vol: 0.07, at: i * 0.09 })); },
  era() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.28, { type: "triangle", vol: 0.08, at: i * 0.12 })); },
  /** Rushing water: filtered noise that swells and fades over a few seconds. */
  flood() {
    if (!on) return;
    try {
      const a = ac(), t = a.currentTime, src = a.createBufferSource();
      src.buffer = noiseBuffer(a);
      src.loop = true;
      const f = a.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(300, t); f.frequency.linearRampToValueAtTime(1100, t + 1.5); f.frequency.linearRampToValueAtTime(400, t + 6);
      const g = a.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 1.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 6.5);
      src.connect(f).connect(g).connect(a.destination); src.start(t); src.stop(t + 7);
    } catch { /* no audio */ }
    tone(90, 0.8, { type: "sawtooth", vol: 0.04, slide: -40 });
  },
  /** Thunder: near 0..1 (a near strike cracks first), after `delay` seconds (light comes before sound). */
  thunder(near = 0.5, delay = 0) {
    if (!on) return;
    const name = near > 0.6 ? "sound/thunder-near.mp3" : Math.random() < 0.5 ? "sound/thunder-far.mp3" : "sound/thunder-far2.mp3";
    recording(name).then((rec) => {
      try {
        const a = ac(); let buf = rec;
        if (!buf) { const th = thunder(a.sampleRate, near, Math.floor(Math.random() * 1e6)); buf = a.createBuffer(2, th.left.length, a.sampleRate); buf.getChannelData(0).set(th.left); buf.getChannelData(1).set(th.right); }
        const src = a.createBufferSource(), g = a.createGain(); src.buffer = buf; g.gain.value = (near > 0.6 ? 0.8 : 0.35 + near) * (warTheme.src ? 0.25 : 1);
        src.connect(g).connect(a.destination); src.start(a.currentTime + delay);
      } catch { /* no audio */ }
    });
  },
  prayer() { [294, 392, 349].forEach((f, i) => tone(f, 0.7, { type: "sine", vol: 0.035, at: i * 0.45 })); },
  levelUp() { [784, 988, 1175].forEach((f, i) => tone(f, 0.12, { type: "sine", vol: 0.04, at: i * 0.06 })); },
  event() { tone(440, 0.2, { type: "sine", vol: 0.06 }); tone(554, 0.25, { type: "sine", vol: 0.05, at: 0.12 }); }
};

// ---------- «صراع الجوف»: war sounds (they can be turned off alone, in the settings) ----------
let warOn = true;
try { warOn = localStorage.getItem("rafaya-war-sound") !== "0"; } catch { /* default on */ }
/** A burst of filtered noise: rockets, blasts, whooshes. */
function noiseHit(dur, { from = 800, to = 200, vol = 0.2, type = "lowpass", at = 0, attack = 0.01 } = {}) {
  if (!on || !warOn) return;
  try {
    const a = ac(), t = a.currentTime + at, src = a.createBufferSource();
    src.buffer = noiseBuffer(a);
    const f = a.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
    const g = a.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(a.destination); src.start(t); src.stop(t + dur + 0.05);
  } catch { /* no audio */ }
}
const wtone = (...args) => { if (warOn) tone(...args); };
export const warSfx = {
  get on() { return warOn; },
  set(v) { warOn = v; try { localStorage.setItem("rafaya-war-sound", v ? "1" : "0"); } catch { /* fine */ } },
  /** The siren: rising and falling. */
  alarm() { for (let i = 0; i < 3; i++) { wtone(520, 0.42, { type: "sawtooth", vol: 0.035, at: i * 0.5, slide: 380 }); } },
  /** The launcher getting ready: hydraulics and beeps. */
  prep() { noiseHit(1.4, { from: 300, to: 900, vol: 0.05, type: "bandpass", attack: 0.3 }); [0, 0.5, 1].forEach((t) => wtone(1200, 0.08, { type: "square", vol: 0.025, at: t })); },
  launch() { noiseHit(2.4, { from: 1800, to: 120, vol: 0.28, attack: 0.04 }); wtone(70, 1.6, { type: "sawtooth", vol: 0.06, slide: -30 }); },
  drone() { wtone(180, 1.8, { type: "sawtooth", vol: 0.025, slide: 60 }); wtone(185, 1.8, { type: "sawtooth", vol: 0.02, slide: 70 }); },
  whoosh() { noiseHit(0.9, { from: 3000, to: 500, vol: 0.12, type: "bandpass", attack: 0.3 }); },
  intercept() { noiseHit(0.8, { from: 2500, to: 400, vol: 0.12, attack: 0.02 }); },
  airBurst() { noiseHit(1.2, { from: 1400, to: 90, vol: 0.3 }); wtone(60, 0.7, { type: "sine", vol: 0.12, slide: -25 }); },
  boom() { noiseHit(1.8, { from: 900, to: 50, vol: 0.42 }); wtone(48, 1.1, { type: "sine", vol: 0.18, slide: -20 }); noiseHit(0.5, { from: 4000, to: 800, vol: 0.06, type: "highpass", at: 0.08 }); },
  ok() { [784, 1047].forEach((f, i) => wtone(f, 0.14, { type: "triangle", vol: 0.05, at: i * 0.1 })); }
};

// the theme starts with the first touch (phones only let sound start after one) and keeps playing
addEventListener("pointerdown", () => { if (!warTheme.src && !warTheme.starting) { warTheme.starting = true; warMusic.play().finally(() => { warTheme.starting = false; }); } }, { passive: true });
