/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { story } from '@molstar/prism-ui/testing/index';
import { RealViewerStory } from '@molstar/prism-viewer/testing/real-viewer';
import type { MesoViewSpecDoc, Population } from '@molstar/meso-spec/format/doc';
import { galleryDoc } from '@molstar/meso-spec/examples/gallery';
import { DefaultResolvers } from '@molstar/meso-spec/resolvers/index';
import { PrismMesoAdapter } from '../prism-adapter.js';
import { MesoSession } from '../session.js';
import { h, panel, pre, showHistory, showIr, showIssues, Styles } from './ui.js';

// Smaller stories for what the slice leaves out (design.md §4.4): one gallery population kind each, its construction
// parameter on a slider. A slider moves a number the resolver reads, so the edit is a model edit that reruns that
// resolver alone; the issues say when the request does not fit (a lattice on a too-small membrane).

const meta: Meta = { title: 'Resolver mocks', parameters: { layout: 'fullscreen' } };
export default meta;

interface Knob {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly apply: (doc: MesoViewSpecDoc, v: number) => MesoViewSpecDoc;
}

function only(ids: string[]): MesoViewSpecDoc {
  const d = galleryDoc();
  return { ...d, populations: d.populations.filter((p) => ids.includes(p.id)) };
}

const setPop = (doc: MesoViewSpecDoc, id: string, edit: (p: Population) => Population) => ({ ...doc, populations: doc.populations.map((p) => (p.id === id ? edit(p) : p)) });

function mock(doc: MesoViewSpecDoc, knob: Knob) {
  return story(() => {
    const irPre = pre();
    const issues = h('div');
    const history = h('div');
    let session: MesoSession | undefined;
    const render = () => {
      if (!session) return;
      showIr(irPre, session.ir);
      showIssues(issues, session.issues);
      showHistory(history, session.history);
    };
    const input = h('input', { type: 'range', min: String(knob.min), max: String(knob.max), step: String(knob.step), value: String(knob.value) });
    const out = h('span', {}, String(knob.value));
    input.addEventListener('input', () => (out.textContent = (input as HTMLInputElement).value));
    input.addEventListener('change', async () => {
      if (!session) return;
      const v = Number((input as HTMLInputElement).value);
      await session.edit(knob.apply(session.doc, v), `${knob.label} ${v}`);
      render();
    });
    const viewer = RealViewerStory({
      spec: (base) => base,
      style: 'height:100%',
      setup: async (v) => {
        session = new MesoSession(doc, { resolvers: DefaultResolvers }, new PrismMesoAdapter(v));
        await session.start();
        render();
      },
    });
    return h(
      'div',
      { style: `${Styles.grid};grid-template-columns:1fr 1.6fr;grid-template-rows:auto 1.5fr 1fr` },
      h('div', { style: 'grid-column:1 / 3' }, panel(doc.metadata.title, h('div', { style: Styles.bar }, knob.label, input, out))),
      panel('IR', irPre),
      panel('Mol* / Prism', h('div', { style: 'flex:1;min-height:0;position:relative' }, viewer)),
      panel('Issues', issues),
      panel('Edits', history),
    );
  });
}

/** Membrane lattices: nuclear pores as a patch (fits), ATP synthase on the mitochondrion (does not; the issue says how many sites there are). */
export const MembraneLattice: StoryObj = {
  render: () =>
    mock(only(['p.pores', 'p.atpsynthase']), {
      label: 'ATP synthase spacing (nm)',
      min: 6,
      max: 20,
      step: 1,
      value: 12,
      apply: (d, v) => setPop(d, 'p.atpsynthase', (p) => ({ ...p, arrangement: { kind: 'lattice', lattice: 'hexagonal', spacing: v } })),
    }),
};

/** Compartment packing: ribosomes and proteasomes kept out of the nucleus, the vesicle and the mitochondrion. */
export const CompartmentPacking: StoryObj = {
  render: () =>
    mock(only(['p.ribosomes', 'p.proteasomes']), {
      label: 'ribosomes',
      min: 50,
      max: 1200,
      step: 50,
      value: 300,
      apply: (d, v) => setPop(d, 'p.ribosomes', (p) => ({ ...p, abundance: { count: v } })),
    }),
};

/** Fibers: six grown actin filaments and a traced microtubule; the slider is the actin persistence length. */
export const Fibers: StoryObj = {
  render: () =>
    mock(only(['p.actin', 'p.microtubule']), {
      label: 'actin persistence (nm)',
      min: 20,
      max: 2000,
      step: 20,
      value: 1000,
      apply: (d, v) =>
        setPop(d, 'p.actin', (p) => ({ ...p, arrangement: { kind: 'fiber', rise: 2.75, twist: -166.6, growth: { persistence: v, length: 220, count: 6 } } })),
    }),
};

/** A curved bilayer: the vesicle's two leaflets at a lipid density. */
export const Bilayer: StoryObj = {
  render: () =>
    mock(only(['p.vesicle-lipids']), {
      label: 'lipids per nm² per leaflet',
      min: 0.5,
      max: 2.5,
      step: 0.1,
      value: 1.5,
      apply: (d, v) => setPop(d, 'p.vesicle-lipids', (p) => ({ ...p, abundance: { density: { value: v, unit: 'per_nm2' } } })),
    }),
};
