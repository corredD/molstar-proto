/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 */

import { SymmetryOperator } from '../../../mol-math/geometry';
import { Mat3, Mat4, Quat, Vec3 } from '../../../mol-math/linear-algebra';
import { Euler } from '../../../mol-math/linear-algebra/3d/euler';
import { RelionStarParticleList } from '../../../mol-io/reader/relion/star';
import { Structure, Unit } from '../../../mol-model/structure';
import { PluginContext } from '../../../mol-plugin/context';
import { getRelionParticleTransforms } from '../../../mol-plugin-state/helpers/relion-star';
import { Asset } from '../../../mol-util/assets';
import { Clip } from '../../../mol-util/clip';
import { ParamDefinition as PD } from '../../../mol-util/param-definition';
import { NumberArray } from '../../../mol-util/type-helpers';
import { mergeUnits } from './util';

export const MesoscalePlacementParams = {
    placementMode: PD.Select<'original' | 'particle-list'>('original', [
        ['original', 'Original'],
        ['particle-list', 'Particle List'],
    ], { isHidden: true }),
    particleListRef: PD.Text('', { isHidden: true }),
    positionScale: PD.Numeric(1, { min: 0.01, max: 100, step: 0.5 }, { isHidden: true }),
    originalClipVariant: PD.Select<Clip.Variant>('instance', [['instance', 'instance'], ['pixel', 'pixel']], { isHidden: true }),
    originalVisuals: PD.Value<string[]>([], { isHidden: true }),
};
export type MesoscalePlacementProps = PD.Values<typeof MesoscalePlacementParams>

type PlacementBinaryData = {
    file: Asset,
    view?: {
        byteOffset: number,
        byteLength: number
    }
}

type PlacementInstances = {
    positions: {
        data: number[] | PlacementBinaryData
    }
    rotations: {
        variant: 'euler' | 'quaternion' | 'matrix',
        data: number[] | PlacementBinaryData
    }
}

export function getMesoscalePlacementProps(originalClipVariant: Clip.Variant, originalVisuals?: string[]): MesoscalePlacementProps {
    return {
        ...PD.getDefaultValues(MesoscalePlacementParams),
        originalClipVariant,
        originalVisuals: originalVisuals ? [...originalVisuals] : [],
    };
}

export function getMesoscaleRepresentationPlacement(mode: 'original' | 'particle-list', originalClipVariant: Clip.Variant, originalVisuals?: readonly string[]) {
    if (mode === 'particle-list') {
        return {
            clipVariant: 'instance' as Clip.Variant,
            visuals: originalVisuals?.includes('structure-element-sphere') ? ['element-sphere'] : (originalVisuals?.length ? [...originalVisuals] : void 0),
        };
    }

    return {
        clipVariant: originalClipVariant,
        visuals: originalVisuals?.length ? [...originalVisuals] : void 0,
    };
}

export function getParticleListTransforms(plugin: PluginContext, particleListRef: string, positionScale: number) {
    const particleList = plugin.state.data.cells.get(particleListRef)?.obj?.data as RelionStarParticleList | undefined;
    if (!particleList) return void 0;
    return getRelionParticleTransforms(particleList, positionScale);
}

const placementPosition = Vec3();
const placementQuat = Quat();
const placementMat3 = Mat3();
const placementEuler = Euler.create(0, 0, 0);

async function getPlacementArray(plugin: PluginContext, data: number[] | PlacementBinaryData): Promise<NumberArray> {
    if (Array.isArray(data)) return data;

    const asset = await plugin.runTask(plugin.managers.asset.resolve(data.file, 'binary'));
    const offset = data.view?.byteOffset || 0;
    const byteLength = data.view?.byteLength || asset.data.byteLength;
    return new Float32Array(asset.data.buffer, offset + asset.data.byteOffset, byteLength / 4);
}

async function getOriginalTransforms(plugin: PluginContext, instances?: PlacementInstances) {
    const transforms: Mat4[] = [];
    if (!instances) {
        transforms.push(Mat4.identity());
        return transforms;
    }

    const positions = await getPlacementArray(plugin, instances.positions.data);
    const rotations = await getPlacementArray(plugin, instances.rotations.data);
    for (let i = 0, il = positions.length / 3; i < il; ++i) {
        Vec3.fromArray(placementPosition, positions, i * 3);
        if (instances.rotations.variant === 'matrix') {
            Mat3.fromArray(placementMat3, rotations, i * 9);
            const transform = Mat4.fromMat3(Mat4(), placementMat3);
            Mat4.setTranslation(transform, placementPosition);
            transforms.push(transform);
        } else if (instances.rotations.variant === 'quaternion') {
            Quat.fromArray(placementQuat, rotations, i * 4);
            const transform = Mat4.fromQuat(Mat4(), placementQuat);
            Mat4.setTranslation(transform, placementPosition);
            transforms.push(transform);
        } else {
            Euler.fromArray(placementEuler, rotations, i * 3);
            Quat.fromEuler(placementQuat, placementEuler, 'XYZ');
            const transform = Mat4.fromQuat(Mat4(), placementQuat);
            Mat4.setTranslation(transform, placementPosition);
            transforms.push(transform);
        }
    }
    return transforms;
}

export async function getPlacementTransforms(plugin: PluginContext, params: Pick<MesoscalePlacementProps, 'placementMode' | 'particleListRef' | 'positionScale'>, originalInstances?: PlacementInstances) {
    if (params.placementMode === 'particle-list') {
        const particleTransforms = getParticleListTransforms(plugin, params.particleListRef, params.positionScale);
        if (particleTransforms && particleTransforms.length > 0) return particleTransforms;
    }

    return getOriginalTransforms(plugin, originalInstances);
}

export function getMergedTemplateUnit(units: readonly Unit[]): Unit | undefined {
    if (units.length === 0) return void 0;

    const seen = new Set<number>();
    const templateUnits: Unit[] = [];

    for (const unit of units) {
        if (seen.has(unit.invariantId)) continue;
        seen.add(unit.invariantId);
        templateUnits.push(Unit.create(
            templateUnits.length,
            unit.invariantId,
            unit.chainGroupId,
            unit.traits,
            unit.kind,
            unit.model,
            SymmetryOperator.Default,
            unit.elements,
        ));
    }

    return templateUnits.length === 1 ? templateUnits[0] : mergeUnits(templateUnits, 0);
}

export function buildInstancedStructure(unit: Unit, transforms: readonly Mat4[], label: string) {
    const builder = Structure.Builder({ label });
    for (let i = 0, il = transforms.length; i < il; ++i) {
        builder.addWithOperator(unit, SymmetryOperator.create(`op-${i}`, transforms[i]));
    }
    return builder.getStructure();
}
