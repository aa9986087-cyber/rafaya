// «الدخول بحساب قوقل»: checks a Google sign-in (an ID token from Google Identity Services) on the server.
// The token is a JWT signed by Google (RS256); its keys are Google's public ones, fetched and kept an hour.
// Only the account's own number (sub) is used, hashed before it is stored: no e-mail, no name.
export const GOOGLE_CLIENT_ID = "610657966885-d15nel049o5fltrq4ospoe4gfb50hf4e.apps.googleusercontent.com";
const CERTS = "https://www.googleapis.com/oauth2/v3/certs";
let keys = null, keysAt = 0;

const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const text = (s) => new TextDecoder().decode(b64url(s));

async function googleKeys(fetcher, now) {
  if (!keys || now - keysAt > 3600000) { const r = await fetcher(CERTS); keys = (await r.json()).keys || []; keysAt = now; }
  return keys;
}

/**
 * The Google account's number (sub) when the token is real, fresh and for this game; otherwise null.
 * fetcher and now are there for the tests.
 */
export async function googleSub(token, { fetcher = fetch, now = Date.now(), clientId = GOOGLE_CLIENT_ID } = {}) {
  try {
    const [h, p, sig] = String(token || "").split(".");
    if (!h || !p || !sig) return null;
    const head = JSON.parse(text(h)), claims = JSON.parse(text(p));
    if (head.alg !== "RS256") return null;
    if (claims.aud !== clientId) return null;
    if (claims.iss !== "accounts.google.com" && claims.iss !== "https://accounts.google.com") return null;
    if (!claims.exp || claims.exp * 1000 < now - 60000) return null;
    if (!claims.sub) return null;
    let jwk = (await googleKeys(fetcher, now)).find((k) => k.kid === head.kid);
    if (!jwk) { keys = null; jwk = (await googleKeys(fetcher, now)).find((k) => k.kid === head.kid); } // keys turned over
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
    return ok ? String(claims.sub) : null;
  } catch { return null; }
}
/** For the tests: forget the kept keys. */
export const forgetGoogleKeys = () => { keys = null; keysAt = 0; };
