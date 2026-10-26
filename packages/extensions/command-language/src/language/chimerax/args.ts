/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { fail, nearest, type Span, warning } from '../diagnostics.js';
import type { Sel } from '../ir.js';
import { type ChimeraxSpec, chimeraxSpec } from '../selection.js';
import type { Compiler, ParamSpec } from '../table.js';
import { ChimeraxColors, chimeraxColor, MaxColorWords } from './colors.js';
import { type CxWord, wordAt } from './tokenizer.js';

// A ChimeraX command's arguments (_spec §3.4), read as ChimeraX's parser reads them (cli.py): its positional
// arguments in order, an optional one tried and skipped when it does not read, none read where a keyword starts (a
// word starting with a letter that begins one of the command's keywords); then keyword and value pairs. A keyword may
// be shortened while it stays one keyword; typed in lower case it matches any case (`bgcolor`, `bgColor`). An atom
// spec reads as far as it can (`parseAtomSpec`), so `color /A :12 red` is the spec `/A :12` and the color `red`.

/** A keyword the command takes: its kind, and the words of an `enum`. */
export interface KeywordSpec {
  readonly kind: ParamSpec['kind'];
  readonly values?: readonly string[];
  /** A keyword that takes no value (ChimeraX's `NoArg`: `show … only`): given is true. */
  readonly flag?: true;
}

export type Keywords = Readonly<Record<string, KeywordSpec>>;

/** A keyword's value, as given. */
export interface KwValue {
  readonly keyword: string;
  readonly word: CxWord;
  /** A spec value's selection (`to #2`, `toAtoms #2@CA`). */
  readonly sel?: Sel;
}

const isLetter = (c: string | undefined) => !!c && /[A-Za-z]/.test(c);

/** The keyword a typed word names, as ChimeraX matches one, or the candidates when it names several. */
function matchKeyword(word: string, keywords: readonly string[]): string | readonly string[] | undefined {
  if (keywords.includes(word)) return word;
  const lower = word.toLowerCase() === word;
  const found = keywords.filter((k) => k.startsWith(word) || (lower && k.toLowerCase().startsWith(word)));
  if (found.length === 1) return found[0];
  const exact = found.find((k) => k.toLowerCase() === word.toLowerCase());
  if (exact) return exact;
  return found.length ? found : undefined;
}

export class ChimeraxArgs {
  /** Where the next argument starts in `text`. */
  i: number;
  readonly #keywords: readonly string[];
  readonly #values = new Map<string, KwValue>();
  #rest = false;
  /** Why the last optional spec that was tried did not read, and where: said if nothing else reads its text. */
  #specFailure: { readonly error: unknown; readonly from: number } | undefined;

  constructor(
    /** The whole submission: places are offsets into it. */
    readonly src: string,
    /** Where the arguments start and the command ends. */
    from: number,
    readonly end: number,
    /** The command's name as ChimeraX knows it (`color bfactor`). */
    readonly name: string,
    readonly keywords: Keywords,
    readonly c: Compiler,
    /** Keywords ChimeraX takes that change nothing here, with what to say (a warning when given). */
    readonly ignored: Readonly<Record<string, string>> = {},
  ) {
    this.i = from;
    this.#keywords = [...Object.keys(keywords), ...Object.keys(ignored)];
  }

  /** The place of what is left (or of the command's end). */
  get here(): Span {
    const w = this.peek();
    return w ? w.at : { from: this.end, to: this.end };
  }

  peek(): CxWord | undefined {
    return wordAt(this.src, this.i, this.end);
  }

  atEnd(): boolean {
    return !this.peek();
  }

