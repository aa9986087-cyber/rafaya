// «قلعة مارد»: the castle in the middle of al-Jouf. Who holds it, the armies on the way, the camp (training),
// the march, the last battles and the record. Foot soldiers only. The server decides everything (js/warserver.js).
import { $, ar, money, sheet, sheetFor, worldMode } from "./main.js";
import { WARX, warApi, warNow, warReq, warSyncNow, warPoll, fmtLeft, secLeft } from "./ui-war.js";
import { me } from "./ui-online.js";
import { toast } from "./ui-build.js";
import { sfx } from "./sound.js";
import { TROOPS, TROOP_IDS, CASTLE, CASTLE_ON } from "./castle.js";

export const CASTLE_UI = { view: null, send: { inf: 0, sf: 0, sn: 0 }, tab: "fight", tick: 0, poll: 0 };
const csN = (n) => ar(Math.round(n || 0));
const csSpan = (ms) => { const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000); return h ? `${ar(h)} س ${ar(m)} د` : `${ar(Math.max(1, m))} د`; };
/** The crown beside the castle holder's name (the chat, the map): to tease everyone else. */
export const castleCrown = (plot) => (CASTLE_ON && plot != null && WARX.st?.castle?.holder === plot ? `<span class="castle-crown" title="ماسك قلعة مارد">👑 أمير الجوف</span>` : "");

