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

5. **Layout editor and the big expansion.**
   - The «ترتيب» tool opens a free, Clash-of-Clans-style layout mode:
     - drag to move; drop on another building to swap;
     - «شيل الكل» puts everything in a tray; there is undo, cancel and save;
     - the town and saving pause while it is open;
     - code: `arrange` / `arr*` functions in main.js and `layoutBlocker` in sim.js.
   - The map grew from 40 to 56 (`MAP_SIZE`):
     - the core is the same 30×30 (`OWN_START` 13);
     - near ring plots n/e/s/w, plus far edges n2/e2/s2/w2 (`OUTER` 8), each needing its near plot;
     - old saves are centred and their wadi continues outward.
   - New era «حاضرة» (pop 9000). House level 5 «برج سكني».
   - A 4th business level (`BIZ_UP[3]`, era 3).
   - New buildings: olive, oilpress (olive chain), windfarm, library, olivetree, bigfountain, and the projects marid, themepark, station, bigstadium, skyline. New goals and achievements.
   - Bots: `placeNear` targets one cluster at a time. Careful bots grow fine to hour 1800. Late-game collapses after ~2500 h are a known bot pathology: they spam tanks and solar.

6. **Even bigger (the owner said the world felt small).**
   - The town map is now **72 × 72**: a free core of 36 × 36 (`OWN_START` 18) and **12 plots** in three rings (`RINGS` [12, 6, 0]; ids n/e/s/w, n2…, n3…, each needing the one inside it), with cheaper prices.
   - Old 30/40/56 saves are centred.
   - **The al-Jouf world map grew from 24 × 16 to 40 × 26.** The old map sits at (8, 5) and **old plot numbers are unchanged** (0 … 383); new cells are numbered after them. Use `worldXY(plot)` / `worldPlot(x, y)` in data.js; never `plot % cols`.
   - New places were added.
   - The growth test moved from seed 42 to seed 2: on 72 × 72, seed 42's bot stalls at بلدة with 25 % unemployment, while the other seeds reach مدينة.
   - Also: «شيل الكل» no longer lifts roads/parking (`arrMovable` checks `cat !== "road"`).

7. **24 plots and «📍 وين الحارة؟».**
   - Each side of each ring is split in halves, giving plot ids like `na`, `nb`, `e2a`, `w3b` (side + ring + half). An old whole plot (`n`, `e2`…) becomes both halves in `unpack`. Prices start at 3000.
   - The 9 quarters (`districtOf`) are now thirds of the town's own 36 × 36 land, not of the whole map.
   - Any news post or promise naming a quarter shows «📍 وين …؟». It calls `showDistrict(d)`: the camera moves there and the quarter's land lights up orange for 8 s. The quarters sheet's «وريني» uses it too.

8. **Roads in the layout editor and 14 new research projects.**
   - The owner wanted «شيل الكل» to lift the asphalt too (I first misread it as a complaint). Now everything moves, roads included.
     - A road picked from the tray is laid by dragging a finger: `arrPaint`, `arrNext`.
     - Arrange redraws with `arrSync()`, which includes roads.
   - New TECH entries, each with a real effect in sim.js:

     | Tech | Effect |
     |---|---|
     | hydro | farmMult ×1.15; olive is now in the farm branch |
     | oliveoil | unlocks oilpress |
     | recharge | aquifer refills faster |
     | floodworks | flood damage chance ×0.5 |
     | recycle | water use ×0.85 |
     | efficiency | power use ×0.85 |
     | marketing | shopMult ×1.15 |
     | health | health bill ×0.5 |
     | security | theft ×0.4 |
     | logistics | chain need ×0.7; `chainAt` entries now carry `need` |
     | egov | staff ×0.8 |
     | heritage | visitor income ×1.25 |
     | transit | road capacity ×1.3 |
     | wind | unlocks windfarm |

