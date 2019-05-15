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
import rna from './rna_allpoints.json';

//import { Canvas3D } from 'mol-canvas3d/canvas3d';
//import { MeshBuilder } from 'mol-geo/geometry/mesh/mesh-builder';
//import { Sphere } from 'mol-geo/primitive/sphere';
//import { SpheresBuilder } from 'mol-geo/geometry/spheres/spheres-builder';
//import { Spheres } from 'mol-geo/geometry/spheres/spheres';
import { GaussianSurfaceRepresentationProvider } from 'mol-repr/structure/representation/gaussian-surface';
import CIF, { CifFrame } from 'mol-io/reader/cif'
import { parsePDB } from 'mol-io/reader/pdb/parser'
import { trajectoryFromMmCIF } from 'mol-model-formats/structure/mmcif';
import { trajectoryFromPDB } from 'mol-model-formats/structure/pdb';
import { Model, Structure, StructureSymmetry, QueryContext, Queries, StructureSelection } from 'mol-model/structure';
import { ColorTheme } from 'mol-theme/color';
import { SizeTheme } from 'mol-theme/size';

import './index.html'
import { Canvas3D } from 'mol-canvas3d/canvas3d';
import { MeshBuilder } from 'mol-geo/geometry/mesh/mesh-builder';
import { Sphere } from 'mol-geo/primitive/sphere';
import { Mat4, Vec3 } from 'mol-math/linear-algebra';
import { Shape } from 'mol-model/shape';
import { ShapeRepresentation } from 'mol-repr/shape/representation';
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
import { PdbFile } from 'mol-io/reader/pdb/schema';
require('mol-plugin/skin/dark.scss');


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
*/
async function parseCif(data: string|Uint8Array) {
    const comp = CIF.parse(data);
    const parsed = await comp.run();
    if (parsed.isError) throw parsed;
    return parsed.result;
}

async function parsePDBfile(data: string) {
    const comp = parsePDB(data);
    const parsed = await comp.run();
    if (parsed.isError) throw parsed;
    return parsed.result;
}


async function downloadCif(url: string, isBinary: boolean) {
    const data = await fetch(url);
    return parseCif(isBinary ? new Uint8Array(await data.arrayBuffer()) : await data.text());
}

async function downloadPDB(url: string) {
    const data = await fetch(url);
    return parsePDBfile(await data.text());
}

async function downloadFromPdb(pdb: string) {
    const parsed = await downloadCif(`https://files.rcsb.org/download/${pdb}.cif`, false);
    //const parsed = await downloadCif(`https://webchem.ncbr.muni.cz/ModelServer/static/bcif/${pdb}`, true);
    return parsed.blocks[0];
}

async function downloadFromPdbCellpack(pdb: string) {
    const url = `https://cdn.jsdelivr.net/gh/mesoscope/cellPACK_data@master/cellPACK_database_1.1.0/other/${pdb}`;
    const parsed:PdbFile = await downloadPDB(url);
    return parsed;
}

async function getModelsCif(frame: CifFrame) {
    return await trajectoryFromMmCIF(frame).run();
}

