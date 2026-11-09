/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { PlacementBuilder, type PlacementSet } from '../ir/placements.js';
import { MesoFiberResolver } from '../resolvers/fiber.js';
import { sdfGrid, shapeSampler } from '../resolvers/geometry.js';
import { MesoLatticeResolver } from '../resolvers/lattice.js';
import { MesoPackResolver } from '../resolvers/meso-pack.js';
import { MesoRelaxResolver } from '../resolvers/relax.js';
import { createRandom } from '../runtime/random.js';
import type { ResolveJob, ResolveOutput } from '../runtime/resolver.js';

// The resolvers' review-gate findings (progress/2026-11-08-mesoviewspec.md, the gate): each a resolver run on a small
// hand-made job, what it must hold.

const entity = (id: string) => ({ id, label: id });

/** A resolve job from populations and compartments (the compartments' `children` default to none). */
export function job(pops: any[], comps: Record<string, any>, extra: any = {}): ResolveJob {
  return {
    model: {
      id: extra.model ?? 'm',
      kind: 'procedural',
      method: 'x',
      populations: pops.map((p) => p.id),
      params: extra.params,
    },
    populations: pops.map((p) => ({ entity: entity(`e.${p.id}`), minFraction: 1, minDistances: [], ...p })),
    compartments: new Map(Object.entries(comps).map(([k, v]) => [k, { id: k, label: k, children: [], ...v }])),
    inputs: new Map(),
    obstacles: extra.obstacles ?? [],
    seed: extra.seed ?? 1,
    relations: extra.relations ?? [],
    upstream: extra.upstream,
  } as unknown as ResolveJob;
}

/** One placement set of `n` copies of one type, from a position function. */
export function setOf(
  n: number,
  at: (i: number) => [number, number, number],
  type: { population: string; compartment: string; radius: number },
  model = 'm.up',
): PlacementSet {
  const b = new PlacementBuilder(n);
  for (let i = 0; i < n; i++) b.push(0, ...at(i), [0, 0, 0, 1]);
  return b.finish({
    key: `${model}#0`,
    model,
    frame: 'world',
    typeTable: [{ index: 0, entity: `e.${type.population}`, label: type.population, ...type }],
  });
}

const run = <T>(r: { project(j: ResolveJob): T; resolve(i: T, j: ResolveJob): unknown }, j: ResolveJob) =>
  r.resolve(r.project(j), j) as ResolveOutput;

/** Distance from a point outside an axis-aligned box of half-side `h` (0 inside). */
const boxDistance = (x: number, y: number, z: number, h: number) =>
  Math.hypot(Math.max(Math.abs(x) - h, 0), Math.max(Math.abs(y) - h, 0), Math.max(Math.abs(z) - h, 0));

