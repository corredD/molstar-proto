# Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
#
# @author Ludovic Autin <autin@scripps.edu>
"""Constants shared by the tracer, the descriptors and the network (LANE.md "Decided")."""

from __future__ import annotations

import os

import torch

# Henyey-Greenstein asymmetry: one value for training, the tracer and the shader (the network has no g input)
G = 0.3
# the transfer function's per-cell opacity is clamped below 1 so that σ = −ln(1 − α) stays finite and inside f16
ALPHA_MAX = 0.99
# pyramid levels (A2's radii voxel · 2^i, i < LEVELS); grids are padded to a multiple of 2^(LEVELS - 1)
LEVELS = 6
# brick edge of the tracker's majorant grid, in voxels
BRICK = 8

DATA_DIR = os.path.expanduser('~/molstar-prism-me/.me-data/volume-lighting')


def device() -> torch.device:
    if os.environ.get('VL_DEVICE'):
        return torch.device(os.environ['VL_DEVICE'])
    if torch.cuda.is_available():
        return torch.device('cuda')
    if torch.backends.mps.is_available():
        return torch.device('mps')
    return torch.device('cpu')
