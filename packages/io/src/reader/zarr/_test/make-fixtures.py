"""
Makes the Zarr reader's fixtures (not shipped; the outputs are committed beside it).

Env: ~/miniforge3/bin/conda create -y -n cryoet-portal python=3.11 zarr=2 numcodecs numpy mrcfile
Run: ~/miniforge3/envs/cryoet-portal/bin/python make-fixtures.py

- blosc/*.bin: one blosc buffer per case of `CASES`; the decoded values are `values(kind, n)`, which the
  tests compute the same way (integers only, so both sides are exact).
- multiscale.zarr: 3 levels of `<f4` (C order, '/' separator, blosc lz4 + shuffle, edge chunks, one chunk all
  fill so never written), level 0 also as multiscale-0.mrc (through mrcfile) for the CCP4 comparison.
- mask.zarr: one level of `|i1` 0/1.
- arrays/*: single arrays for dtypes, endianness, codecs and what is refused.
"""
import json
import os
import shutil

import mrcfile
import numcodecs
import numpy as np
import zarr
from numcodecs import Blosc, GZip, Zlib

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')


def values(kind, n):
    """Matches `values` in blosc.test.ts."""
    i = np.arange(n, dtype=np.int64)
    if kind == 'smooth':
        return ((i >> 4) % 251) + ((i * 7) % 3)
    if kind == 'random':
        out = np.empty(n, dtype=np.int64)
        x = 2463534242
        for k in range(n):
            x ^= (x << 13) & 0xFFFFFFFF
            x ^= x >> 17
            x ^= (x << 5) & 0xFFFFFFFF
            out[k] = x & 0xFF
        return out
    raise ValueError(kind)


# name, kind, dtype, n, cname, shuffle, clevel (numcodecs ignores a blocksize: blocks come from clevel and size)
CASES = [
    # one block, split in typesize streams
    ('lz4-shuffle-f4', 'smooth', '<f4', 8000, 'lz4', Blosc.SHUFFLE, 5),
    ('lz4-noshuffle-f4', 'smooth', '<f4', 8000, 'lz4', Blosc.NOSHUFFLE, 5),
    ('lz4-shuffle-u1', 'smooth', '|u1', 5001, 'lz4', Blosc.SHUFFLE, 5),
    ('lz4hc-shuffle-f4', 'smooth', '<f4', 5000, 'lz4hc', Blosc.SHUFFLE, 5),
    # clevel 1: 64 KiB blocks, so several, the last a leftover block (never split)
    ('lz4-blocks-f4', 'smooth', '<f4', 20000, 'lz4', Blosc.SHUFFLE, 1),
    ('lz4-blocks-i2', 'smooth', '<i2', 40001, 'lz4', Blosc.SHUFFLE, 1),
    ('lz4-blocks-f8', 'smooth', '<f8', 20000, 'lz4', Blosc.SHUFFLE, 1),
    # incompressible: streams stored as they are (size = uncompressed)
    ('lz4-random-u2', 'random', '<u2', 1500, 'lz4', Blosc.SHUFFLE, 5),
    # too small to split (blocksize / typesize < 128), and typesize > 16: one stream
    ('lz4-tiny-f8', 'smooth', '<f8', 100, 'lz4', Blosc.SHUFFLE, 5),
    ('lz4-shuffle-v32', 'smooth', 'V32', 400, 'lz4', Blosc.SHUFFLE, 5),
    # clevel 0: the bytes as they are after the header
    ('memcpyed-f4', 'smooth', '<f4', 1000, 'lz4', Blosc.SHUFFLE, 0),
    ('zlib-shuffle-f4', 'smooth', '<f4', 8000, 'zlib', Blosc.SHUFFLE, 5),
    ('zlib-blocks-i2', 'smooth', '<i2', 40001, 'zlib', Blosc.NOSHUFFLE, 1),
    # refused
    ('bitshuffle-f4', 'smooth', '<f4', 1000, 'lz4', Blosc.BITSHUFFLE, 5),
    ('zstd-f4', 'smooth', '<f4', 1000, 'zstd', Blosc.SHUFFLE, 5),
    ('blosclz-f4', 'smooth', '<f4', 1000, 'blosclz', Blosc.SHUFFLE, 5),
]


def blosc_cases():
    d = os.path.join(HERE, 'blosc')
    os.makedirs(d, exist_ok=True)
    index = []
    for name, kind, dtype, n, cname, shuffle, clevel in CASES:
        # a V32 element is 32 bytes of `values` (typesize 32)
        data = values(kind, n * 32).astype('|u1').view('V32') if dtype == 'V32' else values(kind, n).astype(dtype)
        enc = Blosc(cname=cname, clevel=clevel, shuffle=shuffle).encode(data)
        enc = bytes(enc)
        with open(os.path.join(d, name + '.bin'), 'wb') as f:
            f.write(enc)
        flags = enc[2]
        index.append({'name': name, 'kind': kind, 'dtype': dtype, 'n': n, 'flags': flags,
                      'typesize': enc[3], 'blocksize': int.from_bytes(enc[8:12], 'little'), 'cbytes': len(enc)})
        print(f'{name:32} flags=0x{flags:02x} typesize={enc[3]} blocksize={index[-1]["blocksize"]} '
              f'nbytes={data.nbytes} cbytes={len(enc)}')
    with open(os.path.join(d, 'index.json'), 'w') as f:
        json.dump(index, f, indent=1)


