# Handoff prompt: paste this into a new Claude session

> Copy everything below the line into the first message of a new Claude Code session that has the
> repository `aa9986087-cyber/rafaya` attached.

---

You are taking over the game «الرافعية» and its online world «عالم الجوف»
(live: https://rafaya.vamosx.workers.dev). Repository `aa9986087-cyber/rafaya`. Another Claude session
built most of it with me; you continue from where it stopped.

## Read first (in this order)
1. `PROJECT_MAP.md`: where every file is, how the pieces talk, what must never break, how to release.
   It is the source of truth. `HANDOFF.md` is older history.
2. `AGENTS.md`: the release-note rule.
3. `docs/ENDING_PLAN.md` (the ancient world «الجوف القديمة» and the end of the current world) and
   `docs/CASTLE_PLAN.md` (Qasr Marid, built but switched off).
4. Then `git log --oneline -40` on `main` and on the branch `ccr-0d55594b-h0tozc`, so you see recent work.

## Who I am and how to talk to me
- I am the owner, Saudi, not a programmer. **Reply in Arabic (Gulf), in short bullets, never show code.**
- If I write «عربي», your last reply came out in English: send it again in Arabic.
- If I am vague, ask **one** short question instead of guessing.
- I care most about looks and quality: luxurious, creative, high quality. No copyrighted assets.

## House rules (never break)
- **Push to `main` (production) only when I write «ارفع».** Work on a side branch freely and push it any time.
- Before pushing to `main`: `git fetch origin main`, merge it, run `npm test` (all green).
- Every player-facing release adds a short Arabic item at the **top** of `WHATS_NEW.items` in
  `js/whats-new.js` and bumps `WHATS_NEW.v` for the affected mode. Exception: when I say to keep
  something quiet or hidden (then no item, and don't tell players). After release, check the live build
  has it (curl the live js file).
- **Never break saves** (local saves and server snapshots; `unpack` must read every old save).
- **Privacy:** never show one player's private data to others.
- **Secrets:** never put the admin code or any key in the repo; never ask me to paste a secret in chat.
- Deleting a cheater = delete account and town (`removeOnce` with a new meta key in `src/worker.js`),
  **without** banning the device, unless I say otherwise.
- The server decides war and money; the game only shows. Every new server action needs a twin in
  `js/preview.js` (the trial copy). New `js/*.js` modules go in the `mods` list of `scripts/bundle.mjs`,
  and the trial bundle is one scope: top-level names must be unique, no import aliases.
- Commit messages: no AI model names.

## How I see your work
- Build the trial: `node scripts/bundle.mjs --preview` → `dist/rafaya-trial.html`. Send it to me as a
  page I can open on my phone (an Artifact, or a file I can open). It has «🧪 سيناريوهات الحرب» to try things.
- To check it yourself, Playwright with Chromium works; three.js must be served from `vendor/`
  (jsDelivr may be blocked): route `https://cdn.jsdelivr.net/npm/three@0.160.0/**` to `vendor/`.

## Infrastructure
- Cloudflare Worker + one Durable Object with SQLite (`src/worker.js`). `main` deploys automatically.
  The Durable Object picks up new code about 5 minutes after a deploy.
- I upgraded to **Workers Paid ($5/month)** on 27 Nov 2026, after the free daily database limit ran
  out and the whole world API returned 400 for hours. Keep database reads and writes reasonable.
- After that outage the server took money back from honest players (it read play during the outage as
  "away" and as a pushed clock). It was refunded with an apology (`outageRefund`, meta
  `refund_outage_v1`), and an outage is no longer read as away (`this.gap` in the Board constructor).
  The phone also keeps the world clock (`rafaya-clock-v1`) so its hours never run ahead when the server is down.

## Where we are (28 Nov 2026)
**Live on `main`:**
- War «صراع الجوف» (drones, missiles, air defence, radar, war room, salvos, tribute, truce, medals,
  bought shield, war guide), greater city «الحاضرة الكبرى», moving towns, chat, bulletin, citizen support.
- Citizen support rounds: c1 100, c2 250×3, c3 744 (under 1,500), c4 **7,664 to every town** (paid 27 Nov).
- Clock cheaters deleted and named in the bulletin and chat; clock is now server-based.
- War music was released then removed quietly at my request (`WAR_MUSIC_ON = false`).
- Qasr Marid castle is built but off (`CASTLE_ON = false` in `js/castle.js`); it comes back when I say.

**Ready on branch `ccr-0d55594b-h0tozc`, waiting for my «ارفع»:** destructive weapons.
- 🌋 «صاروخ الزلزال» (150,000, fee 10,000, radius 1.6) and 🌪️ «صاروخ الإعصار» (400,000, fee 25,000,
  radius 2.6). Only a «حاضرة» or bigger, and they need «مجمع صواريخ» (missile pad level 3).
- Everything in reach becomes **rubble**, except mosques and roads. Rubble doesn't work or get repaired;
  the owner taps it → «🧹 شيل الركام» (10% of the building's price × (1 + level), at least 500, 15
  minutes), then the land is empty to build on. The free demolish can't remove rubble.
- In the attack scene the buildings stand until the blast, then fall.
- Limits: a town fires at most **6 a day**; a town receives at most **4 a day** (rolling 24 hours).
- «🏰 منظومة الحصن» (40,000, from «محافظة», 3 levels, 40/55/70% vs the quake, less vs the storm) is the
  **only** defence that can intercept them; each try uses 2 interceptors.
- Trial scenarios «🌋 صاروخ الزلزال على مدينتك» and «🌪️ صاروخ الإعصار ومنظومة الحصن تتصدى».
- The WHATS_NEW item for these weapons is in this branch's history (commit aeded31); put it back when releasing them.
- To release: merge this branch into `main` (after «ارفع»), run the tests, push, and check the note is live.

**The war of 28 Nov 2026 (decided by me one question at a time; on this branch, not live until «ارفع»):**
- The destructive weapons and «منظومة الحصن» are **off** (`HEAVY_ON = false` in `war.js`): I release them later.
- A war starts at once and lasts a real day. Before declaring, a screen shows what you'd win and lose.
- At its end the town hurt more (share of its own worth) loses and pays 20% of its budget; no strike = draw.
  No spoils per strike. A truce, peace or a shield ends it with no winner (the shield: the other may declare
  again once it is down). The same two wait a day before another war. No protection for an owner away.
- A building at 85% hit again falls to rubble (cleared, then rebuilt from level 1).
- Half a town's worth out of action (disabled or rubble) at the war's end: down one stage, even the greater
  city; back at once when nothing is out of action. Wars declared before the update end as they began.
- Launchers reload in half the time; the heat adds half once; a push when weapons are ready.
- Simple rules for players: «📖 دليل الحرب ← 📜 القواعد باختصار». Trial scenarios «📉» and «🧱».

**Open questions / waiting on me:**
- A cheater «محمد خالد»: I must say which account (no exact name match was found).
- A sarcastic "the developer is going to sleep" chat message: I haven't chosen one.

**Later, only when I ask:**
- Qasr Marid back on (`CASTLE_ON`), a 3D battle scene, a castle model on the map.
- The ancient world «الجوف القديمة» (design in `docs/ENDING_PLAN.md`; trailer `jouf-trailer-final.mp4`
  approved, 69.6 s, no «قريبًا»). When I say «جاء وقت النهاية», remind me of the plan and start.

## How to start
1. Read the files above, then tell me in Arabic, in a few bullets, what you understood and what is waiting.
2. Don't change anything on `main` until I say «ارفع».
