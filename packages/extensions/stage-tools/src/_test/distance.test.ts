/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Interval, OrderedSet } from '@molstar/core/data/int';
import { Mat4, Tensor, Vec3 } from '@molstar/core/math/linear-algebra';
import { CCP4Writer } from '@molstar/model/formats/writer/ccp4/ccp4';
import { type Grid, Volume } from '@molstar/model/model/volume';
import { clearFontAtlasCache, setCanvasModule } from '@molstar/graphics/geo/geometry/text/font-atlas';
import { Loci } from '@molstar/model/model/loci';
import { Particle } from '@molstar/model/model/particles/particle-list';
import { StructureElement, StructureProperties, StructureSelection } from '@molstar/model/model/structure';
import { Script } from '@molstar/model/script/script';
import { ParticleListWithTargets } from '@molstar/plugin/state/transforms/particles/ops';
import { ParticlesRepresentation3D } from '@molstar/plugin/state/transforms/particles/representation';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { pointLoci, StageDistance } from '../distance.js';
import { StageToolsExtension } from '../prism-viewer.js';

// `stage.distance` on a headless viewer: 1CRN (crambin) from the repository's example data, and particle lists made
// in memory (apps/prism-me/_spec/ui.md §7).

// A distance's text is drawn into a font atlas, which Node has no canvas for: a stand-in context that draws nothing
// (as Prism's measurements test), unset after this file (the module is shared by the worker's files).
beforeAll(() => {
  const context = {
    measureText: () => ({ width: 8 }),
    clearRect() {},
    fillText() {},
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  };
  setCanvasModule({ createCanvas: () => ({ getContext: () => context }) });
});
afterAll(() => {
  setCanvasModule(undefined);
  clearFontAtlasCache();
});

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
}

const star = (rows: string) => `data_particles\n\nloop_\n_rlnCoordinateX\n_rlnCoordinateY\n_rlnCoordinateZ\n${rows}`;

async function viewer() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), StageToolsExtension] },
  });
  viewers.push(v);
  const crn = new File([readFileSync(new URL('../../../../../data/examples/1crn.cif', import.meta.url))], '1crn.cif');
  expectOk(await v.api.load.files({ files: [crn] }));
  return v;
}

/** One atom of 1CRN as loci (residue `seq`, atom `name`), and where it is */
function atom(v: PrismViewer, seq: number, name: string) {
  const structure = v.plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data;
  const selection = Script.getStructureSelection(
    (Q) =>
      Q.struct.generator.atomGroups({
        'residue-test': Q.core.rel.eq([Q.struct.atomProperty.macromolecular.label_seq_id(), seq]),
        'atom-test': Q.core.rel.eq([Q.struct.atomProperty.macromolecular.label_atom_id(), name]),
      }),
    structure,
  );
  const loci = StructureSelection.toLociWithSourceUnits(selection);
  const e = loci.elements[0];
  const loc = StructureElement.Location.create(structure, e.unit, e.unit.elements[OrderedSet.getAt(e.indices, 0)]);
  const at = Vec3.create(
    StructureProperties.atom.x(loc),
    StructureProperties.atom.y(loc),
    StructureProperties.atom.z(loc),
  );
  return { loci, at };
}

const distances = (v: PrismViewer) =>
  [...v.plugin.state.data.cells.values()].filter((c) => c.transform.transformer === StageDistance);

