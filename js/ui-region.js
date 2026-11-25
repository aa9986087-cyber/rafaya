// The solo region map.
// Moved out of js/main.js as it was (nothing changed in it); main.js and the modules import each other's names.
import { $, RG, S, ar, closeSheet, money, noteTown, refresh, save, saveRegion, sheet, store, switchTown, townKey } from "./main.js";
import { ERAS, PROVINCE_FEES, REGION, SITES, TERRAINS } from "./data.js";
import { row, toast } from "./ui-build.js";
import { sfx } from "./sound.js";
import { changeMoney, newGame, pack, unpack } from "./sim.js";

export const linked = (a, b) => RG.roads.some(([p, q]) => (p === a && q === b) || (p === b && q === a));
// (towns founded before the region had its real names keep a place on the map)
export const siteOf = (id) => SITES.find((x) => x.id === id) || { id, x: 50, y: 86, terrain: RG.towns[id]?.terrain || "plain", name: RG.towns[id]?.name || "" };
export const regionOpen = () => (RG.towns.main?.era ?? (S.site === "main" ? S.era : 0)) >= REGION.unlockEra;
/** What linked towns this town trades with (their people shop and their traders buy here). */
export function noteNeighbours() {
  const here = S.site || "main";
  S.neighbours = Object.keys(RG.towns).filter((id) => id !== here && linked(here, id)).map((id) => ({ id, name: RG.towns[id].name, pop: RG.towns[id].pop }));
}
export function regionSheet(pick) {
  noteTown();
  const here = S.site || "main", towns = RG.towns, ids = Object.keys(towns);
  const totalPop = ids.reduce((n, id) => n + (towns[id].pop || 0), 0), totalMoney = ids.reduce((n, id) => n + (towns[id].money || 0), 0);
  const title = ids.length >= 3 ? "أمير المنطقة" : "عمدة الرافعية";
  const sel = pick || here, site = siteOf(sel), t = towns[sel];
  const founded = ids.length - 1, price = REGION.found[Math.min(founded, REGION.found.length - 1)];
  const roads = RG.roads.map(([p, q]) => { const a = siteOf(p), b = siteOf(q); return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="rg-road"/>`; }).join("");
  const dots = [...SITES, ...Object.keys(towns).filter((id) => !SITES.some((x) => x.id === id)).map(siteOf)].map((x) => {
    const tt = towns[x.id], cur = x.id === here, on = x.id === sel;
    const rad = tt ? 3.2 + Math.min(4, Math.log10((tt.pop || 1) + 1) * 1.3) : 3;
    return `<g class="rg-site ${tt ? "town" : "free"} ${cur ? "cur" : ""} ${on ? "on" : ""}" data-site="${x.id}" transform="translate(${x.x} ${x.y})">
      <circle r="${rad}"/>${tt ? "" : `<text class="plus" y="1.3">+</text>`}
      <text class="lbl" y="${-rad - 1.6}">${tt ? tt.name : x.name}</text>${tt ? `<text class="pop" y="${rad + 3.4}">${ar((tt.pop || 0).toLocaleString("en-US"))}</text>` : ""}</g>`;
  }).join("");
  let detail;
  if (t) {
    detail = `<div class="rg-card"><div class="rg-top"><b>${t.name}</b><small>${ERAS[t.era || 0].name} · ${TERRAINS[t.terrain]?.name || ""}</small></div>
      <div class="rows">${row("السكان", money(t.pop || 0))}${row("الميزانية", `${money(t.money || 0)} ريال`, (t.money || 0) < 0 ? "minus" : "")}${row("الدخل بالساعة", `${(t.net || 0) >= 0 ? "+" : "−"}${money(Math.abs(t.net || 0))}`, (t.net || 0) >= 0 ? "plus" : "minus")}</div>
      ${sel === here ? `<p class="hint">أنت فيها الحين.</p>` : `<div class="sheet-actions"><button class="btn go block" id="rgEnter" type="button">ادخل ${t.name}</button></div>
        ${linked(here, sel) ? `<p class="hint">🛣️ موصولة بطريق: يتسوقون ويتاجرون مع بعض.</p><div class="rg-send"><span>حوّل لها من ميزانيتك:</span>${[1000, 5000, 20000].map((v) => `<button class="btn" type="button" data-send="${v}" ${S.money < v ? "disabled" : ""}>${money(v)}</button>`).join("")}</div>`
          : `<div class="sheet-actions"><button class="btn block" id="rgRoad" type="button" ${S.money < roadCost(here, sel) ? "disabled" : ""}>🛣️ وصّل طريق من ${S.name} بـ${money(roadCost(here, sel))} ريال</button></div><p class="hint">المدن الموصولة بطريق يتسوق ناسها عند بعض، والتجار يشترون من ورشهم.</p>`}`}</div>`;
  } else {
    detail = `<div class="rg-card"><div class="rg-top"><b>${site.name}</b><small>أرض ${TERRAINS[site.terrain].name}</small></div><p>${TERRAINS[site.terrain].text}</p>
      ${regionOpen() ? `<input id="rgName" type="hidden" value="${site.name}">
        <div class="sheet-actions"><button class="btn go block" id="rgFound" type="button" ${S.money < price ? "disabled" : ""}>أسس ${site.name} بـ${money(price)} ريال</button></div>
        <p class="hint">تندفع من ميزانية ${S.name}، و${site.name} تبدأ بثلاث خيام و${money(REGION.startMoney)} ريال. المدن اللي ما أنت فيها توقف لين ترجع لها.</p>`
        : `<div class="need">تنفتح لما تصير الرافعية ${ERAS[REGION.unlockEra].name} (${money(ERAS[REGION.unlockEra].pop)} ساكن).</div>`}</div>`;
  }
  sheet(`<h2>🗺️ منطقة الرافعية</h2><p>لقبك: <b>${title}</b> · ${ar(ids.length)} ${ids.length === 1 ? "مدينة" : "مدن"} · ${money(totalPop)} ساكن · ${money(totalMoney)} ريال</p>
    <svg class="rg-map" viewBox="0 0 100 100" role="img" aria-label="خريطة المنطقة"><defs><radialGradient id="rgSand" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#f1d9a6"/><stop offset="1" stop-color="#d9b47a"/></radialGradient></defs>
      <rect width="100" height="100" rx="6" fill="url(#rgSand)"/>
      <path d="M0 52 C 20 46, 35 60, 50 54 S 80 44, 100 50" class="rg-wadi"/>
      <path d="M6 12 l6 -6 l6 6 z M12 30 l5 -5 l5 5 z M24 16 l4 -4 l4 4 z" class="rg-hill"/>
      <path d="M68 10 q 6 -4 12 0 q 6 4 12 0 M70 30 q 6 -4 12 0" class="rg-dune"/>
      ${roads}${dots}</svg>
    ${detail}`, "region");
  $("sheetBody").querySelectorAll("[data-site]").forEach((g) => g.addEventListener("click", () => { sfx.tap(); regionSheet(g.dataset.site); }));
  $("rgEnter")?.addEventListener("click", () => switchTown(sel));
  $("rgRoad")?.addEventListener("click", () => {
    const c = roadCost(here, sel);
    if (S.money < c) { toast("ما يكفي المال", "bad"); sfx.deny(); return; }
    changeMoney(S, -c, "build", "ربط المدن بطريق"); RG.roads.push([here, sel]); noteNeighbours(); save(); sfx.build(); toast(`انفتح الطريق بين ${S.name} و${t.name} 🛣️`, "goal"); refresh(); regionSheet(sel);
  });
  $("sheetBody").querySelectorAll("[data-send]").forEach((b) => b.addEventListener("click", () => {
    const v = Number(b.dataset.send);
    if (S.money < v) return;
    const raw = store.get(townKey(sel));
    if (!raw) return;
    const other = unpack(raw);
    changeMoney(other, v, "transfer", S.name);
    changeMoney(S, -v, "transfer", other.name);
    store.set(townKey(sel), pack(other));
    RG.towns[sel].money = Math.round(other.money);
    save(); refresh(); sfx.coin(); toast(`حوّلت ${money(v)} ريال لـ${t.name}`, "goal"); regionSheet(sel);
  }));
  $("rgFound")?.addEventListener("click", () => {
    if (S.money < price) { toast("ما يكفي المال", "bad"); sfx.deny(); return; }
    const name = ($("rgName").value || site.name).trim().slice(0, 20);
    changeMoney(S, -price, "land", site.name); save();
    const town = newGame(Math.floor(Math.random() * 1e9), { terrain: site.terrain, name, site: site.id, money: REGION.startMoney });
    store.set(townKey(site.id), pack(town));
    RG.towns[site.id] = { name, terrain: site.terrain, pop: town.pop, era: 0, money: town.money, net: 0 };
    saveRegion();
    sfx.era(); toast(`تأسست «${name}»! 🎉`, "era");
    switchTown(site.id);
  });
}
export const roadCost = (a, b) => { const p = siteOf(a), q = siteOf(b); return Math.round(Math.hypot(p.x - q.x, p.y - q.y) * REGION.roadPerUnit); };
/** The result of the yearly election. */
export function electionSheet(m) {
  const pct = Math.round(m.share * 100);
  sfx[m.won ? "era" : "event"]();
  sheet(`<h2>🗳️ نتيجة انتخابات المجلس البلدي</h2>
    <div class="vote"><b class="${m.won ? "plus" : "minus"}">${ar(pct)}٪</b><span>من أصوات أهل الرافعية</span></div>
    <i class="prog"><i style="width:${pct}%"></i></i>
    <p>${m.won ? `مبروك! الأهالي جددوا ثقتهم فيك سنة ثانية. المحافظة صرفت لك دعم <b>${money(m.grant)} ريال</b>، والناس فرحانين يومين.` : `خسرت هالمرة. المحافظة بترسل مراقب، ورسومها السنة الجاية بتكون الضعف (${money(PROVINCE_FEES[S.era] * 2)} ريال). شد حيلك ووفّ بوعودك عشان ترجع ثقة الناس.`}</p>
    <div class="rows">${row("وعود وفيت فيها", ar(m.record.kept || 0), "plus")}${row("وعود ما وفيت فيها", ar(m.record.broken || 0), m.record.broken ? "minus" : "")}${row("رضا الناس", `${ar(Math.round(S.happy))}٪`)}${row("ثقة الناس فيك", `${ar(Math.round(S.trust ?? 60))}٪`)}</div>
    <div class="sheet-actions"><button class="btn go block" id="electOk" type="button">تمام</button></div>`, "election");
  $("electOk").addEventListener("click", closeSheet);
}
