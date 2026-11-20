/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { type Issue, issue, type RepresentationHint } from '@molstar/meso-spec/format';
import type { IRBand, IRView } from '@molstar/meso-spec/ir';

// A view's bands as Prism draws them (lane `mvs-lod-bands`, _spec/bands.md "In prism-me"). Prism switches per copy on
// the GPU between a structure's sphere levels and its silhouette (prism-me's impostors: `lodImpostor`, by size on screen
// or by distance, one threshold, a 0.5-octave dithered blend); that is the one per-copy switch it has, set per list.
// So per list: the rules that hold (a scene band held, or a copy band), each type's hint per copy band, and from them
// silhouettes on at a bound, or off. A list no rule targets is left as the person had it.

/** What a list's representation is given: its silhouettes' params (`structure.lodImpostor*`). */
export type ImpostorPatch =
  | { readonly lodImpostor: false }
  | { readonly lodImpostor: true; readonly lodImpostorBy: 'size'; readonly lodImpostorPixels: number }
  | { readonly lodImpostor: true; readonly lodImpostorBy: 'distance'; readonly lodImpostorDistance: number };

export interface BandPlan {
  /** By set key: the lists whose silhouettes the bands decide. */
  readonly lists: Map<string, ImpostorPatch>;
  readonly issues: Issue[];
}

/** prism-me's silhouettes: the blend's width (`LodImpostorBand`) and the size threshold's range (`lodImpostorPixels`). */
export const PrismBlendOctaves = 0.5;
const PixelsMin = 4;
const PixelsMax = 64;

/** Silhouettes at every distance: beyond this (Å); 0 is prism-me's automatic distance, not "everywhere" (gate 3). */
export const EverywhereDistance = 1e-3;

/** What a rule says a structure type is drawn as, and whether the chain had to fall back to say it. */
function drawable(chain: readonly RepresentationHint[] | undefined): { hint: RepresentationHint; fell: boolean } {
  const hint = chain?.find((h) => h === 'structure' || h === 'silhouette' || h === 'spheres');
  // a chain of nothing Prism draws on a structure type (surface): its structure, said
  return hint ? { hint, fell: false } : { hint: 'structure', fell: !!chain?.length };
}

interface Layer {
  readonly band: IRBand;
  readonly hint: RepresentationHint;
}

interface TypeHints {
  /** What a rule holding everywhere (a scene band) says. */
  base?: RepresentationHint;
  /** What rules on copy bands say, in rule order (later wins). */
  layers: Layer[];
  /** A rule's chain fell back to structure (surface asked). */
  fell: boolean;
}

/**
 * The silhouettes of each list the view's rules target, from its bands, the scene bands that hold now (`held`) and the
 * types drawn from structures (`structureTypes`: a sphere type has no silhouette and decides nothing). A list the rules
 * that hold do not target is not in the plan (the adapter puts back what it had).
 */
export function bandPlan(
  view: IRView,
  held: ReadonlySet<string>,
  structureTypes: (set: string) => ReadonlySet<number>,
): BandPlan {
  const lists = new Map<string, ImpostorPatch>();
  const issues: Issue[] = [];
  if (!view.scales?.length) return { lists, issues };
  const bands = new Map((view.bands ?? []).map((b) => [b.id, b]));
  // each structure type's hints, the rules in order (later wins)
  const types = new Map<string, Map<number, TypeHints>>();
  for (const rule of view.scales) {
    const { hint, fell } = drawable(rule.representation);
    if (!rule.representation?.length) continue;
    const everywhere = rule.at.some((id) => bands.get(id)?.tier === 'scene' && held.has(id));
    const copy = rule.at.map((id) => bands.get(id)).filter((b): b is IRBand => b?.tier === 'copy' && !!b.range);
    if (!everywhere && !copy.length) continue;
    for (const t of rule.targets) {
      const withStructure = structureTypes(t.set);
      for (const type of t.types) {
        if (!withStructure.has(type)) continue;
        let bySet = types.get(t.set);
        if (!bySet) types.set(t.set, (bySet = new Map()));
        let h = bySet.get(type);
        if (!h) bySet.set(type, (h = { layers: [], fell: false }));
        h.fell ||= fell;
        if (everywhere) {
          h.base = hint;
          h.layers = [];
        } else for (const band of copy) h.layers.push({ band, hint });
      }
    }
  }
  for (const [set, bySet] of types) {
    let chosen: ImpostorPatch | undefined;
    let differs = false;
    for (const type of [...bySet.keys()].sort((a, b) => a - b)) {
      const p = typePatch(set, bySet.get(type)!, view.bands ?? [], issues, chosen === undefined);
      if (!p) continue;
      if (!chosen) chosen = p;
      else if (JSON.stringify(p) !== JSON.stringify(chosen)) differs = true;
    }
    if (!chosen) continue;
    lists.set(set, chosen);
    if (differs)
      issues.push(
        issue(
          'representation.fallback',
          'info',
          'render',
          `${set}: its types ask for different far drawings; Prism sets silhouettes per list, drawn as the first type's`,
        ),
      );
  }
  return { lists, issues };
}

