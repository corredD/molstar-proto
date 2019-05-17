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

//IwantHue palette generator
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


function CubicInterpolate(y0:Vec3, y1:Vec3, y2:Vec3, y3:Vec3, mu:number)
{
    let out:Vec3 = Vec3.zero();
    const mu2:number = mu * mu;
    let a0:Vec3= Vec3.zero();
    let a1:Vec3= Vec3.zero();
    let a2:Vec3= Vec3.zero();
    let a3:Vec3= Vec3.zero();
    Vec3.sub(a0,y3,y2);
    Vec3.sub(a0,a0,y0);
    Vec3.add(a0,a0,y1);
    
    Vec3.sub(a1,y0,y1);
    Vec3.sub(a1,a1,a0);
    
    Vec3.sub(a2,y2,y0);
    
    Vec3.copy(a3,y1);

    out[0] = a0[0] * mu * mu2 + a1[0] * mu2 + a2[0] * mu + a3[0];
    out[1] = a0[1] * mu * mu2 + a1[1] * mu2 + a2[1] * mu + a3[1];
    out[2] = a0[2] * mu * mu2 + a1[2] * mu2 + a2[2] * mu + a3[2];

    return out;
}

function ResampleControlPoints(points:number[], segmentLength:number)
{
    const nP:number = points.length/3;
    //insert a point at the end and at the begining
    //controlPoints.Insert(0, controlPoints[0] + (controlPoints[0] - controlPoints[1]) / 2.0f);
    //controlPoints.Add(controlPoints[nP - 1] + (controlPoints[nP - 1] - controlPoints[nP - 2]) / 2.0f);

    let resampledControlPoints:Vec3[]=[];
    //resampledControlPoints.Add(controlPoints[0]);
    //resampledControlPoints.Add(controlPoints[1]);

    let Id = 1;
    let currentPosition:Vec3 = Vec3.create(points[Id*3],points[Id*3+1],points[Id*3+2]);

    let lerpValue:number = 0.0;

    // Normalize the distance between control points
    while (true)
    {
        if (Id + 2 >= nP) break;
        const cp0:Vec3 = Vec3.create(points[(Id-1)*3],points[(Id-1)*3+1],points[(Id-1)*3+2]);//controlPoints[currentPointId - 1];
        const cp1:Vec3 = Vec3.create(points[Id*3],points[Id*3+1],points[Id*3+2]);//controlPoints[currentPointId];
        const cp2:Vec3 = Vec3.create(points[(Id+1)*3],points[(Id+1)*3+1],points[(Id+1)*3+2]);//controlPoints[currentPointId + 1];
        const cp3:Vec3 = Vec3.create(points[(Id+2)*3],points[(Id+2)*3+1],points[(Id+2)*3+2]);//controlPoints[currentPointId + 2];
        var found = false;
        for (; lerpValue <= 1; lerpValue += 0.01)
        {
            //lerp?slerp
            //let candidate:Vec3 = Vec3.lerp(Vec3.zero(), cp0, cp1, lerpValue);
            //const candidate:Vec3 = Vec3.bezier(Vec3.zero(), cp0, cp1, cp2, cp3, lerpValue);
            const candidate:Vec3 =CubicInterpolate(cp0, cp1, cp2, cp3, lerpValue);
            const d:number = Vec3.distance(currentPosition, candidate);
            if (d > segmentLength)
            {
                resampledControlPoints.push(candidate);
                Vec3.copy(currentPosition,candidate);
                found = true;
                break;
            }
        }
        if (!found)
        {
            lerpValue = 0;
            Id+=1;
        }
    }
    return resampledControlPoints;
}

