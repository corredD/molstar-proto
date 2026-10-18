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
  /** By compartment when the list has compartments, else by function */
  readonly groups: MesoGroup;
  readonly groupBy: MesoGroupBy;
}

const ListParam = () =>
  PD.Text('', { description: 'A particle list by label or state ref; empty: the only one loaded' });

const SelectionParams = {
  entities: PD.Text('', {
    description: 'Entities by name or id, comma-separated (HIV1_CA_mono_0_1_0, 3); with no group: empty is every one',
  }),
  group: PD.Text('', {
    description:
      'A group of entities: a compartment by its dotted path (root.HIVenvelop_mature.HIV_capsid), or a function',
  }),
};

export class MesoscaleApi extends ApiArea {
  readonly id = 'mesoscale';

  /**
   * What the Entities view shows of a list (by state ref, the only one when empty), following the state tree while
   * watched: a read for views; undefined when there is no list.
   */
  infoState(particles = ''): ReadonlyState<MesoscaleInfo | undefined> {
    const plugin = this.ctx.plugin;
    return watchedState(
      () => {
        const ctx = { plugin };
        const l = oneList(ctx, particles || undefined);
        return isFailure(l) ? undefined : describe(ctx, l);
      },
      () => plugin.state.data.events.changed,
      { compare: (a, b) => a === b || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b)) },
    );
  }

  readonly entities = this.operation({
    id: 'mesoscale.entities',
    title: 'Describe the entities',
    params: { particles: ListParam() },
    read: true,
    async run({ particles }, ctx) {
      const l = oneList(ctx, particles || undefined);
      if (isFailure(l)) return l;
      const info = describe(ctx, l);
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
      const { visible, color, transparency, emissive, reset, particles } = values as typeof values & {
        visible?: boolean;
        color?: string;
        transparency?: number;
        emissive?: number;
      };
      const l = oneList(ctx, particles || undefined);
      if (isFailure(l)) return l;
      const ids = selectEntities(ctx, l, values.entities, values.group);
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
      groupBy: PD.Select('compartment', [
        ['compartment', 'Compartment'],
        ['function', 'Function'],
      ] as const),
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

function describe(ctx: Pick<ApiContext, 'plugin'>, l: ParticleListRef): MesoscaleInfo {
  const data = dataOf(l)!;
  const entities = mesoEntities(data);
  const groupBy: MesoGroupBy = data.compartmentInfo?.size ? 'compartment' : 'function';
  const styles = readStyles(ctx, l);
  return {
    particles: l.cell.transform.ref,
    label: l.cell.obj?.label ?? l.cell.transform.ref,
    count: data.count,
    entities: entities.map((e) => ({ ...e, visible: true, ...styles.get(e.id) })),
    groups: mesoGroups(data, entities, groupBy),
    groupBy,
  };
}

function selectEntities(ctx: ApiContext, l: ParticleListRef, names: string, group: string): number[] | ApiFailure {
  const data = dataOf(l);
  if (!data) return ApiResult.fail('not-found', 'The particle list is not loaded yet.');
  const entities = mesoEntities(data);
  let ids: number[] | undefined;
  if (group.trim()) {
    const groupBy: MesoGroupBy = data.compartmentInfo?.size ? 'compartment' : 'function';
    const root = mesoGroups(data, entities, groupBy);
    const g = findGroup(root, group.trim()) ?? findGroup(mesoGroups(data, entities, 'function'), group.trim());
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
    if (layer.entities.length !== 1) continue;
    styles.set(layer.entities[0], {
      visible: layer.visible,
      ...(layer.color !== null ? { color: layer.color } : {}),
      ...(layer.transparency !== null ? { transparency: layer.transparency } : {}),
      ...(layer.emissive !== null ? { emissive: layer.emissive } : {}),
    });
  }
  return styles;
}

function toLayers(styles: ReadonlyMap<number, EntityStyle>): ParticleLayerProps[] {
  const layers: ParticleLayerProps[] = [];
  for (const [id, s] of Array.from(styles).sort((a, b) => a[0] - b[0])) {
    if (s.visible && s.color === undefined && s.transparency === undefined && s.emissive === undefined) continue;
    layers.push({
      entities: [id],
      compartments: [],
      targets: [],
      visible: s.visible,
      color: s.color ?? null,
      transparency: s.transparency ?? null,
      emissive: s.emissive ?? null,
    });
  }
  return layers;
}

/** Writes the styles as the layers of every representation of the list; the refs changed, none when already so */
async function writeStyles(
  ctx: ApiContext,
  l: ParticleListRef,
  styles: ReadonlyMap<number, EntityStyle>,
): Promise<string[] | undefined> {
  const layers = toLayers(styles);
  const b = ctx.plugin.state.data.build();
  const changed: string[] = [];
  for (const r of l.representations) {
    const t = layersCell(ctx, r);
    if (t) {
      if (JSON.stringify(t.params?.layers) === JSON.stringify(layers)) continue;
      if (layers.length) b.to(t.ref).update({ layers });
      else b.delete(t.ref);
      changed.push(t.ref);
    } else if (layers.length) {
      b.to(r.cell).apply(ParticleRepresentation3DLayers, { layers });
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
