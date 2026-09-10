# Motion Shelf — developer instructions

Motion Shelf is a browser-based CSS animation library. You create or edit an animation visually, copy its complete CSS, or save it as a real file inside your project’s `animations/` folder.

## Start it correctly

Folder access requires a secure browser context. Open the project through localhost, not by double-clicking `index.html`:

```bash
cd "Junk styles"
python3 -m http.server 4173
```

Then open `http://localhost:4173` in Chrome or Edge.

If using Cursor/VS Code Live Server instead, this workspace disables its file-change reloads in `.vscode/settings.json`. Sync and local saves write files inside the served folder; Live Server would otherwise reload the page or replace its styles during those operations. The app updates its own UI after saves. Refresh manually after editing the application code. Restart Live Server once after changing this setting so its watcher picks it up. The Python server above also serves the app without automatic reloads.

## Main workflow

1. Click **Link project** in the header and choose the root folder containing `index.html`.
2. Motion Shelf remembers that directory handle and reads every `.css` file in `animations/`.
3. A **LOCAL** badge means the CSS file currently exists in the linked folder. It does not mean the file is committed or pushed to GitHub.
4. Click a card anywhere outside its buttons to copy its complete CSS.
5. Use **View details** to open the full modal, or **Edit** to change the animation.
6. Use **Push to local** or **Update local** to write the CSS file. The same linked folder is reused, so the picker is not opened for every save.

On a later visit, the app reloads the saved folder handle. If the browser needs permission again, the header shows **Reconnect project**; clicking it reauthorizes the same folder. Browsers expose the selected folder name, not its full operating-system path, so the header shows `project-name/animations`.

## Filtering, sorting and favourites

The chip row is two rows in one. **All, Desktop, Mobile, Favourite** and **Most used** are pinned: they never scroll away, and on a narrow screen they wrap onto another line instead. Everything after them -- Local, Custom, the interactions, and every category a sync brings in -- lives in the strip that scrolls sideways.

Filters narrow, and no more than two are ever active; selecting a third drops the oldest. Beyond the interaction and category chips there are three that read the record rather than its tags:

| Chip | Shows |
| --- | --- |
| **Favourite** | Animations you have starred. |
| **Custom** | Hand-made animations -- anything without the `origin` block a sync writes. |
| **Local** | Animations whose CSS file exists in the linked project folder. |
| **Campaigns** | Animations a sync read out of the `campaigns` archive. |
| **Previews only** | Animations a sync read out of `previews-only`. |

Picking an archive chip opens a **folder picker** underneath the chips, listing the brand or campaign folders actually present in the library with how many animations came out of each -- Aldi (14), BMW (9). Both archives are organised that way: one top-level folder per brand, which the scanner records as `origin.sources[].folder`. The chosen folder narrows on top of everything else rather than joining the chips, because the archive chip already occupies one of the two filter slots. Switching archives clears it, as does All, and a folder that is no longer represented falls back to "All folders" instead of silently emptying the grid.

`scripts/folder-picker.js` is that picker: a small combobox rather than a `<select>`, because a system menu of four hundred brands can only be scrolled blind. A trigger, a panel, and a search field that filters as you type -- with the keyboard as a first-class path: arrows move, Enter picks, Escape closes, and the pointer shares the same single highlight so the two never disagree about where you are. Clicking outside closes it, and the document listener that watches for that is only bound while the panel is open.

The element is reused across renders whenever it would be rebuilt identically -- the filter row is rebuilt for reasons that have nothing to do with the picker, and replacing it would close the panel and discard whatever had been typed. `renderFolderPicker` keeps the last one along with a signature of the archive and its folder counts, and calls `update()` on it instead when only the selected value moved.

Clicking a chip re-renders the row, which used to throw away how far the strip had been scrolled and send you back to the start every time you picked something from the far end. The offset is saved and put back, assigned directly rather than through `scrollTo`, which would animate the strip on every click.

**Most used** is a sort, not a filter, and is deliberately kept out of `state.selectedFilters` -- otherwise it would occupy one of the two filter slots and quietly evict a real one. It orders by `origin.occurrences`, the number of campaigns a sync found the animation in, highest first. A hand-made animation was written once and counts as one, so customs sit at the bottom of that list rather than pretending to a history they do not have. Click it again to go back.

The default order is **A to Z by name**, applied to every filter combination. When two filters are up, how many of them an animation matches still decides first; the sort order only breaks ties.

Every card says where it came from, next to its title: **Custom** for anything written here by hand, or the archive and -- when the animation came out of a single folder -- the brand: `Campaigns | Aldi`. The tooltip gives the occurrence count and the first few relative source paths. That badge answers "where is this from"; the separate **LOCAL** badge answers the different question of whether the CSS file is in the linked project folder, and both can appear at once. `scripts/origin.js` holds the reading of `origin.sources` -- archive-name normalisation included, since the second archive has been spelled `previews-only` and `previous-only` over the years.

