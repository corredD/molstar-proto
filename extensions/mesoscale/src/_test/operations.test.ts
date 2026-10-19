/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Color } from '@molstar/core/util/color';
import { OrderedSet } from '@molstar/core/data/int';
import { ParticleRepresentation3DLayers } from '@molstar/plugin/state/transforms/particles/layers';
import { ParticleListTargetsFromAttribute } from '@molstar/plugin/state/transforms/particles/ops';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import type { MesoscaleInfo } from '../operations.js';
import { MesoscaleExtension } from '../prism-viewer.js';
import { TestParticleList } from './fixtures.js';

// The `mesoscale` area on a headless viewer, over a cellPACK-like particle list (four entities: lipids in the
// membrane, CA and NC in the capsid surface, one without a compartment) drawn as spheres.

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
  await v.plugin.build().toRoot().apply(TestParticleList).commit();
  expectOk(await v.api.particles.representation({ type: 'spacefill' }));
  return v;
}

const info = async (v: PrismViewer) => {
  const r = await v.api.mesoscale!.entities({});
  expectOk(r);
  return r.value as MesoscaleInfo;
};

const layersOf = (v: PrismViewer) =>
  Array.from(v.plugin.state.data.cells.values()).filter(
    (c) => c.transform.transformer === ParticleRepresentation3DLayers,
  );

