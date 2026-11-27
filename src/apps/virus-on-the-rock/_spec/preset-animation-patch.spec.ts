/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { getPresetAnimationPatch } from '../state';

const flags = (a: boolean, b: boolean, c: boolean) => ({ atomWiggleEnabled: a, instanceTumbleEnabled: b, objectTransformEnabled: c });

describe('getPresetAnimationPatch', () => {
    it("'keep' leaves the three motion flags as they are now, both ways, and applies the rest of the preset", () => {
        const current = flags(false, true, false);
        const preset = { ...flags(true, false, true), tumbleAmplitude: 3 };
        const patch = getPresetAnimationPatch(current as never, preset as never, 'keep');
        expect(patch).toMatchObject({ ...flags(false, true, false), tumbleAmplitude: 3 });
    });

    it("'replace' applies the preset's motion flags", () => {
        const patch = getPresetAnimationPatch(flags(false, true, false) as never, flags(true, false, true) as never, 'replace');
        expect(patch).toMatchObject(flags(true, false, true));
    });

    it("'keep' with a preset that sets no flag stays as it was", () => {
        const patch = getPresetAnimationPatch(flags(true, true, true) as never, {} as never, 'keep');
        expect(patch).toMatchObject(flags(true, true, true));
    });
});
