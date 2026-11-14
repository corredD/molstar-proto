/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Quat, Tensor, Vec3 } from '@molstar/core/math/linear-algebra';
import { CCP4Writer } from '@molstar/model/formats/writer/ccp4/ccp4';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { envelopeOf, fitMapOf, fitPose, fitScore, PaintReach, sceneVolumes, SurfaceTilt } from '../fit.js';
import { sceneMeshes } from '../mesh-surface.js';
import { MesoscaleExtension } from '../prism-viewer.js';
import { angleBetween, crnAtoms, crnSites, density, gridOf, seeded, type Site, turn } from './density.js';
import { setTestTargetStructure, TestTargetList } from './fixtures.js';

// A fit on a surface (Ludo, 2026-11-14, real data: 8CKV hexamers on HIV capsids): a capsid's wall is a lattice, dark
// along it (its neighbours), bright off it. A copy placed on the mesh, not fitted, scores about 0 there (inside − a
// shell half on its dark neighbours), so a grow from it was refused; and a fit free in space moved the copies off the
// surface. On a surface the copy stays on it and is scored against the wall's two sides only; a grow keeps copies by
// the source's score fitted there (not moved). The grows: a sphere (a vesicle's mesh, an OBJ), a dark wall on half of
// it with a lattice of 1CRN in it, darker; and a plane, the source in a hole of a lattice.

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
const drawn = (v: PrismViewer) =>
  (entry(v).representations[0].cell.obj!.data as unknown as { sourceData: ParticleList }).sourceData;
const xyz = (l: ParticleList, i: number) => Vec3.fromArray(Vec3(), l.coordinates, i * 3);
const quat = (l: ParticleList, i: number) => Quat.fromArray(Quat(), l.rotations!, i * 4);

/** The sphere's center and radius (Å), its OBJ fine enough to be the sphere within 0.1 Å */
const C = Vec3.create(150, 150, 0);
const R = 100;
function sphereObj(nu = 192, nv = 96): string {
  const v: string[] = [];
  const f: string[] = [];
  for (let j = 0; j <= nv; j++) {
    const th = (Math.PI * j) / nv;
    for (let i = 0; i < nu; i++) {
      const ph = (2 * Math.PI * i) / nu;
      v.push(
        `v ${C[0] + R * Math.sin(th) * Math.cos(ph)} ${C[1] + R * Math.sin(th) * Math.sin(ph)} ${C[2] + R * Math.cos(th)}`,
      );
    }
  }
  const id = (i: number, j: number) => j * nu + (i % nu) + 1;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      if (j > 0) f.push(`f ${id(i, j)} ${id(i, j + 1)} ${id(i + 1, j)}`);
      if (j < nv - 1) f.push(`f ${id(i + 1, j)} ${id(i, j + 1)} ${id(i + 1, j + 1)}`);
    }
  }
  return `${v.join('\n')}\n${f.join('\n')}\n`;
}

/**
 * The tomogram: a dark wall about the sphere (σ 4 Å, its middle 3 Å out of the mesh, as a segmentation's surface is
 * one face of a wall) where x ≥ `from`, 1CRN darker at the filled sites, noise 0.1 of the peak; a voxel 2 Å
 */
function tomogram(filled: readonly Site[], from: number) {
  const voxel = 2;
  const size: [number, number, number] = [150, 150, 70];
  const origin = Vec3();
  const atoms = crnAtoms();
  const { data } = density(atoms, filled, { origin, size, voxel, blur: 2, noise: 0, contrast: 'bright' });
  let peak = 0;
  for (let i = 0; i < data.length; ++i) peak = Math.max(peak, data[i]);
  const space = Tensor.Space(size, [2, 1, 0], Float32Array);
  const r = seeded(9);
  const p = Vec3();
  for (let k = 0; k < size[2]; ++k)
    for (let j = 0; j < size[1]; ++j)
      for (let i = 0; i < size[0]; ++i) {
        Vec3.set(p, i * voxel, j * voxel, k * voxel);
        const d = Vec3.distance(p, C) - R - 3;
        const wall = 1 / (1 + Math.exp(-(p[0] - from) / 2));
        const o = space.dataOffset(i, j, k);
        const noise = 0.1 * peak * Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
        data[o] = -(data[o] + 0.4 * peak * wall * Math.exp(-(d * d) / 32) + noise);
      }
  return CCP4Writer.writeMrc(gridOf(space, data, origin, voxel), data);
}