describe('mesoscale', () => {
  it('lists the entities and their groups', async () => {
    const v = await viewer();
    const i = await info(v);
    expect(i.entities.map((e) => [e.name, e.count, e.visible])).toEqual([
      ['lipids', 2, true],
      ['CA', 1, true],
      ['NC', 3, true],
      ['loose', 1, true],
    ]);
    expect(i.groupBy).toBe('compartment');
  });

  it('hides a group and colors an entity, as layers on the representation, and says when nothing changes', async () => {
    const v = await viewer();
    const m = v.api.mesoscale!;
    expectOk(await m.style({ group: 'root.envelope.capsid', visible: false }));
    expectOk(await m.style({ entities: 'lipids', color: 'tomato' }));
    const i = await info(v);
    expect(i.entities.filter((e) => !e.visible).map((e) => e.name)).toEqual(['CA', 'NC']);
    expect(i.entities.find((e) => e.name === 'lipids')!.color).toBe(Color(0xff6347));
    expect(layersOf(v)).toHaveLength(1);
    const again = await m.style({ entities: 'lipids', color: 'tomato' });
    expectOk(again);
    expect(again.unchanged).toBe(true);
  });

  it('generates colors for every entity, goes back to the theme, and resets', async () => {
    const v = await viewer();
    const m = v.api.mesoscale!;
    expectOk(await m.colors({ scheme: 'generate' }));
    expect((await info(v)).entities.every((e) => e.color !== undefined)).toBe(true);
    expectOk(await m.colors({ scheme: 'theme' }));
    expect((await info(v)).entities.some((e) => e.color !== undefined)).toBe(false);
    expectOk(await m.style({ entities: 'CA', visible: false }));
    expectOk(await m.style({ reset: true }));
    expect(layersOf(v)).toHaveLength(0);
  });

  it('fails with what to write instead', async () => {
    const v = await viewer();
    const m = v.api.mesoscale!;
    expect(await m.style({ entities: 'nope', visible: false })).toMatchObject({ ok: false, code: 'not-found' });
    expect(await m.style({ group: 'root.nowhere', visible: false })).toMatchObject({ ok: false, code: 'not-found' });
    expect(await m.style({ entities: 'CA', color: 'not a color' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await m.style({ entities: 'CA' })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('wiggles and tumbles the particles, and stops', async () => {
    const v = await viewer();
    const animation = () =>
      (v.plugin.managers.particles.hierarchy.current.lists[0].representations[0].cell.transform.params as any).type
        .params.animation;
    expectOk(await v.api.mesoscale!.motion({ wiggle: 1.5, tumble: 4 } as never));
    expect(animation()).toMatchObject({ wiggleAmplitude: 1.5, tumbleAmplitude: 4 });
    expectOk(await v.api.mesoscale!.motion({ tumble: 0 } as never));
    expect(animation()).toMatchObject({ wiggleAmplitude: 1.5, tumbleAmplitude: 0 });
    expect(await v.api.mesoscale!.motion({} as never)).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('opens an example of the list, by id, from its absolute address', async () => {
    const v = await viewer();
    const list = [{ id: 'tiny', label: 'Tiny', url: '../examples/tiny.bcif', type: 'bcif' }];
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string | URL) => {
      asked.push(String(url));
      return String(url).endsWith('list.json') ? new Response(JSON.stringify(list)) : new Response('', { status: 404 });
    });
    try {
      expect(await v.api.mesoscale!.example({ id: 'nope' })).toMatchObject({ ok: false, code: 'not-found' });
      await v.api.mesoscale!.example({ id: 'tiny' });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(asked).toContain('https://molstar.org/me/examples/list.json');
    expect(asked).toContain('https://molstar.org/me/examples/tiny.bcif');
  });

  it('styles the targets of a list without entities (a RELION list by class)', async () => {
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
    });
    viewers.push(v);
    const star =
      'data_particles\n\nloop_\n_rlnCoordinateX #1\n_rlnCoordinateY #2\n_rlnCoordinateZ #3\n_rlnClassNumber #4\n10 0 0 1\n20 0 0 2\n30 0 0 1\n';
    expectOk(await v.api.load.files({ files: [new File([star], 'particles.star')] }));
    const list = v.plugin.managers.particles.hierarchy.current.lists[0];
    await v.plugin.build().to(list.cell).apply(ParticleListTargetsFromAttribute, { attribute: 'class' }).commit();
    expectOk(await v.api.mesoscale!.style({ entities: 'Class 2', visible: false }));
    expect((await info(v)).entities.map((e) => [e.name, e.visible])).toEqual([
      ['Class 1', true],
      ['Class 2', false],
    ]);
    const r = v.plugin.managers.particles.hierarchy.current.lists[0].representations[0].cell.obj!.data.repr;
    const hidden = r.state.transparency!.layers.map((l: any) => OrderedSet.toArray(l.loci.indices));
    expect(hidden).toEqual([[1]]);
  });

  it('clips a group with its own clip object, which the other entities ignore, and keeps a cut of the whole', async () => {
    const v = await viewer();
    const m = v.api.mesoscale!;
    const repr = () => v.plugin.managers.particles.hierarchy.current.lists[0].representations[0];
    expectOk(await m.style({ entities: 'lipids', color: 'tomato' }));
    expectOk(await m.clip({ group: 'root.envelope.capsid', type: 'sphere', x: 10, sx: 50 } as never));
    let i = await info(v);
    expect(i.cuts).toHaveLength(1);
    expect(i.cuts[0].entities).toEqual([1, 2]);
    expect(i.cuts[0].cut).toMatchObject({ type: 'sphere', position: [10, 0, 0], scale: [50, 100, 100] });
    // the style is kept beside the cut
    expect(i.entities.find((e) => e.name === 'lipids')!.color).toBe(Color(0xff6347));
    expect((repr().cell.transform.params as any).type.params.clip.objects).toHaveLength(1);
    // a cut of the whole object comes after it, the entity's cut stays first
    const params = repr().cell.transform.params as any;
    await v.plugin
      .build()
      .to(repr().cell)
      .update({
        ...params,
        type: {
          ...params.type,
          params: {
            ...params.type.params,
            clip: {
              variant: 'pixel',
              objects: [...params.type.params.clip.objects, { ...params.type.params.clip.objects[0], type: 'plane' }],
            },
          },
        },
      })
      .commit();
    expectOk(await m.clip({ group: 'root.envelope.capsid', type: 'sphere', x: -20 } as never));
    const objects = (repr().cell.transform.params as any).type.params.clip.objects;
    expect(objects.map((o: any) => o.type)).toEqual(['sphere', 'plane']);
    expectOk(await m.clip({ group: 'root.envelope.capsid', type: 'none' } as never));
    i = await info(v);
    expect(i.cuts).toHaveLength(0);
    expect((repr().cell.transform.params as any).type.params.clip.objects.map((o: any) => o.type)).toEqual(['plane']);
  });

  it('undoes a style in one step', async () => {
    const v = await viewer();
    expectOk(await v.api.mesoscale!.style({ entities: 'CA', visible: false }));
    expectOk(await v.api.history.undo({}));
    expect((await info(v)).entities.every((e) => e.visible)).toBe(true);
  });
});
