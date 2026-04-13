/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Task, RuntimeContext } from '../../../mol-task';
import { StringLike } from '../../common/string-like';
import { Tokenizer } from '../common/text/tokenizer';
import { ReaderResult as Result } from '../result';

const RequiredColumnCount = 26;

export interface DynamoTblFile {
    readonly rows: ReadonlyArray<Float64Array>
    readonly rowCount: number
    readonly columnCount: number
}

async function parseInternal(data: StringLike, ctx: RuntimeContext) {
    const tokenizer = Tokenizer(data);
    const rows: Float64Array[] = [];
    const warnings: string[] = [];
    let columnCount = 0;
    let skippedRows = 0;
    let prevPosition = 0;

    while (tokenizer.tokenEnd < tokenizer.length) {
        if (tokenizer.position - prevPosition > 100000 && ctx.shouldUpdate) {
            prevPosition = tokenizer.position;
            await ctx.update({ current: tokenizer.position, max: tokenizer.length });
        }

        const line = Tokenizer.readLine(tokenizer).trim();
        if (!line || line.startsWith('#') || line.startsWith('%') || line.startsWith(';')) continue;

        const tokens = line.split(/\s+/);
        if (tokens.length < RequiredColumnCount) {
            skippedRows += 1;
            continue;
        }

        const row = new Float64Array(tokens.length);
        let isValid = true;
        for (let i = 0, il = tokens.length; i < il; ++i) {
            const value = Number(tokens[i]);
            if (!Number.isFinite(value)) {
                isValid = false;
                break;
            }
            row[i] = value;
        }

        if (!isValid) {
            skippedRows += 1;
            continue;
        }

        columnCount = Math.max(columnCount, row.length);
        rows.push(row);
    }

    if (rows.length === 0) {
        return Result.error<DynamoTblFile>('No readable Dynamo table rows were found.');
    }

    if (skippedRows > 0) {
        warnings.push(`Skipped ${skippedRows} Dynamo row${skippedRows === 1 ? '' : 's'} that were incomplete or not numeric.`);
    }

    return Result.success({
        rows,
        rowCount: rows.length,
        columnCount,
    }, warnings);
}

export function parseDynamoTbl(data: StringLike) {
    return Task.create<Result<DynamoTblFile>>('Parse Dynamo TBL', async ctx => {
        return await parseInternal(data, ctx);
    });
}
