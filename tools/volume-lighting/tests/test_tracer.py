# Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
#
# @author Ludovic Autin <autin@scripps.edu>
"""The tracer against closed forms (plan B1's test: within 1 %)."""

import math

import numpy as np
import pytest
import torch
from scipy.special import expn

from vl.config import G
from vl.grid import TransferFunction
from vl.tracer import Medium, hg_phase, in_scatter, sample_hg

CPU = torch.device('cpu')
SIGMA = -math.log(0.9)  # α = 0.1 per cell
D = 16  # slab thickness, voxels


def _slab():
    tf = TransferFunction(np.array([0, 1], np.float32), np.array([0.1, 0.1], np.float32))
    return Medium(np.full((256, 256, D), 0.5, np.float32), tf, CPU)


def _pts(zs):
    return torch.tensor([[128.0, 128.0, z] for z in zs])


def _close(est, se, ref):
    # within 1 %, and the estimate's noise well below that
    assert (3 * se < 0.01 * ref).all(), (se, ref)
    assert torch.allclose(est, ref, rtol=0.01, atol=0), (est, ref)


def test_hg_samples_follow_the_phase():
    gen = torch.Generator().manual_seed(1)
    d = torch.nn.functional.normalize(torch.randn(1, 3), dim=-1).expand(200_000, 3).contiguous()
    w = sample_hg(d, gen)
    assert torch.allclose(w.norm(dim=-1), torch.ones(200_000), atol=1e-5)
    # mean cosine of HG is g
    assert abs(float((w * d).sum(-1).mean()) - G) < 5e-3
    # the 4π-normalized phase averages to 1 over the sphere
    u = torch.nn.functional.normalize(torch.randn(400_000, 3, generator=gen), dim=-1)
    assert abs(float(hg_phase(u[:, 2]).mean()) - 1) < 1e-2


def test_key_single_scattering_is_phase_times_transmittance():
    med = _slab()
    zs = [2.0, 6.0, 12.0]
    light = torch.tensor([0.6, 0.0, 0.8])
    view = torch.nn.functional.normalize(torch.tensor([[0.3, -0.2, -1.0]]), dim=-1).expand(3, 3)
    gen = torch.Generator().manual_seed(2)
    key, _, se, _ = in_scatter(med, _pts(zs), view, light, torch.zeros(3), 1 << 19, gen)
    ref = hg_phase((view * light).sum(-1)) * torch.exp(-SIGMA * (D - torch.tensor(zs)) / 0.8)
    _close(key, se, ref)


def test_ambient_single_scattering_is_the_slab_closed_form():
    # isotropic phase, sky radiance 1 from both sides: S = (E2(σz) + E2(σ(D − z))) / 2
    med = _slab()
    zs = [1.0, 5.0, 8.0]
    view = torch.tensor([[0.0, 0.0, -1.0]]).expand(3, 3)
    gen = torch.Generator().manual_seed(3)
    _, amb, _, se = in_scatter(med, _pts(zs), view, torch.tensor([0.0, 0.0, 1.0]), torch.zeros(3), 1 << 19, gen, g=0.0)
    z = np.array(zs)
    ref = torch.tensor((expn(2, SIGMA * z) + expn(2, SIGMA * (D - z))) / 2, dtype=torch.float32)
    _close(amb, se, ref)


def test_null_collisions_against_a_gradient():
    # σ(x) = −ln(1 − a x / n), the light diagonal in x, y: it crosses bricks of different, loose majorants; the optical
    # depth is (1 / c) ∫ σ dx, with ∫ −ln(1 − a x) dx = ((1 − a x) ln(1 − a x) − (1 − a x)) / a
    n, a = 64, 0.2
    x = (np.arange(n, dtype=np.float32) + 0.5) / n
    values = np.broadcast_to(x[:, None, None], (n, n, n)).copy()
    tf = TransferFunction(np.array([0, 1], np.float32), np.array([0.0, a], np.float32))
    med = Medium(values, tf, CPU)
    assert float(med.majorant[-1].min()) > 3 * float(med.majorant[1].max())
    xs = np.array([10.3, 30.7, 50.1])
    c, s_ = 0.6, 0.8
    dist = (n - 58.0) / s_
    pts = torch.tensor(np.stack([xs, np.full(3, 58.0), np.full(3, 32.0)], -1), dtype=torch.float32)
    gen = torch.Generator().manual_seed(4)
    view = torch.tensor([[0.0, 0.0, -1.0]]).expand(3, 3)
    light = torch.tensor([c, s_, 0.0])
    key, _, se, _ = in_scatter(med, pts, view, light, torch.zeros(3), 1 << 19, gen, g=0.0)

    def prim(u):
        v = 1 - a * u / n
        return (v * np.log(v) - v) * n / a

    ref = torch.tensor(np.exp(-(prim(xs + c * dist) - prim(xs)) / c), dtype=torch.float32)
    _close(key, se, ref)


@pytest.mark.parametrize('albedo', [0.5, 0.9])
def test_multiple_scattering_adds_light(albedo):
    med = _slab()
    pts = _pts([8.0])
    view = torch.tensor([[0.0, 0.0, -1.0]])
    gen = torch.Generator().manual_seed(5)
    light = torch.tensor([0.0, 0.0, 1.0])
    k0, a0, _, _ = in_scatter(med, pts, view, light, torch.zeros(1), 1 << 15, gen)
    k1, a1, _, _ = in_scatter(med, pts, view, light, torch.full((1,), albedo), 1 << 15, gen)
    assert (k1 > k0 * 1.05).all() and (a1 > a0 * 1.05).all()
