/**
 * Copyright (c) 2020-2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Loci } from '@molstar/model/model/loci';
import { StructureElement, type Structure } from '@molstar/model/model/structure';
import { Script } from '@molstar/model/script/script';
import { BitFlags } from '@molstar/core/util/bit-flags';

export { Clipping };

type Clipping<T extends Loci = Loci> = {
  readonly kind: T['kind'];
  readonly layers: ReadonlyArray<Clipping.Layer<T>>;
  /**
   * What each part does with each clip object (`Clipping.Table`): with a table, a layer's `row` is its part's row and
   * its `groups` are not read; the instances in no layer are in row 0
   */
  readonly table?: Clipping.Table;
};

function Clipping<T extends Loci>(kind: T['kind'], layers: ReadonlyArray<Clipping.Layer<T>>): Clipping<T> {
  return { kind, layers };
}

namespace Clipping {
  export type Layer<T extends Loci = Loci> = { readonly loci: T; readonly groups: Groups; readonly row?: number };
  export const Empty: Clipping = { kind: 'empty-loci', layers: [] };

  /**
   * What a part does with a clip object: is cut by it (`cut`, the default), `ignore`s it, keeps a layer of the band
   * inside it (`keep`, cellVIEW's +) or is cut a band wider (`wider`, cellVIEW's −). The modes of the instance clip;
   * the pixel clip cuts by `keep` and `wider` as by `cut`.
   */
  export type Mode = 'cut' | 'ignore' | 'keep' | 'wider';
  /** The modes as the shaders read them (`Clipping.tableData`) */
  export const ModeCode: { readonly [M in Mode]: number } = { cut: 0, ignore: 1, keep: 2, wider: 3 };
  /**
   * A part's way with a clip object: its mode, the band's width (Å) and the fuzziness (0 to 1) that thins the band
   * toward its edge (`isCut`)
   */
  export type Cell = { readonly mode: Mode; readonly band: number; readonly fuzziness: number };
  /** Rows of cells by clip object index (a missing cell cuts); at most `MaxTableRows` rows */
  export type Table = ReadonlyArray<ReadonlyArray<Cell | undefined>>;
  /** Rows a table can have: an instance's row is a byte */
  export const MaxTableRows = 256;
  /** Cells a row: the clip objects a representation can have (`Clip.MaxObjectCount`) */
  export const TableWidth = 16;

  /**
   * A stable random in [0, 1) of an instance id: cellVIEW's Wang hash (apps/prism-me/_spec/cellview.md §4.1), its top
   * 24 bits (exact in a 32-bit float), the same as the instance clip's (`clipRandom` in the clip chunks), so an instance
   * is thinned the same way every frame
   */
  export function random(id: number): number {
    let h = id >>> 0;
    h = h ^ 61 ^ (h >>> 16);
    h = Math.imul(h, 9);
    h ^= h >>> 4;
    h = Math.imul(h, 0x27d4eb2d);
    h ^= h >>> 15;
    return (h >>> 8) / 16777216;
  }

  /**
   * Whether `cell` cuts an instance at signed distance `d` from the clip object's surface (≤ 0 inside, Å) with the
   * stable random `r` (`random`): cellVIEW's object-space cut at full strength. In the band (`|d| ≤ band`) an instance
   * passes (is left as a plain cut leaves it) with probability `fuzziness · |d| / band`: none at the surface,
   * `fuzziness` at the band's edge. `keep` cuts the inside but what of the band does not pass; `wider` cuts the inside
   * and what of the band outside does not pass. The instance clip's rule (`clipTableTest` in the clip chunks).
   */
  export function isCut(cell: Cell, d: number, r: number): boolean {
    const inside = d <= 0;
    if (cell.mode === 'ignore') return false;
    if (cell.mode === 'cut') return inside;
    const nd = Math.abs(d) / Math.max(cell.band, 0.01);
    const passes = nd > 1 || r < cell.fuzziness * nd;
    return cell.mode === 'keep' ? inside && passes : inside || !passes;
  }

