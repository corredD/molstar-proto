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
import { MmcifParticlesProvider } from '../mmcif-assembly.js';
import { CryoEtDataPortalNdjsonParticlesProvider } from '../ndjson.js';

// A particle list's default visuals: its spheres; and, when the app asks (`PluginConfig.Particles.ShowOrientations`),
// its orientations as axes too, for a list that has them. A cellPACK list: its targets, and its fibers where it has them,
// their points targeted or not.

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

/**
 * A cellPACK file of a fiber (entity 1, below `fibers`: two fibers of three points) and a protein (entity 2): each chain
 * with an atom, so every particle has a target (as a fiber's chain must, to be the fiber entity's)
 */
const cellpackFibers = `data_cellpack_test
loop_
_entity.id
_entity.pdbx_description
1 cell.fibers.mRNA
2 cell.ribosome

loop_
_atom_site.label_asym_id
_atom_site.label_entity_id
_atom_site.label_atom_id
_atom_site.type_symbol
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
F 1 P P 0 0 0
R 2 CA C 0 0 0

loop_
_pdbx_struct_assembly_gen.assembly_id
_pdbx_struct_assembly_gen.oper_expression
_pdbx_struct_assembly_gen.asym_id_list
1 '(1-3)' F
1 '(4-6)' F
1 '(7)' R

loop_
_pdbx_struct_oper_list.id
_pdbx_struct_oper_list.matrix[1][1]
_pdbx_struct_oper_list.matrix[1][2]
_pdbx_struct_oper_list.matrix[1][3]
_pdbx_struct_oper_list.matrix[2][1]
_pdbx_struct_oper_list.matrix[2][2]
_pdbx_struct_oper_list.matrix[2][3]
_pdbx_struct_oper_list.matrix[3][1]
_pdbx_struct_oper_list.matrix[3][2]
_pdbx_struct_oper_list.matrix[3][3]
_pdbx_struct_oper_list.vector[1]
_pdbx_struct_oper_list.vector[2]
_pdbx_struct_oper_list.vector[3]
${[1, 2, 3, 4, 5, 6, 7].map((i) => `${i} 1 0 0 0 1 0 0 0 1 ${i * 10} 0 0`).join('\n')}
`;

async function cellpackTypesShown() {
  const plugin = new PluginContext({ behaviors: [], registry: ParticlesRegistry });
  await plugin.init();
  const data = await plugin.builders.data.rawData({ data: cellpackFibers, label: 'fibers.cif' });
  const parsed = await MmcifParticlesProvider.parse(plugin, data);
  const list = plugin.state.data.select(parsed.list.ref)[0].obj!.data as { fibers?: { count: number } };
  expect(list.fibers?.count).toBe(2);
  await MmcifParticlesProvider.visuals!(plugin, parsed);
  const types = Array.from(plugin.state.data.cells.values())
    .filter((c) => c.transform.transformer === ParticlesRepresentation3D)
    .map((c) => (c.transform.params as { type: { name: string } }).type.name);
  plugin.dispose();
  return types;
}

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

  it("shows a cellPACK list's fibers where their points have a target (Ludo: a yeast slab's mRNA, no tubes)", async () => {
    expect(await cellpackTypesShown()).toEqual(['target', 'fibers']);
  });
});
