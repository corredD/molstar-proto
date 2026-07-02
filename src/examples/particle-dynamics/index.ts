/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 *
 * Interactive particle dynamics demo: a synthetic particle cloud whose positions/orientations are
 * updated live by a CPU stepper each frame (computed, not played back) and pushed into the instanced
 * particle representation in place via `updateParticleRenderObjectTransforms`. This is the plumbing
 * for a physics-engine-driven particle shape; the trivial stepper is meant to be swapped for a real
 * solver (XPBD / position-based dynamics) behind the same `ParticleDynamics` interface.
 */

import * as React from 'react';
import { createPluginUI } from '../../mol-plugin-ui';
import { PluginReactContext } from '../../mol-plugin-ui/base';
import { PluginUIContext } from '../../mol-plugin-ui/context';
import { PluginContext } from '../../mol-plugin/context';
import { renderReact18 } from '../../mol-plugin-ui/react18';
import { DefaultPluginUISpec } from '../../mol-plugin-ui/spec';
import { RecipePanel } from './recipe-panel';
import { ParticleRecipe, ParticleRecipeEntry } from './recipe';
import { PluginStateObject as SO, PluginStateTransform } from '../../mol-plugin-state/objects';
import { StateTransforms } from '../../mol-plugin-state/transforms';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { ParticleList, Particle, ParticleTarget } from '../../mol-model/particles/particle-list';
import { ParticleDynamicsParams, ParticleDynamicsProps, particleRigidShapeOffsets } from '../../mol-model/particles/dynamics';
import { AnimateParticleDynamics } from '../../mol-plugin-state/animation/built-in/particle-dynamics';
import { CustomProperties } from '../../mol-model/custom-property';
import { ModelFormat } from '../../mol-model-formats/format';
import { Structure } from '../../mol-model/structure';
import { Volume, Grid } from '../../mol-model/volume';
import { Mesh } from '../../mol-geo/geometry/mesh/mesh';
import { MeshSurface } from '../../mol-math/geometry/mesh-surface';
import { Column, Table } from '../../mol-data/db';
import { ElementSymbol, MoleculeType } from '../../mol-model/structure/model/types';
import { BasicSchema, createBasic } from '../../mol-model-formats/structure/basic/schema';
import { createModels } from '../../mol-model-formats/structure/basic/parser';
import { EntityBuilder } from '../../mol-model-formats/structure/common/entity';
import { ComponentBuilder } from '../../mol-model-formats/structure/common/component';
import { StateSelection } from '../../mol-state';
import { Vec3, Quat, Mat4 } from '../../mol-math/linear-algebra';
import { RuntimeContext, Task } from '../../mol-task';
import './index.html';
import '../../mol-plugin-ui/skin/light.scss';

/** The rigid-body collision-cluster shapes the dynamics can use. */
type RigidShape = 'none' | 'cube' | 'tube';
/** Uniform collision/visual sphere radius used by the rigid-shape demo. */
const RIGID_RADIUS = 10;

/**
 * Build a tiny reference structure of `n` spheres at `offsets` (one carbon per sphere). This is the
 * shape the `target` representation instances at every particle's position+orientation; the demo
 * renders the clusters via `spacefill` (`showRigidClusters`), but the structure is still attached as a
 * target so you can switch to the `target` representation to see the same clusters as real structures.
 */
async function buildClusterStructure(ctx: RuntimeContext, offsets: Float32Array): Promise<Structure> {
    const n = offsets.length / 3;
    const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n);
    for (let i = 0; i < n; ++i) { x[i] = offsets[i * 3]; y[i] = offsets[i * 3 + 1]; z[i] = offsets[i * 3 + 2]; }

    const MOL = Column.ofConst('MOL', n, Column.Schema.str);
    const A = Column.ofConst('A', n, Column.Schema.str);
    const type_symbol = Column.ofConst(ElementSymbol('C'), n, Column.Schema.Aliased<ElementSymbol>(Column.Schema.str));
    const seq_id = Column.ofConst(1, n, Column.Schema.int);
    const atom_site = Table.ofPartialColumns(BasicSchema.atom_site, {
        auth_asym_id: A, auth_atom_id: type_symbol, auth_comp_id: MOL, auth_seq_id: seq_id,
        Cartn_x: Column.ofFloatArray(x), Cartn_y: Column.ofFloatArray(y), Cartn_z: Column.ofFloatArray(z),
        id: Column.range(0, n - 1),
        label_asym_id: A, label_atom_id: type_symbol, label_comp_id: MOL, label_seq_id: seq_id,
        label_entity_id: Column.ofConst('1', n, Column.Schema.str),
        occupancy: Column.ofConst(1, n, Column.Schema.float),
        type_symbol,
        pdbx_PDB_model_num: Column.ofConst(1, n, Column.Schema.int),
    }, n);

    const entityBuilder = new EntityBuilder();
    entityBuilder.setNames([['MOL', 'Rigid cluster']]);
    entityBuilder.getEntityId('MOL', MoleculeType.Unknown, 'A');
    const componentBuilder = new ComponentBuilder(seq_id, type_symbol);
    componentBuilder.setNames([['MOL', 'Rigid cluster']]);
    componentBuilder.add('MOL', 0);

    const basic = createBasic({ entity: entityBuilder.getEntityTable(), chem_comp: componentBuilder.getChemCompTable(), atom_site });
    const format = { kind: 'cluster', name: 'rigid-cluster', data: {} } as unknown as ModelFormat;
    const trajectory = await createModels(basic, format, ctx);
    return Structure.ofModel(trajectory.representative);
}

