/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Column } from '../../mol-data/db';
import { Mat4, Vec3 } from '../../mol-math/linear-algebra';
import { CifBlock, CifField } from '../../mol-io/reader/cif';
import { CryoEtDataPortalNdjsonFile } from '../../mol-io/reader/cryoet/ndjson';
import { DynamoTblFile } from '../../mol-io/reader/dynamo/tbl';
import { RelionStarFile } from '../../mol-io/reader/relion/star';

export type ParticleDistanceUnit = 'pixel' | 'angstrom';
export type ParticleMetadataValue = string | number | boolean | undefined;

export interface Particle {
    readonly index: number
    readonly coordinate: Vec3
    readonly coordinateUnit: ParticleDistanceUnit
    readonly origin: Vec3
    readonly originUnit: ParticleDistanceUnit
    readonly originRotation?: Mat4
    readonly rotation: Mat4
    readonly metadata?: Readonly<Record<string, ParticleMetadataValue>>
}

export interface ParticlesData {
    readonly format: string
    readonly label: string
    readonly particles: ReadonlyArray<Particle>
    readonly pixelSize?: number
    readonly suggestedScale: number
    readonly warnings: ReadonlyArray<string>
    readonly sourceData: unknown
}

export interface RelionParticlesOptions {
    readonly label?: string
    readonly tomogram?: string
}

export interface DynamoParticlesOptions {
    readonly label?: string
    readonly tomo?: number
}

export interface CryoEtDataPortalParticlesOptions {
    readonly label?: string
    readonly coordinateUnit?: ParticleDistanceUnit
    readonly type?: string
}

type TripletFieldSpec = {
    x: readonly string[]
    y: readonly string[]
    z: readonly string[]
    unit: ParticleDistanceUnit
};

const RelionCoordinateSpecs: TripletFieldSpec[] = [
    { x: ['rlnCenteredCoordinateXAngst', 'rlnCenteredCoordinateXAngstrom'], y: ['rlnCenteredCoordinateYAngst', 'rlnCenteredCoordinateYAngstrom'], z: ['rlnCenteredCoordinateZAngst', 'rlnCenteredCoordinateZAngstrom'], unit: 'angstrom' },
    { x: ['rlnCoordinateX'], y: ['rlnCoordinateY'], z: ['rlnCoordinateZ'], unit: 'pixel' },
];

const RelionOriginSpecs: TripletFieldSpec[] = [
    { x: ['rlnOriginXAngst', 'rlnOriginXAngstrom'], y: ['rlnOriginYAngst', 'rlnOriginYAngstrom'], z: ['rlnOriginZAngst', 'rlnOriginZAngstrom'], unit: 'angstrom' },
    { x: ['rlnOriginX'], y: ['rlnOriginY'], z: ['rlnOriginZ'], unit: 'pixel' },
];

const RelionParticleAngleSpecs = [
    { rot: ['rlnAngleRot'], tilt: ['rlnAngleTilt'], psi: ['rlnAnglePsi'] },
];

const RelionSubtomogramAngleSpecs = [
    { rot: ['rlnTomoSubtomogramRot'], tilt: ['rlnTomoSubtomogramTilt'], psi: ['rlnTomoSubtomogramPsi'] },
];

const RelionPixelSizeFields = [
    'rlnTomoTiltSeriesPixelSize',
    'rlnImagePixelSize',
    'rlnMicrographPixelSize',
    'rlnDetectorPixelSize',
];

const RelionTomogramFields = ['rlnTomoName'];

const DynamoShiftColumn = 3;
const DynamoAngleColumn = 6;
const DynamoTomoColumn = 19;
const DynamoRegionColumn = 20;
const DynamoClassColumn = 21;
const DynamoAnnotationColumn = 22;
const DynamoPositionColumn = 23;
const DynamoPixelSizeColumn = 35;

function getFlatField(block: CifBlock, name: string) {
    return block.categories[name]?.getField('');
}

