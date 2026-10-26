# Command language: PyMOL, VMD and ChimeraX commands for Prism

`@molstar/command-language-extension`: people who know PyMOL, VMD or ChimeraX type the commands they know
(`show sticks, ligand`, `mol addrep top`, `show ligand :<5 atoms`) in the Prism viewer, and Mol\* does the same thing or
says plainly that it cannot. This spec is for working on the code; code comments cite it (`_spec §5.2`). Scope per
dialect: [pymol.md](pymol.md), [vmd.md](vmd.md), [chimerax.md](chimerax.md). Open items: [../TODO.md](../TODO.md).

## 1. Decisions

1. **An opt-in Prism extension**, as Mol\*'s others (Prism README decision 27): `apps/prism-viewer` lists it;
   `DefaultPrismViewerSpec()` does not, and a viewer without it carries none of its code. Why: a way into the viewer
   some people want, not one every viewer needs.
2. **Two layers, one rule**: `src/language/` (tokenizers, command tables, the IR, diagnostics, completion, help) imports
   only `@molstar/core` and `@molstar/query-language`, enforced by Biome (`biome.json`); `src/prism-viewer/` and
   `src/plugin/` run it on the viewer. Why: the language is tested without a viewer, and can become a package of its own
   if a second host is ever wanted.
3. **The host is Prism's API, not the plugin**: every command runs through the viewer's operations, inside one
   `script.run` (its calls join its step). Why: Prism's operations are the only way state changes there (Prism README
   decision 8); through them a script gets Undo, the session record, approvals and targets, and a plugin change outside
   the API would break Prism's Undo (api.md §5).
4. **The person's words decide the dialect**: `pymol …` / `vmd …` / `chimerax …` in the command menu, `!` for the
   person's default. Every dialect compiles to one IR; nothing else differs. A dialect's own state (VMD's reps,
   ChimeraX's model ids and atom styles) is optional in the IR and the session state, so the others are unchanged.
5. **Unsupported is an error, never a silent no-op** (§7): a command Mol\* cannot do the same way fails before anything
   runs, saying what it is and what to do instead; one that runs with a difference (an option ignored) says so in a
   warning or a note.
6. **A submission is one step, all or nothing** (§6).
7. **Faithful semantics**: PyMOL's per-atom show flags, VMD's numbered reps and ChimeraX's atom styles are kept on
   Mol\*'s component tree (§5.2–§5.4), so a script written for those programs ends in the scene its author expects.
   ChimeraX's grammar, abbreviations and selectors are read from ChimeraX 1.10 itself (its registry, its parser, its
   atom counts), not from memory.
8. **Eager, not lazy**: the menu's rows parse each keystroke, synchronously (`CommandMenuPrefix.items`); a lazy chunk
   could not answer before it loaded. The language is small (tables and a color list).
9. **No MolViewSpec export here**: a separate piece of work, in `packages/mvs`.

## 2. Layout

