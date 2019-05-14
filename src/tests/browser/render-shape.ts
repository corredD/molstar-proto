/**
 * Copyright (c) 2019 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */
import { createPlugin, DefaultPluginSpec } from 'mol-plugin';
import './index.html'
import { PluginContext } from 'mol-plugin/context';
import recipe from './HIV-1_0.1.6-8_mixed_radii_pdb.json';//righthand-spheres
import recipe2 from './BloodHIV1.0_mixed_fixed_nc1.json';//leftHand-nosphere
//import { Canvas3D } from 'mol-canvas3d/canvas3d';
//import { MeshBuilder } from 'mol-geo/geometry/mesh/mesh-builder';
//import { Sphere } from 'mol-geo/primitive/sphere';
//import { SpheresBuilder } from 'mol-geo/geometry/spheres/spheres-builder';
//import { Spheres } from 'mol-geo/geometry/spheres/spheres';
import { GaussianSurfaceRepresentationProvider } from 'mol-repr/structure/representation/gaussian-surface';
import CIF, { CifFrame } from 'mol-io/reader/cif'
import { trajectoryFromMmCIF } from 'mol-model-formats/structure/mmcif';
import { Model, Structure, StructureSymmetry, QueryContext, Queries, StructureSelection } from 'mol-model/structure';
import { ColorTheme } from 'mol-theme/color';
import { SizeTheme } from 'mol-theme/size';

import { Mat4, Vec3, Vec4, Quat } from 'mol-math/linear-algebra';
//import { Shape } from 'mol-model/shape';
//import { ShapeRepresentation } from 'mol-repr/shape/representation';
import { ColorNames } from 'mol-util/color/tables';
//import { Mesh } from 'mol-geo/geometry/mesh/mesh';
//import { labelFirst } from 'mol-theme/label';
//import { RuntimeContext } from 'mol-task';
//import { Representation } from 'mol-repr/representation';
//import { MarkerAction } from 'mol-geo/geometry/marker-data';
//import { EveryLoci } from 'mol-model/loci';
import { SymmetryOperator } from 'mol-math/geometry';
import { SpacefillRepresentationProvider } from 'mol-repr/structure/representation/spacefill';
//import { GLRenderingContext } from 'mol-gl/webgl/compat';
import { WebGLContext } from 'mol-gl/webgl/context';
require('mol-plugin/skin/light.scss')


const parent = document.getElementById('app')!
/*const canvas = document.createElement('canvas')
canvas.style.width = '100%'
canvas.style.height = '100%'
parent.appendChild(canvas)
*/

let aplugin: PluginContext = createPlugin(parent, {
    ...DefaultPluginSpec,
    layout: {
        initial: {
            isExpanded: false,
            showControls: false
        }
    }
});

//aplugin.structureRepresentation.themeCtx.colorThemeRegistry.add(StripedResidues.Descriptor.name, StripedResidues.colorTheme!);
//aplugin.lociLabels.addProvider(StripedResidues.labelProvider);
//aplugin.customModelProperties.register(StripedResidues.propertyProvider);
/*
const info = document.createElement('div')
info.style.position = 'absolute'
info.style.fontFamily = 'sans-serif'
info.style.fontSize = '24pt'
info.style.bottom = '20px'
info.style.right = '20px'
info.style.color = 'white'
parent.appendChild(info)

let prevReprLoci = Representation.Loci.Empty
*/
const canvas3d = aplugin.canvas3d;// Canvas3D.create(canvas, parent)
/*canvas3d.animate()
canvas3d.input.move.subscribe(({x, y}) => {
    const pickingId = canvas3d.identify(x, y)
    let label = ''
    if (pickingId) {
        const reprLoci = canvas3d.getLoci(pickingId)
        label = labelFirst(reprLoci.loci)
        if (!Representation.Loci.areEqual(prevReprLoci, reprLoci)) {
            canvas3d.mark(prevReprLoci, MarkerAction.RemoveHighlight)
            canvas3d.mark(reprLoci, MarkerAction.Highlight)
            prevReprLoci = reprLoci
        }
    } else {
        canvas3d.mark({ loci: EveryLoci }, MarkerAction.RemoveHighlight)
        prevReprLoci = Representation.Loci.Empty
    }
    info.innerText = label
})
*/
async function parseCif(data: string|Uint8Array) {
    const comp = CIF.parse(data);
    const parsed = await comp.run();
    if (parsed.isError) throw parsed;
    return parsed.result;
}