def level_values(shape, level):
    """Matches `levelValue` in the tests: a value per voxel (z, y, x) that is exact in float32."""
    z, y, x = np.meshgrid(*[np.arange(s) for s in shape], indexing='ij')
    v = (100 * z + 10 * y + x + level * 1000).astype('<f4')
    # one all-fill chunk at level 0, so it is never written (missing key = fill value)
    if level == 0:
        v[0:4, 0:5, 6:12] = 0
    return v


def multiscale():
    path = os.path.join(HERE, 'multiscale.zarr')
    shutil.rmtree(path, ignore_errors=True)
    store = zarr.DirectoryStore(path, dimension_separator='/')
    root = zarr.group(store=store)
    comp = Blosc(cname='lz4', clevel=5, shuffle=Blosc.SHUFFLE)
    shapes = [(9, 11, 14), (5, 6, 7), (3, 3, 4)]
    base = 2.5
    datasets = []
    for level, shape in enumerate(shapes):
        a = root.create_dataset(str(level), shape=shape, chunks=(4, 5, 6), dtype='<f4', compressor=comp,
                                fill_value=0, write_empty_chunks=False)
        a[:] = level_values(shape, level)
        s = base * 2 ** level
        # NGFF: a coarser level's voxel centre sits half a fine voxel per binning step off the fine grid's
        t = (s - base) / 2
        datasets.append({'path': str(level), 'coordinateTransformations': [
            {'type': 'scale', 'scale': [s, s, s]},
            {'type': 'translation', 'translation': [t + 10, t + 20, t + 30]},
        ]})
    root.attrs['multiscales'] = [{
        'version': '0.4', 'name': 'synthetic',
        'axes': [{'name': n, 'type': 'space', 'unit': 'nanometer'} for n in 'zyx'],
        'datasets': datasets,
    }]
    # level 0 as MRC, the same voxels and placement (Å: the zarr is in nm)
    with mrcfile.new(os.path.join(HERE, 'multiscale-0.mrc'), overwrite=True) as m:
        m.set_data(level_values(shapes[0], 0))
        m.voxel_size = base * 10
        m.header.origin = (300.0, 200.0, 100.0)  # x, y, z in Å


def mask():
    path = os.path.join(HERE, 'mask.zarr')
    shutil.rmtree(path, ignore_errors=True)
    store = zarr.DirectoryStore(path, dimension_separator='/')
    root = zarr.group(store=store)
    shape = (6, 7, 8)
    z, y, x = np.meshgrid(*[np.arange(s) for s in shape], indexing='ij')
    v = (((z - 3) ** 2 + (y - 3) ** 2 + (x - 4) ** 2) <= 6).astype('|i1')
    a = root.create_dataset('0', shape=shape, chunks=(4, 4, 4), dtype='|i1',
                            compressor=Blosc(cname='lz4', clevel=5, shuffle=Blosc.SHUFFLE), fill_value=0)
    a[:] = v
    root.attrs['multiscales'] = [{
        'version': '0.4',
        'axes': [{'name': n, 'type': 'space', 'unit': 'angstrom'} for n in 'zyx'],
        'datasets': [{'path': '0', 'coordinateTransformations': [{'type': 'scale', 'scale': [6.0, 6.0, 6.0]}]}],
    }]


def arrays():
    """Single arrays: values `(i % 50) - 7` over a (3, 4, 5) shape in C order, chunks (2, 3, 4)."""
    d = os.path.join(HERE, 'arrays')
    shutil.rmtree(d, ignore_errors=True)
    shape = (3, 4, 5)
    v = (np.arange(60) % 50 - 7).reshape(shape)
    lz4 = Blosc(cname='lz4', clevel=5, shuffle=Blosc.SHUFFLE)
    cases = [
        ('f4-dot', '<f4', lz4, '.', 'C', None, 0),
        ('be-f4', '>f4', lz4, '/', 'C', None, 0),
        ('u2', '<u2', lz4, '/', 'C', None, 0),
        ('i2-fill', '<i2', lz4, '/', 'C', None, -3),
        ('u1-raw', '|u1', None, '/', 'C', None, 0),
        ('i2-zlib', '<i2', Zlib(level=5), '/', 'C', None, 0),
        ('f4-gzip', '<f4', GZip(level=5), '/', 'C', None, 0),
        ('fortran', '<f4', lz4, '/', 'F', None, 0),
        ('filters', '<f4', lz4, '/', 'C', [numcodecs.Delta(dtype='<f4')], 0),
        ('zstd', '<f4', numcodecs.Zstd(), '/', 'C', None, 0),
    ]
    for name, dtype, comp, sep, order, filters, fill in cases:
        store = zarr.DirectoryStore(os.path.join(d, name), dimension_separator=sep)
        vals = v
        if dtype[1] == 'u':
            vals = v + 7
        a = zarr.create(shape=shape, chunks=(2, 3, 4), dtype=dtype, compressor=comp, order=order, filters=filters,
                        fill_value=fill, store=store, write_empty_chunks=False)
        a[:] = vals
        if name == 'i2-fill':
            # a missing chunk: the reader gives the fill value
            del store['0/0/0']


if __name__ == '__main__':
    blosc_cases()
    multiscale()
    mask()
    arrays()
