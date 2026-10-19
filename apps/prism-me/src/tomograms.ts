/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { sliceVisuals } from '@molstar/cryoet-extension/operations';
import type { PluginSpec } from '@molstar/plugin/spec';
import { Ccp4Provider } from '@molstar/plugin/state/formats/volume/ccp4';

// A volume dropped on the explorer is a tomogram first (_spec/ui.md, Volumes): it opens as its three slices (x, y, z,
// the middle ones), not an isosurface (one is added from its properties). The CCP4 / MRC format (.mrc, .map, .rec,
// .st, .ali, .mrcs) is given these visuals: a copy of its provider in the same place, so formats are told apart as before.

const TomogramCcp4Provider = { ...Ccp4Provider, visuals: sliceVisuals };

/** The plugin spec with the CCP4 / MRC format's visuals being the three slices */
export function withTomogramSlices(spec: PluginSpec): PluginSpec {
  if (!spec.registry) return spec;
  return {
    ...spec,
    registry: spec.registry.map((entry) =>
      entry.formats?.includes(Ccp4Provider)
        ? { ...entry, formats: entry.formats.map((f) => (f === Ccp4Provider ? TomogramCcp4Provider : f)) }
        : entry,
    ),
  };
}
