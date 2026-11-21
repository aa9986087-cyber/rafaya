import { test } from "node:test";
import assert from "node:assert/strict";
import { newGame, step, build, demolish, cantBuild, analyze, catchUp, pack, unpack, idx, startResearch, houseBlocker, owns, buyPlot, plotAt } from "../js/sim.js";
import { B, MAP_SIZE as N, START_MONEY } from "../js/data.js";
import { autoplay } from "./balance.mjs";

const fixedRandom = () => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };

test("a new village: a street, three tents, a well, palms on the wadi, some money", () => {
  const s = newGame(1);
  const ids = s.tiles.filter((t) => t.b).map((t) => t.b.id);
  assert.equal(ids.filter((i) => i === "house").length, 3);
  assert.ok(ids.includes("well") && ids.includes("palms") && ids.includes("road"));
  assert.ok(s.tiles.some((t) => t.t === "wadi") && s.tiles.some((t) => t.t === "rock"));
  assert.equal(s.money, START_MONEY);
});

test("building: costs money, needs the right stage and research, and rocks cost extra to clear", () => {
  const s = newGame(2);
  const spot = s.tiles.findIndex((t, i) => !t.b && t.t === "sand" && owns(s, i % N, Math.floor(i / N)));
  const x = spot % N, y = Math.floor(spot / N);
  assert.match(cantBuild(s, x, y, "souq"), /بلدة/);
  assert.match(cantBuild(s, x, y, "solar"), /بلدة|بحث/);
  const before = s.money;
  assert.equal(build(s, x, y, "house"), "");
  assert.equal(s.money, before - B.house.cost);
  assert.match(cantBuild(s, x, y, "well"), /مشغول/);
  const rock = s.tiles.findIndex((t, i) => !t.b && t.t === "rock" && owns(s, i % N, Math.floor(i / N)));
  const m = s.money;
  build(s, rock % N, Math.floor(rock / N), "well");
  assert.equal(s.money, m - B.well.cost - 40);
  assert.equal(demolish(s, x, y), "");
  assert.equal(s.tiles[idx(x, y)].b, null);
});

test("a house without a road houses nobody", () => {
  const s = newGame(3);
  const spot = s.tiles.findIndex((t, i) => !t.b && t.t === "sand" && owns(s, i % N, Math.floor(i / N)) && ![[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => s.tiles[i + dx + dy * N]?.b));
  build(s, spot % N, Math.floor(spot / N), "house");
  const a = analyze(s);
  assert.equal(a.unconnected, 1);
  assert.equal(houseBlocker(s, a, spot % N, Math.floor(spot / N)), "يحتاج طريق");
});

test("research takes days and stays", () => {
  const s = newGame(4);
  s.money = 5000;
  assert.equal(startResearch(s, "irrigation"), "");
  assert.match(startResearch(s, "irrigation"), /بحث/);
  for (let i = 0; i < 6; i++) step(s, fixedRandom());
  assert.equal(s.tech.irrigation, true);
  assert.equal(s.research, null);
});

test("a sensible mayor grows the village into a town and then a city", () => {
  const s = autoplay(800, 42);
  assert.ok(s.era >= 2, `reached stage ${s.era} with ${s.pop} people`);
  assert.ok(s.money > 0);
  const a = analyze(s);
  assert.ok(a.levels[3] + a.levels[4] > 10, "houses grew into villas and towers");
});

test("saving keeps the whole town, and the town carries on while away (up to six town days)", () => {
  const s = autoplay(40, 5);
  const back = unpack(pack(s));
  assert.equal(back.pop, s.pop);
  assert.equal(back.tiles.filter((t) => t.b).length, s.tiles.filter((t) => t.b).length);
  assert.deepEqual(back.tiles.map((t) => t.b?.lvl ?? -1), s.tiles.map((t) => t.b?.lvl ?? -1));
  back.savedAt = Date.now() - 1000 * 60 * 60 * 24; // a day away
  const r = catchUp(back);
  assert.equal(r.days, 144);
  assert.throws(() => unpack("{}"));
});

test("land around the town is bought plot by plot, each dearer than the last", () => {
  const s = newGame(9);
  assert.equal(plotAt(0, 0), "n");
  assert.match(cantBuild(s, 0, 0, "house"), /مو لك/);
  s.money = 100000;
  assert.equal(buyPlot(s, "n"), "");
  assert.equal(s.money, 100000 - 6000);
  assert.ok(owns(s, 0, 0));
  assert.equal(buyPlot(s, "e"), "");
  assert.equal(s.money, 100000 - 6000 - 12000);
  assert.match(buyPlot(s, "n"), /من قبل/);
});

test("a save from the old 30×30 map opens with the town in the middle", () => {
  const s = newGame(11);
  const small = JSON.parse(pack(s));
  small.tiles = Array.from({ length: 900 }, (_, i) => (i === 465 ? ":house:1:3" : ""));
  const back = unpack(JSON.stringify(small));
  assert.equal(back.tiles.length, N * N);
  assert.equal(back.tiles[idx((465 % 30) + 5, Math.floor(465 / 30) + 5)].b.id, "house");
});
