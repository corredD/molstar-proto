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
 * Clips in a category of their own, after the others (Ludo, 2026-10-28): every clip of the scene, each saying how many
 * objects or parts it affects; no clip row under an object any more.
 */
export const ClipsCategory: StoryObj = {
  render: () =>
    story(() => <PanelFrames roots={scene()} picked="k:1" open={['c:particles', 'c:clips']} proposed split={160} />),
};

/**
 * Items b and e: a clip says what it cuts, each object or part its way: keeps a layer on the cut's face, cuts it, or
 * cuts it wider; a layer or a wider cut has a band (Å) and fuzziness (it thins out toward the band's edge, the same
 * instances every frame). Cut also adds one; × takes one off. Click a name to preview it; Ghosts outlines what is removed.
 */
export const GradedCut: StoryObj = {
  render: () => story(() => <PanelFrames roots={scene()} picked="k:1" proposed split={820} height={1040} />),
};

/**
 * An object's or part's Clips points at the clips (Ludo, 2026-10-28): the clips on it, each what it does to it; New
 * clip makes one that cuts it, Use a clip gives it one of the scene's. Here the membrane, which the plane clip keeps a
 * layer of.
 */
export const PartClips: StoryObj = {
  render: () =>
    story(() => <PanelFrames roots={scene()} picked="g:hiv:envelope.membrane" proposed split={460} height={760} />),
};

/** An object no clip is on: its Clips offers a new clip, or one of the scene's. */
export const ObjectWithoutClips: StoryObj = {
  render: () => story(() => <PanelFrames roots={scene()} picked="o:1crn" proposed split={420} height={720} />),
};

/**
 * Item f: the aperture cut (cellVIEW's visibility equalizer), a clip of the Clips category too. What is in front of the
 * chosen parts is removed, most at their outline's middle; near the edge, a share is kept. The preview is the screen.
 */
export const ApertureCut: StoryObj = {
  render: () => story(() => <PanelFrames roots={scene()} picked="k:3" proposed split={520} height={740} />),
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

/** Item f: Add clip… (the scissors, the right-click) with the aperture: open the view onto the picked part. */
export const AddAperture: StoryObj = {
  render: () =>
    story(() => (
      <PanelFrames roots={scene()} picked="g:hiv:capsid.surface" menu="clip" proposed height={420} split={120} />
    )),
};

/** Item e: a clip's right-click with Outline what it cuts (its ghosts). */
export const ClipMenu: StoryObj = {
  render: () => story(() => <PanelFrames roots={scene()} picked="k:1" menu="row" proposed height={420} split={120} />),
};

/**
 * Every row's eye in view; a parent's eye sets every row under it, all the way down (Ludo, 2026-10-28): hide the model,
 * then show one of its groups or entities alone. As in C4D, press an eye and drag along the column: every row passed
 * takes the first one's new state. A row's color dot opens its colors.
 */
export const Eyes: StoryObj = {
  render: () =>
    story(() => (
      <PanelFrames
        roots={scene()}
        picked="g:hiv:envelope.membrane"
        open={['c:particles', 'o:hiv', 'g:hiv:envelope', 'g:hiv:capsid', 'c:clips']}
        proposed
        split={160}
      />
    )),
};

/**
 * A row's ⋯ (Ludo, 2026-10-28): every row shows only its eye and its ⋯; the ⋯ holds the other tools (Color…, Add clip…,
 * Remove) with the right-click's items. Here a model's.
 */
export const MoreMenu: StoryObj = {
  render: () =>
    story(() => (
      <PanelFrames roots={scene()} picked="o:hiv" open={['c:particles']} menu="row" proposed height={460} split={120} />
    )),
};

/** A category's ⋯: its color theme, a clip of every object in it. */
export const CategoryMenu: StoryObj = {
  render: () =>
    story(() => <PanelFrames roots={scene()} picked="c:particles" menu="row" proposed height={420} split={120} />),
};
