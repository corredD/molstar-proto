/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 */

import { parseCifText } from '../cif/text/parser';
import { parseRelionStar } from '../relion/star';

test('parses RELION STAR blocks and keeps particle and optics blocks', async () => {
    const data = `data_optics
loop_
_rlnOpticsGroup
_rlnTomoTiltSeriesPixelSize
1 4.5

data_particles
loop_
_rlnCoordinateX
_rlnCoordinateY
_rlnCoordinateZ
_rlnTomoName
10 20 30 tomo-a
40 50 60 tomo-b
`;

    const parsed = await parseCifText(data).run();
    if (parsed.isError) throw new Error(parsed.message);

    const relion = parseRelionStar(parsed.result);
    if (relion.isError) throw new Error(relion.message);

    expect(relion.result.particleBlock.header).toBe('particles');
    expect(relion.result.opticsBlock?.header).toBe('optics');
    expect(relion.result.source.blocks).toHaveLength(2);
});
