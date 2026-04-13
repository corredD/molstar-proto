/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 */

import { parseDynamoTbl } from '../dynamo/tbl';

test('parses Dynamo TBL rows into raw numeric rows', async () => {
    const data = [
        '1 0 0 10 20 30 90 0 0 0 0 0 0 0 0 0 0 0 0 7 8 9 10 100 200 300 0 0 0 0 0 0 0 0 0 6.5',
        '2 0 0 1 2 3 0 90 0 0 0 0 0 0 0 0 0 0 0 7 8 9 10 40 50 60 0 0 0 0 0 0 0 0 0 6.5',
    ].join('\n');

    const parsed = await parseDynamoTbl(data).run();
    if (parsed.isError) throw new Error(parsed.message);

    expect(parsed.result.rowCount).toBe(2);
    expect(parsed.result.columnCount).toBe(36);
    expect(Array.from(parsed.result.rows[0].slice(23, 26))).toEqual([100, 200, 300]);
    expect(parsed.warnings).toEqual([]);
});
