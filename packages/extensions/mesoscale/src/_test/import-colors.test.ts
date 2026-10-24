/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Color } from '@molstar/core/util/color';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { matchColors, parseColorFile } from '../color-file.js';
import { mesoEntities } from '../model.js';
import type { ImportColorsResult, MesoscaleInfo } from '../operations.js';
import { MesoscaleExtension } from '../prism-viewer.js';
import { cellpackLike, TestParticleList } from './fixtures.js';

// `mesoscale.importColors` (_spec/features.md, "Color file import (JSON)"): entity colors from a JSON file, the
// Mesoscale Explorer's (`{ "<compartment>.<entity>": { "x": r, "y": g, "z": b } }`, 0-255) or a plain map
// (`{ "<entity>": "#rrggbb" }`), on the cellPACK-like list of the fixtures (lipids, CA, NC, loose).

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}`);
}

async function viewer() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
  });
  viewers.push(v);
  await v.plugin.build().toRoot().apply(TestParticleList).commit();
  expectOk(await v.api.particles.representation({ type: 'spacefill' }));
  return v;
}

const colorsOf = async (v: PrismViewer) => {
  const r = await v.api.mesoscale!.entities({});
  expectOk(r);
  return Object.fromEntries(
    (r.value as MesoscaleInfo).entities.map((e) => [
      e.name,
      e.color === undefined ? undefined : Color.toHexStyle(e.color),
    ]),
  );
};

describe('the color file', () => {
  it('reads both formats: a CSS color by name, the explorer’s x, y, z (0-255) by compartment path', () => {
    const file = parseColorFile(
      JSON.stringify({
        lipids: '#ff0000',
        'root.envelope.capsid.surface.CA': { x: 0, y: 128, z: 255 },
        '.loose': 'tomato',
      }),
    );
    if (typeof file === 'string') expect.fail(file);
    const m = matchColors(mesoEntities(cellpackLike()), file);
    expect(Array.from(m.colors, ([id, c]) => [id, Color.toHexStyle(c)])).toEqual([
      [0, '#ff0000'],
      [1, '#0080ff'],
      [3, '#ff6347'],
    ]);
    expect(m.matched).toEqual(['lipids', 'CA', 'loose']);
    expect(m.unmatched).toEqual([]);
  });

  it('says what it could not read: not JSON, not an object, a value that is not a color', () => {
    expect(typeof parseColorFile('{ nope')).toBe('string');
    expect(typeof parseColorFile('[1, 2]')).toBe('string');
    expect(typeof parseColorFile('null')).toBe('string');
    const file = parseColorFile('{"CA": "not a color", "NC": {"x": 1}}');
    if (typeof file === 'string') expect.fail(file);
    const m = matchColors(mesoEntities(cellpackLike()), file);
    expect(m.colors.size).toBe(0);
    expect(m.invalid).toEqual(['CA', 'NC']);
  });

  it('reports the entities two keys name (one entity per name across compartments): the last color kept', () => {
    const file = parseColorFile(
      JSON.stringify({
        'root.envelope.capsid.surface.NC': '#ff0000',
        'root.envelope.capsid.interior.NC': '#00ff00',
        NC: '#0000ff',
        CA: '#ffffff',
      }),
    );
    if (typeof file === 'string') expect.fail(file);
    const m = matchColors(mesoEntities(cellpackLike()), file);
    expect(Color.toHexStyle(m.colors.get(2)!)).toBe('#0000ff');
    expect(m.overridden).toEqual(['NC']);
  });
});

describe('mesoscale.importColors', () => {
  it('colors the named entities and keeps the others as they were', async () => {
    const v = await viewer();
    const m = v.api.mesoscale!;
    expectOk(await m.style({ entities: 'NC', color: '#00ff00', visible: false }));
    const r = await m.importColors({
      json: JSON.stringify({ 'root.envelope.membrane.lipids': { x: 255, y: 0, z: 0 }, CA: '#0000ff' }),
    });
    expectOk(r);
    expect(await colorsOf(v)).toEqual({ lipids: '#ff0000', CA: '#0000ff', NC: '#00ff00', loose: undefined });
    // the rest of a style stays
    const nc = (await m.entities({})) as Extract<ApiResult<MesoscaleInfo>, { ok: true }>;
    expect(nc.value!.entities.find((e) => e.name === 'NC')!.visible).toBe(false);
  });

  it('returns the names it did not find, and says them', async () => {
    const v = await viewer();
    const r = await v.api.mesoscale!.importColors({
      json: JSON.stringify({ CA: 'red', 'root.elsewhere.GAG': 'blue', Ghost: '#123456' }),
    });
    expectOk(r);
    const value = r.value as ImportColorsResult;
    expect(value.matched).toEqual(['CA']);
    expect(value.unmatched).toEqual(['root.elsewhere.GAG', 'Ghost']);
    expect(r.did).toContain('Ghost');
  });

  it('says which entities were named twice, and that the last color is kept', async () => {
    const v = await viewer();
    const r = await v.api.mesoscale!.importColors({
      json: JSON.stringify({ 'root.envelope.capsid.surface.NC': 'red', 'root.envelope.capsid.interior.NC': 'blue' }),
    });
    expectOk(r);
    expect((r.value as ImportColorsResult).overridden).toEqual(['NC']);
    expect(r.did).toContain('1 entity named twice, last color kept: NC');
    expect((await colorsOf(v)).NC).toBe('#0000ff');
  });

  it('is one undo step for the whole file', async () => {
    const v = await viewer();
    const before = await colorsOf(v);
    expectOk(await v.api.mesoscale!.importColors({ json: JSON.stringify({ lipids: 'red', CA: 'green', NC: 'blue' }) }));
    expect(Object.values(await colorsOf(v)).filter((c) => c).length).toBe(3);
    expectOk(await v.api.history.undo({}));
    expect(await colorsOf(v)).toEqual(before);
  });

  it('fails cleanly on a file that is not JSON, names nothing it knows, or changes nothing', async () => {
    const v = await viewer();
    const m = v.api.mesoscale!;
    expect(await m.importColors({ json: '{ "CA": ' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await m.importColors({ json: '"#ff0000"' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await m.importColors({ json: '{"Ghost": "red"}' })).toMatchObject({ ok: false, code: 'not-found' });
    expectOk(await m.importColors({ json: '{"CA": "red"}' }));
    const again = await m.importColors({ json: '{"CA": "red"}' });
    expectOk(again);
    expect(again.unchanged).toBe(true);
  });

  it('has a command, as every operation of the area', async () => {
    const v = await viewer();
    const uncommanded = [...v.api.definitions.value.values()]
      .filter((d) => d.id.startsWith('mesoscale.') && !d.read && !d.surface && !v.managers.commands.get(d.id))
      .map((d) => d.id);
    expect(uncommanded).toEqual([]);
    expect(v.managers.commands.get('mesoscale.importColors')).toBeDefined();
  });
});
