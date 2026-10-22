/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Mat4, Tensor } from '@molstar/core/math/linear-algebra';
import { CCP4Writer } from '@molstar/model/formats/writer/ccp4/ccp4';
import { CustomProperties } from '@molstar/model/model/custom-property';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import type { Structure } from '@molstar/model/model/structure';
import type { Grid } from '@molstar/model/model/volume';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { type DecorationsInfo, type MeshInfo, type SliceInfo, sliceVisuals } from '../operations.js';
import { CryoetExtension } from '../prism-viewer.js';

// The `cryoet` area on a headless viewer: a RELION list of four particles in classes 1, 2, 1, 3 and two small maps
// (an n³ blob each) to decorate them with, all made in memory.

const star = `data_particles

loop_
_rlnCoordinateX #1
_rlnCoordinateY #2
_rlnCoordinateZ #3
_rlnClassNumber #4
10 0 0 1
20 0 0 2
30 0 0 1
40 0 0 3
`;

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

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
}

async function viewer() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), CryoetExtension] },
  });
  viewers.push(v);
  for (const f of [new File([star], 'particles.star'), mapFile('ribosome.mrc', 12), mapFile('proteasome.mrc', 10)]) {
    expectOk(await v.api.load.files({ files: [f] }));
  }
  return v;
}

const decorations = async (v: PrismViewer) => {
  const r = await v.api.cryoet!.decorations({});
  expectOk(r);
  return r.value as DecorationsInfo;
};

/** A cellPACK-like model: two particles of one entity, "crambin", whose structure is given */
const TestModel = PluginStateTransform.BuiltIn({
  name: 'cryoet-test-model',
  display: { name: 'Test Model' },
  from: SO.Root,
  to: SO.Particle.List,
  params: {
    structure: PD.Value<Structure | undefined>(undefined),
    /** Its entities' names, a target each (the last one's two particles) */
    names: PD.Value<string[]>(['crambin']),
  },
})({
  apply({ params }) {
    const last = params.names.length - 1;
    const list: ParticleList = {
      label: 'model',
      count: 2,
      keys: Int32Array.of(0, 1),
      targets: Int32Array.of(last, last),
      targetInfo: new Map(params.names.map((_, i) => [i, { entity: i }])),
      entityInfo: new Map(params.names.map((name, i) => [i, { name }])),
      targetMapping: new Map(
        params.names.map((_, i) => [i, { kind: 'structure' as const, structure: params.structure! }]),
      ),
      coordinates: Float32Array.of(0, 0, 0, 50, 0, 0),
      getParticleLabel: (i) => `${i}`,
      sourceData: { kind: 'test', name: 'test', data: {} },
      customProperties: new CustomProperties(),
      _propertyData: Object.create(null),
    };
    return new SO.Particle.List(list, { label: 'model' });
  },
});

