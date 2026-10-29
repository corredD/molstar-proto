/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { type ObservableState, observableState } from '@molstar/prism-ui';

// The proposed clips' book (Explorer/Proposed; Ludo, 2026-10-28): clips are objects of their own, under the tree's Clips
// category, and a clip cuts the objects and parts it is given, each its own way: cellVIEW's cut × ingredient table
// (_spec/cellview.md §4), edited from either side (a clip's What it cuts, a node's Clips). One book a story, shared by its
// frames. Mock state only: no viewer.

/** A clip's shape; the aperture opens the view onto the parts it is given (cellVIEW's visibility equalizer) */
export type ClipShape = 'plane' | 'sphere' | 'box' | 'aperture';

/** What a clip does to a node: a plane, sphere or box cuts it, keeps a layer of it, or cuts it wider; an aperture opens onto it */
export type CutBias = 'keep' | 'cut' | 'wider' | 'focus';

export interface MockClip {
  readonly key: string;
  readonly label: string;
  readonly shape: ClipShape;
}

/** A clip used on a node, and how */
export interface ClipUse {
  readonly clip: string;
  readonly node: string;
  /** The node's name, as the clip's list shows it */
  readonly nodeLabel: string;
  readonly bias: ObservableState<CutBias>;
  readonly band: ObservableState<number>;
  readonly fuzziness: ObservableState<number>;
}

export const ShapeNames: Record<ClipShape, string> = {
  plane: 'Plane clip',
  sphere: 'Sphere clip',
  box: 'Box clip',
  aperture: 'Aperture cut',
};

/** The nodes a clip can be given in the mock: the objects, and the HIV model's compartments */
export const ClipTargets: readonly (readonly [string, string])[] = [
  ['o:1crn', '1CRN'],
  ['o:hiv', 'HIV-1 virion (whole)'],
  ['g:hiv:envelope.membrane', 'envelope › membrane'],
  ['g:hiv:envelope.surface', 'envelope › surface'],
  ['g:hiv:capsid.interior', 'capsid › interior'],
  ['g:hiv:capsid.surface', 'capsid › surface'],
  ['g:hiv:cytoplasm', 'cytoplasm'],
  ['o:star', 'run_data.star'],
  ['o:tomo', 'tomogram.mrc'],
  ['o:mesh', 'membrane.obj'],
];
const TargetNames = new Map(ClipTargets);

export class ClipBook {
  readonly clips: ObservableState<readonly MockClip[]>;
  readonly uses: ObservableState<readonly ClipUse[]>;
  private next = 1;

  constructor() {
    this.clips = observableState<readonly MockClip[]>([]);
    this.uses = observableState<readonly ClipUse[]>([]);
    const plane = this.add('plane');
    this.use(plane, 'g:hiv:envelope.membrane', 'keep', 60, 0.3);
    this.use(plane, 'g:hiv:envelope.surface', 'cut');
    this.use(plane, 'g:hiv:capsid.interior', 'wider', 80, 0.6);
    this.use(plane, 'g:hiv:cytoplasm', 'cut');
    const sphere = this.add('sphere');
    this.use(sphere, 'o:tomo', 'cut');
    const aperture = this.add('aperture');
    this.use(aperture, 'g:hiv:capsid.interior', 'focus');
    this.use(aperture, 'g:hiv:capsid.surface', 'focus');
  }

  clip(key: string): MockClip | undefined {
    return this.clips.value.find((c) => c.key === key);
  }

  /** A new clip of `shape`; with `node`, it cuts (or, an aperture, opens onto) that node */
  add(shape: ClipShape, node?: string): string {
    const key = `k:${this.next++}`;
    const same = this.clips.value.filter((c) => c.shape === shape).length;
    const label = same ? `${ShapeNames[shape]} ${same + 1}` : ShapeNames[shape];
    this.clips.set([...this.clips.value, { key, label, shape }]);
    if (node) this.use(key, node, shape === 'aperture' ? 'focus' : 'cut');
    return key;
  }

  /** `clip` used on `node` (once: a second use of the same pair is ignored) */
  use(clip: string, node: string, bias: CutBias, band = 60, fuzziness = 0) {
    if (this.uses.value.some((u) => u.clip === clip && u.node === node)) return;
    const use: ClipUse = {
      clip,
      node,
      nodeLabel: TargetNames.get(node) ?? node,
      bias: observableState(bias),
      band: observableState(band),
      fuzziness: observableState(fuzziness),
    };
    this.uses.set([...this.uses.value, use]);
  }

  /** `node` no longer affected by `clip` */
  drop(use: ClipUse) {
    this.uses.set(this.uses.value.filter((u) => u !== use));
  }

  /** How many nodes a clip affects (its row's count) */
  countOf(clip: string): string {
    const n = this.uses.value.filter((u) => u.clip === clip).length;
    return n === 1 ? '1 object' : `${n} objects`;
  }
}

/** The current story's book: made again by `fullScene(…, true)` */
export let clipBook = new ClipBook();
export function newClipBook(): ClipBook {
  clipBook = new ClipBook();
  return clipBook;
}
