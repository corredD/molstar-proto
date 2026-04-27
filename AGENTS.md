# AGENTS.md

## Purpose

This repository is a Mol* or Mol*-derived TypeScript codebase.

Act like a careful maintainer, not a code generator in a hurry.

Primary goals:
- preserve Mol* architecture and mental model
- prefer small, reviewable diffs
- keep rendering, state, data parsing, and UI concerns separated
- maintain strict TypeScript quality
- avoid surprising behavior changes
- validate changes before finishing

When in doubt, choose the solution that is most consistent with existing Mol* patterns already used in nearby files.

## What Mol* values architecturally

Mol* is not just a viewer widget. It is a plugin/state/rendering stack.

Important design principles:
- Prefer official Mol* abstractions before inventing new ones.
- Use `Viewer` only for simple embedding and high-level control.
- Use `PluginContext`, managers, behaviors, and state transforms for custom behavior.
- Think in terms of state tree updates and transforms, not ad hoc imperative mutations.
- Keep serializable state and reproducible loading flows where practical.
- Respect separation between:
  - data loading / parsing
  - model creation
  - plugin state transforms
  - representation / rendering
  - UI wiring
- Reuse existing utilities, helpers, and patterns from nearby Mol* modules before creating new abstractions.

Do not bypass the plugin/state model with DOM hacks or global mutable state unless there is a very strong reason and the codebase already does it that way in the same area.

## How to approach tasks

For small tasks:
1. inspect the nearest relevant files first
2. follow local conventions
3. make the smallest correct change
4. run the narrowest useful validation
5. summarize what changed and any risks

For larger tasks, or anything touching architecture, rendering, async loading, state transforms, file formats, or multiple modules:
1. make a short plan first
2. identify the exact layer to modify
3. prefer one architectural change over scattered patches
4. keep a clear boundary between core logic and UI glue
5. validate with build, lint, and targeted tests

If requirements are ambiguous, do not silently invent product behavior. Infer from surrounding code, comments, docs, and existing patterns. If still ambiguous, implement the least invasive option and state assumptions clearly.

## Repository mental model

Assume the repository follows common Mol* layout unless the local tree shows otherwise.

Typical layers:
- app or viewer entrypoints:
  - `src/apps/...`
- plugin and UI integration:
  - `src/mol-plugin/...`
  - `src/mol-plugin-ui/...`
- core data/model/format logic:
  - `src/mol-model/...`
  - `src/mol-io/...`
  - `src/mol-state/...`
  - `src/mol-task/...`
  - `src/mol-util/...`
- extensions and custom features:
  - `src/extensions/...`
- servers and preprocessing tools:
  - `src/servers/...`

When editing:
- keep parsing / schema / format logic out of viewer-only files
- keep representation behavior out of unrelated UI components
- keep one-off app logic out of reusable core modules unless reuse is intended
- if adding a new feature, place it in the narrowest layer that can own it cleanly

## Rules for Mol* and Mesoscale-style customizations

If this repo adds custom work on top of Mol*, such as Mesoscale Explorer behavior, custom volume loading, story state, large-scene handling, annotation overlays, or domain-specific representations:

- prefer extension points and dedicated modules over patching unrelated core files
- isolate app-specific behavior from general-purpose library code
- avoid hard-coding dataset assumptions in reusable components
- keep custom loaders, preset builders, and state helpers composable
- for large scene or trajectory features, favor incremental loading and existing manager/state mechanisms
- do not regress generic viewer behavior to satisfy a single custom workflow

If you must patch upstream-style core code, explain why an extension or wrapper was insufficient.

## TypeScript and code style

Write TypeScript that fits strict Mol* conventions.

Required:
- use explicit, strong typing for public functions, exported values, and non-trivial locals
- avoid `any`; if unavoidable, isolate it and document why
- prefer `const`; use `let` only when reassignment is required
- never use `var`
- use named exports only
- do not add default exports
- keep functions small and composable
- avoid unused locals, dead branches, and commented-out code
- use single quotes
- preserve existing import style in touched files
- match local naming and file organization conventions

