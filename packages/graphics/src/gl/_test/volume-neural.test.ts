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

  it('lights a uniform dense block near 0, however dense (no glow past the training range)', () => {
    // every read σ: deep inside a dense block, where the light and the sky are blocked
    for (const sigma of [1, 2, 4, 6.9]) {
      const [key, ambient] = evaluateVolumeNetwork([...Array(12).fill(sigma), 0, 0.8]);
      expect(key, `key at σ ${sigma}`).toBeLessThan(0.1);
      expect(ambient, `ambient at σ ${sigma}`).toBeLessThan(0.1);
    }
  });

  it('writes every weight into the WGSL as a literal', () => {
    const wgsl = getVolumeNetworkWgsl();
    const { w1, w2, w3 } = VolumeNeuralWeights;
    for (const w of [w1, w2, w3]) for (const v of w) expect(wgsl).toContain(String(v));
    expect(wgsl).not.toMatch(/NaN|Infinity/);
    // 16 + 16 blocks of 4×4 and 4 of 4×2
    expect(wgsl.match(/mat4x4<f32>\(/g)?.length).toBe(32);
    expect(wgsl.match(/mat4x2<f32>\(/g)?.length).toBe(4);
  });
});
