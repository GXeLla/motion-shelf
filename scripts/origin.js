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
  { value: "campaigns", label: "Campaigns", icon: "fa-solid fa-building" },
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

export function sourceCampaign(source) {
  if (source?.campaign) return String(source.campaign).trim();
  const parts = String(source?.file || "").replace(/\\/g, "/").split("/").filter(Boolean);
  const index = parts.indexOf(String(source?.folder || ""));
  return index >= 0 && index + 2 < parts.length ? parts[index + 1] : "";
}

export function sourceBrand(source) {
  if (source?.brand) return String(source.brand).trim();
  const folder = String(source?.folder || "").trim();
  if (!/^\d+(?:[_-]\d+)*$/.test(folder)) return folder;
  return sourceCampaign(source).split(/[_-]+/).find((entry) => entry && !/^\d+$/.test(entry)) || folder;
}

export function animationBrands(animation) {
  return new Set(sourcesOf(animation).map(sourceBrand).filter(Boolean));
}

export function animationCampaigns(animation, brand = "") {
  const campaigns = new Set();
  sourcesOf(animation).forEach((source) => {
    if (brand && sourceBrand(source) !== brand) return;
    const campaign = sourceCampaign(source);
    if (campaign) campaigns.add(campaign);
  });
  return campaigns;
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
    const folder = sourceBrand(source);

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

export function collectCampaigns(animations, brand = "") {
  const counts = new Map();
  animations.forEach((animation) => {
    animationCampaigns(animation, brand).forEach((campaign) => {
      counts.set(campaign, (counts.get(campaign) || 0) + 1);
    });
  });
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: "base" }))
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
  const folders = [...animationBrands(animation)];
  const campaigns = [...animationCampaigns(animation)];

  const brand = folders.length === 1 ? folders[0] : "";

  const files = sourcesOf(animation)
    .map((source) => source.file)
    .filter(Boolean)
    .slice(0, 4);

  const occurrences = Number(animation.origin.occurrences) || 1;

  return {
    kind: archive || "imported",
    label: archive === "previews-only"
      ? "Previous only"
      : archive === "campaigns" && brand ? brand : archiveLabel(archive) || "Imported",
    icon: archive === "previews-only"
      ? "fa-solid fa-clock-rotate-left"
      : "fa-solid fa-bullhorn",
    tooltip: [
      `Found in ${occurrences} ${occurrences === 1 ? "place" : "places"}.`,
      ...folders.map((entry) => `Brand: ${entry}`),
      ...(campaigns.length > 1 ? [`Campaigns: ${campaigns.length}`] : campaigns.map((entry) => `Campaign: ${entry}`)),
      ...files,
    ].join("\n"),
  };
}
