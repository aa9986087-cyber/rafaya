import { createModeration } from "./moderation.js";

// Single-use authorization bound to one exact request body. The key and body are kept off the repository.
const command = { proof: "3e4823e7fa6689191565797de86e5466b0300c2080bed9678d230fa3cef6500c", expires: 1795581762158 };
const notice = "🛡️ حُذفت مدينة من عالم الجوف بسبب استخدام كلام مسيء في اسمها.";

export async function applyModerationUpdate(board, request, hash, json) {
  const key = request.headers.get("x-moderation-key") || "";
  const length = Number(request.headers.get("content-length"));
  if (Date.now() >= command.expires || !/^[a-f0-9]{64}$/.test(key) || !(length > 0 && length <= 1024)) {
    return json({ error: "not found" }, 404);
  }
  const body = await request.text();
  if (await hash(`${key}\n${body}`) !== command.proof || Date.now() >= command.expires) {
    return json({ error: "not found" }, 404);
  }
  const { names, words, target } = JSON.parse(body);
  const receiptKey = `moderation-receipt:${command.proof}`;
  const result = board.ctx.storage.transactionSync(() => {
    const receipt = board.sql.exec("SELECT value FROM meta WHERE key = ?", receiptKey).toArray()[0];
    if (receipt) return { status: "already applied", ...JSON.parse(receipt.value) };

    const row = board.sql.exec("SELECT town, owner FROM plots WHERE plot = ?", target.plot).toArray()[0];
    if (!row || row.town !== target.town || row.owner !== target.owner) return { status: "town changed" };

    const saved = board.sql.exec("SELECT value FROM meta WHERE key = 'private_moderation'").toArray()[0]?.value;
    const current = saved ? JSON.parse(saved) : {};
    const config = { names: [...new Set([...(current.names || []), ...names])], words: [...new Set([...(current.words || []), ...words])] };
    const moderation = createModeration(config);
    const matching = board.sql.exec("SELECT id FROM wnews WHERE kind = 'town' AND plot = ? AND instr(text, ?) > 0",
      target.plot, `«${target.town}»`).toArray();
    for (const line of matching) board.sql.exec("DELETE FROM wnews WHERE id = ?", line.id);
    board.removeTown(target.plot, "", false);
    board.news("moderation", notice, null, null, false);
    board.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('private_moderation', ?)", JSON.stringify(config));
    const summary = { removed: true, foundingNotices: matching.length };
    board.sql.exec("INSERT INTO meta (key, value) VALUES (?, ?)", receiptKey, JSON.stringify(summary));
    return { status: "applied", ...summary, moderation };
  });
  if (result.status === "town changed") return json(result, 409);
  const { moderation, ...summary } = result;
  if (moderation) {
    board.moderation = moderation;
    board.live({ t: "town", plot: target.plot });
    board.live({ t: "news" });
  }
  return json(summary);
}
