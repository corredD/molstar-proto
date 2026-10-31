/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Interval } from '@molstar/core/data/int';
import { Color } from '@molstar/core/util/color';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { SyncRuntimeContext } from '@molstar/core/task/execution/synchronous';
import { CIF } from '@molstar/io/reader/cif';
import { trajectoryFromMmCIF } from '@molstar/model/formats/structure/mmcif';
import { Structure, StructureElement, StructureProperties } from '@molstar/model/model/structure';
import { CustomProperties } from '@molstar/model/model/custom-property';
import type { ParticleList, ParticleTarget } from '@molstar/model/model/particles/particle-list';
import { ColorLevels } from '@molstar/graphics/geo/geometry/color-levels';
import {
  ParticleHierarchyColorTheme,
  ParticleHierarchyColorThemeParams,
} from '@molstar/graphics/theme/color/particle-hierarchy';
import { UniformColorTheme } from '@molstar/graphics/theme/color/uniform';
import { UniformSizeTheme } from '@molstar/graphics/theme/size/uniform';
import type { Theme } from '@molstar/graphics/theme/theme';
import {
  ParticleTargetRepresentationParams,
  createParticleTargetPropsProvider,
  createTargetVisual,
} from '../representation/target/common.js';
import { ElementSymbolColors, elementSymbolColor } from '../../../theme/color/element-symbol.js';

async function load1cbs() {
  const file = path.resolve(import.meta.dirname, '../../../../../../data/examples/1cbs_updated.cif');
  const parsed = await CIF.parse(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).run();
  if (parsed.isError) throw new Error(parsed.message);
  const trajectory = await trajectoryFromMmCIF(parsed.result.blocks[0], parsed.result).run();
  return Structure.ofModel(trajectory.representative);
}

/** Three particles of one structure target: two in compartment 0 (entity 0), one in compartment 1 (entity 1) */
function particleList(structure: Structure): ParticleList {
  return {
    count: 3,
    keys: Int32Array.from([0, 1, 2]),
    targets: new Int32Array(3),
    targetInfo: new Map([[0, { name: '1cbs' }]]),
    targetMapping: new Map<number, ParticleTarget>([[0, { kind: 'structure', structure }]]),
    compartments: Int32Array.from([0, 0, 1]),
    compartmentInfo: new Map([
      [0, { name: 'a' }],
      [1, { name: 'b' }],
    ]),
    entities: Int32Array.from([0, 0, 1]),
    entityInfo: new Map([
      [0, { name: 'e0' }],
      [1, { name: 'e1' }],
    ]),
    coordinates: Float32Array.from([0, 0, 0, 100, 0, 0, 200, 0, 0]),
    getParticleLabel: () => '',
    sourceData: {} as ParticleList['sourceData'],
    customProperties: new CustomProperties(),
    _propertyData: {},
  };
}

const levelsOn = { name: 'on' as const, params: PD.getDefaultValues(ColorLevels.Params) };

async function visualOf(structure: Structure, colorLevels: unknown, color = 'hierarchy') {
  const particles = particleList(structure);
  const target = particles.targetMapping!.get(0)!;
  const params = PD.getDefaultValues(ParticleTargetRepresentationParams);
  const props = createParticleTargetPropsProvider({
    ...params,
    structure: { ...params.structure, colorLevels } as typeof params.structure,
  })(target);
  const theme = {
    color:
      color === 'hierarchy'
        ? ParticleHierarchyColorTheme({ particles }, PD.getDefaultValues(ParticleHierarchyColorThemeParams))
        : UniformColorTheme({}, { value: Color(0xff0000), saturation: 0, lightness: 0 }),
    size: UniformSizeTheme({}, { value: 1 }),
  } as unknown as Theme;
  const visual = createTargetVisual(0, 1);
  await visual.createOrUpdate({ runtime: SyncRuntimeContext }, theme, props, particles, Interval.ofLength(3), target);
  return { visual, theme, particles, values: visual.renderObject!.values as unknown as ColorLevels.Data };
}

describe('color levels of particle structure targets', () => {
  it('fills the near data per atom (element color, chain offset) and the far data per particle (compartment)', async () => {
    const structure = await load1cbs();
    const { values, theme, particles } = await visualOf(structure, levelsOn);
    expect(values.dColorLevels.ref.value).toBe(true);

    const near = values.tColorNear.ref.value;
    expect(near.count).toBe(structure.elementCount);
    const location = StructureElement.Location.create(structure);
    const chains = new Set<string>();
    const { unitIndices, elementIndices } = structure.serialMapping;
    for (let i = 0; i < structure.elementCount; ++i) {
      location.unit = structure.units[unitIndices[i]];
      location.element = elementIndices[i];
      chains.add(StructureProperties.chain.label_asym_id(location));
      const element = elementSymbolColor(ElementSymbolColors, StructureProperties.atom.type_symbol(location));
      if (Color.fromArray(near.array, i * 4) !== element) throw new Error(`element ${i}`);
    }
    // 1cbs: more than one chain (protein, ligand, water), the first at -1, the last at 1
    expect(chains.size).toBeGreaterThan(1);
    expect(near.array[3]).toBe(ColorLevels.offsetByte(-1));
    expect(near.array[near.count * 4 - 1]).toBe(ColorLevels.offsetByte(1));

    const far = values.tColorFar.ref.value;
    const compartment = (i: number) =>
      (theme.color as { farColor: (l: unknown) => Color }).farColor({
        kind: 'particle-location',
        particles,
        index: i,
      });
    expect([0, 1, 2].map((i) => Color.fromArray(far.array, i * 4))).toEqual([0, 1, 2].map(compartment));
    expect(compartment(0)).not.toBe(compartment(2));
  });

  it('sets the edges as log2 and turns off with the param or a uniform theme', async () => {
    const structure = await load1cbs();
    const { values } = await visualOf(structure, levelsOn);
    expect(Array.from(values.uColorLevelEdges.ref.value)).toEqual([
      Math.log2(levelsOn.params.entity),
      Math.log2(levelsOn.params.chain),
      Math.log2(levelsOn.params.atom),
    ]);
    expect((await visualOf(structure, { name: 'off', params: {} })).values.dColorLevels.ref.value).toBe(false);
    expect((await visualOf(structure, levelsOn, 'uniform')).values.dColorLevels.ref.value).toBe(false);
  });

  it("an item off keeps its representation's uniforms: they are material uniforms, shared by its items (review M2)", async () => {
    const structure = await load1cbs();
    const on = (await visualOf(structure, levelsOn)).values;
    const off = (await visualOf(structure, levelsOn, 'uniform')).values;
    expect(off.dColorLevels.ref.value).toBe(false);
    expect(Array.from(off.uColorLevelEdges.ref.value)).toEqual(Array.from(on.uColorLevelEdges.ref.value));
    expect(off.uColorLevelBand.ref.value).toBe(on.uColorLevelBand.ref.value);
    expect(off.uColorLevelChainHue.ref.value).toBe(on.uColorLevelChainHue.ref.value);
  });
});
