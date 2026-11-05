/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { EmpiarPanel, type EmpiarPanelArea, type EmpiarPanelContext } from '@molstar/cryoet-extension/empiar-card';
import {
  type EmpiarAsk,
  type ListingRow,
  listingBytes,
  readEmpiarEntry,
  walkCondition,
  walkGrid,
} from '@molstar/cryoet-extension/empiar-entry';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import { story } from '@molstar/prism-ui/testing/index';
import type { Meta, StoryObj } from '@storybook/web-components-vite';

// The EMPIAR card (+ Open › EMPIAR id…; extensions/cryoet/_spec/empiar.md §4) over a few folders of EMPIAR-12534 as its
// API and listings give them (2026-11-04), no viewer and no network: Load asks first, then answers what it would load.

const meta: Meta = { title: 'Explorer/EMPIAR' };
export default meta;

const set = (directory: string, category: string, name: string, pixel: number) => ({
  directory,
  category,
  name,
  pixel_width: pixel,
});
const entry = readEmpiarEntry(12534, {
  'EMPIAR-12534': {
    title: 'Cytoplasmic ribosomes on mitochondria alter the local membrane environment for protein import',
    cross_references: [{ name: 'EMD-48752' }, { name: 'EMD-48751' }],
    imagesets: [
      set(
        'data/EMPIAR_upload/Reconstructed_tomograms',
        'reconstructed volumes',
        'Reconstructed tomograms of CHX-treated S. cerevisiae lamellae',
        9.98,
      ),
      set('data/EMPIAR_upload/Tilt_series', 'tilt series', 'Unaligned tilt series stacks, CHX-treated', 1.663),
      set(
        'data/EMPIAR_upload_nonCHX/Reconstructed_tomograms',
        'reconstructed volumes',
        'Reconstructed tomograms of vehicle-treated S. cerevisiae lamellae',
        15.83,
      ),
    ].map((s, i) => (i === 0 ? { ...s, segmentations: [{ file: 'data/EMPIAR_upload/Voxel_segmentations' }] } : s)),
  },
});

const runs = ['YTC041_1_lam1_1_ts_003', 'YTC041_1_lam1_2_ts_002', 'YTC041_1_lam4_1_ts_002'];
const folder = (name: string): ListingRow => ({ name, folder: true, size: '' });
const file = (name: string, size: string): ListingRow => ({ name, folder: false, size, bytes: listingBytes(size) });
const grids = ['YTC041_1', 'YTC041_2'];
const rows: Record<string, readonly ListingRow[]> = {
  'data/EMPIAR_upload': [
    'Frames',
    'Particle_lists',
    'Reconstructed_tomograms',
    'Surfaces',
    'Tilt_series',
    'Voxel_segmentations',
  ].map(folder),
  'data/EMPIAR_upload/Particle_lists': [
    file('80S_ribosome_CHX.star', '12M'),
    file('co-translation_ribosome_CHX.star', '493K'),
  ],
  'data/EMPIAR_upload/Reconstructed_tomograms': grids.map(folder),
  'data/EMPIAR_upload/Surfaces': grids.map(folder),
  'data/EMPIAR_upload/Tilt_series': grids.map(folder),
  'data/EMPIAR_upload/Voxel_segmentations': grids.map(folder),
  'data/EMPIAR_upload/Reconstructed_tomograms/YTC041_1': runs.map((r) => file(`${r}.mrc_9.98Apx.mrc`, '834M')),
  'data/EMPIAR_upload/Surfaces/YTC041_1': runs.map((r) => file(`${r}_labels.hff`, '3.8M')),
  'data/EMPIAR_upload/Tilt_series/YTC041_1': runs.map((r) => file(`${r}.mrc.st`, '3.3G')),
  'data/EMPIAR_upload/Voxel_segmentations/YTC041_1': runs.map((r) => file(`${r}_labels.mrc`, '417M')),
  'data/EMPIAR_upload_nonCHX': [folder('Reconstructed_tomograms')],
  'data/EMPIAR_upload_nonCHX/Reconstructed_tomograms': [folder('YTC009_3'), folder('YTC025_2')],
};
const listing = (f: string) =>
  new Promise<readonly ListingRow[]>((done, fail) =>
    setTimeout(
      () => (rows[f] ? done(rows[f]) : fail(new Error(`Could not read the folder ${f}: 404 (not in the story)`))),
      150,
    ),
  );

const area: EmpiarPanelArea = {
  entry: async () => entry,
  condition: (_, root) => walkCondition(entry, root, listing),
  grid: async (_, root, grid) => walkGrid(entry, await walkCondition(entry, root, listing), grid, listing),
  asked: observableState<EmpiarAsk | undefined>({ id: 12534, run: 'YTC041_1_lam1_1_ts_003' }).asReadonly,
};

const ctx: EmpiarPanelContext = {
  api: {
    run: (_, values) =>
      new Promise((done) =>
        setTimeout(
          () =>
            done(
              values.large
                ? { ok: true, did: `Would load EMPIAR-12534 ${values.run}: ${values.files}.` }
                : { ok: false, code: 'confirm', message: `${values.run}: 1.3 GB to read whole.` },
            ),
          400,
        ),
      ),
  },
};

const Card = (props: { width: number }) => (
  <div style={`width: ${props.width}px; padding-top: var(--msp-space-3); background: var(--msp-color-surface)`}>
    <EmpiarPanel ctx={ctx} area={area} />
  </div>
);

/** `?empiar=12534&empiar-run=YTC041_1_lam1_1_ts_003`: the run's files with sizes (checked: the default load), the surfaces and tilt series greyed with why */
export const Narrow: StoryObj = { name: 'Card', render: () => story(() => <Card width={340} />) };

/** The same, wide: the file names on one line */
export const Wide: StoryObj = { name: 'Card, wide', render: () => story(() => <Card width={560} />) };
