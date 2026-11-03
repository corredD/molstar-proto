# Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
#
# @author Ludovic Autin <autin@scripps.edu>
"""Our path tracer against Mitsuba 3's volpath, multiple scattering on a heterogeneous grid (skipped without the conda
env `volume-lighting`)."""

import os
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MITSUBA_PY = os.path.expanduser('~/miniforge3/envs/volume-lighting/bin/python')


@pytest.mark.skipif(not os.path.exists(MITSUBA_PY), reason='no conda env volume-lighting')
def test_ours_matches_mitsuba(tmp_path):
    out = str(tmp_path / 'mi.npz')
    script = os.path.join(HERE, 'mitsuba_check.py')
    subprocess.run([sys.executable, script, 'ours', out], check=True)
    subprocess.run([MITSUBA_PY, script, 'mitsuba', out], check=True, capture_output=True)
    sys.path.insert(0, HERE)
    from mitsuba_check import compare

    r = compare(out)
    # same orientation (same camera frame), same brightness to 1 %, 4×4 blocks within the noise
    assert r['orientation'] == '0'
    assert abs(r['ratio'] - 1) < 0.01
    assert r['median'] < 0.02
