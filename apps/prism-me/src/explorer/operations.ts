/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { OrderedSet } from '@molstar/core/data/int';
import { Sphere3D } from '@molstar/core/math/geometry';
import { ButtonsType } from '@molstar/core/util/input/input-observer';
import { type Observable, Subject } from 'rxjs';
import { EmptyLoci, isEmptyLoci, Loci } from '@molstar/model/model/loci';
import { MarkerAction } from '@molstar/core/util/marker-action';
import { isStageDistanceData } from '@molstar/stage-tools-extension/distance';
import { isStageLabelData } from '@molstar/stage-tools-extension/label';
import { drawnObject } from '@molstar/stage-tools-extension/operations';
import { Particle, type ParticleList, type ParticleTarget } from '@molstar/model/model/particles/particle-list';
import { Structure, StructureElement, StructureProperties, StructureSelection } from '@molstar/model/model/structure';
import { Shape, ShapeGroup } from '@molstar/model/model/shape';
import { EmissiveStructureRepresentation3DFromBundle } from '@molstar/plugin/state/transforms/structure/effects/emissive';
import { OverpaintStructureRepresentation3DFromBundle } from '@molstar/plugin/state/transforms/structure/effects/overpaint';
import { TransparencyStructureRepresentation3DFromBundle } from '@molstar/plugin/state/transforms/structure/effects/transparency';
import { Grid, Volume } from '@molstar/model/model/volume';
import { Script } from '@molstar/model/script/script';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import type { PluginContext } from '@molstar/plugin/context';
import { StateTransform } from '@molstar/core/state';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { setSubtreeVisibility } from '@molstar/plugin/behavior/static/state';
import { type ApiAreaContext, ApiArea, ApiResult } from '@molstar/prism-viewer/api/area';
import { labelOf, loadedStructures } from '@molstar/prism-viewer/api/scope';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import type {} from '@molstar/prism-viewer/features/clipping';
import { watchedState } from '@molstar/prism-viewer/sources/watched';
import { GizmoAppearance, type GizmoLook } from '@molstar/graphics/util/gizmo/controller';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import { isMac } from '@molstar/prism-ui/commands/keys';

// The `explorer` area (apps/prism-me/_spec/ui.md §3): what the scene holds, as the explorer's tree shows it: four
// categories (structures, particles, volumes, meshes), each object with its parts; and the 3D side of a row (its
// highlight, the camera on it). The particle models' entities and the lists' targets come from the mesoscale and
// cryo-ET areas, as their views read them.

export type Category = 'structures' | 'particles' | 'volumes' | 'meshes';

/** An object of the scene (a row under a category) */
export interface SceneObject {
  readonly ref: string;
  readonly category: Category;
  /** structure: a structure; model: a cellPACK or PetWorld model; list: a particle list; volume; mesh */
  readonly kind: 'structure' | 'model' | 'list' | 'volume' | 'mesh';
  readonly label: string;
  /** What the count at the end of its row says: atoms, particles, voxels */
  readonly count?: string;
  readonly visible: boolean;
  /** A structure's entities, with their chains */
  readonly entities?: readonly StructureEntity[];
  /** A volume's representations */
  readonly representations?: readonly {
    readonly ref: string;
    readonly label: string;
    /** isosurface, slice, oblique slice (a slice on a plane), direct-volume… */
    readonly type: string;
    readonly visible: boolean;
  }[];
}

export interface StructureEntity {
  /** The mmCIF entity id */
  readonly id: string;
  readonly label: string;
  readonly chains: readonly string[];
}

/** How a structure node looks: what the style layers on its representations make of all of it */
export interface StructureLook {
  /** The color painted on all of it, if one is */
  readonly color?: number;
  /** 0: opaque, 1: hidden */
  readonly transparency: number;
  /** 0: none, 1: full glow */
  readonly emissive: number;
}

/** A particle list's or a volume's representation, as the properties list them */
export interface RepresentationInfo {
  readonly ref: string;
  readonly label: string;
  /** spacefill, orientation, target…; isosurface, slice… */
  readonly type: string;
  readonly visible: boolean;
}

/** A left-click on the canvas: what it picked, where on the page (client px) */
export interface CanvasClick {
  readonly loci: Loci;
  readonly x?: number;
  readonly y?: number;
  /** With ⌘ on a Mac, Ctrl elsewhere: a point of a distance, in selection mode (_spec/ui.md §7) */
  readonly measure?: boolean;
}

/** A 3D pick as a row of the tree */
export interface PickedNode {
  readonly key: string;
  readonly label: string;
  readonly kind: string;
  readonly node: NodeRef;
  /** A volume's representation (a slice, an isosurface): its state ref, the node its volume */
  readonly representation?: string;
}

/** A node of the tree as the 3D side needs it: its object, and which part of it */
export type NodeRef =
  | { readonly ref: string }
  | { readonly ref: string; readonly entity: string; readonly chain?: string }
  | {
      readonly ref: string;
      readonly particles: {
        readonly entities?: number[];
        readonly compartments?: number[];
        readonly targets?: number[];
      };
    };

/** The particle representation types as the explorer names them (the others by their own label) */
export const ParticleTypeLabels: Readonly<Record<string, string>> = {
  spacefill: 'Spheres',
  orientation: 'Axes',
  target: 'Objects (the decoration)',
};

