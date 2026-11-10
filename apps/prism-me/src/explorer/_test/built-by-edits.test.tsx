/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// @module-tag medium

import {
  exosomeDoc,
  ExosomeRecipe,
  syntheticPicksStar,
  syntheticVesicleObj,
} from '../../../../../packages/mesoscale/spec/src/examples/index.js';
import { DefaultResolvers } from '../../../../../packages/mesoscale/spec/src/resolvers/index.js';
import type { ResolveJob } from '../../../../../packages/mesoscale/spec/src/runtime/index.js';
import { createMesoViewSpecExtension } from '../../../../../packages/mesoscale/molstar/src/extension.js';
import type { MesoViewSpecApi } from '@molstar/meso-molstar';
import { createMesoscaleExplorerSpec } from '@molstar/prism-me-app/spec';
import { ShellModel } from '@molstar/prism-ui/shell/shell';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { documentKey } from '../document.js';
import { explorerUI, sceneModelOf } from '../ui.js';

// Built by's controls (prism.md §4.3, §12.2 lane 6): the population's count, the model's seed, Add relax stage. Each is
// a patch through `mesoviewspec.edit` (one step); a value the document would refuse is said under the field and nothing
// is sent. Over a headless viewer in jsdom with the exosome open.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
  document.body.innerHTML = '';
});

async function until(check: () => boolean, ms = 60000) {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/**
 * A gate on `m.recipe`'s resolution: while held, its resolver waits (and stops when the run's signal fires), so what
 * shows while an edit resolves, and a Cancel, never race the packer. Open, the resolvers run as they are.
 */
function gate() {
  let held = false;
  let open: (() => void) | undefined;
  const stopped = () => Object.assign(new Error('stopped'), { name: 'AbortError' });
  const wait = (signal: AbortSignal | undefined) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(stopped());
      open = resolve;
      signal?.addEventListener('abort', () => reject(stopped()), { once: true });
    });
  const resolvers = DefaultResolvers.map((r) => ({
    ...r,
    resolve: (input: unknown, job: ResolveJob) =>
      held && job.model.id === 'm.recipe'
        ? wait(job.signal).then(() => r.resolve(input as never, job))
        : r.resolve(input as never, job),
  })) as typeof DefaultResolvers;
  return {
    resolvers,
    hold: () => {
      held = true;
    },
    release: () => {
      held = false;
      open?.();
    },
  };
}

async function mounted() {
  const spec = createMesoscaleExplorerSpec('');
  const v = await createPrismViewerHeadless({
    spec: { ...spec, extensions: (spec.extensions ?? []).filter((e) => e.id !== 'mesoviewspec') },
  });
  viewers.push(v);
  const held = gate();
  await v.extensions.mount(
    createMesoViewSpecExtension({ fetchText: async () => undefined, resolvers: held.resolvers }),
  );
  const r = await v.api.run('mesoviewspec.open', {
    data: JSON.stringify(exosomeDoc()),
    files: [
      new File([JSON.stringify(ExosomeRecipe)], 'exosome.cellpack-gpu.json'),
      new File([syntheticPicksStar()], 'catalase_picks.star'),
      new File([syntheticVesicleObj()], 'membrane.obj'),
    ],
  });
  if (!r.ok) throw new Error(r.message);
  const api = v.api.as({ kind: 'person' });
  const ui = explorerUI({ api, sources: v.sources, managers: v.managers });
  const host = document.createElement('div');
  document.body.append(host);
  ui.tabs![0].render.mount(host, { shell: new ShellModel() } as never, undefined as never);
  const scene = sceneModelOf(api.explorer!)!;
  const owner = (v.api as never as { mesoviewspec: MesoViewSpecApi }).mesoviewspec;
  const steps = () => v.managers.history.steps.value.length;
  return { v, host, scene, owner, steps, gate: held };
}
type Mounted = Awaited<ReturnType<typeof mounted>>;

const section = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`[data-section="${id}"]`);
const header = (host: HTMLElement, id: string) => section(host, id)?.querySelector<HTMLButtonElement>('button');
async function openBuiltBy(m: Mounted, population = 'p.catalase') {
  const row = m.scene.documentTree()!.outline.row(population)!;
  m.scene.picked.set({
    key: documentKey(row.id),
    label: row.label,
    kind: 'population',
    doc: { id: row.id, select: `(population ${row.id})` },
  });
  await until(() => !!header(m.host, 'built-by'));
  if (header(m.host, 'built-by')!.getAttribute('aria-expanded') !== 'true') header(m.host, 'built-by')!.click();
}
const field = (m: Mounted, label: string) =>
  section(m.host, 'built-by')?.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
