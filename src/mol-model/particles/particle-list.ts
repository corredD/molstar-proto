/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { OrderedSet } from '../../mol-data/int';
import { Mat4, Quat, Vec3 } from '../../mol-math/linear-algebra';
import { Sphere3D } from '../../mol-math/geometry';
import { BoundaryHelper } from '../../mol-math/geometry/boundary-helper';
import { ModelFormat } from '../../mol-model-formats/format';
import { CustomProperties, CustomPropertyDescriptor } from '../custom-property';
import { Boundary } from '../../mol-math/geometry/boundary';

export interface ParticleList {
    readonly entryId?: string
    readonly label?: string

    readonly count: number

    /** Unique keys for each particle for mapping to source data. */
    readonly keys: Int32Array

    /**
     * Per-particle target index (length = `count`). Each value identifies which
     * target structure (or later volume) this particle belongs to.  Use 0 for
     * single-target data.  The distinct values in this array correspond to the
     * keys of `targetMapping` when present.
     */
    readonly targets: Int32Array

    /**
     * Optional mapping from each unique target ID in `targets` to the list of
     * canonical chain IDs (label_asym_id values) that make up the reference
     * structure for that target.  Used by `buildTargetStructuresFromMapping`
     * in `src/mol-model/particles/particle-structure-registry.ts` to automatically
     * split a parent structure into per-target sub-structures.
     */
    readonly targetMapping?: ReadonlyMap<number, ReadonlyArray<string>>

    /**
     * Optional mapping from each unique target ID in `targets` to a trajectory model index.
     * When present, each target's reference structure is the full structure built from that
     * trajectory model, rather than a chain-split sub-structure of a single parent structure.
     * Used by the petworld mmCIF variant where each molecule type is stored as a separate model
     * (`pdbx_PDB_model_num`) and chain IDs are reused across models. Takes precedence over
     * `targetMapping`.
     */
    readonly targetModels?: ReadonlyMap<number, number>

    /**
     * Optional per-particle compartment index (length = `count`). Each value identifies
     * which compartment this particle belongs to. A value of -1 means "no compartment".
     * The distinct non-negative values correspond to keys of `compartmentInfo`.
     */
    readonly compartments?: Int32Array

    /**
     * Optional mapping from each unique compartment index in `compartments` to the
     * compartment name/path string (e.g. `"root.mge.surface.proteins"`).
     */
    readonly compartmentInfo?: ReadonlyMap<number, string>

    /**
     * Optional per-particle entity index (length = `count`). Each value identifies
     * which entity (molecule type) this particle belongs to. A value of -1 means "no entity".
     * The distinct non-negative values correspond to keys of `entityInfo`.
     */
    readonly entities?: Int32Array

    /**
     * Optional mapping from each unique entity index in `entities` to the entity
     * name string (e.g. `"MG_191_192_NAP"`).
     */
    readonly entityInfo?: ReadonlyMap<number, string>

    /** Particle positions in angstrom, packed as `[x0, y0, z0, x1, y1, z1, ...]`. */
    readonly coordinates: Float32Array
    /** Optional per-particle orientations as unit quaternions, packed as `[x0, y0, z0, w0, ...]`. */
    readonly rotations?: Float32Array
    /** Optional per-particle bounding sphere radii in angstrom (length = `count`). */
    readonly radii?: Float32Array

    /**
     * Optional polyline (fiber) connectivity over particles, stored in compressed-sparse-row
     * form. Fiber `f` (for `0 <= f < count`) is the ordered polyline through the particles
     * `indices[offsets[f]]` .. `indices[offsets[f + 1]) - 1]`. Used by formats such as
     * Simularium where an agent expands into a chain of particles. Currently informational
     */
    readonly fibers?: {
        readonly count: number
        readonly offsets: Int32Array
        readonly indices: Int32Array
    }

    /**
     * Named per-particle scalar attributes, indexed by particle position (length = count).
     * Keys are short identifiers (e.g. 'cc', 'class', 'score').
     */
    readonly attributes?: ReadonlyMap<string, Float32Array>

