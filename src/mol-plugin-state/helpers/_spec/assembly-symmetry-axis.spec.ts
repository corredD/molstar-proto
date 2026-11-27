/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ValueCell } from '../../../mol-util';
import { AssemblySymmetryProvider } from '../../../extensions/assembly-symmetry/prop';
import { syncStructureAssemblyAxes } from '../assembly-symmetry-axis';

const axis = { order: 3, start: [0, 0, 0], end: [0, 0, 1] };
const symmetryA = { rotation_axes: [axis] };
const symmetryB = { rotation_axes: [axis, { order: 3, start: [0, 0, 0], end: [1, 0, 0] }] };

function fakePlugin(structure: object) {
    const values = {
        uAudioAssemblyAxes: ValueCell.create(new Array(96).fill(0)),
        uAudioAssemblyAxisCount: ValueCell.create(0),
        uAudioAssemblyAxisCenter: ValueCell.create([0, 0, 0]),
        uAudioWaveRadial: ValueCell.create(0),
    };
    const hierarchy = {
        structures: [{
            model: { trajectory: {} },
            cell: { obj: { data: structure } },
            components: [{ representations: [{ cell: { obj: { data: { repr: { renderObjects: [{ values }] } } } } }] }],
        }],
    };
    return { values, plugin: { managers: { structure: { hierarchy: { current: hierarchy } } }, state: { data: {} } } as any };
}

describe('syncStructureAssemblyAxes cache', () => {
    it('reads the symmetry once per sync after the first, and misses when the symmetry changes', () => {
        const structure = { boundary: { box: { min: [0, 0, 0], max: [1, 1, 1] } }, models: [], units: [] };
        let current: unknown = symmetryA;
        const get = jest.spyOn(AssemblySymmetryProvider, 'get').mockImplementation(() => ({ value: current }) as any);
        const { plugin, values } = fakePlugin(structure);
        const reads: number[] = [];
        for (let i = 0; i < 4; i++) {
            get.mockClear();
            syncStructureAssemblyAxes(plugin, 'highest');
            reads.push(get.mock.calls.length);
        }
        expect(reads).toEqual([2, 1, 1, 1]);
        expect(values.uAudioAssemblyAxisCount.ref.value).toBe(1);

        current = symmetryB;
        syncStructureAssemblyAxes(plugin, 'highest');
        expect(values.uAudioAssemblyAxisCount.ref.value).toBe(2);
        get.mockClear();
        syncStructureAssemblyAxes(plugin, '2');
        expect(values.uAudioAssemblyAxisCount.ref.value).toBe(0);
        get.mockRestore();
    });
});
