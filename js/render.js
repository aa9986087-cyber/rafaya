// Isometric drawing of the town. Everything is drawn with canvas shapes (no image files).
import { MAP_SIZE as N, B } from "./data.js";
import { idx, inMap } from "./sim.js";

export const TW = 64, TH = 32; // one tile on screen at zoom 1

/** Top corner of tile (x, y) in world pixels. */
export const iso = (x, y) => ({ x: (x - y) * TW / 2, y: (x + y) * TH / 2 });

/** Which tile is under a world point. */
export function pickTile(wx, wy) {
  const fx = (wx / (TW / 2) + wy / (TH / 2)) / 2;
  const fy = (wy / (TH / 2) - wx / (TW / 2)) / 2;
  return { x: Math.floor(fx), y: Math.floor(fy) };
}

const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(n >> 16)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
};

function diamond(g, x, y, inset = 0) {
  const p = iso(x, y), cx = p.x, cy = p.y + TH / 2;
  const w = TW / 2 * (1 - inset), h = TH / 2 * (1 - inset);
  g.beginPath();
  g.moveTo(cx, cy - h); g.lineTo(cx + w, cy); g.lineTo(cx, cy + h); g.lineTo(cx - w, cy); g.closePath();
}

/** A box standing on the tile: footprint inset, height in pixels, one base colour shaded per face. */
function box(g, x, y, inset, height, color, { top, ox = 0, oy = 0, sx = 1, sy = 1 } = {}) {
  const p = iso(x, y), cx = p.x + ox, cy = p.y + TH / 2 + oy;
  const w = TW / 2 * (1 - inset) * sx, h = TH / 2 * (1 - inset) * sy;
  // left face
  g.fillStyle = shade(color, 0.82);
  g.beginPath(); g.moveTo(cx - w, cy); g.lineTo(cx, cy + h); g.lineTo(cx, cy + h - height); g.lineTo(cx - w, cy - height); g.closePath(); g.fill();
  // right face
  g.fillStyle = shade(color, 0.66);
  g.beginPath(); g.moveTo(cx + w, cy); g.lineTo(cx, cy + h); g.lineTo(cx, cy + h - height); g.lineTo(cx + w, cy - height); g.closePath(); g.fill();
  // top
  g.fillStyle = top || shade(color, 1.06);
  g.beginPath(); g.moveTo(cx, cy - h - height); g.lineTo(cx + w, cy - height); g.lineTo(cx, cy + h - height); g.lineTo(cx - w, cy - height); g.closePath(); g.fill();
  return { cx, cy: cy - height, w, h };
}

/** Little windows on the two visible faces of a box. */
function windows(g, b, height, rows, color = "#3b2a1a", every = 3) {
  g.fillStyle = color;
  for (let r = 0; r < rows; r++) {
    const yy = b.cy + height - 8 - r * (height - 6) / Math.max(1, rows) - 4;
    for (let i = 1; i < every; i++) {
      const t = i / every;
      g.fillRect(b.cx - b.w * (1 - t) - 1.5, yy + b.h * t - 2, 3, 4);
      g.fillRect(b.cx + b.w * (1 - t) - 1.5, yy + b.h * t - 2, 3, 4);
    }
  }
}

function palm(g, px, py, s = 1, t = 0) {
  g.strokeStyle = "#7a5530"; g.lineWidth = 2.4 * s;
  g.beginPath(); g.moveTo(px, py); g.quadraticCurveTo(px + 2 * s, py - 10 * s, px + 1 * s, py - 20 * s); g.stroke();
  const sway = Math.sin(t * 1.5 + px * 0.1) * 1.5 * s;
  g.strokeStyle = "#3f8a3c"; g.lineWidth = 2.2 * s; g.lineCap = "round";
  for (const [dx, dy] of [[-9, 3], [9, 3], [-7, -4], [7, -4], [0, -7], [-11, 7], [11, 7]]) {
    g.beginPath(); g.moveTo(px + s, py - 20 * s); g.quadraticCurveTo(px + dx * s * 0.6 + sway, py - 24 * s + dy * 0.3 * s, px + dx * s + sway, py - 20 * s + dy * s); g.stroke();
  }
  g.fillStyle = "#c58b2e"; g.beginPath(); g.arc(px + s, py - 18 * s, 2 * s, 0, Math.PI * 2); g.fill();
}

