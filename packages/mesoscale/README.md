# MesoViewSpec (prototype)

A declarative format for mesoscale scenes: biology, evidence and provenance, view state; with its IR, a runtime with
pluggable resolvers, and a Mol\*/Prism renderer adapter. A prototype to test the design.

- [`_spec/design.md`](_spec/design.md): the design (for review)
- [`_spec/renderer-recommendations.md`](_spec/renderer-recommendations.md): what the prototypes showed about the Mol\*
  renderer
- `examples/`: each example document as authored (`*.mesoviewspec.json`) and the IR made of it (`*.ir.json`)
- `spec/` (`@molstar/meso-spec`): the format, IR, runtime and resolvers; no Mol\* imports
- `molstar/` (`@molstar/meso-molstar`): the Prism adapter, the MolViewSpec export, the session, the stories

```sh
pnpm test:unit packages/mesoscale     # quick: validation, resolvers, IR, edits (no network, no GL)
pnpm test:medium packages/mesoscale   # integration: the real Prism viewer, headless (GL with `pnpm native:install`)
pnpm test:heavy packages/mesoscale    # performance: scaling, memory, edit costs (opt-in; MESO_PERF_OUT=<file>)
pnpm -C storybook storybook           # the stories, under MesoViewSpec
```
