/**
 * Copyright (c) 2019 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import './index.html'
import recipe from './HIV-1_0.1.6-8_mixed_radii_pdb.json';
import { Canvas3D } from 'mol-canvas3d/canvas3d';
import { MeshBuilder } from 'mol-geo/geometry/mesh/mesh-builder';
import { Sphere } from 'mol-geo/primitive/sphere';
import { SpheresBuilder } from 'mol-geo/geometry/spheres/spheres-builder';
import { Spheres } from 'mol-geo/geometry/spheres/spheres';
import { GaussianSurfaceRepresentationProvider } from 'mol-repr/structure/representation/gaussian-surface';
import CIF, { CifFrame } from 'mol-io/reader/cif'
import { trajectoryFromMmCIF } from 'mol-model-formats/structure/mmcif';
import { Model, Structure } from 'mol-model/structure';
import { ColorTheme } from 'mol-theme/color';
import { SizeTheme } from 'mol-theme/size';


import { Mat4, Vec3, Quat } from 'mol-math/linear-algebra';
import { Shape } from 'mol-model/shape';
import { ShapeRepresentation } from 'mol-repr/shape/representation';
import { ColorNames } from 'mol-util/color/tables';
import { Mesh } from 'mol-geo/geometry/mesh/mesh';
import { labelFirst } from 'mol-theme/label';
import { RuntimeContext, Progress } from 'mol-task';
import { Representation } from 'mol-repr/representation';
import { MarkerAction } from 'mol-geo/geometry/marker-data';
import { EveryLoci } from 'mol-model/loci';

const parent = document.getElementById('app')!
parent.style.width = '100%'
parent.style.height = '100%'

const canvas = document.createElement('canvas')
canvas.style.width = '100%'
canvas.style.height = '100%'
parent.appendChild(canvas)

const info = document.createElement('div')
info.style.position = 'absolute'
info.style.fontFamily = 'sans-serif'
info.style.fontSize = '24pt'
info.style.bottom = '20px'
info.style.right = '20px'
info.style.color = 'white'
parent.appendChild(info)

let prevReprLoci = Representation.Loci.Empty
const canvas3d = Canvas3D.create(canvas, parent)
canvas3d.animate()
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
/**
 * Create a mesh of spheres at given centers
 * - asynchronous (using async/await)
 * - progress tracking (via `ctx.update`)
 * - re-use storage from an existing mesh if given
 */
async function getSphereMesh(ctx: RuntimeContext, centers: number[], radii: number[], mesh?: Mesh) {
    const builderState = MeshBuilder.createState(centers.length * 128, centers.length * 128 / 2, mesh)
    const t = Mat4.identity()
    const v = Vec3.zero()
    builderState.currentGroup = 0
    for (let i = 0, il = centers.length / 3; i < il; ++i) {
        // for production, calls to update should be guarded by `if (ctx.shouldUpdate)`
        let sphere = Sphere(1, radii[i])//spher details.
        await ctx.update({ current: i, max: il, message: `adding sphere ${i}` })
        builderState.currentGroup = i
        Mat4.setTranslation(t, Vec3.fromArray(v, centers, i * 3))
        MeshBuilder.addPrimitive(builderState, t, sphere)
    }
    return MeshBuilder.getMesh(builderState)
}
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
//fromQuat
//setTranslation
function getMat(entry:[[number,number,number],[number,number,number,number]]){
  let pos = entry[0];
  let rot = entry[1];
  let q = Quat.create(rot[0],rot[3],rot[2],rot[1]);
  //Quat.invert(q,q);
  let m = Mat4.fromQuat(Mat4.zero(),q);
  Mat4.setTranslation(m, Vec3.create(pos[0], pos[1], pos[2]));
  return m;
}
let transforms = ingr.results.map(getMat);
const myData={
  centers: centers,
  radii: ingr.radii[0],
  //colors: ColorNames.tomato,
  //labels: ['Sphere 0, Instance A', 'Sphere 1, Instance A', 'Sphere 0, Instance B', 'Sphere 1, Instance B'],
  transforms: transforms
};
(window as any).ingr_data = myData;
type MyData = typeof myData;

/**
 * Get shape from `MyData` object
 */
async function getShapeMesh(ctx: RuntimeContext, data: MyData, props: {}, shape?: Shape<Mesh>) {
    await ctx.update('async creation of shape from  myData')
    const { centers,radii, transforms } = data//colors, labels,
    const mesh = await getSphereMesh(ctx, centers,radii, shape && shape.geometry)
    const groupCount = centers.length / 3
    return Shape.create(
        'test', data, mesh,
        (groupId: number) => ColorNames.tomato,//colors[groupId], // color: per group, same for instances
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
                        shape?: Shape<Spheres>) {
    await ctx.update('async creation of shape from  myData')
    const { centers,radii, transforms } = data//colors, labels,
    const spheres = await getSphereSpheres(ctx, centers,radii, shape && shape.geometry)
    const groupCount = centers.length / 3
    return Shape.create(
        'test', data, spheres,
        (groupId: number) => ColorNames.tomato,//colors[groupId], // color: per group, same for instances
        () => 1, // size: constant
        (groupId: number, instanceId: number) => "HIV1_MA_Hyb_0_1_0",//labels[instanceId * groupCount + groupId], // label: per group and instance
        transforms
    )
}

//canvas3d.add(spheresRepr())

// Init ShapeRepresentation container
const reprS = ShapeRepresentation( getShapeSpheres, Spheres.Utils);//getShape, Mesh.Utils)
const reprM = ShapeRepresentation( getShapeMesh, Mesh.Utils);//getShape, Mesh.Utils)

export async function init() {
    const cif = await downloadFromPdb('1crn')
    const models = await getModels(cif)
    const structure = await getStructure(models[0])
    const gaussianSurfaceRepr = getGaussianSurfaceRepr()
    gaussianSurfaceRepr.setTheme({
        color: reprCtx.colorThemeRegistry.create('secondary-structure', { structure }),
        size: reprCtx.sizeThemeRegistry.create('physical', { structure })
    })
    console.time('gaussian surface')
    await gaussianSurfaceRepr.createOrUpdate(
          { ...GaussianSurfaceRepresentationProvider.defaultValues,
            quality: 'custom', alpha: 1.0, flatShaded: true,
             doubleSided: true, resolution: 0.3 , transforms:myData.transforms}, structure).run()
    console.timeEnd('gaussian surface');
    canvas3d.add(gaussianSurfaceRepr);
    (window as any).gaussianSurfaceRepr=gaussianSurfaceRepr;
    // Create shape from myData and add to canvas3d

    await reprM.createOrUpdate({}, myData).run((p: Progress) => console.log(Progress.format(p)))
    canvas3d.add(reprM)
    await reprS.createOrUpdate({}, myData).run((p: Progress) => console.log(Progress.format(p)))
    canvas3d.add(reprS)
    canvas3d.resetCamera()

    // Change color after 1s
    setTimeout(async () => {
        //myData.colors[0] = ColorNames.darkmagenta
        // Calling `createOrUpdate` with `data` will trigger color and transform update
        await reprM.createOrUpdate({}, myData).run()
        await reprS.createOrUpdate({}, myData).run()
    }, 1000)
}
init()
