/**
 * Copyright (c) 2021-2023 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { utf8ByteCount, utf8Write } from '../../mol-io/common/utf8';
import { Vec3 } from '../../mol-math/linear-algebra';
import { Structure, to_mmCIF, Unit } from '../../mol-model/structure';
import { InstanceAssemblyData } from '../../mol-model/structure/export/categories/instance_assembly';
import { StateTransforms } from '../../mol-plugin-state/transforms';
import { getTransformFromParams, transformParamsNeedCentroid } from '../../mol-plugin-state/transforms/helpers';
import { PluginContext } from '../../mol-plugin/context';
import { StateSelection, StateTransform } from '../../mol-state';
import { Task } from '../../mol-task';
import { getFormattedTime } from '../../mol-util/date';
import { download } from '../../mol-util/download';
import { zip } from '../../mol-util/zip/zip';

const ModelExportNameProp = '__ModelExportName__';
export const ModelExport = {
    getStructureName(structure: Structure): string | undefined {
        return structure.inheritedPropertyData[ModelExportNameProp];
    },
    setStructureName(structure: Structure, name: string) {
        return structure.inheritedPropertyData[ModelExportNameProp] = name;
    }
};

/**
 * Instance transforms of the `StructureInstances` decorator sitting on `structureRef`, if any.
 *
 * `structure` must be the decorator's *input*, i.e. a single copy of the coordinates, because the
 * operators are what generate the instances from it. That holds today only because the structure
 * hierarchy has no mapping for `StructureInstances`, so `StructureRef.cell` is the cell before the
 * decorator. If that ever changes, this has to select the pre-instance structure explicitly —
 * otherwise the export writes the expanded copies *and* the operators, double-applying them.
 */
function getInstanceAssembly(plugin: PluginContext, structureRef: StateTransform.Ref, structure: Structure): InstanceAssemblyData | undefined {
    const cell = StateSelection.tryFindDecorator(plugin.state.data, structureRef, StateTransforms.Model.StructureInstances);
    const transformParams = cell?.params?.values?.transforms;
    if (!transformParams?.length) return void 0;

    const center = transformParams.some((t: any) => transformParamsNeedCentroid(t.transform))
        ? structure.boundary.sphere.center
        : Vec3.unit;
    return { transforms: transformParams.map((t: any) => getTransformFromParams(t.transform, center)) };
}

export async function exportHierarchy(plugin: PluginContext, options?: { format?: 'cif' | 'bcif', instancesAsAssembly?: boolean }) {
    try {
        await plugin.runTask(_exportHierarchy(plugin, options), { useOverlay: true });
    } catch (e) {
        console.error(e);
        plugin.log.error(`Model export failed. See console for details.`);
    }
}

function _exportHierarchy(plugin: PluginContext, options?: { format?: 'cif' | 'bcif', instancesAsAssembly?: boolean }) {
    return Task.create('Export', async ctx => {
        await ctx.update({ message: 'Exporting...', isIndeterminate: true, canAbort: false });

        const format = options?.format ?? 'cif';
        const { structures } = plugin.managers.structure.hierarchy.current;

        const files: [name: string, data: string | Uint8Array<ArrayBuffer>][] = [];
        const entryMap = new Map<string, number>();

        for (const _s of structures) {
            const s = _s.transform?.cell.obj?.data ?? _s.cell.obj?.data;
            if (!s) continue;
            if (s.models.length > 1) {
                plugin.log.warn(`[Export] Skipping ${_s.cell.obj?.label}: Multimodel exports not supported.`);
                continue;
            }
            if (s.units.some(u => !Unit.isAtomic(u))) {
                plugin.log.warn(`[Export] Skipping ${_s.cell.obj?.label}: Non-atomic model exports not supported.`);
                continue;
            }

            const name = ModelExport.getStructureName(s) || s.model.entryId || 'unnamed';

            const fileName = entryMap.has(name)
                ? `${name}_${entryMap.get(name)! + 1}.${format}`
                : `${name}.${format}`;
            entryMap.set(name, (entryMap.get(name) ?? 0) + 1);

            await ctx.update({ message: `Exporting ${name}...`, isIndeterminate: true, canAbort: false });
            if (s.elementCount > 100000) {
                // Give UI chance to update, only needed for larger structures.
                await new Promise(res => setTimeout(res, 50));
            }

            const instanceAssembly = options?.instancesAsAssembly
                ? getInstanceAssembly(plugin, _s.cell.transform.ref, s)
                : void 0;
            if (instanceAssembly) {
                plugin.log.info(`[Export] ${name}: writing ${instanceAssembly.transforms.length} particle instances as assembly operators.`);
            }

            try {
                files.push([fileName, to_mmCIF(name, s, format === 'bcif', { copyAllCategories: true, instanceAssembly })]);
            } catch (e) {
                if (format === 'cif' && s.elementCount > 2000000) {
                    plugin.log.warn(`[Export] The structure might be too big to be exported as Text CIF, consider using the BinaryCIF format instead.`);
                }
                throw e;
            }
        }

        if (files.length === 1) {
            download(new Blob([files[0][1]]), files[0][0]);
        } else if (files.length > 1) {
            const zipData: Record<string, Uint8Array<ArrayBuffer>> = {};
            for (const [fn, data] of files) {
                if (data instanceof Uint8Array) {
                    zipData[fn] = data;
                } else {
                    const bytes = new Uint8Array(utf8ByteCount(data));
                    utf8Write(bytes, 0, data);
                    zipData[fn] = bytes;
                }
            }
            await ctx.update({ message: `Compressing Data...`, isIndeterminate: true, canAbort: false });
            const buffer = await zip(ctx, zipData);
            download(new Blob([new Uint8Array(buffer, 0, buffer.byteLength)]), `structures_${getFormattedTime()}.zip`);
        }

        plugin.log.info(`[Export] Done.`);
    });
}