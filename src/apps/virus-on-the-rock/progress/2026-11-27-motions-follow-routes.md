# motions-follow-routes (lane, 2026-11-27)

## Brief



- **Asked:** a route never moves nothing because its motion is off. **Check:** Ambient Pulse, the capsid moves;
  Motion Targets › Instance Beats off, then + Add route: Instance Beats comes on; turn Instance Beats off again and edit
  a gain: it stays off.
- **Build:** `getPresetRoutes` makes no route for a motion the preset turns off. The app subscribes to
  `manager.state.routes` and calls `enableMotionsFor` only when the set of motions the enabled routes need **grows**
  (a gain or floor edit never re-enables a motion the user turned off); the call in `loadFrom` goes.
- **Tests:** the preset probe (every preset × its motion flags: no dead route; fails today on ambient-pulse); the
  needed-set function (grows on add and on a target change, not on a gain edit).
- **Size:** ~30 production lines.
