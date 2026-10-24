/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Color } from '@molstar/core/util/color';
import { ColorNames } from '@molstar/core/util/color/names';
import type { MesoEntity } from './model.js';

// A color file (_spec/features.md, "Color file import (JSON)"): one JSON object, a color per entity name. Two forms,
// told apart per value:
// - the Mesoscale Explorer's (v5 `apps/mesoscale-explorer/src/ui/states.tsx`, `loadColors`): the key the entity's
//   full cellPACK name, `<compartment path>.<entity>` (`root.HIVenvelop_mature.HIV_capsid.surface.proteins.HIV1_CA_mono_0_1_0`),
//   the value `{ "x": r, "y": g, "z": b }`, integers in 0-255 (`Color.fromRgb`, as v5 reads it). Unlike v5, a value
//   with a fraction (a 0-1 color) is not a color here (reported in `invalid`), where v5 drew it near black;
// - a plain map: the key the entity's name, the value a CSS color (`#rrggbb`, `#rgb`, a color name).
// A key is the entity's name as the particle list has it, else its last dotted part (the compartment path is not
// checked): the particle model names a cellPACK entity by that part alone, one entity for a name found in several
// compartments. Two keys for one entity (its copies in two compartments, which v5 colored apart): the last color is
// kept and the entity is reported (`overridden`).

/** A CSS color name or #rrggbb (#rgb) */
export function cssColor(text: string): Color | undefined {
  const c = text.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(c)) return Color.fromHexStyle(c);
  if (/^#[0-9a-f]{3}$/.test(c)) return Color.fromHexStyle(`#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`);
  const named = (ColorNames as Record<string, Color>)[c.replace(/[\s-]/g, '')];
  return named;
}

/** The file's object, or why it is not one (not JSON, not an object) */
export function parseColorFile(text: string): Record<string, unknown> | string {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return `The colors are not JSON (${e instanceof Error ? e.message : String(e)}).`;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return 'The colors are not a JSON object of entity names.';
  }
  return data as Record<string, unknown>;
}

/** A value of the file as a color: a CSS color, or the explorer's `{ x, y, z }` (integers, 0-255) */
export function colorOfValue(value: unknown): Color | undefined {
  if (typeof value === 'string') return cssColor(value);
  if (!value || typeof value !== 'object') return undefined;
  const { x, y, z } = value as { x?: unknown; y?: unknown; z?: unknown };
  if (!isChannel(x) || !isChannel(y) || !isChannel(z)) return undefined;
  return Color.fromRgb(x, y, z);
}

function isChannel(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 255;
}

export interface ColorFileMatch {
  /** The color of each entity named, by entity id */
  readonly colors: ReadonlyMap<number, Color>;
  /** The entities colored, by name, in the list's order */
  readonly matched: readonly string[];
  /** The keys of the file that name no entity */
  readonly unmatched: readonly string[];
  /** The keys whose value is not a color */
  readonly invalid: readonly string[];
  /** The entities two keys or more name, by name, in the list's order: the last key's color kept */
  readonly overridden: readonly string[];
}

/** The colors of the file on `entities`: the names indexed once, each key looked up (bulk operations are one change) */
export function matchColors(entities: readonly MesoEntity[], file: Readonly<Record<string, unknown>>): ColorFileMatch {
  const byName = new Map<string, number>();
  for (const e of entities) byName.set(e.name, e.id);
  const colors = new Map<number, Color>();
  const unmatched: string[] = [];
  const invalid: string[] = [];
  const twice = new Set<number>();
  for (const key of Object.keys(file)) {
    const color = colorOfValue(file[key]);
    if (color === undefined) {
      invalid.push(key);
      continue;
    }
    let id = byName.get(key);
    if (id === undefined) {
      const dot = key.lastIndexOf('.');
      if (dot >= 0) id = byName.get(key.slice(dot + 1));
    }
    if (id === undefined) unmatched.push(key);
    else {
      if (colors.has(id)) twice.add(id);
      colors.set(id, color);
    }
  }
  const matched: string[] = [];
  const overridden: string[] = [];
  for (const e of entities) {
    if (colors.has(e.id)) matched.push(e.name);
    if (twice.has(e.id)) overridden.push(e.name);
  }
  return { colors, matched, unmatched, invalid, overridden };
}
