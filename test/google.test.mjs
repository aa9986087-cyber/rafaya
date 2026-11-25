import { test } from "node:test";
import assert from "node:assert/strict";
import { googleSub, forgetGoogleKeys, GOOGLE_CLIENT_ID } from "../src/google.js";

const b64 = (buf) => Buffer.from(buf).toString("base64url");
async function signer() {
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const sign = async (claims, kid = "k1") => {
    const h = b64(JSON.stringify({ alg: "RS256", kid, typ: "JWT" })), p = b64(JSON.stringify(claims));
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${b64(sig)}`;
  };
  return { jwk, sign };
}

test("a Google sign-in is accepted only when it is real, fresh and for this game", async () => {
  const a = await signer(), b = await signer(), now = Date.now();
  const fetcher = async () => ({ json: async () => ({ keys: [a.jwk] }) });
  const good = { iss: "https://accounts.google.com", aud: GOOGLE_CLIENT_ID, sub: "1234567890", exp: Math.floor(now / 1000) + 3600 };
  forgetGoogleKeys();
  assert.equal(await googleSub(await a.sign(good), { fetcher, now }), "1234567890");
  assert.equal(await googleSub(await b.sign(good), { fetcher, now }), null, "signed by someone else");
  assert.equal(await googleSub(await a.sign({ ...good, aud: "other.apps.googleusercontent.com" }), { fetcher, now }), null, "for another app");
  assert.equal(await googleSub(await a.sign({ ...good, exp: Math.floor(now / 1000) - 3600 }), { fetcher, now }), null, "expired");
  assert.equal(await googleSub(await a.sign({ ...good, iss: "https://evil.example" }), { fetcher, now }), null, "not from Google");
  const t = await a.sign(good), [h, , s] = t.split(".");
  assert.equal(await googleSub(`${h}.${b64(JSON.stringify({ ...good, sub: "999" }))}.${s}`, { fetcher, now }), null, "changed after signing");
  assert.equal(await googleSub("nonsense", { fetcher, now }), null);
});
