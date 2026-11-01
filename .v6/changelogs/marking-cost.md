## Graphics: sphere impostors skip work the pass would throw away

- An unmarked sphere leaves the marking mask before the projection. Hovering in CellPack HIV (the membrane, 114k
  instances, at a tenth of the camera distance) goes from 16.7 to 11.6 ms on WebGPU at dpr 1, where an unmarked frame
  is 11.2; from 42.5 to 31.7 ms at dpr 2; from 101.5 to 84.1 ms on WebGL2 at dpr 1; from 213.4 to 171.1 ms at dpr 2.
  The depth pass still draws those spheres, so they keep occluding. A mesh or a bond is unchanged: one triangle can
  mix markers.
- A sphere the color pass would discard whole leaves that pass: the opaque pass when the sphere is transparent, the
  transparent pass when it is opaque. Only where every fragment agrees (not x-ray, not an alpha thickness, not opaque
  back faces, not a per-vertex transparency). The same membrane at transparency 0.5: 14.9 to 12.0 ms, 41.9 to 33.2,
  111.7 to 86.7, 251 to 170.1, on those four configs. What remains is the transparent instances actually drawn.
- The picture is unchanged. This is a library change, an upstream candidate.
