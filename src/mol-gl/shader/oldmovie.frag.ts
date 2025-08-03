/**
 * Copyright (c) 2024 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

export const old_movie_frag = `
precision highp float;  
precision highp sampler2D;  
  
uniform sampler2D tColor;  
uniform sampler2D tGrain;  
uniform sampler2D tNoise;  
uniform vec4 uVignette; // x - intensity, y - power, z - grain, w - noise alpha  
uniform vec4 uGrain;    // xy - scale, zw - offset  
uniform vec4 uTint;     // rgb - color, a - strength  
uniform vec2 uJolt;     // screen shake offset  
uniform vec2 uTexSize;  
  
  
void main() {  
    vec2 coords = gl_FragCoord.xy;
    vec2 uv = coords / uTexSize;

    // Vignette calculation  
    vec2 vigUv = uv * (1.0 - uv.yx);  
    float vig = vigUv.x * vigUv.y * uVignette.x;  
    vig = pow(vig, uVignette.y);  
      
    // Sample main texture with jolt offset  
    vec4 main = texture2D(tColor, uv + uJolt);  
      
    // Add grain  
    float grain = texture2D(tGrain, uv * uGrain.xy + uGrain.zw).a;  
    grain = abs((grain - 0.5) * uVignette.z);  
      
    // Add noise  
    vec3 noise = texture2D(tNoise, uv + uJolt).rgb;  
    main.rgb += noise * uVignette.w;  
      
    // Apply grain and tint  
    main.rgb += grain;  
    main.rgb = mix(main.rgb, uTint.rgb, (1.0 - vig) * uTint.a);  
      
    gl_FragColor = main;
}  
`;