import assert from "node:assert/strict";
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { encryptPush, pushKeys } from "../src/web-push.js";

test("a Web Push recipient can decrypt the notification without calling the inbox", async () => {
  const receiver = createECDH("prime256v1");
  const publicKey = receiver.generateKeys();
  const auth = randomBytes(16);
  const keys = pushKeys({ p256dh: publicKey.toString("base64url"), auth: auth.toString("base64url") });
  assert.ok(keys);
  assert.equal(pushKeys({ p256dh: publicKey.toString("base64url"), auth: "invalid" }), null);

  const message = { title: "تجربة التنبيهات", body: "تنبيه من عالم الجوف.", tag: "test", receipt: "test-id" };
  const payload = Buffer.from(await encryptPush(message, keys));
  const salt = payload.subarray(0, 16);
  const keyLength = payload[20];
  assert.equal(payload.readUInt32BE(16), 4096);
  assert.equal(keyLength, 65);
  const sender = payload.subarray(21, 21 + keyLength);
  const encrypted = payload.subarray(21 + keyLength);
  const authInfo = Buffer.concat([Buffer.from("WebPush: info\0"), publicKey, sender]);
  const input = hkdfSync("sha256", receiver.computeSecret(sender), auth, authInfo, 32);
  const key = hkdfSync("sha256", input, salt, "Content-Encoding: aes128gcm\0", 16);
  const nonce = hkdfSync("sha256", input, salt, "Content-Encoding: nonce\0", 12);
  const cipher = createDecipheriv("aes-128-gcm", new Uint8Array(key), new Uint8Array(nonce));
  cipher.setAuthTag(encrypted.subarray(-16));
  const plaintext = Buffer.concat([cipher.update(encrypted.subarray(0, -16)), cipher.final()]);
  assert.equal(plaintext.at(-1), 2);
  assert.deepEqual(JSON.parse(plaintext.subarray(0, -1)), message);
});

test("the service worker reports the actual notification display result for a test", async () => {
  const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
  const handlers = new Map(), receipts = [];
  let fail = false;
  runInNewContext(source, {
    self: {
      addEventListener: (type, listener) => handlers.set(type, listener),
      registration: { showNotification: async (title, options) => {
        assert.equal(title, "تنبيه تجريبي");
        assert.equal(options.body, "النص");
        if (fail) throw new Error("display blocked");
      } },
      clients: { matchAll: async () => [{ postMessage: (message) => receipts.push(message) }] },
    },
  });
  const runPush = () => {
    let lifetime;
    handlers.get("push")({
      data: { json: () => ({ title: "تنبيه تجريبي", body: "النص", receipt: "test-id" }) },
      waitUntil: (work) => { lifetime = work; },
    });
    return lifetime;
  };
  await runPush();
  fail = true;
  await assert.rejects(runPush, /display blocked/);
  assert.deepEqual(receipts.map(({ type, receipt, shown }) => [type, receipt, shown]), [
    ["push-test", "test-id", true],
    ["push-test", "test-id", false],
  ]);
});
