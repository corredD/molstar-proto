/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { render } from '@molstar/prism-ui';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import { describe, expect, it, vi } from 'vitest';
import { MeshControls } from '../controls.js';
import type { CryoetApi, MeshInfo } from '../operations.js';

// A mesh's color in its controls (prism-me's properties): Prism's color row and its ColorPicker, not the system's
// picker (prism-ui styling.md §4: one ColorPicker); a run of picks is one change, the last.

describe("a mesh's color", () => {
  it("is Prism's color picker; a run of picks makes one change, the last", async () => {
    const mesh: MeshInfo = {
      ref: 'm',
      label: 'membrane.obj',
      visible: true,
      visuals: ['mesh'],
      opacity: 1,
      color: 0xcccccc,
      scale: 1,
    };
    const list = observableState<readonly MeshInfo[]>([mesh]);
    const area = { mesh: vi.fn(async () => ({ ok: true })) } as unknown as CryoetApi;
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <MeshControls area={area} mesh={mesh} list={list.asReadonly} />, host);

    expect(host.querySelector('input[type=color]')).toBeNull();
    // the row's swatch opens the picker under it
    host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click();
    await new Promise((r) => setTimeout(r, 0));
    const hues = Array.from(host.querySelectorAll<HTMLButtonElement>('[aria-label="Palette"] [role=option]'));
    expect(hues.length).toBeGreaterThan(2);
    hues[0].click();
    hues[1].click();
    hues[2].click();
    await new Promise((r) => setTimeout(r, 300));
    expect(area.mesh).toHaveBeenCalledTimes(1);
    const color = hues[2].style.background;
    const [r, g, b] = color.match(/\d+/g)!.map(Number);
    const hex = `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
    expect(area.mesh).toHaveBeenCalledWith({ mesh: 'm', color: hex });
    dispose();
    host.remove();
  });
});
