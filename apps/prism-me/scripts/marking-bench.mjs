/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// What do marking and transparency cost in prism-me's look? Loads a mesoscale example in headless Chrome (Playwright)
// and per case (marking on or off; nothing marked, a hover, a selection; a clip with and without Ghosts; an entity shown
// in part; an entity with transparency) and per fraction of the camera's distance (1, 0.1, 0.02) prints the frame time
// still and turning 1° a frame (`zoom-test.js`'s batched `T()` and `M()`), and for the hover and selection cases the
// time of a marking change at rest (a hover on and off: with marking on the marking pass redrawn over the last image,
// with it off the whole frame). Method and results: apps/prism-me/progress/2026-10-31-marking-cost.md.
//
//   node scripts/esbuild/app.mjs apps/prism-me --dev --port 1367     # in another shell
//   node apps/prism-me/scripts/marking-bench.mjs --port 1367 --backend webgpu --example cellpack-hiv1
//
// Options: --port (1367), --backend webgpu|webgl2 (webgpu), --example (cellpack-hiv1), --fractions (1,0.1,0.02),
// --batches of 20 frames (5), --dpr (1), --cases (all; a comma list of the names below), --json a file for the numbers,
// --eval JavaScript run in the page after the load (e.g. a prop to compare).

import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright');

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])),
);
const port = +(args.port ?? 1367);
const backend = args.backend ?? 'webgpu';
const example = args.example ?? 'cellpack-hiv1';
const fractions = (args.fractions ?? '1,0.1,0.02').split(',').map(Number);
const batches = +(args.batches ?? 5);

// each case: marking on or off, what is marked, and the scene's change (set up, then undone)
const Cases = {
  none: { marking: true },
  'none-off': { marking: false },
  hover: { marking: true, mark: 'hover' },
  'hover-off': { marking: false, mark: 'hover' },
  select: { marking: true, mark: 'select' },
  'select-off': { marking: false, mark: 'select' },
  clip: { marking: true, scene: 'clip' },
  ghosts: { marking: true, scene: 'ghosts' },
  shown: { marking: true, scene: 'shown' },
  transparency: { marking: true, scene: 'transparency' },
};
const cases = args.cases ? args.cases.split(',') : Object.keys(Cases);

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
await page.evaluate(fs.readFileSync(new URL('./zoom-test.js', import.meta.url), 'utf8'));
if (args.eval) {
  await page.evaluate(args.eval);
  await page.waitForTimeout(5000);
}
const box = await (await page.$('canvas')).boundingBox();

