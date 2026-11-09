/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { MesoViewSpecDoc } from '@molstar/meso-spec/format/doc';
import type { Issue } from '@molstar/meso-spec/format/issues';
import { irToJson, type IR } from '@molstar/meso-spec/ir/ir';
import { type Patch, printPatch } from '@molstar/meso-spec/format/patch';
import { type DataCodec, DocumentCodec, IRCodec, printData } from '@molstar/meso-spec/format/sexpr';
import { trace, traceToSexprData, traceToText } from '@molstar/meso-spec/format/trace';
import type { EditRecord } from '../session.js';

// Plain DOM for the stories: panels of documents, IR, issues, an edit log. No framework: the stories test the format,
// not a UI. Data panels are spelled as S-expressions by default (design.md §3.7, SeqQL's "one tree, three spellings"),
// JSON on a toggle: the stored spelling, for comparison.

type Attrs = Record<string, string | ((e: Event) => void) | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | undefined)[]
) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v);
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c !== undefined) el.append(c);
  return el;
}

export const Styles = {
  grid: 'display:grid;gap:8px;height:100vh;box-sizing:border-box;padding:8px;font:12px/1.4 system-ui,sans-serif;background:#f6f6f4;color:#222',
  panel:
    'background:#fff;border:1px solid #ddd;border-radius:6px;overflow:auto;min-height:0;display:flex;flex-direction:column',
  title: 'font-weight:600;padding:6px 8px;border-bottom:1px solid #eee;position:sticky;top:0;background:#fff;z-index:1',
  pre: 'margin:0;padding:6px 8px;font:11px/1.35 ui-monospace,Menlo,monospace;white-space:pre;flex:1',
  bar: 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:6px 8px',
};

export function panel(title: string, body: Node, extra = '', toggle = false) {
  const head = h(
    'div',
    { style: `${Styles.title};display:flex;align-items:center;gap:8px` },
    title,
    toggle ? spellingToggle() : undefined,
  );
  return h('section', { style: `${Styles.panel};${extra}` }, head, body);
}

export function pre(text = '') {
  return h('pre', { style: Styles.pre }, text);
}

export type Spelling = 'sexpr' | 'json';
let spelling: Spelling = 'sexpr';
const shown = new Map<HTMLElement, { value: unknown; codec: DataCodec; focus?: string }>();
const toggles = new Set<HTMLElement>();
const listeners = new Set<() => void>();

/** Called after the spelling changes (panels that are not plain data: issues, traces). */
export function onSpellingChange(f: () => void) {
  listeners.add(f);
}

/** The spelling every data panel uses; switching re-renders them all. */
export function setSpelling(s: Spelling) {
  spelling = s;
  for (const [el, v] of shown) if (el.isConnected) render(el, v.value, v.codec, v.focus, false);
  for (const f of listeners) f();
  for (const t of toggles)
    if (t.isConnected) t.textContent = s === 'sexpr' ? 'S-expression · JSON' : 'JSON · S-expression';
}

/** A button that flips the spelling of every data panel (S-expression first, JSON second). */
export function spellingToggle() {
  const b = h('button', {
    style: 'margin-left:auto;font:11px system-ui',
    title: 'Switch the spelling of the data panels',
  });
  b.textContent = spelling === 'sexpr' ? 'S-expression · JSON' : 'JSON · S-expression';
  b.addEventListener('click', () => setSpelling(spelling === 'sexpr' ? 'json' : 'sexpr'));
  toggles.add(b);
  return b;
}

/** A panel whose value prints through its own S-expression printer (a patch). */
const printers = new Map<HTMLElement, (value: unknown) => string>();

/** A patch (format/patch.ts) in the current spelling: `(patch :ops [...])`, or its JSON. */
export function showPatch(el: HTMLElement, patch: unknown) {
  printers.set(el, (p) => printPatch(p as Patch));
  showData(el, patch);
}

function render(el: HTMLElement, value: unknown, codec: DataCodec, focus: string | undefined, scroll: boolean) {
  const print = printers.get(el);
  const text = spelling === 'sexpr' ? (print ? print(value) : printData(value, codec)) : JSON.stringify(value, null, 1);
  el.textContent = '';
  let first: HTMLElement | undefined;
  const needle = focus
    ? spelling === 'sexpr'
      ? new RegExp(`(^|[\\s(\\[])${focus.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s)\\]])`)
      : `"${focus}"`
    : undefined;
  for (const line of text.split('\n')) {
    const hit = needle !== undefined && (typeof needle === 'string' ? line.includes(needle) : needle.test(line));
    const span = h('div', hit ? { style: 'background:#fff3b0' } : {}, line);
    if (hit && !first) first = span;
    el.append(span);
  }
  if (scroll) first?.scrollIntoView({ block: 'center' });
}

