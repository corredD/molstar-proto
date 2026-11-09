/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { betaCellDoc, BetaCellResources, exosomeDoc, ExosomeResources } from '@molstar/meso-spec/examples';
import { placementSets } from '@molstar/meso-spec/ir';
import { DefaultResolvers } from '@molstar/meso-spec/resolvers';
import { compile, flattenInstances, planCommit } from '@molstar/meso-spec/runtime';
import { describe, expect, it } from 'vitest';
import { type CameraCanvas, commitCamera, sceneRadius } from '../prism-adapter.js';

// The adapter's camera step against a recording canvas (quick lane: the headless viewer has no Canvas3D). What it
// proves: the radius comes from the IR, not from a canvas that has not committed the new sets yet, and the canvas
// commits (so its own first-representation reset happens) before the IR camera is set.

function recordingCanvas() {
  const calls: { op: string; state?: { radius?: number; radiusMax?: number } }[] = [];
  const canvas = {
    // what the canvas reports before its first commit
    boundingSphereVisible: { center: [0, 0, 0], radius: 0 },
    commit: () => calls.push({ op: 'commit' }),
    requestCameraReset: () => calls.push({ op: 'reset' }),
    camera: { setState: (state: { radius?: number }) => calls.push({ op: 'setState', state }) },
  } as unknown as CameraCanvas;
  return { canvas, calls };
}

async function betaCell() {
  const r = await compile(betaCellDoc(), { resolvers: DefaultResolvers, load: (id) => BetaCellResources[id]?.() });
  return flattenInstances(r.ir!).ir;
}

describe('the Prism adapter camera', () => {
  // gate A4: the radius was read from canvas.boundingSphereVisible before the canvas committed the new sets (radius 1
  // on a first open), and Canvas3D's reset on its first representations could land after the IR camera
  it('a first commit: the canvas commits, then the IR camera is set with the scene radius from the IR', async () => {
    const ir = await betaCell();
    expect(ir.view.camera).toBeDefined();
    const { canvas, calls } = recordingCanvas();
    const radius = sceneRadius(placementSets(ir));
    expect(radius).toBeGreaterThan(1000);
    expect(commitCamera(canvas, ir, planCommit(undefined, ir), () => radius)).toBe(true);
    expect(calls.map((c) => c.op)).toEqual(['commit', 'setState']);
    expect(calls[1].state).toMatchObject({ radius, radiusMax: radius });
  });

  it('the scene radius covers every copy', async () => {
    const ir = await betaCell();
    const sets = placementSets(ir);
    const r = sceneRadius(sets);
    // the box's centre, and every copy within r of it
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const s of sets)
      for (let i = 0; i < s.count; i++)
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], s.positions[3 * i + k]);
          hi[k] = Math.max(hi[k], s.positions[3 * i + k]);
        }
    const c = lo.map((x, k) => (x + hi[k]) / 2);
    for (const s of sets)
      for (let i = 0; i < s.count; i += 97) {
        const d = Math.hypot(s.positions[3 * i] - c[0], s.positions[3 * i + 1] - c[1], s.positions[3 * i + 2] - c[2]);
        expect(d + s.typeTable[s.types[i]].radius).toBeLessThanOrEqual(r + 1e-6);
      }
  });

  // gate A9: any added set re-applied the IR camera (or reset it), so a model edit lost the user's orbit
  it('a model edit that adds a set with the camera unchanged leaves the camera alone', async () => {
    const options = { resolvers: DefaultResolvers, load: (id: string) => ExosomeResources[id]?.(), cache: new Map() };
    const prev = (await compile(exosomeDoc(), options)).ir!;
    const doc = {
      ...exosomeDoc(),
      populations: exosomeDoc().populations.map((p) =>
        p.id === 'p.miRNA' ? { ...p, abundance: { concentration: { value: 0.0008, unit: 'M' as const } } } : p,
      ),
    };
    const next = (await compile(doc, options)).ir!;
    const plan = planCommit(prev, next);
    expect(plan.add.length).toBe(1);
    expect(plan.cameraChanged).toBe(false);
    const { canvas, calls } = recordingCanvas();
    expect(commitCamera(canvas, next, plan, () => 1000)).toBe(false);
    expect(calls).toEqual([]);
    // a view without a camera: no reset either
    const bare = { ...next, view: { ...next.view, camera: undefined } };
    expect(commitCamera(canvas, bare, planCommit({ ...prev, view: bare.view }, bare), () => 1000)).toBe(false);
    expect(calls).toEqual([]);
  });
});
