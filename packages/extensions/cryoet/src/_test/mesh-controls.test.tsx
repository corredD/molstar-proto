/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { render } from '@molstar/prism-ui';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeshControls } from '../controls.js';
import type { CryoetApi, MeshInfo } from '../operations.js';

// A mesh's color in its controls (prism-me's properties): Prism's color row and its ColorPicker, not the system's
// picker (prism-ui styling.md §4: one ColorPicker); a run of picks is one change, the last, made at once if the
// controls go first. Fake timers: the wait is the controls', nothing else.

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

/** The controls of one mesh, its picker opened; the palette's hues and the area's calls */
function mounted() {
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
  host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click();
  const hues = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[aria-label="Palette"] [role=option]'));
  return { host, area, dispose, hues };
}

const hexOf = (b: HTMLElement) => {
  const [r, g, bl] = b.style.background.match(/\d+/g)!.map(Number);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
};

describe("a mesh's color", () => {
  it('a run of picks left at once (the controls gone) is still made, once', () => {
    vi.useFakeTimers();
    const { area, dispose, hues } = mounted();
    hues()[0].click();
    hues()[3].click();
    const last = hexOf(hues()[3]);
    dispose();
    expect(area.mesh).toHaveBeenCalledTimes(1);
    expect(area.mesh).toHaveBeenCalledWith({ mesh: 'm', color: last });
    vi.advanceTimersByTime(500);
    expect(area.mesh).toHaveBeenCalledTimes(1);
  });

  it("is Prism's color picker; a run of picks makes one change, the last", () => {
    vi.useFakeTimers();
    const { host, area, dispose, hues } = mounted();
    expect(host.querySelector('input[type=color]')).toBeNull();
    expect(hues().length).toBeGreaterThan(2);
    hues()[0].click();
    hues()[1].click();
    hues()[2].click();
    const last = hexOf(hues()[2]);
    vi.advanceTimersByTime(500);
    expect(area.mesh).toHaveBeenCalledTimes(1);
    expect(area.mesh).toHaveBeenCalledWith({ mesh: 'm', color: last });
    dispose();
  });
});
