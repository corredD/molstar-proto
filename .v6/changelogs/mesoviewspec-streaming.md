## MesoViewSpec streaming

- `@molstar/meso-spec` and `@molstar/meso-molstar` (private, `packages/mesoscale`): a streamed model
  (`stream: { resource }`, a `meso-tiles` manifest from a `TileProvider`) shows every tile at level 0 (one proxy copy per
  population and tile) and loads copies around the camera within a copy budget (`planStream`, `TileStreamer`; hysteresis,
  cancellation, failed tiles reported once as `stream.tile`). The session runs the streamer on every edit and queues a
  step when a load settles; a Streaming story and a tiled fixture. R5 (one list per tile) measured: commit and memory
  confirmed, frame time not measured. Design in `packages/mesoscale/_spec/design.md` 6.8, findings in
  `renderer-recommendations.md`.
