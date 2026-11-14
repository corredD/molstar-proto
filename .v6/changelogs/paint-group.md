## prism-me: Mesoscale

- Groups (cellPAINT's grouping): a few instances of a list made a brush of their own, painted and grown as one. A list's
  Group section: Pick instances (while on, a click on a particle adds or removes its instance, a group copy whole,
  selected in 3D and counted; Esc stops), a name, Make group. The group's frame: its members' centroid, their principal
  axes (+z the smallest, right-handed), its radius their bounds; its members kept at their poses relative to it, the
  instances where they were. The group is a row of its list ("Group 1 · 3 members") with Paint with: every member at
  the copy's pose times its own, the whole group under the pointer, its +z along a surface's normal. A grow from a
  group copy (every mode) grows copies of the group. A group may hold groups. Ungroup a copy (its right-click): its
  members, one level down, where they are. Kept in sessions. `mesoscale.group`, `mesoscale.paint { group }`,
  `mesoscale.ungroup`; `ParticleListPainted.groups`.
