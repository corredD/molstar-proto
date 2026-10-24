/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Color } from '@molstar/core/util/color';
import { ColorNames } from '@molstar/core/util/color/names';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { Spheres } from '@molstar/graphics/geo/geometry/spheres/spheres';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import type {
  ParticleListRef,
  ParticleRepresentationRef,
} from '@molstar/plugin/state/manager/particles/hierarchy-state';
import {
  type ParticleCutProps,
  type ParticleLayerProps,
  ParticleRepresentation3DLayers,
} from '@molstar/plugin/state/transforms/particles/layers';
import { type ApiContext, ApiArea, type ApiFailure, ApiResult } from '@molstar/prism-viewer/api/area';
import { OptionalParam } from '@molstar/prism-viewer/api/params';
import { isFailure, pickOne } from '@molstar/prism-viewer/api/scope';
import { watchedState } from '@molstar/prism-viewer/sources/watched';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import {
  findGroup,
  generateColors,
  groupEntities,
  type MesoEntity,
  type MesoGroup,
  type MesoGroupBy,
  mesoEntities,
  mesoGroups,
} from './model.js';

// The `mesoscale` area (_spec/features.md, "Mesoscale"): the Mesoscale Explorer's entity controls on a particle list
// (cellPACK and PetWorld load as particles): the entities and their groups (`entities`), each entity's visibility,
// color, transparency and emissive (`style`, `colors`), the graphics mode (`graphics`). The styles are layers on the
// list's representations (`ParticleRepresentation3DLayers`), one per styled entity: one representation for the whole
// list, its merged render objects kept.

/** Graphics modes: the level of detail of the particles and the canvas's resolution (the Mesoscale Explorer's). */
export const GraphicsModes = ['ultra', 'quality', 'balanced', 'performance'] as const;
export type GraphicsMode = (typeof GraphicsModes)[number];

/** The particles' graphics: their mode (none when their levels of detail are not one of the modes'), their motion */
export interface GraphicsInfo {
  readonly mode?: GraphicsMode;
  readonly wiggle: number;
  readonly tumble: number;
}

/** How an entity looks: what its layer sets */
export interface EntityStyle {
  readonly visible: boolean;
  readonly color?: Color;
  readonly transparency?: number;
  readonly emissive?: number;
}

export interface EntityInfo extends MesoEntity, EntityStyle {}

/** What `entities` says of a particle list */
export interface MesoscaleInfo {
  readonly particles: string;
  readonly label: string;
  readonly count: number;
  readonly entities: readonly EntityInfo[];
  /** By the grouping asked; none asked: by compartment when the list has compartments, else by function */
  readonly groups: MesoGroup;
  /** The grouping of `groups` */
  readonly groupBy: MesoGroupBy;
  /** Whether the list has compartments (else grouping by compartment lists every entity flat) */
  readonly hasCompartments: boolean;
}

const ListParam = () =>
  PD.Text('', { description: 'A particle list by label or state ref; empty: the only one loaded' });

const GroupByParam = () =>
  PD.Select('compartment', [
    ['compartment', 'Compartment'],
    ['function', 'Function'],
  ] as const);

const SelectionParams = {
  entities: PD.Text('', {
    description: 'Entities by name or id, comma-separated (HIV1_CA_mono_0_1_0, 3); with no group: empty is every one',
  }),
  group: PD.Text('', {
    description:
      'A group of entities: a compartment by its dotted path (root.HIVenvelop_mature.HIV_capsid), or a function',
  }),
};

/** The grouping `style`'s `group` is read in (colors' `groupBy` groups its generated colors only) */
const SelectionGroupByParam = () =>
  OptionalParam(
    PD.Select('compartment', GroupByParam().options, {
      description:
        'The grouping the group is read in; absent: by compartment when the list has compartments (a function also works), else by function',
    }),
  );

export class MesoscaleApi extends ApiArea {
  readonly id = 'mesoscale';

