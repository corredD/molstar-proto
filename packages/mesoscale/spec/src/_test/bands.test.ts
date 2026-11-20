/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { exosomeDoc, ExosomeResources } from '../examples/index.js';
import type { Band, MesoViewSpecDoc, ScaleRule } from '../format/doc.js';
import { validate } from '../format/validate.js';
import { bandEvaluatorSpec } from '../format/bands.js';
import { DefaultResolvers } from '../resolvers/index.js';
import { compile, updateView } from '../runtime/runtime.js';
import { bandHolds, type BandInput, measureCopy, sceneBandsHolding } from '../runtime/bands.js';
import type { IRBand } from '../ir/ir.js';

// Bands by evaluators (_spec/bands.md, proposed v0.6, lane `mvs-lod-bands`): a band names an evaluator from a registry
// (a measure with a range, or a test), checked statically; the view carries its bands as it resolves them and the scale
// rules materialized onto types; the evaluators are pure functions of the camera and the scene.

const Bands: Band[] = [
  { id: 'b.near', evaluator: 'meso.size', range: [40, null] },
  { id: 'b.mid', evaluator: 'meso.size', range: [12, 40] },
  { id: 'b.far', size: [0, 12], blend: { width: 0.5, by: 'dither' } },
  { id: 'b.in-exosome', evaluator: 'meso.eye-inside', params: { compartment: 'c.exosome' } },
];
const Scales: ScaleRule[] = [
  { id: 's.atoms', select: '(entity e.catalase)', at: ['b.near', 'b.mid'], show: { representation: 'structure' } },
  { id: 's.shape', select: '(entity e.catalase)', at: 'b.far', show: { representation: ['silhouette', 'spheres'] } },
];

function banded(edit: (d: MesoViewSpecDoc) => Partial<MesoViewSpecDoc> = () => ({})): MesoViewSpecDoc {
  const d = exosomeDoc();
  const base: MesoViewSpecDoc = {
    ...d,
    bands: Bands,
    scales: Scales,
    views: d.views!.map((v) => (v.id === 'v.lumen' ? { ...v, bands: [{ id: 'b.far', range: [0, 6] }] } : v)),
  };
  return { ...base, ...edit(base) };
}

