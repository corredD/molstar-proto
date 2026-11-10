## prism-me: the mesoscale operations on a MesoViewSpec document, as patches

- The Entities controls on a document's lists (style, Generate colors, a uniform color, theme colors, Import colors,
  a category's Color… by object, by entity, uniform, generate) now change the document: each is one style look of the
  shown view (`l.style.<n>`), one step, saved with the document. The same address again sets that look and moves it
  last; Reset, or a color back to the default with nothing else said, removes it. The eyes', Show only's and the
  author's looks are never touched. A document with no view gets `v.prism` on its first edit.
- A document row's ⋯ › Color…: the swatches and Default color (`mesoviewspec.look`). A part's row has none.
- `mesoscale.entities` on a document list reads the document: its populations by label, grouped by the document's
  compartments or by Kind.
- A document opens in its palette as before; once the person chooses a color theme for a list (By zoom, or another
  theme), its default colors step aside so the theme shows, and stated colors stay.
- For extensions: the mesoscale area asks a list's owner first (`@molstar/mesoscale-extension/owner`,
  `registerParticleListOwner`); the MesoViewSpec extension is that owner for its lists.

### After the review gate

- Theme colors, By entity and Reset on a document's lists now clear the color looks at other addresses too (a
  compartment's, several populations'), when those looks lie within what was picked. A look that also colors other
  lists (a compartment's, under one list's theme colors) is left as it is and the change is refused, naming that look:
  change it on its own row, or over every list it reaches.
- A theme By object or Uniform over a document is one look `(all)` in one color, not a color a list.
- `mesoscale.entities` on a document list reports each entity's visibility and color as drawn (an eye, Show only, a
  look on a compartment), no longer every entity visible.
- For extensions: an owned look edit takes `whole` (all the owner draws).
