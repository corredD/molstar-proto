/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { PluginStateTransform, PluginStateObject as SO } from '@molstar/plugin/state/objects';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { type RuntimeContext, Task } from '@molstar/core/task';
import type { PluginContext } from '@molstar/plugin/context';
import {
  particleTargetFormatOptions,
  particleTargetFileExtensions,
  type ParticleTargetSource,
  matchParticleTargetFiles,
  loadParticleTarget,
  isParticleTargetObject,
  particleTargetFromObject,
} from '@molstar/plugin/state/helpers/particle-targets';
import { Asset } from '@molstar/core/util/assets';
import { type ParticleList, type ParticleTarget, Particle } from '@molstar/model/model/particles/particle-list';
import { type StateObject, StateSelection, type StateTransform, StateTransformer } from '@molstar/core/state';

const plus1 = (v: number) => v + 1,
  minus1 = (v: number) => v - 1;

export { ParticleListFromTrajectory };
type ParticleListFromTrajectory = typeof ParticleListFromTrajectory;
const ParticleListFromTrajectory = PluginStateTransform.BuiltIn({
  name: 'particle-list-from-trajectory',
  display: { name: 'Particle List from Trajectory', description: 'Extract a single frame from a ParticleTrajectory.' },
  from: SO.Particle.Trajectory,
  to: SO.Particle.List,
  params: (a) => {
    if (!a) {
      return { frameIndex: PD.Numeric(0, {}, { description: 'Zero-based index of the frame', immediateUpdate: true }) };
    }
    return {
      frameIndex: PD.Converted(
        plus1,
        minus1,
        PD.Numeric(
          1,
          { min: 1, max: a.data.frameCount, step: 1 },
          { description: 'Frame Index', immediateUpdate: true },
        ),
      ),
    };
  },
})({
  isApplicable: (a) => a.data.frameCount > 0,
  apply({ a, params }) {
    return Task.create('Particle List from Trajectory', async (ctx) => {
      const idx = Math.max(0, Math.min(params.frameIndex, a.data.frameCount - 1));
      const list = await Task.resolveInContext(a.data.getFrameAtIndex(idx), ctx);
      return new SO.Particle.List(list, {
        label: list.label || 'Particles',
        description: `Frame ${params.frameIndex + 1} of ${a.data.frameCount}`,
      });
    });
  },
});

/** The structures, shapes and volumes in the state a target can reference. */
function targetObjectOptions(plugin: PluginContext): [string, string][] {
  const cells = plugin.state.data.select(
    StateSelection.Generators.root.subtree().filter((cell) => isParticleTargetObject(cell.obj)),
  );
  return cells.map((c) => [c.transform.ref, c.obj!.label] as [string, string]);
}

function ParticleListWithTargetsParams(a: SO.Particle.List | undefined, plugin: PluginContext) {
  const targetIds = a ? Array.from(a.data.targetInfo.keys()).sort((x, y) => x - y) : [];
  const targetIdDescription =
    targetIds.length > 0
      ? `Target ID in the particle list this object maps to. Available IDs: ${targetIds.slice(0, 32).join(', ')}${targetIds.length > 32 ? ', …' : ''}.`
      : 'Target ID in the particle list this object maps to (matches ParticleList.targets).';
  const formatOptions = particleTargetFormatOptions(plugin);
  const objectOptions = targetObjectOptions(plugin);

  return {
    files: PD.FileList({
      accept: particleTargetFileExtensions(plugin),
      multiple: true,
      description:
        'Reference objects matched to particle targets by exact filename (without extension) and entity name.',
    }),
    targets: PD.ObjectList(
      {
        targetId: PD.Numeric(0, { min: 0, step: 1 }, { description: targetIdDescription }),
        source: PD.MappedStatic(
          'file',
          {
            file: PD.Group(
              {
                file: PD.File({ accept: particleTargetFileExtensions(plugin) }),
                format: PD.Select('auto', formatOptions),
              },
              { isFlat: true },
            ),
            url: PD.Group(
              {
                url: PD.Url('', { label: 'URL' }),
                format: PD.Select('auto', formatOptions),
                isBinary: PD.Optional(
                  PD.Boolean(false, { description: 'Leave unset to derive from the file extension.' }),
                ),
              },
              { isFlat: true },
            ),
            ref: PD.Group(
              {
                ref:
                  objectOptions.length > 0
                    ? PD.Select(objectOptions[0][0], objectOptions, { label: 'Object' })
                    : PD.Text('', {
                        label: 'Object',
                        description: 'Ref of a structure, shape or volume in the state.',
                      }),
              },
              { isFlat: true },
            ),
          },
          {
            options: [
              ['file', 'File'],
              ['url', 'URL'],
              ['ref', 'Object in the scene'],
            ] as ['url' | 'file' | 'ref', string][],
          },
        ),
      },
      (e) => `Target ${e.targetId}`,
      {
        description: 'Reference objects instanced at each particle, mapped per particle target ID.',
      },
    ),
    includeParent: PD.Boolean(true, {
      description: 'Keep the reference objects the particle list already provides (e.g. built by its format).',
    }),
  };
}

