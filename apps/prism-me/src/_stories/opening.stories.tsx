/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { story } from '@molstar/prism-ui/testing/index';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { PanelFrames } from './frames.js';

// Opening (ui.md §2), the explorer (apps/prism-me/_spec/ui.md), Prism UI over a scene made in memory: no viewer, no
// plugin. The reference the app is held to (architecture.md §7.6); each story in light and dark, wide and narrow.

const meta: Meta = { title: 'Explorer/Opening' };
export default meta;

/** ui.md §2: the tree empty, a short line in its place with the formats. */
export const Empty: StoryObj = {
  render: () => story(() => <PanelFrames roots={[]} height={360} />),
};

/** ui.md §2: + Open at the top of the tree: Files…, an id…, Examples…, Session…. */
export const Open: StoryObj = {
  render: () => story(() => <PanelFrames roots={[]} height={360} menu="open" />),
};
