/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { Mat4 } from '@molstar/core/math/linear-algebra';
import { Tensor } from '@molstar/core/math/linear-algebra';
import { Spheres } from '@molstar/graphics/geo/geometry/spheres/spheres';
import { CCP4Writer } from '@molstar/model/formats/writer/ccp4/ccp4';
import type { Grid } from '@molstar/model/model/volume';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MesoscaleExtension } from '../prism-viewer.js';
import { TestFiberList, TestParticleList } from './fixtures.js';

// Graphics quality and motion per object (apps/prism-me/_spec/ui.md §4, Graphics & Motion): `mesoscale.graphics` and
// `mesoscale.motion` given an `object` (a structure, a particle list, a volume) change that object alone; without one,
// the graphics mode sets every object and the canvas. Two copies of 1CRN (data/examples), a cellPACK-like list and a
// small map made in memory.

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

async function viewer(structures = ['a.cif', 'b.cif']) {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
  });
  viewers.push(v);
  await v.plugin.build().toRoot().apply(TestParticleList).commit();
  expectOk(await v.api.particles.representation({ type: 'spacefill' }));
  for (const f of [...structures.map((n) => crn(n)), mapFile('map.mrc', 10)]) {
    expectOk(await v.api.load.files({ files: [f] }));
  }
  if (!v.plugin.managers.volume.hierarchy.current.volumes[0]?.representations.length) {
    expectOk(await v.api.run('volume.representation', { type: 'isosurface' }));
  }
  return v;
}

type Params = { type: { params: Record<string, any> } };
const paramsOf = (cell: { transform: { params?: unknown } }) => (cell.transform.params as Params).type.params;

/** The representations' params of each object: structures a and b, the list, the volume */
function objects(v: PrismViewer) {
  const [a, b] = v.plugin.managers.structure.hierarchy.current.structures;
  const list = v.plugin.managers.particles.hierarchy.current.lists[0];
  const volume = v.plugin.managers.volume.hierarchy.current.volumes[0];
  const reprs = (s: typeof a) => s.components.flatMap((c) => c.representations).map((r) => paramsOf(r.cell));
  return {
    refs: {
      a: a.cell.transform.ref,
      b: b.cell.transform.ref,
      list: list.cell.transform.ref,
      volume: volume.cell.transform.ref,
    },
    a: reprs(a),
    b: reprs(b),
    list: list.representations.map((r) => paramsOf(r.cell)),
    volume: volume.representations.map((r) => paramsOf(r.cell)),
  };
}

