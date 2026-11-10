# Prism over MesoViewSpec

How prism-me opens, shows and edits a MesoViewSpec document: what the document owns, what Prism owns, how an edit in the
Scene tree becomes a patch, how Undo spans both, and the app lanes that build it. Modelled on
`packages/prism/viewer/_spec/sequence.md` (Seq\* in the Prism viewer). The format, IR and runtime are
[design.md](design.md)'s; the renderer findings are [renderer-recommendations.md](renderer-recommendations.md)'s.

- **Status:** a design (lane `mvs-prism-design`, 2026-11-08); §12 is the build. Built: §1.1's owner, §3, §5.3's open,
  close, get, edit and save, §7.1 and §7.3 (lane `mvs-open`, 2026-11-09); §4.1-§4.3, §4.5, §4.6, and §5.2's eye and Show
  only on a document's rows (lane `mvs-tree`, 2026-11-09). What differs is said where it does.
- **Who decides:** each decision is tagged **(Ludo)** when it is the app's or the base's, **(David)** when it changes
  the format, **(proposed)** when it follows from the code and the specs. §11 lists what waits for a word.
- **Reading of the brief:** "features.md rows 13-39" is read as the whole _Mesoscale_ section of
  `apps/prism-me/_spec/features.md` plus the opening rows that bring a mesoscale scene (cellPACK, PetWorld, examples,
  sessions, the URL). §6 covers every one of them, and every gesture of `apps/prism-me/_spec/ui.md` §3-§5.

## 1. One owner, one viewer (decision 1: drive, not beside)

- **The document drives the lists it makes.** A MesoViewSpec document opened in prism-me is the one source of what its
  particle lists show: which copies, where, in which colors, visible or not. Every edit a person or the agent makes to
  such a list that the document can say is a **patch** to the document (§2). The runtime derives the view, and the Prism
  adapter (`PrismMesoAdapter`, [runtime.md](runtime.md)) writes it as Prism layers. Nothing writes those layers beside
  it. **(proposed)**
- **A document list is known by its source.** `toParticleList` (`packages/mesoscale/molstar/src/particle-list.ts`) sets
  `sourceData.kind: 'meso-view-spec'` and the set's key as `sourceData.name`. That is the hook: an operation that meets
  such a list asks the document's owner (§1.1) instead of writing the list.
- **Every other list is as today.** A cellPACK or PetWorld model (`mmcif_particles`), a STAR, Dynamo, EM or NDJSON list,
  a Simularium file: the mesoscale extension's operations write their layers as now (`mesoscale.style` →
  `particles.look`). Nothing in this design changes them.
- **The alternative, beside:** the extension's operations keep writing `particles.look` on document lists too, and the
  document only seeds the first look. Refused, for three reasons the code shows:
  - **Silent divergence.** Prism patches a list's layers by selector (`patchLayers`,
    `packages/prism/viewer/src/sources/particles/look.ts`): `mesoscale.style` writes `{entities: [i]}` layers, the
    adapter `{targets: [i]}` ones. A style layer, pushed after the adapter's, stays and shadows every later color the
    document gives that type, until a re-pack makes a new list. The document says red, the screen shows blue, and
    neither side knows.
  - **Saving loses the work.** The person's colors and eyes would live only in Prism's layers; the saved document (the
    thing to share, diff and trace, design.md §1) would not have them.
  - **The extension's model is not the document's.** `toParticleList` sets `entities = targets = types`: each list
    numbers its types 0..n, so ids collide across lists (one list per placement set, one set per model). It sets no
    `compartments` or `compartmentInfo`, so `mesoGroups` (`packages/extensions/mesoscale/src/model.ts`) gives a flat
    list per model. A document's compartment spans several models. So the extension's per-list entities and groups
    cannot be the document's tree (§4); the document's own sections are.
- **This answers the brief's spike question without a spike:** the adapter's lists can carry the extension's entities
  (one entity per type, its label the population's), so the extension's reads still work on them; they cannot carry its
  groups, and they should not carry its writes.

### 1.1 The owner

- **`MesoDocumentModel`** (proposed, `packages/mesoscale/molstar/src/document-model.ts`, exported from
  `@molstar/meso-molstar`) holds the open document: `doc`, `revision`, the `MesoSession` (runtime cache, IR, issues,
  counts, edit records), the adapter, the shown view (§4.4). It commits patches (§2.3). It takes the viewer's API, a
  loader and a scheduler as plain arguments: no DOM, testable on a headless Prism viewer, as the adapter's medium tests
  are.
- **One document at a time** **(Ludo)**: opening a second asks, then replaces the first (`destructive`, as `load.mvs`).
  Why: the format has one id namespace a document ([format.md](format.md)); two open documents would need ids qualified
  by document in every address, row and patch. Seq\*'s precedent is one structure at a time (sequence.md §3). The
  alternative, several documents keyed by id, waits for a case that needs it.
- **The owner port in the mesoscale extension** (proposed):
  `ParticleListOwner { owns(list): boolean; info(list, groupBy); propose(edit): Promise<OperationResult> }`, registered
  on the `mesoscale` area by the `mesoviewspec` extension. `mesoscale.style`, `.colors`, `.importColors`, `.theme` and
  `.entities` call it first for each list they touch; an owned list's edit becomes the owner's patch, inside the same
  run (so one step). The extension imports nothing of `@molstar/meso-*`; the owner is the only bridge.

## 2. Patches (decision 2; design.md §11 decision 6)

### 2.1 The patch

Seq\*'s, as `packages/sequences/_spec/format.md` § Patches states it, over the MesoViewSpec document **(David)**:

```
{ format: "meso_view_spec_patch", base?: <revision>, revision?: <revision>, ops: [...] }
```

- **Ops by id:** `set` (a shallow merge of a node's fields; `null` removes a field, back to its default), `remove` (the
  node; no cascade), `insert` (a node into a section or a list, after a sibling id, `"first"` or `"last"`, never a
  number), `move`. A node is any object with an `id`: a section item (entity, compartment, population, instance, model,
  view, tour, …) or a view's look or annotation (§2.2). `set` never changes a node's `kind` or `id`.
- **Top-level fields** (`session`, `metadata`, `units`) are set with `set` on the reserved id `document`.
- **All or nothing.** Shapes first, then the ops in order, then the result validated (`format/validate.ts`, phase
  `static`). Any error leaves the document as it was; issues are pathed `/ops/<k>`.
- **No cascade:** removing a population a model or a look names leaves a dangling reference; validation refuses the
  patch. The caller removes what refers to it in the same patch.
- **Inverse and diff:** applying returns the inverse; `diff(a, b)` gives the patch from `a` to `b`, nodes matched by id.
  Untouched sections are shared, so a look edit on a 200k-copy document copies one view.
- **The S-expression spelling** prints a patch as it prints a document ([format.md](format.md)):
  `(patch :ops [(set v.cell …)])`. The agent and the History list read that.
- **Where:** `packages/mesoscale/spec/src/format/patch.ts` (`applyPatch`, `diff`, `classifyPatch`, `printPatch`,
  `readPatch`), no Mol\* import (the Biome rule). As built:
  - `kind`, in `set`, is the node's field (an entity's `protein`, a relation's `binds`) as well as its section: `set`
    refuses `id` and `kind`; a node whose kind changes is replaced (`remove` and `insert`; `diff` writes that).
  - `insert` and `move` name a section (`parent: 'views'`) or a view's list (`parent: 'v.x', list: 'looks'`); a node
    that brings a look or annotation id the document has is refused; `document` is no node id, `metadata` is not
    removed.
  - The inverse of an edit that cannot be anchored (the look before it has no id) sets the view's whole `looks`; a list
    that empties and returns goes back where the field order (doc.ts) has it, so an inverse restores the bytes.
  - Shapes are checked op by op as it applies (the first error is the one reported), not all before the first.
  - `classifyPatch(doc, patch)` reads the cost of a patch from its ops; `classifyEdit` ignores `revision`.

### 2.2 What a patch can name: two format additions

A ref patch needs a target, and two edits the UI makes have none today **(David)**:

- **Looks get an `id`** (optional in the format; the viewer always writes one). `Look` has no id (`format/doc.ts`), and
  Seq\*'s rule is "anchors are refs, never numbers". Without one, "make catalase red" cannot be told from "the third
  look", and an undo of the second of two edits would remove the wrong one. A look without an id (hand-written) is
  addressed through its view: the viewer rewrites the view's looks with ids in its first patch of that view (one `set`
  of `looks`).
