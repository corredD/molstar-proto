/**
 * Copyright (c) 2019-2025 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Áron Samuel Kovács <aron.kovacs@mail.muni.cz>
 * @author Ludovic Autin <ludovic.autin@gmail.com>
 * @author Gianluca Tomasello <giagitom@gmail.com>
 */

import { QuadSchema, QuadValues } from '../../mol-gl/compute/util';
import { TextureSpec, Values, UniformSpec, DefineSpec } from '../../mol-gl/renderable/schema';
import { ShaderCode } from '../../mol-gl/shader-code';
import { WebGLContext } from '../../mol-gl/webgl/context';
import { Texture } from '../../mol-gl/webgl/texture';
import { ValueCell } from '../../mol-util';
import { createComputeRenderItem } from '../../mol-gl/webgl/render-item';
import { createComputeRenderable, ComputeRenderable } from '../../mol-gl/renderable';
import { Mat4, Vec2, Vec3, Vec4 } from '../../mol-math/linear-algebra';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { RenderTarget } from '../../mol-gl/webgl/render-target';
import { ICamera } from '../../mol-canvas3d/camera';
import { quad_vert } from '../../mol-gl/shader/quad.vert';
import { isTimingMode } from '../../mol-util/debug';
import { getTransformedLightDirection, Light } from '../../mol-gl/renderer';
import { shadows_frag } from '../../mol-gl/shader/shadows.frag';
import { PostprocessingProps } from './postprocessing';

export const ShadowParams = {
    // Mode switch
    mode: PD.Select<'simple' | 'advanced'>('simple', [['simple', 'Simple'], ['advanced', 'Advanced']]),

    // SIMPLE (original) params
    steps: PD.Numeric(1, { min: 1, max: 64, step: 1 }),
    maxDistance: PD.Numeric(3, { min: 0, max: 256, step: 1 }),
    tolerance: PD.Numeric(1.0, { min: 0.0, max: 10.0, step: 0.1 }),

    // ADVANCED (Bend-inspired) params
    sampleCount: PD.Numeric(60, { min: 1, max: 256, step: 1 }),
    hardShadowSamples: PD.Numeric(4, { min: 0, max: 32, step: 1 }),
    fadeOutSamples: PD.Numeric(8, { min: 0, max: 64, step: 1 }),
    maxPixelDistance: PD.Numeric(120, { min: 1, max: 2048, step: 1 }),

    surfaceThickness: PD.Numeric(0.005, { min: 0.0001, max: 0.05, step: 0.0001 }),
    bilinearThreshold: PD.Numeric(0.02, { min: 0.0, max: 0.25, step: 0.001 }),
    shadowContrast: PD.Numeric(4.0, { min: 0.5, max: 16.0, step: 0.5 }),

    ignoreEdgePixels: PD.Boolean(false),
    usePrecisionOffset: PD.Boolean(false),
    bilinearSamplingOffsetMode: PD.Boolean(false),
};

export type ShadowProps = PD.Values<typeof ShadowParams>

export class ShadowPass {
    static isEnabled(props: PostprocessingProps) {
        return props.enabled && props.shadow.name !== 'off';
    }

    readonly target: RenderTarget;
    private readonly renderable: ShadowsRenderable;

    private invProjection = Mat4.identity();
    private invHeadRotation = Mat4.identity();

    constructor(readonly webgl: WebGLContext, width: number, height: number, depthTextureOpaque: Texture) {
        this.target = webgl.createRenderTarget(width, height, false);
        this.renderable = getShadowsRenderable(webgl, depthTextureOpaque);
    }

    getByteCount() {
        return this.target.getByteCount();
    }

    setSize(width: number, height: number) {
        const [w, h] = this.renderable.values.uTexSize.ref.value;
        if (width !== w || height !== h) {
            this.target.setSize(width, height);
            ValueCell.update(this.renderable.values.uTexSize, Vec2.set(this.renderable.values.uTexSize.ref.value, width, height));
        }
    }

