/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { RuntimeContext, Task } from '../../mol-task';
import { ShapeProvider } from '../../mol-model/shape/provider';
import { Color } from '../../mol-util/color';
import { ObjFile } from '../../mol-io/reader/obj/schema';
import { MeshBuilder } from '../../mol-geo/geometry/mesh/mesh-builder';
import { Mesh } from '../../mol-geo/geometry/mesh/mesh';
import { Shape } from '../../mol-model/shape';
import { ChunkedArray } from '../../mol-data/util';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { ColorNames } from '../../mol-util/color/names';
import { deepClone } from '../../mol-util/object';
import { ValueCell } from '../../mol-util/value-cell';
import { Mat4 } from '../../mol-math/linear-algebra/3d/mat4';

export type ObjData = {
    source: ObjFile,
    transforms?: Mat4[],
}

function createObjShapeParams(objFile?: ObjFile) {
    const hasVertexColors = !!objFile && objFile.colors.length > 0;
    return {
        ...Mesh.Params,
        coloring: PD.MappedStatic(hasVertexColors ? 'vertex' : 'uniform', {
            vertex: PD.Group({}, { isFlat: true }),
            uniform: PD.Group({
                color: PD.Color(ColorNames.grey),
                saturation: PD.Numeric(0, { min: -6, max: 6, step: 0.1 }),
                lightness: PD.Numeric(0, { min: -6, max: 6, step: 0.1 }),
            }, { isFlat: true })
        }),
    };
}

export const ObjShapeParams = createObjShapeParams();
export type ObjShapeParams = typeof ObjShapeParams

async function getMesh(ctx: RuntimeContext, source: ObjFile, mesh?: Mesh) {
    const {
        vertices, normals, colors,
        faceCornerCounts, faceCornerOffsets,
        faceVertexIndices, faceNormalIndices,
    } = source;

    const faceCount = faceCornerCounts.length;
    // upper bound: each n-gon emits (n-2) triangles, and we expand each corner
    // into a unique mesh vertex. Estimate from total corner count.
    const totalCorners = faceCornerOffsets[faceCount] || 0;
    const estVertices = Math.max(totalCorners, 16);
    const estTriangles = Math.max(totalCorners - 2 * faceCount, 8);

    const builderState = MeshBuilder.createState(estVertices, estTriangles, mesh);
    const { vertices: outV, normals: outN, groups: outG, indices: outI } = builderState;

    const hasNormals = normals.length > 0;
    const updateChunk = 50000;

    let nextVertex = 0;
    for (let f = 0; f < faceCount; ++f) {
        const start = faceCornerOffsets[f];
        const count = faceCornerCounts[f];
        const baseVertex = nextVertex;

        // Push one mesh vertex per face corner. Per-corner normals (OBJ allows the
        // same source vertex to carry different normals across faces).
        for (let c = 0; c < count; ++c) {
            const ci = start + c;
            const vi = faceVertexIndices[ci];
            const v3 = vi * 3;
            ChunkedArray.add3(outV, vertices[v3], vertices[v3 + 1], vertices[v3 + 2]);

            if (hasNormals) {
                const ni = faceNormalIndices[ci];
                if (ni >= 0) {
                    const n3 = ni * 3;
                    ChunkedArray.add3(outN, normals[n3], normals[n3 + 1], normals[n3 + 2]);
                } else {
                    ChunkedArray.add3(outN, 0, 0, 0);
                }
            }
            // Group by source-vertex index so picking maps back to the OBJ vertex.
            ChunkedArray.add(outG, vi);
            nextVertex++;
        }

        // Fan triangulation: (c0, c1, c2), (c0, c2, c3), ...
        for (let t = 1; t < count - 1; ++t) {
            ChunkedArray.add3(outI, baseVertex, baseVertex + t, baseVertex + t + 1);
        }

        if (ctx.shouldUpdate && (f % updateChunk) === 0) {
            await ctx.update({ message: 'building OBJ mesh', current: f, max: faceCount });
        }
    }

    const m = MeshBuilder.getMesh(builderState);
    if (!hasNormals) Mesh.computeNormals(m);

    ValueCell.updateIfChanged(m.varyingGroup, true);

    // Stash per-mesh-vertex source-vertex index for coloring lookup.
    void colors;
    return m;
}

type Coloring =
    | { kind: 'vertex' }
    | { kind: 'uniform', r: number, g: number, b: number };

function getColoring(props: PD.Values<ObjShapeParams>): Coloring {
    const { coloring } = props;
    if (coloring.name === 'uniform') {
        let color = coloring.params.color;
        color = Color.saturate(color, coloring.params.saturation);
        color = Color.lighten(color, coloring.params.lightness);
        const [r, g, b] = Color.toRgb(color);
        return { kind: 'uniform', r, g, b };
    }
    return { kind: 'vertex' };
}

function createShape(objData: ObjData, mesh: Mesh, coloring: Coloring) {
    const { source, transforms } = objData;
    const colors = source.colors;
    const hasVertexColors = colors.length > 0;

    return Shape.create(
        'obj-mesh', source, mesh,
        (groupId: number) => {
            if (coloring.kind === 'uniform' || !hasVertexColors) {
                if (coloring.kind === 'uniform') return Color.fromRgb(coloring.r, coloring.g, coloring.b);
                return Color.fromRgb(127, 127, 127);
            }
            const i = groupId * 3;
            return Color.fromRgb(
                Math.round(colors[i] * 255) | 0,
                Math.round(colors[i + 1] * 255) | 0,
                Math.round(colors[i + 2] * 255) | 0
            );
        },
        () => 1,
        (groupId: number) => `Vertex ${groupId}`,
        transforms
    );
}

function makeShapeGetter() {
    let _objData: ObjData | undefined;
    let _props: PD.Values<ObjShapeParams> | undefined;

    let _shape: Shape<Mesh>;
    let _mesh: Mesh;
    let _coloring: Coloring;

    const getShape = async (ctx: RuntimeContext, objData: ObjData, props: PD.Values<ObjShapeParams>, shape?: Shape<Mesh>) => {
        let newMesh = false;
        let newColor = false;

        if (!_objData || _objData !== objData) newMesh = true;
        if (!_props || !PD.isParamEqual(ObjShapeParams.coloring, _props.coloring, props.coloring)) newColor = true;

        if (newMesh) {
            _mesh = await getMesh(ctx, objData.source, shape && shape.geometry);
            _coloring = getColoring(props);
            _shape = createShape(objData, _mesh, _coloring);
        } else if (newColor) {
            _coloring = getColoring(props);
            _shape = createShape(objData, _mesh, _coloring);
        }

        _objData = objData;
        _props = deepClone(props);
        return _shape;
    };
    return getShape;
}

export function shapeFromObj(source: ObjFile, params?: { transforms?: Mat4[] }) {
    return Task.create<ShapeProvider<ObjData, Mesh, ObjShapeParams>>('Shape Provider', async ctx => {
        return {
            label: 'Mesh',
            data: { source, transforms: params?.transforms },
            params: createObjShapeParams(source),
            getShape: makeShapeGetter(),
            geometryUtils: Mesh.Utils,
        };
    });
}
