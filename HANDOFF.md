# HANDOFF — «الرافعية» (Al-Rafaya)

> To the AI reading this: you are taking over an ongoing project from another AI assistant.
> Read this whole file before you touch anything. It says what the game is, how it is built,
> how it is deployed, what the owner likes and dislikes, and **exactly where we stopped**.

---

## 0. Where we stopped (read first)

Last state, **2026-11-22**, latest commit on `main`: `b7ff565`.

**The last three commits:**
1. `3c9bace`: natural dam lake (soft shore, wet sand, moving ripples), ground colours blended between tiles (no squares), pinch-zoom/drag on the world map with ＋/－ buttons, and explainer sheets for every top box.
2. `ad82851`: rain water in the wadi is now a flowing stream with ragged banks and pools, not tile squares. The owner had complained «للحين شكل الماء ماتغير» about this, and it is fixed.
3. `b7ff565`: **building rotation.**
   - A «↻» button on the build chip turns the ghost before you press «✓ ابنِ».
   - A «↻ لفّ المبنى (ببلاش)» button in the building's info sheet turns it after it is built.
   - Saved as `t.b.rot` (0–3 quarter turns), the 7th field of a packed tile.
   - Dams, pivots and roads do not turn.

4. `01a0b04`: **power poles** (`pole` in data.js, `powerNet()` in sim.js; a pole within 4 tiles of a source or a live pole is live and powers 3 tiles round it; wires drawn in `syncWires`). The owner asked for this because players put the generator next to houses and got smoke complaints. Also **visits are look-only**: the owner's friends could change a visited town. A capture listener on `#sheetBody` blocks changes while `visiting` (allow-list `VISIT_OK` / `VISIT_SHEETS` in main.js), and `worldSync` always sends your own town (`visiting.home`), never the visited one.

**Nothing is half-done.** All tests pass (28/28). Everything is pushed and auto-deployed.

**Ideas raised before, not started (only build them if the owner asks):**
- A staging copy of the site plus an admin page to moderate world reports.
- World of al-Jouf **phase 2+**:
  - shared groundwater between neighbours; a dam upstream hurting the town downstream;
  - migration between towns; road tolls; a shared market;
  - pollution drifting to neighbours; grazing fights;
  - Emir elections for the region; land auctions; reputation; tribes/alliances.
  - The owner explicitly wants rivalry/conflict («ابي شي متناقض»), not only friendly help.
- The owner has not yet said whether «🌍 عالم الجوف» fully works on the live site. Their latest screenshot shows a world town («ابراهيم») running on world time, so it seems to work.

---

## 1. Who the owner is and how to talk to them

**Language and tone**
- They write in **Saudi (Najdi/Jouf) dialect Arabic**. **Always reply in Arabic**, simple and friendly, Saudi-flavoured. They got upset once at an English reply.
- They are not a programmer. Explain what changed in plain Arabic, as short bullet lists, not code.
- They send phone screenshots of the live site and say what is wrong. Look at the screenshot carefully: the complaint is often about a specific visual. Example: "the water still looks like squares" was about the *rain stream in the wadi*, not the dam lake.

**What they want**
- They like big features, but every feature must be **logical and realistic for al-Jouf / Saudi life**:
  - seasons: no rain in summer;
  - prayer times, Ramadan, Eid, the faydah in spring, kashta, camel shows (مزاين الإبل).

**Hard rules they set (do not break)**
1. **No Claude/LLM API calls inside the game.** «لا تحط سالفه ذكاء كلاود انهم ياخذون من رصيدي». All resident talk is generated locally from templates and game state (`js/news.js`, `js/people.js`).
2. **Never show who is "online now"** in the world.
3. **No speed-up in world mode** (option B). Solo mode keeps ⏸ ▶ ⏩.
4. **The solo game stops while the player is away** (no catch-up offline). The **world** keeps running, and the deputy mayor runs your town while you are away, with protections.
5. Every complaint from a resident must be clear: show «💡 وش يبي».
6. Every upgrade must show how much income and expenses change.
7. Goal rewards must at least cover the cost they ask for.
8. Map/region names:
   - Region towns: **الرديفة، الأضارع، صفان (in the Nafud)**.
   - The world map is **الجوف**, not نجد.
   - **الرافعية is west (left) of دومة الجندل.**

---

## 2. What the game is

