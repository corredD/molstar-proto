/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { VolumeNeuralWeights } from './_generated/volume-neural-weights.js';

/** The network's weights as `tools/volume-lighting/train.py` writes them (`volume-lighting.md` §C1) */
export interface VolumeNetworkWeights {
  readonly layout: { readonly inputs: number; readonly hidden: number; readonly outputs: number };
  /** per input: the training range it is clamped to (a network extrapolates badly beyond it) */
  readonly lo: readonly number[];
  readonly hi: readonly number[];
  /** per output: its largest value (the key's phase peak, the sky's radiance 1) */
  readonly outMax: readonly number[];
  /** per input: normalized as `(x - mean) * scale` after the clamp */
  readonly mean: readonly number[];
  readonly scale: readonly number[];
  /** row major, out × in */
  readonly w1: readonly number[];
  readonly b1: readonly number[];
  readonly w2: readonly number[];
  readonly b2: readonly number[];
  readonly w3: readonly number[];
  readonly b3: readonly number[];
}

const sqrelu = (x: number) => (x > 0 ? x * x : 0);

function layer(w: readonly number[], b: readonly number[], x: ArrayLike<number>, act: boolean) {
  const out = new Array<number>(b.length);
  for (let o = 0; o < b.length; ++o) {
    let s = b[o];
    for (let i = 0; i < x.length; ++i) s += w[o * x.length + i] * x[i];
    out[o] = act ? sqrelu(s) : s;
  }
  return out;
}

/**
 * The network in TypeScript, the reference of the WGSL one: `input` the 13 descriptors of §A2 and the albedo, returns
 * the key light's and the ambient light's in-scatter
 */
export function evaluateVolumeNetwork(input: ArrayLike<number>, w: VolumeNetworkWeights = VolumeNeuralWeights) {
  const x = Array.from(
    { length: w.layout.inputs },
    (_, i) => (Math.min(Math.max(input[i], w.lo[i]), w.hi[i]) - w.mean[i]) * w.scale[i],
  );
  const o = layer(w.w3, w.b3, layer(w.w2, w.b2, layer(w.w1, w.b1, x, true), true), false);
  return o.map((v, i) => Math.min(v * v, w.outMax[i]));
}

/** a WGSL float literal of `x` (the shortest decimal that rounds back to it) */
const lit = (x: number) => {
  const s = String(x);
  return /[.e]/.test(s) ? s : `${s}.0`;
};

/** `mat4x{rows}<f32>` of the block of `w` (row major, `cols` wide) at rows `r0..`, columns `c0..c0 + 4`, 0 beyond */
function block(w: readonly number[], cols: number, rowCount: number, r0: number, c0: number, rows: number) {
  const v: string[] = [];
  for (let c = 0; c < 4; ++c) {
    for (let r = 0; r < rows; ++r) {
      const row = r0 + r;
      const col = c0 + c;
      v.push(row < rowCount && col < cols ? lit(w[row * cols + col]) : '0.0');
    }
  }
  return `mat4x${rows}<f32>(${v.join(', ')})`;
}

function vec4(a: readonly number[], i0: number, pad: number) {
  return `vec4<f32>(${[0, 1, 2, 3].map((k) => (i0 + k < a.length ? lit(a[i0 + k]) : lit(pad))).join(', ')})`;
}

/**
 * The network in WGSL from `w` (`volume-lighting.md` §C3): constants only, the 14 inputs in 4 vec4s (clamped to the
 * training range, then normalized), each layer as
 * 4×4 blocks (`mat4x4` and, for the 2 outputs, `mat4x2`); `volumeNetwork` takes the descriptors of
 * `volumeDescriptors` and the albedo
 */
export function getVolumeNetworkWgsl(w: VolumeNetworkWeights = VolumeNeuralWeights) {
  const { inputs, hidden, outputs } = w.layout;
  if (inputs !== 14 || hidden !== 16 || outputs !== 2) throw new Error('volume network: unexpected layout');
  const lines: string[] = [];
  for (let i = 0; i < 4; ++i) {
    lines.push(`const VnLo${i} = ${vec4(w.lo, 4 * i, 0)};`);
    lines.push(`const VnHi${i} = ${vec4(w.hi, 4 * i, 0)};`);
    lines.push(`const VnMean${i} = ${vec4(w.mean, 4 * i, 0)};`);
    lines.push(`const VnScale${i} = ${vec4(w.scale, 4 * i, 0)};`);
  }
  const sum = (bias: string, mats: (k: number) => string, x: string) =>
    `${bias} + ${[0, 1, 2, 3].map((k) => `${mats(k)} * ${x}${k}`).join(' + ')}`;
  const hiddenLayer = (wt: readonly number[], b: readonly number[], cols: number, name: string, x: string) => {
    const out: string[] = [];
    for (let j = 0; j < 4; ++j) {
      for (let k = 0; k < 4; ++k) lines.push(`const ${name}${j}${k} = ${block(wt, cols, hidden, 4 * j, 4 * k, 4)};`);
      out.push(`    let ${name.toLowerCase()}${j} = sqrelu4(${sum(vec4(b, 4 * j, 0), (k) => `${name}${j}${k}`, x)});`);
    }
    return out;
  };
  const body = [
    ...[
      'vec4<f32>(d.around0, d.around1.x)',
      'vec4<f32>(d.around1.yz, d.light0.xy)',
      'vec4<f32>(d.light0.z, d.light1)',
      'vec4<f32>(d.cosine, albedo, 0.0, 0.0)',
    ].map((v, i) => `    let x${i} = (clamp(${v}, VnLo${i}, VnHi${i}) - VnMean${i}) * VnScale${i};`),
    ...hiddenLayer(w.w1, w.b1, inputs, 'VnA', 'x'),
    ...hiddenLayer(w.w2, w.b2, hidden, 'VnB', 'vna'),
  ];
  for (let k = 0; k < 4; ++k) lines.push(`const VnC${k} = ${block(w.w3, hidden, outputs, 0, 4 * k, 2)};`);
  body.push(
    `    let o = vec2<f32>(${lit(w.b3[0])}, ${lit(w.b3[1])}) + ${[0, 1, 2, 3].map((k) => `VnC${k} * vnb${k}`).join(' + ')};`,
  );
  body.push(`    return min(o * o, vec2<f32>(${lit(w.outMax[0])}, ${lit(w.outMax[1])}));`);
  return /* wgsl */ `
${lines.join('\n')}

fn sqrelu4(x: vec4<f32>) -> vec4<f32> {
    let r = max(x, vec4<f32>(0.0));
    return r * r;
}

/** the key light's and the ambient light's in-scatter at a sample (\`volume-lighting.md\` §C1) */
fn volumeNetwork(d: VolumeDescriptors, albedo: f32) -> vec2<f32> {
${body.join('\n')}
}
`;
}
