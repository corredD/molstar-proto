# Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
#
# @author Ludovic Autin <autin@scripps.edu>
"""Maps, transfer functions, extinction and the extinction pyramid (volume-lighting.md §A1), in Mol*'s x, y, z cell frame:
cell j spans [j, j + 1), its value at j + 0.5."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import torch

from .config import ALPHA_MAX, LEVELS

TF_SIZE = 256


def load_map(path: str, max_size: int = 0) -> tuple[np.ndarray, float]:
    """The map's values in x, y, z order (mrcfile reads z, y, x) and its voxel size in Å; block-mean downsampled by an
    integer factor until no axis exceeds `max_size` (0: as is)"""
    import mrcfile

    with mrcfile.open(path, permissive=True) as m:
        data = np.asarray(m.data, dtype=np.float32).transpose(2, 1, 0).copy()
        voxel = float(m.voxel_size.x) or 1.0
    if max_size:
        f = int(np.ceil(max(data.shape) / max_size))
        if f > 1:
            s = [n // f * f for n in data.shape]
            data = data[: s[0], : s[1], : s[2]].reshape(s[0] // f, f, s[1] // f, f, s[2] // f, f).mean((1, 3, 5))
            voxel *= f
    return np.ascontiguousarray(data, dtype=np.float32), voxel


def normalize(data: np.ndarray) -> np.ndarray:
    """values to the transfer function's domain [0, 1] over the map's min..max, as Mol*'s direct volume, on the bytes of
    its grid texture (`rgba8unorm`)"""
    lo, hi = float(data.min()), float(data.max())
    return (np.round((data - lo) / max(hi - lo, 1e-12) * 255) / 255).astype(np.float32)


def sigma_from_alpha(alpha):
    """extinction per voxel of a per-cell opacity (direct-volume.wgsl.ts: opacity per cell), α clamped to ALPHA_MAX"""
    if isinstance(alpha, torch.Tensor):
        return -torch.log1p(-alpha.clamp(0.0, ALPHA_MAX))
    return -np.log1p(-np.clip(alpha, 0.0, ALPHA_MAX))


@dataclass
class TransferFunction:
    """piecewise linear opacity over normalized values, as the shader takes it: TF_SIZE entries at texel centers
    (i + 0.5) / TF_SIZE, bytes (`tTransferTex`) unless `quantize` is off (closed-form tests)"""

    xs: np.ndarray
    alphas: np.ndarray
    quantize: bool = True

    def table(self) -> np.ndarray:
        t = np.interp((np.arange(TF_SIZE) + 0.5) / TF_SIZE, self.xs, self.alphas)
        return (np.round(t * 255) / 255 if self.quantize else t).astype(np.float32)


def tf_alpha(table, v):
    """the table linearly filtered at v · TF_SIZE − 0.5, clamped to it (the sampler; `vl-extinction`'s `extinction`)"""
    lib = torch if isinstance(v, torch.Tensor) else np
    x = lib.clip(v * TF_SIZE - 0.5, 0.0, TF_SIZE - 1.0)
    i = lib.floor(x)
    w = x - i
    i = i.long() if lib is torch else i.astype(np.int64)
    j = lib.clip(i + 1, 0, TF_SIZE - 1)
    return table[i] * (1 - w) + table[j] * w


def random_tf(rng: np.random.Generator, values: np.ndarray) -> TransferFunction:
    """an opacity ramp from a threshold to a plateau, sometimes with a second, fainter peak below it (Mol*'s direct
    volume transfer functions); the threshold leaves 2-30 % of the cells above it (log-uniform: maps' contours do not
    survive downsampling, tomograms have none), the peak per-cell opacity log-uniform in [0.03, 0.99]"""
    frac = float(np.exp(rng.uniform(np.log(0.02), np.log(0.3))))
    c, top = (float(x) for x in np.quantile(values, [1 - frac, 1 - frac / 20]))
    peak = float(np.exp(rng.uniform(np.log(0.03), np.log(0.99))))
    hi = min(c + max(rng.uniform(0.2, 1.0) * (top - c), 1 / 255), 0.999)
    xs = [0.0, c, hi, 1.0]
    alphas = [0.0, 0.0, peak, peak * rng.uniform(0.5, 1.0)]
    if rng.random() < 0.4:
        m = float(np.quantile(values, 1 - min(3 * frac, 0.6)))
        w = max((c - m) * rng.uniform(0.1, 0.4), 1 / 255)
        if m - w > 0 and m + w < c:
            xs[1:1] = [m - w, m, m + w]
            alphas[1:1] = [0.0, peak * rng.uniform(0.05, 0.3), 0.0]
    return TransferFunction(np.asarray(xs, np.float32), np.asarray(alphas, np.float32))


def cell_sigma(values: np.ndarray, tf: TransferFunction) -> np.ndarray:
    """σ(TF(value)) per cell (level 0 at the cells' centers)"""
    return sigma_from_alpha(tf_alpha(tf.table(), values)).astype(np.float32)


def _mean8(p: np.ndarray) -> np.ndarray:
    x, y, z = (n // 2 for n in p.shape)
    return p.reshape(x, 2, y, 2, z, 2).sum((1, 3, 5), dtype=np.float32) * np.float32(0.125)


def pyramid(sigma: np.ndarray, levels: int = LEVELS) -> list[np.ndarray]:
    """levels 1 .. levels − 1 (§A1): the cells zero-padded to a multiple of 2^(levels − 1), level 1 the f32 mean of each
    texel's 2³ cells, level k the mean of its 8 children of level k − 1, each stored as f16 (`r16float`)"""
    m = 1 << (levels - 1)
    p = np.pad(sigma.astype(np.float32), [(0, -n % m) for n in sigma.shape])
    out = [_mean8(p).astype(np.float16)]
    for _ in range(2, levels):
        out.append(_mean8(out[-1].astype(np.float32)).astype(np.float16))
    return out
