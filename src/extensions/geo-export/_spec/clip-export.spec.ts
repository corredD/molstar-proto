/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mesh } from '../../../mol-geo/geometry/mesh/mesh';
import { createRenderObject } from '../../../mol-gl/render-object';
import { RenderableState } from '../../../mol-gl/renderable';
import { Box3D } from '../../../mol-math/geometry/primitives/box3d';
import { Mat4 } from '../../../mol-math/linear-algebra/3d/mat4';
import { Vec3 } from '../../../mol-math/linear-algebra/3d/vec3';
import { SyncRuntimeContext } from '../../../mol-task/execution/synchronous';
import { Clip } from '../../../mol-util/clip';
import { ColorNames } from '../../../mol-util/color/names';
import { createTransform } from '../../../mol-geo/geometry/transform-data';
import { Spheres } from '../../../mol-geo/geometry/spheres/spheres';
import { GlbExporter } from '../glb-exporter';
import { ObjExporter } from '../obj-exporter';

/**
 * Four unit triangles, two at y = +1 and two at y = -1, so a plane clip through the origin removes
 * exactly half of them.
 */
function createMesh() {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const groups: number[] = [];

    let v = 0;
    for (const y of [1, 1, -1, -1]) {
        const x = v * 0.01; // keep the triangles distinct
        positions.push(x, y, 0, x + 1, y, 0, x, y, 1);
        for (let k = 0; k < 3; ++k) {
            normals.push(0, 1, 0);
            groups.push(0);
        }
        indices.push(v, v + 1, v + 2);
        v += 3;
    }

    return Mesh.create(
        new Float32Array(positions), new Uint32Array(indices),
        new Float32Array(normals), new Float32Array(groups),
        12, 4
    );
}

function planeClip(invert: boolean, variant: Clip.Variant = 'pixel') {
    return {
        clip: {
            variant,
            objects: [{
                type: 'plane' as const,
                invert,
                position: Vec3(),
                rotation: { axis: Vec3.create(1, 0, 0), angle: 0 },
                scale: Vec3.create(1, 1, 1),
                transform: Mat4.identity(),
            }],
        },
    };
}

const state: RenderableState = {
    visible: true, alphaFactor: 1, pickable: false, colorOnly: false,
    opaque: true, writeDepth: true,
};

function renderObject(props: any, transform?: ReturnType<typeof createTransform>) {
    const values = Mesh.Utils.createValuesSimple(createMesh(), props, ColorNames.red, 1, transform);
    // a uniform color type is what lets the exporter run without a WebGL context
    expect(values.dColorType.ref.value).toBe('uniform');
    return createRenderObject('mesh', values, state, -1);
}

const boundingBox = Box3D.create(Vec3.create(-2, -2, -2), Vec3.create(2, 2, 2));

/** pull the JSON chunk back out of the glb container */
function parseGlb(glb: Uint8Array) {
    const text = new TextDecoder().decode(glb);
    const start = text.indexOf('{"asset"');
    return JSON.parse(text.slice(start, text.lastIndexOf('}') + 1));
}

async function objFaceCount(props: any, applyClipping: boolean, transform?: ReturnType<typeof createTransform>) {
    const exporter = new ObjExporter('test', boundingBox);
    exporter.setOptions({ applyClipping });
    await exporter.add(renderObject(props, transform), undefined!, SyncRuntimeContext);
    const { obj } = await exporter.getData();
    return obj.split('\n').filter(l => l.startsWith('f ')).length;
}

/** one sphere straddling y = 0, with its center just above the plane */
async function sphereFaceCount(clipPrimitive: boolean) {
    const spheres = Spheres.create(new Float32Array([0, 0.5, 0]), new Float32Array([0]), 1);
    const values = Spheres.Utils.createValuesSimple(spheres, { ...planeClip(false), clipPrimitive }, ColorNames.red, 2);
    expect(values.dColorType.ref.value).toBe('uniform');

    const exporter = new ObjExporter('test', boundingBox);
    exporter.setOptions({ applyClipping: true });
    await exporter.add(createRenderObject('spheres', values, state, -1), undefined!, SyncRuntimeContext);
    const { obj } = await exporter.getData();
    return obj.split('\n').filter(l => l.startsWith('f ')).length;
}

