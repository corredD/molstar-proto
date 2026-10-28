/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { Interval, OrderedSet } from '@molstar/core/data/int';
import { Binding } from '@molstar/core/util/binding';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { ButtonsType, EmptyKeyInput, ModifiersKeys } from '@molstar/core/util/input/input-observer';
import { MarkerAction } from '@molstar/core/util/marker-action';
import { clearFontAtlasCache, setCanvasModule } from '@molstar/graphics/geo/geometry/text/font-atlas';
import type { Loci } from '@molstar/model/model/loci';
import { Mat4, Tensor, Vec3 } from '@molstar/core/math/linear-algebra';
import { CCP4Writer } from '@molstar/model/formats/writer/ccp4/ccp4';
import { Particle } from '@molstar/model/model/particles/particle-list';
import { type Grid, Volume } from '@molstar/model/model/volume';
import { type Shape, ShapeGroup } from '@molstar/model/model/shape';
import { Bond, StructureElement, StructureSelection } from '@molstar/model/model/structure';
import { Script } from '@molstar/model/script/script';
import { FocusLoci as CameraFocusLoci } from '@molstar/plugin/behavior/dynamic/camera';
import { FocusLoci as RepresentationFocusLoci } from '@molstar/plugin/behavior/dynamic/representation';
import type { PluginSpec } from '@molstar/plugin/spec';
import { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { isStageDistanceData } from '@molstar/stage-tools-extension/distance';
import type { DistanceInfo } from '@molstar/stage-tools-extension/operations';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MesoscaleExplorerExtensions } from '../../extensions.js';
import { createMesoscaleExplorerSpec } from '../../spec.js';
import { distancePicker } from '../measure.js';
import { nodeMenuItems, removeObject } from '../menu.js';
import type { PickedNode } from '../operations.js';
import { ancestorKeys, rowsOf, toggleVisible } from '../rows.js';

// A distance by two Ctrl+clicks in the explorer (_spec/ui.md §7), on a headless viewer: 1CRN and a RELION
// list made in memory.

// A distance's text is drawn into a font atlas, which Node has no canvas for: a stand-in context that draws nothing.
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

const star = 'data_particles\n\nloop_\n_rlnCoordinateX\n_rlnCoordinateY\n_rlnCoordinateZ\n10 0 0\n13 4 0\n';

/** A viewer with 1CRN and a list; in selection mode (where Ctrl or ⌘ + click measures) unless said otherwise */
async function viewer(selectionMode = true) {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
  });
  viewers.push(v);
  const crn = new File([readFileSync(new URL('../../../../../data/examples/1crn.cif', import.meta.url))], '1crn.cif');
  for (const f of [crn, new File([star], 'p.star')]) expectOk(await v.api.load.files({ files: [f] }));
  v.plugin.selectionMode = selectionMode;
  return v;
}

/** One atom of 1CRN as a pick (residue `seq`, atom `name`) */
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
  return StructureSelection.toLociWithSourceUnits(selection);
}

const particle = (v: PrismViewer, i: number) =>
  Particle.Loci(v.plugin.managers.particles.hierarchy.current.lists[0].cell.obj!.data, OrderedSet.ofSingleton(i));

const distances = (v: PrismViewer) => v.api.stage!.distancesState().value;

function picker(v: PrismViewer) {
  const posted: string[] = [];
  const revealed: PickedNode[] = [];
  const p = distancePicker(v.api, v.api.explorer!, {
    post: (t) => posted.push(t),
    reveal: (n) => revealed.push(n),
    // the messages as off a Mac, whatever runs the test
    mac: false,
  });
  return { p, posted, revealed };
}

