/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { RuntimeContext, Task } from '../../mol-task';
import { ShapeProvider } from '../../mol-model/shape/provider';
import { Color } from '../../mol-util/color';
import { GltfFile, GltfJson, GltfMeshPrimitive } from '../../mol-io/reader/gltf/schema';
import { MeshBuilder } from '../../mol-geo/geometry/mesh/mesh-builder';
import { Mesh } from '../../mol-geo/geometry/mesh/mesh';
import { Shape } from '../../mol-model/shape';
import { ChunkedArray } from '../../mol-data/util';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { ColorNames } from '../../mol-util/color/names';
import { Mat4, Vec3, Quat } from '../../mol-math/linear-algebra';
import { distinctColors } from '../../mol-util/color/distinct';
import { ValueCell } from '../../mol-util';

// glTF 2.0 accessor componentType constants
const FLOAT = 5126;
const UNSIGNED_INT = 5125;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_BYTE = 5121;

export type GltfData = { source: GltfFile }

type GltfColoringName = 'uniform' | 'given' | 'custom' | 'vertex';

function getMaterialNames(json: GltfJson): string[] {
    return (json.materials ?? []).map((m, i) => m.name ?? `Material ${i}`);
}

function getBaseColor(json: GltfJson, materialIdx: number): Color {
    const factor = json.materials?.[materialIdx]?.pbrMetallicRoughness?.baseColorFactor;
    return factor ? Color.fromNormalizedRgb(factor[0], factor[1], factor[2]) : ColorNames.grey;
}

export function createGltfShapeParams(source?: GltfFile, hasVertexColors = false) {
    const materialNames = source ? getMaterialNames(source.json) : [];
    const hasMaterials = materialNames.length > 0;
    const hasBaseColors = hasMaterials && (source!.json.materials ?? []).some(
        m => m.pbrMetallicRoughness?.baseColorFactor !== undefined
    );

    const defaultColors = materialNames.length > 1
        ? distinctColors(materialNames.length)
        : materialNames.length === 1 ? [ColorNames.grey] : [];

    const materialColorParams: Record<string, PD.Color> = {};
    for (let i = 0; i < materialNames.length; i++) {
        materialColorParams[materialNames[i]] = PD.Color(defaultColors[i]);
    }

    type ColoringOpts = {
        uniform: PD.Group<{ color: Color }>;
        given?: PD.Group<{}>;
        custom?: PD.Group<Record<string, Color>>;
        vertex?: PD.Group<{}>;
    }
    const coloringOptions: ColoringOpts = {
        uniform: PD.Group({ color: PD.Color(ColorNames.grey) }, { isFlat: true }),
    };
    if (hasBaseColors) coloringOptions.given = PD.Group({}, { isFlat: true });
    if (hasMaterials) coloringOptions.custom = PD.Group(materialColorParams, { isFlat: false });
    if (hasVertexColors) coloringOptions.vertex = PD.Group({}, { isFlat: true });

    const defaultColoring: GltfColoringName =
        hasVertexColors ? 'vertex' : hasBaseColors ? 'given' : hasMaterials ? 'custom' : 'uniform';

    return {
        ...Mesh.Params,
        coloring: PD.MappedStatic(defaultColoring, coloringOptions),
    };
}

export const GltfShapeParams = createGltfShapeParams();
export type GltfShapeParams = typeof GltfShapeParams;

function getMaterialColors(source: GltfFile, props: PD.Values<GltfShapeParams>): Color[] {
    const { json } = source;
    const materialNames = getMaterialNames(json);
    const count = Math.max(1, materialNames.length);
    const { coloring } = props;

    if (coloring.name === 'vertex') return []; // colors come from geometry
    if (coloring.name === 'uniform') return Array<Color>(count).fill(coloring.params.color);
    if (coloring.name === 'given') {
        if (materialNames.length === 0) return [ColorNames.grey];
        return materialNames.map((_, i) => getBaseColor(json, i));
    }
    // custom
    if (materialNames.length === 0) return [ColorNames.grey];
    const params = coloring.params as Record<string, Color>;
    return materialNames.map(name => params[name] ?? ColorNames.grey);
}

// --- Accessor reading ---

