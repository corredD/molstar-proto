/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { MesoViewSpecDoc } from '@molstar/meso-spec/format';
import type { ParticleTarget } from '@molstar/model/model/particles/particle-list';
import { type RuntimeContext, Task } from '@molstar/core/task';
import { Asset } from '@molstar/core/util/assets';
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

/** Formats Mol* reads a structure from by URI: binary or not, and the data format that parses it. */
const UriFormats: Readonly<Record<string, { readonly binary: boolean; readonly format: string }>> = {
  bcif: { binary: true, format: 'mmcif' },
  mmcif: { binary: false, format: 'mmcif' },
  cif: { binary: false, format: 'mmcif' },
  pdb: { binary: false, format: 'pdb' },
};

/**
 * The structure `entity` is drawn from (the document's entities, then its superstructures'): a PDB accession as the RCSB
 * BinaryCIF, an absolute URI in a format Mol* reads as that URI, parsed as its declared format; none without a
 * structure, or one this viewer cannot read (a relative URI, another database: not yet). A `selection` is not applied
 * yet; it is part of the key, so two selections of one file are not taken for one.
 */
export function entityStructureOf(doc: MesoViewSpecDoc, entity: string): EntityStructure | undefined {
  const structure = (
    doc.entities.find((e) => e.id === entity) ??
    (doc.superstructures ?? []).flatMap((s) => s.entities ?? []).find((e) => e.id === entity)
  )?.structure;
  if (!structure) return undefined;
  const resource = doc.resources?.find((r) => r.id === structure.resource);
  if (!resource) return undefined;
  let source: ParticleTargetSource | undefined;
  if (resource.accession) {
    if (resource.accession.db.toUpperCase() !== 'PDB') return undefined;
    const id = resource.accession.id.toUpperCase();
    source = { kind: 'url', url: `https://models.rcsb.org/${id}.bcif`, isBinary: true, format: 'mmcif' };
  } else if (resource.uri && /^https?:\/\//i.test(resource.uri)) {
    const f = UriFormats[resource.format.toLowerCase()];
    if (!f) return undefined;
    source = { kind: 'url', url: resource.uri, isBinary: f.binary, format: f.format };
  }
  if (!source || source.kind !== 'url') return undefined;
  const { assembly, selection } = structure as { assembly?: string; selection?: string };
  return {
    key: `${source.url}${assembly ? `#${assembly}` : ''}${selection ? `|${selection}` : ''}`,
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
 * The entities' structures, each loaded once by key while kept: the load itself is kept, so two commits at once share
 * it. A failure is said and not kept (the next list made tries again, as after a network blip); a cancelled load is not
 * kept either. `dispose` lets every structure go (a document closed).
 */
export class EntityStructureCache {
  private readonly loaded = new Map<string, Promise<Loaded>>();

  /** The structure of each of `wanted` (loading those not loaded yet), by key; a failure as its message. */
  async load(
    plugin: PluginContext,
    ctx: RuntimeContext,
    wanted: readonly EntityStructure[],
    fetch?: (url: string) => Promise<Uint8Array | undefined>,
  ): Promise<Map<string, ParticleTarget | { readonly error: string }>> {
    const out = new Map<string, ParticleTarget | { readonly error: string }>();
    for (const s of wanted) {
      let pending = this.loaded.get(s.key);
      if (!pending) {
        pending = loadOne(plugin, ctx, s, fetch);
        this.loaded.set(s.key, pending);
      }
      let entry: Loaded;
      try {
        entry = await pending;
      } catch (e) {
        // cancelled: not kept, the next commit loads it
        if (this.loaded.get(s.key) === pending) this.loaded.delete(s.key);
        throw e;
      }
      if (!entry.target && this.loaded.get(s.key) === pending) this.loaded.delete(s.key);
      out.set(s.key, entry.target ?? { error: entry.error ?? 'not loaded' });
    }
    return out;
  }

  /** Lets go of every structure: their assets and their structures' properties. */
  dispose() {
    const all = [...this.loaded.values()];
    this.loaded.clear();
    for (const p of all)
      void p.then(
        (e) => {
          for (const a of e.assets) a.dispose();
          if (e.target?.kind === 'structure') e.target.structure.customPropertyDescriptors.dispose();
        },
        () => {},
      );
  }
}

async function loadOne(
  plugin: PluginContext,
  ctx: RuntimeContext,
  s: EntityStructure,
  fetch?: (url: string) => Promise<Uint8Array | undefined>,
): Promise<Loaded> {
  const assets: Asset.Wrapper[] = [];
  try {
    // a host that fetches for the viewer: its bytes, as a file named as the address (no query, no fragment)
    let source = s.source;
    if (fetch && source.kind === 'url') {
      const url = typeof source.url === 'string' ? source.url : source.url.url;
      const bytes = await fetch(url);
      if (!bytes) throw new Error(`${url} could not be fetched`);
      const path = url.split(/[?#]/)[0];
      const name = path.slice(path.lastIndexOf('/') + 1) || 'structure';
      source = {
        kind: 'file',
        file: Asset.File(new File([bytes as BlobPart], name)),
        ...(source.format ? { format: source.format } : {}),
      };
    }
    let target = await loadParticleTarget(plugin, ctx, source, assets);
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
    if (Task.isAbort(e)) throw e;
    return { target: undefined, assets: [], error: e instanceof Error ? e.message : String(e) };
  }
}
