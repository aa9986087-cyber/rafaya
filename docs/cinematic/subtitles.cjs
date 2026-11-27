const { chromium } = require('playwright'); const fs = require('fs');
const lines = JSON.parse(fs.readFileSync(__dirname + '/subs/lines.json', 'utf8'));
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 720, height: 240 } });
  const font = fs.readFileSync(__dirname + '/fonts/Amiri-Bold.ttf').toString('base64');
  for (const [k, text] of Object.entries(lines)) {
    await p.setContent(`<html><head><style>@font-face{font-family:A;src:url(data:font/ttf;base64,${font})} html,body{margin:0;background:transparent}
      div{width:720px;height:240px;display:grid;place-items:center;text-align:center;direction:rtl;font:700 44px/1.45 A;color:#f6ecd3;padding:0 40px;box-sizing:border-box;
      text-shadow:0 3px 18px rgba(0,0,0,.95),0 0 4px #000,0 0 30px rgba(0,0,0,.7)}</style></head><body><div>${text}</div></body></html>`);
    await p.evaluate(() => document.fonts.ready); await p.screenshot({ path: `${__dirname}/subs/${k}.png`, omitBackground: true }); }
  await b.close(); })();
