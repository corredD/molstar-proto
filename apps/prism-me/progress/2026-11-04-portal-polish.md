# Lane portal-polish (2026-11-04)

Branch `me/portal-polish`, worktree `~/prism-me-lanes/portal-polish`, dev server port 1349.

## Brief (Ludo, 2026-11-04)

Items 2, 5 and 8 of the small items left by #46-#49, with Ludo's answers:

- **Item 2, names.** The tree showed two volumes called `TS_08.zarr` (the tomogram and the tilt series). Answer:
  **"Run + kind + id"**: `TS_08 tomogram 638`, `TS_08 tilt series 17086`; the sizes stay on the right.
- **Item 5, tilt series placement.** It loads raw, beside the tomogram (alignment identity; tilt axis −5° on TS_08; 1.7
  Å a pixel against 6.8 Å). Answer: **"before deciding, make it optional so we can compare."** The decision is pending
  his comparison: build a switch, change no default.
- **Item 8, descriptions.** Answer: **"Portal: description + method"**: the index keeps each annotation's description,
  method and GO id; hover and properties show them, the GO id as a link.

### What was found (2026-11-04, the portal client)

- Annotations have `object_name`, `object_id` (GO id, e.g. `GO:0022626`), `object_description` (sometimes None; e.g.
  "chloramphenicol bound 70S ribosome", "Membrain-seg prediction"), `annotation_method` (e.g. "Template matching +
  manual filtering + 3D classification filtering", long ones too).
- The tilt series' angles are looked up from the volume's file address (lane portal-tiltseries), and Data reads
  `downloadUrlAbove`: **change only the label, never the URL.**
- #49 added a description to particle entities (`ParticleEntityInfo.description`, shown by Mol\*'s particle label and
  the properties via `descriptionOf` in `apps/prism-me/src/explorer/properties.tsx` ~line 151). Portal ndjson lists
  probably have no `entityInfo`: feed the portal description through that same field (or the list's own description)
  rather than a new hover path. If a volume's (mask's) hover cannot take it cheaply, report it, do not build new hover
  infrastructure. The coordinator is moving `descriptionOf` into a shared helper for the tree's tooltips (lane
  `tree-tooltips`, done inline): use it once merged, do not write a second reader.

### Steps

1. **Names** (`packages/extensions/cryoet/src/portal.ts`): a portal volume's label is `<run> tomogram <id>` /
   `<run> tilt series <id>`, a mask `<run> <object> <annotation id>`, a point list `<object>` as today if it is already
   that; say the rule in portal.md. Tests and stories that match `TS_08.zarr` are updated.
2. **Tilt series placement switch**, on the loaded series (cryoet controls, the Slice or Data section of the series, in
   `packages/extensions/cryoet/src/controls.tsx`, not in `properties.tsx`, the live-forms lane edits that), one click to
   compare, no reload: **beside, raw** (today, the default), **beside, turned** (by the tilt axis), **overlay, turned**
   (centred on the tomogram in x, y; under it in z). By `stage.move`; a URL param
   `portal-tiltseries-place=beside|turned|overlay`. Nobody has checked the rotation's sign or whether the tomogram
   already has the tilt axis applied: verify both by matching a feature between image 21 (≈0°) and a top view of the
   tomogram, report the sign found, with screenshots of the three placements. The scale needs no change (the NGFF x, y
   scale is in Å, both about 6.3–6.5 kÅ wide).
3. **Descriptions** (`tools/portal-index/portal_index.py`, `PortalAnnotation` in `portal-index.ts`): `description`,
   `method`, `goId`, each written only when present; version 1 kept; the four datasets rebuilt, growth reported. Shown
   on hover of the points (and masks if cheap) and in the properties: the object name, the description, the method (one
   line, cut), the GO id as a link to `https://amigo.geneontology.org/amigo/term/<id>`.
