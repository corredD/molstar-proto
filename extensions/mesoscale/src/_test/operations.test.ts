/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Color } from '@molstar/core/util/color';
import { ParticleRepresentation3DLayers } from '@molstar/plugin/state/transforms/particles/layers';
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

  it('undoes a style in one step', async () => {
    const v = await viewer();
    expectOk(await v.api.mesoscale!.style({ entities: 'CA', visible: false }));
    expectOk(await v.api.history.undo({}));
    expect((await info(v)).entities.every((e) => e.visible)).toBe(true);
  });
});