Favourites are stored in `localStorage` under `motion-shelf.favourites.v1`, as a list of animation ids. Not on the animation record, for two reasons: the library itself lives in `sessionStorage` and is rebuilt from `animations/*.css` on every visit, so a star kept there would not survive a reload; and a star written into the animation file would travel to the whole team through git, turning one person's shortlist into everybody's. Ids are safe to key on because each animation file carries its own id in its metadata block.

A favourited card keeps an amber rim and a soft glow so a shortlist is findable by eye in a large grid, and its star stays visible while every other card only shows one on hover.

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
| `scripts/animations.js` | Animation data creation/update, the shared preview keyframes stylesheet, metadata and final CSS export. |
| `scripts/storage.js` | Normalizes animation records and keeps unfinished/session-only animations in `sessionStorage`. |
| `scripts/state.js` | Shared runtime state, selection, filters, sort order, drafts and linked-project status. |
| `scripts/cards.js` | Builds cards in batches as the grid is scrolled, safe-frame preview, local badges, tags and card buttons, and the in-place card patches for starring and selecting. |
| `scripts/filters.js` | Search, dynamic categories, maximum-two-filter behavior, the pinned/scrolling chip split and the display order. |
| `scripts/favourites.js` | Reads and writes the starred animations. localStorage only, keyed by animation id. |
| `scripts/folder-picker.js` | The searchable brand/campaign dropdown shown under the archive chips. Owns only its own open/query/highlight state. |
| `scripts/origin.js` | Reads `origin.sources`: which archive an animation came from, which brand folders inside it, and the wording of the card's provenance badge. |
| `scripts/modals.js` | Opens/closes dialogs. Clicking outside does not close the editor. |
| `scripts/utils.js` | Escaping, slugs, dates, IDs and normalization helpers. |
| `scripts/animation-extract.js` | Turns CSS, GSAP and class-toggle JavaScript into normalized keyframe records; handles naming, categories, interaction classification and the behaviour fingerprint used for de-duplication. Pure functions, no DOM. |
| `scripts/campaign-scan.js` | Walks the campaign archives read-only through the File System Access API, filters to source files, batches the work with progress, tolerates broken campaigns, and caches results by size and modification time. |
| `scripts/animation-family.js` | The stage after extraction: target/container detection, behaviour naming, family fingerprints, canonical selection and the CSS custom-property templates. |
| `scripts/sync-ui.js` | The single Sync action: reusing known archives, asking for only a missing one, progress, the results dialog, and merging canonical animations into the library. |
| `scripts/preview-scene.js` | Draws both halves of every preview: the still landscape backdrop that fills the frame, and the framed subject the animation moves. Four moods, seeded from the animation's own id. Inline SVG, no image files. |
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

Everything a card needs is worked out automatically, so a thousand imported animations need no hand editing:

- **Target** -- markup decides it (`<img class="product">` is conclusive), then image-specific styling such as `object-fit`, then wording like `packshot` or `logo`. Anything ambiguous stays on the generic `div`.
- **Interaction** -- `:hover` selectors, class toggles resolved to their handler, `infinite`/`repeat: -1`, an opacity ending near zero, or a multi-step timeline.
- **Categories** -- read from the motion itself: fade, slide, scale, rotate, 3d, elastic, spring, timeline.
- **Device** -- ad archives file creatives by format, and those folder names say which screen a creative was built for (`.../dynamic-head-desktop/`, `.../midscroll-mobile/`). An animation seen only on desktop creatives is marked desktop, only on mobile is mobile, and one seen on both -- or with no evidence either way -- stays `both`.

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

## Previews

Animations do not carry artwork. Nothing is taken from the campaign archives, and there is no image field: every preview is drawn by `scripts/preview-scene.js`, in two halves.

The **backdrop** is a small landscape that fills the whole frame and never moves. It belongs to the stage -- `.card-preview`, the detail stage, the editor stage -- as a background image, not to the animated element.

The **subject** is a framed plate centred in that frame, and it is the element the animation actually runs on. It borrows the same palette so it belongs to the scene behind it, and keeps a light rim and a shadow so it stays readable as a separate object.

The split is what keeps a preview inside its frame. A keyframe is free to fly the subject in from off-frame, squash it to a fifth of its size or turn it edge-on; the frame still shows scenery behind it instead of an empty hole. It also makes the motion easier to read, because it now moves against something stationary.

Four moods -- night, dusk, dawn and overcast -- each with a sky gradient, a sun or a moon, drifting cloud banks, two ridges, a horizon and grass. The mood, the star field, the ridge shapes and where the sun or moon sits are all seeded from the animation's own id, so the library looks varied while a card keeps the same sky between renders.

It is deliberately low contrast and nearly still, because the preview exists to show the animation rather than compete with it: only the clouds move, on a 52 second drift, and stars are drawn static since animating them on every card in a thousand-card library costs far more than it shows.

The backdrop is 16:9, exactly the shape of `.card-preview`, and every shape in it spans the full viewBox, so there is no edge for the card colour to show through.

