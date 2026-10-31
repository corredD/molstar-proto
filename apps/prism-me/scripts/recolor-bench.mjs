/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// How long does it take to re-run the `particle-hierarchy` color theme over a mesoscale example (CellPack MG, 2.1 M
// particles) in headless Chrome (Playwright)? Each round changes the theme's `shift` in one state commit, and times the
// commit, the first synchronous frame after it, and both together; a baseline of frames with nothing changing and a CPU
// loop of `theme.color(location)` over every particle (the theme factory's cost apart from the state machinery) come
// with it. It also reports whether a commit keeps the render objects (colors only) or rebuilds them (geometry).
//
//   node scripts/esbuild/app.mjs apps/prism-me --dev --port 1359     # in another shell
//   node apps/prism-me/scripts/recolor-bench.mjs --port 1359 --backend webgpu \
//     --data /path/to/MG.bcif
//
// Options: --port (1359), --backend webgpu|webgl2 (webgpu), --example (cellpack-mg), --rounds of recolors (20),
// --data a local copy of the example's file (answers every `.bcif` or `.cif` request on another host, as in
// hidden-cost-bench.mjs), --json a file for the raw numbers.

import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright');

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])),
);
const port = +(args.port ?? 1359);
const backend = args.backend ?? 'webgpu';
const example = args.example ?? 'cellpack-mg';
const rounds = +(args.rounds ?? 20);

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
page.on('pageerror', (e) => console.error('pageerror:', String(e).slice(0, 300)));
await page.goto(`http://localhost:${port}/apps/prism-me/build/?graphics-backend=${backend}&example=${example}`);
await page.waitForFunction(() => window.molstar?.viewer, null, { timeout: 60000 });
await page.waitForFunction(() => window.molstar.viewer.plugin.canvas3d.getRenderObjects().length > 0, null, {
  timeout: 240000,
  polling: 1000,
});
await page.waitForTimeout(5000);

const result = await page.evaluate(
  async ([rounds]) => {
    const pl = window.molstar.viewer.plugin;
    const c = pl.canvas3d;
    const g = c.graphics;
    pl.animationLoop.stop();
    const frame = async () => {
      c.requestDraw();
      c.tick(performance.now(), { isSynchronous: true });
      await g.waitForGpuCommandsComplete();
    };
    const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
    const p90 = (a) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * 0.9))];
    const stat = (a) => ({ median: median(a), p90: p90(a), all: a });
    const roIds = () =>
      c
        .getRenderObjects()
        .map((r) => r.id)
        .join(',');
    const roSig = () =>
      c
        .getRenderObjects()
        .map((r) => `${r.id}:${r.values.drawCount?.ref.value}:${r.values.instanceCount?.ref.value}`)
        .join(',');

    const cells = [];
    for (const list of pl.managers.particles.hierarchy.current.lists)
      for (const r of list.representations) cells.push(r.cell);
    const first = cells[0];
    const particles = first.obj.data.sourceData;
    const info = {
      backend: g.capabilities.backend,
      representations: cells.length,
      initialColorTheme: cells.map((x) => x.transform.params.colorTheme.name),
      particles: particles.count,
      renderObjects: c.getRenderObjects().length,
    };

    const themes = pl.representation.particles.themes;
    const provider = themes.colorThemeRegistry.get('particle-hierarchy');
    const defaults = provider.defaultValues;
    const setShift = async (shift) => {
      const b = pl.state.data.build();
      for (const cell of cells) {
        const cur = pl.state.data.cells.get(cell.transform.ref).transform.params;
        b.to(cell.transform.ref).update({
          ...cur,
          colorTheme: { name: 'particle-hierarchy', params: { ...defaults, shift } },
        });
      }
      await b.commit();
    };

    // warm up
    await setShift(0);
    for (let i = 0; i < 30; i++) await frame();

    // baseline
    const base = [];
    for (let i = 0; i < 60; i++) {
      const t0 = performance.now();
      await frame();
      base.push(performance.now() - t0);
    }

    // recolor rounds
    const ids0 = roIds();
    const sig0 = roSig();
    const commit = [];
    const firstFrame = [];
    const total = [];
    let idsChanged = false;
    let sigChanged = false;
    for (let i = 1; i <= rounds; i++) {
      const shift = i % 2 ? 10 * ((i + 1) / 2) : 5 + 10 * (i / 2); // 10, 15, 20, 25, ... all different
      const t0 = performance.now();
      await setShift(shift % 101);
      const t1 = performance.now();
      await frame();
      const t2 = performance.now();
      commit.push(t1 - t0);
      firstFrame.push(t2 - t1);
      total.push(t2 - t0);
      if (roIds() !== ids0) idsChanged = true;
      if (roSig() !== sig0) sigChanged = true;
    }
    await setShift(0);
    for (let i = 0; i < 5; i++) await frame();

    // the CPU cost of the theme alone: the factory, then color(location) over every particle
    let cpu;
    try {
      const props = { ...defaults, shift: 7 };
      const reps = 5;
      const factoryMs = [];
      const loopMs = [];
      for (let k = 0; k < reps; k++) {
        const t0 = performance.now();
        const theme = provider.factory({ particles }, { ...props, shift: 7 + k });
        const t1 = performance.now();
        const loc = { kind: 'particle-location', particles, index: 0 };
        let acc = 0;
        for (let i = 0; i < particles.count; i++) {
          loc.index = i;
          acc += theme.color(loc);
        }
        const t2 = performance.now();
        factoryMs.push(t1 - t0);
        loopMs.push(t2 - t1);
        if (acc === -1) console.log(acc);
      }
      cpu = { factory: stat(factoryMs), colorLoop: stat(loopMs) };
    } catch (e) {
      cpu = { error: String(e) };
    }

    return {
      info,
      baseline: stat(base),
      commit: stat(commit),
      firstFrame: stat(firstFrame),
      total: stat(total),
      cpu,
      renderObjectsAfter: c.getRenderObjects().length,
      idsChanged,
      sigChanged,
    };
  },
  [rounds],
);
await browser.close();

const f = (s) => `${s.median.toFixed(1)} / ${s.p90.toFixed(1)}`;
console.log(JSON.stringify(result.info));
console.log(`render objects kept: ${!result.idsChanged} (draw/instance counts kept: ${!result.sigChanged})`);
if (result.cpu.error) console.log(`cpu loop: ${result.cpu.error}`);
else
  console.log(
    `cpu theme factory ${f(result.cpu.factory)} ms, color loop over all particles ${f(result.cpu.colorLoop)} ms`,
  );
console.log(
  '\n| Backend | Particles | Representations | Baseline frame ms | Commit ms (median / p90) | First frame ms (median / p90) | Total ms (median / p90) |',
);
console.log(
  '| ------- | --------- | --------------- | ----------------- | ------------------------ | ----------------------------- | ----------------------- |',
);
console.log(
  `| ${result.info.backend} | ${result.info.particles} | ${result.info.representations} | ${result.baseline.median.toFixed(1)} | ${f(result.commit)} | ${f(result.firstFrame)} | ${f(result.total)} |`,
);
if (args.json) fs.writeFileSync(args.json, JSON.stringify(result));