describe('stage.distance', () => {
  it('measures two atoms (Å, as their positions say), drawn by one cell, listed under its first pick', async () => {
    const v = await viewer();
    const s = v.api.stage!;
    const a = atom(v, 1, 'CA');
    const b = atom(v, 10, 'CA');
    const r = await s.distance({ a: { loci: a.loci }, b: { loci: b.loci }, node: 'e:x:1', nodeB: 'e:x:2' } as never);
    expectOk(r);
    expect(distances(v)).toHaveLength(1);
    const [d] = s.distancesState().value;
    expect(d.distance).toBeCloseTo(Vec3.distance(a.at, b.at), 3);
    expect(d.label).toBe(`${Vec3.distance(a.at, b.at).toFixed(2)} Å`);
    expect(d.node).toBe('e:x:1');
    expect(d.a.key).toBe('e:x:1');
    expect(d.b.key).toBe('e:x:2');
    expect(d.a.label).toBe('THR 1 CA (A)');
    // the same again: already so, no second one
    const again = await s.distance({
      a: { loci: a.loci },
      b: { loci: b.loci },
      node: 'e:x:1',
      nodeB: 'e:x:2',
    } as never);
    expect(again.ok && again.unchanged).toBe(true);
    expect(distances(v)).toHaveLength(1);
    // the same two points the other way round, from the other row: the same distance
    const swapped = await s.distance({
      a: { loci: b.loci },
      b: { loci: a.loci },
      node: 'e:x:2',
      nodeB: 'e:x:1',
    } as never);
    expect(swapped.ok && swapped.unchanged).toBe(true);
    expect(distances(v)).toHaveLength(1);
  });

  it("measures two particles by '<list ref>#<index>' (the agent's form), under the list when no row is given", async () => {
    const v = await viewer();
    const s = v.api.stage!;
    expectOk(await v.api.load.files({ files: [new File([star('10 0 0\n13 4 0\n')], 'p.star')] }));
    const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    expectOk(await s.distance({ a: `${list}#0`, b: `${list}#1` } as never));
    const [d] = s.distancesState().value;
    expect(d.distance).toBeCloseTo(5, 5);
    expect(d.node).toBe(`o:${list}`);
    // an index past the list's end is said
    const bad = await s.distance({ a: `${list}#0`, b: `${list}#7` } as never);
    expect(bad.ok).toBe(false);
  });

  it("names a residue point as an atom's: its residue, author number and chain", async () => {
    const v = await viewer();
    const s = v.api.stage!;
    const r1 = Loci.normalize(atom(v, 1, 'CA').loci, 'residue');
    const r10 = Loci.normalize(atom(v, 10, 'CA').loci, 'residue');
    expectOk(await s.distance({ a: { loci: r1 }, b: { loci: r10 } } as never));
    const [d] = s.distancesState().value;
    expect([d.a.label, d.b.label]).toEqual(['THR 1 (A)', 'ARG 10 (A)']);
  });

  it('measures from all of a multi-particle pick (a fiber): its middle, not its first bead', async () => {
    const v = await viewer();
    const s = v.api.stage!;
    expectOk(await v.api.load.files({ files: [new File([star('0 0 0\n10 0 0\n5 10 0\n')], 'p.star')] }));
    const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell;
    const both = Particle.Loci(list.obj!.data, OrderedSet.ofSortedArray([0, 1]));
    expectOk(await s.distance({ a: { loci: both }, b: `${list.transform.ref}#2` } as never));
    // from the middle of the two (Mol*'s sphere around them, about it), not from the first (11.18 Å)
    expect(s.distancesState().value[0].distance).toBeCloseTo(10, 1);
    expect(s.distancesState().value[0].a.label).toMatch(/2 particles/);
  });

  it('sizes its text and line to what it measures, times its options; each change one step, undone step by step', async () => {
    const v = await viewer();
    const s = v.api.stage!;
    const a = atom(v, 1, 'CA');
    const b = atom(v, 10, 'CA');
    expectOk(await s.distance({ a: { loci: a.loci }, b: { loci: b.loci } } as never));
    const props = () => distances(v)[0].obj!.data.repr.props as { textSize: number; linesSize: number; alpha: number };
    const atoms = { ...props() };
    // particles decorated by crambin (its radius about 15 Å): a larger text and line than between two atoms
    expectOk(await v.api.load.files({ files: [new File([star('0 0 0\n100 0 0\n')], 'p.star')] }));
    const listRef = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    const crn = v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
    await v.plugin
      .build()
      .to(listRef)
      .apply(ParticleListWithTargets, { targets: [{ targetId: 0, source: { name: 'ref', params: { ref: crn } } }] })
      .apply(ParticlesRepresentation3D, { type: { name: 'target', params: {} } } as never)
      .commit();
    const drawn = v.plugin.managers.particles.hierarchy.current.lists[0].representations.find(
      (r) => (r.cell.transform.params as { type?: { name?: string } }).type?.name === 'target',
    )!.cell.obj!.data.sourceData;
    const p0 = Particle.Loci(drawn, OrderedSet.ofSingleton(0));
    const p1 = Particle.Loci(drawn, OrderedSet.ofSingleton(1));
    expectOk(await s.distance({ a: { loci: p0 }, b: { loci: p1 } } as never));
    const particles = distances(v)[1].obj!.data.repr.props as { textSize: number; linesSize: number };
    expect(s.distancesState().value[1].distance).toBeCloseTo(100, 5);
    expect(particles.linesSize).toBeGreaterThan(atoms.linesSize * 5);
    expect(particles.textSize).toBeGreaterThan(atoms.textSize * 5);
    // its options: on its representation, in one step
    const ref = distances(v)[0].transform.ref;
    expectOk(await s.editDistance({ distance: ref, textSize: 2, lineWidth: 3, opacity: 0.5 } as never));
    expect(props().textSize).toBeCloseTo(atoms.textSize * 2, 6);
    expect(props().linesSize).toBeCloseTo(atoms.linesSize * 3, 6);
    expect(props().alpha).toBe(0.5);
    expectOk(await v.api.run('history.undo', {}));
    expect(props().alpha).toBe(1);
    // hidden: one step
    expectOk(await s.editDistance({ distance: ref, visible: false } as never));
    expect(s.distancesState().value[0].visible).toBe(false);
    // undone step by step: the hide (shown again, both still there), then the second distance's making
    expectOk(await v.api.run('history.undo', {}));
    expect(s.distancesState().value[0].visible).toBe(true);
    expect(distances(v)).toHaveLength(2);
    expectOk(await v.api.run('history.undo', {}));
    expect(distances(v)).toHaveLength(1);
    expect(distances(v)[0].transform.ref).toBe(ref);
    // a text size and a line width past the sliders' old 10: up to 100, for a volume's scale
    expectOk(await s.editDistance({ distance: ref, textSize: 50, lineWidth: 50 } as never));
    expect(props().textSize).toBeCloseTo(atoms.textSize * 50, 6);
    expect(props().linesSize).toBeCloseTo(atoms.linesSize * 50, 6);
  });

  it('goes with either of its objects, in the same step (its dependency); that step undone, it is back', async () => {
    const v = await viewer();
    const s = v.api.stage!;
    expectOk(await v.api.load.files({ files: [new File([star('10 0 0\n13 4 0\n')], 'p.star')] }));
    const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    const a = atom(v, 1, 'CA');
    expectOk(await s.distance({ a: { loci: a.loci }, b: `${list}#1` } as never));
    expect(distances(v)).toHaveLength(1);
    expectOk(await v.api.run('particles.remove', { particles: list }));
    expect(distances(v)).toHaveLength(0);
    expectOk(await v.api.run('history.undo', {}));
    expect(distances(v)).toHaveLength(1);
    const structure = v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
    expectOk(await v.api.run('structure.remove', { structure }));
    expect(distances(v)).toHaveLength(0);
  });
});

