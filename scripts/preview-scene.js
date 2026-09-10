/*
 * Generated previews.
 *
 * An animation carries no artwork of its own -- nothing is taken from the
 * campaign archives -- so both halves of a preview are drawn here:
 *
 *   1. the backdrop: a landscape that fills the whole frame and never moves,
 *   2. the subject:  a small framed plate that the animation actually moves.
 *
 * Splitting them is what keeps a preview inside its frame. The animated
 * element is free to fly in, shrink or turn as far as its keyframes say, and
 * the frame still shows scenery behind it instead of an empty hole.
 *
 * Both are derived from the animation's own id, so the library looks varied
 * while any one card keeps the same sky between renders. Everything is inline
 * SVG, so there are no image files and nothing to fetch.
 */

/* The backdrop is drawn at exactly the shape of .card-preview (16:9), so
   object-fit: cover has nothing to crop. */
const VIEW = { width: 480, height: 270 };
const HORIZON = 190;
const FLOOR = VIEW.height;

/* The subject is a little wider than tall, and sits centred in the frame. */
const PLATE = { width: 320, height: 200, pad: 10, radius: 14 };

const SCENES = [
  {
    name: "night",
    sky: ["#101a2c", "#243248"],
    ridgeFar: "#2a3852",
    ridgeNear: "#1b2436",
    ground: ["#243330", "#161f1d"],
    glow: "rgba(130, 175, 255, .16)",
    grass: "#7fae95",
    stars: 16,
    body: { kind: "moon", fill: "#e8eeff", r: 19, high: true },
  },
  {
    name: "dusk",
    sky: ["#2b1d33", "#5a3230"],
    ridgeFar: "#4a2f33",
    ridgeNear: "#2c1e21",
    ground: ["#33261d", "#1d1613"],
    glow: "rgba(255, 155, 95, .22)",
    grass: "#b98f63",
    stars: 7,
    body: { kind: "sun", fill: "#ff9f5a", r: 24, high: false },
  },
  {
    name: "dawn",
    sky: ["#1b2836", "#4b3a44"],
    ridgeFar: "#3b3140",
    ridgeNear: "#22262e",
    ground: ["#28352e", "#171f1c"],
    glow: "rgba(255, 195, 165, .2)",
    grass: "#9db78d",
    stars: 9,
    body: { kind: "sun", fill: "#ffc9a3", r: 21, high: false },
  },
  {
    name: "overcast",
    sky: ["#1a2624", "#2c3a36"],
    ridgeFar: "#2f403b",
    ridgeNear: "#1e2a27",
    ground: ["#233230", "#16201e"],
    glow: "rgba(160, 220, 200, .14)",
    grass: "#7ea896",
    stars: 0,
    body: { kind: "sun", fill: "#c3d6cb", r: 21, high: true },
  },
];

function seedFrom(value) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash >>> 0;
}

/* Which scene an animation gets. Unsigned shifts throughout: ">>" would
   coerce a hash above 2^31 to a negative int32 and index past the array. */
export function pickScene(key) {
  const seed = seedFrom(String(key || "motion-shelf"));
  const scene = SCENES[(seed >>> 7) % SCENES.length] || SCENES[0];

  return { scene, seed };
}

