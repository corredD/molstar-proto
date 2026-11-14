/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { CCP4Writer } from '@molstar/model/formats/writer/ccp4/ccp4';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { sceneVolumes } from '../fit.js';
import { decoratorUnder, type PaintStroke, ParticleListPainted } from '../paint.js';
import type { PaintGroup } from '../paint-group.js';
import { pluginPaintHost } from '../paint-host.js';
import { MesoscaleExtension } from '../prism-viewer.js';
import { crnAtoms, density, type Site } from './density.js';
import { setTestTargetStructure, TestTargetList } from './fixtures.js';

// The night lanes together (me/night-integration): a group brush (paint-group) fitted to a density (density-fit), grown
// by Symmetry (symmetry) and by a fitted Tiling, Place Auto (decisions) for a group brush.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
}

async function viewer() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
  });
  viewers.push(v);
  const crn = readFileSync(new URL('../../../../../data/examples/1crn.cif', import.meta.url));
  expectOk(await v.api.load.files({ files: [new File([crn], '1crn.cif')] }));
  setTestTargetStructure(v.plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data);
  await v.plugin.build().toRoot().apply(TestTargetList).commit();
  expectOk(await v.api.particles.representation({ type: 'target' }));
  return v;
}

const entry = (v: PrismViewer) => v.plugin.managers.particles.hierarchy.current.lists[0];
const ref = (v: PrismViewer) => entry(v).cell.transform.ref;
const drawn = (v: PrismViewer) =>
  (entry(v).representations[0].cell.obj!.data as unknown as { sourceData: ParticleList }).sourceData;
const params = (v: PrismViewer) =>
  decoratorUnder(v.plugin.state.data, ref(v), ParticleListPainted)?.transform.params as {
    strokes: PaintStroke[];
    groups?: PaintGroup[];
  };
const xyz = (l: ParticleList, i: number) => Vec3.fromArray(Vec3(), l.coordinates, i * 3);
const quat = (l: ParticleList, i: number) => Quat.fromArray(Quat(), l.rotations!, i * 4);
const sitesOf = (l: ParticleList, from: number, to: number): Site[] => {
  const out: Site[] = [];
  for (let i = from; i < to; ++i) out.push({ position: xyz(l, i), rotation: quat(l, i) });
  return out;
};

/** Three copies of CA and NC close together (7, 8, 9), then a group of them (paint-group-operation.test.ts's) */
async function grouped(v: PrismViewer) {
  expectOk(
    await v.api.run('mesoscale.paint', {
      entity: 'CA',
      positions: [100, 0, 0, 120, 0, 0],
      normals: [0, 0, 1, 0, 0, 1],
      seed: 1,
    }),
  );
  expectOk(await v.api.run('mesoscale.paint', { entity: 'NC', positions: [110, 15, 0], normals: [0, 0, 1], seed: 2 }));
  const r = await v.api.run('mesoscale.group', { particles: ref(v), indices: [7, 8, 9] });
  expectOk(r);
  return r.value as { group: number; members: number };
}

/** A copy of group `id` painted at `at`, +z up, no spin (the list's first 10 particles before it) */
const paintGroup = (v: PrismViewer, id: number, at: number[], extra: Record<string, unknown> = {}) =>
  v.api.run('mesoscale.paint', {
    entity: '',
    group: id,
    positions: at,
    normals: [0, 0, 1],
    orient: 'normal',
    spin: 0,
    ...extra,
  });

/** An MRC of 1CRN at the sites (Dark, noise 0.1 of its peak) covering them with a margin of 30 Å, a voxel 2 Å */
async function loadMap(v: PrismViewer, sites: readonly Site[]) {
  const lo = Vec3.create(Infinity, Infinity, Infinity);
  const hi = Vec3.create(-Infinity, -Infinity, -Infinity);
  for (const s of sites) {
    Vec3.min(lo, lo, s.position);
    Vec3.max(hi, hi, s.position);
  }
  const origin = Vec3.subScalar(Vec3(), lo, 30);
  const size = [0, 1, 2].map((c) => Math.ceil((hi[c] - lo[c] + 60) / 2)) as [number, number, number];
  const { grid, data } = density(crnAtoms(), sites, { origin, size, voxel: 2, blur: 2, noise: 0.1, seed: 3 });
  expectOk(await v.api.load.files({ files: [new File([CCP4Writer.writeMrc(grid, data)], 'tomo.mrc')] }));
  return sceneVolumes(v.plugin.state.data)[0].ref;
}

