/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { DecorationsInfo } from '@molstar/cryoet-extension/operations';
import { groupEntities, type MesoGroup } from '@molstar/mesoscale-extension/model';
import type { MesoscaleInfo } from '@molstar/mesoscale-extension/operations';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import type { Category, NodeRef, SceneObject } from './operations.js';

// The rows of the explorer's tree (_spec/ui.md §3), flat, from the scene's objects and the parts the mesoscale and
// cryo-ET areas read; and what a row's eye runs.

/** The parts of a particle object: a model's entities and groups, a list's targets */
export type Parts = ReadonlyMap<string, MesoscaleInfo | DecorationsInfo | undefined>;

export const Categories: readonly { id: Category; label: string }[] = [
  { id: 'structures', label: 'Structures' },
  { id: 'particles', label: 'Particles' },
  { id: 'volumes', label: 'Volumes' },
  { id: 'meshes', label: 'Meshes' },
];

/** A row of the tree, flat (its depth says where it is) */
export interface Row {
  readonly key: string;
  readonly depth: number;
  readonly label: string;
  readonly kind: string;
  readonly count?: string;
  readonly color?: number;
  /** Its eye: whether shown; absent, no eye */
  readonly visible?: boolean;
  readonly hasChildren: boolean;
  /** What it stands for in 3D (none for a category) */
  readonly node?: NodeRef;
  /** A representation's row: its state ref */
  readonly representation?: string;
}

// --- the rows ---------------------------------------------------------------------------------------------------------

export function rowsOf(
  objects: readonly SceneObject[],
  parts: Parts,
  open: ReadonlySet<string>,
  filter: string,
): Row[] {
  const f = filter.trim().toLowerCase();
  const rows: Row[] = [];
  const push = (r: Row, children: () => void) => {
    rows.push(r);
    if (r.hasChildren && (open.has(r.key) || f)) children();
  };
  for (const c of Categories) {
    const items = objects.filter((o) => o.category === c.id);
    if (!items.length) continue;
    push(
      { key: `c:${c.id}`, depth: 0, label: c.label, kind: 'category', count: String(items.length), hasChildren: true },
      () => {
        for (const o of items) objectRows(o, parts.get(o.ref), push, f);
      },
    );
  }
  return f ? rows.filter((r) => r.kind === 'category' || r.label.toLowerCase().includes(f)) : rows;
}

type Push = (r: Row, children: () => void) => void;

