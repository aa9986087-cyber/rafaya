// نشرة الرافعية (solo) and نشرة الجوف (the world bulletin).
// Moved out of js/main.js as it was (nothing changed in it); main.js and the modules import each other's names.
import { $, A, HOUR_MS, S, ar, arrange, closeSheet, inspect, money, quartersSheet, refresh, save, sheet, sheetFor, store, tool, visitTown, world, worldMapSheet, worldMode } from "./main.js";
import { showWhatsNewDot, wnMarkAll, wnUnseen } from "./ui-whatsnew.js";
import { buyPlot, dayOf, decide, districtName, districtOf, hourOf, hoursToElection, optionCost, owns, plotAt, plotPrice, seasonOf, startResearch, voteShare, worldEventsAt } from "./sim.js";
import { FIX_HINT, answerPost, decisionReaction, followUps, moodOf, replyOptions, topicName, writePosts } from "./news.js";
import { B, DECISIONS, ELECTION_GRANT, ERAS, HOURS, MAP_SIZE as N, PLOTS, PRAYERS, SEASONS, SEASON_DAYS, TECH } from "./data.js";
import { floatAt, row, toast } from "./ui-build.js";
import { LIVE, api } from "./ui-online.js";
import { WHATS_NEW } from "./whats-new.js";
import { sfx } from "./sound.js";
import { regionSheet } from "./ui-region.js";

export function addPosts(posts) {
  if (!posts.length) return;
  S.news = [...posts, ...(S.news || [])].slice(0, 50);
  S.newsUnread = (S.newsUnread || 0) + posts.length;
  showNewsCount();
  if (sheetFor === "news") newsSheet();
}
export function showNewsCount() {
  const n = (S.newsUnread || 0) + (worldMode ? wnewsUnread() : 0) + (() => { try { return wnUnseen(worldMode ? "world" : "solo").length; } catch { return 0; } })(); // (before the updates list is set up: none)
  $("newsCount").hidden = !n;
  $("newsCount").textContent = ar(Math.min(n, 9)) + (n > 9 ? "+" : "");
}
export function hourNews(msgs) {
  const season = seasonOf(S.day);
  const big = msgs.some((m) => ["event", "season"].includes(m.kind));
  const posts = followUps(S, A, season);
  // People speak up twice a day (morning and evening), a little more in a big city; big news brings one more.
  const hour = hourOf(S.day);
  if (hour === 9 || hour === 19) posts.push(...writePosts(S, A, season, Math.min(2, 1 + Math.floor(S.pop / 1500))));
  else if (big) posts.push(...writePosts(S, A, season, 1));
  addPosts(posts);
}
export const moodTag = (m) => (m < 0 ? `<i class="mood bad">زعلان</i>` : m > 0 ? `<i class="mood good">مبسوط</i>` : `<i class="mood ask">يطالب</i>`);
/** Who wrote a post (old saves only have the kind of person). */
export const personOf = (p) => p.person || { name: "واحد من الأهالي", role: "", area: "" };
/**
 * «📍 وين؟» buttons for the quarters a text names (the longest names first, so «الحارة الشمالية
 * الغربية» is not also read as «الحارة الشمالية»).
 */
