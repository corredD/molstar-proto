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
export const AudioReactiveAssemblyAxisMaxCount = 32;

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

function getSymmetryAxes(symmetry: AssemblySymmetryValue | undefined, order: AudioReactiveAssemblyAxisOrder) {
    if (!symmetry || !AssemblySymmetryData.isRotationAxes(symmetry.rotation_axes)) return void 0;

    if (order === 'highest') {
        let highestOrder = getAxisOrderScore(symmetry.rotation_axes[0].order);
        for (let i = 1, il = symmetry.rotation_axes.length; i < il; ++i) {
            const axis = symmetry.rotation_axes[i];
            const axisOrder = getAxisOrderScore(axis.order);
            if (axisOrder > highestOrder) highestOrder = axisOrder;
        }
        return symmetry.rotation_axes.filter(axis => getAxisOrderScore(axis.order) === highestOrder);
    }

    const requestedOrder = parseInt(order, 10);
    return symmetry.rotation_axes.filter(axis => axis.order === requestedOrder);
}

function clearAssemblyAxes(outAxes: number[], outCenter: Vec3) {
    outAxes.fill(0);
    Vec3.set(outCenter, 0, 0, 0);
}

function writeAssemblyAxes(axes: NonNullable<ReturnType<typeof getSymmetryAxes>>, outAxes: number[], outCenter: Vec3) {
    clearAssemblyAxes(outAxes, outCenter);

    let count = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;

    for (let i = 0, il = axes.length; i < il && count < AudioReactiveAssemblyAxisMaxCount; ++i) {
        const axis = axes[i];
        const direction = Vec3.sub(Vec3(), axis.end as Vec3, axis.start as Vec3);
        if (Vec3.magnitude(direction) < 1e-6) continue;
        Vec3.normalize(direction, direction);

        const offset = count * 3;
        outAxes[offset] = direction[0];
        outAxes[offset + 1] = direction[1];
        outAxes[offset + 2] = direction[2];

        cx += (axis.start[0] + axis.end[0]) * 0.5;
        cy += (axis.start[1] + axis.end[1]) * 0.5;
        cz += (axis.start[2] + axis.end[2]) * 0.5;
        count += 1;
    }

    if (count > 0) {
        Vec3.set(outCenter, cx / count, cy / count, cz / count);
    }

    return count;
}

export function getStructureAssemblyAxes(structure: Structure, order: AudioReactiveAssemblyAxisOrder, outAxes: number[], outCenter: Vec3) {
    const axes = getSymmetryAxes(getAssemblySymmetry(structure), order);
    if (!axes || axes.length === 0) {
        clearAssemblyAxes(outAxes, outCenter);
        return 0;
    }
    return writeAssemblyAxes(axes, outAxes, outCenter);
}

export function getSelectedStructureAssemblyAxes(plugin: PluginContext, order: AudioReactiveAssemblyAxisOrder, outAxes: number[], outCenter: Vec3) {
    for (const selected of plugin.managers.structure.hierarchy.selection.structures) {
        const structure = selected.cell.obj?.data;
        if (!structure) continue;
        const count = getStructureAssemblyAxes(structure, order, outAxes, outCenter);
        if (count > 0) return count;
    }
    clearAssemblyAxes(outAxes, outCenter);
    return 0;
}
