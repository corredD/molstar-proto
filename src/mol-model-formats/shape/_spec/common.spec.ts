/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ChunkedArray } from '../../../mol-data/util';
import { Mesh } from '../../../mol-geo/geometry/mesh/mesh';
import { MeshBuilder } from '../../../mol-geo/geometry/mesh/mesh-builder';
import { Shape } from '../../../mol-model/shape';
import { Mat4 } from '../../../mol-math/linear-algebra';
import { RuntimeContext } from '../../../mol-task';
import { Color } from '../../../mol-util/color';
import { ColorNames } from '../../../mol-util/color/names';
import { ParamDefinition as PD } from '../../../mol-util/param-definition';
import { ShapeWireframeParams, wireframeShapeGetter } from '../common';
import { ObjShapeParams } from '../obj';
import { PlyShapeParams } from '../ply';
import { VtpShapeParams } from '../vtp';

// ─── helpers ─────────────────────────────────────────────────────────────────

/** A single triangle, one group per vertex. */
function triangleMesh(): Mesh {
    const state = MeshBuilder.createState(3, 1);
    ChunkedArray.add3(state.vertices, 0, 0, 0);
    ChunkedArray.add3(state.vertices, 1, 0, 0);
    ChunkedArray.add3(state.vertices, 0, 1, 0);
    for (let i = 0; i < 3; i++) ChunkedArray.add(state.groups, i);
    ChunkedArray.add3(state.indices, 0, 1, 2);
    return MeshBuilder.getMesh(state);
}

const transforms = [Mat4.fromTranslation(Mat4(), [1, 2, 3] as any)];

function meshShape(name: string) {
    return Shape.create(
        name, { src: name }, triangleMesh(),
        () => ColorNames.red as Color,
        () => 1,
        (gid: number) => `Vertex ${gid}`,
        transforms, 3
    );
}

const ctx = {} as RuntimeContext;

// ─── tests ───────────────────────────────────────────────────────────────────

describe('wireframeShapeGetter', () => {
    it('mirrors the mesh shape as lines, keeping its color, size, label and transforms', async () => {
        const mesh = meshShape('vtp-mesh');
        const getWireframe = wireframeShapeGetter(async () => mesh);

        const wireframe = await getWireframe(ctx, {}, {});

        expect(wireframe.geometry.kind).toBe('lines');
        expect(wireframe.geometry.lineCount).toBe(3);
        expect(wireframe.name).toBe('vtp-mesh-wireframe');
        expect(wireframe.sourceData).toBe(mesh.sourceData);
        expect(wireframe.groupCount).toBe(mesh.groupCount);
        expect(wireframe.transforms).toBe(transforms);
        expect(wireframe.getColor(0, 0)).toBe(mesh.getColor(0, 0));
        expect(wireframe.getSize(0, 0)).toBe(mesh.getSize(0, 0));
        expect(wireframe.getLabel(1, 0)).toBe('Vertex 1');
    });

    it('reuses the lines while the mesh shape is unchanged', async () => {
        const mesh = meshShape('vtp-mesh');
        const getWireframe = wireframeShapeGetter(async () => mesh);

        const first = await getWireframe(ctx, {}, {});
        const second = await getWireframe(ctx, {}, {});

        expect(second).toBe(first);
    });

    it('rebuilds when the mesh getter returns a new shape', async () => {
        let mesh = meshShape('vtp-mesh');
        const getWireframe = wireframeShapeGetter(async () => mesh);

        const first = await getWireframe(ctx, {}, {});
        mesh = meshShape('vtp-mesh');
        const second = await getWireframe(ctx, {}, {}, first);

        expect(second).not.toBe(first);
        expect(second.id).not.toBe(first.id);
    });
});

describe('shape wireframe params', () => {
    it('defaults to the mesh visual only, so existing shapes render unchanged', () => {
        expect(PD.getDefaultValues(ShapeWireframeParams).visuals).toEqual(['mesh']);
    });

    it.each([
        ['vtp', VtpShapeParams],
        ['ply', PlyShapeParams],
        ['obj', ObjShapeParams],
    ])('are offered by the %s shape provider', (_name, params) => {
        const values = PD.getDefaultValues(params);
        expect(values.visuals).toEqual(['mesh']);
        expect(values.sizeFactor).toBe(PD.getDefaultValues(ShapeWireframeParams).sizeFactor);
    });
});
