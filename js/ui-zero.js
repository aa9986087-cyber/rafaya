// «ساعة الصفر»: the wars of al-Jouf open for everyone at the same moment, set on the server. Until then a
// countdown (days of al-Jouf, and the real clock to the second) shows in the town; at zero a grand official
// announcement opens the war. The first time a player enters the world after this release, the war trailer
// plays first (once, with a skip button), then the countdown.
import { $, ar, store, worldClock, worldMode } from "./main.js";
import { JOUF_DAY } from "./war.js";
import { sfx, warSfx } from "./sound.js";
import { warGuide } from "./ui-warguide.js";
import { WARX } from "./ui-war.js";

export const ZERO = { at: 0, timer: 0, shown: false };
const INTRO = "rafaya-war-intro-v1", SEEN = "rafaya-war-open-seen-";
const nowS = () => Date.now() + (worldClock.offset || 0);
const pad2 = (n) => String(n).padStart(2, "0");
/** The time left, split for the display: days of al-Jouf, and the real hours, minutes and seconds. */
function left(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { jouf: Math.ceil(ms / JOUF_DAY), h: Math.floor(s / 3600), m: Math.floor(s / 60) % 60, s: s % 60 };
}
const clock = (l) => ar(`${pad2(l.h)}:${pad2(l.m)}:${pad2(l.s)}`);

/** The server's zero hour (from the world clock or the war state). */
export function setWarOpen(at) {
  at = Number(at) || 0;
  if (at === ZERO.at) return;
  ZERO.at = at;
  zeroChip();
}
/** Right after entering one's town: the trailer (first time only), then the countdown or the announcement. */
export function zeroEnter() {
  if (!worldMode) return;
  const next = () => { if (ZERO.at > nowS()) zeroSheet(); else maybeAnnounce(); };
  if (!store.get(INTRO)) { store.set(INTRO, "1"); playIntro(next); } else next();
}

// ---------- the chip in the town: always ticking ----------
function zeroChip() {
  let el = $("zeroChip");
  if (!(ZERO.at > nowS())) { el?.remove(); clearInterval(ZERO.timer); if (ZERO.at && worldMode) maybeAnnounce(); return; }
  if (!el) {
    el = document.createElement("button"); el.id = "zeroChip"; el.type = "button"; el.className = "zero-chip";
    el.addEventListener("click", () => { sfx.tap(); zeroSheet(); });
    document.body.append(el);
  }
  const draw = () => {
    const ms = ZERO.at - nowS();
    if (ms <= 0) { zeroChip(); return; }
    el.hidden = !worldMode;
    const l = left(ms);
    el.innerHTML = `<i>⚔️</i><span><small>ساعة الصفر</small><b>${ar(l.jouf)} يوم · ${clock(l)}</b></span>`;
    const big = $("zeroBig"); // the countdown sheet, if open, ticks too
    if (big) { big.querySelector("[data-z=d]").textContent = ar(l.jouf); big.querySelector("[data-z=h]").textContent = ar(pad2(l.h)); big.querySelector("[data-z=m]").textContent = ar(pad2(l.m)); big.querySelector("[data-z=s]").textContent = ar(pad2(l.s)); }
  };
  draw();
  clearInterval(ZERO.timer); ZERO.timer = setInterval(draw, 1000);
}

// ---------- the countdown, big ----------
export function zeroSheet() {
  const ms = ZERO.at - nowS();
  if (ms <= 0) { maybeAnnounce(true); return; }
  const l = left(ms);
  $("zeroFull")?.remove();
  const box = document.createElement("div");
  box.id = "zeroFull"; box.className = "zero-full";
  box.innerHTML = `<button type="button" class="zero-x" aria-label="إغلاق">✕</button><div class="zero" id="zeroBig">
      <div class="zero-seal"><i></i><b>⚔️</b></div>
      <h2>صراع الجوف</h2><p class="zero-sub">العد التنازلي لساعة الصفر</p>
      <div class="zero-days"><b data-z="d">${ar(l.jouf)}</b><span>يوم بالجوف</span></div>
      <div class="zero-clock">${[["h", "ساعة", l.h], ["m", "دقيقة", l.m], ["s", "ثانية", l.s]].map(([k, t, v]) => `<div><b data-z="${k}">${ar(pad2(v))}</b><small>${t}</small></div>`).join("<i>:</i>")}</div>
      <p class="zero-when">الحرب تفتح للكل بنفس اللحظة: ${new Date(ZERO.at - (worldClock.offset || 0)).toLocaleString("ar-SA", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" })}</p>
      <div class="zero-now"><b>وش تسوي الحين؟</b><ul><li>🏗️ ابنِ مركز القيادة والمباني الحربية</li><li>🚀 اشترِ سلاحك وعبّ دفاعك</li><li>📖 اقرأ قوانين الحرب وخطط لأهدافك</li></ul><small>قبل ساعة الصفر: ما فيه إعلان حرب ولا جزية ولا ضربات.</small></div>
      <div class="sheet-actions keep"><button class="btn go block" type="button" id="zGuide">📖 دليل الحرب وقوانينها</button><button class="btn block" type="button" id="zIntro">🎬 شوف إعلان الحرب</button></div>
    </div>`;
  document.body.append(box);
  requestAnimationFrame(() => box.classList.add("on"));
  const close = () => { box.classList.remove("on"); setTimeout(() => box.remove(), 300); };
  box.querySelector(".zero-x").addEventListener("click", () => { sfx.tap(); close(); });
  $("zGuide").addEventListener("click", () => { sfx.tap(); close(); warGuide(); });
  $("zIntro").addEventListener("click", () => { sfx.tap(); close(); playIntro(() => zeroSheet()); });
}

