// The game's version. "dev" here; every deploy writes a fresh stamp (scripts/copy-site.mjs) before the
// Worker is built, so the server and the files it serves always carry the same one. A game whose
// version differs from the server's must update (main.js, versionCheck).
export const VERSION = "dev";
// The oldest release a copy may be and carry on (the same as VERSION unless UPDATE.json makes a release optional).
export const REQUIRED = "dev";
