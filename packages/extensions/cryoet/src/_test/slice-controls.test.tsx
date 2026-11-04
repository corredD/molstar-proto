/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Tensor } from '@molstar/core/math/linear-algebra';
import { CCP4Writer } from '@molstar/model/formats/writer/ccp4/ccp4';
import type { Grid } from '@molstar/model/model/volume';
import { render } from '@molstar/prism-ui';
import { flushFrame } from '@molstar/prism-ui/reactive/frame-state';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import type { ApiResult, ViewerApi } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Slice } from '../controls.js';
import type { CryoetApi, SliceAxis, SliceInfo } from '../operations.js';
import { CryoetExtension } from '../prism-viewer.js';

// A volume's Slice slider follows the pointer (apps/prism-me/_spec/features.md, the slice rows): the Slider previews
// once a frame, each preview is a `cryoet.slice` as soon as the one in flight settles (the newest value wins), the
// release applies the last, and the drag is one undo step. Fake timers and clock: a slice step takes 5 ms, a frame 16
// ms; the undo step on a headless viewer, a 12³ map made in memory.

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

const StepMs = 5;
const FrameMs = 16;

/**
 * The Slice controls of a 100-deep volume, its z slice at 0 and its x slice at 7 (for `axis`; none: the axis picker);
 * the area's calls, those in flight at most
 */
function mounted(options: { axis?: SliceAxis; stepMs?: number } = { axis: 'z' }) {
  const stepMs = options.stepMs ?? StepMs;
  const info = observableState<SliceInfo | undefined>({
    dimensions: [100, 100, 100],
    slices: [
      { axis: 'z', index: 0, contrast: 3, ref: 'sz', visible: true },
      { axis: 'x', index: 7, contrast: 3, ref: 'sx', visible: true },
    ],
    obliques: [],
    radius: 50,
  });
  let running = 0;
  let most = 0;
  // a step lands in the state, as `cryoet.slice` does
  const slice = vi.fn(async (values: { axis: SliceAxis; index?: number; contrast?: number }) => {
    running++;
    most = Math.max(most, running);
    await new Promise((r) => setTimeout(r, stepMs));
    running--;
    const now = info.value!;
    const slices = now.slices.map((x) =>
      x.axis === values.axis ? { ...x, index: values.index ?? x.index, contrast: values.contrast ?? x.contrast } : x,
    );
    info.set({ ...now, slices });
    return { ok: true };
  });
  const area = { sliceState: () => info.asReadonly, slice } as unknown as CryoetApi;
  // the group's API is the same: its `cryoet` area is the one the controls are given
  const groups: string[] = [];
  const api = {
    cryoet: area,
    group: async (label: string, work: (g: ViewerApi) => Promise<unknown>) => {
      groups.push(label);
      return { ok: true, did: label, value: await work(api) };
    },
  } as unknown as ViewerApi;
  const host = document.createElement('div');
  document.body.append(host);
  const dispose = render(
    () => <Slice api={api} area={area} volume="v" {...(options.axis ? { axis: options.axis } : {})} />,
    host,
  );
  const range = host.querySelector<HTMLInputElement>('input[type=range][aria-label="Slice"]')!;
  const contrast = host.querySelector<HTMLInputElement>('input[type=range][aria-label="Contrast"]')!;
  const drag = (i: number, el = range) => {
    el.value = String(i);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    flushFrame();
  };
  const release = (el = range) => el.dispatchEvent(new Event('change', { bubbles: true }));
  /** A key step: the native range's input then change, no frame between */
  const key = (i: number) => {
    range.value = String(i);
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const pick = (label: string) =>
    Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((b) => b.textContent?.trim() === label)!
      .click();
  const indices = () => slice.mock.calls.map(([v]) => v.index);
  return { slice, info, groups, range, contrast, dispose, drag, release, key, pick, indices, most: () => most };
}

describe("a volume's Slice slider", () => {
  it('moves the slice during a drag, one call in flight, the last value applied', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    const s = mounted();
    // a drag of 300 ms, a preview a frame
    let i = 0;
    for (let t = 0; t < 300; t += FrameMs) {
      s.drag(++i);
      await vi.advanceTimersByTimeAsync(FrameMs);
    }
    const during = s.slice.mock.calls.length;
    expect(during).toBeGreaterThan(5);
    s.release();
    await vi.advanceTimersByTimeAsync(100);
    expect(s.indices().at(-1)).toBe(i);
    expect(s.most()).toBe(1);
    s.dispose();
  });

  it('keeps the knob under the pointer while an earlier step lands, and the release applies where it is', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    const s = mounted();
    s.drag(10);
    await vi.advanceTimersByTimeAsync(1);
    s.drag(20);
    // 10 lands while the pointer is at 20
    await vi.advanceTimersByTimeAsync(StepMs);
    expect(s.indices()).toEqual([10]);
    expect(s.range.value).toBe('20');
    s.release();
    await vi.advanceTimersByTimeAsync(100);
    expect(s.indices().at(-1)).toBe(20);
    s.dispose();
  });

  it("with the axis picker, shows and applies an axis's own values while another's step lands", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    // a slow step (a fine level): the z drag's last still lands when x is picked
    const s = mounted({ stepMs: 200 });
    s.drag(10);
    s.drag(30);
    s.release();
    await vi.advanceTimersByTimeAsync(1);
    s.pick('X');
    await vi.advanceTimersByTimeAsync(1);
    expect(s.range.value).toBe('7');
    s.drag(5, s.contrast);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.range.value).toBe('7');
    s.release(s.contrast);
    await vi.advanceTimersByTimeAsync(2000);
    const x = s.slice.mock.calls.filter(([v]) => v.axis === 'x').map(([v]) => v);
    expect(x.every((v) => v.index === undefined)).toBe(true);
    expect(s.info.value!.slices.map((v) => [v.axis, v.index])).toEqual([
      ['z', 30],
      ['x', 7],
    ]);
    s.dispose();
  });

  it('makes keys pressed in a row one undo step', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    const s = mounted();
    for (let i = 1; i <= 5; i++) {
      s.key(i);
      await vi.advanceTimersByTimeAsync(30);
    }
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.indices().at(-1)).toBe(5);
    expect(s.groups).toHaveLength(1);
    s.dispose();
  });

  it('applies what is shown when the controls go mid-drag, and nothing after', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    const s = mounted();
    s.drag(10);
    s.drag(20);
    s.drag(30);
    s.dispose();
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.indices().at(-1)).toBe(30);
    const n = s.slice.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.slice.mock.calls.length).toBe(n);
    expect(s.most()).toBe(1);
  });
});

