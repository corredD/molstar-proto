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
 * Parameters of the CPU particle solver. Contacts (sphere-sphere, box walls, mesh inside/outside
 * confinement) and the surface "on" snap are implemented as XPBD (Extended Position Based Dynamics;
 * Macklin, Müller & Chentanez 2016, "XPBD: Position-Based Simulation of Compliant Constrained
 * Dynamics", 10.1145/2994258.2994272) constraints, solved over `numSubsteps` substeps per step
 * (small-steps XPBD; Macklin, Müller & Chentanez 2019, "Small Steps in Physics Simulation") - this,
 * not `iterationsPerSubstep`, is what keeps constraint stiffness independent of framerate/substep
 * count, unlike a plain PBD pass whose correction strength scales with the timestep. Rigid-body
 * orientation is a separate mechanism layered on top of the same substep loop (Flex-style shape
 * matching; Müller 2005, polar-decomposition rotation extraction) - it is not itself an XPBD
 * constraint and is not reformulated here. Meant to remain swappable for a future GPU backend behind
 * the same `ParticleDynamics` interface without touching the representation or the animation that
 * drives it.
 */
export const ParticleDynamicsParams = {
    gravity: PD.Vec3(Vec3.create(0, -50, 0), {}, { description: 'Constant acceleration applied each step (arbitrary units).' }),
    damping: PD.Numeric(0.01, { min: 0, max: 1, step: 0.01 }, { description: 'Fraction of velocity removed each step (0 = frictionless).' }),
    bounds: PD.Numeric(150, { min: 1, max: 2000, step: 1 }, { description: 'Half-extent of the cubic box the particles bounce inside, in angstrom.' }),
    restitution: PD.Numeric(0.8, { min: 0, max: 1, step: 0.05 }, { description: 'Fraction of the pre-contact approach speed restored as bounce after a collision, wall hit, or mesh confinement, applied as a separate XPBD restitution pass (Macklin et al. 2016 §3.5).' }),
    collisions: PD.Boolean(true, { description: 'Resolve sphere-sphere overlaps between particles each substep (XPBD position constraint, plus the restitution pass above).' }),
    numSubsteps: PD.Numeric(4, { min: 1, max: 16, step: 1 }, { description: 'XPBD substeps per step, each integrating dt/numSubsteps. This - not iterationsPerSubstep - is what makes constraint stiffness independent of framerate (Macklin et al., "Small Steps in Physics Simulation", 2019).' }),
    iterationsPerSubstep: PD.Numeric(1, { min: 1, max: 8, step: 1 }, { description: 'Constraint-solver (Gauss-Seidel) passes per substep. 1 is the recommended XPBD configuration; raise only if dense or high-gravity sphere stacks still show residual overlap after raising numSubsteps first.' }),
    contactCompliance: PD.Numeric(0, { min: 0, max: 1e-2, step: 1e-5 }, { description: 'Compliance (inverse stiffness) of sphere-sphere collisions, box walls, and mesh inside/outside confinement. 0 = perfectly rigid (the pre-XPBD behavior).' }),
    particleRadius: PD.Numeric(10, { min: 0.1, max: 500, step: 0.1 }, { description: 'Uniform collision sphere radius for every particle (the grid assumes a single diameter).' }),
    rigidBody: PD.Boolean(false, { description: 'Flex-style rigid bodies: each particle is a small cluster of collision spheres; collisions between clusters induce a position AND rotation that is fed back to the viewer (shape matching).' }),
    rigidShape: PD.Select('cube', PD.arrayToOptions(['cube', 'tube'] as const), { description: 'Sphere arrangement of a rigid body: "cube" = 4 spheres in a square, "tube" = 5 spheres in a line.' }),
    surfaceCohesion: PD.Numeric(0.4, { min: 0, max: 2, step: 0.05 }, { description: 'Attraction pulling surface-constrained particles of the same compartment together each step (clamped). 0 = no attraction. See `Particle.setSurfaceBindings`.' }),
    surfaceCompliance: PD.Numeric(0, { min: 0, max: 1e-2, step: 1e-5 }, { description: 'Compliance of the surface "on" snap constraint (XPBD point-to-plane). 0 = hard snap onto the mesh (the pre-XPBD behavior).' }),
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
    /** Advance exactly one timestep (`numSubsteps` XPBD substeps). */
    step: () => void
    /** Restore the initial positions/orientations and zero the velocities. */
    reset: () => void
    /** Update the live-tunable props (gravity, damping, radius, compliance, ...) so changes take effect on the next step. */
    setProps: (props: ParticleDynamicsProps) => void
    /** The reflective box: `center` (origin unless bound to a mesh) and `half` (its half-extent). A viewer
     * can frame the camera on it so the simulation is in view even when a bound mesh sits far off-origin. */
    getBox: () => { center: Vec3, half: number }
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
 * Create an XPBD CPU dynamics for a `ParticleList`: semi-implicit-Euler prediction under gravity with
 * damping, substepped position-based constraints (reflective box walls, optional sphere-sphere
 * collisions, mesh surface confinement), and an explicit post-solve restitution pass. With
 * `rigidBody` enabled it instead simulates each particle as a Flex-style rigid cluster of collision
 * spheres and recovers a position + orientation per cluster via shape matching once per substep.
 * `step`/`getFrameAtIndex` mutate the list's `coordinates` (and `rotations`, if present) in place, so
 * a representation built from the same list reflects the motion once its instance transforms are
 * refreshed.
 *
 * Particles whose `compartment` is bound to a mesh via `Particle.setSurfaceBindings` are instead
 * constrained to that surface: each substep they are attracted toward same-compartment neighbours
 * (`surfaceCohesion`, applied once per full step, not per substep), projected back onto the mesh, and
 * oriented to the surface normal - a port of the surface-relaxation packing the fullerene engine
 * demonstrates.
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
    let numSubsteps = Math.max(1, props.numSubsteps | 0);
    let iterationsPerSubstep = Math.max(1, props.iterationsPerSubstep | 0);
    let contactCompliance = props.contactCompliance;
    let surfaceCompliance = props.surfaceCompliance;
    // Uniform collision radius for every particle - the grid assumes a single diameter. Per-particle
    // `radii` from the source data are intentionally ignored here so the cell size stays uniform.
    let particleRadius = props.particleRadius;
    let invCell = 1 / Math.max(2 * particleRadius, 1e-3);
    let surfaceCohesion = props.surfaceCohesion;
    let surfaceOrient = props.surfaceOrient;

    // Derived quantities recomputed whenever a relevant prop above changes (see `recomputeDerived`,
    // called once below and again at the top of `setProps`): the substep timestep, the per-substep
    // damping factor that reproduces the SAME per-frame decay regardless of `numSubsteps`
    // (`keepSub^numSubsteps === keep`), and the XPBD correction fractions for each constraint family
    // (1 = hard constraint, matching the pre-XPBD behavior exactly; less at higher compliance). All
    // assume uniform, unit inverse mass for every particle/sub-sphere (`w = 1`) - a per-type mass would
    // enter these denominators (and the equal-mass 50/50 pair split in `resolveCollisions`/
    // `applyRestitution`) once `ParticleList` carries a mass/density field.
    let dtSub = 1;
    let keepSub = 1;
    let contactFrac = 1; // single-body contact (wall, mesh inside/outside): denominator (1 + alpha_tilde)
    let pairFrac = 0.5; // sphere-sphere pair: denominator (2 + alpha_tilde), both spheres unit inv-mass
    let surfaceFrac = 1; // single-body surface "on" snap: denominator (1 + alpha_tilde)
    const recomputeDerived = () => {
        dtSub = dt / numSubsteps;
        keepSub = Math.pow(keep, 1 / numSubsteps);
        const contactAlphaTilde = contactCompliance / (dtSub * dtSub);
        const surfaceAlphaTilde = surfaceCompliance / (dtSub * dtSub);
        contactFrac = 1 / (1 + contactAlphaTilde);
        pairFrac = 1 / (2 + contactAlphaTilde);
        surfaceFrac = 1 / (1 + surfaceAlphaTilde);
    };

    // local axis (unit) aligned to the surface normal for `on`-constrained objects; refreshed by setProps
    const orientAxis = Vec3.create(0, 0, 1);
    const setOrientAxis = (v: Vec3) => {
        const m = Vec3.magnitude(v);
        if (m > 1e-6) Vec3.scale(orientAxis, v, 1 / m); else Vec3.set(orientAxis, 0, 0, 1);
    };
    setOrientAxis(props.surfaceOrientAxis);
    // Reflective box. Without a bound mesh it is the origin-centred cube of half-extent `bounds`. With
    // one, it is CENTRED on the mesh (its AABB centre, `boxCenter`) and sized to enclose the mesh plus a
    // `bounds` margin (`boxBounds = meshHalf + bounds`), so confined bodies - and `outside` bodies that
    // fall away under gravity - stay in a shell around the mesh instead of a huge origin-centred cube
    // that leaves them scattered far from it. Both are set in the surface setup below.
    const boxCenter = Vec3(); // origin unless bound to a mesh
    let meshHalf = 0; // largest half-extent of the bound-mesh AABB (0 = no bound mesh)
    let boxBounds = props.bounds;

    // initial state for reset
    const coords0 = Float32Array.from(coords);
    const rotations0 = rotations ? Float32Array.from(rotations) : undefined;

    // --- rigid-body (Flex-style shape matching) setup ------------------------------------------
    // When enabled, every particle becomes a small rigid cluster of collision spheres. The spheres
    // collide as individuals (driving translation AND torque); after each substep a best-fit rigid
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
    const prevPos = new Float32Array(simCount * 3); // start-of-substep positions (XPBD post-solve velocity)
    const velPred = new Float32Array(simCount * 3); // velocity right after predict, before any position
    // correction - the restitution pass reads the pre-solve approach speed from here (non-rigid only;
    // rigid contacts are always position-only/inelastic, see `stepRigid`)
    const bodyOf = rigid ? new Int32Array(simCount) : undefined; // sphere -> body, for intra-body exclusion
    const bodyQuat = rigid ? new Float32Array(count * 4) : undefined; // per-body orientation (shape-match warm start)
    if (bodyOf && clusterStart && clusterCount) {
        for (let b = 0; b < count; ++b) { const s0 = clusterStart[b], n = clusterCount[b]; for (let k = 0; k < n; ++k) bodyOf[s0 + k] = b; }
    }

    const spinAxes = (!rigid && rotations) ? new Float32Array(count * 3) : undefined; // fixed unit axis per particle
    let spinAngle = rotations ? props.angularSpeed * dt : 0; // radians per full step (applied once per step, not per substep)

    const setProps = (p: ParticleDynamicsProps) => {
        gravity = p.gravity;
        dt = p.timestep;
        keep = Math.max(0, 1 - p.damping);
        bounds = p.bounds;
        restitution = p.restitution;
        collisions = p.collisions;
        numSubsteps = Math.max(1, p.numSubsteps | 0);
        iterationsPerSubstep = Math.max(1, p.iterationsPerSubstep | 0);
        contactCompliance = p.contactCompliance;
        surfaceCompliance = p.surfaceCompliance;
        particleRadius = p.particleRadius;
        invCell = 1 / Math.max(2 * particleRadius, 1e-3);
        surfaceCohesion = p.surfaceCohesion;
        surfaceOrient = p.surfaceOrient;
        setOrientAxis(p.surfaceOrientAxis);
        boxBounds = meshHalf > 0 ? meshHalf + p.bounds : p.bounds;
        spinAngle = rotations ? p.angularSpeed * dt : 0;
        recomputeDerived();
    };
    recomputeDerived();

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
    // collide it with the mesh so it never crosses (confined inside / excluded outside). Non-rigid only
    // for `surfacePass`/`applyCohesion`; rigid bodies apply the same `constrain()` helper directly to
    // their sub-spheres/COM (see `stepRigid`).
    const MODE_NONE = 0, MODE_ON = 1, MODE_INSIDE = 2, MODE_OUTSIDE = 3;
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
    // centre the box on the bound mesh(es) and size it to enclose them plus the `bounds` margin (union of
    // every binding's bounding sphere). No bound mesh: origin-centred cube of half-extent `bounds`.
    if (surfaceBindings && surfaceBindings.size) {
        let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
        surfaceBindings.forEach(b => {
            const c = b.surface.center, r = b.surface.radius;
            minx = Math.min(minx, c[0] - r); maxx = Math.max(maxx, c[0] + r);
            miny = Math.min(miny, c[1] - r); maxy = Math.max(maxy, c[1] + r);
            minz = Math.min(minz, c[2] - r); maxz = Math.max(maxz, c[2] + r);
        });
        Vec3.set(boxCenter, (minx + maxx) / 2, (miny + maxy) / 2, (minz + maxz) / 2);
        meshHalf = Math.max((maxx - minx) / 2, (maxy - miny) / 2, (maxz - minz) / 2);
        boxBounds = meshHalf + bounds;
    }
    const cohForce = onCount > 0 ? new Float32Array(count * 3) : undefined; // accumulated cohesion pull
    const projPoint = Vec3(), projNormal = Vec3(), constrainPos = Vec3();

    // Cached-clearance skip for the `inside`/`outside` constraint. `project` is O(triangleCount) for a
    // query far from every surface triangle - e.g. a body settled deep inside a hollow mesh, where the
    // whole surface is roughly equidistant so the search must test most triangles - and a settled or
    // non-contact body barely moves between substeps. So per collision sphere we remember where it last
    // projected (`clearAt*`) and the clearance there (`clearDist` = distance to the nearest surface point
    // minus `particleRadius`): while the sphere stays within that clearance of the recorded point it
    // provably cannot have reached the surface, so the one-sided constraint is still satisfied and the
    // projection is skipped. Exact - it only ever skips a constraint that would have applied zero
    // correction. `-1` marks "not yet projected" (force a projection). `on` mode never caches (it must
    // re-snap to the surface every step). Only allocated when some compartment is confined.
    // Float64 so the skip boundary matches `project`'s (Float64) distance exactly - Float32 rounding of
    // the clearance would fuzz the contact boundary.
    const clearDist = collideCount > 0 ? new Float64Array(simCount) : undefined;
    const clearAtX = collideCount > 0 ? new Float64Array(simCount) : undefined;
    const clearAtY = collideCount > 0 ? new Float64Array(simCount) : undefined;
    const clearAtZ = collideCount > 0 ? new Float64Array(simCount) : undefined;

    /** XPBD constraint against a bound mesh per `mode`. `on`: point-to-plane constraint pulling the
     * point toward the (already nearest) projected point by `surfaceFrac` of its normal offset - at
     * `surfaceCompliance = 0` (`surfaceFrac = 1`) this reduces to snapping straight onto the surface
     * (the nearest-point projection's displacement is, by construction, along the normal, so this is
     * exactly the pre-XPBD hard snap). `inside`/`outside`: one-sided constraint keeping the point a
     * radius clear on the allowed side. The violation MAGNITUDE uses the Euclidean distance to the
     * surface (`project`'s return) and the push DIRECTION uses the offset from the closest point - the
     * triangle normal is used ONLY to classify which side the point is on. (Measuring the violation with
     * the normal, as the pre-XPBD code did, misjudges points near an edge/concavity, where the closest
     * point sits on an edge and the face normal is far from the offset direction: a comfortably-clear
     * point reads as deeply penetrating and gets yanked, which the rigid velocity rebuild turns into an
     * explosion. Assumes consistently outward-facing normals for the side test.) Writes the result to
     * `constrainPos`; returns whether the point moved. */
    const constrain = (surf: MeshSurface, mode: number, x: number, y: number, z: number, cacheIdx: number): boolean => {
        // Broad-phase reject for the `outside` constraint: every mesh point lies within `surf.radius` of
        // `surf.center`, so a point farther than `radius + particleRadius` from the centre is already
        // more than a radius clear of the surface and trivially satisfies "stay outside". Skipping it
        // avoids `project`, which is O(triangleCount) for a query far outside the grid (the ring search
        // scans the whole grid because its distance-based early termination never fires). This is the hot
        // path once `outside` bodies fall away from an off-centre mesh into the far corners of the box.
        if (mode === MODE_OUTSIDE) {
            const cdx = x - surf.center[0], cdy = y - surf.center[1], cdz = z - surf.center[2];
            const clear = surf.radius + particleRadius;
            if (cdx * cdx + cdy * cdy + cdz * cdz > clear * clear) return false;
        }
        // cached-clearance skip (inside/outside only): still on the safe side if the sphere hasn't moved
        // more than its recorded clearance since the last projection (see the `clearDist` declaration)
        if (clearDist && cacheIdx >= 0 && mode !== MODE_ON && clearDist[cacheIdx] >= 0) {
            const mdx = x - clearAtX![cacheIdx], mdy = y - clearAtY![cacheIdx], mdz = z - clearAtZ![cacheIdx];
            const c = clearDist[cacheIdx];
            if (mdx * mdx + mdy * mdy + mdz * mdz <= c * c) return false;
        }
        Vec3.set(tmp, x, y, z);
        const dist = surf.project(tmp, projPoint, projNormal);
        if (clearDist && cacheIdx >= 0 && mode !== MODE_ON) {
            clearAtX![cacheIdx] = x; clearAtY![cacheIdx] = y; clearAtZ![cacheIdx] = z;
            clearDist[cacheIdx] = Math.max(0, dist - particleRadius);
        }
        if (mode === MODE_ON) {
            const dx = x - projPoint[0], dy = y - projPoint[1], dz = z - projPoint[2];
            const c = dx * projNormal[0] + dy * projNormal[1] + dz * projNormal[2];
            const corr = c * surfaceFrac;
            Vec3.set(constrainPos, x - projNormal[0] * corr, y - projNormal[1] * corr, z - projNormal[2] * corr);
            return true;
        }
        // `dist` (from `project`) is the true Euclidean distance to the nearest surface point; the offset
        // `p - projPoint` points from that point back to the particle, i.e. along the direction that
        // increases clearance on whichever side the particle is currently on. The triangle normal is used
        // ONLY to decide the side (does the particle need to stay `outside` or `inside` the mesh) - NOT to
        // measure the violation. Using the normal for the magnitude (the pre-XPBD `particleRadius -
        // (p-projPoint).n`) is wrong near an edge/concavity, where the closest point is on an edge and the
        // triangle normal is far from the offset direction: it reads a particle that is comfortably clear
        // (large Euclidean `dist`) as deeply penetrating and yanks it tens of angstrom in one substep,
        // which the rigid velocity rebuild turns into an explosion. Euclidean `dist` never does that.
        const ox = x - projPoint[0], oy = y - projPoint[1], oz = z - projPoint[2];
        const signed = ox * projNormal[0] + oy * projNormal[1] + oz * projNormal[2];
        const side = mode === MODE_OUTSIDE ? 1 : -1; // normal side the point must stay on
        if (signed * side >= 0) {
            // on the allowed side: only push if within a radius of the surface, straight away from it
            if (dist >= particleRadius) return false;
            const corr = (particleRadius - dist) * contactFrac;
            const inv = dist > 1e-6 ? corr / dist : 0; // unit offset * corr (away from the surface)
            Vec3.set(constrainPos, x + ox * inv, y + oy * inv, z + oz * inv);
            return true;
        }
        // crossed to the forbidden side: move back across to a radius clear, along the surface normal
        const corr = (dist + particleRadius) * contactFrac;
        Vec3.set(constrainPos, x + projNormal[0] * side * corr, y + projNormal[1] * side * corr, z + projNormal[2] * side * corr);
        return true;
    };

    // --- XPBD restitution pass -------------------------------------------------------------------
    // Position corrections alone (above, and in `resolveCollisions`/`clampWalls`) are inelastic - XPBD
    // restores bounce with a SEPARATE velocity-only pass, run once per substep after velocity has been
    // rebuilt from displacement (Macklin et al. 2016 §3.5). Each contact triggered during the position
    // solve is recorded here (`j = -1` for a static contact: a box wall or a bound mesh, with `n`
    // pointing from the particle TOWARD the obstacle); the pass re-measures the pre-solve approach
    // speed from `velPred` and nudges the post-solve velocity so its normal component matches
    // `-restitution * vnPre`, only for contacts that were actually approaching (a resting/separating
    // contact gets no added energy). Rigid contacts never call `addContact`: `stepRigid` is always
    // position-only/inelastic by design (its sub-sphere velocities are rebuilt from the shape-matched
    // displacement instead).
    let contactCount = 0;
    let contactI = new Int32Array(64);
    let contactJ = new Int32Array(64);
    let contactNx = new Float32Array(64);
    let contactNy = new Float32Array(64);
    let contactNz = new Float32Array(64);
    const ensureContactCapacity = (n: number) => {
        if (contactI.length >= n) return;
        const cap = Math.max(n, contactI.length * 2);
        const growI = new Int32Array(cap); growI.set(contactI); contactI = growI;
        const growJ = new Int32Array(cap); growJ.set(contactJ); contactJ = growJ;
        const growNx = new Float32Array(cap); growNx.set(contactNx); contactNx = growNx;
        const growNy = new Float32Array(cap); growNy.set(contactNy); contactNy = growNy;
        const growNz = new Float32Array(cap); growNz.set(contactNz); contactNz = growNz;
    };
    const addContact = (i: number, j: number, nx: number, ny: number, nz: number) => {
        ensureContactCapacity(contactCount + 1);
        contactI[contactCount] = i; contactJ[contactCount] = j;
        contactNx[contactCount] = nx; contactNy[contactCount] = ny; contactNz[contactCount] = nz;
        ++contactCount;
    };
    const predAlongNormal = (i: number, nx: number, ny: number, nz: number) => {
        const c = i * 3;
        return velPred[c] * nx + velPred[c + 1] * ny + velPred[c + 2] * nz;
    };
    const applyRestitution = (v: Float32Array) => {
        for (let c = 0; c < contactCount; ++c) {
            const i = contactI[c], j = contactJ[c];
            const nx = contactNx[c], ny = contactNy[c], nz = contactNz[c];
            const ci = i * 3;
            if (j < 0) {
                // static contact: `n` points toward the obstacle, so approaching means a POSITIVE
                // predicted velocity along it (i.e. vnPre, defined i->obstacle like the pair case, is negative)
                const vnPre = -predAlongNormal(i, nx, ny, nz);
                if (vnPre >= 0) continue;
                const vnPost = -(v[ci] * nx + v[ci + 1] * ny + v[ci + 2] * nz);
                const dv = -restitution * vnPre - vnPost;
                if (Math.abs(dv) < 1e-9) continue;
                v[ci] -= dv * nx; v[ci + 1] -= dv * ny; v[ci + 2] -= dv * nz;
            } else {
                // particle pair: `n` points i -> j, same convention `resolveCollisions` detects with
                const cj = j * 3;
                const vnPre = predAlongNormal(j, nx, ny, nz) - predAlongNormal(i, nx, ny, nz);
                if (vnPre >= 0) continue;
                const vnPost = (v[cj] * nx + v[cj + 1] * ny + v[cj + 2] * nz) - (v[ci] * nx + v[ci + 1] * ny + v[ci + 2] * nz);
                const dv = (-restitution * vnPre - vnPost) * 0.5; // equal-mass split
                if (Math.abs(dv) < 1e-9) continue;
                v[ci] -= dv * nx; v[ci + 1] -= dv * ny; v[ci + 2] -= dv * nz;
                v[cj] += dv * nx; v[cj + 1] += dv * ny; v[cj + 2] += dv * nz;
            }
        }
        contactCount = 0;
    };

    const rand = mulberry32((props.seed >>> 0) || 1);
    const initState = () => {
        vel.fill(0);
        // invalidate the surface-clearance cache: positions are about to be (re)set, so any recorded
        // clearance/anchor is stale and must not be trusted to skip a projection
        if (clearDist) clearDist.fill(-1);
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
    // The cell size tracks `invCell`, which `setProps` recomputes when the radius changes. Rebuilt
    // once per substep (inside `resolveCollisions`, called `iterationsPerSubstep` times per substep);
    // reused across those inner iterations, which is safe because a hard-constraint correction moves a
    // sphere by well under one radius, far short of escaping its cell's 3x3x3 neighbour search.
    let tableSize = 16; while (tableSize < simCount) tableSize <<= 1;
    const tableMask = tableSize - 1;
    const bucketStart = new Int32Array(tableSize + 1); // prefix sums: bucket b is [bucketStart[b], bucketStart[b+1])
    const bucketCursor = new Int32Array(tableSize);
    const sorted = new Int32Array(Math.max(simCount, 1)); // sphere indices grouped by bucket
    const partHash = new Int32Array(Math.max(simCount, 1));
    const seen = new Int32Array(27); // hashes of the neighbour cells already scanned for the current sphere

    const hashCell = (ix: number, iy: number, iz: number) =>
        ((Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) >>> 0) & tableMask;

    /** Resolve sphere-sphere overlaps in `p` (length `n` spheres) via a single XPBD position
     * correction per contacting pair - at `contactCompliance = 0` (`pairFrac = 0.5`) this reduces to
     * exactly the pre-XPBD `(minD - d) * 0.5` split (both spheres equal, unit inverse mass). `bodies`
     * (if given) excludes pairs from the same rigid body, whose rigidity is enforced by shape matching
     * instead. `recordContacts` adds each pair to the restitution contact list above - pass `true`
     * only on the FINAL solver iteration of a substep (mirroring the old `applyImpulse` gate) so a
     * pair still touching across multiple iterations isn't recorded, and thus restituted, more than
     * once; rigid-body calls never record (always inelastic, see the module doc). */
    const resolveCollisions = (p: Float32Array, n: number, bodies?: Int32Array, recordContacts = false) => {
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
                    // XPBD: C = d - minD (< 0 on overlap), delta_lambda = -C/(w_i+w_j+alpha_tilde); with
                    // w_i=w_j=1 the magnitude of delta_lambda (= the correction applied to each sphere) is
                    // `(minD-d) * pairFrac`, which is exactly `(minD-d)*0.5` at compliance = 0
                    const corr = (minD - d) * pairFrac;
                    p[ci] = (xi -= nx * corr); p[ci + 1] = (yi -= ny * corr); p[ci + 2] = (zi -= nz * corr);
                    p[cj] += nx * corr; p[cj + 1] += ny * corr; p[cj + 2] += nz * corr;
                    if (recordContacts) addContact(i, j, nx, ny, nz);
                }
            }
        }
    };

    /** XPBD one-sided box-wall constraint for `n` points in `p` (particles or rigid sub-spheres):
     * pushes any point outside `[-boxBounds, boxBounds]` back by `contactFrac` of the overshoot (1 =
     * hard clamp, matching the pre-XPBD behavior at `contactCompliance = 0`). When `recordContacts`,
     * each triggered axis is added to the restitution contact list; rigid calls never record (see the
     * module doc). `skipOnMode`, if given, skips particles stuck to a surface (the `on` constraint
     * owns their position instead). */
    const clampWalls = (p: Float32Array, n: number, recordContacts: boolean, skipOnMode?: Int8Array) => {
        for (let i = 0; i < n; ++i) {
            if (skipOnMode && skipOnMode[i] === MODE_ON) continue;
            const c = i * 3;
            for (let axis3 = 0; axis3 < 3; ++axis3) {
                const idx = c + axis3;
                const hi = boxCenter[axis3] + boxBounds, lo = boxCenter[axis3] - boxBounds;
                if (p[idx] > hi) {
                    p[idx] -= (p[idx] - hi) * contactFrac;
                    if (recordContacts) addContact(i, -1, axis3 === 0 ? 1 : 0, axis3 === 1 ? 1 : 0, axis3 === 2 ? 1 : 0);
                } else if (p[idx] < lo) {
                    p[idx] += (lo - p[idx]) * contactFrac;
                    if (recordContacts) addContact(i, -1, axis3 === 0 ? -1 : 0, axis3 === 1 ? -1 : 0, axis3 === 2 ? -1 : 0);
                }
            }
        }
    };

    /** Pull surface-constrained particles of the same compartment together (clamped band attraction,
     * fullerene-style cohesion), reusing the collision hash. Attraction range (1.8 diameters) fits the
     * 3x3x3 neighbourhood at diameter-sized cells. Called once per full step (not per substep) from
     * `stepSimple`, so its clamped step magnitude isn't multiplied by `numSubsteps`. */
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

    /** Per-substep surface pass (non-rigid): `on` particles are projected onto the mesh (XPBD point-
     * to-plane, `surfaceFrac`) and oriented to its normal; `inside`/`outside` particles are kept clear
     * of it (XPBD one-sided, `contactFrac`) and recorded as a contact so the restitution pass can
     * bounce them. Cohesion is NOT run here - see `applyCohesion`'s separate once-per-step call site. */
    const surfacePass = () => {
        if (!boundSurfaces || !boundMode) return;
        for (let i = 0; i < count; ++i) {
            const mode = boundMode[i];
            const surf = boundSurfaces[i];
            if (mode === MODE_NONE || !surf) continue;
            const c = i * 3;
            if (!constrain(surf, mode, pos[c], pos[c + 1], pos[c + 2], i)) continue;
            pos[c] = constrainPos[0]; pos[c + 1] = constrainPos[1]; pos[c + 2] = constrainPos[2];
            if (mode === MODE_ON) {
                vel[c] *= keepSub; vel[c + 1] *= keepSub; vel[c + 2] *= keepSub; // no normal velocity build-up
                if (surfaceOrient && rotations) {
                    Quat.rotationTo(q, orientAxis, projNormal);
                    const r = i * 4;
                    rotations[r] = q[0]; rotations[r + 1] = q[1]; rotations[r + 2] = q[2]; rotations[r + 3] = q[3];
                }
            } else {
                // obstacle-pointing normal: outside mode escapes along +projNormal (obstacle is -projNormal),
                // inside mode escapes along -projNormal (obstacle is +projNormal) - see the module comment
                const sign = mode === MODE_OUTSIDE ? -1 : 1;
                addContact(i, -1, projNormal[0] * sign, projNormal[1] * sign, projNormal[2] * sign);
            }
        }
    };

    /** Non-rigid tumble: rotate every particle with rotations about its fixed random spin axis by
     * `spinAngle` (already scaled to `angularSpeed * dt`, once per full step). Composing the same
     * fixed-axis rotation across `numSubsteps` smaller angles would sum to the same net rotation, so
     * there's no correctness reason to split it - applying it once avoids the extra quaternion work. */
    const applyTumble = () => {
        if (!rotations || !spinAxes) return;
        for (let i = 0; i < count; ++i) {
            Vec3.set(axis, spinAxes[i * 3], spinAxes[i * 3 + 1], spinAxes[i * 3 + 2]);
            Quat.setAxisAngle(dq, axis, spinAngle);
            const r = i * 4;
            Quat.set(q, rotations[r], rotations[r + 1], rotations[r + 2], rotations[r + 3]);
            Quat.multiply(q, dq, q);
            Quat.normalize(q, q);
            rotations[r] = q[0]; rotations[r + 1] = q[1]; rotations[r + 2] = q[2]; rotations[r + 3] = q[3];
        }
    };

    let index = 0;

    /** Integrate `vel` under gravity + damping and advance `pos` (semi-implicit Euler) for `n` spheres
     * over substep `h` ("predict"). Surface-constrained ("on") particles are skipped every substep -
     * the surface pass drives them position-based. Snapshots the predicted velocity into `velPred` for
     * the restitution pass. */
    const integrate = (n: number, h: number) => {
        for (let i = 0; i < n; ++i) {
            if (!rigid && boundMode && boundMode[i] === MODE_ON) continue;
            const c = i * 3;
            const vx = (vel[c] + gravity[0] * h) * keepSub;
            const vy = (vel[c + 1] + gravity[1] * h) * keepSub;
            const vz = (vel[c + 2] + gravity[2] * h) * keepSub;
            vel[c] = vx; vel[c + 1] = vy; vel[c + 2] = vz;
            pos[c] += vx * h; pos[c + 1] += vy * h; pos[c + 2] += vz * h;
        }
        velPred.set(vel);
    };

    const stepSimple = () => {
        for (let s = 0; s < numSubsteps; ++s) {
            prevPos.set(pos);
            integrate(count, dtSub);
            for (let it = 0; it < iterationsPerSubstep; ++it) {
                if (collisions) resolveCollisions(pos, count, undefined, it === iterationsPerSubstep - 1);
            }
            clampWalls(pos, count, true, boundMode);
            if (hasSurface) surfacePass();
            // velocity rebuilt from displacement (XPBD post-solve velocity), skipping `on`-mode
            // particles which manage their own velocity (damped normal component) inside `surfacePass`
            for (let i = 0; i < count; ++i) {
                if (boundMode && boundMode[i] === MODE_ON) continue;
                const c = i * 3;
                vel[c] = (pos[c] - prevPos[c]) / dtSub;
                vel[c + 1] = (pos[c + 1] - prevPos[c + 1]) / dtSub;
                vel[c + 2] = (pos[c + 2] - prevPos[c + 2]) / dtSub;
            }
            applyRestitution(vel);
        }
        if (hasSurface && onCount > 0 && surfaceCohesion > 0) {
            applyCohesion();
            surfacePass(); // re-snap onto the surface after cohesion nudged positions off it
        }
        applyTumble();
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
        if (!clusterOffsets || !clusterStart || !clusterCount || !bodyOf || !bodyQuat || !rotations) return;
        for (let s = 0; s < numSubsteps; ++s) {
            // PBD-style: predict, satisfy contacts/walls (position-only, always inelastic - see the
            // module doc), then shape-match each body to a rigid pose and derive velocities from the
            // net displacement over the substep.
            prevPos.set(pos);
            integrate(simCount, dtSub);
            for (let it = 0; it < iterationsPerSubstep; ++it) {
                if (collisions) resolveCollisions(pos, simCount, bodyOf, false);
                // clamp every sub-sphere into the box (position only; velocity is rebuilt from the
                // substep displacement below)
                clampWalls(pos, simCount, false);
                // inside/outside confinement collides EVERY sub-sphere with the mesh (not just the COM),
                // so a rigid body can't poke through; the shape match below then fits a rigid pose to the
                // corrected spheres, keeping the whole body on the allowed side. (`on` stays COM-based +
                // orient, per body, after shape matching.)
                if (boundMode && boundSurfaces) {
                    for (let b = 0; b < count; ++b) {
                        const mode = boundMode[b], surf = boundSurfaces[b];
                        if (!surf || (mode !== MODE_INSIDE && mode !== MODE_OUTSIDE)) continue;
                        const s0 = clusterStart[b], k = clusterCount[b];
                        for (let kk = 0; kk < k; ++kk) {
                            const so = (s0 + kk) * 3;
                            if (constrain(surf, mode, pos[so], pos[so + 1], pos[so + 2], s0 + kk)) {
                                pos[so] = constrainPos[0]; pos[so + 1] = constrainPos[1]; pos[so + 2] = constrainPos[2];
                            }
                        }
                    }
                }
            }

            const invDtSub = 1 / dtSub;
            for (let b = 0; b < count; ++b) {
                const s0 = clusterStart[b], k = clusterCount[b];
                if (k === 0) continue;
                // center of mass of the (post-collision) spheres
                let cx = 0, cy = 0, cz = 0;
                for (let kk = 0; kk < k; ++kk) { const so = (s0 + kk) * 3; cx += pos[so]; cy += pos[so + 1]; cz += pos[so + 2]; }
                cx /= k; cy /= k; cz /= k;
                // covariance Apq = sum (p - c) (x) rest   (column-major: apq[col*3 + row]); rest offset of
                // a sphere is stored at its own global index, so the offset and position share index `so`
                apq.fill(0);
                for (let kk = 0; kk < k; ++kk) {
                    const so = (s0 + kk) * 3;
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
                    if (surf && constrain(surf, MODE_ON, cx, cy, cz, -1)) {
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
                // snap spheres to the rigid goal positions and rebuild velocities from the substep displacement
                for (let kk = 0; kk < k; ++kk) {
                    const so = (s0 + kk) * 3;
                    Vec3.set(tmp, clusterOffsets[so], clusterOffsets[so + 1], clusterOffsets[so + 2]);
                    Vec3.transformQuat(tmp, tmp, q);
                    const gx = cx + tmp[0], gy = cy + tmp[1], gz = cz + tmp[2];
                    // velocity from the net substep displacement; damping was already applied in `integrate`
                    vel[so] = (gx - prevPos[so]) * invDtSub;
                    vel[so + 1] = (gy - prevPos[so + 1]) * invDtSub;
                    vel[so + 2] = (gz - prevPos[so + 2]) * invDtSub;
                    pos[so] = gx; pos[so + 1] = gy; pos[so + 2] = gz;
                }
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

    const getBox = () => ({ center: Vec3.clone(boxCenter), half: boxBounds });

    return { count, getFrameAtIndex, step, reset, setProps, getBox };
}
