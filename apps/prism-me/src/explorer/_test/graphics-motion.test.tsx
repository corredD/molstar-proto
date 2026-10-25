/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Mat4, Tensor } from '@molstar/core/math/linear-algebra';
import { CCP4Writer } from '@molstar/model/formats/writer/ccp4/ccp4';
import { CustomProperties } from '@molstar/model/model/custom-property';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import type { Grid } from '@molstar/model/model/volume';
import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';
import { ShellModel } from '@molstar/prism-ui/shell/shell';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { MesoscaleExplorerExtensions } from '../../extensions.js';
import { explorerUI } from '../ui.js';

// Graphics & Motion in an object's properties (_spec/ui.md §4), over a headless viewer in jsdom: 1CRN
// (data/examples), a mesoscale model and a RELION list made in memory, a small map. Ludovic's check: each object shows
// what applies to it (a volume, quality only; a part, nothing), and a change acts on the object picked alone.

function model(): ParticleList {
  const count = 3;
  return {
    label: 'HIV',
    count,
    keys: Int32Array.from({ length: count }, (_, i) => i),
    targets: Int32Array.from([0, 0, 1]),
    targetInfo: new Map([
      [0, { entity: 0 }],
      [1, { entity: 1 }],
    ]),
    entityInfo: new Map([
      [0, { name: 'CA' }],
      [1, { name: 'NC' }],
    ]),
    coordinates: Float32Array.from({ length: count * 3 }, (_, i) => (i % 3 === 0 ? (i / 3) * 10 : 0)),
    getParticleLabel: (i) => `${i}`,
    sourceData: { kind: 'test', name: 'test', data: {} },
    customProperties: new CustomProperties(),
    _propertyData: Object.create(null),
  };
}

const TestModel = PluginStateTransform.BuiltIn({
  name: 'prism-me-test-graphics-model',
  display: { name: 'Test Graphics Model' },
  from: SO.Root,
  to: SO.Particle.List,
  params: {},
})({
  apply() {
    return new SO.Particle.List(model(), { label: 'HIV' });
  },
});

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

const star = 'data_particles\n\nloop_\n_rlnCoordinateX #1\n_rlnCoordinateY #2\n_rlnCoordinateZ #3\n10 0 0\n20 0 0\n';

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
  document.body.innerHTML = '';
});

async function viewer() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
  });
  viewers.push(v);
  await v.plugin.build().toRoot().apply(TestModel).commit();
  const hiv = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
  const r = await v.api.particles.representation({ type: 'spacefill', particles: hiv });
  if (!r.ok) throw new Error(r.message);
  const crn = new File(
    [readFileSync(resolve(import.meta.dirname, '../../../../../data/examples/1crn.cif'))],
    '1crn.cif',
  );
  for (const f of [crn, new File([star], 'list.star'), mapFile('map.mrc', 10)]) {
    const l = await v.api.load.files({ files: [f] });
    if (!l.ok) throw new Error(l.message);
  }
  return v;
}

async function until(check: () => boolean, ms = 10000) {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out: ${items(document.body).map(labelOf).join(', ')}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

function mountScene(v: PrismViewer) {
  const api = v.api.as({ kind: 'person' });
  const ui = explorerUI({ api, sources: v.sources, managers: v.managers });
  const host = document.createElement('div');
  document.body.append(host);
  ui.tabs![0].render.mount(host, { shell: new ShellModel() } as never, undefined as never);
  return host;
}

const items = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('[role=treeitem]'));
const labelOf = (row: HTMLElement) => row.querySelector('span[style*="flex: 1; min-width: 0"]')?.textContent ?? '';
const rowOf = (host: HTMLElement, label: string) => items(host).find((r) => labelOf(r) === label);
const button = (host: HTMLElement, text: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === text);
const quality = (host: HTMLElement, label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('[aria-label="Quality"] button')).find(
    (b) => b.textContent === label,
  );

/** Picks a row and opens its Graphics & Motion; what it shows: Quality, Wiggle, Tumble */
async function graphicsOf(host: HTMLElement, label: string) {
  rowOf(host, label)!.click();
  await until(() => !!button(host, 'Graphics & Motion'));
  const section = button(host, 'Graphics & Motion')!;
  if (section.getAttribute('aria-expanded') !== 'true') section.click();
  await until(() => !!quality(host, 'Fast'));
  return ['Quality', 'Wiggle amplitude', 'Tumble amplitude']
    .filter((l) => !!host.querySelector(`[aria-label="${l}"]`))
    .map((l) => l.split(' ')[0]);
}

describe('Graphics & Motion', () => {
  it('shows what applies to each object: quality, wiggle and tumble; a volume quality only; a part nothing', async () => {
    const v = await viewer();
    const host = mountScene(v);
    await until(() => ['HIV', '1CRN', 'list.star', 'map.mrc'].every((l) => !!rowOf(host, l)));
    expect(await graphicsOf(host, '1CRN')).toEqual(['Quality', 'Wiggle', 'Tumble']);
    expect(await graphicsOf(host, 'HIV')).toEqual(['Quality', 'Wiggle', 'Tumble']);
    expect(await graphicsOf(host, 'list.star')).toEqual(['Quality', 'Wiggle', 'Tumble']);
    expect(await graphicsOf(host, 'map.mrc')).toEqual(['Quality']);
    // a part (the model's entity): no section of its own
    (rowOf(host, 'HIV')!.querySelector('button[aria-label="Unfold"]') as HTMLButtonElement).click();
    await until(() => !!rowOf(host, 'CA'));
    rowOf(host, 'CA')!.click();
    await until(() => !button(host, 'Graphics & Motion'));
  });

  it("sets the model's quality and wiggles 1CRN, each alone, one step each", async () => {
    const v = await viewer();
    const host = mountScene(v);
    await until(() => ['HIV', '1CRN'].every((l) => !!rowOf(host, l)));
    const params = () =>
      v.plugin.managers.structure.hierarchy.current.structures[0].components
        .flatMap((c) => c.representations)
        .map((r) => JSON.stringify(r.cell.transform.params));
    const crn = params();
    const steps = v.api.history.steps.value.length;

    await graphicsOf(host, 'HIV');
    quality(host, 'Fast')!.click();
    await until(() => quality(host, 'Fast')!.getAttribute('aria-pressed') === 'true');
    expect(params()).toEqual(crn);
    expect(v.api.history.steps.value.length).toBe(steps + 1);

    await graphicsOf(host, '1CRN');
    expect(quality(host, 'Fast')!.getAttribute('aria-pressed')).not.toBe('true');
    button(host, 'Wiggle')!.click();
    await until(() => button(host, 'Wiggle')!.getAttribute('aria-pressed') === 'true');
    expect(v.api.history.steps.value.length).toBe(steps + 2);
    const hiv = v.plugin.managers.particles.hierarchy.current.lists.find((l) => l.cell.obj?.label === 'HIV')!;
    const animation = (p: unknown) =>
      (p as { type: { params: { animation?: { wiggleAmplitude: number } } } }).type.params.animation;
    expect(hiv.representations.every((r) => (animation(r.cell.transform.params)?.wiggleAmplitude ?? 0) === 0)).toBe(
      true,
    );
    expect(params().every((p) => animation(JSON.parse(p))?.wiggleAmplitude === 1)).toBe(true);
  });
});
