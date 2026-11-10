/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Color } from '@molstar/core/util/color';
import type { PluginContext } from '@molstar/plugin/context';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import type { MesoEntity, MesoGroup, MesoGroupBy } from './model.js';

// The owner port (packages/mesoscale/_spec/prism.md §1.1): a particle list another extension owns (a MesoViewSpec
// document's) is not styled by layers. `mesoscale.style`, `.colors`, `.importColors`, `.theme` and `.entities` ask its
// owner first: the entities and groups are the owner's (`info`), an edit becomes the owner's own change (`propose`, a
// patch of its document), inside the same run, so one history step. This extension knows nothing of the owner but this
// port: the owner registers itself on the viewer's plugin.

/** A change to some entities' looks: absent fields kept, null clears one (back to the default), reset drops the look */
export interface OwnedLookChange {
  readonly visible?: boolean;
  readonly color?: Color | null;
  readonly transparency?: number | null;
  readonly emissive?: number | null;
  readonly reset?: boolean;
}

/** One look to change: some entities of the list, or a whole group (as `info` gives its path) */
export interface OwnedLookEdit {
  readonly entities: readonly number[];
  /** The group the entities are, when the person picked a group: the owner may address the group itself */
  readonly group?: string;
  readonly change: OwnedLookChange;
}

/** What an operation proposes to the owner: the looks of one or more of its lists, as one change */
export interface OwnedEdit {
  /** The lists by state ref, each with its looks to change */
  readonly lists: readonly { readonly list: string; readonly looks: readonly OwnedLookEdit[] }[];
  /** What the person did, for the record ("style", "colors", "import colors", "theme") */
  readonly label: string;
}

/** What `info` says of an owned list: its entities and their groups, in the owner's terms */
export interface OwnedListInfo {
  readonly entities: readonly MesoEntity[];
  readonly groups: MesoGroup;
  readonly groupBy: MesoGroupBy;
  readonly hasCompartments: boolean;
}

export interface ParticleListOwner {
  /** Whether the list (by state ref) is this owner's */
  owns(list: string): boolean;
  /** The list's entities and groups (by compartment, or by function: the owner's kinds); undefined when not its own */
  info(list: string, groupBy?: MesoGroupBy): OwnedListInfo | undefined;
  /** The edit as the owner's change, through `api` (the run's: one step) */
  propose(edit: OwnedEdit, api: ViewerApi): Promise<ApiResult>;
  /**
   * The lists' color theme or colors-by-zoom changed (a viewer-only setting): the owner draws its looks again, its
   * default colors only where no theme was chosen (prism.md §5.3)
   */
  themeChanged?(lists: readonly string[], api: ViewerApi): Promise<void>;
}

const owners = new WeakMap<PluginContext, Set<ParticleListOwner>>();

/** Registers an owner of particle lists on a viewer's plugin; returns its removal */
export function registerParticleListOwner(plugin: PluginContext, owner: ParticleListOwner): () => void {
  let set = owners.get(plugin);
  if (!set) owners.set(plugin, (set = new Set()));
  set.add(owner);
  return () => {
    set.delete(owner);
  };
}

/** The owner of a list (by state ref), if another extension owns it */
export function particleListOwner(plugin: PluginContext, list: string): ParticleListOwner | undefined {
  const set = owners.get(plugin);
  if (!set) return undefined;
  for (const o of set) if (o.owns(list)) return o;
  return undefined;
}