  /**
   * What the Entities view shows of a list (by state ref, the only one when empty), its groups by `groupBy` (the view's
   * switch; absent or undefined: the default grouping), following the state tree and the grouping while watched: a read
   * for views; undefined when there is no list.
   */
  infoState(
    particles = '',
    groupBy?: ReadonlyState<MesoGroupBy | undefined>,
  ): ReadonlyState<MesoscaleInfo | undefined> {
    const plugin = this.ctx.plugin;
    return watchedState(
      () => {
        const ctx = { plugin };
        const l = oneList(ctx, particles || undefined);
        return isFailure(l) ? undefined : describe(ctx, l, groupBy?.value);
      },
      () => (groupBy ? [plugin.state.data.events.changed, groupBy] : plugin.state.data.events.changed),
      { compare: (a, b) => a === b || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b)) },
    );
  }

  /**
   * The graphics mode and the motion as the particles' representations have them (the first one's), following the state
   * tree while watched: a read for views; undefined without particles
   */
  graphicsState(particles?: string): ReadonlyState<GraphicsInfo | undefined> {
    const plugin = this.ctx.plugin;
    return watchedState(
      () => {
        // one list's (a model's), else the first shown
        const all = lists({ plugin });
        const of = particles ? all.filter((l) => l.cell.transform.ref === particles) : all;
        const params = of.flatMap((l) => l.representations)[0]?.cell.transform.params as
          | { type?: { params?: Record<string, unknown> } }
          | undefined;
        const type = params?.type?.params;
        if (!type) return undefined;
        const lod = JSON.stringify(type.lodLevels);
        const animation = findAnimation(type);
        return {
          mode: GraphicsModes.find((m) => JSON.stringify(Spheres.LodLevelsPresets[m]) === lod),
          wiggle: animation?.wiggleAmplitude ?? 0,
          tumble: animation?.tumbleAmplitude ?? 0,
        };
      },
      () => plugin.state.data.events.changed,
      { compare: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
    );
  }

  /** The particle lists (state ref and label), following the state tree while watched: a read for views */
  listsState(): ReadonlyState<readonly { readonly ref: string; readonly label: string }[]> {
    const plugin = this.ctx.plugin;
    return watchedState(
      () =>
        lists({ plugin }).map((l) => ({ ref: l.cell.transform.ref, label: l.cell.obj?.label ?? l.cell.transform.ref })),
      () => plugin.state.data.events.changed,
      { compare: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
    );
  }

  readonly entities = this.operation({
    id: 'mesoscale.entities',
    title: 'Describe the entities',
    params: {
      particles: ListParam(),
      groupBy: OptionalParam(
        PD.Select('compartment', GroupByParam().options, {
          description:
            'How to group the entities; absent: by compartment when the list has compartments, else by function',
        }),
      ),
    },
    read: true,
    async run(values, ctx) {
      const { particles, groupBy } = values as typeof values & { groupBy?: MesoGroupBy };
      const l = oneList(ctx, particles || undefined);
      if (isFailure(l)) return l;
      const info = describe(ctx, l, groupBy);
      const lines = info.entities.map(
        (e) =>
          `${e.name} (${e.id}): ${e.count.toLocaleString('en')}${e.visible ? '' : ', hidden'}${e.color !== undefined ? `, ${Color.toHexStyle(e.color)}` : ''}`,
      );
      return ApiResult.ok(
        `${info.label}: ${info.count.toLocaleString('en')} particles, ${info.entities.length} entities\n${lines.join('\n')}`,
        {},
        { value: info },
      );
    },
  });

  readonly style = this.operation({
    id: 'mesoscale.style',
    title: 'Style entities',
    params: {
      ...SelectionParams,
      groupBy: SelectionGroupByParam(),
      visible: OptionalParam(PD.Boolean(true, { description: 'Show or hide them' })),
      color: OptionalParam(PD.Text('', { description: 'A CSS color (tomato, #ff6347)' })),
      transparency: OptionalParam(
        PD.Numeric(0, { min: 0, max: 1, step: 0.01 }, { description: '0 (opaque) to 1 (invisible)' }),
      ),
      emissive: OptionalParam(PD.Numeric(0, { min: 0, max: 1, step: 0.01 }, { description: 'Glow, 0 to 1' })),
      reset: PD.Boolean(false, { description: 'Back to their default look (shown, the color theme)' }),
      particles: ListParam(),
    },
    async run(values, ctx) {
      const { visible, color, transparency, emissive, reset, particles, groupBy } = values as typeof values & {
        groupBy?: MesoGroupBy;
        visible?: boolean;
        color?: string;
        transparency?: number;
        emissive?: number;
      };
      const l = oneList(ctx, particles || undefined);
      if (isFailure(l)) return l;
      const ids = selectEntities(ctx, l, values.entities, values.group, groupBy);
      if (isFailure(ids)) return ids;
      const parsed = color ? cssColor(color) : undefined;
      if (color && parsed === undefined) {
        return ApiResult.fail('invalid', `'${color}' is not a color.`, 'Give a color name (tomato) or #rrggbb.');
      }
      const patch: Partial<EntityStyle> = {
        ...(visible !== undefined ? { visible } : {}),
        ...(parsed !== undefined ? { color: parsed } : {}),
        ...(transparency !== undefined ? { transparency } : {}),
        ...(emissive !== undefined ? { emissive } : {}),
      };
      if (!reset && Object.keys(patch).length === 0) {
        return ApiResult.fail('invalid', 'Nothing to change.', 'Give visible, color, transparency, emissive or reset.');
      }
      const styles = readStyles(ctx, l);
      for (const id of ids) {
        const next = reset ? { visible: true } : { ...(styles.get(id) ?? { visible: true }), ...patch };
        styles.set(id, next);
      }
      const changed = await writeStyles(ctx, l, styles);
      if (!changed) return ApiResult.already('They already look so.');
      return ApiResult.ok(`${reset ? 'Reset' : 'Styled'} ${describeSelection(l, ids)}.`, { nodes: changed });
    },
  });

  readonly colors = this.operation({
    id: 'mesoscale.colors',
    title: 'Color the entities',
    params: {
      scheme: PD.Select('generate', [
        ['generate', 'Generate: a hue per group, its entities around it'],
        ['uniform', 'Uniform: one color'],
        ['theme', "The representation's color theme"],
      ] as const),
      groupBy: PD.Select('compartment', GroupByParam().options, {
        description: 'The groups of the generated colors (a hue each)',
      }),
      variability: PD.Numeric(20, { min: 1, max: 180, step: 1 }, { description: 'Hue spread within a group, °' }),
      shift: PD.Numeric(0, { min: 0, max: 100, step: 1 }, { description: 'Rotates the generated colors' }),
      color: PD.Text('white', { description: 'The uniform color' }),
      ...SelectionParams,
      particles: ListParam(),
    },
    async run({ scheme, groupBy, variability, shift, color, entities, group, particles }, ctx) {
      const l = oneList(ctx, particles || undefined);
      if (isFailure(l)) return l;
      const ids = selectEntities(ctx, l, entities, group);
      if (isFailure(ids)) return ids;
      const uniform = scheme === 'uniform' ? cssColor(color) : undefined;
      if (scheme === 'uniform' && uniform === undefined) {
        return ApiResult.fail('invalid', `'${color}' is not a color.`, 'Give a color name (tomato) or #rrggbb.');
      }
      const data = dataOf(l)!;
      const generated =
        scheme === 'generate'
          ? generateColors(mesoGroups(data, mesoEntities(data), groupBy), variability, shift)
          : undefined;
      const styles = readStyles(ctx, l);
      for (const id of ids) {
        const { color: _, ...rest } = styles.get(id) ?? { visible: true };
        const c = scheme === 'theme' ? undefined : (uniform ?? generated?.get(id));
        styles.set(id, c === undefined ? rest : { ...rest, color: c });
      }
      const changed = await writeStyles(ctx, l, styles);
      if (!changed) return ApiResult.already('They are already colored so.');
      return ApiResult.ok(`Colored ${describeSelection(l, ids)} (${scheme}).`, { nodes: changed });
    },
  });

  readonly motion = this.operation({
    id: 'mesoscale.motion',
    title: 'Wiggle and tumble the particles',
    params: {
      wiggle: OptionalParam(
        PD.Numeric(0, { min: 0, max: 5, step: 0.1 }, { description: 'Wiggle of the atoms, Å; 0: off' }),
      ),
      tumble: OptionalParam(
        PD.Numeric(0, { min: 0, max: 10, step: 0.1 }, { description: 'Tumble of each particle, Å of surface; 0: off' }),
      ),
      particles: PD.Text('', { description: 'A particle list (a model) by label or state ref; empty: every one' }),
    },
    async run(values, ctx) {
      const { wiggle, tumble, particles } = values as { wiggle?: number; tumble?: number; particles: string };
      if (wiggle === undefined && tumble === undefined) {
        return ApiResult.fail('invalid', 'Nothing to change.', 'Give wiggle or tumble (0 stops it).');
      }
      // one model's particles when it is given, not the rest of the scene's
      const one = particles.trim() ? oneList(ctx, particles) : undefined;
      if (isFailure(one)) return one;
      const reps = (one ? [one] : lists(ctx)).flatMap((l) => l.representations);
      if (!reps.length) return ApiResult.fail('not-found', 'No particles are shown.', 'Open a mesoscale model first.');
      const b = ctx.plugin.state.data.build();
      const nodes: string[] = [];
      for (const r of reps) {
        const old = r.cell.transform.params as any;
        const next = { ...old, type: { ...old.type, params: withMotion(old.type.params, wiggle, tumble) } };
        if (JSON.stringify(next) === JSON.stringify(old)) continue;
        b.to(r.cell).update(next);
        nodes.push(r.cell.transform.ref);
      }
      if (!nodes.length) return ApiResult.already('The particles already move so.');
      await b.commit();
      const parts = [
        wiggle !== undefined ? (wiggle ? `wiggle ${wiggle} Å` : 'no wiggle') : undefined,
        tumble !== undefined ? (tumble ? `tumble ${tumble} Å` : 'no tumble') : undefined,
      ].filter((x) => x);
      return ApiResult.ok(`The particles move: ${parts.join(', ')}.`, { nodes });
    },
  });

  readonly example = this.operation({
    id: 'mesoscale.example',
    title: 'Open a mesoscale example',
    params: {
      id: PD.Select<MesoscaleExampleId>(
        'petworld-hiv',
        MesoscaleExampleChoices as unknown as [MesoscaleExampleId, string][],
        {
          description: 'An example of the Mesoscale Explorer',
        },
      ),
    },
    modules: ['network'],
    async run({ id }, ctx) {
      const list = await mesoscaleExamples();
      if (!list.length)
        return ApiResult.fail('unavailable', 'The examples could not be fetched.', `From ${ExamplesBase}.`);
      const e = list.find((x) => x.id === id);
      if (!e) {
        return ApiResult.fail(
          'not-found',
          `There is no example '${id}'.`,
          `Examples: ${list.map((x) => x.id).join(', ')}.`,
        );
      }
      const r =
        e.type === 'molx' || e.type === 'molj'
          ? await ctx.api.run('load.snapshot', { url: e.url, type: e.type })
          : await ctx.api.run('load.url', { url: e.url, format: 'mmcif_particles', binary: e.type === 'bcif' });
      if (!r.ok) return r;
      return ApiResult.ok(`Opened the example ${e.label}.`, r.changed);
    },
  });

  readonly graphics = this.operation({
    id: 'mesoscale.graphics',
    title: 'Set the graphics mode',
    params: {
      mode: PD.Select<GraphicsMode>(
        'quality',
        GraphicsModes.map((m) => [m, m] as [GraphicsMode, string]),
        { description: 'ultra and quality draw every particle near; balanced and performance draw fewer, faster' },
      ),
    },
    async run({ mode }, ctx) {
      const reps = lists(ctx).flatMap((l) => l.representations);
      const lodLevels = Spheres.LodLevelsPresets[mode];
      const updates = reps.filter((r) => {
        const params = (r.cell.transform.params as { type?: { params?: { lodLevels?: unknown } } })?.type?.params;
        return params && 'lodLevels' in params && JSON.stringify(params.lodLevels) !== JSON.stringify(lodLevels);
      });
      const pixelScale = mode === 'balanced' ? 0.75 : mode === 'performance' ? 0.5 : 1;
      const canvasChanged = ctx.plugin.canvas3dContext?.props.pixelScale !== pixelScale;
      if (!updates.length && !canvasChanged) return ApiResult.already(`The graphics are already ${mode}.`);
      if (updates.length) {
        const b = ctx.plugin.state.data.build();
        for (const r of updates) {
          b.to(r.cell).update((old: any) => ({
            ...old,
            type: { ...old.type, params: { ...old.type.params, lodLevels } },
          }));
        }
        await b.commit();
      }
      if (canvasChanged) {
        ctx.plugin.canvas3dContext?.setProps({ pixelScale });
        ctx.plugin.canvas3d?.setProps({
          postprocessing: {
            sharpening:
              pixelScale < 1 ? { name: 'on', params: { sharpness: 0.5, denoise: true } } : { name: 'off', params: {} },
          },
        });
      }
      return ApiResult.ok(`Graphics set to ${mode}.`, { nodes: updates.map((r) => r.cell.transform.ref), view: true });
    },
  });
}

/** Sets `wiggleAmplitude` and `tumbleAmplitude` of every `animation` group in a representation's params */
/** The first `animation` params found in a representation's params (where `withMotion` writes) */
function findAnimation(params: unknown): { wiggleAmplitude?: number; tumbleAmplitude?: number } | undefined {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return undefined;
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (k === 'animation' && v && typeof v === 'object') return v as { wiggleAmplitude?: number };
    const found = findAnimation(v);
    if (found) return found;
  }
  return undefined;
}

