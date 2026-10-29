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

// What the cellVIEW evaluation proposes (apps/prism-me/TODO.md, Proposed; progress/2026-10-28-cellview-evaluation.md),
// in the explorer's four places, for Ludo to judge before any brief: not decided, so apart from the decided mocks. The
// previews draw cellVIEW's rules (_spec/cellview.md §4) on a 2D slice of dots: change a control, see what it keeps.

const meta: Meta = { title: 'Explorer/Proposed (cellVIEW)' };
export default meta;

const scene = () => fullScene(2400, true);

/**
 * Items b and e: a plane clip graded per part. Each compartment ignores it, keeps a layer on its face, is cut, or is cut
 * wider; a layer or a wider cut has a band (Å) and fuzziness (it thins out toward the band's edge, the same instances
 * every frame). Click a part's name to preview it; Ghosts outlines what the cut removes.
 */
export const GradedCut: StoryObj = {
  render: () => story(() => <PanelFrames roots={scene()} picked="k:hiv:1" proposed split={860} height={1080} />),
};

/**
 * Item f: the aperture cut (cellVIEW's visibility equalizer). What is in front of the chosen parts is removed, most at
 * their outline's middle; near the edge, a share is kept. The preview is the screen.
 */
export const ApertureCut: StoryObj = {
  render: () => story(() => <PanelFrames roots={scene()} picked="k:hiv:2" proposed split={520} height={740} />),
};

/** The clips as rows under their model: the graded plane clip says how many parts it cuts, the aperture onto what. */
export const ClipRows: StoryObj = {
  render: () =>
    story(() => <PanelFrames roots={scene()} picked="k:hiv:2" open={['c:particles', 'o:hiv']} proposed split={160} />),
};

/** With item b: a part shown in part (Look › Shown): a share of its instances, the same ones at every share. */
export const ShownInPart: StoryObj = {
  render: () => story(() => <PanelFrames roots={scene()} picked="g:hiv:capsid.surface" proposed split={360} />),
};

/** Item d: a part's right-click with Show only this, its group, its compartment; Show all again. */
export const ShowOnly: StoryObj = {
  render: () =>
    story(() => <PanelFrames roots={scene()} picked="me:hiv:4" menu="row" proposed height={460} split={120} />),
};

/** Item f: Add clip… with the aperture: open the view onto the picked part. */
export const AddAperture: StoryObj = {
  render: () =>
    story(() => (
      <PanelFrames roots={scene()} picked="g:hiv:capsid.surface" menu="clip" proposed height={420} split={120} />
    )),
};

/** Item e: a clip's right-click with Outline what it cuts (its ghosts). */
export const ClipMenu: StoryObj = {
  render: () =>
    story(() => <PanelFrames roots={scene()} picked="k:hiv:1" menu="row" proposed height={420} split={120} />),
};