//easier to align to theses normals
function GetSmoothNormals(points:Vec3[])
{
    let nP:number = points.length;
    let smoothNormals:Vec3[]=[];
    if (points.length < 3) {
        for (let i = 0; i < points.length; i++)
            smoothNormals.push(Vec3.normalize(Vec3.zero(), points[i]));
        return smoothNormals;
    }
    let p0:Vec3 = Vec3.copy(Vec3.zero(),points[0]);//undefined ?
    let p1:Vec3 = Vec3.copy(Vec3.zero(),points[1]);
    let p2:Vec3 = Vec3.copy(Vec3.zero(),points[2]);
    let p21:Vec3 = Vec3.sub(Vec3.zero(),p2,p1);
    let p01:Vec3 =  Vec3.sub(Vec3.zero(),p0,p1);
    let p0121:Vec3 = Vec3.cross(Vec3.zero(),p01,p21 );
    let last:Vec3 = Vec3.normalize(Vec3.zero(),p0121); 
    smoothNormals.push(last);
    for (let i = 1; i < points.length - 1; i++)
    {
        p0 = points[i - 1];
        p1 = points[i];
        p2 = points[i + 1];
        const t:Vec3 = Vec3.normalize(Vec3.zero(),Vec3.sub(Vec3.zero(),p2 , p0));
        const b:Vec3 = Vec3.normalize(Vec3.zero(),Vec3.cross(Vec3.zero(),t, last));
        let n:Vec3 = Vec3.normalize(Vec3.zero(),Vec3.cross(Vec3.zero(),t, b));
        n=Vec3.scale(n,n,-1.0);
        last=Vec3.copy(last,n);
        smoothNormals.push(n);
    }
    last= Vec3.normalize(Vec3.zero(),Vec3.cross(Vec3.zero(), Vec3.sub(Vec3.zero(),points[nP - 3],points[nP-2]), Vec3.sub(Vec3.zero(),points[nP-2] , points[nP-1]))); 
    smoothNormals.push(last);
    return smoothNormals;
}
let frame : {[key:string]:Vec3} = {t:Vec3.zero(),
             r: Vec3.zero(),
             s: Vec3.zero()};
type Frame = typeof frame;

function getFrame(reference:Vec3,tangent:Vec3){
    let t:Vec3 = Vec3.normalize(Vec3.zero(),tangent);
    //# make reference vector orthogonal to tangent
    let proj_r_to_t:Vec3 = Vec3.scale(Vec3.zero(),tangent, Vec3.dot(reference,tangent)/Vec3.dot(tangent,tangent) );
    let r:Vec3 = Vec3.normalize(Vec3.zero(),Vec3.sub(Vec3.zero(),reference , proj_r_to_t));
    //# make bitangent vector orthogonal to the others
    let s:Vec3 = Vec3.normalize(Vec3.zero(),Vec3.cross(Vec3.zero(),t,r));
    return {t:t,
        r: r,
        s: s};
}

//easier to align to theses normals
//https://github.com/bzamecnik/gpg/blob/master/rotation-minimizing-frame/rmf.py
function GetMiniFrame(points:Vec3[],normals:Vec3[])
{
    let frames:Frame[]=[];
    let t0:Vec3 = Vec3.normalize(Vec3.zero(),Vec3.sub(Vec3.zero(),points[1],points[0]));
    frames.push(getFrame(normals[0],t0));
    let npoints = points.length;
    for (let i=0; i< npoints-2; i++){
        let t2 = Vec3.normalize(Vec3.zero(),Vec3.sub(Vec3.zero(),points[i+2],points[i+1]));
        const v1:Vec3 = Vec3.sub(Vec3.zero(),points[i + 1] ,points[i]);//this is tangeant
        const c1 = Vec3.dot(v1,v1);
        //# compute r_i^L = R_1 * r_i
        const v1r = Vec3.scale(Vec3.zero(),v1,(2.0/c1)*Vec3.dot(v1,frames[i].r));
        const ref_L_i:Vec3 = Vec3.sub(Vec3.zero(), frames[i].r,v1r);
        //# compute t_i^L = R_1 * t_i
        const v1t = Vec3.scale(Vec3.zero(),v1,(2.0/c1)*Vec3.dot(v1,frames[i].t));
        const tan_L_i:Vec3 = Vec3.sub(Vec3.zero(), frames[i].t,v1t);
        // # compute reflection vector of R_2
        const v2:Vec3 =  Vec3.sub(Vec3.zero(),t2 , tan_L_i);
        const c2 = Vec3.dot(v2,v2);
        //# compute r_(i+1) = R_2 * r_i^L
        const v2l = Vec3.scale(Vec3.zero(),v1,(2.0/c2)*Vec3.dot(v2,ref_L_i));
        const ref_next = Vec3.sub(Vec3.zero(), ref_L_i,v2l);//ref_L_i - (2 / c2) * v2.dot(ref_L_i) * v2
        frames.push(getFrame(ref_next,t2));//frames.append(Frame(ref_next, tangents[i+1]))
    }
    return frames;
}