/** A map of n³ voxels, its values rising along x */
function mapFile(name: string, n: number) {
  const space = Tensor.Space([n, n, n], [2, 1, 0], Float32Array);
  const data = new Float32Array(n * n * n).map((_, i) => i % n);
  const grid: Grid = {
    transform: { kind: 'matrix', matrix: Mat4.identity() },
    cells: Tensor.create(space, Tensor.Data1(data)),
    stats: { min: 0, max: n - 1, mean: n / 2, sigma: 1 },
  };
  return new File([CCP4Writer.writeMrc(grid, data)], name);
}

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
}

describe("a Slice slider's drag on a viewer", () => {
  it('is one undo step, undone to where the drag started', async () => {
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), CryoetExtension] },
    });
    try {
      expectOk(await v.api.load.files({ files: [mapFile('map.mrc', 12)] }));
      const c = v.api.cryoet!;
      const volume = v.plugin.managers.volume.hierarchy.current.volumes[0].cell.transform.ref;
      expectOk(await c.slice({ volume, axis: 'z', index: 2 } as never));
      const index = () => (c.sliceState(volume).value as SliceInfo).slices[0].index;
      const steps = () => v.managers.history.steps.value.length;
      const n = steps();
      const host = document.createElement('div');
      document.body.append(host);
      const dispose = render(() => <Slice api={v.api} area={c} volume={volume} axis="z" />, host);
      const range = host.querySelector<HTMLInputElement>('input[type=range][aria-label="Slice"]')!;
      for (const i of [3, 4, 5, 6, 7, 8]) {
        range.value = String(i);
        range.dispatchEvent(new Event('input', { bubbles: true }));
        flushFrame();
        await new Promise((r) => setTimeout(r, 5));
      }
      range.dispatchEvent(new Event('change', { bubbles: true }));
      await vi.waitFor(() => expect(index()).toBe(8));
      await vi.waitFor(() => expect(v.api.running.value.length).toBe(0));
      expect(steps()).toBe(n + 1);
      expectOk(await v.api.run('history.undo', {}));
      expect(index()).toBe(2);
      dispose();
    } finally {
      await v.dispose();
    }
  });
});
