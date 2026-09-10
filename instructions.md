# Motion Shelf — developer instructions

Motion Shelf is a browser-based CSS animation library. You create or edit an animation visually, copy its complete CSS, or save it as a real file inside your project’s `animations/` folder.

## Start it correctly

Folder access requires a secure browser context. Open the project through localhost, not by double-clicking `index.html`:

```bash
cd "Junk styles"
python3 -m http.server 4173
```

Then open `http://localhost:4173` in Chrome or Edge.

## Main workflow

1. Click **Link project** in the header and choose the root folder containing `index.html`.
2. Motion Shelf remembers that directory handle and reads every `.css` file in `animations/`.
3. A **LOCAL** badge means the CSS file currently exists in the linked folder. It does not mean the file is committed or pushed to GitHub.
4. Click a card anywhere outside its buttons to copy its complete CSS.
5. Use **View details** to open the full modal, or **Edit** to change the animation.
6. Use **Push to local** or **Update local** to write the CSS file. The same linked folder is reused, so the picker is not opened for every save.

On a later visit, the app reloads the saved folder handle. If the browser needs permission again, the header shows **Reconnect project**; clicking it reauthorizes the same folder. Browsers expose the selected folder name, not its full operating-system path, so the header shows `project-name/animations`.

## Editor model

The editor deliberately separates three kinds of CSS:

- **Global CSS properties** style the animated element: width, border radius, filter, opacity, transform origin, and similar declarations. Do not place `animation-*` declarations here.
- **Animation settings** control duration, delay, iterations and easing. CSS and GSAP-style easing names are converted to a CSS `cubic-bezier(...)` value.
- **Keyframes** contain `from`, `to`, or percentage blocks.
- **Parent properties** apply only to the preview/export parent helper class and are useful for perspective, clipping and 3D transforms.

The editor preview always loops infinitely and restarts after every change. That live loop is only an editing aid; exported iteration behavior comes from **Iterations in exported CSS**.

The dashed safe frame is a preview guide. Content should stay inside it during the important part of the motion. The stage clips extreme overflow so an unsafe animation cannot break cards or the editor. The guide itself is never exported.

## Easing editor

Choose a CSS preset, a GSAP-style preset, or **Custom cubic-bezier**. Drag either handle in the graph or type the four values. X values are limited to `0–1`; Y values allow controlled overshoot for back-style easing. The moving dot and the animated image update immediately.

The short easing menu groups CSS defaults and GSAP-style families. Select Power to reveal strength buttons 1–4, and use the separate In / Out / InOut direction buttons for GSAP-style families and CSS Ease. Ease also offers Default for the plain CSS `ease` curve. Strength and direction are retained when switching families. Linear, steps and custom presets keep their own choices, with direction buttons disabled. Browse easing curves starts collapsed and provides optional curve tiles. The selected family, strength, direction, graph, moving dot and exported CSS follow the same selection.

Existing Bézier presets retain their curves. New GSAP-style curves are sampled into CSS `linear()` functions, including bounce and elastic; these require a browser that supports CSS linear easing functions. No GSAP runtime is required. These are CSS approximations of the core families, not GSAP plugin eases. Non-Bézier presets show a read-only graph; select Custom cubic-bezier to edit handles and coordinates.

## Validation and autocomplete

Saving is blocked when the editor finds a missing name, invalid keyframe name, invalid duration/delay/iterations, malformed declaration, animation properties in the global CSS field, unbalanced keyframes, or an invalid URL. Errors appear both in a summary and beside the affected fields.

In the Global CSS and Parent CSS textareas, start typing a property such as `trans`, `border`, or `persp`. Choose a suggestion with the mouse, arrow keys plus Enter, or Tab.

## Generated CSS format

Every generated file contains:

```css
/* @motion-shelf
{ "id": "...", "name": "...", "duration": 1.2, "easing": "power2.out" }
*/

.ms-animation-name-parent { /* optional parent properties */ }
.ms-animation-name { /* global CSS + structured animation properties */ }
@keyframes msAnimationName { /* motion */ }
```

The metadata comment lets Motion Shelf reconstruct the card after refresh. CSS files without metadata are also shown: the filename and first keyframe rule are used as fallbacks.

## JavaScript files

