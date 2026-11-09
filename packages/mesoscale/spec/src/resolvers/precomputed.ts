/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { type Id, issue, type Issue } from '@molstar/meso-spec/format';
import { mulQuat, PlacementBuilder, type PlacementType, rotateVec, rotationOf } from '@molstar/meso-spec/ir';
import type { ResolveJob, ResolveOutput, Resolver, StarTable } from '@molstar/meso-spec/runtime';

// `meso.precomputed` (_spec/runtime.md): placements someone else computed, read from their native format and carried into
// the world frame by the resource frame's alignment. A precomputed model and a procedural one are the same to everything
// after the resolver: both end as placement sets. Formats: RELION STAR (coordinates in voxels, ZYZ angles, as Mol*'s
// reader reads them: packages/model/src/formats/particles/star.ts `relionEulerToRotation`) and a small JSON one. As
// that reader, a STAR row's origin shift (`rlnOrigin*` in pixels, `rlnOrigin*Angst` in Å, turned by the subtomogram's
// rotation when it has one) is taken off its coordinate, and its subtomogram angles (`rlnTomoSubtomogram*`) turn its
// rotation: subtomogram · particle. An Å shift becomes voxels by the resource frame's scale (the voxel size).
//
// `params.placements`: an inline table in the same JSON shape, already in world Å (the runtime writes the document's
// instances, _spec/format.md, this way, so given poses have one code path whether a file or the document holds them).
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
  version: '0.3.0',
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
        const all = (names: string[]) => {
          const c = names.map(col);
          return c.every((i) => i >= 0) ? c : undefined;
        };
        const [cx, cy, cz] = ['rlnCoordinateX', 'rlnCoordinateY', 'rlnCoordinateZ'].map(col);
        const angles = all(['rlnAngleRot', 'rlnAngleTilt', 'rlnAnglePsi']);
        const sub = all(['rlnTomoSubtomogramRot', 'rlnTomoSubtomogramTilt', 'rlnTomoSubtomogramPsi']);
        // the origin shift: Å first (RELION 3.1+), as Mol*'s reader; Å to voxels by the frame's scale
        const originA = all(['rlnOriginXAngst', 'rlnOriginYAngst', 'rlnOriginZAngst']);
        const origin = originA ?? all(['rlnOriginX', 'rlnOriginY', 'rlnOriginZ']);
        const perVoxel = originA ? 1 / (Math.hypot(M[0], M[1], M[2]) || 1) : 1;
        const pick = typeof input.populations === 'string' ? undefined : col(input.populations.column);
        if (pick !== undefined && pick < 0) {
          issues.push(
            issue(
              'resolver.unsupported',
              'error',
              'resolve',
              `${r.id} has no column ${(input.populations as { column: string }).column} to read populations from (it has ${table.columns.join(', ')})`,
              { ids: [r.id, job.model.id] },
            ),
          );
          continue;
        }
        const rq = [0, 0, 0, 1];
        const sq = [0, 0, 0, 1];
        const shift = [0, 0, 0];
        for (const row of table.rows) {
          const pop = typeof input.populations === 'string' ? input.populations : input.populations.values[row[pick!]];
          const type = pop === undefined ? undefined : typeOf.get(pop);
          if (type === undefined) continue;
          if (angles) relionQuat(rq, +row[angles[0]], +row[angles[1]], +row[angles[2]]);
          else [rq[0], rq[1], rq[2], rq[3]] = [0, 0, 0, 1];
          if (sub) relionQuat(sq, +row[sub[0]], +row[sub[1]], +row[sub[2]]);
          let [x, y, z] = [+row[cx], +row[cy], +row[cz]];
          if (origin) {
            shift[0] = +row[origin[0]] * perVoxel;
            shift[1] = +row[origin[1]] * perVoxel;
            shift[2] = +row[origin[2]] * perVoxel;
            if (sub) rotateVec(shift, sq, shift[0], shift[1], shift[2]);
            x -= shift[0];
            y -= shift[1];
            z -= shift[2];
          }
          put(type, x, y, z, sub ? mulQuat(rq, sq, [...rq]) : rq);
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
