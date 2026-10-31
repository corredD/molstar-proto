/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// Does culling lose a clip's ghosts? Loads a mesoscale example in headless Chrome (Playwright), cuts everything with a
// plane through its center facing the camera, turns the cut's Ghosts on, and per fraction of the camera's distance and
// per turn about the target (the ghosts toward the screen's edges) compares settled images of the canvas: as drawn
// against the same view without the GPU's occlusion test, and against the same view with GPU culling off (the CPU's
// cells); the ghosts' own pixels are the image with Ghosts against without. Prints the pixels that differ (by more
// than 16 of 255 in a channel). Method and results: apps/prism-me/progress/2026-10-31-ghost-cull.md.
//
//   node scripts/esbuild/app.mjs apps/prism-me --dev --port 1365     # in another shell
//   node apps/prism-me/scripts/ghost-check.mjs --port 1365 --backend webgpu --example cellpack-hiv1 --shots /tmp/g
//
// Options: --port (1365), --backend webgpu|webgl2 (webgpu), --example (cellpack-hiv1), --fractions (1,0.3,0.1,0.03),
// --angles degrees about the camera's up axis (0,30,60), --dpr (1), --shots a folder for the images, --json a file,
// --nocpu 1 to skip the GPU-culling-off reference (slow: rebuilds the objects), --eval JavaScript run in the page after
// the cut (window.cutIndex; e.g. another path: Clip whole, one-phase occlusion, a graded cut), --turns frames turned 2°
// each at every fraction (each frame against the same camera drawn without occlusion: a frame of popping), --notsettled
// 1 to skip the settled views.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright');

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])),
);
const port = +(args.port ?? 1365);
const backend = args.backend ?? 'webgpu';
const example = args.example ?? 'cellpack-hiv1';
const fractions = (args.fractions ?? '1,0.3,0.1,0.03').split(',').map(Number);
const angles = (args.angles ?? '0,30,60').split(',').map(Number);

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

const cut = await page.evaluate(async () => {
  const api = window.molstar.api;
  const added = await api.run('clipping.add', { shape: 'plane', everything: true });
  if (!added.ok) return { error: added.message };
  const index = added.value?.index ?? 1;
  const ghost = await api.run('clipping.update', { cut: index, ghost: true });
  return { index, add: added.message, ghost: ghost.message };
});
console.log(JSON.stringify({ example, backend, cut }));
if (cut.error) process.exit(1);
await page.waitForTimeout(3000);
// another path, after the cut (window.cutIndex): e.g. Clip whole, one-phase occlusion, a graded cut
if (args.eval) {
  await page.evaluate((i) => {
    window.cutIndex = i;
  }, cut.index);
  console.log(JSON.stringify({ eval: await page.evaluate(`(async () => { ${args.eval} })()`) }));
  await page.waitForTimeout(3000);
}

await page.evaluate((cutIndex) => {
  const pl = window.molstar.viewer.plugin;
  const c = pl.canvas3d;
  pl.animationLoop.stop();
  // full detail and resolution while moving: the frames compared are at rest
  c.setProps({ motion: { lodScale: 1, pixelScale: 1 } });
  const snap = c.camera.getSnapshot();
  const frame = async () => {
    c.requestDraw();
    c.tick(performance.now(), { isSynchronous: true });
    await c.graphics.waitForGpuCommandsComplete();
  };
  window.G = {
    frames: async (n) => {
      for (let i = 0; i < n; i++) await frame();
    },
    at: (f, degrees = 0) => {
      const t = snap.target;
      const d = [0, 1, 2].map((k) => (snap.position[k] - t[k]) * f);
      const a = (degrees * Math.PI) / 180;
      const p = [
        t[0] + d[0] * Math.cos(a) + d[2] * Math.sin(a),
        t[1] + d[1],
        t[2] - d[0] * Math.sin(a) + d[2] * Math.cos(a),
      ];
      c.camera.setState({ ...snap, position: p }, 0);
    },
    occlusion: (on) => c.setProps({ hiZ: { ...c.props.hiZ, gpu: on } }),
    // the eval's cut where it made another (`window.cutIndex`)
    ghost: (on) => window.molstar.api.run('clipping.update', { cut: window.cutIndex ?? cutIndex, ghost: on }),
    stats: () => ({
      gpuCulled: c['renderer']?.gpuCulledCount,
    }),
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
      return n;
    },
  };
}, cut.index);

