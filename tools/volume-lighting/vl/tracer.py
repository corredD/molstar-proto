# Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
#
# @author Ludovic Autin <autin@scripps.edu>
"""Reference tracer (plan B1): delta tracking through σ(TF(trilinear(value))), single and multiple scattering, a
Henyey-Greenstein phase, one directional key light and a uniform sky. Wavefront style: every path of a batch advances
one tentative collision per iteration, finished ones are compacted out."""

from __future__ import annotations

import math

import numpy as np
import torch
import torch.nn.functional as F

from .config import BRICK, G
from .descriptors import sample_level
from .grid import TF_SIZE, TransferFunction, sigma_from_alpha, tf_alpha

EPS = 1e-3  # past a brick face, in voxels


def hg_phase(cos: torch.Tensor, g: float = G) -> torch.Tensor:
    """Henyey-Greenstein, normalized to 1 on average over the sphere (4π · p): isotropic is 1"""
    return (1 - g * g) / (1 + g * g - 2 * g * cos).clamp(min=1e-12) ** 1.5


def sample_hg(d: torch.Tensor, gen: torch.Generator, g: float = G) -> torch.Tensor:
    """a direction around `d` distributed as the phase (weight phase / pdf = 1)"""
    n = d.shape[0]
    u1 = torch.rand(n, device=d.device, generator=gen)
    u2 = torch.rand(n, device=d.device, generator=gen)
    if abs(g) < 1e-4:
        c = 1 - 2 * u1
    else:
        s = (1 - g * g) / (1 - g + 2 * g * u1)
        c = ((1 + g * g - s * s) / (2 * g)).clamp(-1.0, 1.0)
    sn = (1 - c * c).clamp(min=0).sqrt()
    phi = 2 * math.pi * u2
    # orthonormal frame around d (Duff et al. 2017)
    sign = torch.where(d[:, 2] >= 0, 1.0, -1.0)
    a = -1.0 / (sign + d[:, 2])
    b = d[:, 0] * d[:, 1] * a
    t = torch.stack([1 + sign * d[:, 0] ** 2 * a, sign * b, -sign * d[:, 0]], -1)
    bt = torch.stack([b, sign + d[:, 1] ** 2 * a, -d[:, 1]], -1)
    return (sn * phi.cos())[:, None] * t + (sn * phi.sin())[:, None] * bt + c[:, None] * d


def _range_max(table: torch.Tensor, lo: torch.Tensor, hi: torch.Tensor) -> torch.Tensor:
    """max of table[lo..hi] (inclusive) per query, by a sparse table"""
    levels = [table]
    while (1 << len(levels)) <= table.shape[0]:
        p, s = levels[-1], 1 << (len(levels) - 1)
        levels.append(torch.maximum(p[:-s], p[s:]))
    k = torch.floor(torch.log2((hi - lo + 1).float())).long()
    out = torch.zeros_like(lo, dtype=table.dtype)
    for j, lv in enumerate(levels):
        m = k == j
        if m.any():
            out[m] = torch.maximum(lv[lo[m]], lv[hi[m] - (1 << j) + 1])
    return out


