/**
 * Copyright (c) 2020-2023 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { WebGLContext } from '../../mol-gl/webgl/context';
import { Scene } from '../../mol-gl/scene';
import { MeshBuilder } from '../../mol-geo/geometry/mesh/mesh-builder';
import { Vec3, Mat4, Mat3 } from '../../mol-math/linear-algebra';
import { addSphere } from '../../mol-geo/geometry/mesh/builder/sphere';
import { GraphicsRenderObject } from '../../mol-gl/render-object';
import { Mesh } from '../../mol-geo/geometry/mesh/mesh';
import { ColorNames } from '../../mol-util/color/names';
import { addCylinder } from '../../mol-geo/geometry/mesh/builder/cylinder';
import { Torus } from '../../mol-geo/primitive/torus';
import { ValueCell } from '../../mol-util';
import { Sphere3D } from '../../mol-math/geometry';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { produce } from '../../mol-util/produce';
import { Shape } from '../../mol-model/shape';
import { PickingId } from '../../mol-geo/geometry/picking';
import { Camera } from '../camera';
import { DataLoci, EmptyLoci, isEveryLoci, Loci } from '../../mol-model/loci';
import { MarkerAction, MarkerActions } from '../../mol-util/marker-action';
import { Visual } from '../../mol-repr/visual';
import { Interval } from '../../mol-data/int';

const HandleParams = {
    ...Mesh.Params,
    alpha: { ...Mesh.Params.alpha, defaultValue: 1 },
    ignoreLight: { ...Mesh.Params.ignoreLight, defaultValue: true },
    colorX: PD.Color(ColorNames.red, { isEssential: true }),
    colorY: PD.Color(ColorNames.green, { isEssential: true }),
    colorZ: PD.Color(ColorNames.blue, { isEssential: true }),
    scale: PD.Numeric(0.33, { min: 0.1, max: 2, step: 0.1 }, { isEssential: true }),
};
type HandleParams = typeof HandleParams
type HandleProps = PD.Values<HandleParams>

export const HandleHelperParams = {
    handle: PD.MappedStatic('off', {
        on: PD.Group(HandleParams),
        off: PD.Group({})
    }, { cycle: true, description: 'Show handle tool' }),
};
export type HandleHelperParams = typeof HandleHelperParams
export type HandleHelperProps = PD.Values<HandleHelperParams>

/** Target on-screen size (CSS px) of the gizmo's axis length, kept ~constant across zoom. */
const HandleScreenSize = 80;

export class HandleHelper {
    scene: Scene;
    props: HandleHelperProps = {
        handle: { name: 'off', params: {} }
    };

    private renderObject: GraphicsRenderObject | undefined;
    private pixelRatio = 1;
    /** world axis length the mesh was built at; used to renormalise to a constant screen size */
    private baseScale = 1;

    private _transform = Mat4();
    getBoundingSphere(out: Sphere3D, instanceId: number) {
        if (this.renderObject) {
            Sphere3D.copy(out, this.renderObject.values.invariantBoundingSphere.ref.value);
            Mat4.fromArray(this._transform, this.renderObject.values.aTransform.ref.value, instanceId * 16);
            Sphere3D.transform(out, out, this._transform);
        }
        return out;
    }

    setProps(props: Partial<HandleHelperProps>) {
        this.props = produce(this.props, p => {
            if (props.handle !== undefined) {
                p.handle.name = props.handle.name;
                if (props.handle.name === 'on') {
                    this.scene.clear();
                    this.pixelRatio = this.webgl.pixelRatio;
                    const params = {
                        ...props.handle.params,
                        scale: props.handle.params.scale * this.webgl.pixelRatio,
                        cellSize: 0,
                    };
                    this.renderObject = createHandleRenderObject(params);
                    this.baseScale = 10 * params.scale; // getHandleShape builds the mesh at 10 * scale
                    this.scene.add(this.renderObject);
                    this.scene.commit();

                    p.handle.params = { ...props.handle.params };
                }
            }
        });
    }

    get isEnabled() {
        return this.props.handle.name === 'on';
    }

    // TODO could be a lists of position/rotation if we want to show more than one handle tool,
    //      they would be distingishable by their instanceId
    update(camera: Camera, position: Vec3, rotation: Mat3) {
        if (!this.renderObject) return;

        if (this.pixelRatio !== this.webgl.pixelRatio) {
            this.setProps(this.props);
        }

        // keep a ~constant on-screen size: getPixelSize is world units per device pixel at the gizmo,
        // so HandleScreenSize CSS px -> (HandleScreenSize * pixelRatio * pixelSize) world units.
        const pixelSize = camera.getPixelSize(position);
        let f = 1;
        if (this.baseScale > 0 && Number.isFinite(pixelSize) && pixelSize > 0) {
            f = (HandleScreenSize * this.webgl.pixelRatio * pixelSize) / this.baseScale;
        }
        if (!Number.isFinite(f) || f <= 0) f = 1;
        // Cap the world size to a fraction of the camera->gizmo distance: when the camera is close,
        // getPixelSize grows and a constant-screen-size handle would extend past the near plane and be
        // clipped away (the "disappears when too close" case). This keeps it just in front of the camera.
        const dist = Vec3.distance(camera.state.position, position);
        if (Number.isFinite(dist) && dist > 0) f = Math.min(f, (0.5 * dist) / this.baseScale);
        f = Math.max(1e-4, Math.min(f, 1e4));

        const m = this.renderObject.values.aTransform.ref.value as unknown as Mat4;
        // rotation first (fromMat3 zeroes the translation column), then uniform scale, then translation
        Mat4.fromMat3(m, rotation);
        Mat4.scaleUniformly(m, m, f);
        Mat4.setTranslation(m, position);

        ValueCell.update(this.renderObject.values.aTransform, this.renderObject.values.aTransform.ref.value);
        this.scene.update([this.renderObject], true);
    }

