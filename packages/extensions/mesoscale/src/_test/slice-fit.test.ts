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
import { SurfaceTilt, sceneVolumes } from '../fit.js';
import { MesoscaleExtension } from '../prism-viewer.js';
import { crnAtoms, density } from './density.js';
import { setTestTargetStructure, TestTargetList } from './fixtures.js';

// Fit and Grow on a slice (slice-constraint, Ludo 2026-11-14): a volume's slice is a surface as a mesh is. A copy
// painted on a slice with Fit to stays on its plane (its shift along it, its axis along the normal, tilted 5° at most);
// grown from it, every mode that takes a surface lays its copies on the plane, ending at the volume's box.

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
const up = Vec3.create(0, 0, 1);
/** The angle of a copy's +z (its axis along a surface: the brush's Fiber Axis unset) from the normal, ° */
const tilt = (q: Quat) => (Vec3.angle(Vec3.transformQuat(Vec3(), up, q), up) * 180) / Math.PI;

/** The plane z = 40 of a 120 × 120 × 40 voxel (2 Å) map, a 1CRN `off` Å above it at (80, 80) */
async function oneSite(v: PrismViewer, off: number) {
  const { grid, data } = density(crnAtoms(), [{ position: Vec3.create(80, 80, 40 + off), rotation: Quat.identity() }], {
    origin: Vec3(),
    size: [120, 120, 40],
    voxel: 2,
    blur: 2,
    noise: 0.05,
    seed: 3,
  });
  expectOk(await v.api.load.files({ files: [new File([CCP4Writer.writeMrc(grid, data)], 'tomo.mrc')] }));
  return sceneVolumes(v.plugin.state.data)[0].ref;
}

describe('paint on a slice with Fit to', () => {
  it('keeps the fitted copy on the plane, its axis within 5° of the normal; without the slice it leaves it', async () => {
    const v = await viewer();
    const volume = await oneSite(v, 6);
    const stroke = { entity: 'CA', positions: [83, 80, 40], normals: [0, 0, 1], seed: 1, fit: volume };
    // as before (a stroke on a slice, unconstrained): the fit moves it toward the density, off the plane
    expectOk(await v.api.run('mesoscale.paint', stroke));
    const free = xyz(drawn(v), drawn(v).count - 1);
    expect(free[2] - 40).toBeGreaterThan(1);
    expectOk(await v.api.run('history.undo', {}));
    // on the slice: its shift along the plane only, turned like on a surface (Turn Auto: along the normal)
    const slice = { volume, point: [0, 0, 40], normal: [0, 0, 1] };
    expectOk(await v.api.run('mesoscale.paint', { ...stroke, slice }));
    const l = drawn(v);
    const on = xyz(l, l.count - 1);
    expect(Math.abs(on[2] - 40)).toBeLessThan(0.01);
    expect(tilt(quat(l, l.count - 1))).toBeLessThan(SurfaceTilt + 0.01);
    // pulled along the plane toward the site's foot (80, 80)
    expect(Math.hypot(on[0] - 80, on[1] - 80)).toBeLessThan(3);
  });
});
