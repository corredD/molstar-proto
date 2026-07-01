/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Quat, Vec3 } from '../../mol-math/linear-algebra';
import { MeshSurface } from '../../mol-math/geometry/mesh-surface';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { ParticleList, Particle } from './particle-list';

/**
 * Parameters of the trivial CPU particle stepper. This is a placeholder engine that proves the
 * dynamic-update plumbing (compute each frame instead of playing one back); it is meant to be
 * swapped for a real solver (XPBD / position-based dynamics) behind the same `ParticleDynamics`
 * interface without touching the representation or the animation that drives it.
 */
export const ParticleDynamicsParams = {
    gravity: PD.Vec3(Vec3.create(0, -50, 0), {}, { description: 'Constant acceleration applied each step (arbitrary units).' }),
    damping: PD.Numeric(0.01, { min: 0, max: 1, step: 0.01 }, { description: 'Fraction of velocity removed each step (0 = frictionless).' }),
    bounds: PD.Numeric(150, { min: 1, max: 2000, step: 1 }, { description: 'Half-extent of the cubic box the particles bounce inside, in angstrom.' }),
    restitution: PD.Numeric(0.8, { min: 0, max: 1, step: 0.05 }, { description: 'Fraction of velocity kept when bouncing off a wall or off another particle.' }),
    collisions: PD.Boolean(true, { description: 'Resolve sphere-sphere overlaps between particles each step (push apart + exchange momentum).' }),
    solverIterations: PD.Numeric(4, { min: 1, max: 32, step: 1 }, { description: 'Constraint-solver passes per step. A single pass cannot unwind dense or high-gravity sphere stacks (residual overlaps, beads pushed through a surface); more passes converge them, at higher cost.' }),
    particleRadius: PD.Numeric(10, { min: 0.1, max: 500, step: 0.1 }, { description: 'Uniform collision sphere radius for every particle (the grid assumes a single diameter).' }),
    rigidBody: PD.Boolean(false, { description: 'Flex-style rigid bodies: each particle is a small cluster of collision spheres; collisions between clusters induce a position AND rotation that is fed back to the viewer (shape matching).' }),
    rigidShape: PD.Select('cube', PD.arrayToOptions(['cube', 'tube'] as const), { description: 'Sphere arrangement of a rigid body: "cube" = 4 spheres in a square, "tube" = 5 spheres in a line.' }),
    surfaceCohesion: PD.Numeric(0.4, { min: 0, max: 2, step: 0.05 }, { description: 'Attraction pulling surface-constrained particles of the same compartment together each step (clamped). 0 = no attraction. See `Particle.setSurfaceBindings`.' }),
    surfaceOrient: PD.Boolean(true, { description: 'Orient surface-constrained objects to the surface normal.' }),
    surfaceOrientAxis: PD.Vec3(Vec3.create(0, 0, 1), {}, { description: 'Local axis of a surface-constrained object aligned to the surface normal (default +Z).' }),
    timestep: PD.Numeric(0.016, { min: 0.001, max: 0.1, step: 0.001 }, { description: 'Integration timestep per simulation step.' }),
    angularSpeed: PD.Numeric(0, { min: 0, max: 20, step: 0.1 }, { description: 'Artificial tumble rate (non-rigid only): each particle spins forever about a fixed random axis at this many radians per second. 0 = no tumble (default); use rigid bodies for physical rotation that settles.' }),
    seed: PD.Numeric(1, { min: 0, max: 65535, step: 1 }, { description: 'Seed for the initial velocities and spin axes (deterministic).' }),
};
export type ParticleDynamicsParams = typeof ParticleDynamicsParams
export type ParticleDynamicsProps = PD.Values<ParticleDynamicsParams>

export interface ParticleDynamics {
    readonly count: number
    /**
     * Advance the simulation to step `index` and write the result into the backing `ParticleList`
     * (positions and, if present, orientations) in place. Sequential: it integrates forward from the
     * current step; requesting an earlier index resets and re-simulates. This is the seam a real
     * physics engine would implement - the frame is *computed*, not looked up.
     */
    getFrameAtIndex: (index: number) => void
    /** Advance exactly one timestep. */
    step: () => void
    /** Restore the initial positions/orientations and zero the velocities. */
    reset: () => void
    /** Update the live-tunable props (gravity, damping, radius, ...) so changes take effect on the next step. */
    setProps: (props: ParticleDynamicsProps) => void
}

/** Structural props that change the simulation's shape (sphere count / layout) and require a rebuild
 * rather than a live `setProps` update. */
export function particleDynamicsStructuralKey(props: ParticleDynamicsProps): string {
    return `${props.rigidBody}|${props.rigidShape}|${props.seed}`;
}

/** Small deterministic PRNG (mulberry32) so a given seed reproduces the same motion. */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Body-local rest offsets (mean-centred) of the collision spheres that make up one rigid body.
 * Exported so a viewer can build a matching reference shape (e.g. to render the rigid clusters). */
export function particleRigidShapeOffsets(kind: 'cube' | 'tube', r: number): Float32Array {
    if (kind === 'tube') {
        // 5 spheres in a line along x, touching (spacing = one diameter), mean-centred
        const out = new Float32Array(5 * 3);
        for (let k = 0; k < 5; ++k) out[k * 3] = (k - 2) * 2 * r;
        return out;
    }
    // 'cube': 4 spheres at the corners of a square (side = one diameter), mean-centred
    return new Float32Array([
        r, r, 0, r, -r, 0, -r, r, 0, -r, -r, 0,
    ]);
}

