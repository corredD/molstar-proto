/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// @module-tag heavy

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { ShapeFromObj } from '@molstar/plugin/state/formats/shape/obj';
import { HeadlessPluginContext } from '@molstar/plugin-headless/context';
import { HeadlessScreenshotHelper } from '@molstar/plugin-headless/screenshot';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import { forgetLipidPatch, LipidMembrane, LipidMembraneParams, registerLipidPatch } from '../lipids/membrane.js';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { OrganelleMeshFromBinary, parseOrganelleMeshes } from '../organelle-meshes.js';
import { MesoscaleExtension } from '../prism-viewer.js';
import { syntheticPatchPdb } from './lipid-fixtures.js';

// The middle looks' cost at the app's size (round 8 test 4, the gate's S3): the yeast cell (its organelle meshes, never
// committed: LIPID_YEAST, the .bin or .bin.gz; its patch LIPID_PATCH, the app's file by default) wrapped as the app wraps them (Wrap all, the CHARMM-GUI patch), and the
// model at x600 (a sphere of 50,000 Å), each look at whole, middle and close, with a clip at the middle; 900 × 600,
// perspective. Numbers only (LIPID_MEASURE=1): the frame times of a shared machine are not a bound.

const webgpu = await (async () => {
  try {
    const path = createRequire(import.meta.url).resolve('webgpu');
    const module = await import(pathToFileURL(path).href);
    return (await module.create([]).requestAdapter()) ? module : undefined;
  } catch {
    return undefined;
  }
})();

const Width = Number(process.env.LIPID_WIDTH ?? 900);
const Height = Number(process.env.LIPID_HEIGHT ?? 600);

