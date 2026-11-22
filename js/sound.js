// Small sounds made in the browser (no files): taps, building, coins, a fanfare for a new stage.
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
  amb = { wind: make("bandpass", 420, 0.6), rain: make("highpass", 1800, 0.4), nextChirp: 0 };
}
export const ambience = {
  /** Call a few times a second with what is going on. */
  update({ playing, night, raining }) {
    if (!on || !playing) { if (amb) { const t = ctx.currentTime; amb.wind.gain.setTargetAtTime(0, t, 0.3); amb.rain.gain.setTargetAtTime(0, t, 0.3); } return; }
    try {
      if (!amb) startAmbience();
      const t = ctx.currentTime;
      amb.wind.gain.setTargetAtTime(night ? 0.012 : 0.03, t, 1.5);
      amb.rain.gain.setTargetAtTime(raining ? 0.05 : 0, t, 1);
      if (night && !raining && t > amb.nextChirp) { // crickets: three quick high chirps
        for (let i = 0; i < 3; i++) tone(4300 + Math.random() * 300, 0.035, { type: "sine", vol: 0.012, at: i * 0.06 });
        amb.nextChirp = t + 0.6 + Math.random() * 1.6;
      }
    } catch { /* no audio */ }
  }
};

export const sfx = {
  get on() { return on; },
  set(v) { on = v; try { localStorage.setItem("rafaya-sound", v ? "1" : "0"); } catch { /* fine */ } },
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
  levelUp() { [784, 988, 1175].forEach((f, i) => tone(f, 0.12, { type: "sine", vol: 0.04, at: i * 0.06 })); },
  event() { tone(440, 0.2, { type: "sine", vol: 0.06 }); tone(554, 0.25, { type: "sine", vol: 0.05, at: 0.12 }); }
};
