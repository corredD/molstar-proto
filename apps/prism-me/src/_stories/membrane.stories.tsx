/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Color } from '@molstar/core/util/color';
import { ColorLevels } from '@molstar/graphics/geo/geometry/color-levels';
import { MembraneDetailControls, ZoomColors } from '@molstar/mesoscale-extension/controls';
import { DefaultCustomLevels, type MembraneMiddle } from '@molstar/mesoscale-extension/lipids/membrane';
import type { GraphicsInfo, MesoscaleApi } from '@molstar/mesoscale-extension/operations';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import { story } from '@molstar/prism-ui/testing/index';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
// the extensions' API augmentations (\`api.mesoscale\`, \`api.cryoet\`, \`api.stage\`) the app's Look is typed against
import type {} from '../extensions.js';
import { MembraneLook } from '../explorer/properties.js';
import { cellScene } from './fake-scene.js';
import { Frames, PanelFrames } from './frames.js';

// A lipid membrane in the explorer (apps/prism-me/_spec/ui.md §4, §5; lipid-procedural round 7): a cell's membranes
// wrapped as one, a row a part under it (its eye and colour dot); the membrane's own Look, the app's (`MembraneLook`,
// `ZoomColors {membrane}`) over a fake API made in memory: By zoom on, its edges Species and Atoms (no Chain), its Far
// colour and its Atoms' colours. Each story in light and dark, wide and narrow.

const meta: Meta = { title: 'Explorer/Membrane' };
export default meta;

const Ref = 'membrane';

/** The operations the Look runs, answered in memory: its graphics' state and its species' as they would follow */
function fakeApi(start: Partial<GraphicsInfo>, middle: MembraneMiddle = 'parallax') {
  // its detail (`membraneDetail`, round 8: Far, Middle, the px switches), a cut membrane's defaults
  const detail = observableState({
    detail: 'balanced',
    levels: DefaultCustomLevels,
    method: 'cutter',
    far: 'both',
    atomsPx: 2,
    spheresPx: 2,
    budget: 2_000_000,
    middle,
    middlePx: 11,
    shells: 8,
  });
  const membraneDetail = (p: Record<string, unknown>) => {
    const { membrane: _, ...patch } = p;
    detail.set({ ...detail.value, ...patch } as typeof detail.value);
    return Promise.resolve({ ok: true });
  };
  const graphics = observableState<GraphicsInfo | undefined>({
    colorLevels: ColorLevels.defaults,
    far: Color(0x7a9cc6),
    atomColors: 'element',
    ...start,
  });
  const species = observableState([
    { name: 'POPC', shown: true, shownColor: Color(0x6fa8dc) },
    { name: 'POPE', shown: true, shownColor: Color(0x93c47d) },
    { name: 'CHL1', shown: true, shownColor: Color(0xf6b26b) },
  ]);
  const colorLevels = (
    p: { on?: boolean; far?: string; atoms?: GraphicsInfo['atomColors']; meshColors?: boolean } & object,
  ) => {
    const g = graphics.value ?? {};
    const levels =
      p.on === false ? null : p.on === true ? (g.colorLevels ?? ColorLevels.defaults) : (g.colorLevels ?? null);
    const edges = Object.fromEntries(
      Object.entries(p).filter(([k]) => k === 'entity' || k === 'chain' || k === 'atom'),
    );
    graphics.set({
      ...g,
      colorLevels: levels ? { ...levels, ...edges } : null,
      ...(p.atoms ? { atomColors: p.atoms } : {}),
      ...(p.far ? { far: Color.fromHexStyle(p.far) } : {}),
      ...(p.meshColors !== undefined ? { meshColors: p.meshColors } : {}),
    });
    return Promise.resolve({ ok: true });
  };
  const mesoscale = {
    graphicsState: () => graphics.asReadonly,
    membraneSpeciesState: () => species.asReadonly,
    membraneDetailState: () => detail.asReadonly,
    membraneDetail,
    colorLevels,
  } as unknown as MesoscaleApi;
  const api = {
    mesoscale,
    run: (id: string, p: Record<string, unknown>) =>
      id === 'mesoscale.colorLevels' ? colorLevels(p) : Promise.resolve({ ok: true }),
  } as unknown as ViewerApi;
  return { api, mesoscale };
}

/**
 * ui.md §5: the cell's membranes as one, a row a part (`membrane part`): the PM coloured, the vacuole hidden. The mock
 * shows a part's Clips and Labels; the app shows none yet (TODO, review N5).
 */
export const PartsInTheTree: StoryObj = {
  render: () => story(() => <PanelFrames roots={cellScene()} open={['c:meshes', 'o:cell']} picked="mp:cell:PM" />),
};

/** ui.md §4: the membrane's Look, By zoom on: its edges Species and Atoms, then Far and Atoms (by element). */
export const LookByZoom: StoryObj = {
  render: () =>
    story(() => <Frames height={260} render={() => <MembraneLook api={fakeApi({}).api} membrane={Ref} />} />),
};

/** ui.md §4: its atoms' carbons by species (the classic lipid look), its far colour set. */
export const LookCarbonsBySpecies: StoryObj = {
  render: () =>
    story(() => (
      <Frames
        height={260}
        render={() => (
          <MembraneLook api={fakeApi({ atomColors: 'carbon-species', far: Color(0xff6347) }).api} membrane={Ref} />
        )}
      />
    )),
};

/** ui.md §5 (round 9): a cell's membranes, its colours from its meshes (Colours from meshes, on by default). */
export const LookColoursFromMeshes: StoryObj = {
  render: () =>
    story(() => (
      <Frames height={300} render={() => <MembraneLook api={fakeApi({ meshColors: true }).api} membrane={Ref} />} />
    )),
};

/** `ZoomColors {membrane}` alone: By zoom on, two edges (Species, Atoms), no Chain. */
export const ZoomColorsMembrane: StoryObj = {
  render: () =>
    story(() => (
      <Frames height={140} render={() => <ZoomColors area={fakeApi({}).mesoscale} particles={Ref} membrane />} />
    )),
};

/**
 * ui.md §4 (round 8): the cutter's far look, Far Both, Middle Coarse: its sphere levels down to Lipids down to, the
 * budget.
 */
export const DetailMiddleCoarse: StoryObj = {
  render: () =>
    story(() => (
      <Frames height={200} render={() => <MembraneDetailControls area={fakeApi({}).mesoscale} membrane={Ref} />} />
    )),
};

/**
 * ui.md §4 (round 8): Middle Parallax: its atoms down to Atoms down to (9 at least), a cut's lipids down to Cut lipids
 * down to (the cut band, the gate's M1), the budget.
 */
export const DetailMiddleParallax: StoryObj = {
  render: () =>
    story(() => (
      <Frames
        height={220}
        render={() => <MembraneDetailControls area={fakeApi({}, 'parallax').mesoscale} membrane={Ref} />}
      />
    )),
};
