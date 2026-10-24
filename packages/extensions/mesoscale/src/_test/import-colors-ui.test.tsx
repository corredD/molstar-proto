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
import { ImportColors } from '../controls.js';
import { MesoscaleExtension } from '../prism-viewer.js';
import { TestParticleList } from './fixtures.js';

// Import colors… (`controls.tsx`, a model's Look in prism-me) over a headless viewer with two models, in jsdom: the file
// picked runs `mesoscale.importColors` on the model the control was made for, the input is emptied (the same file can
// be picked again). No network.

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

async function twoModels() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
  });
  viewers.push(v);
  await v.plugin.build().toRoot().apply(TestParticleList).commit();
  await v.plugin.build().toRoot().apply(TestParticleList).commit();
  const refs = v.plugin.managers.particles.hierarchy.current.lists.map((l) => l.cell.transform.ref);
  for (const particles of refs) {
    const r = await v.api.run('particles.representation', { type: 'spacefill', particles });
    if (!r.ok) throw new Error(r.message);
  }
  return { v, refs };
}

/** The control for `particles`, mounted; its file input, whose `value` writes are recorded */
function mount(v: PrismViewer, particles: string) {
  const area = v.api.as({ kind: 'person' }).mesoscale!;
  const host = document.createElement('div');
  document.body.append(host);
  domView(() => <ImportColors area={area} particles={particles} />).mount(
    host,
    { shell: new ShellModel() } as never,
    undefined as never,
  );
  const input = host.querySelector('input[type=file]') as HTMLInputElement;
  const values: string[] = [];
  Object.defineProperty(input, 'value', { configurable: true, get: () => '', set: (x: string) => values.push(x) });
  const pick = (file: File) => {
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change'));
  };
  return { host, input, values, pick };
}

const colorOf = async (v: PrismViewer, particles: string, name: string) => {
  const r = await v.api.mesoscale!.entities({ particles });
  if (!r.ok) throw new Error(r.message);
  return (r.value as { entities: { name: string; color?: number }[] }).entities.find((e) => e.name === name)?.color;
};

describe('Import colors…', () => {
  it('runs mesoscale.importColors with its model’s ref, the other model untouched, and empties the input', async () => {
    const { v, refs } = await twoModels();
    const { host, values, pick } = mount(v, refs[1]);
    expect(host.querySelector('button')?.textContent).toContain('Import colors');
    pick(new File([JSON.stringify({ CA: '#ff0000' })], 'colors.json', { type: 'application/json' }));
    await until(() => v.managers.notifications.history.value.length > 0);
    expect(v.managers.notifications.history.value[0].text).toContain('Colored 1 entity');
    expect(await colorOf(v, refs[1], 'CA')).toBe(0xff0000);
    expect(await colorOf(v, refs[0], 'CA')).toBeUndefined();
    expect(values).toEqual(['']);
  });
});
