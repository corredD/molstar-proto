# ChimeraX: scope

What the ChimeraX dialect does ([README](README.md)), written from the command tables by
`src/_test/scope-spec.test.ts` (`UPDATE_SPEC=1` writes it). An omitted atom spec is everything, as in ChimeraX.
A command or keyword may be shortened as ChimeraX allows: a command is the first, in ChimeraX 1.10’s order, that
starts with what is typed (`sel` select, `col` color, but `sh` shape); a keyword one that starts with it, any case
when typed in lower case (`tar` target, `bgcolor` bgColor).

## Commands

| Command | Usage | What it does in Mol\* |
| --- | --- | --- |
| `open` | `open names [format f] [fromDatabase db] [name n]` | Open a PDB entry (1cbs, pdb:1cbs), an AlphaFold DB model (alphafold:P69905), a URL or a file given. |
| `close` | `close [models]` | Close models (structures); no models: everything. `close session` also forgets the names. |
| `close session` | `close session` | Close everything, and forget the names and styles. |
| `show` | `show [objects] [atoms\|cartoons\|surfaces\|models,…] [target acsm] [only]` | Show atoms (in their style), cartoons, surfaces or models; no objects: everything. |
| `display` | `display [objects] [atoms\|cartoons\|surfaces\|models,…] [target acsm] [only]` | Show atoms (in their style), cartoons, surfaces or models; no objects: everything. |
| `hide` | `hide [objects] [atoms\|cartoons\|surfaces\|models,…] [target acsm]` | Hide atoms, cartoons, surfaces or models; no objects: every atom. |
| `~show` | `~show [objects] [atoms\|cartoons\|surfaces\|models,…] [target acsm]` | Hide atoms, cartoons, surfaces or models; no objects: every atom. |
| `~display` | `~display [objects] [atoms\|cartoons\|surfaces\|models,…] [target acsm]` | Hide atoms, cartoons, surfaces or models; no objects: every atom. |
| `style` | `style [objects] [stick\|ball\|sphere]` | Draw atoms as sticks, balls or spheres (now and when they are shown later). |
| `cartoon` | `cartoon [atoms]` | Show cartoons (polymers only). |
| `ribbon` | `ribbon [atoms]` | Show cartoons (polymers only). |
| `cartoon hide` | `cartoon hide [atoms]` | Hide cartoons. |
| `~cartoon` | `~cartoon [atoms]` | Hide cartoons. |
| `~ribbon` | `~ribbon [atoms]` | Hide cartoons. |
| `cartoon style` | `cartoon style [atoms] [worm true\|false]` | Draw cartoons as worms (Mol*’s putty) or not. |
| `surface` | `surface [atoms] [color c] [transparency percent]` | Show molecular surfaces (Mol*’s: of the atoms given). |
| `surface hidePatches` | `surface hidePatches [atoms]` | Hide molecular surfaces. |
| `surface close` | `surface close [atoms]` | Hide molecular surfaces. |
| `~surface` | `~surface [atoms]` | Hide molecular surfaces. |
| `surface style` | `surface style [atoms] solid\|mesh\|dot` | Draw surfaces solid, as a mesh, or as dots. |
| `color` | `color [objects] [color [what]] [target acsr] [transparency percent]` | Color objects: a ChimeraX color name, #rrggbb or r,g,b; byhetero, byelement, bychain, bypolymer, byidentity, bymodel. |
| `color bfactor` | `color bfactor [atoms] [palette p]` | Color by B-factor along a palette (bluered by default). |
| `color byattribute` | `color byattribute bfactor [atoms] [palette p]` | Color by B-factor along a palette (bluered by default). |
| `rainbow` | `rainbow [objects] [residues\|chains\|polymers] [palette p]` | Color residues along a rainbow per chain (or chains, polymers). |
| `transparency` | `transparency [objects] percent [what] [target acsr]` | Make objects transparent, in percent (surfaces unless a target says). |
| `size` | `size [objects] [atomRadius r] [stickRadius r] [ballScale s]` | Size sticks (stickRadius), balls (ballScale) or atoms (atomRadius), as factors of ChimeraX’s defaults. |
| `select` | `select [objects]` | Select objects (`sel` names the selection afterwards). |
| `select add` | `select add [objects]` | Add objects to the selection. |
| `select subtract` | `select subtract [objects]` | Take objects out of the selection. |
| `~select` | `~select [objects]` | Take objects out of the selection (no objects: clear it). |
| `select clear` | `select clear` | Clear the selection. |
| `name` | `name name spec` | Name an atom spec, used as a selector after (re-read with the models there are then). |
| `name frozen` | `name frozen name spec` | Name the atoms an atom spec selects now (later models are not in it). |
| `name delete` | `name delete name` | Forget a name (`all`: every one). |
| `name list` | `name list` | List the names. |
| `view` | `view [objects] [orient] [pad fraction]` | Frame objects (no objects: everything); `view orient` orients along the principal axes. |
| `turn` | `turn [axis [angle [frames]]]` | Turn the scene about a screen axis, in degrees (no arguments: 90° about y). |
| `move` | `move axis [distance [frames]]` | Move the scene along a screen axis, in Ångströms. |
| `zoom` | `zoom [factor [frames]]` | Zoom by a factor (2: twice as large). |
| `distance` | `distance objects` | Measure the distance between two atoms. |
| `angle` | `angle objects` | Measure the angle of three atoms. |
| `torsion` | `torsion objects` | Measure the torsion angle of four atoms. |
| `distance delete` | `distance delete` | Remove the distance measurements. |
| `~distance` | `~distance` | Remove the distance measurements. |
| `label` | `label [objects] [residues\|atoms] [text t] [attribute a]` | Label residues (by default: name and number) or atoms; text gives the text ({0.name}, {0.number}). |
| `label delete` | `label delete [objects] [residues\|atoms]` | Remove labels (no objects: every one). |
| `~label` | `~label [objects] [residues\|atoms]` | Remove labels (no objects: every one). |
| `matchmaker` | `matchmaker matchAtoms to atoms` | Superpose by sequence alignment (Mol*’s chain superposition); says the RMSD. |
| `mmaker` | `mmaker matchAtoms to atoms` | Superpose by sequence alignment (Mol*’s chain superposition); says the RMSD. |
| `align` | `align atoms toAtoms atoms` | Superpose atoms on atoms, paired in order; says the RMSD. |
| `set` | `set [bgColor c] [silhouettes true\|false]` | Set the background color (bgColor) or silhouettes. |
| `~set` | `~set bgColor` | Put the background back to black (bgColor). |
| `lighting` | `lighting [preset] [shadows true\|false] [depthCue true\|false] [multiShadow n]` | Lighting presets (simple, soft, full, flat, gentle, default), shadows, depth cue. |
| `graphics silhouettes` | `graphics silhouettes [true\|false]` | Outlines on or off. |
| `camera` | `camera [ortho\|mono] [fieldOfView degrees]` | Orthographic (ortho) or perspective (mono) projection; the field of view. |
| `save` | `save name.png [width w] [height h] [transparentBackground true\|false]` | Save an image (PNG): name.png [width w] [height h] [transparentBackground true]. |
| `undo` | `undo` | Undo the last step (alone on its line). |
| `redo` | `redo` | Redo what Undo took back. |
| `info` | `info` | List the models: their ids and names. |
| `info models` | `info models` | List the models: their ids and names. |
| `info selection` | `info selection` | Count the atoms selected. |
| `measure center` | `measure center objects` | The center of atoms. |
| `coordset` | `coordset models [frame]` | Show a frame of a trajectory (1-based), or play it. |
| `wait` | `wait [frames]` | Nothing to wait for: Mol* renders as commands run. |
| `stop` | `stop` | Nothing to stop: Mol* moves at once. |

