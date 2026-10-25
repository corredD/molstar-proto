/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { story } from '@molstar/prism-ui/testing/index';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { fullScene } from './fake-scene.js';
import { Frames, Layout } from './frames.js';

// The explorer's layout as ui.md §1 draws it (apps/prism-me/_spec/ui.md), Prism UI over a scene made in memory: no viewer, no
// plugin. The reference the app is held to (architecture.md §7.6); each story in light and dark, wide and narrow.

const meta: Meta = { title: 'Explorer/Layout' };
export default meta;

/** ui.md §1: one panel pinned on the right (the tree above the properties, a split between), the rail's two buttons. */
export const Layout_: StoryObj = {
  name: 'Layout',
  render: () =>
    story(() => (
      <Frames
        widths={[1100, 720]}
        height={560}
        render={(w) => <Layout width={w} panel={{ roots: fullScene(), picked: 'o:1crn', folded: true }} />}
      />
    )),
};
