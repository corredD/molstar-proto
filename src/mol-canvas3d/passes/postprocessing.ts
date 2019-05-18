/**
 * Copyright (c) 2019 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { QuadSchema, QuadValues } from 'mol-gl/compute/util';
import { RenderableSchema, TextureSpec, Values, UniformSpec, DefineSpec } from 'mol-gl/renderable/schema';
import { ShaderCode } from 'mol-gl/shader-code';
import { WebGLContext } from 'mol-gl/webgl/context';
import { Texture } from 'mol-gl/webgl/texture';
import { ValueCell } from 'mol-util';
import { createComputeRenderItem } from 'mol-gl/webgl/render-item';
import { createComputeRenderable, ComputeRenderable } from 'mol-gl/renderable';
import { Vec2 } from 'mol-math/linear-algebra';
import { ParamDefinition as PD } from 'mol-util/param-definition';
import { createRenderTarget, RenderTarget } from 'mol-gl/webgl/render-target';
import { DrawPass } from './draw';

//RenderableValues
export interface OptionParam
{
  key: string;
  toggle?: boolean;
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  stype: string;
  vtype: string;
}

export const ParamsMapping: {[key:string]:OptionParam}  = {
    //SSAO
    //"ssao_noise":         { key: "dssao_noise",   toggle: false, stype:"DefineSpec", vtype:"boolean"},//[0,0,1,"int"],
    "ssaoEnable": { key: "dSSAOEnable", toggle: false,stype:"DefineSpec",vtype:"boolean"},//"dSSAOEnable",
    "ssao_scale":         { key: "ussao_scale",   toggle: false,min: 1, max: 100, step: 1, stype:"UniformSpec",vtype:"f"},//[0,0,1,"int"],
    "ssao_samples":       { key: "dssao_samples", value: 6,    min: 1, max: 20,  step: 1, stype:"DefineSpec", vtype:"number"},//[0,0,1,"int"],
    "ssao_rings":         { key: "dssao_rings",   value: 6,    min: 1, max: 20,  step: 1, stype:"DefineSpec", vtype:"number"},//[6,1,8,"int"],
    "ssao_aoCap":         { key: "ussao_aoCap",   value: 1.2,  min: 0.0, max: 10.0,  step: 0.1, stype:"UniformSpec", vtype:"f"},//[1.2,0.0,10.0,"float"],
    "ssao_aoMultiplier":  { key: "ussao_aoMultiplier",   value: 200.0,  min: 1.0, max: 500.0,  step: 1.0, stype:"UniformSpec", vtype:"f"},
    "ssao_depthTolerance":{ key: "ussao_depthTolerance",   value: 0.0,  min: 0.0, max: 1.0,  step: 0.01, stype:"UniformSpec", vtype:"f"},//[0.0,0.0,1.0,"float"],
    "ssao_aorange":       { key: "ussao_aorange",   value: 60.0,  min: 1.0, max: 500.0,  step: 1.0, stype:"UniformSpec", vtype:"f"},//[0.0,0.0,1.0,"float"],
    "ssao_negative":      { key: "dssao_negative",   toggle: false, stype:"DefineSpec", vtype:"boolean"},
    //HASH
    "hashEnable": { key: "dHashEnable", toggle: false,stype:"DefineSpec",vtype:"boolean"},//"dHashEnable",
    "back_intensity": { key: "back_intensity",  value: 1.0,  min: 0.0, max: 1.0,  step: 0.1, stype:"UniformSpec", vtype:"f"},//[0.0,0.0,1.0,"float"],
    "line_intensity": { key: "line_intensity",  value: 0.0,  min: 0.0, max: 1.0,  step: 0.1, stype:"UniformSpec", vtype:"f"},//[0.0,0.0,1.0,"float"],
    "c_limit": { key: "c_limit",  value: 0.6,  min: 0.0, max: 1.0,  step: 0.1, stype:"UniformSpec", vtype:"f"},//[0.6,0.0,1.0,"float"],
    "c_spacing": { key: "c_spacing",  value: 2.0,  min: 0.0, max: 100.0,  step: 1, stype:"UniformSpec", vtype:"f"},//[2.0,0.0,100.0,"float"],
    "c_width": { key: "c_width",  value: 10.0,  min: 0.0, max: 100.0,  step: 1, stype:"UniformSpec", vtype:"f"},//[10.0,0.0,100.0,"float"],
    "s_spacing": { key: "s_spacing",  value: 6.0,  min: 0.0, max: 10.0,  step: 1, stype:"UniformSpec", vtype:"f"},//[6.0,0.0,10.0,"float"],
    "s_width": { key: "s_width",  value: 1.0,  min: 0.0, max: 100.0,  step: 1, stype:"UniformSpec", vtype:"f"},//[1.0,0.0,100.0,"float"],
    "d_spacing": { key: "d_spacing",  value: 4.0,  min: 0.0, max: 10.0,  step: 1, stype:"UniformSpec", vtype:"f"},//[4.0,0.0,10.0,"float"],
    "d_width_high": { key: "d_width_high",  value: 0.0,  min: 0.0, max: 1.0,  step: 0.1, stype:"UniformSpec", vtype:"f"},//[0.0,0.0,1.0,"float"],
    "d_width_low":{ key: "d_width_low",  value: 0.0,  min: 0.0, max: 10.0,  step: 1, stype:"UniformSpec", vtype:"f"},// [0.0,0.0,10.0,"float"],
    "g_low": { key: "g_low",  value: 16000.0,  min: 0.0, max: 10000000.0,  step: 500, stype:"UniformSpec", vtype:"f"},//[16000.0,0.0,1000000.0,"float"],
    "g_hight": { key: "g_hight",  value: 17000.0,  min: 0.0, max: 10000000.0,  step: 500, stype:"UniformSpec", vtype:"f"},//[17000.0,0.0,1000000.0,"float"],
    "l_low": { key: "l_low",  value: 5000.0,  min: 0.0, max: 10000000.0,  step: 1000, stype:"UniformSpec", vtype:"f"},//[5000.0,0.0,1000000.0,"float"],
    "l_hight": { key: "l_hight",  value: 10000.0,  min: 0.0, max: 10000000.0,  step: 1000, stype:"UniformSpec", vtype:"f"},//[10000.0,0.0,1000000.0,"float"],
    "d_width_spread": { key: "d_width_spread",  value: 1.0,  min: 0.0, max: 100.0,  step: 1, stype:"UniformSpec", vtype:"f"},//[1.0,0.0,100.0,"float"],
    "zl_max": { key: "zl_max",  value: 0.0,  min: 0.0, max: 1.0,  step: 0.1, stype:"UniformSpec", vtype:"f"},//[0.0,0.0,1.0,"float"],
    "zl_min": { key: "zl_min",  value: 0.0,  min: 0.0, max: 1.0,  step: 0.1, stype:"UniformSpec", vtype:"f"},//[0.0,0.0,1.0,"float"],
    //OCCLUSION
    "occlusionEnable": { key: "dOcclusionEnable",   toggle: false, stype:"DefineSpec", vtype:"boolean"},//"dOcclusionEnable",
    "occlusionKernelSize": { key: "dOcclusionKernelSize", value: 4,    min: 1, max: 100,  step: 1, stype:"DefineSpec", vtype:"number"},//"dOcclusionKernelSize",
    "occlusionBias": { key: "uOcclusionBias",   value: 0.5,min: 0, max: 1, step:0.01, stype:"UniformSpec",vtype:"f"},//"uOcclusionBias",
    "occlusionRadius": { key: "uOcclusionRadius",   value: 64,min: 0, max: 256, step:1, stype:"UniformSpec",vtype:"f"},//"uOcclusionRadius",
  
    //OUTLINE
    "outlineEnable": { key: "dOutlineEnable",   toggle: false, stype:"DefineSpec", vtype:"boolean"},//"dOutlineEnable",
    "outlineScale": { key: "uOutlineScale",   value: 1,min: 0, max: 10, step:1, stype:"UniformSpec",vtype:"f"},//"uOutlineScale",
    "outlineThreshold": { key: "uOutlineThreshold",   value: 0.8,min: 0, max: 1, step:0.01, stype:"UniformSpec",vtype:"f"},//"uOutlineThreshold",
  }
  
let tempSchem: RenderableSchema = {
    ...QuadSchema,
    tColor: TextureSpec('texture', 'rgba', 'ubyte', 'nearest'),
    tDepth: TextureSpec('texture', 'rgba', 'ubyte', 'nearest'),
    uTexSize: UniformSpec('v2'),
    dPackedDepth: DefineSpec('boolean'),
  };
  let tempParam:PD.Params = {};
  for (let param in ParamsMapping) {
      let aparam:OptionParam = ParamsMapping[param];
      let key = aparam.key;
      if (aparam.vtype == "boolean"){
          if (aparam.stype == "DefineSpec"){
                tempSchem[key]= DefineSpec('boolean');
          }
          let t:boolean = (aparam.toggle)?aparam.toggle:false;
          tempParam[param]=PD.Boolean(t);
      }
      else if (aparam.vtype == "f"){
        if (aparam.stype == "DefineSpec"){
          tempSchem[key]= DefineSpec('number');
        }
        else if (aparam.stype == "UniformSpec"){
          tempSchem[key]= UniformSpec('f');
        }
        let v = (aparam.value)?aparam.value:0;
        tempParam[param]=PD.Numeric(v,
              { min:aparam.min, max: aparam.max, step: aparam.step });
      }
      else if (aparam.vtype == "number"){
        if (aparam.stype == "DefineSpec"){
          tempSchem[key]= DefineSpec('number');
        }
        else if (aparam.stype == "UniformSpec"){
          tempSchem[key]= UniformSpec('f');
        }
        let v = (aparam.value)?aparam.value:0;
        tempParam[param]=PD.Numeric(v,
              { min:aparam.min, max: aparam.max, step: aparam.step });
      }
  }
//const PostprocessingSchema: RenderableSchema = tempSchem;
const PostprocessingSchema: RenderableSchema = tempSchem;
export const PostprocessingParams:PD.Params = tempParam;

export type PostprocessingProps = PD.Values<typeof PostprocessingParams>

type PostprocessingRenderable = ComputeRenderable<Values<typeof PostprocessingSchema>>

function getPostprocessingRenderable(ctx: WebGLContext, colorTexture: Texture, depthTexture: Texture, packedDepth: boolean, props: Partial<PostprocessingProps>): PostprocessingRenderable {
    const p:PostprocessingProps = { ...PD.getDefaultValues(PostprocessingParams), ...props }
    const values: Values<typeof PostprocessingSchema> = {
        ...QuadValues,
        tColor: ValueCell.create(colorTexture),
        tDepth: ValueCell.create(depthTexture),
        uTexSize: ValueCell.create(Vec2.create(colorTexture.width, colorTexture.height)),
        dPackedDepth: ValueCell.create(packedDepth),
    }
    for (let param in ParamsMapping) {
        let key = ParamsMapping[param].key;
        values[key] = ValueCell.create(p[param]);
      }
      
    const schema = { ...PostprocessingSchema }
    const shaderCode = ShaderCode(
        require('mol-gl/shader/quad.vert').default,
        require('mol-gl/shader/postprocessing.frag').default
    )
    const renderItem = createComputeRenderItem(ctx, 'triangles', shaderCode, schema, values)

    return createComputeRenderable(renderItem, values)
}

export class PostprocessingPass {
    target: RenderTarget
    props: PostprocessingProps
    renderable: PostprocessingRenderable

    constructor(private webgl: WebGLContext, drawPass: DrawPass, props: Partial<PostprocessingProps>) {
        const { gl } = webgl
        this.target = createRenderTarget(webgl, gl.drawingBufferWidth, gl.drawingBufferHeight)
        this.props = { ...PD.getDefaultValues(PostprocessingParams), ...props }
        const { colorTarget, depthTexture, packedDepth } = drawPass
        this.renderable = getPostprocessingRenderable(webgl, colorTarget.texture, depthTexture, packedDepth, this.props)
    }

    get enabled() {
        return this.props.occlusionEnable || this.props.outlineEnable || this.props.ssaoEnable || this.props.hashEnable;
    }

    setSize(width: number, height: number) {
        this.target.setSize(width, height)
        ValueCell.update(this.renderable.values.uTexSize, Vec2.set(this.renderable.values.uTexSize.ref.value, width, height))
    }

    setProps(props: Partial<PostprocessingProps>) {
        for (const param in PostprocessingParams) {
            const key = ParamsMapping[param.toString()].key;
            if (props[param] !== undefined)
            {
                this.props[param] = props[param];
                if (key=="outlineScale") 
                    ValueCell.update(this.renderable.values[key], props[param] * this.webgl.pixelRatio);
                else 
                    ValueCell.update(this.renderable.values[key], props[param]);
            }
        }
        this.renderable.update()
    }

    render(toDrawingBuffer: boolean) {
        const { gl, state } = this.webgl
        if (toDrawingBuffer) {
            this.webgl.unbindFramebuffer()
            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
        } else {
            this.target.bind()
        }
        state.disable(gl.SCISSOR_TEST)
        state.disable(gl.BLEND)
        state.disable(gl.DEPTH_TEST)
        state.depthMask(false)
        this.renderable.render()
    }
}