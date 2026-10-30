/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// Do hidden particles cost a frame? Runs three arms on a mesoscale example in headless Chrome (Playwright) and prints
// the frame times: none hidden (A), about 90 % hidden through the eye's call `mesoscale.style visible:false` (B), and
// the same particles removed from the list (C), each from a fixed camera ("whole": the camera after the load,
// "close": a quarter of the distance). Method and results: apps/prism-me/progress/2026-10-29-hidden-cost.md.
//
//   node scripts/esbuild/app.mjs apps/prism-me --dev --port 1355     # in another shell
//   node apps/prism-me/scripts/hidden-cost-bench.mjs --port 1355 --backend webgpu --example cellpack-mg \
//     --data /path/to/MG_1184_cellpack_atom_instances.bcif
//
// Options: --port (1355), --backend webgpu|webgl2 (webgpu), --example (cellpack-mg), --frames timed per run (100),
// --rounds of A and B (3), --data a local copy of the example's file, --json a file for the raw numbers.
// An example whose server sends no CORS header (CellPack MG's, on cloudfront) is read from `--data`: every request of
// the page for a `.bcif` or `.cif` on another host is answered from that file with `access-control-allow-origin: *`.
// Download it first (`curl -o MG.bcif <the example's url>`); the file is not committed.

import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright');

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])),
);
const port = +(args.port ?? 1355);
const backend = args.backend ?? 'webgpu';
const example = args.example ?? 'cellpack-mg';
const frames = +(args.frames ?? 100);
const rounds = +(args.rounds ?? 3);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--ignore-gpu-blocklist', '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
if (args.data) {
  const body = fs.readFileSync(args.data);
  await page.route(
    (url) => url.hostname !== 'localhost' && /\.b?cif$/.test(url.pathname),
    (r) =>
      r.fulfill({
        body,
        headers: { 'access-control-allow-origin': '*', 'content-type': 'binary/octet-stream' },
      }),
  );
}
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

// the page side: the frames, the camera, and which entities are hidden (largest first, whole entities, up to 90.5 %)
const info = await page.evaluate(() => {
  const v = window.molstar.viewer;
  const pl = v.plugin;
  const c = pl.canvas3d;
  const g = c.graphics;
  pl.animationLoop.stop();
  const frame = async () => {
    c.requestDraw();
    c.tick(performance.now(), { isSynchronous: true });
    await g.waitForGpuCommandsComplete();
  };
  const snap = c.camera.getSnapshot();
  const t = snap.target;
  const q = snap.position;
  const close = {
    ...snap,
    position: [0, 1, 2].map((k) => t[k] + (q[k] - t[k]) * 0.25),
    radius: snap.radius * 0.25,
  };
  let cell;
  pl.state.data.cells.forEach((x) => {
    if (x.transform.transformer.id.endsWith('particle-list-from-mmcif-assembly')) cell = x;
  });
  const list = cell.obj.data;
  const counts = new Map();
  for (const e of list.entities) counts.set(e, (counts.get(e) || 0) + 1);
  const hide = new Set();
  let hidden = 0;
  for (const [e, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    if (hidden >= 0.9 * list.count) break;
    if (hidden + n > 0.905 * list.count) continue;
    hide.add(e);
    hidden += n;
  }
  const keepTargets = [...list.targetInfo].filter(([, ti]) => !hide.has(ti.entity)).map(([, ti]) => ti.name);
  window.H = { v, pl, c, g, frame, cams: { whole: snap, close }, cell, hide: [...hide], keepTargets };
  window.H.measure = async (n, cam) => {
    c.camera.setState(window.H.cams[cam], 0);
    for (let i = 0; i < 60; i++) await frame();
    const wall = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      await frame();
      wall.push(performance.now() - t0);
    }
    const batch = [];
    for (let k = 0; k < Math.max(5, n / 20); k++) {
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) {
        c.requestDraw();
        c.tick(performance.now(), { isSynchronous: true });
      }
      await g.waitForGpuCommandsComplete();
      batch.push((performance.now() - t0) / 20);
    }
    return { wall, batch, draws: g.stats.calls.drawInstanced };
  };
  return { backend: g.capabilities.backend, particles: list.count, hiddenFraction: hidden / list.count };
});
console.log(JSON.stringify(info));

const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
const results = [];
async function run(arm) {
  for (const cam of ['whole', 'close']) {
    const r = await page.evaluate(([n, c]) => window.H.measure(n, c), [frames, cam]);
    results.push({ arm, cam, ...r });
    console.log(
      `${arm} ${cam}: ${median(r.wall).toFixed(1)} ms (pipelined ${median(r.batch).toFixed(1)}), ${r.draws} draws`,
    );
  }
}
const hide = (visible) =>
  page
    .evaluate(
      ([visible]) => window.H.v.api.run('mesoscale.style', { entities: window.H.hide.join(','), visible }),
      [visible],
    )
    .then(() => page.waitForTimeout(6000));
const setAsym = async (asymIds) => {
  await page.evaluate(async (asymIds) => {
    const { pl, cell } = window.H;
    await pl.state.data
      .build()
      .to(cell.transform.ref)
      .update({ ...cell.transform.params, asymIds })
      .commit();
  }, asymIds);
  await page.waitForTimeout(10000);
};

for (let i = 1; i <= rounds; i++) {
  await run('A none hidden');
  await hide(false);
  await run('B 90% hidden');
  await hide(true);
}
await setAsym(await page.evaluate(() => window.H.keepTargets));
for (let i = 1; i <= rounds; i++) await run('C 90% removed');
await browser.close();

// the table: the median of the runs' medians, per arm and camera
const table = [];
for (const cam of ['whole', 'close']) {
  const by = (arm) => median(results.filter((r) => r.arm.startsWith(arm) && r.cam === cam).map((r) => median(r.wall)));
  const [a, b, c] = ['A', 'B', 'C'].map(by);
  table.push(
    `| ${info.backend} | ${cam} | ${a.toFixed(1)} | ${b.toFixed(1)} | ${c.toFixed(1)} | ${(b / a).toFixed(1)} | ${(b / c).toFixed(1)} |`,
  );
}
console.log('\n| Backend | Camera | None hidden (A) | 90 % hidden (B) | 90 % removed (C) | B / A | B / C |');
console.log('| ------- | ------ | --------------- | --------------- | ---------------- | ----- | ----- |');
console.log(table.join('\n'));
if (args.json) fs.writeFileSync(args.json, JSON.stringify({ info, results }));
