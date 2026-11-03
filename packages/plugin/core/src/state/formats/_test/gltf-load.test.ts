/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Task } from '@molstar/core/task';
import { getFileNameInfo } from '@molstar/core/util/file-info';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import type { Mesh } from '@molstar/graphics/geo/geometry/mesh/mesh';
import { PluginContext } from '@molstar/plugin/context';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import { Gltf, GltfProvider } from '../shape/gltf.js';

// A CryoET Data Portal mesh (data/examples/shapes/README.md) loaded as a dropped file is: the format chosen by its
// extension, parsed, baked (io gltf.md §3) and shown as a shape, at its place and size in Å.

const file = path.resolve(import.meta.dirname, '../../../../../../../data/examples/shapes/cryoet-10521-mesh.glb');

describe('a GLB as a shape', () => {
  it('loads the portal mesh as a shape: its triangles, its bounds in Å', async () => {
    const plugin = new PluginContext({ behaviors: [], registry: [Gltf] });
    await plugin.init();
    const bytes = new Uint8Array(fs.readFileSync(file));
    expect(plugin.dataFormats.auto(getFileNameInfo('sample-1.0_mesh.glb'), new SO.Data.Binary(bytes))).toBe(
      GltfProvider,
    );

    const data = await plugin.builders.data.rawData(
      { data: bytes, label: 'sample-1.0_mesh.glb' },
      { state: { isGhost: true } },
    );
    const parsed = await GltfProvider.parse(plugin, data);
    const provider = parsed.shape.cell!.obj!.data;
    const props = PD.getDefaultValues(provider.params);
    // one group, no material: grey, as an OBJ without an MTL
    expect(props.coloring.name).toBe('custom');
    const shape = await Task.create('shape', (ctx) => provider.getShape(ctx, provider.data, props)).run();
    const mesh = shape.geometry as Mesh;
    expect(mesh.triangleCount).toBe(10164);
    expect(mesh.vertexCount).toBe(5084);
    const vertices = mesh.vertexBuffer.ref.value;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.vertexCount * 3; ++i) {
      min[i % 3] = Math.min(min[i % 3], vertices[i]);
      max[i % 3] = Math.max(max[i % 3], vertices[i]);
    }
    expect(min).toEqual([0, 0, Math.fround(682.9225463867188)]);
    expect(max).toEqual([5480, 7720, Math.fround(2804.80078125)]);

    const repr = await GltfProvider.visuals!(plugin, parsed);
    expect(repr.cell?.obj?.type.name).toBe('Shape 3D');
    await plugin.dispose();
  });
});
