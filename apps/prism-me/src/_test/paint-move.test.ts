/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { CustomProperties } from '@molstar/model/model/custom-property';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { MesoscaleExplorerExtensions } from '../extensions.js';

// Painted copies move with their list (lane `paint`, review must-fix 1): a list moved after its first stroke carries
// the copies (stage.move updates the list's one Transform, under the painted decorator), and a later stroke lands where
// it is painted. Over a mesoscale model made in memory, drawn as spheres.

function model(): ParticleList {
  const count = 2;
  return {
    label: 'HIV',
    count,
    keys: Int32Array.of(0, 1),
    targets: Int32Array.of(0, 1),
    targetInfo: new Map([
      [0, { entity: 0 }],
      [1, { entity: 1 }],
    ]),
    entityInfo: new Map([
      [0, { name: 'CA' }],
      [1, { name: 'NC' }],
    ]),
    coordinates: Float32Array.of(0, 0, 0, 10, 0, 0),
    getParticleLabel: (i) => `${i}`,
    sourceData: { kind: 'test', name: 'test', data: {} },
    customProperties: new CustomProperties(),
    _propertyData: Object.create(null),
  };
}

const TestModel = PluginStateTransform.BuiltIn({
  name: 'prism-me-test-paint-move-model',
  display: { name: 'Test Paint Move Model' },
  from: SO.Root,
  to: SO.Particle.List,
  params: {},
})({
  apply() {
    return new SO.Particle.List(model(), { label: 'HIV' });
  },
});

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

async function viewer() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
  });
  viewers.push(v);
  await v.plugin.build().toRoot().apply(TestModel).commit();
  const ref = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
  const r = await v.api.particles.representation({ type: 'spacefill', particles: ref });
  if (!r.ok) throw new Error(r.message);
  return { v, ref };
}

const drawn = (v: PrismViewer) =>
  (
    v.plugin.managers.particles.hierarchy.current.lists[0].representations[0].cell.obj!.data as unknown as {
      sourceData: ParticleList;
    }
  ).sourceData;
const at = (list: ParticleList, i: number) => Vec3.fromArray(Vec3(), list.coordinates, i * 3);

describe('painted copies and a move of their list', () => {
  it('a move after the first stroke carries the copies; a later stroke lands where it is painted', async () => {
    const { v, ref } = await viewer();
    const ok = (r: { ok: boolean; message?: string }) => expect(r.ok, r.message).toBe(true);
    ok(await v.api.run('mesoscale.paint', { entity: 'CA', positions: [10, 20, 30], normals: [0, 0, 1], seed: 1 }));
    ok(
      await v.api.run('stage.move', {
        target: ref,
        matrix: Array.from(Mat4.fromTranslation(Mat4(), Vec3.create(100, 0, 0))),
      }),
    );
    expect(Vec3.distance(at(drawn(v), 0), Vec3.create(100, 0, 0))).toBeLessThan(1e-3);
    expect(Vec3.distance(at(drawn(v), 2), Vec3.create(110, 20, 30))).toBeLessThan(1e-3);
    ok(await v.api.run('mesoscale.paint', { entity: 'CA', positions: [10, 20, 30], normals: [0, 0, 1], seed: 2 }));
    expect(Vec3.distance(at(drawn(v), 3), Vec3.create(10, 20, 30))).toBeLessThan(1e-3);
    // the scale too
    ok(await v.api.run('stage.scale', { target: ref, scale: 2 }));
    expect(drawn(v).count).toBe(4);
  });
});
