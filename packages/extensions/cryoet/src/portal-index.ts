/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// The CryoET Data Portal's index (_spec/portal.md §1): what a dataset holds, written offline by
// `tools/portal-index/` from the portal's client, because a browser cannot ask the portal's GraphQL (its CORS
// allow-list refuses other origins). Only file addresses reach the portal's file host, which serves any origin.

/** The format this reader takes; a file of another version is refused (its tool changed) */
export const PortalIndexVersion = 1;

/** The file host's address; every `path` of an index is relative to it */
export const PortalFiles = 'https://files.cryoetdataportal.cziscience.com/';
/** The portal's own pages: `datasets/<id>`, `runs/<id>` */
export const PortalPages = 'https://cryoetdataportal.czscience.com/';

/** The datasets an index offers, one line each (`index.json`) */
export interface PortalCatalog {
  readonly version: number;
  readonly datasets: readonly PortalDatasetSummary[];
}

export interface PortalDatasetSummary {
  readonly id: number;
  readonly title: string;
  readonly organism?: string;
  readonly runs: number;
}

/** One dataset (`<id>.json`) */
export interface PortalDataset extends PortalDatasetSummary {
  readonly version: number;
  /** When the tool read the portal, YYYY-MM-DD */
  readonly built: string;
  /** The dataset's publications' DOIs */
  readonly dois: readonly string[];
  /** Only the first runs of a large dataset: how many it has in all is `runs` */
  readonly runList: readonly PortalRun[];
  /** What decorates an annotation's points, by its object name (curated in the tool, not the portal's) */
  readonly decorations?: Readonly<Record<string, PortalDecoration>>;
}

export interface PortalDecoration {
  /** A PDB id, the particles' structure */
  readonly pdb?: string;
  /** An EMDB id, the subtomogram average shown beside the tomogram */
  readonly emdb?: string;
  /** The average's box center in the structure's frame (Å): where a point sits on the structure */
  readonly center?: readonly [number, number, number];
}

export interface PortalRun {
  readonly id: number;
  readonly name: string;
  readonly spacings: readonly PortalSpacing[];
}

/** A voxel spacing of a run: its tomograms and the annotations made on them */
export interface PortalSpacing {
  /** Å per voxel: the pixel size of the annotations' points */
  readonly spacing: number;
  readonly tomograms: readonly PortalTomogram[];
  readonly annotations: readonly PortalAnnotation[];
}

export interface PortalTomogram {
  readonly id: number;
  readonly name: string;
  readonly processing?: string;
  /** x, y, z voxels at the spacing */
  readonly size: readonly [number, number, number];
  /** The OME-Zarr, relative to `PortalFiles` */
  readonly zarr: string;
  readonly levels: readonly PortalLevel[];
}

/** A level of an OME-Zarr: its path in the zarr, its size and voxel (x, y, z), its bytes decoded */
export interface PortalLevel {
  readonly path: string;
  readonly size: readonly [number, number, number];
  readonly spacing: number;
  readonly bytes: number;
}

export type PortalShape =
  | 'OrientedPoint'
  | 'Point'
  | 'InstanceSegmentation'
  | 'SegmentationMask'
  | 'InstanceSegmentationMask'
  | 'Mesh';

export interface PortalAnnotation {
  readonly id: number;
  readonly object: string;
  readonly shape: PortalShape;
  /** ndjson, zarr, glb, mrc */
  readonly format: string;
  /** Relative to `PortalFiles` */
  readonly path: string;
  /** The file's size, bytes, when the host told it (a zarr's: its levels' decoded) */
  readonly bytes?: number;
  readonly count?: number;
  readonly groundTruth?: boolean;
  /** The portal shows it by default: a load takes it when no annotation is named */
  readonly default?: boolean;
  /** Its levels, a zarr's */
  readonly levels?: readonly PortalLevel[];
}

/** An index's file read and checked: an object of the version this viewer reads (its fields are trusted) */
export function checkPortalIndex<T extends { version?: unknown }>(json: T, what: string): T {
  if (!json || typeof json !== 'object') throw new Error(`${what} is not a portal index.`);
  if (json.version !== PortalIndexVersion) {
    throw new Error(
      `${what} is a portal index of version ${String(json.version)}; this viewer reads ${PortalIndexVersion}.`,
    );
  }
  return json;
}
