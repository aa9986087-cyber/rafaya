// Before each deploy (see wrangler.jsonc at the repository root): copy only the game's files into
// dist/site, which Cloudflare serves as the "rafaya" Worker. Nothing else of the repo is published.
import { cp, rm, mkdir } from "node:fs/promises";

const root = new URL("../", import.meta.url), out = new URL("dist/site/", root);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const item of ["index.html", "icon.svg", "css", "js", "vendor"]) await cp(new URL(item, root), new URL(item, out), { recursive: true });
console.log("site copied to dist/site");