Also `help [command]` and `usage command`, and `open file.cxc`: a script given with this one runs in its place.
Keywords ChimeraX takes that change nothing here are read and warned about.

## Colors

ChimeraX’s 139 built-in colors by name (`red`, `cornflower blue` or
`cornflowerblue`), `#rgb`, `#rrggbb`, `r,g,b` in percent, `rgb(…)`, `rgba(…)`, `gray(…)`, `hsl(…)`, `hsla(…)`;
`byhetero` and `byelement` with ChimeraX’s element colors; `bychain`, `bypolymer`, `byidentity`, `bymodel` with
Mol*’s themes (Mol*’s palettes).

## Atom specs

ChimeraX 1.10’s grammar (query-language’s ChimeraX transpiler): `#1`, `#1-3`, `#1.2`, `/A`, `/A-C`, `:12-20`,
`:ALA`, `@CA`, wildcards (`*`, `?`, `[…]`), `@@` `::` `//` attribute tests, zones (`@<`, `:<`, `/<`, `#<` and
`>`), `~`, `&`, `|` (one precedence, grouped to the right), `sel` (the selection) and the names `name` defines.
Model ids are ChimeraX’s: given at load, the lowest free.

| Selector | What |
| --- | --- |
| `all` | everything |
| `protein` | proteins |
| `nucleic` | nucleic acids |
| `nucleic-acid` | nucleic acids |
| `main` | the main structure: polymers |
| `ligand` | ligands: small molecules other than solvent and ions |
| `ions` | ions |
| `solvent` | solvent |
| `backbone` | backbone atoms |
| `mainchain` | backbone atoms |
| `min-backbone` | minimal backbone atoms |
| `sidechain` | side-chain atoms, with the CA (proteins) and the sugar ring (nucleic acids) |
| `sideonly` | side-chain atoms only |
| `ribose` | ribose |
| `helix` | helices |
| `strand` | strands |
| `coil` | coils |
| element symbols | `C`, `N`, `Zn`, … (case matters) |

