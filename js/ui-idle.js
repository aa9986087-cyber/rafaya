// The clock, asleep with the game open (the deputy), iPhone Safari leaving the page.
// Moved out of js/main.js as it was (nothing changed in it); main.js and the modules import each other's names.
import { A, RENDER, S, lastTouch, money, openCat, perfSet, refresh, save, sheetFor, speed, sync, visiting, world, worldMode } from "./main.js";
import { hourEffects, renderCards, toast } from "./ui-build.js";
import { AWAY_CAP, changeMoney, hourOf, prayerNow, seasonOf, step } from "./sim.js";
import { council, hourNews } from "./ui-news.js";
import { budget } from "./ui-whatsnew.js";
import { sfx } from "./sound.js";
import { HOURS, MAP_SIZE as N, REGION } from "./data.js";
import { electionSheet } from "./ui-region.js";
import { WARX } from "./ui-war.js";

// The phone left on all night is "away" too: from the last touch the town gains at most AWAY_CAP for its
// stage, like a mayor who left the game. The money from before is never touched. A touch ends it.
export const IDLE_MS = () => globalThis.__idleMs || 15 * 60000;
export function idleCheck() {
  if (!worldMode || visiting || !S.world) return;
  if (!S.idle && Date.now() - lastTouch > IDLE_MS()) {
    S.idle = { money: Math.round(S.money) };
    toast(`😴 ما لمست اللعبة من ربع ساعة: النائب ماسك البلد. أكثر شي تكسبه لين ترجع ${money(idleCap())} ريال`, "season");
  }
}
export const idleCap = () => AWAY_CAP[Math.min(AWAY_CAP.length - 1, S.era)] ?? AWAY_CAP[0];
/**
 * Asleep: the balance never goes above where it was plus the cap. What is above is kept aside (pool),
 * and any bill that comes later (the province fee, repairs, war) is paid from it first, so the cap never
 * makes the mayor pay a bill from his own money that the extra income would have paid.
 */
export function idleClamp() {
  if (!S?.idle) return;
  const top = S.idle.money + idleCap();
  S.idle.pool ||= 0;
  if (S.money > top) {
    S.idle.pool += S.money - top;
    changeMoney(S, top - S.money, "idleLimit");
  } else if (S.money < top && S.idle.pool > 0) {
    const add = Math.min(S.idle.pool, top - S.money);
    changeMoney(S, add, "idleCover");
    S.idle.pool -= add;
  }
}
export function runHour() {
  idleCheck();
  const { msgs } = step(S);
  idleClamp();
  for (const m of msgs) {
    if (m.kind === "decision") continue; // its own sheet opens
    if (m.kind === "land") continue; // the ground is redrawn by the sync below
    if (m.kind === "ach") { toast(m.text, "ach"); sfx.goal(); continue; }
    if (m.kind === "flood") {
      // look at the wadi where the water comes down, then let it run
      const spots = m.lost.length ? m.lost : m.damaged;
      if (spots.length) { const cx = spots.reduce((n, i) => n + (i % N), 0) / spots.length, cy = spots.reduce((n, i) => n + Math.floor(i / N), 0) / spots.length; world.focus(Math.round(cx), Math.round(cy)); world.view.zoom = Math.min(world.view.zoom, 1.1); world.updateCamera(); }
      world.playFlood(m.lost, m.damaged); sfx.flood(); toast(m.text, "bad"); continue;
    }
    if (m.kind === "collapse") { toast(m.text, "bad"); sfx.remove(); continue; }
    if (m.kind === "bolt") { world.lightning(m.i); sfx.thunder(0.95, 0.05); if (m.text) toast(m.text, "bad"); continue; }
    if (m.kind === "election") { electionSheet(m); continue; }
    toast(m.kind === "season" ? m.text : m.title ? `${m.title}: ${m.text}` : m.text, m.kind === "goal" ? "goal" : m.kind === "era" ? "era" : m.kind === "season" ? `season ${seasonOf(S.day).id}` : "");
    (m.kind === "era" ? sfx.era : m.kind === "goal" ? sfx.goal : m.kind === "event" || m.kind === "season" ? sfx.event : sfx.coin)();
    if (m.kind === "era" && openCat) renderCards();
    if (m.kind === "era" && S.era === REGION.unlockEra && (S.site || "main") === "main") setTimeout(() => toast("🗺️ انفتحت خريطة المنطقة: اضغط على مربع الوقت فوق وأسس الرديفة والأضارع وصفان", "era"), 2500);
  }
  sync(false);
  // Rush hours: the first hours of the morning and the afternoon.
  { const h = hourOf(S.day), D = seasonOf(S.day).daylight * HOURS; world.rush = h <= 2 || (h >= Math.round(D * 0.75) && h <= Math.round(D * 0.75) + 1); world.trafficCong = A.trafficCong;
    // القايلة: in summer the streets empty at midday, everyone stays in from the heat
    world.siesta = seasonOf(S.day).id === "summer" && h >= Math.round(D * 0.4) && h < Math.round(D * 0.7); }
  // Prayer time: a soft call, and the men walk to the mosque.
  const pr = prayerNow(S);
  world.prayer = pr;
  if (pr && speed <= 5) { toast(`🕌 حان وقت صلاة ${pr.name}${A.count.mosque + A.count.bigmosque ? "" : " · وما فيه مسجد بالرافعية"}`, ""); sfx.prayer(); }
  refresh();
  save();
  hourEffects();
  hourNews(msgs);
  if (sheetFor === "budget") budget();
  if (sheetFor === "council") council();
}
/**
 * The adaptive quality. It watches, over seconds and not single frames:
 * - how long the game takes to draw a frame;
 * - how late the frames come against the frame rate asked for (a busy GPU or a hot phone shows as late frames).
 * Phones give no reliable temperature to a web page, so heat is read from sustained slowness.
 * Steps (world.setLevel): 1 a little less sharp, 2 no shadows, 3 less sharp still, 4 at most 30 frames a second.
 * Down after 6 s of trouble; up only after 25 s of ease and never within a minute of going down (no flicker).
 * In «auto» it moves both ways; a fixed choice only takes the first two steps down, as a safety net.
 */
