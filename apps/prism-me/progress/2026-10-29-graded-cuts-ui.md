# Graded cuts and Shown %, in the app (2026-10-29, lane `graded-cuts-ui`)

## Brief

- **Asked** (Ludo, TODO.md Next item 4, the app half; its library half is PR #20, merged): per (clip, object or part):
  Keeps a layer, Cuts, Cuts wider, with a band in Å and fuzziness; Look › Shown (%) on a group, an entity or a target.
  Ludo, 2026-10-29: "swith if graded": when a part gets a graded way (Keeps a layer, Cuts wider, a band, fuzziness), the
  app switches that cut to the instance clip (Proteins); the plain Cuts leaves it as it is. **Check:** the GradedCut and
  ShownInPart stories' controls in the app; set the membrane to Keeps a layer and see a layer kept on the cut's face;
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

- **First, a fix of the #18 #20 merge** (PR #21, branch `me/clip-records`, merged in here). On `origin/prism-me`, two
  tests in `clips-category.test.tsx` failed. #20 made Prism's particle cuts a record a part, while the app still wrote
  one merged record a clip and read the first. So Cut also on a second part was not listed, and × did nothing. Now the
  app reads all of a clip's records, gives a part its own record, and takes a part off each record. Its review gave 2
  should-fix, both fixed test first. The coordinator asked for it as its own PR while Ludo tests prism-me.
- **`explorer.clipWay`** (`clips.ts` `setWay`) sets a node's way in a clip: keep, cut or wider, with band and fuzziness.
  - The node gets its own record, placed last; the records of its parts that it holds are removed.
  - A part of a clip of all the model gets a record of every particle first, so the rest of the model stays cut plainly.
  - A graded way runs `clipping.settings` with `instance` in the same step. The plain cut does not.
  - Structures and atoms are refused.
- **What it cuts** (`rows.ts`) lists a row per record, each with its way; where two records give the same row, the later
  one wins. The model's row and a part's row can then both be listed, each its way.
- **The controls** (`properties.tsx` `UseLine`, `WaySelect`, `WayBand`):
  - On particles: a Select (Keeps a layer, Cuts it, Cuts it wider). For a graded way, Band (5–250 Å) and Fuzziness
    sliders, each acting once released.
  - In a clip's What it cuts, and in a node's Clips, where `wayOf` gives the clip's way on that node.
- **Look › Shown (%)** on a group or an entity (in its Look) and on a target (its only Look). It writes the layer's
  `shown` (`particles.look`); 100 % clears it. `shownState` reads it back.
- Tests are in `_test/graded-cuts-ui.test.tsx`:
  - A part kept a layer of through the Select: one step, its record, the cuts switched to instance, still instance once
    the clip moves; band and fuzziness typed, one step each; undo.
  - A part of a whole-model clip: the plain cut leaves the variant as it is, a wider cut switches it; a structure is
    refused.
  - Shown: one step; 100 % clears it.

## Decided

- **"Switch if graded" is scene-wide** (`clipping.settings`), not per cut. A representation's variant is rewritten to
  the scene's at every cut written (Prism's `withObject`), so a per-representation switch would revert on the first move
  of the clip; the test checks that it stays. As a side effect, the scene's other cuts (structures too) become instance.
  It shows as Proteins in Clip whole. If Ludo wants it per cut, that is a library change: a variant per clip object.
- **A row per record** in What it cuts, rather than the union's groups. A graded part shows as its own line under the
  whole model's, which is what the mock's GradedCut shows.
- **A node's own record changes in place** (review S4). A band or fuzziness tweak, or a mode change, on the model or a
  group keeps the records of its parts after it, each its row. A node without a record of its own gets one last, and the
  records of its parts that it holds go, because they would be hidden under it.
- **Look's Reset leaves Shown**; 100 % clears it (review 3, spec reworded). Shown reads the lowest share of the layers
  holding the part, since Prism thins over every layer.
- **A new part given** (Cut also) gets the plain cut, not the way of the clip's other parts.
- The node's Clips got the way controls too (the PartClips story), because they cost little once `UseLine` has them.
- The way controls live in `UseLine`; the body of `ClipProperties` changed by one prop only, so lane `clip-whole` merges
  cleanly.

## Learned

- A merge of two lanes that each passed their own tests broke the app: #20 changed what `cuts.add` replaces, and #18's
  tests ran before #20 was in. The full suite under load (load average ~20, other lanes running) timed out on 15 tests.
  Run one file at a time with a long timeout before calling a failure pre-existing.
- `test:scaling`'s tree-eyes drag guard is flaky under load: it failed once on `origin/prism-me` (×9.9) and passed on
  reruns.
- Driving the panel in Playwright: open the Clips category (its row, then ArrowRight), pick the clip's row, open the
  `clip` section, then use the Select (`[aria-label^="What it does to"]`) and the sliders' boxes.