A mobile-first 3D town builder (three.js, plain ES modules, **no build tool, no npm deps**). You start with tents, a well and palms by a wadi in al-Jouf and grow to قرية → بلدة → مدينة → محافظة.

**Links**
- **Live:** https://rafaya.vamosx.workers.dev (Cloudflare Workers; deploys automatically on every push to `main`).
- **Repo:** GitHub `aa9986087-cyber/rafaya`, branch `main`. Commits go straight to `main`; the owner never asked for PRs.
- **Single-file preview:** `node scripts/bundle.mjs` writes `dist/rafaya.html`. The previous AI republished it as a private claude.ai artifact after each change. That is optional; the live site is what the owner uses.

### Main systems (all working)

**Time**
- One simulation step is one game hour; `HOUR_MS = 50000` real ms per hour.
- 4 seasons of `SEASON_DAYS = 3` days; `YEAR_HOURS = 288`.
- Daylight length changes by season.

**Houses and businesses**
- Houses: tent → mud house → شعبي → villa → عمارة. The player upgrades them by hand. Upgrades need road, water, power and services plus money and **building materials (MAT)**; missing materials are bought from outside.
- Businesses (farm, shop, workshop, pen, dairy, mill, **mosque, hospital**) have 3 levels each (`BIZ_LEVELS`, `BIZ_UP`).

**Utilities and land**
- Water and power have **reach** (coverage radius per source).
- Land: a 40×40 map; you buy plots around the centre.

**Economy**
- Taxes, a shop demand cap, itemised costs, debt, bankruptcy.
- Bank loans; a 30% state subsidy on shops (`SUBSIDY`).

**Events and community**
- Decisions/events are weighted by season.
- Floods on the wadi; insurance; repairs.
- Elections every year: a loss doubles the province fee.
- 9 named districts; prayer times.

**Production and traffic**
- Production chains, with trucks on roads.
- Real traffic: commutes, avenues, roundabouts, signals, parking, jam heat overlay.

**Water**
- Dams on the wadi make a lake (`updateLake`, tile type `"lake"`).
- Groundwater (`s.aquifer`); centre-pivot farms.

**People**
- Families with names and jobs (`js/people.js`); you can follow one person.

**«نشرة الرافعية» (the news feed)**
- Residents post about the town's real numbers.
- The player replies (promise / calm / refuse), and residents remember promises («وعودك»).
- Replies are context-aware (`GOOD_REPLIES` in news.js): rain → prayer replies, Eid → greetings, and so on.

**Weather by season**
- Rain only in autumn, winter and spring. Summer has heat waves, dust and a siesta. Cold snaps come in winter, locusts in spring.
- Eid al-Fitr comes right after Ramadan; Eid al-Adha also exists.
- Spring greenness depends on winter rain (`s.wet`, `springGreen`).

**UI**
- Every top box opens an explainer sheet: money → budget, population → `popSheet`, happiness → `happySheet`, water/power → `utilSheet`, time/season → `whenSheet`.
- Also: a guide in the menu, «وش الجديد» (a visible button with a red dot, `WHATS_NEW` in main.js; **add an entry for every user-visible change and bump `v`**), a move tool, and rotation.

**Region (solo)**
- Several of your own towns: main + الرديفة (meadow) + الأضارع (mountain) + صفان (dunes).
- Saved in localStorage `rafaya-region-v1`; roads and money transfers between them.

**World of al-Jouf (online, phase 1 done)**
- **Server:** `src/worker.js` plus one SQLite Durable Object `Board`, free plan.
- **Players:** a name plus a hashed secret and a recovery code.
- **Map:** a shared 24×16 plot map of al-Jouf with places. You claim a plot and found your town.
- **World clock:** `WORLD_EPOCH = Date.UTC(2026,10,1)`; one hour is 50 s for everyone.
- **Absence:**
  - `deputyCatchUp` runs full steps for up to 168 h, then extrapolates.
  - The town sleeps after 7 real days.
  - Away shield.
  - Deputy orders.
- **Sync:** every 5 min and on page hide.
- **Others:** visit other towns and comment; report abuse.
- **API endpoints:** `/api/world/{join,recover,clock,map,claim,sync,town/:plot,report}` plus older `/api/publish`, `/api/board`, `/api/town`.

---

## 3. Code map

