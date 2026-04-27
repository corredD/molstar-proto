# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is a fork of [Mol*](https://github.com/molstar/molstar), a comprehensive macromolecular structure visualization stack (v5.8.0). The fork adds custom applications and features on top of upstream Mol*, particularly the **Mesoscale Explorer** (large cellular-scale structures), **Virus on the Rock** (audio-reactive viral structure animation), and audio-reactive animation infrastructure wired into the core rendering pipeline.

See **AGENTS.md** at the root for the full architectural guide, coding conventions, state/transform patterns, and validation criteria. That file is the authoritative behavioral spec; this file adds command reference and fork-specific context.

## Commands

```bash
# Development (esbuild watch + hot reload)
npm run dev              # watch main viewer only
npm run dev:viewer       # alias for viewer
npm run dev:apps         # watch all apps
npm run dev:all          # watch all apps + examples + browser tests
npm run serve            # static server on port 1338 (run alongside dev)

# Build
npm run build            # full production build (apps + lib)
npm run build:apps       # esbuild production build for all apps
npm run build:lib        # compile TypeScript to ESM + CJS lib

# Lint & test
npm run lint             # ESLint
npm run lint-fix         # ESLint auto-fix
npm run jest             # run Jest only
npm test                 # lint + jest (also installs gl WebGL peer dep)

# Clean
npm run clean            # full clean
npm run clean:build      # build output only
npm run rebuild          # clean + build
```

Node ≥ 22 is required.

## Architecture layers

The codebase is strictly layered; keep concerns separated:

| Layer | Location | Responsibility |
|---|---|---|
| Data / parsing | `src/mol-io/`, `src/mol-model-formats/` | File format parsers (CIF, mmCIF, maps) |
| Model | `src/mol-model/`, `src/mol-model-props/` | Molecular data structures and queries |
| State | `src/mol-state/`, `src/mol-task/` | State tree, transforms, async tasks |
| Geometry / rendering | `src/mol-geo/`, `src/mol-gl/`, `src/mol-repr/` | Geometry builders, WebGL wrapper, representations |
| Theming | `src/mol-theme/` | Color/size theming system |
| Plugin | `src/mol-plugin/`, `src/mol-plugin-state/` | Plugin context, managers, behaviors |
| UI | `src/mol-plugin-ui/` | React components; can be used independently |
| Apps | `src/apps/` | Entry points per application |
| Extensions | `src/extensions/` | Opt-in modular features |
| Servers | `src/servers/` | model, volume, plugin-state REST servers |

## Fork-specific additions

### Audio-reactive animation

The main custom layer added in this fork:

- **`src/mol-plugin-state/manager/audio-reactive-animation.ts`** — central manager driving beat detection and parameter modulation
- **`src/mol-plugin-state/helpers/audio-reactive-presets.ts`** — preset configs for audio-reactive behaviors
- **`src/mol-geo/geometry/animation.ts`** — animation parameter types
- **`src/mol-gl/renderer.ts`**, **`src/mol-gl/scene.ts`** — renderer changes to consume animation uniforms
- **`src/mol-gl/shader/chunks/common-animation.glsl.ts`**, **`assign-position.glsl.ts`** — GLSL chunk additions
- **Shader vertex files** (`spheres.vert.ts`, `cylinders.vert.ts`, `lines.vert.ts`) — animation uniform consumers
- **`src/mol-gl/renderable/schema.ts`** — schema extensions for animation uniforms
- **`src/mol-plugin/animation-loop.ts`** — animation loop integration

### Mesoscale Explorer (`src/apps/mesoscale-explorer/`)

Custom app for cellular-scale structure visualization. Handles large scenes (many instances), incremental loading, and domain-specific annotation overlays.

### Virus on the Rock (`src/apps/virus-on-the-rock/`)

Specialized viewer for viral structures with audio-reactive animation. Entry: `app.tsx`. Custom structure generation: `random-structures.ts`.

## Dev workflow

1. `npm run dev:viewer` (or `dev:apps` for all apps) in one terminal — esbuild watches and rebuilds on file change
2. `npm run serve` in another terminal — serves `build/` at `http://localhost:1338`
3. Navigate to the app: `http://localhost:1338/viewer/` or `http://localhost:1338/virus-on-the-rock/`

Hot reload uses a `.dev-reload.txt` token; the browser polls and refreshes automatically.

## GLSL shaders

Shader files live in `src/mol-gl/shader/` as `.glsl.ts` TypeScript modules that export the shader source as a string. Chunks (reusable GLSL snippets) live in `src/mol-gl/shader/chunks/`. When adding animation uniforms, update both the schema (`schema.ts`) and the relevant vertex shaders.

## TypeScript config

Strict mode is enabled: `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`. Path aliases (`mol-*`) map to `src/mol-*/index.ts`. The `tsconfig.commonjs.json` builds a parallel CJS output under `lib/commonjs/`.
