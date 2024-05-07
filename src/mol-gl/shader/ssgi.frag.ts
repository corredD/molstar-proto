/**
 * Copyright (c) 2024 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Áron Samuel Kovács <aron.kovacs@mail.muni.cz>
*/

// from
// MIT license martinsh :
// https://github.com/martinsh/godot-SSGI/tree/master/SSGI

export const ssgi_frag = `
precision highp float;
precision highp int;
precision highp sampler2D;

#include common

uniform sampler2D tDepth;
uniform sampler2D tColor;
uniform vec2 uTexSize;
uniform vec4 uBounds;

uniform float uNear;
uniform float uFar;

#if dLightCount != 0
    uniform vec3 uLightDirection[dLightCount];
    uniform vec3 uLightColor[dLightCount];
#endif

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uInvProjection;

// uniform int uSamples;

uniform vec3 uSamples[dNSamples];

const vec3 uAmbiantColor = vec3(1.0, 1.0, 1.0);

uniform float uIndirectamount;//1.0;
uniform float uNoiseamount;//0.0023;
uniform bool uNoise;//0.2;
uniform bool uBackground;//0.2;
uniform bool uGlobalLight;
uniform float uLightDistance;
uniform float uScale;


bool isBackground(const in float depth) {
    return depth == 1.0;
}

bool outsideBounds(const in vec2 p) {
    return p.x < uBounds.x || p.y < uBounds.y || p.x > uBounds.z || p.y > uBounds.w;
}

float getViewZ(in float depth) {
    #if dOrthographic == 1
        return orthographicDepthToViewZ(depth, uNear, uFar);
    #else
        return perspectiveDepthToViewZ(depth, uNear, uFar);
    #endif
}

float getDepth(const in vec2 coords) {
    if (outsideBounds(coords)) {
        return 1.0;
    } else {
        #ifdef depthTextureSupport
            return texture2D(tDepth, coords).r;
        #else
            return unpackRGBAToDepth(texture2D(tDepth, coords));
        #endif
    }
}


vec2 mod_dither3(vec2 u) {
	float noiseX = mod(u.x + u.y + mod(208. + u.x * 3.58, 13. + mod(u.y * 22.9, 9.)),7.) * .143;
	float noiseY = mod(u.y + u.x + mod(203. + u.y * 3.18, 12. + mod(u.x * 27.4, 8.)),6.) * .139;
	return vec2(noiseX, noiseY)*2.0-1.0;
}

vec2 dither(vec2 coord, float seed, vec2 size) {
	float noiseX = ((fract(1.0-(coord.x+seed*1.0)*(size.x/2.0))*0.25)+(fract((coord.y+seed*2.0)*(size.y/2.0))*0.75))*2.0-1.0;
	float noiseY = ((fract(1.0-(coord.x+seed*3.0)*(size.x/2.0))*0.75)+(fract((coord.y+seed*4.0)*(size.y/2.0))*0.25))*2.0-1.0;
    return vec2(noiseX, noiseY);
}

float noise(const in vec2 coords) {
    float a = 12.9898;
    float b = 78.233;
    float c = 43758.5453;
    float dt = dot(coords, vec2(a,b));
    float sn = mod(dt, PI);
    return abs(fract(sin(sn) * c)); // is abs necessary?
}

vec2 getNoiseVec2(const in vec2 coords) {
    return vec2(noise(coords), noise(coords + vec2(PI, 2.71828)));
}

vec3 getViewPos(sampler2D tex, vec2 coord, mat4 ipm){
	float depth = getDepth(coord);//texture(tex, coord).r;
	return screenSpaceToViewSpace(vec3(coord, depth), uInvProjection);
}

float getRawDepth(vec2 uv) { 
    return getDepth(uv); 
}

float Linear01Depth( in float depth ) {
	return (2.0 * uNear) / (uFar + uNear - depth * (uFar - uNear));	
}

float getPixelSize(const in vec2 coords, const in float depth) {
    vec3 viewPos0 = screenSpaceToViewSpace(vec3(coords, depth), uInvProjection);
    vec3 viewPos1 = screenSpaceToViewSpace(vec3(coords + vec2(1.0, 0.0) / uTexSize, depth), uInvProjection);
    return distance(viewPos0, viewPos1);
}
// inspired by keijiro's depth inverse projection
// https://github.com/keijiro/DepthInverseProjection
// constructs view space ray at the far clip plane from the screen uv
// then multiplies that ray by the linear 01 depth
vec3 viewSpacePosAtScreenUV(vec2 uv)
{
    vec3 viewSpaceRay = (uInvProjection * (vec4(uv * 2.0 - 1.0, 1.0, 1.0) * uFar)).xyz;
    float rawDepth = getRawDepth(uv);
    return viewSpaceRay * Linear01Depth(rawDepth);  //p.xyz / p.w?
}

vec3 viewNormalAtPixelPosition(vec2 uv)
{
    vec2 invTexSize = 1.0 / uTexSize;
    // screen uv from vpos
    // vec2 uv = vpos * uTexSize;
    // current pixel's depth
    float c = getRawDepth(uv);

    // get current pixel's view space position
    vec3 viewSpacePos_c = viewSpacePosAtScreenUV(uv);
    
    // get view space position at 1 pixel offsets in each major direction
    vec3 viewSpacePos_l = viewSpacePosAtScreenUV(uv + vec2(-1.0, 0.0) * invTexSize.xy);
    vec3 viewSpacePos_r = viewSpacePosAtScreenUV(uv + vec2( 1.0, 0.0) * invTexSize.xy);
    vec3 viewSpacePos_d = viewSpacePosAtScreenUV(uv + vec2( 0.0,-1.0) * invTexSize.xy);
    vec3 viewSpacePos_u = viewSpacePosAtScreenUV(uv + vec2( 0.0, 1.0) * invTexSize.xy);
    
    
    // get the difference between the current and each offset position
    vec3 l = viewSpacePos_c - viewSpacePos_l;
    vec3 r = viewSpacePos_r - viewSpacePos_c;
    vec3 d = viewSpacePos_c - viewSpacePos_d;
    vec3 u = viewSpacePos_u - viewSpacePos_c;
    
   
    // get depth values at 1 & 2 pixels offsets from current along the horizontal axis
    vec4 H = vec4(
        getRawDepth(uv + vec2(-1.0, 0.0) * invTexSize.xy),
        getRawDepth(uv + vec2( 1.0, 0.0) * invTexSize.xy),
        getRawDepth(uv + vec2(-2.0, 0.0) * invTexSize.xy),
        getRawDepth(uv + vec2( 2.0, 0.0) * invTexSize.xy)
    );
   
    // get depth values at 1 & 2 pixels offsets from current along the vertical axis
    vec4 V = vec4(
        getRawDepth(uv + vec2(0.0,-1.0) * invTexSize.xy),
        getRawDepth(uv + vec2(0.0, 1.0) * invTexSize.xy),
        getRawDepth(uv + vec2(0.0,-2.0) * invTexSize.xy),
        getRawDepth(uv + vec2(0.0, 2.0) * invTexSize.xy)
    );
    
    // current pixel's depth difference from slope of offset depth samples
    // differs from original article because we're using non-linear depth values
    // see article's comments
    vec2 he = abs((2.0 * H.xy - H.zw) - c);
    vec2 ve = abs((2.0 * V.xy - V.zw) - c);

    
    // pick horizontal and vertical diff with the smallest depth difference from slopes
    vec3 hDeriv = he.x < he.y ? l : r;
    vec3 vDeriv = ve.x < ve.y ? d : u;

    // get view space normal from the cross product of the best derivatives
    vec3 viewNormal = normalize(cross(hDeriv, vDeriv));
    
    return viewNormal;// vec3(1.0,1.0,1.0);
}


vec3 getViewNormal(sampler2D tex, vec2 coord, mat4 ipm)
{
    ivec2 texSize = textureSize(tex, 0);

    float pW = 1.0/float(texSize.x);
    float pH = 1.0/float(texSize.y);
    
    vec3 p1 = getViewPos(tex, coord+vec2(pW,0.0), ipm).xyz;
    vec3 p2 = getViewPos(tex, coord+vec2(0.0,pH), ipm).xyz;
    vec3 p3 = getViewPos(tex, coord+vec2(-pW,0.0), ipm).xyz;
    vec3 p4 = getViewPos(tex, coord+vec2(0.0,-pH), ipm).xyz;

    vec3 vP = getViewPos(tex, coord, ipm);
    
    vec3 dx = vP-p1;
    vec3 dy = p2-vP;
    vec3 dx2 = p3-vP;
    vec3 dy2 = vP-p4;
    
    if(length(dx2)<length(dx)&&coord.x-pW>=0.0||coord.x+pW>1.0) {
    dx = dx2;
    }
    if(length(dy2)<length(dy)&&coord.y-pH>=0.0||coord.y+pH>1.0) {
    dy = dy2;
    }

    return normalize(-cross( dx , dy ).xyz);
}

vec3 normalFromDepth(const in float depth, const in float depth1, const in float depth2, vec2 offset1, vec2 offset2) {
    vec3 p1 = vec3(offset1, depth1 - depth);
    vec3 p2 = vec3(offset2, depth2 - depth);

    vec3 normal = cross(p1, p2);
    normal.z = -normal.z;

    return normalize(normal);
}


vec3 getViewNormal1(sampler2D tex, vec2 coord, mat4 ipm)
{
    //return viewNormalAtPixelPosition(coord); //vec3(1.0,1.0,1.0);//
    
    ivec2 texSize = textureSize(tex, 0);
	float depth = getDepth(coord);//texture(tex, coord).r;
	vec3 view = screenSpaceToViewSpace(vec3(coord, depth), uInvProjection); //linear depth
    return normalize(cross(dFdx(view), dFdy(view)));    
    
    /*float pW = 1.0/float(texSize.x);
    float pH = 1.0/float(texSize.y);

    vec2 offset1 = vec2(0.0, pW);
    vec2 offset2 = vec2(pH, 0.0);

    return normalFromDepth(getDepth(coord), getDepth(coord+ offset1), getDepth(coord+ offset2), offset1, offset2);
    */
}

float lenSq(vec3 vector){
    return pow(vector.x, 2.0) + pow(vector.y, 2.0) + pow(vector.z, 2.0);
}


vec3 global_lightSample(sampler2D color_tex, sampler2D depth_tex,  vec2 coord, mat4 ipm, vec2 lightcoord, vec3 normal, vec3 position, float n, vec2 texsize){

	vec2 random = vec2(1.0);
	if (uNoise){
    	random = (mod_dither3((coord*texsize)+vec2(n*82.294,n*127.721)))*0.01*uNoiseamount;
	}else{
		random = dither(coord, 1.0, texsize)*0.1*uNoiseamount;
	}
    // lightcoord *= vec2(0.7);
    if (!uBackground){
        if (isBackground( getDepth( fract(lightcoord)+random ) )){
           return vec3(0.0,0.0,0.0);
        }
    } 
    //light absolute data
    vec3 lightcolor = textureLod(color_tex, ((lightcoord)+random),4.0).rgb;
    vec3 lightnormal   = getViewNormal(depth_tex, fract(lightcoord)+random, ipm).rgb;
    vec3 lightposition = getViewPos(depth_tex, fract(lightcoord)+random, ipm).xyz;

    
    //light variable data
    vec3 lightpath = lightposition - position;
    vec3 lightdir  = normalize(lightpath);
    
    //falloff calculations
    float cosemit  = clamp(dot(lightdir, -lightnormal), 0.0, 1.0); //emit only in one direction
    float coscatch = clamp(dot(lightdir, normal)*0.5+0.5,  0.0, 1.0); //recieve light from one direction
    float distfall = pow(lenSq(lightpath), 0.1) + 1.0;        //fall off with distance
    
    return (lightcolor * uAmbiantColor * PI * cosemit * coscatch / distfall)*(length(lightposition)/20.0);
}


vec3 lightSample(vec2 coord, vec2 lightcoord,  vec3 lightcolor,  vec3 lightdir, vec3 normal, vec3 position, float n, vec2 texsize){

	vec2 random = vec2(1.0);
	if (uNoise){
    	random = (mod_dither3((coord*texsize)+vec2(n*82.294,n*127.721)))*0.01*uNoiseamount;
	}else{
		random = dither(coord, 1.0, texsize)*0.1*uNoiseamount;
	}
    // lightcoord *= vec2(0.7);

    //light absolute data
    // vec3 lightcolor = textureLod(color_tex, ((lightcoord)+random),4.0).rgb;
    vec3 lightnormal   = getViewNormal(tDepth, fract(lightcoord)+random, uInvProjection).rgb;
    // vec3 lightposition = getViewPos(tDepth, fract(lightcoord)+random, uInvProjection).xyz;
    
    //light variable data
    vec3 lightpath = normalize(lightdir) * uLightDistance;
    vec3 lightposition = position + lightpath;
    //lightposition - position;
    // vec3 lightdir  = normalize(lightpath);
    
    //falloff calculations
    float cosemit  = clamp(dot(lightdir, -lightnormal), 0.0, 1.0); //emit only in one direction
    float coscatch = clamp(dot(lightdir, normal)*0.5+0.5,  0.0, 1.0); //recieve light from one direction
    float distfall = pow(lenSq(lightpath), 0.1) + 1.0;        //fall off with distance
    
    return (lightcolor * cosemit * coscatch / distfall)*(length(lightposition)/20.0);
}


vec3 lightSampleOriginal(sampler2D color_tex, sampler2D depth_tex,  vec2 coord, mat4 ipm,
                         vec2 lightcoord, vec3 normal, vec3 position, float n, vec2 texsize){

	vec2 random = vec2(1.0);
	if (uNoise){
    	random = (mod_dither3((coord*texsize)+vec2(n*82.294,n*127.721)))*0.01*uNoiseamount;
	}else{
		random = dither(coord, 1.0, texsize)*0.1*uNoiseamount;
	}
    lightcoord *= vec2(0.7);
    
    //light absolute data
    vec3 lightcolor = textureLod(color_tex, ((lightcoord)+random),4.0).rgb;
    vec3 lightnormal   = getViewNormal(depth_tex, fract(lightcoord)+random, ipm).rgb;
    vec3 lightposition = getViewPos(depth_tex, fract(lightcoord)+random, ipm).xyz;

    
    //light variable data
    vec3 lightpath = lightposition - position;
    vec3 lightdir  = normalize(lightpath);
    
    //falloff calculations
    float cosemit  = clamp(dot(lightdir, -lightnormal), 0.0, 1.0); //emit only in one direction
    float coscatch = clamp(dot(lightdir, normal)*0.5+0.5,  0.0, 1.0); //recieve light from one direction
    float distfall = pow(lenSq(lightpath), 0.1) + 1.0;        //fall off with distance
    
    return (lightcolor * cosemit * coscatch / distfall)*(length(lightposition)/20.0);
}

vec3 hemisphereSample_uniform(vec2 uv) {
    float phi = uv.y * 2.0 * PI;
    float cosTheta = 1.0 - uv.x;
    float sinTheta = sqrt(1.0 - cosTheta * cosTheta);
    return vec3(cos(phi) * sinTheta, sin(phi) * sinTheta, cosTheta);
}

vec3 hemisphereSample_cos(vec2 uv) {
    float phi = uv.y * 2.0 * PI;
    float cosTheta = sqrt(1.0 - uv.x);
    float sinTheta = sqrt(1.0 - cosTheta * cosTheta);
    return vec3(cos(phi) * sinTheta, sin(phi) * sinTheta, cosTheta);
}

void main(void) {
    vec2 invTexSize = 1.0 / uTexSize;
    vec2 selfCoords = gl_FragCoord.xy * invTexSize;
    float selfDepth = getDepth(selfCoords);
    float aspect = uTexSize.x/uTexSize.y;

    vec4 direct = textureLod(tColor,selfCoords,0.0);
    vec3 color = normalize(direct.rgb);
    vec3 indirect = vec3(0.0,0.0,0.0);
    float irr = 0.0;
    if (isBackground(selfDepth)) {
        gl_FragColor = direct;
        return;
    }

    ivec2 iTexSize = textureSize(tColor, 0);
    vec2 texSize = vec2(float(iTexSize.x),float(iTexSize.y));
    
    //fragment geometry data
    vec3 position = getViewPos(tDepth, selfCoords, uInvProjection);
    vec3 normal   = getViewNormal(tDepth, selfCoords, uInvProjection);
    //sampling in spiral

    vec3 randomVec = normalize(vec3(getNoiseVec2(selfCoords) * 2.0 - 1.0, 0.0));
    float pixelSize = getPixelSize(selfCoords, selfDepth);

    vec3 tangent = normalize(randomVec - normal * dot(randomVec, normal));
    vec3 bitangent = cross(normal, tangent);
    mat3 TBN = mat3(tangent, bitangent, normal);

    float dlong = PI*(3.0-sqrt(5.0));
    float dz = 1.0/float(dNSamples);
    float along = 0.0;
    float z = 1.0 - dz/2.0;
    if (uGlobalLight){
        for(int i = 0; i < dNSamples; i++){
            vec3 sampleViewPos = TBN * uSamples[i]; //* pshere;
            sampleViewPos = position + sampleViewPos * uScale;
            
            vec4 offset = vec4(sampleViewPos, 1.0);
            offset = uProjection * offset;
            offset.xyz = (offset.xyz / offset.w) * 0.5 + 0.5;
                            
            /*
            float r = sqrt(1.0-z);
            
            float xpoint = (cos(along)*r)*0.5+0.5;
            float ypoint = (sin(along)*r*aspect)*0.5+0.5;
                    
            z = z - dz;
            along = along + dlong;
            */
            indirect += lightSampleOriginal(tColor, tDepth, selfCoords, uInvProjection, vec2(offset.x, offset.y), normal, position, float(i), texSize);
            // indirect += global_lightSample(tColor, tDepth, selfCoords, uInvProjection, vec2(offset.x, offset.y), normal, position, float(i), texSize); 
        }
        indirect = indirect/float(dNSamples);
    }
    else {
        vec3 lightdir = vec3(0.0,0.0,0.0);
        vec3 lightcolor = vec3(0.0,0.0,0.0);
        vec3 lightindirect = vec3(0.0,0.0,0.0);
        #if dLightCount != 0
            //#pragma unroll_loop_start
            for (int i = 0; i < dLightCount; ++i) {
                lightdir  = uLightDirection[i];
                lightcolor = uLightColor[i]* PI;
                lightindirect = vec3(0.0,0.0,0.0);
                for(int j = 0; j < dNSamples; j++){
                    //float r = sqrt(1.0-z);
                    
                    //float xpoint = (cos(along)*r)*0.5+0.5;
                    //float ypoint = (sin(along)*r*aspect)*0.5+0.5;
                    
                    // vec3 pshere = hemisphereSample_uniform(getNoiseVec2(vec2(xpoint, ypoint)) * 2.0 - 1.0);
                    vec3 sampleViewPos = TBN * uSamples[i]; //* pshere;
                    sampleViewPos = position + sampleViewPos * uScale;
                    
                    vec4 offset = vec4(sampleViewPos, 1.0);
                    offset = uProjection * offset;
                    offset.xyz = (offset.xyz / offset.w) * 0.5 + 0.5;
    
                    z = z - dz;
                    along = along + dlong;
                    lightindirect += lightSample(selfCoords, vec2(offset.x, offset.y), lightcolor, lightdir, normal, sampleViewPos, float(j), texSize); 
                }
                //irr += length(lightindirect/float(uSamples));
                indirect += lightindirect/float(dNSamples);//(irr) * lightcolor;
            }
            indirect = indirect/float(dLightCount);
            //#pragma unroll_loop_end
            /*for(int j = 0; j < uSamples; j++){
                float r = sqrt(1.0-z);
                
                float xpoint = (cos(along)*r)*0.5+0.5;
                float ypoint = (sin(along)*r*aspect)*0.5+0.5;
                        
                z = z - dz;
                along = along + dlong;


            }
            indirect = indirect/float(dLightCount);
            */
        #endif
    }
    /*for(int i = 0; i < uSamples; i++){
            
        float r = sqrt(1.0-z);
        
        float xpoint = (cos(along)*r)*0.5+0.5;
        float ypoint = (sin(along)*r*aspect)*0.5+0.5;
                
        z = z - dz;
        along = along + dlong;
        
        indirect += lightSample(tColor, tDepth, selfCoords, uInvProjection, vec2(xpoint, ypoint), normal, position, float(i), texSize); 
    }*/

	vec3 albedo = direct.rgb + (indirect * uIndirectamount / pixelSize);
    gl_FragColor = vec4(albedo, 1.0);
}
`;
