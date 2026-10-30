# Graded cuts and Shown %, in the app (2026-10-29, lane `graded-cuts-ui`)

## Brief

- **Asked** (Ludo, TODO.md Next item 4, the app half; its library half is PR #20, merged): per (clip, object or part):
  Keeps a layer, Cuts, Cuts wider, with a band in Å and fuzziness; Look › Shown (%) on a group, an entity or a target.
  Ludo, 2026-10-29: "swith if graded": when a part gets a graded way (Keeps a layer, Cuts wider, a band, fuzziness), the
  app switches that cut to the instance clip (Proteins); the plain Cuts leaves it as it is. **Check:** the GradedCut
  and ShownInPart stories' controls in the app; set the membrane to Keeps a layer and see a layer kept on the cut's face;
  raise fuzziness and see it thin; turn the camera and see the same instances; Shown 30 % on the capsid thins it, the
  same ones at every share.
- **The design is the mock:** Storybook prism-me › Explorer › Proposed (cellVIEW), `src/_stories/proposed*.tsx`,
  `clip-book.ts` (GradedCut, ShownInPart); reasons in `progress/2026-10-28-cellview-evaluation.md`, cellVIEW in
  `_spec/cellview.md` §4.1; the library in `progress/2026-10-29-graded-cuts.md` and Prism's `_spec/clipping.md`.
- **Spec:** `_spec/ui.md` §4 (a clip's What it cuts, a node's Look), `features.md`, TODO.md item 4 built.
- **Tests:** each control runs its operation in one undo step; the switch to instance when graded (and not for Cuts).
- **Touches:** `properties.tsx` (a clip's What it cuts, Look), the app's operations; **stays off:** lane `clip-whole`
  (Proteins/Atoms in a clip's section, small, merges first: merge origin/prism-me when it lands, keep both) and lane
  `ghosts` (a clip's Outline what it cuts).
- **Size:** ~250 production lines; the library is built, so it is the app's controls only. If the library lacks
  something, stop and report.
- **Steps and models:** 1. read the library and the mock (Opus) 2. build (Opus) 3. checks (Sonnet) 4. browser on WebGPU
  and WebGL2 (Sonnet) 5. gate (Opus).

## Built

## Decided

## Learned

## Size

## Review
