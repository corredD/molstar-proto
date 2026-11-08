/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { random01, type TileKinds, variantCount } from './assign.js';
import type { Leaflet } from './patch.js';

// The tile-set baker (progress/2026-11-08-lipid-tiles.md, Design: Tiles; Neyret & Cani 1999, oriented edges; Durrant &
// Amaro 2014, clash removal and hole filling, here once per variant). Pure functions, worker-able, once per patch.
//
// A tile is one leaflet of an equilateral triangle of edge L (template: A at the origin, B = (L, 0), C = (L/2, L√3/2),
// counter-clockwise, edge k from corner k to k + 1, its inward normal on its left). Each lipid is owned by the tile
// holding its headgroup. Pieces:
// - a strip per edge type (length L, width 2w, cut once): E places it along the edge from corner k, owning its half on
//   the inner side; Ē turns it 180° in-plane about the edge's midpoint and owns the other half. An edge's lipids exist
//   once, its two sides from one piece. Band lipids lie wholly beyond r_v + δ of both corners;
// - corner discs per vertex colour (C > 1) and the interior (a cut per variant): lipids wholly inside the triangle, δ off
//   every edge, so they meet nothing across a seam;
// - r_v from a lipid's reach: two edges' outer halves (owned by two other tiles) never meet near a vertex.
// Then a variant's own lipids are cleaned against each other and the full strips of its edges (worst first), and holes
// refilled by trial placements under the same rules.

export interface TileSetParams extends TileKinds {
  /** the template's edge, Å */
  readonly edge: number;
  /** the half-width of an edge's band, Å (default: the lipids' reach, at most half the corner radius) */
  readonly bandWidth?: number;
  /** clearance of a lipid from an edge it does not cross, Å; pairs across seams are at least twice it apart */
  readonly clearance: number;
  /** atom pairs closer than this clash, Å */
  readonly clash: number;
  /** trial placements per hole */
  readonly fillTries: number;
}

export const DefaultTileSetParams: TileSetParams = {
  edge: 200,
  edgeTypes: 1,
  vertexColors: 1,
  variants: 2,
  seed: 1,
  clearance: 1,
  clash: 2,
  fillTries: 12,
};

/** One tile variant: its lipids in the template's frame (z along the normal from the leaflet's mid-plane) */
export interface Tile {
  readonly lipidSpecies: Uint16Array;
  /** lipids + 1 entries */
  readonly lipidAtomStart: Uint32Array;
  readonly positions: Float32Array;
  readonly elements: Uint8Array;
  /** lipids removed by clashes, lipids added by the hole fill */
  readonly removed: number;
  readonly filled: number;
}

export interface TileSet {
  readonly params: TileSetParams;
  readonly species: readonly string[];
  readonly variants: readonly Tile[];
  /** the leaflet's mid-plane offset from the bilayer's center, Å (the surface it goes on) */
  readonly offset: number;
  readonly cornerRadius: number;
  readonly bandWidth: number;
  /** the leaflet's area a lipid, Å² */
  readonly areaPerLipid: number;
  /** the template's sphere: its center (x, y, z) and radius, over every variant's atoms */
  readonly sphere: readonly [number, number, number, number];
}

/** A rigid in-plane map: x' = a x − b y + tx, y' = b x + a y + ty (a = cos θ, b = sin θ) */
interface Rigid {
  a: number;
  b: number;
  tx: number;
  ty: number;
}

/** A lipid placed in the template: its species, its headgroup atom, its atoms and their elements */
interface Placed {
  species: number;
  head: number;
  positions: Float32Array;
  elements: Uint8Array;
}

const Sqrt3 = Math.sqrt(3);