- **Looks get `emissive`** (0-1, as `transparency`). Prism's look has it (`mesoscale.style` `emissive`); the document
  does not. The alternative, keeping emissive viewer-only, loses it on save and splits one look across two owners.
- Tour steps and catalog rows have no id either; nothing the UI does edits them one by one (a tour is replaced whole).

### 2.3 The owner commits

- **A viewer proposes; the owner commits** (Seq\*'s principle, `packages/sequences/_spec/README.md` § Principles). In
  prism-me the owner is `MesoDocumentModel`; the operation that proposes is `mesoviewspec.edit { patch }` or one of the
  helpers that build a patch (`mesoviewspec.look`, §5). The owner applies it, keeps the inverse for the record, sets a
  new `revision`, then runs the session's edit.
- **What it costs** is read from the ops, not from hashing: a patch that touches only `views`, `tours`, `session` and
  `metadata` is a **view** edit (`updateView`, no resolver, O(types)); one that touches a population, a model, a
  compartment, an entity, a resource or a frame is a **model** edit (`compile` with the session's cache: only the models
  whose projection changed resolve). `classifyEdit` stays the check for whole documents (an open, an undo).
- **A refused patch changes nothing** and says why (the validation's issues, in the operation's result).
- **The adapter runs inside the operation.** Today it writes through `viewer.api` and `plugin.state.data.updateTree`
  directly. Under a step it must use the operation's `ctx.api` (the step's history context, sequence.md §7.3 "Inside a
  step") for `particles.representation` and `particles.look`, and its own tree updates happen inside that run, so they
  are part of the step and not "changes outside the API" (which would mark every checkpoint unsafe).

### 2.4 Undo: the alternative of inverses

Undo stays Prism's one history (§7), with checkpoints that hold the document. The inverses are kept for the record
(journal.md: each step names its patch and inverse) and for a later "Changes" list, not for Undo. The alternative, Undo
by inverse patches, would be a second history beside Prism's: an undo that crosses a clip (Prism's) and a look (the
document's) would need both in step. Seq\* in Prism made the same choice (sequence.md §7.1: the edits overlay is in the
checkpoint, not undone by inverse).

## 3. Loading (decision 3)

- **`mesoviewspec.open`** (`network` with `addresses`; `destructive` when a document is open): a URL, a file, or data.
  `.mesoviewspec.json` (JSON) or `.mesoviewspec` (the S-expression, `readData` in `format/sexpr.ts`). The URL parameter
  `?mesoviewspec=<url>` (`apps/prism-me/src/url.ts`). A file dropped or picked in + Open › Files… goes to it by its
  extension or, for `.json`, by `"format": "meso_view_spec"` (the lazy stub's `sniff`, as the particles feature sniffs
  mmCIF).
  - As built (`mvs-open`): the drop reaches it through the stub's `owns.opens` (viewer-spec.md §3), a Prism addition:
    `load.files` hands the document its drop's other files and opens none of them as data (those the document does not
    name are said in the result). `open` is always `network` (§5.3): the agent's is refused while a document is open;
    the person's replaces it (undoable) without asking yet (open). `addresses` lists the URL and every absolute address
    in a document given as data; a URL's own resource hosts are not known before it is read. A relative URL is made
    absolute against the page; `fixture://x` reads as `fixtures/x` beside the document (the CLI's rule). An accession
    with no `uri` is not resolved yet (the model is unavailable).
- **A runtime chunk.** `@molstar/meso-spec` (format, runtime, resolvers) and `@molstar/meso-molstar` (adapter, owner)
  are a lazy viewer extension, `mesoviewspec`, whose stub declares its operations, commands, sniff and skill
  (viewer-spec.md, lazy extensions). Nothing of it loads at start; the first open loads it (sequence.md §2's runtime
  chunk). The stub lives in `packages/mesoscale/molstar/src/prism-viewer.ts`; prism-me adds it in
  `apps/prism-me/src/extensions.ts`.
- **Resources** (`resources[].uri`) are read through the runtime's `options.load(resourceId)`:
  - a relative URI resolves against the document's own URL;
  - bytes come through Mol\*'s asset manager (`packages/core/src/util/assets.ts`), so a recipe, mesh or STAR file the
    viewer already fetched is fetched once (sequence.md §2, "Bytes, in core");
  - a dropped document's relative URIs are the files dropped with it, by name; one missing is an unavailable input
    ([runtime.md](runtime.md): the model fails with its cause, the rest is drawn), and the issue says to drop it with
    the document;
  - an `accession` with no `uri` (`pdb-id`) is resolved by the known services, as `load.entry` is.
- **The network policy reads the document first.** `addresses(values)` lists the document's URL and every resource host,
  so the agent's policy (agent.md §4) asks for an unknown host before anything is fetched.
- **The resolvers run where the runtime runs**: on the main thread in this design. A long resolution shows in the status
  pill as a Mol\* task, with Cancel: the session's edit is dropped when it ends and nothing changes (the step's
  rollback). Stopping the work early needs a signal the runtime does not take today (`RuntimeOptions`, the resolvers);
  lane `mvs-model-edits` adds one. A worker is a later lane, not designed here.
- **The alternative, the viewer's loaders** (`load.files`, `load.url` with a `mesoviewspec` format): a document is not
  one data cell but a description that resolves into several lists, with a cache and an owner; a format provider has
  neither. The sniff routes a dropped document to `mesoviewspec.open` instead, as `load.svs` is its own operation
  (sequence.md §6).
- **Not a loader of everything.** A cellPACK `.bcif` is still `mmcif_particles` (§1). Turning a cellPACK model into a
  document (`importCellpackGpuRecipe` exists for cellPACKgpu's serialized recipes, [runtime.md](runtime.md)) is an
  import, not an open; out of this design.

## 4. The document in the Scene tree (decision 4)

### 4.1 Rows

The document is one item of the **Particles** category (ui.md §3), named by its `metadata.title`, its count the copies
drawn. Under it, its parts, made from the document and the IR, not from the lists:

| Row         | From                                                                    | Its address (MesoQL)        | Count                               |
| ----------- | ----------------------------------------------------------------------- | --------------------------- | ----------------------------------- |
| compartment | `compartments[]`, nested by `parent`                                    | `(in c.x)`                  | copies in it and nested             |
| population  | `populations[]`, under its compartment; label: its entity's, a location | `(population p.x)`          | achieved, "of requested" when short |
| instance    | `instances[]`, under its compartment                                    | `(instance i.x)`            | 1                                   |
| part        | a population with `detail: parts`: its superstructure's rows, nested    | `(part (population p) p.y)` | copies through every instance       |
| Views       | `views[]` and `tours[]` (§4.4)                                          | none                        | none                                |

- **A row stands for its address**, so its eye, color, Show only, label and focus all write or read that address. A
  group row (a compartment) is one look `(in c.x)`, never one look per population under it: MesoQL makes a group edit
  O(1) looks.
- **Counts** are the session's (`CompileResult.counts`): a population short of its target reads "354 of 506", in the
  warning tone, its issue in its properties.
- **Lists are not rows.** A model's placement set is a Prism list, but the person sees compartments and populations. The
  lists stay reachable through ⌘K and the state tree.
- **Parts are not drawn apart yet.** A part's address picks copies inside expanded instances: a partial look (runs),
  which the adapter drops (`look.partial`, renderer-recommendations R8). So a part row's eye, color and Show only change
  the document and say, in its Look, that Prism draws them only for whole populations; the superstructure's population
  row (every part of every instance) is the one that draws. Its hover and pick need the expansion's own ids (below,
  §4.6). Until Prism layers select copy runs, a part row is for reading, focus and the document's own edits.
- **Built incrementally**: a view edit changes no row structure (only dots, eyes); a model edit rebuilds the rows of the
  populations whose counts changed. A part's rows are made when first opened (ui.md §3: thousands of entities cost
  nothing until looked at).

- **As built (`mvs-tree`):** rows by id (a document id; a part `<outer>/<inner>`; a group `@model:<id>`,
  `@kind:<kind>`), kept while the document's sections, the counts, the IR's tree and the grouping are the same objects
  (`document-tree.ts`); a model edit rebuilds the outline (the tree keeps the DOM of each row that is the same). A
  compartment's and a group's count include its parts through every instance. Two populations of one entity are told
  apart by id (`catalase (catalse) · p.catalase`). A part row has no eye (read-only in 3D, §11 question 12); its
  superstructure's envelope is the outer row itself, its inner compartments rows. The Particles category's eye sets the
  document's `(all)` eye look.

### 4.2 Group by

