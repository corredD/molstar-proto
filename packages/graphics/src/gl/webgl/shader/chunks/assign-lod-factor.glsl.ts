/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { assign_lod_impostor_factor } from './lod-impostor.glsl.js';

/**
 * Levels of detail of the items drawn as quads (spheres, points), after `vModelPosition`: `lodFactor` the level's scale
 * (a coarser level's fewer items larger) faded at the level's range (1 without levels), `lodCulled` beyond the range;
 * with impostors (`dLodImpostor`, after `assign_lod_impostor`) by the copy's distance, its share of the band
 */
function lodFactor(impostor: boolean) {
  return `
float lodFactor = 1.0;
bool lodCulled = false;
if (uLod.w != 0.0 && (uLod.x != 0.0 || uLod.y != 0.0)) {
    // members of a merged item can have different scales for the same lod level (item-count dependent)
    #if defined(dSegmented)
        float lodScale = uLodLevel == 0 ? aSegmentLod.x : (uLodLevel == 1 ? aSegmentLod.y : (uLodLevel == 2 ? aSegmentLod.z : aSegmentLod.w));
    #else
        float lodScale = uLod.w;
    #endif
    if (uModelScale != 1.0) {
        #if defined(dLodImpostor)
            // the impostor's radius its bounding sphere's (\`assign_lod_impostor_varyings\`)
            lodFactor = lodImpostor ? 1.0 : lodScale;
        #else
            lodFactor = lodScale;
        #endif
    } else {
        #if defined(dLodImpostor)
            ${impostor ? assign_lod_impostor_factor : ''}
        #else
        float d = (dot(uCameraPlane.xyz, vModelPosition) + uCameraPlane.w) / uModelScale;
        lodFactor = min(
            smoothstep(uLod.x, uLod.x + uLod.z, d),
            1.0 - smoothstep(uLod.y - uLod.z, uLod.y, d)
        ) * lodScale;
        lodCulled = d < uLod.x || d > uLod.y;
        #endif
    }
}
`;
}

export const assign_lod_factor = lodFactor(false);
/** With impostors (`dLodImpostor`, spheres): their switch (\`assign_lod_impostor_factor\`) */
export const assign_lod_factor_impostor = lodFactor(true);
