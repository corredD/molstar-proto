/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { afterEach, describe, expect, it } from 'vitest';
import { domView } from '@molstar/prism-ui';
import { ShellModel } from '@molstar/prism-ui/shell/shell';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { MembraneDetailControls, MembraneSpeciesControls } from '../controls.js';
import { forgetLipidPatch, registerLipidPatch } from '../lipids/membrane.js';
import { MesoscaleExtension } from '../prism-viewer.js';
import { syntheticPatchPdb } from './lipid-fixtures.js';

// A lipid membrane's levels in its properties (`controls.tsx`, prism-me's Look; Ludo tunes them, 2026-11-08), over a
// headless viewer in jsdom: Custom shows each level's start, stride and bias, and the levels as text to copy.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
  document.body.innerHTML = '';
});

async function until(check: () => boolean, ms = 5000) {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('a membrane’s levels in its properties', () => {
  it('picks custom levels in one step and shows them as text', async () => {
    registerLipidPatch('ui-patch', syntheticPatchPdb().text);
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
    });
    viewers.push(v);
    const r = await v.api.mesoscale!.wrapMembrane({ radius: 300, edge: 80, patch: 'ui-patch' });
    if (!r.ok) throw new Error(r.message);
    const membrane = r.changed!.nodes![0];
    const host = document.createElement('div');
    document.body.append(host);
    const area = v.api.as({ kind: 'person' }).mesoscale!;
    domView(() => <MembraneDetailControls area={area} membrane={membrane} />).mount(
      host,
      { shell: new ShellModel() } as never,
      undefined as never,
    );
    const button = (label: string) =>
      [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
    await until(() => button('Balanced')?.getAttribute('aria-pressed') === 'true');
    expect(host.querySelector('code')).toBeNull();
    button('Custom').click();
    await until(() => !!host.querySelector('code'));
    expect(v.plugin.state.data.cells.get(membrane)!.transform.params).toMatchObject({ detail: 'custom' });
    // the levels after the first: a start, a stride and a bias each; the text Ludo copies
    const labels = new Set(
      [...host.querySelectorAll('[aria-label^="Level "]')].map((e) => e.getAttribute('aria-label')),
    );
    expect([...labels].sort()).toEqual(
      ['Level 2 bias', 'Level 2 from', 'Level 2 stride', 'Level 3 bias', 'Level 3 from', 'Level 3 stride'].sort(),
    );
    expect(host.querySelector('code')!.textContent).toBe('0 Å ×1 b1 · 2000 Å ×8 b2 · 8000 Å ×64 b2');
    // one step: undone, the preset again
    const undo = await v.api.history.undo({});
    expect(undo.ok).toBe(true);
    expect(v.plugin.state.data.cells.get(membrane)!.transform.params).toMatchObject({ detail: 'balanced' });
    forgetLipidPatch('ui-patch');
  });
  it('switches a membrane’s far look and its switches in one step each, tiles without Texture', async () => {
    registerLipidPatch('ui-patch-far', syntheticPatchPdb().text);
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
    });
    viewers.push(v);
    const r = await v.api.mesoscale!.wrapMembrane({ radius: 300, edge: 80, patch: 'ui-patch-far', method: 'cutter' });
    if (!r.ok) throw new Error(r.message);
    const membrane = r.changed!.nodes![0];
    const host = document.createElement('div');
    document.body.append(host);
    const area = v.api.as({ kind: 'person' }).mesoscale!;
    domView(() => <MembraneDetailControls area={area} membrane={membrane} />).mount(
      host,
      { shell: new ShellModel() } as never,
      undefined as never,
    );
    const button = (label: string) =>
      [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
    await until(() => button('Both')?.getAttribute('aria-pressed') === 'true');
    // the far look's own switches: Coarse's (Parallax the default since 2026-11-10, its middle test below)
    button('Coarse').click();
    await until(() => !!host.querySelector('[aria-label="Lipids down to"]'));
    button('Texture').click();
    await until(() => !!host.querySelector('[aria-label="Lipids from"]'));
    const params = () => v.plugin.state.data.cells.get(membrane)!.transform.params;
    expect(params()).toMatchObject({ far: 'texture' });
    // the operation checks its switches; a valid one is one step
    expect((await area.membraneDetail({ membrane, atomsPx: 100 } as never)).ok).toBe(false);
    expect((await area.membraneDetail({ membrane, atomsPx: 4 } as never)).ok).toBe(true);
    expect(params()).toMatchObject({ far: 'texture', atomsPx: 4 });
    expect((await v.api.history.undo({})).ok).toBe(true);
    expect(params()).toMatchObject({ far: 'texture', atomsPx: 2 });
    // tiles: the cutter's properties (round 4b item 5: one membrane, two generators), but no Texture (built whole: no
    // lipid dropped by its size on screen)
    const t = await v.api.mesoscale!.wrapMembrane({ radius: 300, edge: 80, patch: 'ui-patch-far' });
    const tiles = document.createElement('div');
    document.body.append(tiles);
    domView(() => <MembraneDetailControls area={area} membrane={t.changed!.nodes![0]} />).mount(
      tiles,
      { shell: new ShellModel() } as never,
      undefined as never,
    );
    await until(() => !!tiles.querySelector('button'));
    const labels = () => [...tiles.querySelectorAll('button')].map((b) => b.textContent?.trim());
    await until(() => labels().includes('Spheres'));
    expect(labels()).toContain('Both');
    expect(labels()).not.toContain('Texture');
    expect(tiles.querySelector('[aria-label="Lipids at most"]')).toBeNull();
    const tm = t.changed!.nodes![0];
    expect((await area.membraneDetail({ membrane: tm, far: 'texture' } as never)).ok).toBe(false);
    // nor a middle look: the cutter's far surface (gate X1)
    expect((await area.membraneDetail({ membrane: tm, middle: 'parallax' } as never)).ok).toBe(false);
    expect((await area.membraneDetail({ membrane: tm, middlePx: 14 } as never)).ok).toBe(false);
    expect((await area.membraneDetail({ membrane: tm, middle: 'shells', shells: 6 } as never)).ok).toBe(false);
    expect((await area.membraneDetail({ membrane: tm, far: 'spheres' } as never)).ok).toBe(true);
    // its species shown and hidden (a per-lipid mask: a tile mixes species), but no export: tiles are built whole
    const tilesSpecies = area.membraneSpeciesState(tm).value?.[0]?.name ?? 'X';
    expect((await area.membraneSpecies({ membrane: tm, species: tilesSpecies, shown: false } as never)).ok).toBe(true);
    expect((await area.exportMembrane({ membrane: tm } as never)).ok).toBe(false);
    forgetLipidPatch('ui-patch-far');
  });
  it('switches a cut membrane’s middle look in one step, its atoms’ px with it, shells and their count (round 8, 10)', async () => {
    registerLipidPatch('ui-patch-middle', syntheticPatchPdb().text);
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
    });
    viewers.push(v);
    const r = await v.api.mesoscale!.wrapMembrane({
      radius: 300,
      edge: 80,
      patch: 'ui-patch-middle',
      method: 'cutter',
    });
    if (!r.ok) throw new Error(r.message);
    const membrane = r.changed!.nodes![0];
    const host = document.createElement('div');
    document.body.append(host);
    const area = v.api.as({ kind: 'person' }).mesoscale!;
    domView(() => <MembraneDetailControls area={area} membrane={membrane} />).mount(
      host,
      { shell: new ShellModel() } as never,
      undefined as never,
    );
    const button = (label: string) =>
      [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
    const params = () => v.plugin.state.data.cells.get(membrane)!.transform.params;
    // parallax by default (Ludo, 2026-11-10): the atoms' px, no spheres' switch
    await until(() => button('Parallax')?.getAttribute('aria-pressed') === 'true');
    expect(host.querySelector('[aria-label="Atoms down to"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Lipids down to"]')).toBeNull();
    // coarse: the spheres' switch, no middle slider
    button('Coarse').click();
    await until(() => !!host.querySelector('[aria-label="Lipids down to"]'));
    expect(params()).toMatchObject({ middle: 'coarse' });
    expect(host.querySelector('[aria-label="Atoms down to"]')).toBeNull();
    button('Parallax').click();
    await until(() => !!host.querySelector('[aria-label="Atoms down to"]'));
    expect(params()).toMatchObject({ middle: 'parallax', middlePx: 11 });
    expect(host.querySelector('[aria-label="Lipids down to"]')).toBeNull();
    // the coarse rule's px sets the cut band (gate M1, S5): one slider for it, by Far's (Both: spheresPx, Texture:
    // atomsPx), never a switch that does nothing
    expect(host.querySelector('[aria-label="Cut lipids down to"]')).not.toBeNull();
    button('Texture').click();
    await until(() => params().far === 'texture');
    expect(host.querySelector('[aria-label="Lipids from"]')).toBeNull();
    expect(host.querySelector('[aria-label="Cut lipids down to"]')).not.toBeNull();
    button('Both').click();
    await until(() => params().far === 'both');
    // round 10 (S6): shells offered, one step, their count's slider and the cut band's with them
    expect(host.querySelector('[aria-label="Shells"]')).toBeNull();
    button('Shells').click();
    await until(() => !!host.querySelector('[aria-label="Shells"]'));
    expect(params()).toMatchObject({ middle: 'shells', shells: 8 });
    expect(host.querySelector('[aria-label="Atoms down to"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Cut lipids down to"]')).not.toBeNull();
    expect((await v.api.history.undo({})).ok).toBe(true);
    await until(() => params().middle === 'parallax' && !host.querySelector('[aria-label="Shells"]'));
    // the operation takes shells and their count, in its range, one step
    expect((await area.membraneDetail({ membrane, middle: 'shells', shells: 6 } as never)).ok).toBe(true);
    expect(area.membraneDetailState(membrane).value).toMatchObject({ middle: 'shells', shells: 6 });
    expect((await area.membraneDetail({ membrane, shells: 13 } as never)).ok).toBe(false);
    expect((await v.api.history.undo({})).ok).toBe(true);
    expect(params()).toMatchObject({ middle: 'parallax', shells: 8 });
    // the operation checks its switches; a valid one is one step
    expect((await area.membraneDetail({ membrane, middlePx: 100 } as never)).ok).toBe(false);
    // atoms only down to the stride-1 px (8.8 a lipid): lower would draw atoms the levels draw as spheres (gate S1)
    expect((await area.membraneDetail({ membrane, middle: 'parallax', middlePx: 2 } as never)).ok).toBe(false);
    expect((await area.membraneDetail({ membrane, middlePx: 8.5 } as never)).ok).toBe(false);
    const knob = host.querySelector('input[type="range"][aria-label="Atoms down to"]');
    expect(Number(knob?.getAttribute('min'))).toBeCloseTo(Math.log10(9), 3);
    expect((await area.membraneDetail({ membrane, middlePx: 14 } as never)).ok).toBe(true);
    expect(area.membraneDetailState(membrane).value).toMatchObject({ middle: 'parallax', middlePx: 14 });
    expect((await v.api.history.undo({})).ok).toBe(true);
    expect(params()).toMatchObject({ middle: 'parallax', middlePx: 11 });
    // Far: Spheres has no middle look
    button('Spheres').click();
    await until(() => !host.querySelector('[aria-label="Atoms down to"]') && !button('Parallax'));
    forgetLipidPatch('ui-patch-middle');
  });
  it('shows, hides and colors a membrane’s species, and sets its graphics mode, one step each', async () => {
    registerLipidPatch('ui-patch-species', syntheticPatchPdb().text);
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
    });
    viewers.push(v);
    const area = v.api.as({ kind: 'person' }).mesoscale!;
    const r = await area.wrapMembrane({ radius: 300, edge: 80, patch: 'ui-patch-species', method: 'cutter' } as never);
    if (!r.ok) throw new Error(r.message);
    const membrane = r.changed!.nodes![0];
    const species = area.membraneSpeciesState(membrane);
    const names = species.value!.map((s) => s.name);
    expect(names.length).toBeGreaterThan(1);
    expect((await area.membraneSpecies({ membrane, species: 'NOPE', shown: false } as never)).ok).toBe(false);
    expect((await area.membraneSpecies({ membrane, species: names[0], shown: false } as never)).ok).toBe(true);
    expect((await area.membraneSpecies({ membrane, species: names[1], color: 0xff0000 } as never)).ok).toBe(true);
    const params = () => v.plugin.state.data.cells.get(membrane)!.transform.params;
    expect(params()).toMatchObject({ hiddenSpecies: [names[0]], speciesColors: { [names[1]]: 0xff0000 } });
    expect(area.membraneSpeciesState(membrane).value!.slice(0, 2)).toMatchObject([
      { name: names[0], shown: false },
      { name: names[1], shown: true, color: 0xff0000 },
    ]);
    expect((await v.api.history.undo({})).ok).toBe(true);
    expect(params()).toMatchObject({ speciesColors: {} });
    // its rows in the Look: an eye a species, one step
    const host = document.createElement('div');
    document.body.append(host);
    domView(() => <MembraneSpeciesControls area={area} membrane={membrane} />).mount(
      host,
      { shell: new ShellModel() } as never,
      undefined as never,
    );
    const eye = () =>
      [...host.querySelectorAll('button')].find((b) =>
        [b.getAttribute('title'), b.getAttribute('aria-label'), b.getAttribute('data-tip')].includes(
          `${names[0]}: shown or hidden`,
        ),
      ) as HTMLButtonElement;
    await until(() => !!eye());
    eye().click();
    await until(() => !(params().hiddenSpecies as string[]).includes(names[0]));
    // a species' swatch shows the colour drawn; its picker previews and Apply commits once (review M3, S5)
    const swatchOf = (n: string) =>
      [...host.querySelectorAll('button')].find((b) =>
        [b.getAttribute('title'), b.getAttribute('aria-label'), b.getAttribute('data-tip')].includes(
          `${n}: its colour`,
        ),
      ) as HTMLButtonElement;
    const shown = area.membraneSpeciesState(membrane).value!.find((x) => x.name === names[1])!;
    expect(swatchOf(shown.name).querySelector('span')!.getAttribute('style')).toMatch(/background: #/);
    swatchOf(shown.name).click();
    const apply = () => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Apply');
    await until(() => !!apply());
    const before = JSON.stringify(params().speciesColors);
    apply()!.click();
    await until(() => (params().speciesColors as Record<string, number>)[shown.name] !== undefined);
    expect((params().speciesColors as Record<string, number>)[shown.name]).toBe(shown.shownColor);
    // one step: undone, the colours as before
    expect((await v.api.history.undo({})).ok).toBe(true);
    expect(JSON.stringify(params().speciesColors)).toBe(before);
    // the full build at export: every lipid of its shown species, no step
    const exported = await area.exportMembrane({ membrane } as never);
    expect(exported.ok).toBe(true);
    expect((exported as { did: string }).did).toMatch(/Exported [1-9][\d,]* lipids/);
    // Object graphics' quality: the levels' preset
    expect((await area.graphics({ mode: 'performance', object: membrane } as never)).ok).toBe(true);
    expect(params()).toMatchObject({ detail: 'performance' });
    forgetLipidPatch('ui-patch-species');
  });
});
