# RAFAYA REMASTERED: the graphics update

The plan and the measurements for the graphics update. The official game is not replaced until the owner approves.

## Stage 1: the baseline (measured 2026-11-24)

**Engine:** three.js r160 on WebGL2. These are already in place:
- Instanced buildings: one draw per model and material set.
- PBR materials with normal maps, an HDRI sky (PMREM), ACES tone mapping.
- PCF soft shadows, bloom (UnrealBloom, night only), day and night, rain.
- A slow-phone fallback (main.js perfWatch → world.degrade).

**Test town:** a dense province (3,600 buildings over 60×60 tiles), seen whole (zoom 0.45), on a 390×800 phone viewport.

**Setup:** headless Chromium on software GL (SwiftShader).
- Timings from software GL say nothing about a phone's GPU, so they are not reported.
- The renderer's own counts are the same on any device.

| quality | pixel ratio | draw calls | triangles / frame | programs | textures | JS heap | town load |
|---|---|---|---|---|---|---|---|
| high | 2 | 145 | 3,227,420 | 41 | 25 | 78 MB | 11.6 s* |
| medium | 1.5 | 132 | 3,227,406 | 22 | 12 | 51 MB | 9.7 s* |
| low | 1.25 | 119 | 3,013,420 | 14 | 10 | 54 MB | 7.0 s* |

\* Load times are on software GL.

**Findings:**
- Draw calls are fine, thanks to instancing.
- Triangles are the problem: about 3 million a frame, at every quality, and the shadow pass draws them again. This is the main GPU and heat cost on phones.
- Models were built for close-up and are drawn the same at any distance. There is no level of detail (LOD).
- The heaviest models in the test town (triangles each × count = per frame):

| model | triangles each | count | per frame |
|---|---|---|---|
| palms (date farm) | 6,524 | 119 | 776,356 |
| house3 (villa) | 3,804 | 119 | 452,676 |
| house4 (apartments) | 2,556 | 122 | 311,832 |
| park | 1,940 | 119 | 230,860 |
| souq | 1,108 | 120 | 132,960 |

**Next:**
- LOD: simplified far models; ~80% fewer triangles at city view is the target.
- A frame-time based adaptive quality with hysteresis.
- A battery-saver mode.
- Then the visual stages.

**Measuring tool:** `?debug` in the URL exposes `RAFAYA_DEBUG.info()` (the renderer's counts) without changing the game.

## Stage 2: the performance engine

**What changed:**
- **Culling:** only the buildings the camera sees, plus a 3-tile margin, are drawn (`World.cull`, a few times a second while the camera moves). The town used to draw every building of the map every frame.
- **Far models:** zoomed out (zoom < 0.7, back at > 0.8), each building is drawn with its far model (`modelFar`), which keeps the same size and colours:
  - rounded boxes become plain boxes;
  - round shapes get about half their segments;
  - parts under 0.045 tiles go, except night lights;
  - the date palm becomes a trunk with six fronds (428 faces instead of 6,524 for a palm farm).
- **Adaptive quality:** «✨ تلقائي», the new default. It reads the CPU time per frame and how late frames come, and moves one step at a time:
  1. a little less sharp;
  2. no shadows;
  3. less sharp still;
  4. at most 30 frames a second.
  
  It steps down after 6 s of trouble, and only one step per 6 s. It steps up after 25 s of ease, never within a minute of a step down. Loading moments are ignored. Fixed choices only take steps 1 and 2, as a safety net.
- **New choices:** 🔋 توفير (battery saver: 30/20 fps, no shadows, no traffic) and فائقة (ultra: sharper up to 2.5x, 4096 shadow map). The old choices (عالية/متوسطة/خفيفة) keep their meaning.
- **Meter:** the trial copy and `?debug` show a small meter (fps, step, sharpness, what is drawn).

**Same dense province, same phone viewport (390×800 at 2.75x):**

| | before | after |
|---|---|---|
| triangles / frame, normal zoom (high) | 3,227,420 | 674,892 |
| triangles / frame, zoomed out (high) | 3,227,420 | 833,649 |
| buildings drawn, normal zoom | 3,600 | 320 |
| draw calls (high) | 145 | 117 |

## Stage 3: the buildings (batch 1)

**Remodelled: 20 buildings, the ones that were plain boxes.** Each keeps its tile, its colours and what it is.
- **Civic and trade:** school, clinic, police, civil defence, bank, grocery, mall, library, hospital, hotel, mandi house.
- **Industry, power and water:** generator yard, factory, workshop, solar field, water tower, power station, date factory, dairy, desalination.

**Shared kits:**
- **Civic** (`kBlock`, `kWindows`, `kEntrance`, `kMashrabiya`, `kRoof`, `kPlanter`, `kParking`, `kGround`): stone plinths, parapets and cornices, framed windows with sills (just the glass when far), entrance canopies, mashrabiya screens, roof AC units and water tanks, planters, parking bays.
- **Industry** (`kShed`, `kRollerDoor`, `kPipe`, `kStack`, `kFence`): ribbed metal, roller doors, pipe racks, red and white stacks, fences.

**Every model:**
- **Baked ambient occlusion:** walls darken toward the ground, and faces turned down are in shade. It is in the vertex colours, so it costs nothing while playing.
- **Small decorative palms** (scale under 0.6) use the light palm.
- **Zoomed out**, buildings cast no shadows: specks on screen, and a second drawing of the town.

**Measured** on the same dense province, high quality, triangles per frame averaged over 6 frames:

| zoom | triangles per frame |
|---|---|
| normal | ~0.95M |
| far | ~0.97M |

The baseline was 3.2M, and this test town is a worst case: it has 120 hotels and 120 malls.
