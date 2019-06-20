/**
 * Copyright (c) 2018 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { Box3D, Sphere3D } from '../../../../mol-math/geometry';
import { BoundaryHelper } from '../../../../mol-math/geometry/boundary-helper';
import { Vec3 } from '../../../../mol-math/linear-algebra';
import Structure from '../structure';

export type Boundary = { box: Box3D, sphere: Sphere3D }

const tmpBox = Box3D.empty()
const tmpSphere = Sphere3D.zero()

const boundaryHelper = new BoundaryHelper();

export function computeStructureBoundary(s: Structure): Boundary {
    const min = Vec3.create(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE)
    const max = Vec3.create(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE)

    const { units } = s;

    boundaryHelper.reset(0);

    for (let i = 0, _i = units.length; i < _i; i++) {
        const u = units[i];
        const invariantBoundary = u.lookup3d.boundary;
        const o = u.conformation.operator;

        if (o.isIdentity) {
            Vec3.min(min, min, invariantBoundary.box.min);
            Vec3.max(max, max, invariantBoundary.box.max);

            boundaryHelper.boundaryStep(invariantBoundary.sphere.center, invariantBoundary.sphere.radius);
        } else {
            Box3D.transform(tmpBox, invariantBoundary.box, o.matrix);
            Vec3.min(min, min, tmpBox.min);
            Vec3.max(max, max, tmpBox.max);

            Sphere3D.transform(tmpSphere, invariantBoundary.sphere, o.matrix);
            boundaryHelper.boundaryStep(tmpSphere.center, tmpSphere.radius);
        }
    }

    boundaryHelper.finishBoundaryStep();

    for (let i = 0, _i = units.length; i < _i; i++) {
        const u = units[i];
        const invariantBoundary = u.lookup3d.boundary;
        const o = u.conformation.operator;

        if (o.isIdentity) {
            boundaryHelper.extendStep(invariantBoundary.sphere.center, invariantBoundary.sphere.radius);
        } else {
            Sphere3D.transform(tmpSphere, invariantBoundary.sphere, o.matrix);
            boundaryHelper.extendStep(tmpSphere.center, tmpSphere.radius);
        }
    }

    return { box: { min, max }, sphere: boundaryHelper.getSphere() };
}