    update(camera: ICamera, light: Light, ambientColor: Vec3, props: ShadowProps) {
        let needsUpdateShadows = false;

        const orthographic = camera.state.mode === 'orthographic' ? 1 : 0;

        const [w, h] = this.renderable.values.uTexSize.ref.value;
        const v = camera.viewport;

        ValueCell.update(this.renderable.values.uProjection, camera.projection);
        ValueCell.update(this.renderable.values.uInvProjection, Mat4.invert(this.invProjection, camera.projection));

        Vec4.set(this.renderable.values.uBounds.ref.value,
            v.x / w,
            v.y / h,
            (v.x + v.width) / w,
            (v.y + v.height) / h
        );
        ValueCell.update(this.renderable.values.uBounds, this.renderable.values.uBounds.ref.value);

        ValueCell.updateIfChanged(this.renderable.values.uNear, camera.near);
        ValueCell.updateIfChanged(this.renderable.values.uFar, camera.far);
        if (this.renderable.values.dOrthographic.ref.value !== orthographic) {
            ValueCell.update(this.renderable.values.dOrthographic, orthographic);
            needsUpdateShadows = true;
        }

        // Mode switch
        const shadowMode = props.mode === 'advanced' ? 1 : 0;
        ValueCell.updateIfChanged(this.renderable.values.uShadowMode, shadowMode);

        // SIMPLE uniforms (scaled by camera.scale to match your original code)
        ValueCell.updateIfChanged(this.renderable.values.uMaxDistance, props.maxDistance * camera.scale);
        ValueCell.updateIfChanged(this.renderable.values.uTolerance, props.tolerance * camera.scale);
        if (this.renderable.values.dSteps.ref.value !== props.steps) {
            ValueCell.update(this.renderable.values.dSteps, props.steps);
            needsUpdateShadows = true;
        }

        // ADVANCED uniforms (pixel-space & dimensionless)
        ValueCell.updateIfChanged(this.renderable.values.uSampleCount, props.sampleCount);
        ValueCell.updateIfChanged(this.renderable.values.uHardShadowSamples, props.hardShadowSamples);
        ValueCell.updateIfChanged(this.renderable.values.uFadeOutSamples, props.fadeOutSamples);
        ValueCell.updateIfChanged(this.renderable.values.uMaxPixelDistance, props.maxPixelDistance);

        ValueCell.updateIfChanged(this.renderable.values.uSurfaceThickness, props.surfaceThickness);
        ValueCell.updateIfChanged(this.renderable.values.uBilinearThreshold, props.bilinearThreshold);
        ValueCell.updateIfChanged(this.renderable.values.uShadowContrast, props.shadowContrast);

        ValueCell.updateIfChanged(this.renderable.values.uIgnoreEdgePixels, props.ignoreEdgePixels ? 1 : 0);
        ValueCell.updateIfChanged(this.renderable.values.uUsePrecisionOffset, props.usePrecisionOffset ? 1 : 0);
        ValueCell.updateIfChanged(this.renderable.values.uBilinearSamplingOffsetMode, props.bilinearSamplingOffsetMode ? 1 : 0);

        // Lights
        const hasHeadRotation = !Mat4.isZero(camera.headRotation);
        if (hasHeadRotation) {
            ValueCell.update(this.renderable.values.uLightDirection, getTransformedLightDirection(light, Mat4.invert(this.invHeadRotation, camera.headRotation)));
        } else {
            ValueCell.update(this.renderable.values.uLightDirection, light.direction);
        }
        ValueCell.update(this.renderable.values.uLightColor, light.color);
        if (this.renderable.values.dLightCount.ref.value !== light.count) {
            ValueCell.update(this.renderable.values.dLightCount, light.count);
            needsUpdateShadows = true;
        }
        ValueCell.update(this.renderable.values.uAmbientColor, ambientColor);

        if (needsUpdateShadows) {
            this.renderable.update();
        }
    }