function withMotion(params: unknown, wiggle: number | undefined, tumble: number | undefined): unknown {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return params;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (k === 'animation' && v && typeof v === 'object') {
      out[k] = {
        ...v,
        ...(wiggle !== undefined ? { wiggleAmplitude: wiggle } : {}),
        ...(tumble !== undefined ? { tumbleAmplitude: tumble } : {}),
      };
    } else {
      out[k] = withMotion(v, wiggle, tumble);
    }
  }
  return out;
}

/** The Mesoscale Explorer's examples (its deployed list): cellPACK and PetWorld models, sessions */
export const ExamplesBase = 'https://molstar.org/me/examples/';

/**
 * The examples the explorer can open, as molstar.org/me/examples lists them (2026-10; its sessions, molx, left out):
 * the choices of `mesoscale.example`. The list is fetched when one is opened: one it no longer has is said so.
 */
export const MesoscaleExampleChoices = [
  ['petworld-hiv', 'Petworld HIV'],
  ['petworld-sarscov2', 'Petworld SARS-CoV-2'],
  ['petworld-flagellarmotor', 'Petworld Flagellar Motor'],
  ['petworld-t7phage', 'Petworld T7 phage'],
  ['petworld-postsynmushroom', 'Petworld mushroom-type postsynapse'],
  ['petworld-postsynstubby', 'Petworld stubby-type postsynapse'],
  ['petworld-presynapse', 'Petworld presynaptic bouton'],
  ['petworld-syngap', 'Petworld synaptic gap'],
  ['petworld-synvesicle', 'Petworld synaptic vesicle'],
  ['machineryoflife', 'Machinery Of Life'],
  ['cellpack-hiv1', 'CellPack HIV'],
  ['cellpack-exosome', 'CellPack Exosome'],
  ['cellpack-mg', 'CellPack MG'],
] as const;
export type MesoscaleExampleId = (typeof MesoscaleExampleChoices)[number][0];
export const MesoscaleExampleIds: readonly MesoscaleExampleId[] = MesoscaleExampleChoices.map(([id]) => id);

