# Storybook mocks of the explorer (2026-10-25, lane `explorer-mocks`)

## Brief

- **Asked** (Ludovic, 2026-10-24, Stage 2 of the architecture work): mocks of the explorer in Storybook, the reference
  the app is held to, as David works (architecture first, Storybook mocks as the reference). They decide refactor in
  place or prism-me-v2 ([../\_spec/architecture.md](../_spec/architecture.md) §7.6). **Check:** open Storybook at
  `prism-me/Explorer/…`, see each place of [../\_spec/ui.md](../_spec/ui.md) mocked in light and dark, wide and narrow;
  read the comparison table below and decide.
- **Spec:** [../\_spec/ui.md](../_spec/ui.md), every section (layout, opening, tree, properties, right-click,
  distances); a mock that shows a gap or a contradiction in ui.md notes it below (Decided), it does not change ui.md.
- **What a mock is:** pure. Prism's UI primitives (`packages/prism/ui`: virtual list, params, select, color,
  action-footer, scroll-area, context-menu, choices, tooltip, icon) with rows and params made in memory; no viewer, no
  plugin, no import from `apps/prism-me/src/explorer/*` (types only), so the mocks show the target, not today's code. A
  primitive Prism lacks for the design is a finding (the table's notes), not a home-made control.
- **Stories:** one per ui.md section: Layout (the panel beside a canvas placeholder), Opening (+ Open, the empty tree),
  Tree (loaded; a model with thousands of entities, virtualized; group by compartment and by function; clips, labels and
  distances as rows), Properties (one per row kind: structure, entity, model, group, particle list, target, volume and
  its slice/isosurface, mesh, clip, label, distance), Right-click (one per pick kind), Distances. Each in light and
  dark, wide and narrow; a row's hover actions and `@media (hover: none)`.
- **Wiring:** register `apps/prism-me` in `storybook/packages.ts` (group `prism-me`, the CSS modules plugin as
  `packages/prism/viewer`'s if the mocks have CSS); stories in `apps/prism-me/src/_stories/`. Prism's tokens and styling
  rules (styling.md §4, §5); `styles:check`-clean values.
- **Tests:** the stories build (`storybook` build or its typecheck), `npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`,
  `pnpm lint`, `pnpm format:check`, `pnpm check:workspace`. No unit tests: mocks only.
- **The deliverable** beside the stories: the table under Built, ui.md section → story → the app today at :1343 (same /
  differs / missing) with a note each, and a closing paragraph: what the gap says for refactor vs v2.
- **Touches:** `apps/prism-me/src/_stories/*`, `storybook/packages.ts`, `apps/prism-me/package.json` if Storybook needs
  it, this file, a changelog `.v6/changelogs/explorer-mocks.md`. **Stays off:** `apps/prism-me/src/explorer/*`, the
  extensions, Prism.
- **Size:** ~900 production lines (stories and fake data).
- **Steps and models:** 1. read ui.md, styling.md, the foundations story and the primitives' stories (Opus) 2. fake data
  and the Storybook wiring (Sonnet) 3. the stories (Opus) 4. the app at :1343 against them, the table (Opus, browser) 5.
  checks (Sonnet) 6. the gate (Opus reviewer, skeptic; the UI-foundations check).

## Built

## Decided

## Learned

## Size

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
