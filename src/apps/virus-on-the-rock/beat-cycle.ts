/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

/** what the beat cycle reads from its owner */
export interface BeatCyclePorts {
    /** whether a step may advance the cycle now (axis mode and the cycle on, more than one target) */
    readonly canStep: () => boolean,
    /** the cycle advances on every this-many-th step */
    readonly every: () => number,
}

/** API skeleton: implemented in the next commit */
export class BeatCycle {
    constructor(private readonly ports: BeatCyclePorts) { }

    /** feeds one frame of the symmetry-axis drive at `now` (ms); true when the cycle advances to its next target */
    feed(raw: number, now: number): boolean {
        void this.ports;
        throw new Error('not implemented');
    }

    /** the audio stopped: the trigger re-arms */
    pause() {
        throw new Error('not implemented');
    }

    /** the cycle's targets or settings changed: the trigger re-arms and the count restarts */
    reset() {
        throw new Error('not implemented');
    }
}
