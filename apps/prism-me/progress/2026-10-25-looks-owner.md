# One owner for the particle looks (2026-10-25, lane `looks-owner`)

## Brief

- **Asked** (Ludovic, [../TODO.md](../TODO.md) `Next`, from [../\_spec/architecture.md](../_spec/architecture.md) §7.1):
  a single operation writes a particle representation's Layers cell; mesoscale's styles, cryo-ET's hidden classes and
  Prism's partial cuts call it. **Check:** color an entity, hide a class, cut the model partly, then undo three times:
  each undo takes back exactly one of them, and none drops another.
- **What the coordinator found** (read-only scoping, 2026-10-25): undo is already one step per top-level operation
  (`packages/prism/ui/src/managers/history.ts:13-28`; commits inside a run and `ctx.api` calls join it), so
  architecture.md §5.2 is wrong on that and this lane corrects it. The losses are on the forward path, writers rewriting
  what they did not write:
  - mesoscale `style`/`colors`/`importColors` (`packages/extensions/mesoscale/src/operations.ts:232, 283, 327`) go
    through `readStyles` (:838), which reads `representations[0]` only, keeps single-id layers only and keys entity N
    and target N alike, then `toLayers` (:859) replaces the whole `layers` array on every representation;
  - cryoet `leaveOut` (`packages/extensions/cryoet/src/operations.ts:1227-1251`, from `ensureTargetRepresentation`
    :1189) replaces `hidden` in its own builder; `addRepresentation` (:1254) adds a target representation without the
    list's looks;
  - Prism `addParticleCut`/`removeParticleCut` (`packages/prism/viewer/src/sources/clipping/particles.ts:53-75`, from
    `features/clipping/operations.ts:683-684`) use the cuts read at build time;
  - three rules for deleting the cell when empty, each its own field list (:902, :1244, :73);
  - the row eye on a class (`apps/prism-me/src/explorer/rows.ts:313`) passes target ids as `entities` (architecture
    §5.3).
- **Design:** in Prism (clipping is Prism's and must call the same code), as its own upstreamable commit (the layers
  stack is on `prism-me` only, `0e8772ffc`, `d0490334f`, so it goes upstream with it):
  - `packages/prism/viewer/src/sources/particles/look.ts`: `patchParticleLook(state, builder, repr, patch)`, the only
    code that creates or deletes the cell;
  - `particles.look` in `packages/prism/viewer/src/features/particles/operations.ts` (and its lazy stub,
    `features/lazy/index.ts`), on every representation of the list in one `updateTree`, "already so" when nothing
    changes;
  - params, each absent field kept:
    `{ particles, representation?, layers?: { selector: { entities?, compartments?, targets? }, visible?, color?: Color | null, transparency?: number | null, emissive?: number | null, reset?: boolean }[], hidden?: number[], cuts?: { add?: ParticleCutProps[], remove?: string[] } }`;
    a layer keyed by its kind and sorted ids, indexed once in a Map; `null` clears a field;
  - mesoscale's `writeLayers` and cryoet's `leaveOut` become `ctx.api.run('particles.look', …)` (through `ctx.api`, so
    one undo step); clipping's `commit` calls the helper in its own `updateTree`; `rows.ts:313` passes `targets`.
- **Spec:** architecture.md §5.2 (undo is one step; the losses are writes), §5.3 if the eye fix closes it, §7.1 (built);
  `features.md` rows that change; Prism's spec for `particles.*` operations if it lists them.
