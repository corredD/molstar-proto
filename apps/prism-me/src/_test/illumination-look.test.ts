/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { PluginSpec } from '@molstar/plugin/spec';
import { describe, expect, it } from 'vitest';
import { withMesoscaleLook } from '../look.js';

// The explorer's illumination keeps the outlines (look.ts, Ludo 2026-11-04): `ignoreOutline` false, Mol*'s default
// being true. Only that: the canvas merges a partial illumination into its own (Canvas3D's `setProps`), so it stays
// off until Lighting turns it on, which keeps the canvas' illumination settings (`canvas.lighting`). Over the look
// every spec of the app's goes through (spec.ts's `finalize`), a headless viewer having no canvas.

describe("the explorer's illumination", () => {
  it('keeps the outlines, and turns nothing on', () => {
    expect(withMesoscaleLook({} as PluginSpec).canvas3d?.illumination).toEqual({ ignoreOutline: false });
  });

  it("is merged under a spec's own illumination, as its postprocessing", () => {
    const spec = { canvas3d: { illumination: { maxIterations: 3 } } } as PluginSpec;
    expect(withMesoscaleLook(spec).canvas3d?.illumination).toEqual({ ignoreOutline: false, maxIterations: 3 });
    const own = { canvas3d: { illumination: { ignoreOutline: true } } } as PluginSpec;
    expect(withMesoscaleLook(own).canvas3d?.illumination).toEqual({ ignoreOutline: true });
  });
});
