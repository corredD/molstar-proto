/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { setCanvasModule } from '@molstar/graphics/geo/geometry/text/font-atlas';
import { StateSelection } from '@molstar/core/state';
import { TransparencyStructureRepresentation3DFromBundle } from '@molstar/plugin/state/transforms/structure/effects/transparency';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CommandLanguageExtension } from '../../prism-viewer.js';

// ChimeraX's commands on a headless Prism viewer (_spec §5, §5.4): model ids, atoms in their style, surfaces'
// transparency, residue labels, measurements from one spec, `sel` as the viewer's selection, one step a submission.
// No network: 1CBS from data/examples, given with the script as a file.

const cif = readFileSync(new URL('../../../../../../data/examples/1cbs_updated.cif', import.meta.url));
const file = () => new File([cif], '1cbs.cif');

// Measurement and label texts are drawn into a font atlas, which Node has no canvas for: a stand-in (as host.test.ts).
beforeAll(() => {
  const context = {
    measureText: () => ({ width: 8 }),
    clearRect() {},
    fillText() {},
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  };
  setCanvasModule({ createCanvas: () => ({ getContext: () => context }) });
});
afterAll(() => setCanvasModule(undefined as never));

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

async function viewer() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), CommandLanguageExtension] },
  });
  viewers.push(v);
  return v;
}

async function ok(v: PrismViewer, text: string) {
  const r = await v.api.script!.run({ text, dialect: 'chimerax', files: [file()] });
  if (!r.ok) expect.fail(`${text}: ${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
  return r as Extract<typeof r, { ok: true }>;
}

function components(v: PrismViewer) {
  const s = v.plugin.managers.structure.hierarchy.current.structures[0];
  return (s?.components ?? []).map((c) => ({
    label: (c.cell.params?.values as { label?: string } | undefined)?.label || c.cell.obj?.label || '',
    types: c.representations.map((r) => (r.cell.transform.params as { type: { name: string } }).type.name),
    atoms: c.cell.obj?.data.elementCount ?? 0,
  }));
}

const measurements = async (v: PrismViewer) => {
  const r = await v.api.run('measure.list', {});
  return (r.ok ? (r.value as { kind: string }[]) : []).map((m) => m.kind);
};

describe('ChimeraX commands on the viewer', () => {
  it('opens a file given as model #1, and lists the models by id', async () => {
    const v = await viewer();
    expect((await ok(v, 'open 1cbs.cif')).did).toContain('as 1cbs');
    const r = await ok(v, 'info models');
    expect(JSON.stringify(r.value)).toContain('#1 1cbs');
  });

  it('shows atoms in the style set for them, now and when shown again', async () => {
    const v = await viewer();
    await ok(v, 'open 1cbs.cif');
    await ok(v, 'hide; show /A:45-50 atoms; style /A:45-50 ball');
    const balls = components(v).find((c) => c.label === 'ball-and-stick');
    expect(balls?.atoms).toBeGreaterThan(0);
    // Hidden, then shown again: still balls (the state kept the style).
    await ok(v, 'hide /A:45-50; show /A:45-50');
    expect(components(v).find((c) => c.label === 'ball-and-stick')?.atoms).toBe(balls?.atoms);
    expect(components(v).find((c) => c.label === 'sticks')).toBeUndefined();
  });

  it('makes surfaces transparent and leaves the cartoon opaque (transparency’s default target)', async () => {
    const v = await viewer();
    await ok(v, 'open 1cbs.cif; surface /A; transparency /A 50');
    const under = v.plugin.state.data
      .select(StateSelection.Generators.ofTransformer(TransparencyStructureRepresentation3DFromBundle))
      .map(
        (c) =>
          (v.plugin.state.data.cells.get(c.transform.parent)?.transform.params as { type: { name: string } }).type.name,
      );
    expect(under.length).toBeGreaterThan(0);
    expect(new Set(under)).toEqual(new Set(['molecular-surface']));
  });

  it('labels a residue once, and measures from atoms given one by one or as the selection', async () => {
    const v = await viewer();
    await ok(v, 'open 1cbs.cif');
    expect((await ok(v, 'label /A:45')).did).toContain('Labelled 1 residue');
    await ok(v, 'distance :45@CA :60@CA');
    await ok(v, 'select :46@CA :61@CA; distance sel');
    await ok(v, 'angle :45@CA :46@CA :47@CA');
    expect((await measurements(v)).sort()).toEqual(['angle', 'distance', 'distance', 'label']);
  });

  it('reads sel as the viewer’s selection, picked outside the console', async () => {
    const v = await viewer();
    await ok(v, 'open 1cbs.cif; hide');
    expect((await v.api.run('select.set', { target: 'ligand' })).ok).toBe(true);
    await ok(v, 'show sel atoms');
    const shown = components(v).filter((c) => c.types.includes('ball-and-stick'));
    expect(shown.reduce((n, c) => n + c.atoms, 0)).toBe(22);
  });

  it('runs a submission as one step: Undo takes it back whole', async () => {
    const v = await viewer();
    await ok(v, 'open 1cbs.cif');
    const before = JSON.stringify(components(v));
    await ok(v, 'hide; cartoon hide; show ligand :<5 atoms; color /A red');
    expect(JSON.stringify(components(v))).not.toBe(before);
    await v.api.history.undo();
    expect(JSON.stringify(components(v))).toBe(before);
  });

  it('closes a model by its id', async () => {
    const v = await viewer();
    await ok(v, 'open 1cbs.cif');
    await ok(v, 'close #1');
    expect(v.plugin.managers.structure.hierarchy.current.structures).toHaveLength(0);
  });
});

describe('fixes from the first review, on the viewer', () => {
  const layerTypes = (v: PrismViewer) =>
    v.plugin.state.data
      .select(StateSelection.Generators.ofTransformer(TransparencyStructureRepresentation3DFromBundle))
      .map(
        (c) =>
          (v.plugin.state.data.cells.get(c.transform.parent)?.transform.params as { type: { name: string } }).type.name,
      );

  it('leaves PyMOL’s transparency on every representation, as before (M1)', async () => {
    const v = await viewer();
    const r = await v.api.script!.run({
      text: 'load 1cbs.cif; show surface; set transparency, 0.5',
      dialect: 'pymol',
      files: [file()],
    });
    expect(r.ok).toBe(true);
    expect(new Set(layerTypes(v)).size).toBeGreaterThan(1);
  });

  it('says why a measure of one selection does not have its atoms (S11)', async () => {
    const v = await viewer();
    await ok(v, 'open 1cbs.cif');
    const r = await v.api.script!.run({ text: 'distance :45', dialect: 'chimerax', files: [file()] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain('this measure takes 2');
  });

  it('forgets a closed model’s styles, and lists models by id (M3)', async () => {
    const v = await viewer();
    await ok(v, 'open 1cbs.cif; style ligand ball; close #1; open 1cbs.cif');
    await ok(v, 'show ligand atoms');
    expect(components(v).some((c) => c.label === 'ball-and-stick')).toBe(false);
    await ok(v, 'open 1cbs.cif; open 1cbs.cif; close #2; open 1cbs.cif');
    expect(JSON.stringify((await ok(v, 'info models')).value)).toMatch(/#1[^#]*#2[^#]*#3/);
  });
});
