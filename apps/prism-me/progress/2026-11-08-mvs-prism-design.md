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

- `packages/mesoscale/_spec/prism.md` (new, ~740 lines): Prism over MesoViewSpec, modelled on
  `packages/prism/viewer/_spec/sequence.md`. Decisions with alternatives (§1-§4, §8-§10), the operation → patch tables
  (§5), every features.md mesoscale row and ui.md gesture (§6), snapshots and undo (§7), open questions by who decides
  (§11), the eight app lanes' briefs and the base decision (§12).
- design.md §11: decision 6 gets the proposed answer; decision 12 a pointer to the tree (one sentence appended).
- Commits: 320d56288 (prism.md), 208fe2d1e (design.md), then the gate's fixes 87f3db271, 85730a744, ed77184fb,
  18630070f.

## Decided

Each tagged in prism.md; (L) needs Ludo's word, (D) David's, (C) proposed by Claude from the code.

1. Drive, not beside: a document's lists are edited only through patches; other lists as today (C). The spike question
   is answered from the code: the adapter's lists carry the extension's entities, not its groups (`toParticleList`).
2. Patches: Seq\*'s shape, ops by id; looks get `id` and `emissive` (D). Undo stays Prism's checkpoints holding the
   document (custom state `prism-viewer.mesoviewspec`); inverses for the record (C).
3. Loading: `mesoviewspec.open` in a lazy extension whose stub owns the placements transformer; resources through
   Mol\*'s asset manager; one document at a time (L).
4. The tree: compartments, populations, instances, parts from the document; Group by Compartment, Model, Kind (L);
   showing a view is no step, as `snapshot.apply` (D); focus by address, highlight as MesoLoci; Prism's selection not
   used for copies (it takes no particle loci) (C). Move and turn not offered on a document (L). The eye and Show only
   saved in the document (L). Annotations as Prism labels (D).
5. Agent: a `mesoviewspec` skill with nine tools; the mesoscale tools reach documents through the owner port (C).
6. Streaming: the streaming lane's provider and session requests; tile cells behavior-owned and out of checkpoints (C).
7. No `MesoViewerContext`: Prism's state plus a DOM-free `MesoDocumentModel` (C).
8. The base: a PR of `me/mesoviewspec` to `prism-me` first, recommended (L).
9. After the gate (prism.md §11 rows 11-13): `show_meso_view` asks the agent every time (L); part rows read-only in 3D
   until Prism layers select copy runs (L); look ids carry the edit's kind (D). The two checkpoint changes are a library
   lane 0 from master (C).

## Learned

- The undo contract was the hard part: Undo and a step's rollback hold the history lock while the custom state is set,
  so the owner must not call the API during a restore (a deadlock) and must rebuild the adapter from the tree.
- A tour or tile write from a `history: false` run has no history context: each nested call becomes a step. Runs that
  write the tree must be `undoable: false` person runs, or behavior-owned cells.
- `deriveView` lets later looks win, so an edit must move its look last; looks need ids per edit kind.
- `colorLevels` and zoom colors need lists drawn by targets; the adapter draws spacefill.

## Size

~740 lines of spec against ~400-600: the operation and gesture tables (§5, §6) and the undo contract (§7.3, rewritten
after the gate) took the room. No production code.

## Review

Gate on `me/mesoviewspec...HEAD` at 208fe2d1e: an Opus `lane-reviewer` (5 must-fix, 13 should-fix, 4 nits), then an Opus
`lane-skeptic` (2 new findings; M5 lowered to should-fix, S10 to a nit, none refuted whole). A design: each fix is a
spec change, no tests.

| Finding                                                                     | Severity   | Verdict                  | Commit / open        |
| --------------------------------------------------------------------------- | ---------- | ------------------------ | -------------------- |
| M1 owner commits through the API during Undo: deadlock or lost Redo         | must-fix   | confirmed                | 87f3db271            |
| N1 the same on a failed step's rollback                                     | must-fix   | confirmed (skeptic)      | 87f3db271            |
| M2 a look `set` in place loses to later looks                               | must-fix   | confirmed                | 85730a744            |
| M3 tour and tile writes from `history: false` runs become steps             | must-fix   | confirmed                | ed77184fb            |
| M4 sessions need the stub to own the placements transformer                 | must-fix   | confirmed (id corrected) | 87f3db271            |
| N2 a session on a fresh page needs the no-throw apply                       | should-fix | confirmed (skeptic)      | 87f3db271            |
| M5 Move and turn is `stage.move`, `stage.pose`, `stage.scale`               | should-fix | confirmed, lowered       | 85730a744            |
| S1 the tree's other calls (`state.visibility`, `state.remove`, …)           | should-fix | confirmed                | 85730a744            |
| S2 the eye and Show only merge their `(all)` looks                          | should-fix | confirmed                | 85730a744            |
| S3 the divergence mechanism was backwards                                   | should-fix | confirmed                | 85730a744            |
| S4 colorLevels and zoom refused on spacefill lists                          | should-fix | confirmed                | 85730a744            |
| S5 part looks are partial (not drawn); expanded labels repeat               | should-fix | confirmed                | ed77184fb            |
| S6 `deriveView` cannot show a view other than `session.view`                | should-fix | confirmed                | ed77184fb            |
| S7 a drag of eyes gives N proposals                                         | should-fix | confirmed                | 85730a744            |
| S8 store retention misses expanded keys and Close                           | should-fix | confirmed                | 87f3db271            |
| S9 "destructive if open" cannot be declared                                 | should-fix | confirmed                | 85730a744            |
| S10 the custom state is stringified whole per checkpoint                    | nit        | partly refuted           | 87f3db271            |
| S11 Cancel has no signal in the runtime                                     | should-fix | plausible                | ed77184fb            |
| S12 `show_meso_view` asks every time                                        | should-fix | confirmed                | 85730a744            |
| S13 lane order, files shared with the streaming lane and between lanes 3, 4 | should-fix | partly confirmed         | 18630070f            |
| Nits: instance label, `area.highlight`, `IRLook` file, missing alternatives | nit        | confirmed where checked  | ed77184fb, 18630070f |

Left open: none of the findings; the questions of prism.md §11 wait for Ludo and David.
