/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { IR, IRLook, IRNode } from '../ir/ir.js';
import type { PlacementSet } from '../ir/placements.js';
import { mulQuat } from '../resolvers/precomputed.js';

// Instancing (design.md §3.9, §6.5): the IR keeps a superstructure once (its template sets, in its own frame) and the
// poses of its copies; nothing is multiplied there. A renderer with nested instancing would take that as it is. One
// without (Mol*'s particle lists take structures, shapes and volumes as targets, not other lists:
// renderer-recommendations.md R7) gets `flattenInstances`: every instance set × template set expanded into one
// world-frame set, cached by the pair of keys, so a view edit expands nothing again and keeps every object.

export interface Flattened {
  /** The drawable sets (world frame) and the view's looks remapped onto them; an IR an adapter commits as usual. */
  readonly ir: IR;
  /** Copies and bytes the expansion materialized (0 when nothing is instanced). */
  readonly expandedCopies: number;
  readonly expandedBytes: number;
  /** Copies and bytes the IR holds for the same scene (instance poses + templates). */
  readonly instancedBytes: number;
}

export type ExpansionCache = Map<string, PlacementSet>;

export function flattenInstances(ir: IR, cache: ExpansionCache = new Map()): Flattened {
  const ssNodes = new Map<string, IRNode>();
  const collect = (n: IRNode) => {
    if (n.kind === 'superstructure') ssNodes.set(n.params.superstructure, n);
    for (const c of n.children ?? []) collect(c);
  };
  collect(ir.root);

  // the looks of every set met, drawn or not: the view's, then (an instance set) its instanced types hidden, then (an
  // expansion) those of the template it expands, so a look reaches every level of nesting
  const looksOf = new Map<string, IRLook[]>();
  for (const l of ir.view.looks) looksOf.set(l.set, [...(looksOf.get(l.set) ?? []), l]);
  const hiddenSet = new Set<string>();

  let expandedCopies = 0;
  let expandedBytes = 0;
  let instancedBytes = 0;

  /** The drawable sets of a subtree (not inside a nested superstructure), instances expanded (recursively). */
  const drawable = (n: IRNode, out: PlacementSet[]) => {
    if (n.kind === 'superstructure') return;
    if (n.kind === 'placements') {
      const set = n.params.set;
      const inst = (n.children ?? []).filter(
        (c): c is Extract<IRNode, { kind: 'instances' }> => c.kind === 'instances' && c.params.detail === 'parts',
      );
      out.push(set);
      for (const i of inst) {
        if (!hiddenSet.has(`${set.key}|${i.params.type}`)) {
          hiddenSet.add(`${set.key}|${i.params.type}`);
          looksOf.set(set.key, [
            ...(looksOf.get(set.key) ?? []),
            { set: set.key, types: [i.params.type], visible: false },
          ]);
        }
        const tplNode = ssNodes.get(i.params.superstructure);
        if (!tplNode) continue;
        const tpl: PlacementSet[] = [];
        for (const c of tplNode.children ?? []) drawable(c, tpl);
        instancedBytes += i.params.instances * 36;
        for (const t of tpl) {
          const key = `${set.key}|${i.params.type}*${t.key}`;
          let e = cache.get(key);
          if (!e) {
            e = expand(set, i.params.type, t, key);
            cache.set(key, e);
          }
          expandedCopies += e.count;
          expandedBytes += e.count * 36;
          const looks: IRLook[] = [];
          for (const l of looksOf.get(t.key) ?? []) if (!l.runs) looks.push({ ...l, set: key });
          // looks on copies inside one instance (`part`): the instance's block of the expansion, in pose order
          for (const l of ir.view.looks) {
            const m = /^(.*)@(\d+)>(.*)$/.exec(l.set);
            if (!m || m[1] !== set.key || m[3] !== t.key || !l.runs) continue;
            const at = Number(m[2]);
            if (set.types[at] !== i.params.type) continue;
            let rank = 0;
            for (let q = 0; q < at; q++) if (set.types[q] === i.params.type) rank++;
            looks.push({ ...l, set: key, runs: l.runs.map((v) => v + rank * t.count) });
          }
          looksOf.set(key, looks);
          out.push(e);
        }
      }
      return;
    }
    for (const c of n.children ?? []) drawable(c, out);
  };
  const sets: PlacementSet[] = [];
  drawable(ir.root, sets);
  for (const n of ssNodes.values()) {
    const tpl: PlacementSet[] = [];
    for (const c of n.children ?? []) drawable(c, tpl);
    for (const t of tpl) instancedBytes += t.count * 36;
  }
  const looks = sets.flatMap((s) => looksOf.get(s.key) ?? []);
  const root: IRNode = {
    ref: 'flattened',
    kind: 'scene',
    params: { units: 'A', title: 'flattened' },
    children: sets.map((set) => ({ ref: set.key, kind: 'placements', params: { set } })),
  };
  return { ir: { root, view: { ...ir.view, looks } }, expandedCopies, expandedBytes, instancedBytes };
}

