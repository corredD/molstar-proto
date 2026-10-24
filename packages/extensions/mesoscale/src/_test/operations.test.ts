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
import { type MesoscaleInfo, MesoscaleExampleIds } from '../operations.js';
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

  it('describes the same list by compartment and by function, as different group trees', async () => {
    const v = await viewer();
    const m = v.api.mesoscale!;
    const tree = (g: MesoscaleInfo['groups']): unknown => [g.label, g.entities, g.groups.map(tree)];
    const byCompartment = await m.entities({ groupBy: 'compartment' });
    const byFunction = await m.entities({ groupBy: 'function' });
    expectOk(byCompartment);
    expectOk(byFunction);
    const c = byCompartment.value as MesoscaleInfo;
    const f = byFunction.value as MesoscaleInfo;
    expect([c.groupBy, c.hasCompartments]).toEqual(['compartment', true]);
    expect([f.groupBy, f.hasCompartments]).toEqual(['function', true]);
    expect(tree(c.groups)).toEqual([
      'HIV',
      [3],
      [
        [
          'root',
          [],
          [
            [
              'envelope',
              [],
              [
                ['membrane', [0], []],
                ['capsid', [], [['surface', [1, 2], []]]],
              ],
            ],
          ],
        ],
      ],
    ]);
    expect(tree(f.groups)).toEqual([
      'HIV',
      [],
      [
        ['membrane', [0], []],
        ['unknown function', [1, 2, 3], []],
      ],
    ]);
    // no grouping asked: by compartment, the list has some
    expect((await info(v)).groupBy).toBe('compartment');
  });

  it('resolves a group under the grouping asked, else the default one with functions as a fallback', async () => {
    const v = await viewer();
    const m = v.api.mesoscale!;
    const hidden = async () =>
      (await info(v)).entities
        .filter((e) => !e.visible)
        .map((e) => e.name)
        .sort();
    expectOk(await m.style({ group: 'unknown function', groupBy: 'function', visible: false }));
    expect(await hidden()).toEqual(['CA', 'NC', 'loose']);
    expectOk(await m.style({ reset: true }));
    expectOk(await m.style({ group: 'root.envelope.capsid', groupBy: 'compartment', visible: false }));
    expect(await hidden()).toEqual(['CA', 'NC']);
    expectOk(await m.style({ reset: true }));
    // asked by function, a compartment is not a group
    expect((await m.style({ group: 'root.envelope.capsid', groupBy: 'function', visible: false })).ok).toBe(false);
    // none asked: compartments, then functions
    expectOk(await m.style({ group: 'membrane', visible: false }));
    expect(await hidden()).toEqual(['lipids']);
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

  it('moves the particles of one model only when it is given, the others still', async () => {
    const v = await viewer();
    // a second list in the scene
    await v.plugin.build().toRoot().apply(TestParticleList).commit();
    const [a, b] = v.plugin.managers.particles.hierarchy.current.lists.map((l) => l.cell.transform.ref);
    expectOk(await v.api.run('particles.representation', { type: 'spacefill', particles: b }));
    const wiggleOf = (ref: string) => {
      const l = v.plugin.managers.particles.hierarchy.current.lists.find((x) => x.cell.transform.ref === ref)!;
      return (l.representations[0].cell.transform.params as any).type.params.animation?.wiggleAmplitude ?? 0;
    };
    expectOk(await v.api.mesoscale!.motion({ wiggle: 2, particles: a } as never));
    expect([wiggleOf(a), wiggleOf(b)]).toEqual([2, 0]);
    expect(v.api.mesoscale!.graphicsState(a).value?.wiggle).toBe(2);
    expect(v.api.mesoscale!.graphicsState(b).value?.wiggle).toBe(0);
  });

  it('offers the examples it can open by name, and opens one of the list, from its absolute address', async () => {
    const v = await viewer();
    // the form's choices: the explorer's examples (its sessions, molx, are not opened)
    const id = v.api.describe('mesoscale.example')!.params.id as { options?: readonly [string, string][] };
    expect(id.options?.map(([k]) => k)).toEqual([...MesoscaleExampleIds]);
    expect(id.options?.find(([k]) => k === 'cellpack-mg')?.[1]).toBe('CellPack MG');
    const list = [{ id: 'cellpack-mg', label: 'CellPack MG', url: '../examples/tiny.bcif', type: 'bcif' }];
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string | URL) => {
      asked.push(String(url));
      return String(url).endsWith('list.json') ? new Response(JSON.stringify(list)) : new Response('', { status: 404 });
    });
    try {
      // one the list no longer has: said so
      expect(await v.api.mesoscale!.example({ id: 'petworld-hiv' } as never)).toMatchObject({
        ok: false,
        code: 'not-found',
      });
      await v.api.mesoscale!.example({ id: 'cellpack-mg' } as never);
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

  it('undoes a style in one step', async () => {
    const v = await viewer();
    expectOk(await v.api.mesoscale!.style({ entities: 'CA', visible: false }));
    expectOk(await v.api.history.undo({}));
    expect((await info(v)).entities.every((e) => e.visible)).toBe(true);
  });
});
