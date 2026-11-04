## Prism-me: labels by selection

- `stage.label` (the assistant's `add_label`, ⌘K's Add a label) takes a `selection`, as `stage.distance` takes a point:
  an atom, a residue or a chain of a structure (`A:10@CA`, `A:10`, `chain A`, `ligand`), a particle
  (`<list ref>#<index>`) or a pick (`{ loci }`). Its label sits at the selection's centre, in front of it, named after
  it ("ARG 10 CA (A)") when no text is given; a selection that matches nothing fails with a clear message.
