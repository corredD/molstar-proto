/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { story } from '@molstar/prism-ui/testing/index';
import { RealViewerStory } from '@molstar/prism-viewer/testing/real-viewer';
import type { MesoViewSpecDoc } from '@molstar/meso-spec/format/doc';
import { exosomeDoc, ExosomeResources } from '@molstar/meso-spec/examples/exosome';
import { DefaultResolvers } from '@molstar/meso-spec/resolvers/index';
import { PrismMesoAdapter } from '../prism-adapter.js';
import { MesoSession } from '../session.js';
import { h, onSpellingChange, panel, pre, showHistory, showIr, showIssues, showJson, Styles, traceBox } from './ui.js';

// The thin slice (design.md §10): the exosome document, validated and resolved (the cellPACKgpu adapter, the precomputed
// picks, the bilayer), its IR, and the real Prism viewer drawing it, side by side. Edits go through a session: a color
// edit is a view edit (no resolver runs, no list replaced), a density edit reruns the one model it touches, and the
// catalase the recipe asks for does not fit, which the issues panel explains. The cryo-ET inputs are synthetic
// fixtures (labelled in the document); the recipe is Ludo's, trimmed. No network.

const meta: Meta = { title: 'Thin slice', parameters: { layout: 'fullscreen' } };
export default meta;

type Step = (
  s: MesoSession,
  apply: (doc: MesoViewSpecDoc, label: string, focus?: string) => Promise<void>,
) => Promise<void>;

function withLook(doc: MesoViewSpecDoc, population: string, color: string): MesoViewSpecDoc {
  return {
    ...doc,
    views: doc.views!.map((v) =>
      v.id === doc.session?.view
        ? {
            ...v,
            looks: [
              ...(v.looks ?? []).filter((l) => !(l.select === `(population ${population})` && l.color)),
              { select: `(population ${population})`, color },
            ],
          }
        : v,
    ),
  };
}

function withAbundance(
  doc: MesoViewSpecDoc,
  population: string,
  abundance: MesoViewSpecDoc['populations'][number]['abundance'],
): MesoViewSpecDoc {
  return { ...doc, populations: doc.populations.map((p) => (p.id === population ? { ...p, abundance } : p)) };
}

