/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { AtomStyle, Command, Sel, VmdRep } from './ir.js';
import { VmdColorIds } from './colors.js';
import { selMinus, selOr } from './selection.js';

// What names mean (_spec §4.3, §5): the host's objects (structures) and the session's names, molecule ids and VMD's rep
// defaults, read once a submission. The compiler works on a copy that each command it compiles updates, so a later
// command sees an earlier one's names before anything runs (`fetch 1cbs; select a, /1cbs//A`), and the menu's preview
// of a line reads the same as its run.

/** A structure, as commands name it. */
export interface ObjectInfo {
  /** Its object name (PyMOL's `1cbs`): unique among the objects. */
  readonly name: string;
  /** Its VMD molecule id. */
  readonly molecule: number;
  /** Its ChimeraX model id (`#1`): given at load, the lowest free (ChimeraX reuses a closed model's id). */
  readonly model?: number;
  /** For completion: its chains (author ids) and the residue names of its ligands. */
  readonly chains?: readonly string[];
  readonly ligands?: readonly string[];
}

export interface ScriptEnv {
  /** The objects, in load order. */
  readonly objects: readonly ObjectInfo[];
  /** The named selections. */
  readonly names: ReadonlyMap<string, Sel>;
  /** VMD's top molecule, by object name. */
  readonly top?: string;
  /** What VMD's next `mol addrep` takes. */
  readonly repDefaults: VmdRep;
  /** The id the next loaded molecule gets. */
  readonly nextMolecule: number;
  /** The files given with the submission, by name (`load file.pdb`, `@script.pml`). */
  readonly files: readonly string[];
  /** The texts of the scripts among them, by name (what `@file.pml` and `source file.tcl` run). */
  readonly scripts?: ReadonlyMap<string, string>;
  /** The viewer's selection now (ChimeraX's `sel`): each structure's selected atoms. */
  readonly selection?: Sel;
  /** ChimeraX's atom styles set with `style`, oldest first, the last one an atom is in winning; others: stick. */
  readonly atomStyles?: readonly AtomStyleEntry[];
}

/** One `style` command's atoms (fixed to the objects there were) and their style. */
export interface AtomStyleEntry {
  readonly style: AtomStyle;
  readonly sel: Sel;
}

/** VMD's defaults for a new rep: Lines, `all`, colored by Name (VMD's own). */
export const DefaultVmdRep: VmdRep = {
  style: 'lines',
  color: { theme: 'element-symbol', params: { palette: 'vmd' } },
  selection: 'all',
  material: 'opaque',
};

export const EmptyEnv: ScriptEnv = {
  objects: [],
  names: new Map(),
  repDefaults: DefaultVmdRep,
  nextMolecule: 0,
  files: [],
};

/** A VMD atom selection made with `atomselect`: its molecule and selection, used as `$sel …`. */
export interface AtomSelectHandle {
  readonly object: string;
  readonly text: string;
  readonly sel: Sel;
}

/**
 * What a console keeps between its submissions that is not the viewer's state (not undone, not saved, as in VMD):
 * Tcl variables and atomselect handles.
 */
export interface ScriptSession {
  readonly vars: Map<string, string>;
  readonly handles: Map<string, AtomSelectHandle>;
  nextHandle: number;
}

export function createScriptSession(): ScriptSession {
  return { vars: new Map(), handles: new Map(), nextHandle: 0 };
}

/** The compiler's working copy of the env, updated by each command it compiles. */
export class CompileState {
  objects: ObjectInfo[];
  readonly names: Map<string, Sel>;
  top: string | undefined;
  repDefaults: VmdRep;
  nextMolecule: number;
  readonly files: readonly string[];
  readonly scripts: ReadonlyMap<string, string>;
  readonly session: ScriptSession;
  atomStyles: readonly AtomStyleEntry[];
  /** The selection as the commands compiled so far leave it (`sel`); undefined: nothing selected. */
  selection: Sel | undefined;

  constructor(env: ScriptEnv, session: ScriptSession = createScriptSession()) {
    this.objects = [...env.objects];
    this.names = new Map(env.names);
    this.top = env.top;
    this.repDefaults = env.repDefaults;
    this.nextMolecule = env.nextMolecule;
    this.files = env.files;
    this.scripts = env.scripts ?? new Map();
    this.session = session;
    this.atomStyles = env.atomStyles ?? [];
    this.selection = env.selection;
  }

  /** The ChimeraX model id the next opened structure takes: the lowest no object has, from 1. */
  nextModel(): number {
    const used = new Set(this.objects.map((o) => o.model));
    let id = 1;
    while (used.has(id)) id++;
    return id;
  }