describe('graphics and motion per object', () => {
  it("sets one object's quality, the others unchanged", async () => {
    const v = await viewer();
    const before = objects(v);
    const m = v.api.mesoscale!;
    expectOk(await m.graphics({ mode: 'performance', object: before.refs.list } as never));
    const after = objects(v);
    expect(
      after.list.every(
        (p) => JSON.stringify(p.lodLevels) === JSON.stringify(Spheres.LodPixelPresets.performance.lodLevels),
      ),
    ).toBe(true);
    expect(after.a).toEqual(before.a);
    expect(after.b).toEqual(before.b);
    expect(after.volume).toEqual(before.volume);
    // a structure's: its representations' quality, the other structure's kept
    expectOk(await m.graphics({ mode: 'ultra', object: before.refs.a } as never));
    expect(objects(v).a.every((p) => p.quality === 'highest')).toBe(true);
    expect(objects(v).b).toEqual(before.b);
    expect(m.graphicsState(before.refs.a).value?.mode).toBe('ultra');
    expect(m.graphicsState(before.refs.b).value?.mode).toBeUndefined();
    expect(m.graphicsState(before.refs.list).value?.mode).toBe('performance');
    // a volume's: its representations' quality
    expectOk(await m.graphics({ mode: 'balanced', object: before.refs.volume } as never));
    expect(objects(v).volume.every((p) => p.quality === 'medium')).toBe(true);
    expect(m.graphicsState(before.refs.volume).value).toEqual({ mode: 'balanced' });
  });

  // A particle list draws by size on screen (`lodPixelSize`): a mode writes its pixel preset, levels and size, and reads
  // back by both (TODO.md, from the cellVIEW evaluation, item 1)
  it("writes a mode's pixel levels of detail and lights that mode", async () => {
    const v = await viewer();
    const { refs } = objects(v);
    const m = v.api.mesoscale!;
    for (const mode of ['performance', 'balanced', 'ultra', 'quality'] as const) {
      expectOk(await m.graphics({ mode, object: refs.list } as never));
      const { lodLevels, lodPixelSize } = Spheres.LodPixelPresets[mode];
      for (const p of objects(v).list) {
        expect(p.lodLevels).toEqual(lodLevels);
        expect(p.lodPixelSize).toBe(lodPixelSize);
      }
      expect(m.graphicsState(refs.list).value?.mode).toBe(mode);
    }
    // the preset's levels by distance (`lodPixelSize` 0) are no mode
    const b = v.plugin.build();
    for (const r of v.plugin.managers.particles.hierarchy.current.lists[0].representations) {
      b.to(r.cell).update((old: Params) => {
        old.type.params.lodPixelSize = 0;
      });
    }
    await b.commit();
    expect(m.graphicsState(refs.list).value?.mode).toBeUndefined();
  });

  // A cellPACK list draws its fibers too, without levels of detail: the mode is read from the representations that have
  // them, so the picked mode stays lit
  it('lights the mode of a list with a representation without levels of detail', async () => {
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
    });
    viewers.push(v);
    await v.plugin.build().toRoot().apply(TestFiberList).commit();
    expectOk(await v.api.particles.representation({ type: 'spacefill' }));
    expectOk(await v.api.particles.representation({ type: 'fibers' }));
    const list = v.plugin.managers.particles.hierarchy.current.lists[0];
    const types = list.representations.map((r) => paramsOf(r.cell));
    expect(types.length).toBe(2);
    expect(types.some((p) => !('lodLevels' in p))).toBe(true);
    const m = v.api.mesoscale!;
    const ref = list.cell.transform.ref;
    expectOk(await m.graphics({ mode: 'performance', object: ref } as never));
    expect(m.graphicsState(ref).value?.mode).toBe('performance');
  });

  it('wiggles and tumbles one structure, the other still', async () => {
    const v = await viewer();
    const { refs } = objects(v);
    const m = v.api.mesoscale!;
    expectOk(await m.motion({ wiggle: 1.5, tumble: 2, object: refs.a } as never));
    const after = objects(v);
    expect(after.a.every((p) => p.animation.wiggleAmplitude === 1.5 && p.animation.tumbleAmplitude === 2)).toBe(true);
    expect(after.b.every((p) => p.animation.wiggleAmplitude === 0 && p.animation.tumbleAmplitude === 0)).toBe(true);
    expect(after.list.every((p) => (p.animation?.wiggleAmplitude ?? 0) === 0)).toBe(true);
    expect(m.graphicsState(refs.a).value).toMatchObject({ wiggle: 1.5, tumble: 2 });
    expect(m.graphicsState(refs.b).value).toMatchObject({ wiggle: 0, tumble: 0 });
  });

  it('does not move a volume: its graphics are quality only', async () => {
    const v = await viewer();
    const { refs } = objects(v);
    const m = v.api.mesoscale!;
    expect(await m.motion({ wiggle: 1, object: refs.volume } as never)).toMatchObject({ ok: false, code: 'invalid' });
    const g = m.graphicsState(refs.volume).value!;
    expect('wiggle' in g || 'tumble' in g).toBe(false);
  });

  it('undoes each change in one step', async () => {
    const v = await viewer();
    const before = objects(v);
    const m = v.api.mesoscale!;
    expectOk(await m.motion({ wiggle: 2, object: before.refs.a } as never));
    expectOk(await m.graphics({ mode: 'performance', object: before.refs.a } as never));
    expectOk(await v.api.history.undo({}));
    expect(objects(v).a.every((p) => p.animation.wiggleAmplitude === 2 && p.quality === before.a[0].quality)).toBe(
      true,
    );
    expectOk(await v.api.history.undo({}));
    expect(objects(v).a).toEqual(before.a);
  });

  it('sets every object without one, and the canvas', async () => {
    const v = await viewer();
    expectOk(await v.api.mesoscale!.graphics({ mode: 'performance' }));
    const after = objects(v);
    const lod = JSON.stringify(Spheres.LodPixelPresets.performance.lodLevels);
    expect(after.list.every((p) => JSON.stringify(p.lodLevels) === lod)).toBe(true);
    expect([...after.a, ...after.b, ...after.volume].every((p) => p.quality === 'low')).toBe(true);
  });

  // The scene-wide structure options (component.options) change only the representations that had their previous value:
  // one structure's own quality and motion stay (v6 #2057, "component options keep overrides")
  it("keeps a structure's own quality and motion under the scene-wide structure options", async () => {
    const v = await viewer();
    const { refs } = objects(v);
    const m = v.api.mesoscale!;
    expectOk(await m.motion({ wiggle: 1.5, object: refs.a } as never));
    expectOk(await m.graphics({ mode: 'ultra', object: refs.a } as never));
    expect(objects(v).a.every((p) => p.quality === 'highest' && p.animation.wiggleAmplitude === 1.5)).toBe(true);
    expectOk(await v.api.run('component.options', { quality: 'low' }));
    const after = objects(v);
    expect(after.a.every((p) => p.quality === 'highest' && p.animation.wiggleAmplitude === 1.5)).toBe(true);
    expect(after.b.every((p) => p.quality === 'low' && p.animation.wiggleAmplitude === 0)).toBe(true);
  });
  // ⌘K and the agent name an object as the tree does: a structure by its entry, any object by its file
  it('finds an object by its name in the tree and says it', async () => {
    const one = await viewer(['crn.cif']);
    const r = await one.api.mesoscale!.motion({ wiggle: 1, object: '1CRN' } as never);
    expectOk(r);
    expect(r.did).toContain('1CRN');
    const s = one.plugin.managers.structure.hierarchy.current.structures[0];
    const wiggles = s.components
      .flatMap((c) => c.representations)
      .map((x) => paramsOf(x.cell).animation.wiggleAmplitude);
    expect(wiggles.every((w) => w === 1)).toBe(true);
    const g = await one.api.mesoscale!.graphics({ mode: 'performance', object: 'map.mrc' } as never);
    expectOk(g);
    expect(g.did).toContain('map.mrc');
    const two = await viewer();
    const { refs } = objects(two);
    expectOk(await two.api.mesoscale!.motion({ wiggle: 2, object: 'b.cif' } as never));
    expect(two.api.mesoscale!.graphicsState(refs.b).value).toMatchObject({ wiggle: 2 });
    expect(two.api.mesoscale!.graphicsState(refs.a).value).toMatchObject({ wiggle: 0 });
  });
  // An object's graphics read from every representation: one added later (with its own defaults) makes them mixed, and
  // a mixed object lights no mode and shows its motion off
  it('reads a mixed object as no mode and no motion', async () => {
    const v = await viewer(['crn.cif']);
    const m = v.api.mesoscale!;
    const s = v.plugin.managers.structure.hierarchy.current.structures[0];
    const ref = s.cell.transform.ref;
    expectOk(await m.motion({ wiggle: 1.5, object: ref } as never));
    expectOk(await m.graphics({ mode: 'ultra', object: ref } as never));
    expect(m.graphicsState(ref).value).toEqual({ mode: 'ultra', wiggle: 1.5, tumble: 0 });
    await v.plugin.builders.structure.representation.addRepresentation(s.components[0].cell, {
      type: 'ball-and-stick',
    });
    expect(m.graphicsState(ref).value).toEqual({ wiggle: 0, tumble: 0 });
  });
  // The canvas resolution is the scene's: one object's mode never touches it; the mode of every object does. Headless has
  // no canvas, so a stand-in records what is set.
  it("sets the canvas resolution with every object's mode only", async () => {
    const v = await viewer();
    const { refs } = objects(v);
    const setProps = vi.fn();
    const plugin = v.plugin as unknown as { canvas3dContext: unknown };
    plugin.canvas3dContext = { props: { pixelScale: 1 }, setProps };
    try {
      const m = v.api.mesoscale!;
      expectOk(await m.graphics({ mode: 'performance', object: refs.list } as never));
      expect(await m.graphics({ mode: 'performance', object: refs.list } as never)).toMatchObject({
        ok: true,
        unchanged: true,
      });
      expect(setProps).not.toHaveBeenCalled();
      expectOk(await m.graphics({ mode: 'performance' }));
      expect(setProps).toHaveBeenCalledWith({ pixelScale: 0.5 });
    } finally {
      plugin.canvas3dContext = undefined;
    }
  });
  it('fails, not already, for an object with nothing drawn', async () => {
    const v = await viewer(['crn.cif']);
    const s = v.plugin.managers.structure.hierarchy.current.structures[0];
    const b = v.plugin.build();
    for (const r of s.components.flatMap((c) => c.representations)) b.delete(r.cell.transform.ref);
    await b.commit();
    const ref = s.cell.transform.ref;
    expect(await v.api.mesoscale!.graphics({ mode: 'ultra', object: ref } as never)).toMatchObject({
      ok: false,
      code: 'not-found',
    });
    expect(await v.api.mesoscale!.motion({ wiggle: 1, object: ref } as never)).toMatchObject({
      ok: false,
      code: 'not-found',
      hint: 'Give it a representation first.',
    });
  });
});
