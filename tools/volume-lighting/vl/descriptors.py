# Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
#
# @author Ludovic Autin <autin@scripps.edu>
"""A2's descriptors per ray-march step: the one function to swap when lane volume-lighting freezes A2."""

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


def descriptors(levels: list[torch.Tensor], pos: torch.Tensor, view: torch.Tensor, light: torch.Tensor) -> torch.Tensor:
    """(N, 13): the mean extinction of level i at p (i < 6), of level i at p + l · r_i, and cos(view, light) with `view`
    the camera ray's direction (away from the camera) and `light` towards the light (1: light behind the point)"""
    cols = [sample_level(levels[i], pos, i) for i in range(LEVELS)]
    cols += [sample_level(levels[i], pos + light * RADII[i], i) for i in range(LEVELS)]
    cols.append((view * light).sum(-1))
    return torch.stack(cols, -1)
