/**
 * Copyright (c) 2024 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { QuadSchema, QuadValues } from '../../mol-gl/compute/util';
import { ComputeRenderable, createComputeRenderable } from '../../mol-gl/renderable';
import { TextureSpec, UniformSpec, DefineSpec, Values } from '../../mol-gl/renderable/schema';
import { ShaderCode } from '../../mol-gl/shader-code';
import { WebGLContext } from '../../mol-gl/webgl/context';
import { createComputeRenderItem } from '../../mol-gl/webgl/render-item';
import { Texture } from '../../mol-gl/webgl/texture';
import { Mat4, Vec2, Vec3, Vec4 } from '../../mol-math/linear-algebra';
import { ValueCell } from '../../mol-util';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { quad_vert } from '../../mol-gl/shader/quad.vert';
import { ssgi_frag } from '../../mol-gl/shader/ssgi.frag';
import { Viewport } from '../camera/util';
import { RenderTarget } from '../../mol-gl/webgl/render-target';
import { isTimingMode } from '../../mol-util/debug';
import { ICamera } from '../../mol-canvas3d/camera';
import { Light } from '../../mol-gl/renderer';

export const SSGIParams = {
    uSamples: PD.Numeric(20, { min: 1, max: 128, step: 1 }),
    uIndirectamount: PD.Numeric(0.007, { min: 0.0, max: 3.0, step: 0.001 }),
    uNoiseamount: PD.Numeric(100, { min: 0.0, max: 256.0, step: 1.0 }),
    uNoise: PD.Boolean(true),
    uScale: PD.Numeric(1.0, { min: 0.0, max: 2560.0, step: 0.01 }),
    uLightDistance: PD.Numeric(0.0, { min: 0.0, max: 25600.0, step: 1.0 }),
    uBackground: PD.Boolean(true),
    uGlobalLight: PD.Boolean(false),
};

export type SSGIProps = PD.Values<typeof SSGIParams>

export class SSGIPass {
    private readonly renderable: renderable;

    constructor(private webgl: WebGLContext, input: Texture, depth: Texture) {
        this.renderable = getrenderable(webgl, input, depth);
    }

    private updateState(viewport: Viewport) {
        const { gl, state } = this.webgl;

        state.enable(gl.SCISSOR_TEST);
        state.disable(gl.BLEND);
        state.disable(gl.DEPTH_TEST);
        state.depthMask(false);

        const { x, y, width, height } = viewport;
        state.viewport(x, y, width, height);
        state.scissor(x, y, width, height);

        state.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
    }

    setSize(width: number, height: number) {
        ValueCell.update(this.renderable.values.uTexSize, Vec2.set(this.renderable.values.uTexSize.ref.value, width, height));
    }

    update(camera: ICamera, input: Texture, depth: Texture, props: SSGIProps, light: Light) {
        let needsUpdate = false;
        if (this.renderable.values.tColor.ref.value !== input) {
            ValueCell.update(this.renderable.values.tColor, input);
            needsUpdate = true;
        }
        if (this.renderable.values.tDepth.ref.value !== depth) {
            ValueCell.update(this.renderable.values.tDepth, depth);
            needsUpdate = true;
        }
        const orthographic = camera.state.mode === 'orthographic' ? 1 : 0;
        const invProjection = Mat4.identity();
        Mat4.invert(invProjection, camera.projection);

        const [w, h] = this.renderable.values.uTexSize.ref.value;
        const v = camera.viewport;
        // const ambientColor = Vec3();
        // Vec3.scale(ambientColor, Color.toArrayNormalized(rendererProps.ambientColor, ambientColor, 0), rendererProps.ambientIntensity);

        ValueCell.update(this.renderable.values.uProjection, camera.projection);
        ValueCell.update(this.renderable.values.uInvProjection, invProjection);

        Vec4.set(this.renderable.values.uBounds.ref.value,
            v.x / w,
            v.y / h,
            (v.x + v.width) / w,
            (v.y + v.height) / h
        );
        ValueCell.update(this.renderable.values.uBounds, this.renderable.values.uBounds.ref.value);

        ValueCell.updateIfChanged(this.renderable.values.uNear, camera.near);
        ValueCell.updateIfChanged(this.renderable.values.uFar, camera.far);
        ValueCell.updateIfChanged(this.renderable.values.dOrthographic, orthographic);

        ValueCell.updateIfChanged(this.renderable.values.uIndirectamount, props.uIndirectamount);
        ValueCell.updateIfChanged(this.renderable.values.uNoiseamount, props.uNoiseamount);
        ValueCell.updateIfChanged(this.renderable.values.uScale, props.uScale);
        ValueCell.updateIfChanged(this.renderable.values.uNoise, props.uNoise);
        ValueCell.updateIfChanged(this.renderable.values.uBackground, props.uBackground);
        ValueCell.updateIfChanged(this.renderable.values.uGlobalLight, props.uGlobalLight);
        ValueCell.updateIfChanged(this.renderable.values.uLightDistance, props.uLightDistance);

        if (this.renderable.values.dNSamples.ref.value !== props.uSamples) {
            ValueCell.update(this.renderable.values.uSamples, getSamples(props.uSamples));
            ValueCell.updateIfChanged(this.renderable.values.dNSamples, props.uSamples);
            needsUpdate = true;
        }

        ValueCell.update(this.renderable.values.uLightDirection, light.direction);
        ValueCell.update(this.renderable.values.uLightColor, light.color);
        if (this.renderable.values.dLightCount.ref.value !== light.count) {
            ValueCell.update(this.renderable.values.dLightCount, light.count);
            needsUpdate = true;
        }
        // ValueCell.update(this.renderable.values.uAmbiantColor, ambientColor);
        this.renderable.update();
        if (needsUpdate) {
            this.renderable.update();
        }
    }

    render(viewport: Viewport, target: RenderTarget | undefined) {
        if (isTimingMode) this.webgl.timer.mark('SSGIPass.render');
        if (target) {
            target.bind();
        } else {
            this.webgl.unbindFramebuffer();
        }
        this.updateState(viewport);
        this.renderable.render();
        if (isTimingMode) this.webgl.timer.markEnd('SSGIPass.render');
    }
}

//
const SSGISchema = {
    ...QuadSchema,
    tDepth: TextureSpec('texture', 'rgba', 'ubyte', 'nearest'),
    tColor: TextureSpec('texture', 'rgba', 'ubyte', 'nearest'),
    uTexSize: UniformSpec('v2'),

    uProjection: UniformSpec('m4'),
    uInvProjection: UniformSpec('m4'),
    uBounds: UniformSpec('v4'),

    dOrthographic: DefineSpec('number'),
    uNear: UniformSpec('f'),
    uFar: UniformSpec('f'),

    uSamples: UniformSpec('v3[]'),
    dNSamples: DefineSpec('number'),

    uIndirectamount: UniformSpec('f'),
    uNoiseamount: UniformSpec('f'),
    uNoise: UniformSpec('b'),
    uBackground: UniformSpec('b'),
    uGlobalLight: UniformSpec('b'),
    uLightDistance: UniformSpec('f'),
    uScale: UniformSpec('f'),

    uLightDirection: UniformSpec('v3[]'),
    uLightColor: UniformSpec('v3[]'),
    dLightCount: DefineSpec('number'),
    // uAmbiantColor: UniformSpec('v3'),
};

const SSGIShaderCode = ShaderCode('ssgi', quad_vert, ssgi_frag);
type renderable = ComputeRenderable<Values<typeof SSGISchema>>


const RandomHemisphereVector: Vec3[] = [];
for (let i = 0; i < 256; i++) {
    const v = Vec3();
    v[0] = Math.random() * 2.0 - 1.0;
    v[1] = Math.random() * 2.0 - 1.0;
    v[2] = Math.random();
    Vec3.normalize(v, v);
    Vec3.scale(v, v, Math.random());
    RandomHemisphereVector.push(v);
}


function getSamples(nSamples: number): number[] {
    const samples = [];
    for (let i = 0; i < nSamples; i++) {
        let scale = (i * i + 2.0 * i + 1) / (nSamples * nSamples);
        scale = 0.1 + scale * (1.0 - 0.1);

        samples.push(RandomHemisphereVector[i][0] * scale);
        samples.push(RandomHemisphereVector[i][1] * scale);
        samples.push(RandomHemisphereVector[i][2] * scale);
    }

    return samples;
}

function getrenderable(ctx: WebGLContext, colorTexture: Texture, depthTexture: Texture): renderable {
    const width = colorTexture.getWidth();
    const height = colorTexture.getHeight();

    const values: Values<typeof SSGISchema> = {
        ...QuadValues,
        tDepth: ValueCell.create(depthTexture),
        tColor: ValueCell.create(colorTexture),
        uTexSize: ValueCell.create(Vec2.create(width, height)),

        uProjection: ValueCell.create(Mat4.identity()),
        uInvProjection: ValueCell.create(Mat4.identity()),
        uBounds: ValueCell.create(Vec4()),

        dOrthographic: ValueCell.create(0),
        uNear: ValueCell.create(1),
        uFar: ValueCell.create(10000),

        uSamples: ValueCell.create(getSamples(8)),
        dNSamples: ValueCell.create(8),
        uIndirectamount: ValueCell.create(3.0),
        uNoiseamount: ValueCell.create(1.0),
        uNoise: ValueCell.create(false),
        uBackground: ValueCell.create(false),
        uGlobalLight: ValueCell.create(false),
        uLightDistance: ValueCell.create(10.0),
        uScale: ValueCell.create(1.0),

        uLightDirection: ValueCell.create([]),
        uLightColor: ValueCell.create([]),
        dLightCount: ValueCell.create(0),

        // uAmbiantColor: ValueCell.create(Vec3()),
    };

    const schema = { ...SSGISchema };
    const renderItem = createComputeRenderItem(ctx, 'triangles', SSGIShaderCode, schema, values);

    return createComputeRenderable(renderItem, values);
}