/**
 * Read a VEC3 FLOAT accessor into a Float32Array.
 * Handles byteStride interleaving and sub-arrayed (GLB BIN chunk) buffers.
 */
function readVec3Float(file: GltfFile, accessorIdx: number): Float32Array | null {
    const { json, buffers } = file;
    const accessor = json.accessors?.[accessorIdx];
    if (!accessor || accessor.componentType !== FLOAT || accessor.type !== 'VEC3') return null;

    const bvIdx = accessor.bufferView;
    if (bvIdx === undefined) return null;
    const bv = json.bufferViews?.[bvIdx];
    if (!bv) return null;

    const buf = buffers[bv.buffer];
    if (!buf) return null;

    const count = accessor.count;
    const bvOffset = bv.byteOffset ?? 0;
    const accOffset = accessor.byteOffset ?? 0;
    const elementBytes = 12; // 3 * sizeof(float32)
    const stride = bv.byteStride ?? elementBytes;

    if (stride === elementBytes) {
        const startByte = buf.byteOffset + bvOffset + accOffset;
        return new Float32Array(buf.buffer, startByte, count * 3);
    }

    // Interleaved
    const result = new Float32Array(count * 3);
    const dv = new DataView(buf.buffer, buf.byteOffset);
    for (let i = 0; i < count; i++) {
        const off = bvOffset + accOffset + i * stride;
        result[i * 3] = dv.getFloat32(off, true);
        result[i * 3 + 1] = dv.getFloat32(off + 4, true);
        result[i * 3 + 2] = dv.getFloat32(off + 8, true);
    }
    return result;
}

/**
 * Read a SCALAR index accessor into a native typed array view.
 * Supports UNSIGNED_BYTE, UNSIGNED_SHORT, UNSIGNED_INT.
 */
function readIndexArray(file: GltfFile, accessorIdx: number): Uint8Array | Uint16Array | Uint32Array | null {
    const { json, buffers } = file;
    const accessor = json.accessors?.[accessorIdx];
    if (!accessor || accessor.type !== 'SCALAR') return null;

    const bvIdx = accessor.bufferView;
    if (bvIdx === undefined) return null;
    const bv = json.bufferViews?.[bvIdx];
    if (!bv) return null;

    const buf = buffers[bv.buffer];
    if (!buf) return null;

    const count = accessor.count;
    const startByte = buf.byteOffset + (bv.byteOffset ?? 0) + (accessor.byteOffset ?? 0);

    switch (accessor.componentType) {
        case UNSIGNED_BYTE: return new Uint8Array(buf.buffer, startByte, count);
        case UNSIGNED_SHORT: return new Uint16Array(buf.buffer, startByte, count);
        case UNSIGNED_INT: return new Uint32Array(buf.buffer, startByte, count);
        default: return null;
    }
}

/**
 * Read a COLOR_0 vertex attribute as an RGBA byte array (4 bytes per vertex).
 * Accepts UNSIGNED_BYTE VEC4 (direct view) or FLOAT VEC4 (converted to bytes).
 * Returns null if the accessor is unavailable or unsupported.
 */
