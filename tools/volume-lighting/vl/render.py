# Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
#
# @author Ludovic Autin <autin@scripps.edu>
"""Images of a medium (gray, albedo = the transfer function's color): the shader's emission-absorption ray march with a
shading model's in-scatter at each step, and the path-traced reference. Orthographic camera framing the box's sphere."""

from __future__ import annotations

from collections.abc import Callable

import torch

from .tracer import Medium, first_collisions, in_scatter

# shade(pos (M, 3), view (M, 3)) -> S_key (M,), S_amb (M,)
Shade = Callable[[torch.Tensor, torch.Tensor], tuple[torch.Tensor, torch.Tensor]]


def camera_rays(med: Medium, view: torch.Tensor, res: int, gen: torch.Generator | None = None):
    """origins (res², 3) outside the box and the direction; pixel centers, or jittered within the pixel with `gen`"""
    d = torch.nn.functional.normalize(view.to(med.device).float(), dim=0)
    up = torch.tensor([0.0, 1.0, 0.0], device=med.device)
    if abs(float(d @ up)) > 0.99:
        up = torch.tensor([1.0, 0.0, 0.0], device=med.device)
    right = torch.nn.functional.normalize(torch.linalg.cross(d, up), dim=0)
    up = torch.linalg.cross(right, d)
    center = med.size / 2
    r = float(med.size.norm()) / 2
    j = torch.arange(res, device=med.device, dtype=torch.float32)
    v, u = torch.meshgrid(j, j, indexing='ij')
    u, v = u.reshape(-1), v.reshape(-1)
    if gen is not None:
        u = u + torch.rand(u.shape, device=med.device, generator=gen) - 0.5
        v = v + torch.rand(v.shape, device=med.device, generator=gen) - 0.5
    su = ((u + 0.5) / res * 2 - 1) * r
    sv = (1 - (v + 0.5) / res * 2) * r
    o = center - d * (r + 1) + su[:, None] * right + sv[:, None] * up
    return o, d.expand_as(o).contiguous()


def render_march(med: Medium, origin, d, shade: Shade, albedo: float, step: float = 0.5, light=(1.0, 1.0), cutoff=1e-3,
                 unlit_below: float = 0.0):
    """Σ T · α · albedo · (L_key · S_key + L_amb · S_amb) at steps of `step` cells from the box's entry (α = 1 − e^{−σ
    step}, the shader's per-cell opacity over a step); rays stop below `cutoff` transmittance; samples whose per-cell
    opacity is under `unlit_below` emit the color unlit, as the shader's (`material.a >= 0.01`)"""
    p, inside = med.entry(origin, d)
    n = p.shape[0]
    color = torch.zeros(n, device=med.device)
    T = torch.ones(n, device=med.device)
    idx = inside.nonzero().squeeze(-1)
    pos = p.clone()
    while idx.numel():
        pi = pos[idx]
        out = ((pi < 0) | (pi >= med.size)).any(-1)
        idx, pi = idx[~out], pi[~out]
        if not idx.numel():
            break
        sigma = med.sigma(pi)
        a = 1 - torch.exp(-sigma * step)
        lit = (a > 0) & (1 - torch.exp(-sigma) >= unlit_below)
        dim = (a > 0) & ~lit
        if dim.any():
            color[idx[dim]] += T[idx[dim]] * a[dim] * albedo
        if lit.any():
            sk, sa = shade(pi[lit], d[idx[lit]])
            il = idx[lit]
            color[il] += T[il] * a[lit] * albedo * (light[0] * sk + light[1] * sa)
        T[idx] *= 1 - a
        pos[idx] = pi + d[idx] * step
        idx = idx[T[idx] > cutoff]
    return color


def render_reference(med: Medium, view, light_dir, albedo: float, res: int, spp: int, gen: torch.Generator,
                     light=(1.0, 1.0), max_bounces: int = 256, batch: int = 1 << 20, jitter: bool = False):
    """path traced: per sample a camera ray (the pixel's center, the shader's ray, or jittered over the pixel: a box
    filter, as Mitsuba's), its first collision, one path of `in_scatter` from there"""
    acc = torch.zeros(res * res, device=med.device)
    lt = light_dir.to(med.device).float()
    per = max(1, batch // (res * res))
    for s in range(0, spp, per):
        k = min(per, spp - s)
        o, d = zip(*(camera_rays(med, view, res, gen if jitter else None) for _ in range(k)))
        o, d = torch.cat(o), torch.cat(d)
        p, hit = first_collisions(med, o, d, gen)
        hi = hit.nonzero().squeeze(-1)
        key, amb, _, _ = in_scatter(med, p[hi], d[hi], lt, torch.full((hi.numel(),), albedo, device=med.device), 1,
                                    gen, max_bounces=max_bounces)
        c = torch.zeros(o.shape[0], device=med.device)
        c[hi] = albedo * (light[0] * key + light[1] * amb)
        acc += c.reshape(k, -1).sum(0)
    return acc / spp
