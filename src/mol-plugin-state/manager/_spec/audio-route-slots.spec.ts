/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { PluginContext } from '../../../mol-plugin/context';
import { AudioReactiveAnimationManager } from '../audio-reactive-animation';
import { createEmptyAudioReactiveFrame, DefaultAudioBandDefinitions } from '../audio-reactor';
import { AudioRouter, AudioScopeSlotCount, canNarrowRoute, createAudioRoute, defaultAudioAffect, parseAudioRouting, routesFromDrafts } from '../audio-routing';

const Chain = (i: number) => ({ level: 'chain' as const, entryId: '6Q3Q', modelNum: 1, entityId: '1', operatorName: '1', asymId: String.fromCharCode(65 + i) });
const plugin = { managers: { structure: { hierarchy: { current: { models: [], structures: [] } } } } } as unknown as PluginContext;

function makeRoutes(narrowed: number, extra: number) {
    const base = { enabled: true, source: 'stemDrums', mode: 'level', target: 'wiggle', gain: 1, floor: 0, releaseMs: 0 } as const;
    return [
        ...Array.from({ length: narrowed }, (_, i) => createAudioRoute({ ...base, affect: Chain(i) })),
        ...Array.from({ length: extra }, () => createAudioRoute({ ...base })),
    ];
}

describe('narrowed route slots (D3)', () => {
    it('canNarrowRoute: free below 8; at 8 only the narrowed ones and the non-narrowable', () => {
        const routes = makeRoutes(AudioScopeSlotCount, 1);
        const narrowed = routes[0], other = routes[AudioScopeSlotCount];
        expect(canNarrowRoute(routes, other.id)).toBe(false);
        expect(canNarrowRoute(routes, narrowed.id)).toBe(true);
        const few = makeRoutes(AudioScopeSlotCount - 1, 1);
        expect(canNarrowRoute(few, few[AudioScopeSlotCount - 1].id)).toBe(true);
        // a route that cannot be narrowed is not refused for it: it just has no Who
        const camera = createAudioRoute({ enabled: true, source: 'stemDrums', mode: 'level', target: 'cameraSpin', gain: 1, floor: 0, releaseMs: 0 });
        expect(canNarrowRoute([...routes, camera], camera.id)).toBe(true);
    });

    it('setRouteAffect refuses a 9th narrowed route and leaves it on All', () => {
        const manager = new AudioReactiveAnimationManager(plugin);
        const routes = makeRoutes(AudioScopeSlotCount, 1);
        manager.setRoutes(routes);
        const ninth = routes[AudioScopeSlotCount];
        expect(manager.setRouteAffect(ninth.id, Chain(8))).toBe(false);
        expect(manager.state.routes.value.find(r => r.id === ninth.id)!.affect.level).toBe('all');
        // an already narrowed route may be changed, and any route widened to All, which frees a slot
        expect(manager.setRouteAffect(routes[0].id, Chain(9))).toBe(true);
        expect(manager.setRouteAffect(routes[1].id, defaultAudioAffect())).toBe(true);
        expect(manager.setRouteAffect(ninth.id, Chain(8))).toBe(true);
        expect(manager.state.routes.value.find(r => r.id === ninth.id)!.affect.level).toBe('chain');
    });

    it('setRoutes keeps at most 8 narrowed routes: the 9th is widened to All and the router uses 8 slots', () => {
        const manager = new AudioReactiveAnimationManager(plugin);
        const routes = makeRoutes(AudioScopeSlotCount + 1, 0);
        manager.setRoutes(routes);
        const after = manager.state.routes.value;
        expect(after.filter(r => r.affect.level !== 'all').length).toBe(AudioScopeSlotCount);
        expect(after[AudioScopeSlotCount].affect.level).toBe('all');
        // the 9th cannot slip back in through the re-attach loop a load runs
        for (const r of after) manager.setRouteAffect(r.id, r.affect);
        expect(manager.state.routes.value.filter(r => r.affect.level !== 'all').length).toBe(AudioScopeSlotCount);
        const router = new AudioRouter();
        router.update(manager.state.routes.value, createEmptyAudioReactiveFrame(DefaultAudioBandDefinitions), { drums: 1, bass: 0, other: 0, vocals: 0 }, 16);
        expect(router.scopeCount).toBe(AudioScopeSlotCount);
        expect(router.drives.wiggle).toBe(1);
    });

    it('setRoutes counts disabled narrowed routes too, in array order', () => {
        const manager = new AudioReactiveAnimationManager(plugin);
        const routes = makeRoutes(AudioScopeSlotCount + 1, 0).map((r, i) => i === 0 ? { ...r, enabled: false } : r);
        manager.setRoutes(routes);
        const after = manager.state.routes.value;
        expect(after[0].affect.level).toBe('chain');
        expect(after[AudioScopeSlotCount].affect.level).toBe('all');
    });

    it('an old-format file (top-level affect) with 9+ narrowable routes ends with at most 8 narrowed after load', () => {
        const route = { enabled: true, source: 'stemDrums', mode: 'level', target: 'wiggle', gain: 1 };
        const text = JSON.stringify({ name: 'old', affect: Chain(0), routes: Array.from({ length: 10 }, () => route) });
        const preset = parseAudioRouting(text)![0];
        const manager = new AudioReactiveAnimationManager(plugin);
        manager.setRoutes(routesFromDrafts(preset.routes));
        for (const r of manager.state.routes.value) manager.setRouteAffect(r.id, r.affect);
        expect(manager.state.routes.value.filter(r => r.affect.level !== 'all').length).toBe(AudioScopeSlotCount);
    });
});
