/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { AudioReactivePresetDefinitions, getPresetRoutes } from '../audio-reactive-presets';

/** the motion flags as the animation defaults and the preset leave them (geometry/animation.ts: wiggle on, tumble on, object off) */
function motionsOff(animation: { atomWiggleEnabled?: boolean, instanceTumbleEnabled?: boolean, objectTransformEnabled?: boolean }) {
    return {
        wiggle: animation.atomWiggleEnabled === false,
        tumble: animation.instanceTumbleEnabled === false,
        object: animation.objectTransformEnabled !== true,
    };
}

describe('preset routes', () => {
    for (const preset of AudioReactivePresetDefinitions) {
        it(`${preset.name}: no enabled route on a motion the preset turns off`, () => {
            const off = motionsOff(preset.animation);
            const dead = getPresetRoutes(preset).filter(r => r.enabled && (
                (off.wiggle && r.target === 'wiggle')
                || (off.tumble && ['symAxis', 'instanceRandom', 'instanceAxis', 'instanceNormal'].includes(r.target))
                || (off.object && r.target === 'object')
            ));
            expect(dead.map(r => `${r.source} -> ${r.target}`)).toEqual([]);
        });
    }
});