    /** Metadata for each key in `attributes`. */
    readonly attributeInfo?: ReadonlyMap<string, {
        readonly label: string
        readonly min: number
        readonly max: number
    }>

    readonly getParticleLabel: (index: number) => string

    readonly sourceData: ModelFormat

    customProperties: CustomProperties
    _propertyData: { [name: string]: any }
}

const RigidClustersDescriptor = CustomPropertyDescriptor({ name: 'particle-rigid-clusters' });

/**
 * A reference object instanced at each particle of a given target id. Each particle has
 * exactly one target id (see `ParticleList.targets`); the distinct target ids map to these
 * targets via `Particle.setParticleTargets` / `Particle.getParticleTargets`.
 */
export type ParticleTarget =
    | { readonly kind: 'structure', readonly structure: import('../structure/structure').Structure }
    | { readonly kind: 'shape', readonly shape: import('../shape/shape').Shape }

export function getParticleTransforms(data: ParticleList) {
    const particleCount = data.count;
    const transforms: Mat4[] = [];
    const { rotations } = data;

    for (let i = 0; i < particleCount; ++i) {
        const cOffset = i * 3;

        let transform: Mat4;
        if (rotations) {
            const qOffset = i * 4;
            const q = Quat.create(
                rotations[qOffset + 0],
                rotations[qOffset + 1],
                rotations[qOffset + 2],
                rotations[qOffset + 3],
            );
            transform = Mat4.fromQuat(Mat4(), q);
        } else {
            transform = Mat4.identity();
        }
        transform[12] = data.coordinates[cOffset + 0];
        transform[13] = data.coordinates[cOffset + 1];
        transform[14] = data.coordinates[cOffset + 2];
        transforms.push(transform);
    }

    return transforms;
}

/**
 * Per-particle transforms restricted to a single type/entity (`entities[i] === entity`), in
 * particle-index order. `entity < 0`, or a list without `entities`, yields all particle transforms.
 *
 * Used to instance a structure at only one molecule type's particles (see the `particles-structure`
 * transform). The build and the live dynamics update must use this same predicate/order so the
 * filtered instances stay consistent across a simulation step.
 */
export function getParticleTransformsForEntity(data: ParticleList, entity: number): Mat4[] {
    const all = getParticleTransforms(data);
    const { entities } = data;
    if (entity < 0 || !entities) return all;
    const out: Mat4[] = [];
    for (let i = 0; i < all.length; ++i) {
        if (entities[i] === entity) out.push(all[i]);
    }
    return out;
}

/**
 * Expand a particle list into one transform per rigid-cluster collision sphere: each body's
 * transform composed with a translation by the body-local sphere offset, placing a reference
 * geometry at every collision sphere (e.g. the cube/tube/kmeans spheres). `bodyOf` maps each
 * produced transform back to its source particle (body) so themes and picking remain per-body.
 *
 * When no rigid clusters are attached this is equivalent to `getParticleTransforms` with an
 * identity body->particle mapping.
 */
