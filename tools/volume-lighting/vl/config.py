# Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
#
# @author Ludovic Autin <autin@scripps.edu>
"""Constants shared by the tracer, the descriptors and the network (LANE.md "Decided")."""

from __future__ import annotations

import os

import torch

# Henyey-Greenstein asymmetry: one value for training, the tracer and the shader (the network has no g input)
G = 0.3
# the transfer function's per-cell opacity is clamped below 1 (volume-lighting.md §A1, `VolumeLightingMaxAlpha`)
ALPHA_MAX = 0.999
# descriptor levels k = 0..5 (volume-lighting.md §A2): level 0 on the fly, 1..5 stored (`VolumeLightingLevels`)
LEVELS = 6
# brick edge of the tracker's majorant grid, in voxels
BRICK = 8

DATA_DIR = os.path.expanduser('~/molstar-prism-me/.me-data/volume-lighting')


def device() -> torch.device:
    if os.environ.get('VL_DEVICE'):
        return torch.device(os.environ['VL_DEVICE'])
    if torch.cuda.is_available():
        return torch.device('cuda')
    # not MPS: the wavefront tracer's many small ops each wait on the GPU there, ~450x slower than the CPU (M1 Pro)
    return torch.device('cpu')
