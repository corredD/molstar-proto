/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Tensor, Vec3 } from '@molstar/core/math/linear-algebra';
import { type StateObjectCell, type StateObjectSelector, StateTransform } from '@molstar/core/state';
import { Color } from '@molstar/core/util/color';
import { ColorListOptionsScale } from '@molstar/core/util/color/lists';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import type { ParticleList, ParticleTarget } from '@molstar/model/model/particles/particle-list';
import { Grid, Volume } from '@molstar/model/model/volume';
import {
  particleTargetObjectCells,
  particleTargetSourceFromPdbIdOrUrl,
} from '@molstar/plugin/state/helpers/particle-targets';
import { createVolumeRepresentationParams } from '@molstar/plugin/state/helpers/volume-representation-params';
import type { ParticleListRef } from '@molstar/plugin/state/manager/particles/hierarchy-state';
import type { VolumeRef } from '@molstar/plugin/state/manager/volume/hierarchy-state';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import {
  ParticleListOffsets,
  type ParticleInstanceOffsetProps,
  type ParticleOffsetProps,
  ParticleListTargetsFromAttribute,
  ParticleListWithTargets,
} from '@molstar/plugin/state/transforms/particles/ops';
import {
  type ParticleLayerProps,
  ParticleRepresentation3DLayers,
} from '@molstar/plugin/state/transforms/particles/layers';
import { VolumeRepresentation3D } from '@molstar/plugin/state/transforms/volume/representation';
import { omeZarrLevelNeeds, VolumeFromOmeZarr } from '@molstar/plugin/state/formats/volume/ome-zarr';
import type { OmeZarrFormat } from '@molstar/model/formats/volume/ome-zarr';
import { Ccp4Format } from '@molstar/model/formats/volume/ccp4';
import { VolumeFromCcp4 } from '@molstar/plugin/state/formats/volume/ccp4';
import { gridText, volumeStats, voxelText } from '@molstar/prism-viewer/api/volume';
import { type ApiContext, ApiArea, type ApiFailure, ApiResult } from '@molstar/prism-viewer/api/area';
import { OptionalParam } from '@molstar/prism-viewer/api/params';
import { isFailure, labelOf as structureLabel, loadedStructures, pickOne } from '@molstar/prism-viewer/api/scope';
import { watchedState } from '@molstar/prism-viewer/sources/watched';
import { parseColor } from '@molstar/prism-ui/components/color/parse-color';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import { type ObliquePose, obliquePlane, obliquePoseOfPlane, type SlicePlane } from './oblique.js';
import { ObliqueHandles } from './oblique-handle.js';
import { mb } from './portal-run.js';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import { ButtonsType } from '@molstar/core/util/input/input-observer';
import { isEmptyLoci } from '@molstar/model/model/loci';

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
  /** What it is decorated with, as `objects` names it: an object's state ref, or a model entity's `target:<list>:<id>` */
  readonly object?: string;
  /** The entity it stands for, on a list with entities (a cellPACK or Simularium model) */
  readonly entity?: number;
  /** Shown: no layer of it alone hides it (its eye in the explorer's tree) */
  readonly visible: boolean;
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
  /**
   * What a target can be decorated with: the objects of the scene (by state ref), then the entities of the other
   * particle lists that have one (cellPACK, PetWorld: `target:<list ref>:<target id>`, grouped by their model)
   */
  readonly objects: readonly { readonly ref: string; readonly label: string; readonly group?: string }[];
}

export type SliceAxis = 'x' | 'y' | 'z';

/** One slice of a volume: its axis (one slice per axis), its index, its gray window */
export interface SliceView {
  readonly axis: SliceAxis;
  readonly index: number;
  /** ± this many σ about the mean (a window set so) */
  readonly contrast?: number;
  /** The state ref of its representation */
  readonly ref: string;
  readonly visible: boolean;
}

/** A volume's dimensions and its slices (x, y, z: at most one each) */
/** An oblique slice: a plane through the volume placed by its handle (its pose in the volume's frame) */
export interface ObliqueView extends ObliquePose {
  /** ± this many σ about the mean (a window set so) */
  readonly contrast?: number;
  /** The state ref of its representation */
  readonly ref: string;
  readonly visible: boolean;
}

export interface SliceInfo {
  readonly dimensions: readonly [number, number, number];
  readonly slices: readonly SliceView[];
  readonly obliques: readonly ObliqueView[];
  /** The volume's radius (Å): how far an oblique slice's point goes from its center */
  readonly radius: number;
}

/** One level of an OME-Zarr volume (a resolution it can be read at), as the Data section shows it */
export interface VolumeLevelView {
  /** Its path in the image ("0": the finest) */
  readonly path: string;
  /** Its binning against the finest level: 1, 2, 4… */
  readonly binning: number;
  /** Å per voxel (along x) */
  readonly spacing: number;
  readonly size: readonly [number, number, number];
  /** The bytes of its voxels, decoded */
  readonly bytes: number;
  /** Over the volume's size guard (its `maxSizeMB`): read only when asked again with `large` */
  readonly large: boolean;
  /** "4× · 27.2 Å · 24 MB" */
  readonly label: string;
}

/** What a volume's data is (its Data section): its source, grid, voxel and size; an OME-Zarr's levels */
export interface VolumeDataInfo {
  /** Its format (OME-ZARR, CCP4…) */
  readonly source: string;
  readonly grid: string;
  readonly voxel: string;
  /** The bytes of its voxels, decoded */
  readonly bytes: number;
  /** Its levels, coarsest to finest; empty: one resolution (an MRC map, a single-level OME-Zarr) */
  readonly levels: readonly VolumeLevelView[];
  /** The level read now (its path), when it has levels */
  readonly level?: string;
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
  /** The point and cell arrays it can be colored by (a VTP's), by key ("cell:Labels") */
  readonly arrays?: readonly MeshArray[];
  /** Its color by an array, when it is so colored */
  readonly colorBy?: MeshColorBy;
  /** Its scale (1: as in the file; a mesh in pixels: the pixel size, Å) */
  readonly scale: number;
}

/** A point or cell array of a mesh, by key ("point:Curvature") and as its color theme names it ("Point: Curvature") */
export interface MeshArray {
  readonly key: string;
  readonly label: string;
  /** Its values' range (a vector's: its length's), when the file is read */
  readonly range?: readonly [number, number];
}

/** A mesh colored by an array: its key, its color scale (a color list: viridis…), its range (auto: the array's) */
export interface MeshColorBy {
  readonly array: string;
  readonly colorList: string;
  readonly range: 'auto' | readonly [number, number];
}

/** The color scales an array is colored with (a color list's name: viridis, plasma…) */
export const MeshColorLists: readonly (readonly [string, string])[] = ColorListOptionsScale.map(([k, l]) => [k, l]);

const ListParam = () =>
  PD.Text('', { description: 'A particle list by label or state ref; empty: the only one loaded' });

export class CryoetApi extends ApiArea {
  readonly id = 'cryoet';

  /** An oblique slice's handle, once the views gave it the viewer's API (it runs `cryoet.oblique`) */
  obliqueHandles: ObliqueHandles | undefined;

  /** The oblique slice's handle, made with the viewer's API */
  useObliqueHandles(api: ViewerApi): ObliqueHandles {
    if (!this.obliqueHandles) {
      const handles = new ObliqueHandles(this.ctx.plugin, api);
      // a click on the background (not a drag's end) resets the view: the handle goes with it
      this.ctx.plugin.behaviors.interaction.click.subscribe((e) => {
        if (e.button === ButtonsType.Flag.Primary && isEmptyLoci(e.current.loci)) handles.hide();
      });
      this.obliqueHandles = handles;
    }
    return this.obliqueHandles;
  }

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

