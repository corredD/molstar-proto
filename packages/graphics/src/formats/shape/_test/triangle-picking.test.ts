/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Task } from '@molstar/core/task';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { parseObj } from '@molstar/io/reader/obj/parser';
import { parsePly } from '@molstar/io/reader/ply/parser';
import { shapeFromObj } from '../obj.js';
import { shapeFromPly } from '../ply.js';

// A file's mesh (OBJ, PLY) is picked by triangle (.v6/plans/gl/triangle-picking.md); its wireframe is not

const obj = ['v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0', 'f 1 2 3', 'f 1 3 4'].join('\n');
const ply = [
  'ply',
  'format ascii 1.0',
  'element vertex 3',
  'property float x',
  'property float y',
  'property float z',
  'element face 1',
  'property list uchar int vertex_indices',
  'end_header',
  '0 0 0',
  '1 0 0',
  '0 1 0',
  '3 0 1 2',
].join('\n');

async function shapes(provider: { params: PD.Params; data: unknown; getShape: any; getWireframeShape?: any }) {
  const props = PD.getDefaultValues(provider.params);
  return Task.create('shapes', async (ctx) => ({
    mesh: await provider.getShape(ctx, provider.data, props),
    wireframe: await provider.getWireframeShape?.(ctx, provider.data, props),
  })).run();
}

describe('file meshes picked by triangle', () => {
  it('OBJ', async () => {
    const parsed = await parseObj(obj).run();
    if (parsed.isError) throw new Error(parsed.message);
    const { mesh, wireframe } = await shapes(await shapeFromObj(parsed.result).run());
    expect(mesh.getTriangleLoci).toBeTypeOf('function');
    expect(wireframe.getTriangleLoci).toBeUndefined();
  });

  it('PLY', async () => {
    const parsed = await parsePly(ply).run();
    if (parsed.isError) throw new Error(parsed.message);
    const { mesh } = await shapes(await shapeFromPly(parsed.result).run());
    expect(mesh.getTriangleLoci).toBeTypeOf('function');
  });
});