/** Small deterministic PRNG so the demo cloud is reproducible. */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Synthesize a particle cloud: random positions in a cube, random orientations and radii. */
function makeParticles(count: number, box: number): ParticleList {
    const coordinates = new Float32Array(count * 3);
    const rotations = new Float32Array(count * 4);
    const radii = new Float32Array(count);
    const keys = new Int32Array(count);
    const targets = new Int32Array(count);
    // single compartment "cloud" so the cloud can be bound to a loaded mesh surface via the
    // Synthetic Particles node's `surface` parameter
    const compartments = new Int32Array(count);
    const rand = mulberry32(1);
    for (let i = 0; i < count; ++i) {
        coordinates[i * 3] = (rand() * 2 - 1) * box;
        coordinates[i * 3 + 1] = (rand() * 2 - 1) * box;
        coordinates[i * 3 + 2] = (rand() * 2 - 1) * box;
        // random unit quaternion (Shoemake)
        const u1 = rand(), u2 = rand(), u3 = rand();
        const s1 = Math.sqrt(1 - u1), s2 = Math.sqrt(u1), t1 = 2 * Math.PI * u2, t2 = 2 * Math.PI * u3;
        rotations[i * 4] = s1 * Math.sin(t1); rotations[i * 4 + 1] = s1 * Math.cos(t1);
        rotations[i * 4 + 2] = s2 * Math.sin(t2); rotations[i * 4 + 3] = s2 * Math.cos(t2);
        radii[i] = 3 + rand() * 4;
        keys[i] = i;
    }
    return {
        count, keys, targets, coordinates, rotations, radii,
        compartments, compartmentInfo: new Map([[0, 'cloud']]),
        getParticleLabel: (i: number) => `Particle ${i}`,
        sourceData: { kind: 'particle-dynamics-demo' } as unknown as ModelFormat,
        customProperties: new CustomProperties(),
        _propertyData: {},
    };
}

/** Build a `MeshSurface` from a loaded mesh shape provider (the `SO.Shape.Provider` data). */
async function meshSurfaceFromProvider(ctx: RuntimeContext, provider: any): Promise<MeshSurface | undefined> {
    // getShape needs the param VALUES (e.g. PLY reads props.grouping); provider.params is the schema
    const shape = await provider.getShape(ctx, provider.data, PD.getDefaultValues(provider.params));
    const geo = shape?.geometry;
    if (!geo || geo.kind !== 'mesh') return undefined;
    const mesh = geo as Mesh;
    const positions = mesh.vertexBuffer.ref.value.subarray(0, mesh.vertexCount * 3);
    const indices = mesh.indexBuffer.ref.value.subarray(0, mesh.triangleCount * 3);
    return MeshSurface.create(positions instanceof Float32Array ? positions : new Float32Array(positions), indices);
}

/**
 * Per-compartment surface bindings shared by the particle-producing transforms: each row constrains a
 * compartment/type (matched by name in `compartmentInfo`, e.g. "cloud", "Cube", "Tube", "Protein") to a
 * loaded mesh, by mode. Editable in the UI on the node; the ValueRef resolves because it's a transform.
 */
const surfaceParams = {
    surfaceBindings: PD.ObjectList(
        {
            compartment: PD.Text('', { label: 'Compartment' }),
            surface: PD.ValueRef<any>(
                (ctx: PluginContext) => ctx.state.data.select(StateSelection.Generators.rootsOfType(SO.Shape.Provider)).map(s => [s.transform.ref, s.obj?.label ?? s.transform.ref] as [string, string]),
                (ref, getData) => getData(ref),
            ),
            mode: PD.Select<Particle.SurfaceMode>('on', [['on', 'On surface'], ['inside', 'Inside (confined)'], ['outside', 'Outside (excluded)']]),
        },
        e => `${e.compartment || '?'} → ${e.mode}`,
        { description: 'Constrain a compartment/type (by name) to a loaded mesh surface.' }
    ),
};

/** Resolve the binding rows and attach them to `list` (compartment name -> mesh surface + mode). */
async function applySurfaceBindings(ctx: RuntimeContext, list: ParticleList, rows: { compartment: string, surface: any, mode: Particle.SurfaceMode }[]): Promise<void> {
    if (!rows?.length || !list.compartmentInfo) return;
    const bindings = new Map<number, Particle.SurfaceBinding>();
    for (const row of rows) {
        if (!row.compartment || !row.surface?.ref) continue;
        const surface = await meshSurfaceFromProvider(ctx, row.surface.getValue());
        if (!surface) continue;
        let index = -1;
        list.compartmentInfo.forEach((name, i) => { if (name === row.compartment) index = i; });
        if (index >= 0) bindings.set(index, { surface, mode: row.mode });
    }
    if (bindings.size) Particle.setSurfaceBindings(list, bindings);
}