async function downloadCif(url: string, isBinary: boolean) {
    const data = await fetch(url);
    return parseCif(isBinary ? new Uint8Array(await data.arrayBuffer()) : await data.text());
}

async function downloadFromPdb(pdb: string) {
    const parsed = await downloadCif(`https://files.rcsb.org/download/${pdb}.cif`, false);
    //const parsed = await downloadCif(`https://webchem.ncbr.muni.cz/ModelServer/static/bcif/${pdb}`, true);
    return parsed.blocks[0];
}

async function getModels(frame: CifFrame) {
    return await trajectoryFromMmCIF(frame).run();
}

async function getStructure(model: Model) {
    return Structure.ofModel(model);
}
const reprCtx = {
    colorThemeRegistry: ColorTheme.createRegistry(),
    sizeThemeRegistry: SizeTheme.createRegistry()
}
function getGaussianSurfaceRepr() {
    return GaussianSurfaceRepresentationProvider.factory(reprCtx, GaussianSurfaceRepresentationProvider.getParams)
}

function randomGeneratorVec3(numpts:number) {
    let points:Vec3[] = [];
    for (let i = 0; i < numpts; i++) {
        points.push(Vec3.create(Math.random(), Math.random(), Math.random()));
    }
    return points;
};

function randomGeneratorRotQuat(numpts:number) {
    let rot:Quat[] = [];
    for (let i = 0; i < numpts; i++) {
        let v = Vec4.create(Math.random(), Math.random(), Math.random(), Math.random());
        Vec4.scale(v,v,1.0/Vec4.norm(v))
        rot.push(Quat.create(v[0],v[1],v[2],v[3]));
    }
    return rot;
};

// The code comes from:
//   https://gist.github.com/bpeck/1889735
// For more info see:
//  http://en.wikipedia.org/wiki/Halton_sequence
function halton(index:number, base:number) {
    let result = 0.0;
    let f = 1.0 / base;
    let i = index;
    while(i > 0.0) {
       result = result + f * (i % base);
       i = Math.floor(i / base);
       f = f / base;
    }
    return result;
};

function haltonGeneratorVec3(numpts:number, basex:number, 
                             basey:number, basez:number, scale:number) {
    // 2, 3 Halton Sequence by default
    if (basex == null)
        basex = 2;
    if (basey == null)
        basey = 3;
    if (basez == null)
        basez = 5;
    var points:Vec3[] = [];
    for (var i = 0; i < numpts; i++) {
        let p:Vec3 = Vec3.create(halton(i,basex), halton(i,basey), halton(i,basez));
        Vec3.scale(p,p,scale);
        points.push(p);
    }
    return points;
};

/**
 * Create a mesh of spheres at given centers
 * - asynchronous (using async/await)
 * - progress tracking (via `ctx.update`)
 * - re-use storage from an existing mesh if given

async function getSphereMesh(ctx: RuntimeContext, centers: number[], radii: number[], mesh?: Mesh) {
    const builderState = MeshBuilder.createState(centers.length * 128, centers.length * 128 / 2, mesh)
    const t = Mat4.identity()
    const v = Vec3.zero()
    builderState.currentGroup = 0
    let sphere = Sphere(1)//spher details.
    for (let i = 0, il = centers.length / 3; i < il; ++i) {
        // for production, calls to update should be guarded by `if (ctx.shouldUpdate)`
        await ctx.update({ current: i, max: il, message: `adding sphere ${i}` })
        builderState.currentGroup = i
        Mat4.setTranslation(t, Vec3.fromArray(v, centers, i * 3))
        Mat4.scaleUniformly(t,t,radii[i]);
        MeshBuilder.addPrimitive(builderState, t, sphere)
    }
    return MeshBuilder.getMesh(builderState)
}
 */
