# Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
#
# @author Ludovic Autin <autin@scripps.edu>
"""The pyramid and the descriptors as volume-lighting.md §A1–A2 freeze them."""

import numpy as np
import torch

from vl.descriptors import descriptors, to_torch
from vl.grid import TF_SIZE, TransferFunction, cell_sigma, normalize, pyramid, sigma_from_alpha, tf_alpha
from vl.tracer import Medium

CPU = torch.device('cpu')


def test_pyramid_levels_1_to_5_are_f16_means_of_children():
    rng = np.random.default_rng(1)
    s = rng.random((32, 32, 32), dtype=np.float32) * 4
    lv = pyramid(s)
    assert [x.shape for x in lv] == [(16,) * 3, (8,) * 3, (4,) * 3, (2,) * 3, (1,) * 3]
    assert np.array_equal(lv[0], s.reshape(16, 2, 16, 2, 16, 2).mean((1, 3, 5)).astype(np.float16))
    for i in range(1, 5):
        p = lv[i - 1].astype(np.float32)
        x, y, z = (n // 2 for n in p.shape)
        ref = p.reshape(x, 2, y, 2, z, 2).sum((1, 3, 5)) * np.float32(0.125)
        assert np.array_equal(lv[i], ref.astype(np.float16))


def test_level_1_is_ceil_dim_over_32_times_16():
    assert pyramid(np.ones((33, 40, 20), np.float32))[0].shape == (32, 32, 16)


def test_sigma_clamps_alpha_at_0_999():
    assert np.isclose(sigma_from_alpha(np.float32(1.0)), -np.log(0.001), rtol=1e-6)
    assert torch.isfinite(sigma_from_alpha(torch.tensor([1.0]))).all()


def test_transfer_function_is_filtered_at_texel_centers():
    t = np.arange(TF_SIZE, dtype=np.float32) / 255
    assert np.isclose(tf_alpha(t, np.float32(0.5 / 256)), 0.0)
    assert np.isclose(tf_alpha(t, np.float32(1.0 / 256)), 0.5 / 255)
    assert np.isclose(tf_alpha(t, np.float32(1.0)), 1.0)
    assert np.isclose(tf_alpha(t, np.float32(0.0)), 0.0)
    assert np.all(normalize(np.linspace(-1, 3, 50, dtype=np.float32)) * 255 % 1 == 0)


def _desc(values, tf, pos, light):
    med = Medium(values, tf, CPU)
    lv = to_torch(pyramid(cell_sigma(values, tf)), CPU)
    pos = torch.tensor(pos, dtype=torch.float32)
    light = torch.tensor(light, dtype=torch.float32)
    view = torch.tensor([0.0, 0.0, 1.0]).expand_as(pos)
    return descriptors(med, lv, pos, view, light)


def test_descriptors_of_a_uniform_grid_are_its_sigma_at_every_level():
    tf = TransferFunction(np.array([0, 1], np.float32), np.array([0.3, 0.3], np.float32))
    rng = np.random.default_rng(2)
    # inside the box, the light reads too (|l| · 32 from the sample)
    d = _desc(np.full((96, 96, 96), 0.5, np.float32), tf, rng.uniform(33, 63, (100, 3)), [0.6, 0.0, 0.8])
    s = float(-np.log1p(-tf.table()[0]))
    assert torch.allclose(d[:, [0, 6]], torch.full((100, 2), s), rtol=1e-6)
    assert torch.allclose(d[:, [1, 2, 3, 4, 5, 7, 8, 9, 10, 11]], torch.full((100, 10), float(np.float16(s))), atol=1e-6)
    assert torch.allclose(d[:, 12], torch.full((100,), 0.8))


def test_descriptors_of_a_half_filled_grid_ramp_over_each_level():
    v = np.zeros((64, 64, 64), np.float32)
    v[:32] = 1.0
    tf = TransferFunction(np.array([0, 1], np.float32), np.array([0.0, 0.5], np.float32))
    s = float(-np.log1p(-np.float32(np.round(0.5 * 255.5 / 256 * 255) / 255)))
    xs = np.linspace(16, 48, 33)
    pos = np.stack([xs, np.full_like(xs, 32), np.full_like(xs, 32)], -1)
    d = _desc(v, tf, pos, [0.0, 1.0, 0.0]).numpy()
    # level 0: σ of the filtered value, full left of the cell centers 31.5 / 32.5, empty right of them
    assert np.allclose(d[xs <= 31.5, 0], s, rtol=1e-5) and np.all(d[xs >= 32.5, 0] == 0)
    for k in range(1, 6):
        # level k's texels hold s left of x = 32 and 0 right of it: linear between the two texel centers around it
        ramp = np.clip(0.5 - (xs - 32) / (1 << k), 0, 1) * float(np.float16(s))
        assert np.allclose(d[:, k], ramp, atol=1e-6), k
        assert np.allclose(d[:, 6 + k], ramp, atol=1e-6), k  # the light along y: same x


def test_descriptors_are_0_outside_the_box():
    tf = TransferFunction(np.array([0, 1], np.float32), np.array([0.3, 0.3], np.float32))
    d = _desc(np.full((32, 32, 32), 0.5, np.float32), tf, [[16.0, 16.0, 31.0]], [0.0, 0.0, 1.0])
    # light reads at z = 32 (on the face: inside), then 33, 35, ..., 63: outside
    assert d[0, 6] > 0 and torch.all(d[0, 7:12] == 0)
