/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { PluginContext } from '@molstar/plugin/context';
import { MmcifParticlesProvider } from '@molstar/plugin/state/formats/particles/mmcif-assembly';
import { type ParticleFormatData, complexVisuals } from '@molstar/plugin/state/formats/particles/provider';
import { withColorLevels } from './operations.js';

// cellPACK and PetWorld files (`mmcif_particles`) with colors that follow the zoom from their load (apps/prism-me/
// _spec/ui.md §4 Look): the same format, its visuals' targets made with the levels on (the defaults) in the one build.
// The params given are partial; the state fills the target type's others with their defaults (`normalizeParams`).
// Imported where the particles feature loads (it registers the format), so it stays out of the first chunk.

const targetParams = withColorLevels({ params: { structure: {} } }, true).params;

/** The mmCIF particles format with its targets' colors following the zoom at load */
export const ZoomColorsMmcifParticlesProvider: typeof MmcifParticlesProvider = {
  ...MmcifParticlesProvider,
  visuals: (plugin: PluginContext, data: ParticleFormatData) => complexVisuals(plugin, data, { params: targetParams }),
};
