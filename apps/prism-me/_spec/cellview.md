# cellVIEW's scene tree and cut mapping (reference)

What cellVIEW (cellPACKgpu, the Unity viewer: `~/Dev/cellpackgpu`, commit `1f0bbd67`) does, read from its code, as the
reference for porting its ideas to prism-me. It records cellVIEW's behaviour, not prism-me's decisions: those are in
[architecture.md](architecture.md) and [ui.md](ui.md), and what is worth taking is in
[../progress/2026-10-28-cellview-evaluation.md](../progress/2026-10-28-cellview-evaluation.md). Paths are under
`Assets/`; "(inferred)" marks what was reasoned from the code, not read.

## 1. What the tree is

- **The tree edits the selected cut's mapping; it does not show or hide.** Each row edits the per-ingredient parameters
  of the cut picked in the cut list (§3). An ingredient type is shown or hidden in another panel, the ingredient panel
  (`Scripts/Misc/UIIngredient.cs:480-691`), §2.
- **The live tree** is `UI List/Scripts/TreeViewController.cs` (uGUI, with `BaseItem.cs`, `RangeFieldItem.cs`,
  `CustomRangeSlider.cs`, `ThreeStateToggle.cs`). `TreeViewControl/` (an IMGUI tree) is referenced only from
  commented-out code (`Scripts/Misc/CutObject.cs:123-124, 353-400`).
- **The cut panel's sliders** (fuzziness, distance, curve, aperture) are wired in the scenes under
  `Scenes/local_scenes/` (the `OnFuzzinessChanged` handlers), not in `Scenes/cellpackgpu.unity`.

## 2. The data model

- **Nodes are dotted paths**, one flat ordered list (`RecipeManager.SceneHierarchy`,
  `Scripts/Global Objects/RecipeManager.cs:113`). Only ingredients add paths, with their ancestors, parent first
  (`AddIngredientToHierarchy`, `:613-641`). So compartments, surface/interior and groups exist only as path prefixes. An
  empty compartment has no row, and compartment meshes are not nodes.
- **Paths:** `root.<compartment>.(surface|interior).<group>.<ingredient>`, built from the recipe
  (`Scripts/Utils/CompartmentUtils.cs:156-200`; surface and interior are child compartments, `:220, 762`; inferred from
  these). Fibers have `fibers` in place of `proteins` (`Scripts/Loaders/CellPackLoader.cs:177, 184`). Lipids have
  hard-coded paths, `root.envelope.membrane.inner_membrane` and `outer_membrane` (`RecipeManager.cs:320-327`).
- **Ingredient index space:** proteins, then lipids, then curves (`RecipeManager.cs:146-160`). The lookups are node →
  ingredient (−1 for an inner node) and ingredient → node (`Scripts/Global Objects/CPUBuffers.cs:246-300`).
- **Visibility is one flag per ingredient type:** `IngredientsInfo[type].w`, 0 shown and −1 hidden, set on the CPU, with
  the whole array uploaded at each change (`UIIngredient.cs:480-507`). Never per instance.
  - Proteins: a hidden type is skipped when its draw batches are built
    (`Scripts/Shaders/ComputeSphereBatches.compute:70`).
  - Curves: a hidden type is given 0 spheres (`Scripts/Shaders/RenderCurveIngredients.shader:276-279`).
  - Lipids: the batch kernel reads only the cut flag and the frustum (`ComputeSphereBatches.compute:143-165`), so hiding
    a lipid type looks like a no-op (inferred).
- **The ingredient panel's actions:** show only this; show only the same group, compartment, partners or custom-data
  value; highlight only (`UIIngredient.cs:491-691`).

## 3. A row

- **What it shows** (`RangeFieldItem.cs:8-13`, `BaseItem.cs:140-279`):
  - the last segment of the path;
  - a fold arrow when the node has children;
  - **focus**, a checkbox (`IsFocus`), with a lock toggle shown when focused;
  - **+ / 0 / −**, a three-state toggle (`value1`);
  - a bar with two handles (handle 0 sets `value2`, handle 1 sets `value1`; drag ÷ 200, clamped to 0–1,
    `TreeViewController.cs:594-634`);
  - an occluder mark when `!IsFocus && (value2 < 1 || Aperture > 0)` (`:448`).
- **No color and no count** in a row: those are in the ingredient panel (`UIIngredient.cs:18-52`).
- **A click on a parent writes every leaf under it** (focus `:466-500`, + / 0 / − `:502-534`). Inner nodes hold no value
  of their own.
- **A parent shows its leaves, without a mixed state:**
  - focus is on when any leaf is focused (`BaseItem.cs:271-279`);
  - - / 0 / − shows the leaves' mean `value1`: exactly 0.5 shows 0, below shows −, above shows +
      (`TreeViewController.cs:452-464`, `ThreeStateToggle.cs:44-60`). A mixed parent shows + or −.
