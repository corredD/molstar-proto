/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Abundance, ConcentrationUnit, DensityUnit, Length, LengthUnit, MassUnit, Quantity } from './doc.js';

// Units (design.md §7.1): the document says its units, the IR is in ångström. Conversions happen once, when the runtime
// normalizes the document; resolvers and adapters never see a document unit.

export const LengthToAngstrom: Readonly<Record<LengthUnit, number>> = { A: 1, nm: 10, um: 1e4 };
export const ConcentrationToMolar: Readonly<Record<ConcentrationUnit, number>> = { nM: 1e-9, uM: 1e-6, mM: 1e-3, M: 1 };
/** Per Å². */
export const DensityToPerA2: Readonly<Record<DensityUnit, number>> = { per_nm2: 1e-2, per_um2: 1e-8 };
export const MassToDa: Readonly<Record<MassUnit, number>> = { Da: 1, kDa: 1e3, MDa: 1e6 };

export const Avogadro = 6.02214076e23;
/** Litres per Å³. */
export const LitrePerA3 = 1e-27;

/** A key of a unit table, not a property every object has (`toString`). */
export function isUnitOf<U extends string>(table: Readonly<Record<U, number>>, u: unknown): u is U {
  return typeof u === 'string' && Object.prototype.hasOwnProperty.call(table, u);
}

export function isLengthUnit(u: unknown): u is LengthUnit {
  return isUnitOf(LengthToAngstrom, u);
}

/** A length in Å; `docUnit` is the document's default. Undefined for an unknown unit. */
export function toAngstrom(l: Length, docUnit: LengthUnit): number | undefined {
  if (typeof l === 'number') return l * LengthToAngstrom[docUnit];
  const f = LengthToAngstrom[(l as Quantity).unit as LengthUnit];
  return f === undefined ? undefined : l.value * f;
}

export interface CountContext {
  /** Å³ of the space the population is in. */
  readonly volume?: number;
  /** Å² of the membrane or surface it is on. */
  readonly area?: number;
}

/** The copy count an abundance means in a compartment of this size; undefined when it cannot be known (and why). */
export function abundanceToCount(a: Abundance, ctx: CountContext): { count?: number; why?: string } {
  if ('count' in a) return { count: Math.round(a.count) };
  if ('concentration' in a) {
    const f = ConcentrationToMolar[a.concentration.unit];
    if (f === undefined) return { why: `unknown concentration unit ${a.concentration.unit}` };
    if (ctx.volume === undefined) return { why: 'a concentration needs a volume; the compartment has none known' };
    return { count: Math.round(a.concentration.value * f * Avogadro * ctx.volume * LitrePerA3) };
  }
  if ('density' in a) {
    const f = DensityToPerA2[a.density.unit];
    if (f === undefined) return { why: `unknown density unit ${a.density.unit}` };
    if (ctx.area === undefined) return { why: 'a density needs an area; the compartment has none known' };
    return { count: Math.round(a.density.value * f * ctx.area) };
  }
  if ('volumeFraction' in a) return { why: 'a volume fraction needs the entity volume; resolved by the resolver' };
  return { why: 'unknown abundance' };
}