| File | Responsibility |
| --- | --- |
| `scripts/app.js` | App startup, background initialization, rendering, header folder status, card actions, details, deletion and toast messages. |
| `scripts/background.js` | Creates the tiny randomized spark field once per page load; CSS controls all spark movement and glow. |
| `scripts/filesystem.js` | Stores the project directory handle in IndexedDB, scans `animations/*.css`, parses metadata, merges local files into state and exposes the displayed local path. |
| `scripts/code.js` | Copies CSS to the clipboard, writes/removes CSS files through the already-linked folder handle, and publishes the whole library plus `animations/manifest.json` for **Sync for everyone**. |
| `scripts/editor.js` | Form lifecycle, drafts, categories, live infinite preview, draggable bezier UI, inline errors and CSS autocomplete. |
| `scripts/validation.js` | Validates CSS declarations, animation fields and keyframe syntax; safely applies declarations to the live preview. |
| `scripts/easing.js` | CSS/GSAP easing preset map, cubic-bezier normalization and CSS easing output. |
| `scripts/animations.js` | Animation data creation/update, preview injection, metadata and final CSS export. |
| `scripts/storage.js` | Normalizes animation records and keeps unfinished/session-only animations in `sessionStorage`. |
| `scripts/state.js` | Shared runtime state, selection, filters, drafts and linked-project status. |
| `scripts/cards.js` | Builds cards, safe-frame preview, local badges, tags and card buttons. |
| `scripts/filters.js` | Search, dynamic categories and maximum-two-filter behavior. |
| `scripts/modals.js` | Opens/closes dialogs. Clicking outside does not close the editor. |
| `scripts/utils.js` | Escaping, slugs, dates, IDs and normalization helpers. |
| `scripts/animation-extract.js` | Turns CSS, GSAP and class-toggle JavaScript into normalized keyframe records; handles naming, categories, interaction classification and the behaviour fingerprint used for de-duplication. Pure functions, no DOM. |
| `scripts/campaign-scan.js` | Walks the campaign archives read-only through the File System Access API, filters to source files, batches the work with progress, tolerates broken campaigns, and caches results by size and modification time. |
| `scripts/animation-family.js` | The stage after extraction: target/container detection, behaviour naming, family fingerprints, canonical selection and the CSS custom-property templates. |
| `scripts/sync-ui.js` | The single Sync action: reusing known archives, asking for only a missing one, progress, the results dialog, and merging canonical animations into the library. |
| `scripts/scroll-progress.js` | Drives the glowing top-of-page scroll progress line shared by both pages (`.scroll-progress` / `.scroll-progress-fill` in `styles/styles.css`); updates its width from scroll position via `requestAnimationFrame`. |

## Style files

| File | Responsibility |
| --- | --- |
| `styles/styles.css` | Design tokens, typography and global resets. |
| `styles/enhancements.css` | Layered animated background, morphing color glows, sparks, linked-folder header, LOCAL/copy UI, safe frame, live editor, bezier graph, validation and autocomplete. |
| `styles/base.css` | Shared buttons, headings, app container and empty state. |
| `styles/header.css` | Main header, legend, tooltips and selection bar. |
| `styles/filters.css` | Search and filter controls. |
| `styles/cards.css` | Card grid, previews, tags, dates and actions. |
| `styles/modals.css` | Detail/editor/delete dialog layout and code block. |
| `styles/forms.css` | Base form fields, categories and device selector. |
| `styles/toast.css` | Success/error notifications. |
| `styles/keyframes.css` | Motion Shelf interface animations only. User-created keyframes are injected dynamically or saved in `animations/`. |

Each page also carries its own scrollbar and scroll-progress color theme, layered on top of the shared geometry in `styles/styles.css`: the animation library re-colors them emerald in `styles/library-atmosphere.css`, and the task board re-colors them jade/copper in `styles/task-sky.css`.

## Syncing the campaign archives

**Sync** is the only import control. It reuses the archives it already knows, and opens a folder picker only for one it cannot locate; picking a folder that contains both satisfies both at once. Once an archive has been chosen it is remembered, so later syncs run without asking.

