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
