# Lane `narrowed-slots` (2026-11-27)

## Brief (copied from 2026-11-27-overnight.md)

### `narrowed-slots` (review issue 5, D3)

- **Build:** the router drops a narrowed route when the 8 slots are full (never the global drive); the routing card
  disables the Who select of the other routes once 8 are narrowed, with a note (D3).
- **Tests:** 9 narrowed routes: global drive 0 (1 today); 8: unchanged.

Plan: (1) router test red then fix; (2) manager refuses a 9th (`setRouteAffect` returns false) + pure
`canNarrowRoute(routes, routeId)`; (3) UI disables both Who pickers with the note; spec pages and core-changes.

## Built

- Router: a narrowed route with the 8 slots full adds nothing (was: the global drive); its meter value still shows.
  Test red before (drives.wiggle 1, expected 0), green after; 8 narrowed unchanged.
- Manager: `canNarrowRoute(routes, id)` (pure, counts narrowed scope-capable routes, any enabled state);
  `setRouteAffect` returns false and leaves the route on All for a 9th; `pickRouteAffect` passes the result on.
  Tests red first (canNarrowRoute missing; the 9th narrowed).
- UI: routing card level select disabled with the note, Loaded Structures Who picker options disabled; help text.
  Specs: features.md section 8, ui.md, core-changes.md.

## Decided

- Disabled narrowed routes count toward the 8 (stable; enabling one can never overflow). Brief did not say.
- Loading a saved set with 9 narrowed routes: the loader's `setRouteAffect` re-run leaves the 9th as stored; the
  router then drops it (no global leak). Not refused on load.

## Learned

- A manager test needs only a plugin stub `{managers:{structure:{hierarchy:{current:{models:[],structures:[]}}}}}`.

## Size

Core ~+25 lines, tests ~+75, UI ~+14, specs ~+10. Brief gave no number.

## Checks

lint 0 errors (2 existing warnings), tsc clean, jest 15 suites / 113 tests pass, prd build ok (build/ removed).
Not tried in a browser.

## Review

Gate: reviewer + skeptic (Opus). Merged origin/votr/overnight first (clean). Fix commits below.

| # | Finding | Verdict | Fix |
| --- | --- | --- | --- |
| 1 | A load can leave 9 narrowed routes (setRoutes installs them, the reattach loop cannot widen) | confirmed, must to should | `setRoutes` calls `limitNarrowedRoutes`: narrowed routes past the 8th in array order, disabled counted, widen to All. Test red first (9 narrowed, expected 8) |
| 2 | Old-format file (top-level `affect`) with 9+ narrowable routes | should | same invariant; test via `parseAudioRouting` + load, red first (10 narrowed, expected 8). features.md says what the code does |
| 3 | Disabled narrowed routes count toward the 8, unpinned and the note said "act on a part" | should to nit | test pins it (it passes on the code as it was: a guard); note is "8 routes are narrowed (on or off): widen one to All first" (UI, ui.md) |
| 4 | `canNarrowRoute` per option/row | nit | `narrowedRouteCount` (core, tested) once per render in both UIs |
| 5 | Meter assertion passes on old code | nit | annotated as a regression guard |
| N1 | Same as 1 through other install paths | plausible should | all installs go through `setRoutes` (the only writer of `state.routes`); covered by 1 |
| N2 | The full note repeated under every route on All | nit | shown once at the top of the card; the disabled select keeps its title |

Checks after the fix: see the last commit message of this lane / the report.
