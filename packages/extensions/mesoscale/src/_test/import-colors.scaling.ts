/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { expect, it } from 'vitest';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { CustomProperties } from '@molstar/model/model/custom-property';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import {
  checkLinear,
  quadraticControl,
  scaling,
  scalingAsync,
} from '../../../../sequences/core/_test/model/scaling.js';
import { matchColors, parseColorFile } from '../color-file.js';
import { mesoEntities } from '../model.js';
import { MesoscaleExtension } from '../prism-viewer.js';

// The color file import over n and 4n entities (`test:scaling`; packages/prism/AGENTS.md, bulk operations are one
// change): the file read and matched (the names indexed once, a lookup a key), and the whole operation on a headless
// viewer (one patch of the layers by `particles.look`, one commit). Both catch a scan of the entities per key: the
// operation's case at 4000 → 16000 entities, where a per-key `entities.find` in its run read ×12.7 (×6.1 at 1000, under
// the band: the viewer's fixed cost hid it), the linear path ×3.4 (2026-10-24, M-series laptop).

const PerEntity = 2;

/** A list of `n` entities, `PerEntity` particles each, in two compartments */
function manyEntities(n: number): ParticleList {
  const count = n * PerEntity;
  const targets = Int32Array.from({ length: count }, (_, i) => Math.floor(i / PerEntity));
  return {
    label: 'many',
    count,
    keys: Int32Array.from({ length: count }, (_, i) => i),
    targets,
    targetInfo: new Map(Array.from({ length: n }, (_, i) => [i, { entity: i }])),
    entityInfo: new Map(Array.from({ length: n }, (_, i) => [i, { name: `E${i}` }])),
    compartments: Int32Array.from(targets, (t) => t % 2),
    compartmentInfo: new Map([
      [0, { name: 'root.a' }],
      [1, { name: 'root.b' }],
    ]),
    coordinates: Float32Array.from({ length: count * 3 }, (_, i) => i),
    getParticleLabel: (i) => `${i}`,
    sourceData: { kind: 'test', name: 'test', data: {} },
    customProperties: new CustomProperties(),
    _propertyData: Object.create(null),
  };
}

const ManyEntities = PluginStateTransform.BuiltIn({
  name: 'mesoscale-test-many-entities',
  display: { name: 'Test Many Entities' },
  from: SO.Root,
  to: SO.Particle.List,
  params: { n: PD.Numeric(1) },
})({
  apply({ params }) {
    return new SO.Particle.List(manyEntities(params.n), { label: 'many' });
  },
});

/** The explorer's file for `n` entities: every one by its full path, x, y, z */
function colorFile(n: number): string {
  const file: Record<string, { x: number; y: number; z: number }> = {};
  for (let i = 0; i < n; i++) file[`root.${i % 2 ? 'b' : 'a'}.E${i}`] = { x: i % 256, y: 100, z: 200 };
  return JSON.stringify(file);
}

it('the positive control (a copy per item) is caught', () => {
  checkLinear('quadratic control', scaling(quadraticControl, 2000), false);
});

it('a color file of N entities, read and matched', () => {
  const s = scaling(
    {
      setup: (n) => ({ entities: mesoEntities(manyEntities(n)), text: colorFile(n) }),
      run: ({ entities, text }) => {
        const file = parseColorFile(text);
        if (typeof file === 'string') throw new Error(file);
        if (matchColors(entities, file).colors.size !== entities.length) throw new Error('unmatched');
      },
    },
    2000,
  );
  checkLinear('color file, read and matched, N entities', s);
});

it('mesoscale.importColors over N entities', async () => {
  const s = await scalingAsync(
    {
      setup: async (n) => {
        const base = DefaultPrismViewerSpec();
        const v = await createPrismViewerHeadless({
          spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
        });
        await v.plugin.build().toRoot().apply(ManyEntities, { n }).commit();
        const r = await v.api.particles.representation({ type: 'spacefill' });
        expect(r.ok).toBe(true);
        return { v, text: colorFile(n) };
      },
      run: async ({ v, text }: { v: PrismViewer; text: string }) => {
        const r = await v.api.mesoscale!.importColors({ json: text });
        if (!r.ok) throw new Error(r.message);
      },
      teardown: ({ v }) => v.dispose(),
    },
    4000,
  );
  checkLinear('mesoscale.importColors, N entities', s);
}, 600_000);