function getFirstFlatField(block: CifBlock, names: readonly string[]) {
    for (const name of names) {
        const field = getFlatField(block, name);
        if (field) return field;
    }
}

function hasPresentValue(field: CifField | undefined, row: number) {
    return !!field && field.valueKind(row) === Column.ValueKinds.Present;
}

function getOptionalNumber(field: CifField | undefined, row: number) {
    return hasPresentValue(field, row) ? field!.float(row) : void 0;
}

function getOptionalString(field: CifField | undefined, row: number) {
    return hasPresentValue(field, row) ? field!.str(row) : void 0;
}

function getFieldRowCount(field: CifField | undefined, block: CifBlock, name: string) {
    return field ? block.categories[name].rowCount : 0;
}

function getTripletFields(block: CifBlock, spec: TripletFieldSpec) {
    const xName = spec.x.find(name => !!getFlatField(block, name));
    const yName = spec.y.find(name => !!getFlatField(block, name));
    const zName = spec.z.find(name => !!getFlatField(block, name));

    if (!xName || !yName) return;

    return {
        xName,
        yName,
        zName,
        x: getFlatField(block, xName)!,
        y: getFlatField(block, yName)!,
        z: zName ? getFlatField(block, zName) : void 0,
        rowCount: block.categories[xName].rowCount,
        unit: spec.unit,
    };
}

function getTripletFieldsFromSpecs(block: CifBlock, specs: readonly TripletFieldSpec[]) {
    for (const spec of specs) {
        const fields = getTripletFields(block, spec);
        if (fields) return fields;
    }
}

function getTripletValue(block: CifBlock, row: number, specs: readonly TripletFieldSpec[]) {
    for (const spec of specs) {
        const fields = getTripletFields(block, spec);
        if (!fields) continue;

        const x = getOptionalNumber(fields.x, row);
        const y = getOptionalNumber(fields.y, row);
        const z = getOptionalNumber(fields.z, row);
        if (x === void 0 || y === void 0) continue;

        return {
            value: Vec3.create(x, y, z ?? 0),
            unit: fields.unit,
        };
    }
}

function getAngles(block: CifBlock, row: number, specs: ReadonlyArray<{ rot: readonly string[], tilt: readonly string[], psi: readonly string[] }>) {
    for (const spec of specs) {
        const rot = getOptionalNumber(getFirstFlatField(block, spec.rot), row);
        const tilt = getOptionalNumber(getFirstFlatField(block, spec.tilt), row);
        const psi = getOptionalNumber(getFirstFlatField(block, spec.psi), row);
        if (rot === void 0 && tilt === void 0 && psi === void 0) continue;
        return {
            rot: rot ?? 0,
            tilt: tilt ?? 0,
            psi: psi ?? 0,
        };
    }
}

function getNumericFieldUniqueValue(block: CifBlock | undefined, names: readonly string[]) {
    if (!block) return;

    for (const name of names) {
        const field = getFlatField(block, name);
        if (!field) continue;

        const rowCount = getFieldRowCount(field, block, name);
        let value: number | undefined = void 0;
        let isUnique = true;

        for (let i = 0; i < rowCount; ++i) {
            const current = getOptionalNumber(field, i);
            if (current === void 0) continue;
            if (value === void 0) {
                value = current;
            } else if (Math.abs(value - current) > 1e-6) {
                isUnique = false;
                break;
            }
        }

        if (isUnique && value !== void 0 && Number.isFinite(value) && value > 0) return value;
    }
}

function getNumericFieldValueAtRow(block: CifBlock | undefined, names: readonly string[], row: number) {
    if (!block) return;

    for (const name of names) {
        const field = getFlatField(block, name);
        const value = getOptionalNumber(field, row);
        if (value !== void 0 && Number.isFinite(value) && value > 0) return value;
    }
}