export interface MesoscaleExample {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  readonly type: string;
  readonly description?: string;
}

let examples: Promise<MesoscaleExample[]> | undefined;

/** The examples, fetched once from the explorer's list; their addresses made absolute */
export function mesoscaleExamples(base = ExamplesBase): Promise<MesoscaleExample[]> {
  examples ??= fetch(new URL('list.json', base))
    .then((r) => (r.ok ? r.json() : []))
    // the classic explorer's sessions (molx, molj) need its own transforms (its groups, its cellPACK assembly)
    .then((list: MesoscaleExample[]) =>
      list.filter((e) => e.type !== 'molx' && e.type !== 'molj').map((e) => ({ ...e, url: new URL(e.url, base).href })),
    )
    .catch(() => {
      examples = undefined;
      return [];
    });
  return examples;
}

// --- the particle lists -------------------------------------------------------------------------------------------

function lists(ctx: Pick<ApiContext, 'plugin'>): readonly ParticleListRef[] {
  return ctx.plugin.managers.particles.hierarchy.current.lists;
}

function oneList(ctx: Pick<ApiContext, 'plugin'>, name: string | undefined): ParticleListRef | ApiFailure {
  return pickOne(lists(ctx), name, 'particle list', 'Open a cellPACK or PetWorld model (mmCIF, BinaryCIF) first.');
}