export function districtLinks(...texts) {
  let text = texts.filter(Boolean).join(" ");
  const names = Array.from({ length: 9 }, (_, d) => ({ d, name: districtName(S, d) })).sort((p, q) => q.name.length - p.name.length);
  const found = [];
  for (const { d, name } of names) if (text.includes(name)) { found.push({ d, name }); text = text.split(name).join(" "); }
  return found.map(({ d, name }) => `<button class="home-btn" type="button" data-district="${d}">📍 وين ${name}؟</button>`).join("");
}
/** Show a quarter on the map: the camera goes there and its land lights up for a few seconds. */
export function showDistrict(d) {
  closeSheet();
  const values = new Float32Array(N * N);
  let sx = 0, sy = 0, n = 0, hx = 0, hy = 0, homes = 0;
  for (let i = 0; i < N * N; i++) {
    if (districtOf(i) !== d || !owns(S, i % N, Math.floor(i / N))) continue;
    values[i] = 1; sx += i % N; sy += Math.floor(i / N); n++;
    if (S.tiles[i].b?.id === "house") { hx += i % N; hy += Math.floor(i / N); homes++; }
  }
  if (!n) return;
  const cx = Math.round(homes ? hx / homes : sx / n), cy = Math.round(homes ? hy / homes : sy / n);
  world.setOverlay(values, "#ff8a00", 0.55);
  world.focus(cx, cy); world.view.zoom = Math.min(world.view.zoom, 0.8); world.updateCamera();
  setTimeout(() => floatAt(cx, cy, `📍 ${districtName(S, d)}`, "up"), 300);
  toast(`📍 هذي ${districtName(S, d)}: المربعات المضيئة`, "");
  clearTimeout(showDistrict.t);
  showDistrict.t = setTimeout(() => { if (!tool && !arrange) world.setOverlay(null); }, 8000);
}
export function postHtml(p) {
  const r = personOf(p);
  const when = `اليوم ${ar(dayOf(p.day))} · ${ar(hourOf(p.day))}:٠٠`;
  return `<article class="post" data-post="${p.id}">
    <div class="post-head"><div><b>${r.name}</b><small>${[r.role, r.area, when].filter(Boolean).join(" · ")}</small></div>${moodTag(p.mood)}</div>
    <p>${p.text}</p>
    ${p.ref ? refHtml(p) : p.mood < 0 && FIX_HINT[p.topic] && !p.answered ? `<div class="pfix">💡 وش يبي: ${FIX_HINT[p.topic]}</div>` : ""}
    ${(p.replies || []).map((m) => `<div class="reply ${m.from}"><b>${m.from === "mayor" ? "العمدة" : m.person ? m.person.name : r.name}</b>${m.person?.role ? `<small> (${m.person.role})</small>` : ""} ${m.text}</div>`).join("")}
    ${p.person?.home != null && S.tiles[p.person.home]?.b?.id === "house" ? `<button class="home-btn" type="button" data-home="${p.person.home}">📍 بيته</button>` : ""}${districtLinks(p.text, p.ref?.asked)}
    <div class="post-foot"><span>👥 ${ar(p.likes || 1)} ${(p.likes || 1) > 10 ? "من الأهالي" : ""} يوافقونه</span>${p.answered ? `<span class="answered ${p.change > 0 ? "up" : p.change < 0 ? "down" : ""}">${p.change > 0 ? "الناس ارتاحوا" : p.change < 0 ? "الناس زعلوا" : "بيرجع لك بكرة"}</span>` : ""}</div>
    ${p.answered || p.id.startsWith("d-") ? "" : `<div class="answers">${replyOptions(p).map((o) => `<button type="button" class="ans ${o.tone || o.kind}" data-post="${p.id}" data-kind="${o.kind}">${o.label}</button>`).join("")}</div>`}
  </article>`;
}
/** The promise (or the "we'll see") a follow-up post is about: what they asked, what the mayor said, and when. */
export function refHtml(p) {
  const r = p.ref, when = r.day != null ? `اليوم ${ar(dayOf(r.day))} · ${ar(hourOf(r.day))}:٠٠` : "";
  return `<div class="pref">
    ${r.asked ? `<div><small>طلبهم ${when ? `(${when})` : ""}</small><q>${r.asked}</q></div>` : ""}
    <div><small>${r.calm ? "رديت عليهم" : "وعدك لهم"}</small><b>«${r.said}»</b></div>
    ${p.mood < 0 && FIX_HINT[p.topic] ? `<div class="pfix">🛠️ عشان توفي: ${FIX_HINT[p.topic]}</div>` : ""}
  </div>`;
}
/** Promises the mayor has made that are still open, and people waiting for a real answer. */
export function promisesHtml() {
  const open = (S.promises || []).map((p) => {
    const left = 48 - (S.day - p.day), name = p.person?.name || "واحد من الأهالي";
    return `<div class="prom ${left <= 0 ? "late" : ""}"><div class="prom-top"><b>${topicName(p.topic)}</b><small>${left > 0 ? `باقي ${ar(left)} ساعة قبل لا يذكّرونك` : "تأخرت عليهم!"}</small></div>
      <small>وعدت ${name}${p.person?.area ? ` ${p.person.area}` : ""}: «${p.said}»</small>
      ${FIX_HINT[p.topic] ? `<div class="pfix">🛠️ ${FIX_HINT[p.topic]}</div>` : ""}${districtLinks(p.asked, p.text, p.person?.area)}</div>`;
  });
  const waiting = (S.comebacks || []).map((c) => `<div class="prom calm"><div class="prom-top"><b>${topicName(c.topic)}</b><small>بيرجعون لك بعد ${ar(Math.max(1, c.at - S.day))} ساعة</small></div><small>قلت لـ${c.person?.name || "واحد من الأهالي"}: «إن شاء الله، نشوف»</small></div>`);
  if (!open.length && !waiting.length) return "";
  return `<details class="proms" open><summary>🤝 وعودك (${ar(open.length)})${waiting.length ? ` · ينتظرون جواب (${ar(waiting.length)})` : ""}</summary>${open.join("")}${waiting.join("")}</details>`;
}
export function newsSheet() {
  if (WNEWS.tab === "updates") { updatesNewsSheet(); return; }
  if (worldMode && WNEWS.tab === "world") { worldNewsSheet(); return; }
  S.newsUnread = 0; showNewsCount();
  const posts = S.news || [];
  const trust = Math.round(moodOf(S, null));
  sheet(`${newsTabs("town")}<div class="news-head"><h2>نشرة الرافعية</h2><p>وش يقولون أهل الرافعية عن بلدهم. اختار ردك: الوعد يريّحهم بس لازم توفي، و«نشوف» يرجعون لك بعدها، والرفض يزعّلهم.</p>
    <div class="trust"><span>ثقة الأهالي بالعمدة</span><i class="bar"><i style="width:${trust}%" class="${trust < 45 ? "low" : ""}"></i></i><b>${ar(trust)}٪</b></div></div>
    ${promisesHtml()}
    <div class="feed">${posts.length ? posts.map(postHtml).join("") : `<p class="empty">للحين ما أحد كتب شي. الناس يتكلمون كل كم ساعة.</p>`}</div>`, "news");
  bindNewsTabs();
  $("sheetBody").querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => answer(b.dataset.post, b.dataset.kind)));
  $("sheetBody").querySelectorAll("[data-home]").forEach((b) => b.addEventListener("click", () => {
    const i = Number(b.dataset.home);
    closeSheet(); world.focus(i % N, Math.floor(i / N)); world.view.zoom = Math.max(world.view.zoom, 1.4); world.updateCamera();
    setTimeout(() => { inspect(i % N, Math.floor(i / N)); }, 350);
  }));
}
export const WNEWS = { items: [], polled: 0, busy: false, tab: "town", map: null };
export const wnewsSeen = () => Number(store.get("rafaya-wnews-seen") || 0);
export const wnewsUnread = () => WNEWS.items.filter((x) => x.id > wnewsSeen() && x.plot !== S.world?.plot).length;
export async function wnewsPoll(force) {
  if (!worldMode || WNEWS.busy || (!force && Date.now() - WNEWS.polled < (LIVE.ok ? 600000 : 60000))) return; // live: the server tells us
  WNEWS.busy = true; WNEWS.polled = Date.now();
  try { const r = await api("/world/news"); WNEWS.items = r.items || []; } catch { /* the next time */ }
  WNEWS.busy = false;
  showNewsCount();
}
/** The news sheet's tabs: the town's news, al-Jouf's (world only) and the game's updates. */
export function newsTabs(on) {
  const mode = worldMode ? "world" : "solo", n = worldMode ? wnewsUnread() : 0, up = wnUnseen(mode).length;
  const tabs = [
    ["town", "📰", worldMode ? "مدينتي" : "القرية", S.newsUnread],
    ...(worldMode ? [["world", "🌍", "الجوف", n]] : []),
    ["updates", "✨", "التحديثات", up],
  ];
  return `<div class="wn-tabs" style="--news-tabs:${tabs.length}">${tabs.map(([key, icon, name, unread]) =>
    `<button type="button" class="btn${on === key ? " go" : ""}" data-ntab="${key}"><span aria-hidden="true">${icon}</span><span class="wn-tab-label">${name}</span>${unread && on !== key ? '<i class="dot"></i>' : ""}</button>`
  ).join("")}</div>`;
}
/** The updates tab: what changed in the game for this mode, newest first (the new ones marked). */
export function updatesNewsSheet() {
  const mode = worldMode ? "world" : "solo", fresh = new Set(wnUnseen(mode).map(([, , t]) => t));
  const list = WHATS_NEW.items.filter(([m]) => m === mode || m === "both");
  wnMarkAll(mode); showWhatsNewDot(); showNewsCount();
  sheet(`${newsTabs("updates")}<div class="news-head"><h2>✨ التحديثات</h2><p>وش تغيّر ${mode === "world" ? "بعالم الجوف" : "باللعب الفردي"}، الأحدث فوق.</p></div>
    <div class="rows">${list.map(([, icon, title, text]) => `<div class="row wn"><b class="wn-i">${icon}</b><span><b>${title}${fresh.has(title) ? ' <small class="new-tag">جديد</small>' : ""}</b><small>${text}</small></span></div>`).join("")}</div>`, "news-up");
  bindNewsTabs();
}
export function bindNewsTabs() {
  $("sheetBody").querySelectorAll("[data-ntab]").forEach((b) => b.addEventListener("click", () => { sfx.tap(); WNEWS.tab = b.dataset.ntab; newsSheet(); }));
}
/** The weather and the calendar are the same for every town in al-Jouf: what is on now and what comes in the next two days. */
export function worldForecast() {
  const h = S.day, now = worldEventsAt(h), seen = new Set(now.map((e) => `${e.id}:${e.start}`)), soon = [];
  for (let k = 1; k <= 48; k++) for (const e of worldEventsAt(h + k)) {
    const key = `${e.id}:${e.start}`;
    if (!seen.has(key)) { seen.add(key); soon.push({ ...e, in: k }); }
  }
  const icon = (id) => ({ rain: "🌧️", dust: "🌪️", heat: "🔥", cold: "❄️", locust: "🦗", drought: "🏜️", dates: "🌴", ramadan: "🌙", eid: "🎉", adha: "🐑" })[id] || "📅";
  const left = (e) => e.end - h;
  return `${now.length ? now.map((e) => row(`${icon(e.id)} ${e.name} (الحين)`, `باقي ${ar(left(e))} ساعة`)).join("") : row("☀️ الجو", "هادي ما فيه شي")}
    ${soon.length ? soon.map((e) => row(`${icon(e.id)} ${e.name}`, `بعد ${ar(e.in)} ساعة`)).join("") : `<p class="hint">ما فيه شي متوقع بالـ٤٨ ساعة الجاية.</p>`}`;
}
export function agoText(at) {
  const m = Math.max(0, Math.round((Date.now() - at) / 60000));
  return m < 1 ? "الحين" : m < 60 ? `قبل ${ar(m)} دقيقة` : m < 1440 ? `قبل ${ar(Math.round(m / 60))} ساعة` : `قبل ${ar(Math.round(m / 1440))} يوم`;
}
// ---------- the strikes of one war in one card (the owner, 28 Nov 2026): no line lost, the list kept short ----------

