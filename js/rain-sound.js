// The rain and the thunder, made in code (no sound files): a few seconds of rain are drawn once into a buffer
// that loops without a seam, and each thunder clap is drawn when it happens. Pure math, so it runs the same in
// the browser and in node (where scripts/rain-preview.mjs renders samples to listen to).

/** A small seeded random, so a variant always sounds the same. */
function rand(seed) { let x = seed >>> 0 || 1; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** Pink noise (Paul Kellet's filter): the soft, even hiss of rain on sand. */
function pink(n, r) {
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
  }
  return out;
}
/** One-pole filters, in place. */
function lowpass(x, sr, f) { const k = 1 - Math.exp(-2 * Math.PI * f / sr); let y = 0; for (let i = 0; i < x.length; i++) { y += k * (x[i] - y); x[i] = y; } return x; }
function highpass(x, sr, f) { const k = 1 - Math.exp(-2 * Math.PI * f / sr); let y = 0; for (let i = 0; i < x.length; i++) { y += k * (x[i] - y); x[i] -= y; } return x; }

/**
 * The kinds of rain the owner chooses from:
 *  soft  — a light, steady rain on sand and palm leaves
 *  heavy — a downpour with gusts
 *  roof  — rain on a tin roof and tents: bright drops ringing
 *  storm — a downpour with the wind howling and distant rumbles (the thunder itself comes from thunder())
 */
export const RAIN_KINDS = {
  soft: { hiss: 0.55, low: 0.18, drops: 70, dropVol: 0.35, ring: 0, gust: 0.15, wind: 0 },
  heavy: { hiss: 0.95, low: 0.45, drops: 260, dropVol: 0.3, ring: 0, gust: 0.35, wind: 0.1 },
  roof: { hiss: 0.45, low: 0.15, drops: 150, dropVol: 0.55, ring: 1, gust: 0.15, wind: 0 },
  storm: { hiss: 1.05, low: 0.6, drops: 300, dropVol: 0.28, ring: 0, gust: 0.55, wind: 0.45 }
};

/** A seamless loop of rain, stereo: { left, right } at this sample rate, `sec` seconds long. */
export function rainLoop(sr, kind = "soft", sec = 8) {
  const k = RAIN_KINDS[kind] || RAIN_KINDS.soft, n = Math.round(sr * sec), fade = Math.round(sr * 0.6), m = n + fade;
  const r = rand(0x9e37 + Object.keys(RAIN_KINDS).indexOf(kind) * 7919);
  const ch = [0, 1].map((c) => {
    // the body of the rain: bright hiss and a softer, lower wash
    const hiss = highpass(lowpass(pink(m, r), sr, 7000), sr, 900);
    const low = lowpass(pink(m, r), sr, 700);
    const out = new Float32Array(m);
    for (let i = 0; i < m; i++) out[i] = hiss[i] * k.hiss + low[i] * k.low * 2.2;
    // gusts: the rain swells and fades, slowly (different on each side, so it moves around you)
    let g = 0.5, gv = 0;
    for (let i = 0; i < m; i++) { if (i % 64 === 0) { gv += (r() - 0.5) * 0.002; gv *= 0.995; g = Math.max(0, Math.min(1, g + gv)); } out[i] *= 1 - k.gust + k.gust * (0.4 + g); }
    // wind under the storm
    if (k.wind) { const w = lowpass(lowpass(pink(m, r), sr, 380), sr, 380); for (let i = 0; i < m; i++) out[i] += w[i] * k.wind * 3 * (0.5 + 0.5 * Math.sin(i / sr * 0.7 + c)); }
    // single drops: a tick with a little pitch (on a roof they ring)
    const count = Math.round(k.drops * sec);
    for (let d = 0; d < count; d++) {
      const at = Math.floor(r() * m), amp = k.dropVol * Math.pow(r(), 2.2) * (c ? 0.6 + r() * 0.8 : 0.6 + r() * 0.8);
      const f = k.ring ? 1800 + r() * 3800 : 2500 + r() * 5000, dec = k.ring ? 0.012 + r() * 0.03 : 0.002 + r() * 0.006;
      const len = Math.min(m - at, Math.round(sr * dec * 6));
      for (let i = 0; i < len; i++) {
        const t = i / sr, e = Math.exp(-t / dec);
        out[at + i] += amp * e * (Math.sin(2 * Math.PI * f * t) * (k.ring ? 0.9 : 0.5) + (r() * 2 - 1) * (k.ring ? 0.15 : 0.6) * Math.exp(-t / 0.0015));
      }
    }
    // the loop's end fades into its start, so it never clicks
    for (let i = 0; i < fade; i++) { const a = i / fade; out[i] = out[i] * a + out[n + i] * (1 - a); }
    return out.subarray(0, n);
  });
  // even out the level between kinds
  let peak = 0; for (const x of ch) for (let i = 0; i < x.length; i += 7) peak = Math.max(peak, Math.abs(x[i]));
  const s = 0.55 / (peak || 1);
  for (const x of ch) for (let i = 0; i < x.length; i++) x[i] *= s;
  return { left: ch[0], right: ch[1] };
}

/**
 * A thunder clap, stereo. near 0..1: far off is a long low rumble; near is a sharp crack first, then the rumble.
 */
export function thunder(sr, near = 0.5, seed = 1) {
  const r = rand(seed * 2654435761), sec = 5 + (1 - near) * 2, n = Math.round(sr * sec);
  const ch = [0, 1].map((c) => {
    const rum = lowpass(lowpass(pink(n, r), sr, 140 + near * 120), sr, 160 + near * 120);
    const out = new Float32Array(n);
    // the rumble rolls: a few swells, each a little later and quieter
    const swells = Array.from({ length: 4 + Math.floor(r() * 3) }, (_, i) => ({ at: (0.05 + i * (0.45 + r() * 0.5)) * (1 + (1 - near)), amp: Math.pow(0.72, i) * (0.7 + r() * 0.5) }));
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let env = 0;
      for (const s of swells) { const d = t - s.at; if (d > 0) env += s.amp * (d < 0.08 ? d / 0.08 : Math.exp(-(d - 0.08) / (0.6 + (1 - near) * 0.8))); }
      out[i] = rum[i] * env * 9 * (c ? 0.9 : 1.1);
    }
    // the crack of a near strike: a bright tearing burst
    if (near > 0.4) {
      const crack = highpass(pink(Math.round(sr * 0.6), r), sr, 1200);
      for (let i = 0; i < crack.length; i++) { const t = i / sr; out[i] += crack[i] * near * 2.6 * Math.exp(-t / 0.09) * (0.6 + 0.4 * Math.sin(t * 90 + c)); }
    }
    for (let i = n - Math.round(sr * 0.5); i < n; i++) out[i] *= (n - i) / (sr * 0.5);
    return out;
  });
  let peak = 0; for (const x of ch) for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const s = (0.45 + near * 0.45) / (peak || 1);
  for (const x of ch) for (let i = 0; i < x.length; i++) x[i] *= s;
  return { left: ch[0], right: ch[1] };
}
