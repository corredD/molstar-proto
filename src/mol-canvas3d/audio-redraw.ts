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
    readonly scopeDrive: ArrayLike<number>
}

/**
 * Whether an audio frame needs a render even if nothing else changed: a narrowed route, or the position wave, moves
 * with tumble amplitude 0; illumination and hue repaint the same geometry, so they draw while above 0 and once more when they return to 0
 * (`prevIllumination` and `prevHue` are the last frame's values).
 */
export function audioFrameNeedsRender(prevIllumination: number, prevHue: number, frame: AudioRedrawFrame): boolean {
    if (frame.driveInstanceWave > 0) return true;
    for (let i = 0; i < frame.scopeCount; i++) {
        if (frame.scopeDrive[i] > 0) return true;
    }
    return false;
}