/** A cut of Prism's clipping, as `api.clipping.cuts` lists it */
type Cut = ViewerApi['clipping']['cuts']['value'][number];

export class ExplorerApi extends ApiArea {
  readonly id = 'explorer';

  private readonly picks = new Subject<CanvasClick>();
  /** The left-clicks on the canvas, what they picked and where (the tree follows them) */
  readonly clicks: Observable<CanvasClick> = this.picks.asObservable();
  private onClick?: (click: CanvasClick) => void;
  /**
   * An Apple platform: a distance's points are ⌘+clicks (Ctrl+click is a right-click there); elsewhere Ctrl+clicks.
   * The one place it is decided (the picker's messages read it); set by tests to check both.
   */
  mac = isMac();
  private readonly escapes = new Subject<void>();
  /** Esc pressed on the canvas, or selection mode left (a distance's first point is let go) */
  readonly escaped: Observable<void> = this.escapes.asObservable();
  private onReveal?: (key: string) => void;
  /** The point of a distance on show in 3D (marked as selected), until the second is picked */
  private marked: Loci = EmptyLoci;

  /** What a left-click on the canvas does (the tree follows it), for the viewer's life */
  setOnClick(on: (click: CanvasClick) => void) {
    this.onClick = on;
  }

  /** What `revealRow` does (the tree picks a row by its key, unfolding the way to it), for the viewer's life */
  setOnReveal(on: (key: string) => void) {
    this.onReveal = on;
  }

  /** Picks a row of the tree by its key, unfolding the way to it (a distance's properties go to its points' rows) */
  revealRow(key: string) {
    this.onReveal?.(key);
  }

  constructor(ctx: ApiAreaContext) {
    super(ctx);
    this.picks.subscribe((click) => this.onClick?.(click));
    ctx.plugin.behaviors.interaction.click.subscribe((e) => {
      if (e.button !== ButtonsType.Flag.Primary) return;
      this.picks.next({
        loci: e.current.loci,
        ...(e.page ? { x: e.page[0] - window.scrollX, y: e.page[1] - window.scrollY } : {}),
        // ⌘ on a Mac (Ctrl+click is a right-click there), Ctrl elsewhere (Ludovic, 2026-10-24)
        ...((this.mac ? e.modifiers.meta : e.modifiers.control) ? { measure: true } : {}),
      });
    });
    ctx.plugin.behaviors.interaction.key.subscribe((e) => {
      if (e.code === 'Escape') this.escapes.next();
    });
    let selecting = ctx.plugin.selectionMode;
    ctx.plugin.behaviors.interaction.selectionMode.subscribe((on) => {
      if (selecting && !on) this.escapes.next();
      selecting = on;
    });
  }

