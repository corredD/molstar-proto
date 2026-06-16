/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

export interface GltfAsset {
    readonly version: string
    readonly generator?: string
    readonly minVersion?: string
    readonly copyright?: string
}

export interface GltfScene {
    readonly nodes?: number[]
    readonly name?: string
}

export interface GltfNode {
    readonly mesh?: number
    readonly children?: number[]
    /** Column-major 4×4 transform matrix */
    readonly matrix?: number[]
    /** Translation [x, y, z] */
    readonly translation?: number[]
    /** Rotation quaternion [x, y, z, w] */
    readonly rotation?: number[]
    /** Scale [x, y, z] */
    readonly scale?: number[]
    readonly name?: string
}

export interface GltfMeshPrimitive {
    readonly attributes: {
        readonly POSITION?: number
        readonly NORMAL?: number
        readonly TEXCOORD_0?: number
        readonly COLOR_0?: number
        readonly [key: string]: number | undefined
    }
    readonly indices?: number
    readonly material?: number
    /** Topology mode. 4 = TRIANGLES (default). */
    readonly mode?: number
}

export interface GltfMesh {
    readonly primitives: GltfMeshPrimitive[]
    readonly name?: string
}

export interface GltfAccessor {
    readonly bufferView?: number
    readonly byteOffset?: number
    /** 5120=BYTE, 5121=UNSIGNED_BYTE, 5122=SHORT, 5123=UNSIGNED_SHORT, 5125=UNSIGNED_INT, 5126=FLOAT */
    readonly componentType: number
    readonly count: number
    readonly type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT2' | 'MAT3' | 'MAT4'
    readonly normalized?: boolean
    readonly min?: number[]
    readonly max?: number[]
}

export interface GltfBufferView {
    readonly buffer: number
    readonly byteOffset?: number
    readonly byteLength: number
    /** Stride between elements in bytes; undefined = tightly packed */
    readonly byteStride?: number
    readonly target?: number
}

export interface GltfBuffer {
    readonly byteLength: number
    /** Relative URI or base64 data URI. Absent for the GLB BIN chunk (buffer 0). */
    readonly uri?: string
}

export interface GltfPbrMetallicRoughness {
    readonly baseColorFactor?: [number, number, number, number]
    readonly metallicFactor?: number
    readonly roughnessFactor?: number
}

export interface GltfMaterial {
    readonly pbrMetallicRoughness?: GltfPbrMetallicRoughness
    readonly name?: string
    readonly doubleSided?: boolean
    readonly alphaMode?: string
}

export interface GltfJson {
    readonly asset: GltfAsset
    readonly scene?: number
    readonly scenes?: GltfScene[]
    readonly nodes?: GltfNode[]
    readonly meshes?: GltfMesh[]
    readonly accessors?: GltfAccessor[]
    readonly bufferViews?: GltfBufferView[]
    readonly buffers?: GltfBuffer[]
    readonly materials?: GltfMaterial[]
}

export interface GltfFile {
    /** Parsed glTF 2.0 JSON */
    readonly json: GltfJson
    /**
     * Resolved binary buffers indexed by glTF buffer index.
     * null = buffer could not be resolved (external relative URI without a provided sidecar file).
     */
    readonly buffers: (Uint8Array | null)[]
}
