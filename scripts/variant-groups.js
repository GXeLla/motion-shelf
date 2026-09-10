/* Numbered imported names are display variants, not proof of duplicate code.
   Keep the full library intact; choose one representative for the All view. */
export function featuredVariants(animations, isFavourite = () => false) {
  const groups = new Map();
  const keyFor = (animation) => animation.origin
    ? String(animation.name || "").trim().replace(/\s+\d+$/, "").toLowerCase()
    : null;
  const uses = (animation) => Number(animation.origin?.occurrences) || 1;
  const tieKey = (animation) => String(animation.origin?.familyFingerprint || animation.id);

  for (const animation of animations) {
    const key = keyFor(animation);
    if (!key) continue;
    const current = groups.get(key);
    if (!current || uses(animation) > uses(current)
      || (uses(animation) === uses(current) && tieKey(animation) < tieKey(current))) {
      groups.set(key, animation);
    }
  }

  return animations.filter((animation) => {
    const key = keyFor(animation);
    return !key || isFavourite(animation.id) || groups.get(key) === animation;
  });
}