export const perf = { cpu: 4, late: 1, since: 0, easy: 0, level: 0, downAt: 0, lastAt: 0, warm: performance.now() + 8000 };
export function perfWatch(ms, now, wanted, busy) {
  const gap = perf.lastAt ? now - perf.lastAt : wanted; perf.lastAt = now;
  if (ms > 150 || gap > 1000) perf.warm = now + 4000; // a town being built or opened (one-off work): a few seconds don't count
  if (document.hidden || WARX.scene || now < (perf.warm || 0)) { perf.since = perf.easy = 0; return; } // back from the background, or a war scene: not a measure
  perf.cpu = perf.cpu * 0.95 + ms * 0.05;
  if (busy) perf.late = perf.late * 0.92 + Math.min(4, gap / wanted) * 0.08; // only frames that were meant to come fast say if they are late
  else perf.late = perf.late * 0.995 + 0.005; // calm frames are slow on purpose: lateness fades, so the quality may come back
  const budget = 1000 / RENDER.busy;
  const trouble = perf.cpu > budget * 0.75 || perf.late > 1.35, ease = perf.cpu < budget * 0.35 && perf.late < 1.1;
  if (trouble) { perf.easy = 0; perf.since ||= now; if (now - perf.since > 6000 && now - perf.downAt > 6000) { perf.since = 0; perf.late = 1; perfSet(perf.level + 1, now); } return; } // one step at a time, 6 s apart at least
  perf.since = 0;
  if (!RENDER.adapt || !ease || !perf.level) { perf.easy = 0; return; }
  perf.easy ||= now;
  if (now - perf.easy > 25000 && now - perf.downAt > 60000) { perf.easy = 0; perfSet(perf.level - 1, now); }
}
// the trial copy and ?debug: a small meter in a corner (frames a second, the adaptive step, sharpness, what is drawn)
export const perfHud = (globalThis.RAFAYA_PREVIEW || new URLSearchParams(location.search).has("debug")) ? document.body.appendChild(Object.assign(document.createElement("div"), { id: "perfHud" })) : null;
