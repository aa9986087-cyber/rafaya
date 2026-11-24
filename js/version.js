// The game's version. "dev" here; every deploy writes a fresh stamp (scripts/copy-site.mjs) before the
// Worker is built, so the server and the files it serves always carry the same one. A game whose
// version differs from the server's must update (main.js, versionCheck).
export const VERSION = "dev";
