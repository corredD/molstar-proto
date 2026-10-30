/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { ValueCell } from '@molstar/core/util';
import type { Clip } from '@molstar/core/util/clip';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { Points } from '@molstar/graphics/geo/geometry/points/points';
import { ColorNames } from '@molstar/core/util/color/names';
import { createRenderObject } from '../render-object.js';
import { Scene } from '../scene.js';
import { checkGhost, checkOpaque, DrawFact, DrawState, getCheckFacts } from '../draw-table.js';
import { PostprocessingParams, PostprocessingPass } from '../../canvas3d/passes/postprocessing.js';
import { OutlineParams } from '../../canvas3d/passes/outline.js';
import { createGl } from './gl.shim.js';
import { createRenderer } from './renderer.test.js';
import { ShaderManager } from '../../canvas3d/helper/shader-manager.js';
import { IlluminationParams } from '../../canvas3d/passes/illumination.js';
import { MarkingParams } from '../../canvas3d/passes/marking.js';

// Ghosts of what is cut (cellview.md §4.3): what a ghosted clip object cuts is drawn again as outlines only, by a depth
// draw into the transparent depth target that the outline pass reads.

const plane = (ghost?: boolean): Clip.Props['objects'][number] => ({
  type: 'plane',
  invert: false,
  position: Vec3(),
  rotation: { axis: Vec3.create(1, 0, 0), angle: 0 },
  scale: Vec3.create(1, 1, 1),
  transform: Mat4.identity(),
  ...(ghost === undefined ? {} : { ghost }),
});

/** A points object that draws, cut by planes, the ghosted ones as `ghosts` says */
function cutPoints(...ghosts: (boolean | undefined)[]) {
  const props = {
    ...PD.getDefaultValues(Points.Params),
    clip: { variant: 'instance' as const, objects: ghosts.map(plane) },
  };
  const values = Points.Utils.createValuesSimple(Points.createEmpty(), props, ColorNames.orange, 1);
  ValueCell.update(values.drawCount, 1);
  return createRenderObject('points', values, Points.Utils.createRenderableState(props), -1);
}

const outline = (name: 'on' | 'off') => {
  const props = PD.getDefaultValues(PostprocessingParams);
  return {
    ...props,
    enabled: true,
    outline:
      name === 'on'
        ? { name, params: { ...PD.getDefaultValues(OutlineParams), includeTransparent: false } }
        : { name, params: {} },
  } as typeof props;
};

describe('clip ghosts', () => {
  it('an object with a ghosted clip object is drawn by the ghost pass, and opaque as before', () => {
    const facts = (o: ReturnType<typeof cutPoints>) => getCheckFacts(o.values);
    expect(cutPoints(false, true).values.uClipObjectGhost.ref.value).toBe(0b10);
    expect(checkGhost(facts(cutPoints(false, true)), DrawState.Visible)).toBe(true);
    expect(checkOpaque(facts(cutPoints(false, true)), DrawState.Visible)).toBe(true);
    expect(checkGhost(facts(cutPoints(false, undefined)), DrawState.Visible)).toBe(false);
    expect(facts(cutPoints()) & DrawFact.Ghost).toBe(0);
  });

  it('the scene has ghosts while a visible object has a ghosted clip object', () => {
    const { ctx } = createRenderer(createGl(32, 32, { preserveDrawingBuffer: true }));
    const scene = Scene.create(ctx);
    const o = cutPoints(true);
    scene.add(o);
    scene.commit();
    expect(scene.hasGhosts).toBe(true);
    expect(scene.hasAnimation).toBe(false);

    ValueCell.update(o.values.uClipObjectGhost, 0);
    scene.update([o], true);
    expect(scene.hasGhosts).toBe(false);
  });

  it('the transparent depth is drawn for ghosts while outlines are on, its transparent outlines with them', () => {
    const { ctx } = createRenderer(createGl(32, 32, { preserveDrawingBuffer: true }));
    const scene = Scene.create(ctx);
    scene.add(cutPoints(false));
    scene.commit();
    expect(PostprocessingPass.isGhostDepthRequired(scene, outline('on'))).toBe(false);

    const ghosted = Scene.create(ctx);
    ghosted.add(cutPoints(true));
    ghosted.commit();
    expect(PostprocessingPass.isGhostDepthRequired(ghosted, outline('on'))).toBe(true);
    expect(PostprocessingPass.isGhostDepthRequired(ghosted, outline('off'))).toBe(false);
    // the app's look leaves transparent objects out of the outlines: the ghosts only are in the transparent depth
    expect(PostprocessingPass.isTransparentDepthRequired(ghosted, outline('on'))).toBe(false);
  });

  it('the depth programs are required while ghosts are drawn (else the ghost draw finds none ready)', () => {
    const { ctx } = createRenderer(createGl(32, 32, { preserveDrawingBuffer: true }));
    const ghosted = Scene.create(ctx);
    ghosted.add(cutPoints(true));
    ghosted.commit();
    const props = (name: 'on' | 'off') => ({
      marking: PD.getDefaultValues(MarkingParams),
      illumination: { ...PD.getDefaultValues(IlluminationParams), enabled: false },
      postprocessing: outline(name),
    });
    // with draw buffers and depth textures, depth is required for a reason of the scene's only
    const graphics = {
      capabilities: { ...ctx.capabilities, multipleRenderTargets: true, depthTexture: true },
    } as typeof ctx;
    const depth = (name: 'on' | 'off') => ShaderManager.getRequired(graphics, ghosted, props(name)).includes('depth');
    expect(depth('off')).toBe(false);
    expect(depth('on')).toBe(true);
  });

  it("transparent outlines keep the outline's color unless given one of their own (the ghosts')", () => {
    expect(PD.getDefaultValues(OutlineParams).transparentColor).toBe(null);
  });
});
