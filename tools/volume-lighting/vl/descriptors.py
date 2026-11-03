# Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
#
# @author Ludovic Autin <autin@scripps.edu>
"""The 13 descriptors per ray-march sample, as frozen in volume-lighting.md §A2."""

from __future__ import annotations

import numpy as np
import torch

from .config import LEVELS

N_DESCRIPTORS = 2 * LEVELS + 1
RADII = [float(1 << i) for i in range(LEVELS)]


def sample_level(level: torch.Tensor, pos: torch.Tensor, i: int) -> torch.Tensor:
    """`textureSampleLevel(level i)` with linear filtering and clamp to edge: `pos` (N, 3) in level-0 voxels, texel j of
    level i centered at (j + 0.5) · 2^i"""
    f = pos / float(1 << i) - 0.5
    f0 = torch.floor(f)
    w = f - f0
    n = torch.tensor(level.shape, device=pos.device)
    i0 = f0.long().clamp(min=0)
    i0 = torch.minimum(i0, n - 1)
    i1 = torch.minimum((f0.long() + 1).clamp(min=0), n - 1)
    flat = level.reshape(-1)
    sy, sz = level.shape[1] * level.shape[2], level.shape[2]
    out = torch.zeros(pos.shape[0], device=pos.device, dtype=torch.float32)
    for cx in (0, 1):
        ix, wx = (i1[:, 0], w[:, 0]) if cx else (i0[:, 0], 1 - w[:, 0])
        for cy in (0, 1):
            iy, wy = (i1[:, 1], w[:, 1]) if cy else (i0[:, 1], 1 - w[:, 1])
            for cz in (0, 1):
                iz, wz = (i1[:, 2], w[:, 2]) if cz else (i0[:, 2], 1 - w[:, 2])
                out += wx * wy * wz * flat[ix * sy + iy * sz + iz].float()
    return out


def to_torch(levels: list[np.ndarray], device: torch.device) -> list[torch.Tensor]:
    return [torch.from_numpy(lv.astype(np.float32)).to(device) for lv in levels]


def extinction(med, levels: list[torch.Tensor], pos: torch.Tensor, k: int) -> torch.Tensor:
    """S_k: k = 0 σ of the trilinear value (`med.sigma`), k ≥ 1 level k (levels[k − 1]) trilinear; 0 outside [0, dim]"""
    s = med.sigma(pos) if k == 0 else sample_level(levels[k - 1], pos, k)
    inside = ((pos >= 0) & (pos <= med.size)).all(-1)
    return torch.where(inside, s, torch.zeros_like(s))


def descriptors(med, levels: list[torch.Tensor], pos: torch.Tensor, view: torch.Tensor, light: torch.Tensor):
    """(N, 13): around[k] = S_k(x), light[k] = S_k(x + l · 2^k), cosine = dot(d, L), `view` d the camera ray's direction
    (camera to sample) and `light` L towards the light (1: light behind the sample); `med` the medium (grid values and
    transfer function, `tracer.Medium`), `levels` the pyramid's levels 1..5"""
    cols = [extinction(med, levels, pos, k) for k in range(LEVELS)]
    cols += [extinction(med, levels, pos + light * RADII[k], k) for k in range(LEVELS)]
    cols.append((view * light).sum(-1))
    return torch.stack(cols, -1)
