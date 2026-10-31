/** @vitest-environment jsdom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Developed in collaboration with Anyfold <https://anyfold.ai/>
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DefaultPrismViewerSpec } from '../../default-spec.js';
import { createDefaultPlugin } from '../../sources/create-plugin.js';
import type { PrismStore } from '../../spec.js';
import { createViewerCore, type ViewerCore } from '../../viewer.js';
import { mountShell } from '../shell.js';

// The page's shell over a viewer core in jsdom (no WebGL: the canvas says it could not start). What it keeps in the
// preferences is what the person chose, not what it started with; a shell that fails partway leaves nothing behind.

// jsdom has no ResizeObserver: the shell's layout watchers see no resizes.
class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const cores: ViewerCore[] = [];
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', NoResize);
});
afterEach(async () => {
  for (const c of cores.splice(0)) await c.dispose();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function memoryStore(): PrismStore & { readonly values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  return {
    values,
    get: (k) => values.get(k),
    set: (k, v) => void values.set(k, v),
    remove: (k) => void values.delete(k),
  };
}

async function core(preferences?: PrismStore) {
  const c = await createViewerCore({
    spec: { ...DefaultPrismViewerSpec(), ...(preferences ? { persist: { key: 'mount-test', preferences } } : {}) },
    createPlugin: createDefaultPlugin,
    modules: ['files', 'page'],
  });
  cores.push(c);
  // No WebGL in jsdom: the canvas does not start (the shell says so).
  vi.spyOn(c, 'mountCanvas').mockResolvedValue(false);
  return c;
}

describe('the shell on a page', () => {
  it('keeps the theme only once the person changes it', async () => {
    const preferences = memoryStore();
    const c = await core(preferences);
    const target = document.createElement('div');
    document.body.append(target);
    const mounted = await mountShell(c, target);
    expect(preferences.values.has('theme')).toBe(false);
    c.managers.commands.open('view.theme');
    await new Promise((r) => setTimeout(r, 0));
    expect(preferences.values.has('theme')).toBe(true);
    mounted.dispose();
  });

  // The UI scale (prism-ui styling.md §6): one variable on the shell's root, kept like the theme; never a canvas prop.
  it('scales the UI by one variable on its root, keeps it, and leaves the canvas alone', async () => {
    const preferences = memoryStore();
    const c = await core(preferences);
    const target = document.createElement('div');
    document.body.append(target);
    const mounted = await mountShell(c, target);
    const settingsBefore = JSON.stringify(c.sources.settings.groups.value.map((g) => g.values));
    expect(mounted.root.style.getPropertyValue('--msp-ui-scale')).toBe('');
    expect(preferences.values.has('uiScale')).toBe(false);
    // The canvas, as if it had started (jsdom has no WebGL): its props and its context's (the pixel ratio) watched.
    const canvasProps = vi.fn();
    const contextProps = vi.fn();
    Object.defineProperty(c.plugin, 'canvas3d', { value: { setProps: canvasProps }, configurable: true });
    Object.defineProperty(c.plugin, 'canvas3dContext', {
      value: { setProps: contextProps, pixelScale: 1 },
      configurable: true,
    });
    const setCanvas = vi.spyOn(c.plugin, 'setCanvas3DProps');
    const setContext = vi.spyOn(c.plugin, 'setCanvas3DContextProps');
    c.managers.commands.open('view.ui-larger');
    c.managers.commands.open('view.ui-larger');
    await new Promise((r) => setTimeout(r, 0));
    // The 3D is not touched: no canvas prop, no context prop (the pixel ratio among them), by any path.
    expect(canvasProps).not.toHaveBeenCalled();
    expect(contextProps).not.toHaveBeenCalled();
    expect(setCanvas).not.toHaveBeenCalled();
    expect(setContext).not.toHaveBeenCalled();
    delete (c.plugin as { canvas3d?: unknown }).canvas3d;
    delete (c.plugin as { canvas3dContext?: unknown }).canvas3dContext;
    const scale = mounted.shell.uiScale.value;
    expect(scale).toBeGreaterThan(1);
    expect(mounted.root.style.getPropertyValue('--msp-ui-scale')).toBe(String(scale));
    expect(preferences.values.get('uiScale')).toBe(scale);
    // Not a setting of the plugin's: the settings are as they were.
    expect(JSON.stringify(c.sources.settings.groups.value.map((g) => g.values))).toBe(settingsBefore);
    mounted.dispose();

    // A new shell reads it back.
    const again = await core(preferences);
    const target2 = document.createElement('div');
    document.body.append(target2);
    const remounted = await mountShell(again, target2);
    expect(remounted.shell.uiScale.value).toBe(scale);
    expect(remounted.root.style.getPropertyValue('--msp-ui-scale')).toBe(String(scale));
    again.managers.commands.open('view.ui-reset');
    await new Promise((r) => setTimeout(r, 0));
    expect(remounted.root.style.getPropertyValue('--msp-ui-scale')).toBe('');
    remounted.dispose();
  });

  it('starts at 100 % when its kept scale cannot be read or written', async () => {
    const broken: PrismStore = {
      get: (k) => {
        if (k === 'uiScale') throw new Error('storage blocked');
        return undefined;
      },
      set: (k) => {
        if (k === 'uiScale') throw new Error('storage blocked');
      },
      remove: () => {},
    };
    const c = await core(broken);
    const target = document.createElement('div');
    document.body.append(target);
    const mounted = await mountShell(c, target);
    expect(mounted.shell.uiScale.value).toBe(1);
    c.managers.commands.open('view.ui-larger');
    await new Promise((r) => setTimeout(r, 0));
    expect(mounted.shell.uiScale.value).toBeGreaterThan(1);
    mounted.dispose();
  });

  it('removes what it made when it fails partway', async () => {
    const c = await core();
    const target = document.createElement('div');
    document.body.append(target);
    vi.spyOn(c, 'attachExtensionUI').mockImplementation(() => {
      throw new Error('no port');
    });
    await expect(mountShell(c, target)).rejects.toThrow('no port');
    // Its root is gone from the shadow root, and its tabs with it (the shell retired).
    expect(target.shadowRoot?.childElementCount ?? 0).toBe(0);
  });
});
