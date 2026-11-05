# Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
#
# @author Ludovic Autin <autin@scripps.edu>
"""The CryoET Data Portal's index for prism-me (packages/extensions/cryoet/_spec/portal.md §1).

A browser cannot ask the portal's GraphQL (its CORS allow-list), so the datasets' metadata is read here, once, with
the portal's client, and shipped with the app as one JSON a dataset (`<id>.json`) and a catalog (`index.json`).
The format is `PortalDataset` in packages/extensions/cryoet/src/portal-index.ts, version `VERSION`.

  python -I portal_index.py <out dir> <dataset id>[:<max runs>] ...

Needs the conda env `cryoet-portal` (cryoet_data_portal). Eight bulk queries a dataset, plus each zarr's metadata
(`.zattrs`, each level's `.zarray`) from the file host.
"""

import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from cryoet_data_portal import (
    Annotation,
    AnnotationFile,
    AnnotationShape,
    Client,
    Dataset,
    PerSectionParameters,
    Run,
    TiltSeries,
    Tomogram,
    TomogramVoxelSpacing,
)

VERSION = 1
FILES = 'https://files.cryoetdataportal.cziscience.com/'

# What decorates an annotation's points, by dataset and object name: not the portal's (it links no fitted model).
# `center`: the average's box center in the structure's frame (Å), where a point sits: EMD-13412 is 256³ at 1.7005 Å.
DECORATIONS = {
    10003: {
        'cytosolic ribosome': {'pdb': '7PHB', 'emdb': 'EMD-13412', 'center': [217.664, 217.664, 217.664]},
    },
}



def relative(url):
    if not url.startswith(FILES):
        raise ValueError(f'not on the file host: {url}')
    return url[len(FILES):]


def get_json(url, tries=5):
    # a burst of reads (16 at a time) sometimes has a name lookup dropped by the resolver: asked again, after a moment
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError:
            raise  # the host answered: a 404 is not a dropped lookup
        except urllib.error.URLError:
            if i == tries - 1:
                raise
            time.sleep(1 + i)


def zarr_levels(url):
    """The levels of an OME-Zarr: path, size (x, y, z), spacing (Å), bytes decoded"""
    url = url.rstrip('/')
    ms = get_json(f'{url}/.zattrs')['multiscales'][0]
    levels = []
    for d in ms['datasets']:
        a = get_json(f"{url}/{d['path']}/.zarray")
        scale = next(t['scale'] for t in d['coordinateTransformations'] if t['type'] == 'scale')
        # the last three axes are z, y, x (a 4D or 5D image: its channels and times before them)
        z, y, x = a['shape'][-3:]
        levels.append({
            'path': d['path'],
            'size': [x, y, z],
            'spacing': round(scale[-1], 4),
            'bytes': x * y * z * np.dtype(a['dtype']).itemsize,
        })
    return levels


def tilt_angles(client, dataset_id, tilt_series):
    """Each tilt series' angles, one per image by `z_index` (angles[i] is image i, whatever the rows' order): the client's
    per-section parameters; the file host's `tiltseries_metadata.json` for a series whose rows are not one per image"""
    rows = {}
    for p in PerSectionParameters.find(client, [PerSectionParameters.tiltseries.run.dataset_id == dataset_id]):
        rows.setdefault(p.tiltseries_id, []).append((p.z_index, p.raw_angle))
    out = {}
    for t in tilt_series:
        by_z = dict(rows.get(t.id, []))
        # one row an image: z 0..n-1, none twice
        if len(rows.get(t.id, [])) != t.size_z or sorted(by_z) != list(range(t.size_z)):
            meta = get_json(t.https_omezarr_dir.rsplit('/', 1)[0] + '/tiltseries_metadata.json')
            by_z = {p['z_index']: p['raw_angle'] for p in meta['per_section_parameter']}
            print(f'tilt series {t.id}: angles from tiltseries_metadata.json', file=sys.stderr)
        if sorted(by_z) != list(range(t.size_z)):
            raise ValueError(f'tilt series {t.id}: {len(by_z)} angles for {t.size_z} images')
        out[t.id] = [round(by_z[z], 4) for z in range(t.size_z)]
    return out


