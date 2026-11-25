# PROJECT MAP — «الرافعية» and «عالم الجوف»

Read this first. It tells any AI or developer where everything lives, how the pieces talk, what must
never break, and how a change goes live. (HANDOFF.md is older history; trust this file over it.)

- Live game: https://rafaya.vamosx.workers.dev
- Repository: `aa9986087-cyber/rafaya`. `main` deploys to production automatically.
- Stack: plain ES modules + three.js r160 (in `vendor/`), no build step and no npm dependencies.
  Server: one Cloudflare Worker + one Durable Object with SQLite (`src/worker.js`).

---

## 1. The owner and the house rules (most important)

The owner is Saudi and is not a programmer.

- **Language and format:** reply in **Arabic** (Gulf/Saudi), in short bullets, and never show code.
- **Releasing:** push to `main` (production) **only** when the owner writes «ارفع». Work and pushes on a
  side branch are fine at any time. Every release is mandatory for players. Never add `UPDATE.json`.
- **Release note:** every player-facing release adds a short Arabic item at the **top** of
  `WHATS_NEW.items` in `js/main.js` and bumps `WHATS_NEW.v` for each affected mode (`solo`, `world`;
  use `"both"` for both). Exception: when the owner says it is a secret or surprise, add no item.
  After the release, check that the live build has the note («النشرة ← التحديثات»).
- **Saves:** never break old saves (local saves or the server snapshots).
- **Speed:** be fast. Don't make screenshots or renders unless asked.
- **Privacy:**
  - Never show other players' names, times or stats.
  - Store nothing personal: no e-mail, no phone number.
  - Google sign-in keeps only a hash of the account number.
- **Secrets:**
  - Never put the admin code in the repo; the code stores only its SHA-256 (`ADMIN_CODE_HASH`).
  - Never ask for or store the Google client secret. Only the public Client ID is used.
- **Before pushing to `main`:** fetch and merge any new `origin/main` commits (others also commit). If
  there are conflicts, keep both sides, then run `npm test`.
- **When the owner is vague:** ask one short question rather than guessing. Wrong guesses annoy them.

---

## 2. Files: where everything lives