| Path                         | What                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| `src/language/ir.ts`         | the command IR (§4)                                                                       |
| `src/language/script.ts`     | a submission: split, compile against the env, run on a host (§5); `ScriptHost`            |
| `src/language/env.ts`        | `ScriptEnv` (what names mean), `CompileState` (its working copy), `ScriptSession` (Tcl)   |
| `src/language/selection.ts`  | selections: query-language with objects and named selections (§4.3)                       |
| `src/language/pymol/`        | tokenizer, argument binding, commands, settings, the unsupported list                     |
| `src/language/vmd/`          | Tcl words (§3.2), commands, styles and coloring methods, the unsupported list             |
| `src/language/chimerax/`     | words and commands (§3.4), names (ChimeraX's order), arguments, colors, unsupported list  |
| `src/language/completion.ts` | completion (§8); `describe.ts`: one line per IR command (the menu's Run row)              |
| `src/prism-viewer/`          | the host (`host.ts`, `display.ts`, `vmd.ts`), the `script` area, the menu prefixes, state |
| `src/plugin/vmd-preset.ts`   | VMD's default look as a representation preset (§5.3)                                      |
| `src/prism-viewer.ts`        | the `ViewerExtension`                                                                     |

- **One table per dialect drives everything**: each command's name, signature (argument kinds), help, examples and
  `compile`. Parsing, completion, `help` and the scope tables read it; a test compiles every example and fails every
  listed unsupported command.
- **Changes outside**: query-language's `TranspileOptions.resolveName` (PyMOL objects and named selections) and its
  ChimeraX transpiler (`transpilers/chimerax`, `parseAtomSpec`: a spec at a command's start, where it ends, its pieces);
  Prism's `ViewerExtension.commandPrefixes` and prefix rows that fill the text (`run` returns `{ text }`), and
  `representation.transparency`'s `types`; the model's `queryInSelection` complement of an empty selection (PyMOL's
  `not`). ChimeraX is not a core `Script['language']`: the extension imports its parser (TODO).

## 3. Parsing

Hand-written tokenizers: every token keeps its place for diagnostics, and an unfinished line still reads (completion). A
selection argument goes to query-language as text; its error is placed on the argument.

### 3.1 PyMOL

`command arg, arg, key=value`: the first space or comma ends the name; commas at depth 0 (outside parentheses, brackets,
quotes) split arguments; `;` and newlines end a command; `#` starts a comment outside quotes; `\` before a newline joins
lines (blanked to spaces, so places stay). Keyword arguments bind by the signature's names; an argument PyMOL takes that
Mol\* ignores is a warning (`ignored`), one PyMOL does not take an error. `python … python end` is one unsupported
command.

### 3.2 VMD: a closed subset of Tcl

Tcl's word rules: `{…}` literal (nested), `"…"` and bare words substitute `$name`, `${name}` and `[…]`; `\` escapes; `;`
and newlines end a command; `#` at a command's start is a comment. Evaluated while compiling: `set`, `unset`, `$name`,
`[atomselect …]`, `[molinfo top]`, `puts`; atomselect handles' `num`, `text`, `molid`, `get`, `delete`. Tcl's control
flow and the rest fail `unsupported`: the console runs VMD commands one by one.

### 3.3 Scripts that run scripts

`@file.pml` and `load file.pml` (PyMOL), `source file.tcl` and `play file.vmd` (VMD), `open file.cxc` (ChimeraX) run a
script given with the submission (`ScriptEnv.scripts`: the texts of the `.pml`, `.tcl`, `.vmd` and `.cxc` files among
those given), compiled in place with the same names: its commands take the include's place, their text named by the
file, and its messages, compile and runtime alike, name the file's line. A script that runs itself stops (8 deep at
most). A file not given fails `no-name`.

### 3.4 ChimeraX

As ChimeraX's parser (`cli.py`): `;` and newlines end a command outside quotes; `#` where a command starts makes the
line a comment (elsewhere it is a model, `#1`); a word runs to a blank or `;`, or is quoted, the quote only where a word
starts (`@O3'`). A command's name is its words as ChimeraX resolves them: the whole name, else the first command in
ChimeraX 1.10's registration order that starts with the word (`sel` select, `sh` shape), then the same among its
subcommands (`sel cl`); the order is the registry's, without add-on bundles (`names.ts`). Arguments as `cli.py` binds
them: positionals in order, an optional one tried and skipped when it does not read, none read where a keyword starts;
then keyword and value pairs, a keyword shortened while it is one keyword, any case when typed in lower case. An atom
spec reads as far as it can and ends at a blank (`parseAtomSpec`): `color /A :12 red` is the spec `/A :12`, then `red`.
A word that may be a spec and reads as nothing says why the spec did not read. Keywords ChimeraX takes that change
nothing here are warnings; a command that reads as one ChimeraX has but the table lacks fails `unsupported`, naming it
(an abbreviation says what ChimeraX reads it as: `mol` is molmap).

## 4. The IR

`ir.ts`: what to do in Mol\* terms, whoever typed it. JSON-safe (selections are MolQL), each command with its place and
text. One person's command may be several IR commands (`as` hides and shows; `util.cbag` colors per element), never the
reverse. Representations are the people's words (`sticks`, `mesh`, `tube`); the host maps them (`reps.ts`).

### 4.3 Selections: objects and names

- **Objects are structures.** A PyMOL text that names objects (`/1abc//A`, `1abc and chain A`) is compiled once per
  named object, its name meaning everything there and the others nothing, and once for `others` (every structure it
  names no part for). Each part is plain MolQL on one structure. Why: exact, serializable, no MolQL extension.
- **Named selections are inlined when used**: a name means what it selected when defined (its parts fixed to the objects
  there were: `fixedTo`; by object name, so an object deleted and loaded again under its name is in it). A name the
  selection language reads as its own word (`b`, the B-factor; `chain`) is refused when defined; one that only starts
  with such a word (`b2`, `both`) is a name.
- **VMD selections are scoped to the command's molecule** (VMD's selections never name molecules).
- **ChimeraX specs are compiled per object by its model id** (`chimeraxSpec`): `#1` matches the object that is model 1
  there, nothing elsewhere; `others` has no id (a model term selects nothing there). An object whose part is the same as
  `others` gets none. Model ids are ChimeraX's: given at load, the lowest free (`load.model`, the state's `objects`),
  every structure getting one when first seen. A spec of models side by side (`:12@CA :13@CA`) also gives its pieces in
  the order written (angles and torsions read their atoms so). `sel` is the selection: the viewer's (each structure's
  selected atoms, read with the env), as the submission's own `select` commands leave it (`CompileState.selection`).
