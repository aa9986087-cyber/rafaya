const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = __dirname; const types = { '.html': 'text/html', '.js': 'text/javascript', '.ttf': 'font/ttf', '.webp': 'image/webp' };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); }); });
srv.listen(8765, async () => {
  const [mode, a, b, out] = process.argv.slice(2);
  const br = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await br.newPage({ viewport: { width: 1280, height: 720 } }); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://127.0.0.1:8765/index.html'); await p.waitForFunction(() => window.ready, null, { timeout: 60000 });
  const el = await p.$('#stage');
  if (mode === 'keys') { for (const t of a.split(',').map(Number)) { await p.evaluate((t) => render(t), t); await el.screenshot({ path: `${out}-${t}.jpg`, quality: 85 }); } }
  else { const fps = Number(b) || 24; fs.mkdirSync(out, { recursive: true }); const n = Math.round(Number(a) * fps); const t0 = Date.now();
    for (let i = 0; i < n; i++) { await p.evaluate((t) => render(t), i / fps); await el.screenshot({ path: `${out}/f${String(i).padStart(5, '0')}.jpg`, quality: 92 }); if (i % 100 === 0) console.log('frame', i, '/', n, ((Date.now() - t0) / 1000).toFixed(0) + 's'); } }
  console.log('errors', errs.slice(0, 5)); await br.close(); srv.close();
});
