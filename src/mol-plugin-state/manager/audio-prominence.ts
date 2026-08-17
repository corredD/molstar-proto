/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

/**
 * Relative prominence of several audio sources.
 *
 * A source is prominent when it is loud *and* when it just got louder: a drum hit breaking a
 * silence draws attention in a way a pad sustaining at the same level does not. The two effects
 * are captured separately - the instantaneous level, and a leaky peak-hold of the positive level
 * flux - then combined and softmax-normalized across the active sources so the scores describe
 * which source dominates *right now* rather than how loud it is in absolute terms.
 *
 * The sources are deliberately untyped beyond their keys: they can be the frequency bands of a
 * single mixed signal (see `AudioReactor`) or, given the files, individual stem tracks.
 */

export type AudioProminenceParams = {
    /**
     * Half-life of the onset peak-hold. Long enough to read, short enough to track fast rhythms;
     * the default matches a per-frame decay of 0.92 at 60 fps.
     */
    onsetHalfLifeMs: number,
    /**
     * How much the onset counts relative to the level. 1 weights them equally, as the reference
     * visualization does for stems that are already roughly level-matched. Sources on very
     * different scales - frequency bands of one mix, where the bass saturates and the treble does
     * not - need a higher value for a transient to out-rank a loud sustain.
     */
    onsetWeight: number,
    /**
     * Softmax temperature. Higher values sharpen the distribution, so a source that spikes claims
     * most of the weight and the others collapse toward zero. 0 spreads the weight evenly.
     */
    temperature: number,
    /**
     * Sources whose combined level and onset stay below this are treated as silent, excluded from
     * the softmax and reported as 0. Without it every source would score `1 / count` in silence.
     */
    activityThreshold: number,
};

export const DefaultAudioProminenceParams: AudioProminenceParams = {
    onsetHalfLifeMs: 130,
    onsetWeight: 1,
    temperature: 5,
    activityThreshold: 0.02,
};

/** Per-source outputs of `AudioProminenceTracker.update`. */
export type AudioProminenceFrame<K extends string = string> = {
    /** Leaky peak-hold of the positive level flux, in the units of the input levels. */
    onset: Record<K, number>,
    /** Softmax of `level + onset` over the active sources. Sums to 1, or to 0 when all are silent. */
    prominence: Record<K, number>,
};

function createZeroRecord<K extends string>(keys: readonly K[]): Record<K, number> {
    const out = Object.create(null) as Record<K, number>;
    for (const key of keys) out[key] = 0;
    return out;
}

/**
 * Decay factor to apply to the previous onset value over `dtMs`. Expressed as a half-life rather
 * than a per-frame constant so the decay does not change with the frame rate.
 */
export function getOnsetDecay(halfLifeMs: number, dtMs: number) {
    if (halfLifeMs <= 0) return 0;
    if (dtMs <= 0) return 1;
    return Math.pow(0.5, dtMs / halfLifeMs);
}

/**
 * Softmax of `scores` over the entries flagged in `active`, written into `out`. Inactive entries
 * are set to 0. The maximum is subtracted before exponentiating to keep large temperatures stable.
 */
export function softmaxOverActive<K extends string>(keys: readonly K[], scores: Record<K, number>, active: Record<K, boolean>, temperature: number, out: Record<K, number>) {
    let max = -Infinity;
    let activeCount = 0;
    for (const key of keys) {
        if (!active[key]) continue;
        activeCount += 1;
        if (scores[key] > max) max = scores[key];
    }

    if (activeCount === 0) {
        for (const key of keys) out[key] = 0;
        return out;
    }

    let sum = 0;
    for (const key of keys) {
        if (!active[key]) {
            out[key] = 0;
            continue;
        }
        const weight = Math.exp(temperature * (scores[key] - max));
        out[key] = weight;
        sum += weight;
    }

    if (sum > 0) {
        for (const key of keys) {
            if (active[key]) out[key] /= sum;
        }
    }
    return out;
}

export class AudioProminenceTracker<K extends string = string> {
    private params: AudioProminenceParams;
    private previousLevel: Record<K, number>;
    private scores: Record<K, number>;
    private active: Record<K, boolean>;
    private frame: AudioProminenceFrame<K>;

    constructor(private keys: readonly K[], params?: Partial<AudioProminenceParams>) {
        this.params = { ...DefaultAudioProminenceParams, ...params };
        this.previousLevel = createZeroRecord(keys);
        this.scores = createZeroRecord(keys);
        this.active = Object.create(null) as Record<K, boolean>;
        this.frame = { onset: createZeroRecord(keys), prominence: createZeroRecord(keys) };
    }

    getParams() {
        return this.params;
    }

    setParams(params: Partial<AudioProminenceParams>) {
        this.params = { ...this.params, ...params };
    }

    reset() {
        for (const key of this.keys) {
            this.previousLevel[key] = 0;
            this.frame.onset[key] = 0;
            this.frame.prominence[key] = 0;
        }
    }

    /**
     * Advance by `dtMs` with the current per-source levels. `enabled` optionally excludes sources
     * from the softmax, so the remaining ones redistribute the full weight between them.
     *
     * The returned records are reused between calls; copy them before holding on to the values.
     */
    update(levels: Record<K, number>, dtMs: number, enabled?: (key: K) => boolean): AudioProminenceFrame<K> {
        const { onsetHalfLifeMs, onsetWeight, temperature, activityThreshold } = this.params;
        const decay = getOnsetDecay(onsetHalfLifeMs, dtMs);
        const { onset, prominence } = this.frame;

        for (const key of this.keys) {
            const level = levels[key];
            const delta = level - this.previousLevel[key];
            this.previousLevel[key] = level;

            const held = onset[key] * decay;
            onset[key] = delta > held ? delta : held;

            const score = level + onsetWeight * onset[key];
            this.scores[key] = score;
            this.active[key] = score > activityThreshold && (!enabled || enabled(key));
        }

        softmaxOverActive(this.keys, this.scores, this.active, temperature, prominence);
        return this.frame;
    }
}
