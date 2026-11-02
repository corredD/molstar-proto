/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// What do marking and transparency cost in prism-me's look, and what does the sphere skip (spheres a pass discards whole
// leave in the vertex stage, sphere-impostors.md) save? Loads a mesoscale example in headless Chrome (Playwright) and
// per case (nothing marked, a hover, a selection, marking off; a clip with and without Ghosts; an entity shown in part;
// an entity with transparency, by wboit, dpoit or blended; x-ray; the marking depth with a ghost edge below 1) and per
// fraction of the camera's distance (1, 0.1, 0.02) prints, with the skip and without it (`dNoVertexSkip` on every sphere object:
// the shaders as before the skip, in the same page), the frame time still and turning 1° a frame (`zoom-test.js`'s
// batched `T()` and `M()`), for a hover the time of a marking change at rest (on and off apart: with marking on the
// marking pass redrawn over the last image, with it off the whole frame), and the pixels of the image at rest that
// differ between the two. Method and results: apps/prism-me/progress/2026-10-31-marking-cost.md.
//
//   node scripts/esbuild/app.mjs apps/prism-me --dev --port 1367     # in another shell
//   node apps/prism-me/scripts/marking-bench.mjs --port 1367 --backend webgpu --example cellpack-hiv1
//
// Options: --port (1367), --backend webgpu|webgl2 (webgpu), --example (cellpack-hiv1), --fractions (1,0.1,0.02),
// --batches of 20 frames (5), --runs (1; runs alternate the order, the skip first then last), --dpr (1), --cases (all;
// a comma list of the names below), --notimes 1 (images only), --json a file for the numbers, --shots a folder for the
// images at rest (with the skip, and `-noskip` without), --same 1 the skip in both measures (the noise floor of the
// images and times), --eval JavaScript run in the page after the load.

import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright');
const { PNG } = require('pngjs');

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])),
);
const port = +(args.port ?? 1367);
const backend = args.backend ?? 'webgpu';
const example = args.example ?? 'cellpack-hiv1';
const fractions = (args.fractions ?? '1,0.1,0.02').split(',').map(Number);
const batches = +(args.batches ?? 5);
const runs = +(args.runs ?? 1);
const dpr = +(args.dpr ?? 1);
const times = !args.notimes;