/** A lattice of 1CRN in the plane z = 40 (`spacing` Å, unturned), Dark, a dark wall about it of `wall` × its peak */
function latticeMap(spacing: number, wall: number, noise = 0) {
  const voxel = 2;
  const size: [number, number, number] = [80, 80, 40];
  const sites: Site[] = [];
  for (let i = -3; i <= 3; ++i)
    for (let j = -3; j <= 3; ++j)
      sites.push({ position: Vec3.create(80 + i * spacing, 80 + j * spacing, 40), rotation: Quat.identity() });
  const { data } = density(crnAtoms(), sites, {
    origin: Vec3(),
    size,
    voxel,
    blur: 2,
    noise,
    seed: 2,
    contrast: 'bright',
  });
  let peak = 0;
  for (let i = 0; i < data.length; ++i) peak = Math.max(peak, data[i]);
  const space = Tensor.Space(size, [2, 1, 0], Float32Array);
  for (let k = 0; k < size[2]; ++k)
    for (let j = 0; j < size[1]; ++j)
      for (let i = 0; i < size[0]; ++i) {
        const o = space.dataOffset(i, j, k);
        const d = k * voxel - 40;
        data[o] = -(data[o] + wall * peak * Math.exp(-(d * d) / 32));
      }
  return fitMapOf(gridOf(space, data, Vec3(), voxel))!;
}

describe('a fit on a surface', () => {
  const envelope = envelopeOf({ kind: 'sites', sites: crnSites() }, 0);
  const up = Vec3.create(0, 0, 1);
  const options = { reach: PaintReach.shift * envelope.radius, turn: PaintReach.turn, contrast: 'dark' as const };

  it('shifts the copy along the surface only, turns it about the normal and tilts it 5° at most', () => {
    const map = latticeMap(40, 0.2, 0.1);
    // 5 Å over the surface, 3 Å along it and 12° off a site (about a tilted axis)
    const from = { position: Vec3.create(83, 80, 45), rotation: turn(Vec3.create(1, 0, 1), 12) };
    const free = fitPose(map, envelope, from, options);
    const on = fitPose(map, envelope, from, { ...options, normal: up });
    // free, it leaves the surface (toward the lattice's plane); on it, it stays
    expect(Math.abs(free.position[2] - 45)).toBeGreaterThan(1);
    expect(Math.abs(on.position[2] - 45)).toBeLessThan(1e-6);
    // its turn tilts the surface's normal SurfaceTilt at most
    const turned = Quat.multiply(Quat(), on.rotation, Quat.conjugate(Quat(), from.rotation));
    expect((Vec3.angle(up, Vec3.transformQuat(Vec3(), up, turned)) * 180) / Math.PI).toBeLessThan(SurfaceTilt + 0.01);
    expect(angleBetween(on.rotation, from.rotation)).toBeLessThan(PaintReach.turn + SurfaceTilt);
    // on the lattice's plane, 4 Å along it and 8° about the normal off a site: back onto it (its turn on a map without
    // noise: a small protein's turn is the weak part on a noisy one)
    const near = { position: Vec3.create(83, 82.6, 40), rotation: turn(up, 8) };
    const back = fitPose(latticeMap(40, 0.2), envelope, near, { ...options, normal: up });
    expect(Vec3.distance(back.position, Vec3.create(80, 80, 40))).toBeLessThan(1);
    expect(angleBetween(back.rotation, Quat.identity())).toBeLessThan(3);
  });

  it("scores a copy on a lattice's wall between two of its proteins above 0: the shell along the normal only", () => {
    // its neighbours along the surface as dark as a protein: the whole shell's score is below 0 there
    const map = latticeMap(30, 0);
    const gap = { position: Vec3.create(95, 95, 40), rotation: Quat.identity() };
    expect(fitScore(map, envelope, gap, 'dark')).toBeLessThan(0);
    expect(fitScore(map, envelope, gap, 'dark', up)).toBeGreaterThan(0);
    // on a site it is a site still
    const site = { position: Vec3.create(80, 80, 40), rotation: Quat.identity() };
    expect(fitScore(map, envelope, site, 'dark', up)).toBeGreaterThan(fitScore(map, envelope, gap, 'dark', up));
  });
});

