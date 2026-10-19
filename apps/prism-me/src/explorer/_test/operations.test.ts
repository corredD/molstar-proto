/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { ExplorerExtension } from '../extension.js';

// The `explorer` area on a headless viewer: 1CRN (crambin, with its unit cell), a RELION list and an OBJ mesh.

const star = `data_particles

loop_
_rlnCoordinateX
_rlnCoordinateY
_rlnCoordinateZ
10 0 0
20 0 0
30 0 0
`;
const obj = 'v 0 0 0\nv 10 0 0\nv 0 10 0\nv 0 0 10\nf 1 2 3\nf 1 2 4\nf 1 3 4\nf 2 3 4\n';

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
    spec: { ...base, extensions: [...(base.extensions ?? []), ExplorerExtension] },
  });
  viewers.push(v);
  const crn = new File([readFileSync(new URL('../../../../../data/examples/1crn.cif', import.meta.url))], '1crn.cif');
  for (const f of [crn, new File([star], 'membrane.star'), new File([obj], 'membrane.obj')]) {
    expectOk(await v.api.load.files({ files: [f] }));
  }
  return v;
}

describe('explorer', () => {
  it('lists the scene by category, a model shape (the unit cell) not as a mesh, a list by its file', async () => {
    const v = await viewer();
    // 1CRN's unit cell is a shape of its model: there is one besides the mesh's
    const shapes = Array.from(v.plugin.state.data.cells.values()).filter((c) => c.obj?.type.name === 'Shape 3D');
    expect(shapes).toHaveLength(2);
    const objects = v.api.explorer!.objectsState().value;
    expect(objects.map((o) => [o.category, o.kind, o.label])).toEqual([
      ['structures', 'structure', '1CRN'],
      ['particles', 'list', 'membrane.star'],
      ['meshes', 'mesh', 'membrane.obj'],
    ]);
    expect(objects[0].entities).toEqual([{ id: '1', label: 'CRAMBIN', chains: ['A'] }]);
    expect(objects[1].count).toBe('3 particles');
  });

  it('highlights and focuses a structure entity, a list and a mesh', async () => {
    const v = await viewer();
    const area = v.api.explorer!;
    const [crn, list, mesh] = area.objectsState().value;
    for (const node of [
      { ref: crn.ref, entity: '1' },
      { ref: crn.ref, entity: '1', chain: 'A' },
      { ref: list.ref },
      { ref: mesh.ref },
    ]) {
      expect(() => area.highlight(node)).not.toThrow();
      expect(() => area.focus(node)).not.toThrow();
    }
    area.highlight(undefined);
  });
});
