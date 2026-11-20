/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { bandEvaluatorSpec, bandShape, type MesoViewSpecDoc, type View, viewBands } from '@molstar/meso-spec/format';
import type { IRBand, IRShape } from '@molstar/meso-spec/ir';

// The band evaluators (_spec/bands.md, proposed v0.6): pure functions of what a viewer knows at a moment (the camera,
// the viewport in CSS pixels, the view shown, the compartments' shapes) and, for a copy measure, of one copy's centre and
// radius. Nothing is allocated per copy: a renderer may call `measureCopy` for every copy, or do the same on the GPU.

export interface BandCamera {
  /** Å, world frame. */
  readonly eye: ArrayLike<number>;
  readonly target: ArrayLike<number>;
  readonly up?: ArrayLike<number>;
  /** The vertical field of view, radians. */
  readonly fov: number;
  /** An orthographic camera: the height of the view in Å. */
  readonly orthographic?: { readonly height: number };
}

export interface BandInput {
  readonly camera: BandCamera;
  /** CSS pixels (device pixels over the pixel ratio). */
  readonly viewport: { readonly width: number; readonly height: number };
  /** The id of the view shown. */
  readonly view?: string;
  /** The compartments' shapes by id (the IR's `compartment` nodes). */
  readonly compartments?: ReadonlyMap<string, IRShape>;
}

function eyeDistance(eye: ArrayLike<number>, c: ArrayLike<number>) {
  return Math.hypot(c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]);
}

/**
 * A copy measure for one copy (centre in Å, world frame; bounding radius in Å): `meso.size`, its diameter projected in
 * CSS pixels; `meso.distance`, the eye's distance to its centre. Undefined for an evaluator that is not a copy measure.
 */
export function measureCopy(
  evaluator: string,
  input: BandInput,
  center: ArrayLike<number>,
  radius: number,
): number | undefined {
  const spec = bandEvaluatorSpec(evaluator);
  if (!spec || spec.kind !== 'measure' || spec.tier !== 'copy') return undefined;
  const { camera, viewport } = input;
  if (spec.id === 'meso.distance') return eyeDistance(camera.eye, center);
  // meso.size: what the copy covers of the viewport's height
  if (camera.orthographic) return (2 * radius * viewport.height) / camera.orthographic.height;
  const d = eyeDistance(camera.eye, center);
  if (d <= 0) return Number.POSITIVE_INFINITY;
  return (2 * radius * viewport.height) / (2 * d * Math.tan(camera.fov / 2));
}

/** Whether the eye is inside a shape; undefined where the shape cannot tell (a mesh, an implicit one). */
function eyeInside(eye: ArrayLike<number>, s: IRShape): boolean | undefined {
  switch (s.kind) {
    case 'sphere':
      return eyeDistance(eye, s.center) < s.radius;
    case 'ellipsoid': {
      let q = 0;
      for (let k = 0; k < 3; k++) q += ((eye[k] - s.center[k]) / s.radii[k]) ** 2;
      return q < 1;
    }
    case 'box':
      for (let k = 0; k < 3; k++) if (!(Math.abs(eye[k] - s.center[k]) < s.size[k] / 2)) return false;
      return true;
    default:
      return undefined;
  }
}

/** A scene test's value now; undefined where it cannot tell (the band does not hold). */
export function sceneTest(band: IRBand, input: BandInput): boolean | undefined {
  if (band.tier !== 'scene' || band.kind !== 'test') return undefined;
  switch (band.evaluator) {
    case 'meso.eye-inside': {
      const s = input.compartments?.get(band.params?.compartment as string);
      return s ? eyeInside(input.camera.eye, s) : undefined;
    }
    case 'meso.view':
      return input.view !== undefined && input.view === band.params?.view;
    default:
      return undefined;
  }
}

/** Whether a band holds for a value of its evaluator: a measure over `[lo, hi)` (`null`: no bound), a test while true. */
export function bandHolds(band: IRBand, value: number | boolean | undefined): boolean {
  if (band.kind === 'test') return value === true;
  if (typeof value !== 'number' || !band.range) return false;
  const [lo, hi] = band.range;
  return value >= lo && (hi === null || value < hi);
}

/**
 * The document's bands as `view` resolves them (its overrides over the document's), with their evaluators' kind and
 * tier; a band whose evaluator this runtime lacks is left out (it never holds). Undefined without bands.
 */
export function irBands(doc: MesoViewSpecDoc, view: View | undefined): IRBand[] | undefined {
  if (!doc.bands?.length) return undefined;
  const out: IRBand[] = [];
  for (const b of viewBands(doc, view)) {
    const { evaluator, range } = bandShape(b);
    const spec = bandEvaluatorSpec(evaluator);
    if (!spec) continue;
    out.push({
      id: b.id,
      evaluator: spec.id,
      version: spec.version,
      kind: spec.kind,
      tier: spec.tier,
      ...(b.params && Object.keys(b.params).length ? { params: b.params } : {}),
      ...(spec.kind === 'measure' && range ? { range: [range[0], range[1]] as const } : {}),
      ...(b.blend && spec.kind === 'measure' ? { blend: { width: b.blend.width, by: b.blend.by ?? 'dither' } } : {}),
    });
  }
  return out;
}

/** The scene bands that hold now (the copy bands are each copy's, not here). */
export function sceneBandsHolding(bands: readonly IRBand[], input: BandInput): Set<string> {
  const out = new Set<string>();
  for (const b of bands) if (b.tier === 'scene' && bandHolds(b, sceneTest(b, input))) out.add(b.id);
  return out;
}
