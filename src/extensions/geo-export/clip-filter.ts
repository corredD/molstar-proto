/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { BaseValues } from '../../mol-gl/renderable/schema';
import { Sphere3D } from '../../mol-math/geometry/primitives/sphere3d';
import { Mat4 } from '../../mol-math/linear-algebra/3d/mat4';
import { Vec3 } from '../../mol-math/linear-algebra/3d/vec3';
import { Clip } from '../../mol-util/clip';
import type { AddMeshInput } from './mesh-exporter';

export type InstanceMesh = NonNullable<AddMeshInput['mesh']>

export type ClipState = {
    readonly variant: Clip.Variant
    readonly test: Clip.Test
    /** the geometry's bounding sphere, before any instance transform */
    readonly sphere: Sphere3D
    /**
     * Set for spheres rendered with `clipPrimitive`, where the GPU clips whole spheres by their
     * center in the vertex shader and does no per-fragment test at all - so the export has to drop
     * whole spheres too, or it would slice open spheres the viewer shows whole. Holds the sphere
     * centers (xyz triples) and how many there are.
     */
    readonly primitiveCenters: Float32Array | undefined
    readonly primitiveCount: number
}

/** the extra values a spheres render object carries; absent on every other geometry */
type MaybeSpheresValues = BaseValues & {
    readonly dClipPrimitive?: { readonly ref: { readonly value: boolean } }
    readonly centerBuffer?: { readonly ref: { readonly value: Float32Array } }
}

/**
 * Read a render object's clip objects into a CPU-testable form, or `undefined` when there is nothing
 * to clip - which callers use as the signal to leave the export completely untouched.
 *
 * The GPU value arrays are already exactly `Clip.Objects`' shape: `mol-geo/geometry/base.ts` stores
 * `Clip.getClip(props.clip).objects.*` into them verbatim.
 */
export function getClipState(values: BaseValues): ClipState | undefined {
    const count = values.dClipObjectCount.ref.value;
    if (count === 0) return undefined;

    const variant = values.dClipVariant.ref.value as Clip.Variant;

    const objects: Clip.Objects = {
        count,
        type: values.uClipObjectType.ref.value,
        invert: values.uClipObjectInvert.ref.value,
        position: values.uClipObjectPosition.ref.value,
        rotation: values.uClipObjectRotation.ref.value,
        scale: values.uClipObjectScale.ref.value,
        transform: values.uClipObjectTransform.ref.value,
    };

    // a `none` object clips nothing unless inverted, in which case it clips everything
    let active = false;
    for (let i = 0; i < count; ++i) {
        if (objects.type[i] !== Clip.Type.none || objects.invert[i]) { active = true; break; }
    }
    if (!active) return undefined;

    // `dClipPrimitive` only takes effect for the pixel variant - see `spheres.vert.ts`
    const spheres = values as MaybeSpheresValues;
    const usePrimitives = variant === 'pixel' && spheres.dClipPrimitive?.ref.value === true && spheres.centerBuffer !== undefined;

    return {
        variant,
        test: Clip.createTest(objects),
        sphere: values.invariantBoundingSphere.ref.value,
        primitiveCenters: usePrimitives ? spheres.centerBuffer!.ref.value : undefined,
        // one center per sphere, six impostor vertices each
        primitiveCount: usePrimitives ? values.uVertexCount.ref.value / 6 : 0,
    };
}

const tmpTransform = Mat4();
const tmpCentroid = Vec3();

/**
 * Apply `state`'s clip objects to one instance of `instance`.
 *
 * Returns `instance` itself when nothing is clipped away, `undefined` when everything is, and a
 * filtered copy otherwise. Returning the original reference matters: `GlbExporter` keys its
 * shared-geometry fast path on reference identity, so losing it would multiply the file size by the
 * instance count.
 *
 * Triangles are dropped whole, by centroid - no re-triangulation and no capping, so the cut boundary
 * is jagged and the surface left open.
 */
