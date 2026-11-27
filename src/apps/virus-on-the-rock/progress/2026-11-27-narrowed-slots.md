# Lane `narrowed-slots` (2026-11-27)

## Brief (copied from 2026-11-27-overnight.md)

### `narrowed-slots` (review issue 5, D3)

- **Build:** the router drops a narrowed route when the 8 slots are full (never the global drive); the routing card
  disables the Who select of the other routes once 8 are narrowed, with a note (D3).
- **Tests:** 9 narrowed routes: global drive 0 (1 today); 8: unchanged.

Plan: (1) router test red then fix; (2) manager refuses a 9th (`setRouteAffect` returns false) + pure
`canNarrowRoute(routes, routeId)`; (3) UI disables both Who pickers with the note; spec pages and core-changes.
