# prism-me

The Mesoscale Explorer on Prism. The repository's rules ([../../AGENTS.md](../../AGENTS.md)) and Prism's
([../../packages/prism/AGENTS.md](../../packages/prism/AGENTS.md)) apply; these are the app's own.

- **Read first:** [_spec/README.md](_spec/README.md) (the parts and the decisions) and
  [_spec/features.md](_spec/features.md) (every feature, its status, its operation). A change that moves a feature's
  status updates `features.md` in the same commit; what is missing goes to [TODO.md](TODO.md).
- **The app adds, Prism stays.** The app is a spec and three extensions (`packages/extensions/mesoscale`,
  `packages/extensions/cryoet`, `packages/extensions/stage-tools`); a change Prism itself needs is its own commit,
  upstreamable, with its test.
- **Operations only.** Views, commands and the agent change the scene through the extensions' operations (one history
  step each). An extension uses another's operations by id (`api.run`), never by import.
- **Particles for everything mesoscale** (Ludovic, 2026-10-18): cellPACK and PetWorld are particle lists; per-entity
  looks are particle layers (`ParticleRepresentation3DLayers`), never one representation per entity.
- **Tests:** each extension's `_test/` on a headless viewer (`createPrismViewerHeadless`); data made in memory or from
  `data/examples`, never the network.

## Commands

`pnpm test:unit packages/extensions/mesoscale packages/extensions/cryoet packages/extensions/stage-tools`;
`npx tsc -b apps/prism-me`; `node scripts/esbuild/app.mjs apps/prism-me --dev --port 1343`.
