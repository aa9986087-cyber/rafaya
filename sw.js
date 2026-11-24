// الرافعية: the service worker. It only does notifications (no caching: the game always loads fresh,
// and updates are checked by the game itself). A push carries no data: the worker asks the server what
// it was about (/api/world/push/inbox) and shows it.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function inbox() {
  const sub = await self.registration.pushManager.getSubscription();
  if (!sub) return [];
  const k = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sub.endpoint)));
  const r = await fetch(`/api/world/push/inbox?k=${k}`, { cache: "no-store" });
  return r.ok ? (await r.json()).items || [] : [];
}
self.addEventListener("push", (e) => e.waitUntil((async () => {
  let items = [];
  try { items = await inbox(); } catch { /* show the general one */ }
  if (!items.length) items = [{ title: "عالم الجوف", body: "فيه جديد بمدينتك، ادخل وشوف", tag: "jouf" }];
  for (const it of items.slice(-3)) {
    await self.registration.showNotification(it.title, { body: it.body, tag: it.tag || "jouf", renotify: true, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", dir: "rtl", lang: "ar", data: { url: "/" } });
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
