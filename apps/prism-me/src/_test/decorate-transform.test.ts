/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import type { Sphere3D } from '@molstar/core/math/geometry';
import { CryoetExtension } from '@molstar/cryoet-extension/prism-viewer';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { StageToolsExtension } from '@molstar/stage-tools-extension/prism-viewer';
import { afterEach, describe, expect, it } from 'vitest';

// A particle list decorated with a structure under the list's transform (stage-tools' `stage.scale` and `stage.move`,
// cryoet's `cryoet.decorate`: both extensions, so the app's test), in either order (Ludo, 2026-10-31): the decoration
// applies, and the decorations' render objects are bounded where their particles are (else the camera's near and far
// planes and the culling, from those bounds, drop them when zooming in).

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
}

const star = 'data_particles\n\nloop_\n_rlnCoordinateX\n_rlnCoordinateY\n_rlnCoordinateZ\n10 0 0\n20 0 0\n30 5 0\n';

/** Three atoms about 2 Å apart, a small structure to decorate with */
const pdb = [
  'ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00  0.00           N',
  'ATOM      2  CA  ALA A   1       1.458   0.000   0.000  1.00  0.00           C',
  'ATOM      3  C   ALA A   1       2.009   1.420   0.000  1.00  0.00           C',
  'END',
].join('\n');

async function setup() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), StageToolsExtension, CryoetExtension] },
  });
  viewers.push(v);
  expectOk(await v.api.load.files({ files: [new File([star], 'p.star'), new File([pdb], 'ala.pdb')] }));
  const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
  const structure = [...v.plugin.state.data.cells.values()].find((c) => c.obj?.type.name === 'Structure')!.transform
    .ref;
  const decorate = () => v.api.cryoet!.decorate({ particles: list, with: 'object', object: structure } as never);
  return { v, list, decorate };
}

/** The decorations' representation: its list (as it takes it) and its render objects' bounds */
function decorations(v: PrismViewer) {
  for (const c of v.plugin.state.data.cells.values()) {
    const repr = (c.obj?.data as { repr?: { label: string; renderObjects: readonly any[] } } | undefined)?.repr;
    if (repr?.label !== 'Particle Target') continue;
    const list = (c.transform.parent && v.plugin.state.data.cells.get(c.transform.parent)?.obj?.data) as ParticleList;
    return { list, spheres: repr.renderObjects.map((ro) => ro.values.boundingSphere.ref.value as Sphere3D) };
  }
  return undefined;
}

/** Every particle of the list (drawn moved by `drawn`: a handle's preview) in one of the render objects' bounds */
function expectBounded(v: PrismViewer, drawn = Mat4.identity()) {
  const d = decorations(v);
  expect(d?.spheres.length).toBeGreaterThan(0);
  const p = Vec3();
  for (let i = 0; i < d!.list.count; ++i) {
    Vec3.transformMat4(p, Vec3.fromArray(p, d!.list.coordinates, i * 3), drawn);
    expect(d!.spheres.some((s) => Vec3.distance(p, s.center) <= s.radius + 1e-3)).toBe(true);
  }
  return d!;
}

describe('decorations under a list transform', () => {
  it('decorates a scaled list', async () => {
    const { v, list, decorate } = await setup();
    expectOk(await v.api.run('stage.scale', { target: list, scale: 10 }));
    expectOk(await decorate());
    const d = expectBounded(v);
    expect(d.list.targetMapping?.size).toBe(1);
    expect(d.list.coordinates[6]).toBeCloseTo(300);
    // the list's transform, under the decoration now, is the one the stage reads and moves: its scale kept, a move
    // after it (not scaled again), no second transform
    expect((await v.api.run('stage.scale', { target: list, scale: 10 })).ok).toBe(true);
    expect(decorations(v)!.list.coordinates[6]).toBeCloseTo(300);
    const right = Mat4.fromTranslation(Mat4(), Vec3.create(50, 0, 0));
    expectOk(await v.api.run('stage.move', { target: list, matrix: Array.from(right) }));
    expect(expectBounded(v).list.coordinates[6]).toBeCloseTo(350);
    const transforms = [...v.plugin.state.data.cells.values()].filter(
      (c) => c.transform.transformer.id === 'ms-plugin.particle-list-transform',
    );
    expect(transforms.length).toBe(1);
  });

  it("keeps the decorations' bounds on their particles when the list is scaled, then moved", async () => {
    const { v, list, decorate } = await setup();
    expectOk(await decorate());
    expectBounded(v);
    expectOk(await v.api.run('stage.scale', { target: list, scale: 10 }));
    expect(expectBounded(v).list.coordinates[6]).toBeCloseTo(300);
    const up = Mat4.fromTranslation(Mat4(), Vec3.create(0, 0, 500));
    expectOk(await v.api.run('stage.move', { target: list, matrix: Array.from(up) }));
    expect(expectBounded(v).list.coordinates[8]).toBeCloseTo(500);
    // a handle's drag: drawn moved before its release commits the move
    const down = Mat4.fromTranslation(Mat4(), Vec3.create(0, 0, -800));
    v.api.stage!.previewMove(list, down);
    expectBounded(v, down);
    v.api.stage!.previewMove(list, Mat4.identity());
    expectBounded(v);
  });
});