async function getModelsPDB(pdbfile: PdbFile) {
    return await trajectoryFromPDB(pdbfile).run();
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
 */
async function getSphereMesh(ctx: RuntimeContext, centers: number[], mesh?: Mesh) {
    const builderState = MeshBuilder.createState(centers.length * 128, centers.length * 128 / 2, mesh)
    const t = Mat4.identity()
    const v = Vec3.zero()
    const sphere = Sphere(3)
    builderState.currentGroup = 0
    for (let i = 0, il = centers.length / 3; i < il; ++i) {
        // for production, calls to update should be guarded by `if (ctx.shouldUpdate)`
        await ctx.update({ current: i, max: il, message: `adding sphere ${i}` })
        builderState.currentGroup = i
        Mat4.setTranslation(t, Vec3.fromArray(v, centers, i * 3))
        MeshBuilder.addPrimitive(builderState, t, sphere)
    }
    return MeshBuilder.getMesh(builderState)
}

const myData = {
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
(window as any).recipe2 = recipe2;
//pick the first ingredient sphereTree and results
let ingr = recipe.compartments.HIV1_envelope_Pack_145_0_2_0.surface.ingredients.HIV1_MA_Hyb_0_1_0;
let nSpheres = ingr.positions[0].length;
let nInstances = ingr.results.length;
let centers = [].concat(...ingr.positions[0]);


//setTranslation
function getMat(entry:[[number,number,number],[number,number,number,number]]){
  let pos:number[] = entry[0];
  let rot:number[] = entry[1];
  let q:Quat = Quat.create(-rot[3],rot[0],rot[1],rot[2]);
  //let q:Quat = Quat.create(rot[0],rot[1],rot[2],rot[3]);
  //Quat.invert(q,q);
  //q = Quat.identity();
  let m:Mat4 = Mat4.fromQuat(Mat4.zero(),q);
  Mat4.transpose(m,m);
  Mat4.scale(m,m,Vec3.create(-1.0,1.0,-1.0));
  //let m:Mat4 =  Mat4.quaternion_matrix(Mat4.zero(),q);  
  Mat4.setTranslation(m, Vec3.create(pos[0], pos[1], pos[2]));
  return m;
}

function getMatFromPoints(points:number[]){
    const npoints = points.length/3;
    let transforms:Mat4[]=[];
    for (let i=0; i<npoints-1; i++){
        //rotation to align cylinder to pt1->pt2
        //position is the middle point
        const pti:Vec3= Vec3.create(points[i*3],points[i*3+1],points[i*3+2]);
        const pti1:Vec3= Vec3.create(points[(i+1)*3],points[(i+1)*3+1],points[(i+1)*3+2]);
        const direction:Vec3 = Vec3.sub(Vec3.zero(),pti1,pti);
        direction = Vec3.normalize(direction,direction);
        const quat:Quat = Quat.rotationTo(Quat.zero(), Vec3.create(0,0,1),direction);
        let m:Mat4 = Mat4.fromQuat(Mat4.zero(),quat);
        let pos:Vec3 = Vec3.add(Vec3.zero(),pti1,pti)
        pos = Vec3.scale(pos,pos,1.0/2.0);
        Mat4.setTranslation(m, Vec3.create(pos[0], pos[1], pos[2]));
        transforms.push(m);
    }
    return transforms;
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

let transforms:Mat4[] = recipe2.compartments.HIV1_envelope_Pack_145_0_2_0.surface.ingredients.HIV1_MA_Hyb_0_1_0.results.map(getMat);
//use random transforms
//let transforms = getRandomMat(15);

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
let pdbs:string[] = [ingr.source.pdb, ingr2.source.pdb];
(window as any).ingr_data = datas;
type MyData = typeof myData1;


/**
 * Get shape from `MyData` object
 */
async function getShape(ctx: RuntimeContext, data: MyData, props: {}, shape?: Shape<Mesh>) {
    await ctx.update('async creation of shape from  myData')
    const { centers, colors, labels, transforms } = data
    const mesh = await getSphereMesh(ctx, centers, shape && shape.geometry)
    const groupCount = centers.length / 3
    return Shape.create(
        'test', data, mesh,
        (groupId: number) => colors[groupId], // color: per group, same for instances
        () => 1, // size: constant
        (groupId: number, instanceId: number) => labels[instanceId * groupCount + groupId], // label: per group and instance
        transforms
    )
}

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

// Init ShapeRepresentation container
const repr = ShapeRepresentation(getShape, Mesh.Utils)

async function getOnePDB(pdbname:string, bu:number){
    let models;
    if (pdbname.length == 4) {
        const cif = await downloadFromPdb(pdbname)
        models = await getModelsCif(cif)
    }
    else {
        const pdb = await downloadFromPdbCellpack(pdbname)
        models = await getModelsPDB(pdb)
    }
    const baseStructure = await getStructure(models[0])
    let structure:Structure = baseStructure;
    if (bu !==-1)
    {
            structure = await StructureSymmetry.buildAssembly(baseStructure, '1').run()
    }
    const query = Queries.internal.atomicSequence();
    const result = query(new QueryContext(structure));
    return StructureSelection.unionStructure(result);   
}

function Assamble(instances_transform:Mat4[], polymers:Structure){
    const assembler = Structure.Builder(void 0, void 0);
    const operators: SymmetryOperator[] = []

    //const transforms:Mat4[] = myData1.transforms
    for (let i = 0, il = instances_transform.length; i < il; ++i) {
        operators.push(SymmetryOperator.create(`${i}`, instances_transform[i], { id: '', operList: [] }))
    }
    multiplyStructure(assembler, polymers, operators)
    return assembler.getStructure();
}


export async function init() {
    const showAtoms = true;
    const showSurface = false;

    /*const cif = await downloadFromPdb('1aon')
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
    */
   //loop over the recipe
   //let transforms:Mat4[] = recipe2.compartments.HIV1_envelope_Pack_145_0_2_0.surface.ingredients.HIV1_MA_Hyb_0_1_0.results.map(getMat);
   const theme:string ='chain-id';//'illustrative'
   const surface_resolution:number = 4.0;
   type ingData = typeof recipe2.compartments.HIV1_envelope_Pack_145_0_2_0.surface.ingredients.HIV1_MA_Hyb_0_1_0;

   for (const ingr_name in recipe2.cytoplasme.ingredients){
            continue;
            const ingr:ingData = recipe2.cytoplasme.ingredients[ingr_name];
            if (ingr == undefined) {
                console.log("undefined "+ingr_name);
                continue;
            }
            const pdbname:string = ingr.source.pdb;
            if (!pdbname||pdbname == "None") continue;
            const instances:Mat4[] =  ingr.results.map(getMat);
            const bu = ("biomt" in ingr.source)? 1:-1;
            const polymers:Structure = await getOnePDB(pdbname,bu);//should also consider chains and modelnb
            const fullStructure:Structure  = Assamble(instances,polymers);
            if (showAtoms){
                    const spacefillRepr = getSpacefillRepr(canvas3d.webgl)
                    spacefillRepr.setTheme({
                        color: reprCtx.colorThemeRegistry.create(theme, { structure: fullStructure }),
                        size: reprCtx.sizeThemeRegistry.create('physical', { structure: fullStructure })
                    })
                    console.time('spacefill')
                    await spacefillRepr.createOrUpdate(
                        { ...SpacefillRepresentationProvider.defaultValues,
                            alpha: 1.0 }, fullStructure).run()
                    console.timeEnd('spacefill')
                    canvas3d.add(spacefillRepr);
                    console.log(spacefillRepr)
             }
             if (showSurface) {
                const gaussianSurfaceRepr = getGaussianSurfaceRepr()
                gaussianSurfaceRepr.setTheme({
                     color: reprCtx.colorThemeRegistry.create(theme, { structure: fullStructure }),
                     size: reprCtx.sizeThemeRegistry.create('physical', { structure: fullStructure })
                })
                console.time('gaussian surface')
                await gaussianSurfaceRepr.createOrUpdate(
                       { ...GaussianSurfaceRepresentationProvider.defaultValues,
                         quality: 'custom', alpha: 1.0, flatShaded: false,
                         doubleSided: false, resolution: surface_resolution, radiusOffset: 2 }, fullStructure).run()
                 console.timeEnd('gaussian surface');
                 canvas3d.add(gaussianSurfaceRepr);
             }
   }    
   for (const comp in recipe2.compartments){
        console.log(comp);
        if ("surface" in recipe2.compartments[comp]){

            for (const ingr_name in recipe2.compartments[comp].surface.ingredients){
                const ingr = recipe2.compartments[comp].surface.ingredients[ingr_name];
                if (ingr == undefined) {
                    console.log(ingr_name)
                    continue;
                }
                const pdbname:string = ingr.source.pdb;
                if (!pdbname||pdbname == "None") continue;
                const instances:Mat4[] =  ingr.results.map(getMat);
                const bu = ("biomt" in ingr.source)? 1:-1;
                const polymers:Structure = await getOnePDB(pdbname,bu);//should also consider chains and modelnb
                const fullStructure:Structure  = Assamble(instances,polymers);
                if (showAtoms){
                    const spacefillRepr = getSpacefillRepr(canvas3d.webgl)
                    spacefillRepr.setTheme({
                        color: reprCtx.colorThemeRegistry.create(theme, { structure: fullStructure }),
                        size: reprCtx.sizeThemeRegistry.create('physical', { structure: fullStructure })
                    })
                    console.time('spacefill')
                    await spacefillRepr.createOrUpdate(
                        { ...SpacefillRepresentationProvider.defaultValues,
                            alpha: 1.0 }, fullStructure).run()
                    console.timeEnd('spacefill')
                    canvas3d.add(spacefillRepr);
                    console.log(spacefillRepr)
            }
                if (showSurface) {
                    const gaussianSurfaceRepr = getGaussianSurfaceRepr()
                    gaussianSurfaceRepr.setTheme({
                        color: reprCtx.colorThemeRegistry.create(theme, { structure: fullStructure  }),
                        size: reprCtx.sizeThemeRegistry.create('physical', { structure: fullStructure })
                    })
                    console.time('gaussian surface')
                    await gaussianSurfaceRepr.createOrUpdate(
                        { ...GaussianSurfaceRepresentationProvider.defaultValues,
                            quality: 'custom', alpha: 1.0, flatShaded: false,
                            doubleSided: false, resolution: surface_resolution, radiusOffset: 2 }, fullStructure).run()
                    console.timeEnd('gaussian surface');
                    canvas3d.add(gaussianSurfaceRepr);
                }
            }    
        }
        if ("interior" in recipe2.compartments[comp]){
            continue
            for (const ingr_name in recipe2.compartments[comp].interior.ingredients){
                if (ingr_name =="HIV1_CAhex_0_1_0")continue;
                if (ingr_name =="HIV1_CAhexCyclophilA_0_1_0")continue;
                const ingr = recipe2.compartments[comp].interior.ingredients[ingr_name];
                if (ingr == undefined) {
                    console.log(ingr_name)
                    continue;
                }
                const pdbname:string = ingr.source.pdb;
                if (!pdbname||pdbname == "None") continue;
                const instances:Mat4[] =  ingr.results.map(getMat);
                const bu = ("biomt" in ingr.source)? 1:-1;
                const polymers:Structure = await getOnePDB(pdbname,bu);//should also consider chains and modelnb
                const fullStructure:Structure  = Assamble(instances,polymers);
                if (showAtoms){
                    const spacefillRepr = getSpacefillRepr(canvas3d.webgl)
                    spacefillRepr.setTheme({
                        color: reprCtx.colorThemeRegistry.create(theme, { structure: fullStructure }),
                        size: reprCtx.sizeThemeRegistry.create('physical', { structure: fullStructure })
                    })
                    console.time('spacefill')
                    await spacefillRepr.createOrUpdate(
                        { ...SpacefillRepresentationProvider.defaultValues,
                            alpha: 1.0 }, fullStructure).run()
                    console.timeEnd('spacefill')
                    canvas3d.add(spacefillRepr);
                    console.log(spacefillRepr)
                 }
                if (showSurface) {
                    const gaussianSurfaceRepr = getGaussianSurfaceRepr()
                    gaussianSurfaceRepr.setTheme({
                        color: reprCtx.colorThemeRegistry.create(theme, { structure: fullStructure }),
                        size: reprCtx.sizeThemeRegistry.create('physical', { structure: fullStructure })
                    })
                    console.time('gaussian surface')
                    await gaussianSurfaceRepr.createOrUpdate(
                        { ...GaussianSurfaceRepresentationProvider.defaultValues,
                            quality: 'custom', alpha: 1.0, flatShaded: false,
                            doubleSided: false, resolution: surface_resolution, radiusOffset: 2 }, fullStructure).run()
                    console.timeEnd('gaussian surface');
                    canvas3d.add(gaussianSurfaceRepr);
                }
            }    
        }
   }
   //rna points -> one turn singe strand ?
   //rotation should be pt0->pt1
   
   const pdbname:string = "DNA_oneTurn.pdb";
   const instances:Mat4[] =  getMatFromPoints(rna.points);
   const bu = -1;
   const polymers:Structure = await getOnePDB(pdbname,bu);//should also consider chains and modelnb
   const fullStructure:Structure  = Assamble(instances,polymers);
   if (showAtoms){
           const spacefillRepr = getSpacefillRepr(canvas3d.webgl)
           spacefillRepr.setTheme({
               color: reprCtx.colorThemeRegistry.create(theme, { structure: fullStructure }),
               size: reprCtx.sizeThemeRegistry.create('physical', { structure: fullStructure })
           })
           console.time('spacefill')
           await spacefillRepr.createOrUpdate(
               { ...SpacefillRepresentationProvider.defaultValues,
                   alpha: 1.0 }, fullStructure).run()
           console.timeEnd('spacefill')
           canvas3d.add(spacefillRepr);
           console.log(spacefillRepr)
    }
    if (showSurface) {
       const gaussianSurfaceRepr = getGaussianSurfaceRepr()
       gaussianSurfaceRepr.setTheme({
            color: reprCtx.colorThemeRegistry.create(theme, { structure: fullStructure }),
            size: reprCtx.sizeThemeRegistry.create('physical', { structure: fullStructure })
       })
       console.time('gaussian surface')
       await gaussianSurfaceRepr.createOrUpdate(
              { ...GaussianSurfaceRepresentationProvider.defaultValues,
                quality: 'custom', alpha: 1.0, flatShaded: false,
                doubleSided: false, resolution: surface_resolution, radiusOffset: 2 }, fullStructure).run()
        console.timeEnd('gaussian surface');
        canvas3d.add(gaussianSurfaceRepr);
    }

   /*for (let i=0;i< datas.length;i++) 
   {
        const polymers:Structure = await getOnePDB(pdbs[i],-1);//should also consider chains and modelnb
        const fullStructure:Structure  = Assamble(datas[i].transforms,polymers);
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
   }*/
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

    // // Create shape from myData and add to canvas3d
    // for (let i=0;i<reprM.length;i++){
    //   await reprM[i].createOrUpdate({}, datas[i]).run((p: Progress) => console.log(Progress.format(p)))
    //   canvas3d.add(reprM[i])
    // }
    // await reprS.createOrUpdate({}, myData1).run((p: Progress) => console.log(Progress.format(p)))
    // canvas3d.add(reprS)
    // canvas3d.resetCamera()

    // Change color after 1s
    setTimeout(async () => {
        myData.colors[0] = ColorNames.darkmagenta
        // Calling `createOrUpdate` with `data` will trigger color and transform update
        await repr.createOrUpdate({}, myData).run()
    }, 1000)
}
init()