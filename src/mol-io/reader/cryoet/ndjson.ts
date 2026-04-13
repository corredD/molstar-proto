/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Task, RuntimeContext } from '../../../mol-task';
import { StringLike } from '../../common/string-like';
import { Tokenizer } from '../common/text/tokenizer';
import { ReaderResult as Result } from '../result';

export interface CryoEtDataPortalLocation {
    readonly x: number
    readonly y: number
    readonly z: number
}

export interface CryoEtDataPortalNdjsonRecord {
    readonly raw: Readonly<Record<string, unknown>>
    readonly type: string
    readonly location: CryoEtDataPortalLocation
    readonly xyz_rotation_matrix?: unknown
    readonly instance_id?: number | string
}

export interface CryoEtDataPortalNdjsonFile {
    readonly records: ReadonlyArray<CryoEtDataPortalNdjsonRecord>
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLocation(value: unknown): value is CryoEtDataPortalLocation {
    if (!isObject(value)) return false;
    const x = value.x;
    const y = value.y;
    const z = value.z;
    return typeof x === 'number' && Number.isFinite(x)
        && typeof y === 'number' && Number.isFinite(y)
        && typeof z === 'number' && Number.isFinite(z);
}

async function parseInternal(data: StringLike, ctx: RuntimeContext) {
    const tokenizer = Tokenizer(data);
    const records: CryoEtDataPortalNdjsonRecord[] = [];
    let prevPosition = 0;

    while (tokenizer.tokenEnd < tokenizer.length) {
        if (tokenizer.position - prevPosition > 100000 && ctx.shouldUpdate) {
            prevPosition = tokenizer.position;
            await ctx.update({ current: tokenizer.position, max: tokenizer.length });
        }

        const lineNumber = tokenizer.lineNumber;
        const line = Tokenizer.readLine(tokenizer).trim();
        if (!line) continue;

        let parsed: unknown;
        try {
            parsed = JSON.parse(line);
        } catch {
            return Result.error<CryoEtDataPortalNdjsonFile>('Invalid CryoET Data Portal ndjson record.', lineNumber);
        }

        if (!isObject(parsed)) {
            return Result.error<CryoEtDataPortalNdjsonFile>('CryoET Data Portal ndjson records must be JSON objects.', lineNumber);
        }
        if (typeof parsed.type !== 'string') {
            return Result.error<CryoEtDataPortalNdjsonFile>('CryoET Data Portal ndjson records must define a string "type".', lineNumber);
        }
        const location = parsed.location;
        if (!isLocation(location)) {
            return Result.error<CryoEtDataPortalNdjsonFile>('CryoET Data Portal ndjson records must define a numeric "location" object with x, y, and z fields.', lineNumber);
        }

        const instanceId = typeof parsed.instance_id === 'number' || typeof parsed.instance_id === 'string'
            ? parsed.instance_id
            : void 0;

        records.push({
            raw: parsed,
            type: parsed.type,
            location: {
                x: location.x,
                y: location.y,
                z: location.z,
            },
            xyz_rotation_matrix: parsed.xyz_rotation_matrix,
            instance_id: instanceId,
        });
    }

    if (records.length === 0) {
        return Result.error<CryoEtDataPortalNdjsonFile>('No readable CryoET Data Portal ndjson records were found.');
    }

    return Result.success({ records });
}

export function parseCryoEtDataPortalNdjson(data: StringLike) {
    return Task.create<Result<CryoEtDataPortalNdjsonFile>>('Parse CryoET Data Portal ndjson', async ctx => {
        return await parseInternal(data, ctx);
    });
}
