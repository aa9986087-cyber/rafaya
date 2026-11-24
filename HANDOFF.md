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

23. **Realistic graphics, stage 2:** `palm()` has a ringed trunk, 11 arching fronds (3 parts each, rising then drooping: angle `e`) with leaflets, and date clusters. The pickup body is rounded (`rbox` in the matte set, painted per car); its trim has tyres, metal rims, glass, glowing lamps and mirrors. `carTrim` uses all `SETS`. **Next:** houses and shops in more detail, people, kerbs.

24. **Realistic graphics, stage 3:**
    - Kerbs: `syncKerbs` draws one instanced mesh of concrete edges wherever a road meets non-road.
    - Contact shadows: `syncContact` draws one instanced soft dark patch under every building (fake AO).
    - Smoother people (more segments).
    - Houses and shops keep their models but gain the plaster texture, glass and rounded edges from stage 1.

25. **Villas, apartment blocks and towers rebuilt; heat on all phones:**
    - `house3` (villa), `house4` (عمارة, shops below) and `house5` (glass tower with a lit crown) were rebuilt with the new helpers `frameWin`, `splitAC`, `roofTank` and `sedan`. `VARIANTS` for house3/house4 swap the new colours.
    - Heat: `perfWatch` (main.js) averages how long `world.frame` takes. Slow (> 18 ms) for 4 s raises `world.degrade(level)`: 1 = pixel ratio 1.25, 2 = no shadows, 3 = pixel ratio 1. The level is stored per quality (`rafaya-perf-level`) and reset when the quality setting changes.
    - Behind an open sheet or on the menu the town draws at 15 fps.

26. **The public chat of al-Jouf (world only, owner: «حط شات عام باللاولاين»):**
    - Server: table `chat` (newest 500). `GET /api/world/chat[?after=ID]` and `POST /api/world/chat` (signed in; 200 characters; one message per 6 s per name; `badText` filter). A world wipe clears it.
    - Client: `#chatBtn` (world-only, unread `#chatCount`), `chatSheet`, and `chatPoll` (every 20 s, 4 s while the sheet is open). 🚩 reports go through `/api/world/report`. The town chip opens the map at that town.
    - It never shows who is online.
    - The trial copy has a chat too, with the bots saying a word now and then.

