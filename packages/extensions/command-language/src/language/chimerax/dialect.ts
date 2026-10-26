/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { fail, nearest, type Span } from '../diagnostics.js';
import type { DialectImpl, Unit } from '../dialect.js';
import { ChimeraxCommands, ChimeraxCommandsByName, compileChimeraxCommand } from './commands.js';
import { ChimeraxCommandOrder, ChimeraxSubcommandOrder, resolveWord } from './names.js';
import { splitChimerax, wordAt } from './tokenizer.js';
import { ChimeraxUnsupportedByName } from './unsupported.js';

// ChimeraX as a dialect (_spec §3.4): its lines split into commands; a command's name is its words as ChimeraX
// resolves them (an abbreviation is the first command, in ChimeraX's order, that starts with it; then the same among
// its subcommands: `sel cl` is `select clear`); then the table, else the list of commands Mol* does not do, else any
// other command ChimeraX has (said to be ChimeraX's), else unknown.

interface ChimeraxUnit extends Unit {
  /** The command's first word as typed (`mol` for ChimeraX's `molmap`). */
  readonly typed: string;
  /** The whole submission: places are offsets into it. */
  readonly text: string;
  /** The command's words' place, and where its arguments start. */
  readonly nameAt: Span;
  readonly args: number;
  /** As typed, when no command of ChimeraX's has it. */
  readonly unknown?: true;
}

/** The command a segment's first words name, as ChimeraX resolves them. */
function commandOf(
  text: string,
  at: Span,
): { name: string; typed: string; nameAt: Span; args: number; unknown?: true } {
  const first = wordAt(text, at.from, at.to)!;
  const typed = first.text;
  const top = resolveWord(first.text, ChimeraxCommandOrder);
  if (!top) return { name: first.text, typed, nameAt: first.at, args: first.at.to, unknown: true };
  const subs = ChimeraxSubcommandOrder[top];
  const second = subs ? wordAt(text, first.at.to, at.to) : undefined;
  const sub = second ? resolveWord(second.text, subs!) : undefined;
  if (second && sub) {
    return { name: `${top} ${sub}`, typed, nameAt: { from: first.at.from, to: second.at.to }, args: second.at.to };
  }
  return { name: top, typed, nameAt: first.at, args: first.at.to };
}

export const ChimeraxDialect: DialectImpl = {
  id: 'chimerax',
  commands: ChimeraxCommands,
  split(text) {
    const { segments, diagnostics } = splitChimerax(text);
    const units: ChimeraxUnit[] = segments.map((s) => ({ ...commandOf(text, s.at), at: s.at, source: s.source, text }));
    return { units, diagnostics };
  },
  includeOf(unit) {
    const u = unit as ChimeraxUnit;
    // `open file.cxc` (and `runscript file.cxc`) runs a script given with the submission.
    if (u.name !== 'open' && u.name !== 'runscript') return undefined;
    const w = wordAt(u.text, u.args, u.at.to);
    if (!w || !/\.cxc$/i.test(w.text) || wordAt(u.text, w.at.to, u.at.to)) return undefined;
    return { name: w.text, at: u.at };
  },
  compile(unit, c) {
    const u = unit as ChimeraxUnit;
    if (u.name === 'help' || u.name === 'usage') {
      const topic = u.text.slice(u.args, u.at.to).trim();
      return [{ kind: 'print', text: helpText(topic, u.nameAt) }];
    }
    const command = ChimeraxCommandsByName.get(u.name);
    if (command) return compileChimeraxCommand(command, u.text, u.args, u.at.to, c);
    if (u.unknown) {
      const near = nearest(u.name, ChimeraxCommandsByName.keys());
      return fail(
        'unknown-command',
        `ChimeraX has no command '${u.name}'.`,
        u.nameAt,
        near ? `Did you mean ${near}?` : '`help` lists the commands.',
      );
    }
    const top = u.name.split(' ')[0];
    // An abbreviation ChimeraX reads as another command than the one meant (`sh` is shape, `mol` molmap): said.
    const read =
      u.typed !== top ? `'${u.typed}' is ChimeraX’s ${u.name} (ChimeraX reads it so): ` : `ChimeraX’s ${u.name}: `;
    const unsupported = ChimeraxUnsupportedByName.get(u.name) ?? ChimeraxUnsupportedByName.get(top);
    if (unsupported) return fail('unsupported', `${read}${unsupported.why}`, u.nameAt, unsupported.hint);
    return fail('unsupported', `${read}not supported.`, u.nameAt, '`help` lists the commands Mol* does.');
  },
};

function helpText(topic: string, at: Span): string {
  if (!topic) {
    const names = ChimeraxCommands.map((c) => c.name);
    return `ChimeraX commands: ${names.join(', ')}. \`help command\` says more; atom specs: #1/A:12-20@CA, protein, ligand :<5, sel.`;
  }
  const c = ChimeraxCommandsByName.get(topic) ?? ChimeraxCommandsByName.get(topic.toLowerCase());
  if (c) return `${c.usage}: ${c.summary}${c.examples.length ? ` Example: ${c.examples[0]}` : ''}`;
  const u = ChimeraxUnsupportedByName.get(topic.toLowerCase());
  if (u) return `${u.name}: ${u.why}${u.hint ? ` ${u.hint}` : ''}`;
  return fail('unknown-command', `ChimeraX has no command '${topic}' here.`, at, '`help` lists the commands.');
}