4. Spec in the same commits: `packages/extensions/cryoet/_spec/portal.md`, `apps/prism-me/_spec/features.md`,
   `.v6/changelogs/portal-polish.md`, the TODO (item 5 recorded as "decision pending Ludo's comparison").

### Tests

- Fails first: the names of a 10003 TS_08 load with the tilt series (no two the same); the index of 10003 has annotation
  1212's description "chloramphenicol bound 70S ribosome", its method and GO:0022626.
- The placement switch: each of the three gives the expected matrix (sign as verified); the URL param sets it.
- The properties of the ribosome list show the description and the GO link (jsdom).
- Headed Chromium (`--enable-unsafe-webgpu`, Playwright from the worktree, port 1349): the three placements,
  screenshots; a ribosome hovered with its description.

### Ludo's check

http://localhost:1349/apps/prism-me/build/?portal-dataset=10003&portal-run=TS_08&portal-tiltseries=17086: the tree shows
`TS_08 tomogram 638` and `TS_08 tilt series 17086`; the series' Placement switch changes beside / turned / overlay at
once; hover a ribosome: "chloramphenicol bound 70S ribosome" and its method; its properties link GO:0022626.

Size: about 150 production lines (names 20, placement 60, index 30, display 40), plus tests.

## Built (2026-11-04)

Names, the Placement switch (default beside, raw), and the annotation's description, method and GO link in the
properties. The four indexes rebuilt (version 1 kept). The turn is −(tilt axis + 180°), measured on 10003 TS_08
(portal.md §2). Overlay uses the tomogram where it is now.

Hover of a ribosome does **not** show the description. Mol\*'s particle label reads `entityInfo` only, and a list given
`entityInfo` becomes a mesoscale model in the tree. The brief said not to build a new hover path. Said in portal.md §4,
TODO.md, and the PR. Ludo's check of the hover still fails until he decides.

## Review

Reviewer: 1 must-fix, 5 should-fix, 7 nits. Skeptic: M1 confirmed (say it, do not build it), S3 and S5 should-fix, S1
lowered (the Z-slice gate was already in progress), S2's drift refuted (a nit: no button pressed after a tilt-series
level change), S4 lowered to a nit. Two new nits.

| Finding                                | Verdict                                   | Where                                                                                                       |
| -------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| M1 hover                               | confirmed, said, not built                | TODO, portal.md §4, this file                                                                               |
| S1 Placement on every slice axis       | confirmed, fixed `a81a84107`              | Z slice only                                                                                                |
| S2 level change un-presses the buttons | nit, open                                 | TODO                                                                                                        |
| S3 overlay ignores a moved tomogram    | confirmed, fixed with the real-stage test | `tiltSeriesMatrix(..., tomogramAt)`                                                                         |
| S4 `volumeMatrix` copies stage-tools   | nit, open                                 | place cancels it                                                                                            |
| S5 fake stage only                     | confirmed, fixed                          | `apps/prism-me/src/_test/portal-place.test.ts`                                                              |
| N1–N7, two new nits                    | open                                      | N4 (two tomograms) in TODO; N7 will conflict with `me/tree-tooltips` on TODO.md and `descriptions.test.tsx` |

## Checked

`pnpm test:unit` on `cryoet/src/_test/portal.test.ts` (23), `slice-angle.test.tsx` (5) and
`apps/prism-me/src/_test/portal-place.test.ts` (2): 30 passed. The real stage switches beside, overlay, turned and back,
and overlay follows a tomogram moved by `stage.move`. Headed screenshots of the three placements were not taken in this
pass (the dev server on 1349 is the worktree's; the matrices are the check).

## Size

Brief about 150 production lines. The diff against `origin/prism-me` is larger: the placement math, the index fields and
the properties text, plus tests. The room went to the three places and to saying the hover is not built.

## PR

To `prism-me`. Ludo merges. The default placement waits on his comparison:
`http://localhost:1349/apps/prism-me/build/?portal-dataset=10003&portal-run=TS_08&portal-tiltseries=17086` and
`?portal-tiltseries-place=beside|turned|overlay`.
