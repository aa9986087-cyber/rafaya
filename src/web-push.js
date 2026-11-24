const encoder = new TextEncoder();
const curve = { name: "ECDH", namedCurve: "P-256" };

function decodeKey(value, size) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value) || value.length !== Math.ceil(size * 4 / 3)) return null;
  const bytes = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  return bytes.length === size ? bytes : null;
}

export function pushKeys(keys) {
  const publicKey = decodeKey(keys?.p256dh, 65), auth = decodeKey(keys?.auth, 16);
  return publicKey?.[0] === 4 && auth ? { publicKey, auth } : null;
}

/** RFC 8291 Web Push with a single RFC 8188 aes128gcm record. */
export async function encryptPush(message, keys) {
  const pair = await crypto.subtle.generateKey(curve, true, ["deriveBits"]);
  const serverKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const clientKey = await crypto.subtle.importKey("raw", keys.publicKey, curve, false, []);
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: clientKey }, pair.privateKey, 256);

  const infoLabel = encoder.encode("WebPush: info\0");
  const info = new Uint8Array(infoLabel.length + keys.publicKey.length + serverKey.length);
  info.set(infoLabel);
  info.set(keys.publicKey, infoLabel.length);
  info.set(serverKey, infoLabel.length + keys.publicKey.length);
  const hkdf = (salt, info, length) => ({ name: "HKDF", hash: "SHA-256", salt, info, length });
  const secret = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  const input = await crypto.subtle.deriveBits(hkdf(keys.auth, info, 256), secret, 256);
  const material = await crypto.subtle.importKey("raw", input, "HKDF", false, ["deriveBits"]);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const [cek, nonce] = await Promise.all([
    crypto.subtle.deriveBits(hkdf(salt, encoder.encode("Content-Encoding: aes128gcm\0"), 128), material, 128),
    crypto.subtle.deriveBits(hkdf(salt, encoder.encode("Content-Encoding: nonce\0"), 96), material, 96),
  ]);

  const data = encoder.encode(JSON.stringify(message));
  const plaintext = new Uint8Array(data.length + 1);
  plaintext.set(data);
  plaintext[data.length] = 2; // final record delimiter
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext));
  const headerLength = 21 + serverKey.length;
  const payload = new Uint8Array(headerLength + ciphertext.length);
  payload.set(salt);
  new DataView(payload.buffer).setUint32(16, 4096);
  payload[20] = serverKey.length;
  payload.set(serverKey, 21);
  payload.set(ciphertext, headerLength);
  return payload;
}