A document's Group by (properties, above the sections, view state as today) offers **Compartment** (the default: the
`parent` tree), **Model** (each model a group, its populations under it; where a person sees which resolver built what)
and **Kind** (the entities' `kind`: protein, lipid, nucleic-acid, …). The extension's **Function** has no source in a
document (an entity has no `function`); Kind stands in for it **(Ludo)**.

### 4.3 Properties

For a document row, the sections of ui.md §4 that apply, and three of its own:

- **Look** (color, opacity, glow, Shown): the shown view's looks for the row's address (§5). Shown (%) stays Prism's
  (§6).
- **Evidence** (proposed): the population's or entity's `evidence[]`, each its kind, citation and note; the entity's
  identifiers as links. This is where the Mesoscale Explorer's description goes (features.md "An entity's description");
  the format has no `description` on an entity, and evidence is where the document keeps why it says what it says.
- **Built by**: the model that realizes the population, its resolver, its key, cached or not, its time, its issues
  (requested, achieved, the reason: [runtime.md](runtime.md)). The model edits of §12, lane `mvs-model-edits`, go here.
- **Issues**, on the document's row: the session's issues by phase (`static`, `resolve`, `render`), each with its path.
  A `render` issue is what the adapter could not draw (a partial look, a cutaway, a structure hint).

### 4.4 Views and tours

- **The Views row** lists the document's views and tours. One view is **shown**: the one the person picked, else
  `session.view`, else the first, else none (the runtime's default looks). Today `deriveView` reads only
  `session.view ?? views[0]` and `updateView(doc, ir)` takes no view; the runtime gains a view argument
  (`updateView(doc, ir, view?)`, lane `mvs-views`).
- **Showing a view** is `mesoviewspec.view { view }`, `undoable: false`: in order with the steps, no checkpoint, the
  steps before it stay undoable, and a checkpoint notes the view shown with it, so Undo makes it shown again with the
  scene it restores. The precedent is `snapshot.apply` (sequence.md §7.3 "Showing a snapshot is no step", David
  2026-10-20); the alternative, a `set` of `session.view` (a step), would make browsing views fill the history and
  change what the saved document opens with. As in Seq\* (format.md § Snapshots, "a view the reader picked stays"),
  `session.view` changes only by **Open with this view** (a patch), from the view's ⋯.
- **Look edits go to the shown view.** Switching to another view shows that view's looks; switching back shows the
  edits, which are that view's. With no view at all, the first look edit inserts `v.prism` ("Edited in Prism"), the
  shown view from then on; `session.view` is not set (a document with one view opens on it).
- **New view from here** (the Views row's ⋯) inserts a view with the current camera (numeric, `position`, `target`,
  `up`, in Å, the world frame) and the shown view's looks copied with new ids. **Update camera** sets the shown view's
  `camera` to the current one. Both are patches, one step each.
- **A tour plays** (`mesoviewspec.tour.play`, `history: false`, as `snapshot.play`): it runs each step as a
  `mesoviewspec.view` with the caller's origin (the person's or the agent's; `undoable: false`: in order, with a history
  context, no checkpoint), so the adapter's look writes are inside that run, never steps of their own and never changes
  outside the API; the caption in the canvas's caption line. Stopping leaves the last view shown. The alternative,
  writing each step from a `history: false` run, fails in the code: such a run has no history context (`api/run.ts`), so
  each `particles.look` would be a recorded step, and direct tree writes would mark every checkpoint unsafe
  (`watchOutsideChanges` excepts only snapshots playing, animations and the cells behaviors own). For the agent,
  `tour.play` declares its own approval (agent.md §4, operations that run others): it asks once for the whole tour, as
  `show_meso_view` asks once, and its steps are not asked again.
- **As built (`mvs-views`):** the runtime's `updateView(doc, ir, view?)`, `compile`'s `view` option and `shownViewOf`
  (picked, else `session.view`, else the first). The session keeps the view shown for every derivation (an edit, a
  stream step, a restore). `mesoviewspec.view` saves the custom state again with `shown`, so the next checkpoint notes
  it. A restore of the same document with another view derives only the view and adopts the restored tree. The camera
  stays where it is on Undo: no checkpoint holds it. A view an edit removes is no longer picked.
  `mesoviewspec.tour.play` is `history: false, undoable: false`, so the agent asks once a tour. Each step holds its
  `duration`, 2 s when it has none. Stop, another tour, Undo, Redo, a close and an open end it. Its caption is on the
  tour's row, not in the canvas: Prism has no caption line yet. New view from here, Update camera and Open with this
  view are `mesoviewspec.newView` (`v.view.<n>`, shown in the same step), `.updateCamera` and `.openWith`. Their camera
  is written in the view's frame, or in the document's unit. Open with keeps the view shown as it is.

### 4.5 Focus and the semantic camera

- **Focus** (a row's double click, the right-click's Focus) on a document row is
  `mesoviewspec.focus { select, framing? }`, `history: false` (as `camera.*`, `focus.*`): the runtime's semantic camera
  ([views.md](views.md)) on the row's address, `framing: fit` by default, from the current direction. It uses
  `lociSphere` over the IR, so it frames the copies wherever the last resolution put them, through superstructure
  instances.
- **A view's semantic camera** is placed on show (§4.4), as the adapter does now (`commitCamera`).
- Prism's own Focus on a list (`area.focus`, the explorer's) stays for lists that are not a document's.

### 4.6 Hover, pick and the selection

- **Hover** on a document copy: the 3D label is `getParticleLabel`'s `<population>#<ordinal>` (an instance: `i.x#0`,
  shown as its id by the owner's label provider), then the entity's label and the compartment's. Mol\*'s label
  providers, as for any particle (sequence.md §10's rule: one hover label, Mol\*'s).
- **A click in 3D picks the row** of the copy's population (or instance), opening the way to it, as the tree follows a
  particle pick today (ui.md §3). The pick is a **MesoLocation** (`{set, index}` from the particle loci's list and
  index), named by its stable id. An expanded instance's copies (keys `<set>|<type>*<template>`,
  `runtime/instancing.ts`) copy the template's ordinals, so their label and pick need the instance's id too
  (`p.granules#12/p.Vamp2#305`, [format.md](format.md)): the adapter keeps, per expanded list, its instance and
  template, and the label provider reads them.
- **A row picked highlights its copies**: its address materialized (`evaluateMesoQL`) into MesoLoci, each set's runs
  turned into one `Particle.Loci` per list. The explorer's `area.highlight` takes one node and one loci
  (`highlightOnly`); a document row lights several lists, so it gains a path for a row's several loci. View state, no
  step.
- **Prism's selection is not used for copies.** `select.*` takes structure targets (operations.md); it has no particle
  loci. So a view's `selection` ([views.md](views.md)), derived into `IRView.selection`, drawn by no one today) is shown
  as the lasting highlight of the shown view; the picked row is the person's selection. **Keep as the view's selection**
  (the row's ⋯) sets the shown view's `selection` to the row's address (a patch). The alternative, mirroring into
  Mol\*'s selection manager, waits for particle selection in Prism.

- **As built (`mvs-tree`):** a row's hover and pick light its copies (`mesoviewspec.lociOf`: the address over the source
  IR, mapped onto the drawn lists by the adapter, an instanced type to its whole instances, a template's copies to every
  instance, a `part` to its instance's block); `mesoviewspec.highlight` is the same for ⌘K and the agent. The hover
  label is Mol*'s one label, from the lists: the copy's id (`getParticleLabel`), then its type's description (entity ·
  compartment); no second provider. A copy of an expanded instance picks its part row.
- **Open (`mvs-tree`):** `framing` (Focus frames `fit` only); the shown view's `selection` as a lasting highlight and
  **Keep as the view's selection** (lane `mvs-views`); a distance on a document's copies (selection mode refuses it: a
  document copy has no object row to hang a distance under). An instance type's look reaches its parts by the view's
  order of looks (`IRLook.visibleAt`, `runtime/instancing.ts`), so Show only a population drawn as parts shows them.

## 5. Operations → patches

The extension's operations from the inventory of `packages/extensions/mesoscale/src` (`operations.ts`,
`prism-viewer.ts`) and the other operations the Scene tree calls (`apps/prism-me/src/explorer`). For a list that is not
a document's, every row is as today. For a document list:

### 5.1 The mesoscale extension

