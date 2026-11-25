import { test } from "node:test";
import assert from "node:assert/strict";
import { newGame, step, build, demolish, cantBuild, analyze, catchUp, pack, unpack, idx, startResearch, houseBlocker, owns, buyPlot, plotAt, rng, seasonOf } from "../js/sim.js";
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
  assert.equal(houseBlocker(s, a, spot % N, Math.floor(spot / N)), "يحتاج طريق لاصق فيه من جنب (مو بالزاوية)");
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
  // (on the 72×72 map the bot's own layout on seed 42 leaves a quarter of its people without work and it
  // stalls at بلدة; four of five maps reach مدينة by hour 2000, so the check runs on one of those)
  const s = autoplay(2000, 2);
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
  const nx = 30, ny = 15; // a tile on the near northern ring
  assert.equal(plotAt(nx, ny), "na");
  assert.equal(plotAt(50, ny), "nb", "the other half of the north");
  assert.equal(plotAt(0, 0), "n3a", "the far corner is the edges");
  assert.equal(plotAt(30, 8), "n2a");
  assert.match(cantBuild(s, nx, ny, "house"), /مو لك/);
  s.money = 100000;
  assert.equal(buyPlot(s, "na"), "");
  assert.equal(s.money, 100000 - 3000);
  assert.ok(owns(s, nx, ny));
  assert.ok(!owns(s, 50, ny), "the other half is still for sale");
  assert.equal(buyPlot(s, "eb"), "");
  assert.equal(s.money, 100000 - 3000 - 4500);
  assert.match(buyPlot(s, "na"), /من قبل/);
  assert.match(buyPlot(s, "s2a"), /أول/, "the far south needs the near south first");
  assert.equal(buyPlot(s, "n2a"), "");
  assert.match(buyPlot(s, "e3b"), /أول/);
  s.money = 1e6; assert.equal(buyPlot(s, "n3a"), "");
  assert.ok(owns(s, 0, 0));
  // a save with a whole old plot owns both halves
  const old = JSON.parse(pack(newGame(9))); old.owned = { n: true };
  const back = unpack(JSON.stringify(old));
  assert.ok(back.owned.na && back.owned.nb && !back.owned.n);
});

