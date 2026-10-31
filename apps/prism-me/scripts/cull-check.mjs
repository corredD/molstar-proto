/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// Does culling lose anything? Loads a mesoscale example in headless Chrome (Playwright) and compares images of the
// canvas: per fraction of the camera's distance (1, 0.1, 0.02), settled (frames drawn until the view is stable) with the
// GPU's occlusion test against without it, and with GPU culling against the CPU's cells (the edges of the view: what
// each particle's own sphere test keeps); then turning (a few degrees a frame), each frame with occlusion against the
// same camera without (what a frame of popping shows); at rest after turning, what the canvas leaves without requests
// (motion off and on). Prints the pixels that differ (by more than 16 of 255 in a
// channel) per comparison. Method and results: apps/prism-me/progress/2026-10-31-instance-cull.md.
//
//   node apps/prism-me/scripts/cull-check.mjs --port 1362 --example cellpack-hiv1
//
// Options: --port (1362), --backend (webgpu), --example (cellpack-hiv1), --fractions (1,0.1,0.02), --turn degrees a frame
// (2), --turns frames (20), --dpr (1), --shots a folder for the images that differ.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright');

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])),
);
const port = +(args.port ?? 1362);
const backend = args.backend ?? 'webgpu';
const example = args.example ?? 'cellpack-hiv1';
const fractions = (args.fractions ?? '1,0.1,0.02').split(',').map(Number);
const turn = +(args.turn ?? 2);
const turns = +(args.turns ?? 20);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--ignore-gpu-blocklist', '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: +(args.dpr ?? 1) });
page.on('console', (m) => {
  if (m.type() === 'error') console.error('page:', m.text().slice(0, 300));
});
await page.goto(`http://localhost:${port}/apps/prism-me/build/?graphics-backend=${backend}&example=${example}`);
await page.waitForFunction(() => window.molstar?.viewer, null, { timeout: 60000 });
await page.waitForFunction(() => window.molstar.viewer.plugin.canvas3d.getRenderObjects().length > 0, null, {
  timeout: 240000,
  polling: 1000,
});
await page.waitForTimeout(5000);

await page.evaluate(() => {
  const pl = window.molstar.viewer.plugin;
  const c = pl.canvas3d;
  pl.animationLoop.stop();
  const snap = c.camera.getSnapshot();
  const frame = async () => {
    c.requestDraw();
    c.tick(performance.now(), { isSynchronous: true });
    await c.graphics.waitForGpuCommandsComplete();
  };
  window.C = {
    snap,
    frames: async (n) => {
      for (let i = 0; i < n; i++) await frame();
    },
    // as the app's loop: ticks 16 ms apart without a request (only what the canvas asks for itself is drawn)
    idle: async (n) => {
      for (let i = 0; i < n; i++) {
        c.tick(performance.now(), { isSynchronous: true });
        await c.graphics.waitForGpuCommandsComplete();
        await new Promise((r) => setTimeout(r, 16));
      }
    },
    at: (f, degrees = 0) => {
      const t = snap.target;
      const d = [0, 1, 2].map((k) => (snap.position[k] - t[k]) * f);
      // turned about the camera's up axis (y of the snapshot's view; a turntable)
      const a = (degrees * Math.PI) / 180;
      const p = [
        t[0] + d[0] * Math.cos(a) + d[2] * Math.sin(a),
        t[1] + d[1],
        t[2] - d[0] * Math.sin(a) + d[2] * Math.cos(a),
      ];
      c.camera.setState({ ...snap, position: p }, 0);
    },
    occlusion: (on) => c.setProps({ hiZ: { ...c.props.hiZ, gpu: on } }),
    // pixels that differ by more than 16 of 255 in a channel, of two PNGs (base64)
    diff: async (a, b) => {
      const load = async (s) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const g = canvas.getContext('2d');
        g.drawImage(bitmap, 0, 0);
        return g.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const [x, y] = [await load(a), await load(b)];
      let n = 0;
      for (let i = 0; i < x.length; i += 4) {
        if (Math.abs(x[i] - y[i]) > 16 || Math.abs(x[i + 1] - y[i + 1]) > 16 || Math.abs(x[i + 2] - y[i + 2]) > 16) n++;
      }
      return { differ: n, of: x.length / 4 };
    },
  };
});