/* A seeded generator, so a card's sky never changes between renders. */
function randomFrom(seed) {
  let state = ((seed >>> 0) % 2147483646) + 1;

  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

function skyGradient(id, scene) {
  return '<linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="' + scene.sky[0] + '" />'
    + '<stop offset="1" stop-color="' + scene.sky[1] + '" />'
    + "</linearGradient>";
}

function groundGradient(id, scene) {
  return '<linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="' + scene.ground[0] + '" />'
    + '<stop offset="1" stop-color="' + scene.ground[1] + '" />'
    + "</linearGradient>";
}

function celestial(scene, x, y, scale) {
  const body = scene.body;
  const r = body.r * scale;

  const halo = '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="'
    + (r * 2.6).toFixed(1) + '" fill="' + body.fill + '" opacity=".09" />';

  if (body.kind !== "moon") {
    return halo + '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="'
      + r.toFixed(1) + '" fill="' + body.fill + '" opacity=".6" />';
  }

  return halo
    + '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + r.toFixed(1)
    + '" fill="' + body.fill + '" opacity=".66" />'
    + '<circle cx="' + (x - r * 0.32).toFixed(1) + '" cy="' + (y - r * 0.26).toFixed(1)
    + '" r="' + (r * 0.24).toFixed(1) + '" fill="#93a4c4" opacity=".3" />'
    + '<circle cx="' + (x + r * 0.26).toFixed(1) + '" cy="' + (y + r * 0.21).toFixed(1)
    + '" r="' + (r * 0.16).toFixed(1) + '" fill="#93a4c4" opacity=".26" />'
    + '<circle cx="' + (x + r * 0.05).toFixed(1) + '" cy="' + (y - r * 0.47).toFixed(1)
    + '" r="' + (r * 0.11).toFixed(1) + '" fill="#93a4c4" opacity=".22" />';
}

/*
 * THE BACKDROP
 *
 * Every shape spans the full viewBox, so no matter which scene is picked the
 * frame is completely covered -- there is no edge for the card colour to show
 * through.
 */
export function buildScene(key) {
  const { scene, seed } = pickScene(key);
  const random = randomFrom(seed);
  const pieces = [];

  pieces.push(
    '<rect x="0" y="0" width="' + VIEW.width + '" height="' + VIEW.height + '" fill="url(#sky)" />',
    '<ellipse cx="240" cy="' + HORIZON + '" rx="330" ry="140" fill="' + scene.glow + '" />',
  );

  for (let index = 0; index < scene.stars; index += 1) {
    pieces.push('<circle cx="' + (random() * VIEW.width).toFixed(1)
      + '" cy="' + (random() * 150).toFixed(1)
      + '" r="' + (0.9 + random() * 1.3).toFixed(2)
      + '" fill="#dfe9ff" opacity="' + (0.25 + random() * 0.5).toFixed(2) + '" />');
  }

  /* The sun or moon moves around between cards rather than sitting in the
     same corner every time. */
  const bodyX = 60 + random() * 340;
  const bodyY = scene.body.high ? 40 + random() * 40 : 110 + random() * 40;

  pieces.push(celestial(scene, bodyX, bodyY, 1));

  /* Two cloud banks, drifting slowly enough to read as atmosphere rather
     than as something competing with the animation. */
  for (let index = 0; index < 2; index += 1) {
    const y = 30 + random() * 80;
    const scale = 0.8 + random() * 0.7;

    pieces.push('<g class="cloud" opacity="' + (0.06 + random() * 0.07).toFixed(3)
      + '" style="--drift-delay: -' + (index * 17).toFixed(0) + 's">'
      + '<ellipse cx="' + (90 + index * 190).toFixed(0) + '" cy="' + y.toFixed(0)
      + '" rx="' + (54 * scale).toFixed(0) + '" ry="' + (11 * scale).toFixed(0) + '" fill="#cfe3dd" />'
      + '<ellipse cx="' + (130 + index * 190).toFixed(0) + '" cy="' + (y - 6).toFixed(0)
      + '" rx="' + (35 * scale).toFixed(0) + '" ry="' + (9 * scale).toFixed(0) + '" fill="#cfe3dd" />'
      + "</g>");
  }

  /* Two ridges give the horizon some depth; their shape varies per card. The
     path starts left of 0 and ends right of the viewBox so a wandering curve
     can never pull the silhouette away from a side edge. */
  const ridge = (base, lift, fill, opacity) => {
    const a = (lift * (0.6 + random() * 0.8)).toFixed(0);
    const b = (lift * (0.4 + random() * 0.9)).toFixed(0);
    const c = (lift * (0.5 + random() * 0.9)).toFixed(0);

    return '<path d="M-20 ' + base + ' q 100 -' + a + ' 190 -6 q 75 ' + b
      + ' 150 -14 q 95 -' + c + ' 180 12 L500 ' + FLOOR + ' L-20 ' + FLOOR + ' Z"'
      + ' fill="' + fill + '" opacity="' + opacity + '" />';
  };

  pieces.push(
    ridge(HORIZON - 18, 42, scene.ridgeFar, ".95"),
    ridge(HORIZON - 5, 30, scene.ridgeNear, ".95"),
    '<rect x="0" y="' + HORIZON + '" width="' + VIEW.width
    + '" height="' + (FLOOR - HORIZON) + '" fill="url(#ground)" />',
    '<line x1="0" y1="' + HORIZON + '" x2="' + VIEW.width
    + '" y2="' + HORIZON + '" stroke="#ffffff" stroke-width="1" opacity=".08" />',
  );

  /* Grass along the horizon, and a few larger blades near the bottom edge so
     the lower band reads as ground rather than as a dark bar. */
  for (let index = 0; index < 26; index += 1) {
    const near = index % 3 === 0;
    const x = (random() * VIEW.width).toFixed(1);
    const base = near ? FLOOR - 2 - random() * 16 : HORIZON + 3 + random() * 10;
    const height = near ? 10 + random() * 14 : 4 + random() * 9;
    const lean = (random() - 0.5) * 6;

    pieces.push('<path d="M' + x + " " + base.toFixed(1) + " q " + lean.toFixed(1)
      + " -" + (height / 2).toFixed(1) + " " + (lean * 1.6).toFixed(1) + " -" + height.toFixed(1) + '"'
      + ' stroke="' + scene.grass + '" stroke-width="' + (near ? 1.8 : 1.3)
      + '" fill="none" stroke-linecap="round" opacity="'
      + (near ? 0.22 + random() * 0.2 : 0.16 + random() * 0.22).toFixed(2) + '" />');
  }

  return {
    name: scene.name,
    defs: skyGradient("sky", scene) + groundGradient("ground", scene),
    markup: pieces.join(""),
  };
}

function wrapSvg(view, defs, markup) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + view.width + " "
    + view.height + '" width="' + view.width + '" height="' + view.height + '">'
    + "<style>"
    + ".cloud { transform-box: fill-box; transform-origin: center;"
    + " animation: drift 52s linear infinite alternate var(--drift-delay, 0s); }"
    + " @keyframes drift { from { transform: translateX(-70px); } to { transform: translateX(70px); } }"
    + " @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }"
    + "</style>"
    + "<defs>" + defs + "</defs>"
    + markup
    + "</svg>";

  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg.replace(/\s+/g, " "));
}

