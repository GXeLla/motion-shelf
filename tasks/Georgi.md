# Motion Shelf — Georgi Tasks

You are working on the Motion Shelf project.

Before making changes:
- read README.md
- read instructions.md
- inspect the existing implementation
- preserve existing working functionality
- follow the existing HTML, CSS, and JavaScript architecture

## Active Tasks

### 1. Refine the editor and showcase interfaces for imported animations

**Priority:** Standard  
**Task ID:** task-adapt-editor-showcase-imported-animations

Description:
Redesign and adapt the animation editor and showcase (View Details) modals to support upcoming animations imported from the campaigns and previews-only folders. Establish a consistent, responsive interface that accommodates varying animation structures, image dimensions, aspect ratios, and interaction patterns. Ensure previews accurately represent imported content and that editing controls apply only to the selected animation. Preserve existing functionality and verify both modal workflows against representative imported animations across desktop and mobile layouts.

## Completed Tasks

### 1. Make task updates feel smooth

**Priority:** Important  
**Task ID:** task-smooth-board

Description:
Improve board updates so task actions settle naturally without the page feeling refreshed or visually rebuilt.

### 2. Create a New Milestone action in Milestones

**Priority:** Important  
**Task ID:** task-new-milestone-button

Description:
Place a clear New Milestone button inside the Milestones view so users can create a workstream and its mini-tasks without leaving that page.

### 3. Redesign the animation editor modal

**Priority:** Important  
**Task ID:** task-redesign-animation-editor-modal

Description:
Redesign the animation edit modal as a new, complete interface. Keep the image preview sticky once it reaches the top of the modal while scrolling. Introduce an adjustable class-based approach for the current animation only, so edits are scoped to that animation and never change other animations at the same time. Include all controls and interaction states needed for the new editing experience, while keeping the modal responsive and preserving existing working behavior.

### 4. Auto-classify imported campaign animations

**Priority:** Important  
**Task ID:** task-auto-classify-imported-animations

Description:
When animations are imported from the Campaigns/Preview-only folder, automatically inspect and classify their default properties. Detect hover behavior, image usage, div/container structure, and every relevant animation property available by default. Use that analysis to sort and adjust the imported animation metadata automatically, while keeping the import resilient to different animation structures. Detect duplicate and near-duplicate animations, including variants with different names, timings, or small display changes, and show only one canonical animation in the library.

### 5. Create reusable animation templates with CSS variables

**Priority:** Important  
**Task ID:** task-reusable-animation-templates-css-variables

Description:
Replace collections of nearly identical animation files with reusable templates built on shared keyframe structures. Move adjustable values—such as duration, delay, distance, scale, rotation, easing, opacity, and transform origin—into documented CSS custom properties. Allow projects and individual elements to override those variables without copying or modifying the shared animation definition. Keep keyframes centralized, preserve current visual behavior where possible, define sensible defaults and fallbacks, and document how to apply and customize each template.

### 6. Scan and integrate campaign animation styles

**Priority:** Important  
**Task ID:** task-scan-and-integrate-campaign-animations

Description:
Scan the campaigns and previews-only folders, collect all animation classes, keyframes, and related styles, then organize and integrate them into the Motion Shelf animation library.
