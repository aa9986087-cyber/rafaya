// Before each deploy (see wrangler.jsonc at the repository root): copy only the game's files into
// dist/site, which Cloudflare serves as the "rafaya" Worker. Nothing else of the repo is published.
// Maintenance mode: while a file named MAINTENANCE sits at the repository root, the site serves only
// the "under maintenance" page (players' saved towns live in their browsers and are not touched).
import { cp, rm, mkdir, access } from "node:fs/promises";

const root = new URL("../", import.meta.url), out = new URL("dist/site/", root);
const closed = await access(new URL("MAINTENANCE", root)).then(() => true, () => false);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
if (closed) {
  await cp(new URL("maintenance.html", root), new URL("index.html", out));
  await cp(new URL("icon.svg", root), new URL("icon.svg", out));
  console.log("MAINTENANCE: site copied as the maintenance page only");
} else {
  for (const item of ["index.html", "icon.svg", "css", "js", "vendor"]) await cp(new URL(item, root), new URL(item, out), { recursive: true });
  console.log("site copied to dist/site");
}
