/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Column } from '../../mol-data/db';
import { CifBlock, CifField } from '../../mol-io/reader/cif';
import { Mat4, Vec3 } from '../../mol-math/linear-algebra';
import { ParticleList } from '../../mol-model/particles/particle-list';
import { RelionStarFile } from '../../mol-io/reader/relion/star';
import { packParticleList } from './common';
import { degToRad } from '../../mol-math/misc';

type TripletFieldSpec = {
    x: readonly string[]
    y: readonly string[]
    z: readonly string[]
    unit: 'pixel' | 'angstrom'
};

type Angles = { rot: number, tilt: number, psi: number };

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

function getAngles(block: CifBlock, row: number, specs: ReadonlyArray<{ rot: readonly string[], tilt: readonly string[], psi: readonly string[] }>): Angles | undefined {
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

function relionEulerToRotation(out: Mat4, rot: number, tilt: number, psi: number) {
    const rotZ = Mat4.fromRotation(Mat4(), degToRad(rot), Vec3.unitZ);
    const tiltY = Mat4.fromRotation(Mat4(), degToRad(tilt), Vec3.unitY);
    const psiZ = Mat4.fromRotation(Mat4(), degToRad(psi), Vec3.unitZ);

    Mat4.mul(out, tiltY, rotZ);
    Mat4.mul(out, psiZ, out);
    return out;
}

export interface RelionParticleListOptions {
    readonly label?: string
    readonly tomogram?: string
}

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

function buildRelionLabel(particleBlockHeader: string, tomogram?: string) {
    if (tomogram) return `${particleBlockHeader || 'RELION'} particles (${tomogram})`;
    return `${particleBlockHeader || 'RELION'} particles`;
}

function getRelionSelectedPixelSize(particleBlock: RelionStarFile['particleBlock'], opticsBlock: RelionStarFile['opticsBlock'], selectedRows: readonly number[]) {
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

function hasAnyRotationColumn(particleBlock: RelionStarFile['particleBlock']) {
    return !!getFirstFlatField(particleBlock, RelionParticleAngleSpecs[0].rot)
        || !!getFirstFlatField(particleBlock, RelionParticleAngleSpecs[0].tilt)
        || !!getFirstFlatField(particleBlock, RelionParticleAngleSpecs[0].psi)
        || !!getFirstFlatField(particleBlock, RelionSubtomogramAngleSpecs[0].rot)
        || !!getFirstFlatField(particleBlock, RelionSubtomogramAngleSpecs[0].tilt)
        || !!getFirstFlatField(particleBlock, RelionSubtomogramAngleSpecs[0].psi);
}

function getCombinedRotation(particleAngles: Angles, subtomogramAngles: Angles | undefined) {
    const rotation = relionEulerToRotation(Mat4(), particleAngles.rot, particleAngles.tilt, particleAngles.psi);
    if (subtomogramAngles) {
        const subtomogram = relionEulerToRotation(Mat4(), subtomogramAngles.rot, subtomogramAngles.tilt, subtomogramAngles.psi);
        Mat4.mul(rotation, subtomogram, rotation);
    }
    return rotation;
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

export function createParticleListFromRelionStar(data: RelionStarFile, options: RelionParticleListOptions = {}): ParticleList {
    const { particleBlock, opticsBlock } = data;
    const coordinateFields = getTripletFieldsFromSpecs(particleBlock, RelionCoordinateSpecs);
    if (!coordinateFields) throw new Error(`Block '${particleBlock.header}' does not define supported particle coordinates.`);

    const rowCount = coordinateFields.rowCount;
    const particleData: {
        coordinate: Vec3
        coordinateUnit: 'pixel' | 'angstrom'
        origin: Vec3
        originUnit: 'pixel' | 'angstrom'
        rotation: Mat4
        originRotation?: Mat4
    }[] = [];
    const selectedRows: number[] = [];

    const tomoField = getFirstFlatField(particleBlock, RelionTomogramFields);

    for (let row = 0; row < rowCount; ++row) {
        const tomoName = getOptionalString(tomoField, row);
        if (options.tomogram && tomoName !== options.tomogram) continue;

        const coordinate = getTripletValue(particleBlock, row, RelionCoordinateSpecs);
        if (!coordinate) continue;

        const origin = getTripletValue(particleBlock, row, RelionOriginSpecs) ?? { value: Vec3.create(0, 0, 0), unit: 'pixel' as const };
        const particleAngles = getAngles(particleBlock, row, RelionParticleAngleSpecs) ?? { rot: 0, tilt: 0, psi: 0 };
        const subtomogramAngles = getAngles(particleBlock, row, RelionSubtomogramAngleSpecs);

        particleData.push({
            coordinate: coordinate.value,
            coordinateUnit: coordinate.unit,
            origin: origin.value,
            originUnit: origin.unit,
            originRotation: subtomogramAngles ? relionEulerToRotation(Mat4(), subtomogramAngles.rot, subtomogramAngles.tilt, subtomogramAngles.psi) : void 0,
            rotation: getCombinedRotation(particleAngles, subtomogramAngles),
        });
        selectedRows.push(row);
    }

    if (particleData.length === 0) {
        throw new Error(options.tomogram
            ? `No RELION particle rows matched tomogram '${options.tomogram}'.`
            : `Block '${particleBlock.header}' does not contain any readable particle rows.`);
    }

    const pixelSize = coordinateFields.unit === 'pixel'
        ? getRelionSelectedPixelSize(particleBlock, opticsBlock, selectedRows)
        : void 0;

    return packParticleList(
        options.label ?? buildRelionLabel(particleBlock.header, options.tomogram),
        coordinateFields.unit,
        pixelSize,
        particleData,
        {
            data,
            format: 'relion-star',
            warnings: [
                !hasAnyRotationColumn(particleBlock) ? 'No RELION rotation columns were found; particle rotations default to identity.' : void 0,
                coordinateFields.unit === 'pixel' && pixelSize === void 0
                    ? 'RELION particle coordinates are pixel-space, but no unique positive pixel size was found; pixel-space coordinates default to scale 1.'
                    : void 0,
            ].filter((v): v is string => !!v)
        }
    );
}
