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
import type { ParticleList, ParticleSites, ParticleTarget } from '@molstar/model/model/particles/particle-list';
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

/**
 * The structure's elements as sites (mmCIF particles' targets): positions, radii, a unit a chain, the elements by
 * symbol (or none)
 */
function sitesOf(structure: Structure, withElements = true): ParticleSites {
  const count = structure.elementCount;
  const offsets = new Int32Array(structure.units.length + 1);
  const symbols: string[] = [];
  const index = new Uint8Array(count);
  const location = StructureElement.Location.create(structure);
  let g = 0;
  for (let u = 0; u < structure.units.length; ++u) {
    const unit = structure.units[u];
    offsets[u + 1] = offsets[u] + unit.elements.length;
    location.unit = unit;
    for (let i = 0, il = unit.elements.length; i < il; ++i, ++g) {
      location.element = unit.elements[i];
      const symbol = StructureProperties.atom.type_symbol(location);
      if (!symbols.includes(symbol)) symbols.push(symbol);
      index[g] = symbols.indexOf(symbol);
    }
  }
  return {
    count,
    positions: new Float32Array(count * 3),
    radii: new Float32Array(count).fill(1),
    chains: { offsets, labels: structure.units.map((u) => `${u.id}`) },
    elements: withElements ? { symbols, index } : undefined,
  };
}

/** Three particles of one structure target: two in compartment 0 (entity 0), one in compartment 1 (entity 1) */
function particleList(structure: Structure, target: ParticleTarget = { kind: 'structure', structure }): ParticleList {
  return {
    count: 3,
    keys: Int32Array.from([0, 1, 2]),
    targets: new Int32Array(3),
    targetInfo: new Map([[0, { name: '1cbs' }]]),
    targetMapping: new Map<number, ParticleTarget>([[0, target]]),
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

async function visualOf(structure: Structure, colorLevels: unknown, color = 'hierarchy', given?: ParticleTarget) {
  const particles = particleList(structure, given);
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

  it('fills the far colors again for a new theme, and after off then on (review S5)', async () => {
    const structure = await load1cbs();
    const { visual, particles } = await visualOf(structure, levelsOn);
    const target = particles.targetMapping!.get(0)!;
    const params = PD.getDefaultValues(ParticleTargetRepresentationParams);
    const propsOf = (colorLevels: unknown) =>
      createParticleTargetPropsProvider({
        ...params,
        structure: { ...params.structure, colorLevels } as typeof params.structure,
      })(target);
    const hierarchy = PD.getDefaultValues(ParticleHierarchyColorThemeParams);
    const shifted = ParticleHierarchyColorTheme(
      { particles },
      { ...hierarchy, compartmentPalette: { name: 'auto', params: { compartmentShift: 50 } } },
    );
    const theme = { color: shifted, size: UniformSizeTheme({}, { value: 1 }) } as unknown as Theme;
    const update = (colorLevels: unknown) =>
      visual.createOrUpdate(
        { runtime: SyncRuntimeContext },
        theme,
        propsOf(colorLevels),
        particles,
        Interval.ofLength(3),
        target,
      );
    const far = () => {
      const { array } = (visual.renderObject!.values as unknown as ColorLevels.Data).tColorFar.ref.value;
      return [0, 1, 2].map((i) => Color.fromArray(array, i * 4));
    };
    const expected = [0, 1, 2].map((index) =>
      shifted.farColor!({ kind: 'particle-location', particles, index } as never, false),
    );

    await update(levelsOn);
    expect(far()).toEqual(expected);
    await update({ name: 'off', params: {} });
    await update(levelsOn);
    expect(far()).toEqual(expected);
  });
});

describe('color levels of particle sites targets', () => {
  it('fills the near data per site (element color, chain offset) and the far data per particle', async () => {
    const structure = await load1cbs();
    const sites = sitesOf(structure);
    const { values, theme, particles } = await visualOf(structure, levelsOn, 'hierarchy', { kind: 'sites', sites });
    expect(values.dColorLevels.ref.value).toBe(true);

    const near = values.tColorNear.ref.value;
    expect(near.count).toBe(sites.count);
    const location = StructureElement.Location.create(structure);
    const { unitIndices, elementIndices } = structure.serialMapping;
    for (let i = 0; i < sites.count; ++i) {
      location.unit = structure.units[unitIndices[i]];
      location.element = elementIndices[i];
      const element = elementSymbolColor(ElementSymbolColors, StructureProperties.atom.type_symbol(location));
      if (Color.fromArray(near.array, i * 4) !== element) throw new Error(`site ${i}`);
    }
    // a chain a unit: the first at -1, the last at 1, a chain's sites one offset
    const chains = sites.chains!;
    const last = chains.labels.length - 1;
    expect(near.array[3]).toBe(ColorLevels.offsetByte(-1));
    expect(near.array[near.count * 4 - 1]).toBe(ColorLevels.offsetByte(1));
    const second = ColorLevels.offsetByte(ColorLevels.chainOffset(1, last + 1));
    for (let i = chains.offsets[1]; i < chains.offsets[2]; ++i) expect(near.array[i * 4 + 3]).toBe(second);

    const far = values.tColorFar.ref.value;
    const compartment = (i: number) =>
      (theme.color as { farColor: (l: unknown) => Color }).farColor({
        kind: 'particle-location',
        particles,
        index: i,
      });
    expect([0, 1, 2].map((i) => Color.fromArray(far.array, i * 4))).toEqual([0, 1, 2].map(compartment));
  });

  it("is a carbon's color a site where the sites have no elements", async () => {
    const structure = await load1cbs();
    const sites = sitesOf(structure, false);
    const { values } = await visualOf(structure, levelsOn, 'hierarchy', { kind: 'sites', sites });
    expect(values.dColorLevels.ref.value).toBe(true);
    const near = values.tColorNear.ref.value.array;
    for (let i = 0; i < sites.count; ++i) {
      if (Color.fromArray(near, i * 4) !== ElementSymbolColors.C) throw new Error(`site ${i}`);
    }
  });

  it('turns off and on again', async () => {
    const structure = await load1cbs();
    const target: ParticleTarget = { kind: 'sites', sites: sitesOf(structure) };
    const { visual, theme, particles, values } = await visualOf(structure, levelsOn, 'hierarchy', target);
    const params = PD.getDefaultValues(ParticleTargetRepresentationParams);
    const update = (colorLevels: unknown) =>
      visual.createOrUpdate(
        { runtime: SyncRuntimeContext },
        theme,
        createParticleTargetPropsProvider({
          ...params,
          structure: { ...params.structure, colorLevels } as typeof params.structure,
        })(target),
        particles,
        Interval.ofLength(3),
        target,
      );
    await update({ name: 'off', params: {} });
    expect(values.dColorLevels.ref.value).toBe(false);
    await update(levelsOn);
    expect(values.dColorLevels.ref.value).toBe(true);
  });
});
