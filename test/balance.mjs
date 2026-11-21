// A simple automatic mayor, to check the town can grow from village to province and money stays sane.
import { newGame, step, build, cantBuild, startResearch, analyze, idx, inMap, buyPlot, plotPrice } from "../js/sim.js";
import { B, TECH, MAP_SIZE as N, ERAS, PLOTS } from "../js/data.js";

export function autoplay(days = 250, seed = 42, log = false) {
  const s = newGame(seed);
  const order = ["house", "house", "road", "well", "palms", "house", "road", "mosque", "house", "grocery", "road", "house", "school", "clinic", "park", "house", "cafe", "veg"];
  const free = (cb) => { for (let y = 2; y < N - 2; y++) for (let x = 2; x < N - 2; x++) if (cb(x, y)) return true; return false; };
  const nearRoad = (x, y) => [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => inMap(x+dx,y+dy) && ["road","asphalt"].includes(s.tiles[idx(x+dx,y+dy)].b?.id));
  const place = (id) => free((x, y) => {
    if (s.tiles[idx(x, y)].b || s.tiles[idx(x, y)].t === "rock") return false;
    if (id !== "road" && B[id].cat !== "util" && B[id].cat !== "farm" && !nearRoad(x, y)) return false;
    // Roads follow a street grid so there is always room to grow, like a player planning blocks.
    if (id === "road" && (!nearRoad(x, y) || (x % 4 !== 0 && y % 3 !== 0))) return false;
    if (id !== "road" && x % 4 !== 0 && y % 3 !== 0 ? false : id !== "road" && B[id].cat !== "util" && B[id].cat !== "farm") return false;
    return !build(s, x, y, id);
  });
  let i = 0;
  for (let d = 0; d < days; d++) {
    const a = analyze(s);
    // Keep water and power ahead of demand, then grow.
    if (a.waterRatio < 1) place(s.era >= 2 && !cantBuild(s, 0, 0, "desal") ? "desal" : s.era >= 1 ? "tank" : "well");
    if (s.era >= 1 && !a.grid && s.money > B.generator.cost) place("generator");
    if (s.era >= 1 && a.powerRatio < 1) place(s.tech.solar ? "solar" : s.era >= 2 ? "powerplant" : "generator");
    if (a.unemployment > 0.3) place(s.era >= 1 ? (s.tech.packing ? "datefactory" : "souq") : "grocery");
    if (s.money > (s.era ? 900 : 350)) { place(order[i % order.length]); i++; place("road"); }
    if (s.money > 4500 && s.era >= 1) place(["police", "stadium", "mandi", "workshop"][d % 4]);
    if (s.money > 12000 && s.era >= 2) place(["hospital", "bigmosque", "mall", "factory"][d % 4]);
    for (const p of PLOTS) if (!s.owned[p.id] && s.money > plotPrice(s) * 1.5) buyPlot(s, p.id);
    for (const t of Object.keys(TECH)) if (!s.research && !s.tech[t]) startResearch(s, t);
    step(s);
    if (log && s.day % 100 === 0) console.log(`day ${s.day} | ${ERAS[s.era].name} | pop ${s.pop} | money ${Math.round(s.money)} | net/day ${analyze(s).net} | happy ${Math.round(s.happy)} | water ${analyze(s).waterRatio.toFixed(2)} power ${analyze(s).powerRatio.toFixed(2)} | houses L ${analyze(s).levels}`);
  }
  return s;
}
if (process.argv[1]?.endsWith("balance.mjs")) autoplay(Number(process.argv[2]) || 1500, 42, true);