const DIG = (t) => String(t).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
/** A strike line of the bulletin: { a (attacker), b (hit), hit, dead, hurt } or null for any other news. */
function strikeOf(x) {
  const t = DIG(x.text);
  if (x.kind === "intercept") { const m = t.match(/دفاع «(.+?)» صدّ هجوم «(.+?)»/); return m ? { a: m[2], b: m[1], hit: 0 } : null; }
  if (x.kind !== "hit") return null;
  const m = t.match(/«(.+?)» (?:ضربت .+? في|سوّت .+? بالأرض في) «(.+?)»/); if (!m) return null;
  const n = t.match(/(\d+) وفاة و(\d+) إصابة/);
  return { a: m[1], b: m[2], hit: 1, dead: n ? Number(n[1]) : 0, hurt: n ? Number(n[2]) : 0 };
}
const newsRow = (x) => `<div class="row wnews ${x.id > wnewsSeen() ? "new" : ""}"><span>${ar(x.text)}</span><small>${agoText(x.at)}</small></div>`;
/** The bulletin's lines, newest first: every war's strikes gathered in one card where its newest strike stands. */
export function newsRows(items) {
  const pairs = new Map();
  for (const x of items) { const st = strikeOf(x); if (!st) continue; const k = [st.a, st.b].sort().join("|"); if (!pairs.has(k)) pairs.set(k, []); pairs.get(k).push({ x, st }); }
  const done = new Set();
  return items.map((x) => {
    const st = strikeOf(x);
    if (!st) return newsRow(x);
    const k = [st.a, st.b].sort().join("|");
    if (done.has(k)) return "";
    done.add(k);
    const list = pairs.get(k), fresh = list.some((e) => e.x.id > wnewsSeen());
    // who struck whom: one line for each side that fired (the attacker first, then what came of it)
    const side = (from) => {
      const mine = list.filter((e) => e.st.a === from); if (!mine.length) return "";
      const hits = mine.filter((e) => e.st.hit).length, stopped = mine.length - hits, dead = mine.reduce((n, e) => n + (e.st.dead || 0), 0), hurt = mine.reduce((n, e) => n + (e.st.hurt || 0), 0);
      const to = mine[0].st.b;
      return `<small class="wn-side"><b>🚀 «${from}» ← «${to}»</b> ${ar(mine.length)} ${mine.length === 1 ? "ضربة" : "ضربات"}: ${[hits ? `💥 ${ar(hits)} أصابت` : "", stopped ? `🛡️ ${ar(stopped)} انصدّت` : "", dead ? `⚰️ ${ar(dead)} وفاة` : "", hurt ? `🤕 ${ar(hurt)} إصابة` : ""].filter(Boolean).join(" · ")}</small>`;
    };
    const first = list[list.length - 1].st.a, other = first === list[list.length - 1].st.a ? list[list.length - 1].st.b : first;
    return `<details class="row wnews wn-war ${fresh ? "new" : ""}"><summary><span><b>🔥 حرب «${first}» على «${other}»</b>${side(first)}${side(other)}</span>
        <small>آخر ضربة ${agoText(list[0].x.at)}<br><em>▾ ${ar(list.length)} ${list.length === 1 ? "خبر" : "أخبار"}</em></small></summary>
      <div class="wn-list">${list.map((e) => newsRow(e.x)).join("")}</div></details>`;
  }).join("");
}
export async function worldNewsSheet(refreshed) {
  const top = (WNEWS.map || []).slice();
  const big = top.sort((p, q) => q.pop - p.pop).slice(0, 5), happy = (WNEWS.map || []).filter((t) => t.pop >= 30).sort((p, q) => q.happy - p.happy).slice(0, 3);
  const mine = S.world?.plot;
  const town = (t) => `<button type="button" class="linkish" data-goplot="${t.plot}">«${t.town}»${t.plot === mine ? " (مدينتك)" : ""}</button>`;
  sheet(`${newsTabs("world")}<div class="news-head"><h2>🌍 نشرة الجوف</h2><p>اللي يصير بأرض الجوف كلها: الأجواء، والمدن الجديدة، واللي كبرت، والحروب والصلح.</p></div>
    <h3>🌦️ أجواء الجوف (واحدة للكل)</h3><div class="rows">${worldForecast()}</div>
    ${big.length ? `<h3>🏆 أكبر المدن</h3><div class="rows">${big.map((t, i) => row(`${ar(i + 1)}. ${town(t)}`, `${money(t.pop)} ساكن · ${ERAS[t.era]?.name || ""}`)).join("")}</div>` : ""}
    ${happy.length ? `<h3>😊 أسعد المدن</h3><div class="rows">${happy.map((t) => row(town(t), `${ar(t.happy)}٪`, "plus")).join("")}</div>` : ""}
    <h3>📰 الأخبار</h3>
    <div class="rows">${WNEWS.items.length ? newsRows(WNEWS.items) : `<p class="hint">${refreshed ? "للحين ما صار شي بالجوف." : "نحمّل…"}</p>`}</div>`, "wnews");
  bindNewsTabs();
  $("sheetBody").querySelectorAll("[data-goplot]").forEach((b) => b.addEventListener("click", () => { sfx.tap(); const p = Number(b.dataset.goplot); if (p === mine) closeSheet(); else visitTown(p); }));
  if (WNEWS.items.length) store.set("rafaya-wnews-seen", String(WNEWS.items[0].id));
  showNewsCount();
  if (!refreshed) {
    await Promise.all([wnewsPoll(true), api("/world/map").then((r) => { WNEWS.map = r.plots || []; }).catch(() => {})]);
    if (sheetFor === "wnews") worldNewsSheet(true);
  }
}
/** The mayor answers a post with one of the offered replies. */
export function answer(id, kind) {
  const post = (S.news || []).find((p) => p.id === id);
  if (!post || post.answered) return;
  const label = replyOptions(post).find((o) => o.kind === kind)?.label;
  const r = answerPost(S, A, seasonOf(S.day), post, kind);
  post.replies = [...(post.replies || []), { from: "mayor", text: label }, { from: "res", who: post.who, text: r.text }];
  post.answered = kind; post.change = r.change;
  (r.change > 0 ? sfx.coin : r.change < 0 ? sfx.deny : sfx.tap)();
  refresh(); save();
  newsSheet();
}
/** A choice for the mayor: the story, and a button per option with what it costs and does. */
export function decisionSheet() {
  const d = DECISIONS.find((x) => x.id === S.decision?.id);
  if (!d) return;
  sfx.event();
  sheet(`<div class="decision"><span class="badge">قرار</span><h2>${d.title}</h2><p>${typeof d.text === "function" ? d.text(S, seasonOf(S.day)) : d.text}</p>
    <div class="choices">${d.options.map((o, i) => { const c = optionCost(S, A, o), poor = c > 0 && S.money < c; return `<button type="button" class="choice ${i === 0 ? "first" : ""}" data-choice="${i}" ${poor ? "disabled" : ""}>
      <b>${o.label}</b><small>${o.note}${o.costPer ? ` (${money(c)} ريال)` : ""}${poor ? " · ما يكفي المال" : ""}</small></button>`; }).join("")}</div></div>`, "decision");
  $("sheetClose").hidden = true;
  $("sheetBody").querySelectorAll("[data-choice]").forEach((b) => b.addEventListener("click", () => {
    const choice = Number(b.dataset.choice), decided = S.decision?.id;
    const r = decide(S, choice);
    if (r.error) { toast(r.error, "bad"); sfx.deny(); return; }
    sfx.coin();
    $("sheetClose").hidden = false;
    closeSheet();
    if (r.built) { world.sync(S); toast(`انحفر ${B[r.built].name} جديد قرب البلد`, "goal"); }
    if (r.lost) { world.sync(S); toast(`احترق ${r.lost} 🔥`, "bad"); }
    if (r.ok) { const re = decisionReaction(S, A, decided, choice); if (re) addPosts([re]); }
    refresh(); save();
  }));
}
/** Land outside the town: what it is, what it costs, and a button to buy it. */
export function plotSheet(id) {
  const plot = PLOTS.find((p) => p.id === id), price = plotPrice(S);
  let wadi = 0, fayda = 0, rocks = 0, size = 0;
  S.tiles.forEach((t, i) => { if (plotAt(i % N, Math.floor(i / N)) !== id) return; size++; if (t.t === "wadi") wadi++; else if (t.t === "fayda") fayda++; else if (t.t === "rock") rocks++; });
  const bought = PLOTS.filter((p) => S.owned[p.id]).length;
  sheet(`<h2>${plot.name} للبيع</h2><p>أرض جديدة تكبر فيها الرافعية. كل ما اشتريت أرض، اللي بعدها تصير أغلى.</p>
    <div class="rows">
      ${row("المساحة", `${ar(size)} مربع`)}
      ${wadi ? row("أرض الوادي (خصبة)", `${ar(wadi)} مربع`, "plus") : ""}
      ${fayda ? row("فيضة", `${ar(fayda)} مربع`, "plus") : ""}
      ${rocks ? row("صخور", `${ar(rocks)}`) : ""}
      ${row("السعر", `${money(price)} ريال`, S.money >= price ? "" : "minus")}
      ${row("اشتريت", `${ar(bought)} من ${ar(PLOTS.length)}`)}
    </div>
    <div class="sheet-actions"><button class="btn go block" id="buyPlot" type="button" ${S.money < price ? "disabled" : ""}>${S.money < price ? `تحتاج ${money(price - S.money)} ريال زيادة` : `اشترِ الأرض بـ${money(price)} ريال`}</button></div>`, "plot");
  $("buyPlot").addEventListener("click", () => {
    const why = buyPlot(S, id);
    if (why) { toast(why, "bad"); sfx.deny(); return; }
    sfx.era(); closeSheet(); toast(`صارت ${plot.name} لك!`, "goal");
    world.sync(S); refresh(); save();
  });
}
export function council() {
  const list = Object.entries(TECH).map(([id, t], i) => {
    const done = S.tech[id], going = S.research?.id === id, locked = t.era > S.era;
    const pct = going ? Math.round((1 - S.research.left / t.days) * 100) : 0;
    return `<div class="tech ${done ? "done" : going ? "going" : ""} ${locked ? "locked" : ""}" style="--i:${i}"><div class="tech-top"><b>${t.name}</b>
      ${done ? "<span class='ok'>تم ✓</span>" : going ? `<span>باقي ${ar(S.research.left)} ساعة</span>` : locked ? `<span class="lock">يفتح في ${ERAS[t.era].name}</span>` : `<button class="btn go" data-tech="${id}" type="button" ${S.research || S.money < t.cost ? "disabled" : ""}>${money(t.cost)} ريال · ${ar(t.days)} ساعة</button>`}
      </div><p>${t.text}</p>${going ? `<i class="prog"><i style="width:${pct}%"></i></i>` : ""}</div>`;
  }).join("");
  const vote = Math.round(voteShare(S) * 100), days = Math.ceil(hoursToElection(S) / 24), last = S.elections?.[S.elections.length - 1];
  const elect = S.pop >= 30 ? `<h3>🗳️ الانتخابات</h3><div class="rows">
      ${row("الانتخابات الجاية", days === 1 ? "بكرة" : days === 2 ? "بعد يومين" : `بعد ${ar(days)} ${days <= 10 ? "أيام" : "يوم"}`)}
      ${row("لو صارت اليوم", `${ar(vote)}٪ ${vote >= 50 ? "تفوز" : "تخسر"}`, vote >= 50 ? "plus" : "minus")}
      ${row("وعود وفيت فيها هالسنة", ar(S.record?.kept || 0), "plus")}${S.record?.broken ? row("وعود ما وفيت فيها", ar(S.record.broken), "minus") : ""}
      ${last ? row(`آخر انتخابات`, `${ar(last.share)}٪ ${last.won ? "فزت ✓" : "خسرت"}`, last.won ? "plus" : "minus") : ""}
      <p class="hint">الأصوات تجي من رضا الناس وثقتهم فيك والوعود اللي وفيت فيها. الفوز يجيب دعم ${money(ELECTION_GRANT[S.era])} ريال من المحافظة، والخسارة تضاعف رسوم المحافظة السنة الجاية.</p></div>` : "";
  sheet(`<h2>المجلس البلدي</h2>${elect}
    <div class="sheet-actions"><button class="btn block" id="openQuarters" type="button">🏘️ حارات الرافعية</button></div>
    <h3>الأبحاث</h3><p>أبحاث تطوّر الرافعية. بحث واحد في كل مرة، ويبقى للأبد.</p><div class="rows">${list}</div>`, "council");
  $("openQuarters").addEventListener("click", () => { sfx.tap(); quartersSheet(); });
  $("sheetBody").querySelectorAll("[data-tech]").forEach((b) => b.addEventListener("click", () => {
    const why = startResearch(S, b.dataset.tech);
    if (why) { toast(why, "bad"); sfx.deny(); } else { toast(`بدأ بحث «${TECH[b.dataset.tech].name}»`); sfx.coin(); }
    refresh(); council();
  }));
}
/** What the season, the hour and the town's stage mean, and what comes next. */
/** «بعد يومين», «بعد ٣ أيام», «بعد ١٢ يوم». */
export const afterDays = (d) => (d <= 1 ? "بكرة" : d === 2 ? "بعد يومين" : `بعد ${ar(d)} ${d <= 10 ? "أيام" : "يوم"}`);
export const SEASON_NOTES = {
  spring: ["الفيضة تخضر إذا الشتاء كان ممطر، والناس يكشتون", "الحلال يرعى بالفياض ببلاش", "يجي جراد أحيانًا ويضر المزارع", "مطر الربيع خفيف"],
  summer: ["ما فيه مطر أبد", "الحر يزيد طلب الماء والكهرب (المكيفات)", "موجات حر وغبار", "الناس يقيّلون الظهر والشوارع تفضى"],
  autumn: ["الصِّرام: التمر يجيب دخل زيادة", "يبدأ الوسم وتجي أول الأمطار", "السيول تبدأ بالوادي"],
  winter: ["أكثر وقت للمطر والسيول", "موجات برد: الناس يبون تدفئة وكهرب", "الليل طويل", "مطر الشتاء هو اللي يخضّر الربيع الجاي"]
};
export function whenSheet() {
  const se = seasonOf(S.day), next = SEASONS[(se.i + 1) % 4], h = hourOf(S.day), D = se.daylight * HOURS;
  const era = ERAS[S.era], nextEra = ERAS[S.era + 1]?.worldOnly && !worldMode ? null : ERAS[S.era + 1];
  const prayers = PRAYERS.map((p) => ({ ...p, h: p.at(D) % HOURS }));
  const upcoming = prayers.map((p) => ({ ...p, in: (p.h - h + HOURS) % HOURS || HOURS })).sort((a, b) => a.in - b.in)[0];
  const toElect = hoursToElection(S);
  sheet(`<h2>🌤️ الوقت والموسم</h2>
    <div class="vote"><b>${se.name}</b><span>اليوم ${ar(se.dayIn)} من ${ar(SEASON_DAYS)} · السنة ${ar(se.year)} · ${h < D ? "نهار ☀️" : "ليل 🌙"}</span></div>
    <h3>وش يصير ب${se.name}</h3>
    <div class="rows">${SEASON_NOTES[se.id].map((t) => `<div class="row"><span>• ${t}</span></div>`).join("")}</div>
    <div class="rows">
      ${row("بعده", `${next.name} ${afterDays(Math.ceil(se.left))}`)}
      ${row("طول النهار", `${ar(Math.round(D))} ساعة من ${ar(HOURS)}`)}
      ${upcoming ? row("الصلاة الجاية", `${upcoming.name} بعد ${ar(upcoming.in)} ساعة`) : ""}
      ${toElect != null ? row("الانتخابات", afterDays(Math.ceil(toElect / HOURS))) : ""}
    </div>
    <h3>🏘️ ${S.name && S.site && S.site !== "main" ? S.name : "الرافعية"}: ${era.name}</h3>
    ${nextEra ? `<div class="rows">${row(`عشان تصير ${nextEra.name}`, `${money(S.pop)} من ${money(nextEra.pop)} نسمة`, S.pop >= nextEra.pop ? "plus" : "")}</div>
      <i class="bar wide"><i style="width:${Math.min(100, Math.round((S.pop / nextEra.pop) * 100))}%"></i></i>` : `<div class="need ok">وصلت أعلى مرحلة 👏</div>`}
    <p class="hint">كل ساعة باللعبة = ${ar(Math.round(HOUR_MS / 1000))} ثانية. ${worldMode ? "بعالم الجوف الوقت ماشي للكل حتى وانت طالع." : "اللعبة توقف وانت طالع منها."}</p>
    <div class="sheet-actions keep"><button class="btn block" id="whenMap" type="button">${worldMode ? "🌍 خريطة الجوف" : "🗺️ خريطة المنطقة"}</button></div>`, "when");
  $("whenMap")?.addEventListener("click", () => { sfx.tap(); if (worldMode) worldMapSheet(); else regionSheet(); });
}