/** The particles a list's representations draw: its own, or its decorated data (targets, attributes) */
function dataOf(l: ParticleListRef): ParticleList | undefined {
  return l.representations[0]?.cell.obj?.data.sourceData ?? l.cell.obj?.data;
}

/** The grouping by default: by compartment when the list has compartments, else by function */
function defaultGroupBy(data: ParticleList): MesoGroupBy {
  return data.compartmentInfo?.size ? 'compartment' : 'function';
}

function describe(ctx: Pick<ApiContext, 'plugin'>, l: ParticleListRef, asked?: MesoGroupBy): MesoscaleInfo {
  const data = dataOf(l)!;
  const entities = mesoEntities(data);
  const groupBy = asked ?? defaultGroupBy(data);
  const styles = readStyles(ctx, l);
  return {
    particles: l.cell.transform.ref,
    label: l.cell.obj?.label ?? l.cell.transform.ref,
    count: data.count,
    entities: entities.map((e) => ({ ...e, visible: true, ...styles.get(e.id) })),
    groups: mesoGroups(data, entities, groupBy),
    groupBy,
    hasCompartments: !!data.compartmentInfo?.size,
  };
}

/**
 * The entities by name and in a group: the group read in the grouping asked, none asked: in the default grouping, then
 * among the functions
 */
