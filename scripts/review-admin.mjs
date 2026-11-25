import { readFile } from "node:fs/promises";
import { sign } from "node:crypto";
import { REVIEW_ROUTES, reviewPayload } from "../src/review-access.js";

const origin = "https://rafaya.vamosx.workers.dev";
const query = process.argv[2] || "stats";
const route = query.split("?")[0];
if (!REVIEW_ROUTES.has(route)) throw new Error("Choose a Rafaya administration list to review.");
const url = new URL(`/api/admin/${query}`, origin);
const keyPath = process.env.RAFAYA_REVIEW_KEY_PATH || "/workspace/.rafaya-review-identity/p256.pem";
const key = await readFile(keyPath);
const timestamp = String(Date.now());
const proof = sign("sha256", reviewPayload(url, timestamp), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
const response = await fetch(url, {
  headers: { "x-rafaya-review-time": timestamp, "x-rafaya-review-proof": proof },
  redirect: "error", signal: AbortSignal.timeout(15_000)
});
if (!response.ok) throw new Error(`Rafaya review request returned HTTP ${response.status}`);
process.stdout.write(await response.text());