// ---------- the official announcement, at zero ----------
function maybeAnnounce(force) {
  if (!ZERO.at || ZERO.shown) return;
  const late = nowS() - ZERO.at;
  if (!force && (store.get(SEEN + ZERO.at) || late > 3 * JOUF_DAY)) return; // once; and not days later
  if (WARX.scene || $("introVid")) { setTimeout(() => maybeAnnounce(force), 4000); return; }
  ZERO.shown = true; store.set(SEEN + ZERO.at, "1");
  const el = document.createElement("div");
  el.className = "zero-ann"; el.id = "zeroAnn";
  el.innerHTML = `<div class="za-rays"></div><div class="za-card">
      <div class="za-seal"><b>⚔️</b></div>
      <small class="za-kicker">بيان رسمي</small>
      <h2>بدأ صراع الجوف</h2>
      <p>بسم الله الرحمن الرحيم</p>
      <p>إلى أهالي الجوف ومدنها الكرام،<br>نعلن رسميًا أن ساعة الصفر حلّت، وأن أبواب الحرب صارت مفتوحة من هذه اللحظة: إعلان الحرب، والجزية، والضربات، وفق قوانين الحرب.</p>
      <p>احموا مدنكم، وخطّطوا لأهدافكم، والتزموا بالأنظمة. والقائد الحق من يعرف متى يضرب ومتى يصالح.</p>
      <p class="za-wish">مع تمنياتنا لكم بالتوفيق والسلام</p>
      <small class="za-sign">إدارة عالم الجوف</small>
      <div class="za-acts"><button class="btn go" type="button" id="zaGo">⚔️ إلى غرفة العمليات</button><button class="btn" type="button" id="zaRules">📖 القوانين</button><button class="btn" type="button" id="zaOk">تمام</button></div>
    </div>`;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add("on"));
  try { warSfx.boom(); setTimeout(() => sfx.era(), 700); } catch { /* sound off */ }
  const close = () => { el.classList.remove("on"); setTimeout(() => el.remove(), 400); };
  el.querySelector("#zaOk").addEventListener("click", () => { sfx.tap(); close(); });
  el.querySelector("#zaRules").addEventListener("click", () => { sfx.tap(); close(); warGuide(); });
  el.querySelector("#zaGo").addEventListener("click", () => { sfx.tap(); close(); document.getElementById("warBtn")?.click(); });
}

// ---------- the trailer ----------
/** Full screen, to its end (no skip), sound on when the phone allows (else a button for it); then `done`. */
export function playIntro(done) {
  if ($("introVid")) return;
  const src = globalThis.RAFAYA_WAR_INTRO || "media/war-intro.mp4";
  const el = document.createElement("div");
  el.className = "intro-vid"; el.id = "introVid";
  // no native controls, no play button: the video shows only once it really plays (a gold ring meanwhile)
  el.innerHTML = `<i class="iv-wait"></i><video playsinline webkit-playsinline disablepictureinpicture disableremoteplayback preload="auto" src="${src}"></video><button type="button" class="iv-sound" hidden>🔊 شغّل الصوت</button>`;
  document.body.append(el);
  const v = el.querySelector("video");
  let ended = false;
  const end = () => { if (ended) return; ended = true; v.pause(); el.classList.add("out"); setTimeout(() => { el.remove(); done?.(); }, 350); };
  v.addEventListener("ended", end);
  v.addEventListener("playing", () => el.classList.add("live"));
  v.addEventListener("error", end); // no video (offline): straight on
  const snd = el.querySelector(".iv-sound");
  snd.addEventListener("click", () => { v.muted = false; v.play().catch(() => {}); snd.hidden = true; });
  v.play().catch(() => { v.muted = true; snd.hidden = false; v.play().catch(end); }); // a phone that blocks sound: muted, with the button
}

// ---------- a war won ----------
/** The winner's moment: full screen, the banner, the town celebrating (fireworks drawn in CSS, no 3D work). */
export function victoryScreen(enemy) {
  if ($("victoryBox")) return;
  if (WARX.scene || $("introVid")) { setTimeout(() => victoryScreen(enemy), 4000); return; }
  const el = document.createElement("div");
  el.className = "zero-ann win"; el.id = "victoryBox";
  el.innerHTML = `<div class="za-rays"></div>${Array.from({ length: 10 }, (_, i) => `<i class="fw" style="--x:${8 + (i * 37) % 84}%;--y:${10 + (i * 23) % 40}%;--d:${(i * 0.37) % 2.4}s;--c:${["#f2d48a", "#ff8a7d", "#7fe3b0", "#bfe0ff"][i % 4]}"></i>`).join("")}
    <div class="za-card"><div class="za-seal"><b>🏆</b></div><small class="za-kicker">انتهت الحرب</small>
      <h2>النصر لك!</h2>
      <p>كسرت شوكة «${enemy || "عدوك"}» وانتهت الحرب بانتصارك.</p>
      <p>رايتك ترفرف فوق الجوف، والنشرة تعلن نصرك للكل، وأهل مدينتك يحتفلون فيك. 🎉</p>
      <p class="za-wish">الرضا +١٠ من الفخر · 🎖️ انتصار جديد بسجلك</p>
      <div class="za-acts"><button class="btn go" type="button" id="vOk">الحمدلله 🏆</button></div></div>`;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add("on"));
  try { sfx.era(); setTimeout(() => sfx.goal(), 900); } catch { /* sound off */ }
  const close = () => { el.classList.remove("on"); setTimeout(() => el.remove(), 400); };
  el.querySelector("#vOk").addEventListener("click", () => { sfx.tap(); close(); });
  setTimeout(() => el.querySelectorAll(".fw").forEach((f) => f.remove()), 9000); // the fireworks stop (no endless work)
}