| File | Lines | What is in it |
|---|---|---|
| `js/data.js` | ~520 | All constants and content: buildings `B`, ERAS, SEASONS, EVENTS (with season weights), DECISIONS, GOALS, LOANS, BIZ_LEVELS/BIZ_UP, MAT, GROUND, CHAINS, TRAFFIC, PRAYERS, DISTRICT_NAMES, TERRAINS, SITES, REGION, WORLD (places, `worldTerrain`, `worldPlace`) |
| `js/sim.js` | ~1210 | **Pure simulation, no DOM.** `newGame`, `step` (one hour), `analyze` (computes the analysis object `A` each hour), build/demolish/upgrade/move, economy, loans, elections, lake/groundwater, traffic, chains, `deputyCatchUp`, `pack`/`unpack` (save format) |
| `js/people.js` | ~70 | Deterministic families per house, jobs, wishes |
| `js/news.js` | ~520 | Resident posts, follow-ups, reply options and answers, promises (no AI) |
| `js/models.js` | ~1010 | Every 3D model built from simple shapes (buildings by level, people, camels, trucks, etc.) |
| `js/world3d.js` | ~1340 | three.js scene: ground (vertex-blended colours), lake and wadi-stream water (canvas alpha masks plus moving ripple textures), buildings as instanced meshes, roads, trucks, people, weather, day/night, overlays, ghost preview, flood animation |
| `js/main.js` | ~2000 | Touch input, HUD, every sheet/screen, the game loop (`runHour`), saving, region, world mode, visits |
| `js/sound.js` | ~90 | WebAudio sound effects and ambience |
| `index.html`, `css/style.css` | | Layout and styles (RTL Arabic) |
| `src/worker.js` | ~185 | Cloudflare Worker: serves assets plus `/api/*`, Durable Object `Board` (SQLite tables: towns, comments, players, plots, reports) |
| `wrangler.jsonc` | | Worker config (assets in `dist/site`, DO binding, migration v1) |
| `scripts/copy-site.mjs` | | Copies the game into `dist/site` before deploy. If a file `MAINTENANCE` exists at repo root, it serves `maintenance.html` instead |
| `scripts/bundle.mjs` | | Inlines all modules into one `dist/rafaya.html`. **Top-level names must be unique across modules** (it errors on duplicates) |
| `test/sim.test.mjs` | | 27 node tests of the simulation |
| `test/balance.mjs` | | Bot players that play many days. Styles: `careful`, `borrower`, `spender`, `taxer`, `yesman`, `miser`. Usage: `node test/balance.mjs 1500 42 careful` |
| `vendor/` | | three.js (MIT) |

**Debug hooks:** `window.__S` (the state) and `window.__world` (the renderer) exist for testing.

---

## 4. How to work on it

**Commands**
```bash
npm test                      # node --test, must stay green
node scripts/bundle.mjs       # optional single-file build in dist/rafaya.html
node scripts/copy-site.mjs && npx -y wrangler@4 dev --port 8787 --local   # run locally with the API
# or, without the online parts:  python3 -m http.server 8000
```

**Browser checks**
- The previous AI used Playwright (Chromium, iPhone 13 emulation, `--use-gl=swiftshader`), tapping with `page.touchscreen.tap`, then read the screenshots.
- New game: tap `#mNew`, then `#letsGo`; `[data-speed="0"]` pauses.
- Build cards are `[data-build="<id>"]`, categories `[data-cat="<id>"]`.

**Deploy:** `git push origin main`. Cloudflare builds and deploys automatically within a minute or two. Nothing else is needed.

**Conventions**
- Code comments in English; all player-facing text in Arabic (Saudi dialect).
- Balance changes: run the bots before and after. A careful bot should reach مدينة around day 48–61 without going bankrupt.
- Saves live in the player's browser (`rafaya-save-v1`, `rafaya-region-v1`, world keys). **Never break old saves.** Extend `pack`/`unpack` with optional trailing fields, as `rot` was added.
- After every user-visible change:
  - add a line to `WHATS_NEW` in main.js and bump its `v`;
  - run the tests;
  - commit with a clear message;
  - push;
  - tell the owner in Arabic what changed.

---

## 5. Suggested first message back to the owner

Short Arabic: you have read the handoff, you know the last thing done was building rotation and the wadi water, and ask what they want next. Mention the open ideas in section 0 only briefly.
