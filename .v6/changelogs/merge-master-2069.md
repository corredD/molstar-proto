## Master's #2069 in prism-me (overlay gizmos, clip ghosts, mesoscale loads)

- Ghosts of what clips cut are master's (`Canvas3DParams.clipGhost`, Prism `clipping.settings ghost`): a faint tint
  and edges of what clip objects remove, canvas-wide; prism-me's outlined ghost per clip (`Clip.Params.ghost`) and the
  outline's `transparentColor` are gone. The Mesoscale Explorer's Ghosts switch sets it for every clip.
- Handles are master's overlay gizmos: always drawn over the scene, highlighted with a glow when hovered (no yellow);
  prism-me's on-top layer (`Canvas3D.setOnTop`, `VisualSet.setOnTop`, `GizmoLook.onTop`, On top in the explorer, ⌘K
  "Handles on top") is gone; `canvas.handles` sets the size only.
- Moving a structure, a particle list, a shape or a volume by hand is master's `move` feature (prism-viewer's
  `structure-move` is gone); a scaled placement's pose is its turn alone (prism-me's fix kept).
- `transformHandles`' `rotate` is master's `rings` (with `roll`, `free`); Cryo-ET's oblique handle stays tilt-only.
- GPU culling dispatches past the workgroup limit and stores culled regions as instance indices (master's); prism-me
  keeps cells by member (a drag's preview writes the moved member alone), the wiggle and tumble allowance and the
  occlusion clamp on master's layout.
- Fixes: a particle list transformed or offset by prism-me's ops after a decoration redraws its targets (an identity
  move was taken from a stale `movedFrom`); a target representation's transform syncs its merged objects; a
  `VisualSet` update settles when its representation is removed meanwhile.
