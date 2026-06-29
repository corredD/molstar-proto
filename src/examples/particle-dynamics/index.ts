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

import { createPluginUI } from '../../mol-plugin-ui';
import { PluginUIContext } from '../../mol-plugin-ui/context';
import { renderReact18 } from '../../mol-plugin-ui/react18';
import { DefaultPluginUISpec } from '../../mol-plugin-ui/spec';
import { PluginStateObject as SO, PluginStateTransform } from '../../mol-plugin-state/objects';
import { StateTransforms } from '../../mol-plugin-state/transforms';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { ParticleList, Particle } from '../../mol-model/particles/particle-list';
import { ParticleDynamicsParams, particleRigidShapeOffsets } from '../../mol-model/particles/dynamics';
import { AnimateParticleDynamics } from '../../mol-plugin-state/animation/built-in/particle-dynamics';
import { CustomProperties } from '../../mol-model/custom-property';
import { ModelFormat } from '../../mol-model-formats/format';
import { Structure } from '../../mol-model/structure';
import { Volume, Grid } from '../../mol-model/volume';
import { Mesh } from '../../mol-geo/geometry/mesh/mesh';
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
 * shape that `particles-structure` instances at every particle's position+orientation, so the rigid
 * clusters from the simulation become visible (and we can confirm they translate AND rotate).
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
        getParticleLabel: (i: number) => `Particle ${i}`,
        sourceData: { kind: 'particle-dynamics-demo' } as unknown as ModelFormat,
        customProperties: new CustomProperties(),
        _propertyData: {},
    };
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
    },
})({
    apply({ params }) {
        return Task.create('Synthetic Particles', async ctx => {
            const particles = makeParticles(params.count, params.box);
            if (params.rigidShape !== 'none') {
                // every particle is target 0 (makeParticles fills `targets` with 0); attach the cluster
                // structure for target 0 so `particles-structure` instances it per body
                const offsets = particleRigidShapeOffsets(params.rigidShape, RIGID_RADIUS);
                const structure = await buildClusterStructure(ctx, offsets);
                Particle.setTargetStructures(particles, new Map([[0, structure]]));
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
    params: { list: PD.Value<ParticleList | undefined>(undefined, { isHidden: true }) },
})({
    apply({ params }) {
        if (!params.list) throw new Error('PrebuiltParticles: no list provided');
        return new SO.Particle.List(params.list, { label: 'Rigid Bodies' });
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
    const shape = await provider.getShape(ctx, provider.data);
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

/** One rigid body in the demo scene: a baked, body-local set of bead offsets plus its current pose. */
type DemoBody = { offsets: Float32Array, position: Vec3, rotation: Quat, label: string };

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
        // open with the full UI so a structure can be loaded and the particle representation applied;
        // also start the synthetic dynamics demo so it runs out of the box (play/pause from the
        // animation controls; the example buttons reseed it or stop it).
        await this.start();
    }

    /**
     * Build a synthetic particle cloud + representation and play the dynamics via the animation manager.
     * With `rigidShape` set, each particle is rendered as the matching cube/tube cluster of spheres
     * (via `particles-structure`) and the simulation runs in Flex-style rigid-body mode, so we can see
     * the clusters translate and rotate to confirm the rigid dynamics work.
     */
    async start(count = 3000, box = 150, rigidShape: RigidShape = 'none') {
        await this.plugin.managers.animation.stop();
        await this.plugin.clear();
        this.bodies = []; this.bodiesRef = undefined; this.bodiesList = undefined; this.syntheticRef = undefined;

        const list = await this.plugin.state.data.build().toRoot()
            .apply(SyntheticParticles, { count, box, rigidShape }).commit();
        this.syntheticRef = list.ref;

        const type = rigidShape === 'none'
            ? { name: 'orientation', params: {} }
            // scale the element spheres so they roughly fill the rigid sphere radius (carbon vdw ~1.7 A)
            : { name: 'particles-structure', params: { sizeFactor: RIGID_RADIUS / 1.7 } };
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

    /** Assemble the accumulated bodies into one particle list (heterogeneous rigid clusters + per-body
     * reference structures) and (re)start the rigid simulation, without disturbing loaded objects. */
    private async rebuildBodies() {
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
            return;
        }

        const list = await this.plugin.runTask(Task.create('Build rigid bodies', ctx => this.buildBodiesList(ctx)));
        this.bodiesList = list;

        if (this.bodiesRef && this.plugin.state.data.cells.has(this.bodiesRef)) {
            // CRUCIAL: keep the same particle-list cell ref. A source attached to the particle system
            // (the `particles-structure` decorator references the list by ref) stays connected and is
            // re-instanced at the updated bodies, instead of dangling when the cell is recreated.
            await this.plugin.state.data.build().to(this.bodiesRef).update({ list }).commit();
        } else {
            const cell = await this.plugin.state.data.build().toRoot().apply(PrebuiltParticles, { list }).commit();
            this.bodiesRef = cell.ref;
            await this.plugin.state.data.build().to(cell.ref)
                .apply(StateTransforms.Particles.ParticlesRepresentation3D, { type: { name: 'particles-structure', params: { sizeFactor: RIGID_RADIUS / 1.7 } } }).commit();
        }

        await this.plugin.managers.animation.play(AnimateParticleDynamics, {
            ...PD.getDefaultValues(ParticleDynamicsParams),
            bounds: this.bodiesBox,
            particleRadius: RIGID_RADIUS,
            rigidBody: true,
            rigidShape: 'cube',
        });
    }

    /** Build the heterogeneous particle list: one body per particle, each its own target/reference
     * structure, with the per-body bead offsets packed into a single `RigidClusters`. */
    private async buildBodiesList(ctx: RuntimeContext): Promise<ParticleList> {
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
        const targetStructures = new Map<number, Structure>();

        let s = 0;
        for (let b = 0; b < n; ++b) {
            const body = this.bodies[b];
            const k = body.offsets.length / 3;
            coordinates[b * 3] = body.position[0]; coordinates[b * 3 + 1] = body.position[1]; coordinates[b * 3 + 2] = body.position[2];
            rotations[b * 4] = body.rotation[0]; rotations[b * 4 + 1] = body.rotation[1]; rotations[b * 4 + 2] = body.rotation[2]; rotations[b * 4 + 3] = body.rotation[3];
            radii[b] = RIGID_RADIUS; keys[b] = b; targets[b] = b; // each body is its own target/shape
            offsets.set(body.offsets, s * 3);
            starts[b] = s; counts[b] = k; s += k;
            targetStructures.set(b, await buildClusterStructure(ctx, body.offsets));
        }

        const list: ParticleList = {
            count: n, keys, targets, coordinates, rotations, radii,
            getParticleLabel: (i: number) => this.bodies[i]?.label ?? `Body ${i}`,
            sourceData: { kind: 'particle-dynamics-demo' } as unknown as ModelFormat,
            customProperties: new CustomProperties(),
            _propertyData: {},
        };
        Particle.setRigidClusters(list, { offsets, starts, counts });
        Particle.setTargetStructures(list, targetStructures);
        return list;
    }

    stop() {
        this.plugin.managers.animation.stop();
    }
}

(window as any).ParticleDynamicsDemo = new ParticleDynamicsDemo();
