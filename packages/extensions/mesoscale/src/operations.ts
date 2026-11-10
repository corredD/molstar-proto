/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Color } from '@molstar/core/util/color';
import { download } from '@molstar/core/util/download';
import { Task } from '@molstar/core/task';
import { distinctColors } from '@molstar/core/util/color/distinct';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import type { VisualQuality } from '@molstar/graphics/geo/geometry/base';
import { Spheres } from '@molstar/graphics/geo/geometry/spheres/spheres';
import { ColorLevels } from '@molstar/graphics/geo/geometry/color-levels';
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
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import {
  canDrawLipidMembranes,
  LipidMembrane,
  LipidMembraneParams,
  type LipidMembraneProps,
  LipidMembraneReprParams,
  hasLipidPatch,
  registerLipidPatch,
  type MembraneAtomColors,
  type MembraneData,
  type MembraneDetail,
  type MembraneLevel,
  membraneSpecies,
  membraneSpeciesColors,
} from './lipids/membrane.js';
import type { MembraneFar } from './lipids/procedural.js';
import { membraneStar } from './lipids/export.js';
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
  /** A particle list's colors that follow the zoom (`mesoscale.colorLevels`): their edges, null off, none mixed */
  readonly colorLevels?: ColorLevels.Props | null;
  /** A lipid membrane's far colour by zoom (its own colour) and its atoms' colours close up (round 7 item 6) */
  readonly far?: Color;
  readonly atomColors?: MembraneAtomColors;
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
   * representations have them (every one, a particle list's mode those with levels of detail; mixed: no mode, no
   * motion), else of the first particle list shown; following the state tree while
   * watched: a read for views; undefined without such an object
   */
  graphicsState(object?: string): ReadonlyState<GraphicsInfo | undefined> {
    const plugin = this.ctx.plugin;
    return watchedState(
      () => {
        // a lipid membrane: its colours by zoom (round 4c item 8; its levels are `membraneDetailState`'s)
        const membrane = object ? membraneCell({ plugin }, object) : undefined;
        if (membrane) {
          const p = membrane.transform.params as LipidMembraneProps;
          const levels = p.colorLevels;
          return {
            colorLevels: levels.name === 'on' ? (levels.params as ColorLevels.Props) : null,
            far: p.color,
            atomColors: p.atomColors,
          };
        }
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

  /**
   * Wraps a mesh, a compartment's membrane or a sphere with lipid tiles (progress/2026-11-08-lipid-tiles.md): a lipid
   * membrane object, one history step. WebGPU only: on WebGL2 the object is made and the status line says it is not
   * drawn.
   */
  readonly wrapMembrane = this.operation({
    id: 'mesoscale.wrapMembrane',
    title: 'Wrap with lipids',
    params: {
      mesh: PD.Text('', { description: 'A mesh by state ref (a shape opened from OBJ, PLY, VTP)' }),
      meshes: PD.Text('', {
        description:
          'Meshes by state ref, comma-separated, wrapped as one membrane by the cutter (a cell’s membranes: one budget, inner ones hidden while the eye is outside): over `mesh` and `method`',
      }),
      compartment: PD.Text('', {
        description:
          'A compartment of a particle list by its dotted path (root.exosome): a sphere fitted to its particles',
      }),
      particles: ListParam(),
      radius: PD.Numeric(
        0,
        { min: 0, max: 100000, step: 10 },
        { description: 'A sphere of this radius, Å (no mesh, no compartment)' },
      ),
      patch: PD.Text('synthetic', { description: 'The lipid patch by name: synthetic, or the name of `patchPdb`' }),
      patchPdb: PD.Text('', { description: "A bilayer patch's PDB text (CHARMM-GUI's), registered under `patch`" }),
      patchUrl: PD.Text('', {
        description:
          "A bilayer patch's PDB by URL, fetched once and registered under `patch` (the app's CHARMM-GUI patch)",
      }),
      edge: PD.Numeric(
        0,
        { min: 0, max: 400, step: 10 },
        { description: 'The tiles’ edge, Å (0: suited to the surface, about a thirtieth of its size, 40–200 Å)' },
      ),
      leaflets: PD.Select('both', [
        ['both', 'Both'],
        ['outer', 'Outer'],
        ['inner', 'Inner'],
      ] as const),
      method: PD.Select('tiles', [
        ['tiles', 'Tiles: matched-edge tiles on a remesh'],
        ['cutter', 'Cutter: cellPACKgpu’s, the patch cut on each of the mesh’s own triangles'],
      ] as const),
    },
    async run(
      { mesh, meshes, compartment, particles, radius, patch, patchPdb, patchUrl, edge, leaflets, method },
      ctx,
    ) {
      // round 6: many meshes as one membrane (Wrap all with lipids: one step), cut by the cutter
      const parts = meshes
        .split(',')
        .map((r: string) => r.trim())
        .filter((r: string) => r);
      for (const ref of parts) {
        if (!ctx.plugin.state.data.cells.has(ref)) return ApiResult.fail('not-found', `No mesh ${ref} in the scene.`);
      }
      if (parts.length > 0) method = 'cutter';
      if (patchPdb) registerLipidPatch(patch, patchPdb);
      else if (patchUrl && !hasLipidPatch(patch)) {
        // a static file, fetched on the first wrap (never in the start bundle)
        const response = await fetch(patchUrl);
        if (!response.ok)
          return ApiResult.fail('failed', `The lipid patch ${patchUrl} did not load (${response.status}).`);
        registerLipidPatch(patch, await response.text());
      }
      let center = Vec3.zero();
      let r = radius || 500;
      if (compartment) {
        const l = oneList(ctx, particles || undefined);
        if (isFailure(l)) return l;
        const data = dataOf(l);
        if (!data) return ApiResult.fail('not-found', 'The particle list is not loaded yet.');
        const fit = compartmentSphere(data, compartment);
        if (!fit) return ApiResult.fail('not-found', `No particle is in compartment ${compartment}.`);
        center = fit.center;
        r = fit.radius;
      } else if (mesh && !ctx.plugin.state.data.cells.has(mesh)) {
        return ApiResult.fail('not-found', `No mesh ${mesh} in the scene.`);
      }
      const b = ctx.plugin.state.data.build();
      const node = b.toRoot().apply(
        LipidMembrane,
        {
          ...PD.getDefaultValues(LipidMembraneParams),
          mesh,
          meshes: parts,
          center,
          radius: r,
          patch,
          edge,
          leaflets,
          method,
        },
        // removed with its mesh (moving the mesh does not move it yet: TODO.md)
        parts.length > 0 ? { dependsOn: parts } : mesh ? { dependsOn: [mesh] } : undefined,
      );
      // a failed transform (an unknown patch, a ref that is not a mesh) leaves no cell and no step: reverted, its error
      // read as it happened
      let error: string | undefined;
      const sub = ctx.plugin.state.data.events.cell.stateUpdated.subscribe((e) => {
        if (e.ref === node.ref && e.cell.status === 'error') error = e.cell.errorText;
      });
      try {
        await b.commit({ revertOnError: true });
      } finally {
        sub.unsubscribe();
      }
      const cell = ctx.plugin.state.data.cells.get(node.ref);
      if (error !== undefined || !cell || cell.status !== 'ok') {
        return ApiResult.fail(
          'failed',
          `No lipid membrane was made: ${error ?? cell?.errorText ?? 'its cell was not made'}`,
        );
      }
      // the mesh hidden under its membrane, as cellPACKgpu shows it (its eye shows it again)
      for (const ref of parts.length > 0 ? parts : mesh ? [mesh] : []) {
        ctx.plugin.state.data.updateCellState(ref, { isHidden: true });
      }
      const drawn = canDrawLipidMembranes(ctx.plugin);
      return ApiResult.ok(
        `Wrapped ${parts.length > 0 ? `${parts.length} meshes as one membrane` : mesh ? 'the mesh' : compartment || `a sphere of ${Math.round(r)} Å`} with lipids${drawn ? '' : ' (not drawn: WebGPU only)'}.`,
        { nodes: [node.ref] },
      );
    },
  });

  /** A lipid membrane's levels (`detail`, and with `custom` its `levels`), following the state while watched: a read for views */
  membraneDetailState(membrane: string): ReadonlyState<
    | {
        detail: MembraneDetail;
        levels: readonly MembraneLevel[];
        method: LipidMembraneProps['method'];
        far: MembraneFar;
        atomsPx: number;
        spheresPx: number;
        budget: number;
      }
    | undefined
  > {
    const plugin = this.ctx.plugin;
    return watchedState(
      () => {
        const cell = plugin.state.data.cells.get(membrane);
        if (cell?.transform.transformer !== LipidMembrane) return undefined;
        const { detail, levels, method, far, atomsPx, spheresPx, budget } = cell.transform.params as LipidMembraneProps;
        return { detail, levels, method, far, atomsPx, spheresPx, budget };
      },
      () => plugin.state.data.events.changed,
      { compare: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
    );
  }

  /**
   * A lipid membrane's levels of detail (Ludo, 2026-11-08: he tunes them to set the defaults): a preset by size on
   * screen, or custom levels by distance (each its start, stride and bias, `membraneLevels`). One step; the membrane is
   * drawn again, never cut, baked or remeshed again.
   */
  readonly membraneDetail = this.operation({
    id: 'mesoscale.membraneDetail',
    title: 'Set a lipid membrane’s levels of detail',
    params: {
      membrane: PD.Text('', { description: 'The lipid membrane by state ref' }),
      detail: OptionalParam(PD.Select<MembraneDetail>('balanced', LipidMembraneReprParams.detail.options)),
      levels: OptionalParam(
        PD.Value<readonly MembraneLevel[]>([], {
          description: 'Custom levels (detail: custom), at most 4: { distance (Å from the camera), stride, bias }',
        }),
      ),
      // made per view (the cutter; lipid-procedural): the far look and its switches
      far: OptionalParam(PD.Select<MembraneFar>('both', LipidMembraneReprParams.far.options)),
      atomsPx: OptionalParam(
        PD.Numeric(2, { min: 0.25, max: 16 }, { description: 'Texture: lipids from this size, px' }),
      ),
      spheresPx: OptionalParam(
        PD.Numeric(0.5, { min: 0.05, max: 8 }, { description: 'Spheres: lipids down to this size, px' }),
      ),
      budget: OptionalParam(PD.Numeric(2_000_000, { min: 10_000, max: 8_000_000 }, { description: 'Lipids at most' })),
    },
    async run(values, ctx) {
      const { membrane, detail, levels, ...view } = values as {
        membrane: string;
        detail?: MembraneDetail;
        levels?: readonly MembraneLevel[];
        far?: MembraneFar;
        atomsPx?: number;
        spheresPx?: number;
        budget?: number;
      };
      const ranges = { atomsPx: [0.25, 16], spheresPx: [0.05, 8], budget: [10_000, 8_000_000] } as const;
      for (const [k, [min, max]] of Object.entries(ranges)) {
        const v = view[k as keyof typeof ranges];
        if (v !== undefined && !(v >= min && v <= max)) {
          return ApiResult.fail('invalid', `${k}: from ${min} to ${max}.`);
        }
      }
      const cell = ctx.plugin.state.data.cells.get(membrane);
      if (cell?.transform.transformer !== LipidMembrane) {
        return ApiResult.fail('not-found', `No lipid membrane ${membrane} in the scene.`);
      }
      if (
        levels &&
        (levels.length < 1 ||
          levels.length > 4 ||
          levels[0].distance !== 0 ||
          levels.some((l, j) => !(l.stride >= 1) || !(l.bias > 0) || (j > 0 && !(l.distance > levels[j - 1].distance))))
      ) {
        return ApiResult.fail(
          'invalid',
          'levels: 1 to 4, the first from 0 Å, each a stride ≥ 1 and a bias > 0, their distances rising.',
        );
      }
      // tiles are built whole: no lipid dropped by its size on screen, so no Texture (round 4b item 5)
      if (
        view.far === 'texture' &&
        // by its params (review nit: an errored cut membrane has no data)
        (cell.transform.params as LipidMembraneProps).method !== 'cutter'
      ) {
        return ApiResult.fail('invalid', 'Texture needs a membrane made per view (the cutter): tiles are built whole.');
      }
      const old = cell.transform.params as LipidMembraneProps;
      const defined = Object.fromEntries(Object.entries(view).filter(([, v]) => v !== undefined));
      const next = { ...old, ...(detail ? { detail } : {}), ...(levels ? { levels } : {}), ...defined };
      if (JSON.stringify(next) === JSON.stringify(old)) return ApiResult.already('The membrane already draws so.');
      // a redraw that fails (past the device's buffers with more levels, a cancel) leaves the membrane as it was, no
      // step: reverted, its error read as it happened (as `wrapMembrane`; review M1)
      let error: string | undefined;
      const sub = ctx.plugin.state.data.events.cell.stateUpdated.subscribe((e) => {
        if (e.ref === membrane && e.cell.status === 'error') error = e.cell.errorText;
      });
      try {
        await ctx.plugin.state.data.build().to(cell).update(next).commit({ revertOnError: true });
      } finally {
        sub.unsubscribe();
      }
      const after = ctx.plugin.state.data.cells.get(membrane);
      if (error !== undefined || after?.status !== 'ok') {
        return ApiResult.fail(
          'failed',
          `The levels were not changed: ${error ?? after?.errorText ?? 'the membrane was not drawn'}`,
        );
      }
      return ApiResult.ok(`Levels: ${next.detail}.`, { nodes: [membrane] });
    },
  });

  /**
   * A lipid membrane's species as a particle system's entities (Ludo, 2026-11-08): one shown or hidden, its colour. One
   * step; drawn again, never cut again. The cutter's membranes generate no lipid of a hidden species, a tiles membrane
   * draws its tiles without them
   */
  readonly membraneSpecies = this.operation({
    id: 'mesoscale.membraneSpecies',
    title: 'Show, hide or color a lipid membrane’s species',
    params: {
      membrane: PD.Text('', { description: 'The lipid membrane by state ref' }),
      species: PD.Text('', { description: 'A species (residue name), as `mesoscale.membraneSpeciesState` lists them' }),
      shown: OptionalParam(PD.Boolean(true)),
      color: OptionalParam(PD.Color(Color(0xffffff))),
    },
    async run(values, ctx) {
      const { membrane, species, shown, color } = values as {
        membrane: string;
        species: string;
        shown?: boolean;
        color?: Color;
      };
      const cell = ctx.plugin.state.data.cells.get(membrane);
      if (cell?.transform.transformer !== LipidMembrane || !cell.obj) {
        return ApiResult.fail('not-found', `No lipid membrane ${membrane} in the scene.`);
      }
      const source = (cell.obj.data as { sourceData: MembraneData }).sourceData;
      // both methods (round 4b item 5): a tiles membrane hides a species' lipids out of its tiles
      const names = membraneSpecies(source);
      if (!names.includes(species)) {
        return ApiResult.fail(
          'not-found',
          `The membrane has no species ${species}.`,
          `Its species: ${names.join(', ')}.`,
        );
      }
      const hidden = new Set((cell.transform.params as LipidMembraneProps).hiddenSpecies);
      if (shown === true) hidden.delete(species);
      if (shown === false) hidden.add(species);
      const changed = await updateMembrane(ctx, cell, (old) => ({
        hiddenSpecies: names.filter((n) => hidden.has(n)),
        speciesColors: color === undefined ? old.speciesColors : withSpeciesColors(old, [species], () => color),
      }));
      if (!changed) return ApiResult.already(`${species} is already so.`);
      return ApiResult.ok(`${species}: ${hidden.has(species) ? 'hidden' : 'shown'}.`, { nodes: [membrane] });
    },
  });

  /**
   * A cut lipid membrane's full build (Ludo, 2026-11-08: "only do the full build at export time"): every triangle cut by
   * the TypeScript reference, its shown species, a STAR particle list (`lipids/export.ts`) a chunk of triangles at a
   * time, each chunk a Blob of its own (the strings let go as it goes); downloaded. No history step
   */
  readonly exportMembrane = this.operation({
    id: 'mesoscale.exportMembrane',
    title: 'Export a lipid membrane’s full build',
    params: {
      membrane: PD.Text('', { description: 'The lipid membrane by state ref' }),
      filename: OptionalParam(PD.Text('lipid-membrane.star')),
    },
    history: false,
    async run(values, ctx) {
      const { membrane, filename } = values as { membrane: string; filename?: string };
      const cell = ctx.plugin.state.data.cells.get(membrane);
      if (cell?.transform.transformer !== LipidMembrane || !cell.obj) {
        return ApiResult.fail('not-found', `No lipid membrane ${membrane} in the scene.`);
      }
      const data = (cell.obj.data as { sourceData: MembraneData }).sourceData;
      // the cutter's alone: a tiles membrane's cut parts are only its lost limbs (review M4)
      if (data.method !== 'cutter' || data.cut.length === 0) {
        return ApiResult.fail('invalid', 'Only a membrane cut by the cutter is exported (tiles are built whole).');
      }
      const hidden = new Set((cell.transform.params as LipidMembraneProps).hiddenSpecies);
      const parts: Blob[] = [];
      let rows = 0;
      await ctx.plugin.runTask(
        Task.create('Exporting lipids', async (runtime) => {
          let k = 0;
          const hiddenParts = new Set((cell.transform.params as LipidMembraneProps).hiddenParts);
          for (const chunk of membraneStar(data, hidden, 256, hiddenParts)) {
            parts.push(new Blob([chunk]));
            if (k++ > 0) rows += chunk.split('\n').length - 1;
            if (runtime.shouldUpdate) await runtime.update({ message: `${rows.toLocaleString()} lipids written` });
          }
        }),
      );
      const name = filename?.trim() || 'lipid-membrane.star';
      // a page downloads it (not a test's DOM, without object URLs)
      if (typeof document !== 'undefined' && typeof URL.createObjectURL === 'function')
        download(new Blob(parts, { type: 'text/plain' }), name);
      return ApiResult.ok(`Exported ${rows.toLocaleString()} lipids to ${name}.`);
    },
  });

  /** A lipid membrane's species, each shown or not and its colour override, following the state while watched */
  membraneSpeciesState(
    membrane: string,
  ): ReadonlyState<readonly { name: string; shown: boolean; color?: Color; shownColor: Color }[] | undefined> {
    const plugin = this.ctx.plugin;
    return watchedState(
      () => {
        const cell = plugin.state.data.cells.get(membrane);
        if (cell?.transform.transformer !== LipidMembrane || !cell.obj) return undefined;
        const p = cell.transform.params as LipidMembraneProps;
        const hidden = new Set(p.hiddenSpecies);
        const data = (cell.obj.data as { sourceData: MembraneData }).sourceData;
        const byDefault = membraneSpeciesColors(data);
        return membraneSpecies(data).map((name) => ({
          name,
          shown: !hidden.has(name),
          // the colour drawn: its override, else its default (review S5: the swatch was blank)
          shownColor: p.speciesColors[name] !== undefined ? Color(p.speciesColors[name]) : byDefault(name),
          ...(p.speciesColors[name] !== undefined ? { color: Color(p.speciesColors[name]) } : {}),
        }));
      },
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
      parts: OptionalParam(
        PD.Text('', {
          description:
            'A lipid membrane wrapping a cell’s meshes: its parts (membranes) by name, comma-separated (PM, MITO_IM); empty: every one. Instead of entities',
        }),
      ),
      particles: ListParam(),
    },
    async run(values, ctx) {
      const { visible, color, transparency, emissive, reset, particles, groupBy, parts } = values as typeof values & {
        groupBy?: MesoGroupBy;
        visible?: boolean;
        color?: string;
        transparency?: number;
        emissive?: number;
        parts?: string;
      };
      const membrane = membraneCell(ctx, particles.trim());
      if (parts !== undefined && !membrane) {
        return ApiResult.fail('invalid', 'Parts are a lipid membrane’s (a cell’s membranes): name the membrane.');
      }
      // a list's groups: a membrane has none (review N3: ignored, all its species were styled)
      if (membrane && values.group)
        return ApiResult.fail('invalid', 'A lipid membrane has no groups: name its species.');
      const parsed = color ? cssColor(color) : undefined;
      if (color && parsed === undefined) {
        return ApiResult.fail(
          'invalid',
          `'${color}' is not a color.`,
          'Give a color name (tomato), #rrggbb, rgb() or hsl().',
        );
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
      if (membrane) {
        // a membrane's species: shown or not, their colour (no opacity or glow: its spheres are merged by species)
        if (transparency !== undefined || emissive !== undefined) {
          return ApiResult.fail('invalid', 'A lipid membrane takes a color, visible or reset, not opacity or glow.');
        }
        if (parts !== undefined) {
          // a cell's membranes (round 7 item 2): each part shown or not (its lipids and surfaces), its colour; one step
          const chosen = membranePartsOf(membrane, parts);
          if (isFailure(chosen)) return chosen;
          const all = membranePartNames(membrane);
          const changed = await updateMembrane(ctx, membrane, (old) => {
            const hidden = new Set(old.hiddenParts);
            for (const p of chosen) {
              if (reset || visible === true) hidden.delete(p);
              else if (visible === false) hidden.add(p);
            }
            return {
              hiddenParts: all.filter((n) => hidden.has(n)),
              partColors: withPartColors(old, chosen, (p) =>
                reset
                  ? null
                  : parsed !== undefined
                    ? parsed
                    : old.partColors[p] !== undefined
                      ? Color(old.partColors[p])
                      : null,
              ),
            };
          });
          if (!changed) return ApiResult.already('They already look so.');
          return ApiResult.ok(`${reset ? 'Reset' : 'Styled'} ${chosen.join(', ')} of the membrane.`, {
            nodes: [membrane.transform.ref],
          });
        }
        const names = membraneSpecies((membrane.obj!.data as { sourceData: MembraneData }).sourceData);
        const species = membraneEntities(names, values.entities);
        if (isFailure(species)) return species;
        const changed = await updateMembrane(ctx, membrane, (old) => {
          const hidden = new Set(old.hiddenSpecies);
          for (const s of species) {
            if (reset || visible === true) hidden.delete(s);
            else if (visible === false) hidden.add(s);
          }
          return {
            hiddenSpecies: names.filter((n) => hidden.has(n)),
            color: objectColor(old, species.length === names.length, reset ? null : parsed),
            speciesColors: withSpeciesColors(old, species, (s) =>
              reset
                ? null
                : parsed !== undefined
                  ? parsed
                  : old.speciesColors[s] !== undefined
                    ? Color(old.speciesColors[s])
                    : null,
            ),
          };
        });
        if (!changed) return ApiResult.already('They already look so.');
        return ApiResult.ok(`${reset ? 'Reset' : 'Styled'} ${species.length} species of the membrane.`, {
          nodes: [membrane.transform.ref],
        });
      }
      const l = oneList(ctx, particles || undefined);
      if (isFailure(l)) return l;
      const ids = selectEntities(ctx, l, values.entities, values.group, groupBy);
      if (isFailure(ids)) return ids;
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
      parts: OptionalParam(
        PD.Text('', {
          description:
            'A lipid membrane wrapping a cell’s meshes: its parts (membranes) by name, comma-separated; empty: every one. Instead of entities',
        }),
      ),
      particles: ListParam(),
    },
    async run(values, ctx) {
      const { scheme, groupBy, variability, shift, color, entities, group, particles } = values;
      const { parts } = values as { parts?: string };
      const uniform = scheme === 'uniform' ? cssColor(color) : undefined;
      if (scheme === 'uniform' && uniform === undefined) {
        return ApiResult.fail(
          'invalid',
          `'${color}' is not a color.`,
          'Give a color name (tomato), #rrggbb, rgb() or hsl().',
        );
      }
      const membrane = membraneCell(ctx, particles.trim());
      if (membrane && group) return ApiResult.fail('invalid', 'A lipid membrane has no groups: name its species.');
      if (parts !== undefined && !membrane) {
        return ApiResult.fail('invalid', 'Parts are a lipid membrane’s (a cell’s membranes): name the membrane.');
      }
      if (membrane && parts !== undefined) {
        // a cell's membranes (round 7 item 2): a colour a part, generated (a hue each), one, or the membrane's again
        const chosen = membranePartsOf(membrane, parts);
        if (isFailure(chosen)) return chosen;
        const root = { path: '', label: '', groups: [], entities: chosen.map((_, i) => i) };
        const generated = scheme === 'generate' ? generateColors(root, variability, shift) : undefined;
        const index = new Map(chosen.map((p, i) => [p, i]));
        const changed = await updateMembrane(ctx, membrane, (old) => ({
          partColors: withPartColors(old, chosen, (p) =>
            scheme === 'theme' ? null : (uniform ?? generated!.get(index.get(p)!)!),
          ),
        }));
        if (!changed) return ApiResult.already('They are already colored so.');
        return ApiResult.ok(`Colored ${chosen.join(', ')} of the membrane (${scheme}).`, {
          nodes: [membrane.transform.ref],
        });
      }
      if (membrane) {
        // a membrane's species: one colour, generated around a hue (one group), or their default (the theme's)
        const names = membraneSpecies((membrane.obj!.data as { sourceData: MembraneData }).sourceData);
        const species = membraneEntities(names, entities);
        if (isFailure(species)) return species;
        const root = { path: '', label: '', groups: [], entities: species.map((_, i) => i) };
        const generated = scheme === 'generate' ? generateColors(root, variability, shift) : undefined;
        const index = new Map(species.map((s, i) => [s, i]));
        const changed = await updateMembrane(ctx, membrane, (old) => ({
          color: objectColor(old, species.length === names.length, scheme === 'theme' ? null : uniform),
          speciesColors: withSpeciesColors(old, species, (s) =>
            scheme === 'theme' ? null : (uniform ?? generated!.get(index.get(s)!)!),
          ),
        }));
        if (!changed) return ApiResult.already('They are already colored so.');
        return ApiResult.ok(`Colored ${species.length} species of the membrane (${scheme}).`, {
          nodes: [membrane.transform.ref],
        });
      }
      const l = oneList(ctx, particles || undefined);
      if (isFailure(l)) return l;
      const ids = selectEntities(ctx, l, entities, group);
      if (isFailure(ids)) return ids;
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

  /**
   * Colors that follow the zoom (`color-levels.md`; apps/prism-me/_spec/ui.md §4 Look): a particle list's structure
   * targets colored by the size on screen of their atoms, the far color (a compartment's with Particle Hierarchy), the
   * entity's, the chain's, the atom's; an edge given turns them on. Every representation of the list(s), one step
   */
  readonly colorLevels = this.operation({
    id: 'mesoscale.colorLevels',
    title: 'Colors that follow the zoom',
    params: {
      on: OptionalParam(PD.Boolean(true, { description: 'On or off; an edge given turns them on' })),
      entity: OptionalParam(ColorLevels.Params.entity),
      chain: OptionalParam(ColorLevels.Params.chain),
      atom: OptionalParam(ColorLevels.Params.atom),
      band: OptionalParam(ColorLevels.Params.band),
      chainHue: OptionalParam(ColorLevels.Params.chainHue),
      // a lipid membrane's (round 7 item 6): its far colour alone, its species' and atoms' kept (`mesoscale.style`'s
      // one colour sets them all)
      far: OptionalParam(PD.Text('', { description: 'A lipid membrane’s far colour alone (a CSS color)' })),
      atoms: OptionalParam(LipidMembraneReprParams.atomColors),
      particles: PD.Text('', { description: 'A particle list (a model) by label or state ref; empty: every one' }),
    },
    async run(values, ctx) {
      const { on, particles, far, atoms, ...given } = values as {
        on?: boolean;
        particles: string;
        far?: string;
        atoms?: MembraneAtomColors;
      } & Partial<ColorLevels.Props>;
      const edges = Object.fromEntries(Object.entries(given).filter(([, x]) => x !== undefined));
      if (on === undefined && !Object.keys(edges).length && far === undefined && atoms === undefined) {
        return ApiResult.fail('invalid', 'Nothing to change.', 'Give on, or an edge (entity, chain, atom).');
      }
      const membrane = membraneCell(ctx, particles.trim());
      if ((far !== undefined || atoms !== undefined) && !membrane) {
        return ApiResult.fail(
          'invalid',
          'A far colour alone and the atoms’ colours are a lipid membrane’s: name the membrane.',
        );
      }
      if (membrane) {
        // a membrane's: far its colour, then its species' (its chain's the same), close its atoms' by element
        const farColor = far === undefined ? undefined : cssColor(far);
        if (far !== undefined && farColor === undefined) {
          return ApiResult.fail(
            'invalid',
            `'${far}' is not a color.`,
            'Give a color name (tomato), #rrggbb, rgb() or hsl().',
          );
        }
        const old = (membrane.transform.params as LipidMembraneProps).colorLevels;
        // the levels as they are where only a colour is given
        const levelsGiven = on !== undefined || Object.keys(edges).length > 0;
        const was = old.name === 'on' ? (old.params as ColorLevels.Props) : ColorLevels.defaults;
        const levels = { ...was, ...edges } as ColorLevels.Props;
        if (levelsGiven && (levels.entity >= levels.chain || levels.chain >= levels.atom)) {
          return ApiResult.fail('invalid', 'The edges go entity < chain < atom.', 'Nothing was changed.');
        }
        const colorLevels =
          on === false ? { name: 'off' as const, params: {} } : { name: 'on' as const, params: levels };
        const changed = await updateMembrane(ctx, membrane, () => ({
          ...(levelsGiven ? { colorLevels } : {}),
          ...(farColor !== undefined ? { color: farColor } : {}),
          ...(atoms !== undefined ? { atomColors: atoms } : {}),
        }));
        if (!changed) return ApiResult.already('The colors already follow the zoom so.');
        const said = !levelsGiven
          ? 'Its colours by zoom set.'
          : on === false
            ? 'Colors no longer follow the zoom.'
            : 'Colors follow the zoom.';
        return ApiResult.ok(said, { nodes: [membrane.transform.ref] });
      }
      const one = particles.trim() ? oneList(ctx, particles) : undefined;
      if (isFailure(one)) return one;
      const reps = (one ? [one] : lists(ctx))
        .flatMap((l) => l.representations.map((r) => r.cell))
        .filter(
          (r) => !!(r.transform.params as { type?: { params?: { structure?: object } } }).type?.params?.structure,
        );
      if (!reps.length) {
        return ApiResult.fail('not-found', 'No particles are drawn by their structures.', 'Show a model as targets.');
      }
      // a list drawn in one color (the uniform theme) has no texture for the levels to follow: its color is kept as a
      // Look color on the texture theme, as `mesoscale.theme` does (color-levels.md), after the levels are on
      const uniform: [string, Color][] = [];
      const drawn = new Set(reps);
      if (on !== false) {
        for (const l of one ? [one] : lists(ctx)) {
          for (const r of l.representations) {
            const t = (r.cell.transform.params as { colorTheme?: { name: string; params: { value?: Color } } })
              .colorTheme;
            if (t?.name === 'uniform' && t.params.value !== undefined && drawn.has(r.cell)) {
              uniform.push([l.cell.transform.ref, t.params.value]);
              break;
            }
          }
        }
      }
      const b = ctx.plugin.state.data.build();
      const nodes: string[] = [];
      for (const r of reps) {
        const old = r.transform.params as { type: ParticleType };
        const next = { ...old, type: withColorLevels(old.type, on ?? true, edges) };
        const levels = next.type.params.structure.colorLevels?.params as Partial<ColorLevels.Props>;
        if (levels.entity! >= levels.chain! || levels.chain! >= levels.atom!) {
          return ApiResult.fail('invalid', 'The edges go entity < chain < atom.', 'Nothing was changed.');
        }
        if (JSON.stringify(next) === JSON.stringify(old)) continue;
        b.to(r).update(next);
        nodes.push(r.transform.ref);
      }
      if (!nodes.length && !uniform.length) return ApiResult.already('The colors already follow the zoom so.');
      if (nodes.length) await b.commit();
      if (on === false) return ApiResult.ok('Colors no longer follow the zoom.', { nodes });
      for (const [ref, value] of uniform) {
        const r = await ctx.api.run('mesoscale.theme', {
          objects: [ref],
          theme: 'uniform',
          color: Color.toHexStyle(value),
        });
        if (!r.ok) return r;
      }
      // a Look color is an overpaint: while By zoom is on it holds until the atoms (color-levels.md)
      const painted = (one ? [one] : lists(ctx)).some((l) => !!clearedColors(ctx, l));
      const note = painted ? ' A color set in Look is that color until the atoms, and By zoom stays on.' : '';
      return ApiResult.ok(`Colors follow the zoom.${note}`, { nodes });
    },
  });

  readonly example = this.operation({
    id: 'mesoscale.example',
    title: 'Open a mesoscale example',
    params: {
      // CellPack Exosome first in the form (Ludo, 2026-11-04)
      id: PD.Select<MesoscaleExampleId>(
        'cellpack-exosome',
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
      // a lipid membrane (a particle system, Ludo 2026-11-08): the mode its levels' preset
      const membrane = object ? ctx.plugin.state.data.cells.get(object) : undefined;
      if (membrane?.transform.transformer === LipidMembrane) {
        const old = membrane.transform.params as LipidMembraneProps;
        const detail: MembraneDetail = mode === 'ultra' ? 'off' : mode;
        if (old.detail === detail) return ApiResult.already(`The membrane already draws at ${mode}.`);
        await ctx.plugin.state.data
          .build()
          .to(membrane)
          .update({ ...old, detail })
          .commit({ revertOnError: true });
        return ApiResult.ok(`Graphics: ${mode}.`, { nodes: [membrane.transform.ref] });
      }
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
   * by object or one color. By zoom, once on, stays on for every later theme. A uniform color while it is on (or By
   * object) is written as Look colors on the texture theme, so that color holds until the atoms. Everything is planned
   * before a change, so a theme an object does not take changes nothing; then one change: the representations' themes
   * in one commit, the structures' own colors (their overpaint) cleared in one `representation.reset` (when every
   * structure is given), every list's look colors cleared, generated or painted in one `particles.look`, every mesh in
   * one `cryoet.mesh`, in one data transaction.
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
      groupBy: PD.Value<Record<string, MesoGroupBy>>(
        {},
        { description: "Generate colors: a model's grouping by its ref (its default when absent)" },
      ),
    },
    async run({ objects: refs, theme, color, groupBy }, ctx) {
      if (!refs.length) return ApiResult.fail('invalid', 'Which objects?', 'Give their state refs.');
      const one = theme === 'uniform' ? cssColor(color) : undefined;
      if (theme === 'uniform' && one === undefined) {
        return ApiResult.fail(
          'invalid',
          `'${color}' is not a color.`,
          'Give a color name (tomato), #rrggbb, rgb() or hsl().',
        );
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
          if (theme === 'generate' || theme === 'zoom') return doesNotTake(o.name, label);
          const name = theme === 'entity' ? 'entity-id' : theme === 'chain' ? 'chain-id' : 'uniform';
          plans.push({ kind: 'reps', o, theme: named(name, name === 'uniform' ? { value: mine } : {}) });
        } else if (o.kind === 'particles') {
          if (theme === 'chain') return doesNotTake(o.name, label);
          const data = particleData(o.cell, o.representations);
          const entities = !!data?.entityInfo?.size;
          const list = lists.get(o.cell.transform.ref);
          if (theme === 'zoom') {
            // compartment (Particle Hierarchy: compartments and entities per particle), else entity (Particle Entity:
            // entities per particle, PetWorld's), then chain and atom by size on screen
            const hierarchy = !!data?.entities && !!data.compartments;
            // drawn as targets (a structure group in its params): a spacefill has no atoms to color
            const targets = o.representations.some(
              (r) => !!(r.transform.params as { type?: Partial<ParticleType> }).type?.params?.structure,
            );
            if (!data?.entities || !targets) return doesNotTake(o.name, label);
            const look = list ? clearedColors(ctx, list) : undefined;
            const theme = named(hierarchy ? 'particle-hierarchy' : 'particle-entity');
            plans.push({ kind: 'reps', o, theme, levels: true, look });
            continue;
          }
          if (theme === 'generate' && entities && data) {
            // the colors `mesoscale.colors` generates, by the model's grouping (the tree's when given)
            const by = groupBy[o.cell.transform.ref] ?? defaultGroupBy(data);
            const colors = generateColors(mesoGroups(data, mesoEntities(data), by));
            plans.push({
              kind: 'look',
              o,
              look: [...colors].map(([id, c]) => ({ selector: { entities: [id] }, color: c })),
            });
            continue;
          }
          const byEntity = theme === 'entity' && entities;
          if ((theme === 'entity' || theme === 'generate') && !entities) fallbacks.push(o.name);
          // By zoom stays on. A single color would be a uniform theme, which has no texture for the ladder, so it is
          // a Look color on the texture theme already in use (color-levels.md): that color until the atoms.
          if (!byEntity && data && particleLevelsOn(o)) {
            const hierarchy = !!data.entities && !!data.compartments;
            plans.push({
              kind: 'reps',
              o,
              theme: named(hierarchy ? 'particle-hierarchy' : 'particle-entity'),
              keepTheme: true,
              look: oneColor(data, mine),
            });
            continue;
          }
          plans.push({
            kind: 'reps',
            o,
            theme: byEntity ? named('particle-entity') : named('uniform', { value: mine }),
            // look colors paint over a theme: cleared, whether set by entity or (a plain list) by target
            look: list ? clearedColors(ctx, list) : undefined,
          });
        } else {
          if (theme !== 'object' && theme !== 'uniform') return doesNotTake(o.name, label);
          plans.push({ kind: 'reps', o, theme: named('uniform', { value: mine }), only: 'isosurface' });
        }
      }
      // each representation's theme, planned too: an object with none it can take has nothing to color (a volume's
      // slices show the data; a list not drawn), said rather than "already so"
      const writes: { o: GraphicsObject; r: StateObjectCell; next: object; same: boolean }[] = [];
      const nothing: string[] = [];
      for (const p of plans) {
        if (p.kind !== 'reps') continue;
        let any = false;
        for (const r of p.o.representations) {
          const params = r.transform.params as { type?: { name?: string }; colorTheme?: { name: string } };
          if (p.only && params.type?.name !== p.only) continue;
          const currentTheme = params.colorTheme as { name: string; params: Record<string, unknown> } | undefined;
          const colorTheme =
            p.keepTheme && currentTheme && currentTheme.name !== 'uniform'
              ? currentTheme
              : themeFor(ctx, p.o, r, p.theme);
          if (!colorTheme) continue;
          any = true;
          // By zoom turns the levels on. Already on, they stay on (Ludo, 2026-11-04). Off is left off.
          const turnOn = !!p.levels || levelsAreOn(params.type);
          const next = {
            ...params,
            colorTheme,
            ...(p.o.kind === 'particles' && turnOn ? { type: withColorLevels(params.type, true) } : {}),
          };
          writes.push({ o: p.o, r, next, same: JSON.stringify(params) === JSON.stringify(next) });
        }
        if (!any) nothing.push(p.o.name);
      }
      const none = nothing.length ? `${nothing.join(', ')}: nothing to color` : '';
      if (nothing.length === plans.length) {
        return ApiResult.fail('not-found', `${none} (a volume's slices show the data; a list needs a representation).`);
      }
      // one change (bulk is one change): the representations' themes in one commit, every list's look colors in one
      // `particles.look` (their one writer: cleared, or generated), every mesh's color in one `cryoet.mesh`, in one data
      // transaction (the managers' work done once; restored if any part fails, undo checkpoints on or off)
      const b = ctx.plugin.state.data.build();
      const nodes: string[] = [];
      const changed = new Set<string>();
      for (const w of writes) {
        if (w.same) continue;
        b.to(w.r).update(w.next);
        nodes.push(w.r.transform.ref);
        changed.add(w.o.cell.transform.ref);
      }
      const looks = plans.flatMap((p) =>
        (p.kind === 'reps' || p.kind === 'look') && p.look?.length
          ? [{ particles: p.o.cell.transform.ref, layers: p.look }]
          : [],
      );
      const meshes = plans.flatMap((p) =>
        p.kind === 'mesh' ? [{ mesh: p.ref, color: Color.toHexStyle(p.color) }] : [],
      );
      const structures = plans.flatMap((p) =>
        p.kind === 'reps' && p.o.kind === 'structure' ? [p.o.cell.transform.ref] : [],
      );
      const given = new Set(structures);
      const loaded = ctx.plugin.managers.structure.hierarchy.current.structures;
      const everyStructure = structures.length > 0 && loaded.every((s) => given.has(s.cell.transform.ref));
      // the list a representation's ref is of (a look's change, said by its representations)
      const listOf = new Map(
        [...lists.values()].flatMap((l) => l.representations.map((r) => [r.cell.transform.ref, l.cell.transform.ref])),
      );
      try {
        await ctx.plugin.dataTransaction(
          async () => {
            if (nodes.length) await b.commit();
            // a structure's own colors (its row's brush: an overpaint) paint over a theme: cleared by their owner,
            // `representation.reset`, once for every structure when all are colored (a category's), else one each
            for (const structure of everyStructure ? [''] : structures) {
              const r = await ctx.api.run('representation.reset', { layer: 'color', structure });
              if (!r.ok) throw new Rollback(r);
              if (!r.unchanged) {
                nodes.push(...(r.changed.nodes ?? []));
                for (const s of structure ? [structure] : structures) changed.add(s);
              }
            }
            if (looks.length) {
              const r = await ctx.api.run('particles.look', { lists: looks });
              if (!r.ok) throw new Rollback(r);
              if (!r.unchanged) {
                for (const ref of r.changed.nodes ?? []) {
                  nodes.push(ref);
                  changed.add(listOf.get(ref) ?? ref);
                }
              }
            }
            if (meshes.length) {
              const r = await ctx.api.run('cryoet.mesh', { colors: meshes });
              if (!r.ok) throw new Rollback(r);
              if (!r.unchanged) {
                for (const m of meshes) changed.add(m.mesh);
                nodes.push(...(r.changed.nodes ?? []));
              }
            }
          },
          { rethrowErrors: true },
        );
      } catch (e) {
        // a part failed: the transaction put the state back; its failure is the run's
        if (e instanceof Rollback) return e.failure;
        throw e;
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
  ['zoom', 'By zoom'],
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
      /** Its look colors cleared (they paint over the theme), or one color while By zoom is on */
      readonly look?: readonly LookLayer[];
      /** Its colors following the zoom (`mesoscale.colorLevels`), with the theme */
      readonly levels?: boolean;
      /** Keep a texture theme already set; a uniform one takes `theme` (a uniform color while By zoom is on) */
      readonly keepTheme?: boolean;
    }
  /** A model's generated colors, its look (no theme of its own) */
  | { readonly kind: 'look'; readonly o: GraphicsObject; readonly look: readonly LookLayer[] }
  | { readonly kind: 'mesh'; readonly ref: string; readonly color: Color };

const doesNotTake = (name: string, theme: string) =>
  ApiResult.fail('invalid', `${name} cannot be colored ${theme.toLowerCase()}.`, 'Nothing was changed.');

/** The meshes' refs, as cryoet lists them (its read operation, by id); none without cryoet */
async function meshesOf(ctx: ApiContext): Promise<ReadonlySet<string>> {
  const r = await ctx.api.run('cryoet.meshes', {});
  const list = r.ok ? ((r as { value?: readonly { ref: string }[] }).value ?? []) : [];
  return new Set(list.map((m) => m.ref));
}

/** A layer of `particles.look`: a color for some entities or targets (null clears it) */
interface LookLayer {
  readonly selector: { readonly entities?: number[]; readonly targets?: number[] };
  readonly color: Color | null;
}

/** A failed part of a transaction: thrown so the transaction restores the state, returned as the run's failure */
class Rollback extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure.message);
  }
}

/** One Look color for every entity, or every target when the list has no entities (a uniform color while By zoom is on) */
function oneColor(data: ParticleList, color: Color): LookLayer[] {
  const byTarget = !data.entityInfo;
  return mesoEntities(data).map((e) => ({
    selector: byTarget ? { targets: [e.id] } : { entities: [e.id] },
    color,
  }));
}

/** Whether a particle representation's color levels are on */
function levelsAreOn(type: unknown): boolean {
  return (type as Partial<ParticleType> | undefined)?.params?.structure?.colorLevels?.name === 'on';
}

/** Whether any of a particle object's structure representations has the color levels on */
function particleLevelsOn(o: GraphicsObject): boolean {
  return o.representations.some((r) => levelsAreOn((r.transform.params as { type?: unknown }).type));
}

/** A list's look colors cleared (by entity, or by target on a list with no entities); none to clear: undefined */
function clearedColors(ctx: Pick<ApiContext, 'plugin'>, l: ParticleListRef): LookLayer[] | undefined {
  const byTarget = !dataOf(l)?.entityInfo;
  const layers: LookLayer[] = [];
  for (const [id, style] of readStyles(ctx, l)) {
    if (style.color === undefined) continue;
    layers.push({ selector: byTarget ? { targets: [id] } : { entities: [id] }, color: null });
  }
  return layers.length ? layers : undefined;
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
  // levels by size on screen, as the particle and mesoscale defaults (`screen-space-lod.md`): distances are ignored there
  if (kind !== 'volume' && 'lodLevels' in params) {
    const { lodLevels, lodPixelSize } = Spheres.LodPixelPresets[mode];
    next.lodLevels = lodLevels;
    next.lodPixelSize = lodPixelSize;
  }
  if (kind !== 'particles') next.quality = ModeSettings[mode].quality;
  if (kind === 'volume' && 'stepsPerCell' in params) next.stepsPerCell = ModeSettings[mode].stepsPerCell;
  return next;
}

/** Whether a representation's levels of detail are a mode's preset: its levels and its size on screen */
function isLodPreset(t: Record<string, unknown>, preset: { lodLevels: unknown; lodPixelSize: number }) {
  return JSON.stringify(t.lodLevels) === JSON.stringify(preset.lodLevels) && t.lodPixelSize === preset.lodPixelSize;
}

/**
 * An object's mode and motion as its representations have them, every one (a particle list's mode, every one with levels
 * of detail): a value they differ on is mixed, read as no mode and the motion off (a representation added later, or a
 * preset, has its own); a volume's mode only
 */
function graphicsOf(o: GraphicsObject): GraphicsInfo | undefined {
  const types = o.representations
    .map((r) => (r.transform.params as { type?: { params?: Record<string, unknown> } } | undefined)?.type?.params)
    .filter((t): t is Record<string, unknown> => !!t);
  if (!types.length) return undefined;
  // the one value every representation (of `among`) has, else undefined (mixed)
  const common = <T>(of: (t: Record<string, unknown>) => T, among = types): T | undefined => {
    if (!among.length) return undefined;
    const first = JSON.stringify(of(among[0]));
    return among.every((t) => JSON.stringify(of(t)) === first) ? of(among[0]) : undefined;
  };
  const modeOf = (t: Record<string, unknown>) =>
    o.kind === 'particles'
      ? GraphicsModes.find((m) => isLodPreset(t, Spheres.LodPixelPresets[m]))
      : GraphicsModes.find((m) => ModeSettings[m].quality === t.quality);
  // a particle list's mode is its levels of detail, read where they are (not on its fibers)
  const mode = common(modeOf, o.kind === 'particles' ? types.filter((t) => 'lodLevels' in t) : types);
  if (o.kind === 'volume') return mode ? { mode } : {};
  const levelsOf = (t: Record<string, unknown>) => {
    const levels = (t as Partial<ParticleType['params']>).structure?.colorLevels;
    return levels?.name === 'on' ? (levels.params as ColorLevels.Props) : null;
  };
  const colorLevels = common(
    levelsOf,
    types.filter((t) => 'structure' in t),
  );
  return {
    ...(mode ? { mode } : {}),
    ...(colorLevels !== undefined ? { colorLevels } : {}),
    wiggle: common((t) => findAnimation(t)?.wiggleAmplitude ?? 0) ?? 0,
    tumble: common((t) => findAnimation(t)?.tumbleAmplitude ?? 0) ?? 0,
  };
}

/** A particle representation's type params, as `mesoscale.colorLevels` reads and writes them */
type ParticleType = { params: { structure: { colorLevels?: { name: string; params: object } } } };

/**
 * A particle representation's `type` with its structure targets' color levels on (`edges` over its own, else the
 * defaults) or off; as given without a structure group (a spacefill)
 */
export function withColorLevels<T>(type: T, on: boolean, edges: Partial<ColorLevels.Props> = {}): T {
  const structure = (type as Partial<ParticleType> | undefined)?.params?.structure;
  if (!structure) return type;
  const old = structure.colorLevels;
  const params = { ...ColorLevels.defaults, ...(old?.name === 'on' ? old.params : {}), ...edges };
  const colorLevels = on ? { name: 'on', params } : { name: 'off', params: {} };
  const t = type as ParticleType;
  return { ...t, params: { ...t.params, structure: { ...structure, colorLevels } } } as T;
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

/**
 * Hosts the deployed list points some examples to, and the copy the explorer reads instead: Mol*'s CloudFront allows
 * https://molstar.org only (CORS), so a page anywhere else (localhost, the lab site) cannot read it; mesoscope.scripps.edu
 * holds the same files by name and allows any site (Ludo, 2026-11-03)
 */
const ExampleMirrors: readonly (readonly [RegExp, string])[] = [
  [/^https:\/\/d39ulgwcl2k1f0\.cloudfront\.net\/me\/[^/]+\//, 'https://mesoscope.scripps.edu/explorer/examples/'],
];

/** An example's address as the explorer reads it: absolute (the list's are relative to it), a mirror's where it has one */
export function exampleAddress(url: string, base: string): string {
  const href = new URL(url, base).href;
  const mirror = ExampleMirrors.find(([from]) => from.test(href));
  return mirror ? href.replace(mirror[0], mirror[1]) : href;
}

const examples = new Map<string, Promise<MesoscaleExample[]>>();

/** The examples, fetched once from the explorer's list; their addresses made absolute. A failed fetch is not kept */
export function mesoscaleExamples(base = ExamplesBase): Promise<MesoscaleExample[]> {
  const kept = examples.get(base);
  if (kept) return kept;
  const made = fetch(new URL('list.json', base))
    .then((r) => {
      if (!r.ok) throw new Error(`examples list: HTTP ${r.status}`);
      return r.json();
    })
    // the classic explorer's sessions (molx, molj) need its own transforms (its groups, its cellPACK assembly)
    .then((list: MesoscaleExample[]) =>
      list
        .filter((e) => e.type !== 'molx' && e.type !== 'molj')
        .map((e) => ({ ...e, url: exampleAddress(e.url, base) })),
    )
    .catch((): MesoscaleExample[] => {
      examples.delete(base);
      return [];
    });
  examples.set(base, made);
  return made;
}

// --- the particle lists -------------------------------------------------------------------------------------------

function lists(ctx: Pick<ApiContext, 'plugin'>): readonly ParticleListRef[] {
  return ctx.plugin.managers.particles.hierarchy.current.lists;
}

/**
 * A lipid membrane given where a particle list is (`particles`; round 4c item 8): coloured as a list, its species its
 * entities (prism-me AGENTS.md: particles for everything mesoscale)
 */
function membraneCell(ctx: Pick<ApiContext, 'plugin'>, ref: string) {
  const cell = ref ? ctx.plugin.state.data.cells.get(ref) : undefined;
  return cell?.transform.transformer === LipidMembrane && cell.obj ? cell : undefined;
}

/** A membrane's species named in `entities` (comma-separated; empty: every one), or a failure naming the unknown */
function membraneEntities(
  names: readonly string[],
  entities: string,
  what = 'species',
  plural = 'species',
): readonly string[] | ApiFailure {
  const asked = entities
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e);
  if (!asked.length) return names;
  const known = new Set(names);
  const unknown = asked.filter((e) => !known.has(e));
  if (unknown.length) {
    return ApiResult.fail(
      'not-found',
      `The membrane has no ${what} ${unknown.join(', ')}.`,
      `Its ${plural}: ${names.join(', ')}.`,
    );
  }
  return asked;
}

/** A cell membrane's parts (its membranes, round 6) by name; none for one surface */
function membranePartNames(cell: StateObjectCell) {
  const data = (cell.obj!.data as { sourceData: MembraneData }).sourceData;
  return data.parts?.map((p) => p.name) ?? [];
}

/**
 * A cell membrane's parts named in `parts` (comma-separated; empty: every one; round 7 item 2), or a failure: no parts,
 * an unknown name
 */
function membranePartsOf(cell: StateObjectCell, parts: string): readonly string[] | ApiFailure {
  const names = membranePartNames(cell);
  if (!names.length) return ApiResult.fail('invalid', 'The membrane is one surface: it has no parts.');
  return membraneEntities(names, parts, 'part', 'parts');
}

/** Part colours: those of `parts` set to `color` (null: back to the membrane's), the others kept */
function withPartColors(old: LipidMembraneProps, parts: readonly string[], color: (p: string) => Color | null) {
  const colors: Record<string, number> = { ...old.partColors };
  for (const p of parts) {
    const c = color(p);
    if (c === null) delete colors[p];
    else colors[p] = c;
  }
  return colors;
}

/**
 * A membrane's look patched in one step, every colour operation's and `membraneSpecies`' writer: drawn again, never cut
 * again; whether it changed
 */
async function updateMembrane(
  ctx: Pick<ApiContext, 'plugin'>,
  cell: StateObjectCell,
  patch: (old: LipidMembraneProps) => Partial<LipidMembraneProps>,
) {
  const old = cell.transform.params as LipidMembraneProps;
  const next = { ...old, ...patch(old) };
  if (JSON.stringify(next) === JSON.stringify(old)) return false;
  await ctx.plugin.state.data.build().to(cell).update(next).commit({ revertOnError: true });
  return true;
}

/**
 * A membrane's own colour (By zoom's far colour) as a list's Look colour on all of it (review S2): one colour given to
 * every species is its colour too; back to the theme (null) for every species, its default again; else kept
 */
function objectColor(old: LipidMembraneProps, all: boolean, color: Color | null | undefined): Color {
  if (!all || color === undefined) return old.color;
  return color ?? LipidMembraneReprParams.color.defaultValue;
}

/** Species colours: those of `species` set to `color` (null: back to their default), the others kept */
function withSpeciesColors(old: LipidMembraneProps, species: readonly string[], color: (s: string) => Color | null) {
  const colors: Record<string, number> = { ...old.speciesColors };
  for (const s of species) {
    const c = color(s);
    if (c === null) delete colors[s];
    else colors[s] = c;
  }
  return colors;
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
    // indexed once (a drag over many rows names many entities): by name, the first of a name, else by id
    const byName = new Map<string, MesoEntity>();
    for (const x of entities) if (!byName.has(x.name)) byName.set(x.name, x);
    for (const x of entities) if (!byName.has(String(x.id))) byName.set(String(x.id), x);
    const picked: number[] = [];
    for (const w of wanted) {
      const e = byName.get(w);
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
    const kept = new Set(picked);
    ids = ids ? ids.filter((id) => kept.has(id)) : picked;
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

/**
 * The sphere of a compartment's particles (its path and the compartments below it): their mean, and their mean
 * distance from it as the radius; one pass
 */
export function compartmentSphere(data: ParticleList, path: string) {
  const { compartments, compartmentInfo, coordinates, count } = data;
  if (!compartments || !compartmentInfo) return undefined;
  // its surface where it has one (the membrane's particles), else all of it
  const surface = `${path}.surface`;
  const within = (name: string, p: string) => name === p || name.startsWith(`${p}.`);
  let names = [...compartmentInfo].filter(([, info]) => within(info.name, surface));
  if (!names.length) names = [...compartmentInfo].filter(([, info]) => within(info.name, path));
  const inside = new Set(names.map(([id]) => id));
  const center = Vec3.zero();
  let n = 0;
  for (let i = 0; i < count; ++i) {
    if (!inside.has(compartments[i])) continue;
    center[0] += coordinates[i * 3];
    center[1] += coordinates[i * 3 + 1];
    center[2] += coordinates[i * 3 + 2];
    n += 1;
  }
  if (!n) return undefined;
  Vec3.scale(center, center, 1 / n);
  let radius = 0;
  for (let i = 0; i < count; ++i) {
    if (!inside.has(compartments[i])) continue;
    radius += Math.hypot(
      coordinates[i * 3] - center[0],
      coordinates[i * 3 + 1] - center[1],
      coordinates[i * 3 + 2] - center[2],
    );
  }
  return { center, radius: radius / n };
}
