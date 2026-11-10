/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Sphere3D } from '@molstar/core/math/geometry/primitives/sphere3d';
import { Mat4 } from '@molstar/core/math/linear-algebra/3d/mat4';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { ColorNames } from '@molstar/core/util/color/names';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import {
  AutoGpuCullingMinInstances,
  AutoGpuCullingMinRasterSpheres,
  AutoGpuCullingMinSpheres,
  AutoGpuCullingThreshold,
  resolveGpuCulling,
} from '@molstar/graphics/geo/geometry/base';
import { Spheres } from '@molstar/graphics/geo/geometry/spheres/spheres';
import { SpheresBuilder } from '@molstar/graphics/geo/geometry/spheres/spheres-builder';
import { createTransform } from '@molstar/graphics/geo/geometry/transform-data';
import {
  createRenderObject,
  isMergedRenderObject,
  type GraphicsRenderObject,
} from '@molstar/graphics/gl/render-object';
import type { GraphicsContext } from '@molstar/graphics/gl/context';
import type { ObjectSignature } from '@molstar/graphics/gl/precompile';
import { mergeRenderObjectsByType } from '../merged.js';
import { withMergedSignatures } from '../signatures.js';

/** A spheres render object of `instances` instances (translated copies of `count` spheres) */
function spheres(instances: number, count = 4): GraphicsRenderObject {
  const builder = SpheresBuilder.create(count, 2);
  for (let i = 0; i < count; ++i) builder.add(i, 0, 0, i);
  const geometry = builder.getSpheres();
  const transforms = new Float32Array(instances * 16);
  for (let i = 0; i < instances; ++i)
    Mat4.toArray(Mat4.fromTranslation(Mat4(), Vec3.create(0, i * 10, 0)), transforms, i * 16);
  const transform = createTransform(transforms, instances, Sphere3D.create(Vec3(), 5), 20, 64);
  const props = PD.getDefaultValues(Spheres.Params);
  const values = Spheres.Utils.createValuesSimple(geometry, props, ColorNames.orange, 1, transform);
  return createRenderObject('spheres', values, Spheres.Utils.createRenderableState(props), -1);
}

