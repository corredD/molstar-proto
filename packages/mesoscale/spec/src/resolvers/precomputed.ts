/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Id } from '../format/doc.js';
import { issue, type Issue } from '../format/issues.js';
import { PlacementBuilder, type PlacementType } from '../ir/placements.js';
import type { StarTable } from '../runtime/readers.js';
import type { Resolver, ResolveJob, ResolveOutput } from '../runtime/resolver.js';

// `meso.precomputed` (design.md §4.5): placements someone else computed, read from their native format and carried into
// the world frame by the resource frame's alignment. A precomputed model and a procedural one are the same to everything
// after the resolver: both end as placement sets. Formats: RELION STAR (coordinates in voxels, ZYZ angles, as Mol*'s
// reader reads them: packages/model/src/formats/particles/star.ts `relionEulerToRotation`) and a small JSON one.
//
// `params.placements`: an inline table in the same JSON shape, already in world Å (the runtime writes the document's
// instances, design.md §3.13, this way, so given poses have one code path whether a file or the document holds them).
//
// `params.populations`: which population each row is: one id for the whole file, or `{ column, values: { <value>: id } }`.

type PopulationMap = Id | { readonly column: string; readonly values: Readonly<Record<string, Id>> };

interface PrecomputedInput {
  readonly resources: readonly {
    readonly id: Id;
    readonly format: string;
    readonly contentKey: string;
    readonly toWorld?: readonly number[];
  }[];
  readonly inline?: PlacementsJson;
  readonly populations: PopulationMap;
  readonly types: readonly {
    readonly population: Id;
    readonly entity: Id;
    readonly label: string;
    readonly compartment: Id;
    readonly radius: number;
    readonly requested?: number;
  }[];
}

interface PlacementsJson {
  readonly population?: Id;
  readonly positions: readonly number[];
  readonly rotations?: readonly number[];
  readonly populations?: readonly Id[];
}

export const MesoPrecomputedResolver: Resolver<PrecomputedInput> = {
  id: 'meso.precomputed',
  version: '0.2.0',
  description:
    "Placements from a file (RELION STAR particle lists, MesoViewSpec placement JSON) or the document's instances",
  arrangements: ['random', 'lattice', 'fiber'],
  locations: ['interior', 'membrane', 'outer-surface', 'inner-surface', 'exterior'],
  formats: ['relion-star', 'meso-placements+json'],
  project(job: ResolveJob): PrecomputedInput {
    return {
      resources: (job.model.inputs ?? []).map((id) => {
        const r = job.inputs.get(id)!;
        return { id, format: r.resource.format, contentKey: r.contentKey, toWorld: r.toWorld };
      }),
      inline: job.model.params?.placements as PlacementsJson | undefined,
      populations: (job.model.params?.populations ?? job.populations[0]?.id) as PopulationMap,
      types: job.populations.map((p) => ({
        population: p.id,
        entity: p.entity.id,
        label: p.entity.label,
        compartment: p.compartment,
        radius: p.radius ?? 10,
        requested: p.requested,
      })),
    };
  },
  resolve(input, job): ResolveOutput {
    const typeTable: PlacementType[] = input.types.map(({ requested: _r, ...t }, index) => ({ index, ...t }));
    const typeOf = new Map(input.types.map((t, i) => [t.population, i]));
    const b = new PlacementBuilder(256);
    const issues: Issue[] = [];
    const q = [0, 0, 0, 1];
    const sources = [
      ...input.resources.map((r) => ({ ...r, content: job.inputs.get(r.id)?.content })),
      ...(input.inline
        ? [{ id: job.model.id, format: 'meso-placements+json', content: input.inline as unknown, toWorld: undefined }]
        : []),
    ];
    for (const r of sources) {
      const content = r.content;
      const M = r.toWorld ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      const Mq = rotationOf(M);
      const put = (type: number, x: number, y: number, z: number, rq: number[]) => {
        const wx = M[0] * x + M[4] * y + M[8] * z + M[12];
        const wy = M[1] * x + M[5] * y + M[9] * z + M[13];
        const wz = M[2] * x + M[6] * y + M[10] * z + M[14];
        b.push(type, wx, wy, wz, mulQuat(q, Mq, rq));
      };
      if (r.format === 'relion-star') {
        const tables = content as Map<string, StarTable>;
        const table = [...tables.values()].find((t) => t.columns.includes('rlnCoordinateX'));
        if (!table) {
          issues.push(
            issue('resolver.unsupported', 'error', 'resolve', `${r.id} has no table with rlnCoordinateX`, {
              ids: [r.id],
            }),
          );
          continue;
        }
        const col = (n: string) => table.columns.indexOf(n);
        const [cx, cy, cz] = ['rlnCoordinateX', 'rlnCoordinateY', 'rlnCoordinateZ'].map(col);
        const [ar, at, ap] = ['rlnAngleRot', 'rlnAngleTilt', 'rlnAnglePsi'].map(col);
        const pick = typeof input.populations === 'string' ? undefined : col(input.populations.column);
        const rq = [0, 0, 0, 1];
        for (const row of table.rows) {
          const pop = typeof input.populations === 'string' ? input.populations : input.populations.values[row[pick!]];
          const type = pop === undefined ? undefined : typeOf.get(pop);
          if (type === undefined) continue;
          if (ar >= 0 && at >= 0 && ap >= 0) relionQuat(rq, +row[ar], +row[at], +row[ap]);
          else [rq[0], rq[1], rq[2], rq[3]] = [0, 0, 0, 1];
          put(type, +row[cx], +row[cy], +row[cz], rq);
        }
      } else if (r.format === 'meso-placements+json') {
        const data = content as PlacementsJson;
        const n = data.positions.length / 3;
        for (let i = 0; i < n; i++) {
          const pop =
            data.populations?.[i] ??
            data.population ??
            (typeof input.populations === 'string' ? input.populations : undefined);
          const type = pop === undefined ? undefined : typeOf.get(pop);
          if (type === undefined) continue;
          const rq = data.rotations ? data.rotations.slice(4 * i, 4 * i + 4) : [0, 0, 0, 1];
          put(type, data.positions[3 * i], data.positions[3 * i + 1], data.positions[3 * i + 2], rq);
        }
      }
    }
    const achieved: Record<Id, number> = {};
    for (const t of input.types) achieved[t.population] = b.countOf(typeOf.get(t.population)!);
    const shortfall: Record<Id, string> = {};
    for (const t of input.types)
      if (t.requested !== undefined && achieved[t.population] < t.requested)
        shortfall[t.population] =
          `the file has ${achieved[t.population]} rows for ${t.population}; the document says ${t.requested}`;
    return {
      sets: [b.finish({ key: '', model: job.model.id, frame: 'world', typeTable })],
      achieved,
      shortfall,
      issues,
    };
  },
};

/** RELION's (Rz(rot) Ry(tilt) Rz(psi))ᵀ as a quaternion: the inverse of qz(rot)·qy(tilt)·qz(psi). */
export function relionQuat(out: number[], rot: number, tilt: number, psi: number): number[] {
  const d = Math.PI / 360;
  const z1 = [0, 0, Math.sin(rot * d), Math.cos(rot * d)];
  const y = [0, Math.sin(tilt * d), 0, Math.cos(tilt * d)];
  const z2 = [0, 0, Math.sin(psi * d), Math.cos(psi * d)];
  const t = mulQuat([0, 0, 0, 1], mulQuat([0, 0, 0, 1], z1, y), z2);
  out[0] = -t[0];
  out[1] = -t[1];
  out[2] = -t[2];
  out[3] = t[3];
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
