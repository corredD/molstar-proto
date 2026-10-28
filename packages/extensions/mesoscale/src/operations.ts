/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Color } from '@molstar/core/util/color';
import { distinctColors } from '@molstar/core/util/color/distinct';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import type { VisualQuality } from '@molstar/graphics/geo/geometry/base';
import { Spheres } from '@molstar/graphics/geo/geometry/spheres/spheres';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import { type StateObjectCell, StateTransform } from '@molstar/core/state';
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
import { isFailure, labelOf, pickNamed, pickOne } from '@molstar/prism-viewer/api/scope';
import { watchedState } from '@molstar/prism-viewer/sources/watched';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import { cssColor, matchColors, parseColorFile } from './color-file.js';
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

/** What `importColors` did with a color file: the entities colored, the keys that name none, the values not colors */
export interface ImportColorsResult {
  readonly matched: readonly string[];
  readonly unmatched: readonly string[];
  readonly invalid: readonly string[];
  /** The entities the file names twice or more (one entity per name across compartments): the last color kept */
  readonly overridden: readonly string[];
}

/**
 * An object's graphics: its mode (none when its settings are not one of the modes'), its motion (none for a volume,
 * which does not move: wiggle and tumble do not apply)
 */
export interface GraphicsInfo {
  readonly mode?: GraphicsMode;
  readonly wiggle?: number;
  readonly tumble?: number;
}

/** What a graphics mode sets on each kind of object (apps/prism-me/_spec/ui.md §4, Graphics & Motion) */
const ModeSettings: Record<GraphicsMode, { readonly quality: VisualQuality; readonly stepsPerCell: number }> = {
  ultra: { quality: 'highest', stepsPerCell: 5 },
  quality: { quality: 'high', stepsPerCell: 3 },
  balanced: { quality: 'medium', stepsPerCell: 2 },
  performance: { quality: 'low', stepsPerCell: 1 },
};

/**
 * An object with graphics: a structure, a particle list (a model) or a volume, its name as prism-me's tree shows it (a
 * structure's entry, else the file's name), the other names it is found by, and the representations drawing it
 */
