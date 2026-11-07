/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */
// @module-tag heavy

import { readFileSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector';
import { basename } from 'node:path';
import { monitorEventLoopDelay, PerformanceObserver } from 'node:perf_hooks';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import { mountGizmoCanvas } from '@molstar/prism-viewer/testing/gizmo-canvas';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterAll, expect, it, vi } from 'vitest';
import { createMesoscaleExplorerSpec } from '../spec.js';

// A particle handle's drag on a real cellPACK model (Ludo, 2026-11-06: MG still lags on the lane): the handle's own
// preview (`ParticleHandles`, what the app runs), not the target representation alone as `hiv-copies` does, so the
// other representations it makes again per step show. A benchmark, not a guard: opt in with
// `PRISM_ME_CELLPACK=<the .bcif>` (not in the repository), `npx vitest run --mode heavy apps/prism-me/src/_test/cellpack-handle-drag`.
// Per drag (one particle, then its kind): the preview's time a step (the target representation's `setParticleFrames`
// with the merged sync), the collections, which representations were made again, and the step as the fake canvas takes
// it. That last one includes the canvas's settling (20 timer ticks: about 15.6 ms each on Windows unless something asks
// for fine timers, as the profiler does), so read the preview's. Headless: no GPU (no GPU culling, no upload), so this
// bounds the CPU side only.

const file = process.env.PRISM_ME_CELLPACK;
/** where the first drag's steps are profiled (a .cpuprofile), when given */
const profile = process.env.PRISM_ME_CELLPACK_PROFILE;
const session = new Session();
const post = (method: string) =>
  new Promise<unknown>((resolve, reject) => {
    if (!profile) return resolve(undefined);
    session.post(method, (e, r) => (e ? reject(e) : resolve(r)));
  });
if (profile) session.connect();
const postAlways = (method: string) =>
  new Promise<unknown>((resolve, reject) => session.post(method, (e, r) => (e ? reject(e) : resolve(r))));
const Steps = 20;
/** particles tried: the first targeted ones of so many different targets */
const Tried = Number(process.env.PRISM_ME_CELLPACK_TRIED ?? 4);

