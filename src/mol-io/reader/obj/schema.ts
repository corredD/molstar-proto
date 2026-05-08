/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// http://paulbourke.net/dataformats/obj/
// https://en.wikipedia.org/wiki/Wavefront_.obj_file

export interface ObjFile {
    readonly comments: ReadonlyArray<string>
    /** flat x,y,z (length = 3 * vertexCount) */
    readonly vertices: Float32Array
    /** flat nx,ny,nz (length = 3 * normalCount); empty if no `vn` lines */
    readonly normals: Float32Array
    /** flat u,v (length = 2 * texcoordCount); empty if no `vt` lines */
    readonly texcoords: Float32Array
    /** flat r,g,b in [0,1] from the `v x y z r g b` extension; empty otherwise */
    readonly colors: Float32Array
    /** number of corners per face (length = faceCount) */
    readonly faceCornerCounts: Uint32Array
    /** offset into per-corner index arrays where face f starts; length = faceCount + 1 */
    readonly faceCornerOffsets: Uint32Array
    /** 0-based vertex index per face corner */
    readonly faceVertexIndices: Int32Array
    /** 0-based normal index per face corner; -1 if absent */
    readonly faceNormalIndices: Int32Array
    /** 0-based texcoord index per face corner; -1 if absent */
    readonly faceTexcoordIndices: Int32Array
}

export function ObjFile(file: ObjFile): ObjFile {
    return file;
}