describe('a grow on a mesh fitted to a density', () => {
  it('grows from a copy placed on the surface, unfitted: copies only where the wall is, all on the surface', async () => {
    const v = await viewer();
    const obj = sphereObj();
    expectOk(await v.api.load.files({ files: [new File([obj], 'vesicle.obj')] }));
    const mesh = sceneMeshes(v.plugin.state.data)[0].ref;
    const list = entry(v).cell.transform.ref;
    // the source on the sphere at 30° from its top toward +x, along its normal
    const n = Vec3.create(Math.sin(Math.PI / 6), 0, Math.cos(Math.PI / 6));
    const at = Vec3.scaleAndAdd(Vec3(), C, n, R);
    expectOk(
      await v.api.run('mesoscale.paint', {
        entity: 'CA',
        positions: Array.from(at),
        normals: Array.from(n),
        surface: true,
        orient: 'normal',
        seed: 1,
      }),
    );
    const index = drawn(v).count - 1;
    // the tiling's sites (unfitted), the source's counted
    const tiling = { particles: list, index, mode: 'tiling', pattern: 'hex', mesh, spacing: 36, count: 19, seed: 1 };
    expectOk(await v.api.run('mesoscale.grow', tiling));
    const grown = drawn(v);
    const sites: Site[] = [];
    for (let i = index; i < grown.count; ++i) sites.push({ position: xyz(grown, i), rotation: quat(grown, i) });
    expect(sites.length).toBe(19);
    expectOk(await v.api.run('history.undo', {}));
    // the wall on the source's +x side; its lattice the tiling's moved half a spacing along the surface (y), so the
    // source and every copy the rule draws are between two of its proteins
    const from = at[0] - 5;
    const filled: Site[] = [];
    let empty = 0;
    for (const s of sites) {
      if (s.position[0] < from) {
        empty++;
        continue;
      }
      const normal = Vec3.normalize(Vec3(), Vec3.sub(Vec3(), s.position, C));
      const t = Vec3.normalize(Vec3(), Vec3.cross(Vec3(), Vec3.cross(Vec3(), normal, Vec3.create(0, 1, 0)), normal));
      const moved = Vec3.scaleAndAdd(Vec3(), s.position, t, 18);
      Vec3.scaleAndAdd(moved, C, Vec3.normalize(moved, Vec3.sub(moved, moved, C)), R);
      filled.push({ position: moved, rotation: s.rotation });
    }
    expect(filled.length).toBeGreaterThan(5);
    expect(empty).toBeGreaterThan(3);
    expectOk(await v.api.load.files({ files: [new File([tomogram(filled, from)], 'tomo.mrc')] }));
    const volume = sceneVolumes(v.plugin.state.data)[0].ref;
    // Ludo's grow: Fit to the tomogram, Dark, Threshold 0.6
    const r2 = await v.api.run('mesoscale.grow', { ...tiling, fit: volume, contrast: 'dark', threshold: 0.6 });
    expectOk(r2);
    const after = drawn(v);
    const kept: Vec3[] = [];
    for (let i = index + 1; i < after.count; ++i) kept.push(xyz(after, i));
    expect(kept.length).toBeGreaterThanOrEqual(filled.length - 3);
    for (const q of kept) {
      // on the surface, on the wall's half (a copy's radius and its shift, 20 Å, past its edge at most)
      expect(Math.abs(Vec3.distance(q, C) - R)).toBeLessThan(0.5);
      expect(q[0]).toBeGreaterThan(from - 20);
    }
  });

  it("grows from a copy placed in a lattice's hole (refused before: its whole shell's score below 0)", async () => {
    const v = await viewer();
    const vs = [
      [0, 0, 40],
      [240, 0, 40],
      [240, 240, 40],
      [0, 240, 40],
    ];
    const obj = `${vs.map((x) => `v ${x.join(' ')}`).join('\n')}\nf 1 2 3\nf 1 3 4\n`;
    expectOk(await v.api.load.files({ files: [new File([obj], 'plane.obj')] }));
    const mesh = sceneMeshes(v.plugin.state.data)[0].ref;
    const list = entry(v).cell.transform.ref;
    expectOk(
      await v.api.run('mesoscale.paint', {
        entity: 'CA',
        positions: [120, 120, 40],
        normals: [0, 0, 1],
        surface: true,
        orient: 'normal',
        seed: 1,
      }),
    );
    const index = drawn(v).count - 1;
    const tiling = { particles: list, index, mode: 'tiling', pattern: 'hex', mesh, spacing: 30, count: 37, seed: 1 };
    expectOk(await v.api.run('mesoscale.grow', tiling));
    const grown = drawn(v);
    // the lattice: the tiling's sites moved into its holes (a triangle's center, s/√3 from three of them)
    const a = Vec3.sub(Vec3(), xyz(grown, index + 1), xyz(grown, index));
    const b = Vec3.sub(Vec3(), xyz(grown, index + 2), xyz(grown, index));
    if (Math.abs(Vec3.distance(a, b) - 30) > 0.5) Vec3.sub(b, xyz(grown, index + 3), xyz(grown, index));
    const hole = Vec3.scale(Vec3(), Vec3.add(Vec3(), a, b), 1 / 3);
    const sites: Site[] = [];
    for (let i = index; i < grown.count; ++i) {
      sites.push({ position: Vec3.add(Vec3(), xyz(grown, i), hole), rotation: quat(grown, i) });
    }
    expectOk(await v.api.run('history.undo', {}));
    const { grid, data } = density(crnAtoms(), sites, {
      origin: Vec3(),
      size: [120, 120, 40],
      voxel: 2,
      blur: 2,
      noise: 0.1,
      seed: 5,
    });
    expectOk(await v.api.load.files({ files: [new File([CCP4Writer.writeMrc(grid, data)], 'tomo.mrc')] }));
    const volume = sceneVolumes(v.plugin.state.data)[0].ref;
    expectOk(await v.api.run('mesoscale.grow', { ...tiling, fit: volume, contrast: 'dark', threshold: 0.6 }));
    const after = drawn(v);
    expect(after.count - 1 - index).toBeGreaterThan(5);
    for (let i = index + 1; i < after.count; ++i) expect(Math.abs(xyz(after, i)[2] - 40)).toBeLessThan(1e-3);
  });
});