| Operation                | Today                                                                                      | On a document list                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mesoscale.entities`     | read: a list's entities and groups                                                         | read, answered by the owner (`info`): the list's populations as entities (label, count, the compartment's dotted path from `parent`), groups by the document's compartments; `groupBy: 'function'` reads Kind (§4.2)                                                                                                                                                                         |
| `mesoscale.style`        | `particles.look` layers: visible, color, transparency, emissive, reset                     | a patch of the shown view: one look `{id, select, visible?, color?, transparency?, emissive?}`, `select` the entities' populations `(population p…)` or the group's `(in c.x)`; an existing style look of the same `select` is `set` and `move`d last, else `insert`ed last: later looks win (`deriveView`), so an edit always shows over the looks before it. `reset`: `remove` those looks |
| `mesoscale.colors`       | color layers: generate (a hue per group), uniform, theme                                   | `generate`: one look a population, its color from `generateColors` over the document's groups (O(types)); `uniform`: one look `(all)`, or the group's or the entities' address; `theme`: the looks' `color` set to `null` (the runtime's default colors, §5.3)                                                                                                                               |
| `mesoscale.importColors` | color layers for matched entities                                                          | one patch: a look a matched population (matched by entity label, then population id); `matched`, `unmatched` as now                                                                                                                                                                                                                                                                          |
| `mesoscale.theme`        | agent-only: theme on several objects in one transaction                                    | for the document's lists: `object` → one look `(all)` (one document, one color); `entity` → one look a population, the default colors; `generate`, `uniform` as `mesoscale.colors`; `zoom` → as `mesoscale.colorLevels` (below), refused on a spacefill list                                                                                                                                 |
| `mesoscale.colorLevels`  | the representation's `colorLevels`                                                         | **viewer-only**: a renderer setting ([format.md](format.md)). It needs a representation drawn by targets (`type.params.structure`); the adapter draws spacefill, so it is refused ("No particles are drawn by their structures") until the person switches the list's Representation to targets. A document drawn by structures is the `structure` hint (§5.2)                               |
| `mesoscale.graphics`     | representations' quality and LOD; without `object`, the canvas' pixel scale and sharpening | **viewer-only**, as today. The canvas props are outside the history (ui.md §4: an undo does not bring them back)                                                                                                                                                                                                                                                                             |
| `mesoscale.motion`       | the representation's `animation` params                                                    | **viewer-only**, as today                                                                                                                                                                                                                                                                                                                                                                    |
| `mesoscale.example`      | `load.url` of an Explorer example                                                          | not a document: an `mmcif_particles` list (§1). The five MesoViewSpec examples (`packages/mesoscale/examples`) are opened by `mesoviewspec.open` from + Open › Examples, a section of their own                                                                                                                                                                                              |

- **Viewer-only settings survive a re-pack.** A model edit gives the model a new set key, so the adapter deletes its
  list and makes another. The new list's representation takes the params of the one it replaces (its type, quality, LOD,
  `colorLevels`, `animation`) and its cut records (clipping, §5.2), so a graphics mode, a motion or a clip on a document
  list is the model's, not the key's (proposed; the adapter matches by `set.model`).

### 5.2 What the tree calls besides

| Call (from `apps/prism-me/src/explorer`)                                                                      | On a document list                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `particles.visibility` (a list's eye; `rows.ts`, `menu.ts`), `state.visibility` (a category's eye, `rows.ts`) | the document's eye is an eye look `(all)` `visible`; a model's (Group by Model) is `(model m)`. A patch, so the saved document keeps it. The category's eye takes the same patch for a document, never the cell's hidden flag (the two eyes would disagree)                                                |
| `particles.look` direct: Show only (`menu.ts`), Shown (%) (`properties.tsx`), cuts (`clips.ts`)               | Show only: one patch inserting two Show-only looks last, `(all) :visible false` then the kept address `:visible true`; Show all again removes those two only (the eye's and the authored looks stay). Shown (%) and cuts: **viewer-only** (no format field; [views.md](views.md) "Not restored: clipping") |
| `particles.remove` of a list, `state.remove` (Remove, `menu.ts`)                                              | on the document's item: `mesoviewspec.close`. On a list alone: refused, saying to close the document or remove the model from it (a patch, ⌘K or the agent)                                                                                                                                                |
| `particles.remove` of one representation, `explorer.representationVisibility` (`properties.tsx`)              | **viewer-only**, as today (one representation, not the document's copies)                                                                                                                                                                                                                                  |
| `particles.representation`, `particles.update`                                                                | **viewer-only**: the representation's type and settings. A look's `representation` hint ([views.md](views.md)) is the document's; drawing it is decision 4 (design.md §11)                                                                                                                                 |
| `particles.targets`, `cryoet.decorate`                                                                        | **viewer-only**, a step, not saved. The document's way is a look's `structure` hint, which the adapter draws as spheres today (`representation.fallback`)                                                                                                                                                  |
| `clipping.*`, `explorer.clipUse`, `explorer.clipWay`, `stage.clipWhole`                                       | **viewer-only**, steps, as today. A view's `cutaway` is the document's and is not drawn (renderer-recommendations R8)                                                                                                                                                                                      |
| `stage.move` (Move and turn: `stage.moveGizmos`), `stage.pose` and `stage.scale` (the Position section)       | **not offered** on a document's rows: a document places its copies by its frames and poses. The alternative, a viewer-only transform, would draw copies where the document says they are not                                                                                                               |
| `stage.label` (Add label), `stage.editLabel`                                                                  | an annotation `{id, target: <row's address>, text}` inserted in the shown view; drawn as Prism's label by the adapter (§12, `mvs-views`). Its text (`stage.editLabel`), its removal: patches                                                                                                               |
| `stage.distance` (measurements)                                                                               | **viewer-only**, as today                                                                                                                                                                                                                                                                                  |
| `area.highlight`, `area.focus` (no operation)                                                                 | §4.5, §4.6                                                                                                                                                                                                                                                                                                 |

### 5.3 The new operations

The `mesoviewspec` area (proposed ids; flags as operations.md):

| Operation                              | Flags               | What                                                                                         |
| -------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------- |
| `mesoviewspec.open`                    | network (addresses) | open a document (§3)                                                                         |
| `mesoviewspec.close`                   | destructive         | close it: its lists and the saved state go                                                   |
| `mesoviewspec.get`                     | read                | the outline: compartments, populations with counts, models, views, issues; S-expression      |
| `mesoviewspec.edit`                    |                     | apply a patch (§2); a step                                                                   |
| `mesoviewspec.look`                    |                     | a look patch on the shown view from `select`, `color`, `visible`, `transparency`, `emissive` |
| `mesoviewspec.view`                    | no undo             | show a view (§4.4)                                                                           |
| `mesoviewspec.tour.play`, `.tour.stop` | view                | play, stop a tour                                                                            |
| `mesoviewspec.focus`                   | view                | frame an address (§4.5)                                                                      |
| `mesoviewspec.highlight`               | view                | light an address's copies (§4.6)                                                             |
| `mesoviewspec.save`                    | view; no undo       | the document as `.mesoviewspec.json` or `.mesoviewspec`, with every patch committed          |

- **As built (`mvs-tree`):** the eye and Show only are `mesoviewspec.eye { select (one a line), visible }` and
  `mesoviewspec.showOnly { select? }` (none: Show all again), patches on `session.view ?? views[0]` (no view: `v.prism`
  inserted). **As built (`mvs-drive`):**
  `mesoviewspec.look { select, color? (CSS), defaultColor?, visible?, transparency?, emissive? }` writes one style look
  (a row's Color…). The mesoscale operations reach the document through the owner port
  (`@molstar/mesoscale-extension/owner`: `registerParticleListOwner`, the owner `DocumentListOwner` in `list-owner.ts`),
  with `themeChanged(lists)` beside `owns`, `info` and `propose` for a theme the person changes (By zoom). A style look
  of the same `select` is set and moved last; one left saying nothing (its color back to the default and nothing else)
  is removed. **As built (`mvs-views`):** the eye, Show only and `.look` write the view shown (§4.4), no longer
  `session.view ?? views[0]`. Add a label is `mesoviewspec.label { select, text }`: an annotation `an.<n>` of the view
  shown (`v.prism` with none). The adapter draws a shown view's annotations through `stage.label` inside the run, sized
  to the scene, marked by their node `md:#an:<id>` so a restore adopts them. They go when the view does. Their text
  edited and their removal as patches wait for a hook in `stage.editLabel` (open).
- **Which look an edit updates.** A look's `id` says which edit wrote it: `l.style.<n>` (`mesoscale.style`, colors,
  imports), `l.eye.<n>` (an eye), `l.only.<n>` (Show only); other ids are the author's. An edit matches only looks of
  its own kind and `select`, so a Show all again never removes an eye's look or an authored one.
- **Open while a document is open.** An approval is one value an operation (`api/area.ts`), so `open` cannot be
  destructive only sometimes. It is `network`; with a document open, the person's Open asks first (the UI), and the
  agent's `open_mesoviewspec` is refused, saying to close first (`close` is destructive and asks).
- **Defaults when a look has no color** **(Ludo, 2026-11-09: option A)**. `deriveView` gives every type a color
  (`defaultColor`, a deterministic palette by population) and marks it `IRLook.colorDefault`; a look that states a color
  drops the mark. The adapter writes the default colors as before, so a document opens in its palette, unless the person
  chose the list's color theme (By zoom on, or a theme other than its representation's default): then it writes stated
  colors only, so the theme shows. Why not leave defaults out always (option B): spacefill's default theme is a color
  per copy (`particle-index`), so every document would open in confetti instead of its palette. A theme changed by
  `mesoscale.theme` or `mesoscale.colorLevels` asks the owner to draw the list's looks again (`themeChanged`); one
  changed by the Representation form alone shows after the next look edit (open).

