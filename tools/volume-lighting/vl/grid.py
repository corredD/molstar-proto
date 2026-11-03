# Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
#
# @author Ludovic Autin <autin@scripps.edu>
"""Maps, transfer functions, extinction and the opacity pyramid (plan A1), in Mol*'s x, y, z voxel frame."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import torch

from .config import ALPHA_MAX, LEVELS

TF_SIZE = 1024


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
    """values to the transfer function's domain [0, 1] over the map's min..max, as Mol*'s direct volume"""
    lo, hi = float(data.min()), float(data.max())
    return ((data - lo) / max(hi - lo, 1e-12)).astype(np.float32)


def sigma_from_alpha(alpha):
    """extinction per voxel of a per-cell opacity (direct-volume.wgsl.ts: opacity per cell), α clamped to ALPHA_MAX"""
    if isinstance(alpha, torch.Tensor):
        return -torch.log1p(-alpha.clamp(0.0, ALPHA_MAX))
    return -np.log1p(-np.clip(alpha, 0.0, ALPHA_MAX))


@dataclass
class TransferFunction:
    """piecewise linear opacity over normalized values, tabulated at TF_SIZE entries as σ per voxel"""

    xs: np.ndarray
    alphas: np.ndarray

    def alpha(self, v: np.ndarray) -> np.ndarray:
        return np.interp(v, self.xs, self.alphas).astype(np.float32)

    def sigma_table(self) -> np.ndarray:
        return sigma_from_alpha(self.alpha(np.linspace(0.0, 1.0, TF_SIZE))).astype(np.float32)


def random_tf(rng: np.random.Generator, data: np.ndarray, contour: float | None = None) -> TransferFunction:
    """an opacity ramp from about the contour (or a high percentile) up to a plateau, sometimes with a second, fainter
    peak below it: the transfer functions Mol*'s direct volumes are given; peak per-cell opacity in [0.03, 0.6]"""
    lo, hi = float(data.min()), float(data.max())
    c = (contour - lo) / (hi - lo) if contour is not None else float(np.percentile(normalize(data), 99.0))
    c = float(np.clip(c * rng.uniform(0.6, 1.4), 0.02, 0.9))
    peak = float(np.exp(rng.uniform(np.log(0.03), np.log(0.6))))
    ramp = rng.uniform(0.02, 0.25)
    xs = [0.0, c, min(c + ramp, 0.99), 1.0]
    alphas = [0.0, 0.0, peak, peak * rng.uniform(0.5, 1.0)]
    if rng.random() < 0.4 and c > 0.1:
        w = rng.uniform(0.02, 0.08) * c
        m = c * rng.uniform(0.4, 0.8)
        xs[1:1] = [m - w, m, m + w]
        alphas[1:1] = [0.0, peak * rng.uniform(0.05, 0.3), 0.0]
    return TransferFunction(np.asarray(xs, np.float32), np.asarray(alphas, np.float32))


def voxel_sigma(values: np.ndarray, tf: TransferFunction) -> np.ndarray:
    """per-voxel σ(TF(value)), the pyramid's level 0"""
    return sigma_from_alpha(tf.alpha(values)).astype(np.float32)


def pyramid(sigma: np.ndarray, levels: int = LEVELS) -> list[np.ndarray]:
    """A1 (until frozen): zero-padded to a multiple of 2^(levels - 1), level i the mean of its 8 children computed in f32
    and stored as f16 (`r16float`)"""
    m = 1 << (levels - 1)
    pad = [(0, -n % m) for n in sigma.shape]
    out = [np.pad(sigma, pad).astype(np.float16)]
    for _ in range(1, levels):
        p = out[-1].astype(np.float32)
        x, y, z = (n // 2 for n in p.shape)
        out.append(p.reshape(x, 2, y, 2, z, 2).mean((1, 3, 5)).astype(np.float16))
    return out
