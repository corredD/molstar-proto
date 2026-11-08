/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// Content hashes (design.md §7.2): canonical JSON (sorted keys, typed arrays by content) through two FNV-1a 32-bit
// streams, 16 hex digits. Used for resolution keys: equal inputs, equal keys, no work (as MolViewSpec's params-hash
// versions, `jsonHash` in packages/mvs/runtime, and mol-state's `StateTransform.setParamsHashVersion`).

export function canonicalJson(value: unknown): string {
  const out: string[] = [];
  write(value, out);
  return out.join('');
}

function write(v: unknown, out: string[]) {
  if (v === null || v === undefined) return void out.push('null');
  if (typeof v === 'number') return void out.push(Number.isFinite(v) ? String(v) : 'null');
  if (typeof v === 'string' || typeof v === 'boolean') return void out.push(JSON.stringify(v));
  if (ArrayBuffer.isView(v)) {
    // typed arrays by content digest, not by element: a million-copy obstacle set stays cheap to key
    const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    return void out.push(`"#${v.constructor.name}:${v.byteLength}:${hashBytes(bytes)}"`);
  }
  if (Array.isArray(v)) {
    out.push('[');
    for (let i = 0; i < v.length; i++) {
      if (i) out.push(',');
      write(v[i], out);
    }
    return void out.push(']');
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v as object)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort();
    out.push('{');
    keys.forEach((k, i) => {
      if (i) out.push(',');
      out.push(JSON.stringify(k), ':');
      write((v as Record<string, unknown>)[k], out);
    });
    return void out.push('}');
  }
  out.push('null');
}

function hashBytes(bytes: Uint8Array): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < bytes.length; i++) {
    a = Math.imul(a ^ bytes[i], 0x01000193);
    b = Math.imul(b ^ bytes[i], 0x5bd1e995);
  }
  return hex(a) + hex(b);
}

function hex(n: number) {
  return (n >>> 0).toString(16).padStart(8, '0');
}

export function hashString(s: string): string {
  return hashBytes(new TextEncoder().encode(s));
}

export function contentHash(value: unknown): string {
  return hashString(canonicalJson(value));
}
