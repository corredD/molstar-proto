## prism-me: Mesoscale

- The Entities tab groups by compartment or by function: a Compartment / Function switch in its header, shown when the
  list has compartments.
- `mesoscale.entities` takes `groupBy` (`compartment`, `function`; absent: by compartment when the list has
  compartments, else by function) and says `hasCompartments`; `mesoscale.style` reads its `group` in the `groupBy`
  given (absent: the default grouping, then the functions); `MesoscaleApi.infoState(particles, groupBy)` follows a
  grouping state.