/*
 * POOLED IMAGES
 *
 * A backdrop is about 9KB of data URI and 47 shapes; a plate about 5KB and 26.
 * Drawing a unique one per animation is fine for seven of them and ruinous for
 * a thousand: megabytes of string in the DOM and a separate image for the
 * browser to decode per card.
 *
 * So both are drawn from a small pool. The slot still comes from the
 * animation's own id, so a card keeps the same sky forever and the grid stays
 * varied -- but the whole library decodes a few dozen images instead of
 * thousands, and identical cards share one decoded bitmap.
 */
const BACKDROP_POOL = 32;
const PLATE_POOL = 96;

const backdropCache = new Map();
const plateCache = new Map();

/* Which animation owns which slot, so an id always gets the same image back,
   plus the set of slots already handed out so probing stays O(1). */
const backdropSlots = { size: BACKDROP_POOL, byKey: new Map(), used: new Set() };
const plateSlots = { size: PLATE_POOL, byKey: new Map(), used: new Set() };

/*
 * The slot starts from the animation's own id, then probes forward past any
 * slot another animation already holds. So while the library is smaller than
 * the pool every card gets its own image and nothing looks duplicated; once
 * the pool is full, cards start sharing, which is the whole point -- and the
 * probing stops, so a thousand-card library does not pay for it.
 */
function slotFor(animation, pool) {
  const key = String(
    animation.id || animation.className || animation.name || "motion-shelf",
  );

  const known = pool.byKey.get(key);

  if (known !== undefined) {
    return known;
  }

  const start = seedFrom(key) % pool.size;

  let slot = start;

  if (pool.used.size < pool.size) {
    for (let step = 0; step < pool.size; step += 1) {
      slot = (start + step) % pool.size;

      if (!pool.used.has(slot)) break;
    }

    pool.used.add(slot);
  }

  pool.byKey.set(key, slot);

  return slot;
}

/* The still landscape behind the animation. */
export function createSceneBackdrop(animation = {}) {
  const slot = slotFor(animation, backdropSlots);

  if (!backdropCache.has(slot)) {
    const scene = buildScene("backdrop-" + slot);

    backdropCache.set(slot, wrapSvg(VIEW, scene.defs, scene.markup));
  }

  return backdropCache.get(slot);
}

