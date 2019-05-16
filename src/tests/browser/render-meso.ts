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

import { GaussianSurfaceRepresentationProvider } from 'mol-repr/structure/representation/gaussian-surface';
import CIF, { CifFrame } from 'mol-io/reader/cif'
import { parsePDB } from 'mol-io/reader/pdb/parser'
import { trajectoryFromMmCIF } from 'mol-model-formats/structure/mmcif';
import { trajectoryFromPDB } from 'mol-model-formats/structure/pdb';
import { Model, Structure, StructureSymmetry, QueryContext, Queries, StructureSelection } from 'mol-model/structure';
import { ColorTheme } from 'mol-theme/color';
import { SizeTheme } from 'mol-theme/size';

import { Quat, Mat4, Vec3, Vec4 } from 'mol-math/linear-algebra';
import { Shape } from 'mol-model/shape';
import { ShapeRepresentation } from 'mol-repr/shape/representation';
import { ColorNames } from 'mol-util/color/tables';
import { SymmetryOperator } from 'mol-math/geometry';
import { SpacefillRepresentationProvider } from 'mol-repr/structure/representation/spacefill';
import { WebGLContext } from 'mol-gl/webgl/context';
import { PdbFile } from 'mol-io/reader/pdb/schema';
import { Color } from 'mol-util/color';
import { ColorNames } from 'mol-util/color/tables';
require('mol-plugin/skin/dark.scss');

const parent = document.getElementById('app')!
let aplugin: PluginContext = createPlugin(parent, {
    ...DefaultPluginSpec,
    layout: {
        initial: {
            isExpanded: false,
            showControls: false
        }
    }
}); 
const canvas3d = aplugin.canvas3d;// Canvas3D.create(canvas, parent)

declare var paletteGenerator: any;

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

function GetNColors(ncolor:number){
    // Generate colors (as Chroma.js objects)
    let colors_palette = paletteGenerator.generate(
        ncolor, // Colors
        function(color){ // This function filters valid colors
        var hcl = color.hcl();
        return hcl[0]>=0 && hcl[0]<=360
            && hcl[1]>=30 && hcl[1]<=80
            && hcl[2]>=15 && hcl[2]<=85;//color blind friendly
        },
        false, // Using Force Vector instead of k-Means
        50, // Steps (quality)
        false, // Ultra precision
        'Default' // Color distance type (colorblindness)
    );
    // Sort colors by differenciation first
    return paletteGenerator.diffSort(colors_palette, 'Default');
}

function GenerateOneColorRangePalette(rgb:any,ncolors:number){
    // Generate colors (as Chroma.js objects)
    var hcl = rgb._rgb;//chroma.rgb(rgb[0],rgb[1],rgb[2]).hcl();
    var start = hcl[0]-35;
    var end = hcl[0]+35;
    var colors = paletteGenerator.generate(
      ncolors, // Colors
      function(color){ // This function filters valid colors
        var hcl = color.hcl();
        return hcl[0]>=start && hcl[0]<=end
          && hcl[1]>=0 && hcl[1]<=100//38.82
          && hcl[2]>=30 && hcl[2]<=100;//38.04
      },
      false, // Using Force Vector instead of k-Means
      50, // Steps (quality)
      false, // Ultra precision
      'Default' // Color distance type (colorblindness)
    );
    // Sort colors by differenciation first
    return paletteGenerator.diffSort(colors, 'Default');
  }
  
let transforms:Mat4[] = recipe2.compartments.HIV1_envelope_Pack_145_0_2_0.surface.ingredients.HIV1_MA_Hyb_0_1_0.results.map(getMat);
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
type Compartment = typeof recipe.compartments.HIV1_envelope_Pack_145_0_2_0.surface;
type Ingredient = typeof recipe.compartments.HIV1_envelope_Pack_145_0_2_0.surface.ingredients.HIV1_ENV_4nco_0_1_1;

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
const showAtoms = false;
const showSurface = true;
const surface_resolution:number = 10.0;//can this be change dynamically?

const theme:string ='uniform';//'illustrative'
   