function tree(g, px, py, s = 1) {
  g.fillStyle = "#6b4a2b"; g.fillRect(px - 1, py - 7 * s, 2, 7 * s);
  g.fillStyle = "#4f9a45"; g.beginPath(); g.arc(px, py - 10 * s, 6 * s, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#62b257"; g.beginPath(); g.arc(px - 2 * s, py - 12 * s, 3.5 * s, 0, Math.PI * 2); g.fill();
}

function dome(g, cx, cy, r, color) {
  g.fillStyle = color;
  g.beginPath(); g.arc(cx, cy, r, Math.PI, 0); g.closePath(); g.fill();
  g.fillStyle = shade(color, 0.75); g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx, cy - r - 5); g.lineWidth = 1.4; g.strokeStyle = shade(color, 0.75); g.stroke();
  g.fillStyle = "rgba(255,255,255,.25)"; g.beginPath(); g.arc(cx - r * 0.35, cy - r * 0.45, r * 0.3, 0, Math.PI * 2); g.fill();
}

function minaret(g, cx, cy, h, color) {
  g.fillStyle = shade(color, 0.8); g.fillRect(cx - 3, cy - h, 6, h);
  g.fillStyle = color; g.fillRect(cx - 4.5, cy - h * 0.7, 9, 3);
  dome(g, cx, cy - h, 4, "#2c8a7a");
}

// ---------- ground ----------

const SAND = ["#e9d3a3", "#e5cd9b", "#ecd8aa"];
function groundColor(t, x, y) {
  const n = ((x * 73856093) ^ (y * 19349663)) >>> 0;
  if (t.t === "wadi") return ["#cdb67c", "#c9b276", "#d2bb82"][n % 3];
  return SAND[n % 3];
}

function drawGround(g, s, x, y) {
  const t = s.tiles[idx(x, y)];
  diamond(g, x, y);
  g.fillStyle = groundColor(t, x, y);
  g.fill();
  g.strokeStyle = "rgba(120, 90, 50, .08)"; g.lineWidth = 1; g.stroke();
  const p = iso(x, y), cx = p.x, cy = p.y + TH / 2;
  if (t.t === "wadi") {
    g.fillStyle = "rgba(110, 140, 70, .35)";
    for (let i = 0; i < 3; i++) { const n = (x * 7 + y * 13 + i * 5) % 11; g.beginPath(); g.ellipse(cx - 14 + n * 3, cy - 4 + (i * 5) % 9, 3, 1.5, 0, 0, Math.PI * 2); g.fill(); }
  }
  if (t.t === "rock" && !t.b) {
    g.fillStyle = "#a99a85"; g.beginPath(); g.ellipse(cx - 6, cy, 8, 5, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#c2b39c"; g.beginPath(); g.ellipse(cx - 8, cy - 2, 5, 3, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#9c8d78"; g.beginPath(); g.ellipse(cx + 8, cy + 3, 5, 3, 0, 0, Math.PI * 2); g.fill();
  }
  if (t.b && (t.b.id === "road" || t.b.id === "asphalt")) drawRoad(g, s, x, y, t.b.id === "asphalt");
}

function drawRoad(g, s, x, y, paved) {
  const p = iso(x, y), cx = p.x, cy = p.y + TH / 2;
  diamond(g, x, y, 0.08);
  g.fillStyle = paved ? "#55565c" : "#c4a172"; g.fill();
  const linked = (dx, dy) => inMap(x + dx, y + dy) && ["road", "asphalt"].includes(s.tiles[idx(x + dx, y + dy)].b?.id);
  g.strokeStyle = paved ? "rgba(255, 236, 160, .8)" : "rgba(120, 85, 45, .35)";
  g.lineWidth = paved ? 1.4 : 2;
  g.setLineDash(paved ? [4, 4] : []);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (!linked(dx, dy)) continue;
    const q = iso(x + dx, y + dy);
    g.beginPath(); g.moveTo(cx, cy); g.lineTo((cx + q.x) / 2, (cy + q.y + TH / 2) / 2); g.stroke();
  }
  g.setLineDash([]);
}

// ---------- buildings ----------