describe('a distance by two Ctrl+clicks', () => {
  it('keeps the first point (said), measures at the second, listed under the first row; one undo removes it', async () => {
    const v = await viewer();
    const area = v.api.explorer!;
    const { p, posted, revealed } = picker(v);
    const a = atom(v, 1, 'CA');
    const first = area.pickedOf(a)!;
    expect(await p.click({ loci: a, measure: true })).toBe(true);
    expect(p.pending.value?.picked.key).toBe(first.key);
    expect(posted.at(-1)).toMatch(/Ctrl\+click the second point/);
    expect(distances(v)).toHaveLength(0);
    const second = area.pickedOf(particle(v, 1))!;
    expect(await p.click({ loci: particle(v, 1), measure: true })).toBe(true);
    expect(p.pending.value).toBeUndefined();
    const [d] = distances(v);
    expect(d.node).toBe(first.key);
    expect(d.a.key).toBe(first.key);
    expect(d.b.key).toBe(second.key);
    expect(revealed.at(-1)).toMatchObject({ key: `d:${d.ref}`, kind: 'distance', label: d.label });
    // its row: under the first point's, the way to it unfolded by `reveal`
    const objects = area.objectsState().value;
    const rows = rowsOf(objects, new Map(), { has: () => true } as never, '', [], distances(v));
    const at = rows.findIndex((r) => r.key === `d:${d.ref}`);
    const parent = rows
      .slice(0, at)
      .reverse()
      .find((r) => r.depth < rows[at].depth);
    expect(parent?.key).toBe(first.key);
    expect(rows[at]).toMatchObject({ kind: 'distance', label: `Distance ${d.label}`, visible: true });
    expect(ancestorKeys(objects, new Map(), `d:${d.ref}`, [], distances(v))).toContain(first.key);
    expectOk(await v.api.run('history.undo', {}));
    expect(distances(v)).toHaveLength(0);
  });

  it('a plain click lets the first point go and is not taken; Esc (cancel) too; nothing under the pointer is refused', async () => {
    const v = await viewer();
    const { p, posted } = picker(v);
    await p.click({ loci: atom(v, 1, 'CA'), measure: true });
    expect(await p.click({ loci: atom(v, 10, 'CA') })).toBe(false);
    expect(p.pending.value).toBeUndefined();
    await p.click({ loci: particle(v, 0), measure: true });
    expect(p.pending.value).toBeDefined();
    p.cancel();
    expect(distances(v)).toHaveLength(0);
    // nothing under the pointer: said, nothing kept
    expect(await p.click({ loci: { kind: 'empty-loci' }, measure: true })).toBe(true);
    expect(p.pending.value).toBeUndefined();
    expect(posted.at(-1)).toMatch(/Ctrl\+click one/);
  });

  it("measures at the pick granularity (Ludovic, 2026-10-24): residues by default, atoms when it is 'element'", async () => {
    const v = await viewer();
    const { p } = picker(v);
    expect(v.plugin.managers.interactivity.props.granularity).toBe('residue');
    await p.click({ loci: atom(v, 1, 'CA'), measure: true });
    await p.click({ loci: atom(v, 10, 'CA'), measure: true });
    expect(distances(v)[0].distance).toBeCloseTo(10.67, 2);
    v.plugin.managers.interactivity.setProps({ granularity: 'element' });
    await p.click({ loci: atom(v, 1, 'CA'), measure: true });
    await p.click({ loci: atom(v, 10, 'CA'), measure: true });
    expect(distances(v)).toHaveLength(2);
    expect(distances(v)[1].distance).toBeCloseTo(12.6, 2);
  });

  it('names the gesture by platform on the status line: ⌘+click on a Mac, Ctrl+click elsewhere', async () => {
    const v = await viewer();
    for (const mac of [true, false]) {
      const posted: string[] = [];
      const p = distancePicker(v.api, v.api.explorer!, { post: (t) => posted.push(t), mac });
      await p.click({ loci: atom(v, 1, 'CA'), measure: true });
      await p.click({ loci: { kind: 'empty-loci' }, measure: true });
      const key = mac ? '⌘' : 'Ctrl';
      expect(posted[0]).toMatch(new RegExp(`${key}\\+click the second point`));
      expect(posted[1]).toMatch(new RegExp(`${key}\\+click one`));
      expect(posted.join(' ')).not.toMatch(mac ? /Ctrl/ : /⌘/);
      p.cancel();
    }
  });

  it('takes ⌘+click on a Mac and Ctrl+click elsewhere from the canvas, and the picker says the same gesture', async () => {
    const v = await viewer();
    const area = v.api.explorer!;
    const seen: (boolean | undefined)[] = [];
    const sub = area.clicks.subscribe((c) => seen.push(c.measure));
    const click = (modifiers: Partial<ModifiersKeys>) =>
      v.plugin.behaviors.interaction.click.next({
        current: { loci: atom(v, 1, 'CA') },
        buttons: ButtonsType.Flag.Primary,
        button: ButtonsType.Flag.Primary,
        modifiers: ModifiersKeys.create(modifiers),
      });
    for (const mac of [true, false]) {
      area.mac = mac;
      seen.length = 0;
      click({ meta: true });
      click({ control: true });
      click({});
      expect(seen).toEqual(mac ? [true, undefined, undefined] : [undefined, true, undefined]);
      // the picker follows the area's platform when not told
      const posted: string[] = [];
      const p = distancePicker(v.api, area, { post: (t) => posted.push(t) });
      await p.click({ loci: atom(v, 1, 'CA'), measure: true });
      expect(posted[0]).toContain(mac ? '⌘+click' : 'Ctrl+click');
      p.cancel();
    }
    sub.unsubscribe();
  });

  it('measures only in selection mode: outside it, two Ctrl+clicks are not taken and make nothing', async () => {
    const v = await viewer(false);
    const { p } = picker(v);
    expect(await p.click({ loci: atom(v, 1, 'CA'), measure: true })).toBe(false);
    expect(await p.click({ loci: particle(v, 1), measure: true })).toBe(false);
    expect(p.pending.value).toBeUndefined();
    expect(distances(v)).toHaveLength(0);
    // in selection mode, the same two clicks make one
    v.plugin.selectionMode = true;
    await p.click({ loci: atom(v, 1, 'CA'), measure: true });
    await p.click({ loci: particle(v, 1), measure: true });
    expect(distances(v)).toHaveLength(1);
  });

  it('lets the first point go when selection mode is left (and only then: entering it, or leaving twice, is not told)', async () => {
    const v = await viewer(false);
    const { p } = picker(v);
    let escaped = 0;
    // as explorerUI wires it
    const sub = v.api.explorer!.escaped.subscribe(() => {
      escaped++;
      p.cancel();
    });
    v.plugin.selectionMode = true;
    expect(escaped).toBe(0);
    await p.click({ loci: atom(v, 1, 'CA'), measure: true });
    expect(p.pending.value).toBeDefined();
    v.plugin.selectionMode = false;
    v.plugin.selectionMode = false;
    sub.unsubscribe();
    expect(escaped).toBe(1);
    expect(p.pending.value).toBeUndefined();
  });

  it('keeps the first point through a Ctrl+click on nothing (said), and measures at the next point', async () => {
    const v = await viewer();
    const { p, posted } = picker(v);
    await p.click({ loci: atom(v, 1, 'CA'), measure: true });
    const first = p.pending.value;
    expect(await p.click({ loci: { kind: 'empty-loci' }, measure: true })).toBe(true);
    expect(posted.at(-1)).toMatch(/Ctrl\+click one/);
    expect(p.pending.value).toBe(first);
    await p.click({ loci: particle(v, 1), measure: true });
    expect(distances(v)).toHaveLength(1);
    expect(distances(v)[0].node).toBe(first!.picked.key);
  });

  it('lets the first point go when its object is removed: the next Ctrl+click is a new first point, and says why', async () => {
    const v = await viewer();
    const { p, posted } = picker(v);
    await p.click({ loci: particle(v, 0), measure: true });
    const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    expectOk(await v.api.run('particles.remove', { particles: list }));
    expect(await p.click({ loci: atom(v, 1, 'CA'), measure: true })).toBe(true);
    expect(distances(v)).toHaveLength(0);
    expect(p.pending.value?.picked.kind).toBe('entity');
    expect(posted.some((t) => /removed/.test(t))).toBe(true);
  });

  it('a distance measured already: says so and picks its row; a failure: says why', async () => {
    const v = await viewer();
    const { p, posted, revealed } = picker(v);
    for (let i = 0; i < 2; i++) {
      await p.click({ loci: atom(v, 1, 'CA'), measure: true });
      await p.click({ loci: particle(v, 1), measure: true });
    }
    const [d] = distances(v);
    expect(distances(v)).toHaveLength(1);
    expect(posted.at(-1)).toMatch(/already measured/);
    expect(revealed.at(-1)).toMatchObject({ key: `d:${d.ref}`, kind: 'distance' });
    // a run that fails: its message said, nothing picked
    const failing = new Proxy(v.api, {
      get: (t, k) => (k === 'run' ? async () => ApiResult.fail('invalid', 'No can do.') : Reflect.get(t, k)),
    });
    const f = distancePicker(failing, v.api.explorer!, {
      post: (t) => posted.push(t),
      reveal: (n) => revealed.push(n),
    });
    const before = revealed.length;
    await f.click({ loci: atom(v, 1, 'CA'), measure: true });
    await f.click({ loci: particle(v, 0), measure: true });
    expect(posted.at(-1)).toBe('No can do.');
    expect(revealed.length).toBe(before + 1);
  });

  it("takes a volume's voxel as a point, and the whole volume at a coarse granularity; under the first pick's row", async () => {
    const v = await viewer();
    const n = 6;
    const data = new Float32Array(n * n * n).map((_, i) => i % 5);
    const grid: Grid = {
      transform: { kind: 'matrix', matrix: Mat4.identity() },
      cells: Tensor.create(Tensor.Space([n, n, n], [0, 1, 2], Float32Array), Tensor.Data1(data)),
      stats: { min: 0, max: 4, mean: 2, sigma: 1 },
    };
    expectOk(await v.api.load.files({ files: [new File([CCP4Writer.writeMrc(grid, data)], 'map.mrc')] }));
    const map = v.plugin.managers.volume.hierarchy.current.volumes[0];
    const volume = map.cell.obj!.data;
    const cell = (i: number, j: number, k: number) =>
      Volume.Cell.Loci(volume, [
        {
          indices: Interval.ofSingleton(volume.grid.cells.space.dataOffset(i, j, k) as Volume.CellIndex),
          instances: Interval.ofSingleton(0 as Volume.InstanceIndex),
        },
      ]);
    const { p } = picker(v);
    // a voxel first: the distance under the volume's row
    await p.click({ loci: cell(1, 2, 3), measure: true });
    expect(p.pending.value?.picked.key).toBe(`o:${map.cell.transform.ref}`);
    await p.click({ loci: atom(v, 1, 'CA'), measure: true });
    expect(distances(v)).toHaveLength(1);
    expect(distances(v)[0]).toMatchObject({
      node: `o:${map.cell.transform.ref}`,
      a: { label: 'map.mrc voxel (1, 2, 3)' },
    });
    // at a coarse granularity (Mol*'s 'structure': a volume whole), its center
    v.plugin.managers.interactivity.setProps({ granularity: 'structure' });
    await p.click({ loci: cell(0, 0, 0), measure: true });
    await p.click({ loci: particle(v, 1), measure: true });
    expect(distances(v)[1].a.label).toBe('map.mrc (center)');
    // a moved volume: its representation draws a new volume object, still the volume's row
    v.plugin.managers.interactivity.setProps({ granularity: 'residue' });
    const up = Array.from(Mat4.fromTranslation(Mat4(), Vec3.create(0, 0, 10)));
    expectOk(await v.api.run('stage.move', { target: map.cell.transform.ref, matrix: up }));
    const drawn = v.plugin.managers.volume.hierarchy.current.volumes[0].representations[0].cell.obj!.data
      .sourceData as Volume;
    expect(drawn).not.toBe(volume);
    expect(v.api.explorer!.pickedOf(Volume.Loci(drawn, Interval.ofSingleton(0 as Volume.InstanceIndex)))?.key).toBe(
      `o:${map.cell.transform.ref}`,
    );
  });

  it('takes a bond as a point (normalized to its atoms first)', async () => {
    const v = await viewer();
    const { p } = picker(v);
    const structure = v.plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data;
    const unit = structure.units[0];
    const bond = Bond.Loci(structure, [
      Bond.Location(structure, unit, 0 as StructureElement.UnitIndex, structure, unit, 1 as StructureElement.UnitIndex),
    ]);
    expect(await p.click({ loci: bond, measure: true })).toBe(true);
    expect(p.pending.value?.picked.kind).toBe('entity');
    expect(StructureElement.Loci.is(p.pending.value?.loci)).toBe(true);
  });

  it('Esc on the canvas is told to the explorer (which lets the first point go: explorerUI)', async () => {
    const v = await viewer();
    let escaped = 0;
    const sub = v.api.explorer!.escaped.subscribe(() => escaped++);
    v.plugin.behaviors.interaction.key.next({ ...EmptyKeyInput, key: 'Escape', code: 'Escape' });
    v.plugin.behaviors.interaction.key.next({ ...EmptyKeyInput, key: 'a', code: 'KeyA' });
    sub.unsubscribe();
    expect(escaped).toBe(1);
  });

  it('its line picks its row; its eye and its menu act on it; it goes with an object removed', async () => {
    const v = await viewer();
    const area = v.api.explorer!;
    const { p } = picker(v);
    await p.click({ loci: atom(v, 1, 'CA'), measure: true });
    await p.click({ loci: particle(v, 1), measure: true });
    const [d] = distances(v);
    // a click on its line (Mol*'s shape of the distance: its group 0)
    const cell = v.plugin.state.data.cells.get(d.ref)!;
    const repr = (cell.obj!.data as { repr: { getAllLoci(): { shape?: Shape }[] } }).repr;
    const line = ShapeGroup.Loci(repr.getAllLoci().find((l) => l.shape)!.shape!, [{ ids: OrderedSet.ofSingleton(0) }]);
    expect(isStageDistanceData(line.shape.sourceData)).toBe(true);
    const picked = area.pickedOf(line);
    expect(picked).toMatchObject({ key: `d:${d.ref}`, kind: 'distance', node: { ref: d.ref } });
    // the eye
    const row = {
      key: picked!.key,
      depth: 2,
      label: d.label,
      kind: 'distance',
      visible: true,
      hasChildren: false,
      node: { ref: d.ref },
    };
    expectOk((await toggleVisible(v.api, row))!);
    expect(distances(v)[0].visible).toBe(false);
    // the menu: focus, hide, remove
    const items = nodeMenuItems(v.api, area, picked);
    expect(items.map((i) => i.id)).toEqual(['focus', 'hide', 'remove-distance']);
    // the list removed as the tree's trash does: the distance with it, in the same step
    const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    expectOk(await removeObject(v.api, area, 'particle list', list));
    expect(distances(v)).toEqual([] as DistanceInfo[]);
  });
});