export function bakeTileSet(leaflet: Leaflet, p: Partial<TileSetParams> = {}): TileSet {
  const params = { ...DefaultTileSetParams, ...p };
  const L = params.edge;
  const delta = params.clearance;
  const reach = leaflet.reach;
  // r_v: the outer halves of two edges at a vertex (≥ 45° apart) stay apart by 2δ: r_v sin 45° ≥ 2 reach + 2δ
  const cornerRadius = Math.min(L / 3, (2 * reach + 2 * delta) / Math.SQRT1_2);
  const bandWidth = Math.min(params.bandWidth ?? reach + 2 * delta, cornerRadius / 2);
  let draw = 0;
  const rand = () => random01(params.seed, draw++);
  const randomCut = (): Rigid => {
    const theta = rand() * 2 * Math.PI;
    return { a: Math.cos(theta), b: Math.sin(theta), tx: -rand() * leaflet.box[0], ty: -rand() * leaflet.box[1] };
  };
  const corners = [0, 0, L, 0, L / 2, (L * Sqrt3) / 2];

  // strips in their own frame (s along, t across), cut once per type: lipids with heads within w of the axis
  const strips: Placed[][] = [];
  for (let type = 0; type < params.edgeTypes; ++type) {
    const cut = randomCut();
    strips.push(
      cutLeaflet(
        leaflet,
        cut,
        L / 2,
        0,
        L / 2 + bandWidth + reach,
        (x, y) => x >= 0 && x <= L && Math.abs(y) <= bandWidth,
      ),
    );
  }
  const discs: Rigid[] = [];
  for (let c = 0; c < params.vertexColors; ++c) discs.push(randomCut());

  const variants: Tile[] = [];
  const count = variantCount(params);
  const E = 2 * params.edgeTypes;
  const V = params.variants;
  const C = params.vertexColors;
  for (let index = 0; index < count; ++index) {
    let r = index;
    const v = r % V;
    r = (r - v) / V;
    const e = [0, 0, 0];
    for (let k = 2; k >= 0; --k) {
      e[k] = r % E;
      r = (r - e[k]) / E;
    }
    const c = [0, 0, 0];
    for (let k = 2; k >= 0; --k) {
      c[k] = r % C;
      r = (r - c[k]) / C;
    }
    variants.push(
      bakeVariant(leaflet, params, strips, discs, corners, c, e, randomCut(), cornerRadius, bandWidth, rand),
    );
  }
  return {
    params,
    species: leaflet.species,
    variants,
    offset: leaflet.offset,
    cornerRadius,
    bandWidth,
    areaPerLipid: leaflet.areaPerLipid,
    sphere: boundingSphere(variants, L),
  };
}

/**
 * The lipids of the leaflet (any periodic image) whose head, mapped by `cut` (patch → frame), lies within `radius` of
 * (cx, cy) and passes `accept`; their atoms in the frame
 */
function cutLeaflet(
  leaflet: Leaflet,
  cut: Rigid,
  cx: number,
  cy: number,
  radius: number,
  accept: (x: number, y: number) => boolean,
) {
  const out: Placed[] = [];
  const [bx, by] = leaflet.box;
  // the frame's (cx, cy) in the patch: invert x' = R x + t
  const px = cut.a * (cx - cut.tx) + cut.b * (cy - cut.ty);
  const py = -cut.b * (cx - cut.tx) + cut.a * (cy - cut.ty);
  const { lipidHead, lipidAtomStart, positions, lipidSpecies } = leaflet;
  for (let l = 0, ll = lipidHead.length; l < ll; ++l) {
    const hx = positions[lipidHead[l] * 3];
    const hy = positions[lipidHead[l] * 3 + 1];
    for (let i = Math.ceil((px - radius - hx) / bx); i <= Math.floor((px + radius - hx) / bx); ++i) {
      for (let j = Math.ceil((py - radius - hy) / by); j <= Math.floor((py + radius - hy) / by); ++j) {
        const x = hx + i * bx;
        const y = hy + j * by;
        const fx = cut.a * x - cut.b * y + cut.tx;
        const fy = cut.b * x + cut.a * y + cut.ty;
        if ((fx - cx) ** 2 + (fy - cy) ** 2 > radius * radius || !accept(fx, fy)) continue;
        const start = lipidAtomStart[l];
        const end = lipidAtomStart[l + 1];
        const atoms = new Float32Array((end - start) * 3);
        for (let a = start; a < end; ++a) {
          const ax = positions[a * 3] + i * bx;
          const ay = positions[a * 3 + 1] + j * by;
          const o = (a - start) * 3;
          atoms[o] = cut.a * ax - cut.b * ay + cut.tx;
          atoms[o + 1] = cut.b * ax + cut.a * ay + cut.ty;
          atoms[o + 2] = positions[a * 3 + 2];
        }
        out.push({
          species: lipidSpecies[l],
          head: lipidHead[l] - start,
          positions: atoms,
          elements: leaflet.elements.subarray(start, end),
        });
      }
    }
  }
  return out;
}

/** `lipid` mapped by `m` (in-plane, z kept) */
function mapPlaced(lipid: Placed, m: Rigid): Placed {
  const src = lipid.positions;
  const positions = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    positions[i] = m.a * src[i] - m.b * src[i + 1] + m.tx;
    positions[i + 1] = m.b * src[i] + m.a * src[i + 1] + m.ty;
    positions[i + 2] = src[i + 2];
  }
  return { species: lipid.species, head: lipid.head, positions, elements: lipid.elements };
}