//can this come from any data object
/*const myData = {
    centers: [0, 0, 0, 0, 3, 0, 1, 0 , 4],
    colors: [ColorNames.tomato, ColorNames.springgreen, ColorNames.springgreen],
    labels: ['Sphere 0, Instance A', 'Sphere 1, Instance A', 'Sphere 0, Instance B', 'Sphere 1, Instance B'],
    transforms: [Mat4.identity(), Mat4.fromTranslation(Mat4.zero(), Vec3.create(3, 0, 0))]
}
type MyData = typeof myData
*/
//use recipe to prepare the data object
//legacy format for testing
(window as any).recipe = recipe;
//pick the first ingredient sphereTree and results
let ingr = recipe.compartments.HIV1_envelope_Pack_145_0_2_0.surface.ingredients.HIV1_MA_Hyb_0_1_0;
let nSpheres = ingr.positions[0].length;
let nInstances = ingr.results.length;
let centers = [].concat(...ingr.positions[0]);
//convert position-quaternion to mat4

function quaternion_matrix(quat:Quat)
{
    let q = Vec4.create(quat[0],quat[1],quat[2],quat[3]);
    let n = Vec4.dot(q,q);
    if (n < 0.00001)
    {
          return Mat4.identity();
    }
    Vec4.scale(q,q,2.0 / n);
    let qq = Vec4.outer(q,q);
    let out = Mat4.zero();
    out[0] = 1.0-q[10]-q[15];//2,2 3,3
    out[1] = q[6]-q[12];//1,2 3,0 
    out[2] = q[7]+q[8];//1,3  2,0
    out[3] = 0.0;
    out[4] = q[6]+q[12];
    out[5] = 1.0-q[5]-q[15];//1,1 3,3,
    out[6] = q[11]-q[4];//2,3 1,0
    out[7] = 0.0;
    out[8] = q[7]-q[8];//1,3 2,0
    out[9] = q[11]+q[4];//2,3 1,0
    out[10] = 1.0-q[5]-q[10];//1,1 2,2
    out[11] = 0.0;
    out[12] = 0.0;
    out[13] = 0.0;
    out[14] = 0.0;
    out[15] = 1.0;
    return out;
}

//setTranslation
function getMat(entry:[[number,number,number],[number,number,number,number]]){
  let pos:number[] = entry[0];
  let rot:number[] = entry[1];
  let q:Quat = Quat.create(rot[0],rot[1],rot[2],rot[3]);
  //Quat.invert(q,q);
  //q = Quat.identity();
  let m:Mat4 = Mat4.fromQuat(Mat4.zero(),q);
  //let m:Mat4 = quaternion_matrix(q);  
  Mat4.setTranslation(m, Vec3.create(pos[0], pos[1], pos[2]));
  return m;
}

function getRandomMat(count:number){
    let mats =[];
    for (var i = 0; i < count; i++) {
        let pos = Vec3.create(halton(i,2), halton(i,3), halton(i,5));//0.0?
        //let pos = Vec3.create(Math.random(), Math.random(), Math.random());
        Vec3.scale(pos,pos,1500.0);
        let q = Quat.identity();
        let v = Vec3.create(Math.random(), Math.random(), Math.random());
        Vec3.normalize(v,v);
        let a = Math.random() * Math.PI * 2.0;
        Quat.setAxisAngle(q,v,a);
        let m = Mat4.fromQuat(Mat4.zero(),q);
        Mat4.setTranslation(m, pos);
        mats.push(m);
    }
    return mats;
}

//let transforms:Mat4[] = recipe2.compartments.HIV1_envelope_Pack_145_0_2_0.surface.ingredients.HIV1_MA_Hyb_0_1_0.results.map(getMat);
//use random transforms
let transforms = getRandomMat(1500);

const myData1={
  centers: [].concat(...ingr.positions[0]),
  radii: ingr.radii[0],
  color: ColorNames.blue,
  //labels: ['Sphere 0, Instance A', 'Sphere 1, Instance A', 'Sphere 0, Instance B', 'Sphere 1, Instance B'],
  transforms: transforms
};

