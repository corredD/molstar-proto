/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { story } from '@molstar/prism-ui/testing/index';
import { RealViewerStory } from '@molstar/prism-viewer/testing/real-viewer';
import { tiledFixture } from '@molstar/meso-spec/examples/streaming';
import type { MesoViewSpecDoc } from '@molstar/meso-spec/format/doc';
import { DefaultResolvers } from '@molstar/meso-spec/resolvers/index';
import type { RendererAdapter } from '@molstar/meso-spec/runtime/adapter';
import { PrismMesoAdapter } from '../prism-adapter.js';
import { MesoSession } from '../session.js';
import { h, panel, pre, showHistory, showIssues, Styles } from './ui.js';

// Streaming (design.md §6.8): the scene opens at level 0 (the manifest's counts and envelopes, no copies). A view steps
// the semantic camera; the streamer plans the tiles around the focus within the copy budget, loads them (a delayed
// provider, so it shows), evicts the ones left behind, and the panel follows every commit, loads settling included.

const meta: Meta = { title: 'Streaming', parameters: { layout: 'fullscreen' } };
export default meta;

const Budget = 3000;

export const TiledScene: StoryObj = {
  render: () =>
    story(() => {
      const { doc, provider } = tiledFixture({ delayMs: 400 });
      const stats = pre();
      const level0 = pre();
      const issues = h('div');
      const history = h('div');
      const caption = h('div', { style: 'padding:6px 8px;font-style:italic;min-height:1.4em' });
      let session: MesoSession | undefined;
      let playing = false;

      const render = () => {
        if (!session?.streamer) return;
        const s = session.streamer.stats();
        stats.textContent = [
          `tiles requested ${s.requested}   loaded ${s.loaded}   evicted ${s.evicted}   cancelled ${s.cancelled}   failed ${s.failed}`,
          `resident ${s.resident} / ${s.tiles} tiles   in flight ${s.inFlight}`,
          `loaded copies ${s.copies} / budget ${s.budget}${s.copies > s.budget ? '   OVER BUDGET' : ''}`,
        ].join('\n');
        level0.textContent = [
          `level 0 stands for ${s.level0Copies} copies in ${s.tiles} tiles`,
          ...Object.entries(session.counts).map(([p, c]) => `${p}: ${c.achieved} (requested ${c.requested})`),
        ].join('\n');
        showIssues(issues, session.issues);
        showHistory(history, session.history);
      };

      const buttons = (doc.views ?? []).map((v) => {
        const b = h('button', { onclick: () => void show(v.id) }, v.label ?? v.id) as HTMLButtonElement;
        return b;
      });
      // the scene opens at level 0 (budget 0): the first view or tour switches the budget on
      let streaming = false;
      const startStreaming = async () => {
        streaming = true;
        await session?.setBudget(Budget);
      };
      const show = async (view: string) => {
        if (!session) return;
        if (!streaming) await startStreaming();
        await session.edit((d: MesoViewSpecDoc) => ({ ...d, session: { ...d.session, view } }), `view ${view}`);
        render();
      };
      const level0Only = h(
        'button',
        {
          onclick: async () => {
            streaming = false;
            await session?.setBudget(0);
            render();
          },
        },
        'Back to level 0',
      ) as HTMLButtonElement;
      const play = h('button', {}, 'Play tour') as HTMLButtonElement;
      play.addEventListener('click', async () => {
        const tour = doc.tours?.[0];
        if (!tour || playing) return;
        playing = true;
        // the view buttons wait for the tour; the tour stops when the story is gone (unmounted)
        for (const b of [...buttons, play, level0Only]) b.disabled = true;
        try {
          for (const step of tour.steps) {
            if (!root.isConnected) return;
            caption.textContent = step.caption ?? step.view;
            await show(step.view);
            // loads settle on their own and queue stream steps: give them time to land before the next view
            await new Promise((r) => setTimeout(r, step.duration ?? 2500));
          }
          caption.textContent = 'tour done';
        } finally {
          for (const b of [...buttons, play, level0Only]) b.disabled = false;
          playing = false;
        }
      });

      const viewer = RealViewerStory({
        spec: (s) => s,
        style: 'height:100%',
        setup: async (v) => {
          const prism = new PrismMesoAdapter(v);
          // every commit, a view's or a settled load's, updates the panel
          const adapter: RendererAdapter = {
            id: prism.id,
            async commit(ir) {
              const report = await prism.commit(ir);
              queueMicrotask(render);
              return report;
            },
            dispose: () => prism.dispose(),
          };
          session = new MesoSession(
            doc,
            { resolvers: DefaultResolvers, tiles: () => provider, stream: { budget: { copies: 0 } } },
            adapter,
          );
          await session.start();
          render();
        },
      });
      const root = h(
        'div',
        { style: `${Styles.grid};grid-template-columns:1fr 1.4fr;grid-template-rows:auto 1fr 1fr` },
        h(
          'div',
          { style: 'grid-column:1 / 3' },
          panel(
            'Tiled fixture: level 0 first, copies stream in around the camera',
            h('div', {}, h('div', { style: Styles.bar }, ...buttons, play, level0Only), caption),
          ),
        ),
        h(
          'div',
          { style: 'display:flex;flex-direction:column;gap:8px;min-height:0' },
          panel('Stream', stats),
          panel('Level 0 (the manifest)', level0),
          panel('Issues', issues),
        ),
        panel('Mol* / Prism', h('div', { style: 'flex:1;min-height:0;position:relative' }, viewer)),
        panel('Edits and stream steps', history, 'grid-column:1 / 3'),
      );
      // the session's loads end with the story
      let mounted = false;
      new MutationObserver((_, o) => {
        if (root.isConnected) mounted = true;
        else if (mounted) {
          session?.dispose();
          o.disconnect();
        }
      }).observe(document.body, { childList: true, subtree: true });
      return root;
    }),
};