async function enter(input: HTMLInputElement, text: string) {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}
const countOf = (m: Mounted) =>
  (m.owner.model.doc!.populations.find((p) => p.id === 'p.catalase')!.abundance as { count: number }).count;
const buttons = (m: Mounted) => Array.from(section(m.host, 'built-by')!.querySelectorAll<HTMLButtonElement>('button'));
const textOf = (m: Mounted) => section(m.host, 'built-by')!.textContent ?? '';

describe('Built by: the model edits (prism.md §4.3)', () => {
  it('the count: Enter repacks the copies, one step; a count below 0 is said, nothing sent', async () => {
    const m = await mounted();
    await openBuiltBy(m);
    await until(() => !!field(m, 'Copies asked for'));
    expect(field(m, 'Copies asked for')!.value).toBe('506');
    const s0 = m.steps();

    await enter(field(m, 'Copies asked for')!, '-4');
    await until(() => textOf(m).includes('0 or more'));
    expect(m.steps()).toBe(s0);
    expect(countOf(m)).toBe(506);

    await enter(field(m, 'Copies asked for')!, '300');
    await until(() => countOf(m) === 300);
    expect(m.steps()).toBe(s0 + 1);
    // the status shows the resolution: the copies placed, of those asked for
    await until(() => textOf(m).includes('300 of 300 requested'));
    expect(
      m.owner.model
        .session!.history.at(-1)!
        .models!.filter((x) => !x.cached)
        .map((x) => x.model),
    ).toEqual(['m.recipe']);
  });

  it('the seed: Enter packs again with that seed, one step', async () => {
    const m = await mounted();
    await openBuiltBy(m);
    await until(() => !!field(m, 'Seed'));
    expect(field(m, 'Seed')!.value).toBe('1');
    const s0 = m.steps();
    await enter(field(m, 'Seed')!, '7');
    await until(() => m.owner.model.doc!.models?.find((x) => x.id === 'm.recipe')?.seed === 7);
    expect(m.steps()).toBe(s0 + 1);
    await enter(field(m, 'Seed')!, '2.5');
    await until(() => textOf(m).includes('whole number'));
    expect(m.steps()).toBe(s0 + 1);
  });

  it('Add relax stage: the stage is a model, the copies reach what was asked; it is offered once', {
    timeout: 120000,
  }, async () => {
    const m = await mounted();
    await openBuiltBy(m);
    const add = () => buttons(m).find((b) => b.textContent?.includes('Add relax stage'));
    await until(() => !!add());
    const s0 = m.steps();
    add()!.click();
    await until(() => m.owner.model.doc!.models?.some((x) => x.id === 'm.relax') === true);
    expect(m.steps()).toBe(s0 + 1);
    await until(() => textOf(m).includes('506 of 506 requested'));
    await until(() => !add());
    // Undo takes it away, and it can be added again
    await m.v.managers.history.undo();
    await until(() => !m.owner.model.doc!.models?.some((x) => x.id === 'm.relax'));
    await until(() => !!add());
  });

  it('while it resolves, the status names the model and Cancel is there; Cancel stops it and nothing changes', {
    timeout: 120000,
  }, async () => {
    const m = await mounted();
    await openBuiltBy(m);
    await until(() => !!field(m, 'Copies asked for'));
    const s0 = m.steps();
    const doc = m.owner.model.doc;
    const cancel = () => buttons(m).find((b) => b.textContent?.trim() === 'Cancel');
    expect(cancel()).toBeUndefined();

    // m.recipe's resolution waits at the gate: the status and Cancel are seen, and Cancel lands before any commit
    m.gate.hold();
    await enter(field(m, 'Copies asked for')!, '300');
    await until(() => !!cancel(), 5000);
    await until(() => /Resolving m\.recipe \(\d of \d\)/.test(textOf(m)), 5000);
    cancel()!.click();
    await until(() => textOf(m).includes('Stopped'));
    await until(() => !cancel());
    expect(m.steps()).toBe(s0);
    expect(m.owner.model.doc).toBe(doc);
    expect(countOf(m)).toBe(506);

    // and the same edit goes through after
    m.gate.release();
    await enter(field(m, 'Copies asked for')!, '300');
    await until(() => countOf(m) === 300);
    expect(m.steps()).toBe(s0 + 1);
    await until(() => !textOf(m).includes('Stopped'));
  });
});
