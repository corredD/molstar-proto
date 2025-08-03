/**
 * Copyright (c) 2025 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <ludovic.autin@gmail.com>
 * translated from Unity C# code by NullTale <https://github.com/NullTale/OldMovieFx>
 */

import { QuadSchema, QuadValues, createCopyRenderable, CopyRenderable } from '../../mol-gl/compute/util';
import { ComputeRenderable, createComputeRenderable } from '../../mol-gl/renderable';
import { TextureSpec, UniformSpec, Values } from '../../mol-gl/renderable/schema';
import { ShaderCode } from '../../mol-gl/shader-code';
import { WebGLContext } from '../../mol-gl/webgl/context';
import { createComputeRenderItem } from '../../mol-gl/webgl/render-item';
import { Texture, createNullTexture } from '../../mol-gl/webgl/texture';
import { Vec2, Vec3, Vec4 } from '../../mol-math/linear-algebra';
import { ValueCell } from '../../mol-util';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { quad_vert } from '../../mol-gl/shader/quad.vert';
import { Viewport } from '../camera/util';
import { RenderTarget } from '../../mol-gl/webgl/render-target';
import { isTimingMode } from '../../mol-util/debug';
import { PostprocessingProps } from './postprocessing';
import { Color } from '../../mol-util/color';
import { AssetManager, Asset } from '../../mol-util/assets';
import { old_movie_frag } from '../../mol-gl/shader/oldmovie.frag';

export const OldMovieParams = {
    vignettePower: PD.Numeric(0.15, { min: 0, max: 1, step: 0.01 }),
    grainIntensity: PD.Numeric(0.5, { min: 0, max: 2, step: 0.01 }),
    noiseAlpha: PD.Numeric(0.1, { min: 0, max: 1, step: 0.01 }),
    tintColor: PD.Color(Color(0x8B4513)), // sepia brown
    tintStrength: PD.Numeric(0.3, { min: 0, max: 1, step: 0.01 }),
    joltOffset: PD.Group({
        x: PD.Numeric(0, { min: -0.01, max: 0.01, step: 0.0001 }),
        y: PD.Numeric(0, { min: -0.01, max: 0.01, step: 0.0001 }),
    }),
    flickeringRange: PD.Group({
        min: PD.Numeric(5.5, { min: 0, max: 20, step: 0.1 }),
        max: PD.Numeric(10.0, { min: 0, max: 20, step: 0.1 }),
    }),
    joltRange: PD.Group({
        min: PD.Numeric(-0.01, { min: -0.1, max: 0.1, step: 0.001 }),
        max: PD.Numeric(0.07, { min: -0.1, max: 0.1, step: 0.001 }),
    }),
    noiseType: PD.Numeric(1, { min: 0, max: 5, step: 1 }),
    fps: PD.Numeric(16, { min: 1, max: 60, step: 1 }),
};

export type OldMovieProps = PD.Values<typeof OldMovieParams>
export class OldMoviePass {
    static isEnabled(props: PostprocessingProps) {
        return props.oldmovie?.name === 'on';
}

    readonly target: RenderTarget;

    private readonly renderable: OldMovieRenderable;
    private readonly copyRenderable: CopyRenderable;

    private grainTexture: Texture;
    private noiseTextures: Texture[] = [];
    private currentNoiseTexture: Texture; // Current noise texture to use
    private blackTexture: Texture;
    private texturesLoaded = false;

    private currentFrame = 0;
    private vignetteFlicker = 15.0;
    private currentTiling = Vec4.create(2.0, 2.0, 0, 0);
    private currentJolt = Vec2.create(0, 0);

    // Configuration properties (could be moved to params)
    private readonly flickeringRange = Vec2.create(5.5, 10.0);
    private readonly joltRange = Vec2.create(-0.01, 0.07);
    private readonly fps = 16;

    // store latest properties
    private props: OldMovieProps = PD.getDefaultValues(OldMovieParams);

    constructor(private webgl: WebGLContext, private assetManager: AssetManager, width: number, height: number) {
        this.target = webgl.createRenderTarget(width, height, false, 'uint8', 'linear');

        // Initialize with null textures first
        const nullTexture = createNullTexture();
        this.grainTexture = webgl.resources.texture('image-uint8', 'rgba', 'ubyte', 'linear');
        // this.noiseTexture = webgl.resources.texture('image-uint8', 'rgba', 'ubyte', 'linear');
        this.blackTexture = webgl.resources.texture('image-uint8', 'rgba', 'ubyte', 'linear');
        this.currentNoiseTexture = this.blackTexture;

        this.renderable = getOldMovieRenderable(webgl, nullTexture, this.grainTexture, this.currentNoiseTexture);
        this.copyRenderable = createCopyRenderable(webgl, this.target.texture);

        // Load textures from static assets
        this.loadStaticTextures();
        // Create black texture for when noise is disabled  
        this.createBlackTexture();

        // Initialize current noise texture
        ValueCell.update(this.renderable.values.tNoise, this.currentNoiseTexture);
        // Load all noise textures
        this.loadNoiseTextures();
    }