| File | What it holds |
|---|---|
| `index.html`, `css/style.css` | The one page and its styles (sheets, HUD, dock, toasts). |
| `js/data.js` | Every number and list: buildings `B`, military `MIL`, eras `ERAS`, tech, goals, events, decisions, seasons, terrains, the **world map `WORLD`** and its helpers `worldPlot/worldXY/worldTerrain/worldPlace`, `townNameKey`. |
| `js/sim.js` | The town simulation, pure (no DOM): `newGame`, `build`, `demolish`, `fillWadi`, `step` (one hour), `analyze` (the town right now), dams/lakes/groundwater, traffic, power, quarters, elections, moving, wear/repair, the deputy while away, **`pack`/`unpack` (saves)**. |
| `js/main.js` | ~5000 lines: everything on screen. See the section index in §3. |
| `js/world3d.js` | The 3D town: ground, roads, instanced buildings, light, day and night, rain, flood, lightning, hover/overlay marks, `pick` (screen → tile). |
| `js/models.js` | Every building as a low-poly model built from shapes in code (no model files). `PLACE_STYLE` gives each place of al-Jouf its look. |
| `js/warfx.js` | War on screen only: moving military parts, damage, the attack scenes. Never decides anything. |
| `js/world-weather.js`, `js/world-lighting.js`, `js/building-surfaces.js`, `js/traffic-path.js` | Rendering helpers: wet surfaces, night light map, wall textures, car paths. |
| `js/news.js` | «نشرة الرافعية»: the residents' posts in solo play. |
| `js/people.js` | The families in each house (made from the tile, nothing saved). |
| `js/advisor.js` | «المستشار المالي»: reads the town and gives a ranked list of fixes. |
| `js/sound.js`, `js/rain-sound.js` | Sounds made in code, plus the owner's rain and thunder recordings in `vendor/sound/`. |
| `js/war.js` | «صراع الجوف» rules: pure numbers, shared by the server and the game. |
| `js/warserver.js` | The war **server logic** (decides every result). It runs inside the Durable Object, and inside `preview.js` for the trial. Tables: acct, charge, rel, op, fly, dmg, hit, note, req. `moveTown` moves all of a town's war rows. |
| `js/save-version.js` | Save revision ids, so two phones can't overwrite each other. |
| `js/version.js` | `VERSION`/`REQUIRED`. They are `"dev"` in the repo; the deploy stamps them. |
| `js/preview.js` | The **trial copy only**: a fake al-Jouf server in the page, with bot towns. It answers `/api/world/*` itself. **Every new server route needs a twin here**, or the trial breaks. |
| `src/worker.js` | The server: static files plus `/api/world/*` (players) and `/api/admin/*` (owner). One Durable Object `Board` holds all SQLite tables (§4). |
| `src/moderation.js` | The bad-word and protected-family-name filter for names and chat. It normalises Arabic letters, including Persian چ/گ/ڤ/پ. |
| `src/google.js` | Checks a Google sign-in token (RS256 via Google's keys). |
| `src/web-push.js` | Phone notifications (VAPID Web Push). |
| `src/review-access.js` | Signed read-only access for an outside reviewer. |
| `admin.html` | The owner's control panel: stats, reports, chat, players, ban/delete, gifts, rename, name-fix requests, announcements. |
| `privacy.html` | The Arabic privacy policy, served at `/privacy`. Update it when data collection changes. |
| `sw.js`, `manifest.webmanifest` | Service worker (notifications) and the home-screen app. |
| `scripts/copy-site.mjs` | The deploy build: copies the site into `dist/site` and stamps the version. |
| `scripts/bundle.mjs --preview` | Builds the one-file **trial** `dist/rafaya-trial.html`, with sounds inline. |
| `test/*.test.mjs` | `npm test`: about 60 tests (sim, war, saves, google, push, admin review). `test/balance.mjs` is a money-balance runner. |

---

## 3. `js/main.js` index (search for these section comments: `// ---------- <name>`)

| Section | What is there | Key functions |
|---|---|---|
| state, the 3D town | `S` (the current town), `A` (analysis), `save()`, `refresh()`, `sync()` | `save`, `refresh` |
| touch and mouse / choosing a spot | Tools, painting roads, the fill and upgrades, pending tiles and ✓ | `setTool`, `apply`, `confirmPending`, `paintStarts`, `canDo`, `whyNot` |
| the layout editor | «✏️ تعديل»: move, remove, undo/redo with snapshots | `enterArrange`, `leaveArrange`, `arrSnapshot`, `arrRestore` |
| build dock, HUD, toasts and sheets | Cards, top bar, the stage line | `renderCards`, `toast`, `sheet`, `closeSheet` |
| نشرة الجوف | The world bulletin | `WNEWS` |
| online | `api(path, body)`. It adds `device` to every `/world/` POST. Also visiting towns. | `api`, `visitTown`, `deviceId` |
| the world of al-Jouf | The account in `WORLD_ID`, the town save in `WORLD_SAVE`, sync to the server, conflicts | `me`, `worldSync`, `sendWorldSave`, `readOwnTown`, `readCloudTown`, `enterWorldTown`, `openWorld` |
| notifications, iPhone app, updates | Push setup, moving the save to the installed app, `versionCheck` (every 60 s) | `versionCheck` |
| live | The WebSocket: hints for chat, war, news and town | `liveOpen` |
| name fix, Google | Admin-requested renames, the Google sign-in and link | `namefixSheet`, `googleSection`, `googleLogin` |
| world map sheet | The map, claiming land, «🚚 انقل مدينتك» (once only), renaming the town (once only) | `worldMapSheet`, `moveSheet`, `renameSheet` |
| «صراع الجوف» | War state, the command center, relations, targeting, scenes, damage | `warSyncNow`, `relSheet`, `startTargeting` |
| the public chat | World chat | |
| the region | Solo-mode region map | `regionSheet` |
| what is new | **`WHATS_NEW`** (the release notes) | `whatsNewSheet` |
| the people of the house, the advisor | Families sheet, the advisor sheet | |
| settings | Settings, «✏️ اسمك» (the player's own name, once only), «حسابك وقوقل», playtime | `nameSection`, `googleSection` |
| the clock, asleep, iPhone Safari, start | `runHour` (the game hour: `step` then UI), idle/deputy, boot | `runHour` |

---

## 4. The server (`src/worker.js`)

- `/api/world/*` is for players. A POST carries `{ name, secret }`, which is checked by `keyOk`.
- `/api/admin/*` is for the owner. `POST login {code}` returns a token, which goes in the `x-admin` header.
- **Main tables:**
  - `players`: name, hashed secret and recovery code, `plot`, `played`, `google` (hash), `renamed`, `banned`, `device` (hash).
  - `plots`: one row per town. The plot number is the key. It holds the snapshot (the packed town), money, pop, era, `renamed`, `moved`, `save_version`.
  - `wnews` (bulletin), `chat`, `comments` (keyed `w<plot>`), `reports`, `feedback`.
  - `pushsubs`, `pushq`, `citizen_support`, `citizen_support_push`.
  - `namefix`, `banned_devices`, `admintokens`, `keys`, `handoff`, `awayfix`, `meta`.
  - `war`: every war table, through `sqlWarDb`.
- **Schema changes are additive only:** `ALTER TABLE … ADD COLUMN` inside try/catch in the constructor.
  Never drop or rename a column. One-time data fixes also go in the constructor (guard them with a
  `meta` key, or make them idempotent).
- **Important routes:**
  - `join`, `recover`, `google/login`, `claim`, `sync`, `move` (once), `newname` (once), `rename` (once),
    `restart`, `war/*`, `chat`, `news`, `map`, `town/<plot>`, `clock`, `me`.
  - Admin: `remove` (deletes a player and bans their device), `ban`.
- **Moderation:** every name or chat text goes through `badText` and `this.moderation.blockedName/blockedChat`.
- **Bulletin:** add a line with `this.news(kind, text, plot, n)`. Removed towns are **never** announced (the owner's rule).
- **Citizen support («حساب المواطن»):** rows in `citizen_support`. Round `c2` pays 250 every game week
  (7 days of al-Jouf), three times, to towns under 1000. The payment goes through `war.charge` and a note,
  so the phone applies it.
- **Timing:** after a deploy, the Durable Object switches to the new code in **about 5 minutes**.
  `/api/version` and the static files switch at once.

---

## 5. Things that must never break

1. **World plot numbers.** `WORLD` grew from 24×16 to 40×26, then to 52×26. Old plots keep their
   number through the `old`/`first` offsets and the `PLACE_KEEP` table in `data.js`. A new widening must
   keep every existing plot's number and place. Check all of them.
2. **Saves.** `unpack` must read every old save: tiles strings `ground:id:lvl:res:build:cond:rot:wd:ext`,
   map-size migration, `hv`/`fv` versions. Saves carry `world.plot` and `world.owner`. The game refuses a
   save whose plot or owner differs (`ownsActiveSave`), so a move must rewrite `world.plot` in **both**
   the local save and the server snapshot.
3. **The server decides war and money.** The game only shows it. Never trust a number sent by the client.
4. **`preview.js` mirrors the server.** A new route without a trial twin breaks the trial copy.
5. **Ghost and preview models.** `world3d.setGhost` draws every geometry set except lights and glow.
   (Drawing only `matte` once made the tank and dam unbuildable.)
6. **Performance on phones.** Redraw the ground once per batch, not once per tile (`world.sync` with
   `tiles:true` is heavy).

---

## 6. How to work and release

- **Tests:** `npm test`. They must stay green.
- **Local server:** `node scripts/copy-site.mjs && npx wrangler dev --port 8787 --var WAR_TEST:1`.
  Test with `curl` (Node `fetch` can't use the sandbox proxy).
- **Trial copy for the owner:** run `node scripts/bundle.mjs --preview`. That gives
  `dist/rafaya-trial.html`, which the owner opens from a link.
- **Release (only after «ارفع"):**
  1. `git fetch origin main`, merge it (keep both sides on conflicts), then run `npm test`.
  2. `git push origin HEAD:main`. Cloudflare builds and deploys automatically.
  3. Verify live: `curl https://rafaya.vamosx.workers.dev/js/main.js | grep <the new WHATS_NEW text>`.
     For server changes, wait about 5 minutes, then check the route or data.
  4. Tell the owner in Arabic what changed, what was verified, and anything not verified.
- Commit messages may be Arabic or English. Never put a model name in them.

---

## 7. Features at a glance (where to look)

| Feature | Where |
|---|---|
| Buildings, prices, levels | `data.js` `B`, `BIZ_LEVELS`; `sim.js` `build`, `houseTop/housePrice/buildHouseAt` |
| Roads, power roads, roundabouts | `data.js` `ROAD_IDS`, `powerroad`; `sim.js` power/paths |
| Decorations (small, quarter, monument 2×2) | `data.js` flags `quarter`, `span`, `monument`, `decopart`; `sim.js` |
| Wadi, fill, dams, lakes, groundwater | `sim.js` `fillWadi`, `updateLake`, `stepGround`; `world3d.js` flood and wadi water |
| Weather, rain, lightning, seasons | `sim.js` shared weather; `data.js` `LIGHTNING`; `world3d.js`; `sound.js` |
| World map and places | `data.js` `WORLD`; `main.js` `worldMapSheet`; `models.js` `PLACE_STYLE` |
| Moving a town (once) | `worker.js` `move`; `warserver.js` `moveTown`; `main.js` `moveSheet` |
| Names (player once, town once), bad names | `worker.js` `newname`, `rename`, `namefix`; `src/moderation.js` |
| Bans and device bans | `worker.js` `ban`, `remove`, `banned_devices`; `main.js` `deviceId` |
| War | `war.js` (rules), `warserver.js` (decides), `main.js` war sections, `warfx.js` (show) |
| Bulletin and chat | `worker.js` `news()`, `chat`; `main.js` نشرة الجوف and chat sections |
| Citizen support | `worker.js` `startCitizenSupport2`, `payCitizenSupport`, `flushCitizenSupport` |
| Google sign-in | `src/google.js`; `worker.js` `google/*`; `main.js` Google section |
| Release notes | `main.js` `WHATS_NEW` |
