// One self-contained page (styles and code inline) for sharing a trial copy without a server.
import { readFile, writeFile, mkdir } from "node:fs/promises";

const read = (f) => readFile(new URL("../" + f, import.meta.url), "utf8");
const html = await read("index.html");
const css = await read("css/style.css");
const icon = Buffer.from(await read("icon.svg")).toString("base64");
const code = (await Promise.all(["js/data.js", "js/sim.js", "js/render.js", "js/main.js"].map(read)))
  .map((src) => src.replace(/^import [^;]+;\s*$/gm, "").replace(/^export (const|function|let|class) /gm, "$1 "))
  .join("\n");
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>")).replace(/<script[^>]*><\/script>/, "");
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/)[0];
const page = `<title>الرافعية</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" href="data:image/svg+xml;base64,${icon}">
${fonts}
<script>document.documentElement.lang = "ar"; document.documentElement.dir = "rtl";</script>
<style>${css}</style>
${body}
<script type="module">
${code}
</script>
`;
await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await writeFile(new URL("../dist/rafaya.html", import.meta.url), page);
console.log("dist/rafaya.html", Math.round(page.length / 1024), "KB");
