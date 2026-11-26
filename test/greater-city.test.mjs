import assert from "node:assert/strict";
import test from "node:test";
import { B, CENTRAL_VAULT_LEVEL, ELECTION_GRANT, GREATER_CITY_PROJECTS, GREATER_CITY_STAGE, GREATER_CITY_UPGRADES, MAP_SIZE as N, PROVINCE_FEES, YEAR_HOURS } from "../js/data.js";
import { analyze, build, cantBuild, greaterCityProgress, housePrice, idx, moneyCap, newGame, pack, provinceFee, step, unpack, upgradeAt, upgradeBlocker, upgradePrice } from "../js/sim.js";

function city(world = true) {
  const town = newGame(71);
  if (world) town.world = { plot: 42 };
  town.tiles = town.tiles.map(() => ({ t: "sand", b: null }));
  town.era = GREATER_CITY_STAGE - 1;
  town.money = 400000;
  town.happy = 99;
  return town;
}
const tile = (town, x, y, id, lvl = 0) => {
  const b = { id, lvl, cond: 100, res: 0 };
  town.tiles[idx(x, y)].b = b;
  return b;
};

test("greater city opens at 23,000 in al-Jouf (reachable with the towers of a حاضرة), and yearly finances stay valid", () => {
  const base = city();
  // 200 connected towers (the highest house before the greater city) hold 24,000: room enough for 23,000
  for (let y = 24; y <= 45; y += 3) for (let x = 24; x < 49; x++) {
    tile(base, x, y, "road");
    tile(base, x, y - 1, "house", 5);
    tile(base, x, y + 1, "factory");
  }
  assert.equal(analyze(base).cap, 24000);
  base.pop = 22900;
  const solo = unpack(pack(base));
  delete solo.world;
  assert.equal(base.era, GREATER_CITY_STAGE - 1);
  assert.match(cantBuild(base, 36, 50, "civic_offices"), /الحاضرة الكبرى/);
  step(base, () => 0.71);
  step(solo, () => 0.71);
  assert.ok(base.pop >= 23000, `${base.pop}`);
  assert.equal(base.era, GREATER_CITY_STAGE);
  assert.equal(cantBuild(base, 36, 50, "civic_offices"), "");
  assert.equal(solo.era, GREATER_CITY_STAGE - 1); // a solo town never becomes one
  // 22,999 is not enough
  const almost = city(); almost.pop = 22999; for (let y = 24; y <= 45; y += 3) for (let x = 24; x < 49; x++) { tile(almost, x, y, "road"); tile(almost, x, y - 1, "house", 5); tile(almost, x, y + 1, "factory"); }
  almost.happy = 20; // nobody moves in
  step(almost, () => 0.71);
  assert.ok(almost.pop < 23000); assert.equal(almost.era, GREATER_CITY_STAGE - 1);

  for (const era of [GREATER_CITY_STAGE - 1, GREATER_CITY_STAGE]) {
    const own = unpack(pack(base));
    own.era = era;
    // Year-specific charges must include all eras even if a city entered mid-year.
    own.feeHours = { 3: 27, 4: 36 };
    own.day = YEAR_HOURS;
    own.money = 200000;
    own.happy = 99;
    own.trust = 100;
    own.pop = era === GREATER_CITY_STAGE ? 23000 : 9400;
    assert.ok(Number.isFinite(provinceFee(own)));
    assert.equal(PROVINCE_FEES[era], PROVINCE_FEES[3]);
    const election = step(own, () => 0.71).msgs.find((m) => m.kind === "election");
    assert.equal(election?.grant, ELECTION_GRANT[era]);
    assert.ok(Number.isFinite(own.money));
    assert.equal(unpack(pack(own)).money, own.money);
  }
});

test("real neighborhood services unlock residential towers and the new levels survive saving", () => {
  const town = city();
  const b = tile(town, 36, 36, "house", 4);
  const pos = idx(36, 36);
  for (let x = 34; x <= 38; x++) tile(town, x, 37, "road");
  tile(town, 34, 36, "mosque");
  tile(town, 35, 36, "school");
  tile(town, 37, 36, "clinic");
  tile(town, 36, 39, "well");
  tile(town, 36, 41, "generator");

  assert.match(upgradeBlocker(town, analyze(town), 36, 36), /4 خدمات/);
  tile(town, 38, 36, "police");
  assert.deepEqual([...analyze(town).services[pos]].sort(), ["health", "mosque", "safety", "school"]);
  assert.equal(upgradeAt(town, 36, 36), "");
  assert.equal(b.lvl, 5);
  assert.match(upgradeBlocker(town, analyze(town), 36, 36), /الحاضرة الكبرى/);
  town.era = GREATER_CITY_STAGE;
  const prices = [39280, 78560];
  for (const total of prices) {
    const before = town.money;
    assert.equal(upgradePrice(town, b).total, total);
    assert.equal(upgradeAt(town, 36, 36), "");
    assert.equal(town.money, before - total);
  }
  assert.equal(b.lvl, 7);
  assert.equal(B.house.levels[7].cap, 270);
  assert.equal(housePrice(town, 7).total, 150170);
  const restored = unpack(pack(town));
  assert.equal(restored.tiles[pos].b.lvl, 7);
  assert.equal(restored.houseTop, 7);
});

