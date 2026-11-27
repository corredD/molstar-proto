/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { audioFrameNeedsRender } from '../audio-redraw';

const scopeDrive = new Float32Array(8);
const frame = (o: { illumination?: number, hue?: number, wave?: number, scopeCount?: number, scope0?: number } = {}) => {
    scopeDrive[0] = o.scope0 ?? 0;
    return {
        illumination: o.illumination ?? 0, hue: o.hue ?? 0, driveInstanceWave: o.wave ?? 0,
        scopeCount: o.scopeCount ?? 0, scopeDrive,
    };
};

describe('audioFrameNeedsRender', () => {
    it('renders while the illumination or the hue drive is above 0, or changed', () => {
        expect(audioFrameNeedsRender(0, 0, frame({ illumination: 0.5 }))).toBe(true);
        expect(audioFrameNeedsRender(0, 0, frame({ hue: 0.2 }))).toBe(true);
        expect(audioFrameNeedsRender(0.5, 0.2, frame({ illumination: 0.5, hue: 0.2 }))).toBe(true);
    });

    it('renders once more when a drive returns to 0, then not', () => {
        expect(audioFrameNeedsRender(0.5, 0, frame())).toBe(true);
        expect(audioFrameNeedsRender(0, 0.3, frame())).toBe(true);
        expect(audioFrameNeedsRender(0, 0, frame())).toBe(false);
    });

    it('does not render with every drive 0 and unchanged', () => {
        expect(audioFrameNeedsRender(0, 0, frame({ scopeCount: 1 }))).toBe(false);
    });

    it('keeps the instance wave and the narrowed routes', () => {
        expect(audioFrameNeedsRender(0, 0, frame({ wave: 0.1 }))).toBe(true);
        expect(audioFrameNeedsRender(0, 0, frame({ scopeCount: 1, scope0: 0.1 }))).toBe(true);
        expect(audioFrameNeedsRender(0, 0, frame({ scopeCount: 0, scope0: 0.1 }))).toBe(false);
    });
});
