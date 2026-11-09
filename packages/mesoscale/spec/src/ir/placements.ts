/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// The placement set (_spec/ir.md): the one leaf every resolver produces and every adapter consumes. Struct of arrays,
// in ångström, in the layout Mol*'s particle lists use (`ParticleList.coordinates`, `.rotations` x y z w, `.targets`), so
// an adapter hands the same buffers on without a copy. 36 bytes a copy (12 position, 16 rotation, 4 type, 4 key).

export interface PlacementType {
  /** Its index in `types`. */
  readonly index: number;
  readonly population: string;
  readonly entity: string;
  readonly label: string;
  /** The compartment its population is in. */
  readonly compartment: string;
  /** Å: the sphere a coarse drawing uses. */
  readonly radius: number;
}

export interface PlacementSet {
  /** The resolution key it came from (with the model id: unique in a scene). */
  readonly key: string;
  readonly model: string;
  /** The frame its positions are in (IR frame ref). */
  readonly frame: string;
  readonly count: number;
  /** x y z per copy, Å. */
  readonly positions: Float32Array;
  /** x y z w per copy: the copy's local frame to the set's frame. */
  readonly rotations: Float32Array;
  /** Index into `typeTable` per copy. */
  readonly types: Int32Array;
  /** The copy's ordinal in its population (stable ids are `<population>#<ordinal>`). */
  readonly ordinals: Int32Array;
  readonly typeTable: readonly PlacementType[];
  /** Filaments: copies `indices[offsets[f]..offsets[f+1])` in order (Mol*'s `ParticleList.fibers`, CSR). */
  readonly fibers?: { readonly count: number; readonly offsets: Int32Array; readonly indices: Int32Array };
}

export const BytesPerPlacement = 12 + 16 + 4 + 4;

export function placementBytes(s: PlacementSet) {
  return (
    s.positions.byteLength +
    s.rotations.byteLength +
    s.types.byteLength +
    s.ordinals.byteLength +
    (s.fibers ? s.fibers.offsets.byteLength + s.fibers.indices.byteLength : 0)
  );
}

/** A growable builder: capacity doubles, so `n` pushes cost O(n) and `finish` trims once. */
export class PlacementBuilder {
  private positions: Float32Array;
  private rotations: Float32Array;
  private types: Int32Array;
  private ordinals: Int32Array;
  private perType: number[] = [];
  count = 0;

  constructor(capacity = 1024) {
    this.positions = new Float32Array(capacity * 3);
    this.rotations = new Float32Array(capacity * 4);
    this.types = new Int32Array(capacity);
    this.ordinals = new Int32Array(capacity);
  }

  private grow() {
    const c = Math.max(16, this.types.length * 2);
    const p = new Float32Array(c * 3);
    p.set(this.positions);
    const r = new Float32Array(c * 4);
    r.set(this.rotations);
    const t = new Int32Array(c);
    t.set(this.types);
    const o = new Int32Array(c);
    o.set(this.ordinals);
    this.positions = p;
    this.rotations = r;
    this.types = t;
    this.ordinals = o;
  }

  push(type: number, x: number, y: number, z: number, q: ArrayLike<number>) {
    if (this.count === this.types.length) this.grow();
    const i = this.count++;
    this.positions[3 * i] = x;
    this.positions[3 * i + 1] = y;
    this.positions[3 * i + 2] = z;
    this.rotations[4 * i] = q[0];
    this.rotations[4 * i + 1] = q[1];
    this.rotations[4 * i + 2] = q[2];
    this.rotations[4 * i + 3] = q[3];
    this.types[i] = type;
    const k = this.perType[type] ?? 0;
    this.ordinals[i] = k;
    this.perType[type] = k + 1;
    return i;
  }

  countOf(type: number) {
    return this.perType[type] ?? 0;
  }

