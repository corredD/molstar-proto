/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Vec3 } from '@molstar/core/math/linear-algebra';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import { mountGizmoCanvas } from '@molstar/prism-viewer/testing/gizmo-canvas';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { createMesoscaleExplorerSpec } from '../../spec.js';
import { hideHandles, showHandles } from '../menu.js';

// A structure dragged by its Move handle (_spec/ui.md §5, "its clips and labels with it"), on a headless viewer with a
// fake canvas: 1CRN with a plane clip and a label. The release is one step; the clip and the label follow the structure.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
}

describe("a structure's move handles", () => {
  it('carry its clip and its label, in one step', async () => {
    // the app's spec: Prism's structure handles (`api.move`) are in it
    const v = await createPrismViewerHeadless({ spec: createMesoscaleExplorerSpec('') });
    viewers.push(v);
    const crn = new File(
      [readFileSync(resolve(import.meta.dirname, '../../../../../data/examples/1crn.cif'))],
      '1crn.cif',
    );
    expectOk(await v.api.load.files({ files: [crn] }));
    const ref = v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
    expectOk(await v.api.run('clipping.add', { shape: 'plane', node: ref }));
    expectOk(await v.api.run('stage.label', { text: 'here', target: ref, x: 1, y: 2, z: 3 }));
    const stage = v.api.stage!;
    const cut = () => Vec3.clone(v.api.clipping.cuts.value[0].object.position);
    const label = () => Vec3.create(...stage.labelsState().value[0].position);
    const cut0 = cut();
    const label0 = label();
    const steps = () => v.managers.history.steps.value.length;
    const n = steps();

    const api = v.api.as({ kind: 'person' });
    expect(api.move).toBeDefined();
    const canvas = mountGizmoCanvas(v.plugin);
    showHandles(api, ref, 'structure');
    expect(await canvas.hover()).toBe(true);
    await canvas.drag([3, 6, 9]);
    await canvas.release();
    hideHandles(api);
    canvas.remove();

    expect(steps()).toBe(n + 1);
    const m = stage.placementOf(ref)!.matrix;
    expect(m[12]).toBeGreaterThan(0);
    // where the structure's move puts them
    const at = (p: Vec3) => Array.from(Vec3.transformMat4(Vec3(), p, m));
    at(cut0).forEach((x, i) => expect(cut()[i]).toBeCloseTo(x, 4));
    at(label0).forEach((x, i) => expect(label()[i]).toBeCloseTo(x, 4));

    // one undo puts all three back
    expectOk(await v.api.run('history.undo', {}));
    Array.from(cut0).forEach((x, i) => expect(cut()[i]).toBeCloseTo(x, 4));
    Array.from(label0).forEach((x, i) => expect(label()[i]).toBeCloseTo(x, 4));
  });
});
