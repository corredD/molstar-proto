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

const MaxScopes = 8;

/**
 * Decides per audio frame whether the canvas must draw even if nothing else changed. Illumination and hue (global,
 * and narrowed kinds 8 and 9) repaint the same geometry and have no time term, so they render on change only; a held
 * value does not. The instance wave and the narrowed motion kinds move with `uTime`, so they render while above 0 and
 * once more when they drop to 0. One instance per canvas; `next` allocates nothing.
 */
export class AudioRedrawTracker {
    private prevIllumination = 0;
    private prevHue = 0;
    private prevWave = 0;
    private prevCount = 0;
    private readonly prevKind = new Float32Array(MaxScopes);
    private readonly prevDrive = new Float32Array(MaxScopes);

    next(frame: AudioRedrawFrame): boolean {
        let render = false;
        if (frame.illumination !== this.prevIllumination || frame.hue !== this.prevHue) render = true;
        if (frame.driveInstanceWave > 0 || frame.driveInstanceWave !== this.prevWave) render = true;
        this.prevIllumination = frame.illumination;
        this.prevHue = frame.hue;
        this.prevWave = frame.driveInstanceWave;

        const count = Math.min(frame.scopeCount, MaxScopes);
        const n = Math.max(count, this.prevCount);
        for (let i = 0; i < n; i++) {
            const active = i < count;
            // a disabled route drives nothing; Float32 values compare as stored
            const drive = active ? Math.fround(frame.scopeDrive[i] ?? 0) : 0;
            const kind = active ? Math.fround(frame.scopeKind[i] ?? 0) : this.prevKind[i];
            if (kind !== this.prevKind[i] || drive !== this.prevDrive[i]) render = true;
            else if (drive > 0 && kind !== 8 && kind !== 9) render = true;
            this.prevKind[i] = kind;
            this.prevDrive[i] = drive;
        }
        this.prevCount = count;
        return render;
    }
}
