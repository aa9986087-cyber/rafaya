// node scripts/rain-preview.mjs <out dir>: renders each kind of rain (with a thunder clap in it) to a WAV, to listen to.
import fs from "node:fs";
import { rainLoop, thunder, RAIN_KINDS } from "../js/rain-sound.js";

const out = process.argv[2] || ".", sr = 44100, sec = 24;
fs.mkdirSync(out, { recursive: true });
function wav(path, left, right) {
  const n = left.length, b = Buffer.alloc(44 + n * 4);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 4, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { b.writeInt16LE(Math.max(-1, Math.min(1, left[i])) * 32767 | 0, 44 + i * 4); b.writeInt16LE(Math.max(-1, Math.min(1, right[i])) * 32767 | 0, 46 + i * 4); }
  fs.writeFileSync(path, b);
}
for (const kind of Object.keys(RAIN_KINDS)) {
  const loop = rainLoop(sr, kind), n = sr * sec, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { const j = i % loop.left.length, fadeIn = Math.min(1, i / (sr * 1.5)), fadeOut = Math.min(1, (n - i) / (sr * 1.5)); L[i] = loop.left[j] * fadeIn * fadeOut; R[i] = loop.right[j] * fadeIn * fadeOut; }
  // a far rumble at 8 s and a near strike at 15 s
  for (const [at, near, seed] of [[8, 0.2, 3], [15, 0.9, 7]]) {
    const t = thunder(sr, near, seed), s = Math.round(at * sr);
    for (let i = 0; i < t.left.length && s + i < n; i++) { L[s + i] += t.left[i]; R[s + i] += t.right[i]; }
  }
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = peak > 0.95 ? 0.95 / peak : 1;
  for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
  wav(`${out}/rain-${kind}.wav`, L, R);
  console.log(kind);
}
