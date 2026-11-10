/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { story } from '@molstar/prism-ui/testing/index';
import { RealViewerStory } from '@molstar/prism-viewer/testing/real-viewer';
import { betaCellDoc, BetaCellResources, exosomeDoc, ExosomeResources } from '@molstar/meso-spec/examples';
import { indexDoc, mesoQLReference, type MesoViewSpecDoc, parseMesoQL, printMesoQL } from '@molstar/meso-spec/format';
import { evaluateMesoQL, lociSize, lociToIds } from '@molstar/meso-spec/ir';
import { DefaultResolvers } from '@molstar/meso-spec/resolvers';
import { compile } from '@molstar/meso-spec/runtime';
import { PrismMesoAdapter } from '../prism-adapter.js';
import { MesoSession } from '../session.js';
import { h, onSpellingChange, panel, pre, showHistory, showIr, showIssues, showJson, Styles } from './ui.js';

// Superstructures and MesoQL (_spec/mesoql.md, _spec/format.md). The β-cell holds insulin granules, a superstructure imported from
// a cellPACKgpu recipe and resolved once: the slider changes how many granules (only the cell packing reruns), the
// switch draws them as parts or as one body each (nothing reruns), and the edit log shows what each cost. The address
// story materializes any MesoQL address over a resolved scene and lists the copies it picks.

const meta: Meta = { title: 'Superstructures and addresses', parameters: { layout: 'fullscreen' } };
export default meta;

export const BetaCell: StoryObj = {
  render: () =>
    story(() => {
      const docPre = pre();
      const irPre = pre();
      const issues = h('div');
      const history = h('div');
      let session: MesoSession | undefined;
      let granules = 120;
      let detail: 'parts' | 'entity' = 'parts';
      const render = () => {
        if (!session) return;
        showJson(docPre, session.doc);
        showIr(irPre, session.ir);
        showIssues(issues, session.issues);
        showHistory(history, session.history);
      };
      onSpellingChange(render);
      const apply = async (label: string) => {
        if (!session) return;
        await session.edit(betaCellDoc(granules, detail), label);
        render();
      };
      const slider = h('input', { type: 'range', min: '20', max: '300', step: '20', value: '120' });
      const out = h('span', {}, '120');
      slider.addEventListener('input', () => (out.textContent = (slider as HTMLInputElement).value));
      slider.addEventListener('change', () => {
        granules = Number((slider as HTMLInputElement).value);
        void apply(`${granules} granules`);
      });
      const toggle = h('button', {}, 'Draw granules as one body each');
      toggle.addEventListener('click', () => {
        detail = detail === 'parts' ? 'entity' : 'parts';
        toggle.textContent = detail === 'parts' ? 'Draw granules as one body each' : 'Resolve granules into parts';
        void apply(`detail ${detail}`);
      });
      const viewer = RealViewerStory({
        spec: (base) => base,
        style: 'height:100%',
        setup: async (v) => {
          session = new MesoSession(
            betaCellDoc(),
            { resolvers: DefaultResolvers, load: (id) => BetaCellResources[id]?.() },
            new PrismMesoAdapter(v),
          );
          await session.start();
          render();
        },
      });
      return h(
        'div',
        { style: `${Styles.grid};grid-template-columns:1fr 1fr 1.6fr;grid-template-rows:auto 1.5fr 1fr` },
        h(
          'div',
          { style: 'grid-column:1 / 4' },
          panel(
            'β-cell slice: insulin granules as a superstructure, resolved once',
            h('div', { style: Styles.bar }, 'granules', slider, out, toggle),
          ),
        ),
        panel('MesoViewSpec document', docPre, '', true),
        panel('IR: the granule once, its copies as poses', irPre),
        panel('Mol* / Prism', h('div', { style: 'flex:1;min-height:0;position:relative' }, viewer)),
        panel('Issues (the expansion Prism needs is reported here)', issues),
        h(
          'div',
          { style: 'grid-column:2 / 4;display:contents' },
          panel('Edits: what each one cost', history, 'grid-column:2 / 4'),
        ),
      );
    }),
};

function addressStory(doc: MesoViewSpecDoc, load: (id: string) => unknown, examples: string[]) {
  return story(() => {
    const input = h('textarea', {
      rows: '3',
      style: 'width:100%;font:12px ui-monospace,Menlo,monospace;box-sizing:border-box',
    });
    (input as HTMLTextAreaElement).value = examples[0];
    const result = pre('resolving the scene…');
    const ref = pre(mesoQLReference());
    const picks = h(
      'div',
      { style: Styles.bar },
      ...examples.map((e) => h('button', { onclick: () => ((input as HTMLTextAreaElement).value = e) && run() }, e)),
    );
    const kinds = indexDoc(doc).kinds as ReadonlyMap<string, string>;
    let ir: Awaited<ReturnType<typeof compile>>['ir'];
    const run = () => {
      if (!ir) return;
      const text = (input as HTMLTextAreaElement).value;
      const p = parseMesoQL(text, { kinds });
      if (!p.expr) {
        result.textContent = p.issues.map((i) => `${i.code}: ${i.message}`).join('\n');
        return;
      }
      const t0 = performance.now();
      const e = evaluateMesoQL(p.expr, { doc, ir });
      const ms = performance.now() - t0;
      const runs = [...e.loci.copies.values()].reduce((n, r) => n + r.length / 2, 0);
      result.textContent = [
        `canonical: ${printMesoQL(p.expr)}`,
        `${lociSize(e.loci).toLocaleString('en-US')} copies in ${e.loci.copies.size} placement set${e.loci.copies.size === 1 ? '' : 's'}, ${runs} run${runs === 1 ? '' : 's'} (${ms.toFixed(1)} ms)`,
        ...e.issues.map((i) => `${i.code}: ${i.message}`),
        '',
        ...lociToIds(e.loci, ir, 40),
      ].join('\n');
    };
    input.addEventListener('input', run);
    void compile(doc, { resolvers: DefaultResolvers, load }).then((r) => {
      ir = r.ir;
      run();
    });
    return h(
      'div',
      { style: `${Styles.grid};grid-template-columns:1.2fr 1fr;grid-template-rows:auto 1fr` },
      panel(`MesoQL over ${doc.metadata.title}`, h('div', { style: 'padding:6px 8px' }, input, picks)),
      panel('Reference (generated from the table)', ref, 'grid-row:1 / 3;grid-column:2'),
      panel(
        'MesoLoci: what the address materializes to (runs per placement set), the first copies by stable id',
        result,
      ),
    );
  });
}

/** Type an address; it is checked against the document and materialized over the resolved exosome. */
export const AddressesExosome: StoryObj = {
  render: () =>
    addressStory(exosomeDoc(), (id) => ExosomeResources[id]?.(), [
      '(and (entity e.catalase) (model m.picks))',
      '(within (in c.exosome) :of (population p.catalase.observed) :distance 15)',
      '(not (population p.lipids) :in (in c.exosome :location membrane))',
      '(copies p.catalase 12 3)',
      '(entity c.exosome)',
    ]),
};

/** Addresses through the nesting: one granule's Vamp2, ids that say which granule. */
export const AddressesBetaCell: StoryObj = {
  render: () =>
    addressStory(betaCellDoc(), (id) => BetaCellResources[id]?.(), [
      '(part (copies p.granules 12) p.Vamp2)',
      '(population p.Vamp2)',
      '(part (copies p.granules 0 3) p.Chga)',
    ]),
};