/** The copies of `type` in `inst`, each standing for every copy of `tpl` moved by its pose. */
function expand(inst: PlacementSet, type: number, tpl: PlacementSet, key: string): PlacementSet {
  const poses: number[] = [];
  for (let i = 0; i < inst.count; i++) if (inst.types[i] === type) poses.push(i);
  const n = poses.length * tpl.count;
  const positions = new Float32Array(n * 3);
  const rotations = new Float32Array(n * 4);
  const types = new Int32Array(n);
  const ordinals = new Int32Array(n);
  const q = [0, 0, 0, 1];
  let o = 0;
  for (const i of poses) {
    const qi = inst.rotations.subarray(4 * i, 4 * i + 4);
    const [x, y, z, w] = qi;
    const tx = inst.positions[3 * i],
      ty = inst.positions[3 * i + 1],
      tz = inst.positions[3 * i + 2];
    for (let j = 0; j < tpl.count; j++, o++) {
      // p' = q_i · p_j + t_i
      const vx = tpl.positions[3 * j],
        vy = tpl.positions[3 * j + 1],
        vz = tpl.positions[3 * j + 2];
      const cx = 2 * (y * vz - z * vy),
        cy = 2 * (z * vx - x * vz),
        cz = 2 * (x * vy - y * vx);
      positions[3 * o] = vx + w * cx + (y * cz - z * cy) + tx;
      positions[3 * o + 1] = vy + w * cy + (z * cx - x * cz) + ty;
      positions[3 * o + 2] = vz + w * cz + (x * cy - y * cx) + tz;
      mulQuat(q, qi, tpl.rotations.subarray(4 * j, 4 * j + 4));
      rotations.set(q, 4 * o);
      types[o] = tpl.types[j];
      ordinals[o] = tpl.ordinals[j];
    }
  }
  let fibers: PlacementSet['fibers'];
  if (tpl.fibers) {
    const offsets: number[] = [0];
    const indices = new Int32Array(tpl.fibers.indices.length * poses.length);
    for (let k = 0; k < poses.length; k++) {
      for (let f = 0; f < tpl.fibers.count; f++)
        offsets.push(tpl.fibers.offsets[f + 1] + k * tpl.fibers.indices.length);
      for (let m = 0; m < tpl.fibers.indices.length; m++)
        indices[k * tpl.fibers.indices.length + m] = tpl.fibers.indices[m] + k * tpl.count;
    }
    fibers = { count: tpl.fibers.count * poses.length, offsets: Int32Array.from(offsets), indices };
  }
  return {
    key,
    model: tpl.model,
    frame: 'world',
    count: n,
    positions,
    rotations,
    types,
    ordinals,
    typeTable: tpl.typeTable,
    fibers,
  };
}
