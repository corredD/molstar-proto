/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// Probe (not committed): model_vertexcolor at LIPID_PROBE_SCALE, the cutter's wrap and a camera path, timed.
// LIPID_PROBE=<obj path> LIPID_PROBE_SCALE=600 [LIPID_SHOTS=dir]

import { appendFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'vitest';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { HeadlessPluginContext } from '@molstar/plugin-headless/context';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';
import { SyncRuntimeContext } from '@molstar/core/task/execution/synchronous';
import {
  buildMembraneSteps,
  LipidMembraneParams,
  LipidMembraneRepresentation,
  registerLipidPatch,
  runSteps,
} from '../lipids/membrane.js';
import { writePng } from './lipid-fixtures.js';

const webgpu = await (async () => {
  try {
    const path = createRequire(import.meta.url).resolve('webgpu');
    const module = await import(pathToFileURL(path).href);
    return (await module.create([]).requestAdapter()) ? module : undefined;
  } catch {
    return undefined;
  }
})();

function parseObj(text: string, scale: number) {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) {
      const p = line.trim().split(/\s+/);
      pos.push(+p[1] * scale, +p[2] * scale, +p[3] * scale);
    } else if (line.startsWith('f ')) {
      const f = line
        .trim()
        .split(/\s+/)
        .slice(1)
        .map((s) => parseInt(s.split('/')[0], 10) - 1);
      for (let k = 1; k + 1 < f.length; ++k) idx.push(f[0], f[k], f[k + 1]);
    }
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}

const W = 900;
const H = 600;
const rss = () => Math.round(process.memoryUsage().rss / 1e6);

describe.skipIf(!webgpu || !process.env.LIPID_PROBE)('probe', () => {
  it('wraps and flies', async () => {
    const guard = setInterval(() => {
      if (process.memoryUsage().rss > 8e9) {
        console.log('RSS over 8 GB: abort');
        process.exit(3);
      }
    }, 200);
    const scale = +(process.env.LIPID_PROBE_SCALE ?? 20);
    const plugin = await HeadlessPluginContext.create(
      { webgpu },
      DefaultPluginSpec(),
      { width: W, height: H },
      { backend: 'webgpu' },
    );
    const out: Record<string, unknown> = { scale, rss0: rss() };
    try {
      await plugin.init();
      registerLipidPatch(
        'probe',
        readFileSync(new URL('../../../../../apps/prism-me/src/lipid-patch-charmm-gui.dat', import.meta.url), 'utf8'),
      );
      const mesh = parseObj(readFileSync(process.env.LIPID_PROBE!, 'utf8'), scale);
      const props = {
        ...PD.getDefaultValues(LipidMembraneParams),
        method: 'cutter' as const,
        patch: 'probe',
        ...(process.env.LIPID_FAR ? { far: process.env.LIPID_FAR as never } : {}),
        ...(process.env.LIPID_ATOMSPX ? { atomsPx: +process.env.LIPID_ATOMSPX } : {}),
        ...(process.env.LIPID_BUDGET ? { budget: +process.env.LIPID_BUDGET } : {}),
        ...(process.env.LIPID_DETAIL ? { detail: process.env.LIPID_DETAIL as never } : {}),
      };
      let t0 = performance.now();
      const empty: number[] = [];
      for (let i = 0; i < 4; ++i) {
        const t = performance.now();
        await plugin.getImageRaw({ width: W, height: H });
        empty.push(Math.round(performance.now() - t));
      }
      out.emptyMs = empty;
      t0 = performance.now();
      const data = await runSteps(
        buildMembraneSteps(
          { mesh },
          'probe',
          0,
          'both',
          { edgeTypes: 1, vertexColors: 1, variants: 1, seed: 1 },
          'cutter',
        ),
        SyncRuntimeContext,
      );
      out.stepsMs = Math.round(performance.now() - t0);
      if (typeof data === 'string') throw new Error(data);
      const repr = LipidMembraneRepresentation(plugin.canvas3d!.graphics);
      t0 = performance.now();
      await repr.createOrUpdate(props as never, data).run();
      out.reprMs = Math.round(performance.now() - t0);
      out.rssWrap = rss();
      const r = repr as unknown as { cutLipids: number; pool: Record<string, number> };
      out.full = r.cutLipids;
      plugin.canvas3d!.add(repr as never);
      const canvas = plugin.canvas3d!;
      const camera = canvas.camera;
      canvas.requestCameraReset({ durationMs: 0 });
      t0 = performance.now();
      await plugin.getImageRaw({ width: W, height: H });
      out.firstFrameMs = Math.round(performance.now() - t0);
      const whole = camera.getSnapshot();
      // the vertex nearest the camera, its triangle's normal
      const dir = Vec3.normalize(Vec3(), Vec3.sub(Vec3(), whole.position, whole.target));
      let best = 0;
      let bestD = -Infinity;
      const p = mesh.positions;
      for (let v = 0; v < p.length / 3; ++v) {
        const d = p[v * 3] * dir[0] + p[v * 3 + 1] * dir[1] + p[v * 3 + 2] * dir[2];
        if (d > bestD) {
          bestD = d;
          best = v;
        }
      }
      const P = Vec3.create(p[best * 3], p[best * 3 + 1], p[best * 3 + 2]);
      const R = whole.radius;
      const views: [string, number][] = [
        ['whole', 0],
        ['middle', R * 0.3],
        ['close', 400],
      ];
      const frames: Record<string, unknown>[] = [];
      for (const [name, dist] of [...views, ...views.slice(0, 2).reverse()]) {
        const snapshot = dist === 0 ? whole : { ...whole, target: P, position: Vec3.scaleAndAdd(Vec3(), P, dir, dist) };
        camera.setState(snapshot, 0);
        const ms: number[] = [];
        const s0 = { ...r.pool };
        let image: { data: Uint8ClampedArray | Uint8Array } | undefined;
        for (let i = 0; i < 4; ++i) {
          const t = performance.now();
          image = (await plugin.getImageRaw({ width: W, height: H })) as never;
          ms.push(Math.round(performance.now() - t));
        }
        frames.push({ name, ms, ...r.pool, selectsDelta: r.pool.selects - s0.selects, rss: rss() });
        if (process.env.LIPID_SHOTS)
          await writePng(`${process.env.LIPID_SHOTS}/probe-x${scale}-${name}.png`, W, H, image!.data);
      }
      out.frames = frames;
      out.errors = canvas.graphics.takeErrors?.() ?? [];
    } finally {
      appendFileSync(process.env.LIPID_PROBE_OUT ?? '/dev/null', JSON.stringify(out) + '\n');
      clearInterval(guard);
      plugin.dispose();
    }
  }, 600_000);
});