/** Whether every atom is inside the template triangle, `delta` off its edges */
function wholeInside(positions: Float32Array, L: number, delta: number) {
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    // edges AB (y = 0), BC and CA as distances inward
    if (y < delta) return false;
    if ((Sqrt3 * (L - x) - y) / 2 < delta) return false;
    if ((Sqrt3 * x - y) / 2 < delta) return false;
  }
  return true;
}

/** Whether every atom of a strip lipid (strip frame) lies `r` or more from both ends of the edge */
function clearOfCorners(positions: Float32Array, L: number, r: number) {
  for (let i = 0; i < positions.length; i += 3) {
    const s = positions[i];
    const t = positions[i + 1];
    if (s * s + t * t < r * r || (L - s) * (L - s) + t * t < r * r) return false;
  }
  return true;
}

function bakeVariant(
  leaflet: Leaflet,
  params: TileSetParams,
  strips: Placed[][],
  discs: Rigid[],
  corners: number[],
  c: number[],
  e: number[],
  interiorCut: Rigid,
  cornerRadius: number,
  bandWidth: number,
  rand: () => number,
): Tile {
  const L = params.edge;
  const delta = params.clearance;
  const own: Placed[] = [];
  const obstacles: Placed[] = [];
  const inBand = (x: number, y: number) => {
    for (let k = 0; k < 3; ++k) {
      const { s, t } = edgeCoords(corners, k, L, x, y);
      if (t >= 0 && t <= bandWidth && s >= cornerRadius && s <= L - cornerRadius) return true;
    }
    return false;
  };
  for (let k = 0; k < 3; ++k) {
    const reversed = (e[k] & 1) === 1;
    const strip = strips[e[k] >> 1];
    // the strip frame (s, t) onto edge k: E at corner k along it, the inner side t > 0; Ē turned 180° about its middle
    const ax = corners[k * 2];
    const ay = corners[k * 2 + 1];
    const bx = corners[((k + 1) % 3) * 2];
    const by = corners[((k + 1) % 3) * 2 + 1];
    const ux = (bx - ax) / L;
    const uy = (by - ay) / L;
    const m: Rigid = reversed ? { a: -ux, b: -uy, tx: bx, ty: by } : { a: ux, b: uy, tx: ax, ty: ay };
    for (const lipid of strip) {
      if (!clearOfCorners(lipid.positions, L, cornerRadius + delta)) continue;
      const head = headT(lipid);
      const mine = reversed ? head < 0 : head >= 0;
      (mine ? own : obstacles).push(mapPlaced(lipid, m));
    }
  }
  // corner discs (C > 1): heads within r_v of a corner, the disc turned to the corner's bisector
  if (params.vertexColors > 1) {
    for (let k = 0; k < 3; ++k) {
      const cx = corners[k * 2];
      const cy = corners[k * 2 + 1];
      const angle = Math.atan2((L * Sqrt3) / 6 - cy, L / 2 - cx);
      const disc = discs[c[k]];
      const turn: Rigid = { a: Math.cos(angle), b: Math.sin(angle), tx: cx, ty: cy };
      const cut = compose(turn, disc);
      for (const lipid of cutLeaflet(leaflet, cut, cx, cy, cornerRadius, () => true)) {
        if (wholeInside(lipid.positions, L, delta)) own.push(lipid);
      }
    }
  }
  const nearCorner = (x: number, y: number) => {
    if (params.vertexColors <= 1) return false;
    for (let k = 0; k < 3; ++k) {
      if ((x - corners[k * 2]) ** 2 + (y - corners[k * 2 + 1]) ** 2 <= cornerRadius * cornerRadius) return true;
    }
    return false;
  };
  const cut = compose({ a: 1, b: 0, tx: L / 2, ty: (L * Sqrt3) / 6 }, interiorCut);
  for (const lipid of cutLeaflet(
    leaflet,
    cut,
    L / 2,
    (L * Sqrt3) / 6,
    L / Sqrt3 + 1,
    (x, y) => !inBand(x, y) && !nearCorner(x, y),
  )) {
    if (wholeInside(lipid.positions, L, delta)) own.push(lipid);
  }

  const all = own.concat(obstacles);
  const ownCount = own.length;
  const alive = all.map(() => true);
  const grid = new AtomGrid(params.clash);
  for (let i = 0; i < all.length; ++i) grid.add(all[i].positions, i);
  const removed = removeClashes(all, ownCount, alive, grid, params.clash);
  // holes: candidates on a triangular lattice at half a lipid's spacing, tried where no head is near
  const spacing = Math.sqrt(leaflet.areaPerLipid);
  const heads = new AtomGrid(spacing);
  for (let i = 0; i < all.length; ++i) if (alive[i]) heads.addHead(all[i], i);
  const kept: Placed[] = [];
  for (let i = 0; i < ownCount; ++i) if (alive[i]) kept.push(all[i]);
  let filled = 0;
  // no denser than the patch: up to the template's area at its area a lipid
  const target = Math.round((Sqrt3 / 4) * L * L * (1 / leaflet.areaPerLipid));
  const step = spacing * 0.5;
  for (let y = delta + step / 2; y < (L * Sqrt3) / 2; y += step * 0.866) {
    for (let x = 0; x < L; x += step) {
      if (y > Sqrt3 * x - 2 * delta || y > Sqrt3 * (L - x) - 2 * delta) continue;
      if (kept.length >= target) break;
      if (heads.anyHeadWithin(x, y, spacing * 0.9)) continue;
      for (let t = 0; t < params.fillTries; ++t) {
        const lipid = placeLipid(leaflet, Math.floor(rand() * leaflet.lipidHead.length), x, y, rand() * 2 * Math.PI);
        if (!wholeInside(lipid.positions, L, delta) || grid.clashes(lipid.positions, params.clash, alive)) continue;
        const i = all.length;
        all.push(lipid);
        alive.push(true);
        grid.add(lipid.positions, i);
        heads.addHead(lipid, i);
        kept.push(lipid);
        filled += 1;
        break;
      }
    }
  }
  return pack(kept, removed, filled);
}

