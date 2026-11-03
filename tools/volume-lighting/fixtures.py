# Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
#
# @author Ludovic Autin <autin@scripps.edu>
"""Writes the descriptor fixture of the shader's Dawn test (`webgpu-volume-neural.test.ts`, `_test/_generated/volume-descriptors.json`): a grid and a transfer
function from integer formulas the test repeats, sample points and lights, the descriptors this package computes, and
per descriptor a bound from the GPU filters' precision (volume-lighting.md §A2 reads with hardware filtering: its
sub-texel weights have FILTER_BITS bits, so the shader's values cannot be the Python's bit for bit)."""

import json
import sys

import numpy as np
import torch

from vl.descriptors import RADII, descriptors, sample_level, to_torch
from vl.grid import TF_SIZE, cell_sigma, pyramid
from vl.tracer import Medium

DIM = (24, 20, 18)
FILTER_BITS = 8  # the least sub-texel precision WebGPU implementations filter with (D3D's minimum)
Q = 2.0**-FILTER_BITS


def grid_bytes() -> np.ndarray:
    """x, y, z order: a blob with a little integer noise"""
    x, y, z = np.meshgrid(*(np.arange(n) for n in DIM), indexing='ij')
    b = np.maximum(0, 255 - 9 * (np.abs(x - 12) + np.abs(y - 10) + np.abs(z - 9))) + (x * 7 + y * 3 + z * 5) % 13
    return np.minimum(b, 255).astype(np.uint8)


def transfer_bytes() -> np.ndarray:
    i = np.arange(TF_SIZE)
    return np.where(i < 40, 0, np.minimum(255, (i - 40) * 2)).astype(np.uint8)


class Table:
    def __init__(self, t):
        self.t = t

    def table(self):
        return self.t


def corners(level: np.ndarray, y: np.ndarray, k: int):
    """the 8 texels a trilinear read of `level` (texel size 2^k cells) at y takes"""
    f = y / float(1 << k) - 0.5
    i0 = np.clip(np.floor(f).astype(int), 0, np.array(level.shape) - 1)
    i1 = np.clip(np.floor(f).astype(int) + 1, 0, np.array(level.shape) - 1)
    return np.array([level[(i1 if c & 1 else i0)[0], (i1 if c & 2 else i0)[1], (i1 if c & 4 else i0)[2]]
                     for c in range(8)], np.float64)


def bound0(values: np.ndarray, table: np.ndarray, y: np.ndarray) -> float:
    """S_0's bound: the filtered value v off by dv = 3 Q (range of its 8 cells) + 2^-12, so the table read at
    v · 256 − 0.5 off by its change over ±dv plus Q of its step there, then σ' = 1 / (1 − α) over that α range"""
    c = corners(values, y, 0)
    v = float(sample_level(torch.from_numpy(values), torch.from_numpy(y[None].astype(np.float32)), 0)[0])
    dv = 3 * Q * (c.max() - c.min()) + 2.0**-12

    def alpha(u):
        x = np.clip(u * TF_SIZE - 0.5, 0, TF_SIZE - 1)
        i = int(np.floor(x))
        return table[i] + (table[min(i + 1, TF_SIZE - 1)] - table[i]) * (x - i), abs(table[min(i + 1, TF_SIZE - 1)] - table[i])

    a, _ = alpha(v)
    ends = [alpha(u) for u in (v - dv, v + dv)]
    da = max(abs(e[0] - a) for e in ends) + Q * max(e[1] for e in ends) + 2.0**-12
    amax = min(max(a, *(e[0] for e in ends)) + da, 0.999)
    return float(da / (1 - amax)) + 1e-6


def main(out: str):
    values = grid_bytes().astype(np.float32) / 255
    table = transfer_bytes().astype(np.float32) / 255
    cpu = torch.device('cpu')
    med = Medium(values, Table(table), cpu)
    levels_np = pyramid(cell_sigma(values, Table(table)))
    levels = to_torch(levels_np, cpu)
    rng = np.random.default_rng(5)
    n = 24
    # samples inside the box (some near its faces), lights in every octant; f32 exactly as the test passes them
    pts = (np.stack([rng.uniform(0.5, d - 0.5, n) for d in DIM], 1) * 8).round() / 8
    pts[:4] = [[0.25, 10.0, 9.0], [23.75, 3.5, 17.5], [12.0, 19.875, 0.125], [12.5, 10.5, 9.5]]
    lights = rng.normal(size=(n, 3))
    lights = (lights / np.linalg.norm(lights, axis=1, keepdims=True)).astype(np.float32)
    pts = pts.astype(np.float32)
    cos = np.linspace(-1, 1, n).astype(np.float32)
    p, l = torch.from_numpy(pts), torch.from_numpy(lights)
    d = descriptors(med, levels, p, l * torch.from_numpy(cos)[:, None], l).numpy()
    d[:, 12] = cos  # the view is any vector with that cosine: the test passes the cosine itself
    bounds = np.zeros_like(d, dtype=np.float64)
    inside = lambda y: bool(np.all(y >= 0) and np.all(y <= np.array(DIM)))  # noqa: E731
    for i in range(n):
        for j in range(12):
            k = j % 6
            y = pts[i].astype(np.float64) + (lights[i] * RADII[k] if j >= 6 else 0)
            if not inside(y):
                continue  # 0 on both sides, exactly
            if k == 0:
                bounds[i, j] = bound0(values, table, y)
            else:
                c = corners(levels_np[k - 1].astype(np.float64), y, k)
                # an f16 store may round differently from numpy's by an ulp (≤ 2^-10 relative) at each of k levels
                bounds[i, j] = 3 * Q * (c.max() - c.min()) + k * 2.0**-10 * max(abs(d[i, j]), c.max()) + 1e-6
    fix = {
        'note': 'written by tools/volume-lighting/fixtures.py: grid and transfer function by its integer formulas',
        'dim': list(DIM), 'filterBits': FILTER_BITS,
        'points': pts.reshape(-1).tolist(), 'lights': lights.reshape(-1).tolist(), 'cosines': cos.tolist(),
        'descriptors': d.reshape(-1).astype(np.float64).tolist(), 'bounds': bounds.reshape(-1).tolist(),
    }
    with open(out, 'w') as f:
        json.dump(fix, f, indent=None, separators=(',', ':'))
        f.write('\n')
    print('wrote', out, 'max bound', bounds.max(), 'mean descriptor', d[:, :12].mean())


if __name__ == '__main__':
    main(sys.argv[1])
