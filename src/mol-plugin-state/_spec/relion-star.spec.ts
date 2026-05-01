/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 */

import { Mat4, Vec3 } from '../../mol-math/linear-algebra';
import { RelionStarParticleList } from '../../mol-io/reader/relion/star';
import { StateTransform, StateTree } from '../../mol-state';
import { ColorNames } from '../../mol-util/color/names';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { applyStructureInstances, applyVolumeInstances, clearStructureInstances, clearVolumeInstances, getRelionParticleAxisParams, getRelionParticleAxisShape, getRelionParticleTransform } from '../helpers/relion-star';
import { StateTransforms } from '../transforms';
import { VolumeRepresentation3DHelpers } from '../transforms/representation';
import { Map as ImmutableMap, OrderedSet } from 'immutable';

function createParticleList(particle: RelionStarParticleList['particles'][number]): RelionStarParticleList {
    return {
        format: 'relion-star',
        particleBlockHeader: 'particles',
        particles: [particle],
        suggestedScale: 1,
        warnings: []
    };
}

const MatrixParams = { transform: { name: 'matrix' as const, params: { data: Mat4.identity(), transpose: false } } };

function createTree(withInstances = false) {
    const root = StateTransform.createRoot();
    const structure = StateTransforms.Misc.CreateGroup.apply(root.ref, { label: 'Structure' }, { ref: 'structure' });
    const transform = StateTransforms.Model.TransformStructureConformation.apply(structure.ref, MatrixParams, { ref: 'transform' });
    const componentParent = withInstances
        ? StateTransforms.Model.StructureInstances.apply(transform.ref, { transforms: [{ transform: { name: 'matrix', params: { data: Mat4.identity(), transpose: false } } }] }, { ref: 'instances' })
        : void 0;
    const component = StateTransforms.Misc.CreateGroup.apply((componentParent ?? transform).ref, { label: 'Component' }, { ref: 'component' });

    const transforms = ImmutableMap([
        [root.ref, root],
        [structure.ref, structure],
        [transform.ref, transform],
        ...(componentParent ? [[componentParent.ref, componentParent] as const] : []),
        [component.ref, component]
    ]) as any;
    const children = ImmutableMap([
        [root.ref, OrderedSet([structure.ref])],
        [structure.ref, OrderedSet([transform.ref])],
        [transform.ref, OrderedSet(componentParent ? [componentParent.ref] : [component.ref])],
        ...(componentParent ? [[componentParent.ref, OrderedSet([component.ref])] as const] : []),
        [component.ref, OrderedSet()]
    ]) as any;

    return StateTree.create(transforms, children, ImmutableMap() as any);
}

function createVolumeTree(withInstances = false) {
    const root = StateTransform.createRoot();
    const volume = StateTransforms.Misc.CreateGroup.apply(root.ref, { label: 'Volume' }, { ref: 'volume' });
    const transform = StateTransforms.Volume.VolumeTransform.apply(volume.ref, MatrixParams, { ref: 'transform' });
    const componentParent = withInstances
        ? StateTransforms.Volume.VolumeInstances.apply(transform.ref, { mode: 'transforms', transforms: [{ transform: { name: 'matrix', params: { data: Mat4.identity(), transpose: false } } }] }, { ref: 'instances' })
        : void 0;
    const representation = StateTransforms.Misc.CreateGroup.apply((componentParent ?? transform).ref, { label: 'Representation' }, { ref: 'representation' });

    const transforms = ImmutableMap([
        [root.ref, root],
        [volume.ref, volume],
        [transform.ref, transform],
        ...(componentParent ? [[componentParent.ref, componentParent] as const] : []),
        [representation.ref, representation]
    ]) as any;
    const children = ImmutableMap([
        [root.ref, OrderedSet([volume.ref])],
        [volume.ref, OrderedSet([transform.ref])],
        [transform.ref, OrderedSet(componentParent ? [componentParent.ref] : [representation.ref])],
        ...(componentParent ? [[componentParent.ref, OrderedSet([representation.ref])] as const] : []),
        [representation.ref, OrderedSet()]
    ]) as any;

    return StateTree.create(transforms, children, ImmutableMap() as any);
}

function createBuilderSpy() {
    const calls: any[] = [];
    const builder = {
        to(ref: string) {
            return {
                update(params: any) {
                    calls.push({ kind: 'update', ref, params });
                    return builder;
                },
                apply(transformer: any, params: any, options: any) {
                    calls.push({ kind: 'apply', ref, transformer, params, options });
                    return { ref: 'instances' };
                }
            };
        }
    };
    return { builder: builder as any, calls };
}

