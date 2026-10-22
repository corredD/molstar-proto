/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { PluginConfig } from '@molstar/plugin/config';
import { PluginContext } from '@molstar/plugin/context';
import { ParticlesRegistry } from '@molstar/plugin/particles-registry';
import { ParticlesRepresentation3D } from '@molstar/plugin/state/transforms/particles/representation';
import { CryoEtDataPortalNdjsonParticlesProvider } from '../ndjson.js';

// A particle list's default visuals: its spheres; and, when the app asks (`PluginConfig.Particles.ShowOrientations`),
// its orientations as axes too, for a list that has them.

const oriented = [0, 1, 2]
  .map((i) =>
    JSON.stringify({
      type: 'orientedPoint',
      location: { x: i * 10, y: 0, z: 0 },
      xyz_rotation_matrix: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    }),
  )
  .join('\n');

async function typesShown(showOrientations?: boolean) {
  const plugin = new PluginContext({
    behaviors: [],
    registry: ParticlesRegistry,
    ...(showOrientations !== undefined
      ? { config: [[PluginConfig.Particles.ShowOrientations, showOrientations]] }
      : {}),
  });
  await plugin.init();
  const data = await plugin.builders.data.rawData({ data: oriented, label: 'picks.ndjson' });
  const parsed = await CryoEtDataPortalNdjsonParticlesProvider.parse(plugin, data);
  await CryoEtDataPortalNdjsonParticlesProvider.visuals!(plugin, parsed);
  const types = Array.from(plugin.state.data.cells.values())
    .filter((c) => c.transform.transformer === ParticlesRepresentation3D)
    .map((c) => (c.transform.params as { type: { name: string } }).type.name);
  plugin.dispose();
  return types;
}

describe('particle lists, default visuals', () => {
  it('shows spheres', async () => {
    expect(await typesShown()).toEqual(['spacefill']);
  });

  it('shows the orientations as axes too, when the app asks and the list has them', async () => {
    expect(await typesShown(true)).toEqual(['spacefill', 'orientation']);
  });
});