/** The edge coordinates of (x, y) for edge k: s along it from corner k, t inward */
function edgeCoords(corners: number[], k: number, L: number, x: number, y: number) {
  const ax = corners[k * 2];
  const ay = corners[k * 2 + 1];
  const ux = (corners[((k + 1) % 3) * 2] - ax) / L;
  const uy = (corners[((k + 1) % 3) * 2 + 1] - ay) / L;
  return { s: (x - ax) * ux + (y - ay) * uy, t: -(x - ax) * uy + (y - ay) * ux };
}

/** m ∘ n */
function compose(m: Rigid, n: Rigid): Rigid {
  return {
    a: m.a * n.a - m.b * n.b,
    b: m.b * n.a + m.a * n.b,
    tx: m.a * n.tx - m.b * n.ty + m.tx,
    ty: m.b * n.tx + m.a * n.ty + m.ty,
  };
}

const headT = (lipid: Placed) => lipid.positions[lipid.head * 3 + 1];

/** Lipid `source` of the leaflet turned by `theta`, its head at (x, y) */
function placeLipid(leaflet: Leaflet, source: number, x: number, y: number, theta: number): Placed {
  const start = leaflet.lipidAtomStart[source];
  const end = leaflet.lipidAtomStart[source + 1];
  const h = leaflet.lipidHead[source];
  const p = leaflet.positions;
  const a = Math.cos(theta);
  const b = Math.sin(theta);
  const positions = new Float32Array((end - start) * 3);
  for (let i = start; i < end; ++i) {
    const dx = p[i * 3] - p[h * 3];
    const dy = p[i * 3 + 1] - p[h * 3 + 1];
    const o = (i - start) * 3;
    positions[o] = a * dx - b * dy + x;
    positions[o + 1] = b * dx + a * dy + y;
    positions[o + 2] = p[i * 3 + 2];
  }
  return {
    species: leaflet.lipidSpecies[source],
    head: h - start,
    positions,
    elements: leaflet.elements.subarray(start, end),
  };
}

/**
 * Durrant's clash removal, worst first: the own lipids (the first `ownCount`) with atoms closer than `d` to another
 * lipid's removed, the one with most clashes first, until none; pairs of two fixed lipids (another tile's) ignored.
 * Bounded by the tile's lipids (a few hundred): the scan for the worst is per removal.
 */
function removeClashes(all: Placed[], ownCount: number, alive: boolean[], grid: AtomGrid, d: number) {
  const pairs: number[][] = all.map(() => []);
  for (let i = 0; i < all.length; ++i) {
    grid.forEachNear(all[i].positions, d, (j) => {
      if (j > i && (i < ownCount || j < ownCount)) {
        pairs[i].push(j);
        pairs[j].push(i);
      }
    });
  }
  const count = pairs.map((p) => p.length);
  let removed = 0;
  for (;;) {
    let worst = -1;
    for (let i = 0; i < ownCount; ++i)
      if (alive[i] && count[i] > 0 && (worst < 0 || count[i] > count[worst])) worst = i;
    if (worst < 0) break;
    alive[worst] = false;
    removed += 1;
    for (const j of pairs[worst]) if (alive[j]) count[j] -= 1;
    // fixed lipids clashing only with own ones: counted down, never removed
  }
  return removed;
}

