## MesoViewSpec package entries

- `@molstar/meso-spec` exports one entry per folder: `/format`, `/builder`, `/ir`, `/runtime`, `/resolvers`, `/examples`,
  `/cli`; each `index.ts` names its API (no `export *`). `@molstar/meso-molstar` exports `.`. The `./*` and `.` exports
  of both packages and `meso-spec`'s root `index.ts` are gone: import `@molstar/meso-spec/format` where
  `@molstar/meso-spec/format/patch` (or `/ir/ir`, `/runtime/runtime`, …) was, and the builder from
  `@molstar/meso-spec/builder`, not `builder/index`
- `resolvers` imports `runtime`, not the other way: `mulQuat` and `rotationOf` moved to `ir`, `meshArea` to `runtime`
- `spec/src/_test/layers.test.ts` checks the folder graph; `exports.test.ts` that every type a public signature names is
  exported
