/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { type KeepCanvas, keepCamera } from '../prism-adapter.js';

// The camera kept while tiles are written (prism.md §9; Ludo's app check, 2026-11-10: the camera re-centered by itself
// as tiles streamed in). Canvas3D resets the camera on a scene commit that brings a renderable outside the old bounds
// (`shouldResetCamera`), unless `camera.manualReset`: the hold sets it for the tile write and the canvas commit that
// follows, then puts it back and lets `radiusMax` follow the scene as Canvas3D would. Against a recording canvas (quick
// lane: no WebGL here, so Canvas3D's own reset is not run; see the progress file).

function recordingCanvas(o: { manualReset?: boolean; reprs?: number; radius?: number } = {}) {
  const calls: string[] = [];
  const props = { camera: { manualReset: o.manualReset ?? false }, sceneRadiusFactor: 1 };
  const canvas = {
    get props() {
      return { camera: { ...props.camera }, sceneRadiusFactor: props.sceneRadiusFactor };
    },
    setProps(p: { camera?: { manualReset?: boolean } }) {
      if (p.camera?.manualReset !== undefined) {
        props.camera.manualReset = p.camera.manualReset;
        calls.push(`manualReset ${p.camera.manualReset}`);
      }
    },
    commit: (sync?: boolean) => calls.push(`commit ${!!sync}`),
    reprCount: { value: o.reprs ?? 2 },
    boundingSphere: { center: [0, 0, 0], radius: o.radius ?? 6000 },
    camera: {
      setState: (s: Record<string, unknown>, ms?: number) => calls.push(`setState ${JSON.stringify(s)} ${ms}`),
    },
  } as unknown as KeepCanvas;
  return { canvas, calls, held: () => props.camera.manualReset };
}

describe('the camera kept while tiles are written', () => {
  it('the write and its canvas commit run with manualReset; then it is put back and radiusMax follows', async () => {
    const { canvas, calls, held } = recordingCanvas();
    const out = await keepCamera(canvas, async () => {
      calls.push(`write (held ${held()})`);
      return 7;
    });
    expect(out).toBe(7);
    expect(calls).toEqual([
      'manualReset true',
      'write (held true)',
      'commit true',
      'manualReset false',
      'setState {"radiusMax":6000} 0',
    ]);
  });

  it('a write that throws: committed and put back all the same', async () => {
    const { canvas, calls, held } = recordingCanvas();
    await expect(
      keepCamera(canvas, async () => {
        throw new Error('no');
      }),
    ).rejects.toThrow('no');
    expect(held()).toBe(false);
    expect(calls.slice(0, 3)).toEqual(['manualReset true', 'commit true', 'manualReset false']);
  });

  it("a manualReset already set (someone else's) is left as it is", async () => {
    const { canvas, calls, held } = recordingCanvas({ manualReset: true });
    await keepCamera(canvas, async () => void calls.push('write'));
    expect(calls).toEqual(['write']);
    expect(held()).toBe(true);
  });

  it("no hold on a canvas with no representation yet: Canvas3D's first reset frames the scene", async () => {
    const { canvas, calls } = recordingCanvas({ reprs: 0 });
    await keepCamera(canvas, async () => void calls.push('write'));
    expect(calls).toEqual(['write']);
  });

  it('no canvas (headless): the write alone', async () => {
    let ran = false;
    await keepCamera(undefined, async () => void (ran = true));
    expect(ran).toBe(true);
  });

  it('an empty scene after the write: radiusMax left alone', async () => {
    const { canvas, calls } = recordingCanvas({ radius: 0 });
    await keepCamera(canvas, async () => {});
    expect(calls).toEqual(['manualReset true', 'commit true', 'manualReset false']);
  });
});