function readColorAttribute(file: GltfFile, accessorIdx: number): Uint8Array | null {
    const { json, buffers } = file;
    const accessor = json.accessors?.[accessorIdx];
    if (!accessor || accessor.type !== 'VEC4') return null;

    const bvIdx = accessor.bufferView;
    if (bvIdx === undefined) return null;
    const bv = json.bufferViews?.[bvIdx];
    if (!bv) return null;

    const buf = buffers[bv.buffer];
    if (!buf) return null;

    const count = accessor.count;
    const bvOffset = bv.byteOffset ?? 0;
    const accOffset = accessor.byteOffset ?? 0;

    if (accessor.componentType === UNSIGNED_BYTE) {
        const elementBytes = 4;
        const stride = bv.byteStride ?? elementBytes;
        const startByte = buf.byteOffset + bvOffset + accOffset;

        if (stride === elementBytes) {
            return new Uint8Array(buf.buffer, startByte, count * 4);
        }

        // Interleaved UNSIGNED_BYTE VEC4
        const result = new Uint8Array(count * 4);
        const src = new Uint8Array(buf.buffer, buf.byteOffset);
        for (let i = 0; i < count; i++) {
            const srcOff = bvOffset + accOffset + i * stride;
            result[i * 4] = src[srcOff];
            result[i * 4 + 1] = src[srcOff + 1];
            result[i * 4 + 2] = src[srcOff + 2];
            result[i * 4 + 3] = src[srcOff + 3];
        }
        return result;
    }

    if (accessor.componentType === FLOAT) {
        const elementBytes = 16; // 4 * sizeof(float32)
        const stride = bv.byteStride ?? elementBytes;
        const result = new Uint8Array(count * 4);
        const dv = new DataView(buf.buffer, buf.byteOffset);
        for (let i = 0; i < count; i++) {
            const off = bvOffset + accOffset + i * stride;
            result[i * 4] = Math.min(255, Math.round(dv.getFloat32(off, true) * 255));
            result[i * 4 + 1] = Math.min(255, Math.round(dv.getFloat32(off + 4, true) * 255));
            result[i * 4 + 2] = Math.min(255, Math.round(dv.getFloat32(off + 8, true) * 255));
            result[i * 4 + 3] = Math.min(255, Math.round(dv.getFloat32(off + 12, true) * 255));
        }
        return result;
    }

    return null;
}

// --- Scene graph traversal ---

type PrimitiveInstance = {
    primitive: GltfMeshPrimitive;
    worldTransform: Mat4;
    isIdentity: boolean;
}

function collectPrimitives(json: GltfJson): PrimitiveInstance[] {
    const instances: PrimitiveInstance[] = [];
    const nodes = json.nodes ?? [];
    const identityMat = Mat4.identity();

    function visitNode(nodeIdx: number, parentTransform: Mat4, parentIsIdentity: boolean) {
        const node = nodes[nodeIdx];
        if (!node) return;

        let localTransform: Mat4;
        let localIsIdentity: boolean;

        if (node.matrix) {
            localTransform = Mat4.fromArray(Mat4(), node.matrix, 0);
            localIsIdentity = false;
        } else if (node.translation || node.rotation || node.scale) {
            const t = Vec3.create(
                node.translation?.[0] ?? 0,
                node.translation?.[1] ?? 0,
                node.translation?.[2] ?? 0,
            );
            const q = Quat.create(
                node.rotation?.[0] ?? 0,
                node.rotation?.[1] ?? 0,
                node.rotation?.[2] ?? 0,
                node.rotation?.[3] ?? 1,
            );
            const s = Vec3.create(
                node.scale?.[0] ?? 1,
                node.scale?.[1] ?? 1,
                node.scale?.[2] ?? 1,
            );
            localTransform = Mat4.compose(Mat4(), t, q, s);
            localIsIdentity = false;
        } else {
            localTransform = identityMat;
            localIsIdentity = true;
        }

        let worldTransform: Mat4;
        let isIdentity: boolean;

        if (parentIsIdentity && localIsIdentity) {
            worldTransform = identityMat;
            isIdentity = true;
        } else if (parentIsIdentity) {
            worldTransform = localTransform;
            isIdentity = false;
        } else if (localIsIdentity) {
            worldTransform = parentTransform;
            isIdentity = false;
        } else {
            worldTransform = Mat4.mul(Mat4(), parentTransform, localTransform);
            isIdentity = false;
        }

        if (node.mesh !== undefined) {
            const mesh = json.meshes?.[node.mesh];
            if (mesh) {
                for (const primitive of mesh.primitives) {
                    instances.push({ primitive, worldTransform, isIdentity });
                }
            }
        }

        for (const childIdx of node.children ?? []) {
            visitNode(childIdx, worldTransform, isIdentity);
        }
    }

    const sceneIdx = json.scene ?? 0;
    const scene = json.scenes?.[sceneIdx];
    for (const nodeIdx of scene?.nodes ?? []) {
        visitNode(nodeIdx, identityMat, true);
    }

    return instances;
}

// --- Mesh building ---

type BuildMeshResult = {
    mesh: Mesh;
    hasNormals: boolean;
    /** Per-flat-vertex RGBA byte color (4 bytes each), or null when no COLOR_0 present */
    vertexColors: Uint8Array | null;
    vertexCount: number;
}

