import { buildExportCSS } from "./animations.js";
import { normalizeAnimation } from "./storage.js";

function sourceKey(source) {
  return [source.repository, source.folder, source.brand, source.campaign, source.file, source.type].join("\u0001");
}

/* A scan is authoritative for the current representative, but it must never
   erase a source a previous import had already recorded. */
export function mergeImportOrigins(existing, scanned) {
  if (!existing) return scanned || null;
  if (!scanned) return existing;

  const sources = new Map();
  [...(existing.sources || []), ...(scanned.sources || [])].forEach((source) => {
    if (source && typeof source === "object") sources.set(sourceKey(source), source);
  });

  const variants = new Map();
  [...(existing.variantNames || []), ...(scanned.variantNames || [])].forEach((variant) => {
    const name = String(variant?.name || "");
    if (!name) return;
    variants.set(name, {
      name,
      occurrences: Math.max(
        Number(variants.get(name)?.occurrences) || 0,
        Number(variant.occurrences) || 1,
      ),
    });
  });

  return {
    ...existing,
    ...scanned,
    occurrences: Math.max(Number(existing.occurrences) || 1, Number(scanned.occurrences) || 1),
    variants: Math.max(Number(existing.variants) || 1, Number(scanned.variants) || 1),
    variantNames: [...variants.values()].slice(0, 8),
    sources: [...sources.values()].sort((a, b) => sourceKey(a).localeCompare(sourceKey(b))),
  };
}

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
    origin: mergeImportOrigins(existing.origin, record.origin),
  });

  if (buildExportCSS(candidate) === buildExportCSS(existing)) return existing;

  candidate.updatedAt = Date.now();
  candidate.codeSynced = false;
  return candidate;
}
