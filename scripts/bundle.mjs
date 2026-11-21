// One self-contained page (styles and code inline) for sharing a trial copy without a server.
// Each module goes in as a data: URL named in the import map; three.js comes from jsDelivr.
import { readFile, writeFile, mkdir } from "node:fs/promises";

const read = (f) => readFile(new URL("../" + f, import.meta.url), "utf8");
const html = await read("index.html");
const css = await read("css/style.css");
const icon = Buffer.from(await read("icon.svg")).toString("base64");
const mods = ["data", "sim", "models", "world3d", "sound", "main"];
// One module: drop the local imports and exports; three.js is imported once from jsDelivr.
const code = (await Promise.all(mods.map((m) => read(`js/${m}.js`))))
  .map((src) => src
    .replace(/^import [^;]+;\s*$/gm, "")
    .replace(/^export \{[^}]*\};?\s*$/gm, "")
    .replace(/^export (const|function|let|class|async function) /gm, "$1 "))
  .join("\n");
const bodyStart = html.indexOf(">", html.indexOf("<body")) + 1;
const body = html.slice(bodyStart, html.indexOf("</body>")).replace(/<script[^>]*><\/script>/, "");
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/)[0];
const page = `<title>الرافعية</title>
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
<script type="module">
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js";
const N = 30;
${code.replace(/^const N = MAP_SIZE;$/m, "")}
</script>
`;
await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await writeFile(new URL("../dist/rafaya.html", import.meta.url), page);
console.log("dist/rafaya.html", Math.round(page.length / 1024), "KB");
