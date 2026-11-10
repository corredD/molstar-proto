/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Color } from '@molstar/core/util/color';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { meshTint } from '@molstar/mesoscale-extension/lipids/membrane';
import { MesoscaleExplorerExtensions } from '../../extensions.js';
import { colorItems } from '../menu.js';

// A membrane's parts coloured from their meshes (lipid-procedural round 9): a part's dot, Color… and Generate colour its
// mesh (`cryoet.mesh`), one step with the membrane's; the dot reads the mesh's colour; the switch off is round 7.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
}

/** two tetrahedra, the PM's and a VAC's inside it, in the yeast cell viewer's format (u32 count, (id, nV, nT) u32, nm) */
function organelles() {
  const tetra = (s: number) => [s, s, s, s, -s, -s, -s, s, -s, -s, -s, s];
  const meshes = [
    { id: 0, p: tetra(100) },
    { id: 3, p: tetra(20) },
  ];
  const faces = [0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2];
  const view = new DataView(new ArrayBuffer(4 + 2 * 12 + 2 * (12 * 4 + 12 * 4)));
  view.setUint32(0, 2, true);
  let at = 28;
  meshes.forEach((m, i) => {
    view.setUint32(4 + i * 12, m.id, true);
    view.setUint32(8 + i * 12, 4, true);
    view.setUint32(12 + i * 12, 4, true);
    for (const x of m.p) view.setFloat32((at += 4) - 4, x, true);
    for (const f of faces) view.setUint32((at += 4) - 4, f, true);
  });
  return new File([view.buffer], 'organelle_meshes.bin');
}

async function wrapped() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
  });
  viewers.push(v);
  expectOk(await v.api.load.files({ files: [organelles()] }));
  const area = v.api.explorer!;
  const meshes = area.objectsState().value.filter((o) => o.kind === 'mesh');
  expect(meshes.map((o) => o.label)).toEqual(['PM', 'VAC']);
  const r = await v.api.run('mesoscale.wrapMembrane', { meshes: meshes.map((m) => m.ref).join(',') });
  expectOk(r);
  const membrane = r.changed!.nodes![0];
  const cells = v.plugin.state.data.cells;
  const meshColor = (k: number) =>
    (cells.get(meshes[k].ref)!.transform.params as { coloring: { params: { color: number } } }).coloring.params.color;
  const params = () =>
    cells.get(membrane)!.transform.params as { partColors: object; color: number; meshColors: boolean };
  const tints = () => (cells.get(membrane)!.obj!.data as { repr: { meshTints: readonly unknown[] } }).repr.meshTints;
  const dots = () =>
    area
      .objectsState()
      .value.find((o) => o.ref === membrane)!
      .parts!.map((p) => p.color);
  const steps = () => v.api.history.steps.value.length;
  return { v, area, meshes, membrane, meshColor, params, tints, dots, steps };
}

/** a tetrahedron of half-size `s` as an OBJ file (its shape labelled `Shape` by the provider, its row by the file) */
function objFile(name: string, s: number) {
  const p = [s, s, s, s, -s, -s, -s, s, -s, -s, -s, s];
  const faces = [0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2];
  let text = '';
  for (let i = 0; i < 4; i++) text += `v ${p[3 * i]} ${p[3 * i + 1]} ${p[3 * i + 2]}\n`;
  for (let i = 0; i < 4; i++) text += `f ${faces[3 * i] + 1} ${faces[3 * i + 1] + 1} ${faces[3 * i + 2] + 1}\n`;
  return new File([text], name);
}

