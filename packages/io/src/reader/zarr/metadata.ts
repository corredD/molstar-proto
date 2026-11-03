/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

export type ZarrTypedArray =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

export type ZarrTypedArrayCtor = {
  new (length: number): ZarrTypedArray;
  new (buffer: ArrayBufferLike, byteOffset: number, length: number): ZarrTypedArray;
  readonly BYTES_PER_ELEMENT: number;
};

/** A Zarr v2 `dtype` (zarr.md §2): a number of 1, 2, 4 or 8 bytes. */
export interface ZarrDtype {
  /** As in `.zarray`, e.g. `<f4`. */
  readonly name: string;
  readonly ctor: ZarrTypedArrayCtor;
  readonly size: number;
  readonly littleEndian: boolean;
  readonly isInteger: boolean;
}

/** The codecs read (zarr.md §3); `null` is raw bytes. */
export type ZarrCompressor = { readonly id: 'blosc' } | { readonly id: 'zlib' } | { readonly id: 'gzip' } | null;

/** A `.zarray`, validated (zarr.md §2). */
export interface ZarrArrayMeta {
  readonly shape: readonly number[];
  readonly chunks: readonly number[];
  readonly dtype: ZarrDtype;
  readonly compressor: ZarrCompressor;
  /** What a missing chunk holds; `null` in the file reads as 0. */
  readonly fillValue: number;
  readonly separator: '.' | '/';
}

const Ctors: Record<string, ZarrTypedArrayCtor> = {
  i1: Int8Array,
  u1: Uint8Array,
  i2: Int16Array,
  u2: Uint16Array,
  i4: Int32Array,
  u4: Uint32Array,
  f4: Float32Array,
  f8: Float64Array,
};

