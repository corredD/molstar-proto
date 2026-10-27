/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { Mat4, Tensor } from '@molstar/core/math/linear-algebra';
import { StateSelection } from '@molstar/core/state';
import { ParticleRepresentation3DLayers } from '@molstar/plugin/state/transforms/particles/layers';
import { CCP4Writer } from '@molstar/model/formats/writer/ccp4/ccp4';
import type { Grid } from '@molstar/model/model/volume';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import type { DecorationsInfo } from '@molstar/cryoet-extension/operations';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { MesoscaleExplorerExtensions } from '../../extensions.js';
import { withTomogramSlices } from '../../tomograms.js';
import { ancestorKeys, rowsOf, stableRows, toggleVisible } from '../rows.js';
import {
  addLabel,
  clipItems,
  clippable,
  colorItems,
  nodeMenuItems,
  removable,
  removeObject,
  showTheme,
} from '../menu.js';
import { OrderedSet } from '@molstar/core/data/int';
import { Particle } from '@molstar/model/model/particles/particle-list';
import { Shape, ShapeGroup } from '@molstar/model/model/shape';

// The `explorer` area on a headless viewer: 1CRN (crambin, with its unit cell), a RELION list and an OBJ mesh.

const star = `data_particles

loop_
_rlnCoordinateX
_rlnCoordinateY
_rlnCoordinateZ
10 0 0
20 0 0
30 0 0
`;
const obj = 'v 0 0 0\nv 10 0 0\nv 0 10 0\nv 0 0 10\nf 1 2 3\nf 1 2 4\nf 1 3 4\nf 2 3 4\n';

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
    spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
  });
  viewers.push(v);
  const crn = new File([readFileSync(new URL('../../../../../data/examples/1crn.cif', import.meta.url))], '1crn.cif');
  for (const f of [crn, new File([star], 'membrane.star'), new File([obj], 'membrane.obj')]) {
    expectOk(await v.api.load.files({ files: [f] }));
  }
  return v;
}

