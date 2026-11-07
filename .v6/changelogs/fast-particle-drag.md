## prism-me: a particle's handle follows the drag on a whole-cell model

- A protein's handle (Move this instance, Offset all like it) previews its drag at pointer rate on a large cellPACK
  model: only the moved particles' instances are written (the target representation's `setParticleFrames`), where each
  step used to make every representation of the list again. On HIV (287k instances) a step is at most 12–20 ms, the
  release's commit about 0.8 s, as before.
- Graphics: a merged render object's sync writes only the members whose instances changed, and can grow its bounds
  from those members alone (`sync({ growBounds })`) rather than a union over every member.
- Graphics: the GPU culling (WebGPU) of a merged object keeps each member's cells in a block of its own and writes
  only the members that moved; a drag step on MG (2.2 M instances) went from about 1.1 s and 376 MB written to the GPU
  to 11 ms and 86 KB (measured on a fake compute context: CPU work and bytes, not the GPU's upload time).
- `stage-tools` has a `test:scaling` tier (a drag of 30 steps over n and 4n targets).