describe.skipIf(!webgpu || !process.env.LIPID_MEASURE)('the middle looks measured (Dawn, the app’s size)', () => {
  for (const model of ['x600', 'yeast'] as const) {
    it.skipIf(model === 'yeast' && !process.env.LIPID_YEAST)(
      `measures ${model}, coarse and parallax`,
      {
        timeout: 1_800_000,
      },
      async () => {
        const options = { backend: 'webgpu' as const };
        const renderer = await HeadlessScreenshotHelper.create({ webgpu }, { width: Width, height: Height }, options);
        const base = DefaultPrismViewerSpec();
        const v = await createPrismViewerHeadless({
          spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
          plugin: (spec) =>
            new HeadlessPluginContext({ webgpu }, spec, { width: Width, height: Height }, options, renderer),
        });
        const patch = model === 'yeast' ? 'measure-charmm-gui' : 'measure-synthetic';
        registerLipidPatch(
          patch,
          model === 'yeast'
            ? readFileSync(
                process.env.LIPID_PATCH ??
                  join(import.meta.dirname, '../../../../../apps/prism-me/src/lipid-patch-charmm-gui.dat'),
                'utf8',
              )
            : syntheticPatchPdb().text,
        );
        try {
          const plugin = v.plugin as HeadlessPluginContext;
          const canvas = plugin.canvas3d!;
          canvas.setProps({ camera: { ...canvas.props.camera, mode: 'perspective' } });
          // the surface looked at: the x600 sphere's top, the yeast cell's plasma membrane's top
          let target: Vec3;
          /** the clip's plane (z through `center`) and a point of its ring on the surface */
          let center: Vec3;
          let ring: Vec3;
          let wrap: Record<string, unknown>;
          if (model === 'yeast') {
            let bytes = new Uint8Array(readFileSync(process.env.LIPID_YEAST!));
            if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = new Uint8Array(gunzipSync(bytes));
            const meshes = parseOrganelleMeshes(bytes);
            if (typeof meshes === 'string') throw new Error(meshes);
            const pm = meshes.find((m) => m.name === 'PM') ?? meshes[0];
            let top = -Infinity;
            const c = Vec3();
            for (let i = 0; i < pm.positions.length; i += 3) {
              c[0] += pm.positions[i] / (pm.positions.length / 3);
              c[1] += pm.positions[i + 1] / (pm.positions.length / 3);
            }
            for (let i = 2; i < pm.positions.length; i += 3) {
              c[2] += pm.positions[i] / (pm.positions.length / 3);
              top = Math.max(top, pm.positions[i]);
            }
            target = Vec3.create(c[0], c[1], top);
            center = c;
            let rx = -Infinity;
            let ry = c[1];
            for (let i = 0; i < pm.positions.length; i += 3) {
              if (Math.abs(pm.positions[i + 2] - c[2]) > 300 || pm.positions[i] <= rx) continue;
              rx = pm.positions[i];
              ry = pm.positions[i + 1];
            }
            ring = Vec3.create(rx, ry, c[2]);
            const data = await plugin.builders.data.rawData({ data: bytes, label: 'organelle_meshes.bin' });
            const b = plugin.state.data.build();
            const shapes = meshes.map(
              (_m, index) =>
                b.to(data).apply(OrganelleMeshFromBinary, { index }).apply(ShapeFromObj, { label: meshes[index].name })
                  .selector,
            );
            await b.commit();
            wrap = { meshes: shapes.map((s) => s.ref).join(','), patch };
          } else {
            target = Vec3.create(0, 0, 50000);
            center = Vec3.create(0, 0, 0);
            ring = Vec3.create(50000, 0, 0);
            wrap = { radius: 50000, edge: (50000 * 1.2) / 12, patch, method: 'cutter' };
          }
          const numbers: Record<string, unknown>[] = [];
          for (const middle of ['coarse', 'parallax'] as const) {
            const t0 = performance.now();
            // x600 as test 4 builds it (its edge past the operation's range): the transform at the root
            let membrane: string;
            if (model === 'yeast') {
              const r = await v.api.mesoscale!.wrapMembrane(wrap as never);
              if (!r.ok) throw new Error(r.message);
              membrane = r.changed!.nodes![0];
            } else {
              const node = await plugin
                .build()
                .toRoot()
                .apply(LipidMembrane, {
                  ...PD.getDefaultValues(LipidMembraneParams),
                  ...wrap,
                  center: Vec3.zero(),
                } as never)
                .commit();
              membrane = node.ref;
            }
            expect(
              (await v.api.mesoscale!.membraneDetail({ membrane, middle } as never)).ok || middle === 'coarse',
            ).toBe(true);
            const wrapMs = performance.now() - t0;
            const repr = () =>
              (plugin.state.data.cells.get(membrane)?.obj?.data as { repr?: unknown })?.repr as {
                pool: { live: number; selectMs: number };
              };
            canvas.requestCameraReset({ durationMs: 0 });
            await plugin.getImageRaw({ width: Width, height: Height });
            const whole = canvas.camera.getSnapshot();
            const above = (h: number) => ({
              ...whole,
              target: Vec3.clone(target),
              position: Vec3.create(target[0], target[1], target[2] + h),
              up: Vec3.create(0, 1, 0),
            });
            const at = async (name: string, snapshot: typeof whole) => {
              canvas.camera.setState(snapshot, 0);
              let t = performance.now();
              await plugin.getImageRaw({ width: Width, height: Height });
              const first = performance.now() - t;
              // settled: the median of three frames after it
              const times: number[] = [];
              for (let k = 0; k < 3; ++k) {
                t = performance.now();
                await plugin.getImageRaw({ width: Width, height: Height });
                times.push(performance.now() - t);
              }
              times.sort((x, y) => x - y);
              numbers.push({
                model,
                middle,
                name,
                first: Math.round(first),
                ms: Math.round(times[1]),
                live: repr().pool.live,
                selectMs: +repr().pool.selectMs.toFixed(1),
              });
            };
            await at('whole', whole);
            await at('middle 20000', above(20000));
            await at('mid 1500', above(1500));
            await at('close 300', above(300));
            await at('close 60', above(60));
            // a clip through the center (z), the camera on its ring, obliquely (k = 0.7), at 450 Å (a lipid ~5 px at 900 × 600) and 150 Å (the cut band)
            const onRing = (d: number) => ({
              ...whole,
              target: Vec3.clone(ring),
              position: Vec3.create(ring[0] + d * Math.sqrt(1 - 0.49), ring[1], ring[2] + d * 0.7),
              up: Vec3.create(0, 1, 0),
            });
            await at('ring 450', onRing(450));
            const clip = await v.api.run('clipping.add', { shape: 'plane', node: `#${membrane}` });
            expect(clip.ok, clip.message).toBe(true);
            const placed = await v.api.run('clipping.update', {
              cut: 1,
              position: Array.from(center),
              normal: [0, 0, 1],
            });
            expect(placed.ok, placed.message).toBe(true);
            await at('ring 450 clipped', onRing(450));
            await at('ring 150 clipped', onRing(150));
            numbers.push({ model, middle, name: 'wrap', ms: Math.round(wrapMs) });
            expect((await v.api.run('state.remove', { node: membrane })).ok).toBe(true);
            if (await v.api.run('clipping.remove', { cut: 1 }).then((x) => !x.ok)) {
              // a cut on a removed node may go with it
            }
          }
          console.log(JSON.stringify(numbers));
          expect(plugin.canvas3d!.graphics.takeErrors?.() ?? []).toEqual([]);
        } finally {
          forgetLipidPatch(patch);
          v.dispose?.();
        }
      },
    );
  }
});
