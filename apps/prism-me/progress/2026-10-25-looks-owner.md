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

## Decided

## Learned

## Size

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
