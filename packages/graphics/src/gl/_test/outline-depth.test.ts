/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// A "both" edge stores the transparent depth as an 8-bit square root and the opaque depth in 16 bits.
// The compose pass hides the ghost when the opaque depth is greater. Both sides of that test go through
// this round trip, or a ghost a few Å in front is hidden (and one behind can be painted).

/** Reversed perspective depth, the inverse of `perspectiveDepthToViewZ`. */
function reversedDepth(z: number, near: number, far: number): number {
  return (near * (far - z)) / (z * (far - near));
}

/** The 8-bit square root a "both" edge stores, squared back. */
function outlineQuantizedDepth(depth: number): number {
  const q = Math.round(Math.sqrt(Math.max(depth, 0)) * 255) / 255;
  return q * q;
}

const Shaders = [
  'webgl/shader/postprocessing.frag.ts',
  'webgl/shader/illumination/compose.frag.ts',
  'webgpu/shader/postprocessing.wgsl.ts',
  'webgpu/shader/illumination.wgsl.ts',
];

describe('outline in-front test', () => {
  it('does not hide a ghost a few Å in front once both depths share the 8-bit square root', () => {
    const near = 1;
    const far = 20000;
    const opaque = reversedDepth(5000, near, far);
    const ghost = reversedDepth(4990, near, far);
    // the 16-bit opaque depth against the stored 8-bit ghost depth
    expect(opaque > outlineQuantizedDepth(ghost)).toBe(true);
    expect(outlineQuantizedDepth(opaque) > outlineQuantizedDepth(ghost)).toBe(false);
  });

  it('compares the two depths after that round trip, in every compose shader', () => {
    for (const file of Shaders) {
      const src = readFileSync(resolve(import.meta.dirname, '..', file), 'utf8');
      expect(src, file).toContain('outlineQuantizedDepth(');
      expect(src, file).not.toMatch(/opaqueDepth > outline(?:TransparentDepth|\.transparentDepth)/);
    }
  });
});