function getUniquePositiveFieldValueForRows(block: CifBlock | undefined, names: readonly string[], rows: Iterable<number>) {
    if (!block) return;

    let value: number | undefined = void 0;
    let hasValue = false;

    for (const row of rows) {
        const current = getNumericFieldValueAtRow(block, names, row);
        if (current === void 0) continue;
        hasValue = true;
        if (value === void 0) {
            value = current;
        } else if (Math.abs(value - current) > 1e-6) {
            return;
        }
    }

    return hasValue ? value : void 0;
}

function getUniquePositiveColumnValue(rows: ReadonlyArray<Float64Array>, column: number) {
    let value: number | undefined = void 0;
    for (const row of rows) {
        const current = row[column];
        if (!Number.isFinite(current) || current <= 0) continue;
        if (value === void 0) {
            value = current;
        } else if (Math.abs(value - current) > 1e-6) {
            return;
        }
    }
    return value;
}

function degToRad(value: number) {
    return value * Math.PI / 180;
}

function relionEulerToRotation(out: Mat4, rot: number, tilt: number, psi: number) {
    const rotZ = Mat4.fromRotation(Mat4(), degToRad(rot), Vec3.unitZ);
    const tiltY = Mat4.fromRotation(Mat4(), degToRad(tilt), Vec3.unitY);
    const psiZ = Mat4.fromRotation(Mat4(), degToRad(psi), Vec3.unitZ);

    Mat4.mul(out, tiltY, rotZ);
    Mat4.mul(out, psiZ, out);
    return out;
}

function dynamoEulerToRotation(out: Mat4, tdrot: number, tilt: number, narot: number) {
    const tdrotZ = Mat4.fromRotation(Mat4(), degToRad(-tdrot), Vec3.unitZ);
    const tiltX = Mat4.fromRotation(Mat4(), degToRad(tilt), Vec3.unitX);
    const narotZ = Mat4.fromRotation(Mat4(), degToRad(-narot), Vec3.unitZ);

    Mat4.mul(out, tiltX, tdrotZ);
    Mat4.mul(out, narotZ, out);
    return out;
}

function setRotationFromRowMajor3x3(out: Mat4, values: ArrayLike<number>) {
    Mat4.setIdentity(out);
    Mat4.setValue(out, 0, 0, values[0]);
    Mat4.setValue(out, 0, 1, values[1]);
    Mat4.setValue(out, 0, 2, values[2]);
    Mat4.setValue(out, 1, 0, values[3]);
    Mat4.setValue(out, 1, 1, values[4]);
    Mat4.setValue(out, 1, 2, values[5]);
    Mat4.setValue(out, 2, 0, values[6]);
    Mat4.setValue(out, 2, 1, values[7]);
    Mat4.setValue(out, 2, 2, values[8]);
    return out;
}

function cryoEtRotationToMat4(out: Mat4, matrix: unknown) {
    if (matrix === void 0) return Mat4.setIdentity(out);

    if (Array.isArray(matrix) && matrix.length === 9 && matrix.every(value => Number.isFinite(value))) {
        return setRotationFromRowMajor3x3(out, matrix as ArrayLike<number>);
    }

    if (Array.isArray(matrix) && matrix.length === 3 && matrix.every(row => Array.isArray(row) && row.length === 3)) {
        const flat: number[] = [];
        for (const row of matrix as ReadonlyArray<ReadonlyArray<number>>) {
            for (const value of row) flat.push(value);
        }
        if (flat.every(value => Number.isFinite(value))) {
            return setRotationFromRowMajor3x3(out, flat);
        }
    }

    throw new Error('Unsupported CryoET Data Portal xyz_rotation_matrix format.');
}

function buildRelionLabel(particleBlockHeader: string, tomogram?: string) {
    if (tomogram) return `${particleBlockHeader || 'RELION'} particles (${tomogram})`;
    return `${particleBlockHeader || 'RELION'} particles`;
}

function buildDynamoLabel(tomo?: number) {
    if (tomo !== void 0) return `Dynamo particles (tomo ${tomo})`;
    return 'Dynamo particles';
}