    private createBlackTexture() {
        const size = 256;
        const data = new Uint8Array(size * size * 4);

        // Fill with black (all zeros)
        for (let i = 0; i < size * size * 4; i++) {
            data[i] = 0;
        }

        this.blackTexture.load({ array: data, width: size, height: size });  
    }

    private loadNoiseTextures() {
        // Load all 33 noise textures (00 to 32)
        for (let i = 0; i <= 32; i++) {
            const paddedNumber = i.toString().padStart(2, '0');
            const noiseAsset = Asset.Url(`https://raw.githubusercontent.com/NullTale/OldMovieFx/master/Runtime/OldMovie/Noise/A/OldMovie${paddedNumber}.png`);

            const texture = this.webgl.resources.texture('image-uint8', 'rgba', 'ubyte', 'linear');
            this.noiseTextures.push(texture);

            this.loadTextureFromAsset(noiseAsset, texture, () => {
                // Optional: track loading completion
            });
        }
    }

    private loadStaticTextures() {
        // Create assets for local texture files
        const grainAsset = Asset.Url('https://raw.githubusercontent.com/NullTale/OldMovieFx/master/Runtime/OldMovie/Grain/Grain_Large_A.png');
        // const noiseAsset = Asset.Url('https://raw.githubusercontent.com/NullTale/OldMovieFx/master/Runtime/OldMovie/Noise/A/OldMovie00.png');

        // Load grain texture
        this.loadTextureFromAsset(grainAsset, this.grainTexture, () => {
            this.checkTexturesLoaded();
        });

        // Load noise texture
        // this.loadTextureFromAsset(noiseAsset, this.noiseTexture, () => {
        //    this.checkTexturesLoaded();
        // });
    }

    private loadTextureFromAsset(asset: Asset.Url, texture: Texture, onLoad?: () => void) {
        if (typeof HTMLImageElement === 'undefined') {
            console.error('Missing "HTMLImageElement" required for texture loading');
            return;
        }

        const img = new Image();
        img.onload = () => {
            texture.load(img);
            if (this.webgl.isWebGL2 || (this.isPowerOfTwo(img.width) && this.isPowerOfTwo(img.height))) {
                texture.mipmap();
            }
            onLoad?.();
        };
        img.onerror = () => {
            console.error('Failed to load texture:', asset.url);
            // Create fallback procedural texture
            this.createFallbackTexture(texture);
            onLoad?.();
        };

        this.assetManager.resolve(asset, 'binary').run().then(a => {
            const blob = new Blob([a.data]);
            img.src = URL.createObjectURL(blob);
        }).catch(() => {
            console.warn('Asset not found, creating procedural texture:', asset.url);
            this.createFallbackTexture(texture);
            onLoad?.();
        });
    }

    private createFallbackTexture(texture: Texture) {
        const size = 256;
        const data = new Uint8Array(size * size * 4);

        // Generate random noise pattern
        for (let i = 0; i < size * size; i++) {
            const value = Math.random() * 255;
            data[i * 4] = value;// R
            data[i * 4 + 1] = value; // G
            data[i * 4 + 2] = value; // B
            data[i * 4 + 3] = value; // A
        }

        texture.load({array:data, width:size, height:size});
    }

    private checkTexturesLoaded() {
        // Simple counter-based approach - in production you might want more sophisticated tracking
        if (!this.texturesLoaded) {
            this.texturesLoaded = true;
            // Update renderable with loaded textures
            ValueCell.update(this.renderable.values.tGrain, this.grainTexture);
            // ValueCell.update(this.renderable.values.tNoise, this.noiseTexture);
            this.renderable.update();
        }
    }

    private isPowerOfTwo(value: number): boolean {
        return (value & (value - 1)) === 0;
    }

    setSize(width: number, height: number) {
        const w = this.target.getWidth();
        const h = this.target.getHeight();

        if (width !== w || height !== h) {
            this.target.setSize(width, height);
            ValueCell.update(this.renderable.values.uTexSize, Vec2.set(this.renderable.values.uTexSize.ref.value, width, height));
            ValueCell.update(this.copyRenderable.values.uTexSize, Vec2.set(this.copyRenderable.values.uTexSize.ref.value, width, height));
        }
    }

