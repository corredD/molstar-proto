/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// Zoomed in, what does a frame cost, and what is drawn? Loads a mesoscale example in headless Chrome (Playwright),
// moves the camera to fractions of its distance to the target (1, 0.1, 0.02) and prints per fraction the frame time
// (`zoom-test.js`'s batched method, `T()`) and the particles (instances) and spheres: in a cell drawn at a level (what the
// cell culling draws) against those whose own sphere touches the view and the level's distance range. Method and
// results: apps/prism-me/progress/2026-10-31-instance-cull.md.
//
//   node scripts/esbuild/app.mjs apps/prism-me --dev --port 1362     # in another shell
//   node apps/prism-me/scripts/zoom-bench.mjs --port 1362 --backend webgpu --example cellpack-hiv1
//
// Options: --port (1362), --backend webgpu|webgl2 (webgpu), --example (cellpack-hiv1), --fractions (1,0.1,0.02),
// --batches of 20 frames (7), --dpr the device pixel ratio (1; a Retina display 2), --mode the graphics mode (quality), --shots a folder for a PNG per fraction, --json a file
// for the numbers, --eval JavaScript run in the page before measuring (e.g. a renderer prop to compare).

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
const batches = +(args.batches ?? 7);
const mode = args.mode ?? 'quality';

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
if (mode !== 'quality') {
  await page.evaluate((m) => window.molstar.api.run('mesoscale.graphics', { mode: m }), mode);
  await page.waitForTimeout(3000);
}
await page.evaluate(fs.readFileSync(new URL('./zoom-test.js', import.meta.url), 'utf8'));
if (args.eval) await page.evaluate(args.eval);

