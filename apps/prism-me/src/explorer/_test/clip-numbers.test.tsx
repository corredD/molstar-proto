/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ShellModel } from '@molstar/prism-ui/shell/shell';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { MesoscaleExplorerExtensions } from '../../extensions.js';
import { explorerUI } from '../ui.js';

// A clip's numbers in an object's properties (_spec/ui.md §4, Clips), over a headless viewer in jsdom: 1CRN
// (data/examples), a plane and a sphere clip on it. Each clip's line has its numbers' toggle (view state, no step);
// open, its place, turn and size (its shape's) as sliders; a release or a typed value is one `clipping.update`, one
// step; a change from elsewhere shows in them.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
  document.body.innerHTML = '';
});

async function until(check: () => boolean, ms = 10000) {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const Toggle = 'Its place, turn and size, by numbers';
const buttons = (host: HTMLElement, text: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent?.trim() === text);
const toggles = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.getAttribute('aria-label') === Toggle);
const items = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('[role=treeitem]'));
const rowOf = (host: HTMLElement, label: string) =>
  items(host).find((r) => r.querySelector('span[style*="flex: 1; min-width: 0"]')?.textContent === label);
/** A slider's typed box (not its range), by its label */
const boxes = (host: HTMLElement, label: string) =>
  Array.from(host.querySelectorAll<HTMLInputElement>(`input[aria-label="${label}"]`)).filter((i) => i.type !== 'range');
const ranges = (host: HTMLElement, label: string) =>
  Array.from(host.querySelectorAll<HTMLInputElement>(`input[type=range][aria-label="${label}"]`));

describe("a clip's numbers in the properties", () => {
  it('open per clip, no step; a typed value and a release are one step each; a change elsewhere shows', async () => {
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
    const ref = v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
    for (const shape of ['plane', 'sphere']) {
      const c = await v.api.run('clipping.add', { shape, node: ref });
      if (!c.ok) throw new Error(c.message);
    }
    const cuts = () => v.api.clipping.cuts.value;
    const sphere = () => cuts().find((c) => c.object.type === 'sphere')!;

    const api = v.api.as({ kind: 'person' });
    const ui = explorerUI({ api, sources: v.sources, managers: v.managers });
    const host = document.createElement('div');
    document.body.append(host);
    ui.tabs![0].render.mount(host, { shell: new ShellModel() } as never, undefined as never);
    await until(() => !!rowOf(host, '1CRN'));
    rowOf(host, '1CRN')!.click();
    await until(() => buttons(host, 'Clips').length > 0);
    const section = buttons(host, 'Clips')[0];
    if (section.getAttribute('aria-expanded') !== 'true') section.click();
    await until(() => toggles(host).length === 2);
    const steps = () => v.api.history.steps.value.length;
    const n = steps();
    expect(toggles(host).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false']);
    expect(boxes(host, 'X')).toHaveLength(0);

    // the sphere's numbers (the second line): its place, turn and diameter; the plane's stay closed
    const sphereLine = cuts().findIndex((c) => c.object.type === 'sphere');
    toggles(host)[sphereLine].click();
    await until(() => boxes(host, 'X').length === 1);
    expect(toggles(host).map((b) => b.getAttribute('aria-pressed'))).toEqual(
      sphereLine === 1 ? ['false', 'true'] : ['true', 'false'],
    );
    for (const label of ['Y', 'Z', 'Turn X', 'Turn Y', 'Turn Z', 'Diameter'])
      expect(boxes(host, label)).toHaveLength(1);
    expect(steps()).toBe(n);

    // a typed value: one step, the cut there
    const x0 = sphere().object.position[0];
    const box = boxes(host, 'X')[0];
    box.value = String(x0 + 5);
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => Math.abs(sphere().object.position[0] - (x0 + 5)) < 1e-6);
    expect(steps()).toBe(n + 1);

    // a slider's drag and release: one step, its diameter
    const d0 = sphere().object.scale[0];
    const range = ranges(host, 'Diameter')[0];
    for (const delta of [1, 2, 3]) {
      range.value = String(Number(range.value) + delta * 0.01);
      range.dispatchEvent(new Event('input', { bubbles: true }));
    }
    range.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => sphere().object.scale[0] !== d0);
    await new Promise((r) => setTimeout(r, 50));
    expect(steps()).toBe(n + 2);

    // a change from elsewhere (an undo) shows in the open numbers
    await v.api.run('history.undo', {});
    await until(() => sphere().object.scale[0] === d0);
    const y = sphere().object.position[1];
    await v.api.run('clipping.update', {
      tag: sphere().object.tag,
      position: [x0, y + 3, sphere().object.position[2]],
    });
    await until(() => Number(boxes(host, 'Y')[0].value) === Math.round((y + 3) * 10) / 10);

    // closed again: no numbers, no step
    const before = steps();
    toggles(host)[sphereLine].click();
    await until(() => boxes(host, 'X').length === 0);
    expect(steps()).toBe(before);
  });

  it("a plane's numbers have no size", async () => {
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
    const ref = v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
    const c = await v.api.run('clipping.add', { shape: 'plane', node: ref });
    if (!c.ok) throw new Error(c.message);
    const api = v.api.as({ kind: 'person' });
    const ui = explorerUI({ api, sources: v.sources, managers: v.managers });
    const host = document.createElement('div');
    document.body.append(host);
    ui.tabs![0].render.mount(host, { shell: new ShellModel() } as never, undefined as never);
    await until(() => !!rowOf(host, '1CRN'));
    rowOf(host, '1CRN')!.click();
    await until(() => buttons(host, 'Clips').length > 0);
    const section = buttons(host, 'Clips')[0];
    if (section.getAttribute('aria-expanded') !== 'true') section.click();
    await until(() => toggles(host).length === 1);
    toggles(host)[0].click();
    await until(() => boxes(host, 'X').length === 1);
    for (const label of ['Turn X', 'Turn Y', 'Turn Z']) expect(boxes(host, label)).toHaveLength(1);
    for (const label of ['Diameter', 'Size X', 'Height', 'Angle']) expect(boxes(host, label)).toHaveLength(0);

    // a turn typed (Turn Y, as Position's: X, then Y, then Z) is the cut's rotation, and reads back the same; from
    // no turn (a new plane faces the viewer)
    const tag = v.api.clipping.cuts.value[0].object.tag;
    await v.api.run('clipping.update', { tag, rotation: { axis: [1, 0, 0], angle: 0 } });
    await until(() => boxes(host, 'Turn X')[0].value === '0' && boxes(host, 'Turn Z')[0].value === '0');
    const box = boxes(host, 'Turn Y')[0];
    box.value = '30';
    box.dispatchEvent(new Event('change', { bubbles: true }));
    const rotation = () => v.api.clipping.cuts.value[0].object.rotation;
    await until(() => Math.abs(rotation().angle - 30) < 1e-6);
    expect(Math.abs(rotation().axis[1])).toBeCloseTo(1, 6);
    await until(() => boxes(host, 'Turn Y')[0].value === '30');
    expect(boxes(host, 'Turn X')[0].value).toBe('0');
  });
});
