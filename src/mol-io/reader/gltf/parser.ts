/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ReaderResult as Result } from '../result';
import { Task, RuntimeContext } from '../../../mol-task';
import { GltfFile, GltfJson } from './schema';

// GLB binary container constants (glTF 2.0 spec §5)
const GLTF_MAGIC = 0x46546C67; // 'glTF' in little-endian
const GLB_HEADER_BYTES = 12;   // magic(4) + version(4) + length(4)
const CHUNK_HEADER_BYTES = 8;  // chunkLength(4) + chunkType(4)
const JSON_CHUNK_TYPE = 0x4E4F534A; // 'JSON'
const BIN_CHUNK_TYPE = 0x004E4942;  // 'BIN\0'

function decodeDataUri(uri: string): Uint8Array | null {
    if (!uri.startsWith('data:')) return null;
    const commaIdx = uri.indexOf(',');
    if (commaIdx === -1) return null;
    const isBase64 = uri.substring(0, commaIdx).includes(';base64');
    const payload = uri.substring(commaIdx + 1);
    if (isBase64) {
        const binary = atob(payload);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }
    return new TextEncoder().encode(decodeURIComponent(payload));
}

function parseGlb(data: Uint8Array): GltfFile {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const magic = dv.getUint32(0, true);
    if (magic !== GLTF_MAGIC) throw new Error(`Not a valid GLB file (bad magic 0x${magic.toString(16).toUpperCase()})`);
    const version = dv.getUint32(4, true);
    if (version !== 2) throw new Error(`Unsupported GLB version ${version}; only version 2 is supported`);

    let jsonText: string | null = null;
    let binChunk: Uint8Array | null = null;
    let offset = GLB_HEADER_BYTES;

    while (offset + CHUNK_HEADER_BYTES <= data.byteLength) {
        const chunkLength = dv.getUint32(offset, true);
        const chunkType = dv.getUint32(offset + 4, true);
        const chunkStart = offset + CHUNK_HEADER_BYTES;
        const chunkEnd = chunkStart + chunkLength;

        if (chunkType === JSON_CHUNK_TYPE) {
            jsonText = new TextDecoder().decode(data.subarray(chunkStart, chunkEnd));
        } else if (chunkType === BIN_CHUNK_TYPE && binChunk === null) {
            binChunk = data.subarray(chunkStart, chunkEnd);
        }
        offset = chunkEnd;
    }

    if (jsonText === null) throw new Error('GLB file is missing the required JSON chunk');
    const json: GltfJson = JSON.parse(jsonText);

    const bufferCount = json.buffers?.length ?? 0;
    const buffers: (Uint8Array | null)[] = new Array(bufferCount).fill(null);
    // In GLB, buffer 0 is the embedded BIN chunk (may be absent for JSON-only GLBs)
    if (bufferCount > 0 && binChunk !== null) buffers[0] = binChunk;

    return { json, buffers };
}

function parseGltfText(data: string): GltfFile {
    const json: GltfJson = JSON.parse(data);
    const bufferCount = json.buffers?.length ?? 0;
    const buffers: (Uint8Array | null)[] = new Array(bufferCount).fill(null);
    for (let i = 0; i < bufferCount; i++) {
        const uri = json.buffers![i].uri;
        if (uri) buffers[i] = decodeDataUri(uri); // null for relative URIs (external .bin)
    }
    return { json, buffers };
}

async function parseInternal(data: string | Uint8Array, _ctx: RuntimeContext): Promise<Result<GltfFile>> {
    try {
        const file = data instanceof Uint8Array ? parseGlb(data) : parseGltfText(data);
        return Result.success(file);
    } catch (e: unknown) {
        return Result.error(e instanceof Error ? e.message : String(e));
    }
}

export function parseGltf(data: string | Uint8Array) {
    return Task.create<Result<GltfFile>>('Parse glTF', async ctx => {
        return parseInternal(data, ctx);
    });
}
