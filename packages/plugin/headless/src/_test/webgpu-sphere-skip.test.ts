/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Interval } from '@molstar/core/data/int';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { Color } from '@molstar/core/util/color';
import { MarkerAction } from '@molstar/core/util/marker-action';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { ValueCell } from '@molstar/core/util/value-cell';
import * as Shape from '@molstar/graphics/geo/shape/shape';
import { Spheres } from '@molstar/graphics/geo/geometry/spheres/spheres';
import { SpheresBuilder } from '@molstar/graphics/geo/geometry/spheres/spheres-builder';
import { ShapeRepresentation } from '@molstar/graphics/repr/shape/representation';
import { Visual } from '@molstar/graphics/repr/visual';
import { HeadlessPluginContext } from '@molstar/plugin-headless/context';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';
import { WebGPU } from './webgpu-module.js';

// Spheres a pass discards whole leave in the vertex stage (sphere-impostors.md), on WebGPU (Dawn): the image as with
// every sphere projected (`dNoVertexSkip`), and what each skip must keep drawn. A wrong skip (a sphere marked or seen
// left out, an occluder left out of the marking depth, a transparency on the wrong side of the 0.09 cutoff, another
// instance's or group's value read) changes the image. That the skip happens at all leaves no pixel: the frame times
// show it (apps/prism-me/progress/2026-10-31-marking-cost.md) and graphics `gl/_test/marking-mask-clip.test.ts` locks
// the guards. The WebGL twin: graphics `canvas3d/_test/sphere-skip-draw.test.ts`.

const Size = 128;
const Highlight = Color(0xff00ff);
/** Per group: center and color; group 0 in front of group 1 (marked behind it), 2 to 4 of transparency 0.5, 0.05, 0 */
const Groups = [
  { center: [0, 0, 4], color: 0x3f7fbf },
  { center: [1.2, 0, 0], color: 0x3fbf7f },
  { center: [-4, 0, 0], color: 0xbf3f3f },
  { center: [4, 0, 0], color: 0xbfbf3f },
  { center: [0, 4, 0], color: 0x7f3fbf },
] as const;
/** Two instances: the second below the first */
const Transforms = [Mat4.identity(), Mat4.fromTranslation(Mat4(), Vec3.create(0, -9, 0))];
/** Per group its transparency (0 to 1); in the second instance only the first two groups' */
const Transparency = [0, 0, 0.5, 0.05, 0];

function spheres() {
  const builder = SpheresBuilder.create(Groups.length, 1);
  Groups.forEach(({ center }, i) => builder.add(center[0], center[1], center[2], i));
  return Shape.create(
    's',
    {},
    builder.getSpheres(),
    (g) => Color(Groups[g].color),
    () => 1.5,
    () => 's',
    Transforms,
    Groups.length,
  );
}

type Options = {
  ghostEdgeStrength: number;
  transparency: 'wboit' | 'dpoit' | 'blended';
  xray?: true | 'inverted';
  /** the object's alpha, alpha thickness, transparency strength (the skip's guards: per fragment where not 1, 0, 1) */
  alpha?: number;
  alphaThickness?: number;
  strength?: number;
  mark?: MarkerAction;
};

/** The spheres on a WebGPU canvas; `draw(skip)` the image with the skip on, or with every sphere projected */
async function setup(options: Options) {
  const plugin = await HeadlessPluginContext.create(
    { webgpu: WebGPU.module! },
    DefaultPluginSpec(),
    { width: Size, height: Size },
    { backend: 'webgpu' },
  );
  await plugin.init();
  const canvas = plugin.canvas3d!;
  const postprocessing = {
    enabled: true,
    occlusion: { name: 'off', params: {} },
    shadow: { name: 'off', params: {} },
    outline: { name: 'off', params: {} },
  } as any;
  canvas.setProps({
    renderer: { ...canvas.props.renderer, backgroundColor: Color(0xffffff) },
    multiSample: { ...canvas.props.multiSample, mode: 'off' },
    camera: { ...canvas.props.camera, mode: 'perspective' },
    postprocessing,
    marking: {
      enabled: true,
      highlightEdgeColor: Highlight,
      selectEdgeColor: Highlight,
      ghostEdgeStrength: options.ghostEdgeStrength,
      edgeScale: 1,
      innerEdgeFactor: 1.5,
      highlightEdgeStrength: 1,
      selectEdgeStrength: 1,
    },
  } as any);
  // the transparency mode is the context's
  plugin.canvas3dContext!.setProps({ transparency: options.transparency });
  expect(plugin.canvas3dContext!.props.transparency).toBe(options.transparency);
  const repr = ShapeRepresentation(spheres, Spheres.Utils, { graphics: canvas.graphics });
  const params = {
    ...PD.getDefaultValues(Spheres.Params),
    // `true`, not 'on': the param's values (`createValues`)
    xrayShaded: options.xray ?? false,
    alpha: options.alpha ?? 1,
    alphaThickness: options.alphaThickness ?? 0,
  };
  await repr.createOrUpdate(params as any, {}).run();
  const object = repr.renderObjects[0];
  // a transparency per group and instance (`groupInstance`): the layers' loci stand for their ranges
  const layers = Transparency.map((value, g) => ({ loci: { kind: 'group', g } as any, value }));
  Visual.setTransparency(
    object,
    { kind: 'element-loci', layers } as any,
    (loci: any, apply) => {
      apply(Interval.ofBounds(loci.g, loci.g + 1));
      if (loci.g < 2) apply(Interval.ofBounds(Groups.length + loci.g, Groups.length + loci.g + 1));
      return true;
    },
    true,
  );
  if (options.strength !== undefined) ValueCell.update(object.values.uTransparencyStrength, options.strength);
  // the guards' inputs as the case asks
  expect(object.values.dXrayShaded.ref.value).toBe(options.xray === true ? 'on' : (options.xray ?? 'off'));
  expect(object.values.uAlpha.ref.value).toBe(options.alpha ?? 1);
  canvas.add(repr);
  canvas.requestCameraReset({ durationMs: 0 });
  canvas.commit(true);
  // the marked: group 1 of the first instance (behind group 0), group 4 of the second
  // (`groupInstance` markers: instance × group count + group; the loci stands for the ranges)
  if (options.mark !== undefined) {
    Visual.mark(object, { kind: 'marked' } as any, options.mark, (_, apply) => {
      apply(Interval.ofBounds(1, 2));
      apply(Interval.ofBounds(Groups.length + 4, Groups.length + 5));
      return true;
    });
  }
  const graphics = canvas.graphics;
  // the image pass with the canvas' marking, one sample (its default is 4: edges blended)
  (plugin as any).renderer.imagePass.setProps({
    marking: canvas.props.marking,
    multiSample: { ...canvas.props.multiSample, mode: 'off' },
  });
  const draw = async (skip: boolean) => {
    ValueCell.updateIfChanged(object.values.dNoVertexSkip, !skip);
    canvas.update(repr);
    // the programs of the define compile in the background: images until they are drawn
    let image = (await plugin.getImageRaw({ width: Size, height: Size }, postprocessing)).data;
    for (let i = 0; i < 10; ++i) {
      await graphics.resources.pending.whenReady();
      image = (await plugin.getImageRaw({ width: Size, height: Size }, postprocessing)).data;
    }
    return image;
  };
  /** the pixels within 24 of `color` in each channel */
  const count = (pixels: ArrayLike<number>, color: number) => {
    const [r, g, b] = [(color >> 16) & 255, (color >> 8) & 255, color & 255];
    let n = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (Math.abs(pixels[i] - r) < 24 && Math.abs(pixels[i + 1] - g) < 24 && Math.abs(pixels[i + 2] - b) < 24) n++;
    }
    return n;
  };
  return { plugin, draw, count };
}

