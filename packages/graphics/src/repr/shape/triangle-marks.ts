/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Interval, OrderedSet } from '@molstar/core/data/int';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { ValueCell } from '@molstar/core/util';
import { MarkerAction } from '@molstar/core/util/marker-action';
import type { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { isEveryLoci, type Loci } from '@molstar/model/model/loci';
import { Shape, ShapeGroup } from '@molstar/model/model/shape';
import { createColors } from '@molstar/graphics/geo/geometry/color-data';
import { createMarkers } from '@molstar/graphics/geo/geometry/marker-data';
import { Mesh } from '@molstar/graphics/geo/geometry/mesh/mesh';
import * as ShapeUtils from '@molstar/graphics/geo/shape/shape';
import type { GraphicsRenderObject } from '@molstar/graphics/gl/render-object';
import { Visual } from '../visual.js';

// The triangles of a mesh shape marked one by one (.v6/plans/gl/triangle-picking.md). A mesh's marker is by group and
// instance, and a group may be a whole material: a highlighted or selected triangle is drawn again on top of the mesh,
// in its group's color with the marker on, so only it looks marked. Copies of the marked triangles only (a hover: one),
// in the scene's space (an instance's transform applied), a hair off each side of the surface so the side in view is
// drawn over it (the mesh is double sided). Not pickable: a pick goes through to the mesh.

/** How far off the surface a marked triangle is drawn, times its longest edge */
const Offset = 0.005;

const identity = Mat4.identity();

export class TriangleMarks {
  readonly renderObject: GraphicsRenderObject<'mesh'>;
  private readonly mesh = Mesh.createEmpty();
  private source: Shape<Mesh>;
  /** By `instance * triangleCount + index` */
  private readonly highlighted = new Map<number, ShapeGroup.Triangle>();
  private readonly selected = new Map<number, ShapeGroup.Triangle>();

  constructor(
    source: Shape<Mesh>,
    private props: PD.Values<Mesh.Params>,
  ) {
    this.source = source;
    this.renderObject = ShapeUtils.createRenderObject(this.overlayShape([]), props) as GraphicsRenderObject<'mesh'>;
    this.renderObject.state.pickable = false;
  }

  /** Marked triangles: highlighted or selected */
  get count() {
    return this.keys().length;
  }

  /** The mesh's props changed (its alpha, material, clipping…): the marked triangles take them */
  setProps(props: PD.Values<Mesh.Params>) {
    this.props = props;
    Mesh.Utils.updateValues(this.renderObject.values, props);
    Mesh.Utils.updateRenderableState(this.renderObject.state, props);
    this.renderObject.state.pickable = false;
  }

  /** A new shape of the mesh: its triangles may be others, the marks go */
  setShape(source: Shape<Mesh>) {
    if (source === this.source) return;
    this.source = source;
    this.highlighted.clear();
    this.selected.clear();
    this.rebuild();
  }

  /**
   * Applies a marking: triangles of the shape (a group loci's `triangles`) are marked here; the whole shape or
   * everything unmarked clears them (marked whole, the mesh's own marker shows it). Whether anything changed.
   */
  mark(loci: Loci, action: MarkerAction): boolean {
    let changed = false;
    if (ShapeGroup.isLoci(loci) && loci.triangles) {
      if (loci.shape !== this.source) return false;
      const n = this.source.geometry.triangleCount;
      for (const t of loci.triangles) {
        if (t.index < 0 || t.index >= n) continue;
        const key = t.instance * n + t.index;
        switch (action) {
          case MarkerAction.Highlight:
            changed = setIn(this.highlighted, key, t) || changed;
            break;
          case MarkerAction.RemoveHighlight:
            changed = this.highlighted.delete(key) || changed;
            break;
          case MarkerAction.Select:
            changed = setIn(this.selected, key, t) || changed;
            break;
          case MarkerAction.Deselect:
            changed = this.selected.delete(key) || changed;
            break;
          case MarkerAction.Toggle:
            if (!this.selected.delete(key)) this.selected.set(key, t);
            changed = true;
            break;
          case MarkerAction.Clear:
            changed = this.highlighted.delete(key) || changed;
            changed = this.selected.delete(key) || changed;
            break;
        }
      }
    } else if (isEveryLoci(loci) || (Shape.isLoci(loci) && loci.shape === this.source)) {
      if (action === MarkerAction.RemoveHighlight || action === MarkerAction.Clear) {
        changed = this.highlighted.size > 0;
        this.highlighted.clear();
      }
      if (action === MarkerAction.Deselect || action === MarkerAction.Clear) {
        changed = this.selected.size > 0 || changed;
        this.selected.clear();
      }
    }
    if (changed) this.rebuild();
    return changed;
  }

  private keys() {
    const keys = new Set(this.highlighted.keys());
    for (const k of this.selected.keys()) keys.add(k);
    // in the mesh's order: the same marks, the same copies
    return [...keys].sort((a, b) => a - b);
  }

  /** The shape of the copies: one group a marked triangle, colored as its own group */
  private overlayShape(triangles: readonly ShapeGroup.Triangle[]) {
    const source = this.source;
    const groups = triangles.map((t) => ShapeUtils.triangleGroup(source.geometry, t.index));
    return ShapeUtils.create(
      `${source.name}-marked-triangles`,
      source.sourceData,
      this.mesh,
      (g) => source.getColor(groups[g], triangles[g].instance),
      () => 1,
      (g) => source.getLabel(groups[g], triangles[g].instance),
      [identity],
      triangles.length,
    );
  }

  private rebuild() {
    const keys = this.keys();
    const triangles = keys.map((k) => this.selected.get(k) ?? this.highlighted.get(k)!);
    const k = triangles.length;
    const vb = new Float32Array(k * 18);
    const nb = new Float32Array(k * 18);
    const gb = new Float32Array(k * 6);
    const ib = new Uint32Array(k * 6);
    const { vertexBuffer, normalBuffer, indexBuffer } = this.source.geometry;
    const sv = vertexBuffer.ref.value;
    const sn = normalBuffer.ref.value;
    const si = indexBuffer.ref.value;
    const p = [Vec3(), Vec3(), Vec3()];
    const nrm = [Vec3(), Vec3(), Vec3()];
    const face = Vec3();
    for (let j = 0; j < k; ++j) {
      const t = triangles[j];
      const m = this.source.transforms[t.instance] ?? identity;
      for (let v = 0; v < 3; ++v) {
        const vi = si[3 * t.index + v];
        Vec3.transformMat4(p[v], Vec3.fromArray(p[v], sv, vi * 3), m);
        Vec3.transformDirection(nrm[v], Vec3.fromArray(nrm[v], sn, vi * 3), m);
      }
      Vec3.triangleNormal(face, p[0], p[1], p[2]);
      const edge = Math.sqrt(
        Math.max(Vec3.squaredDistance(p[0], p[1]), Vec3.squaredDistance(p[1], p[2]), Vec3.squaredDistance(p[2], p[0])),
      );
      // two copies, one a hair off each side
      for (let side = 0; side < 2; ++side) {
        const offset = (side === 0 ? 1 : -1) * Offset * edge;
        const base = (2 * j + side) * 3;
        for (let v = 0; v < 3; ++v) {
          const o = (base + v) * 3;
          vb[o] = p[v][0] + face[0] * offset;
          vb[o + 1] = p[v][1] + face[1] * offset;
          vb[o + 2] = p[v][2] + face[2] * offset;
          nb[o] = nrm[v][0];
          nb[o + 1] = nrm[v][1];
          nb[o + 2] = nrm[v][2];
          gb[base + v] = j;
          ib[base + v] = base + v;
        }
      }
    }
    Mesh.create(vb, ib, nb, gb, k * 6, k * 2, this.mesh);

    const shape = this.overlayShape(triangles);
    const values = this.renderObject.values;
    ValueCell.updateIfChanged(values.drawCount, k * 6);
    ValueCell.updateIfChanged(values.uVertexCount, k * 6);
    ValueCell.updateIfChanged(values.uGroupCount, k);
    const locationIt = ShapeUtils.groupIterator(shape);
    const positionIt = Mesh.Utils.createPositionIterator(this.mesh, values);
    createColors(locationIt, positionIt, ShapeUtils.getTheme(shape).color, values);
    createMarkers(k, 'groupInstance', values);
    const each = (marked: Map<number, ShapeGroup.Triangle>) => (_: Loci, apply: (i: Interval) => boolean) => {
      let any = false;
      for (let j = 0; j < k; ++j) if (marked.has(keys[j]) && apply(Interval.ofSingleton(j))) any = true;
      return any;
    };
    // the loci is only a key for `Visual.mark`: the indices come from `each`
    const loci = ShapeGroup.Loci(shape, [{ ids: OrderedSet.ofSingleton(0), instance: 0 }]);
    if (this.highlighted.size) Visual.mark(this.renderObject, loci, MarkerAction.Highlight, each(this.highlighted));
    if (this.selected.size) Visual.mark(this.renderObject, loci, MarkerAction.Select, each(this.selected));
    // its instance's bounds (culling) from the copies
    ShapeUtils.createTransform([identity], this.mesh.boundingSphere, this.props.cellSize, this.props.batchSize, values);
    Mesh.Utils.updateBoundingSphere(values, this.mesh);
  }
}

function setIn(map: Map<number, ShapeGroup.Triangle>, key: number, t: ShapeGroup.Triangle) {
  if (map.has(key)) return false;
  map.set(key, t);
  return true;
}