/*
 * THE SUBJECT
 *
 * A framed plate -- what these animations are written against, an <img> in a
 * layout. It borrows the card's own palette so it belongs to the scene behind
 * it, but its rim and shadow keep it readable as a separate object however
 * far the animation moves it.
 */
export function createScenePreview(animation = {}) {
  const slot = slotFor(animation, plateSlots);

  if (plateCache.has(slot)) {
    return plateCache.get(slot);
  }

  const key = "plate-" + slot;
  const { scene, seed } = pickScene(key);
  const random = randomFrom((seed ^ 0x9e3779b9) >>> 0);

  const x = PLATE.pad;
  const y = PLATE.pad;
  const width = PLATE.width - PLATE.pad * 2;
  const height = PLATE.height - PLATE.pad * 2;
  const horizon = y + height * 0.68;

  const defs = skyGradient("plateSky", scene)
    + groundGradient("plateGround", scene)
    + '<clipPath id="plateClip"><rect x="' + x + '" y="' + y + '" width="' + width
    + '" height="' + height + '" rx="' + PLATE.radius + '" /></clipPath>'
    + '<filter id="plateShadow" x="-25%" y="-25%" width="150%" height="150%">'
    + '<feDropShadow dx="0" dy="5" stdDeviation="7" flood-color="#000000" flood-opacity=".45" />'
    + "</filter>";

  const inner = [];

  inner.push('<rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height
    + '" fill="url(#plateSky)" />');

  for (let index = 0; index < Math.min(scene.stars, 8); index += 1) {
    inner.push('<circle cx="' + (x + random() * width).toFixed(1)
      + '" cy="' + (y + random() * height * 0.5).toFixed(1)
      + '" r="' + (0.8 + random()).toFixed(2)
      + '" fill="#dfe9ff" opacity="' + (0.3 + random() * 0.45).toFixed(2) + '" />');
  }

  inner.push(
    '<ellipse cx="' + (x + width / 2) + '" cy="' + horizon.toFixed(1) + '" rx="' + width
    + '" ry="' + (height * 0.5).toFixed(1) + '" fill="' + scene.glow + '" />',
    celestial(
      scene,
      x + width * (0.24 + random() * 0.5),
      y + height * (scene.body.high ? 0.2 : 0.4),
      0.42,
    ),
    '<path d="M' + (x - 10) + " " + (horizon - 14).toFixed(1)
    + ' q 70 -22 130 -4 q 60 16 120 -10 L' + (x + width + 10) + " " + (y + height)
    + " L" + (x - 10) + " " + (y + height) + ' Z" fill="' + scene.ridgeNear + '" opacity=".95" />',
    '<rect x="' + x + '" y="' + horizon.toFixed(1) + '" width="' + width + '" height="'
    + (y + height - horizon).toFixed(1) + '" fill="url(#plateGround)" />',
  );

  for (let index = 0; index < 9; index += 1) {
    const bx = (x + random() * width).toFixed(1);
    const bladeHeight = 5 + random() * 8;
    const lean = (random() - 0.5) * 4;

    inner.push('<path d="M' + bx + " " + (horizon + 2).toFixed(1) + " q " + lean.toFixed(1)
      + " -" + (bladeHeight / 2).toFixed(1) + " " + (lean * 1.6).toFixed(1)
      + " -" + bladeHeight.toFixed(1) + '"'
      + ' stroke="' + scene.grass + '" stroke-width="1.4" fill="none" stroke-linecap="round"'
      + ' opacity="' + (0.2 + random() * 0.24).toFixed(2) + '" />');
  }

  const markup = '<g filter="url(#plateShadow)">'
    + '<g clip-path="url(#plateClip)">' + inner.join("") + "</g>"
    + '<rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height
    + '" rx="' + PLATE.radius + '" fill="none" stroke="rgba(232, 248, 244, .3)" stroke-width="1.5" />'
    + "</g>";

  const image = wrapSvg(PLATE, defs, markup);

  plateCache.set(slot, image);

  return image;
}

export const SCENE_NAMES = SCENES.map((scene) => scene.name);
