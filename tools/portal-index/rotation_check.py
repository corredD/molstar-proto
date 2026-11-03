# Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
#
# @author Ludovic Autin <autin@scripps.edu>
"""Which rotation convention the CryoET Data Portal's `xyz_rotation_matrix` follows, measured on the data.

A reference map (EMD-13412, 70S) is placed at each oriented point of an ndjson under each candidate R (the matrix as
given, its transpose), the way Mol* draws a particle target: world = p + R (x - c), c the map's box center. The placed
map is correlated with the tomogram around the point (the tomogram's dense matter is dark: its values are negated).
Controls: random rotations, the points of another particle (shuffled), and the mirrored reference.

  python -I rotation_check.py <points.ndjson> <pixel size, Å> <tomogram.zarr level dir> <reference.map>

Prints, per candidate, the mean ± sd of the correlation over the points and how often it wins.
"""

import json
import sys

import mrcfile
import numpy as np
import zarr
from scipy import ndimage
from scipy.spatial.transform import Rotation


def load_points(path, pixel_size):
    points, matrices = [], []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            if r.get('type') != 'orientedPoint':
                continue
            loc = r['location']
            points.append([loc['x'] * pixel_size, loc['y'] * pixel_size, loc['z'] * pixel_size])
            matrices.append(np.array(r['xyz_rotation_matrix'], dtype=np.float64))
    return np.array(points), np.array(matrices)


def load_level(level_dir):
    """The level's array (z, y, x) and its scale and translation (x, y, z, Å) from the NGFF multiscales above it"""
    group = zarr.open(level_dir.rsplit('/', 1)[0], mode='r')
    name = level_dir.rstrip('/').rsplit('/', 1)[1]
    ms = group.attrs['multiscales'][0]
    ds = next(d for d in ms['datasets'] if d['path'] == name)
    scale, translation = [1.0, 1.0, 1.0], [0.0, 0.0, 0.0]
    for t in ds['coordinateTransformations']:
        if t['type'] == 'scale':
            scale = t['scale']
        elif t['type'] == 'translation':
            translation = t['translation']
    # NGFF axes are z, y, x
    return np.asarray(group[name][:], dtype=np.float32), np.array(scale[::-1]), np.array(translation[::-1])


def load_reference(path, spacing, lowpass):
    """The map resampled to `spacing` (Å), low-passed to `lowpass` Å, normalized; its box center in its own voxels"""
    with mrcfile.open(path, permissive=True) as m:
        data = np.asarray(m.data, dtype=np.float32)
        apix = float(m.voxel_size.x)
    zoom = apix / spacing
    data = ndimage.zoom(data, zoom, order=1)
    data = ndimage.gaussian_filter(data, lowpass / spacing / 2.355)
    data = (data - data.mean()) / data.std()
    center = (np.array(data.shape[::-1]) - 1) / 2  # x, y, z voxels
    return data, center


def offsets(radius, spacing):
    n = int(np.ceil(radius / spacing))
    r = np.arange(-n, n + 1) * spacing
    d = np.stack(np.meshgrid(r, r, r, indexing='ij'), -1).reshape(-1, 3)
    return d[np.linalg.norm(d, axis=1) <= radius]


def sample(volume, xyz_voxels):
    return ndimage.map_coordinates(volume, xyz_voxels[:, ::-1].T, order=1, mode='constant', cval=0.0)


def correlation(a, b):
    a = a - a.mean()
    b = b - b.mean()
    return float((a * b).sum() / np.sqrt((a * a).sum() * (b * b).sum() + 1e-12))


def main():
    points_path, pixel_size, level_dir, ref_path = sys.argv[1], float(sys.argv[2]), sys.argv[3], sys.argv[4]
    points, matrices = load_points(points_path, pixel_size)
    tomo, scale, translation = load_level(level_dir)
    spacing = float(scale[0])
    ref, ref_center = load_reference(ref_path, spacing, 30.0)
    # the reference mirrored along x, y and z (arrays are z, y, x)
    mirrors = {'x': ref[:, :, ::-1].copy(), 'y': ref[:, ::-1, :].copy(), 'z': ref[::-1, :, :].copy()}
    d = offsets(160.0, spacing)
    print(f'{len(points)} points; tomogram {tomo.shape[::-1]} at {spacing} Å, translation {translation}; '
          f'reference {ref.shape[::-1]}; {len(d)} samples a point')

    rng = np.random.default_rng(1)
    shuffled = matrices[rng.permutation(len(matrices))]
    randoms = Rotation.random(len(matrices), random_state=2).as_matrix()
    candidates = {
        'M (as given; Mol* today)': (matrices, ref),
        'M^T': (np.transpose(matrices, (0, 2, 1)), ref),
        **{f'M, reference mirrored in {a}': (matrices, m) for a, m in mirrors.items()},
        **{f'M^T, reference mirrored in {a}': (np.transpose(matrices, (0, 2, 1)), m) for a, m in mirrors.items()},
        'shuffled M': (shuffled, ref),
        'random R': (randoms, ref),
    }
    scores = {k: [] for k in candidates}
    for i, p in enumerate(points):
        t = -sample(tomo, (p + d - translation) / spacing)
        for name, (rs, r) in candidates.items():
            # world = p + R (x - c): the reference at x = c + R^T (world - p)
            x = ref_center + (d @ rs[i]) / spacing
            scores[name].append(correlation(t, sample(r, x)))
    table = np.array([scores[k] for k in candidates])
    wins = np.bincount(table[:2].argmax(axis=0), minlength=2)
    for k, s in zip(candidates, table):
        print(f'{k:34s} CC {s.mean():+.4f} ± {s.std():.4f}  median {np.median(s):+.4f}')
    print(f'per point, M beats M^T at {wins[0]} of {len(points)}; M^T beats M at {wins[1]}')
    best = int(table.mean(axis=1).argmax())
    names = list(candidates)
    for j, k in enumerate(names):
        if j != best:
            print(f'{names[best]} beats {k} at {int((table[best] > table[j]).sum())} of {len(points)} points')


if __name__ == '__main__':
    main()