describe('RELION STAR helpers', () => {
    it('applies position scale to coordinates and pixel origins only', () => {
        const pixelTransform = getRelionParticleTransform(Mat4(), createParticleList({
            index: 0,
            coordinate: Vec3.create(10, 20, 30),
            coordinateUnit: 'pixel',
            origin: Vec3.create(1, 2, 3),
            originUnit: 'pixel',
            rotation: Mat4.identity()
        }).particles[0], 2);
        expect(Array.from(Mat4.getTranslation(Vec3(), pixelTransform))).toEqual([18, 36, 54]);

        const angstromOriginTransform = getRelionParticleTransform(Mat4(), createParticleList({
            index: 0,
            coordinate: Vec3.create(10, 20, 30),
            coordinateUnit: 'pixel',
            origin: Vec3.create(1, 2, 3),
            originUnit: 'angstrom',
            rotation: Mat4.identity()
        }).particles[0], 2);
        expect(Array.from(Mat4.getTranslation(Vec3(), angstromOriginTransform))).toEqual([19, 38, 57]);
    });

    it('rotates origin shifts before subtraction when an origin frame is provided', () => {
        const originRotation = Mat4.fromRotation(Mat4(), Math.PI / 2, Vec3.unitZ);
        const transform = getRelionParticleTransform(Mat4(), createParticleList({
            index: 0,
            coordinate: Vec3.create(10, 20, 30),
            coordinateUnit: 'pixel',
            origin: Vec3.create(1, 0, 0),
            originUnit: 'pixel',
            originRotation,
            rotation: Mat4.identity()
        }).particles[0], 2);
        expect(Array.from(Mat4.getTranslation(Vec3(), transform))).toEqual([20, 38, 60]);
    });

    it('uses the particle rotation matrix when building transforms', () => {
        const rotation = Mat4.fromRotation(Mat4(), Math.PI / 2, Vec3.unitZ);
        const transform = getRelionParticleTransform(Mat4(), createParticleList({
            index: 0,
            coordinate: Vec3.create(0, 0, 0),
            coordinateUnit: 'angstrom',
            origin: Vec3.create(0, 0, 0),
            originUnit: 'angstrom',
            rotation,
        }).particles[0], 1);
        const x = Vec3.transformMat4(Vec3(), Vec3.create(1, 0, 0), transform);
        expect(x[0]).toBeCloseTo(0, 6);
        expect(x[1]).toBeCloseTo(1, 6);
        expect(x[2]).toBeCloseTo(0, 6);
    });

    it('inserts and updates the structure instances decorator at the end of the decorator chain', () => {
        const initialTree = createTree(false);
        const { builder: insertBuilder, calls: insertCalls } = createBuilderSpy();
        const insertedRef = applyStructureInstances(insertBuilder, initialTree, 'structure', [Mat4.identity()]);

        expect(insertedRef).toBe('instances');
        expect(insertCalls[0].kind).toBe('apply');
        expect(insertCalls[0].ref).toBe('transform');

        const updatedTree = createTree(true);
        const { builder: updateBuilder, calls: updateCalls } = createBuilderSpy();
        const updatedRef = applyStructureInstances(updateBuilder, updatedTree, 'structure', [Mat4.identity(), Mat4.identity()]);

        expect(updatedRef).toBe('instances');
        expect(updateCalls[0].kind).toBe('update');
        expect(updateCalls[0].ref).toBe('instances');
        expect(updateCalls[0].params.transforms).toHaveLength(2);
    });

    it('clears particle instances by resetting to a single identity transform', () => {
        const tree = createTree(true);
        const { builder, calls } = createBuilderSpy();
        expect(clearStructureInstances(builder, tree, 'structure')).toBe(true);
        expect(calls[0].kind).toBe('update');
        expect(calls[0].ref).toBe('instances');
        expect(calls[0].params.transforms).toHaveLength(1);
    });

    it('inserts and updates the volume instances decorator at the end of the decorator chain', () => {
        const initialTree = createVolumeTree(false);
        const { builder: insertBuilder, calls: insertCalls } = createBuilderSpy();
        const insertedRef = applyVolumeInstances(insertBuilder, initialTree, 'volume', [Mat4.identity()]);

        expect(insertedRef).toBe('instances');
        expect(insertCalls[0].kind).toBe('apply');
        expect(insertCalls[0].ref).toBe('transform');
        expect(insertCalls[0].transformer).toBe(StateTransforms.Volume.VolumeInstances);

        const updatedTree = createVolumeTree(true);
        const { builder: updateBuilder, calls: updateCalls } = createBuilderSpy();
        const updatedRef = applyVolumeInstances(updateBuilder, updatedTree, 'volume', [Mat4.identity(), Mat4.identity()]);

        expect(updatedRef).toBe('instances');
        expect(updateCalls[0].kind).toBe('update');
        expect(updateCalls[0].ref).toBe('instances');
        expect(updateCalls[0].params.mode).toBe('transforms');
        expect(updateCalls[0].params.transforms).toHaveLength(2);
    });

    it('clears volume particle instances by resetting to an empty transform list', () => {
        const tree = createVolumeTree(true);
        const { builder, calls } = createBuilderSpy();
        expect(clearVolumeInstances(builder, tree, 'volume')).toBe(true);
        expect(calls[0].kind).toBe('update');
        expect(calls[0].ref).toBe('instances');
        expect(calls[0].params.mode).toBe('transforms');
        expect(calls[0].params.transforms).toHaveLength(0);
    });

    it('creates an instanced particle-axis preview shape with default scaling', () => {
        const particleList = {
            format: 'relion-star',
            particleBlockHeader: 'particles',
            particles: [{
                index: 4,
                coordinate: Vec3.create(10, 20, 30),
                coordinateUnit: 'pixel' as const,
                origin: Vec3.create(1, 2, 3),
                originUnit: 'pixel' as const,
                rotation: Mat4.identity()
            }],
            suggestedScale: 2,
            warnings: []
        } satisfies RelionStarParticleList;

        const props = PD.getDefaultValues(getRelionParticleAxisParams(particleList));
        const shape = getRelionParticleAxisShape(particleList, props);

        expect(shape.geometry.kind).toBe('lines');
        expect(shape.geometry.lineCount).toBe(3);
        expect(shape.transforms).toHaveLength(1);
        expect(Array.from(Mat4.getTranslation(Vec3(), shape.transforms[0]))).toEqual([18, 36, 54]);
        expect(shape.getColor(0, 0)).toBe(ColorNames.red);
        expect(shape.getColor(1, 0)).toBe(ColorNames.green);
        expect(shape.getColor(2, 0)).toBe(ColorNames.blue);
        expect(shape.getLabel(2, 0)).toBe('Z axis for particle 5');
    });

    function createInstancedVolume(cellCount: number) {
        return {
            grid: { cells: { data: { length: cellCount } } },
            instances: [{ transform: Mat4.identity() }, { transform: Mat4.identity() }]
        } as any;
    }

    it('preserves dot lod levels for instanced volumes', () => {
        const volume = createInstancedVolume(2);
        const ctx = { canvas3d: { webgl: { maxTextureSize: 2 } } } as any;
        const customLodLevels = [{ minDistance: 10, maxDistance: 20, overlap: 0, stride: 7, scaleBias: 2 }];
        const customLodParams = {
            type: { name: 'dot', params: { lodLevels: customLodLevels, sizeFactor: 1 } },
            colorTheme: { name: 'uniform', params: {} },
            sizeTheme: { name: 'uniform', params: {} }
        } as any;
        const preserved = VolumeRepresentation3DHelpers.normalizeParams(ctx, volume, customLodParams);
        expect(preserved.type.params.instanceGranularity).toBeUndefined();
        expect(preserved.type.params.lodLevels).toEqual(customLodLevels);

        const emptyLodParams = {
            type: { name: 'dot', params: { lodLevels: [], sizeFactor: 1 } },
            colorTheme: { name: 'uniform', params: {} },
            sizeTheme: { name: 'uniform', params: {} }
        } as any;
        const empty = VolumeRepresentation3DHelpers.normalizeParams(ctx, volume, emptyLodParams);
        expect(empty.type.params.instanceGranularity).toBeUndefined();
        expect(empty.type.params.lodLevels).toEqual([]);

        const legacyLodParams = {
            type: {
                name: 'dot',
                params: {
                    sizeFactor: 1,
                    lodLevels: [
                        { minDistance: 1, maxDistance: 1000, overlap: 0, stride: 1, scaleBias: 1 },
                        { minDistance: 1000, maxDistance: 4000, overlap: 0, stride: 10, scaleBias: 3 },
                        { minDistance: 4000, maxDistance: 10000, overlap: 0, stride: 50, scaleBias: 2.7 },
                        { minDistance: 10000, maxDistance: 10000000, overlap: 0, stride: 200, scaleBias: 2.3 }
                    ]
                }
            },
            colorTheme: { name: 'uniform', params: {} },
            sizeTheme: { name: 'uniform', params: {} }
        } as any;
        const legacy = VolumeRepresentation3DHelpers.normalizeParams(ctx, volume, legacyLodParams);
        expect(legacy.type.params.instanceGranularity).toBeUndefined();
        expect(legacy.type.params.lodLevels).toEqual(legacyLodParams.type.params.lodLevels);
    });

    it('uses instance granularity for instanced volumes when group-instance marker data would exceed texture capacity', () => {
        const volume = createInstancedVolume(3);
        const ctx = { canvas3d: { webgl: { maxTextureSize: 2 } } } as any;
        const customLodLevels = [{ minDistance: 10, maxDistance: 20, overlap: 0, stride: 7, scaleBias: 2 }];
        const params = {
            type: { name: 'dot', params: { instanceGranularity: false, lodLevels: customLodLevels, sizeFactor: 1 } },
            colorTheme: { name: 'uniform', params: {} },
            sizeTheme: { name: 'uniform', params: {} }
        } as any;

        const normalized = VolumeRepresentation3DHelpers.normalizeParams(ctx, volume, params);
        expect(normalized.type.params.instanceGranularity).toBe(true);
        expect(normalized.type.params.lodLevels).toEqual(customLodLevels);

        const isosurface = VolumeRepresentation3DHelpers.normalizeParams(ctx, volume, {
            type: { name: 'isosurface', params: { instanceGranularity: false } },
            colorTheme: { name: 'uniform', params: {} },
            sizeTheme: { name: 'uniform', params: {} }
        } as any);
        expect(isosurface.type.params.instanceGranularity).toBe(true);
    });
});