const SyntheticParticles = PluginStateTransform.BuiltIn({
    name: 'example-synthetic-particles',
    display: 'Synthetic Particles',
    from: SO.Root,
    to: SO.Particle.List,
    params: {
        count: PD.Numeric(3000, { min: 100, max: 50000, step: 100 }),
        box: PD.Numeric(150, { min: 10, max: 1000, step: 10 }),
        // when set, attach a matching cube/tube reference structure so the rigid clusters are visible
        rigidShape: PD.Select<RigidShape>('none', [['none', 'None'], ['cube', 'Cube'], ['tube', 'Tube']]),
        // constrain the cloud to a loaded mesh (mode = on surface / inside / outside). Bound by the mesh's
        // state ref; the ValueRef resolves correctly because this is a transform (unlike an animation param).
        ...surfaceParams,
        // link a loaded structure to every particle (rendered via the `target` representation). Built-in
        // cube/tube cluster shapes come from `rigidShape` above instead.
        linkStructure: PD.ValueRef<any>(
            (ctx: PluginContext) => ctx.state.data.select(StateSelection.Generators.rootsOfType(SO.Molecule.Structure)).map(s => [s.transform.ref, s.obj?.label ?? s.transform.ref] as [string, string]),
            (ref, getData) => getData(ref),
        ),
    },
})({
    apply({ params }) {
        return Task.create('Synthetic Particles', async ctx => {
            const particles = makeParticles(params.count, params.box);
            // constrain compartments (here just "cloud") to meshes per the binding rows
            await applySurfaceBindings(ctx, particles, params.surfaceBindings);
            if (params.linkStructure?.ref) {
                // link a loaded structure to every particle: the `target` representation instances it
                // at each particle's position+orientation (on the surface, oriented to its normal). One
                // structure per particle for now; a rigid group-of-beads per structure is a follow-up.
                const structure = params.linkStructure.getValue() as Structure;
                Particle.setParticleTargets(particles, new Map<number, ParticleTarget>([[0, { kind: 'structure', structure }]]));
            } else if (params.rigidShape !== 'none') {
                // every particle is target 0 (makeParticles fills `targets` with 0); attach the cluster
                // structure for target 0 so the `target` representation can instance it per body
                const offsets = particleRigidShapeOffsets(params.rigidShape, RIGID_RADIUS);
                const structure = await buildClusterStructure(ctx, offsets);
                Particle.setParticleTargets(particles, new Map<number, ParticleTarget>([[0, { kind: 'structure', structure }]]));

                // also attach the collision spheres as a uniform rigid cluster (same offsets for every
                // body) so the `spacefill` representation can draw them via `showRigidClusters`, and size
                // each particle to the collision radius
                const k = offsets.length / 3;
                const allOffsets = new Float32Array(particles.count * offsets.length);
                const starts = new Int32Array(particles.count);
                const counts = new Int32Array(particles.count);
                for (let b = 0; b < particles.count; ++b) {
                    starts[b] = b * k;
                    counts[b] = k;
                    allOffsets.set(offsets, b * offsets.length);
                    particles.radii![b] = RIGID_RADIUS;
                }
                Particle.setRigidClusters(particles, { offsets: allOffsets, starts, counts });
            }
            return new SO.Particle.List(particles, { label: 'Synthetic Particles' });
        });
    },
});

/** Wrap an already-built `ParticleList` (with its rigid clusters + target structures attached) as a
 * state object. The list is passed as an opaque value - this is a demo convenience, not a serializable
 * transform. */
const PrebuiltParticles = PluginStateTransform.BuiltIn({
    name: 'example-prebuilt-particles',
    display: 'Prebuilt Particles',
    from: SO.Root,
    to: SO.Particle.List,
    params: { list: PD.Value<ParticleList | undefined>(undefined, { isHidden: true }), ...surfaceParams },
})({
    apply({ params }) {
        return Task.create('Prebuilt Particles', async ctx => {
            if (!params.list) throw new Error('PrebuiltParticles: no list provided');
            let list = params.list;
            if (params.surfaceBindings.length) {
                // shallow-clone so a new list object triggers the animation to re-collect (the typed
                // arrays stay shared, so the running poses carry over); attach the bindings to the clone
                list = { ...list, _propertyData: { ...list._propertyData } };
                await applySurfaceBindings(ctx, list, params.surfaceBindings);
            }
            return new SO.Particle.List(list, { label: 'Rigid Bodies' });
        });
    },
});

/** Wrap an already-built reference `Structure` as a state object, so it can be the input of the
 * `particles-structure` decorator (instanced per type). A demo convenience, not serializable. */
const PrebuiltStructure = PluginStateTransform.BuiltIn({
    name: 'example-prebuilt-structure',
    display: 'Prebuilt Structure',
    from: SO.Root,
    to: SO.Molecule.Structure,
    params: { structure: PD.Value<Structure | undefined>(undefined, { isHidden: true }), label: PD.Text('Reference') },
})({
    apply({ params }) {
        if (!params.structure) throw new Error('PrebuiltStructure: no structure provided');
        return new SO.Molecule.Structure(params.structure, { label: params.label });
    },
});

// ---- geometry sampling for rigid-body shapes -------------------------------

/** At most this many source points are fed to k-means (sub-sampled by stride) to keep it fast. */
const MAX_SAMPLE_POINTS = 4000;

/**
 * Deterministic Lloyd k-means returning `k` cluster centres (packed `[x,y,z,...]`). Guards the two
 * ways this blows up into NaNs: fewer points than clusters (returns the points as-is), and empty
 * clusters mid-iteration (reseeded to the farthest point from their centre).
 */
function kmeans(points: Float32Array, k: number, iters = 15): Float32Array {
    const n = points.length / 3;
    if (n <= k) return points.slice(0, n * 3);
    const centers = new Float32Array(k * 3);
    for (let c = 0; c < k; ++c) {
        const idx = Math.floor(c * (n - 1) / (k - 1));
        centers[c * 3] = points[idx * 3]; centers[c * 3 + 1] = points[idx * 3 + 1]; centers[c * 3 + 2] = points[idx * 3 + 2];
    }
    const assign = new Int32Array(n), sum = new Float64Array(k * 3), cnt = new Int32Array(k);
    for (let it = 0; it < iters; ++it) {
        for (let i = 0; i < n; ++i) {
            const px = points[i * 3], py = points[i * 3 + 1], pz = points[i * 3 + 2];
            let best = 0, bd = Infinity;
            for (let c = 0; c < k; ++c) {
                const dx = px - centers[c * 3], dy = py - centers[c * 3 + 1], dz = pz - centers[c * 3 + 2];
                const d = dx * dx + dy * dy + dz * dz;
                if (d < bd) { bd = d; best = c; }
            }
            assign[i] = best;
        }
        sum.fill(0); cnt.fill(0);
        for (let i = 0; i < n; ++i) {
            const c = assign[i];
            sum[c * 3] += points[i * 3]; sum[c * 3 + 1] += points[i * 3 + 1]; sum[c * 3 + 2] += points[i * 3 + 2]; cnt[c]++;
        }
        for (let c = 0; c < k; ++c) {
            if (cnt[c] > 0) {
                centers[c * 3] = sum[c * 3] / cnt[c]; centers[c * 3 + 1] = sum[c * 3 + 1] / cnt[c]; centers[c * 3 + 2] = sum[c * 3 + 2] / cnt[c];
            } else {
                // empty cluster: reseed deterministically to the farthest point from its current centre
                let far = 0, fd = -1;
                for (let i = 0; i < n; ++i) {
                    const dx = points[i * 3] - centers[c * 3], dy = points[i * 3 + 1] - centers[c * 3 + 1], dz = points[i * 3 + 2] - centers[c * 3 + 2];
                    const d = dx * dx + dy * dy + dz * dz;
                    if (d > fd) { fd = d; far = i; }
                }
                centers[c * 3] = points[far * 3]; centers[c * 3 + 1] = points[far * 3 + 1]; centers[c * 3 + 2] = points[far * 3 + 2];
            }
        }
    }
    return centers;
}

