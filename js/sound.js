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
  event() { tone(440, 0.2, { type: "sine", vol: 0.06 }); tone(554, 0.25, { type: "sine", vol: 0.05, at: 0.12 }); }
};
