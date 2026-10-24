/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { CustomProperties } from '@molstar/model/model/custom-property';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { ShellModel } from '@molstar/prism-ui/shell/shell';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { MesoscaleExplorerExtensions } from '../../extensions.js';
import { removeObject } from '../menu.js';
import { explorerUI, sceneModelOf } from '../ui.js';

// The Group by switch in a model's properties (_spec/ui.md §4) and the tree following it (§3), over a headless viewer
// in jsdom, with two cellPACK-like models made in memory: lipids (function "membrane") in the membrane, CA and NC in
// the capsid surface, one entity without a compartment. The second model's compartments are under `cell`, not `root`.

function cellpackLike(label: string, root: string): ParticleList {
  const rows: [number, number][] = [
    [0, 0],
    [0, 0],
    [1, 1],
    [2, 1],
    [2, 1],
    [3, -1],
  ];
  const count = rows.length;
  return {
    label,
    count,
    keys: Int32Array.from(rows, (_, i) => i),
    targets: Int32Array.from(rows, ([t]) => t),
    targetInfo: new Map([0, 1, 2, 3].map((t) => [t, { entity: t }])),
    entityInfo: new Map([
      [0, { name: 'lipids', function: 'membrane' }],
      [1, { name: 'CA' }],
      [2, { name: 'NC' }],
      [3, { name: 'loose' }],
    ]),
    compartments: Int32Array.from(rows, ([, c]) => c),
    compartmentInfo: new Map([
      [0, { name: `${root}.envelope.membrane` }],
      [1, { name: `${root}.envelope.capsid` }],
    ]),
    coordinates: Float32Array.from({ length: count * 3 }, (_, i) => (i % 3 === 0 ? (i / 3) * 10 : 0)),
    getParticleLabel: (i) => `${i}`,
    sourceData: { kind: 'test', name: 'test', data: {} },
    customProperties: new CustomProperties(),
    _propertyData: Object.create(null),
  };
}

const TestModel = PluginStateTransform.BuiltIn({
  name: 'prism-me-test-mesoscale-model',
  display: { name: 'Test Mesoscale Model' },
  from: SO.Root,
  to: SO.Particle.List,
  params: { label: PD.Text('HIV'), root: PD.Text('root') },
})({
  apply({ params }) {
    return new SO.Particle.List(cellpackLike(params.label, params.root), { label: params.label });
  },
});

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
  persons.clear();
  document.body.innerHTML = '';
});

async function viewer() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
  });
  viewers.push(v);
  await v.plugin.build().toRoot().apply(TestModel, { label: 'HIV', root: 'root' }).commit();
  await v.plugin.build().toRoot().apply(TestModel, { label: 'Other', root: 'cell' }).commit();
  for (const l of v.plugin.managers.particles.hierarchy.current.lists) {
    const r = await v.api.particles.representation({ type: 'spacefill', particles: l.cell.transform.ref });
    if (!r.ok) throw new Error(r.message);
  }
  return v;
}

