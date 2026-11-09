/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { story } from '@molstar/prism-ui/testing/index';
import { RealViewerStory } from '@molstar/prism-viewer/testing/real-viewer';
import { exosomeDoc, ExosomeResources } from '@molstar/meso-spec/examples/exosome';
import type { MesoViewSpecDoc } from '@molstar/meso-spec/format/doc';
import { applyPatch, classifyPatch, type Patch, PatchFormat } from '@molstar/meso-spec/format/patch';
import { DefaultResolvers } from '@molstar/meso-spec/resolvers/index';
import { PrismMesoAdapter } from '../prism-adapter.js';
import { MesoSession } from '../session.js';
import { h, onSpellingChange, panel, pre, showHistory, showIssues, showPatch, Styles } from './ui.js';

// Patches (prism.md §2): an edit of the exosome's looks is a patch, a few ops by id. The panels show the patch, the
// inverse the owner keeps for the record, and what the edit costs, read from the ops. Undo here applies the inverse and
// compares the document with the one before, byte for byte (in Prism, Undo is its checkpoints; the inverse is a record).

const meta: Meta = { title: 'Patches', parameters: { layout: 'fullscreen' } };
export default meta;

const colors = ['#ff0000', '#2e7d32', '#1565c0'];

export const ExosomeLookEdit: StoryObj = {
  render: () =>
    story(() => {
      let session: MesoSession | undefined;
      let taken = 0;
      /** Each applied patch, its inverse, and the document's bytes before it. */
      const log: { patch: Patch; inverse: Patch; before: string }[] = [];
      const patchPre = pre();
      const inversePre = pre();
      const status = h('div', { style: 'padding:6px 8px' });
      const issues = h('div');
      const history = h('div');
      const render = () => {
        const last = log[log.length - 1];
        if (last) {
          showPatch(patchPre, last.patch);
          showPatch(inversePre, last.inverse);
        }
        if (session) {
          showIssues(issues, session.issues);
          showHistory(history, session.history);
        }
      };
      onSpellingChange(render);
      const say = (t: string) => {
        status.textContent = t;
      };
      const propose = async (patch: Patch, label: string) => {
        if (!session) return;
        const r = applyPatch(session.doc, patch);
        if (!r.inverse) return say(`refused: ${r.issues.map((i) => `${i.path} ${i.message}`).join('; ')}`);
        log.push({ patch, inverse: r.inverse, before: JSON.stringify(session.doc) });
        const cost = classifyPatch(session.doc, patch);
        await session.edit(r.doc, label);
        say(`${label}: a ${cost} edit`);
        render();
      };
      const recolor = () =>
        propose(
          {
            format: PatchFormat,
            ops: [{ op: 'set', id: 'l.catalase', fields: { color: colors[taken++ % colors.length] } }],
          },
          'catalase color',
        );
      const glow = () =>
        propose(
          {
            format: PatchFormat,
            ops: [
              {
                op: 'insert',
                parent: 'v.overview',
                list: 'looks',
                node: { id: `l.glow${log.length}`, select: '(population p.miRNA)', color: '#ffe082', emissive: 0.8 },
              },
            ],
          },
          'glow miRNA',
        );
      const undo = async () => {
        const last = log.pop();
        if (!session || !last) return;
        const r = applyPatch(session.doc, last.inverse);
        if (!r.inverse) return say(`the inverse was refused: ${r.issues[0]?.message}`);
        await session.edit(r.doc, 'undo by the inverse');
        const same = JSON.stringify(session.doc) === last.before;
        say(`undo by the inverse: the document is back, byte for byte: ${same ? 'yes' : 'NO'}`);
        showPatch(patchPre, last.inverse);
        showPatch(inversePre, last.patch);
        showIssues(issues, session.issues);
        showHistory(history, session.history);
      };
      const buttons = [
        h('button', { onclick: () => void recolor() }, 'Make catalase another color'),
        h('button', { onclick: () => void glow() }, 'Make the miRNA glow'),
        h('button', { onclick: () => void undo() }, 'Undo by the inverse'),
      ];
      const viewer = RealViewerStory({
        spec: (s) => s,
        style: 'height:100%',
        setup: async (v) => {
          const doc: MesoViewSpecDoc = exosomeDoc();
          session = new MesoSession(
            doc,
            { resolvers: DefaultResolvers, load: (id) => ExosomeResources[id]?.() },
            new PrismMesoAdapter(v),
          );
          await session.start();
          say('the exosome, opened');
          render();
        },
      });
      return h(
        'div',
        { style: `${Styles.grid};grid-template-columns:1fr 1fr 1.6fr;grid-template-rows:auto 1.2fr 1fr` },
        h(
          'div',
          { style: 'grid-column:1 / 4' },
          panel('Exosome: looks edited by patches', h('div', {}, h('div', { style: Styles.bar }, ...buttons), status)),
        ),
        panel('The patch', patchPre, '', true),
        panel('Its inverse', inversePre),
        panel('Mol* / Prism', h('div', { style: 'flex:1;min-height:0;position:relative' }, viewer)),
        panel('Issues', issues),
        panel('Edits: a look patch is a view edit, nothing resolved', history, 'grid-column:2 / 4'),
      );
    }),
};
