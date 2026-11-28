"""The stem-events fixture: a synthetic drums and bass pair, through the stem study's reference detector.

Writes stem-events-fixture.json beside it (the events only); stem-events.spec.ts makes the same signal (`fixtureSignal`)
and holds the TS detector to these. Not run by jest; re-run by hand after a change to the signal or to the reference:

    ~/molstar-votr-lanes/stem-study/.venv/bin/python stem-events-fixture.py

band_flux and pick are copied verbatim from stem-study/scripts/metrics.py:22-68 (that script reads the study's data
when imported).

@author Ludovic Autin <autin@scripps.edu>
"""
import json
from pathlib import Path
import numpy as np
from scipy.signal import stft
from scipy.ndimage import maximum_filter1d, median_filter

SR = 44100


def band_flux(x, lo, hi, nfft, hop, lag=2, gamma=100.0):
    f, t, Z = stft(x, fs=SR, window='hann', nperseg=nfft, noverlap=nfft - hop, boundary='zeros', padded=True)
    sel = (f >= lo) & (f <= hi)
    M = np.abs(Z[sel]) * (2 / nfft)
    L = np.log1p(gamma * M)
    flux = np.maximum(0, L[:, lag:] - L[:, :-lag]).sum(0)
    flux = np.concatenate([np.zeros(lag), flux])
    energy = (M ** 2).sum(0)
    return t, flux, energy


def pick(t, flux, energy, min_gap_s, delta_rel, win_s=0.5, floor_db=-30):
    hop_s = t[1] - t[0]
    w = max(3, int(round(win_s / hop_s)) | 1)
    base = median_filter(flux, size=w, mode='nearest')
    loc = int(round(min_gap_s / hop_s))
    is_max = flux == maximum_filter1d(flux, size=2 * loc + 1, mode='nearest')
    thr = base + delta_rel * np.percentile(flux[flux > 0], 95)
    edb = 10 * np.log10(energy + 1e-12)
    run = maximum_filter1d(edb, size=int(round(4 / hop_s)), mode='nearest')
    ahead = maximum_filter1d(edb, size=int(round(0.06 / hop_s)), origin=-int(round(0.03 / hop_s)), mode='nearest')
    idx = np.where(is_max & (flux > thr) & (ahead > run + floor_db))[0]
    out = []
    for i in idx:
        if out and t[i] - t[out[-1]] < min_gap_s:
            if flux[i] > flux[out[-1]]: out[-1] = i
            continue
        out.append(i)
    out = np.array(out, dtype=int)
    times, strength = [], []
    for i in out:
        a = max(0, i - int(round(0.04 / hop_s))); b = min(len(edb), i + int(round(0.06 / hop_s)))
        pk = edb[i:b].max()
        j = a + int(np.argmax(edb[a:b] >= pk - 6))
        times.append(t[j]); strength.append(pk)
    return np.array(times), np.array(strength)


def mulberry32(seed):
    """audio-pipeline-helper.ts mulberry32, in unsigned 32-bit arithmetic"""
    a = seed & 0xffffffff
    M = 0xffffffff
    def imul(x, y): return (x * y) & M
    def rnd():
        nonlocal a
        a = (a + 0x6D2B79F5) & M
        t = imul(a ^ (a >> 15), 1 | a)
        t = ((t + imul(t ^ (t >> 7), 61 | t)) & M) ^ t
        return ((t ^ (t >> 14)) & M) / 4294967296
    return rnd


# the signal: stem-events.spec.ts fixtureSignal does the same, sample by sample
SECONDS = 8
KICKS = [0.5 + 0.5 * k for k in range(14)]           # amplitude 1, 0.5, 1, ...
NOTES = [(0.75 + k, 55 if k % 2 == 0 else 82) for k in range(7)]
HATS = [0.25 + 0.5 * k for k in range(1, 15)]
n = SECONDS * SR
drums = np.zeros(n)
bass = np.zeros(n)
for k, t0 in enumerate(KICKS):
    amp = 1 if k % 2 == 0 else 0.5
    s0 = round(t0 * SR)
    for i in range(round(0.12 * SR)):
        t = i / SR
        drums[s0 + i] += amp * np.exp(-t / 0.04) * np.sin(2 * np.pi * (50 * t + 50 * 0.03 * (1 - np.exp(-t / 0.03))))
for t0, f in NOTES:
    s0 = round(t0 * SR)
    for i in range(round(0.9 * SR)):
        t = i / SR
        bass[s0 + i] += 0.4 * min(1, t / 0.005) * np.exp(-t / 0.6) * np.sin(2 * np.pi * f * t)
rnd = mulberry32(99)
for t0 in HATS:
    s0 = round(t0 * SR)
    prev = 0.0
    for i in range(round(0.02 * SR)):
        w = rnd() * 2 - 1
        drums[s0 + i] += 0.2 * np.exp(-i / SR / 0.006) * (w - prev)
        prev = w
# as the worker holds them: float32 samples (the detector computes in float64)
drums = drums.astype(np.float32).astype(np.float64)
bass = bass.astype(np.float32).astype(np.float64)

tk, fk, ek = band_flux(drums, 40, 150, 1024, 128)
kicks, kick_db = pick(tk, fk, ek, min_gap_s=0.09, delta_rel=0.25, floor_db=-24)
th, fh, eh = band_flux(drums, 150, 16000, 1024, 128)
hits, hit_db = pick(th, fh, eh, min_gap_s=0.06, delta_rel=0.25, floor_db=-30)
near = np.array([np.any(np.abs(kicks - x) <= 0.03) for x in hits], dtype=bool)
tb, fb, eb = band_flux(bass, 30, 300, 4096, 256, lag=2)
bassn, bass_db = pick(tb, fb, eb, min_gap_s=0.08, delta_rel=0.3, floor_db=-30)

pairs = lambda t, d: [[round(float(a), 6), round(float(b), 3)] for a, b in zip(t, d)]
out = {
    'note': 'stem-events-fixture.py: [time s, energy dB as metrics.py] per event',
    'kick': pairs(kicks, kick_db),
    'snare': pairs(hits[~near], hit_db[~near]),
    'bassNote': pairs(bassn, bass_db),
}
Path(__file__).with_suffix('.json').write_text('{\n' + ',\n'.join(f' {json.dumps(k)}: {json.dumps(v)}' for k, v in out.items()) + '\n}\n')
print({k: len(v) for k, v in out.items() if k != 'note'})
