/*
 * Favourites.
 *
 * Kept in localStorage on purpose, not on the animation record:
 *
 *   - the library itself lives in sessionStorage and is rebuilt from
 *     animations/*.css on every visit, so a star stored there would be gone
 *     after a reload,
 *   - and a star written into the animation file would travel to the whole
 *     team through git, turning one person's shortlist into everybody's.
 *
 * Ids are safe to key on because each animation file carries its own id in
 * its metadata block, so an animation keeps the same id across reloads,
 * machines and syncs.
 */

const FAVOURITES_KEY = "motion-shelf.favourites.v1";

const favourites = load();

function load() {
  try {
    const raw = localStorage.getItem(FAVOURITES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];

    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((id) => typeof id === "string" && id)
        : [],
    );
  } catch (error) {
    console.error("Could not load favourites:", error);

    return new Set();
  }
}

function save() {
  try {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify([...favourites]));
  } catch (error) {
    console.error("Could not save favourites:", error);
  }
}

export function isFavourite(id) {
  return favourites.has(String(id || ""));
}

/* Returns the new state, so the caller can word its own toast. */
export function toggleFavourite(id) {
  const key = String(id || "");

  if (!key) return false;

  if (favourites.has(key)) {
    favourites.delete(key);
  } else {
    favourites.add(key);
  }

  save();

  return favourites.has(key);
}

export function favouriteCount() {
  return favourites.size;
}