describe('meso.relax', () => {
  /** 2000 copies (r 10) anywhere within 380 Å, some inside the child; relaxed in a sphere of 420 around the child. */
  const aroundChild = (child: unknown) => {
    const r = createRandom(7);
    const up = setOf(
      2000,
      () => {
        for (;;) {
          const p: [number, number, number] = [r.range(-380, 380), r.range(-380, 380), r.range(-380, 380)];
          if (Math.hypot(...p) <= 380) return p;
        }
      },
      { population: 'p', compartment: 'outer', radius: 10 },
    );
    const j = job(
      [
        {
          id: 'p',
          compartment: 'outer',
          location: 'interior',
          requested: 2000,
          radius: 10,
          arrangement: { kind: 'random' },
        },
      ],
      {
        outer: { shape: { kind: 'sphere', center: [0, 0, 0], radius: 420 }, children: ['child'] },
        child: { shape: child, parent: 'outer', membrane: { thickness: 40 } },
      },
      { model: 'm.relax', params: { iterations: 400, tolerance: 1 }, upstream: { sets: [up], achieved: { p: 2000 } } },
    );
    return run(MesoRelaxResolver, j);
  };

  it('keeps copies out of a child compartment and its membrane, exactly', () => {
    const sphere = aroundChild({ kind: 'sphere', center: [0, 0, 0], radius: 150 });
    const box = aroundChild({ kind: 'box', center: [0, 0, 0], size: [300, 300, 300] });
    for (const [out, gap] of [
      // a copy (r 10) at least 150 + 20 + 10 from the sphere's centre; 20 + 10 from the box
      [sphere, (x: number, y: number, z: number) => Math.hypot(x, y, z) - 150 - 30],
      [box, (x: number, y: number, z: number) => boxDistance(x, y, z, 150) - 30],
    ] as const) {
      const s = out.sets[0];
      let bad = 0;
      for (let i = 0; i < s.count; i++)
        if (gap(s.positions[3 * i], s.positions[3 * i + 1], s.positions[3 * i + 2]) < -1e-3) bad++;
      expect(bad).toBe(0);
      expect((out.report as { outsideExact: number }).outsideExact).toBe(0);
    }
  });

  it('relaxes 150 000 copies (no argument spread over the bodies)', () => {
    const n = 150_000;
    const r = createRandom(7);
    const up = setOf(n, () => [r.range(-3000, 3000), r.range(-3000, 3000), r.range(-3000, 3000)], {
      population: 'p',
      compartment: 'c',
      radius: 10,
    });
    const j = job(
      [{ id: 'p', compartment: 'c', location: 'interior', requested: n, radius: 10, arrangement: { kind: 'random' } }],
      { c: { shape: { kind: 'box', center: [0, 0, 0], size: [7000, 7000, 7000] } } },
      { params: { iterations: 1, tolerance: 1 }, upstream: { sets: [up], achieved: { p: n } } },
    );
    expect(() => run(MesoRelaxResolver, j)).not.toThrow();
  });
});

const xs = (s: PlacementSet) => Array.from({ length: s.count }, (_, i) => s.positions[3 * i]);
const line = (step: number, n: number) => Array.from({ length: n + 1 }, (_, i) => [step * i, 0, 0] as const);
const bigSphere = { c: { shape: { kind: 'sphere', center: [0, 0, 0], radius: 1e4 } } };
const strand = (id: string, requested: number, path: readonly (readonly number[])[]) => ({
  id,
  compartment: 'c',
  location: 'interior',
  requested,
  radius: 5,
  arrangement: { kind: 'fiber', rise: 10, twist: 0, path },
});

describe('meso.fiber', () => {
  it('a grown filament has the persistence length asked: tangent correlation exp(-s/P)', () => {
    const P = 500;
    const grown = {
      ...strand('f', 20_000, []),
      radius: 1,
      arrangement: { kind: 'fiber', rise: 10, twist: 0, growth: { persistence: P, length: 2000, count: 100 } },
    };
    const out = run(
      MesoFiberResolver,
      job([grown], { c: { shape: { kind: 'sphere', center: [0, 0, 0], radius: 1e7 } } }),
    );
    const s = out.sets[0];
    const { offsets, indices } = s.fibers!;
    const tan = (k: number) => {
      const i = 3 * indices[k],
        j = 3 * indices[k + 1];
      const d = [0, 1, 2].map((c) => s.positions[j + c] - s.positions[i + c]);
      const l = Math.hypot(d[0], d[1], d[2]);
      return d.map((x) => x / l);
    };
    for (const lag of [1, 5, 10]) {
      let sum = 0,
        n = 0;
      for (let f = 0; f < s.fibers!.count; f++)
        for (let k = offsets[f]; k + lag + 1 < offsets[f + 1]; k++) {
          const a = tan(k),
            b = tan(k + lag);
          sum += a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
          n++;
        }
      const effective = (-lag * 10) / Math.log(sum / n);
      expect(effective / P).toBeGreaterThan(0.85);
      expect(effective / P).toBeLessThan(1.15);
    }
  });

  it('a traced path keeps copies one rise apart whatever its point spacing (the carry crosses short segments)', () => {
    for (const step of [2, 7, 25]) {
      const len = 200 - (200 % step);
      const n = Math.floor(len / 10) + 1;
      const out = run(MesoFiberResolver, job([strand('f', n, line(step, len / step))], bigSphere));
      expect(out.achieved.f).toBe(n);
      const x = xs(out.sets[0]);
      for (let i = 0; i < n; i++) expect(x[i]).toBeCloseTo(10 * i, 3);
    }
  });

  it("a binder's shortfall gives its own strand's length, not every strand's before it", () => {
    const binder = {
      id: 'b',
      compartment: 'c',
      location: 'interior',
      requested: 100,
      radius: 5,
      arrangement: { kind: 'random' },
    };
    const rel = {
      id: 'r',
      kind: 'binds',
      subjects: ['b'],
      objects: ['g'],
      entry: { position: [0, 0, 0] },
      spacing: 50,
    };
    const out = run(
      MesoFiberResolver,
      job([strand('f', 101, line(10, 100)), strand('g', 21, line(10, 20)), binder], bigSphere, { relations: [rel] }),
    );
    expect(out.shortfall?.b).toMatch(/the strand g is 200 Å long/);
  });
});