function drawBuilding(g, s, x, y, t, time) {
  const b = t.b, id = b.id, p = iso(x, y), cx = p.x, cy = p.y + TH / 2;
  const works = b.works !== false;
  switch (id) {
    case "road": case "asphalt": return;
    case "house": {
      const lv = b.lvl;
      if (lv === 0) tent(g, cx, cy);
      else if (lv === 1) {
        const bb = box(g, x, y, 0.32, 14, "#c79a63");
        g.fillStyle = "#8a6238"; for (let i = -2; i <= 2; i++) g.fillRect(bb.cx + i * 5 - 1, bb.cy - bb.h * 0.2 - 2, 2, 3);
        g.fillStyle = "#4a3320"; g.fillRect(bb.cx + bb.w * 0.4, bb.cy + 9, 4, 6);
      } else if (lv === 2) {
        const bb = box(g, x, y, 0.22, 18, "#e2c597", { top: "#d8b885" });
        windows(g, bb, 18, 1, "#5a7a8a");
        g.fillStyle = "#2f6f5e"; g.fillRect(bb.cx + bb.w * 0.45, bb.cy + 11, 4, 7);
      } else if (lv === 3) {
        const bb = box(g, x, y, 0.14, 24, "#f2ead9", { top: "#e7dcc5" });
        windows(g, bb, 24, 2, "#4f7d96");
        g.fillStyle = "#2c8a7a"; g.fillRect(bb.cx - 6, bb.cy - bb.h * 0.1 - 4, 12, 4);
        tree(g, cx - 20, cy + 4, 0.7);
      } else {
        const bb = box(g, x, y, 0.1, 58, "#e8e2d6", { top: "#cfc7b8" });
        windows(g, bb, 58, 6, "#4f7d96", 4);
        g.fillStyle = "#c9b8a0"; g.fillRect(bb.cx - 4, bb.cy - 6, 8, 6);
      }
      if (b.upAt && s.day - b.upAt < 2) sparkle(g, cx, cy - 30, time);
      break;
    }
    case "grocery": { const bb = box(g, x, y, 0.2, 16, "#e8d6b8"); awning(g, bb, "#2c8a7a"); sign(g, bb, "#c63a2f"); break; }
    case "cafe": { const bb = box(g, x, y, 0.22, 16, "#d9b98e"); awning(g, bb, "#7a3b1f"); g.fillStyle = "#3b2414"; g.beginPath(); g.arc(cx + 14, cy + 6, 3, 0, Math.PI * 2); g.fill(); break; }
    case "souq": { box(g, x, y, 0.08, 10, "#c98d4d"); for (const [ox, c] of [[-12, "#c63a2f"], [0, "#2c8a7a"], [12, "#d9a540"]]) { g.fillStyle = c; g.beginPath(); g.moveTo(cx + ox - 8, cy - 8); g.lineTo(cx + ox, cy - 16); g.lineTo(cx + ox + 8, cy - 8); g.closePath(); g.fill(); } break; }
    case "mandi": { const bb = box(g, x, y, 0.18, 18, "#e3c9a1"); awning(g, bb, "#b0301f"); smoke(g, bb.cx + 8, bb.cy - 4, time, "rgba(240,240,240,.5)"); break; }
    case "hotel": { const bb = box(g, x, y, 0.08, 64, "#d8cbb4", { top: "#bfb197" }); windows(g, bb, 64, 7, "#3d6f8c", 4); g.fillStyle = "#c63a2f"; g.fillRect(bb.cx - 9, bb.cy + 2, 18, 4); break; }
    case "mall": { const bb = box(g, x, y, 0.04, 34, "#9fc4cf", { top: "#e9e3d6" }); windows(g, bb, 34, 3, "#e9f3f5", 5); g.fillStyle = "#c63a2f"; g.fillRect(bb.cx - 12, bb.cy + 4, 24, 3); break; }
    case "palms": {
      diamond(g, x, y, 0.1); g.fillStyle = t.t === "wadi" ? "#9fb36a" : "#b9b277"; g.fill();
      for (const [ox, oy] of [[-12, 0], [0, -6], [12, 0], [0, 6]]) palm(g, cx + ox, cy + oy, 0.75, time);
      break;
    }
    case "veg": {
      diamond(g, x, y, 0.08); g.fillStyle = "#8a6a43"; g.fill();
      g.strokeStyle = "#5fa34a"; g.lineWidth = 3;
      for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(cx - 20 + i * 4, cy - i * 2 + 2); g.lineTo(cx + i * 4, cy + 10 - i * 2 - 8); g.stroke(); }
      break;
    }
    case "workshop": { const bb = box(g, x, y, 0.16, 18, "#9a9184"); g.fillStyle = "#5c564d"; g.fillRect(bb.cx - 5, bb.cy + 6, 10, 10); break; }
    case "datefactory": { const bb = box(g, x, y, 0.1, 22, "#d6b27a"); chimney(g, bb.cx + 10, bb.cy - 2, 14, time); g.fillStyle = "#7a4a1f"; g.beginPath(); g.arc(bb.cx - 4, bb.cy - 2, 4, 0, Math.PI * 2); g.fill(); break; }
    case "factory": { const bb = box(g, x, y, 0.06, 26, "#8f969c"); chimney(g, bb.cx + 12, bb.cy - 4, 22, time); chimney(g, bb.cx + 2, bb.cy - 6, 18, time + 1); break; }
    case "well": {
      g.fillStyle = "#8b7356"; g.beginPath(); g.ellipse(cx, cy, 11, 6, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#3d6f8c"; g.beginPath(); g.ellipse(cx, cy - 1, 7, 3.5, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "#6b4a2b"; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - 10, cy); g.lineTo(cx - 10, cy - 16); g.lineTo(cx + 10, cy - 16); g.lineTo(cx + 10, cy); g.stroke();
      break;
    }
    case "tank": {
      g.strokeStyle = "#6c7378"; g.lineWidth = 2; for (const ox of [-8, 8]) { g.beginPath(); g.moveTo(cx + ox, cy + 4); g.lineTo(cx + ox * 0.6, cy - 18); g.stroke(); }
      g.fillStyle = "#cfe0e6"; g.beginPath(); g.ellipse(cx, cy - 22, 13, 6, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#a9c6d0"; g.fillRect(cx - 13, cy - 34, 26, 12);
      g.fillStyle = "#e3eef2"; g.beginPath(); g.ellipse(cx, cy - 34, 13, 6, 0, 0, Math.PI * 2); g.fill();
      break;
    }
    case "desal": { const bb = box(g, x, y, 0.06, 18, "#e3eef2"); g.fillStyle = "#3d8fb3"; for (const ox of [-10, 8]) { g.beginPath(); g.ellipse(bb.cx + ox, bb.cy + 2, 7, 3.5, 0, 0, Math.PI * 2); g.fill(); } break; }
    case "generator": { const bb = box(g, x, y, 0.22, 14, "#7d8288"); chimney(g, bb.cx + 6, bb.cy - 2, 12, time); g.fillStyle = "#e0b43a"; g.fillRect(bb.cx - 8, bb.cy + 6, 6, 4); break; }
    case "solar": {
      diamond(g, x, y, 0.08); g.fillStyle = "#d9c89f"; g.fill();
      for (const [ox, oy] of [[-10, -2], [8, -2], [-1, 6]]) {
        g.fillStyle = "#1f3f6b"; g.beginPath(); g.moveTo(cx + ox - 9, cy + oy - 6); g.lineTo(cx + ox + 5, cy + oy - 12); g.lineTo(cx + ox + 9, cy + oy - 4); g.lineTo(cx + ox - 5, cy + oy + 2); g.closePath(); g.fill();
        g.strokeStyle = "#7fa8d8"; g.lineWidth = 0.8; g.stroke();
      }
      break;
    }
    case "powerplant": { const bb = box(g, x, y, 0.04, 22, "#9aa1a6"); g.fillStyle = "#c9cfd3"; g.beginPath(); g.ellipse(bb.cx + 8, bb.cy - 10, 8, 4, 0, 0, Math.PI * 2); g.fill(); g.fillRect(bb.cx, bb.cy - 30, 16, 20); smoke(g, bb.cx + 8, bb.cy - 32, time, "rgba(235,235,235,.6)"); break; }
    case "mosque": { const bb = box(g, x, y, 0.16, 16, "#f1ead9"); dome(g, bb.cx - 2, bb.cy + 2, 10, "#2c8a7a"); minaret(g, bb.cx + bb.w * 0.6, bb.cy + 8, 26, "#efe6d2"); break; }
    case "bigmosque": { const bb = box(g, x, y, 0.04, 20, "#f4eee0"); dome(g, bb.cx, bb.cy + 2, 15, "#d7a93a"); minaret(g, bb.cx - bb.w * 0.75, bb.cy + 10, 40, "#f1ead9"); minaret(g, bb.cx + bb.w * 0.75, bb.cy + 10, 40, "#f1ead9"); break; }
    case "school": { const bb = box(g, x, y, 0.1, 20, "#e9d18a"); windows(g, bb, 20, 2, "#3d6f8c", 4); flag(g, bb.cx - bb.w * 0.6, bb.cy + 6, time); break; }
    case "clinic": { const bb = box(g, x, y, 0.16, 18, "#f6f3ee"); crescent(g, bb.cx, bb.cy - 2); break; }
    case "hospital": { const bb = box(g, x, y, 0.06, 40, "#f7f4ef", { top: "#dfe7ea" }); windows(g, bb, 40, 4, "#4f7d96", 4); crescent(g, bb.cx, bb.cy - 3); break; }
    case "park": {
      diamond(g, x, y, 0.06); g.fillStyle = "#86c06c"; g.fill();
      g.fillStyle = "#e8dcc0"; g.beginPath(); g.ellipse(cx, cy, 6, 3, 0, 0, Math.PI * 2); g.fill();
      tree(g, cx - 14, cy, 0.9); tree(g, cx + 14, cy, 0.9); tree(g, cx, cy - 7, 0.8);
      break;
    }
    case "police": { const bb = box(g, x, y, 0.14, 20, "#e7ecf1"); g.fillStyle = "#1f5aa0"; g.fillRect(bb.cx - bb.w * 0.8, bb.cy + 4, bb.w * 1.6, 4); light(g, bb.cx, bb.cy - 4, time, "#3d7be0"); break; }
    case "civil": { const bb = box(g, x, y, 0.14, 20, "#e9e2d6"); g.fillStyle = "#d1421f"; g.fillRect(bb.cx - bb.w * 0.8, bb.cy + 4, bb.w * 1.6, 4); light(g, bb.cx, bb.cy - 4, time, "#e04a2a"); break; }
    case "stadium": {
      diamond(g, x, y, 0.02); g.fillStyle = "#cfc5b2"; g.fill();
      diamond(g, x, y, 0.22); g.fillStyle = "#4fa64a"; g.fill();
      g.strokeStyle = "rgba(255,255,255,.8)"; g.lineWidth = 1; g.stroke();
      g.beginPath(); g.moveTo(cx - 10, cy - 5); g.lineTo(cx + 10, cy + 5); g.stroke();
      break;
    }
    case "university": { const bb = box(g, x, y, 0.04, 30, "#e2cfa8"); windows(g, bb, 30, 3, "#3d6f8c", 5); dome(g, bb.cx, bb.cy, 10, "#2c6d8a"); break; }
    default: box(g, x, y, 0.2, 16, "#cccccc");
  }
  if (!works) { g.fillStyle = "#d1421f"; g.beginPath(); g.arc(cx, cy - 34, 7, 0, Math.PI * 2); g.fill(); g.fillStyle = "#fff"; g.font = "bold 10px Tajawal, sans-serif"; g.textAlign = "center"; g.fillText("!", cx, cy - 30.5); }
}

/** بيت الشعر: a low black goat-hair tent on poles, with a red-and-white sadu band along the front. */
function tent(g, cx, cy) {
  const w = 22, h = 11, top = 14;
  g.fillStyle = "rgba(60, 40, 20, .18)"; g.beginPath(); g.ellipse(cx, cy + 2, w + 2, h, 0, 0, Math.PI * 2); g.fill();
  // back and side panels
  g.fillStyle = "#2a221d";
  g.beginPath(); g.moveTo(cx - w, cy); g.lineTo(cx, cy - h); g.lineTo(cx + w, cy); g.lineTo(cx + w, cy - 6); g.lineTo(cx, cy - h - 6); g.lineTo(cx - w, cy - 6); g.closePath(); g.fill();
  // the roof: three peaks over the poles
  g.fillStyle = "#3a2f28";
  g.beginPath(); g.moveTo(cx - w - 2, cy - 5); g.lineTo(cx - w * 0.5, cy - top - 3); g.lineTo(cx - 3, cy - top + 1); g.lineTo(cx + w * 0.15, cy - top - 2);
  g.lineTo(cx + w * 0.6, cy - top + 2); g.lineTo(cx + w + 2, cy - 4); g.lineTo(cx + 2, cy + h - 6); g.closePath(); g.fill();
  g.strokeStyle = "rgba(255, 255, 255, .12)"; g.lineWidth = 1;
  g.beginPath(); g.moveTo(cx - w * 0.5, cy - top - 3); g.lineTo(cx - w * 0.15, cy + h - 8); g.moveTo(cx + w * 0.15, cy - top - 2); g.lineTo(cx + w * 0.4, cy + h - 9); g.stroke();
  // open front with the sadu curtain
  g.fillStyle = "#1c1612"; g.beginPath(); g.moveTo(cx - w + 2, cy - 4); g.lineTo(cx + 2, cy + h - 6); g.lineTo(cx + 2, cy + h - 1); g.lineTo(cx - w + 2, cy + 1); g.closePath(); g.fill();
  const band = ["#b3261e", "#f1e4c8", "#b3261e", "#1c1612"];
  for (let i = 0; i < 8; i++) {
    const t0 = i / 8, t1 = (i + 1) / 8;
    g.fillStyle = band[i % band.length];
    g.beginPath();
    g.moveTo(cx - w + 2 + (w) * t0, cy - 4 + (h - 2) * t0); g.lineTo(cx - w + 2 + (w) * t1, cy - 4 + (h - 2) * t1);
    g.lineTo(cx - w + 2 + (w) * t1, cy - 1.5 + (h - 2) * t1); g.lineTo(cx - w + 2 + (w) * t0, cy - 1.5 + (h - 2) * t0); g.closePath(); g.fill();
  }
  // tent ropes and pegs
  g.strokeStyle = "rgba(90, 70, 50, .6)"; g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(cx - w - 2, cy - 5); g.lineTo(cx - w - 8, cy + 2); g.moveTo(cx + w + 2, cy - 4); g.lineTo(cx + w + 8, cy + 3); g.stroke();
}

function awning(g, b, color) {
  g.fillStyle = color;
  g.beginPath(); g.moveTo(b.cx - b.w, b.cy + 10); g.lineTo(b.cx, b.cy + b.h + 10); g.lineTo(b.cx, b.cy + b.h + 6); g.lineTo(b.cx - b.w, b.cy + 6); g.closePath(); g.fill();
}
function sign(g, b, color) { g.fillStyle = color; g.fillRect(b.cx - 6, b.cy - 6, 12, 5); }
function crescent(g, cx, cy) {
  g.fillStyle = "#c63a2f"; g.beginPath(); g.arc(cx, cy, 5, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#f6f3ee"; g.beginPath(); g.arc(cx + 2.2, cy - 1, 4.2, 0, Math.PI * 2); g.fill();
}
function flag(g, px, py, t) {
  g.strokeStyle = "#555"; g.lineWidth = 1.2; g.beginPath(); g.moveTo(px, py); g.lineTo(px, py - 22); g.stroke();
  const w = Math.sin(t * 3) * 1.5;
  g.fillStyle = "#2c8a4a"; g.beginPath(); g.moveTo(px, py - 22); g.lineTo(px + 12, py - 20 + w); g.lineTo(px, py - 16); g.closePath(); g.fill();
}
function chimney(g, px, py, h, t) { g.fillStyle = "#6b6f73"; g.fillRect(px - 2.5, py - h, 5, h); smoke(g, px, py - h, t, "rgba(220,220,220,.55)"); }
function smoke(g, px, py, t, color) {
  g.fillStyle = color;
  for (let i = 0; i < 3; i++) { const k = (t * 0.6 + i / 3) % 1; g.globalAlpha = 1 - k; g.beginPath(); g.arc(px + Math.sin((t + i) * 2) * 3 * k, py - k * 18, 2.5 + k * 4, 0, Math.PI * 2); g.fill(); }
  g.globalAlpha = 1;
}
function light(g, px, py, t, color) { g.fillStyle = Math.sin(t * 6) > 0 ? color : "#ffffff"; g.beginPath(); g.arc(px, py, 2.4, 0, Math.PI * 2); g.fill(); }
function sparkle(g, px, py, t) { g.fillStyle = "rgba(255, 220, 110, .9)"; for (let i = 0; i < 4; i++) { const a = t * 2 + i * 1.57; g.beginPath(); g.arc(px + Math.cos(a) * 8, py + Math.sin(a) * 4, 1.8, 0, Math.PI * 2); g.fill(); } }

// ---------- the frame ----------

/**
 * Draw the town. view: { cam: {x, y, zoom}, w, h, dpr, hover, tool, preview, overlay }.
 * overlay: tiles to tint (a Float32Array of 0..1 values and a colour), e.g. the reach of a service.
 */
export function draw(g, s, view, time) {
  const { cam, w, h, dpr } = view;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#f3dfb4"); sky.addColorStop(1, "#e7c891");
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  g.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, dpr * (w / 2 - cam.x * cam.zoom), dpr * (h / 2 - cam.y * cam.zoom));
  // Only draw tiles that can be on screen.
  const half = { x: w / 2 / cam.zoom, y: h / 2 / cam.zoom };
  const vis = (x, y) => { const p = iso(x, y); return p.x > cam.x - half.x - TW && p.x < cam.x + half.x + TW && p.y > cam.y - half.y - TH * 2 && p.y < cam.y + half.y + TH * 4; };
  for (let d = 0; d < N * 2 - 1; d++) for (let x = Math.max(0, d - N + 1); x <= Math.min(N - 1, d); x++) {
    const y = d - x;
    if (vis(x, y)) drawGround(g, s, x, y);
  }
  if (view.overlay) {
    const { values, color } = view.overlay;
    for (let i = 0; i < N * N; i++) if (values[i] > 0) { const x = i % N, y = (i / N) | 0; diamond(g, x, y, 0.04); g.fillStyle = color.replace("A", String(Math.min(0.45, 0.12 + values[i] * 0.02))); g.fill(); }
  }
  if (view.hover) {
    const { x, y, ok } = view.hover;
    if (inMap(x, y)) { diamond(g, x, y); g.fillStyle = ok === false ? "rgba(209, 66, 31, .35)" : "rgba(255, 255, 255, .35)"; g.fill(); g.strokeStyle = ok === false ? "#d1421f" : "#fff"; g.lineWidth = 2 / cam.zoom; g.stroke(); }
  }
  for (let d = 0; d < N * 2 - 1; d++) for (let x = Math.max(0, d - N + 1); x <= Math.min(N - 1, d); x++) {
    const y = d - x;
    const t = s.tiles[idx(x, y)];
    if (t.b && vis(x, y)) drawBuilding(g, s, x, y, t, time);
    if (view.preview && view.preview.x === x && view.preview.y === y && !t.b) {
      g.globalAlpha = 0.65;
      drawBuilding(g, s, x, y, { t: t.t, b: { id: view.preview.id, lvl: 0, works: true } }, time);
      g.globalAlpha = 1;
    }
  }
}

/** The whole map's middle, for centring the camera. */
export const mapCenter = () => { const p = iso(N / 2, N / 2); return { x: p.x, y: p.y }; };
export const mapPreviewColor = (id) => (B[id]?.pollute ? "rgba(209, 66, 31, A)" : "rgba(44, 138, 122, A)");

/** A small picture of a building for the build cards. */
export function thumb(canvas, id) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = canvas.clientWidth || 112, h = canvas.clientHeight || 64;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const g = canvas.getContext("2d");
  const fake = { day: 0, tiles: [] };
  const scale = 1.15;
  g.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * w / 2, dpr * (h / 2 + 4));
  g.translate(0, -TH / 2 + 6);
  diamond(g, 0, 0); g.fillStyle = "#ead4a4"; g.fill();
  if (id === "road" || id === "asphalt") { diamond(g, 0, 0, 0.08); g.fillStyle = id === "asphalt" ? "#55565c" : "#c4a172"; g.fill(); return; }
  drawBuilding(g, fake, 0, 0, { t: "sand", b: { id, lvl: id === "house" ? 0 : 0, works: true } }, 0.5);
}