describe('geo-export clipping', () => {
    it('exports everything when the toggle is off', async () => {
        expect(await objFaceCount(planeClip(false), false)).toBe(4);
        expect(await objFaceCount({}, false)).toBe(4);
    });

    it('is a no-op when the render object has no clip objects', async () => {
        expect(await objFaceCount({}, true)).toBe(4);
    });

    it('drops the clipped triangles when the toggle is on', async () => {
        expect(await objFaceCount(planeClip(false), true)).toBe(2);
    });

    it('partitions the triangles between invert and non-invert', async () => {
        // the strongest available assertion: whatever the cut is, the two halves must add up
        const kept = await objFaceCount(planeClip(false), true);
        const inverted = await objFaceCount(planeClip(true), true);
        expect(kept + inverted).toBe(4);
        expect(kept).toBeGreaterThan(0);
        expect(inverted).toBeGreaterThan(0);
    });

    it('culls whole instances for the instance variant, leaving no mesh-less glTF node', async () => {
        // two instances, one shifted to +y and one to -y, so the plane keeps exactly one of them
        const transform = createTransform(new Float32Array([
            ...Mat4.fromTranslation(Mat4(), Vec3.create(0, 5, 0)),
            ...Mat4.fromTranslation(Mat4(), Vec3.create(0, -5, 0)),
        ]), 2);

        const exporter = new GlbExporter(boundingBox);
        exporter.setOptions({ applyClipping: true });
        await exporter.add(renderObject(planeClip(false, 'instance'), transform), undefined!, SyncRuntimeContext);
        const gltf = parseGlb((await exporter.getData()).glb);

        expect(gltf.nodes.length).toBe(1);
        for (const node of gltf.nodes) {
            // this is what silently broke when reuse was keyed on `instanceIndex === 0`
            expect(node.mesh).toBeDefined();
        }
    });

    it('drops whole spheres when clipPrimitive is set, and cuts them when it is not', async () => {
        // with `clipPrimitive` the vertex shader culls the whole sphere by its center and the fragment
        // shader does no per-pixel test at all (`spheres.frag.ts:57`), so a sphere whose center is on
        // the clipped side must disappear entirely rather than be sliced open
        expect(await sphereFaceCount(true)).toBe(0);
        // without it, the sphere is cut and the part on the visible side survives
        const cut = await sphereFaceCount(false);
        expect(cut).toBeGreaterThan(0);
    });

    it('keeps sharing one glTF mesh across instances with clipping off', async () => {
        // guards the glb-exporter refactor itself, independently of any clipping behaviour
        const transform = createTransform(new Float32Array([
            ...Mat4.fromTranslation(Mat4(), Vec3.create(0, 5, 0)),
            ...Mat4.fromTranslation(Mat4(), Vec3.create(0, -5, 0)),
        ]), 2);

        const exporter = new GlbExporter(boundingBox);
        exporter.setOptions({ applyClipping: false });
        await exporter.add(renderObject(planeClip(false), transform), undefined!, SyncRuntimeContext);
        const gltf = parseGlb((await exporter.getData()).glb);

        expect(gltf.nodes.length).toBe(2);
        expect(gltf.meshes.length).toBe(1);
        expect(gltf.nodes[0].mesh).toBe(gltf.nodes[1].mesh);
    });

    it('keeps sharing one glTF mesh across instances when nothing is clipped', async () => {
        const transform = createTransform(new Float32Array([
            ...Mat4.fromTranslation(Mat4(), Vec3.create(0, 5, 0)),
            ...Mat4.fromTranslation(Mat4(), Vec3.create(0, 6, 0)),
        ]), 2);

        const exporter = new GlbExporter(boundingBox);
        exporter.setOptions({ applyClipping: true });
        // inverted plane at the origin keeps everything above it, i.e. both instances whole
        await exporter.add(renderObject(planeClip(true, 'instance'), transform), undefined!, SyncRuntimeContext);
        const gltf = parseGlb((await exporter.getData()).glb);

        expect(gltf.nodes.length).toBe(2);
        // one mesh, two nodes - losing this would multiply file size by the instance count
        expect(gltf.meshes.length).toBe(1);
        expect(gltf.nodes[0].mesh).toBe(gltf.nodes[1].mesh);
    });
});