/** The pixels that differ between `a` and `b` */
function differing(a: ArrayLike<number>, b: ArrayLike<number>) {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
  }
  return n;
}

describe.skipIf(!WebGPU.module)('spheres skipped in the vertex stage (WebGPU)', () => {
  const cases: [string, Options][] = [
    [
      'highlighted, ghost edge 0.3 (the marking depth), wboit',
      { ghostEdgeStrength: 0.3, transparency: 'wboit', mark: MarkerAction.Highlight },
    ],
    ['highlighted, ghost edge 1, wboit', { ghostEdgeStrength: 1, transparency: 'wboit', mark: MarkerAction.Highlight }],
    ['selected, ghost edge 0.3, dpoit', { ghostEdgeStrength: 0.3, transparency: 'dpoit', mark: MarkerAction.Select }],
    ['nothing marked, blended', { ghostEdgeStrength: 1, transparency: 'blended' }],
    ['x-ray, wboit', { ghostEdgeStrength: 1, transparency: 'wboit', xray: true, mark: MarkerAction.Highlight }],
    ['inverted x-ray, dpoit', { ghostEdgeStrength: 1, transparency: 'dpoit', xray: 'inverted' }],
    // alpha below 1: a sphere below the cutoff is transparent, drawn by the transparent pass
    ['alpha 0.5, wboit', { ghostEdgeStrength: 1, transparency: 'wboit', alpha: 0.5, mark: MarkerAction.Highlight }],
    // thin spheres more transparent in the transparent pass, whatever their transparency; with a float depth (here) no
    // pixel shows that guard: the opaque pass draws those spheres, their transparent fragments at the same depth are
    // dropped; with a quantized depth (WebGPU without depth32float-stencil8, WebGL1) about half of them pass
    ['alpha thickness, wboit', { ghostEdgeStrength: 1, transparency: 'wboit', alphaThickness: 4 }],
    // the strength scales the transparency before the cutoff: the 0.5 group at 0.075 is drawn opaque
    ['transparency strength 0.15, blended', { ghostEdgeStrength: 1, transparency: 'blended', strength: 0.15 }],
  ];
  for (const [name, options] of cases) {
    it(`draws the image of every sphere projected: ${name}`, async () => {
      const s = await setup(options);
      try {
        const all = await s.draw(false);
        const skipped = await s.draw(true);
        // the marked spheres' edges are drawn, every group's color is seen (the opaque, the one below the cutoff drawn
        // opaque, the half transparent blended)
        if (options.mark !== undefined) expect(s.count(skipped, Highlight)).toBeGreaterThan(20);
        if (!options.xray && (options.alpha ?? 1) === 1 && !options.alphaThickness) {
          for (const g of [0, 3, 4]) expect(s.count(skipped, Groups[g].color), `group ${g}`).toBeGreaterThan(20);
        }
        expect(new Set(Array.from(skipped)).size).toBeGreaterThan(10);
        expect(differing(all, skipped)).toBe(0);
      } finally {
        s.plugin.dispose();
      }
    }, 60_000);
  }

  it('the occluder stays in the marking depth: the hidden part of the marked sphere at the ghost strength', async () => {
    const weak = await setup({ ghostEdgeStrength: 0.3, transparency: 'wboit', mark: MarkerAction.Highlight });
    const full = await setup({ ghostEdgeStrength: 1, transparency: 'wboit', mark: MarkerAction.Highlight });
    try {
      // fewer full-strength edge pixels where the hidden edge is drawn faint
      expect(weak.count(await weak.draw(true), Highlight)).toBeLessThan(full.count(await full.draw(true), Highlight));
    } finally {
      weak.plugin.dispose();
      full.plugin.dispose();
    }
  }, 60_000);
});
