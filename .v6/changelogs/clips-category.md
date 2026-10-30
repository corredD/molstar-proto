## prism-me: clips in a category of their own

- A Clips category after Structures, Particles, Volumes and Meshes holds every clip of the scene, each with how many
  objects or parts it cuts, its eye (drawn in the scene) and its trash; no clip row under a node any more.
- A clip's properties: its editor (handles, numbers, On top, remove, shape, invert), then What it cuts: every object or
  part it is given (a model's largest groups, its entities, a list's targets, a structure's entities or chains), each
  with × to take it off, and Cut also… to add one; one step each (`explorer.clipUse`). The last one has no ×: remove the
  clip instead.
- A node's Clips: the clips that cut all of it, each with ×; New clip (a shape: it cuts this); Use a clip (one of the
  scene's). A category's: New clip and Use a clip for every object in it.
- Add clip… (the scissors, the right-click) lists a new clip of each shape, then every clip of the scene, those on it
  already greyed.
- One clip is one Prism cut (its tag): a part added to a clip that cuts another part of the same model writes the
  union to the representations' record, so the membrane and the capsid of HIV are cut by one plane.