## Size

- Brief: ~250 production lines. Lane: +391 −18 (`clips.ts` +144, `properties.tsx` +134, `operations.ts` +68, `rows.ts`
  +45), about 1.5× the brief.
- Where the room went:
  - the record logic (a whole model plus a part, a node's own record in place, subsets, mixed ways);
  - the node's Clips;
  - the review's fixes (~+60).
- Plus the fix PR #21: +60 −22.
- Tests +450 (`graded-cuts-ui.test.tsx` +417, a scaling guard +33); specs, TODO and changelog ~+45.

## Checked in the app (real GL)

Headless Chrome, port 1357, `?example=cellpack-hiv1` (230,158 particles), WebGPU and WebGL2. No page errors.

- Through the panel: the Clips category, Plane 1, What it cuts lists compartment 0 and compartment 1, each with its
  Select. Keeps a layer: one step and the variant switches to instance. Band 250 and Fuzziness 90 typed: the sliders
  show them. Screenshots are in the session scratchpad, `gcui-ui/`.
- Through `explorer.clipWay` (a Sonnet check, `gcui-gl/`):
  - Keeps a layer, band 250 Å: 5,055 px changed on WebGPU, 4,537 on WebGL2.
  - Fuzziness 0.9: the layer thins, 2,453 and 2,447 px.
  - Turned and back: 0 px on WebGL2. On WebGPU ~12.5k px, the same as the control without a cut (11.7k): progressive
    passes, as the library lane found.
  - Shown on the membrane (compartment 0, the blood hidden, no cut): 30 % thins it (39.6k px), 60 % differs from 30 %
    (36.8k px), and 30 % again is the same image (0 px), on both backends. On compartment 1 the share hardly shows from
    outside, because the membrane hides it.

## Left

- The aperture cut (item f), the cut's 2D preview and Ghosts (lane `ghosts`).
- Graded ways on structures (the pixel clip cuts them plainly) and on a decorated list's target structures.
- A per-cut variant, if Ludo wants one (library).
- The `dClipTable` programs are not precompiled: the first graded cut compiles them.
- From PR #21: a list's records are read from its first representation; uncompartmented particles are lost when a
  compartment is taken off a whole-model clip.

## Review

lane-reviewer (Opus), then lane-skeptic (Opus). The reviewer found 3 must-fix, 8 should-fix and 4 nits. The skeptic
refuted none: it confirmed 10 and called 1 plausible. It lowered finding 3 to should-fix and finding 10 to a nit, and
added N1 (should-fix, Ludo's call) and N2 (nit). Each fix has a test that failed first.

| Finding                                                                       | Severity (skeptic) | Fixed in                                      |
| ----------------------------------------------------------------------------- | ------------------ | --------------------------------------------- |
| 1 the record of every particle took the part's way: the whole model graded    | must-fix           | `3f2a632d7` (test `ee119e8f2`)                |
| 2 wayOf misread a whole object with part records                              | must-fix           | `3f2a632d7` (test `ee119e8f2`)                |
| 3 the spec said Look's Reset clears Shown; it does not                        | should-fix         | `6b4b1ff44` (spec reworded)                   |
| 4 a band or fuzziness tweak on the model or a group dropped its parts' ways   | should-fix         | `3f2a632d7` (own record in place)             |
| 5 unsorted group ids and an ignored `unchanged`: a no-op made a step          | should-fix         | `3f2a632d7` (test `ee119e8f2`)                |
| 6 "already" returned before the variant was switched back to instance         | should-fix         | `3f2a632d7` (test `ee119e8f2`)                |
| 7 a node's Clips showed a way control that always failed                      | should-fix         | `7a4e557c9` (test `2419be302`)                |
| 8 a group showed a way that only some of its parts had (no "mixed")           | should-fix         | `3f2a632d7`, `7a4e557c9`                      |
| 9 Shown read the exact selector, not a group's share                          | should-fix         | `6b4b1ff44` (test `2419be302`)                |
| 10 What it cuts: O(records × entities), and O(rows²) per row                  | nit (was should)   | `fcd5ebe22` (guard `e20bbdeb3`, ×19.5 before) |
| 11 test gaps: undo of the variant, node's Clips, entity Shown                 | should-fix         | `ee119e8f2`, `2419be302`                      |
| N1 the switch is scene-wide: a plain clip on 1CRN becomes instance too        | should-fix (Ludo)  | open, Ludo's call (spec and PR say so)        |
| N2 the op's band range 0–1000, the slider's 5–250                             | nit                | `6b4b1ff44`                                   |
| nits: `isAll` duplicated `isCover`; the Look row's For column; empty progress | nit                | `fcd5ebe22`, `6b4b1ff44`, here                |

Left open: a target's Shown is not covered by a test (the test model is a mesoscale model, which has no targets).
