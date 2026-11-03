# Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
#
# @author Ludovic Autin <autin@scripps.edu>
"""The ray march and the path-traced reference against the slab's single scattering seen from above:
L = albedo · phase · (1 − e^{−τ(1 + 1/μ0)}) / (1 + 1/μ0), camera straight down, light at μ0."""

import math

import numpy as np
import torch

from vl.grid import TransferFunction
from vl.render import camera_rays, render_march, render_reference
from vl.tracer import Medium, hg_phase

CPU = torch.device('cpu')
SIGMA, D, MU0, ALBEDO, RES = -math.log(0.9), 16, 0.8, 0.5, 32
LIGHT = torch.tensor([0.6, 0.0, MU0])
VIEW = torch.tensor([0.0, 0.0, -1.0])


def _setup():
    tf = TransferFunction(np.array([0, 1], np.float32), np.array([0.1, 0.1], np.float32), quantize=False)
    med = Medium(np.full((64, 64, D), 0.5, np.float32), tf, CPU)
    o, _ = camera_rays(med, VIEW, RES)
    # pixels whose rays meet the slab's top face away from its sides
    center = ((o[:, :2] - 32).norm(dim=-1) < 12).nonzero().squeeze(-1)
    k = 1 + 1 / MU0
    ref = ALBEDO * float(hg_phase(VIEW @ LIGHT)) * (1 - math.exp(-SIGMA * D * k)) / k
    return med, center, ref


def test_march_of_the_single_scattering_shading():
    med, center, ref = _setup()
    o, d = camera_rays(med, VIEW, RES)

    def shade(p, v):
        return hg_phase(v @ LIGHT) * torch.exp(-SIGMA * (D - p[:, 2]) / MU0), torch.zeros(p.shape[0])

    img = render_march(med, o, d, shade, ALBEDO, step=0.05, light=(1.0, 0.0), cutoff=0)
    assert np.allclose(img[center].numpy(), ref, rtol=0.01)


def test_path_traced_single_scattering():
    med, center, ref = _setup()
    gen = torch.Generator().manual_seed(7)
    img = render_reference(med, VIEW, LIGHT, ALBEDO, RES, 2048, gen, light=(1.0, 0.0), max_bounces=1)
    mean = float(img[center].mean())
    assert abs(mean - ref) < 0.01 * ref, (mean, ref)
