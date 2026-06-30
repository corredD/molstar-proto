/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Vec3 } from '../linear-algebra/3d/vec3';

/**
 * A triangle mesh prepared for fast, exact closest-point queries: triangles are binned into a
 * uniform grid by their axis-aligned bounds, and `project` finds the nearest surface point by
 * expanding cell rings from the query point until no unscanned cell can be closer than the best hit.
 *
 * Unlike `GridLookup3D.nearest` (which is approximate for queries starting outside the data bounds)
 * this is exact: the ring-termination `(ring * cellSize)^2 >= bestSquaredDistance` guarantees every
 * potentially-closer triangle has been visited. Built once per mesh and reused across frames.
 */
interface MeshSurface {
    readonly triangleCount: number
    /** Smallest origin-centred cube half-extent that contains the mesh (max abs coordinate); a box of
     * this half-extent never clips the mesh. */
    readonly extent: number
    /**
     * Closest point on the mesh to `p`, written to `outPoint`, with the hit triangle's normal written
     * to `outNormal`. Returns the distance (not squared). Returns `Infinity` for an empty mesh.
     */
    project(p: Vec3, outPoint: Vec3, outNormal: Vec3): number
    /** Uniform random point on the surface (area-weighted), written to `out`. `rand` returns [0, 1). */
    sample(out: Vec3, rand: () => number): void
}

