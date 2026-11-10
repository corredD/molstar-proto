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
