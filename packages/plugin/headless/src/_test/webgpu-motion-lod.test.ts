/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Vec3 } from '@molstar/core/math/linear-algebra';
import type { Vec4 } from '@molstar/core/math/linear-algebra/3d/vec4';
import { now } from '@molstar/core/util/now';
import type { ValueCell } from '@molstar/core/util/value-cell';
import type { MultiDrawBaseData } from '@molstar/graphics/gl/render-item';
import { HeadlessPluginContext } from '@molstar/plugin-headless/context';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';
import { WebGPU } from './webgpu-module.js';

const Size = 64;

describe.skipIf(!WebGPU.module)('levels of detail while the camera moves (Canvas3D motion)', () => {
  it('draws coarser levels while the camera changes, full detail once it rests', async () => {
    const plugin = await HeadlessPluginContext.create(
      { webgpu: WebGPU.module! },
      DefaultPluginSpec(),
      { width: Size, height: Size },
      { backend: 'webgpu' },
    );
    try {
      await plugin.init();
      // a chain of 16 atoms, 40 copies: instances culled on the CPU by their grid, with levels
      const f = (v: number) => v.toFixed(3).padStart(8);
      const atoms = Array.from({ length: 16 }, (_, i) => {
        const [x, y, z] = [(i % 4) * 1.2, Math.floor(i / 4) * 1.2, 0];
        return `ATOM  ${String(i + 1).padStart(5)}  CA  ALA A${String(i + 1).padStart(4)}    ${f(x)}${f(y)}${f(z)}  1.00  0.00           C`;
      });
      const biomt: string[] = ['REMARK 350 BIOMOLECULE: 1', 'REMARK 350 APPLY THE FOLLOWING TO CHAINS: A'];
      for (let k = 0; k < 40; ++k) {
        const n = String(k + 1).padStart(4);
        biomt.push(`REMARK 350   BIOMT1 ${n}  1.000000  0.000000  0.000000 ${f((k % 8) * 6)}`);
        biomt.push(`REMARK 350   BIOMT2 ${n}  0.000000  1.000000  0.000000 ${f(Math.floor(k / 8) * 6)}`);
        biomt.push(`REMARK 350   BIOMT3 ${n}  0.000000  0.000000  1.000000        0.00000`);
      }
      const pdb = `${biomt.join('\n')}\n${atoms.join('\n')}\nEND\n`;
      const data = await plugin.builders.data.rawData({ data: pdb, label: 'test' });
      const trajectory = await plugin.builders.structure.parseTrajectory(data, 'pdb');
      const model = await plugin.builders.structure.createModel(trajectory);
      const structure = await plugin.builders.structure.createStructure(model, {
        name: 'assembly',
        params: { id: '1' },
      });
      // the level ranges a frame draws with: the first level's `uLod` (a cell the lists keep; frames replayed from
      // recordings read it without rendering their items again), its end in Å of distance
      const graphics = plugin.canvas3d!.graphics;
      const create = graphics.createGraphicsRenderItem;
      let uLod: ValueCell<Vec4> | undefined;
      graphics.createGraphicsRenderItem = (...args) => {
        const item = create(...args);
        const render = item.render;
        item.render = (variant, globals, list?: MultiDrawBaseData[]) => {
          const cell = list?.[0]?.uniforms.find(([name]) => name === 'uLod')?.[1];
          if (variant === 'color' && cell) uLod = cell as ValueCell<Vec4>;
          render(variant, globals, list);
        };
        return item;
      };
      const levelEnd = () => uLod!.ref.value[1];
      await plugin.builders.structure.representation.addRepresentation(structure, {
        type: 'spacefill',
        // levels by size on screen (3 px)
        typeParams: {
          lodPixelSize: 3,
          lodLevels: [
            { minDistance: 1, maxDistance: 300, overlap: 0, stride: 1, scaleBias: 1 },
            { minDistance: 300, maxDistance: 10000000, overlap: 0, stride: 10, scaleBias: 3 },
          ],
        },
      });
      const canvas = plugin.canvas3d!;
      // perspective: levels by distance from the camera
      canvas.setProps({
        camera: { ...canvas.props.camera, mode: 'perspective' },
        motion: { lodScale: 2, holdMs: 250 },
      });
      let time = now();
      const tick = async (ms: number) => {
        canvas.commit(true);
        canvas.tick((time += ms) as now.Timestamp, { isSynchronous: true });
        await canvas.graphics.resources.pending.whenReady();
      };
      for (let i = 0; i < 5; ++i) {
        canvas.requestDraw();
        await tick(1000);
      }
      const rest = levelEnd();
      expect(rest).toBeGreaterThan(0);

      // the camera turning: a frame per 16 ms, each a new view
      const { target, position } = canvas.camera.state;
      for (let i = 1; i <= 3; ++i) {
        const p = Vec3.add(Vec3(), position, Vec3.create(i * 0.5, 0, 0));
        canvas.camera.setState({ target: Vec3.clone(target), position: p }, 0);
        await tick(16);
      }
      // twice as coarse: the first level ends at half the distance
      expect(levelEnd()).toBeCloseTo(rest / 2, 3);

      // at rest past the hold: a frame at full detail, drawn without a request
      await tick(300);
      expect(levelEnd()).toBeCloseTo(rest, 3);
    } finally {
      plugin.dispose();
    }
  }, 60_000);
});
