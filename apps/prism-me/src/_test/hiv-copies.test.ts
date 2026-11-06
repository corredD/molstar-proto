/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */
// @module-tag heavy

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { getHeapStatistics } from 'node:v8';
import { Mat4 } from '@molstar/core/math/linear-algebra';
import { canSetParticleFrames } from '@molstar/graphics/repr/particles/representation/target/representation';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterAll, expect, it } from 'vitest';
import { createMesoscaleExplorerSpec } from '../spec.js';

// How many copies of a cellPACK model the explorer holds before it slows down (Ludo, 2026-11-05: HIV,
// `fixed_latest_cellpack_atom_instances.bcif`). A benchmark, not a guard: opt in with `PRISM_ME_HIV=<the .bcif>` (the
// file is not in the repository; tests never read outside it otherwise), `pnpm test:heavy apps/prism-me/src/_test/hiv-copies`.
// Per copy: its load's time, the JS heap after it, the instances drawn, and a drag of one of its particles (the handle's
// preview steps, then the release's commit). Headless: no GPU, so a frame's draw is the browser's to measure.

const file = process.env.PRISM_ME_HIV;
/** Copies at most, and the load time (ms) past which the benchmark stops: slowed down */
const MaxCopies = Number(process.env.PRISM_ME_HIV_MAX ?? 16);
const SlowLoadMs = Number(process.env.PRISM_ME_HIV_SLOW_MS ?? 20_000);

const viewers: PrismViewer[] = [];
afterAll(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(0);

it.skipIf(!file)(
  'loads copies of a cellPACK model until a load is slow (benchmark, logged)',
  { tags: ['heavy'], timeout: 3_600_000 },
  async () => {
    const bytes = readFileSync(file!);
    const v = await createPrismViewerHeadless({ spec: createMesoscaleExplorerSpec('') });
    viewers.push(v);
    const rows: string[] = [];
    console.log(`${basename(file!)}: ${mb(bytes.length)} MB`);
    for (let copy = 1; copy <= MaxCopies; copy++) {
      const t0 = performance.now();
      const r = await v.api.load.files({ files: [new File([bytes], basename(file!))] });
      const loadMs = performance.now() - t0;
      expect(r.ok, (r as { message?: string }).message).toBe(true);
      const lists = v.plugin.managers.particles.hierarchy.current.lists;
      let instances = 0;
      for (const l of lists) {
        for (const repr of l.representations) {
          for (const ro of (repr.cell.obj?.data as { repr: { renderObjects: { values: any }[] } }).repr.renderObjects) {
            instances += ro.values.instanceCount.ref.value;
          }
        }
      }
      // a drag of the last copy's first particle: what its preview does each step (the target representation's
      // instances written, the canvas given them), 30 steps, the slowest kept; then the release's commit (one step)
      const last = lists[lists.length - 1];
      const target = last.representations
        .map((x) => (x.cell.obj?.data as { repr: unknown }).repr)
        .find(canSetParticleFrames);
      let stepMs = Number.NaN;
      let drawnSteps = 0;
      // a particle the target representation draws (one of a target: a protein, not a lipid of the membrane)
      const data = (
        last.representations.find((x) => canSetParticleFrames((x.cell.obj?.data as { repr: unknown }).repr))?.cell.obj
          ?.data as { sourceData?: ParticleList } | undefined
      )?.sourceData;
      let index = -1;
      if (data?.targetMapping) {
        for (let i = 0; i < data.count && index < 0; i++) if (data.targetMapping.has(data.targets[i])) index = i;
      }
      if (copy === 1)
        console.log(`the target representation's list: ${data?.count} particles, the dragged one ${index}`);
      if (target && index >= 0) {
        const frame = Mat4.identity();
        const frames = { indices: Int32Array.of(index), frames: new Float32Array(16) };
        for (let s = 0; s < 30; s++) {
          frame[12] = s;
          Mat4.toArray(frame, frames.frames, 0);
          const s0 = performance.now();
          if (target.setParticleFrames(frames)) {
            drawnSteps++;
            v.plugin.canvas3d?.update(target as never);
          }
          stepMs = Math.max(Number.isNaN(stepMs) ? 0 : stepMs, performance.now() - s0);
        }
        target.setParticleFrames(undefined);
        // the preview drew each step
        expect(drawnSteps).toBe(30);
      }
      const r0 = performance.now();
      const committed = await v.api.run('cryoet.instance', {
        particles: last.cell.transform.ref,
        index: Math.max(index, 0),
        x: 30,
      });
      const releaseMs = committed.ok ? performance.now() - r0 : Number.NaN;
      const heap = getHeapStatistics().used_heap_size;
      const row =
        `copy ${copy}: load ${loadMs.toFixed(0)} ms, heap ${mb(heap)} MB, ${instances} instances drawn, ` +
        `a drag step at most ${stepMs.toFixed(1)} ms, its release ${releaseMs.toFixed(0)} ms`;
      rows.push(row);
      console.log(row);
      if (loadMs > SlowLoadMs) break;
    }
    console.log(rows.join('\n'));
  },
);
