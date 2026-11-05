/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { PluginRegistryEntry } from '@molstar/plugin/spec';
import type { DataFormatProvider } from '@molstar/plugin/state/formats/provider';
import { isLazyExtension, type LazyViewerExtension, type ViewerExtension } from '@molstar/prism-viewer/spec';

/** The registry with the format `from` given as `to`, in the same place: formats are told apart as before */
export function replaceFormat(
  registry: readonly PluginRegistryEntry[],
  from: DataFormatProvider,
  to: DataFormatProvider,
): PluginRegistryEntry[] {
  return registry.map((entry) =>
    entry.formats?.includes(from) ? { ...entry, formats: entry.formats.map((f) => (f === from ? to : f)) } : entry,
  );
}

/**
 * The extensions with a cellPACK or PetWorld file (`mmcif_particles`) opening with colors that follow the zoom
 * (_spec/ui.md §4 Look; Ludo, 2026-11-04). The particles feature is lazy and registers the format when it loads, after
 * the spec's `finalize`: the format is swapped in its load, the swap's modules loaded with it.
 */
export function withZoomColorsAtLoad(
  extensions: readonly (ViewerExtension | LazyViewerExtension)[],
): (ViewerExtension | LazyViewerExtension)[] {
  return extensions.map((e) =>
    isLazyExtension(e) && e.id === 'particles'
      ? {
          ...e,
          load: async () => {
            const [ext, { MmcifParticlesProvider }, { ZoomColorsMmcifParticlesProvider }] = await Promise.all([
              e.load(),
              import('@molstar/plugin/state/formats/particles/mmcif-assembly'),
              import('@molstar/mesoscale-extension/formats'),
            ]);
            const registry = ext.plugin?.registry;
            if (!registry) return ext;
            return {
              ...ext,
              plugin: {
                ...ext.plugin,
                registry: replaceFormat(registry, MmcifParticlesProvider, ZoomColorsMmcifParticlesProvider),
              },
            };
          },
        }
      : e,
  );
}
