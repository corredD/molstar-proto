/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { GizmoAppearance } from '@molstar/graphics/util/gizmo/controller';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import { mountGizmoCanvas } from '@molstar/prism-viewer/testing/gizmo-canvas';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import type { Canvas3D } from '@molstar/graphics/canvas3d/canvas3d';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMesoscaleHandleLook } from '../look.js';

// The explorer's handles start on top (look.ts, Ludo 2026-11-04), Prism's default being in the scene; On top
// (`canvas.handles`) still turns it off.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

describe("the explorer's handle look", () => {
  it('starts on top, and On top still turns it off', async () => {
    const v = await createPrismViewerHeadless({ spec: DefaultPrismViewerSpec() });
    viewers.push(v);
    const gizmos = mountGizmoCanvas(v.plugin);
    try {
      const canvas = v.plugin.canvas3d as unknown as Canvas3D;
      expect(GizmoAppearance.of(canvas).onTop).toBe(false);
      expect((await applyMesoscaleHandleLook(v.api)).ok).toBe(true);
      expect(GizmoAppearance.of(canvas)).toEqual({ scale: 1, onTop: true });
      expect((await v.api.run('canvas.handles', { onTop: false })).ok).toBe(true);
      expect(GizmoAppearance.of(canvas).onTop).toBe(false);
    } finally {
      gizmos.remove();
    }
  });
});
