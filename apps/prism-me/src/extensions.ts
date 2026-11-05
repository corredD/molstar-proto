/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { CryoetExtension } from '@molstar/cryoet-extension/prism-viewer';
import { EmpiarExtension } from '@molstar/cryoet-extension/empiar';
import { CryoetPortalExtension, type PortalIndexSource } from '@molstar/cryoet-extension/portal';
import type { PortalCatalog, PortalDataset } from '@molstar/cryoet-extension/portal-index';
import { MesoscaleExtension } from '@molstar/mesoscale-extension/prism-viewer';
import { ExplorerExtension } from './explorer/extension.js';
import type { LazyViewerExtension, ViewerExtension } from '@molstar/prism-viewer/spec';
import { StageToolsExtension } from '@molstar/stage-tools-extension/prism-viewer';

/**
 * The CryoET Data Portal's index the explorer ships (`portal/`, written by tools/portal-index): each file a chunk of
 * its own, loaded when first asked for, so the published site needs no server and no copy step
 */
const portalFile = async <T>(name: string): Promise<T> =>
  (await import(`../portal/${name}.json`, { with: { type: 'json' } })).default as T;

export const PortalIndex: PortalIndexSource = {
  catalog: () => portalFile<PortalCatalog>('index'),
  dataset: (id) => portalFile<PortalDataset>(String(id)),
};

/**
 * The extensions the Mesoscale Explorer adds to the Prism viewer with Mol*'s extensions (`FullPrismViewerSpec`):
 * mesoscale models, cryo-ET data (the CryoET Data Portal's, EMPIAR's by id) and the stage tools (_spec/README.md).
 */
export const MesoscaleExplorerExtensions: readonly (ViewerExtension | LazyViewerExtension)[] = [
  MesoscaleExtension,
  CryoetExtension,
  CryoetPortalExtension(PortalIndex),
  EmpiarExtension,
  StageToolsExtension,
  ExplorerExtension,
];
