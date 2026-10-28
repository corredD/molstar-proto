## prism-me: the explorer's properties on their mock

- The explorer's properties are the Storybook mock's frame (`apps/prism-me/src/explorer/properties-view.tsx`): the
  picked row's name and its kind in words, a model's Group by above, then Prism's `SectionList` (every section starts
  folded; one opened or folded stays so from row to row this session; a folded one is paused). Lines on Prism's tokens
  and label column, no inline styles; every color on Prism's color row and its `ColorPicker` (a mesh's too, not the
  system's picker), a color with none of its own saying so.
- A category's properties: Look (visible, a color theme for every object under it, as its brush: one step) and Clips
  (the cuts its scissors made, each editable).
- A clip's shape (plane, sphere, box, cylinder, cone) and invert in its properties, one step each (`clipping.update`), in
  a node's Clips, a category's and a clip row's own section.
- A Labels section on every node: each label made at it, its text and size edited, removed, one step each.
- The cryo-ET and mesoscale controls the properties show are on Prism's tokens (a CSS module each, with `styles` and
  `styles:check`).
