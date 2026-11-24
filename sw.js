// الرافعية: the service worker handles notifications. The inbox is for older, empty pushes.
self.addEventListener("install", (e) => e.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function inbox() {
  const sub = await self.registration.pushManager.getSubscription();
  if (!sub) return [];
  const k = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sub.endpoint)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const r = await fetch(`/api/world/push/inbox?k=${k}`, { cache: "no-store", signal: controller.signal });
    return r.ok ? (await r.json()).items || [] : [];
  } finally { clearTimeout(timer); }
}
self.addEventListener("push", (e) => e.waitUntil((async () => {
  let items = [];
  if (e.data) {
    try {
      const message = e.data.json();
      if (typeof message?.title === "string" && typeof message.body === "string") items = [message];
    } catch { /* show the general one */ }
  } else {
    try { items = await inbox(); } catch { /* show the general one */ }
  }
  if (!items.length) items = [{ title: "عالم الجوف", body: "فيه جديد بمدينتك، ادخل وشوف", tag: "jouf" }];
  for (const it of items.slice(-3)) {
    let shown = false;
    try {
      await self.registration.showNotification(it.title, { body: it.body, tag: it.tag || "jouf", renotify: !it.receipt, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", dir: "rtl", lang: "ar", data: { url: "/" } });
      shown = true;
    } finally {
      if (it.ack) { // the closed-game test: tell the server this phone got it, and whether it could show it
        try { await fetch("/api/world/push/ack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ receipt: it.ack, shown }) }); } catch { /* the game says "no report" */ }
      }
      if (it.receipt) {
        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const window of windows) window.postMessage({ type: "push-test", receipt: it.receipt, shown });
      }
    }
  }
})()));
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) if ("focus" in c) return c.focus();
    return self.clients.openWindow("/");
  })());
});