- **Names come from the env**: object names (the state's, else the entry, lowercased, deduplicated), VMD molecule ids
  (never reused) and ChimeraX model ids (the lowest free) for every loaded structure, the named selections, the top
  molecule, the viewer's selection, ChimeraX's atom styles.

## 5. Execution

`runScript(host, text, dialect)`: split, compile every command against a working copy of the env (each command's names
visible to the next: `fetch 1cbs; select a, /1cbs//A`), run nothing if anything does not read, then run the commands in
order; the first failure stops. Selections are evaluated when their command runs (PyMOL's meaning).

### 5.1 The Prism host

- **`script.run`** `{ dialect, text, files }` runs a submission inside its own step (its calls through `ctx.api` join
  it); its value is what each command printed and said. All reads: `unchanged`, no step. **`script.names`** lists
  objects, molecule ids and names.
- **Session state** (`state.ts`, custom state `command-language`: Undo and saved sessions keep it with the tree): object
  names, molecule ids and ChimeraX model ids by structure ref, named selections, the top molecule, VMD's rep defaults,
  the components the console made for PyMOL's types, and ChimeraX's atom styles (§5.4; a closed structure's go with it).
  Tcl variables and atomselect handles are the area's, not state (not undone, as in VMD).
- **Targets** are `{ molql }` with the structure's ref: a selection's own part, or an atom set as `Loci.toExpression`
  (ranges of source indices) or `all`.
- **IR to operations** (`host.ts`): loads → `load.entry` / `load.url` / `load.data` (a file given with the submission),
  with `copy` when the compiler made a new object (VMD's `mol new`, PyMOL's `load`; `fetch` of a loaded name keeps it;
  when the structure loads after all, another entry than the object of that name, it gets a free name and the next
  molecule id, said in a warning: ids are never reused); `object.*` → `structure.remove` / `.visibility`; `select` →
  `select.clear` + `select.set` per structure; colors (RGB) → `representation.color` (overpaint, per atom, last write
  wins as PyMOL's `color`); per-element colors (`util.cba*`, `util.cnc`, `color atomic`) are a `require` of the
  selection and an optional color per element, so an element the selection lacks is no failure; color themes →
  `representation.update` of the colorTheme on the representations of the components the selection covers
  (`representation.update` is ui-only for commands and tools, not for an operation's own calls). A theme on a whole
  structure first resets its color layer (PyMOL's `util.cbc` after `color red` shows the chains); on part of a component
  it covers the whole component, which a warning says; transparency and size → `representation.transparency` / `.size`;
  `remove` → `contents.visibility` per entity and chain (whole chains only); camera → `camera.frame` / `.orient` /
  `.reset` / `.zoom`, and `camera.set` computed from the camera for `center`, `turn` and `move`; measurements →
  `measure.*` (one atom each, one structure; one selection of exactly the measure's atoms, in the structure's order:
  ChimeraX's `distance sel`); labels → `measure.label` per atom, or per residue at the residue (ChimeraX's; at most
  100); transparency of some representations → `representation.transparency`'s `types` (ChimeraX's surfaces); ChimeraX's
  lighting → `canvas.lighting` (occlusion, shadow, outline, fog); superposition → `superpose.chains` (sequence),
  `.tm-align` (structure), `.atoms` (PyMOL's `pair_fit`: Mol* pairs atoms in structure order, so pairs given out of that
  order fail); canvas → `canvas.background` / `.camera` / `.lighting`; frames → `trajectory.*`; images → `export.image`;
  reads computed from the atoms.
- **`undo` and `redo`** run alone, as the viewer's history (the menu's row calls `history.undo`); inside a script they
  would undo the script's own step, so `script.run` refuses them.

### 5.2 PyMOL's show and hide on a tree of components

PyMOL keeps a show flag per atom per representation; Mol\* keeps components (selections) holding representations. The
tree is the truth, read at each command (`display.ts`): what every component of a structure shows, in the IR's types.

- `show T, X`: the console's component for T (one per structure and type, recorded in the state) grows by the atoms of X
  that no other component already shows as T (not drawn twice); it is made when there is none. A polymer type (cartoon,
  putty, tube, backbone) takes the polymer atoms of X only: PyMOL draws nothing for the rest, and Mol\* refuses such a
  representation on atoms with no polymer (`show cartoon` right after a load leaves the waters and the ligand).
- `hide T, X`: every component showing T loses X: in place when it shows only T (a preset's polymer keeps its name), or,
  when it shows other types too, it gives up its T representation and its atoms outside X move to the console's T
  component. Prism removes a component left empty.
- `as T, X`: hide every type for X, then show T. `show everything` is refused (name a representation).
- `hide everything` and `as` also take X out of components showing what PyMOL has no word for (carbohydrate symbols).
- `cartoon putty|tube|automatic`: the atoms of X shown as cartoon-like move to the other type.

Why components, not transparency: hidden atoms leave the geometry (picking, bounds and framing ignore them, as in
PyMOL), and the tree reads as what the person made. The tree stays small: at most one console component per type per
structure.

### 5.3 VMD's reps

A molecule's reps are its components' representations in tree order, so a structure loaded any way has reps and Undo
keeps them in step. `mol addrep` adds a component of the rep's selection with one representation whose own params carry
the coloring and the material (`representation.update`: colorTheme, alpha). `mol mod*` change the selection
(`component.modify`), the type (the representation made again with the rep's coloring), the coloring or the material;
`mol delrep` removes the representation, or its component when it was the only one. A changed type or material keeps the
representation's other params (licorice stays licorice). A rep whose selection selects nothing fails (VMD would add an
empty rep and shift the indices); so does changing the selection or style of a rep that shares its component with others
(a preset's: they would change too, or move).

VMD's dialect loads with VMD's look: the preset `command-language-vmd-lines` (one rep: Lines of everything, VMD's Name
colors), registered through the extension's plugin parts, so the usual `mol delrep 0 top; mol addrep top` scripts end as
in VMD. It is in Prism's Preset menu for anyone. One palette (`colors.ts`) serves it and the commands.

### 5.4 ChimeraX's atom styles

ChimeraX draws a shown atom in its style (stick, ball, sphere), set by `style` and kept for atoms not shown yet. The
session state keeps the `style` commands' selections (fixed to the objects there were; oldest first, at most 16; a style
of every atom starts the list again, stick of every atom empties it): an atom's style is the last one covering it, else
stick. `show … atoms` shows each style's atoms in it and in no other atom style (Mol\*'s sticks, ball-and-stick,
spacefill, lines: `display` per style, optional, after a `require`); `style X S` restyles the atoms of X shown now in
any atom style, and records S. Cartoons and surfaces are the PyMOL host's types (§5.2); `transparency` changes surfaces
unless its target says otherwise, as ChimeraX.

## 6. Undo and failure

- One submission is one step: Undo (⌘Z, History) takes the whole submission back. Camera changes are view state, as
  everywhere in Prism.
- Compile errors are all reported at once and nothing runs (`invalid`); a runtime failure stops the script and the
  runner restores the step's checkpoint (`failed`), naming the line.

## 7. Diagnostics

`Diagnostic { severity, code, message, hint?, at }`. Codes: `syntax`, `unknown-command` (the nearest by edit distance,
or the other dialect's: "mol is VMD's: type vmd mol …"), `unsupported` (a real command or option Mol\* does not do, with
what to do instead), `unsupported-argument` (an error when the result would differ, a warning or note when it only looks
different: `png …, ray=1`), `argument`, `selection` (the transpiler's message on the argument), `no-name`, `runtime` (an
operation's failure, with its hint).

## 8. Completion

`complete(text, dialect, env)`: the command word; then by the argument's kind (representations, colors, settings, enums,
files, molecules); in a selection the dialect's keywords, properties and operators (query-language's lists), the
session's names and objects, and after `chain` / `resn` the structures' chains and ligands. In a ChimeraX spec: by the
symbol the word ends in (`#` model ids, `/` chains, `:` ligands, `@` atom names, `@@` `::` `//` attributes), else `sel`,
the names and the selectors; after a keyword its values; else the command's words and keywords. Items say what they are
(a kind, a detail; a named color its `rgb`). A completion edits the line (`applyCompletion`); a PyMOL argument with more
after it (not a selection, not the last) comes with its `, `, so the next one's completions follow at once. Once the
command's name is typed, `signature` is its usage with the argument being typed (`active`). Help prints the tables'
lines.

## 9. Prism integration

- **Prefixes** (`commandPrefixes`): `pymol `, `vmd `, `chimerax `, and `!` for the default dialect. A line's rows: what
  it will do (`describeCommand`, with warnings) or the first error and its hint (the row keeps the menu open), then
  completions, first while a word is being typed. Enter on the Run row runs `script.run` as the person; the menu has
  closed: the viewer says a person's run on the status line (what it did and printed, or why it failed), and the row
  posts the warnings, which the viewer does not say (`CommandPrefixContext.post`).
- **The default dialect** is chosen in `!`'s own rows ("Read ! as PyMOL") and kept in the person's preferences
  (`command-language.dialect`); without preferences it lasts for the session, per viewer. Why there: the extension's
  settings group is not shown by Prism, and the choice belongs where it is used.
- **Commands**: `script.run` (a form: dialect and text), `script.names`, and `script.console` (opens the console).
- **The assistant** (`skill.ts`): a skill, not a core tool, with one tool, `run_commands` over `script.run`, for what
  the person pasted or asked to run as written; the agent's own vocabulary stays the viewer's operations. Under the
  agent's policy (Prism's agent.md §4): `script.run` is `approval: 'network'` with `addresses` (a URL a load reaches;
  entries: the known services); an agent's run starts without Tcl variables (a variable set before cannot name what the
  approval did not see), loads only the addresses approved, and refuses what would ask the person on its own (removing
  structures, saving an image). Hiding and changing representations run inside the one undoable step, unasked: Undo
  takes the whole run back. Files cannot be given by the agent (`files` is hidden), so neither can included scripts.
- **The console** (`console-model.ts`, DOM-free; `console.tsx` and its CSS module, its own chunk through
  `ViewerExtension.ui`): a foot tab between History and the Assistant (the other panel one types into), named "PyMOL /
  VMD / ChimeraX console" on the rail (what it is, where "Console" alone could be a log) and "Console" in its header
  (the dialect switch is under it). A transcript of runs, each a status mark (running, done, failed), its dialect, the
  command and what it said: what it did, what reads printed (in a well), warnings and errors with their hints; its time;
  Edit puts a typed line back in the input, in its dialect. Empty, it says what it is and offers example lines of the
  dialect. The dialect is three pressed buttons, as the Log's filters; a line's `pymol ` / `vmd ` / `chimerax ` first
  word overrides it. The composer: the input (Enter runs, ⇧Enter a new line, ↑/↓ the history at its first and last line,
  Tab the first completion), a Run button, and one line under it, of one height whatever it says (what Enter will do and
  its warnings, or the first error and its hint, the hint left to the card while it shows the usage; `inspect`, the
  whole in the tip), so the composer never changes height as one types. A card over the transcript while a command is
  typed (from its name until the line runs, so it does not come and go between arguments): its help as the header (the
  usage with the argument being typed in bold, then what it does, the whole of it), and the completions of the word at
  the input's end under it when there are any (`assist`); idle, there is no card and the composer is one line high. The
  textarea says `aria-autocomplete`, `aria-controls` and the row picked (a textarea takes no combobox role). With the
  caret at the end: ↑/↓ pick, Tab or Enter take the one picked, Tab the first when none is, Enter with none picked runs;
  Esc closes the card until the next keystroke; a row picked is none again whenever the rows change; a line recalled
  from the history comes without its card, so ↑/↓ go on through the history; ⌘I (Ctrl+I) asks for the list: every
  command on the empty input, the card again after Esc; Tab on the empty input moves the focus on, as anywhere. A row is
  its kind or a color's swatch, the label with the part typed marked, and the detail, left out when every row has the
  same one. The tab's icon is `terminal` (`>_`). Every error of a submission shows at once, before anything runs; `undo`
  / `redo` alone are the viewer's history; submissions run one after another. **Import** (and dropping on the tab, an
  overlay saying where): scripts with the files they load, the ones no other includes run (`rootScripts`), each whole in
  the dialect its extension says; files without a script are loaded as the line that loads them (`load 1cbs.cif`,
  `mol new 1cbs.cif`, `open 1cbs.cif`), shown in the transcript. A log, not live (the viewer says each run). The tab
  fills the panel: the transcript scrolls, the bar and the composer stay, and the newest is always in view (each entry
  observes its own size, as it renders its outcome on its own, and the box its; one scroll a frame, `frames`). The
  history of lines is kept with the preferences (`command-language.history`, the last 200).

## 10. Tests

Quick lane: `src/language/_test` (tokenizers, every table example, every unsupported command, diagnostics, names and
objects, completion; ChimeraX's abbreviations as ChimeraX resolves them, its keywords' case, its colors) and
`src/prism-viewer/_test` (a headless viewer with 1CBS given as a file: show/hide/as on the tree, Undo of a submission,
rollback, names, measurements with a stand-in canvas, VMD reps and handles, the menu's rows, the console's model and its
view under jsdom, and the example scripts, `src/examples.ts`, each imported with its structures and replayed: no error,
no warning but the ones it lists as known; the lines that need a canvas are left out headless). ChimeraX's atom specs
are checked against ChimeraX itself: Mol\*'s atom counts against ChimeraX 1.10's on 1CBS and 1TUP
(`model/src/script/_test/chimerax-oracle.*`, recorded by hand with ChimeraX). No network. The stories
(`apps/prism-viewer`, "PyMOL, VMD and ChimeraX commands") replay the same scripts in full.
