# Graphics quality and motion on every object (2026-10-24, lane `me/quality-motion`)

TODO Next's "Graphics quality and procedural animation on every object" (Ludovic, 2026-10-24). PR not opened yet: the
review gate comes first.

## Built

- `mesoscale.graphics` and `mesoscale.motion` (`packages/extensions/mesoscale/src/operations.ts`) take an optional
  `object` (a structure, a particle list or a volume, by label or ref): that object alone, one step, the canvas left
  alone. Without one, the graphics mode sets every object (structures' and volumes' quality too) and the canvas
  resolution, one commit (⌘K, `?graphics-mode=`, the agent). A volume's motion is `invalid`. `graphicsState(object)`
  reads any object; a volume's has no wiggle or tumble. The mode table (quality, levels of detail, steps per cell) is in
  `_spec/ui.md` §4.
- `ObjectGraphics` (`controls.tsx`): Quality (Ultra, Quality, Balanced, Fast) and, where the object moves, Wiggle and
  Tumble (a toggle at 1 Å, an amplitude slider). `Motion` and `GraphicsMode` share its rows.
- prism-me's properties: Graphics & Motion on a structure, a model, a particle list and a volume (quality only), in
  place of the model-only Graphics section. Parts have none.
- The skill and tool text name `object`.
- Tests: `mesoscale/src/_test/object-graphics.test.ts` (one object's quality and motion, the others unchanged; a volume
  does not move; one undo step each; the global mode; the known limit pinned), `explorer/_test/graphics-motion.test.tsx`
  (jsdom: the section per kind, none for a part; Fast on the model leaves 1CRN; Wiggle on 1CRN alone). The first 7
  failed on the code before.
- Tried in the app (headless Chromium, software GL, port 1345): PetWorld HIV, 1CRN and a 24³ MRC. 1CRN's Wiggle: its
  representations at 1 Å, the model unchanged; the model's Fast: its levels of detail at performance, 1CRN unchanged;
  the volume shows Quality only; one undo brings the model's back.

## Decided

- The ops live in the mesoscale extension; Prism is unchanged. Per-structure wiggle writes that structure's
  representations' `animation` params (Mol\*'s component options are scene-wide; its `structure-wiggle` helper takes
  components only in uncertainty mode).
- Tumble is shown on structures: Mol\* supports it per instance.

## Open (TODO.md)

- The scene-wide structure options (quick styles, `component.options`) put back their quality and wiggle on every
  structure: a plugin-core change, its own lane.
- A volume's quality barely changes a slice or an isosurface (only double-sided faces at low); a direct volume's steps
  per cell show.
- The canvas resolution is off screen now (⌘K, `?graphics-mode=`, the agent).
- Parts and meshes have no Graphics & Motion; a structure's `auto` quality lights no mode.
- The message names the object by its cell label (`CIF File (assembly 1)` for PetWorld HIV), not the tree's name.

## Learned

- The disk filled mid-lane (`/private/tmp/claude-501`, other sessions' output, 13 GB): every Bash call fails with ENOSPC
  before it starts. Check `df -h /System/Volumes/Data` before a gate.

## Size

About 230 production lines (`operations.ts` ~150, `controls.tsx` ~60, `properties.tsx` ~25, `prism-viewer.ts` +7), under
the 400 budget; 370 lines of tests.
