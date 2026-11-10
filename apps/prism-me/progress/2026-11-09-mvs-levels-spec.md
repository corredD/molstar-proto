# Semantic levels and MesoLocation as a union, proposed (2026-11-09, lane `mvs-levels-spec`)

## Brief

David's comments of 2026-11-09, relayed by Ludo:

- "renderer settings: representation types, LOD, quality; this not being in the document might be a mistake. we want to
  be able to define 'semantic LOD' at the document level … including even providing different recipes, data references",
  and "it needs to be part of both Mol\* and the document format".
- "`MesoLocation` should likely be a discriminated union to support pointers to tomograms, segmentations, etc too".

A spec pass, prose only, written as a proposal for David and Ludo to review. No type in `format/doc.ts` or `ir/loci.ts`
changes (the `reference/*.md` tables are generated from the code). Stacked on `me/mesoviewspec` at `1f4b10dad`; no dev
port. Stays off prism.md §5, which lane 4 (`mvs-drive`) edits.

## Written

- **views.md, "Semantic levels"**: two kinds of LOD (semantic, in the document; pixel, the viewer's); the three pieces
  the document already has (`Look.representation`, `detail`, streaming levels 0/1/2); level rules (`select`, `size` in
  projected pixels, `show`: `representation`, `detail`, `source`), document defaults with view overrides, later wins;
  what changes in the runtime, streaming, the adapter and patches; four open questions.
- **mesoql.md, "MesoLocation as a union"**: `copy | label | voxel | point`; MesoLoci with `copies` (today's runs),
  `labels`, `voxels`; regions filter copies; new symbols if agreed; what the type change touches; two open questions.
- **format.md**: "Not in the document" narrowed to quality and pixel LOD, with a link.
- **design.md**: decisions 4, 8 and 12 marked reopened, with pointers; the gaps row on detail per view.
- **renderer-recommendations.md**: R9, level of detail per target.

## Review

Opus reviewer (read-only) on `4e5eea2ea`, then an Opus skeptic on each finding. Fixes in one commit after it (prose
only, no tests apply).

| Finding                                                                      | Severity                  | Verdict                         | Fixed                                                |
| ---------------------------------------------------------------------------- | ------------------------- | ------------------------------- | ---------------------------------------------------- |
| M1 the pick-to-row mapping named as lane 4's (it is lane 3's)                | must-fix (skeptic: minor) | confirmed                       | yes: the reason is `document-model.ts`               |
| M2 MesoLoci's new shape: touch list incomplete                               | must-fix (skeptic: minor) | partly confirmed                | yes: the consumers listed                            |
| S1 `rowOfCopy`, `lociOf` called users of a MesoLocation                      | should-fix                | confirmed                       | yes                                                  |
| S2 `point` has no MesoLoci part; `Annotation.target` overlap                 | nit                       | plausible                       | yes: said, open question 3                           |
| S3 `Box` reused with other units                                             | nit                       | confirmed                       | yes: `VoxelBox`                                      |
| S4 regions and copies: `or`, `not`, `:location` undefined                    | minor                     | plausible                       | yes: open question 2                                 |
| S5 rule merge and precedence unstated                                        | minor                     | plausible                       | yes: field by field; open question 5                 |
| S6 pixels depend on the viewport; hysteresis; per copy vs per target         | minor                     | plausible                       | yes: open question 1                                 |
| S7 a `levels` node in the IR tree vs looks in `IRView`, "no resolver reruns" | should-fix (medium)       | confirmed                       | yes: rules in `IRView`; open question 6              |
| S8 `source` as another recipe changes copy identity                          | minor                     | plausible                       | yes: open question 3                                 |
| S9 `levels` already names streaming's levels                                 | nit                       | confirmed                       | yes: renamed `scales`                                |
| S10 prism.md §5.1 not flagged; R9 cites a proposed behaviour as today's      | minor                     | confirmed                       | yes: noted in views.md and R9; prism.md after lane 4 |
| N1 design.md "neither" should be "both"                                      | nit                       | plausible                       | yes                                                  |
| N2 Lisp example not said to be illustrative                                  | nit                       | refuted (the file's convention) | —                                                    |
| N3 R9 a request, not a finding                                               | nit                       | refuted                         | —                                                    |

## Open

- prism.md §5.1 (representation and LOD viewer-only) is to be edited once lane 4 merges, if David and Ludo agree.
- The questions in views.md "Semantic levels" (6) and mesoql.md "MesoLocation as a union" (3).
