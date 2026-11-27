// the current world, frame by frame: the page's clock is ours, so every frame is smooth whatever the speed
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const [mode, outDir] = [process.argv[2] || 'test', process.argv[3] || __dirname + '/cine2/modern/'];
  fs.mkdirSync(outDir, { recursive: true });
  const page = __dirname + '/rafaya-trial.html';
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }); const V = '/home/user/rafaya/vendor/';
  await ctx.addInitScript(() => { try { localStorage.setItem('rafaya-quality', 'high'); } catch {} });
  await ctx.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', (route) => { const u = route.request().url(); const f = u.includes('/build/') ? V + 'three.module.min.js' : V + 'jsm/' + u.split('/examples/jsm/')[1]; route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }); });
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route('**/media/**', (r) => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + page); await p.waitForTimeout(4000);
  await p.evaluate(() => document.getElementById('mContinue').click());
  await p.waitForTimeout(16000);
  for (let k = 0; k < 10; k++) { await p.evaluate(() => { for (const id of ['ntOk', 'mnOk', 'sheetClose']) document.getElementById(id)?.click(); document.getElementById('zeroFull')?.remove(); document.querySelector('video')?.dispatchEvent(new Event('ended')); }); await p.waitForTimeout(700); }
  // take the loop over: the game's own animation frames stop, and each frame is drawn here with a fixed step
  await p.evaluate(() => { window.__raf = window.requestAnimationFrame; window.requestAnimationFrame = () => 0; });
  await p.waitForTimeout(500);
  await p.evaluate(() => { const st = document.createElement('style'); st.id = 'clean'; st.textContent = '.hud,.side,.dock,.goal,#pvScenarios,#zeroChip,#toasts,.toast,#event,#tip,.tip{visibility:hidden!important}'; document.head.append(st); });
  const dense = await p.evaluate(() => { const S = window.__S, N = Math.round(Math.sqrt(S.tiles.length)); let best = [0, 0, 0];
    const tall = (t) => t.b && !t.b.build && (t.b.id === 'skyline' || (t.b.id === 'house' && t.b.lvl >= 4) || ['mall', 'hospital', 'university', 'stadium', 'civic_tower'].includes(t.b.id));
    for (let y = 6; y < N - 6; y += 2) for (let x = 6; x < N - 6; x += 2) { let n = 0; for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) if (tall(S.tiles[(y + dy) * N + x + dx])) n++; if (n > best[2]) best = [x, y, n]; } return best; });
  await p.evaluate(([x, y]) => window.__world.focus(x, y), dense);
  const base = await p.evaluate(() => [window.__world.view.x, window.__world.view.z]);
  // a shot: frames at 30 a second, the camera moved by f(k) each frame; light = time of day
  const shot = async (name, n, light, f) => { fs.mkdirSync(outDir + name, { recursive: true });
    await p.evaluate((l) => { globalThis.RAFAYA_PREVIEW_LIGHT = () => l; window.__world.previewTod = l; }, light);
    for (let i = 0; i < n; i++) { const v = f(i / n); await p.evaluate(([v, b]) => { const w = window.__world; Object.assign(w.view, v, { x: b[0] + (v.dx || 0), z: b[1] + (v.dz || 0), yawTarget: v.yaw }); w.updateCamera(); }, [v, base]);
      await p.evaluate((l) => window.__world.frame(1 / 30, l), light); await p.screenshot({ path: `${outDir}${name}/f${String(i).padStart(4, '0')}.jpg`, quality: 90 }); }
    console.log('shot', name, 'done'); };
  const L = (a, b, k) => a + (b - a) * k;
  if (mode === 'more' || mode === 'rewind') {
    const scene2 = async (name, n, start) => { fs.mkdirSync(outDir + name, { recursive: true }); await p.evaluate(start + '; 0');
      for (let i = 0; i < n; i++) { const done = await p.evaluate(() => { window.__world.frame(1 / 30, 0.87); return window.__sceneDone; }); await p.screenshot({ path: `${outDir}${name}/f${String(i).padStart(4, '0')}.jpg`, quality: 90 }); if (done && i > 30) break; } console.log('scene', name, 'done'); };
    if (mode === 'more') await shot('m6', 140, 0.5, (k) => ({ zoom: L(0.55, 0.85, k), yaw: L(4.2, 4.9, k), pitch: L(0.62, 0.5, k) }));       // the city by day from above
    const base2 = await p.evaluate(() => { const S = window.__S, N = Math.round(Math.sqrt(S.tiles.length)); const i = S.tiles.findIndex((t) => t.b && t.b.id === 'dronebase' && !t.b.build); return i < 0 ? null : [i % N, Math.floor(i / N)]; });
    console.log('dronebase', base2);
    await p.evaluate(() => { globalThis.RAFAYA_PREVIEW_LIGHT = () => 0.8; window.__world.previewTod = 0.8; });
    if (base2 && mode === 'more') await scene2('m7', 200, `window.__sceneDone = false; window.__world.fx.playLaunch({ x: ${base2[0]}, y: ${base2[1]}, kind: "drone", wid: "drone2", n: 3, dir: { x: -1, z: 0.5 } }).then(() => { window.__sceneDone = true; })`);
    // the rewind: the sky turns backwards, day after day, and the town goes back into the sand, building by building
    fs.mkdirSync(outDir + 'm8', { recursive: true });
    await p.evaluate(([x, y]) => window.__world.focus(x, y), dense);
    await p.evaluate(() => { const S = window.__S; window.__gone = S.tiles.map((t, i) => (t.b ? i : -1)).filter((i) => i >= 0).sort(() => Math.random() - 0.5); });
    const n8 = 180;
    for (let i = 0; i < n8; i++) { const k = i / n8;
      await p.evaluate(([k, i, n8, b]) => { const w = window.__world, S = window.__S, tod = ((0.9 - Math.pow(k, 1.6) * 4) % 1 + 1) % 1;
        globalThis.RAFAYA_PREVIEW_LIGHT = () => tod; w.previewTod = tod;
        Object.assign(w.view, { zoom: 1.15 - k * 0.55, yaw: 0.9 + k * 0.9, yawTarget: 0.9 + k * 0.9, pitch: 0.36 + k * 0.2, x: b[0], z: b[1] }); w.updateCamera();
        const want = Math.floor(Math.min(1, Math.max(0, (k - 0.15) / 0.7)) * window.__gone.length);
        let changed = false; while ((window.__goneN || 0) < want) { const t = S.tiles[window.__gone[window.__goneN || 0]]; if (t) t.b = null; window.__goneN = (window.__goneN || 0) + 1; changed = true; }
        if (changed && i % 5 === 0) w.sync(S, { buildings: true });
        w.frame(1 / 30, tod); }, [k, i, n8, base]);
      await p.screenshot({ path: `${outDir}m8/f${String(i).padStart(4, '0')}.jpg`, quality: 90 }); }
    console.log('shot m8 done');
  }
  if (mode === 'test') { await shot('t', 3, 0.9, (k) => ({ zoom: 1.2 + k, yaw: 0.8 + k, pitch: 0.35 })); }
  else {
    if (mode !== 'war') await shot('m1', 150, 0.9, (k) => ({ zoom: L(0.7, 1.2, k), yaw: L(0.4, 1.3, k), pitch: L(0.5, 0.33, k) }));            // night: the lit city, closing in
    if (mode !== 'war') await shot('m2', 150, 0.88, (k) => ({ zoom: L(2.6, 2.0, k), yaw: L(1.9, 2.6, k), pitch: L(0.22, 0.3, k), dx: L(-1, 1, k) })); // between the towers
    // war: the game's own scenes, driven frame by frame: a missile launch, then a salvo falling with the air defence firing
    const scene = async (name, n, start) => { fs.mkdirSync(outDir + name, { recursive: true });
      await p.evaluate((l) => { globalThis.RAFAYA_PREVIEW_LIGHT = () => l; window.__world.previewTod = l; }, 0.87);
      await p.evaluate(start + '; 0'); // never wait on the scene itself: its frames are drawn below
      for (let i = 0; i < n; i++) { const done = await p.evaluate(() => { window.__world.frame(1 / 30, 0.87); return window.__sceneDone; }); if (i % 20 === 0) console.log(name, i); await p.screenshot({ path: `${outDir}${name}/f${String(i).padStart(4, '0')}.jpg`, quality: 90 }); if (done && i > 30) break; }
      console.log('scene', name, 'done'); };
    const find = (id) => p.evaluate((id) => { const S = window.__S, N = Math.round(Math.sqrt(S.tiles.length)); const i = S.tiles.findIndex((t) => t.b && t.b.id === id && !t.b.build); return i < 0 ? null : [i % N, Math.floor(i / N)]; }, id);
    const pad = await find('missilepad'), ad = await find('airdef'), target = dense;
    console.log('pad', pad, 'airdef', ad);
    if (pad) await scene('m4', 200, `window.__sceneDone = false; window.__world.fx.playLaunch({ x: ${pad[0]}, y: ${pad[1]}, kind: "missile", wid: "missile2", n: 2, dir: { x: 1, z: -0.4 } }).then(() => { window.__sceneDone = true; });`);
    await scene('m5', 260, `window.__sceneDone = false; window.__world.fx.playIncoming({ dir: { x: -1, z: 0.3 }, detected: true, banner() {}, airdefs: ${JSON.stringify(ad ? [{ x: ad[0], y: ad[1] }] : [])}, radars: [],
      strikes: [{ x: ${target[0]}, y: ${target[1]}, r: 1.6, area: [], onHit() {}, weapons: [{ w: "missile2", kind: "missile", tried: true, intercepted: false, dmg: 70 }, { w: "missile", kind: "missile", tried: true, intercepted: true, dmg: 0 }] },
                { x: ${target[0] + 3}, y: ${target[1] - 2}, r: 1.2, area: [], onHit() {}, weapons: [{ w: "drone2", kind: "drone", tried: true, intercepted: true, dmg: 0 }, { w: "missile", kind: "missile", tried: true, intercepted: false, dmg: 55 }] }] }).then(() => { window.__sceneDone = true; });`);
    await shot('m3', 120, 0.74, (k) => ({ zoom: L(1.4, 1.0, k), yaw: L(3.2, 3.9, k), pitch: L(0.3, 0.42, k) }));             // sunset over the skyline
  }
  console.log('errors', errs.slice(0, 3)); await b.close();
})();