/** A uniform grid of atoms (or heads) in the plane and z, by lipid: neighbours within its cell size */
class AtomGrid {
  private readonly cells = new Map<number, number[]>();
  private readonly lipids: Placed[] = [];
  constructor(private readonly size: number) {}

  private key(x: number, y: number, z: number) {
    return (
      (Math.floor(x / this.size) + 512) * 1048576 +
      (Math.floor(y / this.size) + 512) * 1024 +
      (Math.floor(z / this.size) + 512)
    );
  }

  /** the atoms of lipid `index`, stored as (index, atom) pairs */
  add(positions: Float32Array, index: number, lipid?: Placed) {
    if (lipid) this.lipids[index] = lipid;
    else this.lipids[index] = { species: 0, head: 0, positions, elements: new Uint8Array(0) };
    for (let a = 0; a < positions.length; a += 3)
      this.push(this.key(positions[a], positions[a + 1], positions[a + 2]), index, a);
  }

  /** the head of `lipid` alone, in the plane (z 0) */
  addHead(lipid: Placed, index: number) {
    this.lipids[index] = lipid;
    const h = lipid.head * 3;
    this.push(this.key(lipid.positions[h], lipid.positions[h + 1], 0), index, h);
  }

  private push(key: number, index: number, atom: number) {
    let cell = this.cells.get(key);
    if (!cell) this.cells.set(key, (cell = []));
    cell.push(index, atom);
  }

  /** calls `f` with each lipid having an atom within `d` (≤ the cell size) of an atom of `positions` (repeats possible) */
  forEachNear(positions: Float32Array, d: number, f: (index: number) => void) {
    const d2 = d * d;
    for (let a = 0; a < positions.length; a += 3) {
      const x = positions[a];
      const y = positions[a + 1];
      const z = positions[a + 2];
      for (let i = -1; i <= 1; ++i) {
        for (let j = -1; j <= 1; ++j) {
          for (let k = -1; k <= 1; ++k) {
            const cell = this.cells.get(this.key(x + i * this.size, y + j * this.size, z + k * this.size));
            if (!cell) continue;
            for (let c = 0; c < cell.length; c += 2) {
              const p = this.lipids[cell[c]].positions;
              const o = cell[c + 1];
              const dx = p[o] - x;
              const dy = p[o + 1] - y;
              const dz = p[o + 2] - z;
              if (dx * dx + dy * dy + dz * dz < d2 && p !== positions) f(cell[c]);
            }
          }
        }
      }
    }
  }

  /** whether an atom of `positions` is within `d` of a living lipid's */
  clashes(positions: Float32Array, d: number, alive: boolean[]) {
    let hit = false;
    this.forEachNear(positions, d, (j) => {
      if (alive[j]) hit = true;
    });
    return hit;
  }

  /** whether a head lies within `d` (≤ the cell size) of (x, y) */
  anyHeadWithin(x: number, y: number, d: number) {
    let hit = false;
    this.forEachNear(new Float32Array([x, y, 0]), d, () => {
      hit = true;
    });
    return hit;
  }
}

/** The kept lipids as a tile */
function pack(lipids: Placed[], removed: number, filled: number): Tile {
  let atoms = 0;
  for (const l of lipids) atoms += l.positions.length / 3;
  const positions = new Float32Array(atoms * 3);
  const elements = new Uint8Array(atoms);
  const lipidSpecies = new Uint16Array(lipids.length);
  const lipidAtomStart = new Uint32Array(lipids.length + 1);
  let a = 0;
  for (let i = 0; i < lipids.length; ++i) {
    lipidSpecies[i] = lipids[i].species;
    lipidAtomStart[i] = a;
    positions.set(lipids[i].positions, a * 3);
    elements.set(lipids[i].elements, a);
    a += lipids[i].positions.length / 3;
  }
  lipidAtomStart[lipids.length] = a;
  return { lipidSpecies, lipidAtomStart, positions, elements, removed, filled };
}

/** The sphere around every variant's atoms and the template */
function boundingSphere(variants: readonly Tile[], L: number): [number, number, number, number] {
  const cx = L / 2;
  const cy = (L * Sqrt3) / 6;
  let r = L / Sqrt3;
  for (const v of variants) {
    const p = v.positions;
    for (let i = 0; i < p.length; i += 3) r = Math.max(r, Math.hypot(p[i] - cx, p[i + 1] - cy, p[i + 2]));
  }
  return [cx, cy, 0, r];
}
