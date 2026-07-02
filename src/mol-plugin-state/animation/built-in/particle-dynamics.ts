/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { StateSelection } from '../../../mol-state';
import { ParticleList } from '../../../mol-model/particles/particle-list';
import { Structure } from '../../../mol-model/structure';
import { Vec3 } from '../../../mol-math/linear-algebra';
import { Sphere3D } from '../../../mol-math/geometry';
import { createParticleDynamics, ParticleDynamics, ParticleDynamicsParams, ParticleDynamicsProps, particleDynamicsStructuralKey } from '../../../mol-model/particles/dynamics';
import { Representation } from '../../../mol-repr/representation';
import { updateParticleRenderObjectTransforms, updateInstancedStructureTransforms } from '../../../mol-repr/particles/visual';
import { PluginContext } from '../../../mol-plugin/context';
import { PluginStateObject as SO } from '../../objects';
import { PluginStateAnimation } from '../model';

/** A representation of a particle list and how to refresh its instanced transforms in place. */
type Consumer = { repr: Representation.Any, update: (particles: ParticleList) => void }
/** One simulation per particle list, shared by all consumers of that list so they stay in sync. */
type Sim = { particles: ParticleList, dynamics: ParticleDynamics, consumers: Consumer[] }
/** `structuralKey` (shape/seed) forces a full rebuild; `consumerKey` tracks the representation set so a
 * representation added or its type switched mid-play is picked up; `lastBounds` reframes the camera
 * when the box half-extent changes. Surface bindings live on the `ParticleList` itself (set by the
 * transform that builds it, via `Particle.setSurfaceBindings`) - the animation just reads them. */
type State = { sims: Sim[], structuralKey: string, consumerKey: string, lastBounds: number }

/** Identity of the current particle/structure representations - changes when one is added, removed, or
 * its type is switched in the UI, so the sims re-collect (reusing dynamics, no motion reset). */
function consumerKey(ctx: PluginContext): string {
    const refs: string[] = [];
    for (const c of ctx.state.data.select(StateSelection.Generators.ofType(SO.Particle.Representation3D))) refs.push(c.transform.ref);
    for (const c of ctx.state.data.select(StateSelection.Generators.ofType(SO.Molecule.Structure.Representation3D))) refs.push(c.transform.ref);
    return refs.sort().join(',');
}

/** The set of particle lists currently feeding a representation. Used to detect when a list's data was
 * rebuilt (e.g. a surface bound on its transform produced a new list object) so the sims re-collect. */
function consumedParticleLists(ctx: PluginContext): Set<ParticleList> {
    const lists = new Set<ParticleList>();
    for (const c of ctx.state.data.select(StateSelection.Generators.ofType(SO.Particle.Representation3D))) {
        const list = c.obj?.data?.sourceData as ParticleList | undefined;
        if (list) lists.add(list);
    }
    for (const c of ctx.state.data.select(StateSelection.Generators.ofType(SO.Molecule.Structure.Representation3D))) {
        const instanced = ctx.state.data.cells.get(c.transform.parent)?.obj?.data as Structure | undefined;
        const list = instanced && Structure.ParticleList.get(instanced);
        if (list) lists.add(list);
    }
    return lists;
}

/** Frame the camera on the cubic simulation box (`center`, half-extent `half`). The box is origin-centred
 * for a free sim but centred on the bound mesh when one is present, so this keeps the view on the action. */
function focusOnBox(ctx: PluginContext, center: Vec3, half: number) {
    // radius reaches the box corners (half * sqrt(3)); focusSphere adds its own padding
    ctx.managers.camera.focusSphere(Sphere3D.create(Vec3.clone(center), half * Math.sqrt(3)));
}

function hasParticleConsumers(ctx: PluginContext) {
    return ctx.state.data.select(StateSelection.Generators.ofType(SO.Particle.Representation3D)).length > 0
        || ctx.state.data.select(StateSelection.Generators.ofType(SO.Molecule.Structure)).some(c => c.obj?.data && Structure.ParticleList.get(c.obj.data));
}

