# Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
#
# @author Ludovic Autin <autin@scripps.edu>
"""Generates the training pairs (plan B2) into DATA_DIR/pairs/<map>.npz; `--bench` times one configuration."""

import argparse
import os
import time

import numpy as np

from vl.config import DATA_DIR, device
from vl.data import generate, manifest

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--maps', nargs='*', help='files from the manifest (default: all)')
    ap.add_argument('--configs', type=int, default=20)
    ap.add_argument('--points', type=int, default=2000)
    ap.add_argument('--paths', type=int, default=1024)
    ap.add_argument('--max-size', type=int, default=144)
    ap.add_argument('--bench', action='store_true')
    a = ap.parse_args()
    dev = device()
    os.makedirs(os.path.join(DATA_DIR, 'pairs'), exist_ok=True)
    for e in manifest():
        if a.maps and e.file not in a.maps:
            continue
        t = time.time()
        n_configs = 1 if a.bench else a.configs
        d = generate(e, dev, n_configs, a.points, a.paths, a.max_size)
        dt = time.time() - t
        rel = lambda v, s: float(np.median(s / np.maximum(v, 1e-6)))  # noqa: E731
        print(f'{e.file} ({e.kind}{", held out" if e.held_out else ""}) on {dev}: {len(d["key"])} pairs in {dt:.1f}s; '
              f'median rel. se key {rel(d["key"], d["se_key"]):.3f} amb {rel(d["amb"], d["se_amb"]):.3f}; '
              f'mean key {d["key"].mean():.3f} amb {d["amb"].mean():.3f}', flush=True)
        if not a.bench:
            np.savez(os.path.join(DATA_DIR, 'pairs', e.file.split('.')[0] + '.npz'), **d)
