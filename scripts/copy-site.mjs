// Before each deploy (see wrangler.jsonc at the repository root): copy only the game's files into
// dist/site, which Cloudflare serves as the "rafaya" Worker. Nothing else of the repo is published.
// Maintenance mode: while a file named MAINTENANCE sits at the repository root, the site serves only
// the "under maintenance" page (players' saved towns live in their browsers and are not touched).
import { cp, rm, mkdir, access, readdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url), out = new URL("dist/site/", root);
const closed = await access(new URL("MAINTENANCE", root)).then(() => true, () => false);
// A fresh version stamp for this deploy (the Worker reads the same file: an older game on a phone must update).
// Only on Cloudflare's build (CF_PAGES / WORKERS_CI) or when asked, so local runs keep "dev".
let stamp;
if (process.env.WORKERS_CI || process.env.CI || process.env.STAMP_VERSION) {
  stamp = process.env.WORKERS_CI_COMMIT_SHA?.slice(0, 10) || new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  await writeFile(new URL("js/version.js", root), `// written by scripts/copy-site.mjs at deploy\nexport const VERSION = "${stamp}";\n`);
  console.log("version", stamp);
}
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
if (closed) {
  await cp(new URL("maintenance.html", root), new URL("index.html", out));
  await cp(new URL("icon.svg", root), new URL("icon.svg", out));
  console.log("MAINTENANCE: site copied as the maintenance page only");
} else {
  for (const item of ["index.html", "admin.html", "icon.svg", "icons", "manifest.webmanifest", "sw.js", "css", "js", "vendor"]) await cp(new URL(item, root), new URL(item, out), { recursive: true });
  if (stamp) {
    const tag = encodeURIComponent(stamp);
    const page = new URL("index.html", out);
    await writeFile(page, (await readFile(page, "utf8")).replace(/((?:css\/style\.css|js\/main\.js))(?:\?[^"]*)?(?=")/g, `$1?v=${tag}`));
    // Give the complete game module graph the same release key, including the shared entry points.
    for (const name of await readdir(new URL("js/", out))) {
      if (!name.endsWith(".js")) continue;
      const module = new URL(`js/${name}`, out);
      const source = await readFile(module, "utf8");
      await writeFile(module, source.replace(/(from "\.\/[\w-]+\.js)(?=")/g, `$1?v=${tag}`));
    }
  }
  console.log("site copied to dist/site");
}