/** Subtract the centroid in place so the offsets are body-local (mean-centred), as the dynamics expects. */
function meanCenter(offsets: Float32Array): Float32Array {
    const n = offsets.length / 3;
    if (n === 0) return offsets;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; ++i) { cx += offsets[i * 3]; cy += offsets[i * 3 + 1]; cz += offsets[i * 3 + 2]; }
    cx /= n; cy /= n; cz /= n;
    for (let i = 0; i < n; ++i) { offsets[i * 3] -= cx; offsets[i * 3 + 1] -= cy; offsets[i * 3 + 2] -= cz; }
    return offsets;
}

/** World-space atom coordinates of a structure (sub-sampled by stride). */
function structurePoints(structure: Structure): Float32Array {
    let total = 0;
    for (const unit of structure.units) total += unit.elements.length;
    const stride = Math.max(1, Math.floor(total / MAX_SAMPLE_POINTS));
    const out: number[] = [];
    for (const unit of structure.units) {
        const conf = unit.conformation;
        const els = unit.elements;
        for (let i = 0; i < els.length; i += stride) {
            const e = els[i];
            out.push(conf.x(e), conf.y(e), conf.z(e));
        }
    }
    return Float32Array.from(out);
}

/** World-space positions of voxels above (mean + sigma), sub-sampled by stride. */
function volumePoints(volume: Volume): Float32Array {
    const { grid } = volume;
    const { cells } = grid;
    const data = cells.data as ArrayLike<number>;
    const space = cells.space;
    const threshold = grid.stats.mean + grid.stats.sigma;
    const transform = Grid.getGridToCartesianTransform(grid);
    const stride = Math.max(1, Math.floor(data.length / (MAX_SAMPLE_POINTS * 4)));
    const out: number[] = [];
    const coord = [0, 0, 0] as unknown as Vec3;
    const v = Vec3();
    for (let i = 0; i < data.length; i += stride) {
        if (data[i] > threshold) {
            space.getCoords(i, coord);
            Vec3.set(v, coord[0], coord[1], coord[2]);
            Vec3.transformMat4(v, v, transform);
            out.push(v[0], v[1], v[2]);
        }
    }
    return Float32Array.from(out);
}

/** World-space vertices of a shape's mesh geometry (sub-sampled by stride), or empty if not a mesh. */
async function shapePoints(ctx: RuntimeContext, provider: any): Promise<Float32Array> {
    const shape = await provider.getShape(ctx, provider.data, PD.getDefaultValues(provider.params));
    const geo = shape?.geometry;
    if (!geo || geo.kind !== 'mesh') return new Float32Array(0);
    const mesh = geo as Mesh;
    const vb = mesh.vertexBuffer.ref.value;
    const vc = mesh.vertexCount;
    const stride = Math.max(1, Math.floor(vc / MAX_SAMPLE_POINTS));
    const out: number[] = [];
    const v = Vec3();
    const transforms = shape.transforms && shape.transforms.length ? shape.transforms : [Mat4.identity()];
    for (let i = 0; i < vc; i += stride) {
        Vec3.set(v, vb[i * 3], vb[i * 3 + 1], vb[i * 3 + 2]);
        Vec3.transformMat4(v, v, transforms[0]);
        out.push(v[0], v[1], v[2]);
    }
    return Float32Array.from(out);
}

/** One rigid body in the demo scene: a baked, body-local set of bead offsets plus its current pose.
 *  `label` is the source id (e.g. `builtin:cube`) and doubles as the body's *type* identity. */
type DemoBody = { offsets: Float32Array, position: Vec3, rotation: Quat, label: string, compartment?: string };

/** Human-friendly entity/type name for a body source id (e.g. `builtin:cube` -> `Cube`). */
function bodyTypeName(sourceId: string): string {
    const [kind, ref] = sourceId.split(':');
    if (kind === 'builtin') return ref.charAt(0).toUpperCase() + ref.slice(1);
    return sourceId;
}

class ParticleDynamicsDemo {
    plugin: PluginUIContext = undefined as unknown as PluginUIContext;

    /** Accumulated rigid bodies added from the UI (each baked to body-local bead offsets). */
    private bodies: DemoBody[] = [];
    /** State ref of the current rigid-bodies particle-list cell (so we can replace it without `clear`). */
    private bodiesRef: string | undefined = undefined;
    /** The live list backing the bodies sim, read back to carry over poses across rebuilds. */
    private bodiesList: ParticleList | undefined = undefined;
    /** State ref of the synthetic demo cloud, removed when we switch to the add-body workflow. */
    private syntheticRef: string | undefined = undefined;
    /** Per structure-sourced entity: the `particles-structure` subtree root that instances that type's
     *  original loaded structure at its particles (its own representation, following the sim). Created once
     *  per type; recomputes on rebuild via its dependency on the particle-list cell. */
    private bodyStructureRefs = new Map<number, string>();
    /** Per entity whose source is a loaded structure: the original `Structure` to instance (see above).
     *  Collision beads of every type are drawn from the list's rigid clusters, not from here. */
    private entitySourceStructures = new Map<number, Structure>();
    /** Box half-extent for the add-body rigid simulation. */
    private bodiesBox = 150;