9. **(REMOVED 2026-11-23 at the owner's request — see 12.) Solo town → world.** In the world map, an empty plot offers «انقل مدينتك الفردية لهنا». The town's owner card has «📦 انقل مدينة فردية مكانها», which asks twice before replacing the world town.
   - `soloTowns()` reads the solo saves: الرافعية and the region towns.
   - `worldCopy()` clones the town onto the world clock (day = world hour, `site` "world", `world.from`) and clears posts, promises and the pending decision. Buildings, people, money, loans, tech and land are kept.
   - The solo town stays (it is a copy).
   - Caveat: a player could swap the solo copy in again to restore money. Not blocked.

10. **iPhone layout.** On small notched iPhones in world mode (7 side buttons), the left rail spilled into the build bar and the world-time chip.
    - `layoutSide()` now measures from the lowest left HUD item, prefers one compact column, and re-measures and shrinks until the last button clears the bar.
    - It reruns on `visualViewport` resize, orientation change, ResizeObserver (hud/dock/side), body class changes and fonts ready.
    - Buttons get `appearance: none` and no padding so Safari matches Chrome.
    - To test the notch in Playwright, override `--top`/`--bottom`/`--left`/`--right` on `:root` (Chromium reports no safe areas).

11. **🛠️ The al-Jouf world is CLOSED for maintenance (owner asked, 2026-11-23: «ابيك تقفل الاولاين صيانه لاني بشتغل عليه كثير»).**
    - Switch: `const WORLD_OPEN = false` in `src/worker.js`. Every `/api/world/*` answers 503 `{error:"maintenance"}`; nothing in the world tables is touched.
    - The client shows `worldClosedSheet()` (main.js) on «🌍 عالم الجوف» and on the world map. Solo play and the old `/api/publish` board still work.
    - **To reopen:** set `WORLD_OPEN = true`, remove the «تحت الصيانة» line from `WHATS_NEW` (add a «رجع العالم» one), push to main.
    - Whole-site maintenance is a different switch (the `MAINTENANCE` file, see copy-site.mjs); it is NOT on.

12. **Solo and world are now developed separately (owner's rule, 2026-11-23).**
    - **Every new update belongs to one mode: «الفردي» (solo, offline), «عالم الجوف» (world, online), or both.** The owner will say which; **if they did not, ASK before building.** World-only code is gated with `worldMode` (main.js) / `S.world` (sim); solo-only with `!worldMode`.
    - «وش الجديد» has two tabs. `WHATS_NEW.items` entries are `[mode, icon, title, text]` with mode `"solo"`, `"world"` or `"both"`; `WHATS_NEW.v` is `{ solo, world }` — bump only the one(s) the change touches. Seen keys: `rafaya-news-seen-solo` / `-world`. The red dot follows the mode being played.
    - The residents' news feed («نشرة») is per town already, so solo and world feeds never mix.
    - **Moving a solo town into the world is removed** (no `soloTowns`/`worldCopy`/`worldSwapSheet` any more). World towns that were already moved stay as they are.

13. **The world was wiped (owner, 2026-11-23: «امسح كل المدن … ابيهم يبدون من جديد»).**
    - `WORLD_GEN` in `src/worker.js` (now 2) with a `meta` table: when the stored gen is lower, the Board deletes every plot, player, report and world comment (`code GLOB 'w[0-9]*'`) once. `/api/publish` towns are kept.
    - `/api/world/clock` returns `gen`; `loadClock()` in main.js drops `rafaya-world-id` and `rafaya-world-town` from the phone when its `rafaya-world-gen` differs. So old world towns cannot come back from phones.
    - To wipe again some day: raise `WORLD_GEN`.

14. **«مدن الربع» removed from solo (owner, 2026-11-23: «مدن الربع بالفردي شله»).** No publish-by-code, no leaderboard, no visiting by code. The server routes `/api/publish`, `/api/board`, `/api/town/*` are gone (404); the `towns` table is left unused. Visiting other towns now exists only in the world (`visitTown(plot)`), and comments only go to `/api/world/town/:plot/comment`. Solo is fully offline now.

15. **«صراع الجوف» — war in the world (owner's PRD, 2026-11-23). WORLD ONLY; solo is untouched.**
    - **Files:**
      - `js/war.js`: pure rules and balance (`WAR` timings and caps, `WEAPONS`, `TARGETS`, relations, intercept chance, damage). Used by both the server and the game.
      - `js/warserver.js`: the **authoritative** `WarServer`. It buys, handles relations, launches, settles each attack once at its arrival time, runs the deputy's repairs and refills, and keeps notes. Storage is one SQLite table `war` (rows as JSON) via `sqlWarDb`; `memWarDb` is for tests and the trial.
      - `js/warfx.js`: three.js scenes and effects (moving radar/air-defence/erector/drone parts, launch, incoming, interception, explosion, persistent damage smoke, scorch and fire, target rings, camera shake). It only **shows** results.
      - `js/preview.js`: TRIAL ONLY (`node scripts/bundle.mjs --preview` → `dist/rafaya-trial.html`). It is an in-page practice world with 3 bot towns and short timings (`fastWar(20)`).
      - UI is in `main.js` under «صراع الجوف»: `warPoll`/`warApply`, `warSheet` (command tabs), `relSheet`, `startTargeting`/`targetTap`/`strikeSheet`, `warOpScene`/`warDefenseScene`/`replayOp`, `opReport`, `warDamageHtml`, `warBack`.
    - **Server:** `POST /api/world/war/{state,buy,rel,launch,op,repair,settings,enemy}` (auth as for sync). `GET /api/world/town/:plot` also returns `damage`. Refusals come back as `200 { error: "Arabic reason" }`. Every money-spending request carries a request id (`req`/`op`): sent twice, it is done once.
    - **Money:** the server writes `charge` rows (seq per town). The game takes each one off `S.money` once (`S.war.seq`). The server's "available" money is the last synced budget minus the charges not applied yet.
    - **Damage:** it is kept on the server per tile (`dmg`), never trusted from a sync. The game copies it into `t.b.wd` (8th packed tile field, optional; `rot` is written as 0 when only `wd` is there). `condFactor` includes `warWorks(wd)`: from 85 the building stands idle; it is never removed. Repairs are timed on the server; damage comes off gradually.
    - **Buildings** (`cat: "mil"`, `worldOnly`): `milhq` (needed first), `dronebase`, `missilepad` (مدينة), `radar`, `airdef`, `armory`. Levels are in `MIL` / `MIL_UP` (data.js). Upgrades use `bizBlocker`/`upgradeCost`, which are MIL-aware.
    - **Protections** (in `WAR`): villages, new players (24 h), sleeping towns, bullies (2 stages above), 2 hits on one building per 6 h, 6 hits on a town per 12 h (3 if away) then a 12 h shield, max 60 damage per operation, at most 3 operations at one town at once. Homes, mosques, schools, clinics and parks can never be targeted.
    - **Relations:** peace → (threat: tension) → hostility (10 min) → war declared → 15 min warning → war 24 h → hostility. Truce (6 h) and peace (24 h cooldown) are offers the other side accepts.
    - **Local test with the real Worker:** `node scripts/copy-site.mjs && npx wrangler@4 dev --local --var WAR_TEST:1`. `WAR_TEST` opens the world locally and uses `fastWar(30)`. **Never set it on the live site.**
    - **Status:** built and tested locally (unit tests, two accounts on wrangler dev, the trial copy). Pushed to main with step 17; the world is open.

16. **Realistic graphics, step 1: the war (owner: «واقعي أكثر», war first, then the rest of the game; both modes).**
    - Open assets in `vendor/` (see `vendor/ASSETS-LICENSE.txt`): three.js add-ons r160 in `vendor/jsm/` (MIT: EffectComposer, UnrealBloomPass, OutputPass, EXRLoader, RoundedBoxGeometry), a Poly Haven sky HDRI `vendor/hdri/sky.exr` (CC0), and two CC0 normal maps in `vendor/tex/`. `index.html` maps `three/addons/` to `./vendor/jsm/`. The single-file bundle maps it to jsDelivr and carries the HDRI and textures inline (`globalThis.RAFAYA_ASSETS`).
    - `models.js`: `SETS` = matte, shiny, lights, **paint, metal, glass, glow**. The Builder keeps UVs and has `rbox`/`lathe`/`plate`. The military models are rebuilt (TEL truck with canisters, Patriot-style battery, slatted radar reflector, corrugated hangars, T-walls, helipads). `MIL_LAYOUT` holds where the moving parts sit.
    - `world3d.js`: the sky reflects only on paint/metal/glass (the rest of the town keeps its warm light). Bloom threshold is 3.2, so only `glow`, flames, flashes and sparks bloom (sunlit sand must not). There is no bloom on "low" quality.
    - `warfx.js`: noise smoke and fire sprites, a flare, one PointLight for blasts and rocket flames (always in the scene, so there is no shader recompile), a ground shockwave, and instanced debris with bounces. Missiles slide out of their canisters.
    - **Next:** the same realistic treatment for the rest of the game (houses, shops, roads, ground, people, cars). Ask the owner before starting.

17. **Icons, smooth edges, visible damage; pushed to main and the world REOPENED (owner, 2026-11-23).**
    - `js/icons.js`: Lucide icons (ISC). `watchIcons(document.body)` swaps every emoji in the page's text for an inline SVG as it appears (a MutationObserver). Texts may keep writing emoji. A new emoji needs an entry in `ICON_PATHS` (taken from lucide-static). SVG `<text>` is skipped: the map's relation markers draw the icon paths directly.
    - Smooth edges: the bloom composer renders into a multisampled target (MSAA); medium quality uses pixel ratio 1.75.
    - Damage shape: `warSquash`/`warTilt` (world3d.js) sink a building from 25% damage (down to half its height) and tilt it from 60%. `warfx.addDamage` adds seeded rubble, a blackened broken top and bent rebar (two instanced meshes, `buildRubble`), with smoke and fire from the top.
    - `WORLD_OPEN = true` again. The live world has the war.

18. **Fixes after the owner tried the trial (2026-11-23):**
    - The interceptor is now clearly visible: the camera frames the battery and the target, the launcher aims and lifts, the interceptor is bigger with a flame and a thick trail, and banners say «الدفاع الجوي أطلق صاروخ اعتراضي». When the batteries have no interceptors, a banner and a «💡» in the report say so (`result.airdef` from the server). The deputy also refills interceptors when an attack is detected at launch (`deputy(…, refillOnly)`).
    - Arrange mode: only a building already selected (tapped) is dragged; any other drag pans. The touch tap threshold is 14 px.
    - The power reach overlay is violet `#9b5cf6` (yellow got lost on the sand).
    - Sheets: a sheet opened while the last one was closing was being hidden by the old close timer (`sheetHide`). Fixed.

19. **Rocks and the al-Jouf button (owner's screenshot, 2026-11-23):** a friend got «المكان مشغول» on a tile drawn with rocks. It could not be reproduced: building on rocks works and the rocks disappear.
    - The message now names what is there («…فيه «كسارة حجر»»): the quarry looks like rocks.
    - `unpack` turns a rock tile under any building but the quarry back to sand.
    - A missing model falls back to "construction", so a sync can never stop half-way and leave stale instances on screen.
    - `#worldBtn` («الجوف») now shows in solo too and calls `openWorld()`.

20. **Realistic graphics, stage 1 for the whole game (both modes), owner 2026-11-23:**
    - The «وقت العالم» chip and the «وش الجديد» chip left the game screen (`#wnChip`/`#wnDot` are gone; the main menu button stays). In the world the speeds group is hidden and `layoutSide` starts under `.hud .stats`.
    - `Builder.box` rounds the edges of big boxes (min ≥ 0.1, max ≥ 0.22) with `RoundedBoxGeometry`.
    - Window and panel colours (the `GLASS` set) are drawn in the glass set.
    - `mats.matte` has the CC0 plaster normal map. The ground and the desert have the grain normal map. `shiny` reflects the sky too.
    - **Next stages:** detailed houses and shops, cars, palms and trees, people, roads with kerbs.

21. **Roads in the layout editor (owner: «اذا جيت بحط طريق معاناه»):** a «امسح طرق» button (`#arrErase`, `arrange.erase`) lifts every road the finger slides over into the tray (`arrErase`, one undo step per slide). A road taken from the tray is drawn by sliding (`arrPaint` → `arrLine` fills the tiles a fast finger skips; busy tiles are skipped), even when the slide starts on a busy tile.

22. **iPhones heating (owner, 2026-11-23):**
    - `frame()` caps drawing to 30 fps when idle, and to 45 (medium) or 60 (high) while busy (a finger down, the camera turning, scenes, rises, arrange).
    - Shadows update every 3rd frame (2nd on high), or on any sync (`shadowMap.autoUpdate = false`, `shadowDirty`).
    - Bloom only on «عالية». Medium pixel ratio is back to 1.5.
    - Pushed to main with everything since step 18.

**Nothing is half-done.** All tests pass (38/38). Everything is pushed and auto-deployed.

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
- **API endpoints:** `/api/world/{join,recover,clock,map,claim,sync,town/:plot,report}` (the older `/api/publish`, `/api/board`, `/api/town` were removed in step 14).

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