// the page side: the camera at a fraction of its distance, and the counts from the render objects' instances
await page.evaluate(() => {
  const pl = window.molstar.viewer.plugin;
  const c = pl.canvas3d;
  const snap = c.camera.getSnapshot();
  window.Z = {
    snap,
    at: (f) => {
      const t = snap.target;
      const q = snap.position;
      c.camera.setState({ ...snap, position: [0, 1, 2].map((k) => t[k] + (q[k] - t[k]) * f) }, 0);
    },
    // the frustum's planes from the projection-view matrix (Gribb, Hartmann), normalized, inside positive
    planes: () => {
      const m = c.camera.projectionView;
      const row = (r) => [m[r], m[4 + r], m[8 + r], m[12 + r]];
      const r0 = row(0);
      const r1 = row(1);
      const r2 = row(2);
      const r3 = row(3);
      const ps = [
        r3.map((x, i) => x + r0[i]),
        r3.map((x, i) => x - r0[i]),
        r3.map((x, i) => x + r1[i]),
        r3.map((x, i) => x - r1[i]),
        r3.map((x, i) => x + r2[i]),
        r3.map((x, i) => x - r2[i]),
      ];
      return ps.map((p) => {
        const l = Math.hypot(p[0], p[1], p[2]);
        return p.map((x) => x / l);
      });
    },
    counts: () => {
      const planes = Z.planes();
      const inside = (x, y, z, r) => planes.every((p) => p[0] * x + p[1] * y + p[2] * z + p[3] >= -r);
      const cam = c.camera.state.position;
      const dir = [0, 1, 2].map((k) => c.camera.state.target[k] - cam[k]);
      const dl = Math.hypot(...dir);
      const n = dir.map((x) => x / dl);
      const depth = (x, y, z) => n[0] * (x - cam[0]) + n[1] * (y - cam[1]) + n[2] * (z - cam[2]);
      const H = c.camera.viewport.height / (c.graphics.pixelRatio || c.webgl?.pixelRatio || devicePixelRatio);
      const k = 2 / (c.camera.projection[5] * H);
      const out = {
        cellInstances: [0, 0, 0, 0],
        ownInstances: [0, 0, 0, 0],
        cellSpheres: [0, 0, 0, 0],
        ownSpheres: [0, 0, 0, 0],
      };
      let objects = 0;
      // a merged object's members: each its own instances, grid and levels
      const objects_ = c.getRenderObjects().flatMap((ro) => (ro.state.visible ? (ro.members ?? [ro]) : []));
      for (const ro of objects_) {
        const v = ro.values;
        if (!v.lodLevels?.ref.value?.length || !v.instanceGrid) continue;
        const levels = v.lodLevels.ref.value;
        const pixel = (levels.pixelSize ?? 0) > 0;
        const ranges = levels.map((l) => (pixel ? [l[0] / k, Math.min(l[1] / k, 1e9)] : [l[0], l[1]]));
        const spheresAt = levels.map((l) => l[3] / 6);
        const grid = v.instanceGrid.ref.value;
        const tr = v.aTransform.ref.value;
        const b = v.invariantBoundingSphere.ref.value;
        const count = v.instanceCount.ref.value;
        objects++;
        const test = (x, y, z, r, outI, outS) => {
          if (!inside(x, y, z, r)) return;
          const d = depth(x, y, z);
          for (let j = 0; j < ranges.length && j < 4; j++) {
            if (d + r < ranges[j][0] || d - r > ranges[j][1]) continue;
            outI[j] += 1;
            outS[j] += spheresAt[j];
          }
        };
        // per instance: its own sphere
        for (let i = 0; i < count; i++) {
          const o = i * 16;
          const [bx, by, bz] = b.center;
          const x = tr[o] * bx + tr[o + 4] * by + tr[o + 8] * bz + tr[o + 12];
          const y = tr[o + 1] * bx + tr[o + 5] * by + tr[o + 9] * bz + tr[o + 13];
          const z = tr[o + 2] * bx + tr[o + 6] * by + tr[o + 10] * bz + tr[o + 14];
          const s = Math.hypot(tr[o], tr[o + 1], tr[o + 2]);
          test(x, y, z, b.radius * s, out.ownInstances, out.ownSpheres);
        }
        // per cell: every instance of a cell drawn at a level
        if (grid.cellSize <= 1) {
          const s = v.boundingSphere.ref.value;
          const cI = [0, 0, 0, 0];
          const cS = [0, 0, 0, 0];
          test(s.center[0], s.center[1], s.center[2], s.radius, cI, cS);
          for (let j = 0; j < 4; j++) {
            out.cellInstances[j] += cI[j] * count;
            out.cellSpheres[j] += cS[j] * count;
          }
        } else {
          for (let q = 0; q < grid.cellCount; q++) {
            const m = grid.cellOffsets[q + 1] - grid.cellOffsets[q];
            if (!m) continue;
            const cs = grid.cellSpheres;
            const cI = [0, 0, 0, 0];
            const cS = [0, 0, 0, 0];
            test(cs[q * 4], cs[q * 4 + 1], cs[q * 4 + 2], cs[q * 4 + 3], cI, cS);
            for (let j = 0; j < 4; j++) {
              out.cellInstances[j] += cI[j] * m;
              out.cellSpheres[j] += cS[j] * m;
            }
          }
        }
      }
      const M = (a) => a.map((x) => +(x / 1e6).toFixed(3));
      return {
        objects,
        cellInstances: out.cellInstances,
        ownInstances: out.ownInstances,
        cellSpheresM: M(out.cellSpheres),
        ownSpheresM: M(out.ownSpheres),
      };
    },
  };
});

const rows = [];
const info = await page.evaluate(() => {
  const c = window.molstar.viewer.plugin.canvas3d;
  return {
    backend: c.graphics.capabilities?.backend,
    dpr: devicePixelRatio,
    viewport: `${c.camera.viewport.width}x${c.camera.viewport.height}`,
  };
});
console.log(JSON.stringify({ example, mode, ...info }));
for (const f of fractions) {
  const r = await page.evaluate(
    async ([f, n]) => {
      const pl = window.molstar.viewer.plugin;
      pl.animationLoop.stop();
      try {
        window.Z.at(f);
        const ms = await window.T(n);
        return { f, ms, ...window.Z.counts() };
      } finally {
        pl.animationLoop.start();
      }
    },
    [f, batches],
  );
  rows.push(r);
  console.log(JSON.stringify(r));
  if (args.shots) {
    fs.mkdirSync(args.shots, { recursive: true });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(args.shots, `${example}-${backend}-${f}.png`) });
  }
}
await browser.close();
if (args.json) fs.writeFileSync(args.json, JSON.stringify({ example, mode, ...info, rows }, null, 1));