/** A behavior's own param defaults; none when its params need a plugin (a representation's: no click bindings) */
function defaultsOf(t: PluginSpec['behaviors'][number]['transformer']) {
  try {
    return t.definition.params?.(undefined as never, undefined);
  } catch {
    return undefined;
  }
}

describe('in selection mode, a modifier click selects as a plain click does (Ludovic, 2026-10-25)', () => {
  it('selects a structure part and toggles a particle, and two of them also make the distance', async () => {
    // the app's own spec (its bindings), headless
    const spec = createMesoscaleExplorerSpec('');
    const v = await createPrismViewerHeadless({ spec: { ...spec, persist: undefined, agent: undefined } as never });
    viewers.push(v);
    const crn = new File([readFileSync(new URL('../../../../../data/examples/1crn.cif', import.meta.url))], '1crn.cif');
    for (const f of [crn, new File([star], 'p.star')]) expectOk(await v.api.load.files({ files: [f] }));
    // no canvas headless: a stand-in that records the marks (Mol*'s selection clicks need one)
    const marks: [string, number][] = [];
    const mark = (r: { loci: Loci }, action: number) => {
      marks.push([r.loci.kind, action]);
      return true;
    };
    // (and takes what is added to it); the camera's Ctrl+click focus off a Mac (selection mode's) is not this test's
    Object.defineProperty(v.plugin, 'canvas3d', {
      value: { mark, add() {}, remove() {}, syncVisibility() {} },
      configurable: true,
    });
    vi.spyOn(v.plugin.managers.camera, 'focusLoci').mockImplementation(() => {});
    v.plugin.selectionMode = true;
    const area = v.api.explorer!;
    const { p } = picker(v);
    const runs: Promise<boolean>[] = [];
    const sub = area.clicks.subscribe((c) => runs.push(p.click(c)));
    try {
      for (const mac of [true, false]) {
        area.mac = mac;
        const modifiers = ModifiersKeys.create(mac ? { meta: true } : { control: true });
        const click = (loci: Loci) =>
          v.plugin.behaviors.interaction.click.next({
            current: { loci },
            buttons: ButtonsType.Flag.Primary,
            button: ButtonsType.Flag.Primary,
            modifiers,
          });
        v.plugin.managers.interactivity.lociSelects.deselectAll();
        marks.length = 0;
        const before = distances(v).length;
        click(atom(v, mac ? 1 : 2, 'CA'));
        const structure = v.plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data;
        expect(
          StructureElement.Loci.size(v.plugin.managers.structure.selection.getLoci(structure) as never),
        ).toBeGreaterThan(0);
        click(particle(v, mac ? 1 : 0));
        expect(marks.some(([kind, action]) => kind === 'particle-loci' && action === MarkerAction.Toggle)).toBe(true);
        await Promise.all(runs);
        expect(distances(v).length).toBe(before + 1);
        // the selection shows the points: nothing of the picker's own unmarks them after (a particle's mark stays);
        // Mol*'s selection re-marks a structure whole (a structure-loci deselect, then its selection)
        expect(marks.filter(([kind, action]) => action === MarkerAction.Deselect && kind !== 'structure-loci')).toEqual(
          [],
        );
      }
      // a volume's voxel: selected (its mark toggled) as the others, and a point
      const n = 4;
      const data = new Float32Array(n * n * n).map((_, i) => i % 3);
      const grid: Grid = {
        transform: { kind: 'matrix', matrix: Mat4.identity() },
        cells: Tensor.create(Tensor.Space([n, n, n], [0, 1, 2], Float32Array), Tensor.Data1(data)),
        stats: { min: 0, max: 2, mean: 1, sigma: 1 },
      };
      expectOk(await v.api.load.files({ files: [new File([CCP4Writer.writeMrc(grid, data)], 'map.mrc')] }));
      const volume = v.plugin.managers.volume.hierarchy.current.volumes[0].cell.obj!.data;
      marks.length = 0;
      const before = distances(v).length;
      v.plugin.behaviors.interaction.click.next({
        current: {
          loci: Volume.Cell.Loci(volume, [
            {
              indices: Interval.ofSingleton(5 as Volume.CellIndex),
              instances: Interval.ofSingleton(0 as Volume.InstanceIndex),
            },
          ]),
        },
        buttons: ButtonsType.Flag.Primary,
        button: ButtonsType.Flag.Primary,
        modifiers: ModifiersKeys.create({ control: true }),
      });
      v.plugin.behaviors.interaction.click.next({
        current: { loci: atom(v, 3, 'CA') },
        buttons: ButtonsType.Flag.Primary,
        button: ButtonsType.Flag.Primary,
        modifiers: ModifiersKeys.create({ control: true }),
      });
      await Promise.all(runs);
      expect(marks.some(([kind, action]) => kind === 'cell-loci' && action === MarkerAction.Toggle)).toBe(true);
      expect(distances(v).length).toBe(before + 1);
    } finally {
      sub.unsubscribe();
      // the stand-in goes before the viewer is disposed (it would dispose it)
      Object.defineProperty(v.plugin, 'canvas3d', { value: undefined, configurable: true });
    }
  });
});

