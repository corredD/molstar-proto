/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Vec3 } from '@molstar/core/math/linear-algebra';
import { Color } from '@molstar/core/util/color';
import type { IR } from '@molstar/meso-spec/ir/ir';
import { type Issue, issue } from '@molstar/meso-spec/format/issues';
import { type CommitReport, planCommit, type RendererAdapter } from '@molstar/meso-spec/runtime/adapter';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
// the `particles` API area's types (the feature is lazy: `extensions.load('particles')` before its first use)
import type {} from '@molstar/prism-viewer/features/particles';
import { MesoPlacements, MesoPlacementStore, toParticleList } from './particle-list.js';

// The Prism adapter (design.md §6.5): the IR into a Prism viewer through its operations, as prism-me's rules ask (one
// representation per list, looks as layers through `particles.look`, never a representation per type). Per commit, by
// key (`planCommit`): new sets become lists with a spacefill representation, gone sets are deleted, kept sets are not
// touched; looks are written when they changed, one `particles.look` per list.

const now = () => performance.now();

interface Placed {
  readonly ref: string;
  readonly label: string;
}

export class PrismMesoAdapter implements RendererAdapter {
  readonly id = 'prism';
  private prev: IR | undefined;
  private placed = new Map<string, Placed>();
  /** For tests and stories: the state objects of the lists, by set key. */
  listObject(key: string) {
    const p = this.placed.get(key);
    return p ? this.viewer.plugin.state.data.cells.get(p.ref)?.obj : undefined;
  }
  listRef(key: string) {
    return this.placed.get(key)?.ref;
  }

  constructor(
    readonly viewer: PrismViewer,
    readonly options: { readonly representation?: string; readonly sizeFactor?: number } = {},
  ) {}

  async commit(ir: IR): Promise<CommitReport> {
    const t0 = now();
    const plan = planCommit(this.prev, ir);
    const v = this.viewer;
    if (plan.add.length) await v.extensions.load('particles');
    const particles = v.api.particles;
    if (!particles) throw new Error('The viewer has no particles feature');

    if (plan.remove.length) {
      const b = v.plugin.state.data.build();
      for (const key of plan.remove) {
        const p = this.placed.get(key);
        if (p) b.delete(p.ref);
        this.placed.delete(key);
        MesoPlacementStore.delete(key);
      }
      await v.plugin.runTask(v.plugin.state.data.updateTree(b));
    }
    for (const set of plan.add) {
      const label = `${set.model} · ${set.count.toLocaleString('en-US')} copies`;
      MesoPlacementStore.set(set.key, toParticleList(set, label));
      const b = v.plugin.state.data.build().toRoot().apply(MesoPlacements, { key: set.key, label });
      await v.plugin.runTask(v.plugin.state.data.updateTree(b));
      this.placed.set(set.key, { ref: b.ref, label });
      const r = await particles.representation({
        type: this.options.representation ?? 'spacefill',
        particles: b.ref,
        // spacefill hides fiber particles by default (a Fibers representation draws them); here a filament's subunits
        // are the copies to draw (renderer-recommendations.md A8)
        params:
          set.fibers && (this.options.representation ?? 'spacefill') === 'spacefill' ? { excludeFibers: false } : {},
      } as Parameters<typeof particles.representation>[0]);
      if (!r.ok) throw new Error(`Could not show ${label}: ${r.message}`);
    }
    const t1 = now();

    let looksWritten = 0;
    if (plan.looksChanged) {
      const lists = [...this.placed].map(([key, p]) => ({
        particles: p.ref,
        layers: plan.looks
          // a look on part of a type (copy runs) has no Prism layer selector (renderer-recommendations.md R8)
          .filter((l) => l.set === key && !l.runs)
          .map((l) => ({
            selector: { targets: [...l.types] },
            color: l.color !== undefined ? Color(l.color) : null,
            visible: l.visible ?? true,
            transparency: l.transparency ?? null,
          })),
      }));
      looksWritten = lists.reduce((s, l) => s + l.layers.length, 0);
      if (lists.length) {
        const r = await particles.look({ lists } as unknown as Parameters<typeof particles.look>[0]);
        if (!r.ok) throw new Error(`Looks: ${r.message}`);
      }
    }
    const t2 = now();

    let cameraSet = false;
    const cam = ir.view.camera;
    const canvas = v.plugin.canvas3d;
    if (canvas && (plan.cameraChanged || plan.add.length)) {
      if (cam) {
        // the scene's radius too: the near and far planes follow it, and a radius left from a smaller scene clips the
        // front of a larger one (renderer-recommendations.md, adapter findings A2)
        const sphere = canvas.boundingSphereVisible;
        const radius = Math.max(sphere.radius, 1);
        canvas.camera.setState(
          {
            position: Vec3.create(cam.position[0], cam.position[1], cam.position[2]),
            target: Vec3.create(cam.target[0], cam.target[1], cam.target[2]),
            up: Vec3.create(cam.up[0], cam.up[1], cam.up[2]),
            radius,
            radiusMax: radius,
          },
          0,
        );
      } else canvas.requestCameraReset();
      cameraSet = true;
    }
    const t3 = now();
    // representation hints: spheres drawn; structure and surface fall back to spheres here, said once per hint
    const issues: Issue[] = [];
    const partial = ir.view.looks.filter((l) => l.runs);
    if (partial.length)
      issues.push(
        issue(
          'look.partial',
          'warning',
          'render',
          `${partial.length} look${partial.length === 1 ? '' : 's'} on part of a population (${partial.reduce((n, l) => n + (l.runs!.length >> 1), 0)} copy runs) not drawn: Prism layers select whole targets only`,
        ),
      );
    for (const hint of ['structure', 'surface'] as const) {
      const n = ir.view.looks.filter((l) => l.representation === hint).length;
      if (n)
        issues.push(
          issue(
            'representation.fallback',
            'info',
            'render',
            `${n} type${n === 1 ? '' : 's'} ask to be drawn as ${hint}; the Prism adapter draws spheres`,
          ),
        );
    }
    this.prev = ir;
    return {
      added: plan.add.map((s) => s.key),
      removed: plan.remove,
      kept: plan.keep,
      looksWritten,
      cameraSet,
      issues,
      ms: { total: t3 - t0, sets: t1 - t0, looks: t2 - t1, camera: t3 - t2 },
    };
  }

  /** Removes every list this adapter made. */
  async clear() {
    const b = this.viewer.plugin.state.data.build();
    for (const [key, p] of this.placed) {
      b.delete(p.ref);
      MesoPlacementStore.delete(key);
    }
    this.placed.clear();
    this.prev = undefined;
    await this.viewer.plugin.runTask(this.viewer.plugin.state.data.updateTree(b));
  }

  async dispose() {
    await this.clear();
  }
}
