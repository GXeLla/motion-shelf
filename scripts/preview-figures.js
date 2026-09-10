/*
 * Stick figure previews.
 *
 * An imported animation carries no artwork of its own -- nothing is taken
 * from the campaign archives -- so the preview is drawn here instead. A
 * little character reads motion far better than an abstract shape: rotation,
 * scale and travel are all obvious on a body.
 *
 * Each animation gets a figure and a colour derived from its own id, so the
 * library looks varied while any one card stays the same between renders.
 * Everything is inline SVG with CSS animated limbs, which keeps it offline,
 * scalable, and animating inside an <img>.
 */

const PALETTE = [
  "#63e6be", "#54a9ea", "#ffd43b", "#ff8787", "#da77f2",
  "#4dd4ac", "#ffa94d", "#9775fa", "#74c0fc", "#f783ac",
  "#a9e34b", "#38d9a9",
];

/* Where each limb pivots, in the drawing's own coordinates. */
const SHOULDER = "160px 96px";
const HIP = "160px 146px";

function seedFrom(value) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash >>> 0;
}

/* ==================================================
ACTIVITIES

Each one supplies the props it needs, the CSS that moves it, and whether the
legs are standing or folded.
================================================== */

const ACTIVITIES = [
  {
    name: "walking",
    css: `
      .leg-a { animation: swing-back 0.9s ease-in-out infinite alternate; }
      .leg-b { animation: swing-fore 0.9s ease-in-out infinite alternate; }
      .arm-a { animation: swing-fore 0.9s ease-in-out infinite alternate; }
      .arm-b { animation: swing-back 0.9s ease-in-out infinite alternate; }
      .figure { animation: bob 0.45s ease-in-out infinite alternate; }`,
  },
  {
    name: "running",
    css: `
      .figure { transform: rotate(7deg); transform-origin: 160px 190px;
        animation: bob 0.28s ease-in-out infinite alternate; }
      .leg-a { animation: stride-back 0.5s ease-in-out infinite alternate; }
      .leg-b { animation: stride-fore 0.5s ease-in-out infinite alternate; }
      .arm-a { animation: stride-fore 0.5s ease-in-out infinite alternate; }
      .arm-b { animation: stride-back 0.5s ease-in-out infinite alternate; }`,
  },
  {
    name: "sitting",
    legs: "seated",
    props: (color) => `<rect x="196" y="150" width="46" height="9" rx="4" fill="${color}" opacity=".45" />
      <rect x="232" y="150" width="9" height="56" rx="4" fill="${color}" opacity=".45" />`,
    css: `
      .figure { animation: breathe 3.2s ease-in-out infinite alternate; }
      .arm-b { animation: rest 3.2s ease-in-out infinite alternate; }`,
  },
  {
    name: "smoking",
    props: (color) => `<g class="smoke">
        <circle cx="192" cy="58" r="5" fill="${color}" opacity=".5" class="puff puff-1" />
        <circle cx="199" cy="48" r="4" fill="${color}" opacity=".4" class="puff puff-2" />
        <circle cx="194" cy="38" r="3" fill="${color}" opacity=".3" class="puff puff-3" />
      </g>
      <line x1="182" y1="72" x2="192" y2="70" stroke="#f4f7f7" stroke-width="4" stroke-linecap="round" />`,
    css: `
      .arm-b { transform: rotate(-118deg); transform-origin: ${SHOULDER};
        animation: draw 3.6s ease-in-out infinite; }
      .figure { animation: breathe 3.6s ease-in-out infinite alternate; }
      .puff { animation: rise 3.2s ease-out infinite; }
      .puff-2 { animation-delay: .5s; }
      .puff-3 { animation-delay: 1s; }`,
  },
  {
    name: "waving",
    css: `
      .arm-b { transform: rotate(-135deg); transform-origin: ${SHOULDER};
        animation: wave 0.7s ease-in-out infinite alternate; }
      .figure { animation: breathe 2.6s ease-in-out infinite alternate; }`,
  },
  {
    name: "jumping",
    css: `
      .figure { animation: hop 1s cubic-bezier(.3, .7, .4, 1) infinite; }
      .arm-a { transform: rotate(95deg); transform-origin: ${SHOULDER}; }
      .arm-b { transform: rotate(-95deg); transform-origin: ${SHOULDER}; }
      .leg-a { animation: tuck 1s ease-in-out infinite; }
      .leg-b { animation: tuck 1s ease-in-out infinite; }
      .shadow { animation: shadow-pulse 1s ease-in-out infinite; }`,
  },
  {
    name: "dancing",
    css: `
      .figure { animation: sway 0.8s ease-in-out infinite alternate; }
      .arm-a { animation: raise-a 0.8s ease-in-out infinite alternate; }
      .arm-b { animation: raise-b 0.8s ease-in-out infinite alternate; }
      .leg-a { animation: swing-fore 0.8s ease-in-out infinite alternate; }`,
  },
  {
    name: "reading",
    css: `
      .head { animation: nod 2.6s ease-in-out infinite alternate; }
      .figure { animation: breathe 3.4s ease-in-out infinite alternate; }`,
    props: (color) => `<g class="book">
        <path d="M130 124 L160 132 L190 124 L190 152 L160 160 L130 152 Z" fill="${color}" opacity=".55" />
        <line x1="160" y1="132" x2="160" y2="158" stroke="#f4f7f7" stroke-width="2.5" opacity=".7" />
      </g>`,
  },
  {
    name: "drinking coffee",
    props: (color) => `<g class="cup">
        <rect x="176" y="40" width="18" height="16" rx="3" fill="${color}" opacity=".7" />
        <path d="M194 44 q7 4 0 8" fill="none" stroke="${color}" stroke-width="3" opacity=".7" />
      </g>
      <circle cx="185" cy="30" r="3" fill="${color}" opacity=".35" class="puff puff-1" />`,
    css: `
      .arm-b { transform: rotate(-112deg); transform-origin: ${SHOULDER};
        animation: sip 4s ease-in-out infinite; }
      .cup { animation: sip-cup 4s ease-in-out infinite; }
      .puff { animation: rise 3s ease-out infinite; }
      .figure { animation: breathe 3.4s ease-in-out infinite alternate; }`,
  },
  {
    name: "thinking",
    props: (color) => `<text x="206" y="58" font-family="Arial, sans-serif" font-size="30"
        font-weight="700" fill="${color}" opacity=".6" class="think">?</text>`,
    css: `
      .arm-b { transform: rotate(-98deg); transform-origin: ${SHOULDER}; }
      .leg-b { animation: tap 0.7s ease-in-out infinite alternate; }
      .think { animation: ponder 2.4s ease-in-out infinite alternate; }
      .figure { animation: breathe 3.6s ease-in-out infinite alternate; }`,
  },
  {
    name: "stretching",
    css: `
      .arm-a { transform: rotate(85deg); transform-origin: ${SHOULDER}; }
      .arm-b { transform: rotate(-85deg); transform-origin: ${SHOULDER}; }
      .figure { animation: lean 2.4s ease-in-out infinite alternate; }`,
  },
  {
    name: "skateboarding",
    props: (color) => `<g class="board">
        <rect x="118" y="204" width="86" height="8" rx="4" fill="${color}" opacity=".7" />
        <circle cx="134" cy="216" r="5" fill="${color}" opacity=".5" />
        <circle cx="188" cy="216" r="5" fill="${color}" opacity=".5" />
      </g>`,
    css: `
      .figure { transform: rotate(-8deg); transform-origin: 160px 200px;
        animation: carve 1.6s ease-in-out infinite alternate; }
      .arm-a { transform: rotate(48deg); transform-origin: ${SHOULDER}; }
      .arm-b { transform: rotate(-42deg); transform-origin: ${SHOULDER}; }
      .board { animation: roll 1.6s ease-in-out infinite alternate; }`,
  },
];

