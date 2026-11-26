/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import * as React from 'react';
import { distinctUntilChanged, map, Observable } from 'rxjs';
import { shallowEqual } from '../../../mol-util';
import { useBehavior } from '../../../mol-plugin-ui/hooks/use-behavior';
import type { VirusOnTheRockApp } from '../app';
import type { VirusOnTheRockState } from '../state';

type StateSource<S> = { readonly value: S, pipe: Observable<S>['pipe'] };

/**
 * A read-only view of one slice of a state behavior: `value` is `select(source.value)`, the same object while the
 * slice is shallow-equal to the last one, and the stream emits only when it changed. Shaped for `useBehavior`.
 */
export function createStateSlice<S, T>(source: StateSource<S>, select: (state: S) => T): Observable<T> & { readonly value: T } {
    let last: T;
    let hasLast = false;
    const read = () => {
        const next = select(source.value);
        if (hasLast && shallowEqual(last, next)) return last;
        hasLast = true;
        return last = next;
    };
    const slice = source.pipe(map(read), distinctUntilChanged()) as Observable<T> & { readonly value: T };
    Object.defineProperty(slice, 'value', { get: read });
    return slice;
}

/**
 * The slice of `app.state` a card reads: pass a selector defined once at module level. A card's slice subscription
 * re-renders it only when the slice changed (the cards are not memoized: a re-render of the Controls re-renders them all)
 */
export function useStateSlice<T>(app: VirusOnTheRockApp, select: (state: VirusOnTheRockState) => T): T {
    const slice = React.useMemo(() => createStateSlice(app.state, select), [app, select]);
    return useBehavior(slice);
}
