export const PENDING_SAVE_LIMIT = 32;
const sequentialWrite = /^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

// Each running town gets its own sequence. Keep the UUID shape for clients and workers
// on the previous release, and use version 8 to distinguish it from their random IDs.
export function townSaveWriter() {
  const uuid = crypto.randomUUID();
  const prefix = uuid.slice(0, 14) + "8" + uuid.slice(15, 24);
  let sequence = 0;
  return () => prefix + (++sequence).toString(16).padStart(12, "0");
}

export function pendingSaveMatches(version, pending) {
  if (typeof version !== "string" || !version || !Array.isArray(pending)) return false;
  const sequential = sequentialWrite.test(version);
  const prefix = version.slice(0, 24);
  // A later save from the same running town includes the changes it already sent.
  return pending.slice(-PENDING_SAVE_LIMIT).some(write => write === version || (
    sequential && typeof write === "string" && sequentialWrite.test(write) && write.startsWith(prefix) && write >= version
  ));
}

export function rememberPendingSave(pending, write) {
  const prefix = write.slice(0, 24);
  return [...pending.filter(previous => typeof previous === "string" && !previous.startsWith(prefix)), write].slice(-PENDING_SAVE_LIMIT);
}