/** Iterations of the shape-match rotation extraction; warm-started, it converges in 1-2 in practice. */
const RIGID_ITERS = 16;

/**
 * Create a trivial CPU dynamics for a `ParticleList`: semi-implicit-Euler translation under gravity
 * with damping and reflective box walls, optional sphere-sphere collisions between particles, and a
 * constant per-particle tumble. With `rigidBody` enabled it instead simulates each particle as a
 * Flex-style rigid cluster of collision spheres and recovers a position + orientation per cluster via
 * shape matching. `step`/`getFrameAtIndex` mutate the list's `coordinates` (and `rotations`, if
 * present) in place, so a representation built from the same list reflects the motion once its
 * instance transforms are refreshed.
 *
 * Particles whose `compartment` is bound to a mesh via `Particle.setSurfaceBindings` are instead
 * constrained to that surface: each step they are attracted toward same-compartment neighbours
 * (`surfaceCohesion`), projected back onto the mesh, and oriented to the surface normal - a port of
 * the surface-relaxation packing the fullerene engine demonstrates. (Surface mode is non-rigid in
 * v1; no per-type affinity matrix or inside/outside confinement yet.)
 */
export function createParticleDynamics(particles: ParticleList, props: ParticleDynamicsProps): ParticleDynamics {
    const count = particles.count;
    const coords = particles.coordinates;
    const rotations = particles.rotations;

    // Live-tunable props: kept in `let`s and refreshed by `setProps` so a running animation reacts to
    // UI changes (e.g. dragging the radius slider) without rebuilding the simulation.
    let gravity = props.gravity;
    let dt = props.timestep;
    let keep = Math.max(0, 1 - props.damping);
    let bounds = props.bounds;
    let restitution = props.restitution;
    let collisions = props.collisions;
    let solverIterations = Math.max(1, props.solverIterations | 0);
    // Uniform collision radius for every particle - the grid assumes a single diameter. Per-particle
    // `radii` from the source data are intentionally ignored here so the cell size stays uniform.
    let particleRadius = props.particleRadius;
    let invCell = 1 / Math.max(2 * particleRadius, 1e-3);
    let surfaceCohesion = props.surfaceCohesion;
    let surfaceOrient = props.surfaceOrient;
    // local axis (unit) aligned to the surface normal for `on`-constrained objects; refreshed by setProps
    const orientAxis = Vec3.create(0, 0, 1);
    const setOrientAxis = (v: Vec3) => {
        const m = Vec3.magnitude(v);
        if (m > 1e-6) Vec3.scale(orientAxis, v, 1 / m); else Vec3.set(orientAxis, 0, 0, 1);
    };
    setOrientAxis(props.surfaceOrientAxis);
    // half-extent of the largest bound mesh (set in the surface setup below); the reflective box grows
    // to at least this so it never clips a mesh the particles are constrained to
    let meshExtent = 0;
    let boxBounds = props.bounds;

    // initial state for reset
    const coords0 = Float32Array.from(coords);
    const rotations0 = rotations ? Float32Array.from(rotations) : undefined;

    // --- rigid-body (Flex-style shape matching) setup ------------------------------------------
    // When enabled, every particle becomes a small rigid cluster of collision spheres. The spheres
    // collide as individuals (driving translation AND torque); after each step a best-fit rigid
    // transform is recovered per cluster (shape matching) and written back as the particle's position
    // + orientation, so the viewer sees a tumbling rigid body. Rigidity within a body is enforced by
    // the shape match, NOT by collisions - intra-body sphere pairs are skipped in the broadphase.
    const rigid = props.rigidBody && !!rotations;

    // Per-body rigid clusters: each body is a set of collision spheres with body-local rest offsets,
    // so different bodies can have different shapes AND sphere counts. Prefer clusters attached to the
    // list (heterogeneous); otherwise synthesize a uniform `rigidShape` cluster for every body.
    // `clusterOffsets` packs every sphere's offset `[x,y,z,...]` by global sphere index; body `b` owns
    // spheres `[clusterStart[b], clusterStart[b] + clusterCount[b])`.
    let clusterOffsets: Float32Array | undefined;
    let clusterStart: Int32Array | undefined;
    let clusterCount: Int32Array | undefined;
    let simCount = count; // total collision spheres
    if (rigid) {
        const attached = Particle.getRigidClusters(particles);
        if (attached) {
            clusterOffsets = attached.offsets; clusterStart = attached.starts; clusterCount = attached.counts;
            simCount = 0; for (let b = 0; b < count; ++b) simCount += clusterCount[b];
        } else {
            const off = particleRigidShapeOffsets(props.rigidShape, particleRadius);
            const k = off.length / 3;
            clusterOffsets = new Float32Array(count * k * 3); clusterStart = new Int32Array(count); clusterCount = new Int32Array(count);
            for (let b = 0; b < count; ++b) { clusterStart[b] = b * k; clusterCount[b] = k; clusterOffsets.set(off, b * k * 3); }
            simCount = count * k;
        }
    }

    // Physics integrate/collide operate on collision spheres. Non-rigid: the spheres ARE the
    // particles, so `pos` aliases the list's coordinates. Rigid: the spheres are internal sub-bodies
    // and the particle coordinates/rotations are written from the shape match.
    const pos = rigid ? new Float32Array(simCount * 3) : coords;
    const vel = new Float32Array(simCount * 3);
    const prevPos = rigid ? new Float32Array(simCount * 3) : undefined; // start-of-step positions (PBD velocity)
    const bodyOf = rigid ? new Int32Array(simCount) : undefined; // sphere -> body, for intra-body exclusion
    const bodyQuat = rigid ? new Float32Array(count * 4) : undefined; // per-body orientation (shape-match warm start)
    if (bodyOf && clusterStart && clusterCount) {
        for (let b = 0; b < count; ++b) { const s0 = clusterStart[b], n = clusterCount[b]; for (let k = 0; k < n; ++k) bodyOf[s0 + k] = b; }
    }

    const spinAxes = (!rigid && rotations) ? new Float32Array(count * 3) : undefined; // fixed unit axis per particle
    let spinAngle = rotations ? props.angularSpeed * dt : 0; // radians per step

    const setProps = (p: ParticleDynamicsProps) => {
        gravity = p.gravity;
        dt = p.timestep;
        keep = Math.max(0, 1 - p.damping);
        bounds = p.bounds;
        restitution = p.restitution;
        collisions = p.collisions;
        solverIterations = Math.max(1, p.solverIterations | 0);
        particleRadius = p.particleRadius;
        invCell = 1 / Math.max(2 * particleRadius, 1e-3);
        surfaceCohesion = p.surfaceCohesion;
        surfaceOrient = p.surfaceOrient;
        setOrientAxis(p.surfaceOrientAxis);
        boxBounds = Math.max(p.bounds, meshExtent);
        spinAngle = rotations ? p.angularSpeed * dt : 0;
    };

    // temporaries reused across the step (avoid per-call allocation)
    const axis = Vec3();
    const dq = Quat();
    const q = Quat();
    const tmp = Vec3();
    const apq = new Float32Array(9); // shape-match covariance, column-major

    // --- surface constraints -------------------------------------------------------------------
    // A particle whose compartment is bound to a mesh (Particle.setSurfaceBindings) is constrained by
    // that mesh. `mode` decides how: `on` sticks it to the surface (skip the free integrate/box path;
    // attract to same-compartment neighbours, project, orient); `inside`/`outside` keep it free but
    // collide it with the mesh so it never crosses (confined inside / excluded outside). Non-rigid only.
    const MODE_NONE = 0, MODE_ON = 1, MODE_INSIDE = 2, MODE_OUTSIDE = 3;
    // surface bindings apply to both modes: non-rigid particles are projected/collided directly; rigid
    // bodies have their center of mass projected/collided (the body still tumbles via shape matching).
    const surfaceBindings = Particle.getSurfaceBindings(particles);
    const compartments = particles.compartments;
    const boundSurfaces: (MeshSurface | undefined)[] | undefined = (surfaceBindings && compartments) ? new Array(count) : undefined;
    const boundMode = boundSurfaces ? new Int8Array(count) : undefined;
    let onCount = 0, collideCount = 0;
    if (boundSurfaces && boundMode && surfaceBindings && compartments) {
        for (let i = 0; i < count; ++i) {
            const b = surfaceBindings.get(compartments[i]);
            boundSurfaces[i] = b?.surface;
            boundMode[i] = !b ? MODE_NONE : b.mode === 'on' ? MODE_ON : b.mode === 'inside' ? MODE_INSIDE : MODE_OUTSIDE;
            if (boundMode[i] === MODE_ON) ++onCount; else if (boundMode[i] !== MODE_NONE) ++collideCount;
        }
    }
    const hasSurface = onCount + collideCount > 0;
    // grow the box to contain every bound mesh so it never clips a surface the particles follow
    if (surfaceBindings) surfaceBindings.forEach(b => { meshExtent = Math.max(meshExtent, b.surface.extent); });
    boxBounds = Math.max(bounds, meshExtent);
    const cohForce = onCount > 0 ? new Float32Array(count * 3) : undefined; // accumulated cohesion pull
    const projPoint = Vec3(), projNormal = Vec3(), constrainPos = Vec3();

    /** Constrain a point to a bound mesh per `mode`: `on` snaps it to the surface; `inside`/`outside`
     * keep it a radius clear on the allowed side. Writes the result to `constrainPos`; returns whether
     * the point was moved (used to decide whether to reflect/rebuild velocity at the call site). */
    const constrain = (surf: MeshSurface, mode: number, x: number, y: number, z: number): boolean => {
        Vec3.set(tmp, x, y, z);
        surf.project(tmp, projPoint, projNormal);
        if (mode === MODE_ON) { Vec3.copy(constrainPos, projPoint); return true; }
        const nx = projNormal[0], ny = projNormal[1], nz = projNormal[2];
        const signed = (x - projPoint[0]) * nx + (y - projPoint[1]) * ny + (z - projPoint[2]) * nz;
        const side = mode === MODE_OUTSIDE ? 1 : -1; // normal side the point must stay on
        if (signed * side < particleRadius) {
            Vec3.set(constrainPos, projPoint[0] + nx * particleRadius * side, projPoint[1] + ny * particleRadius * side, projPoint[2] + nz * particleRadius * side);
            return true;
        }
        return false;
    };

    const rand = mulberry32((props.seed >>> 0) || 1);
    const initState = () => {
        vel.fill(0);
        if (rigid && clusterOffsets && clusterStart && clusterCount && bodyQuat) {
            for (let b = 0; b < count; ++b) {
                // rigid bodies start at rest (velocities already zeroed) and fall under gravity - this
                // keeps a re-collected simulation (e.g. after adding a body to the scene) continuous
                // instead of re-randomising every existing body's velocity
                if (rotations0) Quat.set(q, rotations0[b * 4], rotations0[b * 4 + 1], rotations0[b * 4 + 2], rotations0[b * 4 + 3]);
                else Quat.set(q, 0, 0, 0, 1);
                bodyQuat[b * 4] = q[0]; bodyQuat[b * 4 + 1] = q[1]; bodyQuat[b * 4 + 2] = q[2]; bodyQuat[b * 4 + 3] = q[3];
                let bx = coords[b * 3], by = coords[b * 3 + 1], bz = coords[b * 3 + 2];
                // a surface-stuck body whose COM isn't already on the mesh (i.e. a newly added one) is
                // redistributed across it by sampling; a body already on the surface (carried over from a
                // running sim) keeps its position so adding more bodies doesn't reset the existing ones
                if (boundMode && boundMode[b] === MODE_ON && boundSurfaces && boundSurfaces[b]) {
                    Vec3.set(tmp, bx, by, bz);
                    if (boundSurfaces[b]!.project(tmp, projPoint, projNormal) > 2 * particleRadius) {
                        boundSurfaces[b]!.sample(tmp, rand);
                        bx = tmp[0]; by = tmp[1]; bz = tmp[2];
                    }
                }
                const s0 = clusterStart[b], n = clusterCount[b];
                for (let k = 0; k < n; ++k) {
                    const so = (s0 + k) * 3;
                    Vec3.set(tmp, clusterOffsets[so], clusterOffsets[so + 1], clusterOffsets[so + 2]);
                    Vec3.transformQuat(tmp, tmp, q);
                    pos[so] = bx + tmp[0]; pos[so + 1] = by + tmp[1]; pos[so + 2] = bz + tmp[2];
                }
            }
        } else {
            for (let i = 0; i < count; ++i) {
                // small random initial velocity so the cloud doesn't fall as a rigid block
                vel[i * 3] = (rand() - 0.5) * 20;
                vel[i * 3 + 1] = (rand() - 0.5) * 20;
                vel[i * 3 + 2] = (rand() - 0.5) * 20;
                // `on` particles not already on the mesh (newly added) are redistributed across it by
                // sampling; ones already on it (carried over) keep their position so adding more particles
                // doesn't reset the existing ones. `inside`/`outside` keep their volume position.
                if (boundMode && boundMode[i] === MODE_ON && boundSurfaces && boundSurfaces[i]) {
                    Vec3.set(tmp, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
                    if (boundSurfaces[i]!.project(tmp, projPoint, projNormal) > 2 * particleRadius) {
                        boundSurfaces[i]!.sample(tmp, rand);
                        pos[i * 3] = tmp[0]; pos[i * 3 + 1] = tmp[1]; pos[i * 3 + 2] = tmp[2];
                    }
                }
                if (spinAxes) {
                    const ax = rand() - 0.5, ay = rand() - 0.5, az = rand() - 0.5;
                    const len = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
                    spinAxes[i * 3] = ax / len; spinAxes[i * 3 + 1] = ay / len; spinAxes[i * 3 + 2] = az / len;
                }
            }
        }
    };
    initState();

    // Spatial-hash broadphase for collisions. The cell size is one sphere diameter, so two
    // overlapping spheres are at most one cell apart and a 3x3x3 neighbourhood finds every contact.
    // Cells are hashed into a fixed table (memory bounded by sphere count, not box size), so
    // out-of-range positions still bin and the only consequence of a hash clash is a few wasted
    // distance checks - the actual sphere-sphere test is the sole gate that applies a response.
    // The cell size tracks `invCell`, which `setProps` recomputes when the radius changes.
    let tableSize = 16; while (tableSize < simCount) tableSize <<= 1;
    const tableMask = tableSize - 1;
    const bucketStart = new Int32Array(tableSize + 1); // prefix sums: bucket b is [bucketStart[b], bucketStart[b+1])
    const bucketCursor = new Int32Array(tableSize);
    const sorted = new Int32Array(Math.max(simCount, 1)); // sphere indices grouped by bucket
    const partHash = new Int32Array(Math.max(simCount, 1));
    const seen = new Int32Array(27); // hashes of the neighbour cells already scanned for the current sphere

    const hashCell = (ix: number, iy: number, iz: number) =>
        ((Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) >>> 0) & tableMask;

    /** Resolve sphere-sphere overlaps in `p`/`v` (length `n` spheres). `bodies` (if given) excludes
     * pairs from the same rigid body, whose rigidity is enforced by shape matching instead.
     * `applyImpulse` exchanges momentum; pass `false` on the intermediate iterations of a multi-pass
     * solve (only the positional projection should iterate, so velocities are not over-damped). */
    const resolveCollisions = (p: Float32Array, v: Float32Array, n: number, bodies?: Int32Array, applyImpulse = true) => {
        if (n < 2) return;
        const minD = 2 * particleRadius, minD2 = minD * minD;
        // bin spheres by hashed cell via a counting sort (allocation-stable across steps)
        bucketStart.fill(0);
        for (let i = 0; i < n; ++i) {
            const c = i * 3;
            const h = hashCell(Math.floor(p[c] * invCell), Math.floor(p[c + 1] * invCell), Math.floor(p[c + 2] * invCell));
            partHash[i] = h;
            bucketStart[h + 1]++;
        }
        for (let b = 0; b < tableSize; ++b) bucketStart[b + 1] += bucketStart[b];
        bucketCursor.set(bucketStart.subarray(0, tableSize));
        for (let i = 0; i < n; ++i) sorted[bucketCursor[partHash[i]]++] = i;

        for (let i = 0; i < n; ++i) {
            const ci = i * 3;
            let xi = p[ci], yi = p[ci + 1], zi = p[ci + 2];
            const bi = bodies ? bodies[i] : -1;
            const ix = Math.floor(xi * invCell), iy = Math.floor(yi * invCell), iz = Math.floor(zi * invCell);
            let nSeen = 0;
            for (let dx = -1; dx <= 1; ++dx) for (let dy = -1; dy <= 1; ++dy) for (let dz = -1; dz <= 1; ++dz) {
                const h = hashCell(ix + dx, iy + dy, iz + dz);
                let dup = false; // distinct neighbour cells can hash to the same bucket; visit each bucket once
                for (let s = 0; s < nSeen; ++s) if (seen[s] === h) { dup = true; break; }
                if (dup) continue;
                seen[nSeen++] = h;
                for (let k = bucketStart[h]; k < bucketStart[h + 1]; ++k) {
                    const j = sorted[k];
                    if (j <= i) continue; // each pair once (j > i)
                    if (bodies && bodies[j] === bi) continue; // same rigid body: handled by shape matching
                    const cj = j * 3;
                    const ddx = p[cj] - xi, ddy = p[cj + 1] - yi, ddz = p[cj + 2] - zi;
                    const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
                    if (d2 >= minD2 || d2 < 1e-12) continue; // not touching, or coincident (avoid NaN normal)
                    const d = Math.sqrt(d2);
                    const nx = ddx / d, ny = ddy / d, nz = ddz / d; // unit normal pointing i -> j
                    // positional correction: split the overlap, push each sphere half-way out
                    const corr = (minD - d) * 0.5;
                    p[ci] = (xi -= nx * corr); p[ci + 1] = (yi -= ny * corr); p[ci + 2] = (zi -= nz * corr);
                    p[cj] += nx * corr; p[cj + 1] += ny * corr; p[cj + 2] += nz * corr;
                    // velocity impulse: equal-mass elastic response, only when the spheres are approaching
                    if (!applyImpulse) continue;
                    const vn = (v[cj] - v[ci]) * nx + (v[cj + 1] - v[ci + 1]) * ny + (v[cj + 2] - v[ci + 2]) * nz;
                    if (vn < 0) {
                        const J = -(1 + restitution) * vn * 0.5;
                        v[ci] -= J * nx; v[ci + 1] -= J * ny; v[ci + 2] -= J * nz;
                        v[cj] += J * nx; v[cj + 1] += J * ny; v[cj + 2] += J * nz;
                    }
                }
            }
        }
    };

    /** Pull surface-constrained particles of the same compartment together (clamped band attraction,
     * fullerene-style cohesion), reusing the collision hash. Attraction range (1.8 diameters) fits the
     * 3x3x3 neighbourhood at diameter-sized cells. */
    const applyCohesion = () => {
        if (!boundSurfaces || !boundMode || !cohForce || !compartments) return;
        const diam = 2 * particleRadius;
        const range = diam * 1.8, range2 = range * range, minD2 = diam * diam;
        const maxStep = 0.2 * diam;
        // bin `on`-mode particles into the hash (others marked -1)
        bucketStart.fill(0);
        for (let i = 0; i < count; ++i) {
            if (boundMode[i] !== MODE_ON) { partHash[i] = -1; continue; }
            const c = i * 3;
            const h = hashCell(Math.floor(pos[c] * invCell), Math.floor(pos[c + 1] * invCell), Math.floor(pos[c + 2] * invCell));
            partHash[i] = h; bucketStart[h + 1]++;
        }
        for (let b = 0; b < tableSize; ++b) bucketStart[b + 1] += bucketStart[b];
        bucketCursor.set(bucketStart.subarray(0, tableSize));
        for (let i = 0; i < count; ++i) if (partHash[i] >= 0) sorted[bucketCursor[partHash[i]]++] = i;

        cohForce.fill(0);
        for (let i = 0; i < count; ++i) {
            if (boundMode[i] !== MODE_ON) continue;
            const ci = i * 3, xi = pos[ci], yi = pos[ci + 1], zi = pos[ci + 2], gi = compartments[i];
            const ix = Math.floor(xi * invCell), iy = Math.floor(yi * invCell), iz = Math.floor(zi * invCell);
            let nSeen = 0;
            for (let dx = -1; dx <= 1; ++dx) for (let dy = -1; dy <= 1; ++dy) for (let dz = -1; dz <= 1; ++dz) {
                const h = hashCell(ix + dx, iy + dy, iz + dz);
                let dup = false;
                for (let s = 0; s < nSeen; ++s) if (seen[s] === h) { dup = true; break; }
                if (dup) continue;
                seen[nSeen++] = h;
                for (let k = bucketStart[h], kl = bucketStart[h + 1]; k < kl; ++k) {
                    const j = sorted[k];
                    if (j <= i || compartments[j] !== gi) continue; // each same-surface pair once
                    const cj = j * 3;
                    const ddx = pos[cj] - xi, ddy = pos[cj + 1] - yi, ddz = pos[cj + 2] - zi;
                    const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
                    if (d2 <= minD2 || d2 >= range2) continue; // touching (collisions handle it) or out of band
                    const w = ((d2 ** 0.5) - diam) / (range - diam) / (d2 ** 0.5); // weight / distance
                    cohForce[ci] += ddx * w; cohForce[ci + 1] += ddy * w; cohForce[ci + 2] += ddz * w;
                    cohForce[cj] -= ddx * w; cohForce[cj + 1] -= ddy * w; cohForce[cj + 2] -= ddz * w;
                }
            }
        }
        for (let i = 0; i < count; ++i) {
            if (boundMode[i] !== MODE_ON) continue;
            const ci = i * 3, fx = cohForce[ci], fy = cohForce[ci + 1], fz = cohForce[ci + 2];
            const fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
            if (fl < 1e-9) continue;
            const stepLen = Math.min(surfaceCohesion * maxStep * fl, maxStep) / fl;
            pos[ci] += fx * stepLen; pos[ci + 1] += fy * stepLen; pos[ci + 2] += fz * stepLen;
        }
    };

    /** Surface pass: `on` particles are pulled together, projected onto the mesh and oriented to its
     * normal; `inside`/`outside` particles are collided with the mesh so they never cross it. */
    const surfacePass = () => {
        if (!boundSurfaces || !boundMode) return;
        if (onCount > 0 && surfaceCohesion > 0) applyCohesion();
        for (let i = 0; i < count; ++i) {
            const mode = boundMode[i];
            const surf = boundSurfaces[i];
            if (mode === MODE_NONE || !surf) continue;
            const c = i * 3;
            if (!constrain(surf, mode, pos[c], pos[c + 1], pos[c + 2])) continue;
            pos[c] = constrainPos[0]; pos[c + 1] = constrainPos[1]; pos[c + 2] = constrainPos[2];
            if (mode === MODE_ON) {
                vel[c] *= keep; vel[c + 1] *= keep; vel[c + 2] *= keep; // no normal velocity build-up
                if (surfaceOrient && rotations) {
                    Quat.rotationTo(q, orientAxis, projNormal);
                    const r = i * 4;
                    rotations[r] = q[0]; rotations[r + 1] = q[1]; rotations[r + 2] = q[2]; rotations[r + 3] = q[3];
                }
            } else {
                // reflect the velocity component heading into the wall (projNormal set by `constrain`)
                const side = mode === MODE_OUTSIDE ? 1 : -1;
                const vn = vel[c] * projNormal[0] + vel[c + 1] * projNormal[1] + vel[c + 2] * projNormal[2];
                if (vn * side < 0) {
                    const j = (1 + restitution) * vn;
                    vel[c] -= j * projNormal[0]; vel[c + 1] -= j * projNormal[1]; vel[c + 2] -= j * projNormal[2];
                }
            }
        }
    };

    let index = 0;

    /** Integrate `vel` under gravity + damping and advance `pos` (semi-implicit Euler) for `n` spheres.
     * Surface-constrained particles are skipped - the surface pass drives them position-based. */
    const integrate = (n: number) => {
        for (let i = 0; i < n; ++i) {
            // non-rigid: `i` is a particle; surface-stuck ones are position-based so skip gravity. Rigid:
            // `i` is a sub-sphere (boundMode is body-indexed), so the COM constraint in stepRigid handles it.
            if (!rigid && boundMode && boundMode[i] === MODE_ON) continue;
            const c = i * 3;
            const vx = (vel[c] + gravity[0] * dt) * keep;
            const vy = (vel[c + 1] + gravity[1] * dt) * keep;
            const vz = (vel[c + 2] + gravity[2] * dt) * keep;
            vel[c] = vx; vel[c + 1] = vy; vel[c + 2] = vz;
            pos[c] += vx * dt; pos[c + 1] += vy * dt; pos[c + 2] += vz * dt;
        }
    };

    const stepSimple = () => {
        integrate(count);
        // iterate the positional solve so dense / high-gravity stacks converge (one pass leaves overlaps);
        // momentum is exchanged only on the final pass to avoid over-damping
        if (collisions) for (let it = 0; it < solverIterations; ++it) resolveCollisions(pos, vel, count, undefined, it === solverIterations - 1);
        // reflective cubic box centered at the origin (kept last so particles never escape), plus tumble
        for (let i = 0; i < count; ++i) {
            if (boundMode && boundMode[i] === MODE_ON) continue; // surface pass owns surface-stuck particles
            const c = i * 3;
            let x = pos[c], y = pos[c + 1], z = pos[c + 2];
            let vx = vel[c], vy = vel[c + 1], vz = vel[c + 2];
            if (x > boxBounds) { x = boxBounds; vx = -vx * restitution; } else if (x < -boxBounds) { x = -boxBounds; vx = -vx * restitution; }
            if (y > boxBounds) { y = boxBounds; vy = -vy * restitution; } else if (y < -boxBounds) { y = -boxBounds; vy = -vy * restitution; }
            if (z > boxBounds) { z = boxBounds; vz = -vz * restitution; } else if (z < -boxBounds) { z = -boxBounds; vz = -vz * restitution; }
            pos[c] = x; pos[c + 1] = y; pos[c + 2] = z;
            vel[c] = vx; vel[c + 1] = vy; vel[c + 2] = vz;

            if (rotations && spinAxes) {
                Vec3.set(axis, spinAxes[c], spinAxes[c + 1], spinAxes[c + 2]);
                Quat.setAxisAngle(dq, axis, spinAngle);
                const r = i * 4;
                Quat.set(q, rotations[r], rotations[r + 1], rotations[r + 2], rotations[r + 3]);
                Quat.multiply(q, dq, q);
                Quat.normalize(q, q);
                rotations[r] = q[0]; rotations[r + 1] = q[1]; rotations[r + 2] = q[2]; rotations[r + 3] = q[3];
            }
        }
        if (hasSurface) surfacePass();
        index += 1;
    };

    /** Refine the working quaternion `q` toward the rotational part of the column-major 3x3 `A`
     * (polar decomposition, Müller 2016 - "A robust method to extract the rotational part of
     * deformations"). Warm-started from the body's previous orientation it stays continuous. */
    const extractRotation = (A: Float32Array) => {
        for (let iter = 0; iter < RIGID_ITERS; ++iter) {
            const x = q[0], y = q[1], z = q[2], w = q[3];
            // rotation-matrix columns from q
            const r0x = 1 - 2 * (y * y + z * z), r0y = 2 * (x * y + w * z), r0z = 2 * (x * z - w * y);
            const r1x = 2 * (x * y - w * z), r1y = 1 - 2 * (x * x + z * z), r1z = 2 * (y * z + w * x);
            const r2x = 2 * (x * z + w * y), r2y = 2 * (y * z - w * x), r2z = 1 - 2 * (x * x + y * y);
            const a0x = A[0], a0y = A[1], a0z = A[2];
            const a1x = A[3], a1y = A[4], a1z = A[5];
            const a2x = A[6], a2y = A[7], a2z = A[8];
            let ox = (r0y * a0z - r0z * a0y) + (r1y * a1z - r1z * a1y) + (r2y * a2z - r2z * a2y);
            let oy = (r0z * a0x - r0x * a0z) + (r1z * a1x - r1x * a1z) + (r2z * a2x - r2x * a2z);
            let oz = (r0x * a0y - r0y * a0x) + (r1x * a1y - r1y * a1x) + (r2x * a2y - r2y * a2x);
            const denom = Math.abs(r0x * a0x + r0y * a0y + r0z * a0z + r1x * a1x + r1y * a1y + r1z * a1z + r2x * a2x + r2y * a2y + r2z * a2z) + 1e-9;
            ox /= denom; oy /= denom; oz /= denom;
            const wlen = Math.sqrt(ox * ox + oy * oy + oz * oz);
            if (wlen < 1e-9) break;
            Vec3.set(axis, ox / wlen, oy / wlen, oz / wlen);
            Quat.setAxisAngle(dq, axis, wlen);
            Quat.multiply(q, dq, q);
            Quat.normalize(q, q);
        }
    };

    const stepRigid = () => {
        if (!clusterOffsets || !clusterStart || !clusterCount || !prevPos || !bodyOf || !bodyQuat || !rotations) return;
        // PBD-style: predict, satisfy contacts/walls, then shape-match each body to a rigid pose and
        // derive velocities from the net displacement over the step.
        prevPos.set(pos);
        integrate(simCount);
        // iterate the positional solve (contacts, walls, per-sphere mesh confinement). Velocities are
        // rebuilt from the net displacement after shape matching, so collisions run positional-only.
        for (let it = 0; it < solverIterations; ++it) {
            if (collisions) resolveCollisions(pos, vel, simCount, bodyOf, false);
            // clamp spheres into the box (position only; velocity is rebuilt from the displacement below)
            for (let s = 0; s < simCount; ++s) {
                const c = s * 3;
                if (pos[c] > boxBounds) pos[c] = boxBounds; else if (pos[c] < -boxBounds) pos[c] = -boxBounds;
                if (pos[c + 1] > boxBounds) pos[c + 1] = boxBounds; else if (pos[c + 1] < -boxBounds) pos[c + 1] = -boxBounds;
                if (pos[c + 2] > boxBounds) pos[c + 2] = boxBounds; else if (pos[c + 2] < -boxBounds) pos[c + 2] = -boxBounds;
            }
            // inside/outside confinement collides EVERY sub-sphere with the mesh (not just the COM), so a
            // rigid body can't poke through; the shape match below then fits a rigid pose to the corrected
            // spheres, keeping the whole body on the allowed side. (`on` stays COM-based + orient, per body.)
            if (boundMode && boundSurfaces) {
                for (let b = 0; b < count; ++b) {
                    const mode = boundMode[b], surf = boundSurfaces[b];
                    if (!surf || (mode !== MODE_INSIDE && mode !== MODE_OUTSIDE)) continue;
                    const s0 = clusterStart[b], n = clusterCount[b];
                    for (let k = 0; k < n; ++k) {
                        const so = (s0 + k) * 3;
                        if (constrain(surf, mode, pos[so], pos[so + 1], pos[so + 2])) {
                            pos[so] = constrainPos[0]; pos[so + 1] = constrainPos[1]; pos[so + 2] = constrainPos[2];
                        }
                    }
                }
            }
        }

        const invDt = 1 / dt;
        for (let b = 0; b < count; ++b) {
            const s0 = clusterStart[b], n = clusterCount[b];
            if (n === 0) continue;
            // center of mass of the (post-collision) spheres
            let cx = 0, cy = 0, cz = 0;
            for (let k = 0; k < n; ++k) { const so = (s0 + k) * 3; cx += pos[so]; cy += pos[so + 1]; cz += pos[so + 2]; }
            cx /= n; cy /= n; cz /= n;
            // covariance Apq = sum (p - c) (x) rest   (column-major: apq[col*3 + row]); rest offset of
            // a sphere is stored at its own global index, so the offset and position share index `so`
            apq.fill(0);
            for (let k = 0; k < n; ++k) {
                const so = (s0 + k) * 3;
                const px = pos[so] - cx, py = pos[so + 1] - cy, pz = pos[so + 2] - cz;
                const rx = clusterOffsets[so], ry = clusterOffsets[so + 1], rz = clusterOffsets[so + 2];
                apq[0] += px * rx; apq[1] += py * rx; apq[2] += pz * rx;
                apq[3] += px * ry; apq[4] += py * ry; apq[5] += pz * ry;
                apq[6] += px * rz; apq[7] += py * rz; apq[8] += pz * rz;
            }
            // best-fit rotation, warm-started from the body's previous orientation
            Quat.set(q, bodyQuat[b * 4], bodyQuat[b * 4 + 1], bodyQuat[b * 4 + 2], bodyQuat[b * 4 + 3]);
            extractRotation(apq);
            bodyQuat[b * 4] = q[0]; bodyQuat[b * 4 + 1] = q[1]; bodyQuat[b * 4 + 2] = q[2]; bodyQuat[b * 4 + 3] = q[3];
            // `on`: stick the body's centre of mass to the surface and align its chosen local axis to the
            // surface normal (request: surface-constrained objects oriented along Z by default). The
            // alignment is twist-preserving - it rotates the shape-matched orientation minimally onto the
            // normal, so the body can still spin in-plane. (inside/outside already confined per-sphere above.)
            if (boundMode && boundSurfaces && boundMode[b] === MODE_ON) {
                const surf = boundSurfaces[b];
                if (surf && constrain(surf, MODE_ON, cx, cy, cz)) {
                    cx = constrainPos[0]; cy = constrainPos[1]; cz = constrainPos[2];
                    if (surfaceOrient) {
                        // current world direction of the body's local orient axis, then rotate it onto the normal
                        Vec3.transformQuat(tmp, orientAxis, q);
                        Quat.rotationTo(dq, tmp, projNormal);
                        Quat.multiply(q, dq, q);
                        Quat.normalize(q, q);
                    }
                }
            }
            // write the rigid pose back to the viewer particle
            coords[b * 3] = cx; coords[b * 3 + 1] = cy; coords[b * 3 + 2] = cz;
            rotations[b * 4] = q[0]; rotations[b * 4 + 1] = q[1]; rotations[b * 4 + 2] = q[2]; rotations[b * 4 + 3] = q[3];
            // snap spheres to the rigid goal positions and rebuild velocities from the step displacement
            for (let k = 0; k < n; ++k) {
                const so = (s0 + k) * 3;
                Vec3.set(tmp, clusterOffsets[so], clusterOffsets[so + 1], clusterOffsets[so + 2]);
                Vec3.transformQuat(tmp, tmp, q);
                const gx = cx + tmp[0], gy = cy + tmp[1], gz = cz + tmp[2];
                // velocity from the net step displacement; damping was already applied in `integrate`
                vel[so] = (gx - prevPos[so]) * invDt;
                vel[so + 1] = (gy - prevPos[so + 1]) * invDt;
                vel[so + 2] = (gz - prevPos[so + 2]) * invDt;
                pos[so] = gx; pos[so + 1] = gy; pos[so + 2] = gz;
            }
        }
        index += 1;
    };

    const step = rigid ? stepRigid : stepSimple;

    const reset = () => {
        coords.set(coords0);
        if (rotations && rotations0) rotations.set(rotations0);
        initState();
        index = 0;
    };

    const getFrameAtIndex = (target: number) => {
        const t = Math.max(0, Math.round(target));
        if (t < index) reset();
        while (index < t) step();
    };

    return { count, getFrameAtIndex, step, reset, setProps };
}