export function filterInstance(state: ClipState, input: AddMeshInput, instanceIndex: number, instance: InstanceMesh): InstanceMesh | undefined {
    const { values, isGeoTexture, mode } = input;

    // NOTE: the clip objects live in scene space, so the test transform is the instance transform
    // ALONE. Every exporter separately composes `Mat4.mul(t, this.centerTransform, aTransform[i])` to
    // re-center its output - feeding that composed matrix in here would offset the cut by half the
    // bounding box while still looking plausible.
    Mat4.fromArray(tmpTransform, values.aTransform.ref.value, instanceIndex * 16);
    Clip.setTestInstanceTransform(state.test, tmpTransform);

    if (state.variant === 'instance') {
        // the instance variant has no per-fragment test at all: `clip-instance.glsl.ts` culls the
        // whole instance by its bounding-sphere center, so match that exactly
        return Clip.testPoint(state.test, state.sphere.center) ? undefined : instance;
    }

    // Classifying the whole instance up front skips the per-triangle pass for everything that is
    // entirely on one side of the clip objects - the common case in a large scene. The shared `mesh`'s
    // bounding sphere is computed from those same positions, so it bounds it exactly; the per-instance
    // meshes that `addSpheres`/`addCylinders`/`addPoints` tessellate need their own sphere, which
    // `Mesh` computes lazily and caches. Skipped for the primitive path below, which is already
    // cheaper than one pass over the vertices.
    if (state.primitiveCenters === undefined) {
        const sphere = input.mesh !== undefined ? state.sphere : input.meshes?.[instanceIndex].boundingSphere;
        if (sphere) {
            const classification = Clip.classifyBall(state.test, sphere.center, sphere.radius);
            if (classification === 'discard') return undefined;
            if (classification === 'keep') return instance;
        }
    }

    // raw `points`/`lines` modes have no primitives to filter here; they get instance granularity only
    if (mode !== 'triangles') return instance;

    if (state.primitiveCenters !== undefined && instance.indices !== undefined && instance.vertexMapping !== undefined) {
        return filterPrimitives(state, instance);
    }

    return instance.indices !== undefined
        ? filterIndexedTriangles(state, instance)
        : compactImplicitTriangles(state, instance, isGeoTexture ? 4 : 3);
}

let indexScratch = new Uint32Array(0);
function getIndexScratch(size: number) {
    if (indexScratch.length < size) indexScratch = new Uint32Array(size);
    return indexScratch;
}

let maskScratch = new Uint8Array(0);
function getMaskScratch(size: number) {
    if (maskScratch.length < size) maskScratch = new Uint8Array(size);
    return maskScratch;
}

/**
 * Drop whole tessellated primitives whose center is clipped, matching what the vertex shader does for
 * spheres with `clipPrimitive`. Also markedly cheaper than testing every triangle: one test per
 * sphere rather than one per triangle of every sphere.
 */
function filterPrimitives(state: ClipState, instance: InstanceMesh): InstanceMesh | undefined {
    const { indices, drawCount, vertexMapping } = instance;
    const centers = state.primitiveCenters!;
    const map = vertexMapping!;
    const src = indices!;

    const primitiveCount = state.primitiveCount;
    const keep = getMaskScratch(primitiveCount);
    for (let i = 0; i < primitiveCount; ++i) {
        tmpCentroid[0] = centers[i * 3];
        tmpCentroid[1] = centers[i * 3 + 1];
        tmpCentroid[2] = centers[i * 3 + 2];
        keep[i] = Clip.testPoint(state.test, tmpCentroid) ? 0 : 1;
    }

    const out = getIndexScratch(drawCount);
    let n = 0;
    for (let i = 0; i < drawCount; i += 3) {
        const a = src[i];
        // all three vertices of a triangle belong to the same primitive
        if (!keep[map[a]]) continue;
        out[n++] = a; out[n++] = src[i + 1]; out[n++] = src[i + 2];
    }

    if (n === 0) return undefined;
    if (n === drawCount) return instance;
    return { ...instance, indices: out.slice(0, n), drawCount: n };
}

