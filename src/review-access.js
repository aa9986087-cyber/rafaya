export const REVIEW_ROUTES = new Set(["stats", "reports", "chat", "feedback", "players", "namefix", "gifts", "statement"]);

export function reviewPayload(url, timestamp) {
  return new TextEncoder().encode(`rafaya-review-v1\nGET\n${url.origin}\n${url.pathname}${url.search}\n${timestamp}`);
}

const algorithm = { name: "ECDSA", namedCurve: "P-256" };
const bytes = value => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));

export async function verifyReview(request, publicKey, now) {
  const timestamp = request.headers.get("x-rafaya-review-time") || "";
  const proof = request.headers.get("x-rafaya-review-proof") || "";
  const url = new URL(request.url);
  if (!publicKey || url.protocol !== "https:" || !/^\d{13}$/.test(timestamp) || !/^[\w-]{86}$/.test(proof)) return false;
  if (Math.abs(now - Number(timestamp)) > 60_000) return false;
  try {
    const key = await crypto.subtle.importKey("spki", bytes(publicKey), algorithm, false, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, bytes(proof), reviewPayload(url, timestamp));
  } catch {
    return false;
  }
}