type ParticleListWithTargetsProps = PD.Values<ReturnType<typeof ParticleListWithTargetsParams>>;
type TargetSourceProps = ParticleListWithTargetsProps['targets'][number]['source'];

/** A reference object loaded for one source, with the assets it keeps alive */
interface LoadedTarget {
  readonly target: ParticleTarget;
  readonly assets: Asset.Wrapper[];
}

interface ParticleListWithTargetsCache {
  /** The loaded reference objects by source (`sourceKey`), reused by an update whose source did not change */
  loaded?: Map<string, LoadedTarget>;
  /** The data of the referenced state objects the targets were made from */
  refData?: Map<string, unknown>;
  sourceTargetMapping?: ParticleList['targetMapping'];
  sourceEntityInfo?: ParticleList['entityInfo'];
}

/** What identifies a target source: its kind and where it comes from; the same key is the same reference object */
function sourceKey(source: TargetSourceProps): string | undefined {
  switch (source.name) {
    case 'file':
      return source.params.file ? `file:${source.params.file.id}:${source.params.format}` : undefined;
    case 'url': {
      const { url, format, isBinary } = source.params;
      return url ? `url:${Asset.getUrl(url)}:${format}:${isBinary}` : undefined;
    }
    case 'ref':
      return source.params.ref ? `ref:${source.params.ref}` : undefined;
  }
}

function targetSource(source: TargetSourceProps): ParticleTargetSource | undefined {
  if (source.name === 'url') {
    const { url, format, isBinary } = source.params;
    return { kind: 'url', url, format, isBinary };
  }
  if (source.name === 'file' && source.params.file) {
    return { kind: 'file', file: source.params.file, format: source.params.format };
  }
}

function targetRefs(params: ParticleListWithTargetsProps) {
  const refs: StateTransform.Ref[] = [];
  for (const { source } of params.targets ?? []) {
    if (source.name === 'ref' && source.params.ref) refs.push(source.params.ref as StateTransform.Ref);
  }
  return refs;
}

/** True if a referenced state object is not the one the targets were made from */
function refsChanged(
  params: ParticleListWithTargetsProps,
  cache: ParticleListWithTargetsCache,
  dependencies?: Record<string, StateObject>,
) {
  for (const ref of targetRefs(params)) {
    if (cache.refData?.get(ref) !== dependencies?.[ref]?.data) return true;
  }
  return false;
}

/**
 * The target mapping of `a` with the reference objects of `params`. Sources loaded before (in `cache.loaded`) are
 * reused, unless their referenced state object changed; the assets of the sources no longer used are disposed.
 */
