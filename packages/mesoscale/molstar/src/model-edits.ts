/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { MesoViewSpecDoc, Patch, PatchNode } from '@molstar/meso-spec/format';
import { PatchFormat } from '@molstar/meso-spec/format';

// The model edits of Built by (prism.md §4.3, §12.2 lane 6) as patches over the document. Each says what to write, or
// why it will not (`refused`, in words for the person), or nothing when the document is already so. A refused edit
// never becomes a patch; the validation judges the rest (a patch it refuses changes nothing: prism.md §2.1).

export interface ModelEdit {
  readonly patch?: Patch;
  readonly refused?: string;
}

const patchOf = (...ops: Patch['ops'][number][]): Patch => ({ format: PatchFormat, ops });
const whole = (n: number) => Number.isInteger(n);

/** A population's number of copies: `abundance.count`. Another kind of abundance is the document's to change. */
export function countPatch(doc: MesoViewSpecDoc, population: string, count: number): ModelEdit {
  const p = doc.populations.find((x) => x.id === population);
  if (!p) return { refused: `There is no population ${population}.` };
  if (!whole(count)) return { refused: 'A count is a whole number.' };
  if (count < 0) return { refused: 'A count is 0 or more.' };
  const a = p.abundance as unknown as Record<string, unknown>;
  if (!('count' in a)) {
    const kind = Object.keys(a).find((k) => k !== 'range' && k !== 'unit') ?? 'another kind';
    return { refused: `${p.id} is given by its ${kind === 'volumeFraction' ? 'volume fraction' : kind}, not a count.` };
  }
  if (a.count === count) return {};
  return { patch: patchOf({ op: 'set', id: p.id, fields: { abundance: { ...a, count } } }) };
}

/** A model's seed: the random start of its resolver (a whole number, 0 or more; the runtime's default is 1). */
export function seedPatch(doc: MesoViewSpecDoc, model: string, seed: number): ModelEdit {
  const m = doc.models?.find((x) => x.id === model);
  if (!m) return { refused: `There is no model ${model}.` };
  if (!whole(seed) || seed < 0) return { refused: 'A seed is a whole number, 0 or more.' };
  if ((m.seed ?? 1) === seed) return {};
  return { patch: patchOf({ op: 'set', id: m.id, fields: { seed } }) };
}

/** What a relax stage starts with (the exosome example's: _spec/runtime.md, refine stages). */
const RelaxParams = { iterations: 400, tolerance: 1 };

/**
 * A `meso.relax` refine stage after a model (_spec/runtime.md): it inserts the copies still missing and relaxes
 * overlaps, replacing the model's result. A model has at most one refiner (a stage can have its own), and a precomputed
 * model has nothing to refine.
 */
export function relaxPatch(doc: MesoViewSpecDoc, model: string): ModelEdit {
  const models = doc.models ?? [];
  const m = models.find((x) => x.id === model);
  if (!m) return { refused: `There is no model ${model}.` };
  if (m.kind === 'precomputed') return { refused: `${m.id} is precomputed: there is nothing to relax.` };
  if (m.method === 'meso.relax') return { refused: `${m.id} is already a relax stage.` };
  const by = models.find((x) => x.refines === model);
  if (by) return { refused: `${m.id} is already refined by ${by.id}.` };
  const taken = new Set(models.map((x) => x.id));
  let id = 'm.relax';
  for (let n = 2; taken.has(id); n++) id = `m.relax.${n}`;
  const node: PatchNode = {
    id,
    label: 'packing relaxed',
    kind: 'procedural',
    method: 'meso.relax',
    refines: model,
    populations: [],
    params: { ...RelaxParams },
  };
  return { patch: patchOf({ op: 'insert', node, parent: 'models', after: 'last' }) };
}
