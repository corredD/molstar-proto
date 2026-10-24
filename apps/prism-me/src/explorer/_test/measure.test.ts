/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { OrderedSet } from '@molstar/core/data/int';
import { Binding } from '@molstar/core/util/binding';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { ButtonsType, EmptyKeyInput, ModifiersKeys } from '@molstar/core/util/input/input-observer';
import { MarkerAction } from '@molstar/core/util/marker-action';
import { clearFontAtlasCache, setCanvasModule } from '@molstar/graphics/geo/geometry/text/font-atlas';
import type { Loci } from '@molstar/model/model/loci';
import { Particle } from '@molstar/model/model/particles/particle-list';
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
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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

async function viewer() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
  });
  viewers.push(v);
  const crn = new File([readFileSync(new URL('../../../../../data/examples/1crn.cif', import.meta.url))], '1crn.cif');
  for (const f of [crn, new File([star], 'p.star')]) expectOk(await v.api.load.files({ files: [f] }));
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
  });
  return { p, posted, revealed };
}

describe('a distance by two Ctrl+clicks', () => {
  it('keeps the first point (said, marked), measures at the second, listed under the first row; one undo removes it', async () => {
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
    expect(rows[at]).toMatchObject({ kind: 'distance', label: d.label, visible: true });
    expect(ancestorKeys(objects, new Map(), `d:${d.ref}`, [], distances(v))).toContain(first.key);
    expectOk(await v.api.run('history.undo', {}));
    expect(distances(v)).toHaveLength(0);
  });

  it('a plain click, or a pick that is no point, lets nothing be measured; a plain click is not taken', async () => {
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

  it("unmarks the first point without unmarking the person's selection (its marks put back)", async () => {
    const v = await viewer();
    const area = v.api.explorer!;
    // no canvas headless: a stand-in that records the marks
    const marks: [string, number][] = [];
    const mark = (r: { loci: Loci }, action: number) => {
      marks.push([r.loci.kind, action]);
      return true;
    };
    Object.defineProperty(v.plugin, 'canvas3d', { value: { mark }, configurable: true });
    const a = area.measurePoint(atom(v, 1, 'CA'));
    v.plugin.managers.structure.selection.fromLoci('set', a);
    marks.length = 0;
    area.markPoint(a);
    area.markPoint(undefined);
    expect(marks).toEqual([
      ['element-loci', MarkerAction.Select],
      ['element-loci', MarkerAction.Deselect],
      ['element-loci', MarkerAction.Select],
    ]);
    // the stand-in goes before the viewer is disposed (it would dispose it)
    Object.defineProperty(v.plugin, 'canvas3d', { value: undefined, configurable: true });
  });

  it('Esc on the canvas is told (the explorer lets the first point go)', async () => {
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

describe("the app's bindings", () => {
  it('leave Ctrl+click (and ⌘+click) to the distance: no camera or representation focus on it', () => {
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
    expect(taken).toEqual([]);
  });
});