## 6. What a person does → what it becomes

The opening rows and the _Mesoscale_ section of features.md, then ui.md's gestures, for a document.

| features.md row                                                         | With a document                                                                                                                                                                                                    |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| cellPACK and PetWorld models; fibres; particle lists                    | unchanged (not documents)                                                                                                                                                                                          |
| Sessions `.molx`, `.molj`                                               | carry the document (§7.1)                                                                                                                                                                                          |
| Mesoscale Explorer examples; `?example=`                                | unchanged; the MesoViewSpec examples are their own (§5.1)                                                                                                                                                          |
| The explorer's URL                                                      | gains `?mesoviewspec=<url>` (§3)                                                                                                                                                                                   |
| Entities, by compartment tree or function, with counts                  | the document's rows (§4.1), Group by Compartment, Model, Kind (§4.2); counts achieved of requested                                                                                                                 |
| Show, hide an entity or a group                                         | a look patch (§5.1)                                                                                                                                                                                                |
| A parent's eye sets all under it; eyes dragged (one step)               | one step; `setEyes` runs one `mesoscale.style` per list in one `api.group`, so the explorer builds one patch for a document's rows itself (one `mesoviewspec.edit`, its ops in drag order) rather than N proposals |
| Show only an entity, its group, its compartment; Show all again         | a patch of two looks (§5.2); "its compartment" is `(in c.x :nested false)`                                                                                                                                         |
| Color an entity, generate colors, theme colors, reset                   | look patches (§5.1)                                                                                                                                                                                                |
| Colors that follow the zoom; on at load                                 | viewer-only and only once a list is drawn by targets (§5.1); a document's lists open in spacefill, the looks' colors                                                                                               |
| Opacity, emissive                                                       | look patch; emissive needs the format addition (§2.2)                                                                                                                                                              |
| Filter the entities by name                                             | as today, over the document's rows                                                                                                                                                                                 |
| Graphics modes; Representation form; smooth close up; wiggle and tumble | viewer-only, kept across a re-pack (§5.1)                                                                                                                                                                          |
| The explorer's look (occlusion, shadows, outlines)                      | unchanged (the canvas)                                                                                                                                                                                             |
| Group by function                                                       | Kind (§4.2) **(Ludo)**                                                                                                                                                                                             |
| Lightness, pattern, cel shading per entity (Deferred)                   | still deferred; a look field when Prism has the layer                                                                                                                                                              |
| Level of detail per entity (Partial)                                    | still one level a list; a document's `detail` (parts or entity) is the nearest thing, a model edit                                                                                                                 |
| Clip per entity, group or target                                        | viewer-only (§5.2)                                                                                                                                                                                                 |
| Quick styles (Deferred)                                                 | unchanged                                                                                                                                                                                                          |
| Color file import                                                       | one look patch (§5.1)                                                                                                                                                                                              |
| An entity's description                                                 | the Evidence section (§4.3); the hover label (§4.6)                                                                                                                                                                |
| Snapshot descriptions' links (Deferred)                                 | a view's `description`; links to views (`#v.id`) are a later choice                                                                                                                                                |
| The guided tour (Deferred)                                              | a document's tours (§4.4) are the closest; the Explorer's driver.js tour stays deferred                                                                                                                            |
| Selection list, focus info, measurements (Partial)                      | the picked row and its properties (§4.6); measurements viewer-only                                                                                                                                                 |