namespace MeshSurface {
    /** Build a `MeshSurface` from packed vertex positions `[x,y,z,...]` and triangle `indices`. */
    export function create(positions: Float32Array, indices: Uint32Array | Int32Array): MeshSurface {
        const triangleCount = (indices.length / 3) | 0;

        // vertex bounds
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (let i = 0, il = positions.length; i < il; i += 3) {
            const x = positions[i], y = positions[i + 1], z = positions[i + 2];
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }
        const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
        const extent = Math.max(Math.abs(minX), Math.abs(maxX), Math.abs(minY), Math.abs(maxY), Math.abs(minZ), Math.abs(maxZ), 0);

        // cell size: aim for ~1 triangle per cell (volume / count), with planar/degenerate fallbacks
        const maxExtent = Math.max(dx, dy, dz, 1e-3);
        const volume = dx * dy * dz;
        const cellSize = Math.max(volume > 0 && triangleCount > 0 ? Math.cbrt(volume / triangleCount) : 0, maxExtent / 64, 1e-3);
        const invCell = 1 / cellSize;
        const nx = Math.max(1, Math.floor(dx * invCell) + 1);
        const ny = Math.max(1, Math.floor(dy * invCell) + 1);
        const nz = Math.max(1, Math.floor(dz * invCell) + 1);
        const nCells = nx * ny * nz;

        const cellX = (x: number) => Math.min(nx - 1, Math.max(0, Math.floor((x - minX) * invCell)));
        const cellY = (y: number) => Math.min(ny - 1, Math.max(0, Math.floor((y - minY) * invCell)));
        const cellZ = (z: number) => Math.min(nz - 1, Math.max(0, Math.floor((z - minZ) * invCell)));

        // CSR grid: cellStart[c]..cellStart[c+1] indexes into `entries` (triangle indices). A triangle
        // is binned into every cell its AABB overlaps, so the closest triangle is always found.
        const cellStart = new Int32Array(nCells + 1);
        const va = Vec3(), vb = Vec3(), vc = Vec3();
        const triBounds = (t: number) => {
            const o = t * 3;
            Vec3.fromArray(va, positions, indices[o] * 3);
            Vec3.fromArray(vb, positions, indices[o + 1] * 3);
            Vec3.fromArray(vc, positions, indices[o + 2] * 3);
        };
        const forEachCellOfTri = (cb: (cell: number) => void) => {
            const ix0 = cellX(Math.min(va[0], vb[0], vc[0])), ix1 = cellX(Math.max(va[0], vb[0], vc[0]));
            const iy0 = cellY(Math.min(va[1], vb[1], vc[1])), iy1 = cellY(Math.max(va[1], vb[1], vc[1]));
            const iz0 = cellZ(Math.min(va[2], vb[2], vc[2])), iz1 = cellZ(Math.max(va[2], vb[2], vc[2]));
            for (let ix = ix0; ix <= ix1; ++ix) for (let iy = iy0; iy <= iy1; ++iy) for (let iz = iz0; iz <= iz1; ++iz) {
                cb((ix * ny + iy) * nz + iz);
            }
        };

        for (let t = 0; t < triangleCount; ++t) { triBounds(t); forEachCellOfTri(c => { cellStart[c + 1]++; }); }
        for (let c = 0; c < nCells; ++c) cellStart[c + 1] += cellStart[c];
        const entries = new Int32Array(cellStart[nCells]);
        const cursor = Int32Array.from(cellStart.subarray(0, nCells));
        for (let t = 0; t < triangleCount; ++t) { triBounds(t); forEachCellOfTri(c => { entries[cursor[c]++] = t; }); }

        // cumulative triangle areas, for area-weighted uniform surface sampling
        const cumArea = new Float64Array(triangleCount);
        const e1 = Vec3(), e2 = Vec3(), cr = Vec3();
        let areaSum = 0;
        for (let t = 0; t < triangleCount; ++t) {
            triBounds(t);
            Vec3.sub(e1, vb, va); Vec3.sub(e2, vc, va); Vec3.cross(cr, e1, e2);
            areaSum += 0.5 * Math.sqrt(cr[0] * cr[0] + cr[1] * cr[1] + cr[2] * cr[2]);
            cumArea[t] = areaSum;
        }
        const totalArea = areaSum;

        const sample = (out: Vec3, rand: () => number) => {
            if (triangleCount === 0 || totalArea <= 0) { Vec3.set(out, 0, 0, 0); return; }
            const target = rand() * totalArea;
            let lo = 0, hi = triangleCount - 1; // first triangle whose cumulative area >= target
            while (lo < hi) { const mid = (lo + hi) >> 1; if (cumArea[mid] < target) lo = mid + 1; else hi = mid; }
            triBounds(lo);
            let u = rand(), v = rand();
            if (u + v > 1) { u = 1 - u; v = 1 - v; } // fold into the triangle
            out[0] = va[0] + u * (vb[0] - va[0]) + v * (vc[0] - va[0]);
            out[1] = va[1] + u * (vb[1] - va[1]) + v * (vc[1] - va[1]);
            out[2] = va[2] + u * (vb[2] - va[2]) + v * (vc[2] - va[2]);
        };

        // query state (reused across calls)
        const seen = new Int32Array(triangleCount); // per-query visited stamp
        let gen = 0;
        const cp = Vec3();
        const maxRing = Math.max(nx, ny, nz);

        const project = (p: Vec3, outPoint: Vec3, outNormal: Vec3): number => {
            if (triangleCount === 0) return Infinity;
            ++gen;
            const px = cellX(p[0]), py = cellY(p[1]), pz = cellZ(p[2]);
            let best = Infinity, bestT = -1;
            for (let r = 0; r <= maxRing; ++r) {
                const x0 = Math.max(0, px - r), x1 = Math.min(nx - 1, px + r);
                const y0 = Math.max(0, py - r), y1 = Math.min(ny - 1, py + r);
                const z0 = Math.max(0, pz - r), z1 = Math.min(nz - 1, pz + r);
                for (let ix = x0; ix <= x1; ++ix) for (let iy = y0; iy <= y1; ++iy) for (let iz = z0; iz <= z1; ++iz) {
                    // only the shell at Chebyshev distance r (inner cells were scanned already)
                    if (Math.max(Math.abs(ix - px), Math.abs(iy - py), Math.abs(iz - pz)) !== r) continue;
                    const c = (ix * ny + iy) * nz + iz;
                    for (let k = cellStart[c], kl = cellStart[c + 1]; k < kl; ++k) {
                        const t = entries[k];
                        if (seen[t] === gen) continue;
                        seen[t] = gen;
                        triBounds(t);
                        Vec3.closestPointOnTriangle(cp, p, va, vb, vc);
                        const d2 = Vec3.squaredDistance(p, cp);
                        if (d2 < best) { best = d2; bestT = t; Vec3.copy(outPoint, cp); }
                    }
                }
                // any not-yet-scanned cell is >= r*cellSize away; stop once the best hit is closer
                if (bestT >= 0 && best <= r * cellSize * (r * cellSize)) break;
            }
            if (bestT < 0) return Infinity;
            triBounds(bestT);
            Vec3.triangleNormal(outNormal, va, vb, vc);
            return Math.sqrt(best);
        };

        return { triangleCount, extent, project, sample };
    }
}

export { MeshSurface };