test("treasury requirements and project prices work through the whole civic path", () => {
  const town = city(), initialY = 36;
  for (let n = 0; n < B.vault.max; n++) tile(town, 28 + n, initialY, "vault");
  tile(town, 33, initialY, "skyline");
  tile(town, 33, initialY - 1, "road");
  for (let x = 34; x <= 40; x++) tile(town, x, initialY, "road");
  assert.equal(moneyCap(town), 420000);
  assert.match(cantBuild(town, 34, initialY, "civic_offices"), /الحاضرة الكبرى/);
  town.era = GREATER_CITY_STAGE;

  const place = (id, x) => {
    const price = GREATER_CITY_PROJECTS[id].cost;
    town.money = moneyCap(town);
    const before = town.money;
    assert.equal(build(town, x, initialY + 1, id), "", id);
    assert.equal(town.money, before - price, id);
    const b = town.tiles[idx(x, initialY + 1)].b;
    assert.ok(b.build > 0);
    assert.equal(greaterCityProgress(town).projects.get(id), "building");
    b.build = 1;
    const { msgs } = step(town, () => 0.71);
    assert.ok(msgs.some((m) => m.kind === "goal" && m.text.includes(B[id].name)));
    assert.equal(greaterCityProgress(town).projects.get(id), "open");
  };
  place("civic_offices", 34);
  assert.match(cantBuild(town, 35, initialY + 1, "civic_expo"), /خزينة الحاضرة/);
  const caps = [1115000, 1810000, 2505000, 3200000];
  for (let n = 0; n < B.vault.max; n++) {
    const x = 28 + n, vault = town.tiles[idx(x, initialY)].b;
    while (vault.lvl < CENTRAL_VAULT_LEVEL) {
      town.money = moneyCap(town);
      assert.equal(upgradeAt(town, x, initialY, analyze(town)), "");
      if (n === 0 && vault.lvl === CENTRAL_VAULT_LEVEL - 1) {
        assert.equal(moneyCap(town), 765000);
        place("civic_expo", 35);
      }
    }
    assert.equal(moneyCap(town), caps[n]);
    if (n < B.vault.max - 1) {
      assert.match(cantBuild(town, 39, initialY + 1, "civic_tower"), /الخزائن المركزية/);
      assert.match(upgradeBlocker(town, analyze(town), 33, initialY), /الخزائن المركزية/);
    }
    if (n === 0) {
      place("civic_freight", 36);
      assert.match(cantBuild(town, 37, initialY + 1, "civic_water"), /خزنتين/);
    }
    if (n === 1) {
      assert.match(cantBuild(town, 38, initialY + 1, "civic_energy"), /مجمّع المياه شغّال/);
      place("civic_water", 37);
      place("civic_energy", 38);
    }
  }
  const energy = town.tiles[idx(38, initialY + 1)].b;
  energy.wd = 100;
  assert.match(cantBuild(town, 39, initialY + 1, "civic_tower"), /مجمّع الطاقة شغّال/);
  energy.wd = 0;
  place("civic_tower", 39);
  assert.match(cantBuild(town, 40, initialY + 1, "civic_culture"), /أبراج الرافعية/);
  town.money = moneyCap(town);
  const before = town.money;
  assert.equal(upgradeAt(town, 33, initialY, analyze(town)), "");
  assert.equal(town.money, before - GREATER_CITY_UPGRADES.skyline.cost);
  const vault = town.tiles[idx(28, initialY)].b;
  vault.wd = 100;
  assert.equal(moneyCap(town), 2500000);
  assert.match(cantBuild(town, 40, initialY + 1, "civic_culture"), /3 من 4/);
  vault.wd = 0;
  const connection = town.tiles[idx(38, initialY)];
  const road = connection.b;
  connection.b = null;
  assert.equal(analyze(town).powerSupply, 0);
  assert.equal(greaterCityProgress(town).projects.get("civic_energy"), "stopped");
  assert.match(cantBuild(town, 40, initialY + 1, "civic_culture"), /شغّل «مجمّع الطاقة»/);
  connection.b = road;
  assert.equal(analyze(town).powerSupply, B.civic_energy.power);
  place("civic_culture", 40);
  const restored = unpack(pack(town));
  const progress = greaterCityProgress(restored);
  assert.equal(progress.central, 4);
  assert.equal(progress.upgradedTowers, true);
  assert.equal([...progress.projects.values()].filter((state) => state === "open").length, Object.keys(GREATER_CITY_PROJECTS).length);
  const day = restored.day;
  step(restored, () => 0.71);
  assert.equal(restored.day, day + 1);
  const culture = restored.tiles[idx(40, initialY + 1)].b;
  culture.wd = 100;
  assert.equal(greaterCityProgress(restored).projects.get("civic_culture"), "stopped");
  culture.wd = 0;
  assert.equal(greaterCityProgress(restored).projects.get("civic_culture"), "open");
});
