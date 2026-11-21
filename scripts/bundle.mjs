// One self-contained page (styles and code inline) for sharing a trial copy without a server.
// Each module goes in as a data: URL named in the import map; three.js comes from jsDelivr.
import { readFile, writeFile, mkdir } from "node:fs/promises";

const read = (f) => readFile(new URL("../" + f, import.meta.url), "utf8");
const html = await read("index.html");
const css = await read("css/style.css");
const icon = Buffer.from(await read("icon.svg")).toString("base64");
const mods = ["data", "sim", "models", "world3d", "sound", "main"];
const imports = { three: "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js" };
for (const m of mods) {
  const src = (await read(`js/${m}.js`)).replace(/from "\.\/(\w+)\.js"/g, 'from "rafaya/$1"');
  imports[`rafaya/${m}`] = "data:text/javascript;base64," + Buffer.from(src).toString("base64");
}
const bodyStart = html.indexOf(">", html.indexOf("<body")) + 1;
const body = html.slice(bodyStart, html.indexOf("</body>")).replace(/<script[^>]*><\/script>/, "");
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/)[0];
const page = `<title>الرافعية</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" href="data:image/svg+xml;base64,${icon}">
${fonts}
<script>document.documentElement.lang = "ar"; document.documentElement.dir = "rtl"; document.body && document.body.classList.add("at-menu");</script>
<style>${css}</style>
<script type="importmap">${JSON.stringify({ imports })}</script>
${body}
<script>document.body.classList.add("at-menu");</script>
<script type="module">import "rafaya/main";</script>
`;
await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await writeFile(new URL("../dist/rafaya.html", import.meta.url), page);
console.log("dist/rafaya.html", Math.round(page.length / 1024), "KB");
