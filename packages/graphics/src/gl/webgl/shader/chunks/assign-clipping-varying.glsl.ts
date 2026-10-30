/**
 * Copyright (c) 2020-2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Ludovic Autin <autin@scripps.edu>
 */

export const assign_clipping_varying = `
#if defined(dClipObjects) && defined(dClipping)
    #if defined(dClipTable)
        // the value is the instance's row of the clipping table; the flag, the objects that row ignores
        float clipRow = floor(read_tClipping(granularityIndex(aInstance, group)).r * 255.0 + 0.5);
        vClipping = clipTableIgnored(clipRow) / 255.0;
    #else
        vClipping = read_tClipping(granularityIndex(aInstance, group)).r;
    #endif
#endif
`;