    async init(target: string | HTMLElement) {
        const element = typeof target === 'string' ? document.getElementById(target)! : target;
        this.plugin = await createPluginUI({
            target: element,
            render: renderReact18,
            spec: {
                ...DefaultPluginUISpec(),
                layout: { initial: { isExpanded: true } },
            },
        });
        // Disable automatic camera re-framing: by default the canvas re-centers whenever a renderable
        // moves outside the bounding sphere, which fires constantly during the simulation and every
        // time a body is added. With manualReset on, the camera only moves on an explicit reset (which
        // `start()` still issues for the initial framing).
        this.plugin.canvas3d?.setProps({ camera: { manualReset: true } });
        // open with the full UI so a structure can be loaded and the particle representation applied;
        // also start the synthetic dynamics demo so it runs out of the box (play/pause from the
        // animation controls; the example buttons reseed it or stop it).
        await this.start();

        // Recipe panel: a second React root (not part of the plugin's own component tree), wrapped in
        // `PluginReactContext` so its `ParameterControls` (and any future context-consuming control)
        // resolves `this.plugin` correctly.
        const recipeElement = document.getElementById('recipe-panel');
        if (recipeElement) {
            renderReact18(React.createElement(PluginReactContext.Provider, { value: this.plugin },
                React.createElement(RecipePanel, { demo: this })), recipeElement);
        }
    }

    /**
     * Build a synthetic particle cloud + representation and play the dynamics via the animation manager.
     * With `rigidShape` set, each particle is rendered as the matching cube/tube cluster of spheres
     * (via `spacefill` with `showRigidClusters`) and the simulation runs in Flex-style rigid-body mode,
     * so we can see the clusters translate and rotate to confirm the rigid dynamics work.
     */
    async start(count = 3000, box = 150, rigidShape: RigidShape = 'none') {
        await this.plugin.managers.animation.stop();
        await this.plugin.clear();
        this.bodies = []; this.bodiesRef = undefined; this.bodiesList = undefined; this.syntheticRef = undefined;
        this.bodyStructureRefs.clear();

        const list = await this.plugin.state.data.build().toRoot()
            .apply(SyntheticParticles, { count, box, rigidShape }).commit();
        this.syntheticRef = list.ref;

        const type = rigidShape === 'none'
            ? { name: 'orientation', params: {} }
            // draw each body's collision spheres directly via spacefill's rigid-cluster mode
            : { name: 'spacefill', params: { showRigidClusters: true } };
        await this.plugin.state.data.build().to(list.ref)
            .apply(StateTransforms.Particles.ParticlesRepresentation3D, { type }).commit();

        this.plugin.canvas3d?.requestCameraReset();
        // play the dynamics through the animation manager - controllable (play/pause) from the
        // animation UI, and the canvas renders every frame while it plays
        await this.plugin.managers.animation.play(AnimateParticleDynamics, {
            ...PD.getDefaultValues(ParticleDynamicsParams),
            bounds: box,
            particleRadius: RIGID_RADIUS,
            rigidBody: rigidShape !== 'none',
            rigidShape: rigidShape === 'none' ? 'cube' : rigidShape,
        });
    }

    /** Run the rigid-body demo with the given collision-cluster shape. */
    startRigid(shape: 'cube' | 'tube', count = 500, box = 150) {
        return this.start(count, box, shape);
    }

    /** Sources the user can turn into a rigid body: the built-in shapes plus every loaded object. */
    getSources(): { id: string, label: string }[] {
        const sources = [
            { id: 'builtin:cube', label: 'Box / cube (4 beads)' },
            { id: 'builtin:tube', label: 'Tube (5 beads)' },
            { id: 'builtin:particle', label: 'Particle (1 bead)' },
        ];
        const data = this.plugin.state.data;
        for (const c of data.select(StateSelection.Generators.rootsOfType(SO.Molecule.Structure))) {
            sources.push({ id: `structure:${c.transform.ref}`, label: `Structure: ${c.obj?.label ?? c.transform.ref}` });
        }
        for (const c of data.select(StateSelection.Generators.ofType(SO.Volume.Data))) {
            sources.push({ id: `volume:${c.transform.ref}`, label: `Volume: ${c.obj?.label ?? c.transform.ref}` });
        }
        for (const c of data.select(StateSelection.Generators.ofType(SO.Shape.Provider))) {
            sources.push({ id: `shape:${c.transform.ref}`, label: `Mesh: ${c.obj?.label ?? c.transform.ref}` });
        }
        return sources;
    }

    /** Loaded mesh shape providers a recipe entry's `surfaceMeshRef` can bind a compartment to. */
    getMeshSources(): { id: string, label: string }[] {
        return this.plugin.state.data.select(StateSelection.Generators.ofType(SO.Shape.Provider))
            .map(c => ({ id: c.transform.ref, label: c.obj?.label ?? c.transform.ref }));
    }


    /** Compute body-local (mean-centred) bead offsets for a source: built-in shape or k-means of geometry. */
    private async computeOffsets(ctx: RuntimeContext, sourceId: string): Promise<Float32Array | undefined> {
        const [kind, ref] = sourceId.split(':');
        if (kind === 'builtin') {
            if (ref === 'cube') return particleRigidShapeOffsets('cube', RIGID_RADIUS);
            if (ref === 'tube') return particleRigidShapeOffsets('tube', RIGID_RADIUS);
            return new Float32Array(3); // single bead at the origin
        }
        const cell = this.plugin.state.data.cells.get(ref);
        const obj = cell?.obj?.data;
        if (!obj) return undefined;
        let points: Float32Array | undefined;
        try {
            if (kind === 'structure') points = structurePoints(obj as Structure);
            else if (kind === 'volume') points = volumePoints(obj as Volume);
            else if (kind === 'shape') points = await shapePoints(ctx, obj);
        } catch (e) {
            console.error('rigid body: failed to sample source geometry', e);
            return undefined;
        }
        if (!points || points.length < 3) return undefined;
        return meanCenter(kmeans(points, 10));
    }