function GetTubePropertiesMatrix(coord1:Vec3,coord2:Vec3){
    let x1 = coord1[0];
    let y1 = coord1[1];
    let z1 = coord1[2];
    let x2 = coord2[0];
    let y2 = coord2[1];
    let z2 = coord2[2];
    let v:Vec3 = Vec3.sub(Vec3.zero(),coord2,coord1);
    let offset:Vec3=Vec3.create((x1+x2)/2.0,(y1+y2)/2.0,(z1+z2)/2.0);      
    let v_2 = Vec3.normalize(Vec3.zero(), v);
    let v_1 = Vec3.create(0.0,1.0,2.0);
    let v_3 = Vec3.cross(Vec3.zero(),v_1,v_2);
    v_3 = Vec3.normalize(Vec3.zero(),v_3);
    v_1 = Vec3.cross(Vec3.zero(),v_2,v_3);
    v_1 = Vec3.normalize(Vec3.zero(),v_1);
    let M:Mat4=Mat4.identity();
    M[0] = v_1[0];M[1] = v_1[1];M[2] = v_1[2];
    M[4] = v_2[0];M[5] = v_2[1];M[6] = v_2[2];
    M[8] = v_3[0];M[9] = v_3[1];M[10] = v_3[2];
    M[12] = offset[0];M[13] = offset[1];M[14] = offset[2];
    return M;
}