export function getParticleClusterTransforms(data: ParticleList): { transforms: Mat4[], bodyOf: Int32Array } {
    const clusters = Particle.getRigidClusters(data);
    if (!clusters) {
        const transforms = getParticleTransforms(data);
        const bodyOf = new Int32Array(transforms.length);
        for (let i = 0; i < bodyOf.length; ++i) bodyOf[i] = i;
        return { transforms, bodyOf };
    }

    const { offsets, starts, counts } = clusters;
    const { coordinates, rotations, count } = data;
    let total = 0;
    for (let b = 0; b < count; ++b) total += counts[b];

    const transforms: Mat4[] = [];
    const bodyOf = new Int32Array(total);
    let si = 0;
    for (let b = 0; b < count; ++b) {
        let base: Mat4;
        if (rotations) {
            const qOffset = b * 4;
            base = Mat4.fromQuat(Mat4(), Quat.create(rotations[qOffset + 0], rotations[qOffset + 1], rotations[qOffset + 2], rotations[qOffset + 3]));
        } else {
            base = Mat4.identity();
        }
        const px = coordinates[b * 3 + 0], py = coordinates[b * 3 + 1], pz = coordinates[b * 3 + 2];
        const s0 = starts[b], n = counts[b];
        for (let k = 0; k < n; ++k) {
            const o = (s0 + k) * 3;
            const ox = offsets[o + 0], oy = offsets[o + 1], oz = offsets[o + 2];
            const m = Mat4.clone(base);
            // world translation = body position + R_body * offset (keeping the body rotation)
            m[12] = px + m[0] * ox + m[4] * oy + m[8] * oz;
            m[13] = py + m[1] * ox + m[5] * oy + m[9] * oz;
            m[14] = pz + m[2] * ox + m[6] * oy + m[10] * oz;
            transforms.push(m);
            bodyOf[si++] = b;
        }
    }
    return { transforms, bodyOf };
}

/**
 * Enforce a one-type-one-target invariant: remap `targets` so every particle of the same *type*
 * shares a single target id, and each target id covers exactly one type. The type is read from
 * `typeField` (default `entities`, the per-particle molecule-type category) — which field carries
 * "type" depends on the data source, so it is configurable.
 *
 * Because the distinct target ids key the reference objects (structures/shapes) that get instanced
 * at each particle, collapsing `targets` to the type means a single reference is instanced across all
 * copies of a type, instead of one reference per chain/copy. `targetMapping` and `targetModels` (the
 * per-target reference descriptors) are rebuilt for the new ids using the *first-seen* old target of
 * each type as the representative.
 *
 * Particles with no type (value `< 0`), or lists lacking the type field, keep their original target
 * grouping (each preserved as its own target). Idempotent on data that is already one-type-one-target.
 */
export function groupTargetsByType(particles: ParticleList, typeField: 'entities' | 'compartments' = 'entities'): ParticleList {
    const types = particles[typeField];
    const { count, targets } = particles;

    // type key -> new compact target id, assigned in first-appearance order
    const keyToNewId = new Map<string, number>();
    // new target id -> a representative old target id, for rebuilding the reference descriptors
    const newIdToOldTarget = new Map<number, number>();
    const newTargets = new Int32Array(count);

    for (let i = 0; i < count; ++i) {
        // typed particles group by type; untyped particles fall back to their existing target
        const key = types && types[i] >= 0 ? `e${types[i]}` : `t${targets[i]}`;
        let id = keyToNewId.get(key);
        if (id === undefined) {
            id = keyToNewId.size;
            keyToNewId.set(key, id);
            newIdToOldTarget.set(id, targets[i]);
        }
        newTargets[i] = id;
    }

    const remap = <V>(old: ReadonlyMap<number, V> | undefined): ReadonlyMap<number, V> | undefined => {
        if (!old) return undefined;
        const next = new Map<number, V>();
        for (const [newId, oldTarget] of newIdToOldTarget) {
            const v = old.get(oldTarget);
            if (v !== undefined) next.set(newId, v);
        }
        return next;
    };

    return {
        ...particles,
        targets: newTargets,
        targetMapping: remap(particles.targetMapping),
        targetModels: remap(particles.targetModels),
    };
}

export namespace Particle {
    /** A single particle within a `ParticleList`. */
    export interface Location {
        readonly kind: 'particle-location'
        particles: ParticleList
        /** Particle index in the list. */
        index: number
    }

    export function Location(particles?: ParticleList, index = 0): Location {
        return { kind: 'particle-location', particles: particles!, index };
    }
    export function isLocation(x: any): x is Location {
        return !!x && x.kind === 'particle-location';
    }
    /** Write the particle's position into `out`. */
    export function position(out: Vec3, location: Location): Vec3 {
        const i = location.index * 3;
        const { coordinates } = location.particles;
        return Vec3.set(out, coordinates[i], coordinates[i + 1], coordinates[i + 2]);
    }