const codes = (doc: MesoViewSpecDoc) =>
  validate(doc)
    .filter((i) => /^(bands|scales)\./.test(i.code) || i.path?.match(/^\/(bands|scales)|\/bands\//))
    .map((i) => `${i.code} ${i.severity} ${i.path}`);

describe('bands: the document', () => {
  it('a document with bands and scale rules validates; `size` is shorthand for meso.size', () => {
    expect(codes(banded())).toEqual([]);
  });

  it('the registry: ids with or without a version, kind and tier', () => {
    expect(bandEvaluatorSpec('meso.size')).toMatchObject({ kind: 'measure', tier: 'copy', version: 1 });
    expect(bandEvaluatorSpec('meso.size@1')).toMatchObject({ id: 'meso.size' });
    expect(bandEvaluatorSpec('meso.size@2')).toBeUndefined();
    expect(bandEvaluatorSpec('meso.distance')).toMatchObject({ kind: 'measure', tier: 'copy' });
    expect(bandEvaluatorSpec('meso.eye-inside')).toMatchObject({ kind: 'test', tier: 'scene' });
    expect(bandEvaluatorSpec('meso.view')).toMatchObject({ kind: 'test', tier: 'scene' });
  });

  it('bands.shape: a measure without a range, a test with one, size beside an evaluator, a blend on a test', () => {
    const doc = banded(() => ({
      bands: [
        { id: 'b.a', evaluator: 'meso.distance' },
        { id: 'b.b', evaluator: 'meso.view', params: { view: 'v.overview' }, range: [0, 1] },
        { id: 'b.c', evaluator: 'meso.distance', size: [0, 10], range: [0, 10] },
        { id: 'b.d', evaluator: 'meso.view', params: { view: 'v.lumen' }, blend: { width: 0.5 } },
        { id: 'b.e', size: [10, 5] },
      ],
      scales: [],
      views: exosomeDoc().views,
    }));
    expect(codes(doc)).toEqual([
      'bands.shape error /bands/0/range',
      'bands.shape error /bands/1/range',
      'bands.shape error /bands/2/size',
      'bands.shape error /bands/3/blend',
      'bands.shape error /bands/4/size',
    ]);
  });

  it('bands.overlap: ranges of one family, blends of one family', () => {
    const doc = banded(() => ({
      bands: [
        { id: 'b.a', size: [0, 12] },
        { id: 'b.b', size: [10, 40] },
        { id: 'b.c', evaluator: 'meso.distance', range: [0, 100], blend: { width: 2 } },
        { id: 'b.d', evaluator: 'meso.distance', range: [100, 150], blend: { width: 2 } },
        { id: 'b.e', evaluator: 'meso.distance', range: [150, null] },
      ],
      scales: [],
      views: exosomeDoc().views,
    }));
    expect(codes(doc)).toEqual(['bands.overlap error /bands/1/size', 'bands.overlap error /bands/3/blend']);
  });

  it('bands.evaluator: one the viewer lacks is a warning; params checked against the evaluator', () => {
    const doc = banded(() => ({
      bands: [
        { id: 'b.a', evaluator: 'lab.crowding', range: [0, 1] },
        { id: 'b.b', evaluator: 'meso.eye-inside' },
        { id: 'b.c', evaluator: 'meso.eye-inside', params: { compartment: 'p.lipids' } },
        { id: 'b.d', evaluator: 'meso.size', params: { radius: 3 }, range: [0, 1] },
      ],
      scales: [],
      views: exosomeDoc().views,
    }));
    expect(codes(doc)).toEqual([
      'bands.evaluator warning /bands/0/evaluator',
      'bands.evaluator error /bands/1/params/compartment',
      'ref.kind error /bands/2/params/compartment',
      'bands.evaluator error /bands/3/params/radius',
    ]);
  });

  it("a view's bands: the same ids, no evaluator of their own; scale rules name bands that exist", () => {
    const doc = banded((b) => ({
      views: b.views!.map((v) =>
        v.id === 'v.overview' ? { ...v, bands: [{ id: 'b.nowhere', range: [0, 1] as [number, number] }] } : v,
      ),
      scales: [...Scales, { id: 's.x', select: '(entity e.catalase)', at: 'b.gone', show: { representation: 'cube' } }],
    }));
    expect(codes(doc)).toEqual([
      'bands.shape error /views/0/bands/0/id',
      'scales.shape error /scales/2/at',
      'value.range error /scales/2/show/representation',
    ]);
  });

  it('silhouette is a representation hint, on a look as on a rule', () => {
    const doc = banded((b) => ({
      views: b.views!.map((v) =>
        v.id === 'v.overview'
          ? {
              ...v,
              looks: [...(v.looks ?? []), { select: '(entity e.catalase)', representation: 'silhouette' as const }],
            }
          : v,
      ),
    }));
    expect(validate(doc).filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('bands: the evaluators', () => {
  const camera = { eye: [0, 0, 1000], target: [0, 0, 0], up: [0, 1, 0], fov: Math.PI / 4 };
  const input: BandInput = { camera, viewport: { width: 1200, height: 800 }, view: 'v.overview' };

  it('meso.size: the copy bounding sphere projected, its diameter in CSS pixels; orthographic by the view height', () => {
    // 2r / (2 d tan(fov/2)) of the viewport's height: 100 Å at 1000 Å with a 45° fov over 800 px
    const px = (2 * 50 * 800) / (2 * 1000 * Math.tan(Math.PI / 8));
    expect(measureCopy('meso.size', input, [0, 0, 0], 50)).toBeCloseTo(px, 6);
    // the eye's distance to the copy, not to the target
    expect(measureCopy('meso.size', input, [0, 0, 500], 50)).toBeCloseTo(px * 2, 6);
    const ortho = { ...input, camera: { ...camera, orthographic: { height: 400 } } };
    expect(measureCopy('meso.size', ortho, [0, 0, 500], 50)).toBeCloseTo((100 * 800) / 400, 6);
  });

  it('meso.distance: the eye to the copy centre, Å', () => {
    expect(measureCopy('meso.distance', input, [0, 300, 600], 50)).toBeCloseTo(500, 6);
    expect(measureCopy('meso.eye-inside', input, [0, 0, 0], 50)).toBeUndefined();
  });

  it('a measure band holds over [lo, hi), null no bound; a test band while true', () => {
    const b: IRBand = { id: 'b', evaluator: 'meso.size', version: 1, kind: 'measure', tier: 'copy', range: [12, 40] };
    expect([bandHolds(b, 11.9), bandHolds(b, 12), bandHolds(b, 39.9), bandHolds(b, 40)]).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect(bandHolds({ ...b, range: [40, null] }, 1e9)).toBe(true);
    const t: IRBand = { id: 't', evaluator: 'meso.view', version: 1, kind: 'test', tier: 'scene' };
    expect([bandHolds(t, true), bandHolds(t, false), bandHolds(t, undefined)]).toEqual([true, false, false]);
  });

  it('scene bands: the eye inside a sphere, an ellipsoid, a box; a mesh cannot tell; the view shown', () => {
    const scene = (eye: number[]): BandInput => ({
      ...input,
      camera: { ...camera, eye },
      compartments: new Map([
        ['c.ball', { kind: 'sphere', center: [0, 0, 0], radius: 100 }],
        ['c.egg', { kind: 'ellipsoid', center: [0, 0, 0], radii: [100, 50, 50] }],
        ['c.box', { kind: 'box', center: [0, 0, 0], size: [200, 200, 200] }],
        ['c.mesh', { kind: 'mesh', resource: 'r.m', vertexCount: 3, triangleCount: 1 }],
      ]),
    });
    const bands: IRBand[] = ['c.ball', 'c.egg', 'c.box', 'c.mesh'].map((c) => ({
      id: `in-${c}`,
      evaluator: 'meso.eye-inside',
      version: 1,
      kind: 'test',
      tier: 'scene',
      params: { compartment: c },
    }));
    bands.push({
      id: 'shown',
      evaluator: 'meso.view',
      version: 1,
      kind: 'test',
      tier: 'scene',
      params: { view: 'v.overview' },
    });
    bands.push({ id: 'copy', evaluator: 'meso.size', version: 1, kind: 'measure', tier: 'copy', range: [0, null] });
    expect([...sceneBandsHolding(bands, scene([90, 0, 0]))].sort()).toEqual([
      'in-c.ball',
      'in-c.box',
      'in-c.egg',
      'shown',
    ]);
    expect([...sceneBandsHolding(bands, scene([0, 90, 0]))].sort()).toEqual(['in-c.ball', 'in-c.box', 'shown']);
    expect([...sceneBandsHolding(bands, scene([0, 0, 150]))].sort()).toEqual(['shown']);
    expect([...sceneBandsHolding(bands, { ...scene([0, 0, 0]), view: 'v.lumen' })].sort()).toEqual([
      'in-c.ball',
      'in-c.box',
      'in-c.egg',
    ]);
  });
});

describe('bands: the view', () => {
  const options = () => ({
    resolvers: DefaultResolvers,
    load: (id: string) => ExosomeResources[id]?.(),
    cache: new Map() as Map<string, never>,
  });

  it("the view's bands as it resolves them, overrides applied; the rules materialized onto types", async () => {
    const doc = banded();
    const r = await compile(doc, options());
    const v = r.ir!.view;
    expect(v.bands?.map((b) => [b.id, b.evaluator, b.kind, b.tier, b.range ?? null, b.blend ?? null])).toEqual([
      ['b.near', 'meso.size', 'measure', 'copy', [40, null], null],
      ['b.mid', 'meso.size', 'measure', 'copy', [12, 40], null],
      ['b.far', 'meso.size', 'measure', 'copy', [0, 12], { width: 0.5, by: 'dither' }],
      ['b.in-exosome', 'meso.eye-inside', 'test', 'scene', null, null],
    ]);
    expect(v.scales?.map((s) => [s.id, s.at, s.representation])).toEqual([
      ['s.atoms', ['b.near', 'b.mid'], ['structure']],
      ['s.shape', ['b.far'], ['silhouette', 'spheres']],
    ]);
    const catalaseTypes = r.ir!.view.looks.length; // every (set, type) has a look; the rule names a subset
    expect(catalaseTypes).toBeGreaterThan(0);
    for (const s of v.scales!) {
      expect(s.targets.length).toBeGreaterThan(0);
      for (const t of s.targets) expect(t.types.length).toBeGreaterThan(0);
    }
    // v.lumen re-thresholds the far band (and keeps its blend)
    const lumen = updateView({ ...doc, session: { view: 'v.lumen' } }, r.ir!).view;
    expect(lumen.bands?.find((b) => b.id === 'b.far')).toMatchObject({ range: [0, 6], blend: { width: 0.5 } });
  });

  it('a document without bands: no bands, no scales in the view', async () => {
    const r = await compile(exosomeDoc(), options());
    expect(r.ir!.view.bands).toBeUndefined();
    expect(r.ir!.view.scales).toBeUndefined();
  });
});