/** A cube of half-side `h` as a triangle mesh (outward winding): its face diagonals are shared edges. */
export function cubeMesh(h: number) {
  const v = [
    [-h, -h, -h],
    [h, -h, -h],
    [h, h, -h],
    [-h, h, -h],
    [-h, -h, h],
    [h, -h, h],
    [h, h, h],
    [-h, h, h],
  ];
  const f = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [2, 3, 7],
    [2, 7, 6],
    [1, 2, 6],
    [1, 6, 5],
    [0, 4, 7],
    [0, 7, 3],
  ];
  return { positions: new Float32Array(v.flat()), indices: new Uint32Array(f.flat()) };
}

describe('mesh compartments', () => {
  it('a copy around a mesh child keeps its radius and half the membrane from it (a negative margin)', () => {
    const s = shapeSampler({ kind: 'mesh' } as never, cubeMesh(200))!;
    // off-axis: the six axis probes miss the edge 28 Å away
    expect(s.contains(220, 220, 0, -40)).toBe(true);
    expect(s.contains(240, 0, 0, -39)).toBe(false);
    const out = run(
      MesoPackResolver,
      job(
        [
          {
            id: 'p',
            compartment: 'outer',
            location: 'interior',
            requested: 3000,
            radius: 20,
            arrangement: { kind: 'random' },
          },
        ],
        {
          outer: {
            shape: { kind: 'sphere', center: [0, 0, 0], radius: 700 },
            children: ['child'],
            membrane: { thickness: 40 },
          },
          child: {
            shape: { kind: 'mesh' },
            mesh: cubeMesh(200),
            meshKey: 'k',
            parent: 'outer',
            membrane: { thickness: 40 },
          },
        },
      ),
    );
    const set = out.sets[0];
    expect(set.count).toBeGreaterThan(1000);
    let bad = 0;
    for (let i = 0; i < set.count; i++)
      if (boxDistance(set.positions[3 * i], set.positions[3 * i + 1], set.positions[3 * i + 2], 200) < 40 - 1e-3) bad++;
    expect(bad).toBe(0);
  });

  it('the inside test does not count a ray through a shared edge twice', () => {
    const s = shapeSampler({ kind: 'mesh' } as never, cubeMesh(100))!;
    for (const p of [
      [0, 0, 0],
      [0, 10, 10],
      [0, -30, -30],
      [50, 50, 50],
    ])
      expect(s.contains(p[0], p[1], p[2], 0)).toBe(true);
    const g = sdfGrid(s, createRandom(3), 41);
    let wrong = 0;
    for (let i = 0; i < g.n; i++)
      for (let j = 0; j < g.n; j++)
        for (let k = 0; k < g.n; k++) {
          const x = g.min[0] + i * g.cell,
            y = g.min[1] + j * g.cell,
            z = g.min[2] + k * g.cell;
          if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) < 90 && g.distance(x, y, z) > 0) wrong++;
        }
    expect(wrong).toBe(0);
  });
});

const latticePop = (id: string, requested: number, radius = 20) => ({
  id,
  compartment: 'c',
  location: 'membrane',
  requested,
  radius,
  arrangement: { kind: 'lattice', lattice: 'hexagonal', spacing: 50, vacancy: 0 },
});
const membrane = { c: { shape: { kind: 'sphere', center: [0, 0, 0], radius: 500 }, membrane: { thickness: 40 } } };

