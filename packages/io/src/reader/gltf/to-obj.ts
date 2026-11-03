/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4 } from '@molstar/core/math/linear-algebra/3d/mat4';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { Color } from '@molstar/core/util/color/color';
import type { MtlFile, MtlMaterial, ObjFile } from '../obj/schema.js';
import type { GltfFile } from './schema.js';

// glTF colours are linear, Mol*'s sRGB (the GLB exporter does the reverse), converted on floats: the packed
// Color.linearToSRGB truncates the linear value to 8 bits first, which bands the dark tones (linear 0.21586, sRGB 0x80,
// gives 0x7e), and fromNormalizedRgb truncates (1 gives 0xfe)
const to8 = (c: number) => Math.round(Math.min(Math.max(Color.linearToSRGBNormalized(c), 0), 1) * 255);

/**
 * The scene of a glTF as one OBJ-like mesh in world space (gltf.md §3): each mesh node's primitives baked with the
 * node's world transform, one face group per primitive and node name (the node's, else the mesh's), with the base
 * colours as an MTL (empty when no primitive has a material) and COLOR_0 times the base colour as vertex colours.
 * Normals are kept only when every primitive has them (the OBJ builder computes them otherwise).
 */
export function gltfToObj({ meshes, instances }: GltfFile): { obj: ObjFile; mtl: MtlFile } {
  let positionCount = 0,
    triangleCount = 0,
    hasNormals = true,
    hasColors = false,
    hasMaterials = false;
  for (const { mesh } of instances) {
    for (const p of meshes[mesh].primitives) {
      positionCount += p.vertexCount;
      triangleCount += p.triangleCount;
      hasNormals &&= !!p.normals;
      hasColors ||= !!p.colors;
      hasMaterials ||= !!p.baseColor;
    }
  }

  const positions = new Float32Array(positionCount * 3);
  const normals = new Float32Array(hasNormals ? positionCount * 3 : 0);
  const vertexColors = new Float32Array(hasColors ? positionCount * 3 : 0);
  const positionIndices = new Int32Array(triangleCount * 3);
  const faceGroups = new Int32Array(triangleCount);
  const materialNames: string[] = [];
  const mtl = new Map<string, MtlMaterial>();
  // the group of a (mesh, primitive, label), and the next suffix of a label taken by another (mesh, primitive)
  const groups = new Map<string, number>();
  const suffixes = new Map<string, number>();

  const normalMatrix = Mat4();
  let v = 0,
    t = 0;
  for (const { name: nodeName, mesh, transform } of instances) {
    const { name: meshName, primitives } = meshes[mesh];
    const identity = Mat4.isIdentity(transform);
    // spec §3.7.4: a mirroring transform reverses the winding
    const flip = Mat4.determinant(transform) < 0;
    if (hasNormals && !identity) Mat4.transpose(normalMatrix, Mat4.invert(normalMatrix, transform));
    for (let pi = 0, pl = primitives.length; pi < pl; ++pi) {
      const {
        index,
        vertexCount,
        positions: pos,
        normals: nor,
        colors,
        colorSize,
        indices,
        baseColor,
      } = primitives[pi];
      const [br, bg, bb] = baseColor ?? [1, 1, 1];

      // instances of a mesh under one name share their groups: the group count is the names', not the nodes'
      let label = nodeName || meshName || `Mesh ${mesh}`;
      if (pl > 1 || index > 0) label += ` ${index}`;
      const key = `${mesh}/${index}/${label}`;
      let group = groups.get(key);
      if (group === undefined) {
        let k = suffixes.get(label) ?? 1;
        let name = label;
        while (mtl.has(name)) name = `${label} (${++k})`;
        suffixes.set(label, k);
        group = materialNames.length;
        groups.set(key, group);
        materialNames.push(name);
        mtl.set(name, { Kd: Color.fromRgb(to8(br), to8(bg), to8(bb)) });
      }

      if (identity) {
        positions.set(pos, v * 3);
        if (hasNormals) normals.set(nor!, v * 3);
      } else {
        for (let i = 0; i < vertexCount; ++i)
          Vec3.transformMat4Offset(positions, pos, transform, (v + i) * 3, i * 3, 0);
        if (hasNormals) {
          for (let i = 0; i < vertexCount; ++i) {
            Vec3.transformDirectionOffset(normals, nor!, normalMatrix, (v + i) * 3, i * 3, 0);
          }
        }
      }

      if (hasColors) {
        for (let i = 0, c = 0, o = v * 3; i < vertexCount; ++i, c += colorSize, o += 3) {
          // in 8-bit steps (k / 255 packs back to k exactly), clamped: fromNormalizedRgb neither rounds nor clamps
          vertexColors[o] = to8(colors ? colors[c] * br : br) / 255;
          vertexColors[o + 1] = to8(colors ? colors[c + 1] * bg : bg) / 255;
          vertexColors[o + 2] = to8(colors ? colors[c + 2] * bb : bb) / 255;
        }
      }

      for (let k = 0, kl = primitives[pi].triangleCount; k < kl; ++k, ++t) {
        const o = k * 3;
        const a = indices ? indices[o] : o;
        const b = indices ? indices[o + 1] : o + 1;
        const c = indices ? indices[o + 2] : o + 2;
        positionIndices[t * 3] = v + a;
        positionIndices[t * 3 + 1] = v + (flip ? c : b);
        positionIndices[t * 3 + 2] = v + (flip ? b : c);
        faceGroups[t] = group;
      }
      v += vertexCount;
    }
  }

  const obj: ObjFile = {
    positions,
    normals,
    // one normal per position: the OBJ builder's indexed path, no vertex duplicated
    positionIndices,
    normalIndices: positionIndices,
    positionCount,
    normalCount: hasNormals ? positionCount : 0,
    triangleCount,
    vertexColors,
    materialNames,
    faceGroups,
  };
  return { obj, mtl: hasMaterials ? mtl : new Map() };
}
