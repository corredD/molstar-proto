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

/** The first hint of a chain a structure type can be drawn as here; surface cannot. */
function drawable(chain: readonly RepresentationHint[] | undefined): RepresentationHint | undefined {
  return chain?.find((h) => h === 'structure' || h === 'silhouette' || h === 'spheres');
}

interface TypeHints {
  /** What a rule holding everywhere (a scene band) says. */
  base?: RepresentationHint;
  /** What rules on copy bands say, by band. */
  readonly byBand: Map<string, RepresentationHint>;
}

/**
 * The silhouettes of each list the view's rules target, from its bands, the scene bands that hold now (`held`) and the
 * types drawn from structures (`structureTypes`: a sphere type has no silhouette and decides nothing).
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
    const hint = drawable(rule.representation);
    if (!hint) continue;
    const everywhere = rule.at.some((id) => bands.get(id)?.tier === 'scene' && held.has(id));
    const copy = rule.at.filter((id) => bands.get(id)?.tier === 'copy');
    if (!everywhere && !copy.length) continue;
    for (const t of rule.targets) {
      const withStructure = structureTypes(t.set);
      for (const type of t.types) {
        if (!withStructure.has(type)) continue;
        let bySet = types.get(t.set);
        if (!bySet) types.set(t.set, (bySet = new Map()));
        let h = bySet.get(type);
        if (!h) bySet.set(type, (h = { byBand: new Map() }));
        if (everywhere) {
          h.base = hint;
          h.byBand.clear();
        } else for (const b of copy) h.byBand.set(b, hint);
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
  const named = [...h.byBand.keys()].map((id) => all.find((b) => b.id === id)!).filter((b) => b);
  // the copy bands in play: those rules name, and with a base, the others of their evaluator
  const evaluators = new Set(named.map((b) => b.evaluator));
  const inPlay = h.base ? all.filter((b) => b.tier === 'copy' && evaluators.has(b.evaluator)) : named;
  const hintOf = (b: IRBand) => h.byBand.get(b.id) ?? h.base;
  const silhouettes = inPlay.filter((b) => hintOf(b) === 'silhouette');
  if (!silhouettes.length) {
    if (h.base === 'silhouette') {
      tell('representation.fallback', `silhouettes at every size: drawn below ${PixelsMax} px`);
      return { lodImpostor: true, lodImpostorBy: 'size', lodImpostorPixels: PixelsMax };
    }
    return h.base || named.length ? { lodImpostor: false } : undefined;
  }
  const evaluator = silhouettes[0].evaluator;
  const sorted = [...silhouettes].sort((a, b) => a.range![0] - b.range![0]);
  const lo = sorted[0].range![0];
  const hi = sorted[sorted.length - 1].range![1];
  const contiguous =
    silhouettes.every((b) => b.evaluator === evaluator && !b.params && b.range) &&
    sorted.every((b, k) => k === 0 || sorted[k - 1].range![1] === b.range![0]);
  // Prism's one switch: silhouettes below a size, or beyond a distance
  const drawable =
    contiguous && ((evaluator === 'meso.size' && lo === 0) || (evaluator === 'meso.distance' && hi === null));
  if (!drawable) {
    tell(
      'representation.fallback',
      'silhouettes asked in a band Prism cannot draw them in (only below a size or beyond a distance): drawn as structures',
    );
    return { lodImpostor: false };
  }
  // the blend at the switch: the silhouettes' upper bound by size; by distance, the band ending where they start
  const bound = evaluator === 'meso.size' ? hi : lo;
  const blender =
    evaluator === 'meso.size'
      ? sorted[sorted.length - 1]
      : all.find((b) => b.evaluator === evaluator && !b.params && b.range?.[1] === lo);
  const width = blender?.blend?.width;
  if (bound !== null && width !== PrismBlendOctaves)
    tell(
      'bands.blend',
      `the hand-over at ${bound} ${evaluator === 'meso.size' ? 'px' : 'Å'} is drawn as Prism's ${PrismBlendOctaves} octave dither (asked: ${width === undefined ? 'a switch' : `${width} octave`})`,
    );
  if (evaluator === 'meso.distance') return { lodImpostor: true, lodImpostorBy: 'distance', lodImpostorDistance: lo };
  const pixels = hi === null ? PixelsMax : Math.min(PixelsMax, Math.max(PixelsMin, hi));
  if (hi === null || pixels !== hi)
    tell(
      'representation.fallback',
      `silhouettes below ${hi ?? 'any'} px: drawn below ${pixels} px (Prism's ${PixelsMin}-${PixelsMax})`,
    );
  return { lodImpostor: true, lodImpostorBy: 'size', lodImpostorPixels: pixels };
}
