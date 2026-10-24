/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { OrderedSet } from '@molstar/core/data/int';
import { Vec3 } from '@molstar/core/math/linear-algebra';
import { clearFontAtlasCache, setCanvasModule } from '@molstar/graphics/geo/geometry/text/font-atlas';
import { Particle } from '@molstar/model/model/particles/particle-list';
import { StructureElement, StructureProperties, StructureSelection } from '@molstar/model/model/structure';
import { Script } from '@molstar/model/script/script';
import { ParticleListWithTargets } from '@molstar/plugin/state/transforms/particles/ops';
import { ParticlesRepresentation3D } from '@molstar/plugin/state/transforms/particles/representation';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { StageDistance } from '../distance.js';
import { StageToolsExtension } from '../prism-viewer.js';

// `stage.distance` on a headless viewer: 1CRN (crambin) from the repository's example data, and particle lists made
// in memory (apps/prism-me/_spec/ui.md §7).

// A distance's text is drawn into a font atlas, which Node has no canvas for: a stand-in context that draws nothing
// (as Prism's measurements test), unset after this file (the module is shared by the worker's files).
beforeAll(() => {
  const context = {
    measureText: () => ({ width: 8 }),
    clearRect() {},
    fillText() {},
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  };
  setCanvasModule({ createCanvas: () => ({ getContext: () => context }) });
});
afterAll(() => {
  setCanvasModule(undefined);
  clearFontAtlasCache();
});

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
}

const star = (rows: string) => `data_particles\n\nloop_\n_rlnCoordinateX\n_rlnCoordinateY\n_rlnCoordinateZ\n${rows}`;

async function viewer() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), StageToolsExtension] },
  });
  viewers.push(v);
  const crn = new File([readFileSync(new URL('../../../../../data/examples/1crn.cif', import.meta.url))], '1crn.cif');
  expectOk(await v.api.load.files({ files: [crn] }));
  return v;
}

/** One atom of 1CRN as loci (residue `seq`, atom `name`), and where it is */
function atom(v: PrismViewer, seq: number, name: string) {
  const structure = v.plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data;
  const selection = Script.getStructureSelection(
    (Q) =>
      Q.struct.generator.atomGroups({
        'residue-test': Q.core.rel.eq([Q.struct.atomProperty.macromolecular.label_seq_id(), seq]),
        'atom-test': Q.core.rel.eq([Q.struct.atomProperty.macromolecular.label_atom_id(), name]),
      }),
    structure,
  );
  const loci = StructureSelection.toLociWithSourceUnits(selection);
  const e = loci.elements[0];
  const loc = StructureElement.Location.create(structure, e.unit, e.unit.elements[OrderedSet.getAt(e.indices, 0)]);
  const at = Vec3.create(
    StructureProperties.atom.x(loc),
    StructureProperties.atom.y(loc),
    StructureProperties.atom.z(loc),
  );
  return { loci, at };
}

const distances = (v: PrismViewer) =>
  [...v.plugin.state.data.cells.values()].filter((c) => c.transform.transformer === StageDistance);

