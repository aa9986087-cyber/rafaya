// One self-contained page (styles and code inline) for sharing a trial copy without a server.
// Each module goes in as a data: URL named in the import map; three.js comes from jsDelivr.
import { readFile, writeFile, mkdir } from "node:fs/promises";

const read = (f) => readFile(new URL("../" + f, import.meta.url), "utf8");
const html = await read("index.html");
const css = await read("css/style.css");
const icon = Buffer.from(await read("icon.svg")).toString("base64");
// the open assets (vendor/ASSETS-LICENSE.txt) go inline, so the page needs nothing but the CDN
const bin = (f) => readFile(new URL("../vendor/" + f, import.meta.url));
const assets = {
  "hdri/sky.exr": `data:application/octet-stream;base64,${(await bin("hdri/sky.exr")).toString("base64")}`,
  "tex/concrete-normal.webp": `data:image/webp;base64,${(await bin("tex/concrete-normal.webp")).toString("base64")}`,
  "tex/grain-normal.webp": `data:image/webp;base64,${(await bin("tex/grain-normal.webp")).toString("base64")}`,
  ...Object.fromEntries(await Promise.all(["rain", "thunder-near", "thunder-far", "thunder-far2"].map(async (n) => [`sound/${n}.mp3`, `data:audio/mpeg;base64,${(await bin(`sound/${n}.mp3`)).toString("base64")}`])))
};
// --preview: the TRIAL copy with a practice world of al-Jouf inside the page (js/preview.js), written to dist/rafaya-trial.html
const preview = process.argv.includes("--preview");
const mods = ["version", "data", "sim", "people", "building-surfaces", "world-lighting", "traffic-path", "world-weather", "models", "world3d", "icons", "warfx", "war", "rain-sound", "sound", "news", "advisor", "save-version", "whats-new", "ui-build", "ui-arrange", "ui-tools", "ui-news", "ui-online", "ui-account", "ui-war", "ui-warguide", "ui-zero", "ui-chat", "ui-region", "ui-whatsnew", "ui-people", "ui-settings", "ui-idle", "ui-warroom", ...(preview ? ["warserver", "preview-jouf", "preview"] : []), "main"];
// One module: drop the local imports and exports; three.js is imported once from jsDelivr.
const code = (await Promise.all(mods.map((m) => read(`js/${m}.js`))))
  .map((src) => src
    .replace(/^import (?![^;]*three\/addons)[^;]+;\s*$/gm, "") // three.js add-ons stay: the import map below sends them to the CDN
    .replace(/^export \{[^}]*\};?\s*$/gm, "")
    .replace(/^export (const|function|let|class|async function) /gm, "$1 "))
  .join("\n");
// Every module now shares one scope, so the same top-level name twice would break the page.
// (N, the map size, is declared once by sim.js; the other modules import it as MAP_SIZE as N.)
const names = new Map();
for (const m of mods) for (const [, n] of (await read(`js/${m}.js`)).matchAll(/^(?:export )?(?:const|let|function|class|async function) ([A-Za-z_$][\w$]*)/gm)) {
  if (names.has(n) && !(n === "N")) throw new Error(`"${n}" is declared in both ${names.get(n)} and ${m}`);
  names.set(n, m);
}
const bodyStart = html.indexOf(">", html.indexOf("<body")) + 1;
const body = html.slice(bodyStart, html.indexOf("</body>")).replace(/<script[^>]*><\/script>/, "");
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/)[0];
const page = `<meta charset="utf-8">
<title>${preview ? "تجربة الرافعية" : "الرافعية"}</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" href="data:image/svg+xml;base64,${icon}">
${fonts}
<script>document.documentElement.lang = "ar"; document.documentElement.dir = "rtl"; document.body && document.body.classList.add("at-menu");</script>
<style>${css}</style>
${body}
<script>document.body.classList.add("at-menu");</script>
<script>
  // If anything fails, say so on the loading screen instead of waiting forever.
  const fail = (m) => { const l = document.getElementById("loading"); if (l) l.querySelector("span").textContent = "صار خطأ: " + m; };
  addEventListener("error", (e) => fail(e.message || "تعذّر التحميل"));
  addEventListener("unhandledrejection", (e) => fail(String(e.reason)));
</script>
<script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js", "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/" } }</script>
<script>globalThis.RAFAYA_ASSETS = ${JSON.stringify(assets)};</script>
<script type="module">
import * as THREE from "three";
${code}
</script>
`;
await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
const out = preview ? "dist/rafaya-trial.html" : "dist/rafaya.html";
await writeFile(new URL("../" + out, import.meta.url), page);
console.log(out, Math.round(page.length / 1024), "KB");
