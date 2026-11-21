import { test } from "node:test";
import assert from "node:assert/strict";
import { newGame, step, build, demolish, cantBuild, analyze, catchUp, pack, unpack, idx, startResearch, houseBlocker } from "../js/sim.js";
import { B, MAP_SIZE as N } from "../js/data.js";
import { autoplay } from "./balance.mjs";

const fixedRandom = () => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };

test("a new village: a street, three mud houses, a well, palms on the wadi, some money", () => {
  const s = newGame(1);
  const ids = s.tiles.filter((t) => t.b).map((t) => t.b.id);
  assert.equal(ids.filter((i) => i === "house").length, 3);
  assert.ok(ids.includes("well") && ids.includes("palms") && ids.includes("road"));
  assert.ok(s.tiles.some((t) => t.t === "wadi") && s.tiles.some((t) => t.t === "rock"));
  assert.equal(s.money, 1500);
});

test("building: costs money, needs the right stage and research, and rocks cost extra to clear", () => {
  const s = newGame(2);
  const spot = s.tiles.findIndex((t) => !t.b && t.t === "sand");
  const x = spot % N, y = Math.floor(spot / N);
  assert.match(cantBuild(s, x, y, "souq"), /بلدة/);
  assert.match(cantBuild(s, x, y, "solar"), /بلدة|بحث/);
  const before = s.money;
  assert.equal(build(s, x, y, "house"), "");
  assert.equal(s.money, before - B.house.cost);
  assert.match(cantBuild(s, x, y, "well"), /مشغول/);
  const rock = s.tiles.findIndex((t) => !t.b && t.t === "rock");
  const m = s.money;
  build(s, rock % N, Math.floor(rock / N), "well");
  assert.equal(s.money, m - B.well.cost - 40);
  assert.equal(demolish(s, x, y), "");
  assert.equal(s.tiles[idx(x, y)].b, null);
});

test("a house without a road houses nobody", () => {
  const s = newGame(3);
  const spot = s.tiles.findIndex((t, i) => !t.b && t.t === "sand" && ![[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => s.tiles[i + dx + dy * N]?.b));
  build(s, spot % N, Math.floor(spot / N), "house");
  const a = analyze(s);
  assert.equal(a.unconnected, 1);
  assert.equal(houseBlocker(s, a, spot % N, Math.floor(spot / N)), "يحتاج طريق");
});

test("research takes days and stays", () => {
  const s = newGame(4);
  assert.equal(startResearch(s, "irrigation"), "");
  assert.match(startResearch(s, "irrigation"), /بحث/);
  for (let i = 0; i < 6; i++) step(s, fixedRandom());
  assert.equal(s.tech.irrigation, true);
  assert.equal(s.research, null);
});

test("a sensible mayor grows the village into a town and then a city", () => {
  const s = autoplay(260, 42);
  assert.ok(s.era >= 2, `reached stage ${s.era} with ${s.pop} people`);
  assert.ok(s.money > 0);
  const a = analyze(s);
  assert.ok(a.levels[2] + a.levels[3] > 10, "houses grew into villas and towers");
});

test("saving keeps the whole town, and the town carries on while away (up to 60 days)", () => {
  const s = autoplay(40, 5);
  const back = unpack(pack(s));
  assert.equal(back.pop, s.pop);
  assert.equal(back.tiles.filter((t) => t.b).length, s.tiles.filter((t) => t.b).length);
  assert.deepEqual(back.tiles.map((t) => t.b?.lvl ?? -1), s.tiles.map((t) => t.b?.lvl ?? -1));
  back.savedAt = Date.now() - 1000 * 60 * 60 * 24; // a day away
  const r = catchUp(back);
  assert.equal(r.days, 60);
  assert.throws(() => unpack("{}"));
});