  /**
   * Where a label of a node goes, made from the tree: on the node; for a part of many particles (an entity's copies,
   * a group), on its particle nearest the camera (their center may be none of them); its radius, to stand in front
   */
  anchorOf(node: NodeRef): { readonly position: [number, number, number]; readonly radius: number } | undefined {
    const plugin = this.ctx.plugin;
    const loci = lociOf(plugin, node);
    if (Particle.isLoci(loci) && 'particles' in node) {
      const camera = plugin.canvas3d?.camera.state.position;
      const { coordinates, radii } = loci.particles;
      let best = -1;
      let bestD = Infinity;
      OrderedSet.forEach(loci.indices, (i) => {
        const d = camera
          ? (coordinates[3 * i] - camera[0]) ** 2 +
            (coordinates[3 * i + 1] - camera[1]) ** 2 +
            (coordinates[3 * i + 2] - camera[2]) ** 2
          : 0;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best < 0) return undefined;
      // its size: its own radius, else its object's (an entity's structure), else a few Å
      const target = loci.particles.targetMapping?.get(loci.particles.targets[best]);
      const objectRadius = target?.kind === 'structure' ? target.structure.boundary.sphere.radius : undefined;
      return {
        position: [coordinates[3 * best], coordinates[3 * best + 1], coordinates[3 * best + 2]],
        radius: radii?.[best] || objectRadius || 5,
      };
    }
    const b = this.boundsOf(node);
    return b ? { position: b.center, radius: b.radius } : undefined;
  }

  /** The objects of the scene by category, following the state tree while watched: a read for views */
  objectsState(): ReadonlyState<readonly SceneObject[]> {
    const plugin = this.ctx.plugin;
    return watchedState(
      () => sceneObjects(plugin),
      // a visibility change is a cell's state, not the tree's
      () => [plugin.state.data.events.changed, plugin.state.data.events.cell.stateUpdated],
      { compare: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
    );
  }

  /** What a node stands for in 3D (empty when nothing) */
  loci(node: NodeRef): Loci {
    return lociOf(this.ctx.plugin, node);
  }

  /** How a structure node looks (undefined: not a structure's), following the state tree while watched */
  structureLookState(node: NodeRef): ReadonlyState<StructureLook | undefined> {
    const plugin = this.ctx.plugin;
    return watchedState(
      () => structureLook(plugin, node),
      () => plugin.state.data.events.changed,
      { compare: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
    );
  }

  /** Shows or hides one representation of any kind (Prism's `representation.visibility` takes a structure's) */
  readonly representationVisibility = this.operation({
    id: 'explorer.representationVisibility',
    title: 'Show or hide a representation',
    params: {
      node: PD.Text('', { description: 'The state ref of the representation' }),
      visible: PD.Boolean(true),
    },
    async run({ node, visible }, ctx) {
      const cell = ctx.plugin.state.data.cells.get(node);
      if (!cell?.obj || !SO.isRepresentation3D(cell.obj)) {
        return ApiResult.fail('not-found', `There is no representation '${node}'.`);
      }
      if (!!cell.state.isHidden === !visible)
        return ApiResult.already(`It is already ${visible ? 'shown' : 'hidden'}.`);
      setSubtreeVisibility(ctx.plugin.state.data, node, !visible);
      return ApiResult.ok(`${visible ? 'Showed' : 'Hid'} ${cell.obj.label}.`, { nodes: [node] });
    },
  });

  /**
   * The representations of a particle list or a volume (spheres, orientation, its targets; slice, isosurface…), following
   * the state tree while watched
   */
  representationsState(ref: string): ReadonlyState<readonly RepresentationInfo[]> {
    const plugin = this.ctx.plugin;
    return watchedState(
      () => {
        const list = plugin.managers.particles.hierarchy.current.lists.find((l) => l.cell.transform.ref === ref);
        const reprs =
          list?.representations ??
          plugin.managers.volume.hierarchy.current.volumes.find((v) => v.cell.transform.ref === ref)?.representations ??
          [];
        return reprs.map((r) => ({
          ref: r.cell.transform.ref,
          // a list's as the explorer names them (Spheres, Axes, Objects)
          label: (list && ParticleTypeLabels[typeOf(r.cell.transform.params)]) || reprLabel(r.cell),
          type: typeOf(r.cell.transform.params),
          visible: !r.cell.state.isHidden,
        }));
      },
      () => [plugin.state.data.events.changed, plugin.state.data.events.cell.stateUpdated],
      { compare: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
    );
  }

  /**
   * What a particle list can be drawn as (its representation types, applicable to it), named as the explorer names
   * them: spheres, axes, the decorations' objects, …
   */
  particleTypes(ref: string): readonly { readonly type: string; readonly label: string }[] {
    const plugin = this.ctx.plugin;
    // the list as drawn (decorated: its objects can be drawn)
    const data = drawnObject({ plugin }, ref)?.data as ParticleList | undefined;
    if (!data) return [];
    return plugin.representation.particles.registry
      .getApplicableTypes(data)
      .map(([type, label]) => ({ type, label: ParticleTypeLabels[type] ?? label }));
  }

  /**
   * How a decorated list's objects are clipped (its target representations', the first one's): whole objects
   * (`instance`: a protein whose center is cut goes), whole elements (`element`: atoms, whose centers are cut, go),
   * or cut through (`pixel`, as made); undefined without objects drawn. Following the state tree while watched.
   */
  clipWholeState(ref: string): ReadonlyState<'instance' | 'element' | 'pixel' | undefined> {
    const plugin = this.ctx.plugin;
    return watchedState(
      () => {
        const params = targetRepresentations(plugin, ref)[0]?.transform.params as any;
        const p = params?.type?.params;
        if (!p) return undefined;
        if (p.clip?.variant === 'instance') return 'instance';
        return p.structure?.clipPrimitive ? 'element' : 'pixel';
      },
      () => plugin.state.data.events.changed,
    );
  }

  readonly clipWhole = this.operation({
    id: 'explorer.clipWhole',
    title: "Clip a list's objects whole, or their atoms",
    params: {
      particles: PD.Text('', { description: 'The state ref of the particle list (or mesoscale model)' }),
      whole: PD.Select<'instance' | 'element'>('instance', [
        ['instance', 'Objects (proteins): one whose center is cut goes whole'],
        ['element', 'Elements (atoms): each whose center is cut goes whole'],
      ]),
    },
    async run({ particles, whole }, ctx) {
      const cells = targetRepresentations(ctx.plugin, particles);
      if (!cells.length) return ApiResult.fail('not-found', 'It draws no objects.', 'Decorate its particles first.');
      const b = ctx.plugin.state.data.build();
      let changed = 0;
      for (const cell of cells) {
        const p = (cell.transform.params as any).type.params;
        const variant = whole === 'instance' ? 'instance' : 'pixel';
        const clipPrimitive = whole === 'element' ? true : !!p.structure?.clipPrimitive;
        if (p.clip?.variant === variant && !!p.structure?.clipPrimitive === clipPrimitive) continue;
        b.to(cell).update((old: any) => ({
          ...old,
          type: {
            ...old.type,
            params: {
              ...old.type.params,
              clip: { ...old.type.params.clip, variant },
              structure: { ...old.type.params.structure, clipPrimitive },
            },
          },
        }));
        changed++;
      }
      if (!changed)
        return ApiResult.already(`Its ${whole === 'instance' ? 'objects' : 'atoms'} are already clipped whole.`);
      await b.commit();
      return ApiResult.ok(`Clips its ${whole === 'instance' ? 'objects' : 'atoms'} whole.`, {
        nodes: cells.map((c) => c.transform.ref),
      });
    },
  });

  /** A representation's params as its transform defines them, and their values: for a form */
  representationForm(ref: string): { readonly params: PD.Params; readonly values: PD.Values<PD.Params> } | undefined {
    const { cells } = this.ctx.plugin.state.data;
    const cell = cells.get(ref);
    if (!cell) return undefined;
    const parent = cells.get(cell.transform.parent);
    const params = cell.transform.transformer.definition.params?.(parent?.obj as never, this.ctx.plugin) as
      | PD.Params
      | undefined;
    return params ? { params, values: cell.transform.params as PD.Values<PD.Params> } : undefined;
  }

  /** The representation presets that apply to a structure: [id, name] */
  presets(ref: string): [string, string][] {
    const plugin = this.ctx.plugin;
    const obj = plugin.state.data.cells.get(ref)?.obj;
    if (!SO.Molecule.Structure.is(obj)) return [];
    return plugin.builders.structure.representation
      .getPresets(obj)
      .map((p) => [p.id, p.display.name] as [string, string]);
  }

  /**
   * What a 3D pick is in the tree, at the selection's granularity (a structure, an entity, a chain; a model, an entity;
   * a list, a target; a volume; a mesh): its row's key, name, kind and node; undefined when it is none of them
   */
  pickedOf(loci: Loci): PickedNode | undefined {
    return pickedOf(this.ctx.plugin, loci);
  }

  /** Where a node is: the sphere around it (a label is put in front of it) */
  boundsOf(node: NodeRef): { readonly center: [number, number, number]; readonly radius: number } | undefined {
    const loci = lociOf(this.ctx.plugin, node);
    const sphere = loci.kind === 'empty-loci' ? undefined : Loci.getBoundingSphere(loci);
    if (!sphere) return undefined;
    return { center: [sphere.center[0], sphere.center[1], sphere.center[2]], radius: sphere.radius };
  }

  /** Whether a cell is under another in the state tree (one of an object's representations) */
  isUnder(ref: string, ancestor: string): boolean {
    const { tree } = this.ctx.plugin.state.data;
    for (let r: string | undefined = ref; r; r = tree.transforms.get(r)?.parent) {
      if (r === ancestor) return true;
      if (r === StateTransform.RootRef) return false;
    }
    return false;
  }

  /** The file or entry an object came from: its root cell (removing it removes the object) */
  entryOf(ref: string): string {
    const { tree } = this.ctx.plugin.state.data;
    let root = ref;
    for (;;) {
      const parent = tree.transforms.get(root)?.parent;
      if (!parent || parent === StateTransform.RootRef) return root;
      root = parent;
    }
  }

  /**
   * Of Prism's cuts, those a row lists: an object's, every cut through its representations (a part's too); a
   * structure entity's or chain's, the cuts of its atoms and no others (`clipping.add` `only`); a model's or list's
   * group's, entity's or target's, the cuts of exactly its particles (`clipping.add` `particles`)
   */
  cutsOf(cuts: readonly Cut[], node: NodeRef): Cut[] {
    const under = cuts.filter((c) => c.object.tag && c.targets.some((t) => this.isUnder(t.ref, node.ref)));
    if ('particles' in node) {
      const ids = (a: readonly number[] | undefined) => [...(a ?? [])].sort((x, y) => x - y).join(',');
      const p = node.particles;
      return under.filter((c) => {
        const s = c.particles?.selector;
        return (
          !!s &&
          ids(s.entities) === ids(p.entities) &&
          ids(s.compartments) === ids(p.compartments) &&
          ids(s.targets) === ids(p.targets)
        );
      });
    }
    if (!('entity' in node)) return under;
    const loci = this.loci(node);
    if (!StructureElement.Loci.is(loci)) return [];
    const part = StructureElement.Loci.remap(loci, loci.structure.root);
    return under.filter(
      (c) =>
        c.atoms?.loci.length === 1 &&
        c.atoms.loci[0].structure === part.structure &&
        StructureElement.Loci.areEqual(c.atoms.loci[0], part),
    );
  }

  /** How the handles are drawn on the canvas (all of them: Prism's and the stage's), following changes */
  handleLookState(): ReadonlyState<GizmoLook> {
    const canvas = this.ctx.plugin.canvas3d;
    if (!canvas) return observableState(GizmoAppearance.Default).asReadonly;
    return watchedState(
      () => GizmoAppearance.of(canvas),
      () => GizmoAppearance.state(canvas),
    );
  }

  /** The handles drawn bigger or smaller (their scale), every set of them on the canvas */
  setHandleLook(look: Partial<GizmoLook>) {
    const canvas = this.ctx.plugin.canvas3d;
    if (canvas) GizmoAppearance.set(canvas, look);
  }

  /**
   * A distance's point from a pick, at the selection's granularity (an atom, a residue, a chain, an instance; a
   * particle; a bond: its atoms), as the row it is listed under (`pickedOf`)
   */
  measurePoint(loci: Loci): Loci {
    return Loci.normalize(loci, this.ctx.plugin.managers.interactivity.props.granularity, true);
  }

  /** Whether the canvas is in selection mode (its button under the 3D view): where Ctrl or ⌘ + click measures */
  get selectionMode(): boolean {
    return this.ctx.plugin.selectionMode;
  }

  /**
   * Marks a distance's first point in 3D as selected, the one marked before unmarked (none: unmarks). The selection
   * manager is not told (the person's selection stays as it is); what the unmark took of a structure's selection is
   * marked again. A particle selection is marks only (no state to put back): one under the point loses its mark.
   */
  markPoint(loci: Loci | undefined) {
    const plugin = this.ctx.plugin;
    const canvas = plugin.canvas3d;
    if (canvas && !isEmptyLoci(this.marked)) {
      canvas.mark({ loci: this.marked }, MarkerAction.Deselect);
      if (StructureElement.Loci.is(this.marked)) {
        const selected = plugin.managers.structure.selection.getLoci(this.marked.structure);
        if (!isEmptyLoci(selected)) canvas.mark({ loci: selected }, MarkerAction.Select);
      }
    }
    this.marked = loci ?? EmptyLoci;
    if (canvas && loci && !isEmptyLoci(loci)) canvas.mark({ loci }, MarkerAction.Select);
  }

  /** The particle a pick is on: its list (state ref) and its index there; none for anything else */
  particleOf(loci: Loci): { readonly list: string; readonly index: number } | undefined {
    if (!Particle.isLoci(loci) || OrderedSet.size(loci.indices) === 0) return undefined;
    const lists = this.ctx.plugin.managers.particles.hierarchy.current.lists;
    const l = lists.find(
      (x) =>
        x.cell.obj?.data === loci.particles ||
        x.representations.some((r) => r.cell.obj?.data.sourceData === loci.particles),
    );
    return l ? { list: l.cell.transform.ref, index: OrderedSet.getAt(loci.indices, 0) } : undefined;
  }

  /** A particle's kind: its target's id as drawn (its class, its entity's target), as offsets key it */
  particleKind(list: string, index: number): string {
    const l = this.ctx.plugin.managers.particles.hierarchy.current.lists.find((x) => x.cell.transform.ref === list);
    const data = l?.representations[0]?.cell.obj?.data.sourceData ?? l?.cell.obj?.data;
    return data && index < data.count ? String(data.targets[index]) : '';
  }

  /** The canvas element (a drag in 3D is measured on it) */
  canvasElement(): HTMLElement | undefined {
    return this.ctx.plugin.canvas3dContext?.canvas ?? undefined;
  }

  /** Highlights a node in 3D (none: clears) */
  highlight(node: NodeRef | undefined) {
    const plugin = this.ctx.plugin;
    plugin.managers.interactivity.lociHighlights.clearHighlights();
    if (!node) return;
    const loci = lociOf(plugin, node);
    if (loci.kind !== 'empty-loci') plugin.managers.interactivity.lociHighlights.highlightOnly({ loci });
  }

  /** The camera on a node */
  focus(node: NodeRef) {
    const plugin = this.ctx.plugin;
    const cell = plugin.state.data.cells.get(node.ref);
    // a distance: its two points
    if (SO.Shape.Representation3D.is(cell?.obj) && isStageDistanceData(cell.obj.data.sourceData)) {
      plugin.managers.camera.focusLoci([...cell.obj.data.sourceData.pairs[0].loci]);
      return;
    }
    if (SO.Volume.Data.is(cell?.obj)) {
      const drawn = drawnObject({ plugin }, node.ref);
      plugin.managers.camera.focusSphere(
        Grid.getBoundingSphere((SO.Volume.Data.is(drawn) ? drawn : cell.obj).data.grid),
      );
      return;
    }
    const sphere = this.focusSphereOf(node);
    if (sphere) {
      plugin.managers.camera.focusSphere(sphere);
      return;
    }
    const loci = lociOf(plugin, node);
    if (loci.kind !== 'empty-loci') plugin.managers.camera.focusLoci(loci);
  }

  /**
   * What a focus on particles frames: their points' sphere grown by the largest object drawn on them (a particle is a
   * point; a crambin on it is not: framed as points, the camera comes in too close and the objects are cut); undefined
   * for anything else (its loci's own bounds)
   */
  focusSphereOf(node: NodeRef): Sphere3D | undefined {
    const loci = lociOf(this.ctx.plugin, node);
    if (!Particle.isLoci(loci) || Particle.isLociEmpty(loci)) return undefined;
    const points = Particle.getBoundingSphere(loci);
    const mapping = loci.particles.targetMapping;
    let reach = 0;
    if (mapping) {
      const seen = new Set<number>();
      OrderedSet.forEach(loci.indices, (i) => {
        const t = loci.particles.targets[i];
        if (seen.has(t)) return;
        seen.add(t);
        reach = Math.max(reach, decorationRadius(mapping.get(t)));
      });
    }
    return Sphere3D.create(points.center, points.radius + reach);
  }
}

// --- the objects ---------------------------------------------------------------------------------------------------

function sceneObjects(plugin: PluginContext): SceneObject[] {
  const out: SceneObject[] = [];
  const ctx = { plugin };
  for (const s of loadedStructures(ctx)) {
    const data = s.cell.obj?.data;
    out.push({
      ref: s.cell.transform.ref,
      category: 'structures',
      kind: 'structure',
      label: labelOf(ctx, s),
      ...(data ? { count: `${data.elementCount.toLocaleString('en')} atoms`, entities: entitiesOf(data) } : {}),
      visible: !s.cell.state.isHidden,
    });
  }
  for (const l of plugin.managers.particles.hierarchy.current.lists) {
    const data = l.cell.obj?.data;
    const model = !!(data?.entityInfo?.size || data?.compartmentInfo?.size);
    out.push({
      ref: l.cell.transform.ref,
      category: 'particles',
      kind: model ? 'model' : 'list',
      label: fileLabel(plugin, l.cell.transform.ref) ?? l.cell.obj?.label ?? l.cell.transform.ref,
      ...(data ? { count: `${data.count.toLocaleString('en')} particles` } : {}),
      visible: !l.cell.state.isHidden,
    });
  }
  for (const v of plugin.managers.volume.hierarchy.current.volumes) {
    const dims = v.cell.obj?.data.grid.cells.space.dimensions;
    out.push({
      ref: v.cell.transform.ref,
      category: 'volumes',
      kind: 'volume',
      label: v.cell.obj?.label ?? v.cell.transform.ref,
      ...(dims ? { count: dims.join(' × ') } : {}),
      visible: !v.cell.state.isHidden,
      representations: v.representations.map((r) => ({
        ref: r.cell.transform.ref,
        label: reprLabel(r.cell),
        type: isOblique(r.cell.transform.params) ? 'oblique slice' : typeOf(r.cell.transform.params),
        visible: !r.cell.state.isHidden,
      })),
    });
  }
  for (const m of meshes(plugin)) out.push(m);
  return out;
}

/** A slice on a plane (an oblique slice), not along the grid */
function isOblique(params: unknown): boolean {
  const p = params as { type?: { name?: string; params?: { mode?: string } } } | undefined;
  return p?.type?.name === 'slice' && p.type.params?.mode === 'plane';
}

/** A representation's name: a slice's with its axis (Slice X), an oblique slice's, else its own */
function reprLabel(cell: { obj?: { label: string }; transform: { params?: unknown } }): string {
  if (isOblique(cell.transform.params)) return 'Oblique slice';
  const p = cell.transform.params as { type?: { name?: string; params?: { dimension?: { name?: string } } } };
  const axis = p?.type?.name === 'slice' ? p.type.params?.dimension?.name : undefined;
  if (axis && 'xyz'.includes(axis)) return `Slice ${axis.toUpperCase()}`;
  return cell.obj?.label ?? 'Representation';
}

/** A representation's type (its params' `type.name`) */
function typeOf(params: unknown): string {
  return (params as { type?: { name?: string } } | undefined)?.type?.name ?? '';
}

/** The radius of what decorates a target (its structure's, volume's, shape's), 0 for none */
function decorationRadius(target: ParticleTarget | undefined): number {
  if (!target) return 0;
  if (target.kind === 'structure') return target.structure.boundary.sphere.radius;
  if (target.kind === 'volume') return Grid.getBoundingSphere(target.volume.grid).radius;
  return (target.shape.geometry as { boundingSphere?: { radius: number } }).boundingSphere?.radius ?? 0;
}

/** A particle list's target representations (what draws its decorations' objects) */
function targetRepresentations(plugin: PluginContext, ref: string) {
  const l = plugin.managers.particles.hierarchy.current.lists.find((x) => x.cell.transform.ref === ref);
  return (l?.representations ?? [])
    .map((r) => r.cell)
    .filter((c) => (c.transform.params as { type?: { name?: string } })?.type?.name === 'target');
}

/** The name of the file or entry an object came from: its root data's label */
function fileLabel(plugin: PluginContext, ref: string): string | undefined {
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

/** The shape representations of meshes loaded from files (not the shapes the viewer makes itself) */
function meshes(plugin: PluginContext): SceneObject[] {
  const { cells, tree } = plugin.state.data;
  const out: SceneObject[] = [];
  for (const cell of cells.values()) {
    if (cell.state.isGhost || !SO.Shape.Representation3D.is(cell.obj)) continue;
    // a mesh file's shape: its root is the file's data, and no model is on the way (a unit cell is a model's shape)
    let root = cell.transform.ref;
    let ofModel = false;
    for (;;) {
      const parent = tree.transforms.get(root)?.parent;
      if (!parent || parent === StateTransform.RootRef) break;
      root = parent;
      // a model's shape (a unit cell), a particle list's (its simulation box), or a representation's (a cut's drawing,
      // Prism's clip volumes)
      const up = cells.get(root)?.obj;
      if (SO.Molecule.Model.is(up) || SO.Particle.List.is(up) || SO.isRepresentation3D(up)) ofModel = true;
    }
    if (ofModel) continue;
    const data = cells.get(root)?.obj;
    if (!SO.Data.String.is(data) && !SO.Data.Binary.is(data) && !SO.Data.Response.is(data)) continue;
    out.push({
      ref: cell.transform.ref,
      category: 'meshes',
      kind: 'mesh',
      label: data.label,
      visible: !cell.state.isHidden,
    });
  }
  return out;
}

/** A structure's entities (mmCIF `entity`), each with its chains (`label_asym_id`) */
function entitiesOf(structure: Structure): StructureEntity[] {
  const model = structure.models[0];
  if (!model) return [];
  const { entities } = model;
  const { chains } = model.atomicHierarchy;
  const byEntity = new Map<string, string[]>();
  for (let i = 0, n = chains._rowCount; i < n; ++i) {
    const e = chains.label_entity_id.value(i);
    let list = byEntity.get(e);
    if (!list) byEntity.set(e, (list = []));
    const asym = chains.label_asym_id.value(i);
    if (!list.includes(asym)) list.push(asym);
  }
  const out: StructureEntity[] = [];
  for (let i = 0, n = entities.data._rowCount; i < n; ++i) {
    const id = entities.data.id.value(i);
    const chainIds = byEntity.get(id) ?? [];
    if (!chainIds.length) continue;
    const description = entities.data.pdbx_description.value(i)?.[0];
    out.push({ id, label: description || `Entity ${id}`, chains: chainIds });
  }
  return out;
}

// --- a 3D pick in the tree ------------------------------------------------------------------------------------------

function pickedOf(plugin: PluginContext, loci: Loci): PickedNode | undefined {
  if (loci.kind === 'empty-loci') return undefined;
  const granularity = plugin.managers.interactivity.props.granularity;
  const whole = granularity === 'structure' || granularity === 'model' || granularity === 'operator';
  if (StructureElement.Loci.is(loci) && !StructureElement.Loci.isEmpty(loci)) {
    // the structure's cell may have decorators on it (custom properties): up to the structure the tree lists
    const structures = plugin.managers.structure.hierarchy.current.structures;
    const tree = plugin.state.data.tree;
    let ref: string | undefined = plugin.helpers.substructureParent.get(loci.structure)?.transform.ref;
    let s = undefined as (typeof structures)[number] | undefined;
    while (ref && !(s = structures.find((x) => x.cell.transform.ref === ref))) ref = tree.transforms.get(ref)?.parent;
    const structure = s?.cell.obj?.data;
    if (!s || !structure) return undefined;
    ref = s.cell.transform.ref;
    const label = labelOf({ plugin }, s);
    if (whole) return { key: `o:${ref}`, label, kind: 'structure', node: { ref } };
    // its first element: the entity and the chain it is in (label ids, as the tree's rows)
    const e = loci.elements[0];
    const loc = StructureElement.Location.create(
      loci.structure,
      e.unit,
      e.unit.elements[OrderedSet.getAt(e.indices, 0)],
    );
    const entity = StructureProperties.entity.id(loc);
    const chain = StructureProperties.chain.label_asym_id(loc);
    const info = entitiesOf(structure).find((x) => x.id === entity);
    if (!info) return { key: `o:${ref}`, label, kind: 'structure', node: { ref } };
    if (granularity === 'entity' || info.chains.length < 2) {
      return { key: `e:${ref}:${entity}`, label: info.label, kind: 'entity', node: { ref, entity } };
    }
    return {
      key: `ch:${ref}:${entity}:${chain}`,
      label: `Chain ${chain}`,
      kind: 'chain',
      node: { ref, entity, chain },
    };
  }
  if (Particle.isLoci(loci)) {
    for (const l of plugin.managers.particles.hierarchy.current.lists) {
      const datas = [l.cell.obj?.data, ...l.representations.map((r) => r.cell.obj?.data.sourceData)];
      if (!datas.includes(loci.particles)) continue;
      const ref = l.cell.transform.ref;
      const data = l.cell.obj!.data;
      const model = !!(data.entityInfo?.size || data.compartmentInfo?.size);
      const label = fileLabel(plugin, ref) ?? l.cell.obj!.label;
      const kind = model ? 'mesoscale model' : 'particle list';
      if (whole) return { key: `o:${ref}`, label, kind, node: { ref } };
      const i = OrderedSet.getAt(loci.indices, 0);
      const target = loci.particles.targets[i];
      if (model) {
        const entity = Particle.entityOf(loci.particles, i);
        const name = data.entityInfo?.get(entity)?.name ?? `Entity ${entity}`;
        return {
          key: `me:${ref}:${entity}`,
          label: name,
          kind: 'entity',
          node: { ref, particles: { entities: [entity] } },
        };
      }
      const name = loci.particles.targetInfo.get(target)?.name ?? `Target ${target}`;
      return {
        key: `t:${ref}:${target}`,
        label: name,
        kind: 'target',
        node: { ref, particles: { targets: [target] } },
      };
    }
    return undefined;
  }
  if (
    Volume.isLoci(loci) ||
    Volume.Isosurface.isLoci(loci) ||
    Volume.Cell.isLoci(loci) ||
    Volume.Segment.isLoci(loci)
  ) {
    const v = plugin.managers.volume.hierarchy.current.volumes.find((x) => x.cell.obj?.data === loci.volume);
    if (!v) return undefined;
    const ref = v.cell.transform.ref;
    return { key: `o:${ref}`, label: v.cell.obj?.label ?? ref, kind: 'volume', node: { ref } };
  }
  // a distance of the stage, its line (its text is not pickable): its row (under its first point's)
  if (ShapeGroup.isLoci(loci) && isStageDistanceData(loci.shape.sourceData)) {
    for (const cell of plugin.state.data.cells.values()) {
      const obj = cell.obj;
      if (!SO.Shape.Representation3D.is(obj) || obj.data.sourceData !== loci.shape.sourceData) continue;
      return { key: `d:${cell.transform.ref}`, label: obj.label, kind: 'distance', node: { ref: cell.transform.ref } };
    }
    return undefined;
  }
  // a label of the stage: its row (under the node it was made at)
  if (ShapeGroup.isLoci(loci) && isStageLabelData(loci.shape.sourceData)) {
    for (const cell of plugin.state.data.cells.values()) {
      const obj = cell.obj;
      if (!SO.Shape.Provider.is(obj) || obj.data.data !== loci.shape.sourceData) continue;
      const ref = cell.transform.ref;
      return { key: `l:${ref}`, label: loci.shape.sourceData.text, kind: 'label', node: { ref } };
    }
    return undefined;
  }
  // a mesh's shape, picked in a group or whole (its visuals' loci are whole: `Shape.Loci`, its surface's or wireframe's)
  if (ShapeGroup.isLoci(loci) || Shape.isLoci(loci)) {
    const mesh = meshes(plugin).find((m) => {
      const obj = plugin.state.data.cells.get(m.ref)?.obj;
      return (
        SO.Shape.Representation3D.is(obj) &&
        obj.data.repr.getAllLoci().some((l) => (Shape.isLoci(l) || ShapeGroup.isLoci(l)) && l.shape === loci.shape)
      );
    });
    if (mesh) return { key: `o:${mesh.ref}`, label: mesh.label, kind: 'mesh', node: { ref: mesh.ref } };
  }
  return undefined;
}

// --- a structure's look ----------------------------------------------------------------------------------------------

/**
 * A structure node's color, transparency and emissive: on its representations, the last layer of each kind that
 * covers all of the node (a later layer paints over an earlier one; one that covers only part of it does not say how
 * all of it looks)
 */
function structureLook(plugin: PluginContext, node: NodeRef): StructureLook | undefined {
  const s = plugin.managers.structure.hierarchy.current.structures.find((x) => x.cell.transform.ref === node.ref);
  const structure = s?.cell.obj?.data;
  if (!s || !structure) return undefined;
  const loci = lociOf(plugin, node);
  if (!StructureElement.Loci.is(loci) || StructureElement.Loci.isEmpty(loci)) return undefined;
  let color: number | undefined;
  let transparency = 0;
  let emissive = 0;
  const { cells, tree } = plugin.state.data;
  const covers = (bundle: StructureElement.Bundle) =>
    StructureElement.Loci.isSubset(StructureElement.Bundle.toLoci(bundle, structure), loci);
  // every representation (a ligand is in its own component): their layers, in order
  for (const repr of s.components.flatMap((c) => c.representations)) {
    for (const ref of tree.children.get(repr.cell.transform.ref).toArray()) {
      const t = cells.get(ref)?.transform;
      if (!t) continue;
      const layers = (t.params as { layers?: readonly Record<string, any>[] } | undefined)?.layers ?? [];
      for (const layer of layers) {
        if (!covers(layer.bundle)) continue;
        if (t.transformer === OverpaintStructureRepresentation3DFromBundle)
          color = layer.clear ? undefined : layer.color;
        else if (t.transformer === TransparencyStructureRepresentation3DFromBundle) transparency = layer.value;
        else if (t.transformer === EmissiveStructureRepresentation3DFromBundle) emissive = layer.value;
      }
    }
  }
  return { ...(color !== undefined ? { color } : {}), transparency, emissive };
}

// --- the 3D side ----------------------------------------------------------------------------------------------------

/** The loci of a node: its object's, or its part's */
function lociOf(plugin: PluginContext, node: NodeRef): Loci {
  const cell = plugin.state.data.cells.get(node.ref);
  const obj = cell?.obj;
  if (SO.Molecule.Structure.is(obj)) {
    // the structure as drawn: moved by its transform, if it has one
    const moved = plugin.managers.structure.hierarchy.current.structures.find((x) => x.cell.transform.ref === node.ref)
      ?.transform?.cell.obj?.data;
    const structure = moved ?? obj.data;
    if ('entity' in node) {
      const selection = Script.getStructureSelection(
        (Q) =>
          Q.struct.generator.atomGroups({
            'entity-test': Q.core.rel.eq([Q.struct.atomProperty.macromolecular.label_entity_id(), node.entity]),
            ...(node.chain
              ? { 'chain-test': Q.core.rel.eq([Q.struct.atomProperty.macromolecular.label_asym_id(), node.chain]) }
              : {}),
          }),
        structure,
      );
      return StructureSelection.toLociWithSourceUnits(selection);
    }
    return Structure.toStructureElementLoci(structure);
  }
  if (SO.Particle.List.is(obj)) {
    const l = plugin.managers.particles.hierarchy.current.lists.find((x) => x.cell.transform.ref === node.ref);
    // the particles as drawn: with their decorations (targets by class)
    const data: ParticleList = l?.representations[0]?.cell.obj?.data.sourceData ?? obj.data;
    if ('particles' in node) return Particle.selectLoci(data, node.particles);
    return Particle.Loci(data, OrderedSet.ofBounds(0, data.count));
  }
  if (SO.Volume.Data.is(obj)) {
    // the volume as drawn (moved by its transform, if any)
    const drawn = drawnObject({ plugin }, node.ref);
    const volume = SO.Volume.Data.is(drawn) ? drawn.data : obj.data;
    return Volume.Loci(volume, OrderedSet.ofSingleton(0 as never));
  }
  if (SO.Shape.Representation3D.is(obj)) return obj.data.repr.getAllLoci()[0] ?? EmptyLoci;
  // a label: its shape's (the representation under it)
  if (SO.Shape.Provider.is(obj)) {
    for (const child of plugin.state.data.tree.children.get(node.ref).toArray()) {
      const c = plugin.state.data.cells.get(child)?.obj;
      if (SO.Shape.Representation3D.is(c)) return c.data.repr.getAllLoci()[0] ?? EmptyLoci;
    }
  }
  return EmptyLoci;
}