/** a tetrahedron as a VTP file: its colour its colour theme's, no `coloring` (cryoet.mesh does not paint it) */
function vtpFile(name: string, s: number) {
  const p = [s, s, s, s, -s, -s, -s, s, -s, -s, -s, s];
  const text =
    '<?xml version="1.0"?><VTKFile type="PolyData" version="0.1" byte_order="LittleEndian"><PolyData>' +
    '<Piece NumberOfPoints="4" NumberOfVerts="0" NumberOfLines="0" NumberOfStrips="0" NumberOfPolys="4">' +
    `<Points><DataArray type="Float32" NumberOfComponents="3" format="ascii">${p.join(' ')}</DataArray></Points>` +
    '<Polys><DataArray type="Int32" Name="connectivity" format="ascii">0 1 2 0 3 1 0 2 3 1 3 2</DataArray>' +
    '<DataArray type="Int32" Name="offsets" format="ascii">3 6 9 12</DataArray></Polys></Piece></PolyData></VTKFile>';
  return new File([text], name);
}

/** meshes opened from `files`, wrapped all: the membrane, the meshes' rows, its parts' names and its meshes' colours */
async function wrappedFiles(files: File[]) {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
  });
  viewers.push(v);
  expectOk(await v.api.load.files({ files }));
  const area = v.api.explorer!;
  const meshes = area.objectsState().value.filter((o) => o.kind === 'mesh');
  const r = await v.api.run('mesoscale.wrapMembrane', { meshes: meshes.map((m) => m.ref).join(',') });
  expectOk(r);
  const membrane = r.changed!.nodes![0];
  const cells = v.plugin.state.data.cells;
  const meshColor = (k: number) =>
    (cells.get(meshes[k].ref)!.transform.params as { coloring?: { params: { color: number } } }).coloring?.params.color;
  const parts = () =>
    area
      .objectsState()
      .value.find((o) => o.ref === membrane)!
      .parts!.map((p) => p.name);
  const params = () => cells.get(membrane)!.transform.params as { partColors: object; color: number };
  const dots = () =>
    area
      .objectsState()
      .value.find((o) => o.ref === membrane)!
      .parts!.map((p) => p.color);
  return { v, meshes, membrane, meshColor, parts, params, dots };
}

