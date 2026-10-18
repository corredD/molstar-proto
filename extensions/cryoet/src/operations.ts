/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { type StateObjectCell, StateTransform } from '@molstar/core/state';
import { Color } from '@molstar/core/util/color';
import { ColorNames } from '@molstar/core/util/color/names';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import type { ParticleList, ParticleTarget } from '@molstar/model/model/particles/particle-list';
import { Volume } from '@molstar/model/model/volume';
import {
  particleTargetObjectCells,
  particleTargetSourceFromPdbIdOrUrl,
} from '@molstar/plugin/state/helpers/particle-targets';
import { createVolumeRepresentationParams } from '@molstar/plugin/state/helpers/volume-representation-params';
import type { ParticleListRef } from '@molstar/plugin/state/manager/particles/hierarchy-state';
import type { VolumeRef } from '@molstar/plugin/state/manager/volume/hierarchy-state';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import {
  ParticleListTargetsFromAttribute,
  ParticleListWithTargets,
} from '@molstar/plugin/state/transforms/particles/ops';
import { ParticlesRepresentation3D } from '@molstar/plugin/state/transforms/particles/representation';
import { VolumeRepresentation3D } from '@molstar/plugin/state/transforms/volume/representation';
import { type ApiContext, ApiArea, type ApiFailure, ApiResult } from '@molstar/prism-viewer/api/area';
import { OptionalParam } from '@molstar/prism-viewer/api/params';
import { isFailure, labelOf as structureLabel, loadedStructures, pickOne } from '@molstar/prism-viewer/api/scope';
import { watchedState } from '@molstar/prism-viewer/sources/watched';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';

// The `cryoet` area (apps/prism-me/_spec/features.md, "CryoET"): what decorates a particle list and how the particles
// map to targets (`decorations`, `decorate`, `classes`), and the slices of a tomogram or a tilt series (`slice`).
// A decoration is the plugin's `ParticleListWithTargets` under the list: each target id instanced with an object, an
// object of the scene (a structure, a shape, a volume: swapping it is instant) or one fetched (a PDB id, a URL);
// `classes` is `ParticleListTargetsFromAttribute` above it, a target per value of an attribute (the class).

/** What decorates one target of a list */
export interface TargetDecoration {
  readonly id: number;
  readonly name: string;
  readonly count: number;
  /** What it is decorated with: the object's label, the PDB id or URL, or undefined (spheres only) */
  readonly with?: string;
  /** The state ref of the object of the scene it is decorated with */
  readonly object?: string;
}

export interface DecorationsInfo {
  readonly particles: string;
  readonly label: string;
  readonly count: number;
  /** The attribute the targets are made from (`classes`), if any */
  readonly classes?: string;
  /** The attributes of the list (class, cc, score, …) */
  readonly attributes: readonly { readonly key: string; readonly label: string }[];
  readonly targets: readonly TargetDecoration[];
  /** The objects of the scene a target can be decorated with */
  readonly objects: readonly { readonly ref: string; readonly label: string }[];
}

/** A volume's dimensions and the slice shown, if any */
export interface SliceInfo {
  readonly dimensions: readonly [number, number, number];
  readonly shown?: { readonly axis: 'x' | 'y' | 'z'; readonly index: number; readonly contrast?: number };
}

/** A segmentation mesh loaded from a file (OBJ, PLY, VTP…), as the Segmentations tab shows it */
export interface MeshInfo {
  /** The state ref of its representation */
  readonly ref: string;
  /** The file it came from */
  readonly label: string;
  readonly visible: boolean;
  readonly visuals: readonly ('mesh' | 'wireframe')[];
  /** Opacity, 0 to 1 */
  readonly opacity: number;
  /** Its uniform color, when it has one */
  readonly color?: number;
}

const ListParam = () =>
  PD.Text('', { description: 'A particle list by label or state ref; empty: the only one loaded' });

export class CryoetApi extends ApiArea {
  readonly id = 'cryoet';

