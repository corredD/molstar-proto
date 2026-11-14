/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Mat4, Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import type { Representation } from '@molstar/graphics/repr/representation';
import type { VisualSetCanvas } from '@molstar/graphics/util/visual-set';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { DefaultPaintSettings } from '../paint-mode.js';
import { oneCopyOf, pluginPaintCursor, pluginStructureCursor } from '../paint-cursor.js';
import { paintRotation, paintRotations } from '../paint.js';
import { MesoscaleExtension } from '../prism-viewer.js';
import { setTestTargetStructure, TestTargetList } from './fixtures.js';

// The copy under the pointer (progress/2026-11-08-paint.md, Round 2) on a headless viewer: one copy of the brush's
// target drawn outside the state, in the scene layer (depth-tested, Round 4), never picked, moved by its transform (turned as the stroke's
// first copy of the same seed), gone with the mode.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}`);
}

async function viewer() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
  });
  viewers.push(v);
  const crn = readFileSync(new URL('../../../../../data/examples/1crn.cif', import.meta.url));
  expectOk(await v.api.load.files({ files: [new File([crn], '1crn.cif')] }));
  setTestTargetStructure(v.plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data);
  await v.plugin.build().toRoot().apply(TestTargetList).commit();
  expectOk(await v.api.particles.representation({ type: 'target' }));
  return v;
}

describe('the copy under the pointer', () => {
  it('is one copy of the brush, in the scene (depth-tested), not picked, moved by its transform, hidden and gone with the mode', async () => {
    const v = await viewer();
    // the headless viewer draws nothing: a canvas that keeps what is added (`VisualSetCanvas`)
    const added: Representation<any, any, any>[] = [];
    const removed = vi.fn();
    const canvas = {
      graphics: undefined as never,
      add: (r: Representation<any, any, any>) => void added.push(r),
      remove: removed,
      update: () => true,
      requestDraw: () => {},
    } as unknown as VisualSetCanvas;
    const list = v.plugin.managers.particles.hierarchy.current.lists[0];
    const data = list.cell.obj!.data;
    const ca = [...data.entityInfo!].find(([, e]) => e.name === 'CA')![0];
    const brush = { particles: list.cell.transform.ref, entity: ca, name: 'CA' };
    const cursor = pluginPaintCursor(v.plugin, list, brush, 0xff0000, true, canvas);
    // shown before it is built: it takes the place once built
    cursor.move(Vec3.create(1, 2, 3), Vec3.create(0, 1, 0), DefaultPaintSettings, 7);
    await vi.waitFor(() => expect(added.length).toBe(1));
    const repr = added[0];
    expect(repr.state.pickable).toBe(false);
    expect(repr.state.layer).toBe('scene');
    expect(repr.state.visible).toBe(true);
    expect(Mat4.getTranslation(Vec3(), repr.state.transform)).toEqual(Vec3.create(1, 2, 3));
    // a surface brush, Turn auto: +z along the normal, spun by the seed as the stroke's first copy
    const q = Mat4.getRotation(Quat(), repr.state.transform);
    const [x, y, z, w] = paintRotations([0, 1, 0], 'normal', 7);
    expect(Math.abs(Quat.dot(q, Quat.create(x, y, z, w)))).toBeCloseTo(1, 5);
    cursor.move(Vec3.create(4, 5, 6), Vec3.create(0, 1, 0), DefaultPaintSettings, 7);
    expect(Mat4.getTranslation(Vec3(), repr.state.transform)).toEqual(Vec3.create(4, 5, 6));
    // moved, not rebuilt
    expect(added.length).toBe(1);
    cursor.hide();
    expect(repr.state.visible).toBe(false);
    cursor.dispose();
    expect(removed).toHaveBeenCalledWith(repr);
  });

  it("a structure brush's copy is drawn in a scene with no particle list yet (paint-refine, the first Paint)", async () => {
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
    });
    viewers.push(v);
    const crn = readFileSync(new URL('../../../../../data/examples/1crn.cif', import.meta.url));
    expectOk(await v.api.load.files({ files: [new File([crn], '1crn.cif')] }));
    expect(v.plugin.managers.particles.hierarchy.current.lists.length).toBe(0);
    const added: Representation<any, any, any>[] = [];
    const canvas = {
      graphics: undefined as never,
      add: (r: Representation<any, any, any>) => void added.push(r),
      remove: () => {},
      update: () => true,
      requestDraw: () => {},
    } as unknown as VisualSetCanvas;
    const structure = v.plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data;
    // Mol*'s particles are lazy: their target representation is not registered before a list is there
    expect(v.plugin.representation.particles.registry.has('target')).toBe(false);
    const cursor = pluginStructureCursor(v.plugin, structure, canvas, () =>
      v.extensions.ensureFor({ transformers: ['ms-plugin.particles-representation-3d'] }),
    );
    cursor.move(Vec3.create(1, 2, 3), Vec3.create(0, 0, 1), DefaultPaintSettings, 7);
    await vi.waitFor(() => expect(added.length).toBe(1), { timeout: 5000 });
    expect(added[0].state.visible).toBe(true);
    cursor.dispose();
  });

  it('is nothing without a list or a particle of the brush', async () => {
    const v = await viewer();
    const cursor = pluginPaintCursor(v.plugin, undefined, { particles: 'x', entity: 1, name: 'x' }, undefined, false);
    cursor.move(Vec3(), Vec3.create(0, 0, 1), DefaultPaintSettings, 1);
    cursor.hide();
    cursor.dispose();
  });
});

describe('oneCopyOf and paintRotation', () => {
  it('one copy of a particle: its target, entity and compartment at the origin, no fiber nor attribute', async () => {
    const v = await viewer();
    const data = v.plugin.managers.particles.hierarchy.current.lists[0].cell.obj!.data;
    const one = oneCopyOf(data, 2);
    expect(one.count).toBe(1);
    expect(one.targets[0]).toBe(data.targets[2]);
    expect(one.entities?.[0]).toBe(data.entities?.[2]);
    expect(Array.from(one.coordinates)).toEqual([0, 0, 0]);
    expect(one.fibers).toBeUndefined();
  });

  it("is a stroke's copy i of the same seed, for every turn", () => {
    const normals = [0, 0, 1, 1, 0, 0, 0.3, 0.4, 0.5];
    for (const how of ['normal', 'axis', 'view', 'random'] as const) {
      const all = paintRotations(normals, how, 42, {
        axis: Vec3.create(1, 0, 0),
        spin: how === 'view' ? 30 : undefined,
      });
      for (let i = 0; i < 3; ++i) {
        const n = Vec3.create(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
        const q = paintRotation(Quat(), n, how, 42, i, {
          axis: Vec3.create(1, 0, 0),
          spin: how === 'view' ? 30 : undefined,
        });
        expect(Array.from(q)).toEqual(all.slice(i * 4, i * 4 + 4));
      }
    }
  });
});