  /** An object by its ChimeraX model id. */
  model(id: number): ObjectInfo | undefined {
    return this.objects.find((o) => o.model === id);
  }

  /** An object by name, case-insensitive (PyMOL's names are). */
  object(name: string): ObjectInfo | undefined {
    const exact = this.objects.find((o) => o.name === name);
    if (exact) return exact;
    const lower = name.toLowerCase();
    return this.objects.find((o) => o.name.toLowerCase() === lower);
  }

  /** A named selection by name, case-insensitive. */
  name(name: string): { readonly name: string; readonly sel: Sel } | undefined {
    const exact = this.names.get(name);
    if (exact) return { name, sel: exact };
    const lower = name.toLowerCase();
    for (const [k, sel] of this.names) if (k.toLowerCase() === lower) return { name: k, sel };
    return undefined;
  }

  /** A script given with the submission, by its name or the last part of its path. */
  script(name: string): { readonly name: string; readonly text: string } | undefined {
    const text = this.scripts.get(name);
    if (text !== undefined) return { name, text };
    const base = name.split(/[\\/]/).pop();
    for (const [k, v] of this.scripts) if (k.split(/[\\/]/).pop() === base) return { name: k, text: v };
    return undefined;
  }

  /** A VMD molecule by id, or `top`. */
  molecule(id: string): ObjectInfo | undefined {
    if (id === 'top') return this.top ? this.object(this.top) : this.objects[this.objects.length - 1];
    if (!/^\d+$/.test(id)) return undefined;
    const n = Number(id);
    return this.objects.find((o) => o.molecule === n);
  }

  /** An unused object name from a wish (`1cbs`, then `1cbs_2`). */
  freeName(wish: string): string {
    const base = wish.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'obj';
    if (!this.object(base) && !this.name(base)) return base;
    for (let i = 2; ; i++) {
      const n = `${base}_${i}`;
      if (!this.object(n) && !this.name(n)) return n;
    }
  }

  /** What a compiled command means for the names after it. */
  apply(cmd: Command): void {
    switch (cmd.kind) {
      case 'load':
        this.objects = [
          ...this.objects,
          { name: cmd.name, molecule: cmd.molecule, ...(cmd.model !== undefined ? { model: cmd.model } : {}) },
        ];
        this.nextMolecule = Math.max(this.nextMolecule, cmd.molecule + 1);
        if (cmd.look === 'vmd-lines') this.top = cmd.name;
        break;
      case 'object.remove': {
        const gone = cmd.objects === 'all' ? undefined : new Set(cmd.objects.map((o) => o.toLowerCase()));
        this.objects = gone ? this.objects.filter((o) => !gone.has(o.name.toLowerCase())) : [];
        if (this.top && (!gone || gone.has(this.top.toLowerCase()))) this.top = undefined;
        break;
      }
      case 'object.top':
        this.top = cmd.object;
        break;
      case 'name.set':
        this.names.set(cmd.name, cmd.sel);
        break;
      case 'name.remove':
        if (cmd.names === 'all') this.names.clear();
        else for (const n of cmd.names) this.names.delete(n);
        break;
      case 'rep.defaults':
        this.repDefaults = { ...this.repDefaults, ...cmd.patch };
        break;
      case 'select':
        this.selection =
          cmd.mode === 'set' || !this.selection
            ? cmd.mode === 'remove'
              ? undefined
              : cmd.sel
            : cmd.mode === 'add'
              ? selOr(this.selection, cmd.sel)
              : selMinus(this.selection, cmd.sel);
        break;
      case 'select.clear':
        this.selection = undefined;
        break;
      case 'atom-style':
        this.atomStyles = nextAtomStyles(this.atomStyles, { style: cmd.style, sel: cmd.sel });
        break;
    }
  }
}

/** Styles kept at most: past it, the oldest go (a long session's styles stay a few selections). */
export const MaxAtomStyles = 16;

/**
 * The styles after a `style` command: a style of every atom (`style ball`) starts the list again, and stick on every
 * atom (the default) empties it.
 */
export function nextAtomStyles(list: readonly AtomStyleEntry[], entry: AtomStyleEntry): readonly AtomStyleEntry[] {
  if (entry.sel.text === 'all') return entry.style === 'sticks' ? [] : [entry];
  const next = [...list, entry];
  return next.length > MaxAtomStyles ? next.slice(next.length - MaxAtomStyles) : next;
}

/** VMD's ColorID names, for messages and completion. */
export const VmdColorNames = Object.keys(VmdColorIds);
