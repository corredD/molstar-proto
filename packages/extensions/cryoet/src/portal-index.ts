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
  /** Its tilt series (optional: an index without them is of version 1 still) */
  readonly tiltSeries?: readonly PortalTiltSeries[];
}

/**
 * A tilt series: its images as an OME-Zarr whose z is the image index, not a distance (only x, y are binned), and the
 * tilt angle of each image
 */
export interface PortalTiltSeries {
  readonly id: number;
  /** The OME-Zarr, relative to `PortalFiles` */
  readonly zarr: string;
  /** Its levels: size x, y, images; `spacing` is x's (the zarr's scale, not the portal's pixel size) */
  readonly levels: readonly PortalLevel[];
  /** Å a pixel, the portal's */
  readonly pixelSpacing: number;
  /** The tilt axis' angle in the image (°) */
  readonly tiltAxis: number;
  /** The tilt angle of each image (°): `angles[i]` is image i (z i), by the portal's z index, not by angle */
  readonly angles: readonly number[];
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
  /** raw, filtered, denoised */
  readonly processing?: string;
  /** The reconstruction method: WBP, SART, Fourier_Space, … (each of these four, when the portal has it) */
  readonly method?: string;
  /** The reconstruction's software and version: 'AreTomo3 v2.3.0' */
  readonly reconstructionSoftware?: string;
  /** The processing's software: 'IsoNet2', 'DeepDeWedge' */
  readonly processingSoftware?: string;
  /** The tilt series alignment it was reconstructed from (the portal's AL-<id>) */
  readonly alignment?: number;
  /** The portal shows it by default; of several flagged in a run, the lowest id (as the portal's run page) */
  readonly default?: boolean;
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
  /** What it is, the portal's words ('chloramphenicol bound 70S ribosome'); each of these three when the portal has it */
  readonly description?: string;
  /** How it was made ('Template matching + manual filtering + 3D classification filtering') */
  readonly method?: string;
  /** Its object's Gene Ontology term ('GO:0022626'); another kind of id (UniProtKB:…) is not kept */
  readonly goId?: string;
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
