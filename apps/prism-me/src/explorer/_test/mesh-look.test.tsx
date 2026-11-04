/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { MeshInfo } from '@molstar/cryoet-extension/operations';
import { render } from '@molstar/prism-ui/dom/render';
import { flushFrame } from '@molstar/prism-ui/reactive/frame-state';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExplorerApi } from '../operations.js';
import { Sections, type Subject } from '../properties.js';

// A mesh's Look (the cryo-ET MeshControls in the properties): its Opacity follows a drag, so the controls stay as the
// mesh changes under them (made again, the slider under the pointer would be another and the drag lost).

afterEach(() => {
  document.body.innerHTML = '';
});

describe("a mesh's Look", () => {
  it('keeps its controls while its opacity changes during a drag', async () => {
    const list = observableState<readonly MeshInfo[]>([
      { ref: 'm', label: 'cube.obj', visible: true, visuals: ['mesh'], opacity: 1, color: 0xcccccc, scale: 1 },
    ]);
    // a change lands in the mesh's info, as `cryoet.mesh` does
    const mesh = vi.fn(async (v: { opacity?: number }) => {
      list.set(list.value.map((m) => ({ ...m, ...(v.opacity === undefined ? {} : { opacity: v.opacity }) })));
      return { ok: true };
    });
    const cryoet = { meshesState: () => list.asReadonly, mesh };
    const api: Record<string, unknown> = {
      cryoet,
      group: async (label: string, work: (g: unknown) => Promise<unknown>) => ({
        ok: true,
        did: label,
        value: await work(api),
      }),
    };
    const subject: Subject = {
      api: api as never,
      area: {} as unknown as ExplorerApi,
      picked: { key: 'm', label: 'cube.obj', kind: 'mesh', node: { ref: 'm' } },
      parts: observableState(new Map()).asReadonly as never,
      groupByOf: () => undefined,
    };
    const host = document.createElement('div');
    document.body.append(host);
    render(() => Sections.find((s) => s.id === 'look')!.render(subject), host);
    const range = host.querySelector<HTMLInputElement>('input[type=range][aria-label="Opacity"]')!;
    range.value = '0.5';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    flushFrame();
    await vi.waitFor(() => expect(list.value[0].opacity).toBe(0.5));
    expect(host.contains(range)).toBe(true);
    range.value = '0.3';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    flushFrame();
    await vi.waitFor(() => expect(list.value[0].opacity).toBe(0.3));
    range.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(mesh).toHaveBeenLastCalledWith({ mesh: 'm', opacity: 0.3 }));
  });
});