    /** Add a new rigid body from the selected source, dropped in at the top of the box. */
    async addBody(sourceId: string) {
        const offsets = await this.plugin.runTask(Task.create('Sample rigid body', ctx => this.computeOffsets(ctx, sourceId)));
        if (!offsets || offsets.length < 3) {
            console.warn(`rigid body: could not build a shape from "${sourceId}" (no usable geometry)`);
            return;
        }
        // drop at the top of the box, just inside the wall, accounting for the cluster's vertical extent
        let halfH = 0;
        for (let i = 0; i < offsets.length / 3; ++i) halfH = Math.max(halfH, Math.abs(offsets[i * 3 + 1]));
        const y = this.bodiesBox - halfH - RIGID_RADIUS;
        const position = Vec3.create((Math.random() - 0.5) * this.bodiesBox, y, (Math.random() - 0.5) * this.bodiesBox);
        this.bodies.push({ offsets, position, rotation: Quat.create(0, 0, 0, 1), label: sourceId });
        await this.rebuildBodies();
    }

    /** Add `n` bodies of the selected source at once (one shape sampled, one rebuild), spread through
     * the box - for performance testing. All `n` share the same shape, so they instance one structure. */
    async addBodies(sourceId: string, n: number) {
        const offsets = await this.plugin.runTask(Task.create('Sample rigid body', ctx => this.computeOffsets(ctx, sourceId)));
        if (!offsets || offsets.length < 3) {
            console.warn(`rigid body: could not build a shape from "${sourceId}" (no usable geometry)`);
            return;
        }
        let extent = 0;
        for (let i = 0; i < offsets.length / 3; ++i) {
            extent = Math.max(extent, Math.abs(offsets[i * 3]), Math.abs(offsets[i * 3 + 1]), Math.abs(offsets[i * 3 + 2]));
        }
        const span = Math.max(1, this.bodiesBox - extent - RIGID_RADIUS);
        for (let i = 0; i < n; ++i) {
            const position = Vec3.create((Math.random() * 2 - 1) * span, (Math.random() * 2 - 1) * span, (Math.random() * 2 - 1) * span);
            this.bodies.push({ offsets, position, rotation: Quat.create(0, 0, 0, 1), label: sourceId });
        }
        await this.rebuildBodies();
    }

    /** Resolve a declarative `ParticleRecipe` (see `recipe.ts`, edited by the schematic + table UI) into
     * the same rigid-body pipeline `addBody`/`addBodies` use: sample each entry's source once, place
     * `count` copies spread through the box tagged with the entry's `compartment`, then a single
     * `rebuildBodies` (list + representations + animation) - a recipe is a declarative front-end to
     * this existing code path, not a new simulation pipeline. Entries with both a `surfaceMode` and a
     * `surfaceMeshRef` get a surface binding on the resulting `PrebuiltParticles` node, reusing its
     * existing `surfaceBindings` param (the same one the generic state-tree panel already exposes). */
    async applyRecipe(recipe: ParticleRecipe) {
        await this.plugin.managers.animation.stop();
        // Drop only the PREVIOUS recipe's own bodies/structures - never `plugin.clear()`, which would
        // also delete the structures/meshes the user loaded as recipe sources/surface targets (their
        // refs are what `entry.source`/`entry.surfaceMeshRef` resolve against below).
        if (this.bodiesRef && this.plugin.state.data.cells.has(this.bodiesRef)) {
            await this.plugin.state.data.build().delete(this.bodiesRef).commit();
        }
        await this.deleteBodyStructures();
        this.bodies = []; this.bodiesRef = undefined; this.bodiesList = undefined;

        for (const entry of recipe.entries) {
            const offsets = await this.plugin.runTask(Task.create('Sample rigid body', ctx => this.computeOffsets(ctx, entry.source)));
            if (!offsets || offsets.length < 3) {
                console.warn(`recipe: could not build a shape from "${entry.source}" for type "${entry.name}" (no usable geometry)`);
                continue;
            }
            let extent = 0;
            for (let i = 0; i < offsets.length / 3; ++i) {
                extent = Math.max(extent, Math.abs(offsets[i * 3]), Math.abs(offsets[i * 3 + 1]), Math.abs(offsets[i * 3 + 2]));
            }
            const span = Math.max(1, this.bodiesBox - extent - RIGID_RADIUS);

            // A mesh loaded from a file typically keeps its own real-world coordinates, which are rarely
            // centred on the simulation's origin (e.g. a Blender export centred at (850, 862, 881)). Spawning
            // "on"-bound bodies uniformly around the origin like free bodies would place every one of them
            // far from the mesh, so the very first `initState` projection onto it is an expensive
            // ring-expansion search from far outside the mesh's grid (~300x slower than a query that starts
            // near the surface) - for hundreds of bodies this shows up as a multi-second stall on Apply.
            // Sample a point on the mesh itself instead, so bodies start near their target surface.
            let surface: MeshSurface | undefined;
            if (entry.surfaceMode && entry.surfaceMeshRef) {
                const meshCell = this.plugin.state.data.cells.get(entry.surfaceMeshRef);
                if (meshCell?.obj?.data) {
                    surface = await this.plugin.runTask(Task.create('Sample mesh surface', ctx => meshSurfaceFromProvider(ctx, meshCell.obj!.data)));
                }
            }

            for (let i = 0; i < entry.count; ++i) {
                let position: Vec3;
                if (surface) {
                    position = Vec3();
                    surface.sample(position, Math.random);
                    Vec3.add(position, position, Vec3.create((Math.random() * 2 - 1) * RIGID_RADIUS, (Math.random() * 2 - 1) * RIGID_RADIUS, (Math.random() * 2 - 1) * RIGID_RADIUS));
                } else {
                    position = Vec3.create((Math.random() * 2 - 1) * span, (Math.random() * 2 - 1) * span, (Math.random() * 2 - 1) * span);
                }
                // Key the physics compartment by the entry's NAME, not its (often shared) `compartment`
                // grouping: `surfaceMode`/`surfaceMeshRef` are per-entry, so binding by the shared
                // compartment collapses several types' distinct constraints onto one (last-wins) - e.g.
                // three types all in the default compartment would all get the last row's mode. Naming the
                // compartment after the type makes each entry its own surface-binding + cohesion group.
                this.bodies.push({ offsets, position, rotation: Quat.create(0, 0, 0, 1), label: entry.source, compartment: entry.name });
            }
        }
        // resolved BEFORE the list is ever committed, so the particle list the animation starts playing
        // already carries its surface bindings - no later patch while the sim is running (a previous
        // version patched `surfaceBindings` in a second `.update()` after `rebuildBodies` had already
        // started the animation against the unbound list, racing the running simulation against the
        // rebind).
        const rows = recipe.entries
            .filter((e): e is ParticleRecipeEntry & { surfaceMode: Particle.SurfaceMode, surfaceMeshRef: string } => !!e.surfaceMode && !!e.surfaceMeshRef)
            // bind by the entry NAME (matching the per-type compartment stamped on the bodies above), so
            // each type's mode/mesh applies to its own particles instead of collapsing per shared compartment
            .map(e => ({ compartment: e.name, surface: PD.Ref<any>(e.surfaceMeshRef), mode: e.surfaceMode }));
        await this.rebuildBodies(rows);
        // frame the freshly-built scene: with a bound mesh the simulation box is centred on the mesh (far
        // off-origin for a file-loaded mesh), so an explicit reset brings the mesh + bodies into view
        this.plugin.canvas3d?.requestCameraReset();
    }