interface GraphicsObject {
  readonly kind: 'structure' | 'particles' | 'volume';
  readonly cell: StateObjectCell;
  readonly name: string;
  readonly names: readonly (string | undefined)[];
  readonly representations: readonly StateObjectCell[];
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
   * The graphics mode and the motion of an object (a structure, a particle list, a volume; by state ref) as its
   * representations have them (every one; mixed: no mode, no motion), else of the first particle list shown; following the state tree while
   * watched: a read for views; undefined without such an object
   */
  graphicsState(object?: string): ReadonlyState<GraphicsInfo | undefined> {
    const plugin = this.ctx.plugin;
    return watchedState(
      () => {
        const all = graphicsObjects({ plugin });
        const o = object
          ? all.find((x) => x.cell.transform.ref === object)
          : all.find((x) => x.kind === 'particles' && x.representations.length);
        return o && graphicsOf(o);
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

  /** Says a file a view picked could not be read: on the status line, as the plugin's errors are (it stays shown) */
  fileUnreadable(name: string, e: unknown): void {
    this.ctx.plugin.log.error(`${name} could not be read: ${e instanceof Error ? e.message : String(e)}`);
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
      const change: LayerChange = reset ? { reset: true } : patch;
      const changed = await writeStyles(
        ctx,
        l,
        ids.map((id) => [id, change]),
      );
      if (isFailure(changed)) return changed;
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
      const changed = await writeStyles(
        ctx,
        l,
        ids.map((id) => [id, { color: (scheme === 'theme' ? undefined : (uniform ?? generated?.get(id))) ?? null }]),
      );
      if (isFailure(changed)) return changed;
      if (!changed) return ApiResult.already('They are already colored so.');
      return ApiResult.ok(`Colored ${describeSelection(l, ids)} (${scheme}).`, { nodes: changed });
    },
  });

  readonly importColors = this.operation({
    id: 'mesoscale.importColors',
    title: 'Import entity colors',
    params: {
      json: PD.Text('', {
        description:
          'A JSON object of colors by entity name: {"HIV1_CA_mono_0_1_0": "#ff6347"}, or the Mesoscale Explorer\'s color file ({"root.HIVenvelop_mature.HIV_capsid.surface.proteins.HIV1_CA_mono_0_1_0": {"x": 255, "y": 99, "z": 71}}, 0-255)',
      }),
      particles: ListParam(),
    },
    async run({ json, particles }, ctx) {
      const file = parseColorFile(json);
      if (typeof file === 'string') {
        return ApiResult.fail(
          'invalid',
          file,
          'Give {"<entity name>": "#rrggbb"} or the Mesoscale Explorer\'s color file.',
        );
      }
      const l = oneList(ctx, particles || undefined);
      if (isFailure(l)) return l;
      const data = dataOf(l);
      if (!data) return ApiResult.fail('not-found', 'The particle list is not loaded yet.');
      const entities = mesoEntities(data);
      const { colors, matched, unmatched, invalid, overridden } = matchColors(entities, file);
      const value: ImportColorsResult = { matched, unmatched, invalid, overridden };
      if (!colors.size && invalid.length && !unmatched.length) {
        return ApiResult.fail(
          'invalid',
          `The values of the colors are not colors: ${namesOf(invalid)}.`,
          'Give a CSS color ("#ff6347", "tomato") or {"x": r, "y": g, "z": b}, integers in 0-255.',
        );
      }
      if (!colors.size) {
        return ApiResult.fail(
          'not-found',
          `No entity of ${l.cell.obj?.label ?? 'the list'} is named in the colors${invalid.length ? ` (${invalid.length} not colors)` : ''}.`,
          `Entities: ${namesOf(entities.map((e) => e.name))}.`,
        );
      }
      // one write: one commit, one history step, whatever the number of entities
      const changed = await writeStyles(
        ctx,
        l,
        Array.from(colors, ([id, color]) => [id, { color }]),
      );
      if (isFailure(changed)) return changed;
      const missed = [
        unmatched.length ? `not found: ${namesOf(unmatched)}` : '',
        invalid.length ? `not colors: ${namesOf(invalid)}` : '',
        overridden.length
          ? `${overridden.length} ${overridden.length === 1 ? 'entity' : 'entities'} named twice, last color kept: ${namesOf(overridden)}`
          : '',
      ]
        .filter((x) => x)
        .join('; ');
      if (!changed)
        return ApiResult.already(`The entities are already colored so${missed ? `; ${missed}` : ''}.`, { value });
      return ApiResult.ok(
        `Colored ${matched.length} ${matched.length === 1 ? 'entity' : 'entities'} from the file${missed ? `; ${missed}` : ''}.`,
        { nodes: changed },
        { value },
      );
    },
  });

  readonly motion = this.operation({
    id: 'mesoscale.motion',
    title: 'Wiggle and tumble an object',
    params: {
      wiggle: OptionalParam(
        PD.Numeric(0, { min: 0, max: 5, step: 0.1 }, { description: 'Wiggle of the atoms, Å; 0: off' }),
      ),
      tumble: OptionalParam(
        PD.Numeric(0, { min: 0, max: 10, step: 0.1 }, { description: 'Tumble of each particle, Å of surface; 0: off' }),
      ),
      particles: PD.Text('', { description: 'A particle list (a model) by label or state ref; empty: every one' }),
      object: OptionalParam(
        PD.Text('', {
          description:
            'A structure or a particle list by its name (as the tree shows it) or state ref (in place of particles)',
        }),
      ),
    },
    async run(values, ctx) {
      const { wiggle, tumble, particles, object } = values as {
        wiggle?: number;
        tumble?: number;
        particles: string;
        object?: string;
      };
      if (wiggle === undefined && tumble === undefined) {
        return ApiResult.fail('invalid', 'Nothing to change.', 'Give wiggle or tumble (0 stops it).');
      }
      // one object's representations when it is given (a model, a structure), not the rest of the scene's
      let reps: readonly StateObjectCell[];
      let of = '';
      if (object?.trim()) {
        const o = oneObject(ctx, object);
        if (isFailure(o)) return o;
        if (o.kind === 'volume') {
          return ApiResult.fail(
            'invalid',
            'A volume does not wiggle or tumble.',
            'Give a structure or a particle list.',
          );
        }
        reps = o.representations;
        of = ` of ${o.name}`;
      } else {
        const one = particles.trim() ? oneList(ctx, particles) : undefined;
        if (isFailure(one)) return one;
        reps = (one ? [one] : lists(ctx)).flatMap((l) => l.representations.map((r) => r.cell));
      }
      if (!reps.length) {
        return of
          ? ApiResult.fail('not-found', `Nothing${of} is drawn.`, 'Give it a representation first.')
          : ApiResult.fail('not-found', 'No particles are shown.', 'Open a mesoscale model first.');
      }
      const b = ctx.plugin.state.data.build();
      const nodes: string[] = [];
      for (const r of reps) {
        const old = r.transform.params as any;
        const next = { ...old, type: { ...old.type, params: withMotion(old.type.params, wiggle, tumble) } };
        if (JSON.stringify(next) === JSON.stringify(old)) continue;
        b.to(r).update(next);
        nodes.push(r.transform.ref);
      }
      if (!nodes.length) return ApiResult.already('It already moves so.');
      await b.commit();
      const parts = [
        wiggle !== undefined ? (wiggle ? `wiggle ${wiggle} Å` : 'no wiggle') : undefined,
        tumble !== undefined ? (tumble ? `tumble ${tumble} Å` : 'no tumble') : undefined,
      ].filter((x) => x);
      return ApiResult.ok(`Motion${of}: ${parts.join(', ')}.`, { nodes });
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
      object: OptionalParam(
        PD.Text('', {
          description:
            'A structure, a particle list or a volume by its name (as the tree shows it) or state ref: its quality alone; absent: every object, and the canvas resolution',
        }),
      ),
    },
    async run(values, ctx) {
      const { mode, object } = values as { mode: GraphicsMode; object?: string };
      const one = object?.trim() ? oneObject(ctx, object) : undefined;
      if (isFailure(one)) return one;
      if (one && !one.representations.length) {
        return ApiResult.fail('not-found', `Nothing of ${one.name} is drawn.`, 'Give it a representation first.');
      }
      // one commit for every representation of every object (bulk is one change)
      const b = ctx.plugin.state.data.build();
      const nodes: string[] = [];
      for (const o of one ? [one] : graphicsObjects(ctx)) {
        for (const r of o.representations) {
          const old = r.transform.params as { type?: { params?: Record<string, unknown> } };
          const params = old?.type?.params;
          if (!params) continue;
          const next = withMode(o.kind, params, mode);
          if (JSON.stringify(next) === JSON.stringify(params)) continue;
          b.to(r).update({ ...old, type: { ...old.type, params: next } });
          nodes.push(r.transform.ref);
        }
      }
      // the canvas's resolution is the scene's: set by the mode of every object only
      const pixelScale = mode === 'balanced' ? 0.75 : mode === 'performance' ? 0.5 : 1;
      const canvasChanged = !one && ctx.plugin.canvas3dContext?.props.pixelScale !== pixelScale;
      if (!nodes.length && !canvasChanged) return ApiResult.already(`The graphics are already ${mode}.`);
      if (nodes.length) await b.commit();
      if (canvasChanged) {
        ctx.plugin.canvas3dContext?.setProps({ pixelScale });
        ctx.plugin.canvas3d?.setProps({
          postprocessing: {
            sharpening:
              pixelScale < 1 ? { name: 'on', params: { sharpness: 0.5, denoise: true } } : { name: 'off', params: {} },
          },
        });
      }
      const of = one ? ` for ${one.name}` : '';
      return ApiResult.ok(`Graphics set to ${mode}${of}.`, { nodes, view: !one });
    },
  });

  /**
   * A color theme for several objects at once, each kind by the theme it takes (a category's brush in prism-me, ui.md
   * §3): structures by object, entity, chain or one color; particle models and lists by object, entity (a list with no
   * entities: by object), generated colors or one color; volumes (their isosurfaces: slices show the data) and meshes
   * by object or one color. Everything is planned before a change, so a theme an object does not take changes nothing;
   * then one commit of the representations' themes, and the particles' look colors (they paint over a theme) cleared or
   * generated and the meshes colored in the same step.
   */
  readonly theme = this.operation({
    id: 'mesoscale.theme',
    title: 'Color several objects by a theme',
    surface: {
      kind: 'agent-only',
      reason:
        "Objects by state ref, which a command's form would read as files: the explorer's category brush and the agent",
    },
    params: {
      objects: PD.Value<string[]>([], {
        description: 'The objects by state ref: structures, particle models and lists, volumes, meshes',
      }),
      theme: PD.Select<ObjectsTheme>('object', [...ObjectsThemes]),
      color: PD.Text('white', { description: 'The color of the theme uniform (a CSS color)' }),
    },
    async run({ objects: refs, theme, color }, ctx) {
      if (!refs.length) return ApiResult.fail('invalid', 'Which objects?', 'Give their state refs.');
      const one = theme === 'uniform' ? cssColor(color) : undefined;
      if (theme === 'uniform' && one === undefined) {
        return ApiResult.fail('invalid', `'${color}' is not a color.`, 'Give a color name (tomato) or #rrggbb.');
      }
      const byRef = new Map(graphicsObjects(ctx).map((o) => [o.cell.transform.ref, o]));
      const lists = new Map(
        ctx.plugin.managers.particles.hierarchy.current.lists.map((l) => [l.cell.transform.ref, l]),
      );
      const palette = distinctColors(refs.length);
      const label = ObjectsThemes.find(([t]) => t === theme)![1];
      // the plan: what each object takes, checked before any change
      const plans: ThemePlan[] = [];
      const fallbacks: string[] = [];
      let meshRefs: ReadonlySet<string> | undefined;
      for (let i = 0; i < refs.length; i++) {
        const o = byRef.get(refs[i]);
        const mine = one ?? palette[i];
        if (!o) {
          // not a structure, a list or a volume: a mesh, as cryoet lists them (by id, read once), else nothing changes
          meshRefs ??= await meshesOf(ctx);
          if (!meshRefs.has(refs[i])) {
            return ApiResult.fail('not-found', `There is no object '${refs[i]}' to color.`, 'Nothing was changed.');
          }
          if (theme !== 'object' && theme !== 'uniform') return doesNotTake(refs[i], label);
          plans.push({ kind: 'mesh', ref: refs[i], color: mine });
          continue;
        }
        const named = (name: string, params: Record<string, unknown> = {}) => ({ name, params });
        if (o.kind === 'structure') {
          if (theme === 'generate') return doesNotTake(o.name, label);
          const name = theme === 'entity' ? 'entity-id' : theme === 'chain' ? 'chain-id' : 'uniform';
          plans.push({ kind: 'reps', o, theme: named(name, name === 'uniform' ? { value: mine } : {}) });
        } else if (o.kind === 'particles') {
          if (theme === 'chain') return doesNotTake(o.name, label);
          const data = particleData(o.cell, o.representations);
          const entities = !!data?.entityInfo?.size;
          if (theme === 'generate' && entities) {
            plans.push({ kind: 'generate', o });
            continue;
          }
          const byEntity = theme === 'entity' && entities;
          if ((theme === 'entity' || theme === 'generate') && !entities) fallbacks.push(o.name);
          plans.push({
            kind: 'reps',
            o,
            theme: byEntity ? named('particle-entity') : named('uniform', { value: mine }),
            // look colors paint over a theme: cleared, whether set by entity or (a plain list) by target
            clear: hasLookColors(ctx, lists.get(o.cell.transform.ref)),
          });
        } else {
          if (theme !== 'object' && theme !== 'uniform') return doesNotTake(o.name, label);
          plans.push({ kind: 'reps', o, theme: named('uniform', { value: mine }), only: 'isosurface' });
        }
      }
      // each representation's theme, planned too: an object with none it can take has nothing to color (a volume's
      // slices show the data; a list not drawn), said rather than "already so"
      const writes: { o: GraphicsObject; r: StateObjectCell; params: object; next: object; same: boolean }[] = [];
      const nothing: string[] = [];
      for (const p of plans) {
        if (p.kind !== 'reps') continue;
        let any = false;
        for (const r of p.o.representations) {
          const params = r.transform.params as { type?: { name?: string }; colorTheme?: { name: string } };
          if (p.only && params.type?.name !== p.only) continue;
          const next = themeFor(ctx, p.o, r, p.theme);
          if (!next) continue;
          any = true;
          writes.push({ o: p.o, r, params, next, same: JSON.stringify(params.colorTheme) === JSON.stringify(next) });
        }
        if (!any) nothing.push(p.o.name);
      }
      const none = nothing.length ? `${nothing.join(', ')}: nothing to color` : '';
      if (nothing.length === plans.length) {
        return ApiResult.fail('not-found', `${none} (a volume's slices show the data; a list needs a representation).`);
      }
      // one commit for every representation's theme (bulk is one change)
      const b = ctx.plugin.state.data.build();
      const nodes: string[] = [];
      const changed = new Set<string>();
      for (const w of writes) {
        if (w.same) continue;
        b.to(w.r).update({ ...w.params, colorTheme: w.next });
        nodes.push(w.r.transform.ref);
        changed.add(w.o.cell.transform.ref);
      }
      if (nodes.length) await b.commit();
      // the particles' look colors, which paint over a theme (their one writer, `particles.look`): cleared, or generated
      for (const p of plans) {
        if (p.kind === 'generate' || (p.kind === 'reps' && p.clear)) {
          const r = await ctx.api.run('mesoscale.colors', {
            scheme: p.kind === 'generate' ? 'generate' : 'theme',
            particles: p.o.cell.transform.ref,
          });
          // a nested failure is the run's (a top-level run reads only its own result)
          if (!r.ok) return r;
          if (!r.unchanged) {
            nodes.push(...(r.changed.nodes ?? []));
            changed.add(p.o.cell.transform.ref);
          }
        } else if (p.kind === 'mesh') {
          const r = await ctx.api.run('cryoet.mesh', { mesh: p.ref, color: Color.toHexStyle(p.color) });
          if (!r.ok) return r;
          if (!r.unchanged) {
            nodes.push(p.ref);
            changed.add(p.ref);
          }
        }
      }
      const notes = [
        ...(fallbacks.length ? [`${fallbacks.join(', ')}: no entities, by object`] : []),
        ...(none ? [none] : []),
      ];
      const also = notes.length ? ` (${notes.join('; ')})` : '';
      if (!nodes.length) return ApiResult.already(`They are already colored ${label.toLowerCase()}${also}.`);
      const n = changed.size;
      return ApiResult.ok(`Colored ${n} object${n > 1 ? 's' : ''} ${label.toLowerCase()}${also}.`, { nodes });
    },
  });
}

/** The themes `mesoscale.theme` gives several objects */
const ObjectsThemes = [
  ['object', 'By object'],
  ['entity', 'By entity'],
  ['chain', 'By chain'],
  ['generate', 'Generate colors'],
  ['uniform', 'Uniform'],
] as const;
type ObjectsTheme = (typeof ObjectsThemes)[number][0];

/** What `mesoscale.theme` does to one object */
type ThemePlan =
  | {
      readonly kind: 'reps';
      readonly o: GraphicsObject;
      readonly theme: { readonly name: string; readonly params: Record<string, unknown> };
      /** Only representations of this type (a volume's isosurfaces) */
      readonly only?: string;
      /** Its look colors cleared (a model's: they paint over the theme) */
      readonly clear?: boolean;
    }
  | { readonly kind: 'generate'; readonly o: GraphicsObject }
  | { readonly kind: 'mesh'; readonly ref: string; readonly color: Color };

const doesNotTake = (name: string, theme: string) =>
  ApiResult.fail('invalid', `${name} cannot be colored ${theme.toLowerCase()}.`, 'Nothing was changed.');

/** The meshes' refs, as cryoet lists them (its read operation, by id); none without cryoet */
async function meshesOf(ctx: ApiContext): Promise<ReadonlySet<string>> {
  const r = await ctx.api.run('cryoet.meshes', {});
  const list = r.ok ? ((r as { value?: readonly { ref: string }[] }).value ?? []) : [];
  return new Set(list.map((m) => m.ref));
}

/** Whether a list has look colors (by entity, or by target on a list with no entities) */
function hasLookColors(ctx: Pick<ApiContext, 'plugin'>, l: ParticleListRef | undefined): boolean {
  if (!l) return false;
  for (const s of readStyles(ctx, l).values()) if (s.color !== undefined) return true;
  return false;
}

/** A particle object's list: its representations' source, else its own */
function particleData(cell: StateObjectCell, reps: readonly StateObjectCell[]): ParticleList | undefined {
  return (reps[0]?.obj?.data as { sourceData?: ParticleList } | undefined)?.sourceData ?? cell.obj?.data;
}

/** A representation's color theme, by name, its params the theme's defaults for it and `params` */
function themeFor(
  ctx: Pick<ApiContext, 'plugin'>,
  o: GraphicsObject,
  r: StateObjectCell,
  theme: { readonly name: string; readonly params: Record<string, unknown> },
): { name: string; params: Record<string, unknown> } | undefined {
  const { themes } =
    ctx.plugin.representation[o.kind === 'volume' ? 'volume' : o.kind === 'particles' ? 'particles' : 'structure'];
  const registry = themes.colorThemeRegistry as {
    has(name: string): boolean;
    get(name: string): { getParams(ctx: object): PD.Params };
  };
  if (!registry.has(theme.name)) return undefined;
  const data =
    o.kind === 'particles'
      ? { particles: particleData(o.cell, [r]) }
      : o.kind === 'volume'
        ? { volume: o.cell.obj?.data }
        : { structure: o.cell.obj?.data };
  return {
    name: theme.name,
    params: { ...PD.getDefaultValues(registry.get(theme.name).getParams(data)), ...theme.params },
  };
}

/** The objects with graphics: structures, particle lists, volumes */
function graphicsObjects(ctx: Pick<ApiContext, 'plugin'>): GraphicsObject[] {
  const { plugin } = ctx;
  const { structure, particles, volume } = plugin.managers;
  const named = (cell: StateObjectCell, name?: string) => {
    const file = fileLabel(plugin, cell.transform.ref);
    const shown = name ?? file ?? cell.obj?.label ?? cell.transform.ref;
    return { cell, name: shown, names: [shown, file, cell.obj?.label] };
  };
  return [
    ...structure.hierarchy.current.structures.map((s) => ({
      kind: 'structure' as const,
      ...named(s.cell, labelOf(ctx, s)),
      representations: s.components.flatMap((c) => c.representations.map((r) => r.cell)),
    })),
    ...particles.hierarchy.current.lists.map((l) => ({
      kind: 'particles' as const,
      ...named(l.cell),
      representations: l.representations.map((r) => r.cell),
    })),
    ...volume.hierarchy.current.volumes.map((v) => ({
      kind: 'volume' as const,
      ...named(v.cell),
      representations: v.representations.map((r) => r.cell),
    })),
  ];
}

/** The name of the file an object came from: its root data's label (as prism-me's tree names it) */
function fileLabel(plugin: ApiContext['plugin'], ref: string): string | undefined {
  const { cells, tree } = plugin.state.data;
  let root = ref;
  for (;;) {
    const parent = tree.transforms.get(root)?.parent;
    if (!parent || parent === StateTransform.RootRef) break;
    root = parent;
  }
  const data = cells.get(root)?.obj;
  return SO.Data.String.is(data) || SO.Data.Binary.is(data) || SO.Data.Response.is(data) ? data.label : undefined;
}

/** One object by state ref, its tree name (a structure's entry, a file's name) or the plugin's label */
function oneObject(ctx: Pick<ApiContext, 'plugin'>, name: string): GraphicsObject | ApiFailure {
  return pickNamed(graphicsObjects(ctx), name, {
    what: 'object',
    ids: (o) => [o.cell.transform.ref],
    names: (o) => o.names,
    describe: (o) => `${o.name} (${o.cell.transform.ref})`,
    none: { message: 'Nothing is loaded.', hint: 'Open a structure, a mesoscale model or a volume first.' },
  });
}

/**
 * A representation's params in a graphics mode, by its object's kind: a particle list's levels of detail; a structure's
 * quality and levels of detail (its spheres'); a volume's quality and ray-marching steps (a direct volume's)
 */
function withMode(
  kind: GraphicsObject['kind'],
  params: Record<string, unknown>,
  mode: GraphicsMode,
): Record<string, unknown> {
  const next = { ...params };
  if (kind !== 'volume' && 'lodLevels' in params) next.lodLevels = Spheres.LodLevelsPresets[mode];
  if (kind !== 'particles') next.quality = ModeSettings[mode].quality;
  if (kind === 'volume' && 'stepsPerCell' in params) next.stepsPerCell = ModeSettings[mode].stepsPerCell;
  return next;
}

/**
 * An object's mode and motion as its representations have them, every one: a value they differ on is mixed, read as no
 * mode and the motion off (a representation added later, or a preset, has its own); a volume's mode only
 */
function graphicsOf(o: GraphicsObject): GraphicsInfo | undefined {
  const types = o.representations
    .map((r) => (r.transform.params as { type?: { params?: Record<string, unknown> } } | undefined)?.type?.params)
    .filter((t): t is Record<string, unknown> => !!t);
  if (!types.length) return undefined;
  // the one value every representation has, else undefined (mixed)
  const common = <T>(of: (t: Record<string, unknown>) => T): T | undefined => {
    const first = JSON.stringify(of(types[0]));
    return types.every((t) => JSON.stringify(of(t)) === first) ? of(types[0]) : undefined;
  };
  const modeOf = (t: Record<string, unknown>) =>
    o.kind === 'particles'
      ? GraphicsModes.find((m) => JSON.stringify(Spheres.LodLevelsPresets[m]) === JSON.stringify(t.lodLevels))
      : GraphicsModes.find((m) => ModeSettings[m].quality === t.quality);
  const mode = common(modeOf);
  if (o.kind === 'volume') return mode ? { mode } : {};
  return {
    ...(mode ? { mode } : {}),
    wiggle: common((t) => findAnimation(t)?.wiggleAmplitude ?? 0) ?? 0,
    tumble: common((t) => findAnimation(t)?.tumbleAmplitude ?? 0) ?? 0,
  };
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

/** A few names, then how many more */
function namesOf(names: readonly string[], max = 5): string {
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? `${shown} and ${names.length - max} more` : shown;
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

/**
 * The entity styles of a list: read from the layers of its first representation (they are the same on each), the
 * entities' (single-id) layers, or the targets' on a list without entities (whose entities are its targets)
 */
function readStyles(ctx: Pick<ApiContext, 'plugin'>, l: ParticleListRef): Map<number, EntityStyle> {
  const styles = new Map<number, EntityStyle>();
  const r = l.representations[0];
  if (!r) return styles;
  const byTarget = !dataOf(l)?.entityInfo;
  for (const layer of (layersCell(ctx, r)?.params?.layers ?? []) as ParticleLayerProps[]) {
    const [own, other] = byTarget ? [layer.targets, layer.entities] : [layer.entities, layer.targets];
    if (own.length !== 1 || other.length || layer.compartments.length) continue;
    styles.set(own[0], {
      visible: layer.visible,
      ...(layer.color !== null ? { color: layer.color } : {}),
      ...(layer.transparency !== null ? { transparency: layer.transparency } : {}),
      ...(layer.emissive !== null ? { emissive: layer.emissive } : {}),
    });
  }
  return styles;
}

/** A change to an entity's layer (`particles.look`'s): absent fields kept, null clears one, reset drops the layer */
interface LayerChange {
  readonly visible?: boolean;
  readonly color?: Color | null;
  readonly transparency?: number | null;
  readonly emissive?: number | null;
  readonly reset?: boolean;
}

/**
 * Patches the entities' layers on every representation of the list (`particles.look`, by id: the one writer of the
 * layers cell, so the cuts and the hidden targets there, and the other entities' layers, stay): by entity, or by
 * target on a list without entities (whose entities are its targets). The refs changed, none when already so.
 */
async function writeStyles(
  ctx: ApiContext,
  l: ParticleListRef,
  changes: readonly (readonly [number, LayerChange])[],
): Promise<readonly string[] | ApiFailure | undefined> {
  const byTarget = !dataOf(l)?.entityInfo;
  const layers = changes.map(([id, change]) => ({
    selector: byTarget ? { targets: [id] } : { entities: [id] },
    ...change,
  }));
  const r = await ctx.api.run('particles.look', { particles: l.cell.transform.ref, layers });
  if (!r.ok) return r;
  return r.unchanged ? undefined : (r.changed.nodes ?? []);
}

export { cssColor };
