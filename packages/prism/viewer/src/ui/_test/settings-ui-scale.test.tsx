/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ShellModel } from '@molstar/prism-ui/shell/shell';
import { afterEach, describe, expect, it } from 'vitest';
import { headlessViewer, until } from '../../_test/harness.js';
import { settingsTab } from '../settings.js';

// Settings › Appearance › UI scale (prism-ui styling.md §6): the shell's scale, − and + in the Appearance group, before
// the canvas's params; a press changes the shell's scale and nothing of the plugin's.

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Settings › Appearance › UI scale', () => {
  it('steps the shell’s scale, not a setting of the plugin', async () => {
    const v = await headlessViewer();
    const shell = new ShellModel();
    const host = document.createElement('div');
    document.body.append(host);
    settingsTab(v.sources, v.managers, v.api.as({ kind: 'person' })).render.mount(
      host,
      { shell } as never,
      undefined as never,
    );
    // Headless, no canvas: Appearance is the UI's rows alone, last and folded; open it.
    host.querySelector<HTMLButtonElement>('section[aria-label="Appearance"] button[aria-expanded]')?.click();
    const find = () =>
      host.querySelector<HTMLElement>('section[aria-label="Appearance"] [data-settings-row="UI scale"]');
    await until(() => !!find());
    const row = find()!;
    const before = JSON.stringify(v.sources.settings.groups.value.map((g) => g.values));
    row.querySelector<HTMLButtonElement>('button[aria-label="Larger UI"]')!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(shell.uiScale.value).toBeGreaterThan(1);
    expect(row.textContent).toContain(`${Math.round(shell.uiScale.value * 100)} %`);
    expect(JSON.stringify(v.sources.settings.groups.value.map((g) => g.values))).toBe(before);
  });
});