def index_dataset(client, dataset_id, max_runs):
    ds = Dataset.get_by_id(client, dataset_id)
    runs = sorted(Run.find(client, [Run.dataset_id == dataset_id]), key=lambda r: r.name)
    total_runs = len(runs)
    if max_runs:
        runs = runs[:max_runs]
    run_ids = {r.id for r in runs}

    spacings = [s for s in TomogramVoxelSpacing.find(client, [TomogramVoxelSpacing.run.dataset_id == dataset_id])
                if s.run_id in run_ids]
    tomograms = [t for t in Tomogram.find(client, [Tomogram.run.dataset_id == dataset_id]) if t.run_id in run_ids]
    annotations = {a.id: a for a in Annotation.find(client, [Annotation.run.dataset_id == dataset_id])
                   if a.run_id in run_ids}
    shapes = {s.id: s for s in AnnotationShape.find(client, [AnnotationShape.annotation.run.dataset_id == dataset_id])
              if s.annotation_id in annotations}
    files = [f for f in AnnotationFile.find(client, [AnnotationFile.annotation_shape.annotation.run.dataset_id == dataset_id])
             if f.annotation_shape_id in shapes]

    # a shape's MRC is left out when it has a zarr: a browser reads whole files only, and the zarr has levels
    with_zarr = {f.annotation_shape_id for f in files if f.format == 'zarr'}
    files = [f for f in files if not (f.format == 'mrc' and f.annotation_shape_id in with_zarr)]

    tilt_series = [t for t in TiltSeries.find(client, [TiltSeries.run.dataset_id == dataset_id]) if t.run_id in run_ids]
    angles = tilt_angles(client, dataset_id, tilt_series)

    zarrs = ([t.https_omezarr_dir for t in tomograms] + [f.https_path for f in files if f.format == 'zarr']
             + [t.https_omezarr_dir for t in tilt_series])
    with ThreadPoolExecutor(16) as pool:
        levels = dict(zip(zarrs, pool.map(zarr_levels, zarrs)))

    by_spacing = {s.id: {'spacing': s.voxel_spacing, 'tomograms': [], 'annotations': []} for s in spacings}
    for t in sorted(tomograms, key=lambda t: t.id):
        entry = {
            'id': t.id,
            'name': t.name,
            'processing': t.processing,
            'size': [t.size_x, t.size_y, t.size_z],
            'zarr': relative(t.https_omezarr_dir),
            'levels': levels[t.https_omezarr_dir],
        }
        # what the portal's own tomogram list shows (each when the portal has it): WBP, SART, Fourier_Space, …
        if t.reconstruction_method:
            entry['method'] = t.reconstruction_method
        if t.reconstruction_software:
            entry['reconstructionSoftware'] = t.reconstruction_software
        if t.processing_software:
            entry['processingSoftware'] = t.processing_software
        if t.alignment_id:
            entry['alignment'] = t.alignment_id
        # the portal shows the lowest id flagged (a run may flag one a spacing): the reader picks it
        if t.is_visualization_default:
            entry['default'] = True
        by_spacing[t.tomogram_voxel_spacing_id]['tomograms'].append(entry)
    for f in sorted(files, key=lambda f: (f.annotation_shape_id, f.format)):
        shape = shapes[f.annotation_shape_id]
        a = annotations[shape.annotation_id]
        entry = {
            'id': a.id,
            'object': a.object_name,
            'shape': shape.shape_type,
            'format': f.format,
            'path': relative(f.https_path),
        }
        if f.format == 'zarr':
            entry['levels'] = levels[f.https_path]
        elif f.file_size:
            entry['bytes'] = int(f.file_size)
        if a.object_count:
            entry['count'] = a.object_count
        if a.ground_truth_status:
            entry['groundTruth'] = True
        # the portal's words for it (each when it has them): what it is, how it was made, its Gene Ontology term
        if a.object_description:
            entry['description'] = a.object_description
        if a.annotation_method:
            entry['method'] = a.annotation_method
        if a.object_id and a.object_id.startswith('GO:'):
            entry['goId'] = a.object_id
        if f.is_visualization_default:
            entry['default'] = True
        by_spacing[a.tomogram_voxel_spacing_id]['annotations'].append(entry)

    by_run = {}
    for t in sorted(tilt_series, key=lambda t: t.id):
        # the client has no visualization default for a tilt series (4.9.0): none is written
        by_run.setdefault(t.run_id, []).append({
            'id': t.id,
            'zarr': relative(t.https_omezarr_dir),
            'levels': levels[t.https_omezarr_dir],
            # the portal's pixel size, not the zarr's scale (1.7005 against 1.7)
            'pixelSpacing': t.pixel_spacing,
            'tiltAxis': t.tilt_axis,
            'angles': angles[t.id],
        })

    run_list = []
    for r in runs:
        ss = sorted((by_spacing[s.id] for s in spacings if s.run_id == r.id), key=lambda s: s['spacing'])
        run = {'id': r.id, 'name': r.name, 'spacings': ss}
        if r.id in by_run:
            run['tiltSeries'] = by_run[r.id]
        run_list.append(run)

    # 'doi:10.1038/…, 10.1101/…': the DOIs alone (other references, EMPIAR ids, are left out)
    refs = (d.strip() for d in (ds.dataset_publications or '').replace(';', ',').split(','))
    dois = sorted({d[4:] if d.startswith('doi:') else d for d in refs if d.startswith(('doi:', '10.'))})
    out = {
        'version': VERSION,
        'built': datetime.date.today().isoformat(),
        'id': ds.id,
        'title': ds.title,
        'organism': ds.organism_name,
        'runs': total_runs,
        'dois': dois,
        'runList': run_list,
    }
    if dataset_id in DECORATIONS:
        out['decorations'] = DECORATIONS[dataset_id]
    return out


def main():
    out_dir = sys.argv[1]
    os.makedirs(out_dir, exist_ok=True)
    client = Client()
    catalog = []
    for arg in sys.argv[2:]:
        dataset_id, _, max_runs = arg.partition(':')
        d = index_dataset(client, int(dataset_id), int(max_runs) if max_runs else 0)
        path = os.path.join(out_dir, f"{d['id']}.json")
        with open(path, 'w') as f:
            json.dump(d, f, separators=(',', ':'))
        print(f"{path}: {len(d['runList'])} of {d['runs']} runs, {os.path.getsize(path):,} bytes")
        catalog.append({k: d[k] for k in ('id', 'title', 'organism', 'runs')})
    with open(os.path.join(out_dir, 'index.json'), 'w') as f:
        json.dump({'version': VERSION, 'datasets': catalog}, f, indent=1)


if __name__ == '__main__':
    main()