async function buildMesh(
    ctx: RuntimeContext,
    file: GltfFile,
    instances: PrimitiveInstance[],
    useVertexColors: boolean,
    existingMesh?: Mesh
): Promise<BuildMeshResult> {
    const builderState = MeshBuilder.createState(4096, 2048, existingMesh);
    const { vertices, normals: normBuf, indices, groups } = builderState;

    let hasAnyNormals = false;
    const updateChunk = 10000;

    // Pre-allocated flat color list — 4 bytes (RGBA) per flat vertex
    const flatColors: number[] = useVertexColors ? [] : [];

    for (const { primitive, worldTransform: m, isIdentity } of instances) {
        if ((primitive.mode ?? 4) !== 4) continue;

        const posIdx = primitive.attributes.POSITION;
        if (posIdx === undefined) continue;

        const positions = readVec3Float(file, posIdx);
        if (!positions) continue;

        const posCount = positions.length / 3;

        const normAccessorIdx = primitive.attributes.NORMAL;
        const normals = normAccessorIdx !== undefined ? readVec3Float(file, normAccessorIdx) : null;
        if (normals !== null) hasAnyNormals = true;

        const colorAccessorIdx = primitive.attributes.COLOR_0;
        const colors = (useVertexColors && colorAccessorIdx !== undefined)
            ? readColorAttribute(file, colorAccessorIdx)
            : null;

        const indexArray = primitive.indices !== undefined ? readIndexArray(file, primitive.indices) : null;
        const indexCount = indexArray !== null ? indexArray.length : posCount;
        const triCount = Math.floor(indexCount / 3);

        const materialIdx = primitive.material ?? 0;

        for (let t = 0; t < triCount; t++) {
            const base = vertices.elementCount;

            for (let v = 0; v < 3; v++) {
                const vi = indexArray !== null ? indexArray[t * 3 + v] : t * 3 + v;
                const po = vi * 3;

                // Transform position (point, w=1)
                let px = positions[po], py = positions[po + 1], pz = positions[po + 2];
                if (!isIdentity) {
                    const ox = px, oy = py, oz = pz;
                    px = m[0] * ox + m[4] * oy + m[8] * oz + m[12];
                    py = m[1] * ox + m[5] * oy + m[9] * oz + m[13];
                    pz = m[2] * ox + m[6] * oy + m[10] * oz + m[14];
                }
                ChunkedArray.add3(vertices, px, py, pz);

                if (normals !== null) {
                    // Transform normal (direction, w=0) — upper-left 3×3 only, then renormalize
                    let nx = normals[po], ny = normals[po + 1], nz = normals[po + 2];
                    if (!isIdentity) {
                        const ox = nx, oy = ny, oz = nz;
                        nx = m[0] * ox + m[4] * oy + m[8] * oz;
                        ny = m[1] * ox + m[5] * oy + m[9] * oz;
                        nz = m[2] * ox + m[6] * oy + m[10] * oz;
                        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                        if (len > 0) { nx /= len; ny /= len; nz /= len; }
                    }
                    ChunkedArray.add3(normBuf, nx, ny, nz);
                } else {
                    ChunkedArray.add3(normBuf, 0, 0, 0);
                }

                // Group ID: flat vertex index for vertex-color mode, material index otherwise
                ChunkedArray.add(groups, useVertexColors ? vertices.elementCount - 1 : materialIdx);

                if (useVertexColors) {
                    if (colors !== null) {
                        const co = vi * 4;
                        flatColors.push(colors[co], colors[co + 1], colors[co + 2], colors[co + 3]);
                    } else {
                        flatColors.push(128, 128, 128, 255); // default grey for primitives without COLOR_0
                    }
                }
            }

            ChunkedArray.add3(indices, base, base + 1, base + 2);

            if (t % updateChunk === 0 && ctx.shouldUpdate) {
                await ctx.update({ message: 'Building glTF mesh', current: t, max: triCount });
            }
        }
    }

    const mesh = MeshBuilder.getMesh(builderState);
    if (!hasAnyNormals) Mesh.computeNormals(mesh);
    ValueCell.updateIfChanged(mesh.varyingGroup, true);

    const vertexCount = vertices.elementCount;
    const vertexColors = useVertexColors && flatColors.length > 0
        ? new Uint8Array(flatColors)
        : null;

    return { mesh, hasNormals: hasAnyNormals, vertexColors, vertexCount };
}