await page.evaluate(async () => {
  const pl = window.molstar.viewer.plugin;
  const c = pl.canvas3d;
  const api = window.molstar.api;
  const snap = c.camera.getSnapshot();
  const frame = async () => {
    c.requestDraw();
    c.tick(performance.now(), { isSynchronous: true });
    if (c.graphics.waitForGpuCommandsCompleteSync) c.graphics.waitForGpuCommandsCompleteSync();
    else await c.graphics.waitForGpuCommandsComplete();
  };
  const info = (await api.run('mesoscale.entities', {})).value;
  const largest = [...(info?.entities ?? [])].sort((a, b) => b.count - a.count)[0];
  let clip;
  let selected;
  window.B = {
    largest: largest && { id: largest.id, name: largest.name, count: largest.count },
    at: (f) => {
      const t = snap.target;
      const q = snap.position;
      c.camera.setState({ ...snap, position: [0, 1, 2].map((k) => t[k] + (q[k] - t[k]) * f) }, 0);
    },
    marking: (on) => c.setProps({ marking: { ...c.props.marking, enabled: on } }),
    // the marked share of each object with marks (`markerAverage`)
    marked: () => ({
      objects: c
        .getRenderObjects()
        .filter((r) => r.state.visible && r.values.markerAverage?.ref.value > 0)
        .map((r) => +r.values.markerAverage.ref.value.toPrecision(3)),
    }),
    hoverLoci: () => pl.behaviors.interaction.hover.value?.current?.loci,
    // the marks of a case, the same loci at every fraction (picked once, at the canvas' center): a hover through the
    // plugin's highlights (its granularity), a selection as its marker
    mark: (what) => {
      const loci = window.B.loci;
      if (!loci) return false;
      if (what === 'hover') pl.managers.interactivity.lociHighlights.highlightOnly({ loci });
      else c.mark({ loci }, 0x4 /* MarkerAction.Select */);
      return true;
    },
    clearMarks: () => {
      pl.managers.interactivity.lociHighlights.clearHighlights();
      if (window.B.loci) c.mark({ loci: window.B.loci }, 0x8 /* MarkerAction.Deselect */);
    },
    // ms of a marking change at rest, as a hover on and off: the highlight set and cleared in turn, then a tick without
    // a draw request (with marking on the marking pass redrawn over the last image, off the whole frame)
    markChange: async (n = 40) => {
      const loci = window.B.loci;
      if (!loci) return null;
      const h = pl.managers.interactivity.lociHighlights;
      const step = async (i) => {
        if (i % 2) h.highlightOnly({ loci });
        else h.clearHighlights();
        c.tick(performance.now(), { isSynchronous: true });
        if (c.graphics.waitForGpuCommandsCompleteSync) c.graphics.waitForGpuCommandsCompleteSync();
        else await c.graphics.waitForGpuCommandsComplete();
      };
      for (let i = 0; i < 6; i++) await step(i);
      const w = [];
      for (let i = 0; i < n; i++) {
        const t = performance.now();
        await step(i);
        w.push(performance.now() - t);
      }
      h.highlightOnly({ loci });
      await frame();
      w.sort((a, b) => a - b);
      return +w[n >> 1].toFixed(1);
    },
    // the draw calls and instances of one frame (WebGL2: the CPU's culled lists; WebGPU: indirect draws count their
    // records, not the instances the GPU kept)
    calls: async () => {
      const k = c.graphics.stats.calls;
      await frame();
      for (const key of Object.keys(k)) k[key] = 0;
      await frame();
      return { draws: k.drawInstanced + k.drawInstancedBase + k.multiDrawInstancedBase, instances: k.counts };
    },
    scene: async (what, on) => {
      if (what === 'clip' || what === 'ghosts') {
        if (on) {
          const added = await api.run('clipping.add', { shape: 'plane', everything: true });
          clip = added.value?.index ?? 1;
          if (what === 'ghosts') await api.run('clipping.update', { cut: clip, ghost: true });
        } else {
          await api.run('clipping.remove', { cut: clip });
        }
      } else if (what === 'shown' || what === 'transparency') {
        const layer = { selector: { entities: [largest.id] } };
        if (what === 'shown') layer.shown = on ? 0.5 : null;
        else layer.transparency = on ? 0.5 : null;
        const r = await api.run('particles.look', { layers: [layer] });
        if (!r.ok) throw new Error(r.message);
      }
    },
    transparency: () =>
      c
        .getRenderObjects()
        .filter((r) => r.state.visible)
        .map((r) => +(r.values.transparencyAverage?.ref.value ?? 0).toFixed(3)),
  };
});
const info = await page.evaluate(() => {
  const c = window.molstar.viewer.plugin.canvas3d;
  return {
    backend: c.graphics.capabilities?.backend,
    dpr: devicePixelRatio,
    viewport: `${c.camera.viewport.width}x${c.camera.viewport.height}`,
    largest: window.B.largest,
  };
});
console.log(JSON.stringify({ example, ...info }));

// the marked loci: what the pointer hovers at the canvas' center at the first view
await page.mouse.move(box.x + box.width / 2 - 3, box.y + box.height / 2 - 2);
await page.waitForTimeout(400);
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(1500);
console.log(
  JSON.stringify({
    loci: await page.evaluate(() => {
      const l = window.molstar.viewer.plugin.behaviors.interaction.hover.value?.current?.loci;
      window.B.loci = l && l.kind !== 'empty-loci' ? l : undefined;
      return l?.kind;
    }),
  }),
);
await page.mouse.move(box.x + box.width + 100, box.y + 20);
await page.waitForTimeout(1000);

const rows = [];
for (const name of cases) {
  const k = Cases[name];
  if (!k) throw new Error(`no case ${name}`);
  await page.evaluate((on) => window.B.marking(on), k.marking);
  if (k.scene) {
    await page.evaluate((s) => window.B.scene(s, true), k.scene);
    await page.waitForTimeout(4000);
  }
  for (const f of fractions) {
    await page.evaluate((f) => window.B.at(f), f);
    await page.waitForTimeout(800);
    const r = await page.evaluate(
      async ([n, mark]) => {
        const pl = window.molstar.viewer.plugin;
        pl.animationLoop.stop();
        try {
          if (mark) window.B.mark(mark);
          const still = await window.T(n);
          // read after a frame: the averages are computed as the scene draws
          const marked = window.B.marked();
          const calls = await window.B.calls();
          const turning = await window.M(n);
          const change = mark === 'hover' ? await window.B.markChange() : null;
          return { marked, still, turning, change, calls, transparency: window.B.transparency() };
        } finally {
          window.B.clearMarks();
          pl.animationLoop.start();
        }
      },
      [batches, k.mark],
    );
    const row = { case: name, f, ...r };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  if (k.scene) {
    await page.evaluate((s) => window.B.scene(s, false), k.scene);
    await page.waitForTimeout(3000);
  }
}
await page.evaluate(() => window.B.marking(true));
await browser.close();
if (args.json) fs.writeFileSync(args.json, JSON.stringify({ example, ...info, rows }, null, 1));