    /** Assemble the accumulated bodies into one particle list (heterogeneous rigid clusters + per-body
     * reference structures) and (re)start the rigid simulation, without disturbing loaded objects. */
    private async rebuildBodies(surfaceBindings?: { compartment: string, surface: PD.Ref<any>, mode: Particle.SurfaceMode }[]) {
        await this.plugin.managers.animation.stop();

        // carry the live poses (the sim mutates the list in place) back into `bodies` so existing
        // bodies stay exactly where they are - the new body is appended, so the existing ones are the
        // first `live.count` entries (the new total is larger, hence the prefix, not an equality check)
        const live = this.bodiesList;
        if (live) {
            const m = Math.min(live.count, this.bodies.length);
            for (let b = 0; b < m; ++b) {
                Vec3.set(this.bodies[b].position, live.coordinates[b * 3], live.coordinates[b * 3 + 1], live.coordinates[b * 3 + 2]);
                Quat.set(this.bodies[b].rotation, live.rotations![b * 4], live.rotations![b * 4 + 1], live.rotations![b * 4 + 2], live.rotations![b * 4 + 3]);
            }
        }

        // drop the one-off synthetic demo cloud (a different particle system) the first time we add a
        // body; loaded objects are left untouched
        if (this.syntheticRef) {
            await this.plugin.state.data.build().delete(this.syntheticRef).commit();
            this.syntheticRef = undefined;
        }
        if (this.bodies.length === 0) {
            if (this.bodiesRef) { await this.plugin.state.data.build().delete(this.bodiesRef).commit(); this.bodiesRef = undefined; this.bodiesList = undefined; }
            await this.deleteBodyStructures();
            return;
        }

        const list = await this.plugin.runTask(Task.create('Build rigid bodies', ctx => this.buildBodiesList(ctx)));
        this.bodiesList = list;

        if (this.bodiesRef && this.plugin.state.data.cells.has(this.bodiesRef)) {
            // CRUCIAL: keep the same particle-list cell ref. The `particles-structure` decorators depend
            // on this cell, so they re-instance at the updated bodies instead of dangling.
            // Merge (don't replace) the params: `addBody`/`addBodies` pass no `surfaceBindings`, so an
            // existing binding (set via the recipe or the generic node panel) survives untouched; a
            // recipe re-apply passes its full row set (possibly empty) to replace it outright.
            await this.plugin.state.data.build().to(this.bodiesRef).update(old => {
                old.list = list;
                if (surfaceBindings) old.surfaceBindings = surfaceBindings;
            }).commit();
        } else {
            const cell = await this.plugin.state.data.build().toRoot()
                .apply(PrebuiltParticles, surfaceBindings ? { list, surfaceBindings } : { list }).commit();
            this.bodiesRef = cell.ref;
            // draw the collision shape of EVERY body straight from the list's rigid clusters (spacefill in
            // rigid-cluster mode), coloured per type - this is "the particle system shows the beads". The
            // rep depends on the list cell, so it recomputes in place on later rebuilds (same `bodiesRef`).
            await this.plugin.state.data.build().to(this.bodiesRef)
                .apply(StateTransforms.Particles.ParticlesRepresentation3D, {
                    // semi-transparent so a structure-sourced type's protein (instanced inside these beads
                    // by linkTargetStructures) stays visible; toggle this node off to see only the proteins
                    type: { name: 'spacefill', params: { showRigidClusters: true, alpha: 0.5 } },
                    colorTheme: { name: 'particle-entity', params: {} },
                }).commit();
        }

        // link each structure-sourced type's original structure so the real protein follows its particles
        // (the collision beads above already show every type's shape)
        await this.linkTargetStructures(list);

        // preserve the current animation parameters across the rebuild (e.g. a `bounds` the user set in
        // the controls) - adding a body must not reset them. Only the rigid-body flag is forced on; the
        // first transition (from the synthetic demo) falls back to these defaults.
        const cur = this.plugin.managers.animation.current?.paramValues as Partial<ParticleDynamicsProps> | undefined;
        await this.plugin.managers.animation.play(AnimateParticleDynamics, {
            ...PD.getDefaultValues(ParticleDynamicsParams),
            bounds: this.bodiesBox,
            particleRadius: RIGID_RADIUS,
            rigidShape: 'cube',
            ...(cur ?? {}),
            rigidBody: true,
        });
    }

    /** Remove every tracked per-type reference-structure subtree (`PrebuiltStructure` root + its
     * `particles-structure` decorator + representation) and clear the tracking map. Used before a fresh
     * `applyRecipe`/when bodies drop to zero, so stale subtrees from a previous set of types don't leak. */
    private async deleteBodyStructures() {
        for (const ref of this.bodyStructureRefs.values()) {
            if (this.plugin.state.data.cells.has(ref)) {
                await this.plugin.state.data.build().delete(ref).commit();
            }
        }
        this.bodyStructureRefs.clear();
    }

