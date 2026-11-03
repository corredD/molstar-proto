/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { VolumeNeuralWeights } from '../webgpu/shader/_generated/volume-neural-weights.js';
import { evaluateVolumeNetwork, getVolumeNetworkWgsl } from '../webgpu/shader/volume-neural.wgsl.js';

describe('volume network', () => {
  it("gives PyTorch's outputs for the weights' check inputs", () => {
    const { inputs, outputs } = VolumeNeuralWeights.check;
    for (let i = 0; i < outputs.length / 2; ++i) {
      const out = evaluateVolumeNetwork(inputs.slice(i * 14, i * 14 + 14));
      for (let k = 0; k < 2; ++k) expect(out[k]).toBeCloseTo(outputs[i * 2 + k], 5);
    }
  });

  it('writes every weight into the WGSL once, as a literal', () => {
    const wgsl = getVolumeNetworkWgsl();
    const { w1, w2, w3 } = VolumeNeuralWeights;
    for (const w of [w1, w2, w3]) for (const v of w.slice(0, 20)) expect(wgsl).toContain(String(v));
    expect(wgsl).not.toMatch(/NaN|Infinity/);
    // 16 + 16 blocks of 4×4 and 4 of 4×2
    expect(wgsl.match(/mat4x4<f32>\(/g)?.length).toBe(32);
    expect(wgsl.match(/mat4x2<f32>\(/g)?.length).toBe(4);
  });
});
