/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { Mat4, Tensor } from '@molstar/core/math/linear-algebra';
import { CCP4Writer } from '@molstar/model/formats/writer/ccp4/ccp4';
import type { Grid } from '@molstar/model/model/volume';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { MesoscaleExtension } from '../prism-viewer.js';
import { TestParticleList } from './fixtures.js';

// A color theme for several objects at once (`mesoscale.theme`; apps/prism-me/_spec/ui.md §3, §4: a category's brush,
// Ludo 2026-10-27): each kind takes the theme it supports, one history step, one undo. Two copies of 1CRN
// (data/examples), a cellPACK-like list with entities and a small map with an isosurface, made in memory.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
}

function mapFile(name: string, n: number) {
  const space = Tensor.Space([n, n, n], [2, 1, 0], Float32Array);
  const data = new Float32Array(n * n * n);
  const c = (n - 1) / 2;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (let k = 0; k < n; k++)
        data[space.dataOffset(i, j, k)] = Math.exp(-((i - c) ** 2 + (j - c) ** 2 + (k - c) ** 2) / 8);
  const grid: Grid = {
    transform: { kind: 'matrix', matrix: Mat4.identity() },
    cells: Tensor.create(space, Tensor.Data1(data)),
    stats: { min: 0, max: 1, mean: 0.1, sigma: 0.2 },
  };
  return new File([CCP4Writer.writeMrc(grid, data)], name);
}

const crn = (name: string) =>
  new File([readFileSync(new URL('../../../../../data/examples/1crn.cif', import.meta.url))], name);

async function viewer() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
  });
  viewers.push(v);
  await v.plugin.build().toRoot().apply(TestParticleList).commit();
  expectOk(await v.api.particles.representation({ type: 'spacefill' }));
  for (const f of [crn('a.cif'), crn('b.cif'), mapFile('map.mrc', 10)])
    expectOk(await v.api.load.files({ files: [f] }));
  if (!v.plugin.managers.volume.hierarchy.current.volumes[0]?.representations.length) {
    expectOk(await v.api.run('volume.representation', { type: 'isosurface' }));
  }
  return v;
}

type Theme = { name: string; params: { value?: number } };
const themeOf = (cell: { transform: { params?: unknown } }) =>
  (cell.transform.params as { colorTheme: Theme }).colorTheme;

/** Each object's representations' color themes: structures a and b, the list, the volume's isosurfaces */
function themes(v: PrismViewer) {
  const [a, b] = v.plugin.managers.structure.hierarchy.current.structures;
  const list = v.plugin.managers.particles.hierarchy.current.lists[0];
  const volume = v.plugin.managers.volume.hierarchy.current.volumes[0];
  const of = (s: typeof a) => s.components.flatMap((c) => c.representations).map((r) => themeOf(r.cell));
  return {
    refs: {
      a: a.cell.transform.ref,
      b: b.cell.transform.ref,
      list: list.cell.transform.ref,
      volume: volume.cell.transform.ref,
    },
    a: of(a),
    b: of(b),
    list: list.representations.map((r) => themeOf(r.cell)),
    volume: volume.representations.map((r) => themeOf(r.cell)),
  };
}

describe('a theme for several objects (mesoscale.theme)', () => {
  it('by chain: every structure, one step, one undo; already so, no step', async () => {
    const v = await viewer();
    const { refs } = themes(v);
    const objects = [refs.a, refs.b];
    // 1CRN opens by chain: by entity first
    expectOk(await v.api.run('mesoscale.theme', { objects, theme: 'entity' }));
    const before = themes(v);
    const steps = v.api.history.steps.value.length;
    expectOk(await v.api.run('mesoscale.theme', { objects, theme: 'chain' }));
    const after = themes(v);
    expect([...after.a, ...after.b].every((t) => t.name === 'chain-id')).toBe(true);
    expect(after.list).toEqual(before.list);
    expect(v.api.history.steps.value.length).toBe(steps + 1);
    expect(await v.api.run('mesoscale.theme', { objects, theme: 'chain' })).toMatchObject({
      ok: true,
      unchanged: true,
    });
    expect(v.api.history.steps.value.length).toBe(steps + 1);
    expectOk(await v.api.run('history.undo', {}));
    expect(themes(v).a).toEqual(before.a);
    expect(themes(v).b).toEqual(before.b);
  });

  it('by object: a color each, structures, list and isosurface alike, one step', async () => {
    const v = await viewer();
    const { refs } = themes(v);
    const steps = v.api.history.steps.value.length;
    expectOk(
      await v.api.run('mesoscale.theme', { objects: [refs.a, refs.b, refs.list, refs.volume], theme: 'object' }),
    );
    const after = themes(v);
    const one = (ts: Theme[]) => {
      expect(ts.length).toBeGreaterThan(0);
      expect(ts.every((t) => t.name === 'uniform' && t.params.value === ts[0].params.value)).toBe(true);
      return ts[0].params.value;
    };
    const colors = [one(after.a), one(after.b), one(after.list), one(after.volume)];
    expect(new Set(colors).size).toBe(4);
    expect(v.api.history.steps.value.length).toBe(steps + 1);
  });

  it("by entity: a model's entities, its look colors cleared (they paint over a theme), one step", async () => {
    const v = await viewer();
    const { refs } = themes(v);
    expectOk(await v.api.mesoscale!.colors({ scheme: 'generate', particles: refs.list } as never));
    const colored = () => v.api.mesoscale!.infoState(refs.list).value!.entities.filter((e) => e.color !== undefined);
    expect(colored().length).toBeGreaterThan(0);
    const steps = v.api.history.steps.value.length;
    expectOk(await v.api.run('mesoscale.theme', { objects: [refs.list, refs.a], theme: 'entity' }));
    const after = themes(v);
    expect(after.list.every((t) => t.name === 'particle-entity')).toBe(true);
    expect(after.a.every((t) => t.name === 'entity-id')).toBe(true);
    expect(colored()).toEqual([]);
    expect(v.api.history.steps.value.length).toBe(steps + 1);
    expectOk(await v.api.run('history.undo', {}));
    expect(colored().length).toBeGreaterThan(0);
  });

  it('a theme a kind does not take fails before any change', async () => {
    const v = await viewer();
    const before = themes(v);
    const r = await v.api.run('mesoscale.theme', { objects: [before.refs.a, before.refs.list], theme: 'chain' });
    expect(r).toMatchObject({ ok: false, code: 'invalid' });
    expect(themes(v)).toEqual(before);
  });
});

describe("mesoscale.theme's surface", () => {
  it("is the agent's and the tree's, with no ⌘K form (its refs would be read as files)", async () => {
    const v = await viewer();
    expect(v.managers.commands.get('mesoscale.theme')).toBeUndefined();
    expect(v.api.definitions.value.get('mesoscale.theme')?.surface).toMatchObject({ kind: 'agent-only' });
  });
});