/* Shared movement vocabulary, so the activities stay short. */
const KEYFRAMES = `
  @keyframes swing-fore { from { transform: rotate(-22deg); } to { transform: rotate(22deg); } }
  @keyframes swing-back { from { transform: rotate(22deg); } to { transform: rotate(-22deg); } }
  @keyframes stride-fore { from { transform: rotate(-38deg); } to { transform: rotate(34deg); } }
  @keyframes stride-back { from { transform: rotate(34deg); } to { transform: rotate(-38deg); } }
  @keyframes bob { from { transform: translateY(0); } to { transform: translateY(-4px); } }
  @keyframes breathe { from { transform: translateY(0) scale(1); } to { transform: translateY(-2px) scale(1.015); } }
  @keyframes wave { from { transform: rotate(-135deg); } to { transform: rotate(-172deg); } }
  @keyframes hop {
    0%, 100% { transform: translateY(0); }
    35% { transform: translateY(-42px); }
    55% { transform: translateY(-30px); }
  }
  @keyframes tuck {
    0%, 100% { transform: rotate(0deg); }
    40% { transform: rotate(26deg); }
  }
  @keyframes shadow-pulse {
    0%, 100% { transform: scale(1); opacity: .3; }
    40% { transform: scale(.6); opacity: .14; }
  }
  @keyframes sway { from { transform: rotate(-9deg); } to { transform: rotate(9deg); } }
  @keyframes raise-a { from { transform: rotate(62deg); } to { transform: rotate(104deg); } }
  @keyframes raise-b { from { transform: rotate(-104deg); } to { transform: rotate(-62deg); } }
  @keyframes nod { from { transform: rotate(-6deg); } to { transform: rotate(6deg); } }
  @keyframes rest { from { transform: rotate(8deg); } to { transform: rotate(16deg); } }
  @keyframes lean { from { transform: rotate(-11deg); } to { transform: rotate(11deg); } }
  @keyframes carve { from { transform: rotate(-11deg); } to { transform: rotate(6deg); } }
  @keyframes roll { from { transform: translateX(-7px); } to { transform: translateX(7px); } }
  @keyframes tap { from { transform: rotate(0deg); } to { transform: rotate(-15deg); } }
  @keyframes ponder { from { transform: translateY(0); opacity: .35; } to { transform: translateY(-6px); opacity: .75; } }
  @keyframes draw {
    0%, 100% { transform: rotate(-118deg); }
    45%, 60% { transform: rotate(-142deg); }
  }
  @keyframes sip {
    0%, 100% { transform: rotate(-112deg); }
    40%, 55% { transform: rotate(-136deg); }
  }
  @keyframes sip-cup {
    0%, 100% { transform: translate(0, 0); }
    40%, 55% { transform: translate(-9px, 9px); }
  }
  @keyframes rise {
    0% { transform: translateY(0) scale(.6); opacity: .5; }
    100% { transform: translateY(-30px) scale(1.5); opacity: 0; }
  }`;