let ingr2 = recipe.compartments.HIV1_envelope_Pack_145_0_2_0.surface.ingredients.HIV1_ENV_4nco_0_1_1;
let transforms2 = recipe2.compartments.HIV1_envelope_Pack_145_0_2_0.surface.ingredients.HIV1_ENV_4nco_0_1_1.results.map(getMat);
const myData2={
  centers: [].concat(...ingr2.positions[0]),
  radii: ingr2.radii[0],
  color: ColorNames.red,
  //labels: ['Sphere 0, Instance A', 'Sphere 1, Instance A', 'Sphere 0, Instance B', 'Sphere 1, Instance B'],
  transforms: transforms2
};
let datas = [myData1, myData2];

(window as any).ingr_data = datas;
type MyData = typeof myData1;


/**
 * Get shape from `MyData` object

async function getShapeMesh(ctx: RuntimeContext, data: MyData, props: {}, shape?: Shape<Mesh>) {
    await ctx.update('async creation of mesh shape from  myData')
    const { centers,radii,color, transforms } = data//colors, labels,
    const mesh = await getSphereMesh(ctx, centers,radii, shape && shape.geometry)
    const groupCount = centers.length / 3
    return Shape.create(
        'meshtest', data, mesh,
        (groupId: number) => color,//colors[groupId], // color: per group, same for instances
        () => 1, // size: constant
        (groupId: number, instanceId: number) => "HIV1_MA_Hyb_0_1_0",//labels[instanceId * groupCount + groupId], // label: per group and instance
        transforms
    )
}

function spheresRepr() {
    const spheresBuilder = SpheresBuilder.create(3, 1)
    spheresBuilder.add(0, 0, 0, 0)
    spheresBuilder.add(5, 0, 0, 0)
    spheresBuilder.add(-4, 1, 0, 0)
    const spheres = spheresBuilder.getSpheres()

    const values = Spheres.Utils.createValuesSimple(spheres, {}, Color(0xFF0000), 1)
    const state = Spheres.Utils.createRenderableState({})
    const renderObject = createRenderObject('spheres', values, state, -1)
    console.log(renderObject)
    const repr = Representation.fromRenderObject('spheres', renderObject)
    return repr
}

async function getSphereSpheres(ctx: RuntimeContext, centers: number[],
          radii: number[], spheres?: Spheres)
{
    const builderState = SpheresBuilder.create(centers.length, 1, spheres)
    const t = Mat4.identity()
    const v = Vec3.zero()
    //builderState.currentGroup = 0
    for (let i = 0, il = centers.length / 3; i < il; ++i) {
        // for production, calls to update should be guarded by `if (ctx.shouldUpdate)`
        //let sphere = Sphere(1, radii[i])//spher details.
        builderState.add(centers[i*3], centers[i*3+1], centers[i*3+2], 0)
        await ctx.update({ current: i, max: il, message: `adding sphere ${i}` })
        //builderState.currentGroup = i
        //Mat4.setTranslation(t, Vec3.fromArray(v, centers, i * 3))
        //MeshBuilder.addPrimitive(builderState, t, sphere)
    }
    return builderState.getSpheres();//MeshBuilder.getMesh(builderState)
}

async function getShapeSpheres(ctx: RuntimeContext,
                        data: MyData, props: {},
                        shape?: Shape<Spheres>)
{
    await ctx.update('async creation of spheres from  myData')
    const { centers,radii,color, transforms } = data//colors, labels,
    const spheres = await getSphereSpheres(ctx, centers,radii, shape && shape.geometry)
    const groupCount = centers.length / 3
    return Shape.create(
        'spheretest', data, spheres,
        (groupId: number) => color,//colors[groupId], // color: per group, same for instances
        () => 1, // size: constant
        (groupId: number, instanceId: number) => "HIV1_MA_Hyb_0_1_0",//labels[instanceId * groupCount + groupId], // label: per group and instance
        transforms
    )
}
 */
//canvas3d.add(spheresRepr())

// // Init ShapeRepresentation container
// const reprS = ShapeRepresentation( getShapeSpheres, Spheres.Utils);//getShape, Mesh.Utils)
// const reprM = [ShapeRepresentation( getShapeMesh, Mesh.Utils),
//                ShapeRepresentation( getShapeMesh, Mesh.Utils)];//getShape, Mesh.Utils)

function getSpacefillRepr(webgl?: WebGLContext) {
    return SpacefillRepresentationProvider.factory({ ...reprCtx, webgl }, SpacefillRepresentationProvider.getParams)
}

