/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { compileScript } from '@molstar/query-language/compile';
import { parseAtomSpec } from '@molstar/query-language/transpilers/chimerax/parser';
import { MolScriptBuilder as B } from '@molstar/query-language/language/builder';
import type { Expression } from '@molstar/query-language/language/expression';
import { fail, type Span } from './diagnostics.js';
import type { CompileState } from './env.js';
import type { Sel, SelPart } from './ir.js';

// Selections (_spec §4.3): text through query-language, with PyMOL's objects and named selections. Objects are
// structures: a text that names some is compiled once per named object, its name meaning "everything" there and the
// others "nothing", and once for `others` (every structure it names no part for), so each part is plain MolQL on one
// structure. Named selections are inlined when used: a name means what it selected when it was defined.

const All = B.struct.generator.all();
const Empty = B.struct.generator.empty();

type Scope = SelPart['scope'];

/** The part of a selection for a scope: its own, else its `others` (which covers every structure it does not name). */
function partFor(sel: Sel, scope: Scope): Expression {
  if (scope !== 'others') {
    const own = sel.parts.find((p) => p.scope !== 'others' && p.scope.object === scope.object);
    if (own) return own.molql;
  }
  return sel.parts.find((p) => p.scope === 'others')?.molql ?? Empty;
}

const sameObject = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Why a selection did not read: the transpiler's first line. */
function messageOf(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.split('\n')[0];
}

/** A PyMOL selection. `at` is the argument's place, for messages. */
export function pymolSelection(text: string, state: CompileState, at: Span): Sel {
  const source = text.trim();
  if (!source) fail('argument', 'The selection is empty.', at, "Give one: 'all', 'chain A', 'resn HEM'.");
  const referenced: string[] = [];
  const reference = (object: string) => {
    if (!referenced.some((o) => sameObject(o, object))) referenced.push(object);
  };
  const resolveFor = (scope: Scope) => (name: string) => {
    const named = state.name(name);
    if (named) {
      for (const p of named.sel.parts) if (p.scope !== 'others') reference(p.scope.object);
      return partFor(named.sel, scope);
    }
    const object = state.object(name);
    if (object) {
      reference(object.name);
      return scope !== 'others' && sameObject(scope.object, object.name) ? All : Empty;
    }
    return undefined;
  };
  const compile = (scope: Scope) => {
    try {
      return compileScript('pymol', source, { resolveName: resolveFor(scope) });
    } catch (e) {
      const m = messageOf(e);
      const unknown = m.match(/no object or selection named '([^']*)'/);
      if (unknown) {
        const names = [...state.objects.map((o) => o.name), ...state.names.keys()];
        fail(
          'no-name',
          `No object or selection is named '${unknown[1]}'.`,
          at,
          names.length ? `Names: ${names.join(', ')}.` : 'Nothing is loaded or named yet.',
        );
      }
      return fail('selection', `'${source}' does not read as a PyMOL selection: ${m}`, at);
    }
  };
  const others = compile('others');
  const parts: SelPart[] = referenced.map((object) => ({ scope: { object }, molql: compile({ object }) }));
  parts.push({ scope: 'others', molql: others });
  return { text: source, dialect: 'pymol', parts };
}

/** A VMD selection on one molecule (VMD's selections never name molecules: the command does). */
export function vmdSelection(text: string, object: string, at: Span): Sel {
  const source = text.trim();
  if (!source) fail('argument', 'The selection is empty.', at, "Give one: 'all', 'protein', 'resname HEM'.");
  let molql: Expression;
  try {
    molql = compileScript('vmd', source);
  } catch (e) {
    return fail('selection', `'${source}' does not read as a VMD selection: ${messageOf(e)}`, at);
  }
  return {
    text: source,
    dialect: 'vmd',
    parts: [
      { scope: { object }, molql },
      { scope: 'others', molql: Empty },
    ],
  };
}

/** A ChimeraX atom spec read from the start of a command's arguments, with where it ends and its pieces. */
export interface ChimeraxSpec {
  readonly sel: Sel;
  /** Where the spec ends in the text given (the rest is the command's). */
  readonly end: number;
  /** A spec of models side by side (`:12@CA :14@CA`): each piece, in the order written. */
  readonly pieces?: readonly Sel[];
}

/**
 * A ChimeraX atom spec at the start of `text` (_spec §4.3): compiled once per object, its model id deciding the model
 * terms (`#1`, `#2-3`), and once for `others` (no model id: a model term selects nothing there), so each part is plain
 * MolQL on one structure. Named selections and `sel` are the env's names, inlined. An object whose part is the same as
 * `others` gets none. Throws the transpiler's message as a `selection` (or `no-name`) diagnostic at `at`.
 */
