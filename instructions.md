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
| `scripts/code.js` | Copies CSS to the clipboard and writes/removes CSS files through the already-linked folder handle. |
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

## Important developer rules

- Keep every exported animation name unique.
- Keep `animations/` directly inside the selected project root.
- Do not remove or hand-edit the `@motion-shelf` metadata unless you also keep it valid JSON.
- Keep visual styles out of the timing fields and `animation-*` declarations out of Global CSS.
- Test large translations, rotations and 3D motion against both card and editor safe frames.

## Background layers

The background is decorative and never captures clicks. The original eight-point teal/blue gradient remains on `body::before`. Two large blurred shapes in `.ambient-morph-one` and `.ambient-morph-two` move at different speeds, creating a subtle color-morph effect without changing the established palette. `scripts/background.js` adds tiny spark elements with randomized position, size, timing and drift. Motion is reduced automatically when the operating system requests reduced motion.

To adjust the effect, change the following values in `styles/enhancements.css`:

- Morph strength: `.ambient-morph` and `.ambient-morph-two` opacity.
- Morph speed: the `48s` and `62s` animation durations.
- Spark brightness: `.ambient-sparks` opacity.
- Spark glow: `.ambient-spark` box shadows.

To change spark density, edit `DEFAULT_SPARK_COUNT` and `SMALL_SCREEN_SPARK_COUNT` in `scripts/background.js`.
- Use **Change folder** in the header only when switching projects; normal refreshes and pushes reuse the existing link.
