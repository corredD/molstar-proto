/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { MesoViewSpecDoc } from '@molstar/meso-spec/format';
import type { ParticleTarget } from '@molstar/model/model/particles/particle-list';
import type { RuntimeContext } from '@molstar/core/task';
import type { Asset } from '@molstar/core/util/assets';
import type { PluginContext } from '@molstar/plugin/context';
import { loadParticleTarget, type ParticleTargetSource } from '@molstar/plugin/state/helpers/particle-targets';
import { RootStructureDefinition } from '@molstar/plugin/state/helpers/root-structure';

// A document's entities drawn from their structures (lane `mvs-lod-bands`, bands.md "In prism-me"): an entity's
// `structure` resource as a source Mol*'s particle targets load (`loadParticleTarget`, as paint's brushes), its assembly
// built from the model; the loaded targets kept by source, so a re-pack loads nothing again.

/** What an entity is drawn from: where to load it and what of it to build. */
export interface EntityStructure {
  /** Its source and assembly: what a loaded structure is kept by. */
  readonly key: string;
  /** For what is said of it (`resource.unavailable`). */
  readonly name: string;
  readonly source: ParticleTargetSource;
  /** An assembly id; none: the model. */
  readonly assembly?: string;
}

/** Formats Mol* reads a structure from by URI, binary or not. */
const UriFormats: Readonly<Record<string, boolean>> = { bcif: true, mmcif: false, cif: false, pdb: false };

/**
 * The structure `entity` is drawn from: a PDB accession as the RCSB BinaryCIF, an absolute URI in a format Mol* reads as
 * that URI; none without a structure, or one this viewer cannot read (a relative URI, another database: not yet).
 */
export function entityStructureOf(doc: MesoViewSpecDoc, entity: string): EntityStructure | undefined {
  const structure = doc.entities.find((e) => e.id === entity)?.structure;
  if (!structure) return undefined;
  const resource = doc.resources.find((r) => r.id === structure.resource);
  if (!resource) return undefined;
  let source: ParticleTargetSource | undefined;
  if (resource.accession) {
    if (resource.accession.db.toUpperCase() !== 'PDB') return undefined;
    const id = resource.accession.id.toUpperCase();
    source = { kind: 'url', url: `https://models.rcsb.org/${id}.bcif`, isBinary: true };
  } else if (resource.uri && /^https?:\/\//i.test(resource.uri)) {
    const binary = UriFormats[resource.format.toLowerCase()];
    if (binary === undefined) return undefined;
    source = { kind: 'url', url: resource.uri, isBinary: binary };
  }
  if (!source || source.kind !== 'url') return undefined;
  const assembly = structure.assembly;
  return {
    key: `${source.url}${assembly ? `#${assembly}` : ''}`,
    name: resource.label ?? entity,
    source,
    ...(assembly ? { assembly } : {}),
  };
}

interface Loaded {
  readonly target: ParticleTarget | undefined;
  readonly assets: Asset.Wrapper[];
  /** Why it could not load. */
  readonly error?: string;
}

/**
 * The entities' structures, each loaded once by key while the adapter lives; one that fails is kept as failed (not
 * fetched again on every commit) until `dispose`.
 */
export class EntityStructureCache {
  private readonly loaded = new Map<string, Loaded>();

  /** The structure of each of `wanted` (loading those not loaded yet), by key; a failure as its message. */
  async load(
    plugin: PluginContext,
    ctx: RuntimeContext,
    wanted: readonly EntityStructure[],
  ): Promise<Map<string, ParticleTarget | { readonly error: string }>> {
    const out = new Map<string, ParticleTarget | { readonly error: string }>();
    for (const s of wanted) {
      let entry = this.loaded.get(s.key);
      if (!entry) {
        entry = await loadOne(plugin, ctx, s);
        this.loaded.set(s.key, entry);
      }
      out.set(s.key, entry.target ?? { error: entry.error ?? 'not loaded' });
    }
    return out;
  }

  /** Lets go of every structure: their assets and their structures' properties. */
  dispose() {
    for (const e of this.loaded.values()) {
      for (const a of e.assets) a.dispose();
      if (e.target?.kind === 'structure') e.target.structure.customPropertyDescriptors.dispose();
    }
    this.loaded.clear();
  }
}

async function loadOne(plugin: PluginContext, ctx: RuntimeContext, s: EntityStructure): Promise<Loaded> {
  const assets: Asset.Wrapper[] = [];
  try {
    let target = await loadParticleTarget(plugin, ctx, s.source, assets);
    if (s.assembly && target.kind === 'structure') {
      const model = target.structure;
      const built = await RootStructureDefinition.create(plugin, ctx, model.model, {
        name: 'assembly',
        params: { id: s.assembly },
      } as RootStructureDefinition.Params);
      if (built.data !== model) model.customPropertyDescriptors.dispose();
      target = { kind: 'structure', structure: built.data };
    }
    return { target, assets };
  } catch (e) {
    for (const a of assets) a.dispose();
    return { target: undefined, assets: [], error: e instanceof Error ? e.message : String(e) };
  }
}
