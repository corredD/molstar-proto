/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { IRBand, IRScale, IRView } from '@molstar/meso-spec/ir';
import { describe, expect, it } from 'vitest';
import { bandPlan } from '../band-plan.js';

// The bands of a view as Prism draws them (lane `mvs-lod-bands`, bands.md "In prism-me"): structure then silhouette at
// a size or distance bound is one list with prism-me's silhouettes on (`lodImpostor`, its `by`, the bound); structure
// alone is silhouettes off (the sphere levels alone); a list no rule targets is left as the person had it. Scene bands
// choose which rules hold; what Prism cannot draw as asked is said.

const size = (id: string, lo: number, hi: number | null, blend?: number): IRBand => ({
  id,
  evaluator: 'meso.size',
  version: 1,
  kind: 'measure',
  tier: 'copy',
  range: [lo, hi],
  ...(blend !== undefined ? { blend: { width: blend, by: 'dither' as const } } : {}),
});
const dist = (id: string, lo: number, hi: number | null, blend?: number): IRBand => ({
  ...size(id, lo, hi, blend),
  evaluator: 'meso.distance',
});
const inside: IRBand = {
  id: 'in',
  evaluator: 'meso.eye-inside',
  version: 1,
  kind: 'test',
  tier: 'scene',
  params: { compartment: 'c.cell' },
};
const rule = (id: string, at: string[], representation: IRScale['representation'], types = [0]): IRScale => ({
  id,
  at,
  representation,
  targets: [{ set: 'S', types }],
});
const view = (bands: IRBand[], scales: IRScale[]): IRView => ({ id: 'v', looks: [], bands, scales });
/** Set `S`: types 0 and 1 drawn from structures, type 2 a sphere */
const structures = (set: string) => (set === 'S' ? new Set([0, 1]) : new Set<number>());
const plan = (v: IRView, held = new Set<string>()) => bandPlan(v, held, structures);

describe('the band plan', () => {
  it('structure near, silhouette far by size: silhouettes on below the far band upper bound', () => {
    const p = plan(
      view(
        [size('near', 12, null), size('far', 0, 12, 0.5)],
        [rule('a', ['near'], ['structure']), rule('b', ['far'], ['silhouette', 'spheres'])],
      ),
    );
    expect(p.lists.get('S')).toEqual({ lodImpostor: true, lodImpostorBy: 'size', lodImpostorPixels: 12 });
    expect(p.issues).toEqual([]);
  });

  it('by distance: silhouettes beyond the far band lower bound; its blend is the band before', () => {
    const p = plan(
      view(
        [dist('near', 0, 5000, 0.5), dist('far', 5000, null)],
        [rule('a', ['near'], ['structure']), rule('b', ['far'], ['silhouette'])],
      ),
    );
    expect(p.lists.get('S')).toEqual({ lodImpostor: true, lodImpostorBy: 'distance', lodImpostorDistance: 5000 });
    expect(p.issues).toEqual([]);
  });

  it('structure at every band: silhouettes off, the sphere levels alone', () => {
    const p = plan(view([size('near', 12, null), size('far', 0, 12)], [rule('a', ['near', 'far'], ['structure'])]));
    expect(p.lists.get('S')).toEqual({ lodImpostor: false });
  });

  it('a list no rule targets is left as it is; a sphere type does not decide', () => {
    const v = view([size('far', 0, 12, 0.5)], [rule('b', ['far'], ['silhouette'], [2])]);
    expect(plan(v).lists.has('S')).toBe(false);
    expect(plan(view([], [])).lists.size).toBe(0);
  });

  it('a blend other than 0.5 octave, or none, is drawn at 0.5 and said', () => {
    const p = plan(
      view(
        [size('near', 12, null), size('far', 0, 12, 1)],
        [rule('a', ['near'], ['structure']), rule('b', ['far'], ['silhouette'])],
      ),
    );
    expect(p.lists.get('S')).toMatchObject({ lodImpostor: true, lodImpostorPixels: 12 });
    expect(p.issues.map((i) => [i.code, i.severity, i.phase])).toEqual([['bands.blend', 'info', 'render']]);
    const hard = plan(
      view(
        [size('near', 12, null), size('far', 0, 12)],
        [rule('a', ['near'], ['structure']), rule('b', ['far'], ['silhouette'])],
      ),
    );
    expect(hard.issues.map((i) => i.code)).toEqual(['bands.blend']);
    expect(hard.issues[0].message).toMatch(/0\.5 octave/);
  });

  it('a scene band chooses the rules: inside the cell, structure everywhere', () => {
    const v = view(
      [size('near', 12, null), size('far', 0, 12, 0.5), inside],
      [rule('a', ['near'], ['structure']), rule('b', ['far'], ['silhouette']), rule('c', ['in'], ['structure'])],
    );
    expect(plan(v).lists.get('S')).toMatchObject({ lodImpostor: true });
    expect(plan(v, new Set(['in'])).lists.get('S')).toEqual({ lodImpostor: false });
  });

  it('what Prism cannot draw as asked: silhouettes in a middle band, a size bound outside 4-64 px', () => {
    const middle = plan(
      view(
        [size('near', 40, null), size('mid', 12, 40), size('far', 0, 12)],
        [rule('a', ['near', 'far'], ['structure']), rule('b', ['mid'], ['silhouette'])],
      ),
    );
    expect(middle.lists.get('S')).toEqual({ lodImpostor: false });
    expect(middle.issues.map((i) => i.code)).toEqual(['representation.fallback']);
    const big = plan(
      view(
        [size('near', 100, null), size('far', 0, 100, 0.5)],
        [rule('a', ['near'], ['structure']), rule('b', ['far'], ['silhouette'])],
      ),
    );
    expect(big.lists.get('S')).toEqual({ lodImpostor: true, lodImpostorBy: 'size', lodImpostorPixels: 64 });
    expect(big.issues.map((i) => i.code)).toEqual(['representation.fallback']);
  });

  it('two types of one list asking for different far drawings: the first, said', () => {
    const p = plan(
      view(
        [size('near', 12, null), size('far', 0, 12, 0.5)],
        [
          rule('a', ['near'], ['structure'], [0, 1]),
          rule('b', ['far'], ['silhouette'], [0]),
          rule('c', ['far'], ['structure'], [1]),
        ],
      ),
    );
    expect(p.lists.get('S')).toMatchObject({ lodImpostor: true, lodImpostorPixels: 12 });
    expect(p.issues.map((i) => i.code)).toEqual(['representation.fallback']);
  });
});
