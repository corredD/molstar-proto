/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ChunkedArray } from '../../../mol-data/util';
import { OrderedSet } from '../../../mol-data/int';
import { Lines } from '../../../mol-geo/geometry/lines/lines';
import { Mesh } from '../../../mol-geo/geometry/mesh/mesh';
import { MeshBuilder } from '../../../mol-geo/geometry/mesh/mesh-builder';
import { Shape, ShapeGroup } from '../../../mol-model/shape';
import { MarkerAction } from '../../../mol-util/marker-action';
import { ParamDefinition as PD } from '../../../mol-util/param-definition';
import { ColorNames } from '../../../mol-util/color/names';
import { ShapeMultiRepresentation, ShapeRepresentation } from '../representation';

function triangleMesh(): Mesh {
    const state = MeshBuilder.createState(3, 1);
    ChunkedArray.add3(state.vertices, 0, 0, 0);
    ChunkedArray.add3(state.vertices, 1, 0, 0);
    ChunkedArray.add3(state.vertices, 0, 1, 0);
    for (let i = 0; i < 3; i++) ChunkedArray.add(state.groups, i);
    ChunkedArray.add3(state.indices, 0, 1, 2);
    return MeshBuilder.getMesh(state);
}

const Params = {
    ...Mesh.Params,
    ...Lines.Params,
    visuals: PD.MultiSelect(['mesh'], PD.arrayToOptions(['mesh', 'wireframe'] as const)),
};

function shapeOf<G extends Mesh | Lines>(name: string, geometry: G) {
    return Shape.create(
        name, {}, geometry,
        () => ColorNames.red, () => 1, (gid: number) => `Vertex ${gid}`,
        undefined, 3
    );
}

function makeRepr() {
    const mesh = triangleMesh();
    const meshShape = shapeOf('test-mesh', mesh);
    const linesShape = shapeOf('test-mesh-wireframe', Lines.fromMesh(mesh));
    const repr = ShapeMultiRepresentation('Test', Params, {
        mesh: ShapeRepresentation(() => meshShape, Mesh.Utils),
        wireframe: ShapeRepresentation(() => linesShape, Lines.Utils),
    });
    return { repr, meshShape, linesShape };
}

function markerAverages(repr: ReturnType<typeof makeRepr>['repr']) {
    return Object.fromEntries(repr.renderObjects.map(o => [o.type, (o.values as any).markerAverage.ref.value]));
}

describe('ShapeMultiRepresentation', () => {
    it('shows only the visuals named in `visuals`', async () => {
        const { repr } = makeRepr();

        await repr.createOrUpdate({ ...PD.getDefaultValues(Params), visuals: ['mesh'] }, {}).run();
        expect(repr.renderObjects.map(o => o.type)).toEqual(['mesh']);

        await repr.createOrUpdate({ visuals: ['mesh', 'wireframe'] }).run();
        expect(repr.renderObjects.map(o => o.type)).toEqual(['mesh', 'lines']);

        await repr.createOrUpdate({ visuals: ['wireframe'] }).run();
        expect(repr.renderObjects.map(o => o.type)).toEqual(['lines']);
    });

    it('marks every visual when one of them is picked', async () => {
        const { repr, linesShape } = makeRepr();
        await repr.createOrUpdate({ ...PD.getDefaultValues(Params), visuals: ['mesh', 'wireframe'] }, {}).run();

        // A pick on the wireframe yields a loci pointing at the wireframe's own shape.
        const loci = ShapeGroup.Loci(linesShape, [{ ids: OrderedSet.ofSingleton(1), instance: 0 }]);
        expect(repr.mark(loci, MarkerAction.Highlight)).toBe(true);

        const marked = markerAverages(repr);
        expect(marked.lines).toBeGreaterThan(0);
        expect(marked.mesh).toBeGreaterThan(0);
    });

    it('reports the theme of the first visible visual, not of a visual that was never built', async () => {
        const { repr, linesShape } = makeRepr();
        // The mesh visual comes first but is off, so its theme is still the empty one.
        await repr.createOrUpdate({ ...PD.getDefaultValues(Params), visuals: ['wireframe'] }, {}).run();

        expect(repr.theme.color.granularity).toBe('groupInstance');
        expect(repr.theme.color.color(ShapeGroup.Location(linesShape, 1, 0), false)).toBe(ColorNames.red);
    });
});