    render() {
        if (isTimingMode) this.webgl.timer.mark('ShadowPass.render');
        this.target.bind();
        this.renderable.render();
        if (isTimingMode) this.webgl.timer.markEnd('ShadowPass.render');
    }
}

const ShadowsSchema = {
    ...QuadSchema,
    tDepth: TextureSpec('texture', 'rgba', 'ubyte', 'nearest'),
    uTexSize: UniformSpec('v2'),

    uProjection: UniformSpec('m4'),
    uInvProjection: UniformSpec('m4'),
    uBounds: UniformSpec('v4'),

    dOrthographic: DefineSpec('number'),
    uNear: UniformSpec('f'),
    uFar: UniformSpec('f'),

    // Mode switch
    uShadowMode: UniformSpec('i'),

    // SIMPLE
    dSteps: DefineSpec('number'),
    uMaxDistance: UniformSpec('f'),
    uTolerance: UniformSpec('f'),

    // ADVANCED (Bend-inspired)
    uSampleCount: UniformSpec('i'),
    uHardShadowSamples: UniformSpec('i'),
    uFadeOutSamples: UniformSpec('i'),
    uMaxPixelDistance: UniformSpec('f'),

    uSurfaceThickness: UniformSpec('f'),
    uBilinearThreshold: UniformSpec('f'),
    uShadowContrast: UniformSpec('f'),

    uIgnoreEdgePixels: UniformSpec('i'),
    uUsePrecisionOffset: UniformSpec('i'),
    uBilinearSamplingOffsetMode: UniformSpec('i'),

    uLightDirection: UniformSpec('v3[]'),
    uLightColor: UniformSpec('v3[]'),
    dLightCount: DefineSpec('number'),
    uAmbientColor: UniformSpec('v3'),
};
type ShadowsRenderable = ComputeRenderable<Values<typeof ShadowsSchema>>

function getShadowsRenderable(ctx: WebGLContext, depthTexture: Texture): ShadowsRenderable {
    const width = depthTexture.getWidth();
    const height = depthTexture.getHeight();

    const values: Values<typeof ShadowsSchema> = {
        ...QuadValues,
        tDepth: ValueCell.create(depthTexture),
        uTexSize: ValueCell.create(Vec2.create(width, height)),

        uProjection: ValueCell.create(Mat4.identity()),
        uInvProjection: ValueCell.create(Mat4.identity()),
        uBounds: ValueCell.create(Vec4()),

        dOrthographic: ValueCell.create(0),
        uNear: ValueCell.create(1),
        uFar: ValueCell.create(10000),

        // Default to SIMPLE
        uShadowMode: ValueCell.create(0),

        // SIMPLE defaults
        dSteps: ValueCell.create(1),
        uMaxDistance: ValueCell.create(3.0),
        uTolerance: ValueCell.create(1.0),

        // ADVANCED defaults
        uSampleCount: ValueCell.create(60),
        uHardShadowSamples: ValueCell.create(4),
        uFadeOutSamples: ValueCell.create(8),
        uMaxPixelDistance: ValueCell.create(120.0),

        uSurfaceThickness: ValueCell.create(0.005),
        uBilinearThreshold: ValueCell.create(0.02),
        uShadowContrast: ValueCell.create(4.0),

        uIgnoreEdgePixels: ValueCell.create(0),
        uUsePrecisionOffset: ValueCell.create(0),
        uBilinearSamplingOffsetMode: ValueCell.create(0),

        uLightDirection: ValueCell.create([]),
        uLightColor: ValueCell.create([]),
        dLightCount: ValueCell.create(0),
        uAmbientColor: ValueCell.create(Vec3()),
    };

    const schema = { ...ShadowsSchema };
    const shaderCode = ShaderCode('shadows', quad_vert, shadows_frag);
    const renderItem = createComputeRenderItem(ctx, 'triangles', shaderCode, schema, values);

    return createComputeRenderable(renderItem, values);
}
