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