describe("the app's bindings", () => {
  it("keep the canvas's Ctrl+click and ⌘+click focus as Mol* has them, and select with them in selection mode", () => {
    const spec = createMesoscaleExplorerSpec('');
    const plugin = spec.finalize ? spec.finalize(spec.plugin as PluginSpec) : (spec.plugin as PluginSpec);
    // both focus behaviors are there (else the test checks nothing of them), with bindings
    const ids = plugin.behaviors.map((b) => b.transformer.id);
    expect(ids).toContain(CameraFocusLoci.id);
    expect(ids).toContain(RepresentationFocusLoci.id);
    const taken: string[] = [];
    for (const b of plugin.behaviors) {
      // its params as the spec gives them, else the behavior's own defaults (a behavior listed without params)
      const own = (b.defaultParams as { bindings?: Record<string, Binding> } | undefined)?.bindings;
      const defs = defaultsOf(b.transformer);
      const bindings =
        own ?? (defs ? (PD.getDefaultValues(defs) as { bindings?: Record<string, Binding> }).bindings : undefined);
      for (const [name, binding] of Object.entries(bindings ?? {})) {
        for (const m of [ModifiersKeys.create({ control: true }), ModifiersKeys.create({ meta: true })]) {
          if (Binding.match(binding, ButtonsType.Flag.Primary, m)) taken.push(`${b.transformer.id}.${name}`);
        }
      }
    }
    // as before the distance: the camera's focus (also its selection mode's) and the representation's focus add
    expect(taken.sort()).toEqual(
      [
        'ms-plugin.camera-focus-loci.clickCenterFocus',
        'ms-plugin.camera-focus-loci.clickCenterFocusSelectMode',
        'ms-plugin.camera-focus-loci.clickResetCameraOnEmpty',
        'ms-plugin.camera-focus-loci.clickResetCameraOnEmptySelectMode',
        'ms-plugin.representation-focus-loci.clickFocusAdd',
        'ms-plugin.representation-focus-loci.clickFocusAdd',
        // selection mode's toggle: a modifier click selects as a plain one (Ludovic, 2026-10-25)
        'ms-plugin.representation-select-loci.clickToggle',
        'ms-plugin.representation-select-loci.clickToggle',
      ].sort(),
    );
  });
});
