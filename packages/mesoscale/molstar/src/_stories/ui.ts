/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { MesoViewSpecDoc } from '@molstar/meso-spec/format/doc';
import type { Issue } from '@molstar/meso-spec/format/issues';
import { irToJson, type IR } from '@molstar/meso-spec/ir/ir';
import { trace, traceToText } from '@molstar/meso-spec/format/trace';
import type { EditRecord } from '../session.js';

// Plain DOM for the stories: panels of JSON, issues, an edit log. No framework: the stories test the format, not a UI.

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

export function panel(title: string, body: Node, extra = '') {
  return h('section', { style: `${Styles.panel};${extra}` }, h('div', { style: Styles.title }, title), body);
}

export function pre(text = '') {
  return h('pre', { style: Styles.pre }, text);
}

/** JSON in a <pre>, the lines naming `focus` marked and scrolled to. */
export function showJson(el: HTMLElement, value: unknown, focus?: string) {
  const text = JSON.stringify(value, null, 1);
  el.textContent = '';
  let first: HTMLElement | undefined;
  for (const line of text.split('\n')) {
    const hit = focus && line.includes(`"${focus}"`);
    const span = h('div', hit ? { style: 'background:#fff3b0' } : {}, line);
    if (hit && !first) first = span;
    el.append(span);
  }
  first?.scrollIntoView({ block: 'center' });
}

export function showIr(el: HTMLElement, ir: IR | undefined, focus?: string) {
  showJson(el, ir ? irToJson(ir) : { note: 'no IR: the document has errors' }, focus);
}

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
  const update = () => (out.textContent = traceToText(trace(doc(), (select as HTMLSelectElement).value)));
  select.addEventListener('change', update);
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
