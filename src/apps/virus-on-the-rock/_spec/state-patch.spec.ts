/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { patchIfChanged } from '../state-patch';

interface S { a: number, b?: string, list: number[] }

describe('patchIfChanged', () => {
    it('returns the same reference when no field changed', () => {
        const list = [1];
        const state: S = { a: 1, b: 'x', list };
        expect(patchIfChanged(state, {})).toBe(state);
        expect(patchIfChanged(state, { a: 1 })).toBe(state);
        expect(patchIfChanged(state, { a: 1, b: 'x', list })).toBe(state);
    });

    it('returns a new object with the patch applied and leaves the snapshot untouched when one field changed', () => {
        const list = [1];
        const state: S = { a: 1, b: 'x', list };
        const next = patchIfChanged(state, { a: 1, b: 'y' });
        expect(next).not.toBe(state);
        expect(next).toEqual({ a: 1, b: 'y', list });
        expect(next.list).toBe(list);
        expect(state).toEqual({ a: 1, b: 'x', list });
    });

    it('compares by reference, not by value', () => {
        const state: S = { a: 1, list: [1] };
        const next = patchIfChanged(state, { list: [1] });
        expect(next).not.toBe(state);
        expect(state.list).not.toBe(next.list);
    });

    it('compares only the own keys of the patch', () => {
        const state: S = { a: 1, b: 'x', list: [] };
        const patch = Object.create({ a: 2 }) as Partial<S>;
        patch.b = 'x';
        expect(patchIfChanged(state, patch)).toBe(state);
    });

    it('counts an undefined-valued patch key as a change when the state lacks that key', () => {
        const state: S = { a: 1, list: [] };
        const next = patchIfChanged(state, { b: undefined });
        expect(next).not.toBe(state);
        expect('b' in next).toBe(true);
        expect('b' in state).toBe(false);
    });

    it('does not count an undefined-valued patch key as a change when the state holds undefined there', () => {
        const state: S = { a: 1, b: undefined, list: [] };
        expect(patchIfChanged(state, { b: undefined })).toBe(state);
    });
});
