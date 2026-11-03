# Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
#
# @author Ludovic Autin <autin@scripps.edu>
import numpy as np
import torch

from vl.descriptors import descriptors, to_torch
from vl.grid import TransferFunction, pyramid, sigma_from_alpha, voxel_sigma

CPU = torch.device('cpu')


def test_pyramid_is_the_f16_mean_of_children():
    rng = np.random.default_rng(1)
    s = rng.random((32, 32, 32), dtype=np.float32) * 4
    lv = pyramid(s)
    assert [x.shape for x in lv] == [(32,) * 3, (16,) * 3, (8,) * 3, (4,) * 3, (2,) * 3, (1,) * 3]
    for i in range(1, 6):
        p = lv[i - 1].astype(np.float32)
        ref = (p[0::2, 0::2, 0::2] + p[1::2, 0::2, 0::2] + p[0::2, 1::2, 0::2] + p[1::2, 1::2, 0::2]
               + p[0::2, 0::2, 1::2] + p[1::2, 0::2, 1::2] + p[0::2, 1::2, 1::2] + p[1::2, 1::2, 1::2]) / 8
        assert np.array_equal(lv[i], ref.astype(np.float16))


def test_pyramid_pads_to_a_multiple_of_32():
    assert pyramid(np.ones((33, 40, 20), np.float32))[0].shape == (64, 64, 32)


def test_sigma_clamps_alpha():
    assert np.isclose(sigma_from_alpha(np.float32(1.0)), -np.log(0.01), rtol=1e-6)
    assert np.isfinite(sigma_from_alpha(torch.tensor([1.0]))).all()


def _desc(sigma, pos, light):
    lv = to_torch(pyramid(sigma), CPU)
    pos = torch.tensor(pos, dtype=torch.float32)
    light = torch.tensor(light, dtype=torch.float32)
    view = torch.tensor([0.0, 0.0, 1.0]).expand_as(pos)
    return descriptors(lv, pos, view, light)


def test_descriptors_of_a_uniform_grid_are_its_sigma_at_every_level():
    tf = TransferFunction(np.array([0, 1], np.float32), np.array([0.3, 0.3], np.float32))
    s = voxel_sigma(np.full((64, 64, 64), 0.5, np.float32), tf)
    rng = np.random.default_rng(2)
    d = _desc(s, rng.uniform(0, 64, (100, 3)), [0.6, 0.0, 0.8])
    expect = float(np.float16(-np.log(0.7)))
    assert torch.allclose(d[:, :12], torch.full((100, 12), expect), rtol=0, atol=1e-6)
    assert torch.allclose(d[:, 12], torch.full((100,), 0.8))


def test_descriptors_of_a_half_filled_grid_ramp_over_each_level():
    s = np.zeros((64, 64, 64), np.float32)
    s[:32] = 1.0
    xs = np.linspace(16, 48, 33)
    pos = np.stack([xs, np.full_like(xs, 32), np.full_like(xs, 32)], -1)
    d = _desc(s, pos, [0.0, 1.0, 0.0])
    for i in range(6):
        w = float(1 << i)
        # level i's texels hold 1 left of x = 32 and 0 right of it: linear between the two texel centers around it
        ramp = np.clip(0.5 - (xs - 32) / w, 0, 1)
        assert np.allclose(d[:, i].numpy(), ramp, atol=1e-6), i
        assert np.allclose(d[:, 6 + i].numpy(), ramp, atol=1e-6), i  # light along y: same x
