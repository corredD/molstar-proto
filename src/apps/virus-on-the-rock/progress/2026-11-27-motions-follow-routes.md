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

## Built

- `getPresetRoutes` filters routes whose motion the preset turns off (`MotionFlagOfTarget` in
  `audio-reactive-presets.ts`); Ambient Pulse lost its instanceRandom route. Test over every preset first (failed on
  ambient-pulse only).
- `route-motions.ts`: pure `motionsNeededBy`, `grownMotions`, `createRouteMotionsFollower(initial, {isOn, turnOn})`;
  wired in `app.tsx` on `manager.state.routes`; `enableMotionsFor` and its call in `loadFrom` removed.
- Specs: features.md, audio-routing-spec.md (decision 4), core-changes.md.

## Decided

- Growth is measured per route id (a new id, an enabled route, or a changed target), not on the set of motions: with
  the set, + Add route (symAxis) would never turn Instance Beats on again since a default symAxis route already needs
  it, contradicting the brief's check. A gain/floor/curve edit changes none of these. (Decided in the lane; Ludo to confirm.)
- A loaded routing or a preset replaces ids, so it turns on the motions its routes need, as before.

## Learned

- Route ids are numbers; `getDefaultAudioRoutes()` makes new ids on every call (a test must reuse one array).

## Size

~45 production lines (brief ~30): the follower and its two pure functions, the table, the filter; ~110 test lines.

## Checks

lint 0 errors (2 existing warnings); tsc clean; jest 13 suites 97 tests green; build --prd done.
Not tried in a browser (the brief's check by hand: Ambient Pulse; Instance Beats off then + Add route; off again, edit gain).
