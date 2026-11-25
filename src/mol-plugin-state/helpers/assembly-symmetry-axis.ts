/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Structure } from '../../mol-model/structure';
import { Vec3 } from '../../mol-math/linear-algebra';
import { ValueCell } from '../../mol-util';
import type { AnimationData } from '../../mol-geo/geometry/animation';
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

type StructureAxes = { key: string, count: number, axes: number[], center: Vec3 };

const symmetryIds = new WeakMap<object, number>();
let nextSymmetryId = 1;
const structureAxes = new WeakMap<Structure, StructureAxes>();
/** which axes each object's values hold (keyed by its axes cell, new when the object is rebuilt) */
const appliedAxes = new WeakMap<object, string>();

/** the axes of `structure` for `order`, cached until its symmetry or the order changes */
function getCachedStructureAxes(structure: Structure, order: AudioReactiveAssemblyAxisOrder): StructureAxes {
    const symmetry = getAssemblySymmetry(structure);
    let symmetryId = 0;
    if (symmetry) {
        symmetryId = symmetryIds.get(symmetry) ?? 0;
        if (!symmetryId) symmetryIds.set(symmetry, symmetryId = nextSymmetryId++);
    }
    const key = `${symmetryId}:${order}`;
    const cached = structureAxes.get(structure);
    if (cached?.key === key) return cached;
    const axes = new Array<number>(AudioReactiveAssemblyAxisMaxCount * 3).fill(0);
    const center = Vec3();
    const count = getStructureAssemblyAxes(structure, order, axes, center);
    const entry = { key: `${key}:${count}`, count, axes, center };
    structureAxes.set(structure, entry);
    return entry;
}

/**
 * Gives every loaded structure's render objects its own symmetry axes and centre (model space; the shader moves them by
 * each instance's transform), so a second virus explodes along its axes, not the first one's. Cheap when nothing
 * changed: one cache lookup per structure and one per object.
 */
export function syncStructureAssemblyAxes(plugin: PluginContext, order: AudioReactiveAssemblyAxisOrder) {
    for (const s of plugin.managers.structure.hierarchy.current.structures) {
        const structure = s.cell.obj?.data;
        if (!structure) continue;
        const entry = getCachedStructureAxes(structure, order);
        for (const component of s.components) {
            for (const r of component.representations) {
                const repr = r.cell.obj?.data.repr;
                if (!repr) continue;
                for (const ro of repr.renderObjects) {
                    const values = ro.values as Partial<AnimationData>;
                    if (!values.uAudioAssemblyAxes || !values.uAudioAssemblyAxisCount || !values.uAudioAssemblyAxisCenter) continue;
                    if (appliedAxes.get(values.uAudioAssemblyAxes) === entry.key) continue;
                    ValueCell.update(values.uAudioAssemblyAxisCount, entry.count);
                    ValueCell.update(values.uAudioAssemblyAxisCenter, Vec3.clone(entry.center));
                    ValueCell.update(values.uAudioAssemblyAxes, entry.axes.slice());
                    appliedAxes.set(values.uAudioAssemblyAxes, entry.key);
                }
            }
        }
    }
}