describe('cryoet', () => {
  it("decorates with an entity of a model (its own structure), and lists the models' entities", async () => {
    const v = await viewer();
    const crn = new File([readFileSync(new URL('../../../../data/examples/1crn.cif', import.meta.url))], '1crn.cif');
    expectOk(await v.api.load.files({ files: [crn] }));
    const structure = v.plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data;
    await v.plugin.build().toRoot().apply(TestModel, { structure }).commit();
    const [star, model] = v.plugin.managers.particles.hierarchy.current.lists.map((l) => l.cell.transform.ref);
    const r = await v.api.cryoet!.decorations({ particles: star } as never);
    expectOk(r);
    const entity = (r.value as DecorationsInfo).objects.find((o) => o.group);
    expect(entity).toEqual({ ref: `target:${model}:0`, label: 'model › crambin', group: 'model' });
    expectOk(await v.api.cryoet!.decorate({ with: 'entity', entity: 'crambin', particles: star } as never));
    const list = v.plugin.managers.particles.hierarchy.current.lists[0];
    const target = list.representations[0].cell.obj!.data.sourceData.targetMapping?.get(0);
    expect(target?.kind === 'structure' && target.structure).toBe(structure);
    const after = await v.api.cryoet!.decorations({ particles: star } as never);
    expectOk(after);
    expect((after.value as DecorationsInfo).targets[0]).toMatchObject({
      with: 'model › crambin',
      object: `target:${model}:0`,
    });
  });

  it('decorates every target with an object of the scene, and shows them with a target representation', async () => {
    const v = await viewer();
    expectOk(await v.api.cryoet!.decorate({ with: 'object', object: 'ribosome.mrc' } as never));
    const d = await decorations(v);
    expect(d.targets.map((t) => t.with)).toEqual(['ribosome.mrc']);
    const types = v.plugin.managers.particles.hierarchy.current.lists[0].representations.map(
      (r) => (r.cell.transform.params as any).type.name,
    );
    expect(types).toContain('target');
    // the spheres are hidden: the objects stand for the particles
    const hidden = v.plugin.managers.particles.hierarchy.current.lists[0].representations
      .filter((r) => r.cell.state.isHidden)
      .map((r) => (r.cell.transform.params as any).type.name);
    expect(hidden).toEqual(['spacefill']);
  });

  it('switches what is drawn only when decorated or no longer: the eyes set between are kept, spheres come back', async () => {
    const v = await viewer();
    const c = v.api.cryoet!;
    const reprs = () => v.plugin.managers.particles.hierarchy.current.lists[0].representations;
    const shown = () =>
      reprs()
        .filter((r) => !r.cell.state.isHidden)
        .map((r) => (r.cell.transform.params as any).type.name)
        .sort();
    expectOk(await c.decorate({ with: 'object', object: 'ribosome.mrc' } as never));
    expect(shown()).toEqual(['target']);
    // the spheres shown again by hand: a swap of the object keeps them
    const spheres = reprs().find((r) => (r.cell.transform.params as any).type.name === 'spacefill')!;
    expectOk(await v.api.run('particles.visibility', { node: `#${spheres.cell.transform.ref}`, visible: true }));
    expectOk(await c.decorate({ with: 'object', object: 'proteasome.mrc' } as never));
    expect(shown()).toEqual(['spacefill', 'target']);
    // the spheres removed, then no decoration left: spheres again (nothing would draw the particles)
    expectOk(await v.api.run('particles.remove', { node: `#${spheres.cell.transform.ref}` }));
    expectOk(await c.decorate({ with: 'none' } as never));
    expect(shown()).toEqual(['spacefill']);
  });

  it('splits the targets by class and decorates each class apart, swapping one without touching the others', async () => {
    const v = await viewer();
    const c = v.api.cryoet!;
    expectOk(await c.classes({ attribute: 'class' } as never));
    expect((await decorations(v)).targets.map((t) => [t.name, t.count])).toEqual([
      ['Class 1', 2],
      ['Class 2', 1],
      ['Class 3', 1],
    ]);
    expectOk(await c.decorate({ with: 'object', object: 'ribosome.mrc' } as never));
    expectOk(await c.decorate({ with: 'object', object: 'proteasome.mrc', targets: 'Class 2' } as never));
    expect((await decorations(v)).targets.map((t) => t.with)).toEqual([
      'ribosome.mrc',
      'proteasome.mrc',
      'ribosome.mrc',
    ]);
    expectOk(await c.decorate({ with: 'none', targets: '2' } as never));
    expect((await decorations(v)).targets.map((t) => t.with ?? null)).toEqual(['ribosome.mrc', 'proteasome.mrc', null]);
    const same = await c.decorate({ with: 'none', targets: '2' } as never);
    expectOk(same);
    expect(same.unchanged).toBe(true);
  });

  it('picks an entity by its name as written, before names that differ in case only', async () => {
    const v = await viewer();
    const crn = new File([readFileSync(new URL('../../../../data/examples/1crn.cif', import.meta.url))], '1crn.cif');
    expectOk(await v.api.load.files({ files: [crn] }));
    const structure = v.plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data;
    await v.plugin
      .build()
      .toRoot()
      .apply(TestModel, { structure, names: ['7CGOA', '7CGOa'] })
      .commit();
    const [star] = v.plugin.managers.particles.hierarchy.current.lists.map((l) => l.cell.transform.ref);
    expectOk(await v.api.cryoet!.decorate({ with: 'entity', entity: '7CGOa', particles: star } as never));
    const after = await v.api.cryoet!.decorations({ particles: star } as never);
    expectOk(after);
    expect((after.value as DecorationsInfo).targets[0].with).toBe('model › 7CGOa');
  });

  it('decorates with a structure of the scene, named as the viewer names it', async () => {
    const v = await viewer();
    const crn = new File([readFileSync(new URL('../../../../data/examples/1crn.cif', import.meta.url))], '1crn.cif');
    expectOk(await v.api.load.files({ files: [crn] }));
    expect((await decorations(v)).objects.map((o) => o.label)).toEqual(['1CRN', 'ribosome.mrc', 'proteasome.mrc']);
    expectOk(await v.api.cryoet!.decorate({ with: 'object', object: '1crn' } as never));
    const list = v.plugin.managers.particles.hierarchy.current.lists[0];
    const target = list.representations[0].cell.obj!.data.sourceData.targetMapping?.get(0);
    expect(target?.kind).toBe('structure');
  });

  it('styles a segmentation mesh: wireframe, opacity, color, hidden', async () => {
    const v = await viewer();
    const obj = 'v 0 0 0\nv 10 0 0\nv 0 10 0\nv 0 0 10\nf 1 2 3\nf 1 2 4\nf 1 3 4\nf 2 3 4\n';
    expectOk(await v.api.load.files({ files: [new File([obj], 'membrane.obj')] }));
    const c = v.api.cryoet!;
    const read = async () => {
      const r = await c.meshes({});
      expectOk(r);
      return (r.value as MeshInfo[])[0];
    };
    expect(await read()).toMatchObject({ label: 'membrane.obj', visible: true, visuals: ['mesh'], opacity: 1 });
    expectOk(await c.mesh({ mesh: 'membrane.obj', visuals: 'both', opacity: 0.5, color: 'tomato' } as never));
    expect(await read()).toMatchObject({ visuals: ['mesh', 'wireframe'], opacity: 0.5, color: 0xff6347 });
    expectOk(await c.mesh({ visible: false } as never));
    expect((await read()).visible).toBe(false);
    expect(await c.mesh({ mesh: 'nope', visible: true } as never)).toMatchObject({ ok: false, code: 'not-found' });
  });

  it('scales a segmentation mesh (a mesh in pixels: by the pixel size)', async () => {
    const v = await viewer();
    const obj = 'v 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3\n';
    expectOk(await v.api.load.files({ files: [new File([obj], 'seg.obj')] }));
    const c = v.api.cryoet!;
    const read = async () => {
      const r = await c.meshes({});
      expectOk(r);
      return (r.value as MeshInfo[])[0];
    };
    expect((await read()).scale).toBe(1);
    expectOk(await c.mesh({ mesh: 'seg.obj', scale: 8 } as never));
    expect((await read()).scale).toBeCloseTo(8);
    // the shape drawn is 8 times larger: its instance transform
    const shape = Array.from(v.plugin.state.data.cells.values()).find((x) => SO.Shape.Provider.is(x.obj))!;
    expect((shape.obj!.data as { data: { transforms: number[][] } }).data.transforms[0][0]).toBeCloseTo(8);
    expect(await c.mesh({ mesh: 'seg.obj', scale: 8 } as never)).toMatchObject({ ok: true, unchanged: true });
  });

  it('goes back to the targets of the file', async () => {
    const v = await viewer();
    expectOk(await v.api.cryoet!.classes({ attribute: 'class' } as never));
    expectOk(await v.api.cryoet!.classes({ attribute: '' } as never));
    expect((await decorations(v)).targets).toHaveLength(1);
  });

  it('fails with what to write instead', async () => {
    const v = await viewer();
    const c = v.api.cryoet!;
    expect(await c.classes({ attribute: 'nope' } as never)).toMatchObject({ ok: false, code: 'not-found' });
    expect(await c.decorate({ with: 'object', object: 'nope' } as never)).toMatchObject({
      ok: false,
      code: 'not-found',
    });
    expect(await c.decorate({ with: 'object' } as never)).toMatchObject({ ok: false, code: 'ambiguous' });
    expect(await c.decorate({ with: 'none', targets: 'Class 9' } as never)).toMatchObject({
      ok: false,
      code: 'not-found',
    });
  });

  it('shows a gray slice per axis, the middle one by default, and steps through each apart', async () => {
    const v = await viewer();
    const c = v.api.cryoet!;
    const read = () => (c.sliceState(volumeRef(v, 'ribosome.mrc')).value as SliceInfo).slices;
    expectOk(await c.slice({ volume: 'ribosome.mrc' } as never));
    expect(read()).toMatchObject([{ axis: 'z', index: 6, contrast: 3, visible: true }]);
    expectOk(await c.slice({ volume: 'ribosome.mrc', index: 2, contrast: 1.5 } as never));
    expect(read()).toMatchObject([{ axis: 'z', index: 2, contrast: 1.5 }]);
    // another axis: its own slice, the z one kept
    expectOk(await c.slice({ volume: 'ribosome.mrc', axis: 'x', index: 99 } as never));
    expect(read().map((x) => [x.axis, x.index])).toEqual([
      ['x', 11],
      ['z', 2],
    ]);
    expect(await c.slice({ volume: 'ribosome.mrc', axis: 'x', index: 11 } as never)).toMatchObject({ unchanged: true });
  });

  it('shows the three slices, the isosurfaces hidden; a slice keeps its form-set look when moved', async () => {
    const v = await viewer();
    const c = v.api.cryoet!;
    const ref = volumeRef(v, 'ribosome.mrc');
    expectOk(await c.slices({ volume: 'ribosome.mrc' } as never));
    expect((c.sliceState(ref).value as SliceInfo).slices.map((x) => [x.axis, x.index])).toEqual([
      ['x', 6],
      ['y', 6],
      ['z', 6],
    ]);
    const vol = v.plugin.managers.volume.hierarchy.current.volumes.find((x) => x.cell.transform.ref === ref)!;
    const iso = vol.representations.filter((r) => (r.cell.transform.params as any).type.name === 'isosurface');
    expect(iso.length).toBeGreaterThan(0);
    expect(iso.every((r) => r.cell.state.isHidden)).toBe(true);
    expect(await c.slices({ volume: 'ribosome.mrc' } as never)).toMatchObject({ unchanged: true });
    // its opacity set in the form stays when the slice moves
    const z = (c.sliceState(ref).value as SliceInfo).slices[2].ref;
    await v.plugin
      .build()
      .to(z)
      .update((p: any) => ({ ...p, type: { ...p.type, params: { ...p.type.params, alpha: 0.4 } } }))
      .commit();
    expectOk(await c.slice({ volume: 'ribosome.mrc', axis: 'z', index: 3 } as never));
    expect((v.plugin.state.data.cells.get(z)!.transform.params as any).type.params.alpha).toBe(0.4);
  });

  it('gives a volume format three slices as its visuals (a tomogram dropped), no isosurface', async () => {
    const v = await viewer();
    const c = v.api.cryoet!;
    const vol = v.plugin.managers.volume.hierarchy.current.volumes.find((x) => x.cell.obj?.label === 'proteasome.mrc')!;
    const before = vol.representations.length;
    await sliceVisuals(v.plugin, { volume: { ref: vol.cell.transform.ref, cell: vol.cell } as never });
    const after = (c.sliceState(vol.cell.transform.ref).value as SliceInfo).slices;
    expect(after.map((x) => x.axis)).toEqual(['x', 'y', 'z']);
    const fresh = v.plugin.managers.volume.hierarchy.current.volumes.find(
      (x) => x.cell.obj?.label === 'proteasome.mrc',
    )!;
    expect(fresh.representations.length).toBe(before + 3);
  });

  it('shows the objects while any target is decorated, else the spheres again (a target representation reused)', async () => {
    const v = await viewer();
    const c = v.api.cryoet!;
    const crn = new File([readFileSync(new URL('../../../../data/examples/1crn.cif', import.meta.url))], '1crn.cif');
    expectOk(await v.api.load.files({ files: [crn] }));
    const list = () => v.plugin.managers.particles.hierarchy.current.lists[0];
    const shown = () =>
      list()
        .representations.filter((r) => !r.cell.state.isHidden)
        .map((r) => (r.cell.transform.params as any).type.name)
        .sort();
    expect(shown()).toEqual(['spacefill']);
    expectOk(await c.decorate({ with: 'object', object: '1crn' } as never));
    expect(shown()).toEqual(['target']);
    // back to spheres: the spheres again, the (now empty) objects hidden
    expectOk(await c.decorate({ with: 'none' } as never));
    expect(shown()).toEqual(['spacefill']);
    // decorated again: the same target representation shown again, not another
    expectOk(await c.decorate({ with: 'object', object: '1crn' } as never));
    expect(shown()).toEqual(['target']);
    expect(list().representations.filter((r) => (r.cell.transform.params as any).type.name === 'target')).toHaveLength(
      1,
    );
  });
});

function volumeRef(v: PrismViewer, label: string) {
  return v.plugin.managers.volume.hierarchy.current.volumes.find((x) => x.cell.obj?.label === label)!.cell.transform
    .ref;
}