function selectEntities(
  ctx: ApiContext,
  l: ParticleListRef,
  names: string,
  group: string,
  groupBy?: MesoGroupBy,
): number[] | ApiFailure {
  const data = dataOf(l);
  if (!data) return ApiResult.fail('not-found', 'The particle list is not loaded yet.');
  const entities = mesoEntities(data);
  let ids: number[] | undefined;
  if (group.trim()) {
    const path = group.trim();
    const g = groupBy
      ? findGroup(mesoGroups(data, entities, groupBy), path)
      : (findGroup(mesoGroups(data, entities, defaultGroupBy(data)), path) ??
        findGroup(mesoGroups(data, entities, 'function'), path));
    if (!g)
      return ApiResult.fail('not-found', `There is no group '${group}'.`, 'Read the groups with mesoscale.entities.');
    ids = groupEntities(g);
  }
  const wanted = names
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s);
  if (wanted.length) {
    const picked: number[] = [];
    for (const w of wanted) {
      const e = entities.find((x) => x.name === w || String(x.id) === w);
      if (!e) {
        return ApiResult.fail(
          'not-found',
          `There is no entity '${w}'.`,
          `Entities: ${entities
            .slice(0, 12)
            .map((x) => x.name)
            .join(', ')}${entities.length > 12 ? ', …' : ''}.`,
        );
      }
      picked.push(e.id);
    }
    ids = ids ? ids.filter((id) => picked.includes(id)) : picked;
  }
  return ids ?? entities.map((e) => e.id);
}

function describeSelection(l: ParticleListRef, ids: readonly number[]): string {
  const data = dataOf(l)!;
  const all = mesoEntities(data);
  if (ids.length === all.length) return `every entity of ${l.cell.obj?.label ?? 'the list'}`;
  const names = ids.map((id) => all.find((e) => e.id === id)?.name ?? String(id));
  return names.length <= 3 ? names.join(', ') : `${names.length} entities`;
}

// --- the styles, as layers ------------------------------------------------------------------------------------------