function slice(steps?: Step) {
  return story(() => {
    const docPre = pre();
    const irPre = pre();
    const issues = h('div');
    const history = h('div');
    const status = h('span', { style: 'color:#666' }, 'loading…');
    let session: MesoSession | undefined;
    let focus: string | undefined;
    const render = () => {
      if (!session) return;
      showJson(docPre, session.doc, focus);
      showIr(irPre, session.ir, focus);
      showIssues(issues, session.issues);
      showHistory(history, session.history);
    };
    onSpellingChange(() => session && showIssues(issues, session.issues));
    const apply = async (doc: MesoViewSpecDoc, label: string, f?: string) => {
      if (!session) return;
      focus = f;
      status.textContent = `${label}…`;
      const r = await session.edit(doc, label);
      status.textContent = `${label}: a ${r.kind} edit, ${r.resolverRuns} resolver run${r.resolverRuns === 1 ? '' : 's'}`;
      render();
      tracer.update();
    };

    // controls: a color (view edit), a count and a concentration (model edits), the view
    const popSelect = h(
      'select',
      {},
      ...exosomeDoc().populations.map((p) =>
        h('option', p.id === 'p.miRNA' ? { value: p.id, selected: '' } : { value: p.id }, p.id),
      ),
    );
    const color = h('input', { type: 'color', value: '#22aa44' });
    const count = h('input', { type: 'range', min: '50', max: '600', step: '10', value: '506' });
    const countLabel = h('span', {}, '506');
    count.addEventListener('input', () => (countLabel.textContent = (count as HTMLInputElement).value));
    const conc = h('input', { type: 'number', value: '0.0004', step: '0.0001', min: '0', style: 'width:6em' });
    const viewSelect = h(
      'select',
      {},
      ...exosomeDoc().views!.map((v) => h('option', { value: v.id }, v.label ?? v.id)),
    );
    const controls = h(
      'div',
      { style: Styles.bar },
      h('b', {}, 'View edit'),
      popSelect,
      color,
      h(
        'button',
        {
          onclick: () =>
            session &&
            apply(
              withLook(session.doc, (popSelect as HTMLSelectElement).value, (color as HTMLInputElement).value),
              `color ${(popSelect as HTMLSelectElement).value}`,
              (popSelect as HTMLSelectElement).value,
            ),
        },
        'Recolor',
      ),
      viewSelect,
      h(
        'button',
        {
          onclick: () =>
            session &&
            apply(
              { ...session.doc, session: { view: (viewSelect as HTMLSelectElement).value } },
              `view ${(viewSelect as HTMLSelectElement).value}`,
            ),
        },
        'Switch view',
      ),
      h('b', { style: 'margin-left:12px' }, 'Model edit'),
      'catalase count',
      count,
      countLabel,
      h(
        'button',
        {
          onclick: () =>
            session &&
            apply(
              withAbundance(session.doc, 'p.catalase', { count: Number((count as HTMLInputElement).value) }),
              `catalase ${(count as HTMLInputElement).value}`,
              'p.catalase',
            ),
        },
        'Set count',
      ),
      'miRNA (M)',
      conc,
      h(
        'button',
        {
          onclick: () =>
            session &&
            apply(
              withAbundance(session.doc, 'p.miRNA', {
                concentration: { value: Number((conc as HTMLInputElement).value), unit: 'M' },
              }),
              `miRNA ${(conc as HTMLInputElement).value} M`,
              'p.miRNA',
            ),
        },
        'Set concentration',
      ),
      status,
    );
    const tracer = traceBox(
      () => session?.doc ?? exosomeDoc(),
      ['p.catalase.observed', 'p.catalase', 'c.exosome', 'p.CD63', 'p.lipids', 'm.recipe'],
      'p.catalase.observed',
    );

    const viewer = RealViewerStory({
      spec: (base) => base,
      style: 'height:100%',
      setup: async (v) => {
        session = new MesoSession(
          exosomeDoc(),
          { resolvers: DefaultResolvers, load: (id) => ExosomeResources[id]?.() },
          new PrismMesoAdapter(v),
        );
        await session.start();
        status.textContent = 'opened: every model resolved once';
        render();
        await steps?.(session, apply);
      },
    });

    return h(
      'div',
      { style: `${Styles.grid};grid-template-columns:1fr 1fr 1.6fr;grid-template-rows:auto 1.4fr 1fr` },
      h(
        'div',
        { style: 'grid-column:1 / 4' },
        panel('MesoViewSpec thin slice: exosome document → validation → resolvers → IR → Prism', controls),
      ),
      panel('MesoViewSpec document (authored)', docPre, '', true),
      panel('IR (derived; placement buffers summarized)', irPre),
      panel('Mol* / Prism', h('div', { style: 'flex:1;min-height:0;position:relative' }, viewer)),
      panel('Issues (validation, resolution, constraints)', issues),
      panel('Provenance', tracer.el),
      panel('Edits: what each one cost', history),
    );
  });
}

/** The scene, open: edit it from the bar. */
export const EndToEnd: StoryObj = { render: () => slice() };

/** A color edit: a view edit; no resolver runs, every placement set kept (`=3`), only looks written. */
export const ColorEdit: StoryObj = {
  render: () => slice(async (s, apply) => apply(withLook(s.doc, 'p.miRNA', '#22aa44'), 'color p.miRNA', 'p.miRNA')),
};

/** A density edit: the miRNA concentration doubled; the recipe model reruns, the picks and the bilayer are kept. */
export const DensityEdit: StoryObj = {
  render: () =>
    slice(async (s, apply) =>
      apply(withAbundance(s.doc, 'p.miRNA', { concentration: { value: 0.0008, unit: 'M' } }), 'miRNA ×2', 'p.miRNA'),
    ),
};

/** The recipe's 506 catalase copies do not fit: the issue says how many did and why; asking for 150 meets it. */
export const UnmetConstraint: StoryObj = {
  render: () =>
    slice(async (s, apply) => {
      await new Promise((r) => setTimeout(r, 1500));
      await apply(withAbundance(s.doc, 'p.catalase', { count: 150 }), 'catalase 150', 'p.catalase');
    }),
};
