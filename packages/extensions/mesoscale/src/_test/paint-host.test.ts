/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it, vi } from 'vitest';
import type { PluginContext } from '@molstar/plugin/context';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import { Binding } from '@molstar/core/util/binding';
import { ButtonsType, ModifiersKeys } from '@molstar/core/util/input/input-observer';
import { DefaultTrackballBindings } from '@molstar/graphics/canvas3d/controls/trackball';
import { pluginPaintHost, withAltCamera } from '../paint-host.js';
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

  it("gives a fiber stroke the brush's sequence and range (Round 5), a copy none", async () => {
    const plugin = { log: { warn: vi.fn() }, managers: { particles: { hierarchy: { current: { lists: [] } } } } };
    const calls: Record<string, unknown>[] = [];
    const host = pluginPaintHost(plugin as unknown as PluginContext, async (p) => {
      calls.push(p as Record<string, unknown>);
      return { ok: true };
    });
    const brush = { particles: 'l', entity: 1, name: 'DNA' };
    const s = { ...DefaultPaintSettings, sequence: 'ATGC', range: '2-3' };
    await host.paint(brush, s, [0, 0, 0, 1, 0, 0], [0, 0, 1, 0, 0, 1], 1, true);
    await host.paint(brush, s, [0, 0, 0], [0, 0, 1], 1, false);
    expect(calls[0]).toMatchObject({ sequence: 'ATGC', start: 2, end: 3, fiber: true });
    expect(calls[1].sequence).toBeUndefined();
  });

  it('gives a stroke on a mesh its mesh (grow-mesh: the grow after it follows it), a stroke elsewhere none', async () => {
    const plugin = { log: { warn: vi.fn() }, managers: { particles: { hierarchy: { current: { lists: [] } } } } };
    const calls: Record<string, unknown>[] = [];
    const host = pluginPaintHost(plugin as unknown as PluginContext, async (p) => {
      calls.push(p as Record<string, unknown>);
      return { ok: true };
    });
    const brush = { particles: 'l', entity: 1, name: 'CD9' };
    await host.paint(brush, DefaultPaintSettings, [0, 0, 0], [0, 0, 1], 1, false, 'vesicle-ref');
    await host.paint(brush, DefaultPaintSettings, [0, 0, 0], [0, 0, 1], 1, false);
    expect(calls[0].mesh).toBe('vesicle-ref');
    expect('mesh' in calls[1]).toBe(false);
  });
});

describe('pluginPaintHost, a structure brush (paint-layer round 2)', () => {
  it("paints the structure into the settings' list (empty: the Painting list): no fiber, upright never, its radius", async () => {
    const structure = { boundary: { sphere: { radius: 18 } } };
    const cells = new Map([['s1', { obj: { type: SO.Molecule.Structure.type, data: structure } }]]);
    const lists: unknown[] = [];
    const plugin = {
      log: { warn: vi.fn() },
      state: { data: { cells } },
      managers: { particles: { hierarchy: { current: { lists } } } },
    };
    const calls: Record<string, unknown>[] = [];
    const host = pluginPaintHost(plugin as unknown as PluginContext, async (p) => {
      calls.push(p as Record<string, unknown>);
      return { ok: true };
    });
    const brush = { particles: '', entity: -1, name: '1CRN', structure: 's1' };
    expect(host.has(brush)).toBe(true);
    expect(host.has({ ...brush, structure: 'gone' })).toBe(false);
    expect(host.upright(brush)).toBe(false);
    expect(host.fiberStep(brush)).toBeUndefined();
    expect(host.radius(brush)).toBe(18);
    await host.paint(brush, DefaultPaintSettings, [0, 0, 0], [0, 0, 1], 1, false);
    await host.paint(brush, { ...DefaultPaintSettings, into: 'hiv' }, [0, 0, 0], [0, 0, 1], 1, false);
    expect(calls[0]).toMatchObject({ structure: 's1', particles: '' });
    expect(calls[0].entity).toBeUndefined();
    // HIV gone since it was chosen: the Painting list
    expect(calls[1]).toMatchObject({ structure: 's1', particles: '' });
    lists.push({ cell: { transform: { ref: 'hiv' } } });
    await host.paint(brush, { ...DefaultPaintSettings, into: 'hiv' }, [0, 0, 0], [0, 0, 1], 1, false);
    expect(calls[2]).toMatchObject({ structure: 's1', particles: 'hiv' });
  });

  it('reads a structure brush’s fiber rise in the list it paints into (gone: the Painting list’s)', () => {
    const cells = new Map([['s1', { obj: { type: SO.Molecule.Structure.type, data: {} } }]]);
    const lists: unknown[] = [{ cell: { transform: { ref: 'hiv' } } }];
    const plugin = { state: { data: { cells } }, managers: { particles: { hierarchy: { current: { lists } } } } };
    const asked: string[][] = [];
    const host = pluginPaintHost(
      plugin as unknown as PluginContext,
      async () => undefined,
      undefined,
      (structure, into) => (asked.push([structure, into]), into === 'hiv' ? 30 : undefined),
    );
    const brush = { particles: '', entity: -1, name: '1CRN', structure: 's1' };
    expect(host.fiberStep(brush, 'hiv')).toBe(30);
    expect(host.fiberStep(brush, 'gone')).toBeUndefined();
    expect(host.fiberStep(brush)).toBeUndefined();
    expect(asked).toEqual([
      ['s1', 'hiv'],
      ['s1', ''],
      ['s1', ''],
    ]);
  });
});

describe('withAltCamera', () => {
  const alt = ModifiersKeys.create({ alt: true });
  it('turns, pans and zooms with Alt held as without, and keeps the plain gestures', () => {
    const b = withAltCamera(DefaultTrackballBindings);
    expect(Binding.match(b.dragRotate, ButtonsType.Flag.Primary, alt)).toBe(true);
    expect(Binding.match(b.dragPan, ButtonsType.Flag.Secondary, alt)).toBe(true);
    expect(Binding.match(b.scrollZoom, ButtonsType.Flag.Auxilary, alt)).toBe(true);
    expect(Binding.match(b.dragRotate, ButtonsType.Flag.Primary, ModifiersKeys.None)).toBe(true);
    // the defaults untouched
    expect(Binding.match(DefaultTrackballBindings.dragRotate, ButtonsType.Flag.Primary, alt)).toBe(false);
    expect(b.keyMoveForward).toBe(DefaultTrackballBindings.keyMoveForward);
  });

  it("the host holds the canvas's own bindings and puts them back whole", () => {
    const own = { ...DefaultTrackballBindings, dragPan: Binding.Empty };
    const attribs = { trackball: { bindings: own } };
    const setAttribs = vi.fn((a: typeof attribs) => {
      attribs.trackball.bindings = a.trackball.bindings;
    });
    const lists = { current: { lists: [] } };
    const plugin = { canvas3d: { attribs, setAttribs }, managers: { particles: { hierarchy: lists } } };
    const release = pluginPaintHost(plugin as unknown as PluginContext, async () => undefined).holdCamera();
    expect(Binding.match(attribs.trackball.bindings.dragRotate, ButtonsType.Flag.Primary, alt)).toBe(true);
    release();
    expect(attribs.trackball.bindings).toBe(own);
  });
});
