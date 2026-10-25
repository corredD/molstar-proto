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

// The right-click (apps/prism-me/_spec/ui.md §5), one story per pick kind, opened as the story shows (Prism's
// `openContextMenu`): the same menu on the canvas and on a row, at the level of what is picked. A row's ⋯ and its
// right-click open it too.

const meta: Meta = { title: 'Explorer/Right-click' };
export default meta;

const on = (picked: string, menu: 'row' | 'clip' = 'row'): StoryObj => ({
  render: () => story(() => <PanelFrames roots={fullScene()} picked={picked} menu={menu} height={420} split={120} />),
});

/** An object: Focus, Move, Rotate, Add label, Add clip…. */
export const WholeObject = on('o:1crn');
/** A model's group: Move and Rotate greyed (ui.md §5 [to decide]: the whole object, or only the part). */
export const Group = on('g:hiv:capsid');
/** A model's entity, as a group. */
export const ModelEntity = on('me:hiv:4');
/** A structure's chain, as a part. */
export const Chain = on('ch:1crn:A');
/** A list's target, as a part. */
export const Target = on('t:star:1');
/** Add clip…: its shapes, a plane, sphere or box, for that node. */
export const AddClip = on('o:hiv', 'clip');
/** A clip (its guide in 3D, or its row): Move, Rotate, Size, Flip, Hide, Remove. */
export const Clip = on('k:hiv:1');
/** A label: Move, Rotate, Edit text, Hide, Remove. */
export const Label = on('l:hiv:1');
