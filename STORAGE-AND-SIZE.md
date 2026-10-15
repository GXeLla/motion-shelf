# Storage at a glance

| What | Where | Approximate size |
| --- | --- | --- |
| App without animations | Project files | **0.65 MB** |
| Saved animation | IndexedDB | **13–22 KB each** in our samples |
| Empty database | IndexedDB | **74 KB** in our browser test |
| Favourites | localStorage | **0 when empty; about 4 KB for 100** |
| Card background | Generated while open, not saved | **8–11 KB** |
| Moving card image | Generated while open, not saved | **4.5–6 KB** |
| All UI icons | One shared local SVG file | **25 KB total**, not per card |

**Bigger cards:** longer CSS, more keyframes, settings and source information.

**More scanning:** IndexedDB also keeps scan results; size depends on the folders.

**Details adjustments reset. Custom edits save.** Preview images are reused, not stored with each animation.

Example sizes, not limits. Browser cache and RAM vary; sessionStorage is normally empty (fallback only).
