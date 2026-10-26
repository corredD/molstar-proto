/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { type Diagnostic, error, type Span } from '../diagnostics.js';

// ChimeraX's command lines (_spec §3.4), as its parser reads them (chimerax/core/commands/cli.py): `;` and newlines
// end a command outside quotes; `#` where a command starts makes the rest of the line a comment (anywhere else it is a
// model, `#1`); a word is a run of characters up to a blank or `;`, or a quoted text, the quote only where a word
// starts (`@O3'` is an atom name).

/** A word of a command: its text (quotes removed), as written, and its place. */
export interface CxWord {
  readonly text: string;
  readonly raw: string;
  readonly at: Span;
}

/** One command, as split: its place, its text, and its first words (the command's name is among them). */
export interface CxSegment {
  readonly at: Span;
  readonly source: string;
}

const isBlank = (c: string | undefined) => c === ' ' || c === '\t' || c === '\r' || c === '\n';

/** Splits a submission into commands: `;` and newlines outside quotes, `#` comments where a command starts. */
export function splitChimerax(text: string): { segments: CxSegment[]; diagnostics: Diagnostic[] } {
  const segments: CxSegment[] = [];
  const diagnostics: Diagnostic[] = [];
  let i = 0;
  while (i < text.length) {
    // The command's start: past blanks (not newlines: an empty line is no command).
    while (i < text.length && isBlank(text[i])) i++;
    if (i >= text.length) break;
    if (text[i] === ';') {
      i++;
      continue;
    }
    if (text[i] === '#') {
      const nl = text.indexOf('\n', i);
      i = nl < 0 ? text.length : nl + 1;
      continue;
    }
    const start = i;
    let quote: string | undefined;
    let quoteAt = 0;
    for (; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === quote) quote = undefined;
        else if (c === '\n') {
          diagnostics.push(error('syntax', 'The quote is not closed on its line.', { from: quoteAt, to: i }));
          quote = undefined;
          break;
        }
        continue;
      }
      if (c === ';' || c === '\n') break;
      if ((c === '"' || c === "'") && (i === start || isBlank(text[i - 1]))) {
        quote = c;
        quoteAt = i;
      }
    }
    if (quote) diagnostics.push(error('syntax', 'The quote is not closed.', { from: quoteAt, to: i }));
    let end = i;
    while (end > start && isBlank(text[end - 1])) end--;
    segments.push({ at: { from: start, to: end }, source: text.slice(start, end) });
    if (i < text.length) i++;
  }
  return { segments, diagnostics };
}

/** The word at `from` in `text` (blanks skipped first), or undefined at the end; `limit` ends the text. */
export function wordAt(text: string, from: number, limit = text.length): CxWord | undefined {
  let i = from;
  while (i < limit && isBlank(text[i])) i++;
  if (i >= limit || text[i] === ';') return undefined;
  const start = i;
  const q = text[i];
  if (q === '"' || q === "'") {
    const close = text.indexOf(q, i + 1);
    const end = close < 0 || close >= limit ? limit : close + 1;
    const inner = text.slice(i + 1, close < 0 || close >= limit ? limit : close);
    return { text: inner, raw: text.slice(start, end), at: { from: start, to: end } };
  }
  while (i < limit && !isBlank(text[i]) && text[i] !== ';') i++;
  return { text: text.slice(start, i), raw: text.slice(start, i), at: { from: start, to: i } };
}

/** Every word of `text` between `from` and `limit`. */
export function wordsOf(text: string, from: number, limit = text.length): CxWord[] {
  const out: CxWord[] = [];
  for (let w = wordAt(text, from, limit); w; w = wordAt(text, w.at.to, limit)) out.push(w);
  return out;
}