const canvas = await page.$('canvas');
const shot = async () => (await canvas.screenshot()).toString('base64');
const save = (name, b64) => {
  if (!args.shots) return;
  fs.mkdirSync(args.shots, { recursive: true });
  fs.writeFileSync(path.join(args.shots, `${example}-${name}.png`), Buffer.from(b64, 'base64'));
};
const setGpuCulling = (value) =>
  page.evaluate(async (value) => {
    const pl = window.molstar.viewer.plugin;
    const b = pl.state.data.build();
    pl.state.data.cells.forEach((cell) => {
      if (cell.transform.transformer.id !== 'ms-plugin.particles-representation-3d') return;
      const p = cell.transform.params;
      b.to(cell.transform.ref).update({ ...p, type: { ...p.type, params: { ...p.type.params, gpuCulling: value } } });
    });
    await b.commit();
  }, value);
const settle = () => page.evaluate(() => window.C.frames(12));

const rows = [];
for (const f of fractions) {
  await page.evaluate((f) => window.C.at(f), f);
  await page.evaluate(() => window.C.occlusion(true));
  await settle();
  const occluded = await shot();
  await page.evaluate(() => window.C.occlusion(false));
  await settle();
  const all = await shot();
  await setGpuCulling(false);
  await page.waitForTimeout(4000);
  await settle();
  const cpu = await shot();
  await setGpuCulling('auto');
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.C.occlusion(true));
  const occlusion = await page.evaluate(([a, b]) => window.C.diff(a, b), [occluded, all]);
  const edges = await page.evaluate(([a, b]) => window.C.diff(a, b), [all, cpu]);
  if (occlusion.differ) save(`${f}-occluded`, occluded), save(`${f}-all`, all);
  if (edges.differ) save(`${f}-gpu`, all), save(`${f}-cpu`, cpu);
  const r = { f, occlusion: occlusion.differ, gpuAgainstCpu: edges.differ, pixels: occlusion.of };
  rows.push(r);
  console.log(JSON.stringify(r));
}

// turning: each frame drawn with occlusion (against the frame before's pyramid), then the same camera without
const f = fractions[Math.min(1, fractions.length - 1)];
await page.evaluate((f) => window.C.at(f, 0), f);
await page.evaluate(() => window.C.occlusion(true));
await settle();
let worst = 0;
let total = 0;
for (let i = 1; i <= turns; i++) {
  await page.evaluate(([f, a]) => (window.C.at(f, a), window.C.frames(1)), [f, i * turn]);
  const moving = await shot();
  await page.evaluate(() => window.C.occlusion(false));
  await page.evaluate(() => window.C.frames(2));
  const all = await shot();
  await page.evaluate(() => window.C.occlusion(true));
  // the pyramid of this view (drawn without occlusion) for the next turn is what a still camera has: draw it again
  // with occlusion so that the next frame tests against an occluded frame's pyramid, as while turning
  await page.evaluate(() => window.C.frames(1));
  const d = await page.evaluate(([a, b]) => window.C.diff(a, b), [moving, all]);
  if (d.differ > worst) {
    worst = d.differ;
    save(`turn-${i}-occluded`, moving);
    save(`turn-${i}-all`, all);
  }
  total += d.differ;
}
console.log(JSON.stringify({ turning: f, degreesPerFrame: turn, frames: turns, worst, mean: total / turns }));

// at rest after turning, as the app leaves it: turned frame by frame with occlusion, then ticks without requests for a
// second (the frames the canvas asks for itself); against the settled image without occlusion. With `motion` off and on
for (const lodScale of [1, 4]) {
  await page.evaluate((m) => window.molstar.viewer.plugin.canvas3d.setProps({ motion: { lodScale: m } }), lodScale);
  await page.evaluate((f) => window.C.at(f, 0), f);
  await settle();
  for (let i = 1; i <= 10; i++) await page.evaluate(([f, a]) => (window.C.at(f, a), window.C.frames(1)), [f, i * turn]);
  await page.evaluate(() => window.C.idle(60));
  const rest = await shot();
  await page.evaluate(() => window.C.occlusion(false));
  await settle();
  const all = await shot();
  await page.evaluate(() => window.C.occlusion(true));
  const d = await page.evaluate(([a, b]) => window.C.diff(a, b), [rest, all]);
  if (d.differ) save(`rest-m${lodScale}-occluded`, rest), save(`rest-m${lodScale}-all`, all);
  console.log(JSON.stringify({ atRestAfterTurning: f, motionLodScale: lodScale, differ: d.differ }));
}
await browser.close();
