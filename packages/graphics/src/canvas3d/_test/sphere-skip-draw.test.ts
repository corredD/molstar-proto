/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// @vitest-environment jsdom
// @module-tag medium

import { Interval, OrderedSet } from '@molstar/core/data/int';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { DefaultAssetManager } from '@molstar/core/util/assets';
import { Color } from '@molstar/core/util/color';
import { MarkerAction } from '@molstar/core/util/marker-action';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { ValueCell } from '@molstar/core/util/value-cell';
import { Shape, ShapeGroup } from '@molstar/model/model/shape';
import { describe, expect, it } from 'vitest';
import { Spheres } from '../../geo/geometry/spheres/spheres.js';
import { SpheresBuilder } from '../../geo/geometry/spheres/spheres-builder.js';
import { tryGetGLContext } from '../../gl/_test/gl.js';
import { ShapeRepresentation } from '../../repr/shape/representation.js';
import { Visual } from '../../repr/visual.js';
import { Canvas3D, Canvas3DContext } from '../canvas3d.js';

// Spheres a pass discards whole leave in the vertex stage (sphere-impostors.md), drawn on the native backend (WebGL1,
// `pnpm native:install`; skipped where it has no `EXT_frag_depth`, as headless-gl on macOS): the image as with every sphere projected (`dNoVertexSkip`), and what each skip must keep
// drawn. A wrong skip (a sphere marked or seen left out, an occluder left out of the marking depth, a transparency on
// the wrong side of the 0.09 cutoff, another instance's or group's value read) changes the image. That the skip
// happens at all leaves no pixel: the frame times show it (apps/prism-me/progress/2026-10-31-marking-cost.md) and
// `gl/_test/marking-mask-clip.test.ts` locks the guards. The WebGPU twin: plugin headless
// `_test/webgpu-sphere-skip.test.ts`.

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
/** Per group its transparency (0 to 1), in the second instance only the first two groups' */
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
    Groups.length,
    Transforms,
  );
}

/** The canvas, the spheres, and `draw(skip)`: the pixels with the skip on, or every sphere projected */
async function setup(options: { ghostEdgeStrength: number; transparency: 'wboit' | 'blended' }) {
  const graphics = tryGetGLContext(Size, Size, { fragDepth: true });
  if (!graphics) return;
  const ctx = Canvas3DContext.fromGraphics(document.createElement('canvas'), graphics, new DefaultAssetManager());
  const canvas = Canvas3D.create(ctx);
  canvas.setProps({
    renderer: { backgroundColor: Color(0xffffff) },
    multiSample: { mode: 'off' },
    camera: { mode: 'perspective', helper: { axes: { name: 'off', params: {} } } },
    postprocessing: {
      enabled: true,
      occlusion: { name: 'off', params: {} },
      shadow: { name: 'off', params: {} },
      outline: { name: 'off', params: {} },
    },
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
  ctx.setProps({ transparency: options.transparency });
  let shape: Shape<Spheres> | undefined;
  const repr = ShapeRepresentation(() => (shape = spheres()), Spheres.Utils, { graphics: canvas.graphics });
  await repr.createOrUpdate({ ...PD.getDefaultValues(Spheres.Params) } as any, {}).run();
  const object = repr.renderObjects[0];
  // a transparency per group and instance (`groupInstance`): the layers' loci stand for their ranges
  const layers = Transparency.map((value, g) => ({ loci: { kind: 'group', g } as any, value }));
  Visual.setTransparency(
    object,
    { kind: 'element-loci', layers } as any,
    (loci: any, apply) => {
      apply(Interval.ofBounds(loci.g, loci.g + 1));
      // the second instance: its first two groups only
      if (loci.g < 2) apply(Interval.ofBounds(Groups.length + loci.g, Groups.length + loci.g + 1));
      return true;
    },
    true,
  );
  canvas.add(repr);
  canvas.requestCameraReset({ durationMs: 0 });
  canvas.commit(true);
  // the marked: group 1 of the first instance (behind group 0), group 4 of the second
  repr.mark(
    ShapeGroup.Loci(shape!, [
      { ids: OrderedSet.ofSingleton(1), instance: 0 },
      { ids: OrderedSet.ofSingleton(4), instance: 1 },
    ]),
    MarkerAction.Highlight,
  );

  const draw = (skip: boolean) => {
    ValueCell.updateIfChanged(object.values.dNoVertexSkip, !skip);
    canvas.update(repr);
    canvas.commit(true);
    canvas.requestDraw();
    canvas.tick(0 as any, { isSynchronous: true } as any);
    const gl = (canvas.graphics as any).gl as WebGLRenderingContext;
    const pixels = new Uint8Array(Size * Size * 4);
    gl.readPixels(0, 0, Size, Size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  };
  /** the pixels within 24 of `color` in each channel */
  const count = (pixels: Uint8Array, color: number) => {
    const [r, g, b] = [(color >> 16) & 255, (color >> 8) & 255, color & 255];
    let n = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (Math.abs(pixels[i] - r) < 24 && Math.abs(pixels[i + 1] - g) < 24 && Math.abs(pixels[i + 2] - b) < 24) n++;
    }
    return n;
  };
  return { canvas, draw, count };
}

/** The pixels that differ between `a` and `b` */
function differing(a: Uint8Array, b: Uint8Array) {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
  }
  return n;
}

/** Sphere impostors need `EXT_frag_depth`, which headless-gl lacks: the suite runs where a WebGL context has it */
const canDraw = !!tryGetGLContext(1, 1, { fragDepth: true });

describe.skipIf(!canDraw)('spheres skipped in the vertex stage (native GL)', () => {
  for (const ghostEdgeStrength of [0.3, 1]) {
    for (const transparency of ['wboit', 'blended'] as const) {
      it(`draws the image of every sphere projected: ghost edge ${ghostEdgeStrength}, ${transparency}`, async () => {
        const s = (await setup({ ghostEdgeStrength, transparency }))!;
        try {
          const all = s.draw(false);
          const skipped = s.draw(true);
          // the marked spheres' edges are drawn, every group's color is seen (the opaque, the half transparent, the
          // one below the cutoff drawn opaque)
          expect(s.count(skipped, Highlight)).toBeGreaterThan(20);
          for (const g of [0, 3, 4]) expect(s.count(skipped, Groups[g].color), `group ${g}`).toBeGreaterThan(20);
          expect(differing(all, skipped)).toBe(0);
        } finally {
          s.canvas.dispose();
        }
      });
    }
  }

  it('the occluder stays in the marking depth: the hidden part of the marked sphere at the ghost strength', async () => {
    const weak = (await setup({ ghostEdgeStrength: 0.3, transparency: 'wboit' }))!;
    const full = (await setup({ ghostEdgeStrength: 1, transparency: 'wboit' }))!;
    try {
      // fewer full-strength edge pixels where the hidden edge is drawn faint
      expect(weak.count(weak.draw(true), Highlight)).toBeLessThan(full.count(full.draw(true), Highlight));
    } finally {
      weak.canvas.dispose();
      full.canvas.dispose();
    }
  });
});
