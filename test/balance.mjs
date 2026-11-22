// Automatic mayors, to check the economy: can a sensible player grow the town, and can a careless
// one go broke? Runs are repeatable (seeded randomness).
import { newGame, step, build, cantBuild, startResearch, analyze, idx, inMap, buyPlot, plotPrice, decide, optionCost, rng, owns, repairAll, upgradeHouse, upgradeCost, houseBlocker, takeLoan } from "../js/sim.js";
import { B, TECH, MAP_SIZE as N, ERAS, PLOTS, DECISIONS, LOANS } from "../js/data.js";

/**
 * Player styles:
 *  careful  — income first (farms, shops while the market has room), keeps water and power ahead,
 *             adds homes as they fill, and services only when the income can carry their costs
 *  spender  — builds whatever it can afford, never looks at the income
 *  taxer    — careful, but tax at 20%
 *  yesman   — careful, but says yes to every decision it can pay for
 *  miser    — careful, but never builds services
 */
export function autoplay(hours = 250, seed = 42, log = false, style = "careful") {
  const s = newGame(seed);
  const r = rng(seed * 31 + 7);
  const nearRoad = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inMap(x + dx, y + dy) && ["road", "asphalt"].includes(s.tiles[idx(x + dx, y + dy)].b?.id));
  const free = (cb) => { for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) if (owns(s, x, y) && cb(x, y)) return true; return false; };
  // Streets on a grid (every 4th column and 3rd row) so there is always room to grow.
  const place = (id) => {
    if (s.money < B[id].cost) return false;
    const def = B[id];
    const wadiFirst = id === "palms" || id === "veg";
    const ok = (x, y, wadiOnly) => {
      const t = s.tiles[idx(x, y)];
      if (t.b || t.t === "rock" || t.t === "fayda") return false;
      if (wadiOnly && t.t !== "wadi") return false;
      if (id === "road") return nearRoad(x, y) && (x % 4 === 0 || y % 3 === 0) && !build(s, x, y, id);
      if (x % 4 === 0 || y % 3 === 0) return false; // keep the street grid free
      if (["home", "shop", "serv", "deco", "proj"].includes(def.cat) && !nearRoad(x, y)) return false;
      return !build(s, x, y, id);
    };
    return (wadiFirst && free((x, y) => ok(x, y, true))) || free((x, y) => ok(x, y, false));
  };
  // Water and power reach only so far: put a source next to the homes it should serve.
  const placeNear = (id, targets, needRoad = false) => {
    if (!targets.length || s.money < B[id].cost) return false;
    const cx = targets.reduce((n, i) => n + (i % N), 0) / targets.length, cy = targets.reduce((n, i) => n + Math.floor(i / N), 0) / targets.length;
    const spots = [];
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      const t = s.tiles[idx(x, y)];
      if (!owns(s, x, y) || t.b || t.t === "rock" || t.t === "fayda" || x % 4 === 0 || y % 3 === 0) continue;
      if (needRoad && !nearRoad(x, y)) continue;
      spots.push([Math.hypot(x - cx, y - cy), x, y]);
    }
    spots.sort((p, q) => p[0] - q[0]);
    for (const [, x, y] of spots.slice(0, needRoad ? 60 : 12)) if (!build(s, x, y, id)) return true;
    return false;
  };
  const services = ["mosque", "school", "clinic", "park", "police", "civil", "stadium", "bigmosque", "hospital"];
  let si = 0, lastPower = -99, lastWater = -99;
  for (let h = 0; h < hours; h++) {
    const a = analyze(s);
    if (style === "taxer") s.tax = 20;
    // borrower: careful, but builds a bank early and always keeps the biggest loan it can get
    if (style === "borrower") {
      if (!a.count.bank && s.money > B.bank.cost + 300) place("bank");
      if (a.count.bank && !(s.loans || []).length) for (const o of [...LOANS].reverse()) if (!takeLoan(s, o.id, a)) break;
    }
    if (s.decision) {
      const d = DECISIONS.find((x) => x.id === s.decision.id), c0 = optionCost(s, a, d.options[0]);
      decide(s, style === "yesman" ? (c0 <= s.money ? 0 : d.options.length - 1) : d.id === "loan" || c0 <= s.money * 0.4 ? 0 : d.options.length - 1);
    }
    // Upkeep: the careful mayors repair once things wear (spender and miser never do), and insure a big town.
    if (style !== "spender" && style !== "miser" && a.repairBill > 0 && (h % 24 === 0 || a.repairBill > s.money * 0.5)) repairAll(s);
    const saving = style !== "spender" && a.repairBill > s.money; // repairs come before anything new
    if (style === "careful" || style === "yesman") s.insured = s.era >= 1;
    const target = 10 + s.pop * 0.04; // the income a careful mayor wants to keep
    const marketFull = a.shopRaw >= a.shopDemand * 0.85;
    if (style === "spender") {
      // whatever it can afford, every hour
      const ids = Object.keys(B).filter((k) => k !== "road" && B[k].era <= s.era && (!B[k].tech || s.tech[B[k].tech]));
      place(ids[Math.floor(r() * ids.length)]);
      if (a.unconnected || r() < 0.3) place("road");
      if (a.waterRatio < 1) place(s.era >= 1 ? "tank" : "well");
      if (s.era >= 1 && (!a.grid || a.powerRatio < 1)) place("generator");
    } else if (!saving) {
      // 1. water and power before they run short
      const waterSrc = s.era >= 2 && s.tech.desal ? "desal" : s.era >= 1 ? "tank" : "well";
      const powerSrc = s.tech.solar ? "solar" : s.era >= 2 ? "powerplant" : "generator";
      const homes = [];
      s.tiles.forEach((t, i) => { if (t.b?.id === "house" && t.b.works) homes.push(i); });
      // homes waiting for power to become villas, or villas without it
      const dark = homes.filter((i) => !a.powered[i] && (s.tiles[i].b.lvl >= 3 || (s.tiles[i].b.lvl === 2 && s.happy + (s.tiles[i].b.local || 0) * 0.6 >= 60 && /الكهرباء/.test(houseBlocker(s, a, i % N, Math.floor(i / N))))));
      const dry = homes.filter((i) => !a.watered[i]);
      if (dry.length && h - lastWater >= 24) { if (placeNear(waterSrc, dry)) lastWater = h; }
      else if (a.waterRatio < 1 || a.waterSupply < a.waterUse + 3) placeNear(waterSrc, homes);
      if (s.era >= 1 && h - lastPower >= 24 && s.money > B[powerSrc].cost + 2500) {
        if ((dark.length && placeNear(powerSrc, dark)) || (a.grid && a.powerRatio < 1 && placeNear(powerSrc, homes))) lastPower = h;
      }
      // upgrade homes that are ready, cheapest first, keeping money for running the town
      const ready = homes.filter((i) => !houseBlocker(s, a, i % N, Math.floor(i / N))).sort((p, q) => s.tiles[p].b.lvl - s.tiles[q].b.lvl);
      let ups = 0;
      for (const i of ready) { if (ups >= 2 || s.money < upgradeCost(s.tiles[i].b) * 1.3 + 200) break; if (!upgradeHouse(s, i % N, Math.floor(i / N), a)) ups++; }
      // 2. income: farms and industry sell outside; shops only while the market has room
      if (a.net < target || a.unemployment > 0.25) {
        // a shop if the market has room and it can be paid for; otherwise what sells outside
        const shop = s.era >= 1 ? "souq" : "grocery", farm = s.era >= 1 ? (s.tech.packing && h % 2 ? "datefactory" : "workshop") : (h % 2 ? "palms" : "veg");
        place(!marketFull && s.money >= B[shop].cost ? shop : farm);
      }
      // 3. homes when the town is nearly full, with a road
      // homes close together, near the others (pipes and wires reach only so far)
      if (s.pop >= a.cap * 0.7 || a.cap < 20) { if (!placeNear("house", homes.length ? homes : [idx(N / 2, N / 2 + 3)], true)) place("house"); if (a.unconnected) place("road"); }
      if (h % 5 === 0) place("road");
      // 4. services only when the income carries them
      // (it counts the new building's running cost before deciding)
      if (style !== "miser") { const id = services[si % services.length]; if (B[id].era > s.era) si++; else if (a.net - B[id].upkeep > target + 5 && s.money > B[id].cost + 300 && s.pop >= 70 * services.slice(0, si).filter((k) => a.count[k]).length + 20) { placeNear(id, homes.length ? homes : [idx(N / 2, N / 2 + 3)], true) || place(id); si++; } }
      if (style !== "miser" && s.era >= 1 && a.net > target + 60 && s.money > 6000) placeNear(["mandi", "cafe", "stadium", "park"][h % 4], homes, true);
      if (s.era >= 2 && a.net > target + 200 && s.money > 15000) place(["mall", "hotel", "factory"][h % 3]);
    }
    for (const p of PLOTS) if (!s.owned[p.id] && s.money > plotPrice(s) * 1.5) buyPlot(s, p.id);
    for (const t of Object.keys(TECH)) if (!s.research && !s.tech[t] && s.money > TECH[t].cost * 2) startResearch(s, t);
    step(s, r);
    if (s.era > (s.eraAt || []).length) (s.eraAt ||= []).push(s.day);
    if (s.money < (s.low ?? 1e9)) s.low = s.money;
    if (log && s.day % 100 === 0) { const b = analyze(s); console.log(`hour ${s.day} | ${ERAS[s.era].name} | pop ${s.pop} | money ${Math.round(s.money)} | net/hour ${b.net} | happy ${Math.round(s.happy)} | water ${b.waterRatio.toFixed(2)} power ${b.powerRatio.toFixed(2)} | houses ${b.levels}${s.broke ? " | BANKRUPT" : ""}`); }
  }
  return s;
}
if (process.argv[1]?.endsWith("balance.mjs")) autoplay(Number(process.argv[2]) || 1500, Number(process.argv[3]) || 42, true, process.argv[4] || "careful");
