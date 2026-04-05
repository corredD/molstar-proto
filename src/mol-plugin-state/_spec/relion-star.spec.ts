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
import { applyStructureInstances, clearStructureInstances, getRelionParticleAxisParams, getRelionParticleAxisShape, getRelionParticleTransform } from '../helpers/relion-star';
import { StateTransforms } from '../transforms';
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
});
