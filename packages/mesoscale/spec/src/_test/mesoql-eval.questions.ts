/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { betaCellDoc, BetaCellResources } from '../examples/betacell.js';
import type { MesoViewSpecDoc } from '../format/doc.js';
import { parseMesoQL } from '../format/mesoql.js';
import { indexDoc } from '../format/validate.js';
import type { IR } from '../ir/ir.js';
import { evaluateMesoQL, type MesoLoci, unionRuns } from '../ir/loci.js';
import { DefaultResolvers } from '../resolvers/index.js';
import { compile } from '../runtime/runtime.js';

// The quick-lane eval of the MesoQL skill (packages/mesoscale/_spec/reference/mesoql-skill.md): plain-English questions
// about the β-cell, each with one expected address in canonical text (as printMesoQL prints it). An agent given the
// skill and the scene's ids answers each; `answerMatches` grades the answer by what it picks, so an equivalent spelling
// passes. No β-cell entity has `sites` or a structure, so no question asks for a site or residues.

export interface MesoQLEvalQuestion {
  readonly ask: string;
  readonly expect: string;
  /** A plausible wrong answer: it must pick other copies, or the question tests nothing. */
  readonly near?: string;
}

export const MesoQLEvalQuestions: readonly MesoQLEvalQuestion[] = [
  { ask: 'Show me all the ribosomes.', expect: '(population p.ribosomes)' },
  {
    ask: 'Highlight every insulin secretory granule, the packed ones and the two stated by id.',
    expect: '(entity e.granule)',
    near: '(population p.granules)',
  },
  {
    ask: 'Show the membrane proteins of the granule compartment.',
    expect: '(in c.isg :location membrane)',
    near: '(in c.isg)',
  },
  {
    ask: 'Show the first five packed granules (ordinals 0 to 4).',
    expect: '(copies p.granules 0 5)',
    near: '(copies p.granules 0 4)',
  },
  { ask: 'Show me the docked granule.', expect: '(instance i.granule-docked)', near: '(population p.granules)' },
  {
    ask: 'Of the copies in the granule compartment, keep only those of the Vamp2 entity.',
    expect: '(and (entity e.Vamp2) (in c.isg))',
  },
  { ask: 'Show the granule cargo, Chga and Scg2, together.', expect: '(or (population p.Chga) (population p.Scg2))' },
  {
    ask: 'Of the copies in the granule compartment, leave out the Vamp2 and Rab3a proteins.',
    expect: '(not (population p.Vamp2 p.Rab3a) :in (in c.isg))',
    near: '(not (population p.Vamp2 p.Rab3a))',
  },
  {
    ask: 'Which ribosomes are within 250 nm of granule 12?',
    expect: '(within (population p.ribosomes) :of (copies p.granules 12) :distance 250)',
    near: '(population p.ribosomes)',
  },
  {
    ask: 'Show me the Vamp2 on granule 12.',
    expect: '(part (copies p.granules 12) p.Vamp2)',
    near: '(population p.Vamp2)',
  },
];

/** The compiled β-cell the questions are asked of, and the ids an address is checked against. */
export interface MesoQLEvalScene {
  readonly doc: MesoViewSpecDoc;
  readonly ir: IR;
  readonly kinds: ReadonlyMap<string, string>;
}

/** The β-cell with `granules` packed granules (granule 12 must exist), compiled. */
export async function mesoQLEvalScene(granules = 20): Promise<MesoQLEvalScene> {
  const doc = betaCellDoc(granules);
  const r = await compile(doc, { resolvers: DefaultResolvers, load: (id) => BetaCellResources[id]?.() });
  if (!r.ir) throw new Error(`the β-cell did not compile: ${r.issues.map((i) => i.code).join(', ')}`);
  return { doc, ir: r.ir, kinds: indexDoc(doc).kinds };
}

/** The loci an address picks in the scene, normalized (no empty sets, touching runs merged); undefined if it fails. */
export function evalLoci(text: string, scene: MesoQLEvalScene): MesoLoci | undefined {
  const p = parseMesoQL(text, { kinds: scene.kinds }, undefined, 'selection');
  if (!p.expr || p.issues.length) return undefined;
  const e = evaluateMesoQL(p.expr, { doc: scene.doc, ir: scene.ir });
  if (e.issues.some((i) => i.severity === 'error')) return undefined;
  const out = new Map<string, readonly number[]>();
  for (const [k, r] of e.loci.copies) if (r.length) out.set(k, unionRuns(r, []));
  return { copies: out };
}

/**
 * An agent's answer against the expected address: equal when both pick the same copies (same sets, same runs). The
 * answer may be wrapped in one [MesoQL]...[/MesoQL] block, as the skill asks; an answer that does not parse is wrong.
 */
export function answerMatches(answer: string, expect: string, scene: MesoQLEvalScene): boolean {
  const blocks = [...answer.matchAll(/\[MesoQL\]([\s\S]*?)\[\/MesoQL\]/g)];
  if (blocks.length > 1) return false;
  const a = evalLoci(blocks.length ? blocks[0][1] : answer, scene);
  const b = evalLoci(expect, scene);
  if (!a || !b || a.copies.size !== b.copies.size) return false;
  for (const [k, r] of b.copies) {
    const x = a.copies.get(k);
    if (!x || x.length !== r.length || x.some((v, i) => v !== r[i])) return false;
  }
  return true;
}
