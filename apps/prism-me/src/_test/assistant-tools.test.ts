/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { createViewerAgent } from '@molstar/prism-viewer/agent/session';
import { CoreTools, Skills, withChange } from '@molstar/prism-viewer/agent/skills';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import { isLazyExtension, type PrismViewerAgentSpec } from '@molstar/prism-viewer/spec';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { createMesoscaleExplorerSpec } from '../spec.js';

// The assistant starts on the explorer's spec (Ludo, 2026-11-03: "Tool "add_label" is registered twice"): the
// stage tools and Prism's Measurements skill named add_label, measure_distance, measure_angle and measure_dihedral,
// and a toolkit refuses a name given twice.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

/** Every tool id the spec declares: the core, Prism's skills after the spec's change, every extension's (a lazy one's stub's) */
function declaredIds() {
  const spec = createMesoscaleExplorerSpec('');
  const agent = (spec.agent || {}) as PrismViewerAgentSpec;
  const skills = [
    ...withChange(Skills, agent.skills),
    ...(spec.extensions ?? []).flatMap((e) => (isLazyExtension(e) ? (e.stub.skills ?? []) : (e.skills ?? []))),
  ];
  return [...withChange(CoreTools, agent.core), ...skills.flatMap((s) => s.tools)].map((t) => t.id);
}

describe("the explorer's assistant", () => {
  it('declares each tool name once, lazy skills included (their tools are added on disclosure)', () => {
    const ids = declaredIds();
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    // The stage tools' labels and measurements; Prism's list and remove of its measurements
    expect(ids).toEqual(
      expect.arrayContaining([
        'add_label',
        'measure_distance',
        'measure_angle',
        'measure_dihedral',
        'list_measurements',
        'remove_measurement',
      ]),
    );
  });

  it('starts: its toolkit is made with one name per tool', async () => {
    const v = await createPrismViewerHeadless({ spec: createMesoscaleExplorerSpec('') });
    viewers.push(v);
    // No model: the toolkit is made with the agent, before any turn
    const agent = createViewerAgent({
      viewer: v,
      models: { providerFor: () => undefined, default: { provider: 'none', model: 'none' } },
    });
    const ids = agent.toolkit.allDefinitions().map((d) => d.tool.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['add_label', 'list_measurements', 'remove_measurement']));
    agent.dispose();
  });
});
