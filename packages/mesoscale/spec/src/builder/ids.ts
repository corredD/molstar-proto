/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Id } from '../format/doc.js';
import type { NodeKind } from './refs.js';

// The id policy of the builder (design.md §3.15): an id nobody gave is made from the node's label (or, for a node
// without one, from what it refers to) under the kind's prefix, and made unique within the builder. It depends on the
// calls made and their order only: no state outside the builder, so the same calls make the same ids on every run.

export const IdPrefix: Readonly<Record<NodeKind, string>> = {
  frame: 'f.',
  alignment: 'al.',
  resource: 'r.',
  entity: 'e.',
  superstructure: 's.',
  compartment: 'c.',
  population: 'p.',
  instance: 'i.',
  catalog: 'cat.',
  relation: 'rel.',
  model: 'm.',
  evidence: 'ev.',
  activity: 'act.',
  view: 'v.',
  annotation: 'an.',
  look: 'l.',
  tour: 't.',
};

/** `Insulin granule (β)` → `insulin-granule`: lowercase ASCII words joined by `-`, at most 40 characters. */
export function slug(text: string): string {
  const s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length <= 40) return s;
  const cut = s.lastIndexOf('-', 40);
  return cut > 0 ? s.slice(0, cut) : s.slice(0, 40);
}

/** What follows an id's first `.`: `p.catalase` → `catalase`. */
export const tail = (id: Id) => id.slice(id.indexOf('.') + 1);

/** Every id of one document, one namespace: the builder's registry. */
export class IdRegistry {
  private readonly taken = new Set<Id>();
  private counter = 0;
  /** The next suffix to try per base id: a base made n times costs n probes, not n². */
  private readonly next = new Map<Id, number>();

  has(id: Id) {
    return this.taken.has(id);
  }
  /** Reserves an id given as is (a duplicate stays: `validate` reports `id.duplicate`). */
  reserve(id: Id) {
    this.taken.add(id);
    return id;
  }
  /** A new id under `kind`'s prefix: from `text` if it has letters, else `<prefix><n>`; `-2`, `-3` when taken. */
  make(kind: NodeKind, text: string | undefined): Id {
    const base = IdPrefix[kind] + ((text && slug(text)) || String(++this.counter));
    let id = base;
    let n = this.next.get(base) ?? 2;
    while (this.taken.has(id)) id = `${base}-${n++}`;
    this.next.set(base, n);
    return this.reserve(id);
  }
}
