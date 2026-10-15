# Local icons

`sprite.svg` defines each icon once, under descriptive IDs such as `check`,
`plus`, `mobile-screen`, and `eye-slash`. Artwork retains the original glyph
dimensions; `styles/icons.css` preserves its proportional width at the existing
font size. Colour inherits through `currentColor`.

In app markup use `<i class="icon-solid icon-check"></i>`. `scripts/icons.js`
inserts a local SVG `<use>` referencing `sprite.svg#check`. The host is retained
to preserve positioning, IDs, extra classes, event handling and dynamic toast
references. Changing an icon class updates its SVG. Outline favourites use
`icon-regular icon-star`; filled favourites use `icon-solid icon-star`.

There is no external stylesheet, icon font, or Font Awesome runtime. Attribution
for the retained vector artwork is in LICENSE.md. Radar was missing from the
former free icon library; its local symbol is original artwork. Folder-check
reuses the folder-open and check symbols.

Animation class, Keyframes and Parent headings use tag, timeline and layers,
respectively. The preview scenes are generated locally by preview-scene.js.