describe('a membrane’s parts coloured from their meshes (round 9)', () => {
  it('a part’s dot colours its mesh in one step, the dot and the tint follow; undo restores', async () => {
    const { v, area, meshes, membrane, meshColor, params, tints, dots, steps } = await wrapped();
    const grey = meshColor(1);
    expect(tints()).toEqual([undefined, undefined]);
    expect(dots()).toEqual([meshColor(0), grey]);
    // the dot's pick, as Color…'s swatch runs it (`colorItems`)
    const node = { ref: membrane, membranePart: 'VAC' };
    const swatch = colorItems(v.api, area, { node, kind: 'membrane part' } as never).find(
      (i) => i.id === 'color-tomato',
    );
    expect(swatch).toBeDefined();
    const before = steps();
    // run as the menu runs it (review N5): its operation not awaited, its step awaited
    swatch!.run!();
    await vi.waitFor(() => expect(meshColor(1)).toBe(0xff6347));
    expect(steps()).toBe(before + 1);
    expect(params().partColors).toEqual({});
    expect(tints()).toEqual([undefined, meshTint(Color(0xff6347))]);
    expect(dots()).toEqual([meshColor(0), 0xff6347]);
    expectOk(await v.api.history.undo({}));
    expect(meshColor(1)).toBe(grey);
    expect(tints()).toEqual([undefined, undefined]);
    // Generate (every part): each mesh a hue, one step
    const generate = steps();
    expectOk(await v.api.run('mesoscale.colors', { scheme: 'generate', particles: membrane, parts: '' }));
    expect(steps()).toBe(generate + 1);
    expect(meshColor(0)).not.toBe(grey);
    expect(meshColor(1)).not.toBe(grey);
    expect(params().partColors).toEqual({});
    expect(dots()).toEqual([meshColor(0), meshColor(1)]);
    expect(tints()).toEqual([meshTint(Color(meshColor(0))), meshTint(Color(meshColor(1)))]);
    expect(meshes.length).toBe(2);
  });

  it('the switch off: round 7, a part’s colour its own; shown only for a membrane with meshes', async () => {
    const { v, membrane, meshColor, params, dots, steps } = await wrapped();
    expect(v.api.mesoscale!.graphicsState(membrane).value?.meshColors).toBe(true);
    const before = steps();
    expectOk(await v.api.run('mesoscale.colorLevels', { particles: membrane, meshColors: false }));
    expect(steps()).toBe(before + 1);
    expect(params().meshColors).toBe(false);
    expect(v.api.mesoscale!.graphicsState(membrane).value?.meshColors).toBe(false);
    const grey = meshColor(1);
    expectOk(await v.api.run('mesoscale.style', { particles: membrane, parts: 'VAC', color: 'tomato' }));
    expect(meshColor(1)).toBe(grey);
    expect(params().partColors).toEqual({ VAC: 0xff6347 });
    expect(dots()[1]).toBe(0xff6347);
    // a sphere's membrane: no meshes, no switch
    const sphere = await v.api.run('mesoscale.wrapMembrane', { radius: 300 });
    expectOk(sphere);
    expect(v.api.mesoscale!.graphicsState(sphere.changed!.nodes![0]).value?.meshColors).toBeUndefined();
    // review N6: the switch asked of it fails, nothing changed (not a step that does nothing)
    const steps0 = steps();
    const off = await v.api.run('mesoscale.colorLevels', { particles: sphere.changed!.nodes![0], meshColors: false });
    expect(off.ok).toBe(false);
    expect(steps()).toBe(steps0);
  });

  // the state fills a param left out with its default (`resolveParams`, a session's too): the operations' raw reads of
  // `meshColors` agree with the representation's
  it('reads a membrane saved before round 9 (no meshColors) as on, as it draws', async () => {
    const { v, membrane, meshColor, params } = await wrapped();
    const b = v.plugin.state.data.build();
    b.to(membrane).update((p: Record<string, unknown>) => {
      const { meshColors: _, ...old } = p;
      return old;
    });
    await b.commit();
    expect(params().meshColors).toBe(true);
    expect(v.api.mesoscale!.graphicsState(membrane).value?.meshColors).toBe(true);
    expectOk(await v.api.run('mesoscale.style', { particles: membrane, parts: 'VAC', color: 'tomato' }));
    expect(meshColor(1)).toBe(0xff6347);
    expect(params().partColors).toEqual({});
  });

  it('a category’s theme over a membrane and all its meshes colours the meshes, not the membrane twice', async () => {
    const { v, meshes, membrane, meshColor, params, tints } = await wrapped();
    const old = params();
    expectOk(
      await v.api.run('mesoscale.theme', {
        objects: [membrane, ...meshes.map((m) => m.ref)],
        theme: 'uniform',
        color: 'teal',
      }),
    );
    expect(meshColor(0)).toBe(0x008080);
    expect(meshColor(1)).toBe(0x008080);
    expect(params().color).toBe(old.color);
    expect(tints()).toEqual([meshTint(Color(0x008080)), meshTint(Color(0x008080))]);
  });

  // review S3 + X1: an OBJ's or VTP's shape is labelled by its provider (`Shape`, `VTP Shape`), every one alike, so a
  // part named so painted the last mesh of that name; parts are named as their rows and kept apart, meshes by index
  it('parts of opened meshes are named as their rows, kept apart; a part paints its own mesh', async () => {
    const { v, meshes, membrane, meshColor, parts } = await wrappedFiles([
      objFile('pm.obj', 100),
      objFile('vac.obj', 20),
    ]);
    expect(parts()).toEqual(meshes.map((m) => m.label));
    expect(parts()).toEqual(['pm.obj', 'vac.obj']);
    const other = meshColor(1);
    expectOk(await v.api.run('mesoscale.style', { particles: membrane, parts: parts()[0], color: 'tomato' }));
    expect(meshColor(0)).toBe(0xff6347);
    expect(meshColor(1)).toBe(other);
  });

  it('two meshes of one name are two parts (`name`, `name 2`), each painting its own mesh', async () => {
    const { v, membrane, meshColor, parts } = await wrappedFiles([objFile('pm.obj', 100), objFile('pm.obj', 20)]);
    expect(parts()).toEqual(['pm.obj', 'pm.obj 2']);
    const first = meshColor(0);
    expectOk(await v.api.run('mesoscale.style', { particles: membrane, parts: 'pm.obj 2', color: 'tomato' }));
    expect(meshColor(1)).toBe(0xff6347);
    expect(meshColor(0)).toBe(first);
  });

  // review S2 (the coordinator's decision, for Ludo): a VTP's colour is its theme's, which cryoet.mesh does not write:
  // its part takes round 7's path, its own colour, which applies where its mesh's tint is neutral
  it('a part of a VTP mesh takes its own colour (round 7’s path), its dot and a theme colour it', async () => {
    const { v, meshes, membrane, parts, params, dots } = await wrappedFiles([
      vtpFile('pm.vtp', 100),
      vtpFile('vac.vtp', 20),
    ]);
    expect(parts()).toEqual(['pm.vtp', 'vac.vtp']);
    const r = await v.api.run('mesoscale.style', { particles: membrane, parts: 'vac.vtp', color: 'tomato' });
    expectOk(r);
    expect(r.unchanged).toBeFalsy();
    expect(params().partColors).toEqual({ 'vac.vtp': 0xff6347 });
    expect(dots()[1]).toBe(0xff6347);
    // a category's theme over the membrane and its meshes: the membrane coloured (its meshes' tints cannot)
    expectOk(
      await v.api.run('mesoscale.theme', {
        objects: [membrane, ...meshes.map((m) => m.ref)],
        theme: 'uniform',
        color: 'teal',
      }),
    );
    expect(params().color).toBe(0x008080);
  });

  // review S4a: a session saved before round 9 kept its parts' colours in partColors, its meshes grey: they still show
  it('a part colour of a session before round 9 (grey meshes) is its dot’s, as it is drawn', async () => {
    const { v, membrane, meshColor, params, dots } = await wrapped();
    const b = v.plugin.state.data.build();
    b.to(membrane).update((p: Record<string, unknown>) => ({ ...p, partColors: { VAC: 0xff0000 } }));
    await b.commit();
    expect(params().partColors).toEqual({ VAC: 0xff0000 });
    expect(dots()).toEqual([meshColor(0), 0xff0000]);
    // styled: its mesh painted, its own colour cleared (the mesh the one source again), one step
    const before = v.api.history.steps.value.length;
    expectOk(await v.api.run('mesoscale.style', { particles: membrane, parts: 'VAC', color: 'tomato' }));
    expect(v.api.history.steps.value.length).toBe(before + 1);
    expect(meshColor(1)).toBe(0xff6347);
    expect(params().partColors).toEqual({});
    expect(dots()).toEqual([meshColor(0), 0xff6347]);
  });

  // review N5: a part's eye and colour in one style, one step: its mesh painted and the part hidden, undone together
  it('a part’s eye and colour in one style are one step, undone together', async () => {
    const { v, membrane, meshColor, steps } = await wrapped();
    const cells = v.plugin.state.data.cells;
    const hidden = () => (cells.get(membrane)!.transform.params as { hiddenParts: readonly string[] }).hiddenParts;
    const grey = meshColor(1);
    const before = steps();
    expectOk(
      await v.api.run('mesoscale.style', { particles: membrane, parts: 'VAC', color: 'tomato', visible: false }),
    );
    expect(steps()).toBe(before + 1);
    expect(meshColor(1)).toBe(0xff6347);
    expect(hidden()).toEqual(['VAC']);
    expectOk(await v.api.history.undo({}));
    expect(meshColor(1)).toBe(grey);
    expect(hidden()).toEqual([]);
  });
});
