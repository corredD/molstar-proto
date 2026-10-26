/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { StateBuilder } from '@molstar/core/state';
import type { Color } from '@molstar/core/util/color';
import {
  type ParticleCutProps,
  type ParticleLayerProps,
  ParticleRepresentation3DLayers,
} from '@molstar/plugin/state/transforms/particles/layers';

// A particle representation's looks (`ParticleRepresentation3DLayers`): its layers (color, transparency, visibility,
// emissive of some particles), its cuts of some particles and the targets it leaves out. Several writers share the
// cell (styles, targets left out, cuts); each patches what it names and keeps the rest. This is the only code that
// creates or deletes the cell.

/** Which particles a layer is for: by entity, compartment or target ids; none: every particle */
export interface ParticleLookSelector {
  readonly entities?: readonly number[];
  readonly compartments?: readonly number[];
  readonly targets?: readonly number[];
}

/** A change to the layer of a selector: absent fields kept, `null` clears one, `reset` drops the layer first */
export interface ParticleLayerPatch {
  readonly selector: ParticleLookSelector;
  readonly visible?: boolean;
  readonly color?: Color | null;
  readonly transparency?: number | null;
  readonly emissive?: number | null;
  readonly reset?: boolean;
}

/** A change to a representation's looks: each absent field kept */
export interface ParticleLookPatch {
  readonly layers?: readonly ParticleLayerPatch[];
  /** The targets left out (drawn by another representation), replaced */
  readonly hidden?: readonly number[];
  /** Cuts of some particles: added (one of the same tag replaced), removed by tag */
  readonly cuts?: { readonly add?: readonly ParticleCutPatch[]; readonly remove?: readonly string[] };
}

/** A cut of some particles: the representation's clip object tagged `tag` cuts only the selector's */
export interface ParticleCutPatch extends ParticleLookSelector {
  readonly tag: string;
}

interface LookParams {
  readonly layers: readonly ParticleLayerProps[];
  readonly cuts: readonly ParticleCutProps[];
  readonly hidden: readonly number[];
}

const sorted = (ids: readonly number[] | undefined) =>
  ids?.length ? Array.from(new Set(ids)).sort((a, b) => a - b) : [];

const isIds = (ids: unknown) => ids === undefined || (Array.isArray(ids) && ids.every(Number.isInteger));
const isUnit = (x: unknown) => x === undefined || x === null || (typeof x === 'number' && x >= 0 && x <= 1);
const isSelector = (s: unknown): s is ParticleLookSelector =>
  !!s && typeof s === 'object' && ['entities', 'compartments', 'targets'].every((k) => isIds((s as any)[k]));

/** What is wrong with a patch given as values (an agent's JSON), none when it is well formed */
export function particleLookPatchError(patch: ParticleLookPatch): string | undefined {
  const { layers, hidden, cuts } = patch as { layers?: unknown; hidden?: unknown; cuts?: unknown };
  if (layers !== undefined) {
    if (!Array.isArray(layers)) return 'layers is a list.';
    for (const l of layers as ParticleLayerPatch[]) {
      if (!l || !isSelector(l.selector))
        return 'Each layer has a selector of integer ids: { entities, compartments, targets }.';
      if (l.visible !== undefined && typeof l.visible !== 'boolean') return 'visible is true or false.';
      if (l.color !== undefined && l.color !== null && !Number.isInteger(l.color))
        return 'color is a color number or null.';
      if (!isUnit(l.transparency) || !isUnit(l.emissive)) return 'transparency and emissive are 0 to 1, or null.';
    }
  }
  if (hidden !== undefined && !isIds(hidden)) return 'hidden is a list of target ids.';
  if (cuts !== undefined) {
    const { add, remove } = (cuts ?? {}) as { add?: unknown; remove?: unknown };
    if (
      add !== undefined &&
      !(
        Array.isArray(add) &&
        add.every(
          (c) => isSelector(c) && typeof (c as ParticleCutPatch).tag === 'string' && !!(c as ParticleCutPatch).tag,
        )
      )
    ) {
      return 'Each cut added has a tag and integer ids.';
    }
    if (remove !== undefined && !(Array.isArray(remove) && remove.every((t) => typeof t === 'string'))) {
      return 'cuts.remove is a list of tags.';
    }
  }
  return undefined;
}

/** A layer's key: its selector's ids by kind, sorted */
const keyOf = (s: { entities: readonly number[]; compartments: readonly number[]; targets: readonly number[] }) =>
  `${s.entities.join(',')}|${s.compartments.join(',')}|${s.targets.join(',')}`;

const isNoChange = (l: ParticleLayerProps) =>
  l.visible && l.color === null && l.transparency === null && l.emissive === null;

const sameLayer = (a: ParticleLayerProps, b: ParticleLayerProps) =>
  a.visible === b.visible && a.color === b.color && a.transparency === b.transparency && a.emissive === b.emissive;

function sameIds(a: readonly number[], b: readonly number[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; ++i) if (a[i] !== b[i]) return false;
  return true;
}