function skeleton(color, legs) {
  const limb = (className, x2, y2, origin) =>
    `<g class="${className}" style="transform-origin: ${origin};">`
    + `<line x1="160" y1="${origin === SHOULDER ? 96 : 146}" x2="${x2}" y2="${y2}" `
    + `stroke="${color}" stroke-width="7" stroke-linecap="round" /></g>`;

  const seated = legs === "seated";

  const legMarkup = seated
    ? `<g class="leg-a"><polyline points="160,146 196,152 198,196" fill="none" stroke="${color}"
         stroke-width="7" stroke-linecap="round" stroke-linejoin="round" /></g>
       <g class="leg-b"><polyline points="160,146 190,158 192,198" fill="none" stroke="${color}"
         stroke-width="7" stroke-linecap="round" stroke-linejoin="round" /></g>`
    : limb("leg-a", 138, 200, HIP) + limb("leg-b", 182, 200, HIP);

  return `
    <ellipse class="shadow" cx="160" cy="214" rx="34" ry="6" fill="${color}" opacity=".3" />
    <g class="figure">
      <circle class="head" cx="160" cy="62" r="20" fill="${color}"
        style="transform-origin: 160px 82px;" />
      <line x1="160" y1="82" x2="160" y2="146" stroke="${color}" stroke-width="8" stroke-linecap="round" />
      ${limb("arm-a", 128, 134, SHOULDER)}
      ${limb("arm-b", 192, 134, SHOULDER)}
      ${legMarkup}
    </g>`;
}

/*
 * Picks a figure from the animation's own identity, so the grid looks varied
 * but a card never changes character between renders.
 */
export function pickFigure(key) {
  const seed = seedFrom(String(key || "motion-shelf"));

  return {
    activity: ACTIVITIES[seed % ACTIVITIES.length],
    color: PALETTE[(seed >> 5) % PALETTE.length],
  };
}

export function createFigurePreview(animation = {}) {
  const key = animation.id || animation.className || animation.name || "motion-shelf";
  const { activity, color } = pickFigure(key);

  const label = String(animation.name || "")
    .slice(0, 34)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" width="320" height="240">
    <style>
      .figure, .arm-a, .arm-b, .leg-a, .leg-b, .head, .shadow { transform-box: view-box; }
      .arm-a, .arm-b { transform-origin: ${SHOULDER}; }
      .leg-a, .leg-b { transform-origin: ${HIP}; }
      .figure { transform-origin: 160px 150px; }
      .shadow { transform-origin: 160px 214px; }

      /* Props pivot about themselves, not about the middle of the drawing. */
      .board, .cup, .book, .think, .puff {
        transform-box: fill-box;
        transform-origin: center;
      }
      ${KEYFRAMES}
      ${activity.css}
      @media (prefers-reduced-motion: reduce) {
        * { animation: none !important; }
      }
    </style>
    <rect width="320" height="240" rx="16" fill="#111717" />
    ${activity.props ? activity.props(color) : ""}
    ${skeleton(color, activity.legs)}
    <text x="160" y="234" text-anchor="middle" font-family="Arial, sans-serif"
      font-size="11" fill="#7c8c8c">${label || activity.name}</text>
  </svg>`;

  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg.replace(/\s+/g, " "));
}

export const FIGURE_ACTIVITIES = ACTIVITIES.map((activity) => activity.name);
