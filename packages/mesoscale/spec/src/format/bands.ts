/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Band, BandOverride, BandRange, MesoViewSpecDoc, View } from './doc.js';

// The band evaluators' registry (_spec/bands.md, proposed v0.6): what a document may name and the validator checks. A
// band names an evaluator by id, never code; the runtime evaluates it (runtime/bands.ts). Each declares its kind (a
// measure gives a number a band's range holds over; a test gives true or false) and its tier (`copy`: measured per copy,
// on the GPU where the renderer can switch per copy; `scene`: one value, on the camera's rest).

/** What a param of an evaluator names: a document node of a kind. */
export type BandParamKind = 'compartment' | 'view';

export interface BandEvaluatorSpec {
  readonly id: string;
  readonly version: number;
  readonly kind: 'measure' | 'test';
  readonly tier: 'copy' | 'scene';
  /** Its params by name: the kind of node each names (all required). */
  readonly params: Readonly<Record<string, BandParamKind>>;
  readonly description: string;
}

export const BandEvaluatorSpecs: readonly BandEvaluatorSpec[] = [
  {
    id: 'meso.size',
    version: 1,
    kind: 'measure',
    tier: 'copy',
    params: {},
    description: "The copy's bounding sphere projected: its diameter in CSS pixels",
  },
  {
    id: 'meso.distance',
    version: 1,
    kind: 'measure',
    tier: 'copy',
    params: {},
    description: "The eye's distance to the copy's centre, Å",
  },
  {
    id: 'meso.eye-inside',
    version: 1,
    kind: 'test',
    tier: 'scene',
    params: { compartment: 'compartment' },
    description: "The eye is inside the compartment's geometry (a sphere, an ellipsoid or a box)",
  },
  {
    id: 'meso.view',
    version: 1,
    kind: 'test',
    tier: 'scene',
    params: { view: 'view' },
    description: 'The view shown is this one',
  },
];

/** An evaluator by id (`meso.size`, or `meso.size@1` for a version); undefined when this viewer does not have it. */
export function bandEvaluatorSpec(id: string): BandEvaluatorSpec | undefined {
  if (typeof id !== 'string') return undefined;
  const at = id.lastIndexOf('@');
  const name = at < 0 ? id : id.slice(0, at);
  const version = at < 0 ? undefined : Number(id.slice(at + 1));
  const spec = BandEvaluatorSpecs.find((s) => s.id === name);
  if (!spec || (version !== undefined && version !== spec.version)) return undefined;
  return spec;
}

/** A band's evaluator id and range, the `size` shorthand read. */
export function bandShape(b: Pick<Band, 'evaluator' | 'range' | 'size'>): {
  readonly evaluator: string;
  readonly range?: BandRange;
} {
  if (b.size !== undefined && b.evaluator === undefined) return { evaluator: 'meso.size', range: b.size };
  return { evaluator: b.evaluator ?? 'meso.size', ...(b.range !== undefined ? { range: b.range } : {}) };
}

/** The document's bands as `view` re-thresholds them: same ids and evaluators, its range, params and blend. */
export function viewBands(doc: MesoViewSpecDoc, view: View | undefined): Band[] {
  const overrides = new Map<string, BandOverride>((view?.bands ?? []).map((o) => [o.id, o]));
  return (doc.bands ?? []).map((b) => {
    const o = overrides.get(b.id);
    if (!o) return b;
    const { evaluator } = bandShape(b);
    const range = o.range ?? o.size;
    return {
      id: b.id,
      evaluator,
      ...((o.params ?? b.params) ? { params: o.params ?? b.params } : {}),
      ...(range !== undefined ? { range } : bandShape(b).range !== undefined ? { range: bandShape(b).range } : {}),
      ...((o.blend ?? b.blend) ? { blend: o.blend ?? b.blend } : {}),
    };
  });
}

/** The family a band of a measure belongs to: its evaluator and params (bands of one family may not overlap). */
export function bandFamily(evaluator: string, params: Readonly<Record<string, unknown>> | undefined): string {
  const spec = bandEvaluatorSpec(evaluator);
  const keys = Object.keys(params ?? {}).sort();
  return `${spec?.id ?? evaluator}(${keys.map((k) => `${k}=${JSON.stringify(params![k])}`).join(',')})`;
}
