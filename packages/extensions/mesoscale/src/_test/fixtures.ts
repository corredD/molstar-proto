/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { CustomProperties } from '@molstar/model/model/custom-property';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';

/** A cellPACK-like list: entities by target, compartments per particle */
export function cellpackLike(): ParticleList {
  // particles: target (entity) and compartment
  const rows: [number, number][] = [
    [0, 0],
    [0, 0],
    [1, 1],
    [2, 1],
    [2, 1],
    [2, 2],
    [3, -1],
  ];
  const count = rows.length;
  return {
    label: 'HIV',
    count,
    keys: Int32Array.from(rows, (_, i) => i),
    targets: Int32Array.from(rows, ([t]) => t),
    targetInfo: new Map([
      [0, { entity: 0 }],
      [1, { entity: 1 }],
      [2, { entity: 2 }],
      [3, { entity: 3 }],
    ]),
    entityInfo: new Map([
      [0, { name: 'lipids', function: 'membrane' }],
      [1, { name: 'CA' }],
      [2, { name: 'NC' }],
      [3, { name: 'loose' }],
    ]),
    compartments: Int32Array.from(rows, ([, c]) => c),
    compartmentInfo: new Map([
      [0, { name: 'root.envelope.membrane' }],
      [1, { name: 'root.envelope.capsid.surface' }],
      [2, { name: 'root.envelope.capsid.interior' }],
    ]),
    coordinates: Float32Array.from({ length: count * 3 }, (_, i) => (i % 3 === 0 ? (i / 3) * 10 : 0)),
    getParticleLabel: (i) => `${i}`,
    sourceData: { kind: 'test', name: 'test', data: {} },
    customProperties: new CustomProperties(),
    _propertyData: Object.create(null),
  };
}

/** A transform putting a given particle list in the state, for tests */
export const TestParticleList = PluginStateTransform.BuiltIn({
  name: 'mesoscale-test-particle-list',
  display: { name: 'Test Particle List' },
  from: SO.Root,
  to: SO.Particle.List,
  params: {},
})({
  apply() {
    return new SO.Particle.List(cellpackLike(), { label: 'HIV' });
  },
});

/** A list as a plain particle file has it: targets, no entities and no compartments (a RELION list), for tests */
export const TestPlainList = PluginStateTransform.BuiltIn({
  name: 'mesoscale-test-plain-list',
  display: { name: 'Test Plain List' },
  from: SO.Root,
  to: SO.Particle.List,
  params: {},
})({
  apply() {
    const { entityInfo: _e, compartmentInfo: _ci, compartments: _c, ...plain } = cellpackLike();
    return new SO.Particle.List(plain as ReturnType<typeof cellpackLike>, { label: 'Plain' });
  },
});

/** A cellPACK-like list with one fiber (particles 2 to 4, a cellPACK model's RNA), for tests */
export const TestFiberList = PluginStateTransform.BuiltIn({
  name: 'mesoscale-test-fiber-list',
  display: { name: 'Test Fiber List' },
  from: SO.Root,
  to: SO.Particle.List,
  params: {},
})({
  apply() {
    const fibers = { count: 1, offsets: Int32Array.of(0, 3), indices: Int32Array.of(2, 3, 4) };
    return new SO.Particle.List({ ...cellpackLike(), fibers }, { label: 'HIV' });
  },
});
