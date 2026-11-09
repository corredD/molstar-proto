# Prism over MesoViewSpec: the design (2026-11-08, lane `mvs-prism-design`)

## Brief

- **Asked** (Ludo, 2026-11-08: "we need another orchestration for making it usable like Seq\*"; scope "both, app first";
  base "library lanes only for now"). The design that makes MesoViewSpec usable in prism-me the way
  `packages/prism/viewer/_spec/sequence.md` makes Seq\* usable: written now, built by later app lanes once the base is
  decided. **Check:** Ludo reads `packages/mesoscale/_spec/prism.md` and can answer, for each thing a person does in
  prism-me's mesoscale UI today (`apps/prism-me/_spec/features.md` rows 13-39), what it becomes with a MesoViewSpec
  document; and he gets the app lanes' briefs, sized, ready to start.
- **Spec:** a new `packages/mesoscale/_spec/prism.md` (Prism over MesoViewSpec), modelled on
  `packages/prism/viewer/_spec/sequence.md`; design.md §11 decision 6 (patches) gets a proposed answer, decision 12
  (organization at the top) is noted where the app depends on it.
- **Decides (each with the alternative and why):**
  1. **Drive, not beside:** does a MesoViewSpec document drive `packages/extensions/mesoscale`'s operations
     (`mesoscale.style`, `.colors`, `.entities`, `particles.look`, the Scene tree), each operation becoming a patch to
     the document, or do the two coexist? A table: every mesoscale operation → the patch it proposes (or why it stays
     viewer-only, "interaction is the viewer's").
  2. **Patches** (decision 6): Seq\*'s "a viewer proposes patches; the document's owner commits them"
     (`packages/sequences/_spec/format.md`) vs whole documents with `classifyEdit`; how Undo spans the document and the
     Prism state (sequence.md's undo section is the model).
  3. **Loading:** a `.mesoviewspec.json` / `.mesoviewspec` (S-expression) dropped or opened; resources it names (the
     cellPACK recipe, meshes, picks) found how; a runtime chunk loaded only when a document is opened (as sequence.md
     §2).
  4. **The Scene tree from the document:** compartments, populations, instances, superstructures (parts), models; views
     and tours in the UI; the semantic camera on "Focus" from the tree; selection and hover as MesoLoci both ways.
  5. **Agent tools:** which tools the viewer's agent (`packages/prism/viewer/_spec/agent.md`) gets: load a document,
     select by MesoQL, set a view, focus, edit a population, with the MesoQL skill (lane `mvs-skill-cli`).
  6. **Streaming:** where the `mesoviewspec-streaming` lane's provider and budget plug in.
  7. **The headless context:** whether a `MesoViewerContext` (state, selection, commands; as `SeqViewerContext`) is
     needed in `packages/mesoscale/molstar`, or Prism's viewer state is enough.
- **Then:** the briefs of the app lanes (each: Ludo's check in the app, spec section, tests, touches, size, model), in
  the order to build them; and what the base decision (PR of `me/mesoviewspec` vs stacking) changes for them.
- **Tests:** none required (a design). A spike is allowed only to answer a question the code cannot (e.g. whether the
  adapter's lists can be the mesoscale extension's entities); a spike stays in a throwaway branch and its answer goes in
  the doc.
- **Touches:** `packages/mesoscale/_spec/prism.md` (new), design.md §11 (decisions 6 and 12, a few lines). Reads, never
  edits: `packages/extensions/mesoscale`, `packages/prism/viewer` (`_spec/sequence.md`, `agent.md`, `operations.md`,
  `state.md`), `apps/prism-me`, `packages/sequences/_spec`. **Stays off:** the streaming lane's files (`format/doc.ts`,
  `validate.ts`, `runtime/streaming.ts`, `molstar/src/session.ts`, stories, design.md §6.8).
- **Size:** ~400-600 lines of spec, no production code.
- **Lane model:** Opus (the lane is design).
- **Steps and models:** 1. read the specs and the mesoscale extension's operations (Sonnet subagent: an inventory table
  of every operation, its params, who calls it) 2. design and write prism.md (Opus) 3. the app lanes' briefs (Opus) 4.
  gate: a reviewer reads prism.md against sequence.md and the extension's code for gaps and contradictions (Opus), a
  skeptic.

## Built

## Decided

## Learned

## Size

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
