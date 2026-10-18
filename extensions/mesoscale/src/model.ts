/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Color } from '@molstar/core/util/color';
import { getDistinctBaseColors, getDistinctGroupColors } from '@molstar/core/util/color/distinct';
import { Particle, type ParticleList } from '@molstar/model/model/particles/particle-list';

// The mesoscale view of a particle list (the Mesoscale Explorer's entities and groups, `apps/mesoscale-explorer`):
// its entities with their counts, the compartment of each, and the groups the entities are shown and colored by —
// the compartment tree (cellPACK's `root.envelope.surface.proteins`) or the entity's function.

/** An entity of a particle list (`entityInfo`), with what the explorer shows of it */
export interface MesoEntity {
  readonly id: number;
  readonly name: string;
  /** Its function (`entityInfo.function`: "membrane", "Lipid"), if given */
  readonly function?: string;
  /** Its particles */
  readonly count: number;
  /** The compartment most of its particles are in (`compartmentInfo`), -1: none */
  readonly compartment: number;
}

/** A group of entities: a compartment and its sub-compartments, or a function */
export interface MesoGroup {
  /** `root.envelope.surface` for a compartment, the function's name for a function */
  readonly path: string;
  readonly label: string;
  readonly groups: readonly MesoGroup[];
  /** The entities directly in it (not in its sub-groups) */
  readonly entities: readonly number[];
}

export type MesoGroupBy = 'compartment' | 'function';

/** The entities of `particles`, in the order of their ids; a list without `entityInfo` has one per target */
export function mesoEntities(particles: ParticleList): MesoEntity[] {
  const { count, entityInfo, compartments, targetInfo } = particles;
  const counts = new Map<number, number>();
  const compartmentCounts = new Map<number, Map<number, number>>();
  for (let i = 0; i < count; ++i) {
    const entity = entityInfo ? Particle.entityOf(particles, i) : particles.targets[i];
    counts.set(entity, (counts.get(entity) ?? 0) + 1);
    if (compartments) {
      let c = compartmentCounts.get(entity);
      if (!c) compartmentCounts.set(entity, (c = new Map()));
      c.set(compartments[i], (c.get(compartments[i]) ?? 0) + 1);
    }
  }
  const ids = entityInfo ? Array.from(entityInfo.keys()) : Array.from(targetInfo.keys());
  if (counts.has(-1) && !ids.includes(-1)) ids.push(-1);
  return ids
    .sort((a, b) => a - b)
    .map((id) => {
      const info = entityInfo?.get(id);
      const name = info?.name ?? targetInfo.get(id)?.name ?? (id === -1 ? 'Other' : `Target ${id}`);
      let compartment = -1;
      let most = 0;
      for (const [c, n] of compartmentCounts.get(id) ?? []) {
        if (n > most) [compartment, most] = [c, n];
      }
      return {
        id,
        name,
        ...(info?.function ? { function: info.function } : {}),
        count: counts.get(id) ?? 0,
        compartment,
      };
    });
}

/**
 * The groups of `entities`: by compartment, the tree of their dotted names (each name part a level; entities without a
 * compartment at the root), or by function, one group per function (entities without one in "unknown function").
 */
export function mesoGroups(particles: ParticleList, entities: readonly MesoEntity[], by: MesoGroupBy): MesoGroup {
  interface Mutable {
    path: string;
    label: string;
    groups: Mutable[];
    entities: number[];
  }
  const root: Mutable = { path: '', label: particles.label ?? 'Particles', groups: [], entities: [] };
  const byPath = new Map<string, Mutable>([['', root]]);
  const groupOf = (path: string): Mutable => {
    let g = byPath.get(path);
    if (g) return g;
    const dot = path.lastIndexOf('.');
    const parent = groupOf(dot < 0 ? '' : path.slice(0, dot));
    g = { path, label: dot < 0 ? path : path.slice(dot + 1), groups: [], entities: [] };
    parent.groups.push(g);
    byPath.set(path, g);
    return g;
  };
  for (const e of entities) {
    if (by === 'function') {
      const name = e.function ?? 'unknown function';
      let g = byPath.get(`function:${name}`);
      if (!g) {
        g = { path: name, label: name, groups: [], entities: [] };
        root.groups.push(g);
        byPath.set(`function:${name}`, g);
      }
      g.entities.push(e.id);
    } else {
      const name = e.compartment >= 0 ? particles.compartmentInfo?.get(e.compartment)?.name : undefined;
      (name ? groupOf(name) : root).entities.push(e.id);
    }
  }
  return root;
}

/** The entities of a group and of its sub-groups */
export function groupEntities(group: MesoGroup): number[] {
  return [...group.entities, ...group.groups.flatMap(groupEntities)];
}

/** The group at `path` (a compartment's dotted name, or a function), if any */
export function findGroup(root: MesoGroup, path: string): MesoGroup | undefined {
  if (root.path === path) return root;
  for (const g of root.groups) {
    const found = findGroup(g, path);
    if (found) return found;
  }
}

/**
 * Colors for the entities, as the Mesoscale Explorer generates them (`group-generate`): each group that holds entities
 * directly (a compartment, a function; the loose ones at the root together) gets a distinct base color, and its
 * entities colors around it within `variability` degrees of hue. `shift` (0–100) rotates the colors.
 */
export function generateColors(root: MesoGroup, variability = 20, shift = 0): Map<number, Color> {
  const colors = new Map<number, Color>();
  const holders: MesoGroup[] = [];
  const walk = (g: MesoGroup) => {
    if (g.entities.length) holders.push(g);
    g.groups.forEach(walk);
  };
  walk(root);
  if (holders.length === 1) {
    const generated = getDistinctBaseColors(holders[0].entities.length, shift);
    holders[0].entities.forEach((e, i) => colors.set(e, generated[i]));
    return colors;
  }
  const base = getDistinctBaseColors(holders.length, shift);
  holders.forEach((g, i) => {
    const generated = getDistinctGroupColors(g.entities.length, base[i], variability, shift);
    g.entities.forEach((e, j) => colors.set(e, generated[j]));
  });
  return colors;
}
