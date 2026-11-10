/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

export {
  type IRShape,
  type IRNode,
  type IRNodeOf,
  type IRKind,
  type IRLook,
  type IRView,
  type IR,
  walk,
  placementSets,
  irToJson,
} from './ir.js';
export {
  type PlacementType,
  type PlacementSet,
  BytesPerPlacement,
  placementBytes,
  PlacementBuilder,
  IdentityQuat,
  quatFromTo,
  rotateVec,
  mulQuat,
  rotationOf,
} from './placements.js';
export {
  type MesoLocation,
  type MesoLoci,
  type CopyRuns,
  type VoxelBox,
  EmptyLoci,
  lociOfCopies,
  unionRuns,
  intersectRuns,
  subtractRuns,
  runsSize,
  lociSize,
  typeRuns,
  type LociContext,
  evaluateMesoQL,
  lociToIds,
  lociSphere,
} from './loci.js';
export { contentHash } from './hash.js';
