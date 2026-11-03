/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { StateAction } from '@molstar/core/state';
import type { RuntimeContext } from '@molstar/core/task';
import { Task } from '@molstar/core/task';
import { Asset } from '@molstar/core/util/assets';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import type { OmeZarrFile, OmeZarrLevel } from '@molstar/io/reader/zarr/ome-zarr';
import type { PluginContext } from '@molstar/plugin/context';
import { Isosurface } from '@molstar/plugin/registry/volume/isosurface';
import type { PluginRegistryEntry } from '@molstar/plugin/spec';
import { PluginStateTransform, PluginStateObject as SO } from '@molstar/plugin/state/objects';
import { CustomVolumeProperties } from '@molstar/plugin/state/transforms/volume/ops';
import { defaultVisuals } from './provider.js';

// The reader, the decoder and the volume builder load when a Zarr opens, not with the plugin (`import()` below):
// formats.md §3, zarr.md.

const MB = 1e6;

/** A URL's bytes through the plugin's asset manager, not held (`store` off): a chunk is decoded once. */
async function readUrl(plugin: PluginContext, url: string, ctx: RuntimeContext) {
  const held = await plugin.managers.asset.resolve(Asset.Url(url), 'binary', false).runInContext(ctx);
  return held.data;
}

function levelLabel(l: OmeZarrLevel) {
  return `${l.path}: ${l.size.join('×')}, ${+l.scale[0].toFixed(3)} Å, ${Math.ceil(l.bytes / MB)} MB`;
}

/** The level a `level` param names: a path, or `coarsest`, the one that decodes to the fewest bytes. */
export function getOmeZarrLevel(file: OmeZarrFile, level: string): OmeZarrLevel {
  if (level === 'coarsest') return file.levels.reduce((a, b) => (b.bytes < a.bytes ? b : a));
  const l = file.levels.find((l) => l.path === level);
  if (!l) throw new Error(`OME-Zarr: no level '${level}' (${file.levels.map((l) => l.path).join(', ')})`);
  return l;
}

/** The bytes reading a level holds: its voxels and the one decoded chunk reading holds (zarr.md §5); `maxSizeMB` bounds it */
export function omeZarrLevelNeeds(level: OmeZarrLevel): number {
  return level.bytes + level.chunkBytes;
}

const MaxSizeParam = PD.Numeric(
  512,
  { min: 1, max: 16384, step: 1 },
  {
    label: 'Max Size (MB)',
    description: 'A level that needs more (its voxels and one decoded chunk) is refused before it is read.',
  },
);

export { OmeZarrFromUrl };
type OmeZarrFromUrl = typeof OmeZarrFromUrl;
const OmeZarrFromUrl = PluginStateTransform.BuiltIn({
  name: 'ome-zarr-from-url',
  display: { name: 'OME-Zarr from URL', description: 'Open an OME-Zarr image (NGFF 0.4) at a URL: its metadata only.' },
  from: SO.Root,
  to: SO.Format.OmeZarr,
  params: {
    url: PD.Text('', {
      description: 'The image root (…/name.zarr), read by plain GETs: the host must allow CORS.',
    }),
    label: PD.Optional(PD.Text('')),
  },
})({
  apply({ params }, plugin: PluginContext) {
    return Task.create('Open OME-Zarr', async (ctx) => {
      const [{ openOmeZarr }, { ZarrStore }] = await Promise.all([
        import('@molstar/io/reader/zarr/ome-zarr'),
        import('@molstar/io/reader/zarr/store'),
      ]);
      const label = params.label || params.url.replace(/\/+$/, '').split('/').pop() || params.url;
      const store = ZarrStore.fromUrl(params.url, (url, ctx) => readUrl(plugin, url, ctx));
      const opened = await openOmeZarr(store, label).runInContext(ctx);
      if (opened.isError) throw new Error(`${params.url}: ${opened.message}`);
      for (const w of opened.warnings) plugin.log.warn(`OME-Zarr ${label}: ${w}`);
      const n = opened.result.levels.length;
      return new SO.Format.OmeZarr(opened.result, { label, description: `${n} level${n === 1 ? '' : 's'}` });
    });
  },
});