function hasAnyVertexColors(file: GltfFile, instances: PrimitiveInstance[]): boolean {
    for (const { primitive } of instances) {
        const colorIdx = primitive.attributes.COLOR_0;
        if (colorIdx === undefined) continue;
        const accessor = file.json.accessors?.[colorIdx];
        if (!accessor || accessor.type !== 'VEC4') continue;
        const bvIdx = accessor.bufferView;
        if (bvIdx === undefined) continue;
        const bv = file.json.bufferViews?.[bvIdx];
        if (!bv) continue;
        if (file.buffers[bv.buffer] !== null) return true;
    }
    return false;
}

// --- Shape creation ---

function createShape(
    file: GltfFile,
    mesh: Mesh,
    colors: Color[],
    coloringName: GltfColoringName,
    vertexColors: Uint8Array | null,
    vertexCount: number,
): Shape<Mesh> {
    const materialNames = getMaterialNames(file.json);
    const useVertexColors = coloringName === 'vertex' && vertexColors !== null;

    let getColor: (groupId: number) => Color;
    if (useVertexColors) {
        // groupId = flat vertex index; each vertex has 4 bytes (RGBA) in vertexColors
        getColor = (groupId: number) => {
            const off = groupId * 4;
            return Color.fromRgb(vertexColors![off], vertexColors![off + 1], vertexColors![off + 2]);
        };
    } else {
        getColor = (groupId: number) => colors[Math.min(groupId, colors.length - 1)] ?? ColorNames.grey;
    }

    const getLabel = materialNames.length > 0 && !useVertexColors
        ? (groupId: number) => materialNames[Math.min(groupId, materialNames.length - 1)] ?? 'glTF Mesh'
        : () => 'glTF Mesh';

    const groupCount = useVertexColors ? vertexCount : (colors.length > 0 ? colors.length : undefined);

    return Shape.create(
        'gltf-mesh', file, mesh,
        getColor,
        () => 1,
        getLabel,
        undefined,
        groupCount
    );
}

function makeShapeGetter() {
    let _file: GltfFile | undefined;
    let _colors: Color[] | undefined;
    let _coloringName: string | undefined;
    let _shape: Shape<Mesh>;
    let _mesh: Mesh;
    let _vertexColors: Uint8Array | null = null;
    let _vertexCount = 0;
    let _useVertexColors = false;

    return async (ctx: RuntimeContext, data: GltfData, props: PD.Values<GltfShapeParams>, shape?: Shape<Mesh>) => {
        const { source } = data;
        const newMesh = !_file || _file !== source;
        const coloringName = props.coloring.name as GltfColoringName;

        const nextColors = getMaterialColors(source, props);
        const newColor = !_colors
            || _coloringName !== coloringName
            || nextColors.length !== _colors.length
            || nextColors.some((c, i) => c !== _colors![i]);

        if (newMesh) {
            _colors = nextColors;
            _coloringName = coloringName;
            const instances = collectPrimitives(source.json);
            _useVertexColors = hasAnyVertexColors(source, instances);
            const result = await buildMesh(ctx, source, instances, _useVertexColors, shape?.geometry);
            _mesh = result.mesh;
            _vertexColors = result.vertexColors;
            _vertexCount = result.vertexCount;
            _shape = createShape(source, _mesh, _colors, coloringName, _vertexColors, _vertexCount);
        } else if (newColor) {
            _colors = nextColors;
            _coloringName = coloringName;
            _shape = createShape(source, _mesh, _colors, coloringName, _vertexColors, _vertexCount);
        }

        _file = source;
        return _shape;
    };
}

export function shapeFromGltf(source: GltfFile) {
    return Task.create<ShapeProvider<GltfData, Mesh, GltfShapeParams>>('Shape Provider', async _ctx => {
        const instances = collectPrimitives(source.json);
        const useVertexColors = hasAnyVertexColors(source, instances);
        return {
            label: 'Mesh',
            data: { source },
            params: createGltfShapeParams(source, useVertexColors),
            getShape: makeShapeGetter(),
            geometryUtils: Mesh.Utils,
        };
    });
}
