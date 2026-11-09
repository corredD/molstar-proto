/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Location, MesoQL } from '../format/doc.js';
import type { EntityRef, InstanceRef, ModelRef, PopulationRef, Ref, Scope } from './refs.js';

// MesoQL addresses built from refs (design.md §3.8, §3.15): one helper per symbol of `MesoQLSymbols`, each taking refs
// of the kind the symbol takes, printing the canonical text `printMesoQL` prints. A `Selection` is a `MesoQL` string, so
// it goes where a look's `select` or a camera's `focus` goes; a raw string goes there too and `validate` checks it.

declare const QBrand: unique symbol;
export type Selection = MesoQL & { readonly [QBrand]: 'selection' };
export type SiteAddress = MesoQL & { readonly [QBrand]: 'site' };
export type ResiduesAddress = MesoQL & { readonly [QBrand]: 'residues' };

/** An atom, quoted as `printMesoQL` quotes it. */
const atom = (v: string | number | boolean) =>
  typeof v === 'string' && /[\s()"[\]]/.test(v) ? JSON.stringify(v) : String(v);
/** `(head part…)`: a part is an atom already (`atom(…)`) or a sub-address (raw). Keywords follow, a missing one left out. */
const form = (head: string, parts: readonly string[], kw: readonly (readonly [string, string | undefined])[] = []) =>
  `(${[head, ...parts, ...kw.flatMap(([k, v]) => (v === undefined ? [] : [`:${k}`, v]))].join(' ')})`;
const sel = (...args: Parameters<typeof form>) => form(...args) as Selection;
const ids = (xs: readonly string[]) => xs.map(atom);
const opt = (v: string | number | boolean | undefined) => (v === undefined ? undefined : atom(v));

type P = PopulationRef<Scope>;
type C = Ref<'compartment', Scope>;

export const q = {
  all: () => sel('all', []),
  population: (...p: P[]) => sel('population', ids(p)),
  instance: (...i: InstanceRef[]) => sel('instance', ids(i)),
  entity: (...e: Ref<'entity', Scope>[]) => sel('entity', ids(e)),
  model: (...m: ModelRef<Scope>[]) => sel('model', ids(m)),
  in: (c: C | readonly C[], o: { nested?: boolean; location?: Location } = {}) =>
    sel('in', ids(typeof c === 'string' ? [c] : c), [
      ['nested', opt(o.nested)],
      ['location', opt(o.location)],
    ]),
  copies: (p: P, start: number, count?: number) =>
    sel('copies', ids(count === undefined ? [p, String(start)] : [p, String(start), String(count)])),
  and: (...s: Selection[]) => sel('and', s),
  or: (...s: Selection[]) => sel('or', s),
  not: (s: Selection, o: { in?: Selection } = {}) => sel('not', [s], [['in', o.in]]),
  within: (s: Selection, o: { of: Selection; distance: number }) =>
    sel(
      'within',
      [s],
      [
        ['of', o.of],
        ['distance', atom(o.distance)],
      ],
    ),
  site: <N extends string>(e: EntityRef<Scope, N>, name: NoInfer<N>) => form('site', ids([e, name])) as SiteAddress,
  residues: (
    e: Ref<'entity', Scope>,
    o: { chain?: string; range?: string | number | readonly [number, number] } = {},
  ) =>
    form('residues', ids([e]), [
      ['chain', opt(o.chain)],
      ['range', opt(typeof o.range === 'object' ? o.range.join('-') : o.range)],
    ]) as ResiduesAddress,
  part: (instances: Selection, inner: PopulationRef<'inner'>) => sel('part', [instances, atom(inner)]),
};