/** The layers cell of a representation in the builder's tree (one applied earlier in the same builder too) */
export function particleLookCell(b: StateBuilder.Root, reprRef: string): string | undefined {
  const tree = b.currentTree;
  if (!tree.transforms.has(reprRef)) return undefined;
  for (const child of tree.children.get(reprRef).toArray()) {
    if (tree.transforms.get(child)?.transformer === ParticleRepresentation3DLayers) return child;
  }
  return undefined;
}

function patchLayers(old: readonly ParticleLayerProps[], patches: readonly ParticleLayerPatch[]) {
  const layers: (ParticleLayerProps | undefined)[] = [...old];
  const at = new Map<string, number>();
  for (let i = 0; i < layers.length; ++i) at.set(keyOf(layers[i]!), i);
  let changed = false;
  for (const p of patches) {
    const selector = {
      entities: sorted(p.selector.entities),
      compartments: sorted(p.selector.compartments),
      targets: sorted(p.selector.targets),
    };
    const key = keyOf(selector);
    const i = at.get(key);
    const was = i === undefined ? undefined : layers[i];
    const base = p.reset || !was ? { visible: true, color: null, transparency: null, emissive: null } : was;
    const next: ParticleLayerProps = {
      ...selector,
      visible: p.visible ?? base.visible,
      color: p.color !== undefined ? p.color : base.color,
      transparency: p.transparency !== undefined ? p.transparency : base.transparency,
      emissive: p.emissive !== undefined ? p.emissive : base.emissive,
    };
    const keep = !isNoChange(next);
    if (was && keep && sameLayer(was, next)) continue;
    if (!was && !keep) continue;
    changed = true;
    if (i !== undefined) layers[i] = keep ? next : undefined;
    else {
      // new: over the others (later layers paint over earlier ones)
      at.set(key, layers.length);
      layers.push(next);
    }
  }
  return changed ? layers.filter((l): l is ParticleLayerProps => !!l) : old;
}

function patchCuts(old: readonly ParticleCutProps[], patch: NonNullable<ParticleLookPatch['cuts']>) {
  const drop = new Set<string>([...(patch.remove ?? []), ...(patch.add ?? []).map((c) => c.tag)]);
  if (!drop.size) return old;
  const cuts = old.filter((c) => !drop.has(c.tag));
  for (const c of patch.add ?? []) {
    cuts.push({
      tag: c.tag,
      entities: sorted(c.entities),
      compartments: sorted(c.compartments),
      targets: sorted(c.targets),
    });
  }
  if (cuts.length === old.length && cuts.every((c, i) => sameCut(c, old[i]))) return old;
  return cuts;
}

const sameCut = (a: ParticleCutProps, b: ParticleCutProps) =>
  a.tag === b.tag &&
  sameIds(a.entities, b.entities) &&
  sameIds(a.compartments, b.compartments) &&
  sameIds(a.targets, b.targets);

/**
 * Patches the looks of the particle representation `reprRef` in `b` (applied, updated or deleted when left empty;
 * a representation added earlier in `b` too). Whether it changed anything.
 */
export function patchParticleLook(b: StateBuilder.Root, reprRef: string, patch: ParticleLookPatch): boolean {
  const ref = particleLookCell(b, reprRef);
  const old = (ref ? b.currentTree.transforms.get(ref).params : undefined) as Partial<LookParams> | undefined;
  const oldLayers = old?.layers ?? [];
  const oldCuts = old?.cuts ?? [];
  const oldHidden = old?.hidden ?? [];
  const layers = patch.layers ? patchLayers(oldLayers, patch.layers) : oldLayers;
  const cuts = patch.cuts ? patchCuts(oldCuts, patch.cuts) : oldCuts;
  const nextHidden = patch.hidden ? Array.from(new Set(patch.hidden)).sort((a, b) => a - b) : oldHidden;
  const hidden = sameIds(nextHidden, oldHidden) ? oldHidden : nextHidden;
  if (layers === oldLayers && cuts === oldCuts && hidden === oldHidden) return false;
  const params = { ...old, layers: [...layers], cuts: [...cuts], hidden: [...hidden] };
  if (!layers.length && !cuts.length && !hidden.length) {
    if (!ref) return false;
    b.delete(ref);
  } else if (ref) b.to(ref).update(params as never);
  else b.to(reprRef).apply(ParticleRepresentation3DLayers, params as never);
  return true;
}

/**
 * The layers of the representation `fromRef` on the representation `toRef` too, in `b` (a list's looks are on each of
 * its representations); not its cuts, whose clip objects are its own, nor the targets it leaves out
 */
export function copyParticleLayers(b: StateBuilder.Root, fromRef: string, toRef: string): boolean {
  const ref = particleLookCell(b, fromRef);
  const layers = (ref ? b.currentTree.transforms.get(ref).params?.layers : undefined) as
    | readonly ParticleLayerProps[]
    | undefined;
  if (!layers?.length) return false;
  return patchParticleLook(b, toRef, {
    layers: layers.map(({ entities, compartments, targets, ...look }) => ({
      selector: { entities, compartments, targets },
      ...look,
    })),
  });
}