- **Tests** (headless, `createPrismViewerHeadless`, each fails first on today's code where it is a fix):
  - `packages/prism/viewer/src/features/particles/_test/look.test.ts`: merge by key; `null` clears; one writer's field
    leaves another's; only the helper deletes the cell; one undo step per call;
  - `packages/extensions/mesoscale/src/_test/one-owner.test.ts`, Ludovic's check on the mesoscale fixture with the op
    ids the UI drives (`mesoscale.style` color an entity; a class hidden by `targets`; `clipping.add` on the particles):
    all three present on every representation after each step, then three undos, exactly one gone each; and the other
    order (cut, then reset the color: the cell survives);
  - cryoet `operations.test.ts`: decorate keeps an earlier color and an earlier cut;
  - `packages/prism/viewer/src/features/particles/_test/look.scaling.ts` (n and 4n layer patches, a quadratic control;
    `test:scaling` exists); `mesoscale/src/_test/import-colors.scaling.ts` still passes.
- **Touches:**
  `packages/prism/viewer/src/{sources/particles,features/particles,features/clipping,sources/clipping,features/lazy}`,
  `packages/extensions/mesoscale/src/operations.ts`, `packages/extensions/cryoet/src/operations.ts`,
  `apps/prism-me/src/explorer/rows.ts`, the specs above. **Stays off:** `apps/prism-me/src/explorer/ui.tsx` and
  `measure.ts`, `ui.md` §7 (lane `measure-hint`).
- **Size:** ~+170 / −90 production lines (helper ~90, op ~60, clipping +10/−25, mesoscale +25/−40, cryoet +8/−22); tests
  ~250.
- **Steps and models:** 1. read the writers and the layers stack (Opus) 2. the helper, the op and its tests (Opus, a hot
  path) 3. switch the callers (Opus) 4. checks (Sonnet) 5. the gate (Opus reviewer, skeptic).

## Built

- **Prism** (`8f86ecf94`, upstreamable with the layers stack, no extension named):
  `patchParticleLook(b, reprRef, patch)` in `packages/prism/viewer/src/sources/particles/look.ts`, the only code that
  applies, updates or deletes a `ParticleRepresentation3DLayers` cell. It reads the builder's tree (`b.currentTree`), so
  a cell applied earlier in the same builder is the one patched. Layers keyed by their selector's three sorted id lists,
  indexed once in a Map; an existing key replaced in place, a new one appended; `reset` drops the layer first, `null`
  clears a field, a layer left with no change goes; `hidden` replaced (sorted, deduped); cuts added (same tag replaced)
  or removed by tag; the cell deleted when nothing is left; `false` ("already so") when nothing changes.
  `particles.look` runs it on every representation of a list (or by type, or by node selector) in one `updateTree`
  (agent-only surface: no command form; `layers`, `hidden`, `cuts` all `OptionalParam`, so absent stays absent).
  Clipping's `commit` calls the helper; `addParticleCut`/`removeParticleCut` gone. Lazy stub and `_spec/operations.md`
  updated.
- **mesoscale** (`8002eb494`): `style`, `colors`, `importColors` send per-entity patches to `particles.look` (by entity,
  or by target on a list without entities); `colors` theme scheme is `color: null`, reset is `reset: true`; failures and
  "already so" pass through. `readStyles` (now only the reader for `mesoscale.entities`) keeps only the kind it writes.
  `toLayers`/`writeLayers` gone.
- **cryoet** (`a6d9e5110`, `5ee18f1ac`): `leaveOut` calls `particles.look` by node (`#a, #b`) with `hidden`;
  `addRepresentation` (the decoration's target representation, or the spheres added back) goes through
  `particles.representation`, which gives it the list's layers.
- **After the review:** `particles.representation` copies the first representation's layers onto one it adds
  (`copyParticleLayers`, `91fd804cb`); `particles.look` refuses a malformed patch and dedupes ids; the scaling guard
  reads allocation and covers new layers; Prism wording neutral.
- **App** (`6589c2e42`): the target row's eye (and the menu's Hide on a target) calls `particles.look` with a targets
  selector. Guard (`4c48f728a`): `src/_test/one-look-writer.test.ts`, no apply of the layers transform outside `look.ts`
  in the app, its extensions and Prism's viewer.
- **Specs** (`68212c8b5`): architecture §5.1 built, §5.2 corrected, §5.3 noted, §7.1 built; features.md (hiding row);
  TODO item removed; `.v6/changelogs/looks-owner.md`.
- **Tests:** `look.test.ts` (7: merge by key, null clears, reset, other writers' fields kept, already so, every
  representation in one step with one undo per call, by node); `look.scaling.ts` (2000 → 8000 patches; with a
  `findIndex` per patch it reads ×15.3 and fails); `mesoscale/_test/one-owner.test.ts` (Ludovic's check on two
  representations: color CA, hide class 3 by target, cut NC, one more style write keeps all, four undos each take one
  back; cut then reset keeps the cell; a representation's own `hidden` kept) — failed first on the old code (the class
  hidden by target came back as entity 3's layer); cryoet "decorating keeps an earlier color and an earlier cut, and the
  target representation takes the colors" — failed first (the target representation had no layers); the app's target eye
  test (passes on the old code too: see Decided).

## Decided

- **Helper signature** `(b, reprRef, patch)`, not the brief's `(state, builder, repr, patch)`: it reads the builder's
  tree, so it needs no state and works for a representation added in the same builder (Opus, advisor).
- **`particles.look` takes `node`** (Prism's node selector, `#a, #b`) besides `representation` by type: cryoet's set
  (every representation but the target one) is not one type.
- **New representations take the list's layers**, in Prism's `particles.representation` (review finding 1, must-fix:
  first only in cryoet, so a representation added by hand to a styled list stayed unstyled for good, a regression from
  the old rewrite-everything writes). Not cuts (their clip objects are the representation's own), not `hidden` (the
  target representation must draw the decorated targets). A class hidden before decorating stays hidden on its objects
  (its layer is copied too).
- **`particles.look` is agent-only** (no command form); it validates its patch since agents send raw JSON.
- **The target eye was not a live bug** (§5.3's "likely a bug"): target rows exist only on lists without entities, whose
  mesoscale entities are their targets, so `mesoscale.style` wrote target layers. The eye now calls `particles.look`
  with `targets` anyway, so it does not lean on that rule; the menu's Color on a target still goes through
  `mesoscale.style` (same layer key, so they merge).
- **Undo was already one step per top-level run** (`history.ts`), as the coordinator found: §5.2 corrected, including
  `stage.move` (its `structure.transform` call joins its run).

## Learned

- `StateBuilder.To.update(fn)` runs `fn` on the builder's current params, but a `state.select(...)` before building sees
  only the committed tree: a second writer in the same builder would have made a second cell. The builder's tree is the
  place to read.
- A scaling guard at the helper level (no commit) shows a per-patch scan clearly (×15.3); through the viewer the fixed
  cost hides it at small n.

## Size

Production (no tests, no markdown): **+372 / −160** against the brief's ~+170 / −90. Tests +484, docs +102.

- `look.ts` 224 lines against ~90: the patch rules (key, merge, reset, drop, delete) with their equality helpers (~110),
  the patch's validation for agents (~40, review finding 2), the layer copy for added representations (~20, finding 1),
  comments and types.
- `features/particles/operations.ts` +71 / −9: `particles.look` (op, params, surface) and the copy in
  `particles.representation`.
- mesoscale +49 / −73 against +25 / −40: the writers became one `writeStyles` over patches (the reader kept for
  `mesoscale.entities`, its kind fixed).
- cryoet +17 / −45 (leaveOut and addRepresentation now call operations); clipping +7 / −30.

Nothing of it changes the design; the room went to the validation and to Prism owning the copy (both from the review).

## Review

Opus reviewer (read-only, probes outside the repo), then the Opus skeptic on its findings: 1 must-fix, 6 should-fix, 4
nits, 1 pre-existing note; 10 confirmed, 1 partly (#3), 0 refuted. The skeptic lowered #3, #4, #7 to nits and added two
nits on cryoet's copy (both gone with #1's fix).

| Finding                                                                                                     | Severity         | Verdict   | Commit / open                                      |
| ----------------------------------------------------------------------------------------------------------- | ---------------- | --------- | -------------------------------------------------- |
| 1. A representation added after styling never gets the earlier styles (regression from the full rewrites)   | must-fix         | confirmed | `91fd804cb` (test failed first), `5ee18f1ac`       |
| 2. `particles.look` stores malformed patches; no selector is a raw TypeError; `[2, 2]` and `[2]` two layers | should-fix       | confirmed | `62a377ba9` (test failed first)                    |
| 3. one-owner test's first undo checked nothing directly (emissive-only layer)                               | should-fix → nit | partly    | `2cbfce020`                                        |
| 4. Scaling guard reads no allocation, only the existing-key path                                            | should-fix → nit | confirmed | `4f1fea516`                                        |
| 5. Size well over the brief                                                                                 | should-fix       | confirmed | recorded in Size                                   |
| 6. Spec said the target row's eye; the row has no eye, the menu's Hide calls it                             | should-fix       | confirmed | `ad4755aa2`; the missing show path to TODO.md      |
| 7. Styles on a list with no representation: not-found instead of "already so"                               | should-fix → nit | confirmed | changelog, `ad4755aa2`                             |
| 8. Changelog two headings, not in the Prism commit                                                          | nit              | confirmed | one heading, `ad4755aa2`                           |
| 9. Prism wording names "decorations"                                                                        | nit              | confirmed | `a02fe7fd6`                                        |
| 10. cryoet test's first half passed on the old code                                                         | nit              | confirmed | kept as a guard (noted in Built)                   |
| 11. Extra copies; selectors re-sorted per representation                                                    | nit              | confirmed | copies `9763ac72d`; re-sort left (R small, linear) |
| Pre-existing: a particle cut toggled off and on per representation loses its particles                      | note             | plausible | TODO.md backlog                                    |
