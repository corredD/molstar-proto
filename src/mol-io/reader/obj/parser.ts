/**
 * Copyright (c) 2018-2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ReaderResult as Result } from '../result';
import { Task, RuntimeContext } from '../../../mol-task';
import { ObjFile } from './schema';
import { StringLike } from '../../common/string-like';

const updateChunk = 100000;

function resolveIndex(raw: number, count: number): number {
    // OBJ uses 1-based indexing; negative indices count from the end.
    if (raw > 0) return raw - 1;
    if (raw < 0) return count + raw;
    return -1;
}

async function parseInternal(data: StringLike, ctx: RuntimeContext): Promise<Result<ObjFile>> {
    const text = typeof data === 'string' ? data : data.toString();
    const lines = text.split(/\r?\n/);

    const comments: string[] = [];
    const verts: number[] = [];
    const colors: number[] = [];
    const norms: number[] = [];
    const tex: number[] = [];

    const cornerCounts: number[] = [];
    const cornerOffsets: number[] = [0];
    const cornerVertices: number[] = [];
    const cornerNormals: number[] = [];
    const cornerTexcoords: number[] = [];

    let hasVertexColors = false;
    let cornerOffset = 0;

    for (let li = 0, ll = lines.length; li < ll; ++li) {
        const line = lines[li];
        if (line.length === 0) continue;

        // Trim leading whitespace.
        let s = 0;
        while (s < line.length && (line.charCodeAt(s) === 32 || line.charCodeAt(s) === 9)) s++;
        if (s === line.length) continue;

        const c0 = line.charCodeAt(s);
        // '#' comment
        if (c0 === 35) {
            comments.push(line.slice(s + 1).trim());
            continue;
        }

        // Tokenize on whitespace.
        const toks = line.slice(s).split(/\s+/);
        const head = toks[0];

        if (head === 'v') {
            // v x y z [w] OR v x y z r g b (Blender/MeshLab vertex-color extension)
            verts.push(+toks[1], +toks[2], +toks[3]);
            if (toks.length >= 7) {
                hasVertexColors = true;
                colors.push(+toks[4], +toks[5], +toks[6]);
            } else if (hasVertexColors) {
                // fill colors so indices stay aligned
                colors.push(1, 1, 1);
            }
        } else if (head === 'vn') {
            norms.push(+toks[1], +toks[2], +toks[3]);
        } else if (head === 'vt') {
            tex.push(+toks[1], toks.length > 2 ? +toks[2] : 0);
        } else if (head === 'f') {
            const corners = toks.length - 1;
            if (corners < 3) continue; // skip degenerate
            const vCount = (verts.length / 3) | 0;
            const nCount = (norms.length / 3) | 0;
            const tCount = (tex.length / 2) | 0;
            for (let i = 1; i <= corners; ++i) {
                // Each corner is 'v', 'v/vt', 'v//vn', or 'v/vt/vn'.
                const parts = toks[i].split('/');
                cornerVertices.push(resolveIndex(+parts[0] || 0, vCount));
                cornerTexcoords.push(parts.length > 1 && parts[1] !== '' ? resolveIndex(+parts[1] || 0, tCount) : -1);
                cornerNormals.push(parts.length > 2 && parts[2] !== '' ? resolveIndex(+parts[2] || 0, nCount) : -1);
            }
            cornerCounts.push(corners);
            cornerOffset += corners;
            cornerOffsets.push(cornerOffset);
        }
        // 'g', 'o', 's', 'usemtl', 'mtllib', 'vp', etc. are intentionally ignored for v1.

        if (ctx.shouldUpdate && (li % updateChunk) === 0) {
            await ctx.update({ message: 'parsing OBJ', current: li, max: ll });
        }
    }

    const file = ObjFile({
        comments,
        vertices: new Float32Array(verts),
        normals: new Float32Array(norms),
        texcoords: new Float32Array(tex),
        colors: hasVertexColors ? new Float32Array(colors) : new Float32Array(0),
        faceCornerCounts: new Uint32Array(cornerCounts),
        faceCornerOffsets: new Uint32Array(cornerOffsets),
        faceVertexIndices: new Int32Array(cornerVertices),
        faceNormalIndices: new Int32Array(cornerNormals),
        faceTexcoordIndices: new Int32Array(cornerTexcoords),
    });
    return Result.success(file);
}

export function parseObj(data: StringLike) {
    return Task.create<Result<ObjFile>>('Parse OBJ', async ctx => {
        return await parseInternal(data, ctx);
    });
}
