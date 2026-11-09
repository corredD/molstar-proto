/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { story } from '@molstar/prism-ui/testing/index';
import { RealViewerStory } from '@molstar/prism-viewer/testing/real-viewer';
import { betaCellDoc, BetaCellResources } from '@molstar/meso-spec/examples/betacell';
import type { MesoViewSpecDoc } from '@molstar/meso-spec/format/doc';
import { DefaultResolvers } from '@molstar/meso-spec/resolvers/index';
import { PrismMesoAdapter } from '../prism-adapter.js';
import { MesoSession } from '../session.js';
import { h, onSpellingChange, panel, pre, showData, showHistory, showIssues, Styles } from './ui.js';

// The semantic camera (design.md §5.1): a view says what to look at (a MesoQL address), how tightly (framing) and from
// where (outside the scene); the runtime materializes the address over the resolved copies and places the camera.
// Switching views reruns nothing upstream (the edit log shows it); the tour steps through views with their captions.

const meta: Meta = { title: 'Semantic camera', parameters: { layout: 'fullscreen' } };
export default meta;

export const BetaCellTour: StoryObj = {
  render: () =>
    story(() => {
      const base = betaCellDoc();
      const viewPre = pre();
      const camPre = pre();
      const issues = h('div');
      const history = h('div');
      const caption = h('div', { style: 'padding:6px 8px;font-style:italic;min-height:1.4em' });
      let session: MesoSession | undefined;
      let current = base.session?.view ?? base.views?.[0]?.id;
      let playing = false;

      const docFor = (view: string | undefined): MesoViewSpecDoc => ({ ...base, session: { ...base.session, view } });
      const render = () => {
        if (!session) return;
        const v = base.views?.find((x) => x.id === current);
        showData(viewPre, v ?? {});
        showData(camPre, { camera: session.ir?.view.camera, cutaway: session.ir?.view.cutaway?.length ?? 0 });
        showIssues(issues, session.issues);
        showHistory(history, session.history);
        for (const b of buttons) b.style.fontWeight = b.dataset.view === current ? 'bold' : '';
      };
      onSpellingChange(render);
      const show = async (view: string) => {
        if (!session) return;
        current = view;
        await session.edit(docFor(view), `view ${view}`);
        render();
      };
      const buttons = (base.views ?? []).map((v) => {
        const b = h('button', { onclick: () => void show(v.id) }, v.label ?? v.id) as HTMLButtonElement;
        b.dataset.view = v.id;
        return b;
      });
      const play = h('button', {}, 'Play tour') as HTMLButtonElement;
      play.addEventListener('click', async () => {
        const tour = base.tours?.[0];
        if (!tour || playing) return;
        playing = true;
        // the view buttons wait for the tour; the tour stops when the story is gone (unmounted)
        for (const b of [...buttons, play]) b.disabled = true;
        try {
          for (const step of tour.steps) {
            if (!root.isConnected) return;
            caption.textContent = step.caption ?? '';
            await show(step.view);
            await new Promise((r) => setTimeout(r, step.duration ?? 2000));
          }
          caption.textContent = '';
        } finally {
          for (const b of [...buttons, play]) b.disabled = false;
          playing = false;
        }
      });

      const viewer = RealViewerStory({
        spec: (s) => s,
        style: 'height:100%',
        setup: async (v) => {
          session = new MesoSession(
            docFor(current),
            { resolvers: DefaultResolvers, load: (id) => BetaCellResources[id]?.() },
            new PrismMesoAdapter(v),
          );
          await session.start();
          render();
        },
      });
      const root = h(
        'div',
        { style: `${Styles.grid};grid-template-columns:1fr 1fr 1.6fr;grid-template-rows:auto 1.2fr 1fr` },
        h(
          'div',
          { style: 'grid-column:1 / 4' },
          panel(
            'β-cell: views framed by address, and a tour',
            h('div', {}, h('div', { style: Styles.bar }, ...buttons, play), caption),
          ),
        ),
        panel('The view (what the author wrote)', viewPre),
        panel('Its camera, materialized (Å, world frame)', camPre),
        panel('Mol* / Prism', h('div', { style: 'flex:1;min-height:0;position:relative' }, viewer)),
        panel('Issues', issues),
        h(
          'div',
          { style: 'grid-column:2 / 4;display:contents' },
          panel('Edits: a view switch reruns nothing', history, 'grid-column:2 / 4'),
        ),
      );
      return root;
    }),
};
