/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it, vi } from 'vitest';
import type { PluginContext } from '@molstar/plugin/context';
import { pluginPaintHost } from '../paint-host.js';
import { DefaultPaintSettings } from '../paint-mode.js';

// Paint mode's host on the viewer (review N1): a stroke the operation refuses is said on the status line, not dropped.

describe('pluginPaintHost', () => {
  it('says why a stroke was not painted', async () => {
    const warn = vi.fn();
    const plugin = { log: { warn }, managers: { particles: { hierarchy: { current: { lists: [] } } } } };
    const host = pluginPaintHost(plugin as unknown as PluginContext, async () => ({
      ok: false,
      message: 'No particle of that entity to copy.',
    }));
    await host.paint({ particles: 'l', entity: 1, name: 'CD9' }, DefaultPaintSettings, [0, 0, 0], [0, 0, 1]);
    expect(warn).toHaveBeenCalledWith('Not painted: No particle of that entity to copy.');
  });
});