describe('stage.distance', () => {
  it('measures two atoms (Å, as their positions say), drawn by one cell, listed under its first pick', async () => {
    const v = await viewer();
    const s = v.api.stage!;
    const a = atom(v, 1, 'CA');
    const b = atom(v, 10, 'CA');
    const r = await s.distance({ a: { loci: a.loci }, b: { loci: b.loci }, node: 'e:x:1', nodeB: 'e:x:2' } as never);
    expectOk(r);
    expect(distances(v)).toHaveLength(1);
    const [d] = s.distancesState().value;
    expect(d.distance).toBeCloseTo(Vec3.distance(a.at, b.at), 3);
    expect(d.label).toBe(`${Vec3.distance(a.at, b.at).toFixed(2)} Å`);
    expect(d.node).toBe('e:x:1');
    expect(d.a.key).toBe('e:x:1');
    expect(d.b.key).toBe('e:x:2');
    expect(d.a.label).toBe('THR 1 CA (A)');
    // the same again: already so, no second one
    const again = await s.distance({
      a: { loci: a.loci },
      b: { loci: b.loci },
      node: 'e:x:1',
      nodeB: 'e:x:2',
    } as never);
    expect(again.ok && again.unchanged).toBe(true);
    expect(distances(v)).toHaveLength(1);
  });

  it("measures two particles by '<list ref>#<index>' (the agent's form), under the list when no row is given", async () => {
    const v = await viewer();
    const s = v.api.stage!;
    expectOk(await v.api.load.files({ files: [new File([star('10 0 0\n13 4 0\n')], 'p.star')] }));
    const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    expectOk(await s.distance({ a: `${list}#0`, b: `${list}#1` } as never));
    const [d] = s.distancesState().value;
    const c = distances(v)[0];
    expect(d.distance).toBeCloseTo(5, 5);
    expect(d.node).toBe(`o:${list}`);
    // an index past the list's end is said
    const bad = await s.distance({ a: `${list}#0`, b: `${list}#7` } as never);
    expect(bad.ok).toBe(false);
  });

  it('sizes its text and line to what it measures, times its options; one step each, one undo removes it', async () => {
    const v = await viewer();
    const s = v.api.stage!;
    const a = atom(v, 1, 'CA');
    const b = atom(v, 10, 'CA');
    expectOk(await s.distance({ a: { loci: a.loci }, b: { loci: b.loci } } as never));
    const props = () => distances(v)[0].obj!.data.repr.props as { textSize: number; linesSize: number; alpha: number };
    const atoms = { ...props() };
    // particles decorated by crambin (its radius about 15 Å): a larger text and line than between two atoms
    expectOk(await v.api.load.files({ files: [new File([star('0 0 0\n100 0 0\n')], 'p.star')] }));
    const listRef = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    const crn = v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
    await v.plugin
      .build()
      .to(listRef)
      .apply(ParticleListWithTargets, { targets: [{ targetId: 0, source: { name: 'ref', params: { ref: crn } } }] })
      .apply(ParticlesRepresentation3D, { type: { name: 'target', params: {} } } as never)
      .commit();
    const drawn = v.plugin.managers.particles.hierarchy.current.lists[0].representations.find(
      (r) => (r.cell.transform.params as { type?: { name?: string } }).type?.name === 'target',
    )!.cell.obj!.data.sourceData;
    const p0 = Particle.Loci(drawn, OrderedSet.ofSingleton(0));
    const p1 = Particle.Loci(drawn, OrderedSet.ofSingleton(1));
    expectOk(await s.distance({ a: { loci: p0 }, b: { loci: p1 } } as never));
    const particles = distances(v)[1].obj!.data.repr.props as { textSize: number; linesSize: number };
    expect(s.distancesState().value[1].distance).toBeCloseTo(100, 5);
    expect(particles.linesSize).toBeGreaterThan(atoms.linesSize * 5);
    expect(particles.textSize).toBeGreaterThan(atoms.textSize * 5);
    // its options: on its representation, in one step
    const ref = distances(v)[0].transform.ref;
    expectOk(await s.editDistance({ distance: ref, textSize: 2, lineWidth: 3, opacity: 0.5 } as never));
    expect(props().textSize).toBeCloseTo(atoms.textSize * 2, 6);
    expect(props().linesSize).toBeCloseTo(atoms.linesSize * 3, 6);
    expect(props().alpha).toBe(0.5);
    expectOk(await v.api.run('history.undo', {}));
    expect(props().alpha).toBe(1);
    // hidden and shown
    expectOk(await s.editDistance({ distance: ref, visible: false } as never));
    expect(s.distancesState().value[0].visible).toBe(false);
    // the second distance made: one undo removes it (and the hide stays)
    expectOk(await v.api.run('history.undo', {}));
    expectOk(await v.api.run('history.undo', {}));
    expect(distances(v)).toHaveLength(1);
  });

  it('goes with either of its objects, in the same step (its dependency); undone, it is back', async () => {
    const v = await viewer();
    const s = v.api.stage!;
    expectOk(await v.api.load.files({ files: [new File([star('10 0 0\n13 4 0\n')], 'p.star')] }));
    const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    const a = atom(v, 1, 'CA');
    expectOk(await s.distance({ a: { loci: a.loci }, b: `${list}#1` } as never));
    expect(distances(v)).toHaveLength(1);
    expectOk(await v.api.run('particles.remove', { particles: list }));
    expect(distances(v)).toHaveLength(0);
    expectOk(await v.api.run('history.undo', {}));
    expect(distances(v)).toHaveLength(1);
    const structure = v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
    expectOk(await v.api.run('structure.remove', { structure }));
    expect(distances(v)).toHaveLength(0);
  });
});
