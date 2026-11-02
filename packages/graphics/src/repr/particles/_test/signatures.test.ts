/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { CIF } from '@molstar/io/reader/cif';
import { trajectoryFromMmCIF } from '@molstar/model/formats/structure/mmcif';
import { Structure } from '@molstar/model/model/structure';
import { CustomProperties } from '@molstar/model/model/custom-property';
import type { ParticleList, ParticleTarget } from '@molstar/model/model/particles/particle-list';
import { AutoGpuCullingMinSpheres, AutoGpuCullingThreshold } from '@molstar/graphics/geo/geometry/base';
import type { GraphicsContext } from '@molstar/graphics/gl/context';
import type { RepresentationContext } from '@molstar/graphics/repr/representation';
import { NoSignatureLayers, type SignatureContext } from '@molstar/graphics/repr/signatures';
import { ParticleTargetRepresentationParams } from '../representation/target/common.js';
import { ParticleTargetRepresentation } from '../representation/target/representation.js';

async function load1cbs() {
  const file = path.resolve(import.meta.dirname, '../../../../../../data/examples/1cbs_updated.cif');
  const parsed = await CIF.parse(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).run();
  if (parsed.isError) throw new Error(parsed.message);
  const trajectory = await trajectoryFromMmCIF(parsed.result.blocks[0], parsed.result).run();
  return Structure.ofModel(trajectory.representative);
}

/** `count` particles of one structure target */
function particleList(structure: Structure, count: number): ParticleList {
  return {
    count,
    keys: Int32Array.from({ length: count }, (_, i) => i),
    targets: new Int32Array(count),
    targetInfo: new Map([[0, { name: '1cbs' }]]),
    targetMapping: new Map<number, ParticleTarget>([[0, { kind: 'structure', structure }]]),
    compartments: new Int32Array(count),
    compartmentInfo: new Map([[0, { name: 'a' }]]),
    entities: new Int32Array(count),
    entityInfo: new Map([[0, { name: 'e0' }]]),
    coordinates: Float32Array.from({ length: count * 3 }, (_, i) => (i % 3 === 0 ? i * 100 : 0)),
    getParticleLabel: () => '',
    sourceData: {} as ParticleList['sourceData'],
    customProperties: new CustomProperties(),
    _propertyData: {},
  };
}

describe('particle target signatures', () => {
  it('predict spheres culled on the GPU from many spheres, without the raster', async () => {
    const structure = await load1cbs();
    // impostors and GPU culling, without the raster (no `atomicMinMax64`)
    const graphics = {
      capabilities: { fragDepth: true, indirectInstanceRanges: true },
      compute: { isKernelSupported: () => true },
    } as unknown as GraphicsContext;
    const repr = ParticleTargetRepresentation(
      { graphics } as RepresentationContext,
      () => ParticleTargetRepresentationParams,
    );
    const props = { ...PD.getDefaultValues(ParticleTargetRepresentationParams), gpuCulling: 'auto' as const };
    const draws = Math.max(1, props.lodLevels.length);
    const gpuCulled = (count: number) => {
      const ctx: SignatureContext = {
        graphics,
        color: { types: ['uniform'], palette: false, preferSmoothing: false },
        size: { types: ['uniform'] },
        layers: NoSignatureLayers,
        data: particleList(structure, count),
      };
      return repr.getSignatures(props, ctx).find((s) => s.type === 'spheres' && s.merged)?.gpuCulled ?? false;
    };
    // as many instances as culled per draw: culled on the GPU from as many spheres as the rule asks
    const many = Math.max(
      AutoGpuCullingThreshold * draws,
      Math.ceil(AutoGpuCullingMinSpheres / structure.elementCount),
    );
    expect(many * structure.elementCount).toBeGreaterThanOrEqual(AutoGpuCullingMinSpheres);
    expect(gpuCulled(many)).toBe(true);
    // fewer spheres: on the CPU
    const few = AutoGpuCullingThreshold * draws;
    expect(few * structure.elementCount).toBeLessThan(AutoGpuCullingMinSpheres);
    expect(gpuCulled(few)).toBe(false);
  });
});