export { VolumeFromOmeZarr };
type VolumeFromOmeZarr = typeof VolumeFromOmeZarr;
const VolumeFromOmeZarr = PluginStateTransform.BuiltIn({
  name: 'volume-from-ome-zarr',
  display: { name: 'Volume from OME-Zarr', description: 'Read one level of an OME-Zarr image as a volume.' },
  from: SO.Format.OmeZarr,
  to: SO.Volume.Data,
  params(a) {
    const levels = a?.data.levels ?? [];
    return {
      level: PD.Select<string>(
        'coarsest',
        [['coarsest', 'Coarsest'], ...levels.map((l) => [l.path, levelLabel(l)] as [string, string])],
        {
          description: 'The level read: its path ("0" is the finest), or the coarsest.',
        },
      ),
      maxSizeMB: MaxSizeParam,
      entryId: PD.Text(''),
    };
  },
})({
  apply({ a, params }) {
    return Task.create('Create volume from OME-Zarr', async (ctx) => {
      const file = a.data;
      const level = getOmeZarrLevel(file, params.level);
      const needs = omeZarrLevelNeeds(level);
      if (needs > params.maxSizeMB * MB) {
        const mb = (b: number) => `${Math.round(b / MB)} MB`;
        throw new Error(
          `OME-Zarr: level ${level.path} needs ${mb(needs)} (${mb(level.bytes)} of voxels, ${mb(level.chunkBytes)} for one decoded chunk), over the ${params.maxSizeMB} MB limit: choose a coarser level or raise Max Size`,
        );
      }
      const [{ readOmeZarrLevel }, { volumeFromOmeZarr }] = await Promise.all([
        import('@molstar/io/reader/zarr/ome-zarr'),
        import('@molstar/model/formats/volume/ome-zarr'),
      ]);
      const values = await readOmeZarrLevel(file, level).runInContext(ctx);
      if (values.isError) throw new Error(values.message);
      const volume = await volumeFromOmeZarr(file, level, values.result, {
        label: a.label,
        entryId: params.entryId || undefined,
      }).runInContext(ctx);
      return new SO.Volume.Data(volume, { label: volume.label || 'Volume', description: `Level ${levelLabel(level)}` });
    });
  },
  dispose({ b }) {
    b?.data.customProperties.dispose();
  },
});

export { OpenOmeZarr };
type OpenOmeZarr = typeof OpenOmeZarr;
const OpenOmeZarr = StateAction.build({
  from: SO.Root,
  display: {
    name: 'Open OME-Zarr',
    description: 'Load a volume from an OME-Zarr URL at a level, with its default visual.',
    triggerLabel: 'Open',
  },
  params: {
    url: PD.Text('', { description: 'The image root (…/name.zarr); the host must allow CORS.' }),
    level: PD.Text('coarsest', { description: 'A level path ("0" is the finest), or "coarsest".' }),
    maxSizeMB: MaxSizeParam,
  },
})(({ params }, plugin: PluginContext) =>
  Task.create('Open OME-Zarr', async () => {
    const volume = plugin
      .build()
      .toRoot()
      .apply(OmeZarrFromUrl, { url: params.url }, { state: { isGhost: true } })
      .apply(VolumeFromOmeZarr, { level: params.level, maxSizeMB: params.maxSizeMB, entryId: '' })
      .apply(CustomVolumeProperties);
    // an error is the state's to log, and the nodes are gone
    await volume.commit({ revertOnError: true });
    if (!volume.selector.isOk) return;
    await defaultVisuals(plugin, { volume: volume.selector });
  }),
);

/** OME-Zarr volumes: the transforms, the action and the representation its visual uses. */
export const OmeZarr: PluginRegistryEntry = {
  actions: [OmeZarrFromUrl, VolumeFromOmeZarr, OpenOmeZarr],
  ...Isosurface,
};
