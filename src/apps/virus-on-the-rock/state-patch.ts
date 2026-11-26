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
    // skeleton: today's behaviour (always a copy); the next commit compares the fields
    return { ...state, ...patch };
}
