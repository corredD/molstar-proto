/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { CryoetExtension } from '@molstar/cryoet-extension/prism-viewer';
import type { MergedGraphicsRenderObject } from '@molstar/graphics/gl/render-object';
import { ParticleListWithTargets } from '@molstar/plugin/state/transforms/particles/ops';
import { ParticlesRepresentation3D } from '@molstar/plugin/state/transforms/particles/representation';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import { mountGizmoCanvas } from '@molstar/prism-viewer/testing/gizmo-canvas';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { StageToolsExtension } from '@molstar/stage-tools-extension/prism-viewer';
import { afterEach, describe, expect, it, vi } from 'vitest';

// A particle's handle (stage-tools' `ParticleHandles`, committing cryoet's `cryoet.instance`: both extensions, so the
// app's test) on a headless viewer and a fake canvas: a drag is one step, undone at once; an undo during a drag (of the
// particle's first offset: the list's offsets decorator, under it) cancels it, and its release commits nothing.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
}

describe("a particle's handle", () => {
  it('moves one particle in one step; an undo during a drag cancels it', async () => {
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), StageToolsExtension, CryoetExtension] },
    });
    viewers.push(v);
    const star = 'data_particles\n\nloop_\n_rlnCoordinateX\n_rlnCoordinateY\n_rlnCoordinateZ\n10 0 0\n20 0 0\n';
    expectOk(await v.api.load.files({ files: [new File([star], 'p.star')] }));
    const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    const coords = () =>
      Array.from(
        v.plugin.managers.particles.hierarchy.current.lists[0].representations[0].cell.obj!.data.sourceData.coordinates,
      ).map((x) => Math.round(x * 100) / 100);
    const steps = () => v.managers.history.steps.value.length;
    const canvas = mountGizmoCanvas(v.plugin);
    const handles = v.api.stage!.useParticleHandles(v.api);
    expect(handles.show({ list, index: 1, edit: { kind: 'instance' } })).toBe(true);
    const before = coords();
    const n = steps();
    expect(await canvas.hover()).toBe(true);
    await canvas.drag([2, 4, 6]);
    // previewed: not in the state
    expect(coords()).toEqual(before);
    await canvas.release();
    expect(steps()).toBe(n + 1);
    expect(coords().slice(0, 3)).toEqual(before.slice(0, 3));
    expect(coords().slice(3)).not.toEqual(before.slice(3));
    expectOk(await v.api.run('history.undo', {}));
    expect(coords()).toEqual(before);

    // its first offset, then a drag the undo of it cancels: its release commits nothing
    expectOk(await v.api.run('cryoet.instance', { particles: list, index: 1, y: 3 }));
    expect(await canvas.hover()).toBe(true);
    await canvas.drag([5]);
    expectOk(await v.api.run('history.undo', {}));
    await canvas.release();
    expect(steps()).toBe(n);
    expect(coords()).toEqual(before);
    handles.hide();
    canvas.remove();
  });

  // A decorated particle's drag (a cellPACK protein, Ludo 2026-11-05: on a whole-cell model the drag showed nothing until
  // the release): the target representation previews by writing the moved instances (`setParticleFrames`), never made
  // again during the drag, and its release draws from the state what the preview showed.
  for (const edit of [{ kind: 'instance' }, { kind: 'offset', targets: '0' }] as const) {
    it(`previews a decorated particle's drag as its release draws it (${edit.kind})`, async () => {
      const base = DefaultPrismViewerSpec();
      const v = await createPrismViewerHeadless({
        spec: { ...base, extensions: [...(base.extensions ?? []), StageToolsExtension, CryoetExtension] },
      });
      viewers.push(v);
      const crn = new File([readFileSync(new URL('../../../../data/examples/1crn.cif', import.meta.url))], '1crn.cif');
      expectOk(await v.api.load.files({ files: [crn] }));
      const star = 'data_particles\n\nloop_\n_rlnCoordinateX\n_rlnCoordinateY\n_rlnCoordinateZ\n10 0 0\n80 0 0\n';
      expectOk(await v.api.load.files({ files: [new File([star], 'p.star')] }));
      const crnRef = v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
      const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
      await v.plugin
        .build()
        .to(list)
        .apply(ParticleListWithTargets, {
          targets: [{ targetId: 0, source: { name: 'ref', params: { ref: crnRef } } }],
        })
        .apply(ParticlesRepresentation3D, {
          type: { name: 'target', params: {} },
          colorTheme: { name: 'uniform', params: {} },
          sizeTheme: { name: 'uniform', params: {} },
        } as never)
        .commit();
      const targetRepr = () =>
        v.plugin.managers.particles.hierarchy.current.lists[0].representations.find(
          (r) => (r.cell.transform.params as { type: { name: string } }).type.name === 'target',
        )!.cell.obj!.data.repr;
      /** The target representation's transforms as drawn */
      const drawn = () =>
        targetRepr().renderObjects.flatMap((ro) => {
          (ro as Partial<MergedGraphicsRenderObject>).merged?.sync();
          return Array.from(ro.values.aTransform.ref.value.subarray(0, ro.values.instanceCount.ref.value * 16));
        });
      const before = drawn();
      const canvas = mountGizmoCanvas(v.plugin);
      const handles = v.api.stage!.useParticleHandles(v.api);
      expect(handles.show({ list, index: 0, edit })).toBe(true);
      expect(await canvas.hover()).toBe(true);
      const made = vi.spyOn(targetRepr(), 'createOrUpdate');
      await canvas.drag([2, 4, 6]);
      expect(made).not.toHaveBeenCalled();
      made.mockRestore();
      const previewed = drawn();
      // the control: the drag moved what is drawn (both particles for the kind, the first alone for the instance)
      const movedAt = (a: number[], b: number[], k: number) =>
        a.slice(k * 16, k * 16 + 16).some((x, i) => Math.abs(x - b[k * 16 + i]) > 1e-3);
      expect(movedAt(previewed, before, 0)).toBe(true);
      expect(movedAt(previewed, before, 1)).toBe(edit.kind === 'offset');
      await canvas.release();
      const committed = drawn();
      expect(committed.length).toBe(previewed.length);
      for (let i = 0; i < committed.length; i++) expect(committed[i]).toBeCloseTo(previewed[i], 3);
      handles.hide();
      canvas.remove();
    });
  }
});