function collectSims(ctx: PluginContext, props: ParticleDynamicsProps, reuse?: Map<ParticleList, ParticleDynamics>): Sim[] {
    // One dynamics per particle list, stepped once per frame, so every consumer of that list
    // (orientation markers, an instanced particle-structure, or a structure surface baked from the
    // particles) reads the exact same coordinates and stays in sync. Any surface constraints are
    // already attached to the list (Particle.setSurfaceBindings) by the transform that built it.
    const byList = new Map<ParticleList, Sim>();
    const getSim = (particles: ParticleList) => {
        let sim = byList.get(particles);
        if (!sim) {
            // reuse an existing dynamics (re-collecting only because the representation set changed) so
            // the running motion isn't reset; otherwise build a fresh one
            const dynamics = reuse?.get(particles) ?? createParticleDynamics(particles, props);
            sim = { particles, dynamics, consumers: [] };
            byList.set(particles, sim);
        }
        return sim;
    };

    // particle representations: orientation markers, or a per-particle instanced object
    for (const cell of ctx.state.data.select(StateSelection.Generators.ofType(SO.Particle.Representation3D))) {
        const data = cell.obj?.data;
        if (!data?.repr || !data.sourceData) continue;
        const repr = data.repr as Representation.Any & { updateParticleTransforms?: (p: ParticleList) => void };
        const sim = getSim(data.sourceData as ParticleList);
        if ((cell.transform.params as any)?.type?.name !== 'orientation' && typeof repr.updateParticleTransforms === 'function') {
            sim.consumers.push({ repr, update: p => repr.updateParticleTransforms!(p) });
        } else {
            sim.consumers.push({ repr, update: p => { for (const ro of repr.renderObjects) updateParticleRenderObjectTransforms(ro, p); } });
        }
    }

    // structure representations on a structure baked from particles (the `particles-structure`
    // decorator). Each instance transform is `T_particle * T(-center)`, center = the *source*
    // structure's centroid (the decorator's input, i.e. the grandparent of the representation).
    for (const cell of ctx.state.data.select(StateSelection.Generators.ofType(SO.Molecule.Structure.Representation3D))) {
        const instancedCell = ctx.state.data.cells.get(cell.transform.parent);
        const instanced = instancedCell?.obj?.data as Structure | undefined;
        if (!instanced) continue;
        const particles = Structure.ParticleList.get(instanced);
        if (!particles) continue;
        const base = ctx.state.data.cells.get(instancedCell!.transform.parent)?.obj?.data as Structure | undefined;
        const center = Vec3.clone((base ?? instanced).boundary.sphere.center);
        const entity = Structure.ParticleListEntity.get(instanced);
        const repr = (cell.obj!.data as any).repr as Representation.Any;
        const sim = getSim(particles);
        sim.consumers.push({ repr, update: p => { for (const ro of repr.renderObjects) updateInstancedStructureTransforms(ro, p, center, entity); } });
    }

    return Array.from(byList.values());
}

/**
 * Drive every particle representation in the state with a `ParticleDynamics` stepper, one step per
 * animation tick, refreshing the instanced transforms in place. Runs until paused via the animation
 * controls; while it plays the canvas renders every frame, so the motion is continuous.
 *
 * NB: this updates the instanced particle transforms directly, which is correct for the `orientation`
 * representation; the `particles-structure` (and mesh/volume) consumers compose their transforms
 * differently and need a dedicated in-place update - a follow-up.
 */
export const AnimateParticleDynamics = PluginStateAnimation.create({
    name: 'built-in.animate-particle-dynamics',
    display: { name: 'Particle Dynamics', description: 'Update particle positions and orientations live with a physics stepper.' },
    isExportable: false,
    params: () => ParticleDynamicsParams,
    canApply(ctx) {
        return hasParticleConsumers(ctx)
            ? { canApply: true }
            : { canApply: false, reason: 'No particle representation in the state' };
    },
    initialState: (props, ctx) => ({ sims: collectSims(ctx, props), structuralKey: particleDynamicsStructuralKey(props), consumerKey: consumerKey(ctx), lastBounds: props.bounds }) as State,
    setup: (_props, _state, ctx) => {
        // Force continuous rendering while the simulation runs. Otherwise the canvas only redraws on
        // demand (interaction / a scene shader-animation like wiggle), so the per-frame transform
        // updates accumulate but aren't shown until the next redraw.
        ctx.canvas3d?.animate();
    },
    getDuration: () => ({ kind: 'infinite' }),
    async apply(state: State, _t, ctx) {
        // a structural param changed (rigid body/shape/seed) - rebuild the sims from scratch. Otherwise,
        // if the representation set changed (a rep added/removed/type-switched) OR a consumed list was
        // rebuilt (e.g. a surface bound on its transform produced a new list), re-collect consumers but
        // REUSE the existing dynamics for lists that persist so the running motion isn't reset.
        const props = ctx.params;
        const key = particleDynamicsStructuralKey(props);
        if (key !== state.structuralKey) {
            state.sims = collectSims(ctx.plugin, props);
            state.structuralKey = key;
            state.consumerKey = consumerKey(ctx.plugin);
        } else {
            const ck = consumerKey(ctx.plugin);
            const lists = consumedParticleLists(ctx.plugin);
            const listsChanged = lists.size !== state.sims.length || state.sims.some(s => !lists.has(s.particles));
            if (ck !== state.consumerKey || listsChanged) {
                const reuse = new Map(state.sims.map(s => [s.particles, s.dynamics]));
                state.sims = collectSims(ctx.plugin, props, reuse);
                state.consumerKey = ck;
            }
        }
        // box half-extent changed - reframe the camera so the view tracks the new simulation box (which
        // may be centred on a bound mesh, not the origin); frame the first sim's box
        if (ctx.params.bounds !== state.lastBounds) {
            state.lastBounds = ctx.params.bounds;
            const box = state.sims[0]?.dynamics.getBox();
            if (box) focusOnBox(ctx.plugin, box.center, box.half);
        }
        for (const sim of state.sims) {
            // push the current UI param values into the running simulation so edits (e.g. the
            // collision radius) take effect live, then advance one step
            sim.dynamics.setProps(ctx.params);
            sim.dynamics.step();
            for (const c of sim.consumers) {
                c.update(sim.particles);
                // re-sync the changed instance buffers to the GPU and force a draw (updating the
                // value cells alone is not shown until the scene is committed, e.g. on a settings change)
                ctx.plugin.canvas3d?.update(c.repr, true);
            }
        }
        return { kind: 'next', state };
    },
});