function multiplyStructure(assembler: Structure.StructureBuilder, structure: Structure, operators: ReadonlyArray<SymmetryOperator>) {
    const { units } = structure;
    for (const oper of operators) {
        for (const unit of units) {
            assembler.addWithOperator(unit, oper);
        }
    }
    return assembler.getStructure();
}

export async function init() {
    const cif = await downloadFromPdb('1aon')
    const models = await getModels(cif)
    const baseStructure = await getStructure(models[0])
    const structure = await StructureSymmetry.buildAssembly(baseStructure, '1').run()
    const query = Queries.internal.atomicSequence();
    const result = query(new QueryContext(structure));
    const polymers = StructureSelection.unionStructure(result);

    // const v = Vec3()
    // const it = new Structure.ElementLocationIterator(polymers)
    // while (it.hasNext) {
    //     const l = it.move()
    //     l.unit.conformation.position(l.element, v)
    //     console.log(Vec3.toString(v))
    // }

    const assembler = Structure.Builder(void 0, void 0);
    const operators: SymmetryOperator[] = []

    //const transforms:Mat4[] = myData1.transforms
    for (let i = 0, il = transforms.length; i < il; ++i) {
        operators.push(SymmetryOperator.create(`${i}`, transforms[i], { id: '', operList: [] }))
    }
    // operators[0] = SymmetryOperator.create('identity', Mat4.identity(), { id: '', operList: [] })
    // operators[1] = SymmetryOperator.create('identity', Mat4.setTranslation(Mat4.identity(), Vec3.create(50, 10, 10)), { id: '', operList: [] })

    multiplyStructure(assembler, polymers, operators)

    const fullStructure = assembler.getStructure();

    // const gaussianSurfaceRepr = getGaussianSurfaceRepr()
    // gaussianSurfaceRepr.setTheme({
    //     color: reprCtx.colorThemeRegistry.create('illustrate', { structure: fullStructure }),
    //     size: reprCtx.sizeThemeRegistry.create('physical', { structure: fullStructure })
    // })
    // console.time('gaussian surface')
    // await gaussianSurfaceRepr.createOrUpdate(
    //       { ...GaussianSurfaceRepresentationProvider.defaultValues,
    //         quality: 'custom', alpha: 1.0, flatShaded: false,
    //          doubleSided: false, resolution: 8.0, radiusOffset: 2 }, fullStructure).run()
    // console.timeEnd('gaussian surface');
    // canvas3d.add(gaussianSurfaceRepr);
    // (window as any).gaussianSurfaceRepr=gaussianSurfaceRepr;

    const spacefillRepr = getSpacefillRepr(canvas3d.webgl)
    spacefillRepr.setTheme({
        color: reprCtx.colorThemeRegistry.create('illustrative', { structure: fullStructure }),
        size: reprCtx.sizeThemeRegistry.create('physical', { structure: fullStructure })
    })
    console.time('spacefill')
    await spacefillRepr.createOrUpdate(
          { ...SpacefillRepresentationProvider.defaultValues,
            alpha: 1.0 }, fullStructure).run()
    console.timeEnd('spacefill')
    canvas3d.add(spacefillRepr);
    console.log(spacefillRepr)

    // // Create shape from myData and add to canvas3d
    // for (let i=0;i<reprM.length;i++){
    //   await reprM[i].createOrUpdate({}, datas[i]).run((p: Progress) => console.log(Progress.format(p)))
    //   canvas3d.add(reprM[i])
    // }
    // await reprS.createOrUpdate({}, myData1).run((p: Progress) => console.log(Progress.format(p)))
    // canvas3d.add(reprS)
    // canvas3d.resetCamera()

    // Change color after 1s
    // setTimeout(async () => {
    //     //myData.colors[0] = ColorNames.darkmagenta
    //     // Calling `createOrUpdate` with `data` will trigger color and transform update
    //     //await reprM[0].createOrUpdate({}, datas[0]).run()
    //     //await reprM[1].createOrUpdate({}, datas[1]).run()
    //     await reprS.createOrUpdate({}, myData1).run()
    // }, 1000)
}

init()