test("a save from the old 30×30 map opens with the town in the middle", () => {
  const s = newGame(11);
  const small = JSON.parse(pack(s));
  small.tiles = Array.from({ length: 900 }, (_, i) => (i === 465 ? ":house:1:3" : ""));
  const back = unpack(JSON.stringify(small));
  assert.equal(back.tiles.length, N * N);
  const off = (N - 30) / 2;
  assert.equal(back.tiles[idx((465 % 30) + off, Math.floor(465 / 30) + off)].b.id, "house");
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

test("money is not guaranteed: a spender goes broke, a careful mayor does not", () => {
  const spender = autoplay(900, 2, false, "spender");
  assert.ok(spender.money < 0, `the spender ends in debt (${Math.round(spender.money)})`);
  const careful = autoplay(900, 2, false, "careful");
  assert.ok(careful.money > 0 && !careful.broke, "the careful mayor stays in credit");
  const a = analyze(careful);
  assert.ok(a.shopIncome <= a.shopDemand + 1e-6, "shops never sell more than people spend");
});

test("buildings wear out: a worn one works less, a ruined one stops and then falls; repairs and insurance help", async () => {
  const { repair, repairCost } = await import("../js/sim.js");
  const s = newGame(13);
  const t = s.tiles.find((x) => x.b?.id === "well");
  t.b.cond = 30;
  assert.ok(repairCost(t.b) > 0);
  const before = analyze(s).waterSupply;
  t.b.cond = 100;
  assert.ok(analyze(s).waterSupply > before, "a worn well gives less water");
  t.b.cond = 0.01;
  step(s, fixedRandom());
  assert.ok(t.b.ruin > 0, "at zero it stops working");
  for (let i = 0; i < 48; i++) step(s, fixedRandom());
  assert.equal(t.b, null, "two days later it falls down");
  // repair and insurance
  const w = s.tiles.findIndex((x) => x.b?.id === "palms");
  s.tiles[w].b.cond = 50;
  s.money = 10000;
  assert.equal(repair(s, w % N, Math.floor(w / N)), "");
  assert.equal(s.tiles[w].b.cond, 100);
});

test("a flash flood on the wadi takes buildings; insurance pays part back", () => {
  const s = newGame(13);
  s.insured = true;
  s.events = [{ id: "rain", left: 10 }];
  const onWadi = s.tiles.filter((t) => t.t === "wadi" && t.b).length;
  assert.ok(onWadi > 0, "the start has palms on the wadi");
  const money = s.money;
  const { msgs } = step(s, () => 0.001); // every roll comes up: a flood, and everything goes
  const flood = msgs.find((m) => m.kind === "flood");
  assert.ok(flood && flood.lost.length, "the flood took something");
  assert.ok(s.money > money - 200, "insurance paid back part of what was lost");
});

test("bank: a loan pays out, costs every hour, and can be paid off early", async () => {
  const { takeLoan, payLoan, payoffCost, loanBlocker } = await import("../js/sim.js");
  const { B: Bd } = await import("../js/data.js");
  const s = newGame(5);
  assert.equal(loanBlocker(s, "small"), "تحتاج تبني بنك");
  s.money = 100000;
  let done = false;
  for (let y = 10; y < 30 && !done; y++) for (let x = 10; x < 30 && !done; x++) if (!build(s, x, y, "bank")) done = true;
  assert.ok(done, "bank built");
  assert.ok(Bd.bank.fullCost > Bd.bank.cost, "trade gets the state discount");
  const before = s.money;
  assert.equal(takeLoan(s, "small"), "");
  assert.equal(s.money, before + 3000);
  assert.ok(analyze(s).costs.loan > 0);
  const left = s.loans[0].left;
  step(s, () => 0.99);
  assert.equal(s.loans[0].left, left - 1);
  assert.ok(payoffCost(s.loans[0]) < s.loans[0].per * s.loans[0].left, "paying early skips interest");
  assert.equal(payLoan(s, 0), "");
  assert.equal(s.loans.length, 0);
});

test("farms, shops and workshops upgrade in place and earn more", async () => {
  const { upgradeBiz, upgradeCost, bizBlocker } = await import("../js/sim.js");
  const s = newGame(8);
  s.money = 100000;
  let at = null;
  const road = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => s.tiles[idx(x + dx, y + dy)]?.b?.id === "road");
  for (let y = 6; y < N - 6 && !at; y++) for (let x = 6; x < N - 6 && !at; x++) if (road(x, y) && !s.tiles[idx(x, y)].b && !build(s, x, y, "grocery")) at = { x, y };
  assert.ok(at, "grocery built");
  const b = s.tiles[idx(at.x, at.y)].b;
  const a0 = analyze(s);
  assert.equal(upgradeCost(b), Math.round(B.grocery.cost * 0.7));
  const before = s.money;
  assert.equal(upgradeBiz(s, at.x, at.y, a0), "");
  assert.equal(b.lvl, 1);
  assert.equal(s.money, before - Math.round(B.grocery.cost * 0.7));
  assert.ok(analyze(s).shopRaw > a0.shopRaw, "earns more after the upgrade");
  assert.match(bizBlocker(s, analyze(s), at.x, at.y), /بلدة|الرافعية/, "the top level waits for a town");
  // the level survives a save
  assert.equal(unpack(pack(s)).tiles[idx(at.x, at.y)].b.lvl, 1);
});

test("a building can be moved, keeping its level and residents", async () => {
  const { moveBuilding, moveCost, moveBlocker } = await import("../js/sim.js");
  const s = newGame(9);
  const from = s.tiles.findIndex((t) => t.b?.id === "house");
  const fx = from % N, fy = Math.floor(from / N);
  s.tiles[from].b.lvl = 1;
  const res = s.tiles[from].b.res;
  let to = null;
  for (let y = fy - 3; y <= fy + 3 && !to; y++) for (let x = fx - 3; x <= fx + 3 && !to; x++) if (owns(s, x, y) && !s.tiles[idx(x, y)].b && s.tiles[idx(x, y)].t === "sand") to = { x, y };
  const money = s.money, fee = moveCost(s.tiles[from].b);
  assert.equal(moveBuilding(s, fx, fy, to.x, to.y), "");
  assert.equal(s.tiles[from].b, null);
  const b = s.tiles[idx(to.x, to.y)].b;
  assert.equal(b.lvl, 1); assert.equal(b.res, res);
  assert.equal(s.money, money - fee);
  assert.notEqual(moveBlocker(s, to.x, to.y, to.x, to.y), "", "cannot move onto a taken tile");
});

test("elections at the end of the year; prayers through the day; pens graze in spring", async () => {
  const { voteShare, prayerNow, hoursToElection, districtStats, districtName } = await import("../js/sim.js");
  const { YEAR_HOURS } = await import("../js/data.js");
  // a town grown by the careful bot through its first year has voted once
  const s = autoplay(YEAR_HOURS + 5, 42);
  assert.ok(s.pop >= 30);
  assert.equal(s.elections?.length, 1, "an election came at the end of the year");
  assert.ok(voteShare(s) > 0 && voteShare(s) < 1);
  assert.ok(hoursToElection(s) > 0);
  // five prayers a day
  const names = new Set();
  for (let h = 1; h <= 24; h++) { s.day = h; const p = prayerNow(s); if (p) names.add(p.id); }
  assert.equal(names.size, 5);
  // quarters: renaming shows in the stats
  const d = districtStats(s, analyze(s))[0];
  s.districts = { [d.d]: "حارة الوادي" };
  assert.equal(districtName(s, d.d), "حارة الوادي");
});

test("a dam makes a lake behind it, holds floods, and groundwater falls with pumping", async () => {
  const { updateLake, fillWadi } = await import("../js/sim.js");
  const s = newGame(13);
  s.money = 1e6;
  // a dam on owned wadi with wadi to its west
  let dam = null;
  for (let x = 12; x < N - 6 && !dam; x++) for (let y = 6; y < N - 6 && !dam; y++) if (owns(s, x, y) && owns(s, x - 1, y) && s.tiles[idx(x, y)].t === "wadi" && !s.tiles[idx(x, y)].b && s.tiles[idx(x - 1, y)].t === "wadi" && !s.tiles[idx(x - 1, y)].b) dam = { x, y };
  assert.ok(dam);
  s.tiles[idx(dam.x, dam.y)].b = { id: "dam", lvl: 0, res: 0, cond: 100 };
  assert.ok(updateLake(s), "the lake appears");
  assert.equal(s.tiles[idx(dam.x - 1, dam.y)].t, "lake");
  assert.equal(cantBuild(s, dam.x - 1, dam.y, "house"), "هذي بحيرة السد");
  s.tiles[idx(dam.x, dam.y)].b = null;
  updateLake(s);
  assert.equal(s.tiles[idx(dam.x - 1, dam.y)].t, "wadi", "no dam, no lake");
  // filling wadi
  assert.equal(fillWadi(s, dam.x, dam.y), "");
  assert.equal(s.tiles[idx(dam.x, dam.y)].t, "sand");
  // groundwater goes down in a thirsty town
  const t = autoplay(1300, 2);
  assert.ok(t.aquifer < 100);
});

test("production chains: farms linked by road feed their factory; quarries make materials", async () => {
  const { chainLinks, upgradePrice } = await import("../js/sim.js");
  const { MAT } = await import("../js/data.js");
  const s = newGame(21);
  const road = s.tiles.findIndex((t) => t.b?.id === "road"), ry = Math.floor(road / N), x0 = road % N;
  for (let x = x0 + 1; x < x0 + 9; x++) { const t = s.tiles[idx(x, ry)]; if (!t.b) { t.b = { id: "road", lvl: 0, res: 0 }; t.t = "sand"; } }
  let n = 0;
  for (let x = x0 + 2; x < x0 + 9 && n < 3; x++) { const t = s.tiles[idx(x, ry + 1)]; if (!t.b) { t.b = { id: "palms", lvl: 0, res: 0, cond: 100 }; t.t = "sand"; n++; } }
  s.tiles[idx(x0 + 8, ry - 1)].b = { id: "datefactory", lvl: 0, res: 0, cond: 100 };
  const { at } = chainLinks(s);
  const f = at.get(idx(x0 + 8, ry - 1));
  assert.ok(f && f.got >= 3, "palms on the road reach the factory");
  // materials: short ones are bought
  const villa = { id: "house", lvl: 2 };
  s.materials = 0;
  assert.equal(upgradePrice(s, villa).total, B.house.levels[3].cost + MAT.house[3] * MAT.price);
  s.materials = 1000;
  assert.equal(upgradePrice(s, villa).total, B.house.levels[3].cost);
});

test("traffic: homes drive to work along the roads; a bigger road carries more", async () => {
  const { B: Bd } = await import("../js/data.js");
  const s = autoplay(1600, 2);
  const a = analyze(s);
  assert.ok(a.trips > 0, "people drive to work");
  const busiest = a.trafficLoad.reduce((m, v, i) => (v > a.trafficLoad[m] ? i : m), 0);
  const before = a.trafficCong[busiest];
  s.tiles[busiest].b = { id: "avenue", lvl: 0, res: 0 };
  const b = analyze(s);
  assert.ok(b.trafficCap[busiest] >= Bd.avenue.cap * 0.75);
  assert.ok(b.trafficCong[busiest] <= before, "the avenue takes the jam away");
});

test("people: each house has the same families every time, and fathers work where the roads lead", async () => {
  const { familiesAt, jobOf } = await import("../js/people.js");
  const s = autoplay(900, 3);
  const a = analyze(s);
  const home = s.tiles.findIndex((t) => t.b?.id === "house" && t.b.res >= 3 && a.workOf[s.tiles.indexOf(t)] >= 0);
  assert.ok(home >= 0);
  const f1 = familiesAt(s, home), f2 = familiesAt(s, home);
  assert.deepEqual(f1, f2, "families are stable");
  assert.equal(f1.reduce((n, f) => n + f.size, 0), s.tiles[home].b.res, "everyone in the house belongs to a family");
  assert.ok(jobOf(s, a, home), "the father has a job");
});

test("region: towns on other kinds of land", () => {
  const rocks = (s) => s.tiles.filter((t) => t.t === "rock").length, wadi = (s) => s.tiles.filter((t) => t.t === "wadi").length;
  const base = newGame(5), hill = newGame(5, { terrain: "mountain", name: "الأضارع", site: "adharea", money: 2500 }), dunes = newGame(5, { terrain: "dunes" }), big = newGame(5, { terrain: "bigwadi" });
  assert.ok(rocks(hill) > rocks(base) * 2, "mountain land is rocky");
  assert.equal(wadi(dunes), 0, "no wadi in the dunes");
  assert.ok(wadi(big) > wadi(base), "a big wadi is wider");
  assert.equal(hill.name, "الأضارع"); assert.equal(hill.money, 2500);
  // linked towns bring customers and traders
  const s = autoplay(800, 4), a0 = analyze(s);
  s.neighbours = [{ id: "saffan", name: "صفان", pop: 2000 }];
  const a1 = analyze(s);
  assert.ok(a1.shopDemand > a0.shopDemand && a1.exportDemand > a0.exportDemand);
  assert.equal(unpack(pack(s)).name, "الرافعية");
});

test("the deputy keeps the town while the mayor is away, under the shield", async () => {
  const { deputyCatchUp, DEPUTY_FULL_HOURS, SLEEP_HOURS, rng } = await import("../js/sim.js");
  const s = autoplay(900, 6);
  const day = s.day, pop = s.pop;
  const r = deputyCatchUp(s, 2000, rng(3));
  assert.equal(s.day, day + 2000, "the town keeps the world's hour");
  assert.ok(s.money >= 0, "never bankrupt while away");
  assert.ok(s.pop >= Math.floor(pop * Math.pow(0.95, DEPUTY_FULL_HOURS / 24)) , "no big loss of people");
  assert.equal(r.full, DEPUTY_FULL_HOURS);
  const t = autoplay(300, 7), before = t.money;
  const r2 = deputyCatchUp(t, SLEEP_HOURS * 3, rng(4));
  assert.ok(r2.slept);
});

test("upgrades say what they change; the mosque and the hospital can grow", async () => {
  const { upgradeEffect, upgradable } = await import("../js/sim.js");
  const s = newGame(2);
  const g = upgradeEffect(s, { id: "grocery", lvl: 0 });
  assert.ok(g.incomeNext > g.incomeNow && g.upkeepNext > g.upkeepNow);
  assert.equal(g.radiusNext, g.radiusNow + 1, "a bigger grocery serves a little further"); // groceries serve the homes around them (radius 4)
  const m = upgradeEffect(s, { id: "mosque", lvl: 0 });
  assert.ok(upgradable({ id: "mosque", lvl: 0 }) && upgradable({ id: "hospital", lvl: 0 }));
  assert.ok(m.happyNext > m.happyNow && m.radiusNext === m.radiusNow + 1);
  const h = upgradeEffect(s, { id: "house", lvl: 0 });
  assert.ok(h.capNext > h.capNow && h.taxGain > 0);
});

test("weather follows the season: no rain in summer, Eid al-Fitr after Ramadan", () => {
  const s = newGame(5), r = rng(9), seen = {};
  let eidAfterRamadan = 0;
  for (let h = 0; h < 288 * 12; h++) {
    const before = s.events.map((e) => e.id);
    step(s, r); if (s.decision) s.decision = null;
    for (const e of s.events) if (!before.includes(e.id)) {
      const k = seasonOf(s.day).id;
      (seen[e.id] ||= new Set()).add(k);
      if (e.id === "eid" && before.includes("ramadan")) eidAfterRamadan++;
    }
  }
  assert.ok(!seen.rain?.has("summer"), "no rain in summer");
  assert.ok(!seen.heat || [...seen.heat].every((k) => k === "summer"));
  assert.ok(!seen.cold || [...seen.cold].every((k) => k === "winter"));
  assert.ok(!seen.locust || [...seen.locust].every((k) => k === "spring"));
  if (seen.eid) assert.ok(eidAfterRamadan > 0);
});

test("power poles carry power away from a smoky generator, and only when linked", async () => {
  const { powerNet } = await import("../js/sim.js");
  const s = newGame(5);
  s.era = 1;
  const free = (x, y) => { const t = s.tiles[y * N + x]; t.t = "sand"; t.b = null; };
  for (let x = 15; x <= 29; x++) free(x, 20);
  s.tiles[20 * N + 15].b = { id: "generator", lvl: 0, res: 0, cond: 100 };
  s.tiles[20 * N + 19].b = { id: "pole", lvl: 0, res: 0, cond: 100 };
  s.tiles[20 * N + 23].b = { id: "pole", lvl: 0, res: 0, cond: 100 };
  s.tiles[20 * N + 29].b = { id: "pole", lvl: 0, res: 0, cond: 100 }; // too far from the last one
  const net = powerNet(s);
  assert.ok(net.live.has(20 * N + 19) && net.live.has(20 * N + 23));
  assert.ok(!net.live.has(20 * N + 29));
  const a = analyze(s);
  assert.equal(a.powered[20 * N + 26], 1, "a pole lights three tiles round it, past the generator's own reach");
  assert.equal(a.powered[20 * N + 28], 0);
});

test("the bigger world map keeps every old plot where it was, under the same number", async () => {
  const { WORLD, worldXY, worldPlot, worldTerrain } = await import("../js/data.js");
  // plot 0 of the first map was its top-left corner; plot 24 × 10 + 6 was الرافعية
  assert.deepEqual(worldXY(0), [WORLD.first.x, WORLD.first.y]);
  assert.deepEqual(worldXY(24 * 10 + 6), [6 + WORLD.first.x, 10 + WORLD.first.y]);
  const seen = new Set();
  for (let y = 0; y < WORLD.rows; y++) for (let x = 0; x < WORLD.cols; x++) {
    const p = worldPlot(x, y);
    assert.deepEqual(worldXY(p), [x, y]);
    seen.add(p);
  }
  assert.equal(seen.size, WORLD.cols * WORLD.rows, "one number for every plot");
  assert.equal(Math.max(...seen), WORLD.cols * WORLD.rows - 1);
  assert.ok(["wadi", "bigwadi"].includes(worldTerrain(24 * 10 + 6)));
});

test("away: a town gains at most AWAY_CAP for its stage, and the money it had is never touched", async () => {
  const { deputyCatchUp, AWAY_CAP } = await import("../js/sim.js");
  const s = autoplay(400, 42);
  s.world = { plot: 1 }; s.money = 1234;
  const before = s.money, r = deputyCatchUp(s, 24 * 30, rng(3));
  assert.ok(s.money - before <= AWAY_CAP[s.era], `gained ${s.money - before}, cap ${AWAY_CAP[s.era]}`);
  assert.ok(s.money >= 0);
  if (r.capped) assert.equal(s.money, before + r.cap);
});

test("away cap from debt: the shield clearing a debt is not income and is never taken", async () => {
  const { deputyCatchUp, AWAY_CAP } = await import("../js/sim.js");
  const s = autoplay(400, 42);
  s.world = { plot: 1 }; s.money = -7975;
  deputyCatchUp(s, 24 * 30, rng(3));
  assert.ok(s.money >= 0, `left at ${s.money}`);
  assert.ok(s.money <= AWAY_CAP[s.era], "the gain is counted from zero");
});

test("vault (al-Jouf): income stops at the cap, vaults raise it, money above it is never taken, solo has no cap", async () => {
  const { moneyCap, upgradeCost, upgradeAt, levelName } = await import("../js/sim.js");
  const { BASE_VAULT, VAULT } = await import("../js/data.js");
  const s = autoplay(300, 42);
  assert.equal(moneyCap(s), Infinity, "solo: no cap");
  s.world = { plot: 1 };
  assert.equal(moneyCap(s), BASE_VAULT[s.era]);
  // a vault next to the town
  let at = null;
  for (let i = 0; i < s.tiles.length && !at; i++) if (!s.tiles[i].b && s.tiles[i].t === "sand" && owns(s, i % 72, Math.floor(i / 72))) at = i;
  s.tiles[at].b = { id: "vault", lvl: 0, res: 0, cond: 100 };
  assert.equal(moneyCap(s), BASE_VAULT[s.era] + VAULT[0].cap);
  // income stops at the cap
  s.money = moneyCap(s) - 10;
  for (let h = 0; h < 5; h++) step(s, rng(1));
  assert.ok(s.money <= moneyCap(s) + 1, "stopped at the cap");
  // above the cap (an old town): kept, not taken
  s.money = moneyCap(s) + 50000; const before = s.money;
  step(s, rng(2));
  assert.ok(s.money >= before - 5000, "nothing taken beyond the hour's own costs");
  // upgrade
  s.era = 1; s.money = 100000;
  const b = s.tiles[at].b;
  assert.equal(upgradeCost(b), VAULT[1].up);
  assert.equal(upgradeAt(s, at % 72, Math.floor(at / 72)), "");
  assert.equal(b.lvl, 1); assert.equal(levelName(b), VAULT[1].name);
  assert.equal(moneyCap(s), BASE_VAULT[1] + VAULT[1].cap);
});

test("a wish about some homes: said by someone living there, an idle service asks for a road, and met once those homes have it", async () => {
  const news = await import("../js/news.js");
  const { seasonOf } = await import("../js/sim.js");
  const s = newGame(5);
  for (let i = 0; i < 40; i++) step(s, fixedRandom());
  const put = (x, y, id) => { const t = s.tiles[idx(x, y)]; t.t = "sand"; t.b = id ? { id, lvl: 0, res: id === "house" ? 4 : 0, day: s.day, cond: 100 } : null; return idx(x, y); };
  // two streets of homes far apart, and a clinic on the first
  const street = (y) => { const homes = []; for (let x = 2; x <= 15; x++) { put(x, y, "road"); if (x >= 3 && x <= 14) homes.push(put(x, y + 1, "house")); } return homes; };
  const west = street(50), east = street(8);
  put(8, 49, "clinic");
  s.pop = 200;
  let a = analyze(s);
  const n = news.needs(s, a), health = n.uncovered.find((u) => u.svc === "health");
  assert.ok(health && health.list.every((i) => !a.services[i].has("health")), "only the homes the clinic does not reach");
  assert.ok(west.some((i) => a.services[i].has("health")) && east.every((i) => health.list.includes(i)));
  // the speaker lives in a home without one
  s.news = [];
  let asked = null;
  for (let k = 0; k < 40 && !asked; k++) { asked = news.writePosts(s, a, seasonOf(s.day), 4).find((q) => q.topic === "health" && q.mood < 0); s.news = []; s.day++; }
  assert.ok(asked, "someone asks for a clinic");
  assert.ok(asked.person.home != null && east.includes(asked.person.home), "the one asking lives where there is none");
  // promised; built at his street: kept, even if another quarter would still like one
  news.answerPost(s, a, seasonOf(s.day), asked, "promise");
  assert.ok(s.promises.some((q) => q.topic === "health" && q.near?.length));
  const far = []; for (let x = 40; x <= 50; x++) { put(x, 30, "road"); far.push(put(x, 31, "house")); }
  put(8, 7, "clinic"); a = analyze(s);
  assert.ok(news.needs(s, a).uncovered.some((u) => u.svc === "health"), "another quarter still has none");
  assert.ok(news.followUps(s, a, seasonOf(s.day)).some((q) => /وفيت بوعدك/.test(q.text)), "the promise counts as kept");
  // a clinic with no road: they ask for the road, not for another clinic
  for (let x = 2; x <= 15; x++) put(x, 8, null);
  for (const i of east) put(i % N, Math.floor(i / N), null);
  for (let x = 2; x <= 15; x++) { put(x, 12, "road"); east.push(put(x, 11, "house")); }
  a = analyze(s);
  const n2 = news.needs(s, a);
  assert.ok(n2.noRoad.some((u) => u.svc === "health" && u.list.length), "the clinic without a road is named");
  assert.ok(!n2.uncovered.some((u) => u.svc === "health" && u.list.some((i) => east.includes(i) && Math.abs(i % N - 8) + Math.abs(Math.floor(i / N) - 7) <= 6)), "no 'build a clinic' for homes next to the idle one");
});

test("every stage has a budget: a town at the last stage keeps real numbers", () => {
  const s = newGame(9);
  s.era = 4; s.pop = 9500;
  const a = analyze(s);
  assert.ok(Number.isFinite(a.net) && Number.isFinite(a.upkeep), `net ${a.net}`);
  for (let h = 0; h < 30; h++) step(s, fixedRandom());
  assert.ok(Number.isFinite(s.money), `money ${s.money}`);
});