  /** The slices of a volume (by state ref), following the state tree while watched: a read for views */
  sliceState(volume: string): ReadonlyState<SliceInfo | undefined> {
    const plugin = this.ctx.plugin;
    return watchedState(
      () => {
        const v = oneVolume({ plugin }, volume || undefined);
        return isFailure(v) ? undefined : sliceOf({ plugin }, v);
      },
      () => plugin.state.data.events.changed,
      { compare: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
    );
  }

  /** What a volume's data is and its levels (by state ref), following the state tree while watched: a read for views */
  dataState(volume: string): ReadonlyState<VolumeDataInfo | undefined> {
    const plugin = this.ctx.plugin;
    return watchedState(
      () => {
        const v = oneVolume({ plugin }, volume || undefined);
        return isFailure(v) ? undefined : volumeDataOf(v);
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
      colors: OptionalParam(
        PD.Value<{ mesh: string; color: string }[]>([], {
          description: 'Several meshes, each its own color ({ mesh, color }), in one write (mesh and color left out)',
        }),
      ),
      scale: OptionalParam(
        PD.Numeric(
          1,
          { min: 0.01, max: 100, step: 0.01 },
          {
            description: 'Scales it about the origin: 1 as in the file; a mesh in pixels, the pixel size (Å)',
          },
        ),
      ),
      array: OptionalParam(
        PD.Text('', {
          description:
            'Colors it by a point or cell array of its file (a VTP): "cell:Labels", "point:Curvature", or a name',
        }),
      ),
      colorList: OptionalParam(
        PD.Text('', { description: "The color scale of its array's colors: viridis, plasma, red-white-blue…" }),
      ),
      range: OptionalParam(
        PD.Value<'auto' | [number, number]>('auto', {
          description: "The values its array's colors span: auto (the array's), or [min, max]",
        }),
      ),
    },
    async run(values, ctx) {
      const { mesh, visible, visuals, opacity, color, colors, scale, array, colorList, range } =
        values as typeof values & {
          scale?: number;
          visible?: boolean;
          visuals?: 'mesh' | 'wireframe' | 'both';
          opacity?: number;
          color?: string;
          colors?: { mesh: string; color: string }[];
          array?: string;
          colorList?: string;
          range?: 'auto' | [number, number];
        };
      const byArray = array !== undefined || colorList !== undefined || range !== undefined;
      if (byArray && (color !== undefined || colors !== undefined)) {
        return ApiResult.fail(
          'invalid',
          'A color or an array, not both.',
          'Give color for one color, array for an array.',
        );
      }
      if (colorList !== undefined && !MeshColorLists.some(([k]) => k === colorList)) {
        return ApiResult.fail(
          'invalid',
          `'${colorList}' is not a color scale.`,
          `Scales: ${MeshColorLists.map(([k]) => k).join(', ')}.`,
        );
      }
      if (
        range !== undefined &&
        range !== 'auto' &&
        !(Array.isArray(range) && range.length === 2 && range.every(Number.isFinite) && range[0] < range[1])
      ) {
        return ApiResult.fail('invalid', 'range: auto, or [min, max] with min under max.');
      }
      const all = meshes(ctx);
      // the meshes indexed once, by ref and by name (lowercased): an entry of `colors` found without a scan
      const byRef = new Map(all.map((m) => [m.ref, m]));
      const byName = new Map<string, MeshInfo[]>();
      for (const m of all) {
        const key = m.label.toLowerCase();
        const found = byName.get(key);
        if (found) found.push(m);
        else byName.set(key, [m]);
      }
      const find = (name: string): readonly MeshInfo[] => {
        const n = name.trim();
        if (!n) return all;
        const one = byRef.get(n);
        return one ? [one] : (byName.get(n.toLowerCase()) ?? []);
      };
      const missing = (name: string) =>
        ApiResult.fail(
          'not-found',
          all.length ? `There is no mesh '${name}'.` : 'No meshes are loaded.',
          all.length ? `Meshes: ${all.map((m) => m.label).join(', ')}.` : 'Open an OBJ, PLY or VTP file.',
        );
      const notColor = (c: string) => ApiResult.fail('invalid', `'${c}' is not a color.`, 'Give #rrggbb or a name.');
      // each mesh and its color: one given for all, or each its own (`colors`), all checked before the write
      const picked: (MeshInfo & { color?: number })[] = [];
      if (colors !== undefined) {
        if (!Array.isArray(colors) || mesh.trim() || color) {
          return ApiResult.fail('invalid', 'colors: a list of { mesh, color }, without mesh or color.');
        }
        for (const c of colors) {
          if (!c || typeof c.mesh !== 'string' || typeof c.color !== 'string' || !c.mesh.trim()) {
            return ApiResult.fail('invalid', 'colors: each entry a mesh (name or ref) and a color.');
          }
          const found = find(c.mesh);
          if (found.length > 1) {
            return ApiResult.fail(
              'ambiguous',
              `Which '${c.mesh}'? ${found.length} meshes have that name.`,
              `Give its state ref: ${found.map((m) => m.ref).join(', ')}.`,
            );
          }
          if (!found.length) return missing(c.mesh);
          const parsed = cssColor(c.color);
          if (parsed === undefined) return notColor(c.color);
          picked.push({ ...found[0], color: parsed });
        }
      } else {
        const parsed = color ? cssColor(color) : undefined;
        if (color && parsed === undefined) return notColor(color);
        for (const m of find(mesh)) picked.push({ ...m, color: parsed });
        if (!picked.length) return missing(mesh);
      }
      // each mesh's theme by an array, all checked before the write
      const themes = new Map<string, unknown>();
      if (byArray) {
        for (const m of picked) {
          const cell = ctx.plugin.state.data.cells.get(m.ref)!;
          const theme = arrayTheme(cell, { array, colorList, range });
          if (theme === 'none') {
            return ApiResult.fail(
              'invalid',
              `${m.label} has no arrays to color by.`,
              'A VTP with point or cell arrays has them; give its color.',
            );
          }
          if (typeof theme === 'string') {
            return ApiResult.fail('not-found', `${m.label} has no array '${array}'.`, `Arrays: ${theme}.`);
          }
          themes.set(m.ref, theme.value);
        }
      }
      const b = ctx.plugin.state.data.build();
      const nodes: string[] = [];
      for (const m of picked) {
        const cell = ctx.plugin.state.data.cells.get(m.ref)!;
        const old = cell.transform.params as any;
        const uniform = m.color !== undefined ? { name: 'uniform', params: { color: m.color } } : undefined;
        const next = {
          ...old,
          ...(visuals ? { visuals: visuals === 'both' ? ['mesh', 'wireframe'] : [visuals] } : {}),
          ...(opacity !== undefined ? { alpha: opacity } : {}),
          // an OBJ's and a PLY's color is their `coloring`, a VTP's its `colorTheme`
          ...(uniform && old.coloring ? { coloring: uniform } : {}),
          ...(uniform && old.colorTheme ? { colorTheme: uniform } : {}),
          ...(themes.has(m.ref) ? { colorTheme: themes.get(m.ref) } : {}),
        };
        if (JSON.stringify(next) !== JSON.stringify(old)) {
          b.to(cell).update(next);
          nodes.push(m.ref);
        }
        // the scale is the shape's: its instance transform (OBJ, PLY, VTP shapes have one)
        const shape = shapeCellOf(ctx, m.ref);
        if (scale !== undefined && shape && scale > 0 && Math.abs(scaleOf(shape) - scale) > 1e-6) {
          b.to(shape).update((p: any) => ({
            ...p,
            transforms: [Mat4.fromScaling(Mat4(), Vec3.create(scale, scale, scale))],
          }));
          nodes.push(shape.transform.ref);
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
        ['entity', 'An entity of a model (cellPACK, PetWorld)'],
        ['none', 'Nothing (spheres)'],
      ] as const),
      entity: PD.Text('', {
        description: 'An entity of another particle list: "mg.bcif › MG_001_MONOMER", or its name alone (with: entity)',
      }),
      object: PD.Text('', { description: 'An object of the scene by label or state ref (with: object)' }),
      id: PD.Text('', { description: 'A PDB id (1crn) or the URL of a structure, shape or volume (with: pdb)' }),
      targets: PD.Text('', {
        description: 'Target ids or names, comma-separated (0, Class 2); empty: every target of the list',
      }),
      particles: ListParam(),
    },
    async run({ with: kind, object, id, entity, targets, particles }, ctx) {
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
      } else if (kind === 'entity') {
        const e = pickEntity(ctx, l, entity);
        if (isFailure(e)) return e;
        const [, list, target] = /^target:(.+):(\d+)$/.exec(e.ref)!;
        source = { name: 'target', params: { list, target: Number(target) } };
        what = e.label;
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
      const wasDecorated = !!dataOf(ctx, l)?.targetMapping?.size;
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
      const shown = await ensureTargetRepresentation(ctx, l, wasDecorated);
      return ApiResult.ok(
        `Decorated ${ids.length === data.targetInfo.size ? 'every target' : `${ids.length} target${ids.length > 1 ? 's' : ''}`} of ${labelOf(l)} with ${what}.`,
        { nodes: [l.cell.transform.ref, ...shown] },
      );
    },
  });

  /** The offset of some targets (by their ids, '1,2'; '': every target), if any */
  offsetOf(particles: string, targets: string): { translation: number[]; euler: number[] } | undefined {
    const l = lists(this.ctx).find((x) => x.cell.transform.ref === particles);
    const cell = l && decoratorCell(this.ctx, l, ParticleListOffsets);
    const key = targetsKey(
      targets
        .split(',')
        .filter((t) => t.trim())
        .map(Number),
    );
    const o = ((cell?.transform.params?.offsets ?? []) as ParticleOffsetProps[]).find(
      (x) => targetsKey(x.targets) === key,
    );
    return o ? { translation: Array.from(o.translation), euler: Array.from(o.euler) } : undefined;
  }

  /** The offset of some targets, following the state tree while watched */
  offsetState(
    particles: string,
    targets: string,
  ): ReadonlyState<{ translation: number[]; euler: number[] } | undefined> {
    return watchedState(
      () => this.offsetOf(particles, targets),
      () => this.ctx.plugin.state.data.events.changed,
      { compare: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
    );
  }

  readonly offset = this.operation({
    id: 'cryoet.offset',
    title: 'Offset what decorates some particles (in their own frames)',
    params: {
      particles: ListParam(),
      targets: PD.Text('', { description: "The targets by name or id ('Class 2', '1,2'); empty: every target" }),
      x: OptionalParam(PD.Numeric(0, {}, { description: "A shift along each particle's own X (Å); absent: as it is" })),
      y: OptionalParam(PD.Numeric(0)),
      z: OptionalParam(PD.Numeric(0)),
      ex: OptionalParam(
        PD.Numeric(0, { min: -180, max: 180 }, { description: 'A turn about its own X (°), then Y, then Z' }),
      ),
      ey: OptionalParam(PD.Numeric(0, { min: -180, max: 180 })),
      ez: OptionalParam(PD.Numeric(0, { min: -180, max: 180 })),
    },
    async run(values, ctx) {
      const v = values as { particles: string; targets: string } & Partial<
        Record<'x' | 'y' | 'z' | 'ex' | 'ey' | 'ez', number>
      >;
      const l = oneList(ctx, v.particles || undefined);
      if (isFailure(l)) return l;
      const data = dataOf(ctx, l);
      if (!data) return ApiResult.fail('not-found', 'The list has no particles yet.');
      const ids = v.targets.trim() ? pickTargets(data, v.targets) : [];
      if (isFailure(ids)) return ids;
      const key = targetsKey(ids);
      const cell = decoratorCell(ctx, l, ParticleListOffsets);
      const old = (cell?.transform.params?.offsets ?? []) as ParticleOffsetProps[];
      const at = old.findIndex((o) => targetsKey(o.targets) === key);
      const was = at >= 0 ? old[at] : undefined;
      const t = was?.translation ?? Vec3();
      const e = was?.euler ?? Vec3();
      const next: ParticleOffsetProps = {
        targets: [...ids].sort((a, b) => a - b),
        translation: Vec3.create(v.x ?? t[0], v.y ?? t[1], v.z ?? t[2]),
        euler: Vec3.create(v.ex ?? e[0], v.ey ?? e[1], v.ez ?? e[2]),
      };
      const zero = Vec3.isZero(next.translation) && Vec3.isZero(next.euler);
      const offsets = old.slice();
      if (at >= 0) {
        if (zero) offsets.splice(at, 1);
        else offsets[at] = next;
      } else if (!zero) offsets.push(next);
      if (JSON.stringify(offsets) === JSON.stringify(old)) return ApiResult.already('The offset is already so.');
      const b = ctx.plugin.state.data.build();
      if (cell) b.to(cell).update((p: any) => ({ ...p, offsets }));
      // the last decorator: after the classes' targets and the decorations
      else b.to(lastDecorator(ctx, l)).apply(ParticleListOffsets, { offsets });
      await b.commit();
      const what = ids.length ? `${ids.length} target${ids.length > 1 ? 's' : ''}` : 'every target';
      return ApiResult.ok(`Offset ${what} of ${labelOf(l)}.`, { nodes: [l.cell.transform.ref] });
    },
  });

  /** One instance's own offset (by its index), if any */
  instanceOf(particles: string, index: number): { translation: number[]; euler: number[] } | undefined {
    const l = lists(this.ctx).find((x) => x.cell.transform.ref === particles);
    const cell = l && decoratorCell(this.ctx, l, ParticleListOffsets);
    const o = ((cell?.transform.params?.instances ?? []) as ParticleInstanceOffsetProps[]).find(
      (x) => x.index === index,
    );
    return o ? { translation: Array.from(o.translation), euler: Array.from(o.euler) } : undefined;
  }

  /** One instance's own offset, following the state tree while watched */
  instanceState(
    particles: string,
    index: number,
  ): ReadonlyState<{ translation: number[]; euler: number[] } | undefined> {
    return watchedState(
      () => this.instanceOf(particles, index),
      () => this.ctx.plugin.state.data.events.changed,
      { compare: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
    );
  }

  readonly instance = this.operation({
    id: 'cryoet.instance',
    title: 'Offset one instance alone (in its own frame)',
    params: {
      particles: ListParam(),
      index: PD.Numeric(0, { min: 0, step: 1 }, { description: 'The particle, by its index in the list' }),
      x: OptionalParam(PD.Numeric(0, {}, { description: 'A shift along its own X (Å); absent: as it is' })),
      y: OptionalParam(PD.Numeric(0)),
      z: OptionalParam(PD.Numeric(0)),
      ex: OptionalParam(
        PD.Numeric(0, { min: -180, max: 180 }, { description: 'A turn about its own X (°), then Y, then Z' }),
      ),
      ey: OptionalParam(PD.Numeric(0, { min: -180, max: 180 })),
      ez: OptionalParam(PD.Numeric(0, { min: -180, max: 180 })),
    },
    async run(values, ctx) {
      const v = values as { particles: string; index: number } & Partial<
        Record<'x' | 'y' | 'z' | 'ex' | 'ey' | 'ez', number>
      >;
      const l = oneList(ctx, v.particles || undefined);
      if (isFailure(l)) return l;
      const data = dataOf(ctx, l);
      if (!data || v.index < 0 || v.index >= data.count) {
        return ApiResult.fail('not-found', `There is no particle ${v.index}.`, `From 0 to ${(data?.count ?? 1) - 1}.`);
      }
      const cell = decoratorCell(ctx, l, ParticleListOffsets);
      const old = (cell?.transform.params?.instances ?? []) as ParticleInstanceOffsetProps[];
      const at = old.findIndex((o) => o.index === v.index);
      const t = at >= 0 ? old[at].translation : Vec3();
      const e = at >= 0 ? old[at].euler : Vec3();
      const next: ParticleInstanceOffsetProps = {
        index: v.index,
        translation: Vec3.create(v.x ?? t[0], v.y ?? t[1], v.z ?? t[2]),
        euler: Vec3.create(v.ex ?? e[0], v.ey ?? e[1], v.ez ?? e[2]),
      };
      const zero = Vec3.isZero(next.translation) && Vec3.isZero(next.euler);
      const instances = old.slice();
      if (at >= 0) {
        if (zero) instances.splice(at, 1);
        else instances[at] = next;
      } else if (!zero) instances.push(next);
      if (JSON.stringify(instances) === JSON.stringify(old)) return ApiResult.already('The instance is already so.');
      const b = ctx.plugin.state.data.build();
      if (cell) b.to(cell).update((p: any) => ({ ...p, instances }));
      else b.to(lastDecorator(ctx, l)).apply(ParticleListOffsets, { offsets: [], instances });
      await b.commit();
      return ApiResult.ok(`Offset particle ${v.index} of ${labelOf(l)}.`, { nodes: [l.cell.transform.ref] });
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
      // the decorator kept (back to the file: none), not deleted: the representations under it go with a delete
      const wasDecorated = !!dataOf(ctx, l)?.targetMapping?.size;
      const decorations = decoratorCell(ctx, l, ParticleListWithTargets);
      const b = ctx.plugin.state.data.build();
      if (cell) b.to(cell).update({ attribute: key });
      else b.to(l.cell).apply(ParticleListTargetsFromAttribute, { attribute: key });
      // the decorations were of the other targets' ids: they go (the targets are others now)
      if (decorations && (decorations.transform.params?.targets ?? []).length) {
        b.to(decorations).update((p: any) => ({ ...p, targets: [] }));
      }
      // so were the offsets
      const offsets = decoratorCell(ctx, l, ParticleListOffsets);
      if (offsets && (offsets.transform.params?.offsets ?? []).length) {
        b.to(offsets).update((p: any) => ({ ...p, offsets: [] }));
      }
      await b.commit();
      await ensureTargetRepresentation(ctx, l, wasDecorated);
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
      const n = data.grid.cells.space.dimensions[AxisIndex[axis]];
      // the slice of this axis (one per axis): moved, or made
      const existing = sliceRepresentation(v, axis);
      const old = existing?.cell.transform.params as any;
      const i = Math.max(0, Math.min(n - 1, Math.round(index ?? old?.type?.params?.dimension?.params ?? (n - 1) / 2)));
      const k = contrast ?? (old?.colorTheme?.params?.domain?.name === 'custom' ? undefined : 3);
      const params = sliceParams(ctx.plugin, data, { axis, index: i }, k ?? old.colorTheme.params.domain.params, old);
      if (existing && JSON.stringify(old) === JSON.stringify(params)) {
        return ApiResult.already(`Already at ${axis} ${i + 1} of ${n}.`);
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

  readonly slices = this.operation({
    id: 'cryoet.slices',
    title: 'Show the three slices of a tomogram',
    params: {
      volume: PD.Text('', { description: 'A volume by label or state ref; empty: the only one loaded' }),
      isosurface: PD.Boolean(false, { description: 'Keep its isosurfaces shown (else they are hidden)' }),
    },
    async run({ volume, isosurface }, ctx) {
      const v = oneVolume(ctx, volume || undefined);
      if (isFailure(v)) return v;
      const data = v.cell.obj?.data;
      if (!data) return ApiResult.fail('not-found', 'The volume is not loaded yet.');
      const b = ctx.plugin.state.data.build();
      let made = 0;
      for (const axis of Axes) {
        if (sliceRepresentation(v, axis)) continue;
        const n = data.grid.cells.space.dimensions[AxisIndex[axis]];
        b.to(v.cell).apply(
          VolumeRepresentation3D,
          sliceParams(ctx.plugin, data, { axis, index: Math.round((n - 1) / 2) }, 3),
        );
        made++;
      }
      const hide = isosurface
        ? []
        : v.representations.filter((r) => typeOf(r.cell.transform.params) !== 'slice' && !r.cell.state.isHidden);
      if (!made && !hide.length) return ApiResult.already('The three slices are shown.');
      await b.commit();
      for (const r of hide) ctx.plugin.state.data.updateCellState(r.cell.transform.ref, { isHidden: true });
      return ApiResult.ok(`Showing the x, y and z slices of ${v.cell.obj?.label ?? 'the volume'}.`, {
        nodes: [v.cell.transform.ref],
      });
    },
  });

  readonly oblique = this.operation({
    id: 'cryoet.oblique',
    title: 'Slice a volume on any plane (an oblique slice)',
    params: {
      volume: PD.Text('', { description: 'A volume by label or state ref; empty: the only one loaded' }),
      slice: PD.Text('', { description: 'The oblique slice to place, by state ref; empty: a new one' }),
      x: OptionalParam(
        PD.Numeric(0, {}, { description: "Its point, Å from the volume's center along its axes; absent: where it is" }),
      ),
      y: OptionalParam(PD.Numeric(0)),
      z: OptionalParam(PD.Numeric(0)),
      ex: OptionalParam(
        PD.Numeric(0, { min: -90, max: 90 }, { description: "Its tilt about the volume's X (°), then about its Y" }),
      ),
      ey: OptionalParam(PD.Numeric(0, { min: -180, max: 180 })),
      contrast: OptionalParam(
        PD.Numeric(
          3,
          { min: 0.1, max: 20, step: 0.1 },
          { description: 'The gray window, ± this many σ about the mean' },
        ),
      ),
    },
    async run(values, ctx) {
      const { volume, slice } = values;
      const v = values as typeof values & Partial<Record<'x' | 'y' | 'z' | 'ex' | 'ey' | 'contrast', number>>;
      const ref = oneVolume(ctx, volume || undefined);
      if (isFailure(ref)) return ref;
      const data = ref.cell.obj?.data;
      if (!data) return ApiResult.fail('not-found', 'The volume is not loaded yet.');
      const existing = slice ? obliqueRepresentations(ref).find((r) => r.cell.transform.ref === slice) : undefined;
      if (slice && !existing) return ApiResult.fail('not-found', `'${slice}' is not an oblique slice of this volume.`);
      const old = existing?.cell.transform.params as any;
      // in the grid the slice takes (a moved volume's)
      const grid = drawnGrid(ctx, ref) ?? data.grid;
      const now: ObliquePose = old
        ? obliquePoseOfPlane(grid, old.type.params.plane)
        : { position: [0, 0, 0], tilt: NewObliqueTilt };
      const pose: ObliquePose = {
        position: [v.x ?? now.position[0], v.y ?? now.position[1], v.z ?? now.position[2]],
        tilt: [v.ex ?? now.tilt[0], v.ey ?? now.tilt[1]],
      };
      const k = v.contrast ?? (old?.colorTheme?.params?.domain?.name === 'custom' ? undefined : 3);
      const plane = obliquePlane(grid, pose);
      const params = sliceParams(ctx.plugin, data, { plane }, k ?? old.colorTheme.params.domain.params, old);
      if (existing && JSON.stringify(old) === JSON.stringify(params)) return ApiResult.already('Already there.');
      const b = ctx.plugin.state.data.build();
      let made = existing?.cell.transform.ref;
      if (existing) b.to(existing.cell).update(params);
      else made = b.to(ref.cell).apply(VolumeRepresentation3D, params).ref;
      await b.commit();
      const name = ref.cell.obj?.label ?? 'the volume';
      return ApiResult.ok(
        existing ? `Placed the oblique slice of ${name}.` : `Added an oblique slice to ${name}.`,
        { nodes: [ref.cell.transform.ref] },
        { value: { slice: made } },
      );
    },
  });

  readonly level = this.operation({
    id: 'cryoet.level',
    title: 'Read a volume at another resolution (an OME-Zarr level, an MRC binned)',
    params: {
      volume: PD.Text('', { description: 'A volume by label or state ref; empty: the only one loaded' }),
      level: PD.Text('', {
        description:
          'The level by its path: an OME-Zarr\'s ("0": the finest, 1× binning); an MRC\'s binning ("1", "2", "4")',
      }),
      large: PD.Boolean(false, { description: "Read a level over the volume's size guard (asked first)" }),
    },
    async run({ volume, level, large }, ctx) {
      const v = oneVolume(ctx, volume || undefined);
      if (isFailure(v)) return v;
      const zarr = zarrOf(v);
      const name = v.cell.obj?.label ?? 'The volume';
      if (!zarr) {
        const mrc = ccp4Of(v);
        if (mrc && binLevels(mrc).length > 1) return binTo(ctx, v, mrc, level);
        return ApiResult.fail(
          'invalid',
          `${name} has one resolution.`,
          mrc?.stack
            ? 'A tilt series or an image stack: its images are not binned together.'
            : mrc
              ? `It is too small to bin (its longest side under ${2 * MinBinnedSide} voxels).`
              : 'Only an OME-Zarr volume or an MRC map has levels.',
        );
      }
      const levels = levelViews(zarr);
      const to = zarr.file.levels.find((l) => l.path === level);
      if (!to) {
        return ApiResult.fail(
          'not-found',
          `${name} has no level '${level}'.`,
          `Levels: ${levels.map((l) => `${l.path} (${l.label})`).join(', ')}.`,
        );
      }
      const view = levels.find((l) => l.path === to.path)!;
      if (to.path === zarr.level.path) return ApiResult.already(`${name} is read at ${view.label}.`);
      const needs = omeZarrLevelNeeds(to);
      if (needs > zarr.maxSizeMB * 1e6 && !large) {
        return ApiResult.fail(
          'confirm',
          `${view.binning}× needs ${mb(needs)} decoded, over this volume's ${zarr.maxSizeMB} MB guard.`,
          'A browser tab holds about 2 GB. Choose a coarser level, or call again with large: true.',
        );
      }
      // the gray windows and the transfer functions as the person set them, in σ: σ changes with the binning
      const stats = { ...v.cell.obj!.data.grid.stats };
      const windows = windowsOf(v, stats);
      // one write: the level, and each slice's index at its place in Å (an index past the new grid would fail)
      const b = ctx.plugin.state.data.build();
      b.to(v.cell).update({
        ...(v.cell.transform.params as object),
        level: to.path,
        maxSizeMB: large ? Math.max(zarr.maxSizeMB, Math.ceil(needs / 1e6)) : zarr.maxSizeMB,
      });
      moveSlices(b, v, zarr.level, to);
      const failure = await commitWatched(ctx, v.cell.transform.ref, b);
      const read = ctx.plugin.state.data.cells.get(v.cell.transform.ref)?.obj?.data as Volume | undefined;
      if (failure || (read?.sourceData as OmeZarrFormat | undefined)?.data.level.path !== to.path) {
        return ApiResult.fail(
          'failed',
          failure ?? `Could not read ${name} at ${view.label}.`,
          'It stays at its level.',
        );
      }
      await refit(ctx, v.cell.transform.ref, windows, stats);
      return ApiResult.ok(`Reading ${name} at ${view.label}.`, { nodes: [v.cell.transform.ref] });
    },
  });
}

const Axes: readonly SliceAxis[] = ['x', 'y', 'z'];

/** A new oblique slice's tilt (°, about X then Y): through the middle, visibly not a grid slice */
const NewObliqueTilt: readonly [number, number] = [30, 30];
const AxisIndex = { x: 0, y: 1, z: 2 } as const;

const typeOf = (params: unknown) => (params as { type?: { name?: string } } | undefined)?.type?.name;

/** The grid a volume's representations take: its last decorator's (a moved volume's), else its own */
function drawnGrid(ctx: Pick<ApiContext, 'plugin'>, v: VolumeRef): Grid | undefined {
  return ((lastDecorator(ctx, v).obj?.data as Volume | undefined) ?? v.cell.obj?.data)?.grid;
}

/** A slice along the grid (x, y or z): not a frame's or a plane's (`mode`, grid by default) */
const isGridSlice = (p: { mode?: string } | undefined) => (p?.mode ?? 'grid') === 'grid';

/** A volume's oblique slices: its slices on a plane */
function obliqueRepresentations(v: VolumeRef) {
  return v.representations.filter((r) => {
    const p = r.cell.transform.params as { type?: { name?: string; params?: { mode?: string } } };
    return p?.type?.name === 'slice' && p.type.params?.mode === 'plane';
  });
}

/** A volume's slice of one axis, if it has one */
function sliceRepresentation(v: VolumeRef, axis: SliceAxis) {
  return v.representations.find((r) => {
    const p = r.cell.transform.params as {
      type?: { name?: string; params?: { mode?: string; dimension?: { name?: string } } };
    };
    return p?.type?.name === 'slice' && isGridSlice(p.type.params) && p.type.params?.dimension?.name === axis;
  });
}

/**
 * A slice's representation params: gray, `window` ± this many σ about the mean (or a [min, max]); kept from `old` what
 * its type and its look were set to (the form's params), only the slice and the window changed
 */
function sliceParams(
  plugin: ApiContext['plugin'],
  data: Volume,
  at: { axis: SliceAxis; index: number } | { plane: SlicePlane },
  window: number | [number, number],
  old?: any,
) {
  const where =
    'plane' in at
      ? { mode: 'plane', plane: { point: Vec3.clone(at.plane.point), normal: Vec3.clone(at.plane.normal) } }
      : { mode: 'grid', dimension: { name: at.axis, params: at.index } };
  const { mean, sigma } = data.grid.stats;
  const domain: [number, number] = typeof window === 'number' ? [mean - window * sigma, mean + window * sigma] : window;
  const fresh = createVolumeRepresentationParams(plugin, data, {
    type: 'slice',
    typeParams: { ...where, isoValue: Volume.IsoValue.relative(-1000) } as any,
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
  }) as any;
  if (!old) return fresh;
  return {
    ...old,
    type: { ...old.type, params: { ...old.type.params, ...where } },
    colorTheme:
      old.colorTheme?.name === 'volume-value'
        ? { ...old.colorTheme, params: { ...old.colorTheme.params, domain: { name: 'custom', params: domain } } }
        : old.colorTheme,
  };
}

/**
 * A volume format's visuals for tomograms, as IMOD's 3dmod opens one: its middle XY slice (along z) shown, grayscale
 * at mean ± 3σ, seen straight down z (x right, y up) and framed to it; the x and y slices made too, hidden (their eyes
 * show them). No isosurface.
 */
export async function sliceVisuals(plugin: ApiContext['plugin'], data: { volume?: StateObjectSelector }) {
  const volume = data.volume;
  const v = volume?.cell?.obj?.data as Volume | undefined;
  if (!volume || !v) return [];
  const b = plugin.build();
  for (const axis of Axes) {
    const n = v.grid.cells.space.dimensions[AxisIndex[axis]];
    b.to(volume).apply(VolumeRepresentation3D, sliceParams(plugin, v, { axis, index: Math.round((n - 1) / 2) }, 3), {
      state: { isHidden: axis !== 'z' },
    });
  }
  await b.commit();
  lookDownZ(plugin, v);
  return [];
}

/** The camera looking straight down z at a volume's middle (x right, y up), framed to its XY extent */
function lookDownZ(plugin: ApiContext['plugin'], v: Volume) {
  const camera = plugin.canvas3d?.camera;
  if (!camera) return;
  const box = Grid.getBoundingSphere(v.grid);
  // the XY slice's half-diagonal: the box's, over its full diagonal, times its XY one
  const [nx, ny, nz] = v.grid.cells.space.dimensions;
  const radius = Math.max((box.radius * Math.hypot(nx, ny)) / Math.max(Math.hypot(nx, ny, nz), 1), 1);
  const distance = camera.getTargetDistance(radius);
  const target = Vec3.clone(box.center);
  camera.setState(
    { target, position: Vec3.add(Vec3(), target, Vec3.create(0, 0, distance)), up: Vec3.create(0, 1, 0), radius },
    0,
  );
}

function sliceOf(ctx: Pick<ApiContext, 'plugin'>, v: VolumeRef): SliceInfo | undefined {
  const data = v.cell.obj?.data;
  if (!data) return;
  const [x, y, z] = data.grid.cells.space.dimensions;
  const { mean, sigma } = data.grid.stats;
  const slices: SliceView[] = [];
  for (const axis of Axes) {
    const r = sliceRepresentation(v, axis);
    if (!r) continue;
    const p = r.cell.transform.params as any;
    const domain = p?.colorTheme?.params?.domain;
    slices.push({
      axis,
      index: p.type.params.dimension.params,
      ...(domain?.name === 'custom' && sigma > 0
        ? { contrast: Math.round(((domain.params[1] - mean) / sigma) * 10) / 10 }
        : {}),
      ref: r.cell.transform.ref,
      visible: !r.cell.state.isHidden,
    });
  }
  // in the grid the slices take (a moved volume's: its last decorator's)
  const drawn = drawnGrid(ctx, v) ?? data.grid;
  const obliques = obliqueRepresentations(v).map((r): ObliqueView => {
    const p = r.cell.transform.params as any;
    const domain = p?.colorTheme?.params?.domain;
    return {
      ...obliquePoseOfPlane(drawn, p.type.params.plane as SlicePlane),
      ...(domain?.name === 'custom' && sigma > 0
        ? { contrast: Math.round(((domain.params[1] - mean) / sigma) * 10) / 10 }
        : {}),
      ref: r.cell.transform.ref,
      visible: !r.cell.state.isHidden,
    };
  });
  return { dimensions: [x, y, z], slices, obliques, radius: Grid.getBoundingSphere(data.grid).radius };
}

// --- a volume's data and its levels (cryoet.level) -------------------------------------------------------------------

/** An OME-Zarr volume's file, its level read now and its size guard; undefined: not an OME-Zarr read by its transform */
function zarrOf(v: VolumeRef) {
  const data = v.cell.obj?.data;
  if (v.cell.transform.transformer !== VolumeFromOmeZarr || data?.sourceData.kind !== 'ome-zarr') return undefined;
  const { file, level } = (data.sourceData as OmeZarrFormat).data;
  const { maxSizeMB } = v.cell.transform.params as { maxSizeMB: number };
  return { file, level, maxSizeMB };
}

/** An OME-Zarr's levels, coarsest to finest, each its binning against the finest */
function levelViews(zarr: NonNullable<ReturnType<typeof zarrOf>>): VolumeLevelView[] {
  const finest = Math.min(...zarr.file.levels.map((l) => l.scale[0]));
  return [...zarr.file.levels]
    .sort((a, b) => b.scale[0] - a.scale[0])
    .map((l) => {
      const binning = Math.round((l.scale[0] / finest) * 10) / 10;
      const spacing = l.scale[0];
      return {
        path: l.path,
        binning,
        spacing,
        size: l.size,
        bytes: l.bytes,
        large: omeZarrLevelNeeds(l) > zarr.maxSizeMB * 1e6,
        label: `${binning}× · ${+spacing.toFixed(1)} Å · ${mb(l.bytes)}`,
      };
    });
}

function volumeDataOf(v: VolumeRef): VolumeDataInfo | undefined {
  const data = v.cell.obj?.data;
  if (!data) return;
  const stats = volumeStats(data);
  const zarr = zarrOf(v);
  const mrc = zarr ? undefined : ccp4Of(v);
  const levels = zarr && zarr.file.levels.length > 1 ? levelViews(zarr) : mrc ? binLevels(mrc) : [];
  const several = levels.length > 1;
  return {
    source: data.sourceData.kind.toUpperCase(),
    grid: gridText(stats),
    voxel: voxelText(stats),
    bytes: (data.grid.cells.data as unknown as ArrayBufferView).byteLength ?? 0,
    levels: several ? levels : [],
    ...(several ? { level: zarr ? zarr.level.path : String(mrc!.bin) } : {}),
  };
}

/** Each grid slice of a volume moved to the index at its place (Å) in another level's grid (an index past it fails) */
function moveSlices(b: ReturnType<ApiContext['plugin']['build']>, v: VolumeRef, from: LevelFrame, to: LevelFrame) {
  for (const axis of Axes) {
    const r = sliceRepresentation(v, axis);
    if (!r) continue;
    const p = r.cell.transform.params as any;
    const index = sameIndex(p.type.params.dimension.params, AxisIndex[axis], from, to);
    b.to(r.cell).update({
      ...p,
      type: { ...p.type, params: { ...p.type.params, dimension: { name: axis, params: index } } },
    });
  }
}

// --- an MRC binned (its levels: VolumeFromCcp4's `bin`) ---------------------------------------------------------------

/** The binnings an MRC map can be read at; 8× only over 1000 voxels a side */
const Binnings = [1, 2, 4, 8] as const;
/** A binning is listed while the map's longest side keeps this many voxels */
const MinBinnedSide = 8;

type Ccp4Read = NonNullable<ReturnType<typeof ccp4Of>>;

/** An MRC (CCP4) map read by its transform: its grid at 1× (from the file), the bytes of its type, its binning now */
function ccp4Of(v: VolumeRef) {
  const data = v.cell.obj?.data;
  if (v.cell.transform.transformer !== VolumeFromCcp4 || !data || !Ccp4Format.is(data.sourceData)) return undefined;
  const bin = (v.cell.transform.params as { bin?: number } | undefined)?.bin ?? 1;
  const { header, values } = data.sourceData.data;
  const order = Tensor.convertToCanonicalAxisIndicesFastToSlow([header.MAPC - 1, header.MAPR - 1, header.MAPS - 1]);
  const size = order([header.NC, header.NR, header.NS]);
  // the grid read now, back to 1×: binned by its binning along each side, by its length along a shorter one
  const g = Grid.getGridToCartesianTransform(data.grid);
  const scale: number[] = [];
  const translation: number[] = [];
  for (let a = 0; a < 3; a++) {
    const by = Math.max(1, Math.min(bin, size[a]));
    scale[a] = g[5 * a] / by;
    translation[a] = g[12 + a] - ((by - 1) / 2) * scale[a];
  }
  // a tilt series or an image stack (as Ccp4Provider names them): its images along z are not binned together
  const stack = /\.(st|ali|mrcs)$/i.test(v.cell.obj?.label ?? '');
  return { bin, one: { translation, scale, size } as LevelFrame, bytes: values.BYTES_PER_ELEMENT, stack };
}

/** An MRC's grid binned by `f` (as `binGrid`): voxel 0 at its block's center, the voxel `f` times (a side's length) */
function binnedFrame(one: LevelFrame, f: number): LevelFrame {
  const translation: number[] = [];
  const scale: number[] = [];
  const size: number[] = [];
  for (let a = 0; a < 3; a++) {
    const by = Math.max(1, Math.min(f, one.size[a]));
    translation[a] = one.translation[a] + ((by - 1) / 2) * one.scale[a];
    scale[a] = one.scale[a] * by;
    size[a] = Math.ceil(one.size[a] / by);
  }
  return { translation, scale, size };
}

/** An MRC's levels, coarsest to finest: 1× as read (its type's bytes), each binning a Float32 grid */
function binLevels(mrc: Ccp4Read): VolumeLevelView[] {
  const longest = Math.max(...Array.from(mrc.one.size));
  return Binnings.filter((f) => f === 1 || (!mrc.stack && longest / f >= MinBinnedSide && (f < 8 || longest > 1000)))
    .reverse()
    .map((f) => {
      const frame = binnedFrame(mrc.one, f);
      const size = [frame.size[0], frame.size[1], frame.size[2]] as const;
      const bytes = size[0] * size[1] * size[2] * (f === 1 ? mrc.bytes : 4);
      const spacing = frame.scale[0];
      return {
        path: String(f),
        binning: f,
        spacing,
        size,
        bytes,
        large: false,
        label: `${f}× · ${+spacing.toFixed(1)} Å · ${mb(bytes)}`,
      };
    });
}

/**
 * An MRC read at another binning, as `cryoet.level` reads an OME-Zarr's level: one write (its `bin`, each slice at its
 * place in Å), then its windows and transfer functions refit in σ
 */
async function binTo(ctx: ApiContext, v: VolumeRef, mrc: Ccp4Read, level: string) {
  const name = v.cell.obj?.label ?? 'The volume';
  const levels = binLevels(mrc);
  const view = levels.find((l) => l.path === level.trim().replace(/×$/, ''));
  if (!view) {
    return ApiResult.fail(
      'not-found',
      `${name} has no level '${level}'.`,
      `Levels: ${levels.map((l) => `${l.path} (${l.label})`).join(', ')}.`,
    );
  }
  if (view.binning === mrc.bin) return ApiResult.already(`${name} is read at ${view.label}.`);
  const stats = { ...v.cell.obj!.data.grid.stats };
  const windows = windowsOf(v, stats);
  const b = ctx.plugin.state.data.build();
  b.to(v.cell).update({ ...(v.cell.transform.params as object), bin: view.binning });
  moveSlices(b, v, binnedFrame(mrc.one, mrc.bin), binnedFrame(mrc.one, view.binning));
  const failure = await commitWatched(ctx, v.cell.transform.ref, b);
  const read = ctx.plugin.state.data.cells.get(v.cell.transform.ref);
  if (failure || ((read?.transform.params as { bin?: number } | undefined)?.bin ?? 1) !== view.binning) {
    return ApiResult.fail('failed', failure ?? `Could not read ${name} at ${view.label}.`, 'It stays at its level.');
  }
  await refit(ctx, v.cell.transform.ref, windows, stats);
  return ApiResult.ok(`Reading ${name} at ${view.label}.`, { nodes: [v.cell.transform.ref] });
}

/** A level's grid along x, y and z: voxel i at translation + i·scale (Å), `size` voxels */
interface LevelFrame {
  readonly translation: ArrayLike<number>;
  readonly scale: ArrayLike<number>;
  readonly size: ArrayLike<number>;
}

/** A grid slice's index at one level, the index at the same place (Å) at another: voxel i at translation + i·scale */
function sameIndex(index: number, axis: number, from: LevelFrame, to: LevelFrame) {
  const at = from.translation[axis] + index * from.scale[axis];
  const i = Math.round((at - to.translation[axis]) / to.scale[axis]);
  return Math.max(0, Math.min(to.size[axis] - 1, i));
}

/** The gray windows of a volume's slices and oblique slices (a custom domain), each end in σ, by their refs */
function windowsOf(v: VolumeRef, { mean, sigma }: Grid['stats']): Map<string, [number, number]> {
  const windows = new Map<string, [number, number]>();
  if (!(sigma > 0)) return windows;
  for (const r of v.representations) {
    const p = r.cell.transform.params as any;
    const domain = p?.colorTheme?.params?.domain;
    if (p?.type?.name !== 'slice' || domain?.name !== 'custom' || !Array.isArray(domain.params)) continue;
    windows.set(r.cell.transform.ref, [(domain.params[0] - mean) / sigma, (domain.params[1] - mean) / sigma]);
  }
  return windows;
}

/**
 * A transfer function's point or a color stop (a fraction of a domain: by default the map's [min, max]) at the same value
 * in σ, over another level's statistics (and its domain)
 */
export function samePoint(
  x: number,
  from: Grid['stats'],
  to: Grid['stats'],
  fromDomain: readonly [number, number] = [from.min, from.max],
  toDomain: readonly [number, number] = [to.min, to.max],
) {
  if (!(from.sigma > 0 && to.sigma > 0 && toDomain[1] > toDomain[0])) return x;
  const z = (fromDomain[0] + x * (fromDomain[1] - fromDomain[0]) - from.mean) / from.sigma;
  return Math.max(0, Math.min(1, (to.mean + z * to.sigma - toDomain[0]) / (toDomain[1] - toDomain[0])));
}

/**
 * A volume-value color theme at the same values in σ over another level's statistics: a custom domain's ends (in data
 * units; one in σ, `isRelative`, stays), an auto domain's stops (fractions of [min, max], or of ±|max| symmetric)
 */
function sameColors(theme: any, from: Grid['stats'], to: Grid['stats']) {
  if (theme?.name !== 'volume-value' || !(from.sigma > 0 && to.sigma > 0)) return theme;
  const p = theme.params;
  if (p?.domain?.name === 'custom') {
    if (p.isRelative || !Array.isArray(p.domain.params)) return theme;
    const ends = p.domain.params.map((d: number) => to.mean + ((d - from.mean) / from.sigma) * to.sigma);
    return { ...theme, params: { ...p, domain: { ...p.domain, params: ends } } };
  }
  const auto = (s: Grid['stats']): [number, number] => {
    if (!p?.domain?.params?.symmetric) return [s.min, s.max];
    const m = Math.max(Math.abs(s.min), Math.abs(s.max));
    return [-m, m];
  };
  const colors = (p?.colorList?.colors ?? []).map((c: unknown) =>
    Array.isArray(c) ? [c[0], samePoint(c[1], from, to, auto(from), auto(to))] : c,
  );
  return { ...theme, params: { ...p, colorList: { ...p.colorList, colors } } };
}

/**
 * The volume's look set again in σ over its new level's statistics (binning changes σ, and the range more): the
 * slices' windows, each end at the same σ, the direct volumes' points and colors at the same values in σ (a
 * fraction of [min, max] otherwise: the Tomogram preset's dark matter would cover the noise of a finer level)
 */
async function refit(
  ctx: Pick<ApiContext, 'plugin'>,
  volume: string,
  windows: ReadonlyMap<string, readonly [number, number]>,
  from: Grid['stats'],
) {
  const v = oneVolume(ctx, volume);
  const data = isFailure(v) ? undefined : v.cell.obj?.data;
  if (isFailure(v) || !data) return;
  const b = ctx.plugin.state.data.build();
  for (const r of v.representations) {
    const ref = r.cell.transform.ref;
    const old = r.cell.transform.params as any;
    const z = windows.get(ref);
    let next: unknown;
    if (z && old?.type?.name === 'slice') {
      const { mean, sigma } = data.grid.stats;
      const where =
        old.type.params.mode === 'plane'
          ? { plane: old.type.params.plane as SlicePlane }
          : { axis: old.type.params.dimension.name as SliceAxis, index: old.type.params.dimension.params as number };
      next = sliceParams(ctx.plugin, data, where, [mean + z[0] * sigma, mean + z[1] * sigma], old);
    } else if (old?.type?.name === 'direct-volume' && Array.isArray(old.type.params?.controlPoints)) {
      const controlPoints = (old.type.params.controlPoints as number[][]).map(([x, ...rest]) => [
        samePoint(x, from, data.grid.stats),
        ...rest,
      ]);
      next = {
        ...old,
        type: { ...old.type, params: { ...old.type.params, controlPoints } },
        ...(old.colorTheme ? { colorTheme: sameColors(old.colorTheme, from, data.grid.stats) } : {}),
      };
    }
    if (next && JSON.stringify(next) !== JSON.stringify(old)) b.to(ref).update(next);
  }
  await b.commit();
}

/** A build committed, reverted on an error: the error of the cell `ref` (its transform's message), if it failed */
async function commitWatched(
  ctx: Pick<ApiContext, 'plugin'>,
  ref: string,
  b: ReturnType<ApiContext['plugin']['build']>,
) {
  let failure: string | undefined;
  const sub = ctx.plugin.state.data.events.cell.stateUpdated.subscribe(({ cell }) => {
    if (cell.transform.ref === ref && cell.status === 'error' && failure === undefined) {
      failure = cell.errorText?.replace(/^Error: /, '');
    }
  });
  try {
    await b.commit({ revertOnError: true });
  } finally {
    sub.unsubscribe();
  }
  return failure;
}

// --- the particle lists and their decorations -----------------------------------------------------------------------

type TargetSourceValue =
  | { name: 'ref'; params: { ref: string } }
  | { name: 'url'; params: { url: string; format: string; isBinary?: boolean } }
  | { name: 'target'; params: { list: string; target: number } };
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

/** The last of a list's or a volume's decorators (what its representations take: a moved volume's grid), else itself */
function lastDecorator(ctx: Pick<ApiContext, 'plugin'>, l: { readonly cell: StateObjectCell }): StateObjectCell {
  const { tree, cells } = ctx.plugin.state.data;
  let cell = l.cell as StateObjectCell;
  for (;;) {
    const next = tree.children
      .get(cell.transform.ref)
      .toArray()
      .map((c) => cells.get(c))
      .find((c) => c?.transform.transformer.definition.isDecorator);
    if (!next) return cell;
    cell = next;
  }
}

/** The ids of some targets, sorted: their offset's key ('': every target) */
const targetsKey = (ids: readonly number[]) => [...ids].sort((a, b) => a - b).join(',');

/** The decorator of `transformer` in the chain of decorators under the list, if any */
function decoratorCell(
  ctx: Pick<ApiContext, 'plugin'>,
  l: ParticleListRef,
  transformer: typeof ParticleListWithTargets | typeof ParticleListTargetsFromAttribute | typeof ParticleListOffsets,
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

/** The particles a list draws (its decorations' targets with them), by its state ref */
export function particleListData(ctx: Pick<ApiContext, 'plugin'>, ref: string): ParticleList | undefined {
  const l = lists(ctx).find((x) => x.cell.transform.ref === ref);
  return l && dataOf(ctx, l);
}

/** The list as the representations get it: with its decorations */

/**
 * The particles the list's offsets apply to: its deepest decorator's but its offsets' (its targets, their names and
 * objects, and its particles: a decorator that adds particles, mesoscale's painted copies, adds them here too, so an
 * instance or a kind of them is offset as the file's are; paint-layer, 2026-11-10)
 */
function dataOf(ctx: Pick<ApiContext, 'plugin'>, l: ParticleListRef): ParticleList | undefined {
  const { tree, cells } = ctx.plugin.state.data;
  let data = l.cell.obj?.data as ParticleList | undefined;
  for (let ref: StateTransform.Ref = l.cell.transform.ref; ; ) {
    const decorator = tree.children
      .get(ref)
      .toArray()
      .map((c) => tree.transforms.get(c))
      .find((t) => t?.transformer.definition.isDecorator);
    if (!decorator) return data;
    if (decorator.transformer !== ParticleListOffsets)
      data = (cells.get(decorator.ref)?.obj?.data as ParticleList) ?? data;
    ref = decorator.ref;
  }
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
  const objects = [...sceneObjects(ctx), ...modelEntities(ctx, l)];
  const labelOfRef = new Map(objects.map((o) => [o.ref, o.label]));
  const attributes = l.cell.obj?.data.attributes;
  const classes = decoratorCell(ctx, l, ParticleListTargetsFromAttribute)?.transform.params?.attribute as
    | string
    | undefined;
  const hidden = hiddenTargets(ctx, l);
  return {
    particles: l.cell.transform.ref,
    label: labelOf(l),
    count: data.count,
    ...(classes ? { classes } : {}),
    attributes: attributes ? Array.from(attributes, ([key, a]) => ({ key, label: a.label })) : [],
    targets: Array.from(data.targetInfo, ([id, info]) => {
      const entry = entries.get(id);
      const target = data.targetMapping?.get(id);
      const object = entry ? objectOf(entry.source) : undefined;
      const w = entry
        ? object
          ? (labelOfRef.get(object) ?? object)
          : (entry.source as { params: { url: string } }).params.url
        : target
          ? describeTarget(target)
          : undefined;
      return {
        id,
        name: info.name ?? data.entityInfo?.get(info.entity ?? -1)?.name ?? `Target ${id}`,
        count: counts.get(id) ?? 0,
        ...(w ? { with: w } : {}),
        ...(object ? { object } : {}),
        ...(info.entity !== undefined ? { entity: info.entity } : {}),
        visible: !hidden.has(id),
      };
    }),
    objects,
  };
}

/**
 * The targets a list hides, each by a layer of it alone (the explorer's eye of a class, `particles.look`), read from its
 * first representation's layers (they are the same on each)
 */
function hiddenTargets(ctx: Pick<ApiContext, 'plugin'>, l: ParticleListRef): Set<number> {
  const hidden = new Set<number>();
  const r = l.representations[0];
  if (!r) return hidden;
  const tree = ctx.plugin.state.data.tree;
  for (const child of tree.children.get(r.cell.transform.ref).toArray()) {
    const t = tree.transforms.get(child);
    if (t?.transformer !== ParticleRepresentation3DLayers) continue;
    for (const layer of (t.params?.layers ?? []) as ParticleLayerProps[]) {
      if (layer.targets.length !== 1 || layer.entities.length || layer.compartments.length) continue;
      if (layer.visible) hidden.delete(layer.targets[0]);
      else hidden.add(layer.targets[0]);
    }
  }
  return hidden;
}

/** The shape representations of meshes loaded from files (not the guides and shapes the viewer makes itself) */
function meshes(ctx: Pick<ApiContext, 'plugin'>): MeshInfo[] {
  const { cells, tree } = ctx.plugin.state.data;
  const out: MeshInfo[] = [];
  for (const cell of cells.values()) {
    if (cell.state.isGhost || !SO.Shape.Representation3D.is(cell.obj)) continue;
    // a file's mesh: its root is the file's data, no representation on the way (a cut's drawing is a representation's)
    let root = cell.transform.ref;
    let drawing = false;
    for (;;) {
      const parent = tree.transforms.get(root)?.parent;
      if (!parent || parent === StateTransform.RootRef) break;
      root = parent;
      if (SO.isRepresentation3D(cells.get(root)?.obj)) drawing = true;
    }
    if (drawing) continue;
    const data = cells.get(root)?.obj;
    if (!SO.Data.String.is(data) && !SO.Data.Binary.is(data) && !SO.Data.Response.is(data)) continue;
    const p = cell.transform.params as any;
    const arrays = arraysOf(cell, shapeCellOf(ctx, cell.transform.ref));
    out.push({
      ref: cell.transform.ref,
      label: data.label,
      visible: !cell.state.isHidden,
      visuals: Array.isArray(p?.visuals) ? p.visuals : ['mesh'],
      opacity: p?.alpha ?? 1,
      ...(p?.coloring?.name === 'uniform' ? { color: p.coloring.params.color } : {}),
      ...(p?.colorTheme?.name === 'uniform' ? { color: p.colorTheme.params.color } : {}),
      ...(arrays.length ? { arrays } : {}),
      ...(arrays.length && p?.colorTheme?.name === 'attribute' ? { colorBy: colorByOf(p.colorTheme.params) } : {}),
      scale: scaleOf(shapeCellOf(ctx, cell.transform.ref)),
    });
  }
  return out;
}

/** The definition of a mesh's color theme by an array (a VTP's `colorTheme`, its `attribute` choice), if it has one */
function arrayThemeParams(cell: StateObjectCell): PD.Params | undefined {
  const def = cell.params?.definition?.colorTheme as PD.Any | undefined;
  if (def?.type !== 'mapped' || !def.select.options.some(([name]) => name === 'attribute')) return undefined;
  const group = def.map('attribute');
  return group.type === 'group' ? group.params : undefined;
}

/** A VTP's point or cell array as its file holds it (io's `VtpScalarArray`) */
type FileArray = { readonly numberOfComponents: number; readonly values: { toArray(): ArrayLike<number> } };
type FileArrays = {
  readonly pointData: ReadonlyMap<string, FileArray>;
  readonly cellData: ReadonlyMap<string, FileArray>;
};

/** The arrays a mesh can be colored by: its color theme's (a VTP's point and cell arrays), each its range from its file */
function arraysOf(cell: StateObjectCell, shape?: StateObjectCell): MeshArray[] {
  const name = arrayThemeParams(cell)?.name;
  if (name?.type !== 'select') return [];
  const file = (shape?.obj?.data as { data?: { source?: FileArrays } } | undefined)?.data?.source;
  return name.options
    .filter(([key]) => key !== '')
    .map(([key, label]) => {
      const [kind, array] = [String(key).split(':')[0], String(key).slice(String(key).indexOf(':') + 1)];
      const values =
        kind === 'point' ? file?.pointData?.get(array) : kind === 'cell' ? file?.cellData?.get(array) : undefined;
      const range = values && rangeOf(values);
      return { key: String(key), label, ...(range ? { range } : {}) };
    });
}

/** The range of an array's values (a vector's: its length's), once per array */
const ranges = new WeakMap<FileArray, readonly [number, number] | undefined>();
function rangeOf(a: FileArray): readonly [number, number] | undefined {
  if (ranges.has(a)) return ranges.get(a);
  const values = a.values.toArray();
  const n = Math.max(1, a.numberOfComponents);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i + n <= values.length; i += n) {
    let v = values[i];
    if (n > 1) {
      let sq = 0;
      for (let c = 0; c < n; c++) sq += values[i + c] * values[i + c];
      v = Math.sqrt(sq);
    }
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = min <= max ? ([min, max] as const) : undefined;
  ranges.set(a, range);
  return range;
}

function colorByOf(p: { name: string; colors: string; domain: { name: string; params: unknown } }): MeshColorBy {
  const range = p.domain.name === 'custom' ? (p.domain.params as [number, number]) : 'auto';
  return { array: p.name, colorList: p.colors, range };
}

/**
 * A mesh's color theme by an array, its array, colors or range changed (its others kept, or as the theme opens);
 * 'none': it has no arrays; a string: the array is none of them (its arrays, listed)
 */
function arrayTheme(
  cell: StateObjectCell,
  change: { array?: string; colorList?: string; range?: 'auto' | [number, number] },
): { value: unknown } | string {
  const params = arrayThemeParams(cell);
  const arrays = arraysOf(cell);
  if (!params || !arrays.length) return 'none';
  const old = (cell.transform.params as any)?.colorTheme;
  const base = old?.name === 'attribute' ? old.params : PD.getDefaultValues(params);
  let name = base.name;
  if (change.array !== undefined) {
    const a = change.array.trim();
    const found =
      arrays.find((x) => x.key === a) ??
      arrays.find((x) => x.key.replace(/^(point|cell):/, '').toLowerCase() === a.toLowerCase());
    if (!found) return arrays.map((x) => x.key).join(', ');
    name = found.key;
  }
  const symmetric = base.domain?.name === 'auto' ? !!base.domain.params?.symmetric : false;
  // another array without a range: Auto (the last array's custom range is not this one's)
  const range = change.range ?? (name !== base.name && base.domain?.name === 'custom' ? 'auto' : undefined);
  const domain =
    range === undefined
      ? base.domain
      : range === 'auto'
        ? { name: 'auto', params: { symmetric } }
        : { name: 'custom', params: [range[0], range[1]] };
  return { value: { name: 'attribute', params: { ...base, name, colors: change.colorList ?? base.colors, domain } } };
}

/** The shape a mesh representation draws (its `transforms` param: the OBJ, PLY, VTP shapes') */
function shapeCellOf(ctx: Pick<ApiContext, 'plugin'>, repr: string): StateObjectCell | undefined {
  const { cells, tree } = ctx.plugin.state.data;
  const parent = cells.get(tree.transforms.get(repr)?.parent ?? '');
  return parent && SO.Shape.Provider.is(parent.obj) ? parent : undefined;
}

/** A shape's scale: of its first instance transform (1 when none) */
function scaleOf(shape: StateObjectCell | undefined): number {
  const m = (shape?.transform.params as { transforms?: Mat4[] } | undefined)?.transforms?.[0];
  return m ? Mat4.getMaxScaleOnAxis(m) : 1;
}

/** A color as people write it (#rgb, #rrggbb, rgb(), hsl(), a name: Prism's `parseColor`, the picker's) */
function cssColor(text: string): Color | undefined {
  const c = parseColor(text);
  return c === undefined ? undefined : Color(c);
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

/** How `objects` names what a source decorates with: an object's state ref, a model entity's `target:<list>:<id>` */
function objectOf(source: TargetSourceValue): string | undefined {
  if (source.name === 'ref') return source.params.ref;
  if (source.name === 'target') return `target:${source.params.list}:${source.params.target}`;
  return undefined;
}

/**
 * The entities of the particle lists other than `except` that bring their own (a cellPACK or PetWorld model: a
 * structure per target), named "model › entity"
 */
function modelEntities(ctx: Pick<ApiContext, 'plugin'>, except?: ParticleListRef) {
  const out: { ref: string; label: string; group: string }[] = [];
  for (const l of lists(ctx)) {
    if (l === except || !l.cell.obj) continue;
    const data = l.cell.obj.data;
    if (!data.targetMapping?.size) continue;
    const model = entryLabel(ctx, l.cell);
    for (const [id, target] of data.targetMapping) {
      if (target.kind !== 'structure') continue;
      const info = data.targetInfo.get(id);
      const name = info?.name ?? data.entityInfo?.get(info?.entity ?? -1)?.name ?? `Target ${id}`;
      out.push({ ref: `target:${l.cell.transform.ref}:${id}`, label: `${model} › ${name}`, group: model });
    }
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

function pickEntity(ctx: ApiContext, l: ParticleListRef, name: string) {
  const entities = modelEntities(ctx, l);
  if (!entities.length) {
    return ApiResult.fail('not-found', 'No model with entities is open.', 'Open a cellPACK or PetWorld model first.');
  }
  // as written first (entities may differ by case only: 7CGOA, 7CGOa), else in any case
  const matches = (exact: boolean) => {
    const f = (x: string) => (exact ? x : x.toLowerCase());
    const n = f(name.trim());
    return entities.filter((e) => f(e.ref) === n || f(e.label) === n || f(e.label).endsWith(` › ${n}`));
  };
  const exact = matches(true);
  const found = exact.length ? exact : matches(false);
  if (found.length === 1) return found[0];
  return ApiResult.fail(
    found.length ? 'ambiguous' : 'not-found',
    `${found.length ? 'Several entities are' : 'No entity is'} named '${name}'.`,
    `Name it as "model › entity": ${entities
      .slice(0, 8)
      .map((e) => e.label)
      .join(', ')}${entities.length > 8 ? ', …' : ''}.`,
  );
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
async function ensureTargetRepresentation(
  ctx: ApiContext,
  l: ParticleListRef,
  wasDecorated: boolean,
): Promise<string[]> {
  const fresh = lists(ctx).find((x) => x.cell.transform.ref === l.cell.transform.ref) ?? l;
  const isTarget = (r: ParticleListRef['representations'][number]) =>
    (r.cell.transform.params as { type?: { name?: string } })?.type?.name === 'target';
  const data = dataOf(ctx, fresh);
  const decorated = !!data?.targetMapping?.size;
  const made: string[] = [];
  // what draws the decorations: a target representation, made once, shown when the list becomes decorated
  if (decorated && !fresh.representations.some(isTarget)) made.push(...(await addRepresentation(ctx, fresh, 'target')));
  let now = lists(ctx).find((x) => x.cell.transform.ref === l.cell.transform.ref) ?? fresh;
  // no longer decorated and nothing else to draw them (the spheres removed): the spheres again
  if (!decorated && wasDecorated && !now.representations.some((r) => !isTarget(r))) {
    made.push(...(await addRepresentation(ctx, now, 'spacefill')));
    now = lists(ctx).find((x) => x.cell.transform.ref === l.cell.transform.ref) ?? now;
  }
  // the objects shown when the list becomes decorated, hidden when no longer (they draw nothing then)
  if (decorated !== wasDecorated) {
    const turn = now.representations.filter((r) => isTarget(r) && !!r.cell.state.isHidden === decorated);
    ctx.plugin.managers.particles.hierarchy.toggleVisibility(turn, decorated ? 'show' : 'hide');
    made.push(...turn.map((r) => r.cell.transform.ref));
  }
  // the spheres, axes and others draw the targets not decorated: the decorated ones left out of them
  const hidden = data?.targetMapping ? [...data.targetMapping.keys()].sort((x, y) => x - y) : [];
  made.push(
    ...(await leaveOut(
      ctx,
      now.representations.filter((r) => !isTarget(r)),
      hidden,
    )),
  );
  return made;
}

/**
 * The representations' looks leave out these targets (drawn by the decorations' objects), through `particles.look`
 * (Prism's one writer of the layers cell: the colors and cuts there stay): their refs changed
 */
async function leaveOut(
  ctx: ApiContext,
  reprs: readonly ParticleListRef['representations'][number][],
  hidden: readonly number[],
): Promise<string[]> {
  if (!reprs.length) return [];
  const node = reprs.map((r) => `#${r.cell.transform.ref}`).join(', ');
  const r = await ctx.api.run('particles.look', { node, hidden: [...hidden] });
  if (!r.ok) throw new Error(r.message);
  return r.unchanged ? [] : [...(r.changed.nodes ?? [])];
}

/**
 * A representation of `type` added to a list (`particles.representation`: its type's defaults and default themes, the
 * list's layers): its ref, none if no type
 */
async function addRepresentation(ctx: ApiContext, l: ParticleListRef, type: string): Promise<string[]> {
  if (!dataOf(ctx, l) || !ctx.plugin.representation.particles.registry.has(type)) return [];
  const r = await ctx.api.run('particles.representation', { particles: l.cell.transform.ref, type });
  if (!r.ok) throw new Error(r.message);
  return [...(r.changed.nodes ?? [])];
}
