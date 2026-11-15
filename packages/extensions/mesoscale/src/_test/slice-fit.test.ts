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
import { growParams } from '../operations.js';
import { sliceParams } from '../slice-surface.js';
import { MesoscaleExtension } from '../prism-viewer.js';
import { crnAtoms, density, type Site } from './density.js';
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
    expectOk(await v.api.run('mesoscale.paint', { ...stroke, ...sliceParams(slice) }));
    const l = drawn(v);
    const on = xyz(l, l.count - 1);
    expect(Math.abs(on[2] - 40)).toBeLessThan(0.01);
    expect(tilt(quat(l, l.count - 1))).toBeLessThan(SurfaceTilt + 0.01);
    // pulled along the plane toward the site's foot (80, 80)
    expect(Math.hypot(on[0] - 80, on[1] - 80)).toBeLessThan(3);
  });
});

/** The painted strokes of the list (its grows' records) */
const strokes = (v: PrismViewer) =>
  (
    v.plugin.state.data.cells.get(entry(v).cell.transform.ref) &&
    [...v.plugin.state.data.cells.values()].find((c) => (c.transform.params as { strokes?: unknown })?.strokes)
  )?.transform.params as { strokes: { grow?: { slice?: unknown; params: Record<string, unknown> } }[] };

describe('paint on a slice, then off it (review 1)', () => {
  it('a stroke from a slice onto a mesh: its copies on the mesh fitted on it, those on the slice on the plane', async () => {
    const v = await viewer();
    const volume = await oneSite(v, 6);
    // its second copy on a mesh 12 Å over the plane (its normal +z), the site 6 Å under it
    const stroke = { entity: 'CA', positions: [83, 80, 40, 83, 80, 52], normals: [0, 0, 1, 0, 0, 1], seed: 1 };
    const slice = { volume, point: [0, 0, 40], normal: [0, 0, 1] };
    expectOk(await v.api.run('mesoscale.paint', { ...stroke, fit: volume, mesh: 'a-mesh', ...sliceParams(slice) }));
    const l = drawn(v);
    expect(Math.abs(xyz(l, l.count - 2)[2] - 40)).toBeLessThan(0.01);
    expect(Math.abs(xyz(l, l.count - 1)[2] - 52)).toBeLessThan(0.01);
  });
});

describe('a copy on a slice turned like on a surface, only there (review 5, 11)', () => {
  it('a stroke from the slice to a depth: its copy at the depth turned as before (at random); without normals, the plane’s', async () => {
    const v = await viewer();
    const volume = await oneSite(v, 0);
    const slice = { volume, point: [0, 0, 40], normal: [0, 0, 1] };
    // a brush that is no membrane protein: at random off a surface
    const stroke = { entity: 'loose', positions: [30, 30, 40, 30, 50, 70], normals: [0, 0, 1, 0, -0.6, 0.8], seed: 3 };
    const last = () => quat(drawn(v), drawn(v).count - 1);
    const first = () => quat(drawn(v), drawn(v).count - 2);
    expectOk(await v.api.run('mesoscale.paint', stroke));
    const random = last();
    expectOk(await v.api.run('history.undo', {}));
    expectOk(await v.api.run('mesoscale.paint', { ...stroke, ...sliceParams(slice) }));
    expect(tilt(first())).toBeLessThan(0.01);
    expect(Array.from(last())).toEqual(Array.from(random));
    expectOk(await v.api.run('history.undo', {}));
    // the API without normals: the slice's normal on it
    expectOk(
      await v.api.run('mesoscale.paint', { entity: 'loose', positions: [30, 30, 40], seed: 3, ...sliceParams(slice) }),
    );
    expect(tilt(last())).toBeLessThan(0.01);
  });
});

