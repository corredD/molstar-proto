/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { createViewerAgent } from '@molstar/prism-viewer/agent/session';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { createMesoscaleExplorerSpec } from '../spec.js';

// The assistant starts on the explorer's spec (Ludo, 2026-11-03: "Tool "add_label" is registered twice"): the
// stage tools' labels and measurements and Prism's Measurements skill named the same tools, and a toolkit refuses a
// name given twice. Every tool of the explorer's agent has one name.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

describe("the explorer's assistant", () => {
  it('starts: no tool name is registered twice, and the stage tools keep add_label and measure_distance', async () => {
    const v = await createPrismViewerHeadless({ spec: createMesoscaleExplorerSpec('') });
    viewers.push(v);
    // No model: the toolkit is made with the agent, before any turn
    const agent = createViewerAgent({
      viewer: v,
      models: { providerFor: () => undefined, default: { provider: 'none', model: 'none' } },
    });
    const ids = agent.toolkit.allDefinitions().map((d) => d.tool.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['add_label', 'measure_distance', 'change_label']));
    agent.dispose();
  });
});