- **The toggle** cycles 0 → + → 0 → − (`ThreeStateToggle.cs:62-79`) and writes `value1` = 1 (+), 0.5 (0), 0 (−)
  (`TreeViewController.cs:505`).
- **The panel's sliders** show the mean over the selected node's leaves and write all of them (`:189-343, 546-576`).
- **Selection:** a click selects the row and records it on the selected cut. Switching cuts restores that cut's selected
  row (`:139-150, 164-171`).
- **Hover** writes per-ingredient states to the GPU (`:87-111`), but no live shader reads them: the hover highlight is
  dead.
- **Search:** an autocomplete over every path, matching substrings (`Scripts/Misc/UImanager.cs:449-452`).
- **No virtualization:** one GameObject per node, laid out every `FixedUpdate` with a lens effect (`:782-911`). The tree
  is rebuilt whole on each recipe load (`:36-68`).

## 4. Cuts

- **Shapes:** plane, sphere, cube, cylinder, cone (infinite), capsule and none (`CutObject.cs:7-16`). Each is an
  analytic signed distance on the cut's transform (`Scripts/Shaders/Helper.cginc:509-641`). None returns 0.1: it cuts
  nothing, or everything when inverted.
- **Per cut:** `Inverse`, `HardCut`, `Hidden` (the gizmo), a lock state (unlocked, locked, consumed, restore), and the
  gizmo's alpha, shared by all cuts (`CutObject.cs:37-43, 81-91`). Only the selected cut's gizmo is drawn
  (`UICutmanager.cs:107-118`).
- **The mapping is a dense cut × ingredient table.** Each cut has one `CutParameters` per ingredient type
  (`CutObject.cs:45-64, 145-174`):

  | Field                                     | Default | Meaning                                                    |
  | ----------------------------------------- | ------- | ---------------------------------------------------------- |
  | `IsFocus`                                 | false   | the ingredient is a focus of the aperture cut (§4.2)       |
  | `value1`                                  | 0.5     | the bias: 1 is +, 0.5 is 0, 0 is −                         |
  | `value2`                                  | 1       | the probability that an occluder is kept (aperture cut)    |
  | `fuzziness`                               | 0       | how much the bias thins out with distance (0–1)            |
  | `fuzzinessDistance`                       | 1       | the band's width: `0.01 + fuzzinessDistance · 250` (units) |
  | `fuzzinessCurve`                          | 1       | the exponent on the normalized distance                    |
  | `Aperture`                                | 0       | the share of the focus's silhouette opened (aperture cut)  |
  | `range*`, `count*`, `IsHighlighted`, `Id` |         | unused                                                     |

- **On the GPU** (`Scripts/Global Objects/CutObjectManager.cs:93-130`): `CutInfoStruct`, 48 B per pair, at
  `ingredient + ingredientCount · cut`. Its fields are `info` = (type, value1, value2, inverse), `info2` = (fuzziness,
  fuzzinessDistance, fuzzinessCurve, Aperture), `info3.w` = hardCut. Position, rotation and scale are one float4 per
  cut. The table is rebuilt and uploaded every frame. Capacity: 100 cuts × 1000 types (`GPUBuffers.cs:97, 501-504`).

### 4.1 The object-space cut, per instance

Every frame, one thread per instance (`Scripts/Shaders/ObjectSpaceCutAways.compute:32-169`), at the instance's center (a
lipid: its middle atom). For each cut, with its (cut, ingredient) parameters:

1. `d` = the signed distance, negated when inverted; the instance is in the cut when `d ≤ 0`.
2. `b = 2 · value1 − 1` (the bias, −1 to 1).
3. **+** (`b > 0`): an instance in the cut is **kept** unless it passes `T(b)`.
4. **−** (`b < 0`): an instance outside the cut is **cut too** unless it passes `T(−b)`.
5. **0**: the plain cut.
6. The cuts are OR-ed: an instance cut by any cut is cut.

`T(p)` (`Helper.cginc:592-605`):

```
nd = (|d| / (0.01 + fuzzinessDistance · 250)) ^ fuzzinessCurve
T  = nd > 1  or  rand(id) < 1 − p · lerp(1, 1 − fuzziness, nd)
```

`rand` is a Wang hash of the instance id, so an instance is thinned the same way every frame.

What that does, with `w = 0.01 + fuzzinessDistance · 250` the band's width (scene units; at the default, 250):

- **+ keeps a margin**: at full strength (`value1` 1, `fuzziness` 0), an instance in the cut less than `w` from its
  surface is kept, and deeper ones are cut. The cut leaves a layer of that ingredient on its face.