const viewers: PrismViewer[] = [];
afterAll(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

it.skipIf(!file)(
  "times a particle handle's drag steps on a cellPACK model (benchmark, logged)",
  { tags: ['heavy'], timeout: 3_600_000 },
  async () => {
    const bytes = readFileSync(file!);
    const v = await createPrismViewerHeadless({ spec: createMesoscaleExplorerSpec('') });
    viewers.push(v);
    const t0 = performance.now();
    const r = await v.api.load.files({ files: [new File([bytes], basename(file!))] });
    expect(r.ok, (r as { message?: string }).message).toBe(true);
    console.log(`${basename(file!)} loaded in ${(performance.now() - t0).toFixed(0)} ms`);

    const entry = v.plugin.managers.particles.hierarchy.current.lists[0];
    const list = entry.cell.transform.ref;
    const reprs = entry.representations.map((x) => ({
      name: (x.cell.transform.params as { type: { name: string } }).type.name,
      repr: (x.cell.obj!.data as { repr: { createOrUpdate: (...a: unknown[]) => unknown } }).repr,
      instances: ((x.cell.obj!.data as { repr: { renderObjects: { values: any }[] } }).repr.renderObjects ?? []).reduce(
        (n, ro) => n + ro.values.instanceCount.ref.value,
        0,
      ),
    }));
    console.log(`representations: ${reprs.map((x) => `${x.name} (${x.instances} instances)`).join(', ')}`);
    const data = (entry.representations[0].cell.obj!.data as { sourceData: ParticleList }).sourceData;
    console.log(`${data.count} particles, ${data.targetMapping?.size ?? 0} targets`);

    // the first particle of `Tried` different targets, and one without a target (a lipid, a fiber bead) when any
    const picked: number[] = [];
    const seen = new Set<number>();
    let untargeted = -1;
    for (let i = 0; i < data.count && (picked.length < Tried || untargeted < 0); i++) {
      const t = data.targets[i];
      if (data.targetMapping?.has(t)) {
        if (picked.length < Tried && !seen.has(t)) {
          seen.add(t);
          picked.push(i);
        }
      } else if (untargeted < 0) untargeted = i;
    }
    if (untargeted >= 0) picked.push(untargeted);

    const canvas = mountGizmoCanvas(v.plugin);
    const handles = v.api.stage!.useParticleHandles(v.api);
    const spies = reprs.map((x) => vi.spyOn(x.repr, 'createOrUpdate'));
    for (const index of picked) {
      for (const edit of [
        { kind: 'instance' as const },
        { kind: 'offset' as const, targets: String(data.targets[index]) },
      ]) {
        if (!handles.show({ list, index, edit })) {
          console.log(`particle ${index}: no handle`);
          continue;
        }
        expect(await canvas.hover()).toBe(true);
        for (const s of spies) s.mockClear();
        const times: number[] = [];
        await canvas.drag([]);
        const profiling =
          profile && index === picked[0] && edit.kind === (process.env.PRISM_ME_CELLPACK_PROFILE_KIND ?? 'instance');
        if (profiling) await post('Profiler.enable'), await post('Profiler.start');
        // the preview's own time (the target representation's), and the collections' during the steps
        const target = reprs.find((x) => x.name === 'target')?.repr as { setParticleFrames?: (f: unknown) => boolean };
        const own = target?.setParticleFrames;
        let previewMs = 0;
        if (target && own) {
          target.setParticleFrames = (f: unknown) => {
            const p0 = performance.now();
            try {
              return own.call(target, f);
            } finally {
              previewMs += performance.now() - p0;
            }
          };
        }
        let gcMs = 0;
        let gcs = 0;
        const gc = new PerformanceObserver((l) => {
          for (const e of l.getEntries()) {
            gcMs += e.duration;
            gcs++;
          }
        });
        gc.observe({ entryTypes: ['gc'] });
        for (let s = 1; s <= Steps; s++) {
          const s0 = performance.now();
          await canvas.drag([s]);
          times.push(performance.now() - s0);
        }
        await new Promise((r) => setTimeout(r, 0));
        gc.disconnect();
        if (target && own) target.setParticleFrames = own;
        console.log(
          `  preview ${(previewMs / Steps).toFixed(1)} ms a step; ${gcs} collections, ${(gcMs / Steps).toFixed(1)} ms a step`,
        );
        if (profiling) {
          const { profile: p } = (await post('Profiler.stop')) as { profile: unknown };
          writeFileSync(profile!, JSON.stringify(p));
          console.log(`profile of the steps: ${profile}`);
        }
        const made = reprs.map((x, i) => `${x.name} ${spies[i].mock.calls.length}`).join(', ');
        // `PRISM_ME_CELLPACK_PROFILE_RELEASE=<.cpuprofile>`: the first release profiled
        const releaseProfile = process.env.PRISM_ME_CELLPACK_PROFILE_RELEASE;
        const profilingRelease = !!releaseProfile && index === picked[0] && edit.kind === 'instance';
        if (profilingRelease) {
          if (!profile) session.connect();
          await postAlways('Profiler.enable');
          await postAlways('Profiler.start');
        }
        // the longest the release held the thread (the page frozen that long)
        const blocked = monitorEventLoopDelay({ resolution: 10 });
        blocked.enable();
        const r0 = performance.now();
        await canvas.release();
        const releaseMs = performance.now() - r0;
        blocked.disable();
        console.log(
          `  release: ${releaseMs.toFixed(0)} ms, the thread held at most ${(blocked.max / 1e6).toFixed(0)} ms`,
        );
        if (profilingRelease) {
          const { profile: p } = (await postAlways('Profiler.stop')) as { profile: unknown };
          writeFileSync(releaseProfile!, JSON.stringify(p));
          console.log(`profile of the release: ${releaseProfile}`);
        }
        times.sort((a, b) => a - b);
        console.log(
          `particle ${index} (target ${data.targetMapping?.has(data.targets[index]) ? data.targets[index] : 'none'}), ` +
            `${edit.kind}: step median ${times[times.length >> 1].toFixed(1)} ms, max ${times[times.length - 1].toFixed(1)} ms; ` +
            `made again during ${Steps} steps: ${made}; release ${releaseMs.toFixed(0)} ms`,
        );
        handles.hide();
      }
    }
    for (const s of spies) s.mockRestore();
    canvas.remove();
  },
);