function fail(what: string): never {
  throw new Error(`Zarr: ${what}`);
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isCounts(x: unknown, min: number): x is number[] {
  return Array.isArray(x) && x.length > 0 && x.every((v) => Number.isInteger(v) && v >= min);
}

export function parseZarrDtype(name: unknown): ZarrDtype {
  const m = typeof name === 'string' ? /^([<>|])([iuf][1248])$/.exec(name) : null;
  const ctor = m && Ctors[m[2]];
  if (!m || !ctor) fail(`dtype ${JSON.stringify(name)} is not supported (|i1 |u1 <i2 <u2 <i4 <u4 <f4 <f8, < or >)`);
  const size = ctor.BYTES_PER_ELEMENT;
  if ((m[1] === '|') !== (size === 1)) fail(`dtype ${name}: '|' is for one byte, '<' or '>' for more`);
  return { name: name as string, ctor, size, littleEndian: m[1] !== '>', isInteger: m[2][0] !== 'f' };
}

function parseCompressor(c: unknown): ZarrCompressor {
  if (c === null) return null;
  if (!isRecord(c)) fail('compressor is not an object');
  if (c.id === 'blosc' || c.id === 'zlib' || c.id === 'gzip') return { id: c.id };
  fail(`the ${JSON.stringify(c.id)} compressor is not supported (blosc, zlib, gzip)`);
}

function parseFill(v: unknown): number {
  if (v === null) return 0;
  if (typeof v === 'number') return v;
  if (v === 'NaN') return NaN;
  if (v === 'Infinity') return Infinity;
  if (v === '-Infinity') return -Infinity;
  fail(`fill_value ${JSON.stringify(v)} is not a number`);
}

/** Validates a parsed `.zarray`: what is not read throws, with what is (zarr.md §2). */
export function parseZarrArray(json: unknown): ZarrArrayMeta {
  if (!isRecord(json)) fail('.zarray is not an object');
  if (json.zarr_format !== 2) fail(`zarr_format ${JSON.stringify(json.zarr_format)} is not supported (2)`);
  const { shape, chunks } = json;
  if (!isCounts(shape, 0)) fail('shape is not a list of counts');
  if (!isCounts(chunks, 1) || chunks.length !== shape.length) fail('chunks do not match the shape');
  if (json.order !== 'C') fail(`order ${JSON.stringify(json.order)} is not supported (C)`);
  if (json.filters !== null && json.filters !== undefined && !(Array.isArray(json.filters) && !json.filters.length)) {
    fail('filters are not supported');
  }
  const sep = json.dimension_separator ?? '.';
  if (sep !== '.' && sep !== '/') fail(`dimension_separator ${JSON.stringify(sep)} is not '.' or '/'`);
  return {
    shape,
    chunks,
    dtype: parseZarrDtype(json.dtype),
    compressor: parseCompressor(json.compressor),
    fillValue: parseFill(json.fill_value),
    separator: sep,
  };
}

/** Å per unit, for the NGFF space units read (zarr.md §4). */
const Angstroms: Record<string, number> = {
  angstrom: 1,
  nanometer: 10,
  micrometer: 1e4,
  millimeter: 1e7,
  picometer: 0.01,
};

/** One NGFF dataset, in Mol*'s axis order: x, y, z (zarr.md §4). */
export interface NgffLevel {
  readonly path: string;
  /** Å per voxel. */
  readonly scale: readonly [number, number, number];
  /** Å, where voxel 0 is. */
  readonly translation: readonly [number, number, number];
}

export interface NgffMultiscale {
  readonly name?: string;
  /** The array axis of x, y and z: the space axes, always the last three of the array (zarr.md §4). */
  readonly spaceAxes: readonly [number, number, number];
  /** The array's rank: every axis before the space ones must have one element. */
  readonly rank: number;
  /** Finest first, as listed. */
  readonly levels: readonly NgffLevel[];
  readonly warnings: readonly string[];
}

/** The `scale` and `translation` of a `coordinateTransformations` list, per array axis. */
function transforms(list: unknown, rank: number, where: string) {
  let scale: number[] | undefined;
  let translation: number[] | undefined;
  if (list === undefined) return { scale, translation };
  if (!Array.isArray(list)) fail(`${where}: coordinateTransformations is not a list`);
  for (const t of list) {
    if (!isRecord(t)) fail(`${where}: a coordinate transformation is not an object`);
    if (t.type === 'identity') continue;
    if (t.type !== 'scale' && t.type !== 'translation') fail(`${where}: transformation ${JSON.stringify(t.type)}`);
    const v = t[t.type];
    if (!Array.isArray(v) || v.length !== rank || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
      fail(`${where}: ${t.type} is not ${rank} numbers (a 'path' to a file is not read)`);
    }
    if (t.type === 'scale') scale = v;
    else translation = v;
  }
  return { scale, translation };
}

/**
 * Reads the first `multiscales` entry of a parsed `.zattrs` (NGFF 0.4): its 3 space axes, their unit in Å, each
 * level's scale and translation, the multiscale's own transformations applied after the level's.
 */
export function parseNgffMultiscales(json: unknown): NgffMultiscale {
  if (!isRecord(json) || !Array.isArray(json.multiscales) || !json.multiscales.length) {
    fail('.zattrs has no NGFF multiscales');
  }
  const ms = json.multiscales[0];
  if (!isRecord(ms) || !Array.isArray(ms.axes) || !Array.isArray(ms.datasets) || !ms.datasets.length) {
    fail('multiscales[0] has no axes or no datasets');
  }
  const warnings: string[] = [];
  const axes = ms.axes.map((a) =>
    typeof a === 'string' ? { name: a } : isRecord(a) ? a : fail('an axis is not an object'),
  );
  const rank = axes.length;
  const space = axes
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => a.type === 'space' || (a.type === undefined && /^[xyz]$/.test(String(a.name))));
  if (space.length !== 3 || space.some(({ i }, k) => i !== rank - 3 + k)) {
    fail(`3 space axes, the last of the array, are needed (axes: ${axes.map((a) => a.name).join(', ')})`);
  }
  const spaceAxes = [0, 0, 0] as [number, number, number];
  for (const { a, i } of space) {
    const k = ['x', 'y', 'z'].indexOf(String(a.name));
    if (k < 0) fail(`space axis ${JSON.stringify(a.name)} is not x, y or z`);
    spaceAxes[k] = i;
  }
  if (new Set(spaceAxes).size !== 3) fail('the space axes are not x, y and z');

  const units = space.map(({ a }) => a.unit);
  const unit = units[0];
  if (units.some((u) => u !== unit)) fail(`the space axes have different units (${units.join(', ')})`);
  let toAngstrom = 1;
  if (unit === undefined) warnings.push('the space axes have no unit: taken as Å');
  else if (typeof unit === 'string' && unit in Angstroms) toAngstrom = Angstroms[unit];
  else fail(`unit ${JSON.stringify(unit)} is not supported (${Object.keys(Angstroms).join(', ')})`);

  const outer = transforms(ms.coordinateTransformations, rank, 'multiscales[0]');
  const levels = ms.datasets.map((d, li): NgffLevel => {
    if (!isRecord(d) || typeof d.path !== 'string') fail(`dataset ${li} has no path`);
    const inner = transforms(d.coordinateTransformations, rank, `dataset ${d.path}`);
    if (!inner.scale) fail(`dataset ${d.path} has no scale`);
    const scale = [0, 0, 0] as [number, number, number];
    const translation = [0, 0, 0] as [number, number, number];
    for (let k = 0; k < 3; k++) {
      const i = spaceAxes[k];
      const s0 = inner.scale[i];
      const t0 = inner.translation?.[i] ?? 0;
      const s1 = outer.scale?.[i] ?? 1;
      const t1 = outer.translation?.[i] ?? 0;
      scale[k] = s0 * s1 * toAngstrom;
      translation[k] = (t0 * s1 + t1) * toAngstrom;
      if (!(scale[k] > 0)) fail(`dataset ${d.path}: scale ${scale[k]} is not positive`);
    }
    return { path: d.path, scale, translation };
  });
  return { name: typeof ms.name === 'string' ? ms.name : undefined, spaceAxes, rank, levels, warnings };
}