describe('explorer', () => {
  it('lists the scene by category, a model shape (the unit cell) not as a mesh, a list by its file', async () => {
    const v = await viewer();
    // 1CRN's unit cell is a shape of its model: there is one besides the mesh's
    const shapes = Array.from(v.plugin.state.data.cells.values()).filter((c) => c.obj?.type.name === 'Shape 3D');
    expect(shapes).toHaveLength(2);
    const objects = v.api.explorer!.objectsState().value;
    expect(objects.map((o) => [o.category, o.kind, o.label])).toEqual([
      ['structures', 'structure', '1CRN'],
      ['particles', 'list', 'membrane.star'],
      ['meshes', 'mesh', 'membrane.obj'],
    ]);
    expect(objects[0].entities).toEqual([{ id: '1', label: 'CRAMBIN', chains: ['A'] }]);
    expect(objects[1].count).toBe('3 particles');
  });

  it('removes loaded objects from the scene, with their files and labels; not their parts', async () => {
    const v = await viewer();
    const area = v.api.explorer!;
    const [crn, list, mesh] = area.objectsState().value;
    expectOk(await v.api.stage!.label({ text: 'here', target: list.ref, x: 0, y: 0, z: 0 } as never));
    expect(removable('entity', { ref: crn.ref, entity: '1' })).toBe(false);
    expect(
      nodeMenuItems(v.api, area, { key: '', label: '1CRN', kind: 'structure', node: { ref: crn.ref } }).map(
        (i) => i.id,
      ),
    ).toContain('remove');
    await removeObject(v.api, area, 'particle list', list.ref);
    await removeObject(v.api, area, 'mesh', mesh.ref);
    // its own step: undone at once (the list's was before it)
    expectOk(await v.api.run('history.undo', {}));
    expect(area.objectsState().value.map((o) => o.label)).toEqual(['1CRN', 'membrane.obj']);
    await removeObject(v.api, area, 'mesh', mesh.ref);
    expect(area.objectsState().value.map((o) => o.label)).toEqual(['1CRN']);
    expect(v.api.stage!.labelsState().value).toEqual([]);
    await removeObject(v.api, area, 'structure', crn.ref);
    expect(area.objectsState().value).toEqual([]);
    // nothing of them is left in the state (their files went too)
    const left = v.plugin.state.data.tree.children
      .get('-=root=-')
      .toArray()
      .map((r) => v.plugin.state.data.cells.get(r)!.obj?.label);
    expect(left).toEqual([]);
  });

  it('removes an object loaded from an address (its entry a download), as one dropped', async () => {
    const v = await viewer();
    const area = v.api.explorer!;
    const url = `data:text/plain;base64,${Buffer.from(star).toString('base64')}`;
    expectOk(await v.api.run('load.url', { url, format: 'relion_star_particles' }));
    const loaded = area.objectsState().value.filter((o) => o.kind === 'list');
    expect(loaded).toHaveLength(2);
    const fromUrl = loaded.find((o) => {
      const entry = v.plugin.state.data.cells.get(area.entryOf(o.ref))!;
      return entry.transform.transformer.id.endsWith('download');
    })!;
    expect(fromUrl).toBeDefined();
    await removeObject(v.api, area, 'particle list', fromUrl.ref);
    expect(area.objectsState().value.filter((o) => o.kind === 'list')).toHaveLength(1);
  });

  it('lists a Simularium file once (a model: its box is not a mesh), and decorates one of its agents', async () => {
    const v = await viewer();
    const area = v.api.explorer!;
    const sim = new File(
      [readFileSync(new URL('../../../../../data/examples/particles/small.simularium', import.meta.url))],
      'small.simularium',
    );
    expectOk(await v.api.load.files({ files: [sim] }));
    const mine = area.objectsState().value.filter((o) => o.label === 'small.simularium');
    expect(mine.map((o) => o.kind)).toEqual(['model']);
    expectOk(
      await v.api.run('cryoet.decorate', { particles: mine[0].ref, with: 'object', object: '1crn', targets: '0' }),
    );
    const d = await v.api.run('cryoet.decorations', { particles: mine[0].ref });
    expectOk(d);
    expect((d.value as DecorationsInfo).targets[0].with).toBe('1CRN');
  });

  it('highlights and focuses a structure entity, a list and a mesh', async () => {
    const v = await viewer();
    const area = v.api.explorer!;
    const [crn, list, mesh] = area.objectsState().value;
    for (const node of [
      { ref: crn.ref, entity: '1' },
      { ref: crn.ref, entity: '1', chain: 'A' },
      { ref: list.ref },
      { ref: mesh.ref },
    ]) {
      expect(() => area.highlight(node)).not.toThrow();
      expect(() => area.focus(node)).not.toThrow();
    }
    area.highlight(undefined);
  });

  it('frames a decorated part with room for what is drawn on it (a particle is a point, its object is not)', async () => {
    const v = await viewer();
    const area = v.api.explorer!;
    const list = area.objectsState().value.find((o) => o.kind === 'list')!;
    const target = { ref: list.ref, particles: { targets: [0] } };
    const bare = area.focusSphereOf(target)!;
    expectOk(await v.api.run('cryoet.decorate', { particles: list.ref, with: 'object', object: '1crn' }));
    const crn = v.plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data.boundary.sphere.radius;
    const decorated = area.focusSphereOf(target)!;
    // the points' sphere grown by the crambin drawn on each
    expect(decorated.radius).toBeCloseTo(bare.radius + crn, 3);
  });

  it("hides a list's target by its targets' layer, and shows it again", async () => {
    const v = await viewer();
    const list = v.api.explorer!.objectsState().value.find((o) => o.kind === 'list')!;
    const row = {
      key: `t:${list.ref}:0`,
      depth: 2,
      label: 'Target 0',
      kind: 'target',
      hasChildren: false,
      node: { ref: list.ref, particles: { targets: [0] } },
    };
    const layers = () =>
      v.plugin.state.data
        .select(StateSelection.Generators.ofTransformer(ParticleRepresentation3DLayers))
        .map((c) => (c.transform.params as any).layers);
    expectOk((await toggleVisible(v.api, { ...row, visible: true }))!);
    expect(layers()).toMatchObject([[{ entities: [], targets: [0], visible: false }]]);
    expectOk((await toggleVisible(v.api, { ...row, visible: false }))!);
    expect(layers()).toEqual([]);
  });

  it("flips each object's eye, and the watched read follows (a visibility change is a cell's state)", async () => {
    const v = await viewer();
    const state = v.api.explorer!.objectsState();
    const seen: boolean[][] = [];
    const sub = state.subscribe((o) => seen.push(o.map((x) => x.visible)));
    const rows = () => rowsOf(state.value, new Map(), new Set(['c:structures', 'c:particles', 'c:meshes']), '');
    for (const kind of ['structure', 'particle list', 'mesh']) {
      const row = rows().find((r) => r.kind === kind)!;
      expect(row.visible).toBe(true);
      const r = await toggleVisible(v.api, row);
      expectOk(r!);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(rows().find((x) => x.key === row.key)!.visible).toBe(false);
      expectOk((await toggleVisible(v.api, { ...row, visible: false }))!);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    sub.unsubscribe();
    expect(seen.some((s) => s[0] === false)).toBe(true);
    expect(seen.some((s) => s[1] === false)).toBe(true);
    expect(seen.some((s) => s[2] === false)).toBe(true);
    expect(seen.at(-1)).toEqual([true, true, true]);
  });

  it("paints a structure entity by its label ids, and reads back each node's look", async () => {
    const v = await viewer();
    const cbs = new File(
      [readFileSync(new URL('../../../../../data/examples/1cbs_updated.cif', import.meta.url))],
      '1cbs.cif',
    );
    expectOk(await v.api.load.files({ files: [cbs] }));
    const area = v.api.explorer!;
    const ref = area.objectsState().value.find((o) => o.label === '1CBS')!.ref;
    // the retinoic acid: entity 2, label chain B (its author chain is A, the protein's)
    const rea = { ref, entity: '2' };
    const look = (node: object) => area.structureLookState(node as never).value;
    expectOk(
      await v.api.run('representation.color', { target: { loci: area.loci(rea) }, color: '#ff0000', structure: ref }),
    );
    expectOk(
      await v.api.run('representation.transparency', { target: { loci: area.loci(rea) }, alpha: 0.4, structure: ref }),
    );
    expectOk(
      await v.api.run('representation.emissive', { target: { loci: area.loci(rea) }, strength: 0.7, structure: ref }),
    );
    expect(look(rea)).toEqual({ color: 0xff0000, transparency: 0.4, emissive: 0.7 });
    expect(look({ ref, entity: '2', chain: 'B' })).toEqual({ color: 0xff0000, transparency: 0.4, emissive: 0.7 });
    // the protein is untouched, and the whole structure is not all red
    expect(look({ ref, entity: '1' })).toEqual({ transparency: 0, emissive: 0 });
    expect(look({ ref })).toEqual({ transparency: 0, emissive: 0 });
  });

  it("lists a particle list's representations, gives their form, and shows or hides one", async () => {
    const v = await viewer();
    const area = v.api.explorer!;
    const list = area.objectsState().value.find((o) => o.kind === 'list')!;
    const [r] = area.representationsState(list.ref).value;
    expect(r).toMatchObject({ type: 'spacefill', visible: true });
    const form = area.representationForm(r.ref)!;
    expect(Object.keys(form.params)).toEqual(expect.arrayContaining(['type', 'colorTheme', 'sizeTheme']));
    expect((form.values.type as { name: string }).name).toBe('spacefill');
    expectOk(await v.api.run('explorer.representationVisibility', { node: r.ref, visible: false }));
    expect(area.representationsState(list.ref).value[0].visible).toBe(false);
    expect(await v.api.run('explorer.representationVisibility', { node: r.ref, visible: false })).toMatchObject({
      ok: true,
      unchanged: true,
    });
    expect(await v.api.run('explorer.representationVisibility', { node: 'nope', visible: true })).toMatchObject({
      ok: false,
    });
  });

  it("lists a volume's isosurface and slice as rows of their kind, with their representations", async () => {
    const v = await viewer();
    const n = 10;
    const space = Tensor.Space([n, n, n], [2, 1, 0], Float32Array);
    const data = new Float32Array(n * n * n).map((_, i) => i % 7);
    const grid: Grid = {
      transform: { kind: 'matrix', matrix: Mat4.identity() },
      cells: Tensor.create(space, Tensor.Data1(data)),
      stats: { min: 0, max: 6, mean: 3, sigma: 2 },
    };
    expectOk(await v.api.load.files({ files: [new File([CCP4Writer.writeMrc(grid, data)], 'tomo.mrc')] }));
    expectOk(await v.api.run('cryoet.slice', {}));
    const area = v.api.explorer!;
    const volume = area.objectsState().value.find((o) => o.kind === 'volume')!;
    const types = area.representationsState(volume.ref).value.map((r) => r.type);
    expect(types).toEqual(expect.arrayContaining(['isosurface', 'slice']));
    const rows = rowsOf(area.objectsState().value, new Map(), new Set(['c:volumes', `o:${volume.ref}`]), '');
    const reprRows = rows.filter((r) => r.depth === 2);
    expect(reprRows.map((r) => r.kind).sort()).toEqual(['isosurface', 'slice']);
    for (const r of reprRows) expect(area.representationForm(r.representation!)).toBeDefined();
  });

  it("opens a dropped MRC as its three slices, no isosurface (the explorer's visuals), each its own row", async () => {
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: {
        ...base,
        extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions],
        finalize: (spec) => withTomogramSlices(base.finalize ? base.finalize(spec) : spec),
      },
    });
    viewers.push(v);
    const n = 8;
    const space = Tensor.Space([n, n, n], [2, 1, 0], Float32Array);
    const data = new Float32Array(n * n * n).map((_, i) => i % 5);
    const grid: Grid = {
      transform: { kind: 'matrix', matrix: Mat4.identity() },
      cells: Tensor.create(space, Tensor.Data1(data)),
      stats: { min: 0, max: 4, mean: 2, sigma: 1 },
    };
    expectOk(await v.api.load.files({ files: [new File([CCP4Writer.writeMrc(grid, data)], 'tomo.rec')] }));
    const area = v.api.explorer!;
    const volume = area.objectsState().value.find((o) => o.kind === 'volume')!;
    expect(volume.representations!.map((r) => [r.type, r.label])).toEqual([
      ['slice', 'Slice X'],
      ['slice', 'Slice Y'],
      ['slice', 'Slice Z'],
    ]);
  });

  it('maps a 3D pick to its row at the selection granularity, and its menu', async () => {
    const v = await viewer();
    const area = v.api.explorer!;
    const [crn, list] = area.objectsState().value;
    const setGranularity = (granularity: string) =>
      v.plugin.managers.interactivity.setProps({ granularity: granularity as never });
    const atoms = area.loci({ ref: crn.ref, entity: '1' });
    setGranularity('chain');
    // one chain: its entity's row
    expect(area.pickedOf(atoms)).toMatchObject({ key: `e:${crn.ref}:1`, kind: 'entity', label: 'CRAMBIN' });
    setGranularity('structure');
    expect(area.pickedOf(atoms)).toMatchObject({ key: `o:${crn.ref}`, kind: 'structure', label: '1CRN' });
    setGranularity('chain');
    const data = v.plugin.managers.particles.hierarchy.current.lists[0].cell.obj!.data;
    const particle = Particle.Loci(data, OrderedSet.ofSingleton(1 as never));
    expect(area.pickedOf(particle)).toMatchObject({ key: `t:${list.ref}:0`, kind: 'target', label: 'Target 0' });
    expect(area.pickedOf({ kind: 'empty-loci' })).toBeUndefined();
    // the way to a row: its object, its category
    expect(ancestorKeys(area.objectsState().value, new Map(), `e:${crn.ref}:1`)).toEqual([
      `o:${crn.ref}`,
      'c:structures',
    ]);
    // the menu: focus, and hide where it hides
    const picked = area.pickedOf(particle)!;
    // a target is a part: its Move greyed (a part's move: not yet)
    const items = nodeMenuItems(v.api, area, picked);
    expect(items.map((i) => i.id)).toEqual(['focus', 'move', 'hide', 'label']);
    expect(items[1].disabled).toBeTruthy();
    expect(nodeMenuItems(v.api, area, area.pickedOf(atoms)).map((i) => i.id)).toEqual(['focus', 'move', 'label']);
    // a whole structure moves and turns
    setGranularity('structure');
    const whole = nodeMenuItems(v.api, area, area.pickedOf(atoms));
    expect(whole.map((i) => i.id)).toEqual(['focus', 'move', 'hide', 'label', 'remove']);
    expect(whole[1].disabled).toBeUndefined();
    setGranularity('chain');
    expect(nodeMenuItems(v.api, area, undefined).map((i) => i.id)).toEqual(['reset-camera']);
  });

  it('maps a pick on a mesh, in a group or whole, to its row; its menu: color, move, clip, label', async () => {
    const v = await viewer();
    const area = v.api.explorer!;
    const mesh = area.objectsState().value.find((o) => o.kind === 'mesh')!;
    const shape = (v.plugin.state.data.cells.get(mesh.ref)!.obj!.data as any).repr.getAllLoci()[0].shape;
    const row = { key: `o:${mesh.ref}`, kind: 'mesh', label: 'membrane.obj' };
    expect(area.pickedOf(Shape.Loci(shape))).toMatchObject(row);
    expect(area.pickedOf(ShapeGroup.Loci(shape, [{ ids: OrderedSet.ofSingleton(0), instance: 0 }]))).toMatchObject(row);
    const ids = nodeMenuItems(v.api, area, area.pickedOf(Shape.Loci(shape)), { open: () => {} }).map((i) => i.id);
    expect(ids).toEqual(['focus', 'move', 'hide', 'color', 'clip', 'label', 'remove']);
  });

  it("adds several clips to an object and one to a target (Prism's), each listed at its row, and colors a target", async () => {
    const v = await viewer();
    const area = v.api.explorer!;
    const list = area.objectsState().value.find((o) => o.kind === 'list')!;
    const object = { key: `o:${list.ref}`, label: list.label, kind: 'particle list', node: { ref: list.ref } };
    const run = async (items: { id: string; run(): void }[], id: string) => {
      items.find((i) => i.id === id)!.run();
      await new Promise((resolve) => setTimeout(resolve, 300));
    };
    // the whole list: Prism's cuts (its clipping), added one after the other
    await run(clipItems(v.api, area, object), 'clip-plane');
    await run(clipItems(v.api, area, object), 'clip-sphere');
    const ofList = () => v.api.clipping.cuts.value.filter((c) => c.targets.some((t) => area.isUnder(t.ref, list.ref)));
    expect(ofList().map((c) => c.object.type)).toEqual(['plane', 'sphere']);
    expect(ofList().every((c) => !!c.object.tag)).toBe(true);
    // a target: Prism's cut of only its particles, listed at its row (and its object's)
    const target = {
      key: `t:${list.ref}:0`,
      label: 'Target 0',
      kind: 'target',
      node: { ref: list.ref, particles: { targets: [0] } },
    };
    expect(clippable(target.kind, target.node)).toBe(true);
    await run(clipItems(v.api, area, target), 'clip-cube');
    const ofTarget = area.cutsOf(v.api.clipping.cuts.value, target.node);
    expect(ofTarget.map((c) => [c.object.type, c.particles?.selector.targets])).toEqual([['cube', [0]]]);
    expect(ofList().map((c) => c.object.type)).toEqual(['plane', 'sphere', 'cube']);
    // a color, by the brush
    await run(colorItems(v.api, area, target), 'color-tomato');
    expect(v.api.mesoscale!.infoState(list.ref).value!.entities[0].color).toBe(0xff6347);
  });

  it("cuts a structure's entity with Prism's clipping, listed at its row and its object's", async () => {
    const v = await viewer();
    const area = v.api.explorer!;
    const [crn] = area.objectsState().value;
    const entity = { key: `e:${crn.ref}:1`, label: 'CRAMBIN', kind: 'entity', node: { ref: crn.ref, entity: '1' } };
    expect(clippable(entity.kind, entity.node)).toBe(true);
    clipItems(v.api, area, entity)
      .find((i) => i.id === 'clip-sphere')!
      .run();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const cuts = v.api.clipping.cuts.value;
    expect(cuts).toHaveLength(1);
    expect(area.cutsOf(cuts, entity.node).map((c) => c.object.type)).toEqual(['sphere']);
    expect(area.cutsOf(cuts, { ref: crn.ref })).toHaveLength(1);
    // a whole-object cut of another object is not this entity's
    const list = area.objectsState().value.find((o) => o.kind === 'list')!;
    expectOk(await v.api.run('clipping.add', { shape: 'plane', node: `#${list.ref}` }));
    expect(area.cutsOf(v.api.clipping.cuts.value, entity.node)).toHaveLength(1);
  });

  it("names what a list can be drawn as, and gets its spheres back once removed (Prism's add and remove)", async () => {
    const v = await viewer();
    const area = v.api.explorer!;
    const list = area.objectsState().value.find((o) => o.kind === 'list')!;
    const types = area.particleTypes(list.ref);
    expect(types.find((t) => t.type === 'spacefill')?.label).toBe('Spheres');
    const reprs = () => area.representationsState(list.ref).value.map((r) => r.type);
    const spheres = area.representationsState(list.ref).value.find((r) => r.type === 'spacefill')!;
    expectOk(await v.api.run('particles.remove', { node: `#${spheres.ref}` }));
    expect(reprs()).not.toContain('spacefill');
    expectOk(await v.api.run('particles.representation', { type: 'spacefill', particles: list.ref }));
    expect(reprs()).toContain('spacefill');
  });

  it("shows a representation's color theme over the colors set in Look, once asked for (they are cleared)", async () => {
    const v = await viewer();
    const list = v.api.explorer!.objectsState().value.find((o) => o.kind === 'list')!;
    const colors = () => v.api.mesoscale!.infoState(list.ref).value!.entities.map((e) => e.color);
    // nothing set: nothing to clear
    expect(await showTheme(v.api, list.ref)).toBe(false);
    expectOk(await v.api.run('mesoscale.colors', { scheme: 'uniform', color: 'tomato', particles: list.ref }));
    expect(colors()).toEqual([0xff6347]);
    expect(await showTheme(v.api, list.ref)).toBe(true);
    expect(colors()).toEqual([undefined]);
  });

  it('adds a label at a row, listed under it, with its own menu', async () => {
    const v = await viewer();
    const area = v.api.explorer!;
    const [crn] = area.objectsState().value;
    const entity = { key: `e:${crn.ref}:1`, label: 'CRAMBIN', kind: 'entity', node: { ref: crn.ref, entity: '1' } };
    let revealed: { key: string } | undefined;
    await addLabel(v.api, area, entity, (p) => (revealed = p));
    const labels = v.api.stage!.labelsState().value;
    expect(labels).toMatchObject([{ text: 'CRAMBIN', node: entity.key, target: crn.ref }]);
    // sized to the entity (about its radius, ~17.6 Å, halved), in front of its middle by its radius
    expect(labels[0].size).toBe(9);
    expect(labels[0].depth).toBeCloseTo(17.57, 2);
    // at a point clicked on it: the same size, in front of the point by its height
    await addLabel(v.api, area, entity, undefined, [1, 2, 3]);
    expect(v.api.stage!.labelsState().value[1]).toMatchObject({ size: 9, depth: 9, position: [1, 2, 3] });
    expect(revealed?.key).toBe(`l:${labels[0].ref}`);
    // its row: under the entity's
    const rows = rowsOf(
      area.objectsState().value,
      new Map(),
      new Set(['c:structures', `o:${crn.ref}`, entity.key]),
      '',
      labels,
    );
    const i = rows.findIndex((r) => r.key === entity.key);
    expect(rows[i + 1]).toMatchObject({ key: `l:${labels[0].ref}`, kind: 'label', depth: rows[i].depth + 1 });
    expect(ancestorKeys(area.objectsState().value, new Map(), `l:${labels[0].ref}`, labels)).toEqual([
      entity.key,
      `o:${crn.ref}`,
      'c:structures',
    ]);
    const label = { key: `l:${labels[0].ref}`, label: 'CRAMBIN', kind: 'label', node: { ref: labels[0].ref } };
    expect(nodeMenuItems(v.api, area, label, { reveal: () => {} }).map((x) => x.id)).toEqual([
      'edit-label',
      'move',
      'focus',
      'hide',
      'remove-label',
    ]);
    expect(nodeMenuItems(v.api, area, entity).map((x) => x.id)).toContain('label');
  });

  it("puts a part's label on one of its particles, not their center (an entity's copies around a model)", async () => {
    const v = await viewer();
    const area = v.api.explorer!;
    const list = area.objectsState().value.find((o) => o.kind === 'list')!;
    // the list's particles (x 10, 20, 30): the label goes on one of them
    const anchor = area.anchorOf({ ref: list.ref, particles: { targets: [0] } })!;
    expect([10, 20, 30]).toContain(anchor.position[0]);
    expect(anchor.radius).toBeGreaterThan(0);
  });

  it("does not list a cut's drawing (Prism's clip volumes, a shape of a representation) as a mesh", async () => {
    const v = await viewer();
    const area = v.api.explorer!;
    const crn = area.objectsState().value.find((o) => o.kind === 'structure')!;
    const meshes = () =>
      area
        .objectsState()
        .value.filter((o) => o.category === 'meshes')
        .map((o) => o.label);
    expect(meshes()).toEqual(['membrane.obj']);
    expectOk(await v.api.run('clipping.add', { shape: 'sphere', node: `#${crn.ref}` }));
    const cut = v.api.clipping.cuts.value[0];
    expectOk(await v.api.run('clipping.show', { tag: cut.object.tag, on: true }));
    expect(v.api.clipping.cuts.value[0].drawing).toBeDefined();
    expect(meshes()).toEqual(['membrane.obj']);
  });

  it('keeps unchanged rows as the same objects', () => {
    const stable = stableRows();
    const a = { key: 'a', depth: 1, label: 'A', kind: 'entity', hasChildren: false, visible: true };
    const b = { key: 'b', depth: 1, label: 'B', kind: 'entity', hasChildren: false, visible: true };
    const [a1, b1] = stable([a, b]);
    const [a2, b2] = stable([{ ...a }, { ...b, visible: false }]);
    expect(a2).toBe(a1);
    expect(b2).not.toBe(b1);
    expect(b2.visible).toBe(false);
  });
});