export function chimeraxSpec(text: string, state: CompileState, at: Span): ChimeraxSpec {
  const resolveFor = (scope: Scope) => (name: string) => {
    // `sel`: the selection (the viewer's, as the commands before leave it); a built-in name, never a user's.
    if (name === 'sel') return state.selection ? partFor(state.selection, scope) : Empty;
    const named = state.name(name);
    return named ? partFor(named.sel, scope) : undefined;
  };
  const read = (scope: Scope, model: number | undefined) => {
    try {
      return parseAtomSpec(text, { modelId: model === undefined ? [] : [model], resolveName: resolveFor(scope) });
    } catch (e) {
      const m = messageOf(e);
      const unknown = m.match(/^"([^"]*)" is not a selector name/);
      if (unknown) {
        const names = [...state.names.keys()];
        return fail(
          'no-name',
          `'${unknown[1]}' is not an atom spec, a selector or a name.`,
          at,
          names.length ? `Names: ${names.join(', ')}.` : 'Atom specs: #1/A:12-20@CA, protein, ligand, sel.',
        );
      }
      return fail('selection', `'${text.trim().split(/\s/)[0]}' does not read as a ChimeraX atom spec: ${m}`, at);
    }
  };
  const others = read('others', undefined);
  const source = text.slice(0, others.end).trim();
  const own = state.objects
    .filter((o) => o.model !== undefined)
    .map((o) => ({ object: o.name, read: read({ object: o.name }, o.model) }));
  const same = (a: Expression, b: Expression) => JSON.stringify(a) === JSON.stringify(b);
  const selOf = (pick: (r: ReturnType<typeof read>) => Expression, label: string): Sel => ({
    text: label,
    dialect: 'chimerax',
    parts: [
      ...own
        .filter((o) => !same(pick(o.read), pick(others)))
        .map((o): SelPart => ({ scope: { object: o.object }, molql: pick(o.read) })),
      { scope: 'others', molql: pick(others) },
    ],
  });
  const sel = selOf((r) => r.expression, source);
  const n = others.pieces?.length ?? 0;
  const pieces =
    n > 1 && own.every((o) => o.read.pieces?.length === n)
      ? Array.from({ length: n }, (_, i) => selOf((r) => r.pieces![i], `${source} (atom ${i + 1})`))
      : undefined;
  return { sel, end: others.end, ...(pieces ? { pieces } : {}) };
}

type SelOp = (a: Expression, b: Expression) => Expression;

/** Two selections combined per scope: each object either names, and `others`. */
function combine(a: Sel, b: Sel, op: SelOp, text: string): Sel {
  const objects: string[] = [];
  for (const s of [a, b]) {
    for (const p of s.parts) {
      if (p.scope !== 'others' && !objects.some((o) => sameObject(o, (p.scope as { object: string }).object))) {
        objects.push(p.scope.object);
      }
    }
  }
  return {
    text,
    dialect: a.dialect,
    parts: [
      ...objects.map(
        (object): SelPart => ({ scope: { object }, molql: op(partFor(a, { object }), partFor(b, { object })) }),
      ),
      { scope: 'others', molql: op(partFor(a, 'others'), partFor(b, 'others')) },
    ],
  };
}

/** The atoms of both selections. */
export const selAnd = (a: Sel, b: Sel, text = `(${a.text}) & (${b.text})`) =>
  combine(a, b, (x, y) => B.struct.modifier.intersectBy({ 0: x, by: y }), text);

/** The atoms of either selection. */
export const selOr = (a: Sel, b: Sel, text = `${a.text} | ${b.text}`) =>
  combine(a, b, (x, y) => B.struct.combinator.merge([x, y]), text);

/** The atoms of the first selection that are not the second's. */
export const selMinus = (a: Sel, b: Sel, text = `(${a.text}) & ~(${b.text})`) =>
  combine(a, b, (x, y) => B.struct.modifier.exceptBy({ 0: x, by: y }), text);

/**
 * A selection fixed to the objects there are now (a named selection when it is defined): each its part, and nothing
 * for objects loaded later, as PyMOL's names are the atoms they selected.
 */
export function fixedTo(sel: Sel, objects: readonly string[]): Sel {
  return {
    ...sel,
    parts: [
      ...objects.map((object): SelPart => ({ scope: { object }, molql: partFor(sel, { object }) })),
      { scope: 'others', molql: Empty },
    ],
  };
}

/** The MolQL of a selection on one object: what the host evaluates there. */
export function selectionOn(sel: Sel, object: string): Expression {
  return partFor(sel, { object });
}

/** Whether a part is `nothing` for sure (MolQL's empty generator), so the host can skip its structures. */
export function isEmptyPart(molql: Expression): boolean {
  return JSON.stringify(molql) === JSON.stringify(Empty);
}
