// The public chat of al-Jouf.
// Moved out of js/main.js as it was (nothing changed in it); main.js and the modules import each other's names.
import { $, S, ar, chatSheet, sheet, sheetFor, store, visiting, worldMode } from "./main.js";
import { LIVE, api, me } from "./ui-online.js";
import { toast } from "./ui-build.js";
import { sfx } from "./sound.js";
import { WARX, fmtLeft, relTimer, warNow } from "./ui-war.js";
import { REL_ICONS, REL_NAMES } from "./war.js";

export const CHAT = { msgs: [], last: 0, polled: 0, busy: false };
export const chatSeen = () => Number(store.get("rafaya-chat-seen") || 0);
export async function chatPoll(force) {
  if (!worldMode || CHAT.busy || (!force && Date.now() - CHAT.polled < (LIVE.ok ? 300000 : sheetFor === "chat" ? 4000 : 20000))) return; // live: messages arrive by themselves
  CHAT.busy = true; CHAT.polled = Date.now();
  try {
    const r = await api(`/world/chat${CHAT.last ? `?after=${CHAT.last}` : ""}`);
    if (r.messages?.length) {
      CHAT.msgs = [...CHAT.msgs, ...r.messages].slice(-120);
      CHAT.last = CHAT.msgs[CHAT.msgs.length - 1].id;
      if (sheetFor === "chat") chatSheet(true);
    }
  } catch { /* the next time */ }
  CHAT.busy = false;
  chatCount();
}
export function chatCount() {
  const mine = me()?.name, n = CHAT.msgs.filter((m) => m.id > chatSeen() && m.name !== mine).length;
  $("chatCount").hidden = !n || sheetFor === "chat";
  $("chatCount").textContent = ar(Math.min(n, 9)) + (n > 9 ? "+" : "");
}
export function developerNoteSheet(id, chatDraft) {
  sheet(`<h2>ملاحظة خاصة للمطور</h2>
    <p>المطور يشوف ملاحظتك واسمك في اللعبة. الملاحظة تبقى خاصة وما تظهر في الشات العام.</p>
    <form id="developerNoteForm">
      <label for="developerNoteText">ملاحظتك</label>
      <textarea id="developerNoteText" maxlength="600" required placeholder="اكتب اقتراحك أو وصف المشكلة"></textarea>
      <div class="sheet-actions keep">
        <button class="btn go block" id="developerNoteSend" type="submit">إرسال للمطور فقط</button>
        <button class="btn block" id="developerNoteBack" type="button">رجوع للشات</button>
      </div>
    </form>`, "developer-note");
  const form = $("developerNoteForm");
  $("developerNoteBack").addEventListener("click", () => chatSheet(false, chatDraft));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = $("developerNoteText").value.trim(), send = $("developerNoteSend");
    if (send.disabled) return;
    if (!text) { toast("اكتب ملاحظتك أول", "bad"); return; }
    send.disabled = true;
    let result;
    try {
      result = await api("/world/feedback", { name: id.name, secret: id.secret, text });
    } catch (error) {
      result = { error: error.message === "maintenance" ? "عالم الجوف تحت الصيانة" : "ما وصلت الملاحظة، جرّب مرة ثانية" };
    } finally {
      send.disabled = false;
    }
    if (!result.ok) {
      toast(result.error || "ما وصلت الملاحظة، جرّب مرة ثانية", "bad");
      sfx.deny();
      return;
    }
    toast("وصلت ملاحظتك للمطور", "goal");
    sfx.tap();
    if (sheetFor === "developer-note" && form.isConnected) chatSheet(false, chatDraft);
  });
}
/** The military part of another town's card on the al-Jouf map. */
export function warCardHtml(plot) {
  if (!worldMode) return "";
  const r = WARX.st?.rels.find((x) => x.other === plot), state = r?.state || "peace";
  const home = visiting ? visiting.home : S;
  const why = !home.tiles.some((t) => t.b?.id === "milhq") ? "تحتاج مركز القيادة العسكرية" : state === "warning" ? `الحرب تبدأ بعد ${fmtLeft(r.warStart - warNow())}` : state !== "war" ? (state === "truce" ? "فيه هدنة" : "لازم تكون بينكم حرب: من العلاقات العسكرية") : "";
  return `<div class="row"><span>العلاقة</span><b>${REL_ICONS[state]} ${REL_NAMES[state]}${r ? relTimer(r) : ""}</b></div>
    <button class="btn block" id="wmRel" type="button">⚔️ العلاقات العسكرية</button>
    <button class="btn ${why ? "" : "danger"} block" id="wmTarget" type="button" ${why ? `data-why="${why}"` : ""}>🎯 استهداف المدينة${why ? `<small>${why}</small>` : ""}</button>`;
}
