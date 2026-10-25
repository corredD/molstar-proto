/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { story } from '@molstar/prism-ui/testing/index';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { fullScene } from './fake-scene.js';
import { Frames, Layout, PanelFrames } from './frames.js';

// Distances (apps/prism-me/_spec/ui.md §7): made by two ⌘/Ctrl+clicks in selection mode, the status line naming the
// platform's gesture; the distance's row under its first point's, its properties, its right-click.

const meta: Meta = { title: 'Explorer/Distances' };
export default meta;

const Open = ['c:structures', 'o:1crn', 'e:1crn:1', 'ch:1crn:A'];

/** A first point picked: its row picked, the status line says what the next ⌘+click does. */
export const FirstPoint: StoryObj = {
  render: () =>
    story(() => (
      <Frames
        widths={[1100, 720]}
        height={520}
        render={(w) => (
          <Layout
            width={w}
            status="CYS 3 (A) is the first point: ⌘+click a second to measure (Esc lets it go)"
            panel={{ roots: fullScene(), picked: 'ch:1crn:A', open: Open, split: 160 }}
          />
        )}
      />
    )),
};

/** The distance made: "Distance 10.67 Å" under its first point's row, picked, its properties below. */
export const Made: StoryObj = {
  render: () => story(() => <PanelFrames roots={fullScene()} picked="d:1crn:1" open={Open} split={300} />),
};

/** Its right-click (on the row or the line): Focus, Hide, Remove. */
export const Menu: StoryObj = {
  render: () =>
    story(() => <PanelFrames roots={fullScene()} picked="d:1crn:1" open={Open} menu="row" height={420} split={120} />),
};