// Volume points (apps/prism-me/_spec/ui.md §7, Ludovic, 2026-10-25): a voxel picked, or the whole volume at a coarse
// granularity. A 6×6×6 map of 1 Å voxels from the origin, made in memory: voxel (i, j, k) is at (i, j, k) Å.
describe('stage.distance, volume points', () => {
  const N = 6;
  async function withMap(v: PrismViewer, name = 'map.mrc') {
    const data = new Float32Array(N * N * N).map((_, i) => i % 5);
    const grid: Grid = {
      transform: { kind: 'matrix', matrix: Mat4.identity() },
      cells: Tensor.create(Tensor.Space([N, N, N], [0, 1, 2], Float32Array), Tensor.Data1(data)),
      stats: { min: 0, max: 4, mean: 2, sigma: 1 },
    };
    expectOk(await v.api.load.files({ files: [new File([CCP4Writer.writeMrc(grid, data)], name)] }));
    const volumes = v.plugin.managers.volume.hierarchy.current.volumes;
    return volumes[volumes.length - 1];
  }
  /** The voxel (i, j, k) of a loaded volume, as a pick gives it */
  const voxel = (volume: Volume, i: number, j: number, k: number) =>
    Volume.Cell.Loci(volume, [
      {
        indices: Interval.ofSingleton(volume.grid.cells.space.dataOffset(i, j, k) as Volume.CellIndex),
        instances: Interval.ofSingleton(0 as Volume.InstanceIndex),
      },
    ]);

  it('measures a voxel to an atom, to a particle, and to a voxel of another volume; one undo each', async () => {
    const v = await viewer();
    const s = v.api.stage!;
    // a list of two particles: a pick of all of a list's particles meets a Mol* bug (Particle.getBoundingSphere copies
    // its sphere the wrong way round, zeroing the list's cached boundary)
    expectOk(await v.api.load.files({ files: [new File([star('10 0 0\n30 0 0\n')], 'p.star')] }));
    const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    const map = await withMap(v);
    const volume = map.cell.obj!.data;
    // to an atom: 1CRN's CA 1, from the voxel (1, 2, 3)
    const a = atom(v, 1, 'CA');
    expectOk(await s.distance({ a: { loci: voxel(volume, 1, 2, 3) }, b: { loci: a.loci } } as never));
    expect(s.distancesState().value[0].distance).toBeCloseTo(Vec3.distance(Vec3.create(1, 2, 3), a.at), 4);
    expect(s.distancesState().value[0].a.label).toBe('map.mrc voxel (1, 2, 3)');
    expect(s.distancesState().value[0].node).toBe(`o:${map.cell.transform.ref}`);
    // to a particle at (10, 0, 0), from the voxel (2, 0, 0)
    expectOk(await s.distance({ a: { loci: voxel(volume, 2, 0, 0) }, b: `${list}#0` } as never));
    expect(s.distancesState().value[1].distance).toBeCloseTo(8, 4);
    // to a voxel of a second volume: (0, 0, 0) to (3, 4, 0)
    const other = (await withMap(v, 'other.mrc')).cell.obj!.data;
    expectOk(await s.distance({ a: { loci: voxel(volume, 0, 0, 0) }, b: { loci: voxel(other, 3, 4, 0) } } as never));
    expect(s.distancesState().value[2].distance).toBeCloseTo(5, 4);
    // one step each: the third, then (past the second map's load) the second, then the first
    expectOk(await v.api.run('history.undo', {}));
    expect(distances(v)).toHaveLength(2);
    expectOk(await v.api.run('history.undo', {}));
    expectOk(await v.api.run('history.undo', {}));
    expect(distances(v)).toHaveLength(1);
    expectOk(await v.api.run('history.undo', {}));
    expect(distances(v)).toHaveLength(0);
  });

  it("measures from the whole volume's center at a coarse granularity", async () => {
    const v = await viewer();
    const s = v.api.stage!;
    const volume = (await withMap(v)).cell.obj!.data;
    const whole = Loci.normalize(voxel(volume, 0, 0, 0), 'structure');
    expect(Volume.isLoci(whole)).toBe(true);
    const a = atom(v, 1, 'CA');
    expectOk(await s.distance({ a: { loci: whole }, b: { loci: a.loci } } as never));
    // the grid's center: its box from 0 to N Å on each axis (Mol*'s grid sphere), so N / 2
    const c = N / 2;
    expect(s.distancesState().value[0].distance).toBeCloseTo(Vec3.distance(Vec3.create(c, c, c), a.at), 1);
    expect(s.distancesState().value[0].a.label).toBe('map.mrc (center)');
  });

  it('measures a voxel of a moved volume (its representation draws the moved one), at its moved place', async () => {
    const v = await viewer();
    const s = v.api.stage!;
    const map = await withMap(v);
    const up = Array.from(Mat4.fromTranslation(Mat4(), Vec3.create(0, 0, 10)));
    expectOk(await s.move({ target: map.cell.transform.ref, matrix: up } as never));
    const drawn = v.plugin.managers.volume.hierarchy.current.volumes[0].representations[0].cell.obj!.data
      .sourceData as Volume;
    const a = atom(v, 1, 'CA');
    expectOk(await s.distance({ a: { loci: voxel(drawn, 0, 0, 0) }, b: { loci: a.loci } } as never));
    expect(s.distancesState().value[0].distance).toBeCloseTo(Vec3.distance(Vec3.create(0, 0, 10), a.at), 3);
    expect(s.distancesState().value[0].node).toBe(`o:${map.cell.transform.ref}`);
  });

  it("sizes a voxel point by the grid's spacing (Mol*'s), whatever the grid's shape", async () => {
    const v = await viewer();
    // a slab: 16×16×2 voxels of 10 Å
    const data = new Float32Array(16 * 16 * 2).map((_, i) => i % 5);
    const grid: Grid = {
      transform: { kind: 'matrix', matrix: Mat4.fromScaling(Mat4(), Vec3.create(10, 10, 10)) },
      cells: Tensor.create(Tensor.Space([16, 16, 2], [0, 1, 2], Float32Array), Tensor.Data1(data)),
      stats: { min: 0, max: 4, mean: 2, sigma: 1 },
    };
    expectOk(await v.api.load.files({ files: [new File([CCP4Writer.writeMrc(grid, data)], 'slab.mrc')] }));
    const map = v.plugin.managers.volume.hierarchy.current.volumes[0];
    const point = { ref: map.cell.transform.ref, label: '', key: '', volume: true as const, voxels: [0], instance: 0 };
    expect(pointLoci(v.plugin, point)?.radius).toBeCloseTo(10, 4);
  });

  it('goes with its volume, in the same step', async () => {
    const v = await viewer();
    const s = v.api.stage!;
    const map = await withMap(v);
    expectOk(
      await s.distance({
        a: { loci: voxel(map.cell.obj!.data, 1, 1, 1) },
        b: { loci: atom(v, 1, 'CA').loci },
      } as never),
    );
    expect(distances(v)).toHaveLength(1);
    expectOk(await v.api.run('volume.remove', { volume: map.cell.transform.ref }));
    expect(distances(v)).toHaveLength(0);
  });
});
