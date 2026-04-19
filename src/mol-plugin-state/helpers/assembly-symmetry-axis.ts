/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 */

import { Structure } from '../../mol-model/structure';
import { Vec3 } from '../../mol-math/linear-algebra';
import { PluginContext } from '../../mol-plugin/context';
import { AssemblySymmetryData, AssemblySymmetryDataProvider, AssemblySymmetryProvider, AssemblySymmetryValue } from '../../extensions/assembly-symmetry/prop';

export const AudioReactiveAssemblyAxisOrderOptions = [
    ['highest', 'Highest Order'],
    ['2', '2-fold'],
    ['3', '3-fold'],
    ['4', '4-fold'],
    ['5', '5-fold'],
    ['6', '6-fold'],
] as const;
export type AudioReactiveAssemblyAxisOrder = typeof AudioReactiveAssemblyAxisOrderOptions[number][0];

function getAssemblySymmetry(structure: Structure): AssemblySymmetryValue | undefined {
    const symmetry = AssemblySymmetryProvider.get(structure).value;
    if (symmetry && AssemblySymmetryData.isRotationAxes(symmetry.rotation_axes)) return symmetry;

    const symmetryData = AssemblySymmetryDataProvider.get(structure).value;
    if (!symmetryData) return void 0;

    const symmetryIndex = AssemblySymmetryData.firstNonC1(symmetryData);
    const first = symmetryIndex >= 0 ? symmetryData[symmetryIndex] : void 0;
    return first && AssemblySymmetryData.isRotationAxes(first.rotation_axes) ? first : void 0;
}

function getAxisOrderScore(order: number | undefined) {
    return order ?? 0;
}

function getSymmetryAxis(symmetry: AssemblySymmetryValue | undefined, order: AudioReactiveAssemblyAxisOrder) {
    if (!symmetry || !AssemblySymmetryData.isRotationAxes(symmetry.rotation_axes)) return void 0;

    if (order === 'highest') {
        let best = symmetry.rotation_axes[0];
        for (let i = 1, il = symmetry.rotation_axes.length; i < il; ++i) {
            const axis = symmetry.rotation_axes[i];
            if (getAxisOrderScore(axis.order) > getAxisOrderScore(best.order)) best = axis;
        }
        return best;
    }

    const requestedOrder = parseInt(order, 10);
    return symmetry.rotation_axes.find(axis => axis.order === requestedOrder);
}

export function getStructureAssemblyAxis(structure: Structure, order: AudioReactiveAssemblyAxisOrder) {
    const axis = getSymmetryAxis(getAssemblySymmetry(structure), order);
    if (!axis) return void 0;

    const out = Vec3.sub(Vec3(), axis.end as Vec3, axis.start as Vec3);
    if (Vec3.magnitude(out) < 1e-6) return void 0;
    return Vec3.normalize(out, out);
}

export function getSelectedStructureAssemblyAxis(plugin: PluginContext, order: AudioReactiveAssemblyAxisOrder) {
    for (const selected of plugin.managers.structure.hierarchy.selection.structures) {
        const structure = selected.cell.obj?.data;
        if (!structure) continue;
        const axis = getStructureAssemblyAxis(structure, order);
        if (axis) return axis;
    }
    return void 0;
}