describe('merging render objects', () => {
  it('culls on the GPU from many instances, and many per draw (a segment and level)', () => {
    const min = AutoGpuCullingMinInstances;
    expect(resolveGpuCulling('auto', min, 4)).toBe(true);
    expect(resolveGpuCulling('auto', min - 1, 4)).toBe(false);
    const draws = Math.ceil(min / AutoGpuCullingThreshold) * 2;
    expect(resolveGpuCulling('auto', AutoGpuCullingThreshold * draws, draws)).toBe(true);
    expect(resolveGpuCulling('auto', AutoGpuCullingThreshold * draws - 1, draws)).toBe(false);
    expect(resolveGpuCulling(true, 1, 4)).toBe(true);
    expect(resolveGpuCulling(false, 1e6, 1)).toBe(false);
  });

  it('culls on the GPU from many spheres the raster could draw', () => {
    const min = AutoGpuCullingMinRasterSpheres;
    expect(resolveGpuCulling('auto', 100, 100, min)).toBe(true);
    expect(resolveGpuCulling('auto', 100, 100, min - 1)).toBe(false);
    expect(resolveGpuCulling(false, 100, 100, min)).toBe(false);
    // without the raster (no raster spheres) as many spheres are not enough
    expect(resolveGpuCulling('auto', 100, 100, 0, min)).toBe(false);
  });

  it('culls on the GPU from many spheres without the raster, with many instances per draw', () => {
    const min = AutoGpuCullingMinSpheres;
    // few instances of large members (mesoscale: PetWorld's 19 objects at 4 levels), per instance a test that drops
    // millions of spheres
    const draws = 19 * 4;
    const instances = AutoGpuCullingThreshold * draws;
    expect(instances).toBeLessThan(AutoGpuCullingMinInstances);
    expect(resolveGpuCulling('auto', instances, draws, 0, min)).toBe(true);
    expect(resolveGpuCulling('auto', instances, draws, 0, min - 1)).toBe(false);
    // few instances per draw (a PDB entry's units, one object each): nothing to cull by instance
    expect(resolveGpuCulling('auto', instances - 1, draws, 0, min * 10)).toBe(false);
    // one large object alone
    expect(resolveGpuCulling('auto', AutoGpuCullingThreshold - 1, 1, 0, min * 10)).toBe(false);
  });

  it('keeps symmetric assemblies of a few million spheres on the CPU without the raster', () => {
    // a 60-mer of 7 chains as spacefill, no levels (7qpd's assembly is 0.69M spheres): 60 instances per draw, culled on
    // the GPU measured a loss (`merged-render-objects.md`, When on); the gains without the raster were measured from
    // 13.5M spheres (mesoscale models)
    expect(resolveGpuCulling('auto', 7 * 60, 7, 0, 3_000_000)).toBe(false);
  });

  it('merges a few instances of many spheres to cull them on the GPU, without the raster', () => {
    const instances = AutoGpuCullingThreshold;
    const entries = [{ visual: 0, renderObject: spheres(instances, Math.ceil(AutoGpuCullingMinSpheres / instances)) }];
    // a device without the raster (no `atomicMinMax64`)
    const graphics = { capabilities: {}, resources: { ownsTexture: () => true } } as unknown as GraphicsContext;
    const out: GraphicsRenderObject[] = [];
    mergeRenderObjectsByType(entries, 'auto', new Map(), out, 'auto', true, graphics);
    expect(isMergedRenderObject(out[0])).toBe(true);
    expect((out[0].values as { gpuCulling?: { ref: { value: boolean } } }).gpuCulling?.ref.value).toBe(true);
    // one sphere an instance fewer: below the floor, unmerged
    const fewer = [
      { visual: 0, renderObject: spheres(instances, Math.ceil(AutoGpuCullingMinSpheres / instances) - 1) },
    ];
    const few: GraphicsRenderObject[] = [];
    mergeRenderObjectsByType(fewer, 'auto', new Map(), few, 'auto', true, graphics);
    expect(isMergedRenderObject(few[0])).toBe(false);
  });

  it('predicts the signatures of spheres culled on the GPU without the raster', () => {
    const signature = {
      type: 'spheres',
      defines: {},
      linearTextures: [],
      doubleSided: false,
      hasReflection: false,
      opaque: true,
      transparent: false,
      emissive: false,
    } as unknown as ObjectSignature;
    // culls on the GPU, without the raster (no `atomicMinMax64`)
    const graphics = {
      capabilities: { indirectInstanceRanges: true },
      compute: { isKernelSupported: () => true },
    } as unknown as GraphicsContext;
    const counts = { objects: 19, instances: AutoGpuCullingThreshold * 19 * 4, levels: 4, graphics };
    const gpuCulled = (spheres: number) =>
      withMergedSignatures([signature], { gpuCulling: 'auto' }, { ...counts, spheres }).find((s) => s.merged)
        ?.gpuCulled ?? false;
    expect(gpuCulled(AutoGpuCullingMinSpheres)).toBe(true);
    expect(gpuCulled(AutoGpuCullingMinSpheres - 1)).toBe(false);
  });

  it('merges an object alone to cull it on the GPU, where the device does and it pays', () => {
    const entries = [{ visual: 0, renderObject: spheres(AutoGpuCullingMinInstances) }];
    const out: GraphicsRenderObject[] = [];
    const merged = mergeRenderObjectsByType(entries, 'auto', new Map(), out, 'auto', true);
    expect(out.length).toBe(1);
    expect(isMergedRenderObject(out[0])).toBe(true);
    expect((out[0].values as { gpuCulling?: { ref: { value: boolean } } }).gpuCulling?.ref.value).toBe(true);
    expect(merged.size).toBe(1);

    // without GPU culling on the device (WebGL) it stays as it is
    const plain: GraphicsRenderObject[] = [];
    mergeRenderObjectsByType(entries, 'auto', new Map(), plain, 'auto', false);
    expect(plain).toEqual([entries[0].renderObject]);
    // nor with fewer instances
    const few: GraphicsRenderObject[] = [];
    const fewer = spheres(AutoGpuCullingMinInstances - 1);
    mergeRenderObjectsByType([{ visual: 0, renderObject: fewer }], 'auto', new Map(), few, 'auto', true);
    expect(isMergedRenderObject(few[0])).toBe(false);
  });

  it('marks an object culled on the GPU for the raster only, by its spheres and not its instances', () => {
    const graphics = { capabilities: { atomicMinMax64: true } } as GraphicsContext;
    const rasterOnly = (o: GraphicsRenderObject) =>
      (o.values as { gpuCullingRasterOnly?: { ref: { value: boolean } } }).gpuCullingRasterOnly?.ref.value;
    const instances = 30_000;
    const ro = spheres(instances);
    expect(instances * ro.values.uVertexCount.ref.value).toBeGreaterThanOrEqual(AutoGpuCullingMinRasterSpheres);
    const out: GraphicsRenderObject[] = [];
    mergeRenderObjectsByType([{ visual: 0, renderObject: ro }], 'auto', new Map(), out, 'auto', true, graphics);
    expect((out[0].values as { gpuCulling?: { ref: { value: boolean } } }).gpuCulling?.ref.value).toBe(true);
    expect(rasterOnly(out[0])).toBe(true);
    // by its instances: culled on the GPU whatever the raster takes
    const many: GraphicsRenderObject[] = [];
    const entries = [{ visual: 0, renderObject: spheres(AutoGpuCullingMinInstances) }];
    mergeRenderObjectsByType(entries, 'auto', new Map(), many, 'auto', true, graphics);
    expect(rasterOnly(many[0])).toBe(false);
    // asked for: not for the raster only
    const asked: GraphicsRenderObject[] = [];
    mergeRenderObjectsByType([{ visual: 0, renderObject: ro }], 'auto', new Map(), asked, true, true, graphics);
    expect(rasterOnly(asked[0])).toBe(false);
  });

  it('merges by the number of units as before where GPU culling does not pay', () => {
    const entries = Array.from({ length: 31 }, (_, i) => ({ visual: i, renderObject: spheres(1) }));
    const out: GraphicsRenderObject[] = [];
    mergeRenderObjectsByType(entries, 'auto', new Map(), out, 'auto', true);
    expect(out.length).toBe(1);
    expect((out[0].values as { gpuCulling?: { ref: { value: boolean } } }).gpuCulling?.ref.value).toBe(false);
    // fewer units than `auto` merges: unmerged
    const small: GraphicsRenderObject[] = [];
    mergeRenderObjectsByType(entries.slice(0, 5), 'auto', new Map(), small, 'auto', true);
    expect(small.length).toBe(5);
  });
});