| ui.md gesture                                    | With a document                                    |
| ------------------------------------------------ | -------------------------------------------------- |
| Drop, + Open › Files…, Examples                  | `mesoviewspec.open` (§3)                           |
| Hover in 3D                                      | §4.6                                               |
| Click a row, arrows                              | picks it: its copies lit (§4.6)                    |
| Click in 3D                                      | picks the copy's population or instance row (§4.6) |
| Double click, right-click › Focus                | `mesoviewspec.focus` (§4.5)                        |
| The eye, a parent's eye, a drag along the column | look patches, one step (§5)                        |
| A category's ⋯ › Color…                          | `mesoscale.theme`, the document's lists by §5.1    |
| Color… (a row), its color dot                    | a look patch                                       |
| Add label                                        | an annotation patch (§5.2)                         |
| Add clip…, the Clips section and category        | viewer-only (§5.2)                                 |
| Show only, Show all again                        | a look patch (§5.2)                                |
| Move and turn                                    | not offered on a document (§5.2)                   |
| Remove (the document's ⋯)                        | `mesoviewspec.close`                               |
| Group by                                         | view state, as today (§4.2)                        |
| The filter, folding                              | view state, as today                               |
| Graphics & Motion                                | viewer-only (§5.1)                                 |
| The Views row: a view, a tour                    | §4.4                                               |

## 7. Snapshots, history and undo

Prism's one history (sequence.md §7.3) holds every step; the document is part of what a checkpoint holds.

### 7.1 The document in the state

- **Saved as `prism-viewer.mesoviewspec`**: `{ version: 1, doc, revision, url?, shown? }` through
  `PluginState.registerCustomState` (sequence.md §7.1): the document itself (with every patch committed), the address it
  came from (to resolve relative resources again) and the view shown. Content, so Undo keeps it. Another version or
  none: no document.
- **Sessions need the stub to own the transformer.** `setSnapshot` refuses a snapshot whose transformers are not
  registered (`validateSnapshotTransformers`), and a lazy extension loads for a session only for the transformers its
  stub declares (`ensureFor`, `api/state-open.ts`). So the `mesoviewspec` stub declares
  `transformers: ['ms-plugin.meso-view-spec-placements']`; opening a `.molx` / `.molj` with a document loads the chunk,
  which registers the custom-state key, before the state is set. Without it the session is refused, or the document
  dropped silently (`setCustomState` reads only registered keys).
- **A session opened on a fresh page has no placements** (the store is empty): its lists apply empty (§7.3, point 4) and
  the owner's restore resolves the document cold (§7.3, point 5): an open costs a resolution unless its models are
  precomputed.
- **A dropped document's files** are registered as Mol\* assets by the owner, so a `.molx` holds them as it holds files
  `load.files` read; a `.molj` cannot, and its open names the resources it lacks (models unavailable,
  [runtime.md](runtime.md)). As built (`mvs-open`): not registered yet (open); the owner keeps each document state's
  files in memory, so Undo, Redo and a rollback read them, but a `.molx` does not hold them.
- **What a checkpoint costs.** The custom state is kept by reference (`getSnapshot`), so untouched parts of the document
  are shared in memory (§2.1). The checkpoint's size pass measures a custom-state value once per object
  (`sources/checkpoint.ts`, `size`; lane 0, `checkpoint-owned-cells`): an unchanged document costs nothing at a step,
  and a patched one is measured once. The owner must therefore never change a document in place after handing it over
  (patches already return a new document, §2.1). A model edit costs the patched population, not the copies: placements
  are derived ([views.md](views.md)) and never in the state.

### 7.2 What a step is

- **A step**: `mesoviewspec.edit`, `.look`, `.open`, `.close`; a mesoscale operation on a document list (§5.1); the
  viewer-only operations on a document's representations (they are Prism steps as on any list).
- **Not steps**: `.view` (no undo, §4.4), `.tour.*`, `.focus`, `.highlight` (view); `.get` (read); `.save` (no undo); a
  patch that changes nothing ("it is already so").
- **A model edit is one step however long its resolution**: the checkpoint is taken when it opens; a failed or cancelled
  resolution restores it (nothing half-drawn).

### 7.3 Lists and checkpoints: the contract

The adapter makes a list with a state transform whose only param is the set's key (`MesoPlacements`), over a side store
(`placementStore(plugin)`, one per viewer); before this contract `apply` threw when the key was not in the store, and
the adapter deleted the key when the set went. A restore (Undo, Redo, the rollback of a failed or cancelled step, a
session opened) restores the data tree first and the custom state after it, and Undo and the rollback hold the history's
lock while they do (`ui/src/managers/history.ts`: `undo` and `run` take it around `#restore`). So an Undo past a re-pack
applies a transform whose key is gone, and anything the owner does then through `viewer.api` waits on that lock (a
deadlock) or, deferred, records a new step (and empties Redo). The contract (built, lane `mvs-open`; `undoSteps` is 10
in the owner, not yet read from the viewer's option):

1. **Document lists stay in the data tree and in checkpoints**, with their representations and layers. So clips, motion
   and graphics on them undo as on any list.
2. **In a step, the adapter runs under the operation's `ctx.api`** (§2.3): making and deleting lists is inside the step.
3. **The owner, not the adapter, lets placements go.** The adapter stops deleting store entries (on remove and on
   `clear`). The owner keeps the set keys (expanded instance keys included) named by the IRs of the last
   `options.ui.undoSteps` (10) steps and the current one; the store and the session's cache keep those, and let the
   others go. Older checkpoints are "Too old to undo" (sequence.md §7.4). A closed document's keys go the same way, so
   Undo of `mesoviewspec.close` finds them.
4. **`MesoPlacements.apply` never throws on a missing key**: it gives an empty list and a `render` issue
   (`placements.missing`), so a restore (and a session opened on a fresh page, §7.1) never fails.
5. **During a restore the owner writes nothing through the API.** The custom state's `set` gives it the checkpoint's
   document. It compiles it with the session's cache (from a checkpoint Undo can reach, every model a hit; from a
   session, cold), sets the adapter's `prev` to that IR and rebuilds its maps (`placed`, `expansions`, `bounds`) from
   the restored tree, finding each list by its `MesoPlacements` key. A list whose key the store lacked is filled and its
   cell updated through `plugin.state.data` directly (a hidden `fill` param raised: equal params never apply again),
   while `history.applying` is set (the outside-change watcher ignores the restore's own writes). No `particles.*` call,
   no step.
6. **Redo** is the same restore. The adapter's own repair of lists stripped by an undo (AN1 in the parent lane's gate)
   stays what it is: a check at the next edit, inside that edit's step.

Tests that pin it (lane `mvs-open`, then `mvs-drive`): Undo after a re-pack, then Redo, then Undo again: no error, no
wait, the History's length and the number of lists asserted at each; a failed model edit rolls back the same way; a
`.molj` with a document opened on a fresh page; Undo of Close; a clip, a motion and a graphics mode on a document list
undo; the canvas props of `mesoscale.graphics` do not (ui.md §4).

### 7.4 The shown view

The checkpoint notes the view shown; Undo shows it again with the document it restores (§4.4, the `snapshot.apply`
rule). A view removed by the undone document falls back as §4.4 says.

### 7.5 Large scenes

A document's checkpoint holds no copies, so the history's budgets (sequence.md §7.4) are met by the lists' cells, as for
any particle list. The placements the owner keeps (§7.3, point 3) are the memory Undo costs: those of the last 10 steps.
The status says so once when it passes the history's size budget (proposed: the same 50 MB).

## 8. The agent (decision 5)

- **A skill, `mesoviewspec`**, in the lazy stub (agent.md §3: disclosing it loads the extension). Its guidance is the
  MesoQL reference (`mesoQLReference`) and the document's S-expression spelling, from lane `mvs-skill-cli`'s skill; this
  design names the tools, that lane writes the words.
- **Tools** (thin adapters over §5.3's operations, agent.md §2):
  - `open_mesoviewspec` (url), `close_mesoviewspec`;
  - `get_mesoviewspec` (read: `summary`, `outline`, `document`; the S-expression, at most the state lines of agent.md
    §5, the rest on request);
  - `edit_mesoviewspec` (a patch, as S-expression or JSON: the general tool, validated, refused whole);
  - `style_meso` (`select` MesoQL, color, visible, transparency, emissive: one look);
  - `show_meso_view` (a view id), `focus_meso` (`select`, framing), `highlight_meso` (`select`);
  - `save_mesoviewspec`.
- **The mesoscale skill's tools** (`style_mesoscale_entities`, `color_mesoscale_entities`, …) work on a document's lists
  through the owner (§1.1), so an agent that knows only them still edits the document.
- **What it sees each turn**: the document's outline joins the scene outline (agent.md §5) as one line a compartment
  (populations and counts), the shown view, and the issues' count.
- **Policies** (agent.md §4): edits are preauthorized while the turn can be undone; `open` asks for unknown hosts (§3);
  `close` asks (destructive); `save` asks (no undo, a file for the person); `show_meso_view` asks every time, as
  `snapshot.apply` does (`undoable: false` asks, `agent/policies.ts`): showing a view is what no undo takes back. A
  model edit's resolution can take seconds: the tool's result says what ran (resolver runs, cache hits, time).
- **Untrusted text**: labels, titles, evidence notes and annotations are the document's: `quoted()`.
- **Evals** (agent.md §6): a task's prompts on the exosome headless: "hide the lipids", "color catalase red", "focus on
  the docked granule", each checked on the document (its looks) and on the drawn layers; Undo turn restores both.
- **The alternative:** the mesoscale skill's tools alone, extended for documents. Refused: they name entities and groups
  of one list; a document's addresses (MesoQL) reach compartments, instances and parts across models, and its edits
  (counts, views) are not looks.

## 9. Streaming (decision 6)

Streaming is the `mesoviewspec-streaming` lane's ([streaming.md](streaming.md): written there). This design names only
where it plugs:

- **The provider and the planner** are the streaming lane's `runtime/streaming.ts` contract; the owner hands them to its
  `MesoSession` as that lane defines.
- **Camera-driven requests** are `molstar/src/session.ts`'s, as that lane adds them. In Prism the owner feeds them the
  canvas camera (view state; `camera.*` changes are not steps).
- **Streamed sets are not steps.** Tiles loaded and evicted are cells the owner's behavior makes, not the person's: as
  volume streaming's cells (sequence.md §7.3, "cells behaviors own" are not changes outside the API). Undo restores the
  document; the tiles follow the camera, not the history. Lane 0 (`checkpoint-owned-cells`) built what this needs: a
  transformer registered with `registerBehaviorOwned(plugin, [transformer])`
  (`@molstar/prism-viewer/sources/checkpoint`) makes its cells and everything under them no outside change, leaves them
  out of a checkpoint's data tree, and a restore keeps them where their parent and `dependsOn` stay (sequence.md
  §7.2-§7.4). The fixed list (`isBehaviorOwned`) is unchanged and its cells are still checkpointed (custom-properties
  cells parent structures). So `mvs-streaming-app` registers the tile cells' transformer; a restore keeps the resident
  tiles and the provider continues from the camera.
- **The alternative, tiles as steps:** every camera move would fill the history, and Undo would unload what the person
  is looking at.
- **The budget** is a viewer setting (Settings), never the document's.

## 10. No MesoViewerContext (decision 7)

- **Prism's state is enough.** Seq\* needed `SeqViewerContext` because it is a second engine with its own viewports,
  hover, selection and focus (sequence.md §1). MesoViewSpec draws through Mol\* only: its copies are Mol\* particle
  lists, its hover, pick and camera are Mol\*'s. What it adds is a document and its derivation, which
  `MesoDocumentModel` (§1.1) holds with no DOM.
- **What would change that:** a second drawing of the document (a 2D compartment map, a population table with its own
  hover) that needs state Mol\* does not hold. Then a context with that state, as Seq\*'s, beside the owner.

## 11. Open: who decides

| #   | Question                                                                                                      | Proposed                        | Who                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The base: a PR of `me/mesoviewspec` to `prism-me`, or stacking (§12.1)                                        | the PR                          | Ludo, 2026-11-08: the PR body is ready; the app lanes stack on `me/mesoviewspec` now ("just start the work and make it usable") |
| 2   | One document at a time (§1.1)                                                                                 | yes                             | Ludo, 2026-11-08: yes                                                                                                           |
| 3   | A document's eye and Show only saved in the document, not viewer-only (§5.2)                                  | saved                           | Ludo, 2026-11-08: saved                                                                                                         |
| 4   | Group by: Compartment, Model, Kind; Kind in place of Function (§4.2)                                          | yes                             | Ludo                                                                                                                            |
| 5   | Move and turn not offered on a document (§5.2)                                                                | not offered                     | Ludo                                                                                                                            |
| 6   | Patches as Seq\*'s, ops by id (§2.1); decision 6                                                              | yes                             | David                                                                                                                           |
| 7   | Looks get `id` and `emissive` (§2.2)                                                                          | yes, 0.4                        | David                                                                                                                           |
| 8   | Showing a view is no step; `session.view` set only by Open with this view (§4.4)                              | yes (the `snapshot.apply` rule) | David                                                                                                                           |
| 9   | Annotations as Prism labels; Add label writes an annotation (§5.2)                                            | yes                             | David                                                                                                                           |
| 10  | The undo contract for lists (§7.3)                                                                            | as written                      | ours                                                                                                                            |
| 11  | `show_meso_view` asks the agent every time (`undoable: false`, §8); or a policy that lets showing a view pass | ask, as `snapshot.apply`        | Ludo, 2026-11-08: ask                                                                                                           |
| 12  | Part rows read-only in 3D until Prism layers select copy runs (§4.1); lane 3's β-cell check depends on it     | yes                             | Ludo                                                                                                                            |
| 13  | Look ids carry the edit's kind (`l.style.<n>`, `l.eye.<n>`, `l.only.<n>`, §5.3): a document convention        | yes                             | David                                                                                                                           |

## 12. The app lanes

### 12.1 The base decision

`packages/mesoscale/*` exists only on `me/mesoviewspec` (local, not pushed). Every lane below needs it.

- **A PR of `me/mesoviewspec` to `prism-me` first** (recommended): Ludo reads its body (the parent lane's gate is done),
  merges, and every lane here is a lane as How we work says:
  `git worktree add ~/prism-me-lanes/<slug> -b me/<slug> origin/prism-me`, its own dev port, its PR to the fork's
  `prism-me`, Ludo's check in the running app.
- **Stacking**: each lane branches from `me/mesoviewspec` (the first) or from the lane before it, and merges back into
  `me/mesoviewspec` locally, no PR (nothing is pushed before Ludo signs off). What changes for the lanes:
  - there is no PR body to merge on; the gate's Review table and the progress file are the record;
  - Ludo's check runs on a dev server started in the stack's worktree (`npm run dev:all` there, its own port), not on
    `prism-me`;
  - `prism-me`'s own lanes and the weekly master merge must be merged into the stack too, each a merge commit of its
    own, or the stack drifts;
  - two lanes run at once only where §12.2 says so, each a branch of the lane before them, merged in the order given.
- **Now** (Ludo, 2026-11-08: "library lanes only for now"): only `mvs-patch` (a library lane inside
  `packages/mesoscale/spec`) starts before the base is decided, from `me/mesoviewspec`; under the PR option it is
  rebased on `prism-me` after the merge.
- **The checkpoint changes are a library lane.** Lanes 2 and 8 need two changes to Prism's checkpoint port
  (`packages/prism/viewer/src/sources/checkpoint.ts`): behavior-owned cells registered by transformer instead of the
  fixed `isBehaviorOwned` list, with the port leaving them out; and a custom state's size measured once per value (a
  key's own version), not stringified at each step. Both are generic, so they are lane 0, `checkpoint-owned-cells`, from
  `origin/master` with a failing test first (How we work, "a library fix"); `prism-me` gets it by a cherry-pick when
  lane 2 starts.
- **The streaming lane comes first where files meet.** `mesoviewspec-streaming` edits `format/doc.ts`, `validate.ts` and
  `molstar/src/session.ts`; `mvs-patch` edits the first two and `mvs-open` the third. Each merges into `me/mesoviewspec`
  (or `prism-me`) after the streaming lane, or rebases on it before its gate. Both lanes also add a line to design.md
  §11 decision 12: the streaming lane's answer stands, this lane's pointer follows it.

### 12.2 The briefs, in build order

Each in the shape of the briefs in `apps/prism-me/progress/`.

#### 0. `checkpoint-owned-cells`: behavior-owned cells and custom-state size in Prism's checkpoints (library)

- **Check (Ludo):** none in the app; in prism-me after the cherry-pick, the volume streaming and focus cells behave as
  before (History unchanged while streaming).
- **Spec:** `packages/prism/viewer/_spec/sequence.md` §7.2-§7.4 (the behaviors' cells, the size pass); prism.md §7.1,
  §9.
- **Tests:** unit, failing first: a cell of a transformer registered as behavior-owned is no outside change and is left
  out of a checkpoint, and a restore keeps it; the existing fixed list still holds; a custom state whose value is the
  same object is measured once across checkpoints.
- **Touches:** `packages/prism/viewer/src/sources/checkpoint.ts`, its tests, `CHANGELOG.md` if it applies to 5.x.
- **Size:** ~120 production lines.
- **Lane model:** Sonnet; Opus gate.
- **Steps:** 1. the failing tests (Sonnet) 2. the registry and the filter (Sonnet) 3. the size per value (Sonnet) 4.
  checks, the gate (Opus).
- **Base:** `origin/master` (a library lane); cherry-picked into `prism-me` (or the stack) when lane 2 starts.

#### 1. `mvs-patch`: patches over a MesoViewSpec document

- **Check (Ludo):** in Storybook (MesoViewSpec › Patches), a look edit on the exosome as a patch, its S-expression and
  its inverse shown; Undo by the inverse puts the document back, byte for byte.
- **Spec:** prism.md §2; [format.md](format.md) (the document, its spelling), design.md §11 decision 6.
- **Tests:** quick: every op (`set`, `remove`, `insert`, `move`) and its inverse on the five examples; all or nothing (a
  bad op leaves the document `===` the same); dangling references refused; `diff(a, b)` applied to `a` is `b`; untouched
  sections shared (`===`); a patch touching only views classified `view`; Look `id` and `emissive` validated; the
  S-expression round trip of a patch.
- **Touches:** `packages/mesoscale/spec/src/format/patch.ts` (new), `doc.ts` (Look `id`, `emissive`), `validate.ts`,
  `sexpr.ts` (the patch codec), `ir/ir.ts` (`IRLook.emissive`), `runtime/runtime.ts` (a look's `emissive` into
  `IRLook`), the adapter (emissive in its layers), a story.
- **Size:** ~350 production lines.
- **Lane model:** Sonnet; the contract is §2.
- **Steps:** 1. types and `applyPatch` with quick tests (Sonnet) 2. `diff` and the codec (Sonnet) 3. emissive through IR
  and adapter (Sonnet) 4. the story, checked in Storybook (Sonnet) 5. checks, the gate (Opus).
- **Base:** starts now from `me/mesoviewspec`; rebased on the streaming lane before its gate (§12.1).

#### 2. `mvs-open`: a document opened in prism-me

- **Check (Ludo):** drop `exosome.mesoviewspec.json` on prism-me: drawn, one row in Particles; `?mesoviewspec=<url>`
  opens it; Save gives the file; open it again: the same scene. Re-pack (⌘K `mesoviewspec.edit` with a count), then
  Undo: the old copies back, no error.
- **Spec:** prism.md §1.1, §2.3, §3, §5.3 (open, close, get, save, edit), §7.
- **Tests:** unit (headless viewer): open by URL, file and data; a relative resource resolved against the URL; an
  unknown host asks the agent's policy; the stub loads nothing at start (the boundary test); the custom state saved and
  restored through a `.molj`, also on a fresh page (the stub's transformer loads the chunk); every test §7.3 lists
  (Undo, Redo, Undo after a re-pack with the History's length and the lists counted; a failed model edit's rollback;
  Undo of Close); `MesoPlacements` with a missing key gives an empty list and an issue; the adapter's calls are inside
  the step (no "outside change"); nothing goes through the API during a restore.
- **Touches:** `packages/mesoscale/molstar/src/` (`document-model.ts`, `prism-viewer.ts` stub with its transformer and
  the extension, `prism-adapter.ts` under `ctx.api`, rebuilt from the tree, no store deletes, params kept across a
  re-pack, `particle-list.ts` no-throw apply, `session.ts` cache bound), lane 0's size by value (used, not changed
  here), `apps/prism-me/src/extensions.ts`, `url.ts`, the drop sniff; features.md (a new row).
- **Size:** ~600 production lines.
- **Lane model:** Opus for the owner and the undo contract (the state's hot path); Sonnet for tests and checks.
- **Steps:** 1. the owner and the custom state (Opus) 2. the stub, open, close, save, URL, sniff (Sonnet) 3. the adapter
  under `ctx.api`, the store bound, no-throw apply (Opus) 4. the undo tests (Sonnet) 5. checked in the app (Sonnet:
  drop, reload, undo; no console errors) 6. the gate (Opus).
- **Base:** after lane 0. PR option: from `prism-me` after the merge. Stacking: from `me/mesoviewspec` with lane 1 and
  the streaming lane merged.

#### 3. `mvs-tree`: the document in the Scene tree

- **Check (Ludo):** the exosome's tree: compartments, then populations with "354 of 506" where short; Group by Model and
  Kind; hover a lipid: `p.lipids#…` and its entity; click a catalase in 3D: its row picked; double click a row: the
  camera frames it; the β-cell: a granule's parts under it, opened on demand.
- **Spec:** prism.md §4.1-§4.3, §4.5, §4.6.
- **Tests:** unit: the rows of each example (compartments nested by `parent`, instances, parts); counts with requested;
  Group by switching remakes the document's rows only; a 3D pick maps to its row (MesoLocation → population or
  instance); a row's highlight is one `Particle.Loci` a list from its runs; focus frames `lociSphere`; the Evidence and
  Issues sections; the scaling guard (`test:scaling`): a view edit rebuilds no row.
- **Touches:** `apps/prism-me/src/explorer/` (a document source beside the lists', `ui.tsx`, `rows.ts`,
  `properties.tsx`, `operations.ts`: a row's highlight over several lists), `packages/mesoscale/molstar/src/` (the
  owner's rows and focus, the label provider, the adapter's instance and template per expanded list); ui.md §3-§4,
  features.md.
- **Size:** ~550 production lines.
- **Lane model:** Opus for the tree source (incremental, hot path); Sonnet for sections and tests.
- **Steps:** 1. the rows and their addresses (Opus) 2. counts, Group by (Sonnet) 3. hover, pick, highlight, focus
  (Sonnet) 4. Evidence, Built by, Issues sections (Sonnet) 5. checked in the app (Sonnet) 6. the gate (Opus).
- **Base:** after lane 2 (PR option: from `prism-me` once lane 2 is merged).

#### 4. `mvs-drive`: the mesoscale operations as patches

- **Check (Ludo):** on the exosome: hide the lipids by their eye, color catalase, Generate colors, Show only the lumen,
  Import colors; Save: the file has those looks; Undo each; the same gestures on a cellPACK `.bcif` work as before.
- **Spec:** prism.md §1, §1.1 (the owner port), §5.1, §5.2, §6.
- **Tests:** one unit test a row of §5.1 and §5.2 (the patch it proposes, then the layers drawn); a drag of eyes is one
  patch; the first edit without a view inserts `v.prism`; a look with no color writes no color layer (By zoom shows); an
  `mmcif_particles` list unchanged (the extension's own tests still pass); Undo of each.
- **Touches:** `packages/extensions/mesoscale/src/operations.ts` (the owner port, no `@molstar/meso-*` import),
  `packages/mesoscale/molstar/src/` (the owner's `propose`, `info`), `runtime/runtime.ts` (stated vs default colors),
  `apps/prism-me/src/explorer/` (the document's eyes and menus); features.md.
- **Size:** ~500 production lines.
- **Lane model:** Opus (the port crosses three packages); Sonnet for the per-row tests.
- **Steps:** 1. the port and `mesoscale.style` (Opus) 2. the other rows of §5.1 (Sonnet) 3. §5.2's calls (Sonnet) 4.
  checked in the app (Sonnet) 5. the gate (Opus).
- **Base:** after lane 3 (both edit the eyes in `explorer/rows.ts`). Its shown view is the runtime's own
  (`session.view ?? views[0]`) until lane 5 adds the view argument; `v.prism`, inserted first, is that view.

#### 5. `mvs-views`: views, tours, labels

- **Check (Ludo):** the β-cell: the Views row lists `v.cell`, `v.docked` and the tour; a click shows a view (the camera
  moves, the looks change); Play tour; New view from here, then Open with this view, Save: the file opens on it; Add
  label on a granule: a label in 3D, saved.
- **Spec:** prism.md §4.4, §5.2 (Add label), §7.4.
- **Tests:** unit: `mesoviewspec.view` is no step and Undo restores the view shown with its checkpoint; look edits go to
  the shown view; tour play records nothing; New view and Update camera are patches; annotations drawn as labels and
  removed with their view.
- **Touches:** `packages/mesoscale/spec/src/runtime/runtime.ts` (`updateView` with a view),
  `packages/mesoscale/molstar/src/` (the adapter draws `IRView.annotations`; the owner's shown view; a tour's steps as
  the person's view shows), `apps/prism-me/src/explorer/` (the Views row, its menus); ui.md.
- **Size:** ~400 production lines.
- **Lane model:** Sonnet; Opus for the history rule (step 1).
- **Steps:** 1. show a view as `undoable: false` with the checkpoint note (Opus) 2. the Views row and tours (Sonnet) 3.
  new view, camera, open with (Sonnet) 4. annotations (Sonnet) 5. checked in the app (Sonnet) 6. the gate (Opus).
- **Base:** after lane 4; parallel with lane 6 (merge order 5 then 6).

#### 6. `mvs-model-edits`: change the biology from the properties

- **Check (Ludo):** the exosome's catalase: its count from 506 to 300 in Built by, the copies repacked (one step, the
  status shows the resolution); its seed changed; Add relax stage: 506 of 506; Undo each; Cancel a long one.
- **Spec:** prism.md §4.3 (Built by), §7.2; [runtime.md](runtime.md) (pipeline, refine stages).
- **Tests:** unit: a count edit is one model edit rerunning only its model (the session's record); a seed edit; adding
  `meso.relax` as a refining model; a cancelled resolution restores the checkpoint; a refused patch (a count below 0)
  changes nothing.
- **Touches:** `apps/prism-me/src/explorer/properties.tsx` (Built by's controls), `packages/mesoscale/molstar/src/`
  (cancel through a Mol\* task), `packages/mesoscale/spec/src/runtime/` (a signal through `RuntimeOptions` to the
  resolvers, checked between models and in the packers' loops).
- **Size:** ~400 production lines.
- **Lane model:** Sonnet.
- **Steps:** 1. the controls as patches (Sonnet) 2. progress and Cancel (Sonnet) 3. checked in the app (Sonnet) 4. the
  gate (Opus).
- **Base:** after lane 4; parallel with lane 5.

#### 7. `mvs-agent`: the agent edits the document

- **Check (Ludo):** in the assistant, on the exosome: "hide the lipids and color catalase red", "frame the docked
  granule" (β-cell), "show me the lumen only"; Undo turn puts it back; Save has the edits.
- **Spec:** prism.md §8; agent.md; lane `mvs-skill-cli`'s skill.
- **Tests:** unit: each tool over a scripted model; the outline lines; `open` with an unknown host asks; evals
  (headless) for the three prompts, checked on the document and the layers, Undo turn restoring both.
- **Touches:** `packages/mesoscale/molstar/src/prism-viewer.ts` (the skill, tools), the evals.
- **Size:** ~300 production lines.
- **Lane model:** Sonnet; Opus for the eval tasks' design.
- **Steps:** 1. tools over §5.3 (Sonnet) 2. the skill from `mvs-skill-cli` (Sonnet) 3. evals (Opus writes, Sonnet
  runs) 4. checked in the app with a real model (Sonnet) 5. the gate (Opus).
- **Base:** after lanes 4 and 5, and `mvs-skill-cli` merged.

#### 8. `mvs-streaming-app`: a streamed document in prism-me

- **Check (Ludo):** the streaming lane's tiled fixture opened in prism-me: coarse first, copies where the camera looks,
  the budget in Settings; History shows no tile steps; Undo of a look edit while tiles stream.
- **Spec:** prism.md §9; [streaming.md](streaming.md) (the streaming lane's).
- **Tests:** unit: tiles requested from the canvas camera; tile lists are no step and no outside change; a checkpoint
  leaves them out; the budget setting.
- **Touches:** `packages/mesoscale/molstar/src/document-model.ts`, the tile cells' transformer registered as
  behavior-owned (lane 0's registry), Settings.
- **Size:** ~300 production lines.
- **Lane model:** Sonnet.
- **Steps:** 1. the camera feed and the budget (Sonnet) 2. the history rule (Opus) 3. checked in the app (Sonnet) 4. the
  gate (Opus).
- **Base:** after lanes 0 and 2 and the streaming lane merged.

**In all:** ~3,520 production lines in nine lanes: lane 0 (library, from master) beside lane 1, then 2 to 8 in order;
only lanes 5 and 6 run at the same time.