async function displayAtomOne(fullStructure:structure, colorTheme:ColorTheme){
    const spacefillRepr = getSpacefillRepr(canvas3d.webgl)
    spacefillRepr.setTheme({
        color: colorTheme,//colorTheme,
        size: reprCtx.sizeThemeRegistry.create('physical', { structure: fullStructure })
    })
    
    await spacefillRepr.createOrUpdate(
        { ...SpacefillRepresentationProvider.defaultValues,
            alpha: 1.0 }, fullStructure).run()
    canvas3d.add(spacefillRepr);
}

async function displaySurfaceOne(fullStructure:structure, colorTheme:ColorTheme){
    const gaussianSurfaceRepr = getGaussianSurfaceRepr()
    gaussianSurfaceRepr.setTheme({
        color: colorTheme,
        size: reprCtx.sizeThemeRegistry.create('physical', { structure: fullStructure })
    })
    await gaussianSurfaceRepr.createOrUpdate(
        { ...GaussianSurfaceRepresentationProvider.defaultValues,
            quality: 'custom', alpha: 1.0, flatShaded: false,
            doubleSided: false, resolution: surface_resolution, radiusOffset: 2 }, fullStructure).run()
    canvas3d.add(gaussianSurfaceRepr);
}

async function OneCompartmentProcess(compartment:Compartment,maincolor:any){
    const ningredients = Object.keys(compartment.ingredients).length;
    const ingr_colors = GenerateOneColorRangePalette(maincolor,ningredients);
    let icounter = 0;
    console.log(ingr_colors);
    for (const ingr_name in compartment.ingredients){
        const ingr:Ingredient = compartment.ingredients[ingr_name];
        if (ingr_name =="HIV1_CAhex_0_1_0")continue;
        if (ingr_name =="HIV1_CAhexCyclophilA_0_1_0")continue;
        if (ingr == undefined) {
            console.log(ingr_name)
            continue;
        }
        const pdbname:string = ingr.source.pdb;
        if (!pdbname||pdbname == "None") continue;
        const instances:Mat4[] =  ingr.results.map(getMat);
        const bu = ("biomt" in ingr.source)? 1:-1;// && ingr.source.biomt ?
        const polymers:Structure = await getOnePDB(pdbname,bu);//should also consider chains and modelnb
        const fullStructure:Structure  = Assamble(instances,polymers);
        const colorTheme = reprCtx.colorThemeRegistry.create('uniform', 
            { structure: fullStructure, value: ColorNames.blue}); 
        const acolor:Color = Color(ingr_colors[icounter].hex().replace("#","0x"));
        colorTheme.color = ()=>acolor;// ColorNames.blue;
        if (showAtoms){
            await displayAtomOne(fullStructure,colorTheme);
        }
        if (showSurface) {
            await displaySurfaceOne(fullStructure,colorTheme);
        }
        icounter += 1;
    }     
}

export async function init() {
   const ncompartment = Object.keys(recipe2.compartments).length*2 + 1;
   const colors_comp = GetNColors(ncompartment);
   let counter = 0;
   console.log(ncompartment);
   console.log(colors_comp);
   await OneCompartmentProcess(recipe2.cytoplasme,colors_comp[0]);
   counter+=1; 
   for (const comp in recipe2.compartments){
        console.log(comp);
        if ("surface" in recipe2.compartments[comp]){
            await OneCompartmentProcess(recipe2.compartments[comp].surface,colors_comp[counter]);
            counter+=1; 
        }
        if ("interior" in recipe2.compartments[comp]){
            await OneCompartmentProcess(recipe2.compartments[comp].interior,colors_comp[counter]);
            counter+=1; 
        }
   }
   //rna points -> one turn singe strand ?
   //rotation should be pt0->pt1
   
    const pdbname:string = "DNA_oneTurn.pdb";
    const instances:Mat4[] =  getMatFromPoints(rna.points);
    const bu = -1;
    const polymers:Structure = await getOnePDB(pdbname,bu);//should also consider chains and modelnb
    const fullStructure:Structure  = Assamble(instances,polymers);
    const colorTheme = reprCtx.colorThemeRegistry.create('uniform', 
    { structure: fullStructure, value: ColorNames.blue}); 
    colorTheme.color = ()=>ColorNames.purple;// ColorNames.blue;
    if (showAtoms){
        await displayAtomOne(fullStructure,colorTheme);
    }
    if (showSurface) {
        await displaySurfaceOne(fullStructure,colorTheme);
    }
    canvas3d.resetCamera();
}
init()