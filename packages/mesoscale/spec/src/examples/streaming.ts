/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Box, MesoViewSpecDoc, TileEntry, TileManifest } from '../format/doc.js';
import { createRandom, subSeed } from '../runtime/random.js';
import type { TilePayload, TileProvider } from '../runtime/streaming.js';

// The tiled fixture (design.md §6.8.6): a box of tiles, two populations, three instances as landmarks (inside a tile, on
// the boundary between two, in the last), and a provider that makes every tile's copies from a seed. No file: the
// document's `meso-tiles` resource has no uri, the provider is code.

export interface TiledFixtureOptions {
  /** Tiles per axis; default [4, 4, 2]. */
  readonly grid?: readonly [number, number, number];
  /** Å, default 2000 (200 nm, the yeast viewer's tile). */
  readonly tileSize?: number;
  /** Copies a tile per population; default { 'p.a': 300, 'p.b': 100 }. */
  readonly perTile?: Readonly<Record<string, number>>;
  readonly seed?: number;
  /** For tests: ms before a load resolves (abort tests), and tiles whose load rejects. */
  readonly delayMs?: number;
  readonly fail?: readonly string[];
}

const Radius: Readonly<Record<string, number>> = { 'p.a': 40, 'p.b': 60 };
const Populations = Object.keys(Radius);

export function tiledFixture(o: TiledFixtureOptions = {}): {
  readonly doc: MesoViewSpecDoc;
  readonly provider: TileProvider;
} {
  const [gx, gy, gz] = o.grid ?? [4, 4, 2];
  const size = o.tileSize ?? 2000;
  const perTile = o.perTile ?? { 'p.a': 300, 'p.b': 100 };
  const seed = o.seed ?? 1;
  const total = gx * gy * gz;
  const at = (i: number, j: number, k: number, f = 0.5): [number, number, number] => [
    (i + f) * size,
    (j + f) * size,
    (k + f) * size,
  ];
  const focus = (id: string, framing: 'fit' | 'context' = 'context') => ({
    id: `v.${id}`,
    camera: { focus: `(instance i.${id})`, framing },
  });
  const doc: MesoViewSpecDoc = {
    format: 'meso_view_spec',
    version: '0.2.0',
    metadata: { title: `tiled fixture, ${gx}x${gy}x${gz} tiles` },
    units: { length: 'A' },
    frames: [{ id: 'f.world', kind: 'world', units: 'A', handedness: 'right' }],
    resources: [{ id: 'r.tiles', kind: 'placements', format: 'meso-tiles', label: 'tiles', frame: 'f.world' }],
    entities: [
      { id: 'e.a', label: 'a', kind: 'protein', radius: Radius['p.a'] },
      { id: 'e.b', label: 'b', kind: 'protein', radius: Radius['p.b'] },
    ],
    compartments: [
      {
        id: 'c.box',
        label: 'box',
        kind: 'region',
        geometry: {
          kind: 'box',
          size: [gx * size, gy * size, gz * size],
          center: [(gx * size) / 2, (gy * size) / 2, (gz * size) / 2],
        },
      },
    ],
    populations: Populations.map((p) => ({
      id: p,
      entity: `e.${p.slice(2)}`,
      compartment: 'c.box',
      location: 'interior' as const,
      abundance: { count: total * (perTile[p] ?? 0) },
    })),
    instances: [
      { id: 'i.corner', entity: 'e.a', compartment: 'c.box', pose: { translation: at(0, 0, 0) } },
      // exactly on the boundary between tile 0 and tile 1 along x
      { id: 'i.middle', entity: 'e.a', compartment: 'c.box', pose: { translation: [size, size / 2, size / 2] } },
      { id: 'i.far', entity: 'e.a', compartment: 'c.box', pose: { translation: at(gx - 1, gy - 1, gz - 1) } },
    ],
    models: [
      {
        id: 'm.tiles',
        kind: 'precomputed',
        method: 'meso.stream',
        populations: Populations,
        stream: { resource: 'r.tiles' },
      },
    ],
    views: [
      { id: 'v.all', camera: { focus: '(population p.a)', framing: 'fit' } },
      focus('corner'),
      focus('middle'),
      focus('far'),
    ],
    session: { view: 'v.all', tour: 't.stream' },
    tours: [{ id: 't.stream', steps: ['v.all', 'v.corner', 'v.middle', 'v.far'].map((view) => ({ view })) }],
  };

  const shrink = (b: Box, r: number): Box => ({
    min: b.min.map((x) => x + r) as unknown as Box['min'],
    max: b.max.map((x) => x - r) as unknown as Box['max'],
  });
  const tiles: TileEntry[] = [];
  for (let i = 0; i < gx; i++)
    for (let j = 0; j < gy; j++)
      for (let k = 0; k < gz; k++) {
        const box: Box = { min: [i * size, j * size, k * size], max: [(i + 1) * size, (j + 1) * size, (k + 1) * size] };
        tiles.push({
          id: `t.${i}.${j}.${k}`,
          box,
          counts: Object.fromEntries(Populations.map((p) => [p, perTile[p] ?? 0])),
          envelopes: Object.fromEntries(Populations.map((p) => [p, shrink(box, Radius[p])])),
        });
      }
  const manifest: TileManifest = {
    format: 'meso-tiles',
    levels: [0, 1],
    bounds: { min: [0, 0, 0], max: [gx * size, gy * size, gz * size] },
    populations: Populations,
    tiles,
  };
  const wait = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const abort = () => (clearTimeout(timer), reject(new DOMException('aborted', 'AbortError')));
      const timer = setTimeout(() => (signal.removeEventListener('abort', abort), resolve()), ms);
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    });
  const provider: TileProvider = {
    manifest: async () => manifest,
    async load(id, _level, signal): Promise<TilePayload> {
      if (o.delayMs) await wait(o.delayMs, signal);
      else if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      if (o.fail?.includes(id)) throw new Error(`tile ${id} is unavailable`);
      const tile = tiles.find((t) => t.id === id);
      if (!tile) throw new Error(`no tile ${id}`);
      const rng = createRandom(subSeed(seed, id));
      const count = Populations.reduce((n, p) => n + (tile.counts[p] ?? 0), 0);
      const positions = new Float32Array(3 * count);
      const rotations = new Float32Array(4 * count);
      const types = new Int32Array(count);
      let c = 0;
      Populations.forEach((p, type) => {
        const e = tile.envelopes![p];
        for (let n = 0; n < tile.counts[p]; n++, c++) {
          for (let k = 0; k < 3; k++) positions[3 * c + k] = rng.range(e.min[k], e.max[k]);
          // a uniform unit quaternion (Shoemake)
          const [u1, u2, u3] = [rng.next(), rng.next(), rng.next()];
          const [a, b] = [Math.sqrt(1 - u1), Math.sqrt(u1)];
          rotations.set(
            [
              a * Math.sin(2 * Math.PI * u2),
              a * Math.cos(2 * Math.PI * u2),
              b * Math.sin(2 * Math.PI * u3),
              b * Math.cos(2 * Math.PI * u3),
            ],
            4 * c,
          );
          types[c] = type;
        }
      });
      return { count, positions, rotations, types };
    },
  };
  return { doc, provider };
}