function isTriangleClipped(state: ClipState, vertices: Float32Array, stride: number, a: number, b: number, c: number) {
    // read straight out of the buffer rather than via three `Vec3.fromArray` calls - this runs once
    // per triangle over the whole scene
    const ia = a * stride, ib = b * stride, ic = c * stride;
    tmpCentroid[0] = (vertices[ia] + vertices[ib] + vertices[ic]) / 3;
    tmpCentroid[1] = (vertices[ia + 1] + vertices[ib + 1] + vertices[ic + 1]) / 3;
    tmpCentroid[2] = (vertices[ia + 2] + vertices[ib + 2] + vertices[ic + 2]) / 3;
    return Clip.testPoint(state.test, tmpCentroid);
}

/**
 * Rewrite the index buffer, keeping only unclipped triangles. Vertices, normals, groups,
 * `vertexCount` and `vertexMapping` are carried over untouched, which is what keeps every
 * vertex- and instance-keyed lookup in `MeshExporter` (colors, transparency, overpaint, groups,
 * interpolated volume colors) valid without any changes.
 */
function filterIndexedTriangles(state: ClipState, instance: InstanceMesh): InstanceMesh | undefined {
    const { vertices, indices, drawCount } = instance;
    const src = indices!;

    // never filter in place - `Mesh.getOriginalData(values).indexBuffer` and `values.elements` are
    // live scene data, so mutating them would corrupt the running viewer, not just the export
    const out = getIndexScratch(drawCount);
    let n = 0;
    for (let i = 0; i < drawCount; i += 3) {
        const a = src[i], b = src[i + 1], c = src[i + 2];
        if (isTriangleClipped(state, vertices, 3, a, b, c)) continue;
        out[n++] = a; out[n++] = b; out[n++] = c;
    }

    if (n === 0) return undefined;
    if (n === drawCount) return instance;
    // `slice` off the scratch buffer, so the result is exactly as long as it needs to be
    return { ...instance, indices: out.slice(0, n), drawCount: n };
}

/**
 * For geometry without an index buffer (the `texture-mesh` read-back path), triangles are implicit
 * sequential vertex triples, so surviving triangles have to be compacted into new vertex/normal
 * arrays. `vertexMapping` maps each new vertex back to its original index, which is exactly what
 * `MeshExporter.getColor`/`getTransparency` consume to keep resolving colors, groups and interpolated
 * volume data against the original, unfiltered arrays.
 */
function compactImplicitTriangles(state: ClipState, instance: InstanceMesh, stride: number): InstanceMesh | undefined {
    const { vertices, normals, drawCount } = instance;
    const triangleCount = Math.floor(drawCount / 3);

    const keep = new Uint8Array(triangleCount);
    let kept = 0;
    for (let t = 0; t < triangleCount; ++t) {
        const i = t * 3;
        if (isTriangleClipped(state, vertices, stride, i, i + 1, i + 2)) continue;
        keep[t] = 1;
        ++kept;
    }

    if (kept === 0) return undefined;
    if (kept === triangleCount) return instance;

    const vertexCount = kept * 3;
    const outVertices = new Float32Array(vertexCount * stride);
    const outNormals = normals ? new Float32Array(vertexCount * stride) : undefined;
    const vertexMapping = new Array<number>(vertexCount);
    const previous = instance.vertexMapping;

    let w = 0;
    for (let t = 0; t < triangleCount; ++t) {
        if (!keep[t]) continue;
        for (let k = 0; k < 3; ++k) {
            const source = t * 3 + k;
            const from = source * stride;
            const to = w * stride;
            for (let s = 0; s < stride; ++s) {
                outVertices[to + s] = vertices[from + s];
                if (outNormals && normals) outNormals[to + s] = normals[from + s];
            }
            vertexMapping[w] = previous ? previous[source] : source;
            ++w;
        }
    }

    return { ...instance, vertices: outVertices, normals: outNormals, vertexCount, drawCount: vertexCount, vertexMapping };
}
