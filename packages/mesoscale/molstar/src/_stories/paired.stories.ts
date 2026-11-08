/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { story } from '@molstar/prism-ui/testing/index';
import type { MesoViewSpecDoc } from '@molstar/meso-spec/format/doc';
import { exosomeDoc, ExosomeResources } from '@molstar/meso-spec/examples/exosome';
import { galleryDoc } from '@molstar/meso-spec/examples/gallery';
import { yeastDoc } from '@molstar/meso-spec/examples/yeast';
import { DefaultResolvers } from '@molstar/meso-spec/resolvers/index';
import { compile } from '@molstar/meso-spec/runtime/runtime';
import { h, panel, pre, showIr, showIssues, showJson, Styles, traceBox } from './ui.js';

// The same scene twice (design.md §2, §10): the MesoViewSpec document as authored, the IR the runtime makes of it, the
// issues, a provenance trace. No viewer: what is shown is the format and the IR, computed live in the browser.

const meta: Meta = { title: 'Docs/Paired examples', parameters: { layout: 'fullscreen' } };
export default meta;

function paired(doc: MesoViewSpecDoc, traceIds: string[]) {
  return story(() => {
    const docPre = pre();
    const irPre = pre('resolving…');
    const issues = h('div');
    showJson(docPre, doc);
    const tracer = traceBox(() => doc, traceIds, traceIds[0]);
    void compile(doc, { resolvers: DefaultResolvers, load: (id) => ExosomeResources[id]?.() }).then((r) => {
      showIr(irPre, r.ir);
      showIssues(issues, r.issues);
    });
    return h(
      'div',
      { style: `${Styles.grid};grid-template-columns:1fr 1fr;grid-template-rows:2fr 1fr` },
      panel(`MesoViewSpec: ${doc.metadata.title}`, docPre),
      panel('IR', irPre),
      panel('Issues', issues),
      panel('Provenance', tracer.el),
    );
  });
}

/** The thin slice's scene: a recipe, a segmentation and picks in one document. */
export const Exosome: StoryObj = {
  render: () => paired(exosomeDoc(), ['p.catalase.observed', 'c.exosome', 'p.CD63', 'al.tomo-model']),
};

/** Nesting, lattices, fibers, a bilayer, dispatched by arrangement. */
export const Gallery: StoryObj = { render: () => paired(galleryDoc(), ['p.pores', 'p.atpsynthase', 'p.actin']) };

/** The whole yeast cell, described: the runtime says what it cannot resolve (a tile format, a catalog). */
export const Yeast: StoryObj = { render: () => paired(yeastDoc(), ['p.ribosomes', 'c.nucleus', 'p.npc', 'c.mito']) };