export async function castleSheet(tab = CASTLE_UI.tab) {
  if (!worldMode) return;
  CASTLE_UI.tab = tab;
  if (!CASTLE_UI.view) sheet(`<h2>🏰 ${CASTLE.name}</h2><p class="hint">نحمّل…</p>`, "castle");
  const r = await warApi("castle", {});
  if (r.error) { sheet(`<h2>🏰 ${CASTLE.name}</h2><div class="need">${r.error}</div>`, "castle"); return; }
  CASTLE_UI.view = r.castle; csDraw();
  clearInterval(CASTLE_UI.tick); CASTLE_UI.tick = setInterval(() => { if (sheetFor !== "castle") { clearInterval(CASTLE_UI.tick); clearInterval(CASTLE_UI.poll); return; } csTick(); }, 1000);
  clearInterval(CASTLE_UI.poll); CASTLE_UI.poll = setInterval(csRefresh, 6000);
}
async function csRefresh() {
  if (sheetFor !== "castle") return;
  const r = await warApi("castle", {}); if (r.castle && sheetFor === "castle") { CASTLE_UI.view = r.castle; csDraw(true); }
}
function csDraw(keepScroll) {
  const c = CASTLE_UI.view, mine = c.mine || {}, myPlot = me()?.plot, holder = c.holder === myPlot;
  const now = warNow(), shield = c.shieldUntil > now;
  const keep = keepScroll ? $("sheetBody").querySelector(".cs-body")?.scrollTop || 0 : 0;
  const busy = mine.busy || 0, cap = mine.cap || 0, room = Math.max(0, cap - busy);
  const head = `<div class="cs-hero"><div class="cs-castle">🏰</div><div><h2>${CASTLE.name}</h2>
    ${c.holder != null ? `<p class="cs-lord">👑 أمير الجوف: <b>«${c.holderTown}»</b>${holder ? " (أنت!)" : ""}<small>يحكم من ${csSpan(now - c.since)}</small></p>` : `<p class="cs-lord">🛡️ يحرسها حراس القلعة: محد مسكها للحين</p>`}
    <div class="cs-kpis"><span>⚔️ الحامية <b>${csN(c.garrison)}</b> جندي</span>${shield ? `<span class="cs-shield">🛡️ محمية <b data-cstime="${c.shieldUntil}">${fmtLeft(c.shieldUntil - now)}</b></span>` : `<span class="cs-open">🔥 مفتوحة للهجوم</span>`}</div></div></div>`;
  const marches = c.marches.length ? `<div class="cs-marches"><h3>🚶 جيوش بالطريق</h3>${c.marches.map((m) => {
      const k = Math.min(1, Math.max(0, (now - m.sent) / (m.at - m.sent)));
      return `<div class="cs-march ${m.mine ? "mine" : ""} ${m.mode}"><span>${m.mode === "guard" ? "🛡️" : "⚔️"} «${m.town}» · ${csN(m.n)} جندي</span><b data-cstime="${m.at}">${secLeft(m.at - now)}</b><i><em style="width:${Math.round(k * 100)}%"></em></i></div>`;
    }).join("")}</div>` : "";
  const tabs = `<div class="war-tabs cs-tabs">${[["fight", "⚔️ جيشي"], ["battles", "📜 المعارك"], ["record", "🏆 السجل"]].map(([k, n]) => `<button type="button" class="${k === CASTLE_UI.tab ? "on" : ""}" data-cstab="${k}">${n}</button>`).join("")}</div>`;
  let body = "";
  if (CASTLE_UI.tab === "fight") {
    if (!mine.hq) body = `<div class="need">تحتاج <b>مركز القيادة العسكرية</b> أول، وبعدها <b>معسكر الجنود</b> من قسم «عسكري».</div>`;
    else if (!mine.barracks) body = `<div class="need">ابنِ <b>معسكر الجنود</b> من قسم «عسكري» بالبناء: فيه تدرّب المشاة والقوات الخاصة والقناصة.</div>`;
    else {
      const queue = (mine.training || []).filter((t) => t.done > now);
      body = `<div class="cs-camp"><h3>🏕️ معسكري <small>${csN(busy)} / ${csN(cap)} جندي</small></h3>
        <div class="cs-troops">${TROOP_IDS.map((k) => `<div class="cs-troop"><span class="ic">${TROOPS[k].icon}</span><b>${TROOPS[k].name}</b><small>${TROOPS[k].text}</small>
          <div class="cs-have">عندك <b>${csN(mine.troops?.[k])}</b></div>
          <div class="cs-train">${[5, 10].map((n) => `<button type="button" class="btn" data-train="${k}" data-n="${n}" ${room < n ? "disabled" : ""}>+${ar(n)} <small>${money(TROOPS[k].cost * n)}</small></button>`).join("")}</div></div>`).join("")}</div>
        ${queue.length ? `<div class="cs-queue">⏳ يتدرّبون: ${queue.map((t) => `${csN(t.n)} ${TROOPS[t.kind].name} <b data-cstime="${t.done}">${secLeft(t.done - now)}</b>`).join(" · ")}</div>` : ""}</div>
        <div class="cs-send"><h3>${holder ? "🛡️ أرسل حراس للقلعة" : "⚔️ ازحف على القلعة"}</h3>
        ${TROOP_IDS.map((k) => `<div class="cs-step"><span>${TROOPS[k].icon} ${TROOPS[k].name}</span><button type="button" class="btn" data-sendd="${k}" data-v="-5">−</button><b>${csN(CASTLE_UI.send[k])}</b><button type="button" class="btn" data-sendd="${k}" data-v="5">+</button><button type="button" class="btn ghost" data-sendall="${k}">الكل</button></div>`).join("")}
        <button type="button" class="btn go block" id="csMarch">${holder ? "🛡️ أرسلهم يحرسون" : "⚔️ ازحف الحين"} · يوصلون بعد ${ar(Math.round((c.marchMs || CASTLE.march) / 60000))} دقايق</button>
        <p class="hint">يمشي جيشك على خريطة الجوف قدام الكل. ${holder ? "" : "اللي يموت يروح، والناجي يرجع لمعسكرك. إذا فنت الحامية تصير أمير الجوف."}</p></div>`;
    }
  } else if (CASTLE_UI.tab === "battles") {
    body = c.battles.length ? `<div class="cs-battles">${c.battles.map((b) => `<div class="cs-battle ${b.win ? "won" : "held"}"><b>${b.win ? "👑 سقطت القلعة" : "🛡️ صدّت القلعة"}</b><span>«${b.town}» (${csN(b.sent)}) ضد ${b.holder != null ? `«${b.holderTown}»` : "حراس القلعة"} (${csN(b.garrison)})</span><small>خسر المهاجم ${csN(b.lostA)} · خسرت الحامية ${csN(b.lostD)} · ${csSpan(now - b.at)}</small></div>`).join("")}</div>` : `<p class="hint">ما صارت معارك للحين. كن أول من يزحف!</p>`;
  } else {
    const list = (title, rows, fmt) => `<div class="cs-rec"><h3>${title}</h3>${rows.length ? rows.map((r, i) => `<div><span>${["🥇", "🥈", "🥉"][i] || ar(i + 1)}</span><b>«${r.town}»</b><em>${fmt(r.v)}</em></div>`).join("") : `<p class="hint">محد للحين</p>`}</div>`;
    body = `${c.lord ? `<div class="cs-sayed">👑 <b>سيّد الجوف</b>: «${c.lord.town}»<small>أطول وقت ماسك القلعة بالمجموع</small></div>` : ""}
      ${list("⏳ أطول وقت بالمجموع", c.records.held, csSpan)}${list("🏰 أطول حكم متواصل", c.records.longest, csSpan)}${list("⚔️ أكثر استيلاء", c.records.caps, (v) => `${ar(v)} مرة`)}${list("🛡️ أكثر صد", c.records.defs, (v) => `${ar(v)} مرة`)}${list("🎖️ الشرف (أعداء أسقطهم)", c.records.honour, nf)}`;
  }
  sheet(`${head}${marches}${tabs}<div class="cs-body">${body}</div>`, "castle");
  $("sheet").classList.add("castle");
  const cb = $("sheetBody").querySelector(".cs-body"); if (cb && keep) cb.scrollTop = keep;
  csBind();
}
function csTick() {
  const now = warNow();
  $("sheetBody").querySelectorAll("[data-cstime]").forEach((el) => { const at = Number(el.dataset.cstime); el.textContent = at - now > 90000 ? fmtLeft(at - now) : secLeft(at - now); });
  $("sheetBody").querySelectorAll(".cs-march").forEach((el, i) => { const m = CASTLE_UI.view?.marches[i]; if (!m) return; const k = Math.min(1, Math.max(0, (now - m.sent) / (m.at - m.sent))); const bar = el.querySelector("em"); if (bar) bar.style.width = `${Math.round(k * 100)}%`; });
  if ((CASTLE_UI.view?.marches || []).some((m) => m.at < now - 1500) && !CASTLE_UI.busy) { CASTLE_UI.busy = true; csRefresh().finally(() => { CASTLE_UI.busy = false; warPoll(true); }); }
}
function csBind() {
  const q = (sel) => $("sheetBody").querySelectorAll(sel);
  q("[data-cstab]").forEach((b) => b.addEventListener("click", () => { sfx.tap(); CASTLE_UI.tab = b.dataset.cstab; csDraw(); }));
  q("[data-train]").forEach((b) => b.addEventListener("click", async () => {
    sfx.tap(); b.disabled = true; await warSyncNow();
    const r = await warApi("train", { req: warReq(), kind: b.dataset.train, n: Number(b.dataset.n) });
    if (r.error) { toast(r.error, "bad"); sfx.deny(); b.disabled = false; return; }
    toast(`🏕️ بدأ تدريب ${ar(Number(b.dataset.n))} ${TROOPS[b.dataset.train].name}`, "good"); sfx.build?.();
    CASTLE_UI.view = r.castle; csDraw(true); warPoll(true);
  }));
  const have = (k) => CASTLE_UI.view?.mine?.troops?.[k] || 0;
  q("[data-sendd]").forEach((b) => b.addEventListener("click", () => { sfx.tap(); const k = b.dataset.sendd; CASTLE_UI.send[k] = Math.max(0, Math.min(have(k), CASTLE_UI.send[k] + Number(b.dataset.v))); csDraw(true); }));
  q("[data-sendall]").forEach((b) => b.addEventListener("click", () => { sfx.tap(); const k = b.dataset.sendall; CASTLE_UI.send[k] = have(k); csDraw(true); }));
  $("csMarch")?.addEventListener("click", async (e) => {
    const units = { ...CASTLE_UI.send };
    if (!TROOP_IDS.some((k) => units[k] > 0)) { toast("اختر جنود ترسلهم", "bad"); sfx.deny(); return; }
    e.currentTarget.disabled = true; await warSyncNow();
    const r = await warApi("march", { req: warReq(), units });
    if (r.error) { toast(r.error, "bad"); sfx.deny(); e.currentTarget.disabled = false; return; }
    sfx.event?.(); toast("⚔️ جيشك زاحف! الكل يشوفه بالخريطة", "good");
    CASTLE_UI.send = { inf: 0, sf: 0, sn: 0 }; CASTLE_UI.view = r.castle; csDraw(); warPoll(true);
  });
}
/** A small card in the war room: who holds the castle, and the way in. */
export function castleCard() {
  const c = WARX.st?.castle; if (!c || !CASTLE_ON) return "";
  return `<button type="button" class="cs-card" id="csOpen"><span class="ic">🏰</span><span><b>${CASTLE.name}</b><small>${c.holder != null ? `👑 أمير الجوف: «${c.town}»` : "يحرسها حراس القلعة: محد مسكها"}${c.marching ? ` · ⚔️ ${ar(c.marching)} جيش بالطريق` : ""}</small></span><em>افتح ←</em></button>`;
}
