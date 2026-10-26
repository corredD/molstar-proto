/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Color } from '@molstar/core/util/color';
import { StateSelection } from '@molstar/core/state';
import { ParticleRepresentation3DLayers } from '@molstar/plugin/state/transforms/particles/layers';
import { ParticlesRepresentation3D } from '@molstar/plugin/state/transforms/particles/representation';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { MesoscaleExtension } from '../prism-viewer.js';
import { TestParticleList } from './fixtures.js';

// One owner for the looks (architecture.md §7.1), Ludovic's check on the cellPACK-like fixture, with the operations
// the explorer drives: color an entity (`mesoscale.style`), hide a class (`particles.look` by target, the row's eye),
// cut some particles (`clipping.add` with `particles`). Each write keeps the others' on every representation; each
// undo takes back exactly one.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}`);
}

async function viewer() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
  });
  viewers.push(v);
  await v.plugin.build().toRoot().apply(TestParticleList).commit();
  expectOk(await v.api.particles.representation({ type: 'spacefill' }));
  // a second representation (as a decoration's target one): the looks are on each
  const l = list(v);
  await v.plugin
    .build()
    .to(l.cell)
    .apply(ParticlesRepresentation3D, l.representations[0].cell.transform.params as never)
    .commit();
  return v;
}

const red = Color.fromHexStyle('#ff0000');

const list = (v: PrismViewer) => v.plugin.managers.particles.hierarchy.current.lists[0];

/** Per representation: its entity colors, the targets hidden by a layer, its cut tags (none: no looks cell) */
function looks(v: PrismViewer) {
  const cells = new Map(
    v.plugin.state.data
      .select(StateSelection.Generators.ofTransformer(ParticleRepresentation3DLayers))
      .map((c) => [c.transform.parent, c.transform.params as any]),
  );
  return list(v).representations.map((r) => {
    const p = cells.get(r.cell.transform.ref);
    if (!p) return undefined;
    const layers = p.layers as any[];
    return {
      colored: layers.filter((l) => l.color !== null).map((l) => [l.entities, l.targets, l.color]),
      hiddenTargets: layers.filter((l) => !l.visible && l.targets.length).map((l) => l.targets),
      cuts: (p.cuts as any[]).map((c) => c.entities),
    };
  });
}

const colorCA = (v: PrismViewer) => v.api.run('mesoscale.style', { entities: 'CA', color: '#ff0000' });
const hideClass = (v: PrismViewer) =>
  v.api.run('particles.look', {
    particles: list(v).cell.transform.ref,
    layers: [{ selector: { targets: [3] }, visible: false }],
  });
const cutNC = (v: PrismViewer) =>
  v.api.run('clipping.add', { shape: 'sphere', node: `#${list(v).cell.transform.ref}`, particles: { entities: [2] } });

describe('one owner for the particle looks', () => {
  it('color, hide a class, cut: each write keeps the others on every representation, each undo takes one back', async () => {
    const v = await viewer();
    const color = { colored: [[[1], [], red]] };
    const hidden = { hiddenTargets: [[3]] };
    const cut = { cuts: [[2]] };
    expectOk(await colorCA(v));
    expect(looks(v)).toEqual([
      { ...color, hiddenTargets: [], cuts: [] },
      { ...color, hiddenTargets: [], cuts: [] },
    ]);
    expectOk(await hideClass(v));
    expectOk(await cutNC(v));
    const all = { ...color, ...hidden, ...cut };
    expect(looks(v)).toEqual([all, all]);
    // another style write: the class hidden by target and the cut stay as they are
    expectOk(await v.api.run('mesoscale.style', { entities: 'lipids', emissive: 0.5 }));
    expect(looks(v)).toEqual([all, all]);
    expect((await v.api.mesoscale!.entities({})).value).toMatchObject({
      entities: [{ name: 'lipids', emissive: 0.5 }, { name: 'CA', color: red }, { name: 'NC' }, { name: 'loose' }],
    });

    expectOk(await v.api.run('history.undo', {}));
    expect(looks(v)).toEqual([all, all]);
    expectOk(await v.api.run('history.undo', {}));
    const noCut = { ...color, ...hidden, cuts: [] };
    expect(looks(v)).toEqual([noCut, noCut]);
    expectOk(await v.api.run('history.undo', {}));
    const colorOnly = { ...color, hiddenTargets: [], cuts: [] };
    expect(looks(v)).toEqual([colorOnly, colorOnly]);
    expectOk(await v.api.run('history.undo', {}));
    expect(looks(v)).toEqual([undefined, undefined]);
  });

  it('cut, then the color reset: the cut keeps the cell', async () => {
    const v = await viewer();
    expectOk(await colorCA(v));
    expectOk(await cutNC(v));
    expectOk(await v.api.run('mesoscale.style', { entities: 'CA', reset: true }));
    expect(looks(v)).toEqual([
      { colored: [], hiddenTargets: [], cuts: [[2]] },
      { colored: [], hiddenTargets: [], cuts: [[2]] },
    ]);
  });

  it("a style write on a list whose representations differ fills the ones without it, and keeps each one's own", async () => {
    const v = await viewer();
    const [first, second] = list(v).representations.map((r) => r.cell.transform.ref);
    // the second leaves out a target (a decoration draws it): the first not
    expectOk(await v.api.run('particles.look', { node: `#${second}`, hidden: [0] }));
    expectOk(await colorCA(v));
    const params = (ref: string) =>
      v.plugin.state.data.select(StateSelection.Generators.ofTransformer(ParticleRepresentation3DLayers, ref))[0]
        .transform.params as any;
    expect([params(first).hidden, params(second).hidden]).toEqual([[], [0]]);
    expect(looks(v)[0]).toEqual(looks(v)[1]);
  });
});