  /** The table as the shaders read it: per (row, clip object) the mode code, the band and the fuzziness (`rgba32f`) */
  export function tableData(table: Table, out?: Float32Array): Float32Array {
    const length = table.length * TableWidth * 4;
    const data = out && out.length >= length ? out : new Float32Array(length);
    data.fill(0, 0, length);
    for (let row = 0; row < table.length; ++row) {
      const cells = table[row];
      for (let i = 0, il = Math.min(cells.length, TableWidth); i < il; ++i) {
        const c = cells[i];
        if (!c) continue;
        const o = (row * TableWidth + i) * 4;
        data[o] = ModeCode[c.mode];
        data[o + 1] = c.band;
        data[o + 2] = c.fuzziness;
      }
    }
    return data;
  }

  function cellsEqual(a: Cell | undefined, b: Cell | undefined) {
    if (a === b) return true;
    const mode = a?.mode ?? 'cut';
    if (mode !== (b?.mode ?? 'cut')) return false;
    if (mode !== 'keep' && mode !== 'wider') return true;
    return a!.band === b!.band && a!.fuzziness === b!.fuzziness;
  }

  export function areTablesEqual(a: Table | undefined, b: Table | undefined) {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (let row = 0; row < a.length; ++row) {
      const n = Math.max(a[row].length, b[row].length);
      for (let i = 0; i < n; ++i) if (!cellsEqual(a[row][i], b[row][i])) return false;
    }
    return true;
  }

  export type Groups = BitFlags<Groups.Flag>;
  export namespace Groups {
    export const is: (g: Groups, f: Flag) => boolean = BitFlags.has;
    export enum Flag {
      None = 0x0,
      One = 0x1,
      Two = 0x2,
      Three = 0x4,
      Four = 0x8,
      Five = 0x10,
      Six = 0x20,
    }

    export function create(flags: Flag): Groups {
      return BitFlags.create(flags);
    }

    export const Names = {
      one: Flag.One,
      two: Flag.Two,
      three: Flag.Three,
      four: Flag.Four,
      five: Flag.Five,
      six: Flag.Six,
    };
    export type Names = keyof typeof Names;

    export function isName(name: string): name is Names {
      return name in Names;
    }

    export function fromName(name: Names): Flag {
      switch (name) {
        case 'one':
          return Flag.One;
        case 'two':
          return Flag.Two;
        case 'three':
          return Flag.Three;
        case 'four':
          return Flag.Four;
        case 'five':
          return Flag.Five;
        case 'six':
          return Flag.Six;
      }
    }

    export function fromNames(names: Names[]): Flag {
      let f = Flag.None;
      for (let i = 0, il = names.length; i < il; ++i) {
        f |= fromName(names[i]);
      }
      return f;
    }

    export function toNames(groups: Groups): Names[] {
      const names: Names[] = [];
      if (is(groups, Flag.One)) names.push('one');
      if (is(groups, Flag.Two)) names.push('two');
      if (is(groups, Flag.Three)) names.push('three');
      if (is(groups, Flag.Four)) names.push('four');
      if (is(groups, Flag.Five)) names.push('five');
      if (is(groups, Flag.Six)) names.push('six');
      return names;
    }
  }

  export function areEqual(cA: Clipping, cB: Clipping) {
    if (cA.layers.length !== cB.layers.length) return false;
    if (!areTablesEqual(cA.table, cB.table)) return false;
    for (let i = 0, il = cA.layers.length; i < il; ++i) {
      if (cA.layers[i].groups !== cB.layers[i].groups) return false;
      if (cA.layers[i].row !== cB.layers[i].row) return false;
      if (!Loci.areEqual(cA.layers[i].loci, cB.layers[i].loci)) return false;
    }
    return true;
  }

  /** Check if layers empty */
  export function isEmpty(clipping: Clipping) {
    return clipping.layers.length === 0;
  }