interface Segment {
  lo: number;
  hi: number;
  hint: RepresentationHint;
}

/** `hint` painted over [lo, hi) of `segments` (later paint wins). */
function paint(segments: Segment[], lo: number, hi: number, hint: RepresentationHint): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    if (s.hi <= lo || s.lo >= hi) out.push(s);
    else {
      if (s.lo < lo) out.push({ lo: s.lo, hi: lo, hint: s.hint });
      if (s.hi > hi) out.push({ lo: hi, hi: s.hi, hint: s.hint });
    }
  }
  out.push({ lo, hi, hint });
  return out.sort((a, b) => a.lo - b.lo);
}

/** One type's silhouettes; `say`: its issues are said (the type the list is drawn as). */
function typePatch(
  set: string,
  h: TypeHints,
  all: readonly IRBand[],
  issues: Issue[],
  say: boolean,
): ImpostorPatch | undefined {
  const tell = (code: string, message: string) => {
    if (say) issues.push(issue(code, 'info', 'render', `${set}: ${message}`));
  };
  if (h.fell)
    tell(
      'representation.fallback',
      'a rule asks for no drawing Prism has for a structure (surface): drawn as structures',
    );
  if (!h.base && !h.layers.length) return undefined;
  const evaluators = new Set(h.layers.map((l) => l.band.evaluator));
  if (evaluators.size > 1 || h.layers.some((l) => l.band.params)) {
    tell('representation.fallback', 'rules on bands of two measures: Prism switches by one, drawn as structures');
    return { lodImpostor: false };
  }
  const evaluator = h.layers[0]?.band.evaluator;
  // the measure's line, painted: everywhere what a held scene rule says, then each copy rule over its band
  let segments: Segment[] = h.base ? [{ lo: 0, hi: Number.POSITIVE_INFINITY, hint: h.base }] : [];
  for (const l of h.layers)
    segments = paint(segments, l.band.range![0], l.band.range![1] ?? Number.POSITIVE_INFINITY, l.hint);
  if (segments.some((s) => s.hint === 'spheres'))
    tell('representation.fallback', 'spheres asked for a structure: Prism draws its structure (atoms) there');
  // the silhouettes: one interval
  const sil = segments.filter((s) => s.hint === 'silhouette');
  if (!sil.length) return { lodImpostor: false };
  const lo = sil[0].lo;
  const hi = sil[sil.length - 1].hi;
  const contiguous = sil.every((s, k) => k === 0 || sil[k - 1].hi === s.lo);
  if (contiguous && lo === 0 && hi === Number.POSITIVE_INFINITY)
    return { lodImpostor: true, lodImpostorBy: 'distance', lodImpostorDistance: EverywhereDistance };
  // Prism's one switch: silhouettes below a size, or beyond a distance
  const ok =
    contiguous &&
    ((evaluator === 'meso.size' && lo === 0) || (evaluator === 'meso.distance' && hi === Number.POSITIVE_INFINITY));
  if (!ok) {
    tell(
      'representation.fallback',
      'silhouettes asked in a band Prism cannot draw them in (only below a size or beyond a distance): drawn as structures',
    );
    return { lodImpostor: false };
  }
  // the blend at the switch: the band of the measure whose upper bound it is
  const bound = evaluator === 'meso.size' ? hi : lo;
  const blender = all.find((b) => b.evaluator === evaluator && !b.params && b.range?.[1] === bound);
  const width = blender?.blend?.width;
  if (width !== PrismBlendOctaves || blender?.blend?.by === 'fade')
    tell(
      'bands.blend',
      `the hand-over at ${bound} ${evaluator === 'meso.size' ? 'px' : 'Å'} is drawn as Prism's ${PrismBlendOctaves} octave dither (asked: ${width === undefined ? 'a switch' : `${width} octave${blender?.blend?.by === 'fade' ? ' fade' : ''}`})`,
    );
  if (evaluator === 'meso.distance') {
    return { lodImpostor: true, lodImpostorBy: 'distance', lodImpostorDistance: lo > 0 ? lo : EverywhereDistance };
  }
  const pixels = Math.min(PixelsMax, Math.max(PixelsMin, hi));
  if (pixels !== hi)
    tell(
      'representation.fallback',
      `silhouettes below ${hi} px: drawn below ${pixels} px (Prism's ${PixelsMin}-${PixelsMax})`,
    );
  return { lodImpostor: true, lodImpostorBy: 'size', lodImpostorPixels: pixels };
}
