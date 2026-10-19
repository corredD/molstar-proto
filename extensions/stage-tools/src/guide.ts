/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Clip } from '@molstar/core/util/clip';
import { Color } from '@molstar/core/util/color';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { Mesh } from '@molstar/graphics/geo/geometry/mesh/mesh';
import * as ShapeUtils from '@molstar/graphics/geo/shape/shape';
import { ShapeRepresentation } from '@molstar/graphics/repr/shape/representation';
import type { PluginContext } from '@molstar/plugin/context';
import { clipGuideMesh, clipGuideRimMesh } from './cuts.js';

// The cuts' guides (apps/prism-me/_spec/features.md, "Stage tools"): the shape of every clip object of what the
// scene shows (a whole object's cut, an entity's), drawn translucent over the scene so a cut can be seen, picked and
// dragged. Visuals of the canvas, not of the state: they follow the cuts as the state changes, take no history step,
// and are not saved; one switch shows or hides them all.

/** What a guide stands for: the clip object `index` of the representations of `target` */
export interface CutGuideData {
  readonly kind: 'stage-tools-cut-guide';
  readonly target: string;
  readonly index: number;
  readonly object: Clip.Props['objects'][number];
  /** How far a plane's disk reaches: the target's radius */
  readonly reach: number;
}

export function isCutGuideData(x: unknown): x is CutGuideData {
  return !!x && (x as CutGuideData).kind === 'stage-tools-cut-guide';
}

/** The guides' quiet color */
export const CutGuideColor = Color(0x8fb8de);

/** How a guide's faces are drawn: faint, both sides, flat; not picked (what is faint is not picked by Mol*) */
export const CutGuideLook = {
  ...PD.getDefaultValues(Mesh.Params),
  alpha: 0.18,
  doubleSided: true,
  ignoreLight: true,
};

/** How a guide's rim is drawn: opaque, so it is seen and picked */
export const CutGuideRimLook = {
  ...PD.getDefaultValues(Mesh.Params),
  alpha: 1,
};

type GuideRepr = ShapeRepresentation<CutGuideData, Mesh, any>;

const keyOf = (d: Pick<CutGuideData, 'target' | 'index'>) => `${d.target}:${d.index}`;

/** The guides on a canvas, made, updated and removed as the cuts are */
export class CutGuides {
  private readonly visuals = new Map<string, { reprs: GuideRepr[]; json: string }>();
  private shown = true;

  constructor(private readonly plugin: PluginContext) {}

  get visible() {
    return this.shown;
  }

  /** Shows or hides every guide */
  setVisible(visible: boolean) {
    this.shown = visible;
    for (const { reprs } of this.visuals.values()) for (const repr of reprs) repr.setState({ visible });
    this.plugin.canvas3d?.requestDraw();
  }

  /** Makes the guides `desired` asks for, updates those that changed, removes the others */
  async sync(desired: readonly CutGuideData[]) {
    const canvas = this.plugin.canvas3d;
    if (!canvas) return;
    const keep = new Set<string>();
    for (const d of desired) {
      const key = keyOf(d);
      keep.add(key);
      await this.set(d, key);
    }
    for (const [key, { reprs }] of this.visuals) {
      if (keep.has(key)) continue;
      for (const repr of reprs) {
        canvas.remove(repr);
        repr.destroy();
      }
      this.visuals.delete(key);
    }
    canvas.requestDraw();
  }

  /** One guide as `d` says, made if new (a drag's preview calls it at pointer rate) */
  async set(d: CutGuideData, key = keyOf(d)) {
    const canvas = this.plugin.canvas3d;
    if (!canvas) return;
    const json = JSON.stringify([d.object, d.reach]);
    const old = this.visuals.get(key);
    if (old && old.json === json) return;
    const make = (mesh: typeof clipGuideMesh, label: string): GuideRepr =>
      ShapeRepresentation<CutGuideData, Mesh, any>(
        (_, data, __, shape) =>
          ShapeUtils.create(
            label,
            data,
            mesh(data.object, data.reach, shape?.geometry),
            () => CutGuideColor,
            () => 1,
            () => label,
          ),
        Mesh.Utils,
        { graphics: canvas.graphics },
      );
    // the faint faces, then the rim (seen and picked)
    const reprs = old?.reprs ?? [
      make(clipGuideMesh, 'Cut'),
      make(clipGuideRimMesh, 'Cut: right-click to move, turn or size it'),
    ];
    this.visuals.set(key, { reprs, json });
    await reprs[0].createOrUpdate(CutGuideLook, d).run();
    await reprs[1].createOrUpdate(CutGuideRimLook, d).run();
    if (!old) {
      reprs[0].setState({ visible: this.shown, pickable: false });
      reprs[1].setState({ visible: this.shown, pickable: true });
      for (const repr of reprs) canvas.add(repr);
    }
    canvas.requestDraw();
  }

  /** The guides shown now, for tests and reads */
  keys(): string[] {
    return Array.from(this.visuals.keys());
  }

  dispose() {
    for (const { reprs } of this.visuals.values()) {
      for (const repr of reprs) {
        this.plugin.canvas3d?.remove(repr);
        repr.destroy();
      }
    }
    this.visuals.clear();
  }
}
