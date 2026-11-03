# Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
#
# @author Ludovic Autin <autin@scripps.edu>
"""Gate C's emulation of the shader (review finding 6 and the harness fix of run 2)."""

import math

import numpy as np
import torch

import gate_c
import vl.render as render
from vl.grid import TransferFunction
from vl.tracer import Medium

CPU = torch.device('cpu')


def test_the_march_stops_where_the_shader_does():
    # a thick slab, the camera straight down, S = 1: the shader adds samples until accumulated alpha passes 0.95
    tf = TransferFunction(np.array([0, 1], np.float32), np.array([0.3, 0.3], np.float32), quantize=False)
    med = Medium(np.full((8, 8, 64), 0.5, np.float32), tf, CPU)
    o, d = torch.tensor([[4.0, 4.0, 70.0]]), torch.tensor([[0.0, 0.0, -1.0]])
    one = lambda p, v: (torch.ones(p.shape[0]), torch.zeros(p.shape[0]))  # noqa: E731
    img = render.render_march(med, o, d, one, 1.0, gate_c.STEP, (1.0, 0.0), cutoff=gate_c.MARCH_CUTOFF)
    a = 1 - math.exp(-(-math.log(0.7)) * gate_c.STEP)
    acc = 0.0
    while acc <= 0.95:
        acc += (1 - acc) * a
    assert abs(float(img[0]) - acc) < 1e-5


def test_the_reference_casts_the_pixel_centers(monkeypatch):
    # the shader casts one ray per pixel center (multi-sampling off): a jittered reference measures aliasing
    gens = []
    real = render.camera_rays

    def spy(med, view, res, gen=None):
        gens.append(gen)
        return real(med, view, res, gen)

    monkeypatch.setattr(render, 'camera_rays', spy)
    tf = TransferFunction(np.array([0, 1], np.float32), np.array([0.1, 0.1], np.float32), quantize=False)
    med = Medium(np.full((8, 8, 8), 0.5, np.float32), tf, CPU)
    gen = torch.Generator().manual_seed(0)
    render.render_reference(med, torch.tensor([0.0, 0.0, -1.0]), torch.tensor([0.0, 0.0, 1.0]), 0.5, 4, 2, gen)
    assert gens and all(g is None for g in gens)