const canvas = await page.$('canvas');
const shot = async () => (await canvas.screenshot()).toString('base64');
const save = (name, b64) => {
  if (!args.shots) return;
  fs.mkdirSync(args.shots, { recursive: true });
  fs.writeFileSync(path.join(args.shots, `${example}-${backend}-${name}.png`), Buffer.from(b64, 'base64'));
};
const settle = () => page.evaluate(() => window.G.frames(12));
const view = async (f, a) => {
  await page.evaluate(([f, a]) => window.G.at(f, a), [f, a]);
  await settle();
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

const views = fractions.flatMap((f) => angles.map((a) => [f, a]));
const images = new Map();
const rows = [];
for (const [f, a] of args.notsettled ? [] : views) {
  const key = `${f}-${a}`;
  await view(f, a);
  const drawn = await shot();
  await page.evaluate(() => window.G.occlusion(false));
  await settle();
  const noOcclusion = await shot();
  await page.evaluate(() => window.G.occlusion(true));
  await page.evaluate(() => window.G.ghost(false));
  await page.waitForTimeout(500);
  await settle();
  const noGhost = await shot();
  await page.evaluate(() => window.G.ghost(true));
  await page.waitForTimeout(500);
  await settle();
  save(`${key}-drawn`, drawn);
  save(`${key}-no-occlusion`, noOcclusion);
  save(`${key}-no-ghost`, noGhost);
  images.set(key, drawn);
  const row = {
    f,
    a,
    ghostPixels: await page.evaluate(([x, y]) => window.G.diff(x, y), [noOcclusion, noGhost]),
    lostToOcclusion: await page.evaluate(([x, y]) => window.G.diff(x, y), [drawn, noOcclusion]),
  };
  rows.push(row);
  console.log(JSON.stringify(row));
}
for (const f of args.turns ? fractions : []) {
  // turning about the target, a frame each step; each against the same camera without occlusion (one frame drawn: what
  // the culling of that frame left out)
  let worst = 0;
  let total = 0;
  for (let i = 0; i < +args.turns; i++) {
    await page.evaluate(
      async ([f, a]) => {
        window.G.at(f, a);
        await window.G.frames(1);
      },
      [f, 2 * i],
    );
    const turning = await shot();
    await page.evaluate(async () => {
      window.G.occlusion(false);
      await window.G.frames(1);
    });
    const without = await shot();
    await page.evaluate(() => window.G.occlusion(true));
    const n = await page.evaluate(([x, y]) => window.G.diff(x, y), [turning, without]);
    worst = Math.max(worst, n);
    total += n;
    if (n > 0) save(`turn-${f}-${2 * i}`, turning);
  }
  const row = { f, turns: +args.turns, worstFrameDiffers: worst, totalDiffers: total };
  rows.push(row);
  console.log(JSON.stringify(row));
}
if (!args.nocpu && !args.notsettled) {
  await setGpuCulling(false);
  await page.waitForTimeout(3000);
  for (const [i, [f, a]] of views.entries()) {
    const key = `${f}-${a}`;
    await view(f, a);
    const cpu = await shot();
    save(`${key}-cpu`, cpu);
    rows[i].differsFromCpu = await page.evaluate(([x, y]) => window.G.diff(x, y), [images.get(key), cpu]);
    console.log(JSON.stringify({ f, a, differsFromCpu: rows[i].differsFromCpu }));
  }
}
await browser.close();
if (args.json) fs.writeFileSync(args.json, JSON.stringify({ example, backend, rows }, null, 1));
