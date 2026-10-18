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
import { CutGuideShape } from '../guide.js';
import type { CutInfo } from '../operations.js';
import { menuItems } from '../prism-viewer-ui.js';
import { StageToolsExtension } from '../prism-viewer.js';

// The `stage` area on a headless viewer with 1CRN (crambin), from the repository's example data.

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
    spec: { ...base, extensions: [...(base.extensions ?? []), StageToolsExtension] },
  });
  viewers.push(v);
  const crn = new File([readFileSync(new URL('../../../../data/examples/1crn.cif', import.meta.url))], '1crn.cif');
  expectOk(await v.api.load.files({ files: [crn] }));
  return v;
}

const clips = (v: PrismViewer) =>
  v.plugin.managers.structure.hierarchy.current.structures[0].components.flatMap((c) =>
    c.representations.map((r) => (r.cell.transform.params as any).type.params.clip.objects.length as number),
  );

const cutOf = async (v: PrismViewer) => {
  const r = await v.api.stage!.cuts({});
  expectOk(r);
  return (r.value as CutInfo[])[0];
};

const guides = (v: PrismViewer) =>
  Array.from(v.plugin.state.data.cells.values()).filter((c) => c.transform.transformer === CutGuideShape);

describe('stage', () => {
  it('cuts every representation of a structure with a plane through its center, and draws its guide', async () => {
    const v = await viewer();
    expectOk(await v.api.stage!.cut({ shape: 'plane', target: '' }));
    expect(clips(v).every((n) => n === 1)).toBe(true);
    const info = await cutOf(v);
    expect(info.cut?.shape).toBe('plane');
    expect(info.offset).toBeCloseTo(0, 2);
    expect(guides(v)).toHaveLength(1);
  });

  it('slides, sizes and flips a cut, and removes it with its guide', async () => {
    const v = await viewer();
    const s = v.api.stage!;
    expectOk(await s.cut({ shape: 'sphere', target: '1CRN' }));
    expectOk(await s.adjust({ offset: -0.5, size: 0.3 } as never));
    let info = await cutOf(v);
    expect(info.offset).toBeCloseTo(-0.5, 2);
    expect(info.cut!.radius / info.reach).toBeCloseTo(0.3, 2);
    expectOk(await s.adjust({ flip: true } as never));
    info = await cutOf(v);
    expect(info.cut!.invert).toBe(true);
    expectOk(await s.uncut({ target: '' }));
    expect(clips(v).every((n) => n === 0)).toBe(true);
    expect(guides(v)).toHaveLength(0);
    const again = await s.uncut({ target: '' });
    expectOk(again);
    expect(again.unchanged).toBe(true);
  });

  it('shows and hides the guides', async () => {
    const v = await viewer();
    const s = v.api.stage!;
    expectOk(await s.cut({ shape: 'box', target: '' }));
    expectOk(await s.guides({ visible: false }));
    expect(guides(v).every((c) => c.state.isHidden)).toBe(true);
    expect(s.guidesState().value).toBe(false);
  });

  it('undoes a cut in one step', async () => {
    const v = await viewer();
    expectOk(await v.api.stage!.cut({ shape: 'plane', target: '' }));
    expectOk(await v.api.history.undo({}));
    expect(clips(v).every((n) => n === 0)).toBe(true);
  });

  it('offers what fits the pick in its menu', async () => {
    const v = await viewer();
    const s = v.api.stage!;
    const target = {
      ref: v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref,
      label: '1CRN',
      kind: 'structure' as const,
    };
    const ids = async (pick: Parameters<typeof menuItems>[2]['pick']) =>
      (await menuItems(v.api, s, { x: 0, y: 0, pick, focus: () => {} })).map((i) => i.id);
    expect(await ids({ kind: 'nothing' })).toEqual(['reset-camera']);
    expect(await ids({ kind: 'target', target })).toEqual(['focus', 'cut-plane', 'cut-sphere', 'cut-box']);
    expectOk(await s.cut({ shape: 'plane', target: '' }));
    expect(await ids({ kind: 'target', target })).toEqual([
      'focus',
      'cut-plane',
      'cut-sphere',
      'cut-box',
      'flip',
      'uncut',
      'guides',
    ]);
    expect(await ids({ kind: 'guide', target })).toEqual(['flip', 'uncut', 'guides']);
  });
});
