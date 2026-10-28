## prism-me: the explorer's tree on its mock

- The explorer's tree is the Storybook mock's view (`apps/prism-me/src/explorer/tree-view.tsx`): virtualized (an opened
  model of thousands of entities makes a screenful of rows), Prism's tree keys (a category picked too, Home and End), a
  row's brush, scissors, eye and ⋯ at its end on hover (always on touch), the ⋯ opening its right-click menu; the split
  to the properties dragged or moved by the arrows.
- A category's eye, scissors and brush act on every object under it, one step each; a row's trash removes an object, a
  clip, a label or a distance (as its menu's Remove); clips are rows under the row they were made at.
- `mesoscale.theme` (⌘K, the agent's `color_objects_by_theme`): a color theme for several objects at once (by object,
  entity, chain, generated colors, one color), each kind by what it takes: structures, particle models and lists,
  volumes' isosurfaces, meshes; one history step.
