/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { StateSelection } from '@molstar/core/state';
import { ParticleRepresentation3DLayers } from '@molstar/plugin/state/transforms/particles/layers';
import { Mat4, Tensor, Vec3 } from '@molstar/core/math/linear-algebra';
import { CCP4Writer } from '@molstar/model/formats/writer/ccp4/ccp4';
import { CustomProperties } from '@molstar/model/model/custom-property';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import type { Structure } from '@molstar/model/model/structure';
import type { Grid } from '@molstar/model/model/volume';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';
import { VolumeTransform } from '@molstar/plugin/state/transforms/volume/ops';
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

/** The targets a representation leaves out (its layers' `hidden`: drawn by the decorations' objects) */
const hiddenTargets = (v: PrismViewer, repr: string) => {
  const layers = v.plugin.state.data.select(
    StateSelection.Generators.ofTransformer(ParticleRepresentation3DLayers, repr),
  )[0];
  return [...((layers?.transform.params as { hidden?: number[] } | undefined)?.hidden ?? [])];
};

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
    const crn = new File([readFileSync(new URL('../../../../../data/examples/1crn.cif', import.meta.url))], '1crn.cif');
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
    // the spheres stay, without the decorated targets (their objects stand for them): here, every target
    const spheres = v.plugin.managers.particles.hierarchy.current.lists[0].representations.find(
      (r) => (r.cell.transform.params as any).type.name === 'spacefill',
    )!;
    expect(spheres.cell.state.isHidden).toBeFalsy();
    expect(hiddenTargets(v, spheres.cell.transform.ref)).toEqual([0]);
  });

  it('draws the targets not decorated as spheres and axes: a decorated class is left out of them, not the others', async () => {
    const v = await viewer();
    const c = v.api.cryoet!;
    const reprs = () => v.plugin.managers.particles.hierarchy.current.lists[0].representations;
    const ofType = (t: string) => reprs().find((r) => (r.cell.transform.params as any).type.name === t)!;
    const shown = () =>
      reprs()
        .filter((r) => !r.cell.state.isHidden)
        .map((r) => (r.cell.transform.params as any).type.name)
        .sort();
    // three classes (targets 0, 1, 2); only the second decorated
    expectOk(await c.classes({ attribute: 'class' } as never));
    expectOk(await c.decorate({ with: 'object', object: 'ribosome.mrc', targets: '1' } as never));
    expect(shown()).toEqual(['spacefill', 'target']);
    expect(hiddenTargets(v, ofType('spacefill').cell.transform.ref)).toEqual([1]);
    // a second class: both left out
    expectOk(await c.decorate({ with: 'object', object: 'proteasome.mrc', targets: '2' } as never));
    expect(hiddenTargets(v, ofType('spacefill').cell.transform.ref)).toEqual([1, 2]);
    // back to spheres: nothing left out
    expectOk(await c.decorate({ with: 'none' } as never));
    expect(hiddenTargets(v, ofType('spacefill').cell.transform.ref)).toEqual([]);
    // the spheres removed, then no decoration left: spheres again (nothing would draw the particles)
    expectOk(await c.decorate({ with: 'object', object: 'ribosome.mrc' } as never));
    expectOk(await v.api.run('particles.remove', { node: `#${ofType('spacefill').cell.transform.ref}` }));
    expectOk(await c.decorate({ with: 'none' } as never));
    expect(shown()).toEqual(['spacefill']);
  });

  it('decorating keeps an earlier color and an earlier cut, and the target representation takes the colors', async () => {
    const v = await viewer();
    const c = v.api.cryoet!;
    const list = () => v.plugin.managers.particles.hierarchy.current.lists[0];
    const ofType = (t: string) => list().representations.find((r) => (r.cell.transform.params as any).type.name === t)!;
    const look = (t: string) =>
      v.plugin.state.data.select(
        StateSelection.Generators.ofTransformer(ParticleRepresentation3DLayers, ofType(t).cell.transform.ref),
      )[0]?.transform.params as any;
    expectOk(await c.classes({ attribute: 'class' } as never));
    const ref = list().cell.transform.ref;
    expectOk(
      await v.api.run('particles.look', { particles: ref, layers: [{ selector: { targets: [2] }, color: 0xff0000 }] }),
    );
    expectOk(await v.api.run('clipping.add', { shape: 'sphere', node: `#${ref}`, particles: { targets: [0] } }));
    expectOk(await c.decorate({ with: 'object', object: 'ribosome.mrc', targets: '1' } as never));
    const spheres = look('spacefill');
    expect(spheres.layers).toMatchObject([{ targets: [2], color: 0xff0000 }]);
    expect(spheres.cuts).toMatchObject([{ targets: [0] }]);
    expect(spheres.hidden).toEqual([1]);
    // the objects drawn in the class's color too; they leave nothing out, and have no clip object for the cut
    const target = look('target');
    expect(target.layers).toMatchObject([{ targets: [2], color: 0xff0000 }]);
    expect([target.hidden, target.cuts]).toEqual([[], []]);
  });

  it("says each target's shown state, a class hidden by its own layer (the tree's eye)", async () => {
    const v = await viewer();
    const c = v.api.cryoet!;
    expectOk(await c.classes({ attribute: 'class' } as never));
    const ref = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    expect((await decorations(v)).targets.map((t) => t.visible)).toEqual([true, true, true]);
    expectOk(
      await v.api.run('particles.look', { particles: ref, layers: [{ selector: { targets: [1] }, visible: false }] }),
    );
    expect((await decorations(v)).targets.map((t) => t.visible)).toEqual([true, false, true]);
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
    const crn = new File([readFileSync(new URL('../../../../../data/examples/1crn.cif', import.meta.url))], '1crn.cif');
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
    const crn = new File([readFileSync(new URL('../../../../../data/examples/1crn.cif', import.meta.url))], '1crn.cif');
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

  it('colors several meshes, each its own color, in one write', async () => {
    const v = await viewer();
    const obj = 'v 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3\n';
    expectOk(await v.api.load.files({ files: [new File([obj], 'a.obj'), new File([obj], 'b.obj')] }));
    const c = v.api.cryoet!;
    const read = async () => {
      const r = await c.meshes({});
      expectOk(r);
      return new Map((r.value as MeshInfo[]).map((m) => [m.label, m.color]));
    };
    const state = v.plugin.state.data;
    const updateTree = state.updateTree.bind(state);
    let updates = 0;
    (state as { updateTree: typeof updateTree }).updateTree = ((...args: Parameters<typeof updateTree>) => {
      updates++;
      return updateTree(...args);
    }) as typeof updateTree;
    try {
      expectOk(
        await v.api.run('cryoet.mesh', {
          colors: [
            { mesh: 'a.obj', color: 'tomato' },
            { mesh: 'b.obj', color: '#0000ff' },
          ],
        }),
      );
    } finally {
      (state as { updateTree: typeof updateTree }).updateTree = updateTree;
    }
    expect(updates).toBe(1);
    expect(await read()).toEqual(
      new Map([
        ['a.obj', 0xff6347],
        ['b.obj', 0x0000ff],
      ]),
    );
    // a mesh that is none, or a color that is none: nothing written
    expect(
      await v.api.run('cryoet.mesh', {
        colors: [
          { mesh: 'a.obj', color: 'red' },
          { mesh: 'nope', color: 'red' },
        ],
      }),
    ).toMatchObject({ ok: false });
    expect((await read()).get('a.obj')).toBe(0xff6347);
  });

  it('refuses colors it cannot read: mixed with mesh or color, not a list, an entry with no color, a name of two', async () => {
    const v = await viewer();
    const obj = 'v 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3\n';
    expectOk(
      await v.api.load.files({ files: [new File([obj], 'a.obj'), new File([obj], 'm.obj'), new File([obj], 'm.obj')] }),
    );
    const run = (p: Record<string, unknown>) => v.api.run('cryoet.mesh', p);
    const one = { mesh: 'a.obj', color: 'red' };
    expect(await run({ colors: [one], color: 'blue' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await run({ colors: [one], mesh: 'a.obj' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await run({ colors: one })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await run({ colors: [{ mesh: 'a.obj' }] })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await run({ colors: [{ mesh: 'm.obj', color: 'red' }] })).toMatchObject({ ok: false, code: 'ambiguous' });
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

  it('keeps drawing the particles through targets by class and back to the file', async () => {
    const v = await viewer();
    const c = v.api.cryoet!;
    const list = () => v.plugin.managers.particles.hierarchy.current.lists[0];
    const drawn = () =>
      list()
        .representations.filter((r) => !r.cell.state.isHidden && r.cell.obj)
        .map((r) => (r.cell.transform.params as any).type.name)
        .sort();
    expect(drawn()).toEqual(['spacefill']);
    expectOk(await c.classes({ attribute: 'class' } as never));
    expect(drawn()).toEqual(['spacefill']);
    expectOk(await c.classes({ attribute: '' } as never));
    expect(drawn()).toEqual(['spacefill']);
    // decorated by class, then back to the file: the classes' decorations go with them, the spheres leave none out
    expectOk(await c.classes({ attribute: 'class' } as never));
    expectOk(await c.decorate({ with: 'object', object: 'ribosome.mrc' } as never));
    expect(drawn()).toEqual(['spacefill', 'target']);
    const spheres = list().representations.find((r) => (r.cell.transform.params as any).type.name === 'spacefill')!;
    expect(hiddenTargets(v, spheres.cell.transform.ref)).toEqual([0, 1, 2]);
    expectOk(await c.classes({ attribute: '' } as never));
    expect(drawn()).toEqual(['spacefill']);
    expect(hiddenTargets(v, spheres.cell.transform.ref)).toEqual([]);
  });

  it("offsets a class's particles (in their own frames), or all of them; cleared by a switch of classes", async () => {
    const v = await viewer();
    const c = v.api.cryoet!;
    expectOk(await c.classes({ attribute: 'class' } as never));
    const coords = () =>
      Array.from(
        v.plugin.managers.particles.hierarchy.current.lists[0].representations[0].cell.obj!.data.sourceData.coordinates,
      ).map((x) => Math.round(x * 100) / 100);
    // the file's particles: (10, 0, 0), (20, 0, 0), (30, 0, 0), (40, 0, 0), classes 1, 2, 1, 3 (targets 0, 1, 0, 2)
    expectOk(await c.offset({ targets: '1', z: 5 } as never));
    expect(coords()).toEqual([10, 0, 0, 20, 0, 5, 30, 0, 0, 40, 0, 0]);
    expect(c.offsetOf(v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref, '1')).toMatchObject({
      translation: [0, 0, 5],
      euler: [0, 0, 0],
    });
    // every target, besides: added after it
    expectOk(await c.offset({ targets: '', x: 1 } as never));
    expect(coords()).toEqual([11, 0, 0, 21, 0, 5, 31, 0, 0, 41, 0, 0]);
    // its own again: replaced, not added
    expectOk(await c.offset({ targets: '1', z: 0 } as never));
    expect(coords()).toEqual([11, 0, 0, 21, 0, 0, 31, 0, 0, 41, 0, 0]);
    // the classes switched: the offsets were of their ids, they go
    expectOk(await c.classes({ attribute: '' } as never));
    expect(coords()).toEqual([10, 0, 0, 20, 0, 0, 30, 0, 0, 40, 0, 0]);
  });

  it('offsets one instance alone (its own shift and turn), kept beside its target offset, cleared at zero', async () => {
    const v = await viewer();
    const c = v.api.cryoet!;
    const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    const coords = () =>
      Array.from(
        v.plugin.managers.particles.hierarchy.current.lists[0].representations[0].cell.obj!.data.sourceData.coordinates,
      ).map((x) => Math.round(x * 100) / 100);
    expectOk(await c.offset({ targets: '', z: 1 } as never));
    expectOk(await c.instance({ particles: list, index: 2, y: 3 } as never));
    expect(coords()).toEqual([10, 0, 1, 20, 0, 1, 30, 3, 1, 40, 0, 1]);
    expect(c.instanceOf(list, 2)).toMatchObject({ translation: [0, 3, 0], euler: [0, 0, 0] });
    expect(c.instanceOf(list, 1)).toBeUndefined();
    expect(await c.instance({ particles: list, index: 2, y: 3 } as never)).toMatchObject({ unchanged: true });
    expectOk(await c.instance({ particles: list, index: 2, y: 0 } as never));
    expect(c.instanceOf(list, 2)).toBeUndefined();
    expect(await c.instance({ particles: list, index: 99, y: 1 } as never)).toMatchObject({ ok: false });
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

  it('adds an oblique slice and places it in the volume, apart from the x, y and z slices', async () => {
    const v = await viewer();
    const c = v.api.cryoet!;
    const ref = volumeRef(v, 'ribosome.mrc');
    const read = () => c.sliceState(ref).value as SliceInfo;
    const added = await c.oblique({ volume: 'ribosome.mrc' } as never);
    expectOk(added);
    const slice = (added as { value: { slice: string } }).value.slice;
    // through the middle, tilted; no grid slice
    expect(read().slices).toEqual([]);
    expect(read().obliques).toHaveLength(1);
    expect(read().obliques[0]).toMatchObject({ ref: slice, contrast: 3, visible: true });
    expect(read().obliques[0].tilt.map(Math.round)).toEqual([30, 30]);
    // placed by its numbers, in the volume's frame
    expectOk(await c.oblique({ volume: 'ribosome.mrc', slice, x: 2, z: -3, ex: 10, ey: -20 } as never));
    const o = read().obliques[0];
    expect(o.position.map((x) => Math.round(x * 1000) / 1000)).toEqual([2, 0, -3]);
    expect(o.tilt.map((x) => Math.round(x * 1000) / 1000)).toEqual([10, -20]);
    // the x slice is its own, made beside it: the oblique one is not taken for it
    expectOk(await c.slice({ volume: 'ribosome.mrc', axis: 'x' } as never));
    expect(read().slices.map((x) => x.axis)).toEqual(['x']);
    expect(read().obliques.map((x) => x.ref)).toEqual([slice]);
    expect(await c.oblique({ volume: 'ribosome.mrc', slice: 'nope' } as never)).toMatchObject({
      ok: false,
      code: 'not-found',
    });
    // the volume moved (a turn and a shift, as the stage's move does it: its grid, and the plane with it): the slice's
    // numbers stay, in the volume's frame
    const m = Mat4.mul(Mat4(), Mat4.fromTranslation(Mat4(), Vec3.create(50, 0, 0)), Mat4.rotZ90);
    const vol = v.plugin.managers.volume.hierarchy.current.volumes.find((x) => x.cell.transform.ref === ref)!;
    const plane = (v.plugin.state.data.cells.get(slice)!.transform.params as any).type.params.plane;
    const b = v.plugin.state.data.build();
    b.to(vol.cell).insert(VolumeTransform, { transform: { name: 'matrix', params: { data: m, transpose: false } } });
    b.to(slice).update((p: any) => ({
      ...p,
      type: {
        ...p.type,
        params: {
          ...p.type.params,
          plane: {
            point: Vec3.transformMat4(Vec3(), plane.point, m),
            normal: Vec3.transformDirection(Vec3(), plane.normal, m),
          },
        },
      },
    }));
    await b.commit();
    const kept = read().obliques[0];
    expect(kept.position.map((x) => Math.round(x * 1000) / 1000)).toEqual([2, 0, -3]);
    expect(kept.tilt.map((x) => Math.round(x * 1000) / 1000)).toEqual([10, -20]);
    // placed again by a number: in the moved frame
    expectOk(await c.oblique({ volume: 'ribosome.mrc', slice, x: 4 } as never));
    expect(read().obliques[0].position.map((x) => Math.round(x * 1000) / 1000)).toEqual([4, 0, -3]);
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

  it('shows the objects while any target is decorated, hidden when none is (a target representation reused)', async () => {
    const v = await viewer();
    const c = v.api.cryoet!;
    const crn = new File([readFileSync(new URL('../../../../../data/examples/1crn.cif', import.meta.url))], '1crn.cif');
    expectOk(await v.api.load.files({ files: [crn] }));
    const list = () => v.plugin.managers.particles.hierarchy.current.lists[0];
    const shown = () =>
      list()
        .representations.filter((r) => !r.cell.state.isHidden)
        .map((r) => (r.cell.transform.params as any).type.name)
        .sort();
    expect(shown()).toEqual(['spacefill']);
    expectOk(await c.decorate({ with: 'object', object: '1crn' } as never));
    expect(shown()).toEqual(['spacefill', 'target']);
    // back to spheres: the (now empty) objects hidden
    expectOk(await c.decorate({ with: 'none' } as never));
    expect(shown()).toEqual(['spacefill']);
    // decorated again: the same target representation shown again, not another
    expectOk(await c.decorate({ with: 'object', object: '1crn' } as never));
    expect(shown()).toEqual(['spacefill', 'target']);
    expect(list().representations.filter((r) => (r.cell.transform.params as any).type.name === 'target')).toHaveLength(
      1,
    );
  });
});

function volumeRef(v: PrismViewer, label: string) {
  return v.plugin.managers.volume.hierarchy.current.volumes.find((x) => x.cell.obj?.label === label)!.cell.transform
    .ref;
}
