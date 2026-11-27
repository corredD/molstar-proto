/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

/** the part of an audio frame that decides whether the canvas must draw */
export interface AudioRedrawFrame {
    readonly illumination: number
    readonly hue: number
    readonly driveInstanceWave: number
    readonly scopeCount: number
    readonly scopeKind: ArrayLike<number>
    readonly scopeDrive: ArrayLike<number>
}

/** placeholder: the stateless decision of the first version */
export class AudioRedrawTracker {
    private prevIllumination = 0;
    private prevHue = 0;

    next(frame: AudioRedrawFrame): boolean {
        const r = (frame.illumination > 0 || frame.hue > 0) ||
            frame.illumination !== this.prevIllumination || frame.hue !== this.prevHue ||
            frame.driveInstanceWave > 0 || (frame.scopeCount > 0 && frame.scopeDrive[0] > 0);
        this.prevIllumination = frame.illumination;
        this.prevHue = frame.hue;
        return r;
    }
}
