/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { BehaviorSubject } from 'rxjs';
import { createStateSlice } from '../ui/state-slice';

interface S { a: number, b: number, list: number[] }

describe('createStateSlice', () => {
    it('keeps the same object and emits nothing while the slice is unchanged', () => {
        const source = new BehaviorSubject<S>({ a: 1, b: 1, list: [] });
        const slice = createStateSlice(source, s => ({ a: s.a }));
        const first = slice.value;
        const seen: unknown[] = [];
        slice.subscribe(v => seen.push(v));
        expect(seen.length).toBe(1);
        source.next({ ...source.value, b: 2 });
        expect(slice.value).toBe(first);
        expect(seen.length).toBe(1);
    });

    it('emits a new object when a field of the slice changed', () => {
        const source = new BehaviorSubject<S>({ a: 1, b: 1, list: [] });
        const slice = createStateSlice(source, s => ({ a: s.a }));
        const first = slice.value;
        const seen: { a: number }[] = [];
        slice.subscribe(v => seen.push(v));
        source.next({ ...source.value, a: 2 });
        expect(slice.value).not.toBe(first);
        expect(slice.value).toEqual({ a: 2 });
        expect(seen.map(v => v.a)).toEqual([1, 2]);
    });

    it('compares the fields of the slice by reference', () => {
        const list = [1];
        const source = new BehaviorSubject<S>({ a: 1, b: 1, list });
        const slice = createStateSlice(source, s => ({ list: s.list }));
        const first = slice.value;
        source.next({ ...source.value, list });
        expect(slice.value).toBe(first);
        source.next({ ...source.value, list: [1] });
        expect(slice.value).not.toBe(first);
    });
});