// each case: marking on or off, what is marked, the scene's change (set up, then undone), canvas props, x-ray
const Cases = {
  none: { marking: true },
  'none-off': { marking: false },
  hover: { marking: true, mark: 'hover' },
  'hover-off': { marking: false, mark: 'hover' },
  'hover-depth': { marking: true, mark: 'hover', ghostEdgeStrength: 0.3 },
  select: { marking: true, mark: 'select' },
  'select-off': { marking: false, mark: 'select' },
  clip: { marking: true, scene: 'clip' },
  ghosts: { marking: true, scene: 'ghosts' },
  shown: { marking: true, scene: 'shown' },
  transparency: { marking: true, scene: 'transparency' },
  'transparency-dpoit': { marking: true, scene: 'transparency', transparency: 'dpoit' },
  'transparency-blended': { marking: true, scene: 'transparency', transparency: 'blended' },
  xray: { marking: true, mark: 'hover', xray: true },
};
const cases = args.cases ? args.cases.split(',') : Object.keys(Cases);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--ignore-gpu-blocklist', '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
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
  // the transparency mode is the context's (`Canvas3DContext`), not the canvas'
  const ctx = pl.canvas3dContext;
  const look = { marking: { ...c.props.marking }, transparency: ctx.props.transparency };
  const frame = async () => {
    c.requestDraw();
    c.tick(performance.now(), { isSynchronous: true });
    if (c.graphics.waitForGpuCommandsCompleteSync) c.graphics.waitForGpuCommandsCompleteSync();
    else await c.graphics.waitForGpuCommandsComplete();
  };
  const info = (await api.run('mesoscale.entities', {})).value;
  const largest = [...(info?.entities ?? [])].sort((a, b) => b.count - a.count)[0];
  let clip;
  /** every sphere object's values (a merged object's and its members') */
  const sphereValues = () =>
    c
      .getRenderObjects()
      .flatMap((r) => [r.values, ...(r.members ?? [])])
      .filter((v) => v.dNoVertexSkip);
  /** a define of every sphere object, its renderables updated where it changed */
  const setDefine = (name, value) => {
    let changed = false;
    for (const v of sphereValues()) {
      if (v[name].ref.value !== value) {
        v[name].ref.value = value;
        v[name].ref.version += 1;
        changed = true;
      }
    }
    if (changed) c.update();
  };
  window.B = {
    largest: largest && { id: largest.id, name: largest.name, count: largest.count },
    at: (f) => {
      const t = snap.target;
      const q = snap.position;
      c.camera.setState({ ...snap, position: [0, 1, 2].map((k) => t[k] + (q[k] - t[k]) * f) }, 0);
    },
    /** the case's marking and transparency mode over the look's, its x-ray */
    props: (k) => {
      c.setProps({
        marking: {
          ...look.marking,
          enabled: k.marking,
          ghostEdgeStrength: k.ghostEdgeStrength ?? look.marking.ghostEdgeStrength,
        },
      });
      const transparency = k.transparency ?? look.transparency;
      if (ctx.props.transparency !== transparency) ctx.setProps({ transparency });
      setDefine('dXrayShaded', k.xray ? 'on' : 'off');
    },
    /** frames until one starts no work (a pipeline compiling skips its draws) and nothing is pending */
    settle: async () => {
      const pending = c.graphics.resources.pending;
      for (let i = 0; i < 100; i++) {
        const tracked = pending.trackedCount;
        await frame();
        if (pending.trackedCount === tracked && pending.isReady()) break;
        await pending.whenReady();
      }
      for (let i = 0; i < 5; i++) await frame();
    },
    /** with the skip or without (`dNoVertexSkip`), its programs compiled */
    skip: async (on) => {
      setDefine('dNoVertexSkip', !on);
      await window.B.settle();
    },
    // the marked share of each object with marks (`markerAverage`)
    marked: () =>
      c
        .getRenderObjects()
        .filter((r) => r.state.visible && r.values.markerAverage?.ref.value > 0)
        .map((r) => +r.values.markerAverage.ref.value.toPrecision(3)),
    // the marks of a case, the same loci at every fraction (picked once, at the canvas' center): a hover through the
    // plugin's highlights (its granularity), a selection as its marker on the same loci
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
    // a draw request (with marking on the marking pass redrawn over the last image, off the whole frame); the medians of
    // the hovers on and off apart
    markChange: async (n = 20) => {
      const loci = window.B.loci;
      if (!loci) return null;
      const h = pl.managers.interactivity.lociHighlights;
      const step = async (on) => {
        if (on) h.highlightOnly({ loci });
        else h.clearHighlights();
        c.tick(performance.now(), { isSynchronous: true });
        if (c.graphics.waitForGpuCommandsCompleteSync) c.graphics.waitForGpuCommandsCompleteSync();
        else await c.graphics.waitForGpuCommandsComplete();
      };
      for (let i = 0; i < 6; i++) await step(i % 2 === 1);
      const w = [[], []];
      for (let i = 0; i < 2 * n; i++) {
        const on = i % 2 === 1;
        const t = performance.now();
        await step(on);
        w[on ? 1 : 0].push(performance.now() - t);
      }
      h.highlightOnly({ loci });
      await frame();
      const median = (a) => +a.sort((x, y) => x - y)[a.length >> 1].toFixed(1);
      return { on: median(w[1]), off: median(w[0]) };
    },
    // the draw calls and instances of a frame (WebGPU: an indirect record a call, its instances unknown on the CPU);
    // WebGL counts them in timing mode only (`?timing-mode=1`, which times every pass): null there
    calls: async () => {
      if (c.graphics.capabilities?.backend !== 'webgpu') return null;
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

/** the pixels that differ between two PNG buffers, and the largest channel difference */
const differ = (a, b) => {
  const x = PNG.sync.read(a);
  const y = PNG.sync.read(b);
  let n = 0;
  let max = 0;
  for (let i = 0; i < x.data.length; i += 4) {
    const d = Math.max(
      Math.abs(x.data[i] - y.data[i]),
      Math.abs(x.data[i + 1] - y.data[i + 1]),
      Math.abs(x.data[i + 2] - y.data[i + 2]),
    );
    if (d > 0) n++;
    if (d > max) max = d;
  }
  return { pixels: n, of: x.width * x.height, max };
};

/** one measure at the case and view: still (then the image at rest), calls, turning, a hover's change */
const measure = async (k, skip) => {
  await page.evaluate((on) => window.B.skip(on), skip);
  const r = await page.evaluate(
    async ([n, mark, times]) => {
      const pl = window.molstar.viewer.plugin;
      pl.animationLoop.stop();
      if (mark) window.B.mark(mark);
      const still = await window.T(times ? n : 1);
      // read after a frame: the averages are computed as the scene draws
      return { marked: window.B.marked(), still: times ? still : null, calls: times ? await window.B.calls() : null };
    },
    [batches, k.mark, times],
  );
  // the image at rest (the loop stopped: the last frame drawn)
  const image = await (await page.$('canvas')).screenshot();
  Object.assign(
    r,
    await page.evaluate(
      async ([n, mark, times]) => {
        const pl = window.molstar.viewer.plugin;
        try {
          const turning = times ? await window.M(n) : null;
          const change = times && mark === 'hover' ? await window.B.markChange() : null;
          return { turning, change, transparency: window.B.transparency() };
        } finally {
          window.B.clearMarks();
          pl.animationLoop.start();
        }
      },
      [batches, k.mark, times],
    ),
  );
  return { r, image };
};

const rows = [];
for (const name of cases) {
  const k = Cases[name];
  if (!k) throw new Error(`no case ${name}`);
  await page.evaluate((k) => window.B.props(k), k);
  if (k.scene) {
    await page.evaluate((s) => window.B.scene(s, true), k.scene);
    await page.waitForTimeout(4000);
    await page.evaluate(() => window.B.settle());
  }
  for (const f of fractions) {
    await page.evaluate((f) => window.B.at(f), f);
    await page.waitForTimeout(800);
    // a warm-up at the view (its culling settled, its pyramid built, the turn's levels): the first measure was
    // slower
    await page.evaluate(
      async (n) => {
        const pl = window.molstar.viewer.plugin;
        pl.animationLoop.stop();
        try {
          await window.B.settle();
          await window.T(n);
          await window.M(n);
        } finally {
          pl.animationLoop.start();
        }
      },
      Math.max(1, batches >> 1),
    );
    for (let run = 0; run < runs; run++) {
      // the order alternates by run: the machine's drift falls on both
      const order = run % 2 ? [false, true] : [true, false];
      const out = {};
      // --same 1: the skip both times (the images' noise floor)
      for (const skip of order) out[skip ? 'skip' : 'noskip'] = await measure(k, args.same ? true : skip);
      const diff = differ(out.skip.image, out.noskip.image);
      if (args.shots && run === 0) {
        fs.mkdirSync(args.shots, { recursive: true });
        const base = `${args.shots}/${example}-${backend}-${dpr}-${name}-${f}`;
        fs.writeFileSync(`${base}.png`, out.skip.image);
        fs.writeFileSync(`${base}-noskip.png`, out.noskip.image);
      }
      const row = { case: name, f, run, diff, skip: out.skip.r, noskip: out.noskip.r };
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  }
  if (k.scene) {
    await page.evaluate((s) => window.B.scene(s, false), k.scene);
    await page.waitForTimeout(3000);
  }
}
await page.evaluate(() => window.B.props({ marking: true }));
await browser.close();
if (args.json) fs.writeFileSync(args.json, JSON.stringify({ example, ...info, rows }, null, 1));
