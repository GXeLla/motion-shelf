/*
 * Where an animation came from.
 *
 * A synced animation carries an `origin.sources` list, and each source names
 * the archive it was read out of (`repository`) and the top folder inside
 * that archive (`folder`) -- which, in both archives, is the brand or
 * campaign: Aldi, BMW, and so on. An animation without an origin was written
 * here by hand.
 *
 * Nothing in this module reads a path: `campaigns/Aldi/banner/style.css` is
 * all the provenance a shared animation file ever carries, and that is
 * deliberate.
 */

export const ARCHIVES = [
  { value: "campaigns", label: "Campaigns", icon: "fa-solid fa-bullhorn" },
  { value: "previews-only", label: "Previews only", icon: "fa-solid fa-clock-rotate-left" },
];

/* The archive folder has been spelled both ways over the years. */
export function normalizeArchive(repository) {
  const name = String(repository || "").trim().toLowerCase();

  if (!name) return "";
  if (name === "previous-only" || name === "previews-only") return "previews-only";
  if (name === "campaigns") return "campaigns";

  return name;
}

export function archiveLabel(archive) {
  const known = ARCHIVES.find((entry) => entry.value === normalizeArchive(archive));

  return known ? known.label : String(archive || "");
}

function sourcesOf(animation) {
  const sources = animation?.origin?.sources;

  return Array.isArray(sources) ? sources : [];
}

/* Every archive this animation was found in -- usually one, occasionally
   both, when the same technique survived into a later campaign. */
export function animationArchives(animation) {
  const archives = new Set();

  sourcesOf(animation).forEach((source) => {
    const archive = normalizeArchive(source.repository);

    if (archive) archives.add(archive);
  });

  return archives;
}

/* The brand/campaign folders this animation was found in, optionally limited
   to one archive. */
export function animationFolders(animation, archive = "") {
  const wanted = normalizeArchive(archive);
  const folders = new Set();

  sourcesOf(animation).forEach((source) => {
    const folder = String(source.folder || "").trim();

    if (!folder) return;
    if (wanted && normalizeArchive(source.repository) !== wanted) return;

    folders.add(folder);
  });

  return folders;
}

/* Every folder name in the library for one archive, with how many animations
   came out of each -- what the brand dropdown is built from. */
export function collectFolders(animations, archive) {
  const counts = new Map();

  animations.forEach((animation) => {
    animationFolders(animation, archive).forEach((folder) => {
      counts.set(folder, (counts.get(folder) || 0) + 1);
    });
  });

  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" }))
    .map(([folder, count]) => ({ folder, count }));
}

/*
 * What the card badge says. One line, because a card has room for one line:
 * the archive, and the brand when the animation came from a single one.
 */
export function describeOrigin(animation) {
  if (!animation?.origin) {
    return {
      kind: "custom",
      label: "Custom",
      icon: "fa-solid fa-pen-ruler",
      tooltip: "Written here in Motion Shelf, not imported from an archive.",
    };
  }

  const archives = [...animationArchives(animation)];
  const archive = archives[0] || "";
  const folders = [...animationFolders(animation, archive)];

  const label = archives.length > 1
    ? "Archives"
    : archiveLabel(archive) || "Imported";

  const brand = folders.length === 1 ? folders[0] : "";

  const files = sourcesOf(animation)
    .map((source) => source.file)
    .filter(Boolean)
    .slice(0, 4);

  const occurrences = Number(animation.origin.occurrences) || 1;

  return {
    kind: archive || "imported",
    label,
    brand,
    icon: archive === "previews-only"
      ? "fa-solid fa-clock-rotate-left"
      : "fa-solid fa-bullhorn",
    tooltip: [
      `Found in ${occurrences} ${occurrences === 1 ? "place" : "places"}`
        + (folders.length ? ` across ${folders.length} ${folders.length === 1 ? "folder" : "folders"}` : "")
        + ".",
      ...files,
    ].join("\n"),
  };
}
