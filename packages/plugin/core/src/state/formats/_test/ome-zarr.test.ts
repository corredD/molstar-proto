/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { StateSelection } from '@molstar/core/state';
import { PluginContext } from '@molstar/plugin/context';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import type { OmeZarrFile } from '@molstar/io/reader/zarr/ome-zarr';
import { getOmeZarrLevel, OmeZarr, OmeZarrFromUrl, OpenOmeZarr, VolumeFromOmeZarr } from '../volume/ome-zarr.js';

/** io's Zarr fixtures (data files, made by make-fixtures.py there). */
const Fixtures = path.join(import.meta.dirname, '../../../../../../io/src/reader/zarr/_test/fixtures');
const Host = 'https://files.example.org/';

/** Serves the fixtures (and `extra` files) under `Host`, 404 for the rest; records each request. */
function serve(extra: Record<string, string> = {}) {
  const requests: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    const key = url.slice(Host.length);
    if (key in extra) return new Response(extra[key]);
    const file = path.join(Fixtures, ...key.split('/'));
    if (!key.includes('..') && fs.existsSync(file) && fs.statSync(file).isFile()) {
      return new Response(new Uint8Array(fs.readFileSync(file)));
    }
    return new Response('Not Found', { status: 404 });
  });
  return requests;
}

async function createPlugin() {
  const plugin = new PluginContext({ behaviors: [], registry: [OmeZarr] });
  await plugin.init();
  return plugin;
}

/** The errors the plugin logs (a failed transform's, with `revertOnError` its nodes reverted). */
function errorsOf(plugin: PluginContext) {
  const errors: string[] = [];
  plugin.events.log.subscribe((e) => {
    if (e.type === 'error') errors.push(String(e.message));
  });
  return errors;
}

function volumes(plugin: PluginContext) {
  return plugin.state.data.select(StateSelection.Generators.root.subtree().ofType(SO.Volume.Data));
}

describe('OME-Zarr in the plugin', () => {
  const open = (plugin: PluginContext, url: string, level = 'coarsest') =>
    plugin.runTask(plugin.state.data.applyAction(OpenOmeZarr, { url, level, maxSizeMB: 512 }));

  it('opens a mask from a URL by plain GETs and shows it as an isosurface at 0.5', async () => {
    const requests = serve();
    const plugin = await createPlugin();
    await open(plugin, `${Host}mask.zarr/`);

    const [volume] = volumes(plugin);
    expect(volume.obj!.data.grid.cells.space.dimensions).toEqual([8, 7, 6]);
    const repr = plugin.state.data.select(StateSelection.Generators.root.subtree().ofType(SO.Volume.Representation3D));
    expect(repr.length).toBe(1);
    expect(repr[0].transform.params).toMatchObject({
      type: { name: 'isosurface', params: { isoValue: { kind: 'absolute', absoluteValue: 0.5 } } },
    });
    // no header: a Range or any custom header would need a CORS preflight
    expect(requests.every((r) => r.init?.headers === undefined && r.init?.method === 'GET')).toBe(true);
    expect(requests.map((r) => r.url.slice(Host.length)).sort()).toEqual([
      'mask.zarr/.zattrs',
      'mask.zarr/0/.zarray',
      ...['0/0/0', '0/0/1', '0/1/0', '0/1/1', '1/0/0', '1/0/1', '1/1/0', '1/1/1'].map((k) => `mask.zarr/0/${k}`),
    ]);
    await plugin.dispose();
  });

  it('reads the coarsest level by default, and another when the level changes', async () => {
    serve();
    const plugin = await createPlugin();
    const format = plugin
      .build()
      .toRoot()
      .apply(OmeZarrFromUrl, { url: `${Host}multiscale.zarr` });
    const volume = format.apply(VolumeFromOmeZarr, {});
    await volume.commit();
    expect(volume.selector.data!.grid.cells.space.dimensions).toEqual([4, 3, 3]);
    expect(format.selector.cell!.obj!.label).toBe('multiscale.zarr');

    await plugin
      .build()
      .to(volume.selector)
      .update(VolumeFromOmeZarr, (p) => ({ ...p, level: '0' }))
      .commit();
    const level0 = volumeOf(plugin, volume.ref);
    expect(level0.grid.cells.space.dimensions).toEqual([14, 11, 9]);
    const { space, data } = level0.grid.cells;
    expect(space.get(data, 7, 3, 5)).toBe(537);
    await plugin.dispose();
  });

  it('takes as coarsest the level of fewest bytes, not the last listed', () => {
    const file = {
      levels: [
        { path: 'a', bytes: 10 },
        { path: 'b', bytes: 1 },
        { path: 'c', bytes: 5 },
      ],
    } as unknown as OmeZarrFile;
    expect(getOmeZarrLevel(file, 'coarsest').path).toBe('b');
    expect(getOmeZarrLevel(file, 'c').path).toBe('c');
    expect(() => getOmeZarrLevel(file, 'd')).toThrow("no level 'd' (a, b, c)");
  });

  it('refuses a level over the size limit before reading any chunk, and leaves no node', async () => {
    const huge = JSON.parse(fs.readFileSync(path.join(Fixtures, 'multiscale.zarr', '2', '.zarray'), 'utf8'));
    huge.shape = [1000, 1000, 1000];
    const requests = serve({ 'multiscale.zarr/2/.zarray': JSON.stringify(huge) });
    const plugin = await createPlugin();
    const errors = errorsOf(plugin);
    await open(plugin, `${Host}multiscale.zarr`, '2');
    expect(errors.join('\n')).toContain(
      'level 2 needs 4000 MB (4000 MB of voxels, 0 MB for one decoded chunk), over the 512 MB limit',
    );
    expect(requests.some((r) => /\/\d+\/\d+\/\d+$/.test(r.url))).toBe(false);
    expect(volumes(plugin)).toEqual([]);
    expect(plugin.state.data.tree.children.get(plugin.state.data.tree.root.ref).size).toBe(0);
    await plugin.dispose();
  });

  it('counts the decoded chunk in the size limit: a small level of huge chunks is refused', async () => {
    const meta = JSON.parse(fs.readFileSync(path.join(Fixtures, 'multiscale.zarr', '2', '.zarray'), 'utf8'));
    meta.chunks = [1024, 1024, 1024];
    const requests = serve({ 'multiscale.zarr/2/.zarray': JSON.stringify(meta) });
    const plugin = await createPlugin();
    const errors = errorsOf(plugin);
    await open(plugin, `${Host}multiscale.zarr`, '2');
    expect(errors.join('\n')).toContain('level 2 needs 4295 MB (0 MB of voxels, 4295 MB for one decoded chunk)');
    expect(requests.some((r) => /\/\d+\/\d+\/\d+$/.test(r.url))).toBe(false);
    await plugin.dispose();
  });

  it('says what is wrong with a store it cannot read', async () => {
    serve();
    const plugin = await createPlugin();
    const errors = errorsOf(plugin);
    await open(plugin, `${Host}nothing.zarr`);
    expect(errors.join('\n')).toContain(`${Host}nothing.zarr: Zarr: .zattrs is missing`);
    await plugin.dispose();
  });
});

function volumeOf(plugin: PluginContext, ref: string) {
  return (plugin.state.data.cells.get(ref)!.obj as SO.Volume.Data).data;
}
