/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { story } from '@molstar/prism-ui/testing/index';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { fullScene } from './fake-scene.js';
import { PanelFrames } from './frames.js';

// The tree (apps/prism-me/_spec/ui.md §3) over a scene made in memory: four categories, eyes, color dots, counts, a
// row's actions on hover; click picks, double click focuses, right-click opens its menu, the arrows move (Prism's
// `TreeNavigation`). Each story in light and dark, wide and narrow.

const meta: Meta = { title: 'Explorer/Tree' };
export default meta;

/** ui.md §3: the four categories, each object under its own; what is opened only. */
export const Loaded: StoryObj = {
  render: () => story(() => <PanelFrames roots={fullScene()} open={['c:structures', 'c:particles', 'c:volumes']} />),
};

/**
 * ui.md §3: a model of 2,400 entities, opened down to a group of 480: virtualized (only a screenful is made), its parts
 * made when first opened. Grouped by compartment, its default.
 */
export const ThousandsOfEntities: StoryObj = {
  render: () => story(() => <PanelFrames roots={fullScene()} picked="me:hiv:4" split={200} />),
};

/** ui.md §3, §4 Group by: the same model by function (its rows only remade; a view state, no step). */
export const GroupedByFunction: StoryObj = {
  render: () =>
    story(() => (
      <PanelFrames roots={fullScene()} picked="o:hiv" groupBy="function" open={['c:particles', 'o:hiv']} split={200} />
    )),
};

/** ui.md §3, §5, §7: a clip and a label as rows under their model, a distance under its first point's row. */
export const MadeAtNodes: StoryObj = {
  render: () =>
    story(() => (
      <PanelFrames
        roots={fullScene()}
        picked="d:1"
        open={['c:structures', 'c:particles', 'o:1crn', 'e:1crn:1', 'ch:1crn:A', 'o:hiv']}
        split={200}
      />
    )),
};

/** styling.md §4: a row's actions (eye, ⋯) always shown on touch (`@media (hover: none)`); on a mouse, on hover. */
export const Touch: StoryObj = {
  render: () => story(() => <PanelFrames roots={fullScene()} picked="t:star:1" touch split={200} />),
};