  /** Whether the next word starts a keyword: positional arguments end there. */
  atKeyword(): boolean {
    const w = this.peek();
    if (!w || !isLetter(w.raw[0])) return false;
    return matchKeyword(w.text, this.#keywords) !== undefined;
  }

  /** The next word, consumed, unless it is a keyword's or there is none. */
  word(): CxWord | undefined {
    if (this.atKeyword()) return undefined;
    const w = this.peek();
    if (w) this.i = w.at.to;
    return w;
  }

  /** An optional atom spec (`objects`): undefined when none reads here (the text stays for what comes next). */
  spec(): ChimeraxSpec | undefined {
    const w = this.peek();
    if (!w || this.atKeyword()) return undefined;
    try {
      const s = chimeraxSpec(this.src.slice(w.at.from, this.end), this.c.state, { from: w.at.from, to: this.end });
      this.i = w.at.from + s.end;
      this.#specFailure = undefined;
      return s;
    } catch (e) {
      this.#specFailure = { error: e, from: w.at.from };
      return undefined;
    }
  }

  /** A spec the command needs: its error said here when none reads. */
  requiredSpec(what = 'an atom spec'): ChimeraxSpec {
    const w = this.peek();
    if (!w) return fail('argument', `${this.name} needs ${what}.`, this.here, 'Give one: #1, /A:12-20, ligand, sel.');
    const s = chimeraxSpec(this.src.slice(w.at.from, this.end), this.c.state, { from: w.at.from, to: this.end });
    this.i = w.at.from + s.end;
    return s;
  }

  /** An enum word (shortened as ChimeraX allows: the first of the words that starts with it), or undefined. */
  choice(values: readonly string[]): { value: string; at: Span } | undefined {
    const w = this.peek();
    if (!w || this.atKeyword()) return undefined;
    const t = w.text.toLowerCase();
    const value = values.find((v) => v.toLowerCase() === t) ?? values.find((v) => v.toLowerCase().startsWith(t));
    if (!value || !t) return undefined;
    this.i = w.at.to;
    return { value, at: w.at };
  }

  /** A comma-separated list of enum words (`atoms,cartoons`), or undefined. */
  choices(values: readonly string[]): { values: string[]; at: Span } | undefined {
    const w = this.peek();
    if (!w || this.atKeyword()) return undefined;
    const out: string[] = [];
    for (const part of w.text.split(',')) {
      const t = part.toLowerCase();
      const v = values.find((x) => x.toLowerCase() === t) ?? values.find((x) => x.toLowerCase().startsWith(t));
      if (!v || !t) return undefined;
      out.push(v);
    }
    this.i = w.at.to;
    return { values: out, at: w.at };
  }

  /** An optional number, or undefined when the next word is none. */
  number(): { value: number; at: Span } | undefined {
    const w = this.peek();
    if (!w || this.atKeyword()) return undefined;
    const v = Number(w.text);
    if (w.text === '' || !Number.isFinite(v)) return undefined;
    this.i = w.at.to;
    return { value: v, at: w.at };
  }

  /** An optional color (a name of up to its words, `cornflower blue`), or undefined. */
  color(): { value: number; text: string; at: Span } | undefined {
    const w = this.peek();
    if (!w || this.atKeyword()) return undefined;
    // The longest run of words that names a color, as ChimeraX's color names may have blanks.
    let words = [w];
    for (let k = 1; k < MaxColorWords; k++) {
      const next = wordAt(this.src, words[words.length - 1].at.to, this.end);
      if (!next) break;
      words = [...words, next];
    }
    for (let k = words.length; k >= 1; k--) {
      const text = words
        .slice(0, k)
        .map((x) => x.text)
        .join(' ');
      const value = k > 1 ? ChimeraxColors.get(text.toLowerCase()) : chimeraxColor(text);
      if (value !== undefined) {
        const at = { from: w.at.from, to: words[k - 1].at.to };
        this.i = at.to;
        return { value, text, at };
      }
    }
    return undefined;
  }

  /**
   * The keyword and value pairs to the end, each value read by its keyword's kind; then nothing may be left. A word
   * that is no keyword is an error that says what the command takes (or why the spec it may be did not read).
   */
  rest(): void {
    if (this.#rest) return;
    this.#rest = true;
    for (let w = this.peek(); w; w = this.peek()) {
      if (!isLetter(w.raw[0])) this.#unexpected(w);
      const k = matchKeyword(w.text, this.#keywords);
      if (k === undefined) this.#unexpected(w);
      if (Array.isArray(k)) {
        fail('argument', `'${w.text}' could be ${k.map((x) => `'${x}'`).join(' or ')}.`, w.at, 'Type more of it.');
      }
      const keyword = k as string;
      this.i = w.at.to;
      const spec = this.keywords[keyword];
      const value = this.#keywordValue(keyword, spec, w);
      if (keyword in this.ignored) {
        this.c.report(warning('unsupported-argument', `${keyword} is ignored: ${this.ignored[keyword]}`, w.at));
        continue;
      }
      this.#values.set(keyword, value);
    }
  }

  #keywordValue(keyword: string, spec: KeywordSpec | undefined, at: CxWord): KwValue {
    if (spec?.kind === 'selection') {
      const s = this.requiredSpec(`an atom spec after ${keyword}`);
      return { keyword, word: { text: s.sel.text, raw: s.sel.text, at: { from: at.at.from, to: this.i } }, sel: s.sel };
    }
    if (spec?.kind === 'color') {
      const color = this.color();
      if (!color) this.#badValue(keyword, 'a color (a name, #rrggbb, r,g,b in percent)', at);
      return { keyword, word: { text: color!.text, raw: color!.text, at: color!.at } };
    }
    if (spec?.flag) return { keyword, word: { text: 'true', raw: '', at: at.at } };
    const value = wordAt(this.src, this.i, this.end);
    if (!value) return this.#badValue(keyword, 'a value', at);
    this.i = value.at.to;
    return { keyword, word: value };
  }

  #badValue(keyword: string, what: string, at: CxWord): never {
    return fail('argument', `${keyword} needs ${what}.`, { from: at.at.from, to: this.i }, this.#usage());
  }

  #unexpected(w: CxWord): never {
    // The word was tried as a spec and did not read: why is the better message.
    if (this.#specFailure?.from === w.at.from) throw this.#specFailure.error;
    const near = nearest(w.text, this.#keywords);
    return fail(
      'argument',
      `${this.name} does not take '${w.text}' here.`,
      w.at,
      near ? `Did you mean ${near}?` : this.#usage(),
    );
  }

  #usage(): string {
    const ks = Object.keys(this.keywords);
    return ks.length ? `${this.name} takes the keywords ${ks.join(', ')}.` : `${this.name} takes no keywords.`;
  }

  has(keyword: string): boolean {
    this.rest();
    return this.#values.has(keyword);
  }

  /** A keyword's place (or the command's end). */
  at(keyword: string): Span {
    this.rest();
    return this.#values.get(keyword)?.word.at ?? { from: this.end, to: this.end };
  }

  text(keyword: string, def = ''): string {
    this.rest();
    return this.#values.get(keyword)?.word.text ?? def;
  }

  num(keyword: string, def?: number): number {
    this.rest();
    const v = this.#values.get(keyword);
    if (!v) {
      if (def === undefined) return fail('argument', `${this.name} needs ${keyword}.`, this.here);
      return def;
    }
    const n = Number(v.word.text);
    if (!Number.isFinite(n) || v.word.text === '')
      fail('argument', `${keyword} is a number, not '${v.word.text}'.`, v.word.at);
    return n;
  }

  bool(keyword: string, def: boolean): boolean {
    this.rest();
    const v = this.#values.get(keyword);
    return v ? readBool(v.word.text, v.word.at) : def;
  }

  sel(keyword: string): Sel | undefined {
    this.rest();
    return this.#values.get(keyword)?.sel;
  }

  colorOf(keyword: string): number | undefined {
    this.rest();
    const v = this.#values.get(keyword);
    return v ? chimeraxColor(v.word.text) : undefined;
  }

  /** A keyword's enum word (shortened as ChimeraX allows). */
  choiceOf(keyword: string, values: readonly string[]): string | undefined {
    this.rest();
    const v = this.#values.get(keyword);
    if (!v) return undefined;
    const t = v.word.text.toLowerCase();
    const found = values.find((x) => x.toLowerCase() === t) ?? values.find((x) => x.toLowerCase().startsWith(t));
    if (!found || !t) fail('argument', `${keyword} is one of ${values.join(', ')}, not '${v.word.text}'.`, v.word.at);
    return found;
  }

  /** Nothing may be left. */
  done(): void {
    this.rest();
  }
}

/** ChimeraX's booleans: true or false, and 1, 0, on, off, yes, no. */
export function readBool(t: string, at: Span): boolean {
  const s = t.trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'on' || s === 'yes' || s === 't') return true;
  if (s === 'false' || s === '0' || s === 'off' || s === 'no' || s === 'f') return false;
  return fail('argument', `'${t}' is not true or false.`, at, 'Give true or false.');
}
