/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CustomProperties } from '@molstar/model/model/custom-property';
import type { ParticleList, ParticleTarget } from '@molstar/model/model/particles/particle-list';
import type { Structure } from '@molstar/model/model/structure';
import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';
import { ShellModel } from '@molstar/prism-ui/shell/shell';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { MesoscaleExplorerExtensions } from '../../extensions.js';
import { explorerUI } from '../ui.js';
import { CategoryThemes } from '../tree-view.js';

// Colors that follow the zoom in a model's Look (_spec/ui.md §4; color-levels.md), over a headless viewer in jsdom: a
// mesoscale model whose two targets are 1CRN (data/examples), drawn as targets. Ludo's check: the setting is in Look,
// one step, its edges adjustable; and in the category's color theme.

let structure: Structure;

function model(): ParticleList {
  const count = 3;
  const targets = Int32Array.from([0, 0, 1]);
  return {
    label: 'HIV',
    count,
    keys: Int32Array.from({ length: count }, (_, i) => i),
    targets,
    targetInfo: new Map([
      [0, { entity: 0 }],
      [1, { entity: 1 }],
    ]),
    targetMapping: new Map<number, ParticleTarget>([0, 1].map((t) => [t, { kind: 'structure', structure }])),
    entities: targets,
    entityInfo: new Map([
      [0, { name: 'CA' }],
      [1, { name: 'NC' }],
    ]),
    compartments: Int32Array.from([0, 0, 1]),
    compartmentInfo: new Map([
      [0, { name: 'capsid' }],
      [1, { name: 'interior' }],
    ]),
    coordinates: Float32Array.from({ length: count * 3 }, (_, i) => (i % 3 === 0 ? (i / 3) * 100 : 0)),
    getParticleLabel: (i) => `${i}`,
    sourceData: { kind: 'test', name: 'test', data: {} },
    customProperties: new CustomProperties(),
    _propertyData: Object.create(null),
  };
}

const TestModel = PluginStateTransform.BuiltIn({
  name: 'prism-me-test-zoom-model',
  display: { name: 'Test Zoom Model' },
  from: SO.Root,
  to: SO.Particle.List,
  params: {},
})({
  apply() {
    return new SO.Particle.List(model(), { label: 'HIV' });
  },
});

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
  const crn = new File(
    [readFileSync(resolve(import.meta.dirname, '../../../../../data/examples/1crn.cif'))],
    '1crn.cif',
  );
  const l = await v.api.load.files({ files: [crn] });
  if (!l.ok) throw new Error(l.message);
  structure = v.plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data;
  await v.plugin.build().toRoot().apply(TestModel).commit();
  const hiv = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
  const r = await v.api.particles.representation({ type: 'target', particles: hiv });
  if (!r.ok) throw new Error(r.message);
  return v;
}

async function until(check: () => boolean, ms = 10000) {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
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
const labelOf = (row: HTMLElement) => row.querySelector('[data-tip-overflow]')?.textContent ?? '';
const rowOf = (host: HTMLElement, label: string) =>
  items(host)
    .find((r) => labelOf(r) === label)
    ?.querySelector<HTMLElement>('[data-tree-row]') ?? undefined;
const button = (host: HTMLElement, text: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === text);
const levels = (v: PrismViewer) =>
  v.plugin.managers.particles.hierarchy.current.lists[0].representations.map(
    (r) =>
      (r.cell.transform.params as { type: { params: { structure: { colorLevels: { name: string } } } } }).type.params
        .structure.colorLevels.name,
  );

describe('colors that follow the zoom (Look)', () => {
  it("a model's Look turns them on, one step; its edges show then", async () => {
    const v = await viewer();
    const host = mountScene(v);
    await until(() => !!rowOf(host, 'HIV'));
    rowOf(host, 'HIV')!.click();
    await until(() => !!button(host, 'Look'));
    const look = button(host, 'Look')!;
    if (look.getAttribute('aria-expanded') !== 'true') look.click();
    await until(() => !!button(host, 'By zoom'));
    expect(host.querySelector('[aria-label^="Chain colors from"]')).toBeNull();
    const steps = v.api.history.steps.value.length;
    button(host, 'By zoom')!.click();
    await until(() => button(host, 'By zoom')!.getAttribute('aria-pressed') === 'true');
    expect(levels(v)).toEqual(['on']);
    expect(v.api.history.steps.value.length).toBe(steps + 1);
    await until(() => !!host.querySelector('[aria-label^="Chain colors from"]'));
  });

  it("the particles' category offers the theme by zoom", () => {
    expect(CategoryThemes['c:particles'].map(([id]) => id)).toContain('zoom');
  });
});
