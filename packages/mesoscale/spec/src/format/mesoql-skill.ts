/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { MesoQLSymbols, type QSymbol } from './mesoql.js';

// The MesoQL skill (design.md §3.8, §12.1): the text an agent is given to write addresses, generated from the symbol
// table as SeqQL's is (packages/sequences/core/src/query/skill.ts), never edited by hand. The committed copy is
// packages/mesoscale/_spec/reference/mesoql-skill.md; a test keeps it equal to this text. No `node:` imports: the viewer's
// agent loads it too.

const RefInitial: Record<string, string> = {
  population: 'p',
  instance: 'i',
  entity: 'e',
  compartment: 'c',
  model: 'm',
  superstructure: 's',
};

const KeywordValue = { selection: 'Q', bool: 'b', number: 'n', length: 'd' } as const;

/** A symbol's signature from the table: `(in c c... :nested b :location L)`, `(copies p start count?)`. */
export function mesoQLSignature(s: QSymbol): string {
  const args = s.args.map((a) => {
    const w =
      a.kind === 'id' ? (RefInitial[a.ref ?? ''] ?? a.name) : a.kind === 'int' || a.kind === 'word' ? a.name : 'Q';
    return a.rest ? `${w} ${w}...` : a.optional ? `${w}?` : w;
  });
  const keywords = Object.entries(s.keywords ?? {}).map(
    ([k, t]) => `:${k} ${t === 'word' || t === 'range' ? k[0].toUpperCase() : KeywordValue[t]}`,
  );
  return `(${[s.name, ...args, ...keywords].join(' ')})`;
}

/** Compositions the symbols' own examples do not show; each parses (a test checks it against the β-cell's ids). */
export const MesoQLComposed: readonly { readonly text: string; readonly says: string }[] = [
  { text: '(and (entity e.Vamp2) (in c.cell))', says: 'the Vamp2 copies in the cell' },
  { text: '(not (entity e.ribosome) :in (in c.cell))', says: 'everything in the cell but ribosomes' },
  {
    text: '(within (population p.ribosomes) :of (copies p.granules 12) :distance 250)',
    says: 'ribosomes near granule 12',
  },
  { text: '(or (population p.Vamp2) (population p.Rab3a))', says: 'two proteins together' },
  { text: '(part (copies p.granules 0 5) p.Chga)', says: 'Chga in the first five granules' },
  { text: '(in c.cell :nested false)', says: 'the cell itself, not what is inside its compartments' },
];

/** What each `mesoql.*` code means, in the order the skill lists them. */
export const MesoQLIssueCodes: readonly { readonly code: string; readonly says: string }[] = [
  { code: 'mesoql.syntax', says: 'not readable: unbalanced parentheses, an unclosed quote' },
  { code: 'mesoql.form', says: 'not a form like (entity e.x)' },
  { code: 'mesoql.symbol.unknown', says: 'no such symbol; the message suggests near ones' },
  { code: 'mesoql.type', says: 'a selection, a site or residues where another is expected' },
  {
    code: 'mesoql.keyword',
    says: 'a keyword the symbol does not take, given twice, with no value or a value of the wrong type',
  },
  { code: 'mesoql.range', says: 'a label range is like 53-63' },
  { code: 'mesoql.arity', says: 'too many or too few arguments' },
  { code: 'mesoql.argument', says: 'an argument of the wrong type (a number for an id)' },
  { code: 'mesoql.ref.missing', says: 'an id names nothing in the document' },
  { code: 'mesoql.ref.kind', says: 'an id names a node of another kind (an entity where a population goes)' },
  { code: 'mesoql.site', says: 'the entity has no site of that name; the message lists its sites' },
  { code: 'mesoql.empty', says: 'a warning: the address is fine but picks nothing in this resolution' },
];

export interface MesoQLSkillOptions {
  /** The host's line naming the scene's ids (`Ids: p.catalase (a population), e.ALB (an entity), c.exosome ...`). */
  readonly ids?: string;
}

const line = (s: QSymbol) => `${mesoQLSignature(s)}  ${s.description}`;
const takesSelection = (s: QSymbol) =>
  s.args.some((a) => a.kind === 'selection') || Object.values(s.keywords ?? {}).includes('selection');

export function mesoQLSkill(opts: MesoQLSkillOptions = {}): string {
  const selects = MesoQLSymbols.filter((s) => s.returns === 'selection' && !takesSelection(s));
  const combines = MesoQLSymbols.filter((s) => s.returns === 'selection' && takesSelection(s));
  const others = MesoQLSymbols.filter((s) => s.returns !== 'selection');
  return [
    'MESOSCALE ADDRESSES (MesoQL)',
    '',
    'An address picks copies in a mesoscale scene: the copies of a population, the ones in a compartment, the ones near',
    'others. Write one S-expression with the ids of the scene document: (name argument... :keyword value ...). Words',
    'need no quotes; ; starts a comment.',
    '',
    'Wrap each address in [MesoQL]...[/MesoQL] and send each in its own block: several blocks are several addresses,',
    "and text around them is fine. An address passed as a tool's argument takes no tags.",
    '',
    ...(opts.ids ? [opts.ids, ''] : []),
    'THE SLOT SETS THE TYPE',
    "A selection goes in a look's select, a view's selection and cutaway, a camera's focus, an annotation's target.",
    "A site goes in a relation's entry and exit. Residues go in a site's at and a contact's a and b.",
    '',
    'COPY IDS',
    'A copy is <population>#<ordinal> (p.granules#12); inside a part, <instance copy>/<population>#<ordinal>',
    '(p.granules#12/p.Vamp2#3). (copies p start count) counts ordinals and holds for one resolution; (instance i) names',
    'the same copy every time.',
    '',
    'PATTERNS',
    'Narrow by intersecting: (and (entity e) (in c)); remove with (not Q :in U), U defaults to every copy.',
    '(in c) takes the compartments inside c too: :nested false stops at c. :location membrane or interior narrows it.',
    "(within Q :of Q2 :distance d) measures centre to centre, d in the document's length unit.",
    "(part Q p.inner) picks an inner population in the superstructure instances Q picks (a virus's capsid proteins).",
    'A site and residues belong in their slots only; they pick no copies.',
    '',
    'SELECT',
    ...selects.map(line),
    '',
    'COMBINE',
    ...combines.map(line),
    '',
    'SITES AND RESIDUES',
    ...others.map(line),
    '',
    'EXAMPLES',
    'Ids in the examples are illustrative; use the ids you were given.',
    ...MesoQLSymbols.map((s) => `${s.example}  ${s.description}`),
    ...MesoQLComposed.map((c) => `${c.text}  ${c.says}`),
    '',
    'RESULTS AND ERRORS',
    'A query reports its canonical address, the number of copies, the count per population and the first copy ids: check',
    'them against the question. An error names the part that is wrong; fix it and resend the corrected address.',
    ...MesoQLIssueCodes.map((c) => `${c.code}  ${c.says}`),
    '',
  ].join('\n');
}

/** The committed file's text: Seq*'s wrapper around the skill. */
export const mesoQLSkillFile = (): string =>
  `# MesoQL skill\n\nGenerated from the symbol table; do not edit.\n\n\`\`\`text\n${mesoQLSkill()}\`\`\`\n`;