async function until(check: () => boolean, ms = 10000) {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** The person's API each viewer's scene was mounted with (its explorer area keys the scene's state) */
const persons = new Map<PrismViewer, ReturnType<PrismViewer['api']['as']>>();

function mountScene(v: PrismViewer) {
  const api = v.api.as({ kind: 'person' });
  persons.set(v, api);
  const ui = explorerUI({ api, sources: v.sources, managers: v.managers });
  const host = document.createElement('div');
  document.body.append(host);
  ui.tabs![0].render.mount(host, { shell: new ShellModel() } as never, undefined as never);
  return host;
}

const items = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('[role=treeitem]'));
const labelOf = (row: HTMLElement) => row.querySelector('span[style*="flex: 1; min-width: 0"]')?.textContent ?? '';
const rowOf = (host: HTMLElement, label: string) => items(host).find((r) => labelOf(r) === label);
/** The rows under a model's row, until the next row at its level, as [label, level] */
const childrenOf = (host: HTMLElement, model: string) => {
  const all = items(host);
  const at = all.findIndex((r) => labelOf(r) === model);
  const level = Number(all[at].getAttribute('aria-level'));
  const out: HTMLElement[] = [];
  for (const r of all.slice(at + 1)) {
    if (Number(r.getAttribute('aria-level')) <= level) break;
    out.push(r);
  }
  return out;
};
const outline = (rows: HTMLElement[]) => rows.map((r) => `${r.getAttribute('aria-level')}:${labelOf(r)}`);
const unfold = (row: HTMLElement) => (row.querySelector('button[aria-label="Unfold"]') as HTMLButtonElement).click();
const choice = (host: HTMLElement, label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('[aria-label="Group by"] button')).find(
    (b) => b.textContent === label,
  );

describe("a model's Group by", () => {
  it("regroups that model's rows by function and back, the other model's rows kept as they are", async () => {
    const v = await viewer();
    const host = mountScene(v);
    await until(() => !!rowOf(host, 'HIV') && !!rowOf(host, 'Other'));
    unfold(rowOf(host, 'HIV')!);
    unfold(rowOf(host, 'Other')!);
    await until(() => childrenOf(host, 'HIV').length > 0 && childrenOf(host, 'Other').length > 0);
    expect(outline(childrenOf(host, 'HIV'))).toEqual(['3:root', '3:loose']);
    const others = childrenOf(host, 'Other');
    expect(outline(others)).toEqual(['3:cell', '3:loose']);

    // the model picked: its properties have the switch, by compartment
    rowOf(host, 'HIV')!.click();
    await until(() => !!choice(host, 'Function'));
    expect(choice(host, 'Compartment')!.getAttribute('aria-pressed')).toBe('true');

    choice(host, 'Function')!.click();
    await until(() => outline(childrenOf(host, 'HIV')).includes('3:membrane'));
    expect(outline(childrenOf(host, 'HIV'))).toEqual(['3:membrane', '3:unknown function']);
    expect(choice(host, 'Function')!.getAttribute('aria-pressed')).toBe('true');
    // the other model's rows: the same elements, not made again
    expect(childrenOf(host, 'Other')).toEqual(others);
    expect(childrenOf(host, 'Other').every((r, i) => r === others[i])).toBe(true);

    choice(host, 'Compartment')!.click();
    await until(() => outline(childrenOf(host, 'HIV'))[0] === '3:root');
    expect(outline(childrenOf(host, 'HIV'))).toEqual(['3:root', '3:loose']);
    expect(childrenOf(host, 'Other').every((r, i) => r === others[i])).toBe(true);
  });

  it("hides exactly a function group's entities with its eye", async () => {
    const v = await viewer();
    const host = mountScene(v);
    await until(() => !!rowOf(host, 'HIV'));
    unfold(rowOf(host, 'HIV')!);
    rowOf(host, 'HIV')!.click();
    await until(() => !!choice(host, 'Function'));
    choice(host, 'Function')!.click();
    await until(() => !!rowOf(host, 'unknown function'));
    (rowOf(host, 'unknown function')!.querySelector('button[aria-label="Show or hide"]') as HTMLButtonElement).click();
    const hidden = (ref: string) =>
      v.api
        .mesoscale!.infoState(ref)
        .value!.entities.filter((e) => !e.visible)
        .map((e) => e.name);
    const [hiv, other] = v.api.explorer!.objectsState().value.filter((o) => o.kind === 'model');
    await until(() => hidden(hiv.ref).length > 0);
    expect(hidden(hiv.ref)).toEqual(['CA', 'NC', 'loose']);
    expect(hidden(other.ref)).toEqual([]);
  });

  it("forgets a removed model's grouping and parts", async () => {
    const v = await viewer();
    const host = mountScene(v);
    await until(() => !!rowOf(host, 'HIV'));
    rowOf(host, 'HIV')!.click();
    await until(() => !!choice(host, 'Function'));
    choice(host, 'Function')!.click();
    const person = persons.get(v)!;
    const scene = sceneModelOf(person.explorer!)!;
    const [hiv] = v.api.explorer!.objectsState().value.filter((o) => o.kind === 'model');
    await until(() => scene.groupings.get(hiv.ref) === 'function' && !!scene.parts.value.get(hiv.ref));
    const r = await removeObject(person, person.explorer!, 'mesoscale model', hiv.ref);
    expect(r?.ok).toBe(true);
    await until(() => !rowOf(host, 'HIV'));
    expect(scene.groupings.values.has(hiv.ref)).toBe(false);
    expect(scene.parts.value.has(hiv.ref)).toBe(false);
  });
});
