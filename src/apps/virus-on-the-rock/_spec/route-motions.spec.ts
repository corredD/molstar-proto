/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { AudioRoute, createAudioRoute, getDefaultAudioRoutes } from '../../../mol-plugin-state/manager/audio-routing';
import { createRouteMotionsFollower, motionsNeededBy, MotionFlag } from '../route-motions';

const route = (target: AudioRoute['target'], enabled = true) =>
    createAudioRoute({ enabled, source: 'stemDrums', mode: 'level', target, gain: 1, floor: 0, releaseMs: 0 });

function setup(initial: AudioRoute[], on: Record<MotionFlag, boolean>) {
    const turned: MotionFlag[] = [];
    const feed = createRouteMotionsFollower(initial, {
        isOn: flag => on[flag],
        turnOn: flag => { on[flag] = true; turned.push(flag); },
    });
    return { feed, turned, on };
}

describe('motions follow routes', () => {
    it('lists the motion of each enabled route, none for instanceWave or a disabled route', () => {
        const a = route('wiggle'), b = route('instanceWave'), c = route('object', false), d = route('symAxis');
        expect([...motionsNeededBy([a, b, c, d]).values()]).toEqual(['atomWiggleEnabled', 'instanceTumbleEnabled']);
    });

    it('seeding with the routes in place turns nothing on', () => {
        const routes = getDefaultAudioRoutes();
        const { feed, turned } = setup(routes, { atomWiggleEnabled: false, instanceTumbleEnabled: false, objectTransformEnabled: false });
        feed(routes.slice());
        expect(turned).toEqual([]);
    });

    it('adding a route to a motion that is off turns it on, even when another route already uses it', () => {
        const existing = route('symAxis');
        const { feed, turned } = setup([existing], { atomWiggleEnabled: true, instanceTumbleEnabled: false, objectTransformEnabled: false });
        feed([existing, route('symAxis')]);
        expect(turned).toEqual(['instanceTumbleEnabled']);
    });

    it('changing a target to a motion that is off turns it on', () => {
        const r = route('wiggle');
        const { feed, turned } = setup([r], { atomWiggleEnabled: true, instanceTumbleEnabled: true, objectTransformEnabled: false });
        feed([{ ...r, target: 'object' }]);
        expect(turned).toEqual(['objectTransformEnabled']);
    });

    it('enabling a route turns its motion on', () => {
        const r = route('wiggle', false);
        const { feed, turned } = setup([r], { atomWiggleEnabled: false, instanceTumbleEnabled: true, objectTransformEnabled: false });
        feed([{ ...r, enabled: true }]);
        expect(turned).toEqual(['atomWiggleEnabled']);
    });

    it('a gain, floor or curve edit never turns a motion the user turned off back on', () => {
        const r = route('symAxis');
        const { feed, turned, on } = setup([r], { atomWiggleEnabled: true, instanceTumbleEnabled: true, objectTransformEnabled: false });
        on.instanceTumbleEnabled = false; // the user turns Instance Beats off
        feed([{ ...r, gain: 5 }]);
        feed([{ ...r, gain: 5, floor: 0.3 }]);
        feed([{ ...r, gain: 5, floor: 0.3, curve: 'exp' }]);
        expect(turned).toEqual([]);
    });

    it('an instance wave route turns nothing on', () => {
        const { feed, turned } = setup([], { atomWiggleEnabled: false, instanceTumbleEnabled: false, objectTransformEnabled: false });
        feed([route('instanceWave')]);
        expect(turned).toEqual([]);
    });

    it('retargeting a route within one motion turns nothing on (the user turned that motion off on purpose)', () => {
        const r = route('symAxis');
        const { feed, turned } = setup([r], { atomWiggleEnabled: true, instanceTumbleEnabled: false, objectTransformEnabled: false });
        feed([{ ...r, target: 'instanceRandom' }]);
        expect(turned).toEqual([]);
    });

    it('a replaced set turns on what its new ids need, and only that', () => {
        const old = [route('wiggle'), route('symAxis')];
        const { feed, turned } = setup(old, { atomWiggleEnabled: false, instanceTumbleEnabled: true, objectTransformEnabled: false });
        feed([route('wiggle'), route('object')]);
        expect(turned).toEqual(['atomWiggleEnabled', 'objectTransformEnabled']);
    });

    it('removing a route turns nothing on', () => {
        const a = route('wiggle'), b = route('object');
        const { feed, turned } = setup([a, b], { atomWiggleEnabled: false, instanceTumbleEnabled: false, objectTransformEnabled: false });
        feed([a]);
        expect(turned).toEqual([]);
    });
});