    getLoci(pickingId: PickingId) {
        const { objectId, groupId, instanceId } = pickingId;
        if (!this.renderObject || objectId !== this.renderObject.id) return EmptyLoci;
        return HandleLoci(this, groupId, instanceId);
    }

    private eachGroup = (loci: Loci, apply: (interval: Interval) => boolean): boolean => {
        if (!this.renderObject) return false;
        if (!isHandleLoci(loci)) return false;
        let changed = false;
        const groupCount = this.renderObject.values.uGroupCount.ref.value;
        const { elements } = loci;
        for (const { groupId, instanceId } of elements) {
            const idx = instanceId * groupCount + groupId;
            if (apply(Interval.ofSingleton(idx))) changed = true;
        }
        return changed;
    };

    mark(loci: Loci, action: MarkerAction) {
        if (!MarkerActions.is(MarkerActions.Highlighting, action)) return false;
        if (!isEveryLoci(loci)) {
            if (!isHandleLoci(loci)) return false;
            if (loci.data !== this) return false;
        }
        return Visual.mark(this.renderObject, loci, action, this.eachGroup);
    }

    constructor(private webgl: WebGLContext, props: Partial<HandleHelperProps> = {}) {
        this.scene = Scene.create(webgl, 'blended');
        this.setProps(props);
    }
}

function createHandleMesh(scale: number, mesh?: Mesh) {
    const state = MeshBuilder.createState(512, 256, mesh);
    const radius = 0.05 * scale;
    const x = Vec3.scale(Vec3(), Vec3.unitX, scale);
    const y = Vec3.scale(Vec3(), Vec3.unitY, scale);
    const z = Vec3.scale(Vec3(), Vec3.unitZ, scale);
    const cylinderProps = { radiusTop: radius, radiusBottom: radius, radialSegments: 32 };

    state.currentGroup = HandleGroup.TranslateScreenXY;
    addSphere(state, Vec3.origin, radius * 3, 2);

    state.currentGroup = HandleGroup.TranslateObjectX;
    addSphere(state, x, radius, 2);
    addCylinder(state, Vec3.origin, x, 1, cylinderProps);

    state.currentGroup = HandleGroup.TranslateObjectY;
    addSphere(state, y, radius, 2);
    addCylinder(state, Vec3.origin, y, 1, cylinderProps);

    state.currentGroup = HandleGroup.TranslateObjectZ;
    addSphere(state, z, radius, 2);
    addCylinder(state, Vec3.origin, z, 1, cylinderProps);

    // rotation rings, one per axis (torus lies in XY plane by default = ring around Z)
    const torusProps = { radius: scale, tube: radius, radialSegments: 8, tubularSegments: 48 };
    state.currentGroup = HandleGroup.RotateObjectZ;
    MeshBuilder.addPrimitive(state, Mat4.identity(), Torus(torusProps));
    state.currentGroup = HandleGroup.RotateObjectX;
    MeshBuilder.addPrimitive(state, Mat4.fromRotation(Mat4(), Math.PI / 2, Vec3.unitY), Torus(torusProps));
    state.currentGroup = HandleGroup.RotateObjectY;
    MeshBuilder.addPrimitive(state, Mat4.fromRotation(Mat4(), Math.PI / 2, Vec3.unitX), Torus(torusProps));

    // TODO add props to create subset of geometries

    return MeshBuilder.getMesh(state);
}

export const HandleGroup = {
    None: 0,
    TranslateScreenXY: 1,
    // TranslateScreenZ: 2,
    TranslateObjectX: 3,
    TranslateObjectY: 4,
    TranslateObjectZ: 5,
    // TranslateObjectXY: 6,
    // TranslateObjectXZ: 7,
    // TranslateObjectYZ: 8,

    // RotateScreenZ: 9,
    RotateObjectX: 10,
    RotateObjectY: 11,
    RotateObjectZ: 12,
} as const;

function HandleLoci(handleHelper: HandleHelper, groupId: number, instanceId: number) {
    return DataLoci('handle', handleHelper, [{ groupId, instanceId }],
        (boundingSphere: Sphere3D) => handleHelper.getBoundingSphere(boundingSphere, instanceId),
        () => `Handle Helper | Group Id ${groupId} | Instance Id ${instanceId}`);
}
export type HandleLoci = ReturnType<typeof HandleLoci>
export function isHandleLoci(x: Loci): x is HandleLoci {
    return x.kind === 'data-loci' && x.tag === 'handle';
}

function getHandleShape(props: HandleProps, shape?: Shape<Mesh>) {
    const scale = 10 * props.scale;
    const mesh = createHandleMesh(scale, shape?.geometry);
    mesh.setBoundingSphere(Sphere3D.create(Vec3.create(scale / 2, scale / 2, scale / 2), scale + scale / 4));
    const getColor = (groupId: number) => {
        switch (groupId) {
            case HandleGroup.TranslateObjectX: return props.colorX;
            case HandleGroup.TranslateObjectY: return props.colorY;
            case HandleGroup.TranslateObjectZ: return props.colorZ;
            case HandleGroup.RotateObjectX: return props.colorX;
            case HandleGroup.RotateObjectY: return props.colorY;
            case HandleGroup.RotateObjectZ: return props.colorZ;
            default: return ColorNames.grey;
        }
    };
    return Shape.create('handle', {}, mesh, getColor, () => 1, () => '');
}

function createHandleRenderObject(props: HandleProps) {
    const shape = getHandleShape(props);
    return Shape.createRenderObject(shape, props);
}