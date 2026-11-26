// «🔍 بحث»: find anything in one's own town (a big town gets lost in), and fly to it.
// Like buildings come as one line («مساجد (٨)») that opens to each one with its district and state; the ones
// that need the mayor (damaged, standing idle, ready to upgrade) come first. After «روح له» a small bar under
// the top cards steps through the same kind one by one («◀ ٣ من ٨ ▶»). It only looks and moves the camera.
import { $, A, S, ar, closeSheet, inspect, sheet, sheetFor, visiting, world } from "./main.js";
import { toast } from "./ui-build.js";
import { B, CATS } from "./data.js";
import { districtName, districtOf, idleWhy, levelName, upgradable, upgradeBlocker } from "./sim.js";
import { sfx } from "./sound.js";

const FIND = { q: "", cat: "", flt: "", open: "", list: [], at: 0 };
const findN = () => Math.round(Math.sqrt(S.tiles.length));
/** Arabic the way people type it: no «ال», one alef, ه for ة, ي for ى, no marks. */
const findNorm = (t) => String(t || "").replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/(^|\s)ال/g, "$1").trim();

/** Every building of the town as a line to show: where, what, and what it needs. */
function findItems() {
  const n = findN(), out = [];
  S.tiles.forEach((t, i) => {
    const b = t.b;
    if (!b || !B[b.id] || b.id === "decopart" || B[b.id].cat === "road") return;
    const x = i % n, y = Math.floor(i / n), why = idleWhy(S, x, y);
    const hurt = (b.wd || 0) > 0 || (b.cond ?? 100) < 60 || b.ruin > 0;
    const up = !b.build && upgradable(b) && !upgradeBlocker(S, A, x, y);
    const tag = b.build > 0 ? ["build", "🏗️ تحت البناء"] : hurt ? ["hurt", b.wd > 0 ? `🔧 متضرر ${ar(Math.round(b.wd))}٪` : `🔧 حالته ${ar(Math.round(b.cond ?? 100))}٪`] : why ? ["idle", `⚠️ ${why.split(/[:(]/)[0].trim()}`] : up ? ["up", "⬆️ يقدر يتطور"] : ["ok", "✓ شغّال"];
    out.push({ i, x, y, id: b.id, cat: B[b.id].cat, name: levelName(b), kind: B[b.id].name, district: districtName(S, districtOf(i)), tag, hurt, idle: !!why && !b.build, up });
  });
  return out;
}
const findRank = (it) => (it.hurt ? 0 : it.idle ? 1 : it.up ? 2 : it.tag[0] === "build" ? 3 : 4);

