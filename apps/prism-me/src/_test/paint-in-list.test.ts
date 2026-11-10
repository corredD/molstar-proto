/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { OrderedSet } from '@molstar/core/data/int';
import { ParticleListPainted } from '@molstar/mesoscale-extension/paint';
import { Particle, type ParticleList } from '@molstar/model/model/particles/particle-list';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { MesoscaleExplorerExtensions } from '../extensions.js';

// Painted copies are their list's particles (lane `paint-layer`, round 2; Ludo, 2026-11-10: "a painted copy can be
// edited, and can edit all of the same type"): moved alone or with their kind, decorated, picked and drawn by every
// representation as the list's own. And a structure of the scene paints into a list (Ludo: "The target of the paint is
// a particle list parent"): into a model as a new entity, or into the Painting list of an empty scene.

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
    spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
  });
  viewers.push(v);
  return v;
}

const lists = (v: PrismViewer) => v.plugin.managers.particles.hierarchy.current.lists;
/** A list's particles as its first representation draws them (its decorators', the copies with them) */
const drawn = (v: PrismViewer, k = 0) =>
  (lists(v)[k].representations[0].cell.obj!.data as unknown as { sourceData: ParticleList }).sourceData;
const xyz = (l: ParticleList, i: number) => Array.from(l.coordinates.slice(i * 3, i * 3 + 3)).map((x) => +x.toFixed(3));
const steps = (v: PrismViewer) => v.api.history.steps.value.length;
const star = 'data_particles\n\nloop_\n_rlnCoordinateX\n_rlnCoordinateY\n_rlnCoordinateZ\n10 0 0\n20 0 0\n';

async function loadCrn(v: PrismViewer) {
  const crn = readFileSync(new URL('../../../../data/examples/1crn.cif', import.meta.url));
  expectOk(await v.api.load.files({ files: [new File([crn], '1crn.cif')] }));
  return v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
}

describe('painted copies as their list’s particles', () => {
  it('moves a copy alone (its own instance) and with its kind (an offset of its target)', async () => {
    const v = await viewer();
    expectOk(await v.api.load.files({ files: [new File([star], 'p.star')] }));
    const ref = lists(v)[0].cell.transform.ref;
    expectOk(await v.api.run('mesoscale.paint', { entity: '0', positions: [0, 50, 0, 0, 60, 0], seed: 1 }));
    expect(drawn(v).count).toBe(4);
    // the model's particle 0 moved: the copies stay where they were painted
    expectOk(await v.api.run('cryoet.instance', { particles: ref, index: 0, x: 5 }));
    expect(xyz(drawn(v), 2)).toEqual([0, 50, 0]);
    expect(xyz(drawn(v), 3)).toEqual([0, 60, 0]);
    // a copy moved alone: the others as they were
    expectOk(await v.api.run('cryoet.instance', { particles: ref, index: 2, x: 5 }));
    expect(xyz(drawn(v), 2)).not.toEqual([0, 50, 0]);
    expect(xyz(drawn(v), 3)).toEqual([0, 60, 0]);
    // all of its kind: the copies with the file's particles
    const before = [xyz(drawn(v), 1), xyz(drawn(v), 3)];
    expectOk(await v.api.run('cryoet.offset', { particles: ref, targets: '', z: 7 }));
    expect(xyz(drawn(v), 1)).not.toEqual(before[0]);
    expect(xyz(drawn(v), 3)).not.toEqual(before[1]);
  });

  it('draws the copies in a representation added after the stroke, and picks a copy as its list’s particle', async () => {
    const v = await viewer();
    expectOk(await v.api.load.files({ files: [new File([star], 'p.star')] }));
    expectOk(await v.api.run('mesoscale.paint', { entity: '0', positions: [0, 50, 0], seed: 1 }));
    expectOk(await v.api.particles.representation({ type: 'orientation' }));
    for (const r of lists(v)[0].representations) {
      expect((r.cell.obj!.data as unknown as { sourceData: ParticleList }).sourceData.count).toBe(3);
    }
    const explorer = (v.api as unknown as { explorer: { particleOf(loci: unknown): unknown } }).explorer;
    const loci = Particle.Loci(drawn(v), OrderedSet.ofSingleton(2));
    expect(explorer.particleOf(loci)).toMatchObject({ list: lists(v)[0].cell.transform.ref, index: 2 });
  });
});

describe('a structure painted into a list', () => {
  it('paints into a model as a new entity of its name, one step; undo takes both away', async () => {
    const v = await viewer();
    expectOk(await v.api.load.files({ files: [new File([star], 'p.star')] }));
    const crn = await loadCrn(v);
    const ref = lists(v)[0].cell.transform.ref;
    const s = steps(v);
    const r = await v.api.run('mesoscale.paint', { structure: crn, particles: ref, positions: [0, 50, 0], seed: 1 });
    expectOk(r);
    expect(steps(v)).toBe(s + 1);
    const d = drawn(v);
    expect(d.count).toBe(3);
    const target = d.targetMapping?.get(d.targets[2]);
    expect(target?.kind).toBe('structure');
    expect(d.getParticleLabel(2).toLowerCase()).toContain('1crn');
    expectOk(await v.api.run('history.undo', {}));
    expect(drawn(v).count).toBe(2);
    expect(drawn(v).targetMapping?.get(drawn(v).targets[0])?.kind).not.toBe('structure');
  });

  it('paints into the Painting list of a scene without one: made in the stroke’s step; undo leaves nothing', async () => {
    const v = await viewer();
    const crn = await loadCrn(v);
    const s = steps(v);
    expectOk(await v.api.run('mesoscale.paint', { structure: crn, positions: [0, 0, 0, 30, 0, 0], seed: 1 }));
    expect(steps(v)).toBe(s + 1);
    expect(lists(v).length).toBe(1);
    expect(lists(v)[0].cell.obj!.label).toBe('Painting');
    expect(drawn(v).count).toBe(2);
    // a second stroke: the same list, its entity kept
    expectOk(await v.api.run('mesoscale.paint', { structure: crn, positions: [0, 30, 0], seed: 2 }));
    expect(lists(v).length).toBe(1);
    expect(drawn(v).count).toBe(3);
    expect(new Set(Array.from(drawn(v).targets)).size).toBe(1);
    expectOk(await v.api.run('history.undo', {}));
    expectOk(await v.api.run('history.undo', {}));
    expect(lists(v).length).toBe(0);
  });

  it('keeps a structure brush in a saved session: opened again, its copies are drawn', async () => {
    const v = await viewer();
    const crn = await loadCrn(v);
    expectOk(await v.api.run('mesoscale.paint', { structure: crn, positions: [0, 0, 0], seed: 1 }));
    const painted = Array.from(v.plugin.state.data.cells.values()).filter(
      (c) => c.transform.transformer === ParticleListPainted,
    );
    expect(painted.length).toBe(1);
    const snapshot = JSON.parse(JSON.stringify(v.plugin.state.data.getSnapshot()));
    await v.plugin.runTask(v.plugin.state.data.setSnapshot(snapshot));
    expect(drawn(v).count).toBe(1);
    expect(drawn(v).targetMapping?.get(drawn(v).targets[0])?.kind).toBe('structure');
  });
});
