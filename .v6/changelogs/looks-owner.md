## Prism: particle looks

- `particles.look`: one writer of a particle representation's looks (its layers cell): layers patched by their
  selector (entities, compartments, targets; absent fields kept, `null` clears one, `reset`), the targets left out,
  cuts of some particles added or removed by tag; every representation of a list in one step, "already so" when
  nothing changes, a malformed patch refused. Clipping's cuts of some particles go through the same code; a
  representation added to a list (`particles.representation`) takes the list's layers.
- prism-me: an entity's style, generated colors and a color file no longer drop a class hidden by target, a
  decoration's left-out targets or a cut of some particles: they patch the looks through `particles.look`. On a list
  with no representation they now fail (`not-found`, "has no representations") instead of saying "already so".