    /** Link each structure-sourced type's ORIGINAL loaded structure to the particle system: one
     * `particles-structure` subtree per such type, instancing the real structure (its own auto
     * representation - cartoon/surface) at every particle of that type, so the protein follows the sim.
     * The collision beads of ALL types are drawn separately, straight from the list's rigid clusters (see
     * `rebuildBodies`), so non-structure types (cube/tube/mesh) need no subtree here. Subtrees are created
     * once per type; on later rebuilds existing ones recompute through their dependency on the list cell. */
    private async linkTargetStructures(list: ParticleList) {
        if (!this.bodiesRef) return;
        for (const [entity, src] of this.entitySourceStructures) {
            if (this.bodyStructureRefs.has(entity)) continue;
            const label = list.entityInfo?.get(entity) ?? `Type ${entity}`;
            const refCell = await this.plugin.state.data.build().toRoot()
                .apply(PrebuiltStructure, { structure: src, label: `${label} (structure)` }).commit();
            const instanced = await this.plugin.state.data.build().to(refCell.ref)
                .apply(StateTransforms.Model.ParticlesStructure, { particles: PD.Ref(this.bodiesRef), entity }).commit();
            await this.plugin.builders.structure.representation.applyPreset(instanced.ref, 'auto');
            // track the subtree ROOT so a fresh apply removes structure + decorator + representation in one call
            this.bodyStructureRefs.set(entity, refCell.ref);
        }
    }

    /** Build the particle list: one particle per body, per-body bead offsets packed into a single
     * `RigidClusters`. Bodies that share the same shape (same `offsets` reference) share a target, so
     * they render as instances of ONE reference structure (one render object) rather than one per body
     * - this is what makes "Add 100 Bodies" a meaningful sim test rather than a render-object stress test. */
    private async buildBodiesList(ctx: RuntimeContext): Promise<ParticleList> {
        this.entitySourceStructures.clear(); // recomputed below as targets are assigned
        const n = this.bodies.length;
        const coordinates = new Float32Array(n * 3);
        const rotations = new Float32Array(n * 4);
        const radii = new Float32Array(n);
        const keys = new Int32Array(n);
        const targets = new Int32Array(n);

        let totalSpheres = 0;
        for (const body of this.bodies) totalSpheres += body.offsets.length / 3;
        const offsets = new Float32Array(totalSpheres * 3);
        const starts = new Int32Array(n);
        const counts = new Int32Array(n);
        const entities = new Int32Array(n);
        // distinct shape *type* (by source label) -> shared entity id
        const targetOfLabel = new Map<string, number>();

        let s = 0;
        for (let b = 0; b < n; ++b) {
            const body = this.bodies[b];
            const k = body.offsets.length / 3;
            coordinates[b * 3] = body.position[0]; coordinates[b * 3 + 1] = body.position[1]; coordinates[b * 3 + 2] = body.position[2];
            rotations[b * 4] = body.rotation[0]; rotations[b * 4 + 1] = body.rotation[1]; rotations[b * 4 + 2] = body.rotation[2]; rotations[b * 4 + 3] = body.rotation[3];
            // one entity per body type (by source label); cube and tube are different types, and the same
            // type added across batches collapses to one entity. The collision beads are drawn straight
            // from the list's rigid clusters (a `ParticlesRepresentation3D` in `rebuildBodies`), so no
            // per-type reference structure is built here; a structure source just keeps its original
            // structure so `linkTargetStructures` can instance the real protein at each of its particles.
            let target = targetOfLabel.get(body.label);
            if (target === undefined) {
                target = targetOfLabel.size;
                targetOfLabel.set(body.label, target);
                const [kind, ref] = body.label.split(':');
                const src = kind === 'structure' ? this.plugin.state.data.cells.get(ref)?.obj?.data as Structure | undefined : undefined;
                if (src) this.entitySourceStructures.set(target, src);
            }
            radii[b] = RIGID_RADIUS; keys[b] = b; targets[b] = target; entities[b] = target;
            offsets.set(body.offsets, s * 3);
            starts[b] = s; counts[b] = k; s += k;
        }

        // one entity per body type, so the `particle-entity` color theme distinguishes cube/tube/etc.
        const entityInfo = new Map<number, string>();
        for (const [label, id] of targetOfLabel) entityInfo.set(id, bodyTypeName(label));

        // Compartment groups bodies for surface binding/cohesion: defaults to the body type (matching
        // the old behavior for bodies added via `addBody`/`addBodies`, which don't set `compartment`),
        // but a recipe entry's explicit `compartment` lets several distinct types (sources) share one
        // surface binding group, per the cellPACK compartment->ingredient concept `ParticleRecipe` mirrors.
        const compartmentOfName = new Map<string, number>();
        const compartments = new Int32Array(n);
        for (let b = 0; b < n; ++b) {
            const name = this.bodies[b].compartment ?? bodyTypeName(this.bodies[b].label);
            let c = compartmentOfName.get(name);
            if (c === undefined) { c = compartmentOfName.size; compartmentOfName.set(name, c); }
            compartments[b] = c;
        }
        const compartmentInfo = new Map<number, string>();
        for (const [name, id] of compartmentOfName) compartmentInfo.set(id, name);

        const list: ParticleList = {
            count: n, keys, targets, entities, entityInfo, coordinates, rotations, radii,
            compartments, compartmentInfo,
            getParticleLabel: (i: number) => this.bodies[i]?.label ?? `Body ${i}`,
            sourceData: { kind: 'particle-dynamics-demo' } as unknown as ModelFormat,
            customProperties: new CustomProperties(),
            _propertyData: {},
        };
        Particle.setRigidClusters(list, { offsets, starts, counts });
        return list;
    }

    stop() {
        this.plugin.managers.animation.stop();
    }
}

(window as any).ParticleDynamicsDemo = new ParticleDynamicsDemo();