function objectRows(o: SceneObject, part: MesoscaleInfo | DecorationsInfo | undefined, push: Push, f: string) {
  const base = { depth: 1, label: o.label, count: o.count, visible: o.visible, node: { ref: o.ref } };
  if (o.kind === 'structure') {
    push({ ...base, key: `o:${o.ref}`, kind: 'structure', hasChildren: !!o.entities?.length }, () => {
      for (const e of o.entities ?? []) {
        push(
          {
            key: `e:${o.ref}:${e.id}`,
            depth: 2,
            label: e.label,
            kind: 'entity',
            count: e.chains.length > 1 ? `${e.chains.length} chains` : undefined,
            hasChildren: e.chains.length > 1,
            node: { ref: o.ref, entity: e.id },
          },
          () => {
            for (const ch of e.chains) {
              push(
                {
                  key: `ch:${o.ref}:${e.id}:${ch}`,
                  depth: 3,
                  label: `Chain ${ch}`,
                  kind: 'chain',
                  hasChildren: false,
                  node: { ref: o.ref, entity: e.id, chain: ch },
                },
                () => {},
              );
            }
          },
        );
      }
    });
    return;
  }
  if (o.kind === 'model') {
    const info = part as MesoscaleInfo | undefined;
    push({ ...base, key: `o:${o.ref}`, kind: 'mesoscale model', hasChildren: !!info?.entities.length }, () => {
      if (!info) return;
      const byId = new Map(info.entities.map((e) => [e.id, e]));
      const walk = (g: MesoGroup, depth: number) => {
        for (const child of g.groups) {
          const members = groupEntities(child);
          const shown = members.some((id) => byId.get(id)?.visible);
          push(
            {
              key: `g:${o.ref}:${child.path}`,
              depth,
              label: child.label,
              kind: 'group',
              count: String(members.length),
              visible: shown,
              hasChildren: true,
              node: { ref: o.ref, particles: { entities: members } },
            },
            () => walk(child, depth + 1),
          );
        }
        for (const id of g.entities) {
          const e = byId.get(id);
          if (!e) continue;
          push(
            {
              key: `me:${o.ref}:${id}`,
              depth,
              label: e.name,
              kind: 'entity',
              count: e.count.toLocaleString('en'),
              visible: e.visible,
              ...(e.color !== undefined ? { color: e.color } : {}),
              hasChildren: false,
              node: { ref: o.ref, particles: { entities: [id] } },
            },
            () => {},
          );
        }
      };
      walk(info.groups, 2);
    });
    return;
  }
  if (o.kind === 'list') {
    const info = part as DecorationsInfo | undefined;
    push({ ...base, key: `o:${o.ref}`, kind: 'particle list', hasChildren: !!info?.targets.length }, () => {
      for (const t of info?.targets ?? []) {
        push(
          {
            key: `t:${o.ref}:${t.id}`,
            depth: 2,
            label: t.with ? `${t.name} · ${t.with}` : t.name,
            kind: 'target',
            count: t.count.toLocaleString('en'),
            hasChildren: false,
            node: { ref: o.ref, particles: { targets: [t.id] } },
          },
          () => {},
        );
      }
    });
    return;
  }
  if (o.kind === 'volume') {
    push({ ...base, key: `o:${o.ref}`, kind: 'volume', hasChildren: !!o.representations?.length }, () => {
      for (const r of o.representations ?? []) {
        push(
          {
            key: `r:${r.ref}`,
            depth: 2,
            label: r.label,
            kind: r.type === 'slice' || r.type === 'isosurface' ? r.type : 'volume representation',
            visible: r.visible,
            hasChildren: false,
            node: { ref: o.ref },
            representation: r.ref,
          },
          () => {},
        );
      }
    });
    return;
  }
  push({ ...base, key: `o:${o.ref}`, kind: 'mesh', hasChildren: false }, () => {});
  void f;
}

/** A row's eye: the visibility operation of what it stands for */
export function toggleVisible(api: ViewerApi, row: Row) {
  const visible = !row.visible;
  const node = row.node;
  if (!node) return;
  switch (row.kind) {
    case 'structure':
      return api.run('structure.visibility', { structure: node.ref, visible });
    case 'mesoscale model':
    case 'particle list':
      return api.run('particles.visibility', { particles: node.ref, visible });
    case 'group':
    case 'entity':
      if ('particles' in node) {
        return api.run('mesoscale.style', {
          particles: node.ref,
          entities: (node.particles.entities ?? []).join(','),
          visible,
        });
      }
      return;
    case 'volume':
      return api.run('volume.visibility', { volume: node.ref, visible });
    case 'slice':
    case 'isosurface':
    case 'volume representation':
      return api.run('volume.visibility', { node: row.representation!, visible });
    case 'mesh':
      return api.run('cryoet.mesh', { mesh: node.ref, visible });
  }
}

/**
 * Keeps the rows that did not change as the same objects (the tree's `For` remakes a row whose object is new): a
 * change remakes only the rows it touched, an unfolded model's thousands of entities stay as they are.
 */
export function stableRows() {
  let last = new Map<string, { row: Row; json: string }>();
  return (rows: readonly Row[]): Row[] => {
    const next = new Map<string, { row: Row; json: string }>();
    const out = rows.map((row) => {
      const json = JSON.stringify(row);
      const old = last.get(row.key);
      const kept = old && old.json === json ? old : { row, json };
      next.set(row.key, kept);
      return kept.row;
    });
    last = next;
    return out;
  };
}
