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

// The properties of the picked row (apps/prism-me/_spec/ui.md §4), one story per row kind: only the sections that
// apply, opened here to be seen (the app starts them folded). Prism's `SectionList`, `ParamsForm`, `Choices`, `Select`,
// `Slider`, `TextInput`; nothing applies (no viewer).

const meta: Meta = { title: 'Explorer/Properties' };
export default meta;

const at = (picked: string, note?: { groupBy?: 'function' }): StoryObj => ({
  render: () => story(() => <PanelFrames roots={fullScene()} picked={picked} split={460} {...note} />),
});

/** A category: Look (its eye and a color theme for every object under it), Clips (the cuts its scissors made). */
export const Category = at('c:particles');
/** A structure: Look, Representation, Position, Clips, Labels, Graphics & Motion. */
export const Structure = at('o:1crn');
/** A structure's entity: Look, Representation, Clips, Labels (no Position: a part). */
export const Entity = at('e:1crn:1');
/** A cellPACK model: Group by above the sections; Look with Generate colors, Decoration, Representation, … */
export const Model = at('o:hiv');
/** A model's group: Look with Generate colors, Clips, Labels. */
export const Group = at('g:hiv:capsid');
/** A particle list: Representation (spheres or the decorating objects), Decoration (targets by class), … */
export const ParticleList = at('o:star');
/** A list's target: Look, Decoration, Clips, Labels. */
export const Target = at('t:star:1');
/** A volume: Representation, Slice (axis, position, contrast), Position, Graphics (quality only: no motion). */
export const Volume = at('o:tomo');
/** A volume's slice: Look, Slice, Clips, Labels. */
export const Slice = at('r:tomo:z');
/** A volume's isosurface: Look, Representation, Clips, Labels. */
export const Isosurface = at('r:tomo:iso');
/** A mesh: Look, Representation (surface, wireframe, both), Position, Clips, Labels (no Graphics & Motion). */
export const Mesh = at('o:mesh');
/** A clip's row: its handles, shape, invert, its place, turn and size on demand, On top, remove (ui.md §4). */
export const Clip = at('k:hiv:1');
/** A label's row: its text, size, color, plate, tether, remove (ui.md §5). */
export const Label = at('l:hiv:1');
/** A distance's row: its value, its two points, text size and line width (0.1–100, log), opacity (ui.md §7). */
export const Distance = at('d:1crn:1');