- **− widens the cut**: at full strength, an instance outside the cut less than `w` from its surface is cut too.
- **Fuzziness thins the band toward its far edge**: at the surface the full strength applies; at the band's edge an
  instance is affected with probability `1 − fuzziness`. A partial bias (`value1` between) affects that share of the
  instances. Which instances, is stable per instance (`rand(id)`).

Fibers use a simpler rule, without fuzziness: − cuts the whole type, + is never cut, 0 cuts where `d ≤ 0`
(`RenderCurveIngredients.shader:90-110`).

**HardCut** cuts per atom, not per instance: an atom with `d < 0` gets radius 0 in the tessellation path, which slices
through molecules (`Scripts/Shaders/RenderProteinsAdv.shader:354-372`).

### 4.2 The aperture cut, in screen space (the visibility equalizer)

Le Muzic et al.'s cutaway: what lies in front of the focus ingredients is opened, most at the middle of their
silhouette. Every frame, for each cut (`Scripts/Rendering/SceneRenderer.cs:1228-1355`):

1. The focus ingredients (`IsFocus`) are drawn as sphere impostors into a depth and stencil mask (`:960-1030`).
2. A jump-flood distance transform, 9 passes at 512² (`:854-958`, `FloodFill.compute`), gives each pixel its distance
   inside the silhouette to its edge.
3. The occluders (`!IsFocus && (Aperture > 0 || value2 < 1)`, `:1308`) are drawn where the stencil is set and they are
   in front of the focus. Each writes a flag per instance (`ViewSpaceCutAways.shader:126-149`): 0 not over the focus, 1
   near the silhouette's edge (within the aperture), 2 deeper inside.
4. `DiscardOccluding*` (`ComputeVisibility.compute:73-161`): an instance flagged 2 is cut; one flagged 1 is cut when
   `rand(id) > value2`.

**Lock:** a locked cut writes its id into each instance it cuts (`instanceInfo.w`) and is then consumed: the instances
stay cut as the cut moves away. Restore clears them (`SceneRenderer.cs:1273-1291`).

### 4.3 Ghosts

Cut or hidden instances can be drawn again as outlines only: drawn to ID buffers, edges found, and the edges laid over
the image (`SceneRenderer.cs:1394-1469`, `Composite.shader:500-513`; `EnableGhosts`, `WhenGhosts`: at which stage of the
composition).

## 5. What is saved

The scene state (JSON) holds the camera and, per cut, its type, scale, position, rotation and per-ingredient parameters
(`UImanager.cs:9376-9418`, `CompartmentUtils.cs:1639-1655`). Not saved: `Inverse`, `HardCut`, the lock, the tree's fold
and selection, the ingredients' visibility. Parameters are keyed by ingredient index, not path, so a changed recipe
misreads them.

## 6. Defects (not to port)

- **The HardCut line resets every earlier cut:** `if (hardCut) cut = false` runs inside the loop over cuts, erasing the
  OR of the cuts before it (`ObjectSpaceCutAways.compute:85-87`).
- **Adding or removing a cut wipes every cut's mapping:** `UpdateCutObjectParams` re-initializes every cut's parameters
  (`CutObjectManager.cs:132-140`, called from `UICutmanager.cs:218, 266, 281`). Loading several cuts keeps the last
  one's only (`UImanager.cs:9379-9385`); enabling a cut again wipes it too (`CutObject.cs:459-461`).
- **Exports do not match the screen:** the CPU cut used by the CIF and PDB exports skips the fuzziness, the hard cut,
  the aperture and `value2` (`CutObjectManager.cs:281-327`).
- **Visibility is reset by a palette change:** `ColorManager.InitColors` rebuilds `IngredientsInfo` with `w = 0`
  (`Scripts/Global Objects/ColorManager.cs:93, 155`).
- **Index hazards:** an ingredient missing from the hierarchy shifts every later lookup (`CPUBuffers.cs:279-285`); the
  membrane loader gives lipids ingredient type 0, a protein's cut row (`LoaMembrane.cs:79`).
- **Dead work every frame:** the per-node histograms are added to by atomics on every instance, never cleared and never
  read (`ObjectSpaceCutAways.compute:150-168`; `SceneRenderer.cs:1653-1654`); the aperture's masks and flood fill run
  even when nothing is culled (`:1324`); the default path (`force_simple`) reads the draw count back to the CPU every
  frame (`Scripts/Utils/RenderUtils.cs:215`).
- **Quadratic UI:** linear parent lookups per node at build (`TreeViewController.cs:580, 689`), `List.Contains` per item
  in the lookups (`CPUBuffers.cs:250-300`), leaves collected again per node (`:438-464`).