/** A value in the current spelling, in a <pre>; the lines naming `focus` marked and scrolled to. */
export function showData(el: HTMLElement, value: unknown, codec: DataCodec = DocumentCodec, focus?: string) {
  shown.set(el, { value, codec, focus });
  render(el, value, codec, focus, true);
}

/** A MesoViewSpec document. */
export function showJson(el: HTMLElement, value: unknown, focus?: string) {
  showData(el, value, DocumentCodec, focus);
}

export function showIr(el: HTMLElement, ir: IR | undefined, focus?: string) {
  showData(el, ir ? irToJson(ir) : { note: 'no IR: the document has errors' }, IRCodec, focus);
}

const omit = (o: object, ...keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

const sevColor = { error: '#c0392b', warning: '#b7791f', info: '#4a6fa5' } as const;

export function showIssues(el: HTMLElement, issues: readonly Issue[]) {
  el.textContent = '';
  if (!issues.length) el.append(h('div', { style: 'padding:6px 8px;color:#2e7d32' }, 'No issues.'));
  for (const i of issues) {
    const c = i.constraint;
    el.append(
      h(
        'div',
        { style: `padding:6px 8px;border-bottom:1px solid #f0f0f0;border-left:3px solid ${sevColor[i.severity]}` },
        h(
          'div',
          {},
          h('b', { style: `color:${sevColor[i.severity]}` }, `${i.severity} `),
          h('code', {}, i.code),
          ` ${i.message}`,
        ),
        c
          ? h(
              'div',
              { style: 'margin-top:2px' },
              h('b', {}, `${c.achieved} / ${c.requested}`),
              ` ${c.kind}${c.reason ? ` — ${c.reason}` : ''}`,
            )
          : undefined,
        i.path
          ? h('div', { style: 'color:#888' }, `at ${i.path} (${i.phase})`)
          : h('div', { style: 'color:#888' }, `(${i.phase})`),
        spelling === 'sexpr'
          ? h(
              'pre',
              { style: `${Styles.pre};padding:2px 0 0;color:#555` },
              printData({ kind: i.code, ...omit(i, 'code', 'message') }, IRCodec),
            )
          : undefined,
      ),
    );
  }
}

const ms = (x?: number) => (x === undefined ? '' : x < 10 ? x.toFixed(1) : x.toFixed(0));

export function showHistory(el: HTMLElement, history: readonly EditRecord[]) {
  const rows = history.map((r) =>
    h(
      'tr',
      { style: r.kind === 'view' ? 'background:#eef7ee' : r.kind === 'model' ? 'background:#fdf3e6' : '' },
      ...[
        r.label,
        r.kind,
        String(r.resolverRuns),
        String(r.cacheHits),
        r.compileMs
          ? `${ms(r.compileMs.resolve)} (v ${ms(r.compileMs.validate)} · n ${ms(r.compileMs.normalize)} · a ${ms(r.compileMs.assemble)})`
          : '—',
        r.commit ? `${ms(r.commit.ms.sets)} / ${ms(r.commit.ms.looks)}` : '—',
        r.commit ? `+${r.commit.added.length} −${r.commit.removed.length} =${r.commit.kept.length}` : '—',
        ms(r.totalMs),
      ].map((x) => h('td', { style: 'padding:2px 6px;border-bottom:1px solid #eee' }, x)),
    ),
  );
  const head = [
    'edit',
    'kind',
    'resolver runs',
    'cache hits',
    'resolve ms (validate · normalize · assemble)',
    'commit ms sets / looks',
    'sets +added −removed =kept',
    'total ms',
  ];
  el.textContent = '';
  el.append(
    h(
      'table',
      { style: 'border-collapse:collapse;width:100%' },
      h(
        'tr',
        {},
        ...head.map((x) => h('th', { style: 'text-align:left;padding:2px 6px;border-bottom:1px solid #ccc' }, x)),
      ),
      ...rows,
    ),
  );
}

export function traceBox(doc: () => MesoViewSpecDoc, ids: readonly string[], initial?: string) {
  const out = pre();
  const select = h(
    'select',
    {},
    ...ids.map((id) => h('option', id === initial ? { value: id, selected: '' } : { value: id }, id)),
  );
  const update = () => {
    const steps = trace(doc(), (select as HTMLSelectElement).value);
    if (spelling === 'sexpr') showData(out, traceToSexprData(steps), IRCodec);
    else out.textContent = traceToText(steps);
  };
  select.addEventListener('change', update);
  onSpellingChange(update);
  update();
  return {
    el: h(
      'div',
      { style: 'display:flex;flex-direction:column;min-height:0;flex:1' },
      h('div', { style: Styles.bar }, 'Trace back from ', select),
      out,
    ),
    update,
  };
}