27. **One weather and one calendar for the whole world (owner: fairness, «عشان العدل»):**
    - `worldEventsAt(hour)` (sim.js) is deterministic: a seeded series of weather (rain, dust, heat, cold, locust, drought, dates), drawn by season, plus a calendar. Ramadan starts 33 hours earlier each game year (like the Hijri year), Eid al-Fitr follows it, and Eid al-Adha comes 57 hours after Eid al-Fitr.
    - In `step`, a world town (`s.world`) runs `syncSharedEvents`: its shared events become exactly the world's. Random events there are only the town's own (the governor's visit, the town festival).
    - Time, seasons and prayers were already shared through the world clock. A test checks two towns stay identical for 600 hours.

28. **Know the money before buying (owner, 2026-11-23):**
    - Build cards show the building's usual income and upkeep per hour.
    - With a spot chosen, `buildPreview(id, spots)` puts the building into `S` for a moment, runs `analyze`, and puts the town back. The tool chip then shows income, upkeep and net per hour for that exact spot (homes: the tax when full), plus a hint when there are too few people to staff it.

29. **Who a building serves or bothers (owner, 2026-11-23):**
    - `reachHomes`/`reachLine` (main.js) count the homes and people within a building's radius.
    - The tool chip shows «يخدم …» for services and shops, and a red «⚠️ … بيزعّل …» for polluters (the existing `pollute` already lowers those homes' happiness and raises the health bill). The building's sheet shows the same, with the fix for polluters.
    - The grocery now has `radius: 4, happy: 3`. The old test expecting no reach was updated. The careful bot still reaches مدينة on time.
30. **Daily net is real (owner, 2026-11-23):**
    - The hourly net genuinely changes: shops ×0.6 at prayer (not fajr), and rush-hour jams cut staffing and add congestion.
    - The budget's per-day line used to be this hour × 24, so it jumped. `step` now keeps `s.netLog` (the last 24 hourly nets), and `dayNet(s, a)` sums it (scaling up a short log; old saves without a log fall back to ×24).
    - The budget sheet shows a 💡 line explaining why the hour changes, and says when it is prayer or a jam right now.
31. **Mosque reach as a map (owner, 2026-11-23):**
    - The owner wanted the mosque's reach shown like water and power, not as a count of homes.
    - `reachLine` for `service: "mosque"` now says «مداه N مربعات حوله».
    - `mosqueMap()`/`mosqueGaps()` (main.js) colour every tile any mosque reaches in green and the homes outside it in red (heat overlay), with a toast giving the count. There is a button in the happiness sheet and in every mosque's sheet.
32. **No contradictions, نشرة الجوف, prayer-time labels, Ramadan calendar (owner, 2026-11-23):**
    - `here()` in main.js puts the town's own name in place of «الرافعية» in sheets (except whatsnew, settings, how, region, welcome, wnews), toasts and chips.
    - The needy decision's `text` is a function of season and Ramadan. The decision sheet accepts text functions.
    - The summer «القايلة» complaint changes in Ramadan and is dropped when there is a café or park.
    - World bulletin: table `wnews` (wiped with the gen). `Board.news()` gets lines from claim, sync (era up, pop marks 100…20000, once each) and WarServer (`world.news`: war, truce, peace, hit, intercept). `GET /api/world/news`. The trial (preview.js) has `pvNews`.
    - Client: `WNEWS`, `wnewsPoll` (60 s), tabs in `newsSheet`, `worldNewsSheet` (forecast via `worldEventsAt` 48 h ahead, top towns from /map, the feed). The badge counts unread world lines not about your own town.
    - `partOfDay` now follows PRAYERS: الضحى until dhuhr, الظهر until asr, and so on.
    - Ramadan, Eid and Adha are never random now, in either mode. `calendarAt(hour)` (sim.js): Ramadan 24 h, Eid 12 h, Adha 12 h, 80 h after Ramadan starts, once per YEAR_HOURS (288), 33 h earlier each year. Solo syncs them by `s.day`; the world uses the same function inside `worldEventsAt`.
33. **Longer seasons (owner, 2026-11-23, both modes):**
    - `SEASON_DAYS` 3 → 7, and `YEAR_HOURS = 24 * 4 * SEASON_DAYS` (672). The day is unchanged: `HOUR_MS` is 50 s, so a day takes 20 real minutes at ▶ and 4 at ⏩. The frame `dt` is capped at 0.1 s, so a slow phone runs slower, never faster.
    - `calendarAt` scales with the year: Ramadan Y/14 (48 h), each Eid 24 h, Adha at 0.28 Y. Ramadan starts 0.115 Y earlier each year.
    - `PROVINCE_FEES` were scaled by SEASON_DAYS/3 to keep the same cost per hour. `springGreen` divides by 34·SEASON_DAYS/3. The «سنة كاملة» achievement uses YEAR_HOURS.
    - Old saves and the world: the season is worked out from the hour, so it can jump once when this goes live (for everyone in the world at the same time).
34. **Straight roads, a 30-minute day, unique and renamable town names (owner, 2026-11-23):**
    - Roads (building and arrange): `roadAim()` in main.js.
      - The first move picks x or y, and the road stays on that line.
      - It turns only on a clear sideways move (≥2 tiles off the line, and the finger's last tiles mostly sideways), from the corner.
      - `roadStroke` rebuilds the stroke's pending tiles on every move; tiles pending before the stroke stay. `arrPaint` uses the same aim.
      - The other painting tools use `stepTiles`, so nothing is skipped.
    - Day: `HOUR_MS` 50 s → 75 s.
      - World continuity: the server stores `meta.slow_at` the first time the new code answers /clock, and returns it as `slowAt`.
      - The client's `worldHours()` counts 50 s hours before slowAt and 75 s after, so the world's hour never jumps. The trial is slow from its epoch.
    - Names: `townNameKey()` (data.js) ignores spaces, `_`, tatweel, hamza forms, ة/ه, ى/ي and harakat.
      - Claim refuses a taken name with 422. The client also checks the map first.
      - `POST /api/world/rename` works once (column `plots.renamed`, added with ALTER TABLE). It writes a bulletin line.
      - /sync now returns the town's name, so a rename reaches the other phone. The UI is a button on your own town's card in the al-Jouf map.
35. **Money balance (owner, 2026-11-23, both modes):**
    - The owner asked for fun that is neither easy nor tiresome. I tested first: farms carried village income (66 of 97/h at 56 people), and goals that need no building gave free money.
    - The province fee hit 14,000 at once when a town became a city just before the year ended.
    - Farm market: `a.farmDemand = 45 + pop·0.6 + neighbours·0.3`; above it crops sell at 40% (`a.farmRaw` is the raw value). The budget sheet explains it.
    - Goal rewards with no building were roughly halved: pop 40 → 200, بلدة → 800, happy 70 → 800, net 500 → 1200, مدينة → 2500, محافظة → 6000, حاضرة → 50,000. Building goals still cover their cost.
    - The province fee is prorated by `s.feeHours` (hours at each era this year). Old saves count the untracked part at the current era.
    - The event banner (`#event`) hides 30 s after an event starts (`evBanner`). Its key ignores digits, so the hourly «باقي N ساعة» doesn't reset it.
36. **Fee warning and turning wind turbines (owner, 2026-11-23, both modes):**
    - `provinceFee(s)` in sim.js is the single place that computes the fee (also the estimate).
    - `step` warns 72 h and 24 h before the year ends. The budget sheet shows the coming fee and the days left.
    - The windfarm model has no blades now. `windRotor` (models.js) is spun by WarFX parts (kind "wind", `WIND_TOWERS`): slower when damaged, still when wrecked.
37. **Undo while drawing a road (owner, 2026-11-23, both modes):**
    - In `roadAim`, a finger back on a tile of the committed segments cuts the path back to that tile, taking that segment's axis.
    - Going back to a wrong turn's corner undoes the turn, and going back along the road shortens it.
    - Arrange (`arrPaint`) keeps `drag.placed`. Roads no longer on the path go back to the store or the hand.
38. **Service cards and reach maps (owner, 2026-11-23, both modes):**
    - Tapping a `serv` card in the dock opens `serviceInfo(id)`: cost, upkeep, happiness, radius, how many you have, and the homes outside reach, with «اعرض مداه» and «ابنِ» buttons. Tapping it again while it is the tool deselects it as before.
    - `needCover`/`needGaps`/`needMap` generalise the mosque map. Buildings with the same `service` cover for each other; park and stadium go by their own id. Upgraded radii are counted.
39. **Roads follow the finger again (owner, 2026-11-23, both modes):**
    - The owner didn't like straight-only roads, so straight runs (step 34) were removed.
    - `roadAim` now keeps the finger's path tile by tile, using `stepTiles` so there are no gaps. Stepping back onto the path cuts it there (the undo from step 37 stays). It is used by building (`roadStroke`) and by arrange (`arrPaint`).
40. **The day is back to 20 minutes (owner, 2026-11-23, both modes):**
    - `HOUR_MS` is 50 s again. The server also stores `meta.fast_at` (the first /clock of this code) and returns it.
    - `worldHours()` counts 50 s hours before slowAt, 75 s from slowAt to fastAt, and 50 s after, so the world's hour never jumps. Seasons stay 7 days.
41. **No daytime glare (owner, 2026-11-23, both modes, high quality only):**
    - The sun on well water and car headlights bloomed into white halos by day.
    - `setTimeOfDay` now scales the glow material (1.2 by day → 7 at night) and the bloom threshold (6.5 by day → 3.2 at night, and 3.2 during a war scene).
42. **Live al-Jouf (owner, 2026-11-23, world only):**
    - WebSocket `GET /api/world/live` uses the Durable Object's hibernatable sockets (`acceptWebSocket`). The client sends `{t:"hello", name, secret}`, and the socket remembers its plot. Pings every 45 s.
    - The server pushes hints: `chat` (with the message), `news`, `town` (a town's snapshot changed or it was renamed), and `war` (to that plot only; WarServer.note → `world.ping`). Who is online is never sent or shown.
    - Strikes settle on time: after every war call, `armWar()` sets a DO alarm at the next arrival, and `alarm()` settles.
    - Client: `LIVE`, `liveOpen` / `liveRetry` (1 s…30 s) / `liveClose` / `liveHint`. When live, polls are only safety nets (war 90 s, chat 120 s, news 5 min).
    - A town's layout goes up 3 s after a change (`warSyncNow` only sends when the layout key changed); its numbers every 2 min. `refreshVisit()` redraws a visited town live.
    - The trial (preview) has no socket and keeps polling.
43. **Away earnings cap (owner, 2026-11-24, world only):**
    - The owner came back to 55,000 in a village. `AWAY_CAP` (sim.js) is [5000, 10000, 20000, 40000, 80000] by era. `deputyCatchUp` caps the gain (never the money from before) and returns `cap`/`capped`; the deputy report explains it.
    - A hidden or asleep tab no longer runs every missed hour in full: in world mode a gap over 3 h goes through `deputyCatchUp`.
    - Server side, for old cached games too: on /sync after more than 10 min without a sync, a gain above cap·1.1 since the last sync is taken back with `WarServer.fine()`. This is a charge the game applies once, plus a note.
    - It is recorded in table `awayfix`; `GET /api/world/awayfix` lists who and how much.
    - The past can't be fixed: the server never kept the money before a return.
44. **Asleep with the game open (owner, 2026-11-24, world only):**
    - After 15 min without a touch (`IDLE_MS`; tests set `globalThis.__idleMs`), `S.idle = { money }` is set and `runHour` caps the gain at `AWAY_CAP` for the stage.
    - A deputy catch-up after a hidden spell is clamped to the same cap. The frame drops to 15 fps.
    - A touch (`idleWake`) ends it and says how much was earned.
    - `idleClamp()` keeps what is above the cap in `S.idle.pool`. Later bills while asleep (fee, repairs, war charges) are paid from the pool first, so the cap only ever removes surplus income, never the mayor's own money.
    - The deputy's catch-up caps once at the end, so its bills come out of the surplus too.
45. **Road upgrades like building upgrades (owner, 2026-11-24, both modes):**
    - The roads category has an «تطوير الطرق» card (tool `roadup`, in `UP_CARDS.road`): dirt → asphalt (needs the asphalt research) → main street.
    - Ready roads show in orange above the road surface. `setOverlay` got opacity and lift arguments.
    - Tap or drag selects, ✓ upgrades. Cost is the next road's price (via `build`, which replaces road kinds).
    - `roadNext`, `roadUpWhy` and `readyRoads` are in main.js. A road's inspect sheet has «⬆ طوّره إلى …».
46. **Mandatory updates (owner, 2026-11-24, both modes):**
    - `js/version.js` says "dev" in the repo.
    - `scripts/copy-site.mjs` writes a fresh stamp on Cloudflare's build (`WORKERS_CI`/`CI`, or `STAMP_VERSION=1` locally) before the Worker is built, so the server and its files share it.
    - `GET /api/version` answers with no-store.
    - The game checks at start, every 5 min and when it comes back to the front (`versionCheck`). A different version opens the «update» sheet, which can't be closed or covered. «حدّث الحين» saves, re-fetches the game's files with cache: reload, and reloads.
    - If the browser still serves old files after one try, it says to close the browser.
    - "dev" (local, the trial, the single-file bundle) never checks.
    - **Never commit a stamped js/version.js** (local deploy tests overwrite it: put "dev" back).
47. **Phone notifications (owner, 2026-11-24, world only):**
    - PWA files: `manifest.webmanifest`, `icons/icon-192|512.png`, `sw.js` (notifications only, no caching). copy-site copies them.
    - Web Push with **no payload**:
      - The server makes its own VAPID keys once (meta `vapid`); nothing to set in Cloudflare.
      - `wake()` POSTs to the endpoint with a signed ES256 JWT.
      - The service worker then GETs `/api/world/push/inbox?k=sha256(endpoint)` to learn what to show.
    - Tables `pushsubs` (k, plot, endpoint) and `pushq` (1 h). 404/410 drops a subscription.
    - Sent for every WarServer note (`world.notify`) and when a chat message names your town or player name.
    - Not sent while that town's game is open in front: sockets ping every 30 s only when visible, and the attachment keeps `seen`. Sends go out after the answer (`outbox`/`flush`, also after the alarm).
    - Client: `pushOn`/`pushOff`/`pushState`, a one-time `pushOffer` card after entering al-Jouf (it waits for other screens), and a toggle in settings. iPhone outside the home screen gets install steps.
    - Local tests: WAR_TEST allows an http://localhost endpoint (a fake push service).
48. **Away cap bug with debts (owner, 2026-11-24, world only):**
    - الصالحية left in debt (−7,975). The away shield cleared it, and the town came back with 5,000. The server counted 12,975 as income and took 7,475, leaving −2,475. Reproduced exactly.
    - Fixed in both places: the client cap and the server cap now count from `max(0, money before)`.
    - `Board.refundDebtFix()` (once, meta `refund_debtfix_v1`) gives back what such rows took beyond the right amount, as a negative charge with an apology note. It is recorded in `awayfix` with a negative `taken`.
    - The client's `idleClamp` after charges now runs only for bills (paid > 0), never for refunds.
    - The refund note has kind "apology" (`WarServer.fine(..., kind, extra)`). The game shows it as a centred box (`apologyBox`): our mistake, the amount given back, 30 s with a shrinking bar, or «تمام».
    - `GET /api/world/awayfix?view=page` is the same list as an Arabic page for the owner. Red is a wrong deduction (the town left in debt), green is a refund.
49. **Citizens' reminders and a test button (owner, 2026-11-24, world only):**
    - Syncs carry `pending` from `pendingSummary`: unanswered complaints (mood < 0, the most liked first) and a waiting decision. They are stored in `plots.pending`.
    - `Board.remind()` runs on the alarm. The alarm fires every 30 min while anyone has notifications on (`armWar` also arms it on every POST).
    - It pushes «📰 أهل «town» يبونك» when the mayor has been away over 1 h, at most every 8 h (`plots.reminded`).
    - `POST /world/push/test` sends one to your phones now, even with the game open. It is the «📲 جرّب التنبيه» button in settings.
    - The push request now sends an empty body (no hand-set Content-Length).
    - WAR_TEST shortens the waits (10 s away, 30 s between, 5 s alarm).
50. **iPhone steps and move codes (owner, 2026-11-24, world only):**
    - The iPhone's home-screen app has its own storage, so the account moves with a code. `POST /world/handoff` gives a 6-digit code (30 min, once).
    - `POST /world/handoff/claim {code}` gives the new app its own key (table `keys`). Both keys work (`keyOk`). Failed claims are limited to 30 a minute.
    - `pushIosHelp` shows the code and five steps with share and add icons, or asks for iOS 16.4+. The join sheet has «📲 عندي رمز نقل».
    - **No-code move (done):** `/world/handoff` also returns a long token (7 days, once). `pushIosHelp` puts it in the address (`/?link=TOKEN`) and points the manifest link at `/api/world/manifest?t=TOKEN` (start_url `/?link=TOKEN`).
    - On the home-screen app's first launch, the startup code claims it by itself and cleans the address. The 6-digit code sits under «ما انتقل حسابك؟» as the fallback.
    - Short steps for each phone. iPhone in Safari: 3 steps (share → add to home screen → open the icon → enable). The code sits under «🔑 احتياط». Android: the phone's own allow prompt, no steps. Refused once: `pushDeniedHelp` gives one step for this phone (iPhone settings, or 🔒 by the address on Android).
    - **The whole game moves into the home-screen app (owner: the app opened empty in al-Jouf):**
      - In Safari on an iPhone (not standalone), `iosPrepareMove` gzips every `rafaya-*` localStorage key and stores it with `POST /api/move/put` (table `moves`: 7 days, plus a 6-digit code for 24 h). It puts `?move=TOKEN` in the address and the manifest's start_url (`/api/world/manifest?m=`).
      - The copy is refreshed at most every 10 min from `save()`, and on load.
      - The standalone app's startup takes it (`/move/take`, once), restores the keys, and reloads («جبنا لعبتك كاملة»). It asks before overwriting anything played there.
      - An empty app asks once for the code (`handoffSheet`). Safari's settings have «📲 انقل لعبتك للتطبيق» (`moveCodeSheet`).
      - The older account-only `?link` and `/world/handoff` stay as the last resort.
    - **iPhone steps by version (owner said it was hard):**
      - iOS 26 put Share inside «⋯» (bottom right) and added an «Open as Web App» switch that must stay on, so the steps say both. Older iOS gets ⬆️ with a «⋯» hint.
      - The fallback code now lasts 24 h.
      - A home-screen app with no account asks for the code straight away (once), and also when the link didn't work.
51. **The owner's control panel (owner, 2026-11-24):**
    - `/admin.html` (copied by copy-site, noindex) talks to `/api/admin/*` with an `x-admin` token.
    - Login checks the owner's code against `ADMIN_CODE_HASH` in worker.js. The code itself is only in the owner's chat, never in the repo. Ten failed logins in 10 minutes lock login for 10 minutes. Tokens are kept hashed in `admintokens`.
    - Tools:
      - stats.
      - reports: clear, ban, rename.
      - chat: delete (a live `chatdel` hint removes it from open games), ban.
      - players: search, ban/unban with a reason (`players.banned`; banned players get 403 "banned" and a toast), gift.
      - gift: a negative charge plus a note of kind "gift", shown as a centred box like the apology.
      - announce: a bulletin line plus a chat message as «📢 الإدارة».
      - away: the awayfix page.
    - To change the code: put the SHA-256 of the new code in `ADMIN_CODE_HASH`.
    - Gifts checked end to end: an online player, and an away player who comes back. A live hint arriving while a war poll runs now triggers another poll right after (`WARX.again`), so nothing waits up to 90 s.
    - WarServer.state stores `acct.seenSeq` (the charges the game has applied). The panel's «🎁 الهدايا» tab shows each gift as arrived or not yet. A gift lands only when the player is in al-Jouf.
    - The players search now stays after an action (`lastQ`); before, the list reset and a button could hit the wrong player.
    - All 15 panel checks pass through the UI: login, reports, chat delete, ban/unban, rename, gift (arrived), announce, away page.
52. **Money vaults (owner, 2026-11-24, world only):**
    - The economy was measured first: careful bots' net per hour is about 81 / 417 / 873 / ~0 by stage, and the dearest buildings are 2.1k / 27k / 90k / 210k / 420k.
    - `moneyCap(s)` = `BASE_VAULT[era]` [5k, 15k, 50k, 150k, 400k] + each vault's `VAULT[lvl].cap`. Levels: 5k / 15k / 40k / 120k / 350k, upgrade prices 2.5k / 8k / 25k / 70k, eras 0–4. A vault is worldOnly, max 4, 600 to build, upkeep 2×upkeepX.
    - **Prices raised (owner, 2026-11-24, "not easy, but fair"):** build 1,500, and each extra vault costs ×(1 + 0.5·vaults already built) via `priceOf(s, id)`: 1,500 / 2,250 / 3,000 / 3,750. Upgrades cost 6k / 18k / 50k / 140k, about 40% of the capacity added, and always below the stage's own strongroom.
    - `earn()` caps only the hourly income and the deputy's steady income. Loans, rewards, refunds and gifts still come in, and money already above the cap is never taken.
    - Upgrades go through the vault branches in upgradeCost, upgradable, bizBlocker, upgradeEffect, levelName and upgradeMats. Models `vault`/`vault1`/`vault2`.
    - The HUD says «🔒 الخزنة مليانة» and gives one toast when it fills. The budget sheet shows the capacity, and the vault's sheet and card show capacity numbers.
53. **Start again (owner, 2026-11-24, world only):**
    - Settings has «🔄 ابدأ مدينتي من جديد» (`restartSheet`); you type the town's name to confirm.
    - `POST /world/restart` allows once per 24 h (`plots.restarted`). It calls `WarServer.resetTown` (deletes acct, charge, dmg, hit and note rows by k1 via the new `db.delK1`; relations stay), resets the plot's row, and writes a bulletin line.
    - The game makes a fresh town on the same land and name with `war.seq` 0, and the war notes seen are reset. The trial supports it too.
    - Two phones: the fresh town keeps `world.restartAt` (the server's `restarted`). /sync refuses a copy whose `restartAt` is older and answers `{restarted, town}`. `syncReply` on the other phone swaps in the fresh town (`freshWorldTown`) and says why.
54. **Telling players what changed (owner, 2026-11-24, both modes):**
    - **Owner's rule: every update that goes live gets its own new line (a new title) in WHATS_NEW, even a change to an existing feature (e.g. «💰 أسعار الخزنة»), so the updates tab and «الجديد من آخر مرة» show it.**
    - Each phone keeps the WHATS_NEW titles it has seen, per mode (`rafaya-news-titles-<mode>`).
    - `newSinceSheet` («✨ الجديد من آخر مرة») lists only the unseen lines, with «كل التحديثات» for the whole list. A phone that only had the old date stamp gets the newest 5.
    - `maybeWhatsNew` waits for the screen in front (the away or deputy report) to close. It runs on «كمّل» (solo) and on entering al-Jouf; the notifications offer comes after it.
    - With mandatory updates this reaches everyone: every new item needs a new title in WHATS_NEW.
    - The news sheet has an «✨ التحديثات» tab (`updatesNewsSheet`) next to the town's news and al-Jouf's (the solo game shows the town and updates tabs). Unseen updates add to the news badge.

**Nothing is half-done.** All tests pass (39/39). Everything is pushed and auto-deployed.

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
