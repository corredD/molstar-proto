/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

/**
 * `state` with `patch` applied, as a new object only when a field changed: each own key of `patch` is compared to the
 * same key of `state` by reference (`Object.is`), and a key set to `undefined` that `state` lacks counts as a change.
 * Returns `state` itself, allocating nothing, when no field changed; never mutates `state`.
 */
export function patchIfChanged<S extends object>(state: S, patch: Partial<S>): S {
    let next: S | undefined;
    for (const key in patch) {
        if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
        const value = patch[key] as S[typeof key];
        if (next === undefined) {
            if (Object.is(value, state[key]) && (value !== undefined || Object.prototype.hasOwnProperty.call(state, key))) continue;
            next = { ...state };
        }
        next[key] = value;
    }
    return next ?? state;
}