    updateSettings(props: OldMovieProps) {
        const currentTime = performance.now() / 1000; // Convert to seconds
        const frameTime = 1.0 / this.fps;
        const curFrame = Math.floor(currentTime / frameTime);

        if (this.currentFrame !== curFrame) {
            this.currentFrame = curFrame;

            // Random vignette flickering
            const randomValue = Math.random();
            this.vignetteFlicker = this.lerp(this.flickeringRange[0], this.flickeringRange[1], randomValue);

            // Dynamic grain tiling based on screen size
            const screenWidth = this.renderable.values.uTexSize.ref.value[0];
            const screenHeight = this.renderable.values.uTexSize.ref.value[1];
            const grainTexWidth = 256; // Assuming grain texture size
            const grainTexHeight = 256;

            this.currentTiling = Vec4.create(
                screenWidth / grainTexWidth,
                screenHeight / grainTexHeight,
                Math.random(), // Random offset X
                Math.random() // Random offset Y
            );

            // Random jolt calculation
            const joltRandomX = Math.random();
            const joltRandomY = Math.random();
            this.currentJolt = Vec2.create(
                this.lerp(this.joltRange[0], this.joltRange[1], joltRandomX) * props.joltOffset.x,
                this.lerp(this.joltRange[0], this.joltRange[1], joltRandomY) * props.joltOffset.y
            );
            // Random noise texture selection (matching Unity logic)
            if (props.noiseType === 0) {
                // Noise disabled - use black texture
                this.currentNoiseTexture = this.blackTexture;
            } else {
                // Random selection from available noise textures
                const randomIndex = Math.floor(Math.random() * this.noiseTextures.length);
                this.currentNoiseTexture = this.noiseTextures[randomIndex];
            }
            ValueCell.update(this.renderable.values.tNoise, this.currentNoiseTexture);
            this.renderable.update();
        }

        // Update vignette parameters
        const vignette = Vec4.create(
            this.vignetteFlicker,
            props.vignettePower,
            props.grainIntensity,
            props.noiseAlpha
        );
        ValueCell.update(this.renderable.values.uVignette, vignette);

        // Update grain parameters
        const grain = this.currentTiling;
        ValueCell.update(this.renderable.values.uGrain, grain);

        // Update tint parameters
        const tintColor = Color.toVec3Normalized(Vec3(), props.tintColor);
        const tint = Vec4.create(tintColor[0], tintColor[1], tintColor[2], props.tintStrength);
        ValueCell.update(this.renderable.values.uTint, tint);

        // Update jolt offset
        const jolt = this.currentJolt;
        ValueCell.update(this.renderable.values.uJolt, jolt);
        // Update the noise texture uniform
    }

    update(input: Texture, p0: Texture, props: OldMovieProps) {
        // let needsUpdate = false;
        // can this be called everyframe ? 
        if (this.renderable.values.tColor.ref.value !== input) {
            ValueCell.update(this.renderable.values.tColor, input);
            // needsUpdate = true;
        }
        this.updateSettings(props);
        this.props = props;
    }

    private lerp(a: number, b: number, t: number): number {
        return a + (b - a) * t;
    }

    render(viewport: Viewport, target: RenderTarget | undefined) {
        if (isTimingMode) this.webgl.timer.mark('OldMoviePass.render');

        this.updateSettings(this.props);

        const { gl, state } = this.webgl;
        const { x, y, width, height } = viewport;

        state.viewport(x, y, width, height);
        state.scissor(x, y, width, height);
        state.enable(gl.SCISSOR_TEST);
        state.disable(gl.BLEND);
        state.disable(gl.DEPTH_TEST);
        state.depthMask(false);

        // Render old movie effect to internal target
        this.target.bind();
        this.renderable.render();

        // Copy to final target or drawing buffer
        if (target) {
            target.bind();
        }

        this.copyRenderable.render();

        if (isTimingMode) this.webgl.timer.markEnd('OldMoviePass.render');
    }
}

//

const OldMovieSchema = {
    ...QuadSchema,
    tColor: TextureSpec('texture', 'rgba', 'ubyte', 'linear'),
    tGrain: TextureSpec('texture', 'rgba', 'ubyte', 'linear'),
    tNoise: TextureSpec('texture', 'rgba', 'ubyte', 'linear'),
    uTexSize: UniformSpec('v2'),
    uVignette: UniformSpec('v4'),
    uGrain: UniformSpec('v4'),
    uTint: UniformSpec('v4'),
    uJolt: UniformSpec('v2'),
};
const OldMovieShaderCode = ShaderCode('Old Movie', quad_vert, old_movie_frag);
type OldMovieRenderable = ComputeRenderable<Values<typeof OldMovieSchema>>

function getOldMovieRenderable(ctx: WebGLContext, colorTexture: Texture, grainTexture: Texture, noiseTexture: Texture): OldMovieRenderable {
    const width = colorTexture.getWidth();
    const height = colorTexture.getHeight();

    const values: Values<typeof OldMovieSchema> = {
        ...QuadValues,
        tColor: ValueCell.create(colorTexture),
        tGrain: ValueCell.create(grainTexture),
        tNoise: ValueCell.create(noiseTexture),
        uTexSize: ValueCell.create(Vec2.create(width, height)),
        uVignette: ValueCell.create(Vec4.create(15.0, 0.15, 0.5, 0.1)),
        uGrain: ValueCell.create(Vec4.create(2.0, 2.0, 0, 0)),
        uTint: ValueCell.create(Vec4.create(0.545, 0.271, 0.075, 0.3)), // sepia
        uJolt: ValueCell.create(Vec2.create(0, 0)),
    };

    const schema = { ...OldMovieSchema };
    const renderItem = createComputeRenderItem(ctx, 'triangles', OldMovieShaderCode, schema, values);

    return createComputeRenderable(renderItem, values);
}