/** The layers cell of a representation, if any */
function layersCell(ctx: Pick<ApiContext, 'plugin'>, r: ParticleRepresentationRef) {
  const tree = ctx.plugin.state.data.tree;
  for (const child of tree.children.get(r.cell.transform.ref).toArray()) {
    const t = tree.transforms.get(child);
    if (t?.transformer === ParticleRepresentation3DLayers) return t;
  }
}

/** The entity styles of a list: read from the layers of its first representation (they are the same on each) */
function readStyles(ctx: Pick<ApiContext, 'plugin'>, l: ParticleListRef): Map<number, EntityStyle> {
  const styles = new Map<number, EntityStyle>();
  const r = l.representations[0];
  if (!r) return styles;
  const t = layersCell(ctx, r);
  for (const layer of (t?.params?.layers ?? []) as ParticleLayerProps[]) {
    // an entity's layer, or a target's on a list without entities (`toLayers`)
    const id =
      layer.entities.length === 1 ? layer.entities[0] : layer.targets.length === 1 ? layer.targets[0] : undefined;
    if (id === undefined) continue;
    styles.set(id, {
      visible: layer.visible,
      ...(layer.color !== null ? { color: layer.color } : {}),
      ...(layer.transparency !== null ? { transparency: layer.transparency } : {}),
      ...(layer.emissive !== null ? { emissive: layer.emissive } : {}),
    });
  }
  return styles;
}

/** The layers of the styles: by entity, or by target on a list without entities (whose entities are its targets) */
function toLayers(styles: ReadonlyMap<number, EntityStyle>, byTarget: boolean): ParticleLayerProps[] {
  const layers: ParticleLayerProps[] = [];
  for (const [id, s] of Array.from(styles).sort((a, b) => a[0] - b[0])) {
    if (s.visible && s.color === undefined && s.transparency === undefined && s.emissive === undefined) continue;
    layers.push({
      entities: byTarget ? [] : [id],
      compartments: [],
      targets: byTarget ? [id] : [],
      visible: s.visible,
      color: s.color ?? null,
      transparency: s.transparency ?? null,
      emissive: s.emissive ?? null,
    });
  }
  return layers;
}

/** Writes the styles as the layers of every representation of the list; the refs changed, none when already so */
function writeStyles(ctx: ApiContext, l: ParticleListRef, styles: ReadonlyMap<number, EntityStyle>) {
  return writeLayers(ctx, l, { styles });
}

/**
 * Writes the styles (layers) of a list on every representation, in its layers cell (the cuts there, of some particles,
 * Prism's clipping's, kept). The refs changed, none when already so.
 */
async function writeLayers(
  ctx: ApiContext,
  l: ParticleListRef,
  patch: { styles: ReadonlyMap<number, EntityStyle> },
): Promise<string[] | undefined> {
  const byTarget = !dataOf(l)?.entityInfo;
  const b = ctx.plugin.state.data.build();
  const changed: string[] = [];
  for (const r of l.representations) {
    const t = layersCell(ctx, r);
    const oldLayers = (t?.params?.layers ?? []) as ParticleLayerProps[];
    const cuts = (t?.params?.cuts ?? []) as ParticleCutProps[];
    const layers = toLayers(patch.styles, byTarget);
    if (JSON.stringify(layers) === JSON.stringify(oldLayers)) continue;
    if (t) {
      const hidden = (t.params?.hidden ?? []) as number[];
      if (layers.length || cuts.length || hidden.length) b.to(t.ref).update((old: any) => ({ ...old, layers }));
      else b.delete(t.ref);
      changed.push(t.ref);
    } else if (layers.length) {
      b.to(r.cell).apply(ParticleRepresentation3DLayers, { layers, cuts: [] });
      changed.push(r.cell.transform.ref);
    }
  }
  if (!changed.length) return;
  await b.commit();
  return changed;
}

/** A CSS color name or #rrggbb */
export function cssColor(text: string): Color | undefined {
  const c = text.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(c)) return Color.fromHexStyle(c);
  if (/^#[0-9a-f]{3}$/.test(c)) return Color.fromHexStyle(`#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`);
  const named = (ColorNames as Record<string, Color>)[c.replace(/[\s-]/g, '')];
  return named;
}