class Medium:
    """normalized values (x, y, z) and a transfer function; σ per cell at any point, brick majorants"""

    def __init__(self, values: np.ndarray, tf: TransferFunction, device: torch.device):
        self.device = device
        self.values = torch.from_numpy(np.ascontiguousarray(values, np.float32)).to(device)
        self.table = torch.from_numpy(tf.table()).to(device)
        self.size = torch.tensor(values.shape, device=device, dtype=torch.float32)
        # a trilinear sample in brick b reads voxels bB - 1 .. (b + 1)B: their value range bounds σ over the brick
        v = self.values.cpu()[None, None]  # max_pool3d has no MPS kernel
        vmax = F.max_pool3d(v, BRICK + 2, BRICK, padding=1, ceil_mode=True)[0, 0]
        vmin = -F.max_pool3d(-v, BRICK + 2, BRICK, padding=1, ceil_mode=True)[0, 0]
        k = TF_SIZE - 1
        lo = torch.floor((vmin.reshape(-1) * TF_SIZE - 0.5).clamp(0, k)).long()
        hi = torch.ceil((vmax.reshape(-1) * TF_SIZE - 0.5).clamp(0, k)).long()
        # σ is monotone in α: the largest α the filtered table takes over the range bounds σ
        table = self.table.cpu()
        self.majorant = (sigma_from_alpha(_range_max(table, lo, hi)).reshape(vmax.shape) * 1.0001).to(device)
        self.nb = torch.tensor(self.majorant.shape, device=device)
        self.maj_flat = self.majorant.reshape(-1)

    def sigma(self, pos: torch.Tensor) -> torch.Tensor:
        """σ(TF(trilinear value)), classified after filtering as the ray marcher's samples (§A2's S_0)"""
        return sigma_from_alpha(tf_alpha(self.table, sample_level(self.values, pos, 0)))

    def march(self, pos: torch.Tensor, d: torch.Tensor, gen: torch.Generator, ratio: bool):
        """from `pos` (inside the box) along `d`: delta tracking to the first real collision (`ratio` False: returns
        positions and a hit mask) or ratio tracking of the transmittance to the box's exit (`ratio` True: returns T)"""
        n = pos.shape[0]
        p = pos.clone()
        hit = torch.zeros(n, dtype=torch.bool, device=self.device)
        T = torch.ones(n, device=self.device)
        # 1 / 0 = ±inf; an axis the ray does not move along never bounds the brick exit
        inv = 1.0 / d
        flat = d == 0
        idx = torch.arange(n, device=self.device)
        sy, sz = int(self.nb[1] * self.nb[2]), int(self.nb[2])
        while idx.numel():
            pi, di, ii = p[idx], d[idx], inv[idx]
            out = ((pi < 0) | (pi >= self.size)).any(-1)
            b = torch.minimum(torch.floor(pi / BRICK).long().clamp(min=0), self.nb - 1)
            face = (b + (di > 0)).float() * BRICK
            ta = torch.where(flat[idx], torch.inf, (face - pi) * ii)
            texit, axis = ta.min(-1)
            texit = texit.clamp(min=0)
            mu = self.maj_flat[b[:, 0] * sy + b[:, 1] * sz + b[:, 2]]
            u = torch.rand(idx.shape[0], device=self.device, generator=gen)
            t = -torch.log1p(-u) / mu.clamp(min=1e-12)
            coll = (t < texit) & ~out
            pi = pi + di * torch.where(coll, t, texit)[:, None]
            # a crossing snaps the exit axis past its face by EPS in position: `d · EPS` vanishes at grazing angles
            cross = (~coll).nonzero().squeeze(-1)
            ax = axis[cross]
            fc = face[cross, ax] + torch.where(di[cross, ax] > 0, EPS, -EPS)
            pi[cross, ax] = fc
            p[idx] = pi
            done = out
            ci = coll.nonzero().squeeze(-1)
            if ci.numel():
                r = (self.sigma(pi[ci]) / mu[ci]).clamp(max=1.0)
                if ratio:
                    tc = T[idx[ci]] * (1 - r)
                    # roulette on small transmittance, unbiased
                    low = tc < 1e-3
                    if low.any():
                        keep = torch.rand(int(low.sum()), device=self.device, generator=gen) < 0.5
                        tc[low] = torch.where(keep, tc[low] * 2, torch.zeros_like(tc[low]))
                    T[idx[ci]] = tc
                    done[ci] |= tc <= 0
                else:
                    real = torch.rand(ci.numel(), device=self.device, generator=gen) < r
                    hit[idx[ci[real]]] = True
                    done[ci[real]] = True
            idx = idx[~done]
        return T if ratio else (p, hit)

    def entry(self, origin: torch.Tensor, d: torch.Tensor):
        """slab test of rays against the box [0, size]: entry points (just inside) and a mask of rays that meet it"""
        inv = 1.0 / d
        t0 = (0 - origin) * inv
        t1 = (self.size - origin) * inv
        # an axis the ray does not move along: no bound if the origin is inside its slab, no hit otherwise
        flat = d == 0
        within = (origin >= 0) & (origin <= self.size)
        tlo = torch.where(flat, torch.where(within, -torch.inf, torch.inf), torch.minimum(t0, t1))
        thi = torch.where(flat, torch.where(within, torch.inf, -torch.inf), torch.maximum(t0, t1))
        tn = tlo.amax(-1).clamp(min=0)
        tf = thi.amin(-1)
        return origin + d * (tn + EPS)[:, None], tn < tf


def in_scatter(
    med: Medium, pos, view, light, albedo, n_paths: int, gen: torch.Generator, g: float = G, max_bounces: int = 256
):
    """S_key, S_amb at each point towards the camera (all orders; the point's own albedo excluded) and their standard
    errors: (N,) each. `view` (N, 3) the camera ray's direction, `light` (3,) towards the light, `albedo` (N,)"""
    n = pos.shape[0]
    m = n * n_paths
    x = pos.repeat_interleave(n_paths, 0)
    d = view.repeat_interleave(n_paths, 0)
    a = albedo.repeat_interleave(n_paths, 0)
    w = torch.ones(m, device=med.device)
    key = torch.zeros(m, device=med.device)
    amb = torch.zeros(m, device=med.device)
    lt = light.reshape(1, 3)
    idx = torch.arange(m, device=med.device)
    for bounce in range(max_bounces):
        if not idx.numel():
            break
        xi, di, wi = x[idx], d[idx], w[idx]
        T = med.march(xi, lt.expand_as(xi), gen, ratio=True)
        key[idx] += wi * hg_phase((di * lt).sum(-1), g) * T
        di = sample_hg(di, gen, g)
        xi, hit = med.march(xi, di, gen, ratio=False)
        amb[idx[~hit]] += wi[~hit]
        wi = wi * a[idx]
        if bounce >= 3:
            q = wi.clamp(max=0.95)
            alive = torch.rand(idx.numel(), device=med.device, generator=gen) < q
            wi = wi / q.clamp(min=1e-12)
            hit = hit & alive
        x[idx], d[idx], w[idx] = xi, di, wi
        idx = idx[hit]
    key = key.reshape(n, n_paths)
    amb = amb.reshape(n, n_paths)
    def se(v):
        return v.std(1) / math.sqrt(n_paths) if n_paths > 1 else torch.zeros(n, device=v.device)

    return key.mean(1), amb.mean(1), se(key), se(amb)


def first_collisions(med: Medium, origin, d, gen: torch.Generator):
    """camera rays from outside the box: the first real collision of each (where camera rays first meet density) and the
    mask of rays that have one"""
    p, inside = med.entry(origin, d)
    hit = torch.zeros(p.shape[0], dtype=torch.bool, device=med.device)
    ii = inside.nonzero().squeeze(-1)
    q, h = med.march(p[ii], d[ii], gen, ratio=False)
    p[ii] = q
    hit[ii] = h
    return p, hit