export function findSheet() {
  if (visiting) { toast("البحث داخل مدينتك بس: ارجع لمدينتك", "bad"); return; }
  const all = findItems(), q = findNorm(FIND.q);
  let list = all.filter((it) => (!FIND.cat || it.cat === FIND.cat) && (!FIND.flt || (FIND.flt === "up" ? it.up : FIND.flt === "hurt" ? it.hurt : it.idle)));
  if (q) list = list.filter((it) => [it.name, it.kind, it.district, CATS.find((c) => c.id === it.cat)?.name].some((s) => findNorm(s).includes(q)));
  // one line per kind, the kinds that need the mayor first, then the biggest
  const groups = new Map();
  for (const it of list) (groups.get(it.id) || groups.set(it.id, []).get(it.id)).push(it);
  const rows = [...groups.values()].map((g) => g.sort((a, b) => findRank(a) - findRank(b) || a.name.localeCompare(b.name, "ar")))
    .sort((a, b) => findRank(a[0]) - findRank(b[0]) || b.length - a.length);
  const count = (k) => all.filter((it) => (k === "up" ? it.up : k === "hurt" ? it.hurt : it.idle)).length;
  const sum = (g) => { const lv = new Map(); g.forEach((it) => lv.set(it.name, (lv.get(it.name) || 0) + 1));
    const s = [...lv].map(([n, c]) => `${ar(c)} ${n}`), h = g.filter((it) => it.hurt).length, i = g.filter((it) => it.idle).length, u = g.filter((it) => it.up).length;
    return [...s.slice(0, 3), ...(s.length > 3 ? ["…"] : []), h ? `🔧 ${ar(h)} متضرر` : "", i ? `⚠️ ${ar(i)} واقف` : "", u ? `⬆️ ${ar(u)} يتطور` : ""].filter(Boolean).join(" · "); };
  const line = (it) => `<button type="button" class="fd-one ${it.tag[0]}" data-fdgo="${it.i}"><span><b>${it.name}</b><small>${it.district} · ${it.tag[1]}</small></span><i>📍 روح له</i></button>`;
  const body = rows.map((g) => g.length === 1 ? `<div class="fd-group single">${line(g[0])}</div>`
    : `<div class="fd-group ${FIND.open === g[0].id ? "open" : ""}"><button type="button" class="fd-head" data-fdopen="${g[0].id}"><span><b>${g[0].kind} (${ar(g.length)})</b><small>${sum(g)}</small></span><i>${FIND.open === g[0].id ? "▴" : "▾"}</i></button>
      ${FIND.open === g[0].id ? `<div class="fd-list">${g.map(line).join("")}</div>` : ""}</div>`).join("");
  const keep = $("findQ") && document.activeElement === $("findQ");
  sheet(`<h2>🔍 ابحث في مدينتك</h2>
    <input id="findQ" class="fd-q" type="search" placeholder="اكتب: مسجد، بئر، مستشفى، اسم حارة…" value="${FIND.q.replace(/"/g, "&quot;")}" autocomplete="off">
    <div class="fd-chips">${[["", "الكل"], ...CATS.filter((c) => c.id !== "road" && (c.id !== "mil" || S.world)).map((c) => [c.id, c.name])].map(([id, n]) => `<button type="button" class="${FIND.cat === id ? "on" : ""}" data-fdcat="${id}">${n}</button>`).join("")}</div>
    <div class="fd-chips flt">${[["up", "⬆️ يقدر يتطور"], ["hurt", "🔧 يحتاج تصليح"], ["idle", "⚠️ واقف"]].map(([k, n]) => `<button type="button" class="${FIND.flt === k ? "on" : ""}" data-fdflt="${k}">${n} (${ar(count(k))})</button>`).join("")}</div>
    <p class="hint">${ar(list.length)} مبنى${q || FIND.cat || FIND.flt ? "" : " بمدينتك"}</p>
    <div class="fd-body">${body || `<p class="hint">ما لقيت شي. جرّب كلمة ثانية.</p>`}</div>`, "find");
  FIND.groups = rows;
  const qi = $("findQ");
  if (keep) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
  qi.addEventListener("input", () => { FIND.q = qi.value; clearTimeout(FIND.t); FIND.t = setTimeout(findSheet, 180); });
  const q2 = (s) => $("sheetBody").querySelectorAll(s);
  q2("[data-fdcat]").forEach((b) => b.addEventListener("click", () => { sfx.tap(); FIND.cat = b.dataset.fdcat; findSheet(); }));
  q2("[data-fdflt]").forEach((b) => b.addEventListener("click", () => { sfx.tap(); FIND.flt = FIND.flt === b.dataset.fdflt ? "" : b.dataset.fdflt; findSheet(); }));
  q2("[data-fdopen]").forEach((b) => b.addEventListener("click", () => { sfx.tap(); FIND.open = FIND.open === b.dataset.fdopen ? "" : b.dataset.fdopen; findSheet(); }));
  q2("[data-fdgo]").forEach((b) => b.addEventListener("click", () => {
    sfx.tap();
    const i = Number(b.dataset.fdgo), g = rows.find((r) => r.some((it) => it.i === i)) || [];
    FIND.list = g.map((it) => it.i); FIND.at = Math.max(0, FIND.list.indexOf(i));
    findGo();
  }));
}

/** Fly to the building at FIND.at, open its card, and keep the bar to step through its kind. */
function findGo() {
  const i = FIND.list[FIND.at], n = findN();
  if (i == null) return;
  closeSheet();
  const x = i % n, y = Math.floor(i / n);
  world.focus(x, y);
  setTimeout(() => { inspect(x, y); findBarDraw(); }, 120);
}
function findBarDraw() {
  let el = $("findBar");
  if (FIND.list.length < 2) { el?.remove(); return; }
  if (!el) {
    el = document.createElement("div"); el.id = "findBar"; el.className = "find-bar";
    document.body.append(el);
    el.addEventListener("click", (e) => {
      const k = e.target.closest("[data-fb]")?.dataset.fb;
      if (!k) return;
      sfx.tap();
      if (k === "x") { el.remove(); return; }
      if (k === "list") { el.remove(); findSheet(); return; }
      FIND.at = (FIND.at + (k === "next" ? 1 : -1) + FIND.list.length) % FIND.list.length;
      findGo();
    });
  }
  const b = S.tiles[FIND.list[FIND.at]]?.b;
  el.innerHTML = `<button type="button" data-fb="prev" aria-label="اللي قبله">▶</button><button type="button" class="fb-mid" data-fb="list"><b>${b ? B[b.id].name : ""}</b><small>${ar(FIND.at + 1)} من ${ar(FIND.list.length)}</small></button><button type="button" data-fb="next" aria-label="اللي بعده">◀</button><button type="button" class="fb-x" data-fb="x" aria-label="سكّر">✕</button>`;
}
/** Leaving the town or opening something else: the bar goes. */
export function findBarClose() { $("findBar")?.remove(); }
export const findOpen = () => sheetFor === "find";
