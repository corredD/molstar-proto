# Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
#
# @author Ludovic Autin <autin@scripps.edu>
"""Training pairs (plan B2): per map ~20 random transfer functions, lights and albedos; points where camera rays first
meet density; their 13 descriptors and albedo against the reference in-scatter. The split is fixed here, before any
data: HELD_OUT is never trained on nor tuned on; validation is carved from the training maps' configurations."""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass

import numpy as np
import torch

from .config import DATA_DIR
from .descriptors import descriptors, to_torch
from .grid import cell_sigma, load_map, normalize, pyramid, random_tf
from .tracer import Medium, first_collisions, in_scatter

HELD_OUT = ('emd_11638.map', 'emd_5778.map', 'tomo_10003_TS_08_b.mrc')
VAL_EVERY = 10  # configuration c of a training map is validation when c % VAL_EVERY == VAL_EVERY - 1


@dataclass
class MapEntry:
    file: str
    kind: str

    @property
    def held_out(self) -> bool:
        return self.file in HELD_OUT


def manifest() -> list[MapEntry]:
    with open(os.path.join(DATA_DIR, 'manifest.json')) as f:
        return [MapEntry(m['file'], m['kind']) for m in json.load(f)]


def load_values(entry: MapEntry, max_size: int) -> np.ndarray:
    """normalized byte values, tomograms inverted (their density is dark)"""
    data, _ = load_map(os.path.join(DATA_DIR, entry.file), max_size)
    return normalize(-data if entry.kind == 'tomogram' else data)


def random_unit(rng: np.random.Generator, n: int = 1) -> np.ndarray:
    v = rng.normal(size=(n, 3))
    return (v / np.linalg.norm(v, axis=1, keepdims=True)).astype(np.float32)


def view_rays(med: Medium, rng: np.random.Generator, n: int, n_views: int):
    """orthographic camera rays of `n_views` random directions, origins uniform over the disc framing the box"""
    r = float(med.size.norm()) / 2
    dirs = random_unit(rng, n_views).repeat(math.ceil(n / n_views), 0)[:n]
    a = random_unit(rng, n)
    u = np.cross(dirs, a)
    u /= np.linalg.norm(u, axis=1, keepdims=True)
    w = np.cross(dirs, u)
    rho = r * np.sqrt(rng.random(n))[:, None]
    phi = 2 * np.pi * rng.random(n)[:, None]
    c = med.size.cpu().numpy() / 2
    o = c - dirs * (r + 1) + rho * (np.cos(phi) * u + np.sin(phi) * w)
    t = lambda x: torch.from_numpy(np.ascontiguousarray(x, np.float32)).to(med.device)  # noqa: E731
    return t(o), t(dirs)


def generate(entry: MapEntry, device, n_configs=20, points=1500, n_paths=256, max_size=144, seed=0, batch=1 << 21):
    """one map's pairs: a dict of arrays (desc (N, 13), albedo, key, amb, se_key, se_amb, config)"""
    rng = np.random.default_rng([seed, abs(hash(entry.file)) % (1 << 31)])
    gen = torch.Generator(device=device).manual_seed(seed)
    values = load_values(entry, max_size)
    out: dict[str, list] = {k: [] for k in ('desc', 'albedo', 'key', 'amb', 'se_key', 'se_amb', 'config')}
    for c in range(n_configs):
        tf = random_tf(rng, values)
        med = Medium(values, tf, device)
        levels = to_torch(pyramid(cell_sigma(values, tf)), device)
        light = torch.from_numpy(random_unit(rng)[0]).to(device)
        # rays until `points` first collisions (faint transfer functions let most rays through), 8 views per batch
        ps, ds, n = [], [], 0
        for _ in range(64):
            o, d = view_rays(med, rng, points * 2, 8)
            p, hit = first_collisions(med, o, d, gen)
            ps.append(p[hit])
            ds.append(d[hit])
            n += int(hit.sum())
            if n >= points:
                break
        p, d = torch.cat(ps)[:points], torch.cat(ds)[:points]
        hi = torch.arange(p.shape[0], device=device)
        if not hi.numel():
            continue
        albedo = torch.from_numpy(rng.uniform(0.3, 0.95, hi.numel()).astype(np.float32)).to(device)
        res = [torch.empty(0, device=device)] * 4
        step = max(1, batch // n_paths)
        for s in range(0, hi.numel(), step):
            r = in_scatter(med, p[s : s + step], d[s : s + step], light, albedo[s : s + step], n_paths, gen)
            res = [torch.cat([a, b]) for a, b in zip(res, r)]
        out['desc'].append(descriptors(med, levels, p, d, light))
        out['albedo'].append(albedo)
        for k, v in zip(('key', 'amb', 'se_key', 'se_amb'), res):
            out[k].append(v)
        out['config'].append(torch.full((hi.numel(),), c, dtype=torch.int32, device=device))
    return {k: torch.cat(v).cpu().numpy() for k, v in out.items()}

