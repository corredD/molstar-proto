/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Interval } from '@molstar/core/data/int';
import { Sphere3D } from '@molstar/core/math/geometry';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { ValueCell } from '@molstar/core/util';
import { MarkerAction } from '@molstar/core/util/marker-action';
import type { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { DataLoci, isEveryLoci, type Loci } from '@molstar/model/model/loci';
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
  /** The source mesh's vertices and triangles as marked (`meshVersion`) */
  private version: string;
  /** By `instance * triangleCount + index` */
  private readonly highlighted = new Map<number, ShapeGroup.Triangle>();
  private readonly selected = new Map<number, ShapeGroup.Triangle>();

  constructor(
    source: Shape<Mesh>,
    private props: PD.Values<Mesh.Params>,
  ) {
    this.source = source;
    this.version = meshVersion(source.geometry);
    this.renderObject = ShapeUtils.createRenderObject(this.overlayShape(0), props) as GraphicsRenderObject<'mesh'>;
    this.renderObject.state.pickable = false;
  }

  /** The mesh's props changed (its alpha, material, clipping…): the marked triangles take them */
  setProps(props: PD.Values<Mesh.Params>) {
    this.props = props;
    Mesh.Utils.updateValues(this.renderObject.values, props);
    Mesh.Utils.updateRenderableState(this.renderObject.state, props);
    this.renderObject.state.pickable = false;
  }

  /**
   * A new shape: of the same mesh (moved, scaled: new transforms), the marks stay, drawn where it is now; of another
   * mesh, its triangles are others: the marks go
   */
  setShape(source: Shape<Mesh>) {
    if (source === this.source) return;
    // the same mesh, its triangles unchanged (a reader may fill the same mesh again)
    const same = source.geometry === this.source.geometry && meshVersion(source.geometry) === this.version;
    this.source = source;
    this.version = meshVersion(source.geometry);
    if (!same) {
      this.highlighted.clear();
      this.selected.clear();
    }
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

  /** The marked triangles' keys, in the mesh's order (the same marks, the same copies), into `this.keys` */
  private collectKeys() {
    const keys = this.keys;
    keys.length = 0;
    for (const k of this.highlighted.keys()) keys.push(k);
    for (const k of this.selected.keys()) if (!this.highlighted.has(k)) keys.push(k);
    keys.sort(byNumber);
    return keys;
  }

  /** The copies' groups as their triangles' own and their instances, read by the copies' shape (`overlay`) */
  private readonly groups: number[] = [];
  private readonly instances: number[] = [];
  private readonly keys: number[] = [];
  /** The copies' shape, made once: one group a marked triangle, colored as its own group */
  private overlay: Shape<Mesh> | undefined;

  private overlayShape(count: number): Shape<Mesh> {
    const { groups, instances } = this;
    if (!this.overlay || this.overlay.sourceData !== this.source.sourceData) {
      // its source read when called: a new source shape (a move) needs no new copies' shape
      this.overlay = ShapeUtils.create(
        `${this.source.name}-marked-triangles`,
        this.source.sourceData,
        this.mesh,
        (g) => this.source.getColor(groups[g], instances[g]),
        () => 1,
        (g) => this.source.getLabel(groups[g], instances[g]),
        [identity],
        count,
      );
    }
    (this.overlay as { groupCount: number }).groupCount = count;
    return this.overlay;
  }

  /** The buffers of the copies, grown by doubling, reused from mark to mark (a hover marks at each move) */
  private buffers = {
    vb: new Float32Array(0),
    nb: new Float32Array(0),
    gb: new Float32Array(0),
    ib: new Uint32Array(0),
  };

  private buffersFor(k: number) {
    if (this.buffers.ib.length < k * 6) {
      const n = Math.max(k, 2 * (this.buffers.ib.length / 6), 4);
      this.buffers = {
        vb: new Float32Array(n * 18),
        nb: new Float32Array(n * 18),
        gb: new Float32Array(n * 6),
        ib: new Uint32Array(n * 6),
      };
    }
    return this.buffers;
  }

  /** Marks the copies `marked` holds (`Visual.mark`'s apply, made once) */
  private readonly applyTo =
    (marked: Map<number, ShapeGroup.Triangle>) => (_: Loci, apply: (i: Interval) => boolean) => {
      let any = false;
      const keys = this.keys;
      for (let j = 0, k = keys.length; j < k; ++j)
        if (marked.has(keys[j]) && apply(Interval.ofSingleton(j))) any = true;
      return any;
    };
  private readonly applyHighlighted = this.applyTo(this.highlighted);
  private readonly applySelected = this.applyTo(this.selected);

  private rebuild() {
    const keys = this.collectKeys();
    const k = keys.length;
    const { vb, nb, gb, ib } = this.buffersFor(k);
    const { vertexBuffer, normalBuffer, indexBuffer } = this.source.geometry;
    const sv = vertexBuffer.ref.value;
    const sn = normalBuffer.ref.value;
    const si = indexBuffer.ref.value;
    const { groups, instances } = this;
    groups.length = k;
    instances.length = k;
    for (let j = 0; j < k; ++j) {
      const t = this.selected.get(keys[j]) ?? this.highlighted.get(keys[j])!;
      groups[j] = ShapeUtils.triangleGroup(this.source.geometry, t.index);
      instances[j] = t.instance;
      const m = this.source.transforms[t.instance] ?? identity;
      for (let v = 0; v < 3; ++v) {
        const vi = si[3 * t.index + v];
        Vec3.transformMat4(P[v], Vec3.fromArray(P[v], sv, vi * 3), m);
        Vec3.transformDirection(N[v], Vec3.fromArray(N[v], sn, vi * 3), m);
      }
      Vec3.triangleNormal(Face, P[0], P[1], P[2]);
      const edge = Math.sqrt(
        Math.max(Vec3.squaredDistance(P[0], P[1]), Vec3.squaredDistance(P[1], P[2]), Vec3.squaredDistance(P[2], P[0])),
      );
      // two copies, one a hair off each side
      for (let side = 0; side < 2; ++side) {
        const offset = (side === 0 ? 1 : -1) * Offset * edge;
        const base = (2 * j + side) * 3;
        for (let v = 0; v < 3; ++v) {
          const o = (base + v) * 3;
          vb[o] = P[v][0] + Face[0] * offset;
          vb[o + 1] = P[v][1] + Face[1] * offset;
          vb[o + 2] = P[v][2] + Face[2] * offset;
          nb[o] = N[v][0];
          nb[o + 1] = N[v][1];
          nb[o + 2] = N[v][2];
          gb[base + v] = j;
          ib[base + v] = base + v;
        }
      }
    }
    Mesh.create(vb, ib, nb, gb, k * 6, k * 2, this.mesh);

    const shape = this.overlayShape(k);
    const values = this.renderObject.values;
    ValueCell.updateIfChanged(values.drawCount, k * 6);
    ValueCell.updateIfChanged(values.uVertexCount, k * 6);
    ValueCell.updateIfChanged(values.uGroupCount, k);
    const locationIt = ShapeUtils.groupIterator(shape);
    const positionIt = Mesh.Utils.createPositionIterator(this.mesh, values);
    createColors(locationIt, positionIt, ShapeUtils.getTheme(shape).color, values);
    createMarkers(k, 'groupInstance', values);
    // the loci is only a key for `Visual.mark`: the indices come from the apply
    if (this.highlighted.size) Visual.mark(this.renderObject, MarkKey, MarkerAction.Highlight, this.applyHighlighted);
    if (this.selected.size) Visual.mark(this.renderObject, MarkKey, MarkerAction.Select, this.applySelected);
    // its instance's bounds (culling) from the copies
    ShapeUtils.createTransform([identity], this.mesh.boundingSphere, this.props.cellSize, this.props.batchSize, values);
    Mesh.Utils.updateBoundingSphere(values, this.mesh);
  }
}

const byNumber = (a: number, b: number) => a - b;
const P = [Vec3(), Vec3(), Vec3()];
const N = [Vec3(), Vec3(), Vec3()];
const Face = Vec3();
/** A non-empty loci for `Visual.mark` (which skips empty ones); what it marks comes from the apply */
const MarkKey: Loci = DataLoci(
  'triangle-marks',
  undefined,
  [0],
  () => Sphere3D(),
  () => '',
);

function meshVersion(mesh: Mesh) {
  return `${mesh.vertexBuffer.ref.version}:${mesh.indexBuffer.ref.version}:${mesh.triangleCount}`;
}

function setIn(map: Map<number, ShapeGroup.Triangle>, key: number, t: ShapeGroup.Triangle) {
  if (map.has(key)) return false;
  map.set(key, t);
  return true;
}