describe('a group brush fitted to a density', () => {
  it("is fitted as a ball of the group's radius (not 10 Å), the host's radius the same", async () => {
    const v = await viewer();
    const g = await grouped(v);
    const group = params(v).groups![0];
    expect(group.radius).toBeGreaterThan(15);
    // the group's leaves where a copy painted at S puts them: the map's sites
    const S = [80, 80, 50];
    expectOk(await paintGroup(v, g.group, S));
    const sites = sitesOf(drawn(v), 10, 13);
    expectOk(await v.api.run('history.undo', {}));
    const volume = await loadMap(v, sites);
    // painted 6 Å off: past a 10 Å ball's reach (a third of it), within the group's
    expectOk(await paintGroup(v, g.group, [S[0] + 6, S[1], S[2]], { fit: volume }));
    const s = params(v).strokes.at(-1)!;
    expect(s.group).toBe(g.group);
    expect(s.fit?.shift[0]).toBeGreaterThan(10 / 3 + 0.5);
    expect(Vec3.distance(Vec3.fromArray(Vec3(), s.positions, 0), Vec3.create(S[0], S[1], S[2]))).toBeLessThan(2.5);
    // its leaves drawn at the fitted copy's pose
    expect(drawn(v).count).toBe(13);
    // the copy under the pointer's radius: the group's
    const host = pluginPaintHost(v.plugin, async () => ({ ok: true }));
    expect(host.radius({ particles: ref(v), entity: g.group, name: group.name, group: g.group })).toBe(group.radius);
    // a group brush is not upright: Place Auto goes to Surface over a mesh as for any brush (decisions 2)
    expect(host.upright({ particles: ref(v), entity: g.group, name: group.name, group: g.group })).toBe(false);
    host.dispose();
  });
});

describe('grown from a group copy', () => {
  it('by Symmetry (C6): five more group copies, each the source turned about the center', async () => {
    const v = await viewer();
    const g = await grouped(v);
    expectOk(await paintGroup(v, g.group, [0, 0, 300]));
    const r = await v.api.run('mesoscale.grow', { particles: ref(v), index: 11, mode: 'symmetry', group: 'c', n: 6 });
    expectOk(r);
    const grown = params(v).strokes.at(-1)!;
    expect(grown.group).toBe(g.group);
    expect(grown.positions.length / 3).toBe(5);
    const out = drawn(v);
    expect(out.count).toBe(13 + 15);
    // the six copies' centers on a ring: one distance from their mean
    const centers = [Vec3.fromArray(Vec3(), params(v).strokes.at(-2)!.positions, 0)];
    for (let k = 0; k < 5; ++k) centers.push(Vec3.fromArray(Vec3(), grown.positions, k * 3));
    const mean = centers.reduce((a, c) => Vec3.add(a, a, c), Vec3());
    Vec3.scale(mean, mean, 1 / 6);
    const r0 = Vec3.distance(centers[0], mean);
    expect(r0).toBeGreaterThan(5);
    for (const c of centers) expect(Vec3.distance(c, mean)).toBeCloseTo(r0, 2);
    // each copy's leaves as the source's: their distances kept
    const d = (i: number, j: number) => Vec3.distance(xyz(out, i), xyz(out, j));
    for (let k = 0; k < 5; ++k) {
      const b = 13 + 3 * k;
      expect(d(b, b + 1)).toBeCloseTo(d(10, 11), 3);
      expect(d(b, b + 2)).toBeCloseTo(d(10, 12), 3);
      expect(d(b + 1, b + 2)).toBeCloseTo(d(11, 12), 3);
    }
  });

  it('by a fitted Tiling: works, its copies kept only on the filled sites (a ball of the group radius)', async () => {
    const v = await viewer();
    const g = await grouped(v);
    expectOk(await paintGroup(v, g.group, [80, 80, 50]));
    const tiling = { particles: ref(v), index: 11, mode: 'tiling', pattern: 'square', spacing: 60, count: 9 };
    expectOk(await v.api.run('mesoscale.grow', tiling));
    const all = params(v).strokes.at(-1)!.positions;
    expect(all.length / 3).toBe(8);
    // the source and every other grown copy filled
    const filled = new Set([0, 2, 4, 6]);
    const sites = sitesOf(drawn(v), 10, 13);
    for (const k of filled) sites.push(...sitesOf(drawn(v), 13 + 3 * k, 16 + 3 * k));
    expectOk(await v.api.run('history.undo', {}));
    const volume = await loadMap(v, sites);
    const r = await v.api.run('mesoscale.grow', { ...tiling, fit: volume, threshold: 0.7 });
    expectOk(r);
    const kept = params(v).strokes.at(-1)!;
    expect(kept.group).toBe(g.group);
    // Count counts the copies kept (density-fit): the filled four, none on an empty site
    const n = kept.positions.length / 3;
    expect(n).toBe(4);
    expect(drawn(v).count).toBe(13 + 3 * n);
    for (let i = 0; i < n; ++i) {
      const p = Vec3.fromArray(Vec3(), kept.positions, i * 3);
      const near = (k: number) => Vec3.distance(p, Vec3.fromArray(Vec3(), all, k * 3));
      const nearest = [...Array(8).keys()].sort((a, b) => near(a) - near(b))[0];
      expect(filled.has(nearest)).toBe(true);
      expect(near(nearest)).toBeLessThan(5);
    }
  });
});