  /** Remap layers */
  export function remap(clipping: Clipping, structure: Structure): Clipping {
    if (clipping.kind === 'element-loci') {
      const layers: Clipping.Layer[] = [];
      for (const layer of clipping.layers) {
        let { loci, groups } = layer;
        loci = StructureElement.Loci.remap(loci as StructureElement.Loci, structure);
        if (!StructureElement.Loci.isEmpty(loci)) {
          layers.push({ loci, groups });
        }
      }
      return { kind: 'element-loci', layers };
    } else {
      return clipping;
    }
  }

  /** Merge layers */
  export function merge(clipping: Clipping): Clipping {
    if (isEmpty(clipping)) return clipping;
    if (clipping.kind === 'element-loci') {
      const { structure } = clipping.layers[0].loci as StructureElement.Loci;
      const map = new Map<Groups, StructureElement.Loci>();
      let shadowed = StructureElement.Loci.none(structure);
      for (let i = 0, il = clipping.layers.length; i < il; ++i) {
        let { loci, groups } = clipping.layers[il - i - 1]; // process from end
        loci = StructureElement.Loci.subtract(loci as StructureElement.Loci, shadowed);
        shadowed = StructureElement.Loci.union(loci, shadowed);
        if (!StructureElement.Loci.isEmpty(loci)) {
          if (map.has(groups)) {
            loci = StructureElement.Loci.union(loci, map.get(groups)!);
          }
          map.set(groups, loci);
        }
      }
      const layers: Clipping.Layer[] = [];
      map.forEach((loci, groups) => {
        layers.push({ loci, groups });
      });
      return { kind: 'element-loci', layers };
    } else {
      return clipping;
    }
  }

  /** Filter layers */
  export function filter(clipping: Clipping, filter: Structure): Clipping {
    if (isEmpty(clipping)) return clipping;
    if (clipping.kind === 'element-loci') {
      const { structure } = clipping.layers[0].loci as StructureElement.Loci;
      const layers: Clipping.Layer[] = [];
      for (const layer of clipping.layers) {
        let { loci, groups } = layer;
        // filter by first map to the `filter` structure and
        // then map back to the original structure of the clipping loci
        const filtered = StructureElement.Loci.remap(loci as StructureElement.Loci, filter);
        loci = StructureElement.Loci.remap(filtered, structure);
        if (!StructureElement.Loci.isEmpty(loci)) {
          layers.push({ loci, groups });
        }
      }
      return { kind: 'element-loci', layers };
    } else {
      return clipping;
    }
  }

  export type ScriptLayer = { script: Script; groups: Groups };
  export function ofScript(scriptLayers: ScriptLayer[], structure: Structure): Clipping {
    const layers: Clipping.Layer[] = [];
    for (let i = 0, il = scriptLayers.length; i < il; ++i) {
      const { script, groups } = scriptLayers[i];
      const loci = Script.toLoci(script, structure);
      if (!StructureElement.Loci.isEmpty(loci)) {
        layers.push({ loci, groups });
      }
    }
    return { kind: 'element-loci', layers };
  }

  export type BundleLayer = { bundle: StructureElement.Bundle; groups: Groups };
  export function ofBundle(bundleLayers: BundleLayer[], structure: Structure): Clipping {
    const layers: Clipping.Layer[] = [];
    for (let i = 0, il = bundleLayers.length; i < il; ++i) {
      const { bundle, groups } = bundleLayers[i];
      const loci = StructureElement.Bundle.toLoci(bundle, structure.root);
      layers.push({ loci, groups });
    }
    return { kind: 'element-loci', layers };
  }

  export function toBundle(clipping: Clipping<StructureElement.Loci>) {
    const layers: BundleLayer[] = [];
    for (let i = 0, il = clipping.layers.length; i < il; ++i) {
      const { loci, groups } = clipping.layers[i];
      const bundle = StructureElement.Bundle.fromLoci(loci);
      layers.push({ bundle, groups });
    }
    return { kind: 'element-loci', layers };
  }
}
