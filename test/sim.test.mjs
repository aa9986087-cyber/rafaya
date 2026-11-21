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
  const s = autoplay(1600, 42);
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

test("decisions about the village: they show up for a reason and do what they say", async () => {
  const { DECISIONS } = await import("../js/data.js");
  const { decide, seasonOf } = await import("../js/sim.js");
  const s = newGame(21);
  const a = analyze(s);
  const thirst = DECISIONS.find((d) => d.id === "thirst");
  assert.equal(thirst.when(s, a, seasonOf(s.day)), false, "no thirst while water is enough");
  assert.equal(thirst.when(s, { ...a, waterRatio: 0.5 }, seasonOf(s.day)), true);
  s.decision = { id: "tentsworn" };
  const before = s.money;
  assert.ok(decide(s, 0).ok);
  assert.equal(s.money, before - 20 * a.levels[0], "20 riyals a tent");
  s.money = -100;
  s.decision = { id: "loan" };
  decide(s, 0);
  assert.equal(s.money, 2900);
  assert.ok(analyze(s).loan > 0, "the loan is paid back every hour");
});

test("the residents remember: they ask, hold the mayor to a promise, and thank him when it is done", async () => {
  const news = await import("../js/news.js");
  const { seasonOf, onRoad } = await import("../js/sim.js");
  const s = newGame(5);
  for (let i = 0; i < 40; i++) step(s, fixedRandom());
  s.pop = 70; s.money = 5000;
  const season = seasonOf(s.day);
  news.writePosts(s, analyze(s), season, 4);
  const post = { who: "abunasser", topic: "mosque", mood: -1, text: "" };
  assert.deepEqual(news.replyOptions(post).map((o) => o.kind), ["promise", "calm", "refuse"]);
  const r = news.answerPost(s, analyze(s), season, post, "promise");
  assert.ok(r.change > 0, "a promise cheers him");
  assert.equal(s.promises.length, 1);
  const i = s.tiles.findIndex((t, k) => !t.b && t.t !== "rock" && owns(s, k % N, Math.floor(k / N)) && onRoad(s, k % N, Math.floor(k / N)));
  build(s, i % N, Math.floor(i / N), "mosque");
  const posts = news.followUps(s, analyze(s), season);
  assert.ok(posts.some((p) => /وفيت بوعدك/.test(p.text)), "thanks the mayor for the kept promise");
  assert.equal(s.promises.length, 0);
});

test("fobbing a resident off brings them back, and they will not take it twice", async () => {
  const news = await import("../js/news.js");
  const { seasonOf } = await import("../js/sim.js");
  const s = newGame(5);
  for (let i = 0; i < 40; i++) step(s, fixedRandom());
  s.pop = 70;
  const season = seasonOf(s.day);
  const post = { who: "umsaad", topic: "school", mood: -1, text: "" };
  assert.equal(news.answerPost(s, analyze(s), season, post, "calm").change, 0);
  assert.equal(s.comebacks.length, 1);
  s.day += 25;
  const back = news.followUps(s, analyze(s), seasonOf(s.day)).find((p) => p.who === "umsaad");
  assert.ok(back && back.noCalm, "she comes back and wants a yes or a no");
  assert.deepEqual(news.replyOptions(back).map((o) => o.kind), ["promise", "refuse"]);
  const before = news.moodOf(s, "umsaad");
  news.answerPost(s, analyze(s), seasonOf(s.day), back, "refuse");
  assert.ok(news.moodOf(s, "umsaad") < before, "refusing upsets her");
});