    /** A loci over one or more particles in a `ParticleList`. */
    export interface Loci {
        readonly kind: 'particle-loci'
        readonly particles: ParticleList
        readonly indices: OrderedSet<number>
    }
    export function Loci(particles: ParticleList, indices: OrderedSet<number>): Loci {
        return { kind: 'particle-loci', particles, indices };
    }
    export function isLoci(x: any): x is Loci {
        return !!x && x.kind === 'particle-loci';
    }
    export function areLociEqual(a: Loci, b: Loci) {
        return a.particles === b.particles && OrderedSet.areEqual(a.indices, b.indices);
    }
    export function isLociEmpty(loci: Loci) {
        return OrderedSet.isEmpty(loci.indices);
    }
    export function lociSize(loci: Loci) {
        return OrderedSet.size(loci.indices);
    }
    /** Remap a loci to a new `ParticleList`; indices outside the new range are dropped. */
    export function remapLoci(loci: Loci, particles: ParticleList): Loci {
        if (loci.particles === particles) return loci;
        const { count } = particles;
        if (count === 0) return Loci(particles, OrderedSet.Empty);
        const filtered: number[] = [];
        OrderedSet.forEach(loci.indices, v => { if (v < count) filtered.push(v); });
        return Loci(particles, OrderedSet.ofSortedArray(filtered));
    }

    const _boundaryHelper = new BoundaryHelper('98');
    const _tmpPos = Vec3();
    export function getBoundingSphere(loci: Loci, boundingSphere?: Sphere3D): Sphere3D {
        if (!boundingSphere) boundingSphere = Sphere3D();
        const { particles, indices } = loci;
        const { coordinates, radii } = particles;
        if (OrderedSet.isEmpty(indices)) {
            boundingSphere.center[0] = boundingSphere.center[1] = boundingSphere.center[2] = 0;
            boundingSphere.radius = 0;
            return boundingSphere;
        }
        _boundaryHelper.reset();
        if (radii) {
            OrderedSet.forEach(indices, v => {
                const i = v * 3;
                Vec3.set(_tmpPos, coordinates[i], coordinates[i + 1], coordinates[i + 2]);
                _boundaryHelper.includePositionRadius(_tmpPos, radii[v]);
            });
            _boundaryHelper.finishedIncludeStep();
            OrderedSet.forEach(indices, v => {
                const i = v * 3;
                Vec3.set(_tmpPos, coordinates[i], coordinates[i + 1], coordinates[i + 2]);
                _boundaryHelper.radiusPositionRadius(_tmpPos, radii[v]);
            });
        } else {
            OrderedSet.forEach(indices, v => {
                const i = v * 3;
                Vec3.set(_tmpPos, coordinates[i], coordinates[i + 1], coordinates[i + 2]);
                _boundaryHelper.includePosition(_tmpPos);
            });
            _boundaryHelper.finishedIncludeStep();
            OrderedSet.forEach(indices, v => {
                const i = v * 3;
                Vec3.set(_tmpPos, coordinates[i], coordinates[i + 1], coordinates[i + 2]);
                _boundaryHelper.radiusPosition(_tmpPos);
            });
        }
        const sphere = _boundaryHelper.getSphere();
        Sphere3D.copy(boundingSphere, sphere);
        return boundingSphere;
    }

    export function getLabel(loci: Loci): string {
        const size = OrderedSet.size(loci.indices);
        if (size === 0) return 'None';
        if (size === 1) {
            const index = OrderedSet.start(loci.indices);
            return loci.particles.getParticleLabel(index);
        }
        return `${size} Particles`;
    }

