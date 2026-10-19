/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { OrderedSet } from '@molstar/core/data/int';
import { ButtonsType } from '@molstar/core/util/input/input-observer';
import { type Observable, Subject } from 'rxjs';
import { EmptyLoci, type Loci } from '@molstar/model/model/loci';
import { Particle, type ParticleList } from '@molstar/model/model/particles/particle-list';
import { Structure, StructureElement, StructureProperties, StructureSelection } from '@molstar/model/model/structure';
import { ShapeGroup } from '@molstar/model/model/shape';
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
import { watchedState } from '@molstar/prism-viewer/sources/watched';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';

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
    /** isosurface, slice, direct-volume… */
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

/** A 3D pick as a row of the tree */
export interface PickedNode {
  readonly key: string;
  readonly label: string;
  readonly kind: string;
  readonly node: NodeRef;
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

export class ExplorerApi extends ApiArea {
  readonly id = 'explorer';

  private readonly picks = new Subject<Loci>();
  /** The left-clicks on the canvas, what they picked (the tree follows them) */
  readonly clicks: Observable<Loci> = this.picks.asObservable();

  constructor(ctx: ApiAreaContext) {
    super(ctx);
    ctx.plugin.behaviors.interaction.click.subscribe((e) => {
      if (e.button === ButtonsType.Flag.Primary) this.picks.next(e.current.loci);
    });
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
        const reprs =
          plugin.managers.particles.hierarchy.current.lists.find((l) => l.cell.transform.ref === ref)
            ?.representations ??
          plugin.managers.volume.hierarchy.current.volumes.find((v) => v.cell.transform.ref === ref)?.representations ??
          [];
        return reprs.map((r) => ({
          ref: r.cell.transform.ref,
          label: reprLabel(r.cell),
          type: typeOf(r.cell.transform.params),
          visible: !r.cell.state.isHidden,
        }));
      },
      () => [plugin.state.data.events.changed, plugin.state.data.events.cell.stateUpdated],
      { compare: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
    );
  }

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
    if (SO.Volume.Data.is(cell?.obj)) {
      plugin.managers.camera.focusSphere(Grid.getBoundingSphere(cell.obj.data.grid));
      return;
    }
    const loci = lociOf(plugin, node);
    if (loci.kind !== 'empty-loci') plugin.managers.camera.focusLoci(loci);
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
        type: typeOf(r.cell.transform.params),
        visible: !r.cell.state.isHidden,
      })),
    });
  }
  for (const m of meshes(plugin)) out.push(m);
  return out;
}

/** A representation's name: a slice's with its axis (Slice X), else its own */
function reprLabel(cell: { obj?: { label: string }; transform: { params?: unknown } }): string {
  const p = cell.transform.params as { type?: { name?: string; params?: { dimension?: { name?: string } } } };
  const axis = p?.type?.name === 'slice' ? p.type.params?.dimension?.name : undefined;
  if (axis && 'xyz'.includes(axis)) return `Slice ${axis.toUpperCase()}`;
  return cell.obj?.label ?? 'Representation';
}

/** A representation's type (its params' `type.name`) */
function typeOf(params: unknown): string {
  return (params as { type?: { name?: string } } | undefined)?.type?.name ?? '';
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
  return SO.Data.String.is(data) || SO.Data.Binary.is(data) ? data.label : undefined;
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
      if (SO.Molecule.Model.is(cells.get(root)?.obj)) ofModel = true;
    }
    if (ofModel) continue;
    const data = cells.get(root)?.obj;
    if (!SO.Data.String.is(data) && !SO.Data.Binary.is(data)) continue;
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
  if (ShapeGroup.isLoci(loci)) {
    const mesh = meshes(plugin).find((m) => {
      const obj = plugin.state.data.cells.get(m.ref)?.obj;
      return (
        SO.Shape.Representation3D.is(obj) &&
        obj.data.repr.getAllLoci().some((l) => ShapeGroup.isLoci(l) && l.shape === loci.shape)
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
    const structure = obj.data;
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
  if (SO.Volume.Data.is(obj)) return Volume.Loci(obj.data, OrderedSet.ofSingleton(0 as never));
  if (SO.Shape.Representation3D.is(obj)) return obj.data.repr.getAllLoci()[0] ?? EmptyLoci;
  return EmptyLoci;
}
