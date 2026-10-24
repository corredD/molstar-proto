/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import {
  isLazyExtension,
  type LazyViewerExtension,
  type ViewerExtension,
  type ViewerExtensionUI,
} from '@molstar/prism-viewer/spec';
import { afterEach, describe, expect, it } from 'vitest';
import { SceneTab } from '../explorer/ui.js';
import { MesoscaleExplorerExtensions } from '../extensions.js';
import { HiddenParts } from '../spec.js';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';

// The rule of apps/prism-me/AGENTS.md (Ludovic, 2026-10-24): the app's UI goes in the explorer's four places (the
// tree, its properties, its right-click menu, + Open), never in an extension's tab, which the app hides. So every tab
// the app's extensions register is hidden but the explorer's Scene, and every hidden part of theirs exists (a renamed
// tab would show again, and a stale id would hide nothing).

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

async function partsOf(extensions: readonly (ViewerExtension | LazyViewerExtension)[] = MesoscaleExplorerExtensions) {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
  });
  viewers.push(v);
  const ctx = { api: v.api.as({ kind: 'person' }), sources: v.sources, managers: v.managers };
  const tabs: string[] = [];
  const all = new Set<string>();
  for (const e of extensions) {
    // a lazy one's parts are its stub's until it loads: this guard would not see them
    if (isLazyExtension(e)) throw new Error(`'${e.id}' is lazy: the hidden parts' guard cannot read its parts`);
    const ui: ViewerExtensionUI = (await e.ui?.(ctx)) ?? {};
    for (const t of ui.tabs ?? []) tabs.push(t.id);
    for (const p of [
      ...(ui.tabs ?? []),
      ...(ui.sections ?? []),
      ...(ui.overlays ?? []),
      ...(ui.pages ?? []),
      ...(ui.rows ?? []),
    ]) {
      all.add(p.id);
    }
  }
  return { tabs, all, owners: new Set(extensions.map((e) => e.id)) };
}

describe("prism-me's hidden parts", () => {
  it("hide every tab of the app's extensions but the explorer's Scene, and name only parts that exist", async () => {
    const { tabs, all, owners } = await partsOf();
    expect(tabs).toContain(SceneTab);
    expect(tabs.filter((t) => t !== SceneTab && !HiddenParts.includes(t))).toEqual([]);
    const ours = HiddenParts.filter((id) => owners.has(id.split('.')[0]));
    expect(ours.length).toBeGreaterThan(0);
    expect(ours.filter((id) => !all.has(id))).toEqual([]);
  });

  it('fail on a lazy extension of the app, whose parts they cannot read', async () => {
    const lazy = {
      id: 'lazy-test',
      stub: { parts: [] },
      load: async () => ({ id: 'lazy-test' }) as ViewerExtension,
    } as unknown as LazyViewerExtension;
    await expect(partsOf([...MesoscaleExplorerExtensions, lazy])).rejects.toThrow(/lazy/);
  });
});