describe('grow from a copy on a slice', () => {
  /** A copy painted on the slice z = 40 of an empty 240 × 240 × 80 Å volume at (x, 120), along its normal */
  async function source(v: PrismViewer, x = 120) {
    const volume = await oneSite(v, 0);
    const slice = { volume, point: [0, 0, 40], normal: [0, 0, 1] };
    expectOk(
      await v.api.run('mesoscale.paint', {
        entity: 'CA',
        positions: [x, 120, 40],
        normals: [0, 0, 1],
        seed: 1,
        ...sliceParams(slice),
      }),
    );
    return { slice, list: entry(v).cell.transform.ref, index: drawn(v).count - 1 };
  }
  /** The copies from `from` on, all on the plane (|z − 40| < 0.01 Å); their count */
  const onThePlane = (v: PrismViewer, from: number) => {
    const l = drawn(v);
    for (let i = from; i < l.count; ++i) expect(Math.abs(xyz(l, i)[2] - 40)).toBeLessThan(0.01);
    return l.count - from;
  };

  it('Tiling, Sphere, Random walk and Spiral lay their copies on the plane, a copy’s up along its normal', async () => {
    const v = await viewer();
    const { slice, list, index } = await source(v);
    const grow = (p: object) =>
      v.api.run('mesoscale.grow', { particles: list, index, ...sliceParams(slice), seed: 1, ...p });
    expectOk(await grow({ mode: 'tiling', pattern: 'hex', spacing: 30, count: 19 }));
    expect(onThePlane(v, index + 1)).toBe(18);
    const l = drawn(v);
    for (let i = index + 1; i < l.count; ++i) expect(tilt(quat(l, i))).toBeLessThan(0.01);
    expectOk(await v.api.run('history.undo', {}));
    expectOk(await grow({ mode: 'sphere', count: 20, radius: 60, turn: 'source' }));
    expect(onThePlane(v, index + 1)).toBe(20);
    for (let i = index + 1; i < drawn(v).count; ++i) expect(tilt(quat(drawn(v), i))).toBeLessThan(0.01);
    expectOk(await v.api.run('history.undo', {}));
    for (const mode of [
      { mode: 'walk', steps: 20 },
      { mode: 'spiral', count: 30, spacing: 30 },
    ]) {
      expectOk(await grow(mode));
      expect(onThePlane(v, index + 1)).toBeGreaterThan(1);
      expectOk(await v.api.run('history.undo', {}));
    }
  });

  it('a Tiling at the slice’s edge stops at the volume’s box', async () => {
    const v = await viewer();
    const { slice, list, index } = await source(v, 10);
    expectOk(
      await v.api.run('mesoscale.grow', {
        particles: list,
        index,
        ...sliceParams(slice),
        mode: 'tiling',
        pattern: 'square',
        spacing: 30,
        count: 400,
      }),
    );
    // the box's 238 × 238 Å holds some 64 sites 30 Å apart (as the lattice is turned), not the 400 asked
    const n = onThePlane(v, index + 1);
    expect(n).toBeGreaterThan(40);
    expect(n).toBeLessThan(80);
    for (let i = index + 1; i < drawn(v).count; ++i) {
      const p = xyz(drawn(v), i);
      for (const c of [0, 1]) expect(p[c]).toBeGreaterThan(-1e-6);
      for (const c of [0, 1]) expect(p[c]).toBeLessThan(238 + 1e-6);
    }
  });

  it('a Helix along the plane or away from it: its axis through the source, every copy Radius from it (Ludo, 2026-11-14)', async () => {
    const v = await viewer();
    const { slice, list, index } = await source(v);
    const n = Vec3.create(0, 0, 1);
    const helix = {
      particles: list,
      index,
      ...sliceParams(slice),
      mode: 'helix',
      helixRadius: 15,
      pitch: 60,
      turns: 2,
    };
    const at = xyz(drawn(v), index);
    /** The copies' farthest off Radius from the line through the source along `d` */
    const worst = (d: Vec3) => {
      const l = drawn(v);
      let w = 0;
      for (let i = index + 1; i < l.count; ++i) {
        const r = Vec3.sub(Vec3(), xyz(l, i), at);
        w = Math.max(w, Math.abs(Vec3.magnitude(Vec3.scaleAndAdd(r, r, d, -Vec3.dot(r, d))) - 15));
      }
      return w;
    };
    for (const sliceAxis of ['along', 'normal'] as const) {
      expectOk(await v.api.run('mesoscale.grow', { ...helix, sliceAxis }));
      expect(drawn(v).count - index - 1).toBeGreaterThan(5);
      // away: the normal; along: a line of the plane (the best of its directions every 0.05°)
      let best = Infinity;
      if (sliceAxis === 'normal') best = worst(n);
      else {
        for (let t = 0; t < 180; t += 0.05) {
          best = Math.min(best, worst(Vec3.create(Math.cos((t * Math.PI) / 180), Math.sin((t * Math.PI) / 180), 0)));
        }
      }
      expect(best).toBeLessThan(0.1);
      expect(strokes(v).strokes.at(-1)!.grow!.params.sliceAxis).toBe(sliceAxis);
      expectOk(await v.api.run('history.undo', {}));
    }
  });

  it('refuses a Crystal, and a source off the slice', async () => {
    const v = await viewer();
    const { slice, list, index } = await source(v);
    const grow = (p: object) => v.api.run('mesoscale.grow', { particles: list, index, ...sliceParams(slice), ...p });
    expect(await grow({ mode: 'crystal' })).toMatchObject({ ok: false, code: 'invalid' });
    const off = { ...slice, point: [0, 0, 400] };
    expect(await grow({ mode: 'tiling', ...sliceParams(off) })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('keeps the slice with the grow: a session round-trip; a grow of an old session has none', async () => {
    const v = await viewer();
    const { slice, list, index } = await source(v);
    expectOk(
      await v.api.run('mesoscale.grow', { particles: list, index, ...sliceParams(slice), mode: 'tiling', count: 7 }),
    );
    expect(strokes(v).strokes.at(-1)!.grow!.slice).toMatchObject(slice);
    const snapshot = JSON.parse(JSON.stringify(v.plugin.state.data.getSnapshot()));
    await v.plugin.build().delete(list).commit();
    await v.plugin.runTask(v.plugin.state.data.setSnapshot(snapshot));
    expect(strokes(v).strokes.at(-1)!.grow!.slice).toMatchObject(slice);
    expectOk(await v.api.run('mesoscale.grow', { particles: list, index, mode: 'tiling', count: 7 }));
    expect(strokes(v).strokes.at(-1)!.grow!.slice).toBeUndefined();
  });

  it('with Fit to over a tomogram: copies only on the filled sites, all on the plane', async () => {
    const v = await viewer();
    const { slice, list, index } = await source(v);
    const tiling = {
      particles: list,
      index,
      ...sliceParams(slice),
      mode: 'tiling',
      pattern: 'hex',
      spacing: 36,
      count: 37,
      seed: 1,
    };
    expectOk(await v.api.run('mesoscale.grow', tiling));
    const grown = drawn(v);
    // the tiling's sites on the source's +x side filled (the source's too), the others empty
    const filled: Site[] = [];
    for (let i = index; i < grown.count; ++i) {
      if (xyz(grown, i)[0] >= 115) filled.push({ position: xyz(grown, i), rotation: quat(grown, i) });
    }
    expect(filled.length).toBeGreaterThan(10);
    expect(grown.count - index - filled.length).toBeGreaterThan(10);
    expectOk(await v.api.run('history.undo', {}));
    const { grid, data } = density(crnAtoms(), filled, {
      origin: Vec3(),
      size: [120, 120, 40],
      voxel: 2,
      blur: 2,
      noise: 0.1,
      seed: 5,
    });
    expectOk(await v.api.load.files({ files: [new File([CCP4Writer.writeMrc(grid, data)], 'tomo2.mrc')] }));
    const volume = sceneVolumes(v.plugin.state.data).find((x) => x.label.startsWith('tomo2'))!.ref;
    expectOk(
      await v.api.run('mesoscale.grow', {
        ...tiling,
        ...sliceParams({ ...slice, volume }),
        fit: volume,
        contrast: 'dark',
        threshold: 0.6,
      }),
    );
    const kept = onThePlane(v, index + 1);
    expect(kept).toBeGreaterThanOrEqual(filled.length - 4);
    expect(kept).toBeLessThan(filled.length);
    // each on a filled site (within a fit's shift)
    for (let i = index + 1; i < drawn(v).count; ++i) {
      const p = xyz(drawn(v), i);
      expect(Math.min(...filled.map((f) => Vec3.distance(f.position, p)))).toBeLessThan(3);
    }
  });
});

describe('Grow knows the slice', () => {
  it('a copy painted on a slice: Grow on it; a source picked on a shown slice: on it; another, none', async () => {
    const v = await viewer();
    const volume = await oneSite(v, 0);
    const m = v.api.mesoscale!;
    const list = entry(v).cell.transform.ref;
    const slice = { volume, point: [0, 0, 40], normal: [0, 0, 1] };
    const paintParams = { entity: 'CA', normals: [0, 0, 1], seed: 1, ...sliceParams(slice) };
    expectOk(await v.api.run('mesoscale.paint', { ...paintParams, positions: [120, 120, 40] }));
    const index = drawn(v).count - 1;
    // the paint mode's commit: its last copy the source, on the stroke's slice
    (m as unknown as { growFromLast(list: string, mesh?: string, slice?: object): void }).growFromLast(
      list,
      undefined,
      slice,
    );
    expect(m.growSource.value).toEqual({ particles: list, index });
    expect(m.growSettings.value.slice).toEqual(slice);
    expect(growParams(m.growSource.value!, { ...m.growSettings.value, mode: 'tiling' })).toMatchObject(
      sliceParams(slice),
    );
    // a crystal grows in space whatever On says
    expect(growParams(m.growSource.value!, { ...m.growSettings.value, mode: 'crystal' }).slice).toBeUndefined();
    // a helix on it (Ludo, 2026-11-14), its axis's choice; a mesh picked wins, the slice kept for later; None: in space,
    // the slice kept to pick again (review 4)
    expect(growParams(m.growSource.value!, { ...m.growSettings.value, mode: 'helix' })).toMatchObject({
      ...sliceParams(slice),
      sliceAxis: 'along',
    });
    const on = (patch: object) =>
      growParams(m.growSource.value!, { ...m.growSettings.value, mode: 'tiling', ...patch });
    expect(on({ mesh: 'a-mesh' })).toMatchObject({ mesh: 'a-mesh' });
    expect(on({ mesh: 'a-mesh' }).slice).toBeUndefined();
    expect(on({ inSpace: true }).slice).toBeUndefined();
    expect(on({ inSpace: false })).toMatchObject(sliceParams(slice));
    // picked (right-click): the slice shown under it, its plane then
    expectOk(await v.api.run('mesoscale.paint', { ...paintParams, positions: [60, 60, 40] }));
    expectOk(
      await v.api.run('volume.representation', {
        volume,
        type: 'slice',
        params: { dimension: { name: 'z', params: 20 } },
      }),
    );
    m.setGrowSource({ particles: list, index: index + 1 });
    expect(m.growSettings.value.slice?.volume).toBe(volume);
    expect(m.growSettings.value.slice!.point[2]).toBeCloseTo(40, 10);
    expect(Math.abs(m.growSettings.value.slice!.normal[2])).toBeCloseTo(1, 10);
    // a copy off the slice: none
    expectOk(await v.api.run('mesoscale.paint', { entity: 'CA', positions: [60, 60, 70], seed: 1 }));
    m.setGrowSource({ particles: list, index: index + 2 });
    expect(m.growSettings.value.slice).toBeUndefined();
  });
});

describe('the slice as the assistant and ⌘K give it (review 2)', () => {
  it('three plain params, text and vectors; an empty volume (their default) is no slice', async () => {
    const v = await viewer();
    for (const id of ['mesoscale.paint', 'mesoscale.grow']) {
      const params = v.api.describe(id)!.params;
      expect([params.slice.type, params.slicePoint.type, params.sliceNormal.type]).toEqual(['text', 'vec3', 'vec3']);
    }
    const volume = await oneSite(v, 0);
    const list = entry(v).cell.transform.ref;
    expectOk(await v.api.run('mesoscale.paint', { entity: 'CA', positions: [120, 120, 40], seed: 1 }));
    const index = drawn(v).count - 1;
    // the defaults all given (as the assistant does): in space
    const defaults = { slice: '', slicePoint: [0, 0, 0], sliceNormal: [0, 0, 1] };
    expectOk(await v.api.run('mesoscale.grow', { particles: list, index, mode: 'tiling', count: 7, ...defaults }));
    expect(strokes(v).strokes.at(-1)!.grow!.slice).toBeUndefined();
    // a slice without its plane: refused
    expect(
      await v.api.run('mesoscale.grow', { particles: list, index, mode: 'tiling', slice: volume, slicePoint: [1, 2] }),
    ).toMatchObject({ ok: false, code: 'invalid' });
  });
});
