export default `precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexSize;

const float noiseAmount = 0.0002;


//OCCULUSION OPTIONS
//dOcclusionKernelSize is #define?
uniform float uOcclusionBias;
uniform float uOcclusionRadius;

uniform float uOutlineScale;
uniform float uOutlineThreshold;

//SSAO OPTIONS
//dssao_rings is defined
//dssao_noise is defined
uniform float ussao_scale;//1
uniform float ussao_aoCap;//1.0
uniform float ussao_aoMultiplier;//100
uniform float ussao_depthTolerance;//0.0
uniform float ussao_aorange;//160.0

//HASH OPTIONS
//render Pierrick
uniform float back_intensity;
uniform float line_intensity;
uniform float c_limit;
uniform float c_spacing;
uniform float c_width;
uniform float s_spacing;
uniform float s_width;
uniform float d_spacing;
uniform float d_width_high;
uniform float d_width_low;
uniform float g_low;
uniform float g_hight;
uniform float l_low;
uniform float l_hight;
uniform float d_width_spread;
uniform float zl_min;
uniform float zl_max;


#define PI 3.14159265

#include common

float noise(vec2 coords) {
	float a = 12.9898;
	float b = 78.233;
	float c = 43758.5453;
	float dt = dot(coords, vec2(a,b));
	float sn = mod(dt, 3.14159);

	return fract(sin(sn) * c);
}

float getDepth(in vec2 coords) {
	#ifdef dPackedDepth
		return unpackRGBAToDepth(texture2D(tDepth, coords));
	#else
		return texture2D(tDepth, coords).r;
	#endif
}

float calcSSAO(in vec2 coords, in float depth) {
	float occlusionFactor = 0.0;

	for (int i = -dOcclusionKernelSize; i <= dOcclusionKernelSize; i++) {
		for (int j = -dOcclusionKernelSize; j <= dOcclusionKernelSize; j++) {
			vec2 coordsDelta = coords + uOcclusionRadius / float(dOcclusionKernelSize) * vec2(float(i) / uTexSize.x, float(j) / uTexSize.y);
            coordsDelta += noiseAmount * (noise(coordsDelta) - 0.5) / uTexSize;
            coordsDelta = clamp(coordsDelta, 0.5 / uTexSize, 1.0 - 1.0 / uTexSize);
			if (getDepth(coordsDelta) < depth) occlusionFactor += 1.0;
		}
	}

	return occlusionFactor / float((2 * dOcclusionKernelSize + 1) * (2 * dOcclusionKernelSize + 1));
}

float calcEdgeDepth(in vec2 coords) {
    vec2 invTexSize = 1.0 / uTexSize;
    float halfScaleFloor = floor(uOutlineScale * 0.5);
    float halfScaleCeil = ceil(uOutlineScale * 0.5);

    vec2 bottomLeftUV = coords - invTexSize * halfScaleFloor;
    vec2 topRightUV = coords + invTexSize * halfScaleCeil;
    vec2 bottomRightUV = coords + vec2(invTexSize.x * halfScaleCeil, -invTexSize.y * halfScaleFloor);
    vec2 topLeftUV = coords + vec2(-invTexSize.x * halfScaleFloor, invTexSize.y * halfScaleCeil);

    float depth0 = getDepth(bottomLeftUV);
    float depth1 = getDepth(topRightUV);
    float depth2 = getDepth(bottomRightUV);
    float depth3 = getDepth(topLeftUV);

    float depthFiniteDifference0 = depth1 - depth0;
    float depthFiniteDifference1 = depth3 - depth2;

    return sqrt(pow(depthFiniteDifference0, 2.0) + pow(depthFiniteDifference1, 2.0)) * 100.0;
}


vec2 rand(in vec2 coord) {
    //generating random noise
    float noiseX = (fract(sin(dot(coord ,vec2(12.9898,78.233))) * 43758.5453));
    float noiseY = (fract(sin(dot(coord ,vec2(12.9898,78.233)*2.0)) * 43758.5453));
    return vec2(noiseX,noiseY)*0.004;
    }

float compareDepths( in float depth1, in float depth2 ){
	float aoCap  = ussao_aoCap;
	float aoMultiplier  = ussao_aoMultiplier;
	float depthTolerance  = ussao_depthTolerance;
	float aorange  = ussao_aorange;//60 units in space the AO effect extends to (this gets divided by the camera far range
    float diff = sqrt(clamp(1.0-(depth1-depth2) / (aorange),0.0,1.0));
    float ao = min(aoCap,max(0.0,depth1-depth2-depthTolerance) * aoMultiplier) * diff;
    return ao;
    }

float computeAO(in vec2 scrCoord){
	int samples = dssao_samples; //samples on the each ring (3-7)
	int rings = dssao_rings; //ring count (2-8)
	float RenderedTextureWidth = uTexSize.x;
	float RenderedTextureHeight = uTexSize.y;
	float depth = getDepth(scrCoord);
    float d=0.0;
    float aspect = RenderedTextureWidth/RenderedTextureHeight;
    vec2 noise = rand(scrCoord);//getRandom(srcCoord);//
    float w=0.0;
		float h=0.0;
		//int do_noise = 0;
		float scale = ussao_scale;
		#ifdef dssao_noise
       w = (scale / RenderedTextureWidth)/clamp(depth,0.05,1.0)+(noise.x*(1.0-noise.x));
       h = (scale / RenderedTextureHeight)/clamp(depth,0.05,1.0)+(noise.y*(1.0-noise.y));
    #else
       w = (scale / RenderedTextureWidth)/clamp(depth,0.05,1.0)+0.001;//+(noise.x*(1.0-noise.x));
       h = (scale / RenderedTextureHeight)/clamp(depth,0.05,1.0)+0.001;//+(noise.y*(1.0-noise.y));
		#endif
    float pw;
    float ph;

    float ao;
    float s;

    int ringsamples;
    for (int i = 1; i <= rings; i += 1){
        ringsamples = i * samples;
        for (int j = 0 ; j < ringsamples ; j += 1)   {
            float step = PI*2.0 / float(ringsamples);//uOcclusionRadius
            pw = (cos(float(j)*step)*float(i));
            ph = (sin(float(j)*step)*float(i))*aspect;
			d = getDepth(vec2(scrCoord.s+pw*w,scrCoord.t+ph*h));
			ao += compareDepths(depth,d);
            s += 1.0;
            }
        }
    ao /= s;
    //ao = 1.0-ao;
    return ao;//ao
    }

float calculate_1st_derivative(in vec2 scrCoord){
	float g_opacity;
	float g;

	// A B C
	// D X E
	// F G H
	float zl_X = getDepth(scrCoord.xy);
	float zl_A = getDepth(vec2(scrCoord.x-1.0, scrCoord.y+1.0));
	float zl_B = getDepth(vec2(scrCoord.x, scrCoord.y+1.0));
	float zl_C = getDepth(vec2(scrCoord.x+1.0, scrCoord.y+1.0));
	float zl_D = getDepth(vec2(scrCoord.x-1.0, scrCoord.y));
	float zl_E = getDepth(vec2(scrCoord.x+1.0, scrCoord.y));
	float zl_F = getDepth(vec2(scrCoord.x-1.0, scrCoord.y-1.0));
	float zl_G = getDepth(vec2(scrCoord.x, scrCoord.y-1.0));
	float zl_H = getDepth(vec2(scrCoord.x+1.0, scrCoord.y-1.0));

	g = (abs(zl_A+2.0*zl_B+zl_C-zl_F-2.0*zl_G)+abs(zl_C+2.0*zl_E+zl_H-zl_A-2.0*zl_D-zl_F))/8.0;
	g_opacity = min((g-g_low)/(g_hight-g_low),1.0);
	g_opacity = max(g_opacity,0.0);
	return g_opacity*-10000.0;
}

float calculate_2nd_derivative(in vec2 scrCoord){

	float l_opacity;
	float l;

	// A B C
	// D X E
	// F G H
	float zl_X = getDepth(scrCoord.xy);
	float zl_A = getDepth(vec2(scrCoord.x-1.0, scrCoord.y+1.0));
	float zl_B = getDepth(vec2(scrCoord.x, scrCoord.y+1.0));
	float zl_C = getDepth(vec2(scrCoord.x+1.0, scrCoord.y+1.0));
	float zl_D = getDepth(vec2(scrCoord.x-1.0, scrCoord.y));
	float zl_E = getDepth(vec2(scrCoord.x+1.0, scrCoord.y));
	float zl_F = getDepth(vec2(scrCoord.x-1.0, scrCoord.y-1.0));
	float zl_G = getDepth(vec2(scrCoord.x, scrCoord.y-1.0));
	float zl_H = getDepth(vec2(scrCoord.x+1.0, scrCoord.y-1.0));

	l = abs(8.0*zl_X-zl_A-zl_B-zl_C-zl_D-zl_E-zl_F-zl_F-zl_G-zl_H)/3.0;
	l_opacity = min((l-l_low)/(l_hight-l_low),1.0);
	l_opacity = max(l_opacity,0.0);

	return l_opacity*-10000.0;
}

float get_l_opacity_ave(in vec2 scrCoord, in float l_opacity_X){

	float l_opacity_ave = 0.0;
	float l_opacity = 0.0;
	int rl = 0;

	for (float i = -1.0; i < 2.0; ++i) {
		for (float j = -1.0; j < 2.0; ++j) {
			l_opacity = calculate_2nd_derivative(vec2(scrCoord.x+i,scrCoord.y+j));
			l_opacity_ave = l_opacity_ave+l_opacity;
			if (l_opacity > 0.0) {
				rl = rl+1;
			}
		}
	}
	if (rl > 6) {
	    l_opacity_ave = min(1.0,l_opacity_ave/6.0);
	} else {
		l_opacity_ave = l_opacity_X;
	}

	return l_opacity_ave;
}

vec4 HashTest(in vec2 scrCoord, in float d, in vec4 color)
{
	// NOT GOOD
    float shadow = d;
	// fin NOT GOOD

	float x_opacity = 0.0;
	float y_opacity = 0.0;
	float s_opacity = 0.0;
	float d_opacity = 0.0;
	// compute shade using luminosity method
	float shade_image = 0.21*color.r + 0.72*color.g + 0.07*color.b;
	float distance;
	float shade;
	float value;
	float zl_spread;
	float line_opacity;
	float final_val;

	d = -10000.0*d;
	zl_spread = zl_max-zl_min;

	// calculate first derivative for outlines
	float g_opacity = calculate_1st_derivative(scrCoord);

	// calculate second derivative for cusps and creases
	float l_opacity = calculate_2nd_derivative(scrCoord);

	// averaging cusps and creases
	float l_opacity_ave = get_l_opacity_ave(scrCoord, l_opacity);

	if (d != -10000.0) {	// ICI CONDITION DU TEST A REVOIR
		// contour lines
		value = d-scrCoord.x;	// ICI SOUSTRATION DE LA COORD X A REVOIR
		distance = abs(mod(value,c_spacing));
		distance = min(distance,c_spacing-distance);
		shade = min(shade_image/c_limit,1.0);
		x_opacity = (1.0-shade)*c_width/2.0-distance;

		value = d-scrCoord.y;
		distance = abs(mod(value,c_spacing));
		distance = min(distance,c_spacing-distance);
		shade = min(shade_image/c_limit,1.0);
		y_opacity = (1.0-shade)*c_width/2.0-distance;

		// shadow hatch lines
		if (shadow < 0.95*shade_image) {
			value = scrCoord.x+scrCoord.y;
			distance = abs(mod(value,s_spacing));
			distance = min(distance,s_spacing-distance);
			s_opacity = s_width/2.0-distance;
		}
	}

	// depth hatch lines
	value = scrCoord.x+scrCoord.y;
	distance = abs(mod(value,d_spacing));
	distance = min(distance,d_spacing-distance);
	if (d != -10000.0) {	// ICI CONDITION DU TEST A REVOIR
	    d_opacity = ((d-zl_min)/zl_spread*d_width_spread+d_width_low)/2.0-distance;
	} else {
		d_opacity = d_width_low/2.0-distance;
	}

	// calculate intensity of pixel
	line_opacity = max(g_opacity, max(l_opacity_ave, max(x_opacity, max(y_opacity, max(s_opacity, max(d_opacity,0.0))))));
	line_opacity = min(line_opacity,1.0);

	final_val = back_intensity-(back_intensity-line_intensity)*line_opacity;
	final_val = min(final_val,1.0);
	return vec4(final_val,final_val,final_val, 1.0);
}


void main(void) {
	vec2 coords = gl_FragCoord.xy / uTexSize;
	vec4 color = texture2D(tColor, coords);
	vec3 black = vec3(0.0,0.0,0.0);
	float depth = getDepth(coords);
	#ifdef dSSAOEnable
		if (depth != 1.0) {
			float occlusionFactor = computeAO(coords);
			#ifdef dssao_negative
				occlusionFactor = 1.0 - occlusionFactor;
		  #endif
			color = mix(color, vec4(0.0, 0.0, 0.0, 1.0), uOcclusionBias * occlusionFactor);//uOcclusionBias * occlusionFactor
		}
	#endif
	#ifdef dOcclusionEnable
		if (depth != 1.0) {
			float occlusionFactor = calcSSAO(coords, depth);
			color = mix(color, vec4(0.0, 0.0, 0.0, 1.0), uOcclusionBias * occlusionFactor);
		}
	#endif
	#ifdef dHashEnable
			if (depth != 1.0) {
				float hash = HashTest(coords, depth, color).r;
				color = mix(color, vec4(0.0, 0.0, 0.0, 1.0), uOcclusionBias * (1.0-hash));
		}
	#endif
	#ifdef dOutlineEnable
    	color.rgb *= (step(calcEdgeDepth(coords), uOutlineThreshold));
	#endif
	gl_FragColor = color;
}
`