Pick whichever folder contains `campaigns/` and `previews-only/` (a repositories or work folder); Motion Shelf searches up to three levels down for them by name, so nothing is tied to one machine's paths. If only one of the two exists, the sync runs on that one. Everything a sync finds goes through classification, de-duplication, family matching and template extraction before it reaches the library -- there is no separate cleanup step, and future campaigns follow the same path automatically.

The archives are **strictly read-only**. The picker is opened with `mode: "read"`, so the browser will not return a writable handle at all, and no directory or file is ever requested with `create`. Everything a scan produces is stored inside Motion Shelf.

What is extracted:

- **CSS** -- `@keyframes` plus the rule that references them, with duration, delay, easing, iterations, direction and fill mode read from either the shorthand or the longhand properties. Vendor-prefixed copies collapse onto one animation.
- **GSAP** -- `to`, `from`, `fromTo`, `set` and timelines, including the legacy `TweenMax.to(target, duration, vars)` shape. A preceding `gsap.set()` supplies the starting state, which is what makes a bare `.to({x: 0})` meaningful. Consecutive tweens on the same target become one sequence, laid out across 0-100% by their durations. `repeat: -1` becomes `infinite` and `yoyo: true` becomes `alternate`. GSAP eases map onto the names `scripts/easing.js` already understands, so no second easing engine exists.
- **JavaScript** -- classes added or toggled inside an event handler are resolved back to the CSS animation they carry, which is how an animation is classified as hover, interaction or appear.

What is deliberately not imported: banner sizes, positions, brand colours, fonts, imagery, copy, tracking and any value a static reader cannot resolve (`getCurve(...)`, `adWidth`). Only styles the motion actually depends on -- `transform-origin`, `perspective`, `transform-style`, `overflow`, `clip-path` and similar -- travel with an animation, split between the element and its parent helper class.

De-duplication is by the shape of the motion, not its name: keyframe names, selectors, formatting, `from`/`to` versus `0%`/`100%`, vendor prefixes and timing differences all collapse, so one fade written a thousand ways is one card. Whether an animation loops, and whether it alternates, are treated as genuinely different behaviour. Because GSAP is converted to keyframes before fingerprinting, the same motion written in CSS in one campaign and in GSAP in another also collapses onto a single entry. The most frequently used name and timing win, and each entry records how many places it was found in.

Authoring-tool placeholders are rejected: anything whose visible change is below roughly 5% opacity, one pixel, one degree or a 0.02 scale step is not an animation worth keeping, and generated names such as `gwd_gen_...` fall back to a description of the motion instead.

Imported animations are ordinary Motion Shelf records from that point on -- they preview, filter, search, edit and export exactly like hand-made ones, and the archives are never reopened to display them. Provenance is kept as a relative path (`campaigns/Aldi/banner/style.css`), never an absolute one.

### What a sync actually opens

A full archive is roughly 155,000 files, and almost none of them are worth
reading, so a sync narrows the work in four stages:

1. Images, video, fonts and known runtime libraries are rejected on their
   filename, before anything is opened. Listing a folder only opens the files
   that could contain animation code.
2. The file opened during listing is reused for the read, so nothing is opened
   twice, and reads overlap eight at a time. Parsing still happens in listing
   order, so a scan is reproducible.
3. Four files in five contain no animation code at all; a substring test skips
   the parsers for those.
4. Campaign archives copy the same stylesheet into every banner size, so most
   file bodies have already been seen. Identical content is replayed against
   the new location -- the parse is skipped but the occurrence still counts,
   which is what canonical selection depends on.

On the current archive that is about 62,000 file opens instead of 216,000, and
about 9,000 parses instead of 62,000, with byte-identical results.

Every file is also remembered by size and modification time, so a second sync
re-reads only what actually changed.

## Families, canonical animations and templates

Extraction collapses animations that are byte-for-byte the same motion. A
second stage then groups what is left into **families**: animations with the
same structure that differ only in how far, how big, how fast or how sharply
they move. `float-small`, `productFloat` and `imgFloating` are one family; a
three step float and a five step bounce are not.

Two identities are kept on every imported animation:

- `origin.exactFingerprint` -- the structure together with its values.
- `origin.familyFingerprint` -- the same structure with adjustable magnitudes
  abstracted away. Directions, identity values (a float returning to
  `translateY(0)`) and the keyframe offsets all stay part of it, so sliding
  left never merges with sliding right and no intermediate stage is flattened.