Not supported: `sel-residues`, `template-mismatch`, `pbonds`, `hbonds`, `clashes`, `contacts`, `missing`, `aromatic`, `aliphatic`, `amide`, `amine`, `carbonyl`, `carboxylate`, `disulfide`, `ester`, `ether`, `hydroxyl`, `methyl`, `nitro`, `phosphate`, `sulfonate`, `thiol`, and the IDATM atom types.

| Level | Attributes |
| --- | --- |
| atom | `bfactor`, `occupancy`, `name`, `element`, `serial_number`, `alt_loc` |
| residue | `name`, `number`, `insertion_code`, `chain_id`, `label_seq_id`, `is_helix`, `is_strand` |
| chain | `chain_id` |

## Targets and atom styles

Atoms: `ball-and-stick` (sizeAspectRatio: 1), `ball-and-stick`, `spacefill`, `line` (an atom shows in one style: stick, ball or
sphere, set by `style` and kept for atoms shown later). Cartoons: `cartoon`, `putty`. Surfaces: `molecular-surface`.
Models: the structure’s visibility. Pseudobonds are not drawn.

## Not supported

| Command | Why | Instead |
| --- | --- | --- |
| `volume` | Maps and volumes are not supported yet. | Maps and volumes are not supported yet. |
| `vop` | Map operations are not supported. | Maps and volumes are not supported yet. |
| `molmap` | Maps from atoms are not supported. | Maps and volumes are not supported yet. |
| `fitmap` | Fitting into maps is not supported. | Maps and volumes are not supported yet. |
| `segger` | Map segmentation is not supported. | Maps and volumes are not supported yet. |
| `segmentation` | Segmentations are not supported. | Maps and volumes are not supported yet. |
| `segmentations` | Segmentations are not supported. | Maps and volumes are not supported yet. |
| `measure` | Of the measure commands only `measure center` is supported. |  |
| `delete` | Deleting atoms is not supported. | Mol* shows structures as they are loaded; it does not edit them. Hide them: hide … |
| `addh` | Adding hydrogens is not supported. | Mol* shows structures as they are loaded; it does not edit them. |
| `addcharge` | Adding charges is not supported. | Mol* shows structures as they are loaded; it does not edit them. |
| `swapaa` | Mutating residues is not supported. | Mol* shows structures as they are loaded; it does not edit them. |
| `swapna` | Mutating residues is not supported. | Mol* shows structures as they are loaded; it does not edit them. |
| `build` | Building is not supported. | Mol* shows structures as they are loaded; it does not edit them. |
| `bond` | Adding bonds is not supported. | Mol* shows structures as they are loaded; it does not edit them. |
| `altlocs` | Changing alternate locations is not supported. | Mol* shows structures as they are loaded; it does not edit them. |
| `changechains` | Renaming chains is not supported. | Mol* shows structures as they are loaded; it does not edit them. |
| `renumber` | Renumbering residues is not supported. | Mol* shows structures as they are loaded; it does not edit them. |
| `setattr` | Setting attributes is not supported. | Mol* shows structures as they are loaded; it does not edit them. |
| `defattr` | Setting attributes is not supported. | Mol* shows structures as they are loaded; it does not edit them. |
| `hbonds` | Hydrogen bonds are not drawn. | Mol* shows interactions from the Structure panel (the Interactions component). |
| `contacts` | Contacts are not drawn. | Mol* shows interactions from the Structure panel (the Interactions component). |
| `clashes` | Clashes are not drawn. | Mol* shows interactions from the Structure panel (the Interactions component). |
| `interfaces` | Interface diagrams are not drawn. | Mol* shows interactions from the Structure panel (the Interactions component). |
| `sym` | Symmetry copies by command are not supported. | Mol*’s Assembly in the Structure panel shows assemblies. |
| `morph` | Morphs are not supported. | Use the snapshots and animation panels. |
| `movie` | Movies are not recorded here. | Use the snapshots and animation panels. |
| `roll` | Turning without end is not supported. | turn y 90 turns once; the Spin control spins. |
| `rock` | Rocking is not supported. | turn y 30 turns once. |
| `wobble` | Wobbling is not supported. | turn y 30 turns once. |
| `2dlabels` | Labels on the screen are not supported. | label puts labels on atoms or residues. |
| `shape` | Shapes are not drawn. |  |
| `marker` | Markers are not placed. |  |
| `clip` | Clipping by command is not supported. | The Canvas panel clips the view. |
| `cofr` | The center of rotation is not set by command. | Mol* turns about the view’s center. |
| `nucleotides` | Nucleotide shapes are not drawn. | cartoon shows nucleic acids. |
| `sequence` | The sequence viewer is not driven by command. |  |
| `tile` | Arranging models is not supported. |  |
| `split` | Splitting models is not supported. |  |
| `combine` | Combining models is not supported. |  |
| `rename` | Renaming models is not supported. |  |
| `palette` | Palettes by command are not supported. | color bfactor and rainbow take palette. |
| `key` | Color keys are not drawn. |  |
| `scalebar` | Scale bars are not drawn. |  |
| `perframe` | Commands per frame are not run. | Use the snapshots and animation panels. |
| `alias` | Aliases are not defined. |  |
| `runscript` | Python scripts are not run. | Scripts here are ChimeraX commands; Python is not run. |
| `pwd` | There is no folder: files come with the script. |  |
| `cd` | There is no folder: files come with the script. |  |
| `log` | The console is the log. |  |
| `windowsize` | The window is the page’s. | save image.png width 1200 height 900 sets the image’s size. |
| `material` | Materials are Mol*’s. | lighting soft, lighting full. |
| `dssp` | Secondary structure is Mol*’s (the file’s, else computed). |  |
| `coulombic` | Electrostatic coloring is not supported. |  |
| `mlp` | Lipophilicity coloring is not supported. |  |
| `alphafold` | Of AlphaFold’s commands, fetching is open alphafold:UniProtId. | open alphafold:P69905 |
| `esmfold` | Predicting structures is not supported. |  |
| `boltz` | Predicting structures is not supported. |  |
| `blastprotein` | Sequence searches are not supported. |  |
| `blastpdb` | Sequence searches are not supported. |  |
| `foldseek` | Structure searches are not supported. |  |
| `similarstructures` | Structure searches are not supported. |  |
| `modeller` | Modelling is not supported. |  |
| `rmsd` | RMSD without superposing is not supported. | matchmaker and align say the RMSD. |
| `exit` | There is nothing to quit. |  |
| `quit` | There is nothing to quit. |  |
| `toolshed` | Bundles are not installed here. |  |
| `ui` | ChimeraX’s windows are not here. |  |
| `tool` | ChimeraX’s tools are not here. |  |
| `mousemode` | Mouse modes are Mol*’s. |  |
| `vr` | VR by command is not supported. | The Canvas panel enters the headset view. |
| `xr` | XR by command is not supported. | The Canvas panel enters the headset view. |

Any other ChimeraX command fails too, saying it is ChimeraX’s.