function buildCryoEtLabel(type?: string) {
    if (type) return `CryoET Data Portal particles (${type})`;
    return 'CryoET Data Portal particles';
}

function getRelionSelectedPixelSize(particleBlock: CifBlock, opticsBlock: CifBlock | undefined, selectedRows: readonly number[]) {
    if (selectedRows.length === 0) return;

    const particlePixelSize = getUniquePositiveFieldValueForRows(particleBlock, RelionPixelSizeFields, selectedRows);
    if (particlePixelSize !== void 0) return particlePixelSize;

    const particleOpticsGroup = getFlatField(particleBlock, 'rlnOpticsGroup');
    if (!opticsBlock) {
        return getNumericFieldUniqueValue(opticsBlock, RelionPixelSizeFields) ?? getNumericFieldUniqueValue(particleBlock, RelionPixelSizeFields);
    }
    const opticsGroupField = getFlatField(opticsBlock, 'rlnOpticsGroup');
    if (!particleOpticsGroup || !opticsGroupField) {
        return getNumericFieldUniqueValue(opticsBlock, RelionPixelSizeFields) ?? getNumericFieldUniqueValue(particleBlock, RelionPixelSizeFields);
    }

    const selectedGroups = new Set<string>();
    for (const row of selectedRows) {
        const group = getOptionalString(particleOpticsGroup, row);
        if (group) selectedGroups.add(group);
    }

    if (selectedGroups.size === 0) {
        return getNumericFieldUniqueValue(opticsBlock, RelionPixelSizeFields) ?? getNumericFieldUniqueValue(particleBlock, RelionPixelSizeFields);
    }

    const matchingOpticsRows: number[] = [];
    const opticsRowCount = getFieldRowCount(opticsGroupField, opticsBlock, 'rlnOpticsGroup');
    for (let row = 0; row < opticsRowCount; ++row) {
        const group = getOptionalString(opticsGroupField, row);
        if (group && selectedGroups.has(group)) matchingOpticsRows.push(row);
    }

    return getUniquePositiveFieldValueForRows(opticsBlock, RelionPixelSizeFields, matchingOpticsRows);
}

export function getParticleTranslation(out: Vec3, particle: Particle, positionScale: number) {
    const coordinateScale = particle.coordinateUnit === 'pixel' ? positionScale : 1;
    const originScale = particle.originUnit === 'pixel' ? positionScale : 1;

    Vec3.scale(out, particle.coordinate, coordinateScale);
    const originShift = Vec3.scale(Vec3(), particle.origin, originScale);
    if (particle.originRotation) {
        Vec3.transformMat4(originShift, originShift, particle.originRotation);
    }
    Vec3.sub(out, out, originShift);
    return out;
}

export function getParticleTransform(out: Mat4, particle: Particle, positionScale: number) {
    Mat4.copy(out, particle.rotation);
    Mat4.setTranslation(out, getParticleTranslation(Vec3(), particle, positionScale));
    return out;
}

export function getParticleTransforms(data: ParticlesData, positionScale: number) {
    return data.particles.map(particle => getParticleTransform(Mat4(), particle, positionScale));
}

export function getRelionStarTomogramNames(data: RelionStarFile) {
    const tomoField = getFirstFlatField(data.particleBlock, RelionTomogramFields);
    const tomograms = new Set<string>();
    if (!tomoField) return [];

    const rowCount = getFieldRowCount(tomoField, data.particleBlock, RelionTomogramFields[0]);
    for (let row = 0; row < rowCount; ++row) {
        const tomoName = getOptionalString(tomoField, row);
        if (tomoName) tomograms.add(tomoName);
    }
    return Array.from(tomograms).sort();
}

export function getDynamoTblTomogramIds(data: DynamoTblFile) {
    const tomograms = new Set<number>();
    for (const row of data.rows) {
        const tomo = row[DynamoTomoColumn];
        if (Number.isFinite(tomo)) tomograms.add(tomo);
    }
    return Array.from(tomograms).sort((a, b) => a - b);
}

