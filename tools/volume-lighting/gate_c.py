# Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
#
# @author Ludovic Autin <autin@scripps.edu>
"""Gate C (plan C4, LANE.md "Gate C criterion"): `volumetric` and `neural` against path-traced references on the
held-out maps, over a light sweep; prints the numbers as JSON and writes the images (`--images DIR`)."""

from __future__ import annotations

import argparse
import json
import math
import os
import sys

import numpy as np
import torch

from vl.config import G
from vl.data import HELD_OUT, load_values, manifest, random_unit
from vl.descriptors import descriptors, to_torch
from vl.grid import cell_sigma, pyramid, random_tf
from vl.net import Net, volumetric
from vl.render import camera_rays, render_march, render_reference
from vl.tracer import Medium

SEED = 9001  # no training run draws from it
ANGLES = [0, 30, 60, 90, 120, 150, 180]
LIGHT = (0.6, 0.4)  # Mol*'s key light and ambient intensities
RES, SPP, ALBEDO, STEP = 96, 256, 0.8, 0.5


def shade_fn(med, levels, light, model):
    def shade(p, v):
        d = descriptors(med, levels, p, v, light)
        if model == 'volumetric':
            return volumetric(d)
        x = torch.cat([d, torch.full((d.shape[0], 1), ALBEDO)], 1)
        with torch.no_grad():
            o = model(x)
        return o[:, 0], o[:, 1]

    return shade


def main(weights: str, images: str | None, n_tf: int, spp: int, maps=HELD_OUT, jitter: bool = False):
    net = Net.load(weights)
    cpu = torch.device('cpu')
    rng = np.random.default_rng(SEED)
    results = {}
    for e in (m for m in manifest() if m.file in maps):
        values = load_values(e, 144)
        rows = []
        for t in range(n_tf):
            tf = random_tf(rng, values)
            med = Medium(values, tf, cpu)
            levels = to_torch(pyramid(cell_sigma(values, tf)), cpu)
            view = torch.from_numpy(random_unit(rng)[0])
            up = torch.nn.functional.normalize(torch.linalg.cross(view, torch.from_numpy(random_unit(rng)[0])), dim=0)
            o, d = camera_rays(med, view, RES)
            for ang in ANGLES:
                a = math.radians(ang)
                light = (-view * math.cos(a) + up * math.sin(a)).float()
                gen = torch.Generator().manual_seed(SEED + ang)
                halves = [render_reference(med, view, light, ALBEDO, RES, spp // 2, gen, light=LIGHT, jitter=jitter)
                          for _ in range(2)]
                ref = (halves[0] + halves[1]) / 2
                row = {'tf': t, 'angle': ang, 'ref_mean': float(ref.mean()),
                       'noise': float((halves[0] - halves[1]).pow(2).mean().sqrt() / 2 / ref.mean())}
                imgs = {'reference': ref}
                for name, model in (('volumetric', 'volumetric'), ('neural', net)):
                    # the shader stops a ray at accumulated alpha 0.95 (T < 0.05)
                    img = render_march(med, o, d, shade_fn(med, levels, light, model), ALBEDO, STEP, LIGHT,
                                       cutoff=0.05, unlit_below=0.01)
                    imgs[name] = img
                    row[name] = {'ratio': float(img.mean() / ref.mean()),
                                 'rel_rmse': float((img - ref).pow(2).mean().sqrt() / ref.mean())}
                rows.append(row)
                print(e.file, json.dumps(row), flush=True)
                if images:
                    save(images, f'{e.file.split(".")[0]}_tf{t}_{ang:03d}', imgs)
        summ = {m: {'mean_ratio': float(np.mean([r[m]['ratio'] for r in rows])),
                    'mean_abs_ratio_err': float(np.mean([abs(r[m]['ratio'] - 1) for r in rows])),
                    'rel_rmse': float(np.mean([r[m]['rel_rmse'] for r in rows]))} for m in ('volumetric', 'neural')}
        summ['noise_floor'] = float(np.mean([r['noise'] for r in rows]))
        summ['neural_passes'] = (summ['neural']['rel_rmse'] <= 0.8 * summ['volumetric']['rel_rmse']
                                 and summ['neural']['mean_abs_ratio_err'] < summ['volumetric']['mean_abs_ratio_err'])
        results[e.file] = {'summary': summ, 'rows': rows}
    results['gate_c'] = all(v['summary']['neural_passes'] for v in results.values())
    results['g'] = G
    print(json.dumps({k: (v['summary'] if isinstance(v, dict) else v) for k, v in results.items()}, indent=1))
    return results


def save(folder: str, name: str, imgs: dict):
    """one PNG per configuration: reference | volumetric | neural, the same exposure (the reference's 99.5th
    percentile at 0.9), gamma 2.2"""
    from PIL import Image

    os.makedirs(folder, exist_ok=True)
    ref = imgs['reference'].reshape(RES, RES).numpy()
    k = 0.9 / max(float(np.percentile(ref, 99.5)), 1e-6)
    row = np.concatenate([imgs[m].reshape(RES, RES).numpy() for m in ('reference', 'volumetric', 'neural')], 1)
    Image.fromarray((np.clip(row * k, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)).save(os.path.join(folder, name + '.png'))


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('weights', help='the weights module (.ts) or a JSON export')
    ap.add_argument('--images')
    ap.add_argument('--tfs', type=int, default=2)
    ap.add_argument('--spp', type=int, default=SPP)
    ap.add_argument('--out')
    ap.add_argument('--maps', nargs='*', default=list(HELD_OUT), help='default: the held-out maps')
    ap.add_argument('--jitter', action='store_true', help='the reference box-filtered over the pixel (run 1, a bug)')
    a = ap.parse_args()
    r = main(a.weights, a.images, a.tfs, a.spp, a.maps, a.jitter)
    if a.out:
        with open(a.out, 'w') as f:
            json.dump(r, f, indent=1)
    sys.exit(0)