function getMatFromResamplePoints(points:number[]){
    let segmentLength:number = 3.4;
    let new_points:Vec3[] = ResampleControlPoints(points,3.4);
    const npoints = new_points.length;
    let new_normal:Vec3[] = GetSmoothNormals(new_points);
    let frames:Frame[]=GetMiniFrame(new_points,new_normal);
    const limit = npoints;
    let transforms:Mat4[]=[];
    let pti:Vec3 = Vec3.copy(Vec3.zero(),new_points[0]);
    console.log(new_points.length);
    console.log(points.length/3);
    console.log(limit);
    console.log(segmentLength);
    for (let i=0; i<npoints-2; i++){
        const pti1:Vec3= new_points[i+1];//Vec3.create(points[(i+1)*3],points[(i+1)*3+1],points[(i+1)*3+2]);
        let d:number = Vec3.distance(pti, pti1);
        if (d >= segmentLength)
        {
            let direction:Vec3 = Vec3.normalize(Vec3.zero(),Vec3.sub(Vec3.zero(),pti1,pti));
             /*
            let binormal:Vec3 = Vec3.normalize(Vec3.zero(),Vec3.cross(Vec3.zero(),direction, new_normal[i]));
            let normal:Vec3  = Vec3.normalize(Vec3.zero(),Vec3.cross(Vec3.zero(),direction, binormal));
            const q:Quat = Quat.setAxisAngle(Quat.zero(),direction, 0.0 );//Math.random()*3.60
            normal = Vec3.transformQuat(Vec3.zero(), normal, q);	
            binormal = Vec3.transformQuat(Vec3.zero(),binormal, q);
            
            // Get rotation to align with the normal
            let from:Vec3 = Vec3.create(1,0,0);	// Assuming that the nucleotide is pointing in the up direction
            let to:Vec3 = Vec3.copy(Vec3.zero(),normal);	
            let axis:Vec3 = Vec3.normalize(Vec3.zero(),Vec3.cross(Vec3.zero(),from, to));
            let cos_theta =  Vec3.dot(Vec3.normalize(Vec3.zero(),from), Vec3.normalize(Vec3.zero(),to));
            let angle = Math.acos(cos_theta);
            let quat1:Quat = Quat.setAxisAngle(Quat.zero(), axis, angle );//QuaternionFromAxisAngle(axis, angle);
            quat1 = Quat.rotationTo(Quat.zero(), Vec3.create(0,0,1),direction);//
            // Get rotation to align with the binormal
            let from2:Vec3 = Vec3.transformQuat(Vec3.zero(),Vec3.create(1,0,0), quat1);	
            let to2:Vec3 = Vec3.copy(Vec3.zero(),binormal);	
            let axis2:Vec3 = Vec3.normalize(Vec3.zero(),Vec3.cross(Vec3.zero(),from2, to2));
            let cos_theta2 = Vec3.dot(Vec3.normalize(Vec3.zero(),from2), Vec3.normalize(Vec3.zero(),to2));
            let angle2 = Math.acos(cos_theta2);
            let quat2:Quat = Quat.setAxisAngle(Quat.zero(), axis2, angle2);
            //quat2 = Quat.rotationTo(Quat.zero(), from2,binormal);//
            
            let v_1 = Vec3.create(0.0,1.0,2.0);
            let v_3 = Vec3.normalize(Vec3.zero(),Vec3.cross(Vec3.zero(),v_1,direction));
            v_1 = Vec3.cross(Vec3.zero(),direction,v_3);
            */
            const quat:Quat = Quat.rotationTo(Quat.zero(), Vec3.create(0,0,1),frames[i].t);// Quat.rotationTo(Quat.zero(), Vec3.create(0,0,1),new_normal[i]);//Quat.rotationTo(Quat.zero(), Vec3.create(0,0,1),direction);new_normal
            const rq:Quat = Quat.setAxisAngle(Quat.zero(), frames[i].t, Math.random()*3.60 );//Quat.setAxisAngle(Quat.zero(),direction, Math.random()*3.60 );//Quat.identity();//
            let m:Mat4 = Mat4.fromQuat(Mat4.zero(),Quat.multiply(Quat.zero(),rq,quat));//Mat4.fromQuat(Mat4.zero(),Quat.multiply(Quat.zero(),quat1,quat2));//Mat4.fromQuat(Mat4.zero(),quat);//Mat4.identity();//Mat4.fromQuat(Mat4.zero(),Quat.multiply(Quat.zero(),rq,quat));
            //let pos:Vec3 = Vec3.add(Vec3.zero(),pti1,pti)
            //pos = Vec3.scale(pos,pos,1.0/2.0);
            //Vec3.makeRotation(Mat4.zero(),Vec3.create(0,0,1),frames[i].t);//
            Mat4.setTranslation(m, pti1);
            //let m2:Mat4 = GetTubePropertiesMatrix(pti,pti1);
            //let q:Quat = Quat.rotationTo(Quat.zero(), Vec3.create(0,1,0),Vec3.create(0,0,1))
            //m2=Mat4.mul(Mat4.identity(),Mat4.fromQuat(Mat4.zero(),q),m2);
            transforms.push(m);
            pti=Vec3.copy(pti,pti1);
        }
        if (transforms.length >= limit) break;
    }
    return transforms;    
}

function getMatFromPoints(points:number[]){
    const npoints = 20;//points.length/3;
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
          && hcl[2]>=50 && hcl[2]<=100;//38.04
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
    return baseStructure;//StructureSelection.unionStructure(result);   
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
const showAtoms = true;
const showSurface = false;
const surface_resolution:number = 3.0;//can this be change dynamically?

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
    console.log("display atom");
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
    /*await OneCompartmentProcess(recipe2.cytoplasme,colors_comp[0]);
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
    }*/
    const pdbname:string = "RNA_U_Base.pdb";//"dna_single_base.pdb";//"DNA_oneTurn.pdb";
    const instances:Mat4[] =  getMatFromResamplePoints(rna.points);
    const bu = -1;
    const polymers:Structure = await getOnePDB(pdbname,bu);//should also consider chains and modelnb
    const fullStructure:Structure  = Assamble(instances,polymers);
    const colorTheme = reprCtx.colorThemeRegistry.create('illustrative', 
    { structure: fullStructure, value: ColorNames.blue}); 
    //colorTheme.color = ()=>ColorNames.purple;// ColorNames.blue;
    if (showAtoms){
        await displayAtomOne(fullStructure,colorTheme);
    }
    if (showSurface) {
        await displaySurfaceOne(fullStructure,colorTheme);
    }
    canvas3d.resetCamera();
}
init()