export function createParticlesFromRelionStar(data: RelionStarFile, options: RelionParticlesOptions = {}): ParticlesData {
    const { particleBlock, opticsBlock } = data;
    const coordinateFields = getTripletFieldsFromSpecs(particleBlock, RelionCoordinateSpecs);
    if (!coordinateFields) throw new Error(`Block '${particleBlock.header}' does not define supported particle coordinates.`);

    const rowCount = coordinateFields.rowCount;
    const opticsGroupField = getFlatField(particleBlock, 'rlnOpticsGroup');
    const tomoField = getFirstFlatField(particleBlock, RelionTomogramFields);
    const warnings: string[] = [];
    const particles: Particle[] = [];
    const selectedRows: number[] = [];

    for (let row = 0; row < rowCount; ++row) {
        const tomoName = getOptionalString(tomoField, row);
        if (options.tomogram && tomoName !== options.tomogram) continue;

        const coordinate = getTripletValue(particleBlock, row, RelionCoordinateSpecs);
        if (!coordinate) continue;

        const origin = getTripletValue(particleBlock, row, RelionOriginSpecs) ?? { value: Vec3.create(0, 0, 0), unit: 'pixel' as const };
        const particleAngles = getAngles(particleBlock, row, RelionParticleAngleSpecs) ?? { rot: 0, tilt: 0, psi: 0 };
        const subtomogramAngles = getAngles(particleBlock, row, RelionSubtomogramAngleSpecs);
        const subtomogram = subtomogramAngles
            ? relionEulerToRotation(Mat4(), subtomogramAngles.rot, subtomogramAngles.tilt, subtomogramAngles.psi)
            : void 0;
        const rotation = relionEulerToRotation(Mat4(), particleAngles.rot, particleAngles.tilt, particleAngles.psi);
        if (subtomogram) {
            Mat4.mul(rotation, subtomogram, rotation);
        }

        selectedRows.push(row);
        particles.push({
            index: row,
            coordinate: coordinate.value,
            coordinateUnit: coordinate.unit,
            origin: origin.value,
            originUnit: origin.unit,
            originRotation: subtomogram ? Mat4.copy(Mat4(), subtomogram) : void 0,
            rotation,
            metadata: {
                tomoName,
                opticsGroup: getOptionalString(opticsGroupField, row),
                particleRot: particleAngles.rot,
                particleTilt: particleAngles.tilt,
                particlePsi: particleAngles.psi,
                subtomogramRot: subtomogramAngles?.rot,
                subtomogramTilt: subtomogramAngles?.tilt,
                subtomogramPsi: subtomogramAngles?.psi,
            }
        });
    }

    if (particles.length === 0) {
        throw new Error(options.tomogram
            ? `No RELION particle rows matched tomogram '${options.tomogram}'.`
            : `Block '${particleBlock.header}' does not contain any readable particle rows.`);
    }

    if (!getAngles(particleBlock, 0, RelionParticleAngleSpecs) && !getAngles(particleBlock, 0, RelionSubtomogramAngleSpecs)) {
        warnings.push('No RELION rotation columns were found; particle rotations default to identity.');
    }

    const pixelSize = coordinateFields.unit === 'pixel'
        ? getRelionSelectedPixelSize(particleBlock, opticsBlock, selectedRows)
        : void 0;

    if (coordinateFields.unit === 'pixel' && pixelSize === void 0) {
        warnings.push('RELION particle coordinates are pixel-space, but no unique positive pixel size was found; pixel-space coordinates default to scale 1.');
    }

    return {
        format: 'relion-star',
        label: options.label ?? buildRelionLabel(particleBlock.header, options.tomogram),
        particles,
        pixelSize,
        suggestedScale: pixelSize ?? 1,
        warnings,
        sourceData: data,
    };
}

