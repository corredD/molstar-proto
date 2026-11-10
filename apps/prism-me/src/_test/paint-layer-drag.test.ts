/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { CryoetExtension } from '@molstar/cryoet-extension/prism-viewer';
import type { Representation } from '@molstar/graphics/repr/representation';
import { ParticleListPaintLayer } from '@molstar/mesoscale-extension/paint';
import { MesoscaleExtension } from '@molstar/mesoscale-extension/prism-viewer';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import { mountGizmoCanvas } from '@molstar/prism-viewer/testing/gizmo-canvas';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { StageToolsExtension } from '@molstar/stage-tools-extension/prism-viewer';
import { afterEach, describe, expect, it, vi } from 'vitest';

// A particle's handle on a list with painted copies (paint-layer, 2026-11-10): the paint layer's representations are
// the list's (the hierarchy takes a list under a list as part of it), but they draw the copies, not the list. A drag's
// preview draws the list's own representations moved and leaves the layer's as they are (stage-tools and mesoscale:
// the app's test).

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
}

describe("a particle's handle on a painted list", () => {
  it("previews the list's particles moved, the painted copies' representations left as they are", async () => {
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: {
        ...base,
        extensions: [...(base.extensions ?? []), StageToolsExtension, CryoetExtension, MesoscaleExtension],
      },
    });
    viewers.push(v);
    const star = 'data_particles\n\nloop_\n_rlnCoordinateX\n_rlnCoordinateY\n_rlnCoordinateZ\n10 0 0\n20 0 0\n';
    expectOk(await v.api.load.files({ files: [new File([star], 'p.star')] }));
    const list = () => v.plugin.managers.particles.hierarchy.current.lists[0];
    expectOk(await v.api.run('mesoscale.paint', { entity: '0', positions: [0, 50, 0, 0, 60, 0], seed: 1 }));
    const layer = Array.from(v.plugin.state.data.cells.values()).find(
      (c) => c.transform.transformer === ParticleListPaintLayer,
    )!;
    expect((layer.obj!.data as ParticleList).count).toBe(2);
    // the layer's representations are among the list's, after its own
    const reprs = list().representations;
    const own = reprs.filter((r) => r.cell.transform.parent !== layer.transform.ref);
    const painted = reprs.filter((r) => r.cell.transform.parent === layer.transform.ref);
    expect(own.length).toBeGreaterThan(0);
    expect(painted.length).toBe(own.length);
    expect(reprs.indexOf(own[0])).toBe(0);
    const paintedReprs = painted.map((r) => (r.cell.obj!.data as { repr: Representation<ParticleList> }).repr);

    const canvas = mountGizmoCanvas(v.plugin);
    const handles = v.api.stage!.useParticleHandles(v.api);
    expect(handles.show({ list: list().cell.transform.ref, index: 1, edit: { kind: 'instance' } })).toBe(true);
    const made = paintedReprs.map((r) => vi.spyOn(r, 'createOrUpdate'));
    const framed = paintedReprs.map((r) =>
      'setParticleFrames' in r
        ? vi.spyOn(r as never as { setParticleFrames: () => boolean }, 'setParticleFrames')
        : undefined,
    );
    expect(await canvas.hover()).toBe(true);
    await canvas.drag([2, 4, 6]);
    // previewed: the copies' representations not given the list's particles (made again from them, or framed by their
    // indices: the list's particle 1 is not copy 1)
    for (const m of made) expect(m).not.toHaveBeenCalled();
    for (const f of framed) if (f) expect(f.mock.calls.filter(([frames]) => frames !== undefined)).toEqual([]);
    await canvas.release();
    for (const m of made) expect(m.mock.calls.filter(([, data]) => data !== layer.obj!.data)).toEqual([]);
    canvas.remove();
  });
});