  finish(
    meta: Pick<PlacementSet, 'key' | 'model' | 'frame' | 'typeTable'>,
    fibers?: PlacementSet['fibers'],
  ): PlacementSet {
    const n = this.count;
    // the buffers handed on as they are when the slack is small (a view, no copy; at most 1/8 unused), trimmed by one
    // copy when it is not (a resolver that over-asked by much)
    const small = this.types.length - n <= this.types.length / 8;
    const trim = <T extends Float32Array | Int32Array>(a: T, k: number): T =>
      (a.length === n * k ? a : small ? a.subarray(0, n * k) : a.slice(0, n * k)) as T;
    return {
      ...meta,
      count: n,
      positions: trim(this.positions, 3),
      rotations: trim(this.rotations, 4),
      types: trim(this.types, 1),
      ordinals: trim(this.ordinals, 1),
      fibers,
    };
  }
}

// ---- rotations ----

export const IdentityQuat: readonly [number, number, number, number] = [0, 0, 0, 1];

/** The rotation taking unit vector `a` to unit vector `b`, then turning by `spin` radians about `b`. */
export function quatFromTo(
  out: number[],
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  spin = 0,
): number[] {
  const d = ax * bx + ay * by + az * bz;
  let x: number, y: number, z: number, w: number;
  if (d < -0.999999) {
    // opposite: half a turn about any axis perpendicular to a
    let px = 0,
      py = -az,
      pz = ay;
    if (px * px + py * py + pz * pz < 1e-12) [px, py, pz] = [-az, 0, ax];
    const l = Math.hypot(px, py, pz);
    [x, y, z, w] = [px / l, py / l, pz / l, 0];
  } else {
    x = ay * bz - az * by;
    y = az * bx - ax * bz;
    z = ax * by - ay * bx;
    w = 1 + d;
    const l = Math.hypot(x, y, z, w);
    x /= l;
    y /= l;
    z /= l;
    w /= l;
  }
  if (spin) {
    // s = rotation about b by spin; result = s * q
    const h = spin / 2;
    const sw = Math.cos(h);
    const ss = Math.sin(h);
    const sx = bx * ss,
      sy = by * ss,
      sz = bz * ss;
    out[0] = sw * x + sx * w + sy * z - sz * y;
    out[1] = sw * y - sx * z + sy * w + sz * x;
    out[2] = sw * z + sx * y - sy * x + sz * w;
    out[3] = sw * w - sx * x - sy * y - sz * z;
    return out;
  }
  out[0] = x;
  out[1] = y;
  out[2] = z;
  out[3] = w;
  return out;
}

/** v rotated by q (x y z w). */
export function rotateVec(out: number[], q: ArrayLike<number>, vx: number, vy: number, vz: number): number[] {
  const [qx, qy, qz, qw] = [q[0], q[1], q[2], q[3]];
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
  return out;
}

export function mulQuat(out: number[], a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const [ax, ay, az, aw] = [a[0], a[1], a[2], a[3]];
  const [bx, by, bz, bw] = [b[0], b[1], b[2], b[3]];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

/** The rotation of a column-major 4×4 similarity, as a quaternion (its scale divided out). */
export function rotationOf(m: readonly number[]): number[] {
  const s = Math.hypot(m[0], m[1], m[2]) || 1;
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = [
    m[0] / s,
    m[4] / s,
    m[8] / s,
    m[1] / s,
    m[5] / s,
    m[9] / s,
    m[2] / s,
    m[6] / s,
    m[10] / s,
  ];
  const tr = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (tr > 0) {
    const S = Math.sqrt(tr + 1) * 2;
    w = 0.25 * S;
    x = (m21 - m12) / S;
    y = (m02 - m20) / S;
    z = (m10 - m01) / S;
  } else if (m00 > m11 && m00 > m22) {
    const S = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / S;
    x = 0.25 * S;
    y = (m01 + m10) / S;
    z = (m02 + m20) / S;
  } else if (m11 > m22) {
    const S = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / S;
    x = (m01 + m10) / S;
    y = 0.25 * S;
    z = (m12 + m21) / S;
  } else {
    const S = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / S;
    x = (m02 + m20) / S;
    y = (m12 + m21) / S;
    z = 0.25 * S;
  }
  return [x, y, z, w];
}