/** The smallest gap between copies of set `a` (type ta) and set `b` (type tb), minus their radii. */
function minGap(a: PlacementSet, b: PlacementSet, ta?: number, tb?: number) {
  let min = Infinity;
  for (let i = 0; i < a.count; i++) {
    if (ta !== undefined && a.types[i] !== ta) continue;
    for (let k = 0; k < b.count; k++) {
      if (tb !== undefined && b.types[k] !== tb) continue;
      const d = Math.hypot(
        a.positions[3 * i] - b.positions[3 * k],
        a.positions[3 * i + 1] - b.positions[3 * k + 1],
        a.positions[3 * i + 2] - b.positions[3 * k + 2],
      );
      min = Math.min(min, d - a.typeTable[a.types[i]].radius - b.typeTable[b.types[k]].radius);
    }
  }
  return min;
}

describe('meso.lattice', () => {
  it('a negative or any seed gives a patch (no NaN pole)', () => {
    for (const seed of [-5, 0, 997, 1]) {
      const out = run(MesoLatticeResolver, job([latticePop('p', 10)], membrane, { seed }));
      expect(out.achieved.p).toBe(10);
      expect(Array.from(out.sets[0].positions).every(Number.isFinite)).toBe(true);
    }
  });

  it('two lattice populations on one membrane do not share sites', () => {
    const out = run(MesoLatticeResolver, job([latticePop('a', 30), latticePop('b', 30)], membrane));
    expect(out.achieved).toEqual({ a: 30, b: 30 });
    expect(minGap(out.sets[0], out.sets[0], 0, 1)).toBeGreaterThanOrEqual(0);
  });

  it('two lattice models with the same seed put their patches in different places', () => {
    const first = (model: string) =>
      Array.from(
        run(MesoLatticeResolver, job([latticePop('p', 10)], membrane, { model })).sets[0].positions.slice(0, 3),
      );
    expect(first('m.one')).not.toEqual(first('m.two'));
  });

  it('skips the sites an obstacle takes', () => {
    const plain = run(MesoLatticeResolver, job([latticePop('p', 30)], membrane)).sets[0];
    const s0 = [plain.positions[0], plain.positions[1], plain.positions[2]] as [number, number, number];
    const obstacle = setOf(1, () => s0, { population: 'x', compartment: 'c', radius: 30 }, 'm.x');
    const out = run(MesoLatticeResolver, job([latticePop('p', 30)], membrane, { obstacles: [obstacle] }));
    expect(out.achieved.p).toBe(30);
    expect(minGap(out.sets[0], obstacle)).toBeGreaterThanOrEqual(0);
  });
});

describe('meso.fiber and obstacles', () => {
  it('a grown filament steps around the copies of the models it avoids', () => {
    // a wall of obstacles across the middle of a box the filaments grow in
    const wall: [number, number, number][] = [];
    for (let y = -380; y <= 380; y += 40) for (let z = -380; z <= 380; z += 40) wall.push([0, y, z]);
    const obstacles = setOf(wall.length, (i) => wall[i], { population: 'x', compartment: 'c', radius: 25 }, 'm.x');
    const grown = {
      ...strand('f', 4000, []),
      arrangement: { kind: 'fiber', rise: 10, twist: 0, growth: { persistence: 300, length: 1000, count: 40 } },
    };
    const out = run(
      MesoFiberResolver,
      job(
        [grown],
        { c: { shape: { kind: 'box', center: [0, 0, 0], size: [800, 800, 800] } } },
        { obstacles: [obstacles] },
      ),
    );
    expect(out.achieved.f).toBeGreaterThan(0);
    expect(minGap(out.sets[0], obstacles)).toBeGreaterThanOrEqual(0);
  });

  it('a traced path through an obstacle is kept (the observation) and the overlap reported', () => {
    const obstacles = setOf(1, () => [100, 0, 0], { population: 'x', compartment: 'c', radius: 20 }, 'm.x');
    const out = run(MesoFiberResolver, job([strand('f', 21, line(10, 20))], bigSphere, { obstacles: [obstacles] }));
    expect(out.achieved.f).toBe(21);
    expect(
      out.issues?.some(
        (i) => i.severity === 'warning' && /f follows a traced path: \d+ copies overlap/.test(i.message),
      ),
    ).toBe(true);
  });
});