async function loadTargets(
  plugin: PluginContext,
  ctx: RuntimeContext,
  a: SO.Particle.List,
  params: ParticleListWithTargetsProps,
  cache: ParticleListWithTargetsCache,
  dependencies: Record<string, StateObject> | undefined,
) {
  const previous = cache.loaded ?? new Map<string, LoadedTarget>();
  const loaded = new Map<string, LoadedTarget>();
  const refData = new Map<string, unknown>();
  const changedRefs = new Set<string>();
  for (const ref of targetRefs(params)) {
    const data = dependencies?.[ref]?.data;
    refData.set(ref, data);
    if (cache.refData?.get(ref) !== data) changedRefs.add(`ref:${ref}`);
  }

  const load = async (key: string, run: (assets: Asset.Wrapper[]) => Promise<ParticleTarget>) => {
    const kept = loaded.get(key) ?? (changedRefs.has(key) ? undefined : previous.get(key));
    if (kept) {
      loaded.set(key, kept);
      return kept.target;
    }
    const assets: Asset.Wrapper[] = [];
    const target = await run(assets);
    loaded.set(key, { target, assets });
    return target;
  };

  const targetMapping = new Map<number, ParticleTarget>();
  if (params.includeParent && a.data.targetMapping) {
    for (const [targetId, target] of a.data.targetMapping) targetMapping.set(targetId, target);
  }
  const explicitTargetIds = new Set(params.targets.map((t) => t.targetId));

  const fileMatches = matchParticleTargetFiles(a.data, params.files ?? [], explicitTargetIds);
  for (const warning of fileMatches.warnings) plugin.log.warn(warning);
  for (const { file, targetIds } of fileMatches.matches) {
    try {
      const target = await load(`file:${file.id}:auto`, (assets) =>
        loadParticleTarget(plugin, ctx, { kind: 'file', file }, assets),
      );
      for (const targetId of targetIds) targetMapping.set(targetId, target);
    } catch (e) {
      console.error(e);
      plugin.log.warn(`Could not load particle target file '${file.name}'.`);
    }
  }

  for (const { targetId, source } of params.targets) {
    const key = sourceKey(source);
    if (!key) continue;
    try {
      const target = await load(key, async (assets) => {
        if (source.name === 'ref') {
          const obj = dependencies?.[source.params.ref];
          if (!obj) throw new Error(`The object '${source.params.ref}' is not in the state.`);
          return particleTargetFromObject(ctx, obj);
        }
        return loadParticleTarget(plugin, ctx, targetSource(source)!, assets);
      });
      targetMapping.set(targetId, target);
    } catch (e) {
      console.error(e);
      plugin.log.warn(`Could not load the reference object for particle target ${targetId}.`);
    }
  }

  for (const [key, entry] of previous) {
    if (loaded.get(key) !== entry) for (const asset of entry.assets) asset.dispose();
  }
  cache.loaded = loaded;
  cache.refData = refData;
  cache.sourceTargetMapping = a.data.targetMapping;
  cache.sourceEntityInfo = a.data.entityInfo;
  return targetMapping;
}

export { ParticleListWithTargets };
type ParticleListWithTargets = typeof ParticleListWithTargets;
const ParticleListWithTargets = PluginStateTransform.BuiltIn({
  name: 'particle-list-with-targets',
  display: {
    name: 'Particle List with Targets',
    description:
      'Attach reference structures, shapes, or volumes that are instanced at each particle of the matching target ID.',
  },
  isDecorator: true,
  from: SO.Particle.List,
  to: SO.Particle.List,
  params: ParticleListWithTargetsParams,
})({
  apply({ a, params, cache, dependencies }, plugin: PluginContext) {
    return Task.create('Particle List with Targets', async (ctx) => {
      const transformCache = cache as ParticleListWithTargetsCache;
      const targetMapping = await loadTargets(plugin, ctx, a, params, transformCache, dependencies);
      return new SO.Particle.List(Particle.withTargets(a.data, targetMapping), {
        label: a.label,
        description: a.description,
      });
    });
  },
  update({ a, b, oldParams, newParams, cache, dependencies }, plugin: PluginContext) {
    const transformCache = cache as ParticleListWithTargetsCache;
    if (
      a.data.targetMapping !== transformCache.sourceTargetMapping ||
      a.data.entityInfo !== transformCache.sourceEntityInfo ||
      !b.data.targetMapping
    ) {
      return StateTransformer.UpdateResult.Recreate;
    }
    if (
      !PD.areEqual(ParticleListWithTargetsParams(a, plugin), oldParams, newParams) ||
      refsChanged(newParams, transformCache, dependencies)
    ) {
      // only the sources that changed are loaded, see `loadTargets`
      return Task.create('Particle List with Targets', async (ctx) => {
        const targetMapping = await loadTargets(plugin, ctx, a, newParams, transformCache, dependencies);
        b.data = Particle.withTargets(a.data, targetMapping);
        b.label = a.label;
        b.description = a.description;
        return StateTransformer.UpdateResult.Updated;
      });
    }

    b.data = Particle.withTargets(a.data, b.data.targetMapping);
    b.label = a.label;
    b.description = a.description;
    return StateTransformer.UpdateResult.Updated;
  },
  getDependencies: (params) => targetRefs(params as ParticleListWithTargetsProps),
  dispose({ cache }) {
    for (const entry of (cache as ParticleListWithTargetsCache).loaded?.values() ?? []) {
      for (const asset of entry.assets) asset.dispose();
    }
  },
});