    const ParticleTargetsDescriptor = CustomPropertyDescriptor({ name: 'particle-targets' });
    export function setParticleTargets(
        particles: ParticleList,
        map: ReadonlyMap<number, ParticleTarget>
    ): void {
        particles.customProperties.add(ParticleTargetsDescriptor);
        particles._propertyData[ParticleTargetsDescriptor.name] = map;
    }
    export function getParticleTargets(
        particles: ParticleList
    ): ReadonlyMap<number, ParticleTarget> | undefined {
        return particles._propertyData[ParticleTargetsDescriptor.name];
    }

    export const BoundaryDescriptor: CustomPropertyDescriptor<Boundary> = CustomPropertyDescriptor({ name: 'particle-boundary' });
    export function setBoundary(particles: ParticleList, boundary: Boundary): void {
        particles.customProperties.add(BoundaryDescriptor);
        particles._propertyData[BoundaryDescriptor.name] = boundary;
    }
    const boundaryHelperCoarse = new BoundaryHelper('14');
    const boundaryHelperFine = new BoundaryHelper('98');
    function getBoundaryHelper(count: number) {
        return count > 10_000 ? boundaryHelperCoarse : boundaryHelperFine;
    }
    export function getBoundary(particles: ParticleList): Boundary {
        if (!particles._propertyData[BoundaryDescriptor.name]) {
            // Compute boundary from particle positions and radii, and store it in the particle list for later retrieval.
            // loop over positions and radii to compute the boundary
            const { count, coordinates, radii } = particles;
            const boundaryHelper = getBoundaryHelper(count);
            const _tmpPos = Vec3();
            boundaryHelper.reset();
            if (radii) {
                for (let i = 0; i < count; i++) {
                    const cOffset = i * 3;
                    Vec3.set(_tmpPos, coordinates[cOffset], coordinates[cOffset + 1], coordinates[cOffset + 2]);
                    boundaryHelper.includePositionRadius(_tmpPos, radii[i]);
                }
                boundaryHelper.finishedIncludeStep();
                for (let i = 0; i < count; i++) {
                    const cOffset = i * 3;
                    Vec3.set(_tmpPos, coordinates[cOffset], coordinates[cOffset + 1], coordinates[cOffset + 2]);
                    boundaryHelper.radiusPositionRadius(_tmpPos, radii[i]);
                }
            } else {
                for (let i = 0; i < count; i++) {
                    const cOffset = i * 3;
                    Vec3.set(_tmpPos, coordinates[cOffset], coordinates[cOffset + 1], coordinates[cOffset + 2]);
                    boundaryHelper.includePosition(_tmpPos);
                }
                boundaryHelper.finishedIncludeStep();
                for (let i = 0; i < count; i++) {
                    const cOffset = i * 3;
                    Vec3.set(_tmpPos, coordinates[cOffset], coordinates[cOffset + 1], coordinates[cOffset + 2]);
                    boundaryHelper.radiusPosition(_tmpPos);
                }
            }
            const sphere = boundaryHelper.getSphere();
            particles._propertyData[BoundaryDescriptor.name] = { box: boundaryHelper.getBox(), sphere };
        };
        return particles._propertyData[BoundaryDescriptor.name];
    }

    /**
     * Per-body rigid-cluster geometry for the dynamics: the collision spheres that make up each
     * rigid body, allowing a different shape (and sphere count) per particle. `offsets` are
     * body-local sphere centres (mean-centred per body), packed `[x,y,z,...]` for ALL spheres of all
     * bodies in order; body `b` owns spheres `[starts[b], starts[b] + counts[b])`. When absent, the
     * dynamics falls back to a single uniform `rigidShape` for every body.
     */
    export interface RigidClusters {
        readonly offsets: Float32Array
        readonly starts: Int32Array
        readonly counts: Int32Array
    }

    export function setRigidClusters(particles: ParticleList, clusters: RigidClusters): void {
        particles.customProperties.add(RigidClustersDescriptor);
        particles._propertyData[RigidClustersDescriptor.name] = clusters;
    }

    export function getRigidClusters(particles: ParticleList): RigidClusters | undefined {
        return particles._propertyData?.[RigidClustersDescriptor.name];
    }
}
