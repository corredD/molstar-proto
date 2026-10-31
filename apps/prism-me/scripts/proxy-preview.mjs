/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// usage: node apps/prism-me/scripts/proxy-preview.mjs <port> <example> <out dir> <fractions> <level>
// Side-by-side images: the current coarse levels (every n-th atom) against k-means proxies (cellVIEW's) at the same
// camera. In the page, the prefix of each member's positions that a coarse level draws is replaced by the k-means
// centers of all its atoms (k = that level's count), group of the nearest atom. Only valid where the particles in view
// are at that level or coarser.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright');
const [port, example, out, fractionsArg, levelArg] = process.argv.slice(2);
const fractions = fractionsArg.split(',').map(Number);
const level = +levelArg;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--ignore-gpu-blocklist', '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`http://localhost:${port}/apps/prism-me/build/?graphics-backend=webgpu&example=${example}`);
await page.waitForFunction(() => window.molstar?.viewer, null, { timeout: 60000 });
await page.waitForFunction(() => window.molstar.viewer.plugin.canvas3d.getRenderObjects().length > 0, null, {
  timeout: 240000,
  polling: 1000,
});
await page.waitForTimeout(5000);
const canvas = await page.$('canvas');
const shoot = async (name) => {
  await page.evaluate(async () => {
    const c = window.molstar.viewer.plugin.canvas3d;
    for (let i = 0; i < 30; i++) {
      c.requestDraw();
      c.tick(performance.now(), { isSynchronous: true });
      await c.graphics.waitForGpuCommandsComplete();
      await new Promise((r) => setTimeout(r, 16));
    }
  });
  fs.writeFileSync(`${out}/${example}-${name}.png`, await canvas.screenshot());
};
const at = (f) =>
  page.evaluate((f) => {
    const c = window.molstar.viewer.plugin.canvas3d;
    window.__snap ??= c.camera.getSnapshot();
    const s = window.__snap;
    c.camera.setState({ ...s, position: [0, 1, 2].map((k) => s.target[k] + (s.position[k] - s.target[k]) * f) }, 0);
  }, f);
fs.mkdirSync(out, { recursive: true });
for (const f of fractions) {
  await at(f);
  await shoot(`${f}-current`);
}
const info = await page.evaluate((level) => {
  const c = window.molstar.viewer.plugin.canvas3d;
  let members = 0,
    proxies = 0;
  for (const ro of c.getRenderObjects())
    for (const m of ro.members ?? [ro]) {
      const v = m.values;
      const levels = v.lodLevels?.ref.value;
      const pg = v.tPositionGroup?.ref.value;
      const cb = v.centerBuffer?.ref.value;
      const gb = v.groupBuffer?.ref.value;
      if (!levels || levels.length <= level || !pg || !cb) continue;
      const n = cb.length / 3;
      const k = Math.max(1, levels[level][3] / 6);
      if (k >= n) continue;
      // k-means: initial centers the level's current spheres, then Lloyd's steps, nearest center by a grid
      const cx = new Float64Array(k),
        cy = new Float64Array(k),
        cz = new Float64Array(k);
      for (let i = 0; i < k; i++) {
        cx[i] = pg.array[i * 4];
        cy[i] = pg.array[i * 4 + 1];
        cz[i] = pg.array[i * 4 + 2];
      }
      const min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < n; i++)
        for (let d = 0; d < 3; d++) {
          min[d] = Math.min(min[d], cb[i * 3 + d]);
          max[d] = Math.max(max[d], cb[i * 3 + d]);
        }
      const vol = Math.max(1, (max[0] - min[0] + 1) * (max[1] - min[1] + 1) * (max[2] - min[2] + 1));
      const cell = Math.max(2, Math.cbrt(vol / k));
      const assign = new Int32Array(n);
      for (let it = 0; it < 6; it++) {
        const grid = new Map();
        const key = (x, y, z) =>
          `${Math.floor((x - min[0]) / cell)},${Math.floor((y - min[1]) / cell)},${Math.floor((z - min[2]) / cell)}`;
        for (let i = 0; i < k; i++) {
          const kk = key(cx[i], cy[i], cz[i]);
          let l = grid.get(kk);
          if (!l) grid.set(kk, (l = []));
          l.push(i);
        }
        for (let a = 0; a < n; a++) {
          const x = cb[a * 3],
            y = cb[a * 3 + 1],
            z = cb[a * 3 + 2];
          const gx = Math.floor((x - min[0]) / cell),
            gy = Math.floor((y - min[1]) / cell),
            gz = Math.floor((z - min[2]) / cell);
          let best = -1,
            bd = Infinity;
          for (let r = 1; r <= 3 && best < 0; r++) {
            for (let dx = -r; dx <= r; dx++)
              for (let dy = -r; dy <= r; dy++)
                for (let dz = -r; dz <= r; dz++) {
                  const l = grid.get(`${gx + dx},${gy + dy},${gz + dz}`);
                  if (!l) continue;
                  for (const i of l) {
                    const d2 = (cx[i] - x) ** 2 + (cy[i] - y) ** 2 + (cz[i] - z) ** 2;
                    if (d2 < bd) {
                      bd = d2;
                      best = i;
                    }
                  }
                }
          }
          if (best < 0)
            for (let i = 0; i < k; i++) {
              const d2 = (cx[i] - x) ** 2 + (cy[i] - y) ** 2 + (cz[i] - z) ** 2;
              if (d2 < bd) {
                bd = d2;
                best = i;
              }
            }
          assign[a] = best;
        }
        const sx = new Float64Array(k),
          sy = new Float64Array(k),
          sz = new Float64Array(k),
          sn = new Float64Array(k);
        for (let a = 0; a < n; a++) {
          const i = assign[a];
          sx[i] += cb[a * 3];
          sy[i] += cb[a * 3 + 1];
          sz[i] += cb[a * 3 + 2];
          sn[i]++;
        }
        for (let i = 0; i < k; i++)
          if (sn[i] > 0) {
            cx[i] = sx[i] / sn[i];
            cy[i] = sy[i] / sn[i];
            cz[i] = sz[i] / sn[i];
          }
      }
      // the proxies in place of the level's spheres, the group of an atom of theirs
      const grp = new Float64Array(k).fill(-1);
      for (let a = 0; a < n; a++) if (grp[assign[a]] < 0) grp[assign[a]] = gb[a];
      for (let i = 0; i < k; i++) {
        pg.array[i * 4] = cx[i];
        pg.array[i * 4 + 1] = cy[i];
        pg.array[i * 4 + 2] = cz[i];
        if (grp[i] >= 0) pg.array[i * 4 + 3] = grp[i];
      }
      v.tPositionGroup.ref.value = pg;
      v.tPositionGroup.ref.version++;
      members++;
      proxies += k;
    }
  c.update();
  return { members, proxies };
}, level);
console.log(JSON.stringify(info));
for (const f of fractions) {
  await at(f);
  await shoot(`${f}-proxies-level${level}`);
}
await browser.close();