  /** What the decorate row shows of a list, following the state tree while watched: a read for views */
  decorationsState(particles: string): ReadonlyState<DecorationsInfo | undefined> {
    const plugin = this.ctx.plugin;
    return watchedState(
      () => {
        const l = oneList({ plugin }, particles || undefined);
        return isFailure(l) ? undefined : describe({ plugin }, l);
      },
      () => plugin.state.data.events.changed,
      { compare: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
    );
  }

  /** The slice of a volume (by state ref) as shown, following the state tree while watched: a read for views */
  sliceState(volume: string): ReadonlyState<SliceInfo | undefined> {
    const plugin = this.ctx.plugin;
    return watchedState(
      () => {
        const v = oneVolume({ plugin }, volume || undefined);
        return isFailure(v) ? undefined : sliceOf(v);
      },
      () => plugin.state.data.events.changed,
      { compare: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
    );
  }

  /** The segmentation meshes, following the state tree while watched: a read for views */
  meshesState(): ReadonlyState<readonly MeshInfo[]> {
    const plugin = this.ctx.plugin;
    return watchedState(
      () => meshes({ plugin }),
      () => plugin.state.data.events.changed,
      { compare: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
    );
  }

  readonly meshes = this.operation({
    id: 'cryoet.meshes',
    title: 'Describe the segmentation meshes',
    params: {},
    read: true,
    async run(_, ctx) {
      const list = meshes(ctx);
      if (!list.length) return ApiResult.ok('No meshes are loaded.', {}, { value: list });
      const lines = list.map(
        (m) => `${m.label} (${m.ref}): ${m.visible ? m.visuals.join(' + ') : 'hidden'}, opacity ${m.opacity}`,
      );
      return ApiResult.ok(lines.join('\n'), {}, { value: list });
    },
  });

  readonly mesh = this.operation({
    id: 'cryoet.mesh',
    title: 'Show a segmentation mesh as…',
    params: {
      mesh: PD.Text('', { description: 'A mesh by file name or state ref; empty: every mesh' }),
      visible: OptionalParam(PD.Boolean(true)),
      visuals: OptionalParam(
        PD.Select<'mesh' | 'wireframe' | 'both'>('mesh', [
          ['mesh', 'Surface'],
          ['wireframe', 'Wireframe'],
          ['both', 'Both'],
        ]),
      ),
      opacity: OptionalParam(PD.Numeric(1, { min: 0, max: 1, step: 0.01 })),
      color: OptionalParam(PD.Text('', { description: 'A CSS color (#ffcc00, tomato); one color for the whole mesh' })),
    },
    async run(values, ctx) {
      const { mesh, visible, visuals, opacity, color } = values as typeof values & {
        visible?: boolean;
        visuals?: 'mesh' | 'wireframe' | 'both';
        opacity?: number;
        color?: string;
      };
      const all = meshes(ctx);
      const n = mesh.trim().toLowerCase();
      const picked = n ? all.filter((m) => m.ref === mesh.trim() || m.label.toLowerCase() === n) : all;
      if (!picked.length) {
        return ApiResult.fail(
          'not-found',
          all.length ? `There is no mesh '${mesh}'.` : 'No meshes are loaded.',
          all.length ? `Meshes: ${all.map((m) => m.label).join(', ')}.` : 'Open an OBJ, PLY or VTP file.',
        );
      }
      const parsed = color ? cssColor(color) : undefined;
      if (color && parsed === undefined)
        return ApiResult.fail('invalid', `'${color}' is not a color.`, 'Give #rrggbb or a name.');
      const b = ctx.plugin.state.data.build();
      const nodes: string[] = [];
      for (const m of picked) {
        const cell = ctx.plugin.state.data.cells.get(m.ref)!;
        const old = cell.transform.params as any;
        const next = {
          ...old,
          ...(visuals ? { visuals: visuals === 'both' ? ['mesh', 'wireframe'] : [visuals] } : {}),
          ...(opacity !== undefined ? { alpha: opacity } : {}),
          ...(parsed !== undefined && old.coloring ? { coloring: { name: 'uniform', params: { color: parsed } } } : {}),
        };
        if (JSON.stringify(next) !== JSON.stringify(old)) {
          b.to(cell).update(next);
          nodes.push(m.ref);
        }
        if (visible !== undefined && visible === !!cell.state.isHidden) {
          ctx.plugin.state.data.updateCellState(m.ref, { isHidden: !visible });
          nodes.push(m.ref);
        }
      }
      if (!nodes.length) return ApiResult.already('The meshes already look so.');
      await b.commit();
      return ApiResult.ok(`Updated ${picked.length === 1 ? picked[0].label : `${picked.length} meshes`}.`, { nodes });
    },
  });

  readonly decorations = this.operation({
    id: 'cryoet.decorations',
    title: 'Describe what decorates the particles',
    params: { particles: ListParam() },
    read: true,
    async run({ particles }, ctx) {
      const l = oneList(ctx, particles || undefined);
      if (isFailure(l)) return l;
      const info = describe(ctx, l);
      const lines = info.targets.map(
        (t) => `${t.name} (${t.id}): ${t.count.toLocaleString('en')} particles, ${t.with ?? 'not decorated'}`,
      );
      return ApiResult.ok(
        `${info.label}: ${info.targets.length} targets${info.classes ? ` by ${info.classes}` : ''}\n${lines.join('\n')}`,
        {},
        { value: info },
      );
    },
  });

  readonly decorate = this.operation({
    id: 'cryoet.decorate',
    title: 'Decorate particles with…',
    params: {
      with: PD.Select('object', [
        ['object', 'An object of the scene (structure, shape, volume)'],
        ['pdb', 'A PDB id or a URL'],
        ['none', 'Nothing (spheres)'],
      ] as const),
      object: PD.Text('', { description: 'An object of the scene by label or state ref (with: object)' }),
      id: PD.Text('', { description: 'A PDB id (1crn) or the URL of a structure, shape or volume (with: pdb)' }),
      targets: PD.Text('', {
        description: 'Target ids or names, comma-separated (0, Class 2); empty: every target of the list',
      }),
      particles: ListParam(),
    },
    async run({ with: kind, object, id, targets, particles }, ctx) {
      const l = oneList(ctx, particles || undefined);
      if (isFailure(l)) return l;
      const data = dataOf(ctx, l);
      if (!data) return ApiResult.fail('not-found', 'The particle list is not loaded yet.');
      const ids = pickTargets(data, targets);
      if (isFailure(ids)) return ids;

      let source: TargetSourceValue | undefined;
      let what: string;
      if (kind === 'object') {
        const obj = pickObject(ctx, object);
        if (isFailure(obj)) return obj;
        source = { name: 'ref', params: { ref: obj.transform.ref } };
        what = obj.obj?.label ?? obj.transform.ref;
      } else if (kind === 'pdb') {
        if (!id.trim()) return ApiResult.fail('invalid', 'No PDB id or URL.', 'Give id: 1crn, or a URL.');
        const s = particleTargetSourceFromPdbIdOrUrl(ctx.plugin, id);
        if (s.kind !== 'url') return ApiResult.fail('invalid', `'${id}' is not a PDB id or URL.`);
        source = {
          name: 'url',
          params: { url: s.url as string, format: s.format ?? 'auto', isBinary: s.isBinary },
        };
        what = id.trim();
      } else {
        what = 'nothing';
      }

      const cell = decoratorCell(ctx, l, ParticleListWithTargets);
      const old = (cell?.transform.params?.targets ?? []) as TargetEntry[];
      const kept = old.filter((t) => !ids.includes(t.targetId));
      const next: TargetEntry[] = source ? [...kept, ...ids.map((targetId) => ({ targetId, source: source! }))] : kept;
      next.sort((a, b) => a.targetId - b.targetId);
      if (JSON.stringify(next) === JSON.stringify(old)) {
        return ApiResult.already(`Already decorated with ${what}.`);
      }
      const b = ctx.plugin.state.data.build();
      if (cell) {
        b.to(cell).update((p: any) => ({ ...p, targets: next }));
      } else if (next.length) {
        const parent = decoratorCell(ctx, l, ParticleListTargetsFromAttribute) ?? l.cell;
        b.to(parent).apply(ParticleListWithTargets, { files: [], targets: next, includeParent: true });
      }
      await b.commit();
      const shown = await ensureTargetRepresentation(ctx, l);
      return ApiResult.ok(
        `Decorated ${ids.length === data.targetInfo.size ? 'every target' : `${ids.length} target${ids.length > 1 ? 's' : ''}`} of ${labelOf(l)} with ${what}.`,
        { nodes: [l.cell.transform.ref, ...shown] },
      );
    },
  });

  readonly classes = this.operation({
    id: 'cryoet.classes',
    title: 'Targets by class',
    params: {
      attribute: PD.Text('class', {
        description:
          'An attribute whose values become the targets (class, cc, score…); empty: back to the targets of the file',
      }),
      particles: ListParam(),
    },
    async run({ attribute, particles }, ctx) {
      const l = oneList(ctx, particles || undefined);
      if (isFailure(l)) return l;
      const attributes = l.cell.obj?.data.attributes;
      const key = attribute.trim();
      if (key && !attributes?.has(key)) {
        return ApiResult.fail(
          'not-found',
          `The particle list has no attribute '${key}'.`,
          attributes?.size
            ? `Attributes: ${Array.from(attributes.keys()).join(', ')}.`
            : 'This list has no attributes.',
        );
      }
      const cell = decoratorCell(ctx, l, ParticleListTargetsFromAttribute);
      const current = cell?.transform.params?.attribute as string | undefined;
      if ((current ?? '') === key)
        return ApiResult.already(key ? `The targets are already by ${key}.` : 'The targets are the file’s.');
      const b = ctx.plugin.state.data.build();
      if (!key) b.delete(cell!.transform.ref);
      else if (cell) b.to(cell).update({ attribute: key });
      else b.to(l.cell).apply(ParticleListTargetsFromAttribute, { attribute: key });
      await b.commit();
      const n = dataOf(ctx, l)?.targetInfo.size ?? 0;
      return ApiResult.ok(
        key ? `${labelOf(l)} has ${n} targets by ${key}.` : `${labelOf(l)} has the targets of its file again.`,
        {
          nodes: [l.cell.transform.ref],
        },
      );
    },
  });

  readonly slice = this.operation({
    id: 'cryoet.slice',
    title: 'Slice a tomogram',
    params: {
      axis: PD.Select('z', [
        ['x', 'x'],
        ['y', 'y'],
        ['z', 'z (a tilt series: its images)'],
      ] as const),
      index: OptionalParam(
        PD.Numeric(0, { min: 0, step: 1 }, { description: 'The slice, from 0; absent: the middle' }),
      ),
      contrast: OptionalParam(
        PD.Numeric(
          3,
          { min: 0.1, max: 20, step: 0.1 },
          { description: 'The gray window, ± this many σ about the mean' },
        ),
      ),
      volume: PD.Text('', { description: 'A volume by label or state ref; empty: the only one loaded' }),
    },
    async run(values, ctx) {
      const { axis, volume } = values;
      const { index, contrast } = values as typeof values & { index?: number; contrast?: number };
      const v = oneVolume(ctx, volume || undefined);
      if (isFailure(v)) return v;
      const data = v.cell.obj?.data;
      if (!data) return ApiResult.fail('not-found', 'The volume is not loaded yet.');
      const dims = data.grid.cells.space.dimensions;
      const n = dims[axis === 'x' ? 0 : axis === 'y' ? 1 : 2];
      const existing = v.representations.find(
        (r) => (r.cell.transform.params as { type?: { name?: string } })?.type?.name === 'slice',
      );
      const old = existing?.cell.transform.params as any;
      const oldIndex = old?.type?.params?.dimension?.name === axis ? old.type.params.dimension.params : undefined;
      const i = Math.max(0, Math.min(n - 1, Math.round(index ?? oldIndex ?? (n - 1) / 2)));
      const { mean, sigma } = data.grid.stats;
      const k = contrast ?? (old?.colorTheme?.params?.domain?.name === 'custom' ? undefined : 3);
      const domain: [number, number] =
        k !== undefined ? [mean - k * sigma, mean + k * sigma] : old.colorTheme.params.domain.params;
      const params = createVolumeRepresentationParams(ctx.plugin, data, {
        type: 'slice',
        typeParams: { dimension: { name: axis, params: i }, isoValue: Volume.IsoValue.relative(-1000) } as any,
        color: 'volume-value',
        colorParams: {
          domain: { name: 'custom', params: domain },
          colorList: {
            kind: 'interpolate',
            colors: [
              [0x000000, 0],
              [0xffffff, 1],
            ],
          },
        } as any,
      });
      if (existing && JSON.stringify(old) === JSON.stringify(params)) {
        return ApiResult.already(`Already at ${axis} ${i} of ${n}.`);
      }
      const b = ctx.plugin.state.data.build();
      if (existing) b.to(existing.cell).update(params);
      else b.to(v.cell).apply(VolumeRepresentation3D, params);
      await b.commit();
      return ApiResult.ok(`Showing slice ${i + 1} of ${n} along ${axis} of ${v.cell.obj?.label ?? 'the volume'}.`, {
        nodes: [v.cell.transform.ref],
      });
    },
  });
}

function sliceOf(v: VolumeRef): SliceInfo | undefined {
  const data = v.cell.obj?.data;
  if (!data) return;
  const [x, y, z] = data.grid.cells.space.dimensions;
  const r = v.representations.find(
    (r) => (r.cell.transform.params as { type?: { name?: string } })?.type?.name === 'slice',
  );
  const p = r?.cell.transform.params as any;
  const dim = p?.type?.params?.dimension;
  const domain = p?.colorTheme?.params?.domain;
  const { mean, sigma } = data.grid.stats;
  return {
    dimensions: [x, y, z],
    ...(dim && ['x', 'y', 'z'].includes(dim.name)
      ? {
          shown: {
            axis: dim.name,
            index: dim.params,
            ...(domain?.name === 'custom' && sigma > 0
              ? { contrast: Math.round(((domain.params[1] - mean) / sigma) * 10) / 10 }
              : {}),
          },
        }
      : {}),
  };
}

// --- the particle lists and their decorations -----------------------------------------------------------------------

type TargetSourceValue =
  | { name: 'ref'; params: { ref: string } }
  | { name: 'url'; params: { url: string; format: string; isBinary?: boolean } };
type TargetEntry = { targetId: number; source: TargetSourceValue };

function lists(ctx: Pick<ApiContext, 'plugin'>): readonly ParticleListRef[] {
  return ctx.plugin.managers.particles.hierarchy.current.lists;
}

function oneList(ctx: Pick<ApiContext, 'plugin'>, name: string | undefined): ParticleListRef | ApiFailure {
  return pickOne(
    lists(ctx),
    name,
    'particle list',
    'Open a particle file (RELION STAR, Dynamo TBL, NDJSON, EM) first.',
  );
}

function oneVolume(ctx: Pick<ApiContext, 'plugin'>, name: string | undefined): VolumeRef | ApiFailure {
  return pickOne(
    ctx.plugin.managers.volume.hierarchy.current.volumes,
    name,
    'volume',
    'Open a tomogram or a tilt series (MRC: .mrc, .rec, .st, .ali) first.',
  );
}

const labelOf = (l: ParticleListRef) => l.cell.obj?.label ?? l.cell.transform.ref;

/** The decorator of `transformer` in the chain of decorators under the list, if any */
function decoratorCell(
  ctx: Pick<ApiContext, 'plugin'>,
  l: ParticleListRef,
  transformer: typeof ParticleListWithTargets | typeof ParticleListTargetsFromAttribute,
): StateObjectCell | undefined {
  const { tree, cells } = ctx.plugin.state.data;
  let ref: StateTransform.Ref = l.cell.transform.ref;
  for (;;) {
    const decorator = tree.children
      .get(ref)
      .toArray()
      .map((c) => tree.transforms.get(c))
      .find((t) => t?.transformer.definition.isDecorator);
    if (!decorator) return;
    if (decorator.transformer === transformer) return cells.get(decorator.ref);
    ref = decorator.ref;
  }
}

/** The list as the representations get it: with its decorations */
function dataOf(ctx: Pick<ApiContext, 'plugin'>, l: ParticleListRef): ParticleList | undefined {
  const deepest =
    decoratorCell(ctx, l, ParticleListWithTargets) ?? decoratorCell(ctx, l, ParticleListTargetsFromAttribute);
  return (deepest?.obj?.data as ParticleList | undefined) ?? l.cell.obj?.data;
}

function describe(ctx: Pick<ApiContext, 'plugin'>, l: ParticleListRef): DecorationsInfo {
  const data = dataOf(ctx, l)!;
  const counts = new Map<number, number>();
  for (let i = 0; i < data.count; ++i) counts.set(data.targets[i], (counts.get(data.targets[i]) ?? 0) + 1);
  const entries = new Map(
    ((decoratorCell(ctx, l, ParticleListWithTargets)?.transform.params?.targets ?? []) as TargetEntry[]).map(
      (t) => [t.targetId, t] as const,
    ),
  );
  const objects = sceneObjects(ctx);
  const labelOfRef = new Map(objects.map((o) => [o.ref, o.label]));
  const attributes = l.cell.obj?.data.attributes;
  const classes = decoratorCell(ctx, l, ParticleListTargetsFromAttribute)?.transform.params?.attribute as
    | string
    | undefined;
  return {
    particles: l.cell.transform.ref,
    label: labelOf(l),
    count: data.count,
    ...(classes ? { classes } : {}),
    attributes: attributes ? Array.from(attributes, ([key, a]) => ({ key, label: a.label })) : [],
    targets: Array.from(data.targetInfo, ([id, info]) => {
      const entry = entries.get(id);
      const target = data.targetMapping?.get(id);
      const w = entry
        ? entry.source.name === 'ref'
          ? (labelOfRef.get(entry.source.params.ref) ?? entry.source.params.ref)
          : entry.source.params.url
        : target
          ? describeTarget(target)
          : undefined;
      return {
        id,
        name: info.name ?? data.entityInfo?.get(info.entity ?? -1)?.name ?? `Target ${id}`,
        count: counts.get(id) ?? 0,
        ...(w ? { with: w } : {}),
        ...(entry?.source.name === 'ref' ? { object: entry.source.params.ref } : {}),
      };
    }),
    objects,
  };
}

/** The shape representations of meshes loaded from files (not the guides and shapes the viewer makes itself) */
function meshes(ctx: Pick<ApiContext, 'plugin'>): MeshInfo[] {
  const { cells, tree } = ctx.plugin.state.data;
  const out: MeshInfo[] = [];
  for (const cell of cells.values()) {
    if (cell.state.isGhost || !SO.Shape.Representation3D.is(cell.obj)) continue;
    let root = cell.transform.ref;
    for (;;) {
      const parent = tree.transforms.get(root)?.parent;
      if (!parent || parent === StateTransform.RootRef) break;
      root = parent;
    }
    const data = cells.get(root)?.obj;
    if (!SO.Data.String.is(data) && !SO.Data.Binary.is(data)) continue;
    const p = cell.transform.params as any;
    out.push({
      ref: cell.transform.ref,
      label: data.label,
      visible: !cell.state.isHidden,
      visuals: Array.isArray(p?.visuals) ? p.visuals : ['mesh'],
      opacity: p?.alpha ?? 1,
      ...(p?.coloring?.name === 'uniform' ? { color: p.coloring.params.color } : {}),
    });
  }
  return out;
}

/** A CSS color name or #rrggbb */
function cssColor(text: string): Color | undefined {
  const c = text.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(c)) return Color.fromHexStyle(c);
  return (ColorNames as Record<string, Color>)[c.replace(/[\s-]/g, '')];
}

function describeTarget(t: ParticleTarget): string {
  return t.kind === 'structure' ? 'its structure' : t.kind === 'volume' ? 'its volume' : 'its shape';
}

/**
 * The structures, shapes and volumes of the scene a target can be decorated with: the loaded structures (not their
 * components), named as the viewer names them (the entry: 1CRN), and every volume and shape
 */
function sceneObjects(ctx: Pick<ApiContext, 'plugin'>) {
  const out: { ref: string; label: string }[] = [];
  for (const s of loadedStructures(ctx)) out.push({ ref: s.cell.transform.ref, label: structureLabel(ctx, s) });
  for (const c of particleTargetObjectCells(ctx.plugin.state.data)) {
    if (SO.Molecule.Structure.is(c.obj)) continue;
    out.push({ ref: c.transform.ref, label: entryLabel(ctx, c) });
  }
  return out;
}

/** A volume's or shape's name: the file (or address) it came from, its entry's label; else its own */
function entryLabel(ctx: Pick<ApiContext, 'plugin'>, cell: StateObjectCell): string {
  const { tree, cells } = ctx.plugin.state.data;
  let ref = cell.transform.ref;
  for (;;) {
    const parent = tree.transforms.get(ref)?.parent;
    if (!parent || parent === StateTransform.RootRef) break;
    ref = parent;
  }
  return cells.get(ref)?.obj?.label || cell.obj!.label;
}

function pickObject(ctx: ApiContext, name: string): StateObjectCell | ApiFailure {
  const objects = sceneObjects(ctx);
  if (!objects.length) {
    return ApiResult.fail(
      'not-found',
      'There is no structure, shape or volume in the scene.',
      'Open one, or use with: pdb.',
    );
  }
  const n = name.trim();
  const lower = n.toLowerCase();
  const found = n
    ? objects.filter((o) => o.ref === n || o.label.toLowerCase() === lower)
    : objects.length === 1
      ? objects
      : [];
  if (found.length === 1) return ctx.plugin.state.data.cells.get(found[0].ref)!;
  return ApiResult.fail(
    found.length ? 'ambiguous' : n ? 'not-found' : 'ambiguous',
    n ? `${found.length ? 'Several objects are' : 'No object is'} named '${n}'.` : 'Which object?',
    `Objects: ${objects.map((o) => `${o.label} (${o.ref})`).join(', ')}.`,
  );
}

function pickTargets(data: ParticleList, names: string): number[] | ApiFailure {
  const wanted = names
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s);
  if (!wanted.length) return Array.from(data.targetInfo.keys());
  const out: number[] = [];
  for (const w of wanted) {
    const id = Array.from(data.targetInfo).find(([id, info]) => String(id) === w || info.name === w)?.[0];
    if (id === undefined) {
      return ApiResult.fail(
        'not-found',
        `There is no target '${w}'.`,
        `Targets: ${Array.from(data.targetInfo, ([id, info]) => (info.name ? `${info.name} (${id})` : id)).join(', ')}.`,
      );
    }
    out.push(id);
  }
  return out;
}

/**
 * The list shows its decorations: a `target` representation, added under its decorations when it has none (built from
 * the decorated list: `particles.representation` checks the types against the list as loaded); the refs added.
 */
async function ensureTargetRepresentation(ctx: ApiContext, l: ParticleListRef): Promise<string[]> {
  const fresh = lists(ctx).find((x) => x.cell.transform.ref === l.cell.transform.ref) ?? l;
  const has = fresh.representations.some(
    (r) => (r.cell.transform.params as { type?: { name?: string } })?.type?.name === 'target',
  );
  const data = dataOf(ctx, fresh);
  const { registry, themes } = ctx.plugin.representation.particles;
  if (has || !data?.targetMapping?.size || !registry.has('target')) return [];
  const provider = registry.get('target');
  const dataCtx = { particles: data };
  const color = themes.colorThemeRegistry.get(provider.defaultColorTheme.name);
  const size = themes.sizeThemeRegistry.get(provider.defaultSizeTheme.name);
  const b = ctx.plugin.state.data.build();
  const repr = b.to(fresh.cell).apply(ParticlesRepresentation3D, {
    type: { name: 'target', params: PD.getDefaultValues(provider.getParams(themes, data)) },
    colorTheme: {
      name: color.name,
      params: { ...PD.getDefaultValues(color.getParams(dataCtx)), ...provider.defaultColorTheme.props },
    },
    sizeTheme: {
      name: size.name,
      params: { ...PD.getDefaultValues(size.getParams(dataCtx)), ...provider.defaultSizeTheme.props },
    },
  } as never);
  await b.commit();
  // the spheres stood for the particles until now: the objects take their place
  const shown = fresh.representations.filter((r) => !r.cell.state.isHidden);
  ctx.plugin.managers.particles.hierarchy.toggleVisibility(shown, 'hide');
  return [repr.ref, ...shown.map((r) => r.cell.transform.ref)];
}