Do not weaken type safety, disable lint rules casually, or add broad escape hatches just to make code compile.

## State, transforms, and data flow

When changing behavior, first ask:
- Should this be a state transform?
- Should this be a manager action or behavior?
- Should this live in app wiring instead of core state?
- Is there already a similar pattern elsewhere in the repo?

Prefer:
- state transforms for reproducible data-to-object pipelines
- managers/behaviors for interactive and lifecycle-driven logic
- serializable state when the workflow benefits from persistence or replay
- task-based async flows where the surrounding code uses them

Avoid:
- hidden side effects during import or module initialization
- duplicating state in both UI and plugin layers without a clear reason
- direct object mutation when a state update or builder pattern is already used nearby

## Performance and rendering guardrails

This codebase often handles large structures, trajectories, or volumes.

Therefore:
- avoid unnecessary allocations in hot paths
- avoid repeated heavy computations inside render-time or interaction-time code
- preserve lazy loading and streaming behavior where present
- do not introduce broad recomputation if a local invalidation/update is possible
- be careful with loops over large selections, volumes, or trajectories
- do not import large app/viewer surfaces into narrow utility code
- avoid adding dependencies for problems already solved inside the repo

If a change may affect performance, mention the likely hotspot and keep the implementation conservative.

## UI changes

For UI work:
- keep business logic out of React components where practical
- prefer existing controls, managers, command patterns, and UI helpers
- match existing labels, naming, tone, and interaction patterns
- avoid visual churn unrelated to the task
- do not rewrite a working component just to modernize style unless requested

## File formats, schemas, and data loading

When touching file formats, CIF schemas, trajectories, maps, or custom loaders:
- do not guess format semantics
- preserve backward compatibility when possible
- keep parsing logic separate from visualization policy
- add or update representative tests for edge cases
- document assumptions near the parser or transformer
- avoid burying format-specific fixes inside generic viewer code

## Dependencies

Before adding a new dependency:
- first check whether the repo already contains a utility for the same need
- prefer existing Mol* utilities and platform APIs
- justify any new runtime dependency in the final summary
- do not add a dependency for trivial formatting, collection helpers, or one-off wrappers

## Editing strategy

Prefer:
- targeted edits
- preserving surrounding style
- minimal public API changes
- compatibility with existing callers
- updating nearby tests/docs when behavior changes

Avoid:
- drive-by refactors
- broad renames without strong reason
- mixing formatting-only changes with logic changes
- changing unrelated files to satisfy personal style preferences

## Validation and done criteria

A task is not done until the relevant validation has been attempted and the result is reported honestly.

When available, use the narrowest meaningful commands first, then broader ones if needed.

Typical validation order:
1. targeted tests for touched logic
2. type/lint checks
3. focused build for the touched app/package
4. broader repo build only when needed

For Mol* upstream-style repos, likely useful commands include:
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run dev`
- `npm run dev:viewer`

Before finishing:
- confirm changed files compile or lint cleanly when practical
- mention commands actually run
- mention commands not run
- mention any assumptions, limitations, or follow-up work

Do not claim success without validation.

## Final response format

When you finish a task, include:
1. what changed
2. why this location/architecture was chosen
3. validation performed
4. risks, assumptions, or follow-ups

Keep it brief, concrete, and reviewer-friendly.

## For reviews

When asked to review code:
- prioritize correctness, regressions, state-model violations, async/task issues, performance risks, and API compatibility
- call out architectural mismatch with Mol* patterns
- distinguish clearly between must-fix issues and optional polish
- do not request unnecessary refactors

## Local overrides

If a deeper directory contains another `AGENTS.md`, follow the deeper file for that subtree in addition to this one.

Recommended subdirectory overrides in larger Mol* repos:
- `src/apps/viewer/AGENTS.md`
- `src/extensions/AGENTS.md`
- `src/mol-plugin/AGENTS.md`
- `src/servers/AGENTS.md`

These should only add local rules, not repeat this file.