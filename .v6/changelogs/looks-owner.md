## Prism: particles

- `particles.look`: one writer of a particle representation's looks (its layers cell): layers patched by their
  selector (entities, compartments, targets; absent fields kept, `null` clears one, `reset`), the targets left out,
  cuts of some particles added or removed by tag; every representation of a list in one step, "already so" when
  nothing changes. Clipping's cuts of some particles go through the same code.

## prism-me: Mesoscale

- An entity's style, generated colors and a color file no longer drop a class hidden by target, a decoration's
  left-out targets or a cut of some particles: they patch the looks through `particles.look`.
- A decoration's target representation takes the list's colors (a class colored before decorating keeps its color).
