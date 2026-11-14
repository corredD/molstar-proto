/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { OrderedSet } from '@molstar/core/data/int';
import { Particle, type ParticleList } from '@molstar/model/model/particles/particle-list';
import type { PluginContext } from '@molstar/plugin/context';
import { type ObservableState, observableState } from '@molstar/prism-ui/reactive/observable-state';

// Pick instances (paint-group; progress/2026-11-13-paint-group.md): while on, a click on a particle of the list adds
// or removes its instance (a group copy whole), shown selected in 3D; Make group (`mesoscale.group`) takes them. View
// state: no step. The canvas is in selection mode meanwhile (a plain click neither moves the camera nor resets it; its
// select toggle is overridden by the instances' selection, set after it); leaving that mode ends the picking.

/** An instance: its particles as drawn (`first`, `count`: a group copy's leaves, else one) */
export interface PickedInstance {
  readonly first: number;
  readonly count: number;
}

export interface GroupPickState {
  readonly particles: string;
  readonly instances: readonly PickedInstance[];
}

export class InstancePick {
  /** The list picked in and its instances, in the order picked; undefined: off */
  readonly state: ObservableState<GroupPickState | undefined> = observableState<GroupPickState | undefined>(undefined);

  constructor(
    private readonly plugin: PluginContext,
    /** A particle's instance: its group copy's particles, else none (the particle alone) */
    private readonly instanceAt: (particles: string, index: number) => PickedInstance | undefined,
  ) {}

  /** Whether the canvas was in selection mode before the picking (it is left as it was) */
  private selecting = false;

  /** Starts picking in a list (the instances picked before let go) */
  start(particles: string) {
    if (!this.state.value) this.selecting = this.plugin.selectionMode;
    this.state.set({ particles, instances: [] });
    if (!this.plugin.selectionMode) this.plugin.selectionMode = true;
    this.mark();
  }

  stop() {
    if (!this.state.value) return;
    this.state.set(undefined);
    this.plugin.managers.interactivity.lociSelects.deselectAll();
    if (!this.selecting && this.plugin.selectionMode) this.plugin.selectionMode = false;
  }

  /** A click on particle `index` of `particles`: its instance added or removed; false when not picking in that list */
  toggle(particles: string, index: number): boolean {
    const s = this.state.value;
    if (!s || s.particles !== particles) return false;
    const at = this.instanceAt(particles, index) ?? { first: index, count: 1 };
    const has = s.instances.some((x) => x.first === at.first);
    this.state.set({
      particles,
      instances: has ? s.instances.filter((x) => x.first !== at.first) : [...s.instances, at],
    });
    this.mark();
    return true;
  }

  /** The instances' first particles (a group copy's member stands for the copy: `mesoscale.group`) */
  get indices(): number[] {
    return this.state.value?.instances.map((x) => x.first) ?? [];
  }

  /** The instances' particles selected in 3D (the list as drawn: its first representation's) */
  private mark() {
    const s = this.state.value;
    const selects = this.plugin.managers.interactivity.lociSelects;
    selects.deselectAll();
    if (!s?.instances.length) return;
    const l = this.plugin.managers.particles.hierarchy.current.lists.find((x) => x.cell.transform.ref === s.particles);
    const data = l?.representations[0]?.cell.obj?.data.sourceData as ParticleList | undefined;
    if (!data) return;
    const indices: number[] = [];
    for (const x of s.instances) for (let i = x.first; i < x.first + x.count && i < data.count; ++i) indices.push(i);
    indices.sort((a, b) => a - b);
    selects.select({ loci: Particle.Loci(data, OrderedSet.ofSortedArray(indices)) });
  }
}