export function createParticlesFromDynamoTbl(data: DynamoTblFile, options: DynamoParticlesOptions = {}): ParticlesData {
    const warnings: string[] = [];
    const particles: Particle[] = [];
    const selectedRows: Float64Array[] = [];

    for (let index = 0, il = data.rows.length; index < il; ++index) {
        const row = data.rows[index];
        if (options.tomo !== void 0 && row[DynamoTomoColumn] !== options.tomo) continue;

        const coordinate = Vec3.create(
            row[DynamoPositionColumn + 0] + row[DynamoShiftColumn + 0],
            row[DynamoPositionColumn + 1] + row[DynamoShiftColumn + 1],
            row[DynamoPositionColumn + 2] + row[DynamoShiftColumn + 2],
        );

        particles.push({
            index,
            coordinate,
            coordinateUnit: 'pixel',
            origin: Vec3.create(0, 0, 0),
            originUnit: 'pixel',
            rotation: dynamoEulerToRotation(Mat4(), row[DynamoAngleColumn + 0], row[DynamoAngleColumn + 1], row[DynamoAngleColumn + 2]),
            metadata: {
                tag: row[0],
                tomo: row[DynamoTomoColumn],
                region: row[DynamoRegionColumn],
                class: row[DynamoClassColumn],
                annotation: row[DynamoAnnotationColumn],
                apix: row[DynamoPixelSizeColumn],
                tdrot: row[DynamoAngleColumn + 0],
                tilt: row[DynamoAngleColumn + 1],
                narot: row[DynamoAngleColumn + 2],
            }
        });
        selectedRows.push(row);
    }

    if (particles.length === 0) {
        throw new Error(options.tomo !== void 0
            ? `No Dynamo particle rows matched tomo '${options.tomo}'.`
            : 'No readable Dynamo table rows were found.');
    }

    const pixelSize = getUniquePositiveColumnValue(selectedRows, DynamoPixelSizeColumn);
    if (pixelSize === void 0) {
        warnings.push('Dynamo particle coordinates are pixel-space, but no unique positive pixel size was found; pixel-space coordinates default to scale 1.');
    }

    return {
        format: 'dynamo-tbl',
        label: options.label ?? buildDynamoLabel(options.tomo),
        particles,
        pixelSize,
        suggestedScale: pixelSize ?? 1,
        warnings,
        sourceData: data,
    };
}

export function createParticlesFromCryoEtDataPortalNdjson(data: CryoEtDataPortalNdjsonFile, options: CryoEtDataPortalParticlesOptions = {}): ParticlesData {
    const coordinateUnit = options.coordinateUnit ?? 'pixel';
    const warnings: string[] = [];
    const particles: Particle[] = [];

    for (let index = 0, il = data.records.length; index < il; ++index) {
        const record = data.records[index];
        if (options.type && record.type !== options.type) continue;

        particles.push({
            index,
            coordinate: Vec3.create(record.location.x, record.location.y, record.location.z),
            coordinateUnit,
            origin: Vec3.create(0, 0, 0),
            originUnit: coordinateUnit,
            rotation: cryoEtRotationToMat4(Mat4(), record.xyz_rotation_matrix),
            metadata: {
                type: record.type,
                instanceId: record.instance_id,
            }
        });
    }

    if (particles.length === 0) {
        throw new Error(options.type
            ? `No CryoET Data Portal ndjson records matched type '${options.type}'.`
            : 'No readable CryoET Data Portal ndjson particle records were found.');
    }

    if (options.coordinateUnit === void 0) {
        warnings.push('CryoET Data Portal ndjson does not encode distance units; coordinates are treated as pixel-space by default.');
    }

    return {
        format: 'cryoet-data-portal-ndjson',
        label: options.label ?? buildCryoEtLabel(options.type),
        particles,
        pixelSize: void 0,
        suggestedScale: 1,
        warnings,
        sourceData: data,
    };
}
