/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ColorLevels } from '@molstar/graphics/geo/geometry/color-levels';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewerSpec } from '@molstar/prism-viewer/spec';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { createMesoscaleExplorerSpec } from '../spec.js';
import { CellpackCif } from './fixtures.js';

// Colors that follow the zoom on at load in the explorer (_spec/ui.md §4 Look; Ludo, 2026-11-04): a cellPACK or
// PetWorld file (`mmcif_particles`, loaded by the lazy particles feature) has its target representations made with
// them on, in the visuals' one build; Prism's own spec keeps them off.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

type Params = { type: { name: string; params: { structure: Record<string, unknown> } } };

async function load(spec: PrismViewerSpec) {
  const v = await createPrismViewerHeadless({ spec });
  viewers.push(v);
  const events = { created: 0, updated: 0 };
  v.plugin.state.data.events.object.created.subscribe((e) => {
    if (e.obj.type.name === 'Particle 3D') events.created++;
  });
  v.plugin.state.data.events.object.updated.subscribe((e) => {
    if (e.obj.type.name === 'Particle 3D') events.updated++;
  });
  const r = await v.api.load.files({ files: [new File([CellpackCif], 'exosome.cif')] });
  if (!r.ok) expect.fail(r.message);
  const list = v.plugin.managers.particles.hierarchy.current.lists[0];
  const targets = list.representations
    .map((r) => r.cell.transform.params as Params)
    .filter((p) => p.type.name === 'target');
  return { v, list, targets, events };
}

describe('colors that follow the zoom, on at load (prism-me)', () => {
  it("a cellPACK file's targets are made with them on, the defaults, once; Look reads On", async () => {
    const { v, list, targets, events } = await load(createMesoscaleExplorerSpec(''));
    expect(targets.length).toBe(1);
    expect(targets[0].type.params.structure.colorLevels).toEqual({ name: 'on', params: ColorLevels.defaults });
    // the target type's other params are its defaults, not dropped by the partial params given
    expect(targets[0].type.params.structure.type).toBe('spacefill');
    expect(targets[0].type.params.structure.sizeFactor).toBe(1);
    expect(events).toEqual({ created: list.representations.length, updated: 0 });
    expect(v.api.mesoscale!.graphicsState(list.cell.transform.ref).value?.colorLevels).toEqual(ColorLevels.defaults);
  });

  it('Off turns them off, one undo step', async () => {
    const { v } = await load(createMesoscaleExplorerSpec(''));
    const before = v.api.history.steps.value.length;
    const off = await v.api.run('mesoscale.colorLevels', { on: false });
    expect(off.ok).toBe(true);
    expect(v.api.history.steps.value.length).toBe(before + 1);
    const levels = () =>
      v.plugin.managers.particles.hierarchy.current.lists[0].representations.map(
        (r) => (r.cell.transform.params as Params).type.params.structure.colorLevels,
      );
    expect(levels()).toEqual([{ name: 'off', params: {} }]);
  });

  it("Prism's own spec keeps them off", async () => {
    const { targets } = await load(DefaultPrismViewerSpec());
    expect(targets.length).toBe(1);
    expect(targets[0].type.params.structure.colorLevels).toEqual({ name: 'off', params: {} });
  });
});
