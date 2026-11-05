## Fixes: Prism's scene when one update removes a volume and a particle list

- Prism: the scene tree no longer throws ("Cannot read properties of undefined (reading 'size')" in
  `StateTree.getDecoratorRoot`) when one state update removes a volume and a particle list together, as the undo of a
  load that made both does. The hierarchies are synced one after another inside the update, and the scene rebuilt its
  rows on the first one's word while the particle hierarchy still held the removed list. The scene now rebuilds its rows
  once the update ends, whatever told it (a structure, volume or particle hierarchy, the measurements, shapes, volume
  streaming's cells)
