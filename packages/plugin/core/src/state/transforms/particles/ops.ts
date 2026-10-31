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
  particleTargetObjectOptions,
  particleTargetFileExtensions,
  type ParticleTargetSource,
  matchParticleTargetFiles,
  loadParticleTarget,
  particleTargetFromObject,
} from '@molstar/plugin/state/helpers/particle-targets';
import { Asset } from '@molstar/core/util/assets';
import { Mat3, Mat4, Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { type ParticleList, type ParticleTarget, Particle } from '@molstar/model/model/particles/particle-list';
import { type StateObject, type StateTransform, StateTransformer } from '@molstar/core/state';

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

export { ParticleListTargetsFromAttribute };
type ParticleListTargetsFromAttribute = typeof ParticleListTargetsFromAttribute;
const ParticleListTargetsFromAttribute = PluginStateTransform.BuiltIn({
  name: 'particle-list-targets-from-attribute',
  display: {
    name: 'Particle Targets from Attribute',
    description:
      'Give each distinct value of an attribute (e.g. the class) its own target ID, so each can be decorated with its own object.',
  },
  isDecorator: true,
  from: SO.Particle.List,
  to: SO.Particle.List,
  params: (a) => {
    const keys = a?.data.attributes ? Array.from(a.data.attributes.keys()) : [];
    const options = keys.map((k) => [k, a!.data.attributes!.get(k)!.label] as [string, string]);
    return {
      attribute: PD.Select(keys.includes('class') ? 'class' : (keys[0] ?? ''), [['', 'File'], ...options], {
        description: "The attribute whose values become the target IDs; none: the file's targets.",
      }),
    };
  },
})({
  isApplicable: (a) => !!a.data.attributes?.size,
  apply({ a, params }) {
    // none: the file's targets, the list as it is (the decorator stays: what is under it is kept)
    if (!params.attribute) return new SO.Particle.List(a.data, { label: a.label, description: a.description });
    const data = Particle.withTargetsFromAttribute(a.data, params.attribute);
    return new SO.Particle.List(data, {
      label: a.label,
      description: `${a.description ? `${a.description} · ` : ''}${data.targetInfo.size} targets by ${a.data.attributes!.get(params.attribute)!.label.toLowerCase()}`,
    });
  },
});

function ParticleListWithTargetsParams(a: SO.Particle.List | undefined, plugin: PluginContext) {
  const targetIds = a ? Array.from(a.data.targetInfo.keys()).sort((x, y) => x - y) : [];
  const targetIdDescription =
    targetIds.length > 0
      ? `Target ID in the particle list this object maps to. Available IDs: ${targetIds.slice(0, 32).join(', ')}${targetIds.length > 32 ? ', …' : ''}.`
      : 'Target ID in the particle list this object maps to (matches ParticleList.targets).';
  const formatOptions = particleTargetFormatOptions(plugin);
  const objectOptions = particleTargetObjectOptions(plugin.state.data);
  const listOptions = particleListOptions(plugin.state.data);

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
                    ? PD.Select(objectOptions[0][0], objectOptions, {
                        label: 'Object',
                        description: 'A structure, shape or volume already loaded.',
                      })
                    : PD.Text('', {
                        label: 'Object',
                        description: 'Load a structure, shape or volume to pick it here.',
                      }),
              },
              { isFlat: true },
            ),
            target: PD.Group(
              {
                list:
                  listOptions.length > 0
                    ? PD.Select(listOptions[0][0], listOptions, {
                        label: 'Particle list',
                        description: 'A particle list whose target is used (a cellPACK or PetWorld entity).',
                      })
                    : PD.Text('', { label: 'Particle list', description: 'Load a particle list to pick it here.' }),
                target: PD.Numeric(0, { min: 0, step: 1 }, { description: 'The target ID in that list.' }),
              },
              { isFlat: true },
            ),
          },
          {
            options: [
              ['file', 'File'],
              ['url', 'URL'],
              ['ref', 'Object in the scene'],
              ['target', 'Target of a particle list'],
            ] as ['url' | 'file' | 'ref' | 'target', string][],
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
    case 'target':
      return source.params.list ? `target:${source.params.list}:${source.params.target}` : undefined;
  }
}

