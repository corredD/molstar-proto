/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { MotionFlagOfTarget } from '../../mol-plugin-state/helpers/audio-reactive-presets';
import type { AudioRoute } from '../../mol-plugin-state/manager/audio-routing';

export type MotionFlag = NonNullable<typeof MotionFlagOfTarget[keyof typeof MotionFlagOfTarget]>;

/** the motion each enabled route needs on to move anything, by route id (instanceWave and the like need none) */
export function motionsNeededBy(routes: readonly AudioRoute[]): ReadonlyMap<number, MotionFlag> {
    const needed = new Map<number, MotionFlag>();
    for (const r of routes) {
        const flag = r.enabled ? MotionFlagOfTarget[r.target] : undefined;
        if (flag) needed.set(r.id, flag);
    }
    return needed;
}

/**
 * The motions to turn on after a route edit: those a route needs that it did not need before, by id: a route added, a
 * route enabled, or a route whose target moved to another motion. A gain, floor or curve edit changes none of these, so
 * a motion the user turned off stays off while its routes are edited.
 */
export function grownMotions(before: ReadonlyMap<number, MotionFlag>, after: ReadonlyMap<number, MotionFlag>): MotionFlag[] {
    const grown: MotionFlag[] = [];
    after.forEach((flag, id) => {
        if (before.get(id) !== flag && !grown.includes(flag)) grown.push(flag);
    });
    return grown;
}

/** ports: which motions are on now, and how to turn one on */
export interface RouteMotionsPorts {
    isOn(flag: MotionFlag): boolean,
    turnOn(flag: MotionFlag): void,
}

/**
 * Turns a motion on when a route edit makes the routes need it (see `grownMotions`), and only then. Feed it every
 * routes emission; seed it with the routes in place at the start, which enable nothing.
 */
export function createRouteMotionsFollower(initial: readonly AudioRoute[], ports: RouteMotionsPorts) {
    let needed = motionsNeededBy(initial);
    return (routes: readonly AudioRoute[]) => {
        const next = motionsNeededBy(routes);
        for (const flag of grownMotions(needed, next)) {
            if (!ports.isOn(flag)) ports.turnOn(flag);
        }
        needed = next;
    };
}
