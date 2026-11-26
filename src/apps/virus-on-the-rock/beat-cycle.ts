/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

/**
 * The beat cycle steps when the symmetry-axis drive rises past this share of its running peak, and re-arms once it falls
 * under the release share: relative, so it follows whatever routes drive the axes, at any gain
 */
export const BeatCycleTriggerLevel = 0.75;
export const BeatCycleReleaseLevel = 0.3;
export const BeatCyclePeakDecayMs = 3000;
export const BeatCycleAverageMs = 400;
/** no two steps closer than this, ms */
export const BeatCycleMinIntervalMs = 400;
export const BeatCyclePeakFloor = 0.05;

/** what the beat cycle reads from its owner */
export interface BeatCyclePorts {
    /** whether a step may advance the cycle now (axis mode and the cycle on, more than one target) */
    readonly canStep: () => boolean,
    /** the cycle advances on every this-many-th step */
    readonly every: () => number,
}

/**
 * The beat detector of the axis cycle: counts the hits of the symmetry-axis drive and says when the cycle advances. It
 * knows no viewer; its owner applies the next target
 */
export class BeatCycle {
    private triggerActive = false;
    private peak = BeatCyclePeakFloor;
    private average = 0;
    private lastStepMs = 0;
    private lastMs = 0;
    private count = 0;

    constructor(private readonly ports: BeatCyclePorts) { }

    /** feeds one frame of the symmetry-axis drive at `now` (ms); true when the cycle advances to its next target */
    feed(raw: number, now: number): boolean {
        // the symmetry-axis channel's drive (whatever routes feed it: drums, bass...), relative to its running peak. Not
        // the beat detector's intensity against `beatThreshold` (the detector's flux multiplier, ~1.1-1.35): a 0-1
        // intensity never reached it, so the cycle only ran while the start-up forced it to 0.05
        const dt = this.lastMs > 0 ? now - this.lastMs : 16;
        this.lastMs = now;
        // a hit is the drive rising above its short average (a sustained bass keeps the drive high, never a hit)
        this.average += (raw - this.average) * (1 - Math.exp(-dt / BeatCycleAverageMs));
        const excess = Math.max(0, raw - this.average);
        this.peak = Math.max(excess, BeatCyclePeakFloor, this.peak * Math.exp(-dt / BeatCyclePeakDecayMs));
        const drive = excess / this.peak;
        const beatActive = this.triggerActive ? drive > BeatCycleReleaseLevel : drive >= BeatCycleTriggerLevel;
        const shouldAdvance = this.ports.canStep() && beatActive && !this.triggerActive && now - this.lastStepMs >= BeatCycleMinIntervalMs;
        this.triggerActive = beatActive;
        if (!shouldAdvance) return false;
        this.lastStepMs = now;
        this.count += 1;
        return this.count % this.ports.every() === 0;
    }

    /** the audio stopped: the trigger re-arms (the clock, peak and average are kept) */
    pause() {
        this.triggerActive = false;
    }

    /** the cycle's targets or settings changed: the trigger re-arms and the count restarts */
    reset() {
        this.triggerActive = false;
        this.count = 0;
    }
}