One family becomes one card. The most used member sets the structure, the most
common name and timing win, and the varying magnitudes become custom
properties whose defaults are the median of what the archive actually used.
Motion written with `transform`, with the standalone `translate`/`scale`/
`rotate` properties, or in GSAP is all read the same way, so the same
technique lands in one family whichever way it was authored.

Names describe behaviour -- Vertical Float, Fade Up, Scale Fade In, Continuous
Rotation -- because historical names like `anim1` or `productAnim` say nothing.
A source name is only used when the family has a single member and the name is
genuinely more descriptive; either way the original is kept in
`origin.originalName`.

### Adjustable values

A CSS family exposes its magnitudes as `--ms-*` custom properties with the
defaults declared on the class, so it works untouched:

```css
.ms-vertical-float {
  --ms-distance: 15px;
  --ms-duration: 2s;
  --ms-ease: ease-in-out;
}
```

and any element overrides one value without touching the shared definition:

```css
.product-b { --ms-distance: 30px; }
```

Keyframes read those properties with the declared value as an inline fallback,
and the direction stays in the keyframe (`calc(var(--ms-distance) * -1)`) so
an override cannot accidentally reverse the motion. Each family has exactly
one `@keyframes` block. The editor lists these values under **Adjustable
values** above the class styles, and the card and editor previews both apply
them, so changing one is visible immediately.

GSAP families are not rewritten into CSS variables. They keep
`template.engine: "gsap"` and their resolved configuration -- `y`, `duration`,
`repeat`, `yoyo`, `ease` -- as structured metadata instead.

Animations you create by hand have no `origin`, and the family logic only ever
groups or refreshes entries that have one. A resync matches on the family
fingerprint, so a known technique is updated in place and a newly discovered
value variant joins its family instead of adding another card.

## Sharing the library

**Push to local** writes one animation. Confirming a **Sync** writes the whole library into `animations/` and regenerates `animations/manifest.json` from the files that are actually there, whenever a project folder is linked. The manifest is what every visitor loads, so once the change is committed and pushed the whole team sees the same catalog. Syncing writes files; it does not commit or push for you.

## Important developer rules

- Keep every exported animation name unique.
- Keep `animations/` directly inside the selected project root.
- Do not remove or hand-edit the `@motion-shelf` metadata unless you also keep it valid JSON.
- Keep visual styles out of the timing fields and `animation-*` declarations out of Global CSS.
- Test large translations, rotations and 3D motion against both card and editor safe frames.

## Background layers

The backgrounds are decorative and never capture clicks. The animation library uses an emerald aurora in `styles/library-atmosphere.css`: slow light ribbons, curved contour lines, green haze and the shared spark field. `scripts/library-atmosphere.js` builds a stable SVG field of 540 stars/dust points and 12 twinkling highlights, and adds smooth, bounded pointer and scroll parallax to separate depth layers. Thin light tracers and three occasional meteors add movement; mobile shows only one meteor. Pointer parallax is limited to fine mouse pointers; animation pauses in hidden tabs, and reduced-motion preferences disable movement and hide meteors/tracers. The task page retains its independent observatory styling.

To adjust the library effect, change the following values in `styles/library-atmosphere.css`:

- Aurora strength and speed: `.atmosphere-aurora` and `.aurora-ribbon` opacity and animation durations.
- Background colors: `.library-atmosphere` and `.atmosphere-haze` gradients.
- Spark brightness and glow: the library-scoped `.ambient-sparks` and `.ambient-spark` rules.
- Star brightness and details: `.atmosphere-stars`, `.library-beacon`, `.library-meteor` and `.atmosphere-filaments`. Star positions/density are seeded in `buildLibraryStars()` in `scripts/library-atmosphere.js`.
- Parallax depth: `data-depth` on each layer in `index.html`; motion distances are bounded in `scripts/library-atmosphere.js`.

To change spark density, edit `DEFAULT_SPARK_COUNT` and `SMALL_SCREEN_SPARK_COUNT` in `scripts/background.js`.
- Use **Change folder** in the header only when switching projects; normal refreshes and pushes reuse the existing link.
