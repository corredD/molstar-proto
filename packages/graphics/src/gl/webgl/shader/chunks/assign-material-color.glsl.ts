/**
 * Copyright (c) 2018-2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Ludovic Autin <autin@scripps.edu>
 */

export const assign_material_color = `
#if defined(dNeedsMarker)
    float marker = uMarker;
    if (uMarker == -1.0) {
        marker = floor(vMarker * 255.0 + 0.5); // rounding required to work on some cards on win
    }
#endif

// optional per-fragment opacity multiplier; defaults to 1.0
#ifndef dHasMaterialOpacity
    float materialOpacity = 1.0;
#endif

#if defined(dRenderVariant_color) || defined(dRenderVariant_tracing) || defined(dRenderVariant_emissive)
    #if defined(dColorType_grid) && defined(dColorGridFragment)
        // the grid at its cell centers: the 2d layout's texels are half a cell off in x and y (\`texture3dFrom2dLinear\`)
        vec3 varyingColor = texture3dFrom2dLinear(tColorGrid, vColorGridPosition + vec3(0.5 / uColorGridDim.xy, 0.0), uColorGridDim, uColorGridTexDim).rgb;
        #ifdef dUsePalette
            float paletteV = ((varyingColor.r * 256.0 * 256.0 * 255.0 + varyingColor.g * 256.0 * 255.0 + varyingColor.b * 255.0) - 1.0) / PALETTE_SCALE;
        #endif
    #else
        #if defined(dColorType_varying)
            vec3 varyingColor = vColor.rgb;
        #endif
        #ifdef dUsePalette
            float paletteV = vPaletteV;
        #endif
    #endif
#endif

#if defined(dRenderVariant_color) || defined(dRenderVariant_tracing)
    #if defined(dUsePalette)
        vec4 material = vec4(texture2D(tPalette, vec2(paletteV, 0.5)).rgb, uAlpha);
    #elif defined(dColorType_uniform)
        vec4 material = vec4(uColor, uAlpha);
    #elif defined(dColorType_varying)
        vec4 material = vec4(varyingColor, uAlpha);
    #endif

    // mix material with overpaint; the levels already folded a Look color into vColor (color-levels.md)
    #if defined(dOverpaint) && !(defined(dColorLevels) && defined(dColorType_texture))
        material.rgb = mix(material.rgb, vOverpaint.rgb, vOverpaint.a);
    #endif

    float emissive = uEmissive;
    #ifdef dEmissive
        emissive += vEmissive;
    #endif

    float metalness = uMetalness;
    float roughness = uRoughness;
    float bumpiness = uBumpiness;
    #ifdef dSubstance
        float sf = clamp(vSubstance.a, 0.0, 0.99); // clamp to avoid artifacts
        metalness = mix(metalness, vSubstance.r, sf);
        roughness = mix(roughness, vSubstance.g, sf);
        bumpiness = mix(bumpiness, vSubstance.b, sf);
    #endif

    #if defined(dXrayShaded)
        material.a = calcXrayShadedAlpha(material.a, normal);
    #endif
#elif defined(dRenderVariant_depth)
    // behind the opaque depth (depth is reversed)
    if (fragmentDepth < getDepth(gl_FragCoord.xy / uDrawingBufferSize)) {
        discard;
    }
    vec4 material;
    if (uRenderMask == MaskOpaque) {
        #if defined(dXrayShaded)
            discard;
        #endif
        #if defined(dTransparency)
            float dta = 1.0 - vTransparency;
            #if __VERSION__ == 100 || defined(dVaryingGroup)
                if (vTransparency < 0.1) dta = 1.0; // hard cutoff to avoid artifacts
            #endif

            if (uAlpha * materialOpacity * dta < 1.0) {
                discard;
            }
        #else
            if (uAlpha * materialOpacity < 1.0) {
                discard;
            }
        #endif
        material = packDepthToRGBA(fragmentDepth);
    } else if (uRenderMask == MaskTransparent) {
        float alpha = uAlpha * materialOpacity;
        #if defined(dTransparency)
            float dta = 1.0 - vTransparency;
            alpha *= dta;
        #endif

        #ifdef dXrayShaded
            alpha = calcXrayShadedAlpha(alpha, normal);
        #else
            if (alpha == 1.0) {
                discard;
            }
        #endif
        material = packDepthWithAlphaToRGBA(fragmentDepth, alpha);
    } else {
        material = packDepthToRGBA(fragmentDepth);
    }
#elif defined(dRenderVariant_marking)
    vec4 material = vec4(0.0, 0.0, 0.0, uAlpha * materialOpacity);
    #if defined(dXrayShaded)
        material.a = calcXrayShadedAlpha(material.a, normal);
    #endif
#elif defined(dRenderVariant_emissive)
    float emissive = uEmissive;
    #ifdef dEmissive
        emissive += vEmissive;
    #endif
    float emissiveAlpha = uAlpha;
    #if defined(dXrayShaded)
        emissiveAlpha = calcXrayShadedAlpha(emissiveAlpha, normal);
    #endif
    // fade emissive bloom with fog so the glow dims into the background like the geometry
    if (uFog) {
        float viewZ = depthToViewZ(uIsOrtho, fragmentDepth, uNear, uFar);
        emissiveAlpha *= 1.0 - smoothstep(uFogNear, uFogFar, abs(viewZ));
    }
    // dim emitters behind a transparent blocker by its coverage (tDepthAlpha packs front depth+alpha)
    vec2 emissiveBlocker = unpackRGBAToDepthWithAlpha(texture2D(tDepthAlpha, gl_FragCoord.xy / uDrawingBufferSize));
    if (fragmentDepth < emissiveBlocker.x - 0.0001) {
        emissiveAlpha *= 1.0 - emissiveBlocker.y;
    }
    // glow with the object's own color so emissive isn't double-counted via the lit buffer
    #if defined(dUsePalette)
        vec3 emissiveColor = texture2D(tPalette, vec2(paletteV, 0.5)).rgb;
    #elif defined(dColorType_uniform)
        vec3 emissiveColor = uColor;
    #elif defined(dColorType_varying)
        vec3 emissiveColor = varyingColor;
    #else
        vec3 emissiveColor = vec3(1.0);
    #endif
    #ifdef dOverpaint
        emissiveColor = mix(emissiveColor, vOverpaint.rgb, vOverpaint.a);
    #endif
    float e = emissive * emissiveAlpha;
    vec4 material = vec4(emissiveColor * e, e);
#endif

// apply per-group transparency
#if defined(dTransparency) && (defined(dRenderVariant_pick) || defined(dRenderVariant_color) || defined(dRenderVariant_emissive) || defined(dRenderVariant_tracing) || defined(dRenderVariant_marking))
    float ta = 1.0 - vTransparency;
    if (vTransparency < 0.09) ta = 1.0; // hard cutoff looks better

    #if defined(dRenderVariant_pick)
        if (ta * uAlpha < uPickingAlphaThreshold)
            discard; // ignore so the element below can be picked
    #elif defined(dRenderVariant_emissive)
        material *= ta;
    #elif defined(dRenderVariant_color) || defined(dRenderVariant_tracing) || defined(dRenderVariant_marking)
        material.a *= ta;
    #endif
#endif
`;
