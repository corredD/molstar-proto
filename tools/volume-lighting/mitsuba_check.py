# Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
#
# @author Ludovic Autin <autin@scripps.edu>
"""Second reference (plan B1): our path tracer against Mitsuba 3's `volpath` on a heterogeneous grid with multiple
scattering. Three steps, two Pythons (Mitsuba lives in the conda env `volume-lighting`, torch in the base one):

    python mitsuba_check.py ours OUT.npz           # scene, σ on a 4× finer grid, our image
    <env>/bin/python mitsuba_check.py mitsuba OUT.npz
    python mitsuba_check.py compare OUT.npz
"""

import math
import sys

import numpy as np

RES, SPP, ALBEDO, SIZE, UP = 48, 1024, 0.8, 32, 4
LIGHT = np.array([0.48, 0.6, 0.64])
VIEW = np.array([0.0, 0.0, -1.0])


def blobs() -> np.ndarray:
    rng = np.random.default_rng(11)
    x = (np.arange(SIZE) + 0.5)[:, None, None, None]
    g = np.stack(np.broadcast_arrays(x, x.transpose(1, 0, 2, 3), x.transpose(2, 1, 0, 3)), -1)[..., 0, :]
    v = np.zeros((SIZE,) * 3)
    for _ in range(6):
        c, r = rng.uniform(8, 24, 3), rng.uniform(3, 7)
        v += np.exp(-((g - c) ** 2).sum(-1) / (2 * r * r))
    return (v / v.max()).astype(np.float32)


def ours(out: str):
    import torch

    sys.path.insert(0, __file__.rsplit('/', 1)[0])
    from vl.config import G
    from vl.grid import TransferFunction
    from vl.render import render_reference
    from vl.tracer import Medium

    tf = TransferFunction(np.array([0, 0.2, 0.6, 1], np.float32), np.array([0, 0, 0.5, 0.6], np.float32))
    med = Medium(blobs(), tf, torch.device('cpu'))
    n = SIZE * UP
    j = (torch.arange(n, dtype=torch.float32) + 0.5) / UP
    pts = torch.stack(torch.meshgrid(j, j, j, indexing='ij'), -1).reshape(-1, 3)
    fine = med.sigma(pts).reshape(n, n, n).numpy()
    gen = torch.Generator().manual_seed(3)
    img = render_reference(med, torch.tensor(VIEW), torch.tensor(LIGHT), ALBEDO, RES, SPP, gen).reshape(RES, RES)
    np.savez(out, sigma=fine, ours=img.numpy(), g=G)


def mitsuba(out: str):
    import mitsuba as mi

    for v in ('metal_ad_mono', 'scalar_rgb'):
        try:
            mi.set_variant(v)
            break
        except Exception:
            continue
    d = dict(np.load(out))
    T = mi.ScalarTransform4f
    c, r = SIZE / 2, SIZE * math.sqrt(3) / 2
    cam = np.array([c, c, c]) - VIEW * (r + 1)
    scene = mi.load_dict({
        'type': 'scene',
        'integrator': {'type': 'volpath', 'max_depth': 1024, 'rr_depth': 4, 'hide_emitters': True},
        'sensor': {
            'type': 'orthographic',
            'to_world': T().look_at(origin=cam.tolist(), target=[c, c, c], up=[0, 1, 0]) @ T().scale([r, r, 1]),
            'film': {'type': 'hdrfilm', 'width': RES, 'height': RES, 'rfilter': {'type': 'box'}},
            'sampler': {'type': 'independent', 'sample_count': SPP},
        },
        'key': {'type': 'directional', 'direction': (-LIGHT).tolist(), 'irradiance': 4 * math.pi},
        'sky': {'type': 'constant', 'radiance': 1.0},
        'cube': {
            'type': 'cube',
            'to_world': T().translate([c, c, c]) @ T().scale(c),
            'bsdf': {'type': 'null'},
            'interior': {
                'type': 'heterogeneous',
                'albedo': ALBEDO,
                'phase': {'type': 'hg', 'g': float(d['g'])},
                'sigma_t': {
                    'type': 'gridvolume',
                    'grid': mi.VolumeGrid(np.ascontiguousarray(d['sigma'].transpose(2, 1, 0))),
                    'to_world': T().scale(SIZE),
                },
            },
        },
    })
    img = np.array(mi.render(scene))
    d['mitsuba'] = img.mean(-1) if img.ndim == 3 else img
    d['variant'] = mi.variant()
    np.savez(out, **d)


def compare(out: str):
    d = np.load(out)
    a = d['ours']
    flips = {f'{k}{"T" if t else ""}': (np.rot90(d['mitsuba'], k).T if t else np.rot90(d['mitsuba'], k))
             for k in range(4) for t in (0, 1)}
    name, b = min(flips.items(), key=lambda kv: float(((kv[1] - a) ** 2).mean()))
    lit = b > 0.05 * b.max()
    # 4×4 blocks against the per-pixel noise
    blk = lambda x: x.reshape(RES // 4, 4, RES // 4, 4).mean((1, 3))  # noqa: E731
    rel = np.abs(blk(a) - blk(b))[blk(lit.astype(float)) == 1] / blk(b)[blk(lit.astype(float)) == 1]
    r = {'orientation': name, 'ratio': float(a[lit].mean() / b[lit].mean()), 'median': float(np.median(rel)),
         'p90': float(np.percentile(rel, 90))}
    print(f'variant {d["variant"]}, orientation {name}: mean ratio {r["ratio"]:.4f}, '
          f'4x4-block relative error median {r["median"]:.4f}, p90 {r["p90"]:.4f}')
    return r


if __name__ == '__main__':
    {'ours': ours, 'mitsuba': mitsuba, 'compare': compare}[sys.argv[1]](sys.argv[2])