/** The state ref a source key reads (`ref:<ref>`, `target:<list>:<id>`), if any */
function refOfKey(key: string) {
  if (key.startsWith('ref:')) return key.slice(4);
  if (key.startsWith('target:')) return key.slice(7, key.lastIndexOf(':'));
  return '';
}

/**
 * Options for picking a particle list among the cells of `state`, its own cell first, then the decorators on it (named
 * after them): every cell a list ref can name is offered, so a select of them never replaces one given by a script.
 */
function particleListOptions(state: PluginContext['state']['data']): [string, string][] {
  const own: [string, string][] = [];
  const decorated: [string, string][] = [];
  for (const cell of state.cells.values()) {
    if (cell.state.isGhost || !(cell.obj instanceof SO.Particle.List)) continue;
    const def = cell.transform.transformer.definition;
    if (def.isDecorator) decorated.push([cell.transform.ref, `${cell.obj.label} (${def.display.name})`]);
    else own.push([cell.transform.ref, cell.obj.label]);
  }
  return [...own, ...decorated];
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
    if (source.name === 'target' && source.params.list) refs.push(source.params.list as StateTransform.Ref);
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
    if (cache.refData?.get(ref) !== data) changedRefs.add(ref);
  }

  const load = async (key: string, run: (assets: Asset.Wrapper[]) => Promise<ParticleTarget>) => {
    const kept = loaded.get(key) ?? (changedRefs.has(refOfKey(key)) ? undefined : previous.get(key));
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
        if (source.name === 'target') {
          const obj = dependencies?.[source.params.list];
          if (!(obj instanceof SO.Particle.List)) throw new Error(`'${source.params.list}' is not a particle list.`);
          const target = obj.data.targetMapping?.get(source.params.target);
          if (!target) throw new Error(`'${obj.label}' has no reference object for target ${source.params.target}.`);
          return target;
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

/** The list a decorator last took: what is above it may change it (a decorator inserted there), its source not */
type InputCache = { input?: ParticleList };

/**
 * Whether `input` is another list than the one the decorator last took, recording it. Not its `sourceData`: a
 * decoration inserted above keeps the source and adds the targets (the model's `ModelWithCoordinates` does the same)
 */
function inputChanged(cache: unknown, input: ParticleList) {
  const c = cache as InputCache;
  if (c.input === input) return false;
  c.input = input;
  return true;
}

export { ParticleListTransform };
type ParticleListTransform = typeof ParticleListTransform;
/**
 * Moves and turns a particle list as a rigid body: its positions by the matrix, its orientations by its rotation (the
 * rotation itself for a list without orientations). A decorator: what is under it takes the moved list.
 */
const ParticleListTransform = PluginStateTransform.BuiltIn({
  name: 'particle-list-transform',
  display: {
    name: 'Transform',
    description: 'Scale the positions, then move and turn the particles as one rigid body.',
  },
  isDecorator: true,
  from: SO.Particle.List,
  to: SO.Particle.List,
  params: {
    transform: PD.Mat4(Mat4.identity(), { description: 'A rigid transform: a rotation, then a translation (Å)' }),
    scale: PD.Numeric(
      1,
      { min: 1e-6, max: 1e6, step: 0.01 },
      {
        description:
          "The positions' scale about the origin, before the transform: Å per unit of the file (a tomogram's pixel size)",
      },
    ),
  },
})({
  apply({ a, params, cache }) {
    (cache as InputCache).input = a.data;
    return new SO.Particle.List(transformParticles(a.data, params.transform, params.scale ?? 1), {
      label: a.label,
      description: a.description,
    });
  },
  update({ a, b, newParams, oldParams, cache }) {
    const changed = inputChanged(cache, a.data);
    if (
      !changed &&
      Mat4.areEqual(newParams.transform, oldParams.transform, 1e-9) &&
      (newParams.scale ?? 1) === (oldParams.scale ?? 1)
    ) {
      return StateTransformer.UpdateResult.Unchanged;
    }
    b.data = transformParticles(a.data, newParams.transform, newParams.scale ?? 1);
    b.label = a.label;
    return StateTransformer.UpdateResult.Updated;
  },
});

export { ParticleListOffsets };
type ParticleListOffsets = typeof ParticleListOffsets;

const OffsetParams = {
  targets: PD.Value<number[]>([], { description: 'The targets offset; none: every particle' }),
  translation: PD.Vec3(Vec3(), {}, { description: "A shift in each particle's own frame (Å)" }),
  euler: PD.Vec3(Vec3(), {}, { description: "A turn in each particle's own frame: about X, then Y, then Z (°)" }),
};
export type ParticleOffsetProps = PD.Values<typeof OffsetParams>;

const InstanceOffsetParams = {
  index: PD.Numeric(0, { min: 0, step: 1 }, { description: 'The particle, by its index in the list' }),
  translation: PD.Vec3(Vec3(), {}, { description: "A shift in the particle's own frame (Å)" }),
  euler: PD.Vec3(Vec3(), {}, { description: "A turn in the particle's own frame: about X, then Y, then Z (°)" }),
};
export type ParticleInstanceOffsetProps = PD.Values<typeof InstanceOffsetParams>;

/**
 * Offsets of the particles of some targets in their own frames (what decorates them placed off the particle: an
 * object on a surface turned about its own axis): each shifted along its own axes and turned about them, after
 * everything else (the end of the list's decorators, its classes' targets known). Offsets apply in their order.
 */
const ParticleListOffsets = PluginStateTransform.BuiltIn({
  name: 'particle-list-offsets',
  display: { name: 'Offsets', description: 'Shift and turn the particles of some targets in their own frames.' },
  isDecorator: true,
  from: SO.Particle.List,
  to: SO.Particle.List,
  params: {
    offsets: PD.ObjectList<ParticleOffsetProps>(
      OffsetParams,
      (o) => `Offset of ${o.targets.length || 'every'} target(s)`,
      {
        defaultValue: [],
      },
    ),
    instances: PD.ObjectList<ParticleInstanceOffsetProps>(
      InstanceOffsetParams,
      (o) => `Offset of particle ${o.index}`,
      {
        defaultValue: [],
        description: "Offsets of one particle each (an instance edited alone), after its targets' offsets",
      },
    ),
  },
})({
  apply({ a, params, cache }) {
    (cache as InputCache).input = a.data;
    return new SO.Particle.List(offsetParticles(a.data, params.offsets, params.instances ?? []), {
      label: a.label,
      description: a.description,
    });
  },
  update({ a, b, newParams, oldParams, cache }) {
    const changed = inputChanged(cache, a.data);
    if (
      !changed &&
      JSON.stringify(newParams.offsets) === JSON.stringify(oldParams.offsets) &&
      JSON.stringify(newParams.instances ?? []) === JSON.stringify(oldParams.instances ?? [])
    ) {
      return StateTransformer.UpdateResult.Unchanged;
    }
    b.data = offsetParticles(a.data, newParams.offsets, newParams.instances ?? []);
    b.label = a.label;
    return StateTransformer.UpdateResult.Updated;
  },
});

/** A local turn as a quaternion: about X, then Y, then Z (degrees) */
function eulerQuat(euler: Vec3): Quat {
  const d = Math.PI / 180;
  const qx = Quat.setAxisAngle(Quat(), Vec3.create(1, 0, 0), euler[0] * d);
  const qy = Quat.setAxisAngle(Quat(), Vec3.create(0, 1, 0), euler[1] * d);
  const qz = Quat.setAxisAngle(Quat(), Vec3.create(0, 0, 1), euler[2] * d);
  return Quat.multiply(Quat(), qz, Quat.multiply(Quat(), qy, qx));
}

/**
 * The particles with `offsets` applied, each in its own frame, then `instances` (one particle's each); the list as it
 * is when none reaches a particle
 */
export function offsetParticles(
  list: ParticleList,
  offsets: ReadonlyArray<ParticleOffsetProps>,
  instances: ReadonlyArray<ParticleInstanceOffsetProps> = [],
): ParticleList {
  const moves = (o: { translation: Vec3; euler: Vec3 }) => !Vec3.isZero(o.translation) || !Vec3.isZero(o.euler);
  const active = offsets.filter(moves);
  const one = new Map<number, { o: ParticleInstanceOffsetProps; turn: Quat }>();
  for (const o of instances)
    if (moves(o) && o.index >= 0 && o.index < list.count) one.set(o.index, { o, turn: eulerQuat(o.euler) });
  const byTarget = active.map((o) => ({ o, targets: new Set(o.targets), turn: eulerQuat(o.euler) }));
  const reached = new Set<number>();
  for (const t of list.targetInfo.keys()) if (byTarget.some((b) => !b.targets.size || b.targets.has(t))) reached.add(t);
  if (!reached.size && !one.size) return list;
  const n = list.count;
  const coordinates = Float32Array.from(list.coordinates);
  const rotations = new Float32Array(n * 4);
  const p = Vec3();
  const q = Quat();
  const shift = Vec3();
  // along its own axes, then turned about them
  const apply = (o: { translation: Vec3 }, turn: Quat) => {
    Vec3.transformQuat(shift, o.translation, q);
    Vec3.add(p, p, shift);
    Quat.multiply(q, q, turn);
  };
  for (let i = 0; i < n; ++i) {
    if (list.rotations) Quat.fromArray(q, list.rotations, i * 4);
    else Quat.setIdentity(q);
    const target = list.targets[i];
    const alone = one.get(i);
    if (reached.has(target) || alone) {
      Vec3.fromArray(p, coordinates, i * 3);
      if (reached.has(target)) {
        for (const b of byTarget) if (!b.targets.size || b.targets.has(target)) apply(b.o, b.turn);
      }
      if (alone) apply(alone.o, alone.turn);
      Vec3.toArray(p, coordinates, i * 3);
    }
    Quat.toArray(q, rotations, i * 4);
  }
  return { ...list, coordinates, rotations, _propertyData: Object.create(null) };
}

/** The particles' positions scaled by `scale` about the origin, then moved and turned by `m` (orientations turned) */
function transformParticles(list: ParticleList, m: Mat4, scale = 1): ParticleList {
  if (Mat4.isIdentity(m) && scale === 1) return list;
  const n = list.count;
  const coordinates = new Float32Array(n * 3);
  const p = Vec3();
  for (let i = 0; i < n; ++i) {
    Vec3.fromArray(p, list.coordinates, i * 3);
    Vec3.scale(p, p, scale);
    Vec3.transformMat4(p, p, m);
    Vec3.toArray(p, coordinates, i * 3);
  }
  // the turn: the matrix's rotation, as a unit quaternion
  const turn = Quat.normalize(Quat(), Quat.fromMat3(Quat(), Mat3.fromMat4(Mat3(), m)));
  const rotations = new Float32Array(n * 4);
  const q = Quat();
  for (let i = 0; i < n; ++i) {
    if (list.rotations) Quat.fromArray(q, list.rotations, i * 4);
    else Quat.setIdentity(q);
    Quat.multiply(q, turn, q);
    Quat.toArray(q, rotations, i * 4);
  }
  // its simulation box, if any, no longer bounds it
  const { cell: _, ...rest } = list;
  return { ...rest, coordinates, rotations, _propertyData: Object.create(null) };
}
