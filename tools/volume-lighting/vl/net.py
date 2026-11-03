# Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
#
# @author Ludovic Autin <autin@scripps.edu>
"""The neural shader's network (plan C1, C2): the 13 descriptors and the albedo, clamped to the training range and
normalized by a stored mean and scale, 14 → 16 → 16 → 2 with squared ReLU, outputs squared then clamped per channel:
S_key, S_amb. And the shading models as the ray
march takes them: A3's `volumetric` (volume-lighting.md §A3) and the network."""

from __future__ import annotations

import json

import torch
from torch import nn

from .descriptors import N_DESCRIPTORS

N_IN, HIDDEN, N_OUT = N_DESCRIPTORS + 1, 16, 2
# the key's 4π-normalized phase peaks at (1 + g) / (1 − g)² = 2.65 for g = 0.3 (multiple scattering adds a little);
# the ambient in-scatter of a sky of radiance 1 is at most 1
OUT_MAX = (3.0, 1.0)

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
        # the training range: inputs beyond it are clamped to it (a network extrapolates badly)
        self.register_buffer('lo', torch.full((N_IN,), -1e9))
        self.register_buffer('hi', torch.full((N_IN,), 1e9))
        self.register_buffer('out_max', torch.tensor(OUT_MAX))
        self.l1 = nn.Linear(N_IN, HIDDEN)
        self.l2 = nn.Linear(HIDDEN, HIDDEN)
        self.l3 = nn.Linear(HIDDEN, N_OUT)

    def fit_normalization(self, x: torch.Tensor):
        self.mean.copy_(x.mean(0))
        self.scale.copy_(1.0 / x.std(0).clamp(min=1e-6))
        self.lo.copy_(x.amin(0))
        self.hi.copy_(x.amax(0))

    def raw(self, x: torch.Tensor) -> torch.Tensor:
        h = (torch.minimum(torch.maximum(x, self.lo), self.hi) - self.mean) * self.scale
        return self.l3(sqrelu(self.l2(sqrelu(self.l1(h)))))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return torch.minimum(self.raw(x).square(), self.out_max)

    def export(self) -> dict:
        """the JSON next to the shader: row-major weights (out × in), biases, the input mean and scale"""
        # f32 values printed as the doubles they are: the shader's literals round back to the same f32
        r = lambda t: [float(v) for v in t.detach().cpu().float().reshape(-1)]  # noqa: E731
        return {
            'layout': {'inputs': N_IN, 'hidden': HIDDEN, 'outputs': N_OUT, 'activation': 'sqrelu'},
            'inputs': 'around0..5, light0..5, cosine (volume-lighting.md §A2), albedo; clamped to [lo, hi]',
            'outputs': 'S_key, S_amb: squared, clamped to outMax',
            'lo': r(self.lo), 'hi': r(self.hi), 'outMax': r(self.out_max),
            'mean': r(self.mean), 'scale': r(self.scale),
            'w1': r(self.l1.weight), 'b1': r(self.l1.bias),
            'w2': r(self.l2.weight), 'b2': r(self.l2.bias),
            'w3': r(self.l3.weight), 'b3': r(self.l3.bias),
        }

    @staticmethod
    def load(path: str) -> Net:
        """from the weights module train.py writes (a JSON literal after `= `) or a JSON export"""
        with open(path) as f:
            src = f.read()
        if not path.endswith('.json'):
            src = src[src.index('= ', src.index('VolumeNeuralWeights')) + 2 : src.rindex(';')]
        j = json.loads(src)
        n = Net()
        t = lambda k, *s: torch.tensor(j[k], dtype=torch.float32).reshape(*s)  # noqa: E731
        with torch.no_grad():
            n.mean.copy_(t('mean', N_IN))
            n.scale.copy_(t('scale', N_IN))
            n.lo.copy_(t('lo', N_IN))
            n.hi.copy_(t('hi', N_IN))
            n.out_max.copy_(t('outMax', N_OUT))
            for i, (o, k) in enumerate(((HIDDEN, N_IN), (HIDDEN, HIDDEN), (N_OUT, HIDDEN)), 1):
                getattr(n, f'l{i}').weight.copy_(t(f'w{i}', o, k))
                getattr(n, f'l{i}').bias.copy_(t(f'b{i}', o))
        return n


def relative_loss(pred: torch.Tensor, y: torch.Tensor, eps: float = 0.01) -> torch.Tensor:
    """relative L2, its denominator (stopgrad(pred) + y) / 2 + ε: unbiased by the targets' noise (LANE.md "Decided")"""
    return (((pred - y) / ((pred.detach() + y) / 2 + eps)) ** 2).mean()
