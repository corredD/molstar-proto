# Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
#
# @author Ludovic Autin <autin@scripps.edu>
"""The neural shader's network (plan C1, C2): the 13 descriptors and the albedo, normalized by a stored mean and scale,
14 → 16 → 16 → 2 with squared ReLU, outputs squared then clamped: S_key, S_amb. And the shading models as the ray
march takes them: A3's `volumetric` (volume-lighting.md §A3) and the network."""

from __future__ import annotations

import json

import torch
from torch import nn

from .descriptors import N_DESCRIPTORS

N_IN, HIDDEN, N_OUT = N_DESCRIPTORS + 1, 16, 2
OUT_MAX = 4.0  # the key's 4π-normalized phase peaks at (1 + g) / (1 − g)² = 2.65 for g = 0.3

# §A3: the cone segments ending at the reads of levels 0..5, and the obscurance's weights
SEGMENTS = torch.tensor([1.0, 1.0, 2.0, 4.0, 8.0, 16.0])
OBSCURANCE = torch.tensor([1.0, 0.5, 0.5, 0.5, 0.5, 0.5])


def volumetric(desc: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    """A3: transmittance exp(−Σ D_k light[k]), occlusion exp(−Σ w_k around[k]); isotropic"""
    t = torch.exp(-(desc[:, 6:12] * SEGMENTS.to(desc.device)).sum(-1))
    a = torch.exp(-(desc[:, 0:6] * OBSCURANCE.to(desc.device)).sum(-1))
    return t, a


def sqrelu(x: torch.Tensor) -> torch.Tensor:
    return torch.relu(x).square()


class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.register_buffer('mean', torch.zeros(N_IN))
        self.register_buffer('scale', torch.ones(N_IN))
        self.l1 = nn.Linear(N_IN, HIDDEN)
        self.l2 = nn.Linear(HIDDEN, HIDDEN)
        self.l3 = nn.Linear(HIDDEN, N_OUT)

    def fit_normalization(self, x: torch.Tensor):
        self.mean.copy_(x.mean(0))
        self.scale.copy_(1.0 / x.std(0).clamp(min=1e-6))

    def raw(self, x: torch.Tensor) -> torch.Tensor:
        h = (x - self.mean) * self.scale
        return self.l3(sqrelu(self.l2(sqrelu(self.l1(h)))))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.raw(x).square().clamp(max=OUT_MAX)

    def export(self) -> dict:
        """the JSON next to the shader: row-major weights (out × in), biases, the input mean and scale"""
        # f32 values printed as the doubles they are: the shader's literals round back to the same f32
        r = lambda t: [float(v) for v in t.detach().cpu().float().reshape(-1)]  # noqa: E731
        return {
            'layout': {'inputs': N_IN, 'hidden': HIDDEN, 'outputs': N_OUT, 'activation': 'sqrelu', 'outMax': OUT_MAX},
            'inputs': 'around0..5, light0..5, cosine (volume-lighting.md §A2), albedo',
            'outputs': 'S_key, S_amb: squared, clamped to outMax',
            'mean': r(self.mean), 'scale': r(self.scale),
            'w1': r(self.l1.weight), 'b1': r(self.l1.bias),
            'w2': r(self.l2.weight), 'b2': r(self.l2.bias),
            'w3': r(self.l3.weight), 'b3': r(self.l3.bias),
        }

    @staticmethod
    def load(path: str) -> Net:
        with open(path) as f:
            j = json.load(f)
        n = Net()
        t = lambda k, *s: torch.tensor(j[k], dtype=torch.float32).reshape(*s)  # noqa: E731
        with torch.no_grad():
            n.mean.copy_(t('mean', N_IN))
            n.scale.copy_(t('scale', N_IN))
            for i, (o, k) in enumerate(((HIDDEN, N_IN), (HIDDEN, HIDDEN), (N_OUT, HIDDEN)), 1):
                getattr(n, f'l{i}').weight.copy_(t(f'w{i}', o, k))
                getattr(n, f'l{i}').bias.copy_(t(f'b{i}', o))
        return n


def relative_loss(pred: torch.Tensor, y: torch.Tensor, eps: float = 0.01) -> torch.Tensor:
    """relative L2, its denominator (stopgrad(pred) + y) / 2 + ε: unbiased by the targets' noise (LANE.md "Decided")"""
    return (((pred - y) / ((pred.detach() + y) / 2 + eps)) ** 2).mean()
