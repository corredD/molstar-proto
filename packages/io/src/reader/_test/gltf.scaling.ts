/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { it } from 'vitest';
import { Mat4 } from '@molstar/core/math/linear-algebra/3d/mat4';
import { checkLinear, quadraticControl, scaling } from '../../../../sequences/core/_test/model/scaling.js';
import type { GltfFile, GltfPrimitive } from '../gltf/schema.js';
import { gltfToObj } from '../gltf/to-obj.js';

// The bake over n and 4n nodes (`test:scaling`; apps/prism-me AGENTS.md, no accidental quadratic): every node a mesh
// of its own under one name, so each is a group whose name is taken (a suffix found per group, not a scan of the taken
// ones: the first bake's scan read ×20 at 2000 → 8000 nodes, 2026-11-02).

const primitive: GltfPrimitive = {
  index: 0,
  vertexCount: 3,
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  colorSize: 0,
  triangleCount: 1,
};

const sameNamedNodes = (n: number): GltfFile => ({
  meshes: Array.from({ length: n }, () => ({ primitives: [primitive] })),
  instances: Array.from({ length: n }, (_, mesh) => ({
    name: 'a',
    mesh,
    transform: Mat4.fromTranslation(Mat4(), [mesh, 0, 0]),
  })),
});

it('the glTF bake of N same-named nodes', () => {
  checkLinear('gltf bake: N nodes, one name', scaling({ setup: sameNamedNodes, run: (f) => void gltfToObj(f) }, 2000));
});

it('the quadratic control is caught', () => {
  checkLinear('control', scaling(quadraticControl, 2000), false);
});