## Sync speed

Measured against the real archives, not guessed at: reading files is ~46% of a scan and listing directories another ~34%, while every parser put together is about 3%. So the scanner is an I/O program, and the wins are all about not waiting.

**Directories overlap.** The walk used to take one directory at a time and read its files in batches of eight, which meant listing and reading never happened at once. Six directories now run together with twelve reads each, drained from a shared queue -- measured at ~500 to ~880 files a second on the real archives. Past that the curve is flat and only the number of open handles grows. A worker that finds the queue empty waits rather than stopping, because another worker may be about to push subdirectories onto it.

**Nothing that was already scanned is scanned again.** `loadScanCache` and `saveScanCache` existed but nothing called them, so every sync re-read and re-parsed the whole archive. Sync now loads the cache for each archive before the scan and writes it back after. A file whose size and modification time are unchanged is opened far enough to compare those two numbers and no further -- not read, not hashed, not parsed. On a test archive that is a cold scan of 569ms against a warm one of 189ms, with byte-identical results; edit one file and exactly one file is reparsed. The cache carries a `CACHE_VERSION`: bump it whenever extraction, classification or the record shape changes, or a stale entry will keep serving animations produced by code that no longer exists.

**Order stopped mattering.** Concurrency means files no longer arrive in listing order, so the family stage no longer depends on it: `commonest` breaks vote ties on the key, and both the family and member sorts break ties on the fingerprint. Verified by scanning a fixture archive with the old scanner and the new one -- same files inspected, same duplicates collapsed, same families, same canonical output, and identical run to run.

Parsing in a Worker was considered and rejected: at 3% of the time it cannot pay for the cost of moving the text.

## Holding up at a thousand animations

Seven animations forgive anything; a synced archive is a different program. Measured against a synthetic library of 1,000, the original grid took longer than two minutes to appear and 700ms per search keystroke. These are the five things that fixed it, and they should all be kept in mind before adding per-card work.

**The grid is reconciled, not rebuilt.** A render used to empty the grid and build it again, which is why applying a sync flashed: every card on screen was destroyed and replaced, previews and all, though almost all of them were about to be drawn identically. `renderCards` now compares each animation against a `data-signature` holding everything its card is drawn from -- the record, plus selection, favourite and filter state, which live outside it. Identical cards are moved into place as live nodes, keeping their previews and any animation running in them; only what actually changed is rebuilt, and a card that was not on screen a moment ago arrives with a short rise instead. Applying a sync of 30 new animations over 48 cards reuses 18 nodes, rebuilds none, and never lets the grid empty for a frame. A re-render also keeps as much of the grid as was already rendered, up to 240 cards, so it cannot collapse the page under someone who had scrolled a long way down it.

**The grid is windowed.** `renderCards` builds 48 cards and puts a `.grid-sentinel` after them; an `IntersectionObserver` with an 800px margin appends the next batch before you reach it. A filter click therefore builds 48 cards, not the library. The observer re-observes itself after each batch: an observer only reports a *change*, so a jump to the end of a page, or a very tall window, would otherwise stall after one batch.

**Preview images come from a pool.** A backdrop is ~9KB of data URI and 47 shapes, a plate ~5KB and 26. `preview-scene.js` keeps 32 backdrops and 96 plates, and hands an animation a slot derived from its own id, probing past slots already taken so nothing looks duplicated until the library outgrows the pool. The whole grid then decodes a few dozen images instead of one per card, and repeated cards share a decoded bitmap.

**One stylesheet holds every preview's keyframes.** There used to be a `<style>` element per animation, rewritten on every render. Now `injectAnimationForPreview` inserts each animation's `@keyframes` once into `#ms-preview-keyframes` and remembers it; rendering the same card again costs a Map lookup. An edit replaces that animation's rule rather than appending a second one with the same name.

**Cards that are off screen cost nothing.** `content-visibility: auto` with `contain-intrinsic-size: auto 520px` lets the browser skip style, layout and paint for built-but-unseen cards while keeping the page height honest.

**Not everything is a re-render.** Typing waits 140ms for a pause before filtering. Starring a card patches that one card (`refreshCardFavourite`) unless the Favourite filter is up and the star changes what belongs on screen. Ticking a card in selection mode patches it too (`refreshCardSelection`). Rebuilding the grid throws away every preview on screen and restarts every animation, so it is reserved for changes that actually alter the list.

Measured after all five, at 1,000 animations: first render ~1s, a filter click ~30ms, five search keystrokes ~90ms, 3,000 DOM nodes and one style element.

The decorative atmosphere pauses its animations while the page is scrolling (`[data-scrolling="true"]` in `library-atmosphere.css`), on top of the existing pause for a hidden tab.

The remaining ceiling is storage, not speed: the whole library is `JSON.stringify`'d into `sessionStorage` on every mutation -- about 1.5MB at 1,000 animations against a 5-10MB browser quota. A few thousand animations will need IndexedDB, or persisting only the records the user owns.

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
