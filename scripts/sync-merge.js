import { buildExportCSS } from "./animations.js";
import { normalizeAnimation } from "./storage.js";

/* Keep publishing metadata stable when a scan produces the same animation.
   Otherwise a new updatedAt alone makes every CSS file look changed. */
export function mergeScannedAnimation(record, existing) {
  if (!existing) return normalizeAnimation({ ...record, source: "session" });

  const candidate = normalizeAnimation({
    ...existing,
    ...record,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: existing.updatedAt,
  });

  if (buildExportCSS(candidate) === buildExportCSS(existing)) return existing;

  candidate.updatedAt = Date.now();
  candidate.codeSynced = false;
  return candidate;
}
