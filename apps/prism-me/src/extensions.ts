/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { CryoetExtension } from '@molstar/cryoet-extension/prism-viewer';
import { MesoscaleExtension } from '@molstar/mesoscale-extension/prism-viewer';
import { ExplorerExtension } from './explorer/extension.js';
import type { LazyViewerExtension, ViewerExtension } from '@molstar/prism-viewer/spec';
import { StageToolsExtension } from '@molstar/stage-tools-extension/prism-viewer';

/**
 * The extensions the Mesoscale Explorer adds to the Prism viewer with Mol*'s extensions (`FullPrismViewerSpec`):
 * mesoscale models, cryo-ET data and the stage tools (_spec/README.md).
 */
export const MesoscaleExplorerExtensions: readonly (ViewerExtension | LazyViewerExtension)[] = [
  MesoscaleExtension,
  CryoetExtension,
  StageToolsExtension,
  ExplorerExtension,
];
