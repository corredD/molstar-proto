/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describePortalRun } from '@molstar/cryoet-extension/portal';
import type { PortalCatalog, PortalDataset } from '@molstar/cryoet-extension/portal-index';
import { PortalPanel, type PortalPanelArea, type PortalPanelContext } from '@molstar/cryoet-extension/portal-ui';
import { ApiResult } from '@molstar/prism-viewer/api/area';
import { story } from '@molstar/prism-ui/testing/index';
import type { Meta, StoryObj } from '@storybook/web-components-vite';

// The CryoET Data Portal's card (+ Open › CryoET Data Portal…; extensions/cryoet/_spec/portal.md §4) over the index the
// explorer ships (10003, 10453, 10524), no viewer: Load answers after a moment with what it would load.

const meta: Meta = { title: 'Explorer/CryoET Data Portal' };
export default meta;

const file = async <T,>(name: string): Promise<T> =>
  (await import(`../../portal/${name}.json`, { with: { type: 'json' } })).default as T;

function area(reads: (format: string) => boolean): PortalPanelArea {
  return {
    catalog: () => file<PortalCatalog>('index'),
    dataset: (id) => file<PortalDataset>(String(id)),
    describe: (ds, run, spacing) => describePortalRun(reads, ds, run, spacing),
  };
}

const ctx: PortalPanelContext = {
  api: {
    run: (_, values) =>
      new Promise((done) =>
        setTimeout(() => done(ApiResult.ok(`Would load ${values.dataset} ${values.run}: ${values.annotations}.`)), 600),
      ),
  },
};

const Card = (props: { reads: (format: string) => boolean }) => (
  <div style="width: 340px; padding-top: var(--msp-space-3); background: var(--msp-color-surface)">
    <PortalPanel ctx={ctx} area={area(props.reads)} />
  </div>
);

/** Every format read: dataset, run, level with its size, the annotations (the portal's defaults checked), Load */
export const Card10003: StoryObj = { name: 'Card', render: () => story(() => <Card reads={() => true} />) };

/** A viewer without a GLB reader: 10524's meshes say they need one, the rest loads */
export const WithoutAReader: StoryObj = {
  name: 'Card, a format not read',
  render: () => story(() => <Card reads={(f) => f !== 'glb'} />),
};
