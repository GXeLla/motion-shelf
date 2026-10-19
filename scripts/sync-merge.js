import { buildExportCSS } from "./animations.js";
import { normalizeAnimation } from "./storage.js";

export function planNewImports(current, scanned, { familyKey = animation => animation.origin?.familyFingerprint, isDeleted = () => false } = {}) {
  const ids = new Set(current.map(animation => animation.id));
  const families = new Set(current.flatMap(animation => animation.origin
    ? [animation.origin.familyFingerprint, familyKey(animation)].filter(Boolean) : []));
  const additions = [];
  let existing = 0;
  for (const animation of scanned) {
    const key = animation.origin?.familyFingerprint;
    if (isDeleted(animation.id)) continue;
    if (ids.has(animation.id) || (key && families.has(key))) {
      existing++;
      continue;
    }
    if (animation.audit?.status === "broken / quarantined") continue;
    ids.add(animation.id);
    if (key) families.add(key);
    additions.push(mergeScannedAnimation(animation));
  }
  const newAnimations = uniqueImportedClasses(additions, current);
  return { candidates: [...current, ...newAnimations], newAnimations, added: newAnimations.length, unchanged: existing };
}

// Allocate across the complete batch, including already-suffixed manual names.
export function uniqueImportedClasses(imported, manual) {
  const reserved = new Set(manual.map(animation => animation.className));
  return imported.map(animation => {
    let name = animation.className;
    if (reserved.has(name)) {
      const base = `${name}-imported`;
      name = base;
      let suffix = 2;
      while (reserved.has(name)) name = `${base}-${suffix++}`;
    }
    reserved.add(name);
    return name === animation.className ? animation : {
      ...animation, className: name, codeSynced: false, updatedAt: Date.now(),
    };
  });
}

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

  const auditChanged = JSON.stringify(candidate.audit || null) !== JSON.stringify(existing.audit || null);
  if (buildExportCSS(candidate) === buildExportCSS(existing) && !auditChanged) return existing;

  candidate.updatedAt = Date.now();
  candidate.codeSynced = false;
  return candidate;
}
