## prism-me: Mesoscale

- A model with compartments has a Group by switch (Compartment / Function) in its properties; the scene tree groups
  that model's entities by it.
- `mesoscale.entities` takes `groupBy` (`compartment`, `function`; absent: by compartment when the list has
  compartments, else by function) and says `hasCompartments`; `mesoscale.style` reads its `group` in the `groupBy`
  given (absent: the default grouping, then the functions); `MesoscaleApi.infoState(particles, groupBy)` follows a
  grouping state.
