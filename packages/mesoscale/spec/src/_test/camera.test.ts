/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { betaCellDoc, BetaCellResources } from '../examples/betacell.js';
import { exosomeDoc } from '../examples/exosome.js';
import type { MesoViewSpecDoc } from '../format/doc.js';
import { validate } from '../format/validate.js';
import { type IR, placementSets } from '../ir/ir.js';
import { DefaultResolvers } from '../resolvers/index.js';
import { compile, updateView } from '../runtime/runtime.js';
import { compileExosome } from './helpers.js';

// The semantic camera (design.md §5.1): a view framed by an address, materialized from the copies it picks; numeric
// cameras placed by their view's frame.

const load = (id: string) => BetaCellResources[id]?.();
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function granulePose(ir: IR, n: number, model = 'default:meso.pack') {
  const cell = placementSets(ir).find((s) => s.model === model)!;
  const g = cell.typeTable.find((t) => t.population === 'p.granules')!.index;
  const idx = [...cell.types.keys()].filter((i) => cell.types[i] === g)[n];
  return [cell.positions[3 * idx], cell.positions[3 * idx + 1], cell.positions[3 * idx + 2]];
}

describe('semantic camera', () => {
  it('frames one granule by its address, from outside the cell', async () => {
    const r = await compile(betaCellDoc(), { resolvers: DefaultResolvers, load });
    const ir = updateView({ ...betaCellDoc(), session: { view: 'v.granule-12' } }, r.ir!);
    const cam = ir.view.camera!;
    // granule 12's pose: the 13th copy of p.granules in the cell's set
    const pose = granulePose(r.ir!, 12);
    // its VAMP2 sits on its membrane: their centre is near the granule's centre, their sphere about the granule's
    expect(dist(cam.target, pose)).toBeLessThan(150);
    expect(cam.focus!.radius).toBeGreaterThan(1300);
    expect(cam.focus!.radius).toBeLessThan(1600);
    // from outside: the camera is farther from the cell's centre than the granule, along the same line
    expect(Math.hypot(...cam.position)).toBeGreaterThan(Math.hypot(...pose));
    expect(cam.transition).toBe(1500);
    // the cutaway and the annotation materialize too
    expect(ir.view.cutaway?.length).toBeGreaterThan(0);
    expect(dist(ir.view.annotations![0].position!, cam.target)).toBeLessThan(1e-6);
  });

  it('re-resolving moves the scene; the semantic camera follows the same granule', async () => {
    // a new seed repacks the cell: granule 12 moves, and the camera moves with it
    const run = async (seed: number) => {
      const d = betaCellDoc();
      const model = {
        id: 'm.cell',
        kind: 'procedural' as const,
        method: 'meso.pack',
        populations: ['p.granules', 'p.ribosomes'],
        seed,
      };
      const doc = { ...d, models: [model], session: { view: 'v.granule-12' } };
      const r = await compile(doc, { resolvers: DefaultResolvers, load });
      return { target: r.ir!.view.camera!.target, pose: granulePose(r.ir!, 12, 'm.cell') };
    };
    const a = await run(3);
    const b = await run(7);
    expect(dist(a.pose, b.pose)).toBeGreaterThan(100);
    expect(dist(a.target, a.pose)).toBeLessThan(150);
    expect(dist(b.target, b.pose)).toBeLessThan(150);
  });

  it('a numeric camera in a tomogram frame lands where the tomogram is', async () => {
    const d = exosomeDoc();
    // the tomogram's centre, in voxels: the alignment puts it at the world origin
    const doc = {
      ...d,
      views: [{ id: 'v.tomo', frame: 'f.tomo', camera: { position: [200, 200, 400], target: [200, 200, 100] } }],
      session: { view: 'v.tomo' },
    };
    const r = await compileExosome(doc);
    const cam = r.ir!.view.camera!;
    expect(dist(cam.target, [0, 0, 0])).toBeLessThan(1e-6);
    expect(dist(cam.position, [0, 0, 3000])).toBeLessThan(1e-6);
  });

  it('a camera needs a focus or a position and a target; tours name views', () => {
    const d = betaCellDoc();
    const bad = {
      ...d,
      views: [{ id: 'v', camera: { framing: 'fit' as const } }],
      tours: [{ id: 't', steps: [{ view: 'v.nope' }] }],
    };
    const codes = validate(bad)
      .filter((i) => i.severity === 'error')
      .map((i) => i.code);
    expect(codes).toContain('value.range');
    expect(codes).toContain('ref.missing');
    expect(validate(betaCellDoc()).filter((i) => i.severity === 'error')).toEqual([]);
  });
  // review gate R4 + RN1: a view frame turns the camera's directions (up, from, position − target), not only its points;
  // and the up the IR states is perpendicular to the view direction
  const unit = (v: readonly number[]) => v.map((x) => x / Math.hypot(v[0], v[1], v[2]));
  const cos = (a: readonly number[], b: readonly number[]) => unit(a).reduce((x, v, k) => x + v * unit(b)[k], 0);
  const turned = (camera: Record<string, unknown>) => {
    const d = exosomeDoc();
    const s = Math.SQRT1_2;
    // the tomogram frame turned a quarter about x: its y is the world's z
    return {
      ...d,
      alignments: [{ ...d.alignments![0], transform: { translation: [0, 0, 0], rotation: [s, 0, 0, s] } }],
      views: [{ id: 'v.tomo', frame: 'f.tomo', camera }],
      session: { view: 'v.tomo' },
    } as MesoViewSpecDoc;
  };

  it('a numeric camera in a turned frame: its up turns with the frame', async () => {
    const r = await compileExosome(turned({ position: [0, 0, 300], target: [0, 0, 0], up: [0, 1, 0] }));
    const c = r.ir!.view.camera!;
    const dir = c.target.map((v, k) => v - c.position[k]);
    expect(dist(c.position, [0, -3000, 0])).toBeLessThan(1e-6);
    expect(dist(c.up, [0, 0, 1])).toBeLessThan(1e-6);
    expect(Math.abs(cos(dir, c.up))).toBeLessThan(1e-6);
  });

  it('a semantic camera in a turned frame: its `from` direction turns with the frame', async () => {
    const r = await compileExosome(turned({ focus: '(all)', framing: 'fit', from: [0, 0, 1] }));
    const c = r.ir!.view.camera!;
    // from +z in the frame is from -y in the world
    expect(
      cos(
        c.position.map((v, k) => v - c.target[k]),
        [0, -1, 0],
      ),
    ).toBeGreaterThan(1 - 1e-6);
    expect(
      Math.abs(
        cos(
          c.position.map((v, k) => v - c.target[k]),
          c.up,
        ),
      ),
    ).toBeLessThan(1e-6);
  });

  it("every shipped view's up is perpendicular to its view direction (v.docked looks along y)", async () => {
    const r = await compile(betaCellDoc(), { resolvers: DefaultResolvers, load });
    for (const v of betaCellDoc().views ?? []) {
      const c = updateView({ ...betaCellDoc(), session: { view: v.id } }, r.ir!).view.camera;
      if (!c) continue;
      expect(
        Math.abs(
          cos(
            c.target.map((x, k) => x - c.position[k]),
            c.up,
          ),
        ),
        v.id,
      ).toBeLessThan(0.9);
      expect(
        Math.abs(
          cos(
            c.target.map((x, k) => x - c.position[k]),
            c.up,
          ),
        ),
        v.id,
      ).toBeLessThan(1e-6);
      expect(Math.hypot(...c.up), v.id).toBeCloseTo(1, 9);
    }
  });
  it("a numeric annotation is a point in the view's frame, placed as the camera is", async () => {
    const doc = turned({ position: [0, 0, 300], target: [0, 0, 0] });
    const d = {
      ...doc,
      views: [{ ...doc.views![0], annotations: [{ id: 'a', text: 'a', target: { position: [0, 0, 300] } }] }],
    };
    const r = await compileExosome(d as MesoViewSpecDoc);
    expect(dist(r.ir!.view.annotations![0].position!, r.ir!.view.camera!.position)).toBeLessThan(1e-6);
  });
});
