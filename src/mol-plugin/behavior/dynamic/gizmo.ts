/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Interactive 3D transform gizmo. While gizmo mode is enabled:
 *  - clicking a structure attaches the translate/rotate handle at its center;
 *  - dragging a translate axis (or the centre handle) moves the structure in real time
 *    and commits a TransformStructureConformation on release.
 * (P2: translate, structures only. Rotation rings = P3, Blender G/R+XYZ keys = P4,
 *  volume/shape targets = P5.)
 */

import { PluginBehavior } from '../behavior';
import { HandleGroup, HandleHelperParams, isHandleLoci } from '../../../mol-canvas3d/helper/handle-helper';
import { Loci } from '../../../mol-model/loci';
import { StructureElement } from '../../../mol-model/structure';
import { Mat3, Mat4, Vec3 } from '../../../mol-math/linear-algebra';
import { Ray3D } from '../../../mol-math/geometry/primitives/ray3d';
import { Plane3D } from '../../../mol-math/geometry/primitives/plane3d';
import { Visual } from '../../../mol-repr/visual';
import { GraphicsRenderObject } from '../../../mol-gl/render-object';
import { StateSelection } from '../../../mol-state';
import { StateTransforms } from '../../../mol-plugin-state/transforms';

type GizmoTarget = { ref: string, center: Vec3, baseMatrix: Mat4 }
type GizmoDrag = {
    axis?: Vec3 // world axis for object-axis translate; undefined = screen-plane translate
    center: Vec3
    baseMatrix: Mat4
    renderObjects: GraphicsRenderObject[]
    startParam: number
    startHit: Vec3
    deltaVec: Vec3
}

function isTranslateGroup(g: number) {
    return g === HandleGroup.TranslateObjectX || g === HandleGroup.TranslateObjectY
        || g === HandleGroup.TranslateObjectZ || g === HandleGroup.TranslateScreenXY;
}

function axisForGroup(g: number): Vec3 | undefined {
    switch (g) {
        case HandleGroup.TranslateObjectX: return Vec3.unitX;
        case HandleGroup.TranslateObjectY: return Vec3.unitY;
        case HandleGroup.TranslateObjectZ: return Vec3.unitZ;
        default: return undefined; // TranslateScreenXY -> camera plane
    }
}

/** Parameter t such that `center + t*axis` is the point on the axis closest to the ray (both dirs unit). */
function rayAxisParam(ray: Ray3D, center: Vec3, axis: Vec3): number {
    const w0 = Vec3.sub(Vec3(), ray.origin, center);
    const b = Vec3.dot(ray.direction, axis);
    const d = Vec3.dot(ray.direction, w0);
    const e = Vec3.dot(axis, w0);
    const denom = 1 - b * b;
    if (Math.abs(denom) < 1e-6) return NaN; // ray parallel to axis
    return (e - b * d) / denom;
}

export const GizmoMode = PluginBehavior.create({
    name: 'gizmo-mode',
    category: 'interaction',
    display: { name: '3D Gizmo Mode', description: 'Click a structure to attach a translate/rotate gizmo and drag it to move the structure.' },
    ctor: class extends PluginBehavior.Handler {
        private handleEnabled = false;
        private hoverGroup = HandleGroup.None as number;
        private target: GizmoTarget | undefined;
        private drag: GizmoDrag | undefined;

        private readonly _ray: Ray3D = { origin: Vec3(), direction: Vec3() };
        private readonly _plane: Plane3D = { normal: Vec3(), constant: 0 };
        private readonly _rot = Mat3.identity();
        private readonly _mat = Mat4();
        private readonly _vec = Vec3();

        private get canvas3d() { return this.ctx.canvas3d; }

        private setHandleEnabled(on: boolean) {
            if (on === this.handleEnabled) return;
            this.handleEnabled = on;
            const params = (HandleHelperParams.handle.map('on') as any).defaultValue;
            this.canvas3d?.setProps({ handle: { handle: on ? { name: 'on', params } : { name: 'off', params: {} } } });
        }

        private setTrackball(on: boolean) {
            if (this.canvas3d) this.canvas3d.controls.enabled = on;
        }

        private readBaseMatrix(ref: string): Mat4 {
            const o = this.ctx.state.data.selectQ(q => q.byRef(ref).subtree().withTransformer(StateTransforms.Model.TransformStructureConformation))[0];
            const t = o?.transform.params?.transform;
            if (t && t.name === 'matrix') return Mat4.clone(t.params.data);
            return Mat4.identity();
        }

        private collectRenderObjects(ref: string): GraphicsRenderObject[] {
            const cells = this.ctx.state.data.select(StateSelection.Generators.byRef(ref).subtree());
            const ros: GraphicsRenderObject[] = [];
            for (const c of cells) {
                const data: any = c.obj?.data;
                if (data && Array.isArray(data.renderObjects)) ros.push(...data.renderObjects);
            }
            return ros;
        }

        private resolveTarget(loci: Loci): GizmoTarget | undefined {
            // P2: structures only
            if (!StructureElement.Loci.is(loci)) return undefined;
            const cell = this.ctx.helpers.substructureParent.get(loci.structure, true);
            if (!cell) return undefined;
            const ref = cell.transform.ref;
            return { ref, center: Vec3.clone(loci.structure.boundary.sphere.center), baseMatrix: this.readBaseMatrix(ref) };
        }

        private attach(loci: Loci) {
            const c = this.canvas3d;
            if (!c) return;
            const target = this.resolveTarget(loci);
            if (!target) { this.target = undefined; this.setHandleEnabled(false); return; }
            this.target = target;
            this.setHandleEnabled(true);
            c.handle.update(c.camera, target.center, this._rot);
            c.requestDraw();
        }

        /** Mouse ray into the scene. `camera.getRay` expects bottom-up Y, input is top-down. */
        private updateRay(x: number, y: number) {
            const c = this.canvas3d!;
            c.camera.getRay(this._ray, x, c.input.height - y);
            Vec3.normalize(this._ray.direction, this._ray.direction);
        }

        /** Intersection of the mouse ray with the camera-facing plane through `center`. */
        private screenHit(center: Vec3, x: number, y: number): Vec3 | undefined {
            const c = this.canvas3d!;
            this.updateRay(x, y);
            const n = Vec3.sub(this._vec, c.camera.state.target, c.camera.state.position);
            Vec3.normalize(n, n);
            Vec3.copy(this._plane.normal, n);
            this._plane.constant = -Vec3.dot(n, center);
            const out = Vec3();
            return Plane3D.intersectRay3D(out, this._plane, this._ray) ? out : undefined;
        }

        private onDrag(x: number, y: number, isStart: boolean) {
            const c = this.canvas3d;
            if (!c) return;

            if (isStart) {
                this.drag = undefined;
                if (!this.ctx.gizmoMode || !this.target || !isTranslateGroup(this.hoverGroup)) return;
                this.setTrackball(false);
                const axis = axisForGroup(this.hoverGroup);
                const center = Vec3.clone(this.target.center);
                let startParam = 0;
                const startHit = Vec3();
                if (axis) {
                    this.updateRay(x, y);
                    startParam = rayAxisParam(this._ray, center, axis);
                } else {
                    const hit = this.screenHit(center, x, y);
                    if (hit) Vec3.copy(startHit, hit);
                }
                this.drag = {
                    axis, center, baseMatrix: this.target.baseMatrix,
                    renderObjects: this.collectRenderObjects(this.target.ref),
                    startParam, startHit, deltaVec: Vec3(),
                };
                return;
            }

            const d = this.drag;
            if (!d) return;

            if (d.axis) {
                this.updateRay(x, y);
                const p = rayAxisParam(this._ray, d.center, d.axis);
                if (!Number.isFinite(p) || !Number.isFinite(d.startParam)) return;
                Vec3.scale(d.deltaVec, d.axis, p - d.startParam);
            } else {
                const hit = this.screenHit(d.center, x, y);
                if (!hit) return;
                Vec3.sub(d.deltaVec, hit, d.startHit);
            }

            // live preview: offset every render object of the target by the world delta
            Mat4.fromTranslation(this._mat, d.deltaVec);
            for (const r of d.renderObjects) Visual.setTransform(r, this._mat);
            // keep the gizmo on the object
            Vec3.add(this._vec, d.center, d.deltaVec);
            c.handle.update(c.camera, this._vec, this._rot);
            c.requestDraw();
        }

        private async onDragEnd() {
            const d = this.drag;
            this.drag = undefined;
            this.setTrackball(true);
            if (!d || !this.target) return;
            if (Vec3.magnitude(d.deltaVec) < 1e-4) return; // no-op click

            // absolute transform (from root coords) = Translate(delta) * existing
            Mat4.fromTranslation(this._mat, d.deltaVec);
            const abs = Mat4.mul(Mat4(), this._mat, d.baseMatrix);
            await this.commit(this.target.ref, abs);

            // the structure rebuilt at baked coords; update cached base + center for the next drag
            this.target.baseMatrix = abs;
            Vec3.add(this.target.center, d.center, d.deltaVec);
        }

        private async commit(ref: string, matrix: Mat4) {
            const state = this.ctx.state.data;
            const o = state.selectQ(q => q.byRef(ref).subtree().withTransformer(StateTransforms.Model.TransformStructureConformation))[0];
            const params = { transform: { name: 'matrix' as const, params: { data: matrix, transpose: false } } };
            const b = o
                ? state.build().to(o).update(params)
                : state.build().to(ref).insert(StateTransforms.Model.TransformStructureConformation, params);
            await this.ctx.runTask(state.updateTree(b));
        }

        register() {
            this.subscribeObservable(this.ctx.behaviors.interaction.gizmoMode, on => {
                if (!on) {
                    this.setHandleEnabled(false);
                    this.target = undefined;
                    this.drag = undefined;
                    this.setTrackball(true);
                }
            });

            // hovering a handle disables the camera trackball, so a drag that starts on a
            // handle never orbits the view (the flag is already set before the drag begins).
            this.subscribeObservable(this.ctx.behaviors.interaction.hover, ({ current }) => {
                if (this.drag) return;
                if (this.ctx.gizmoMode && isHandleLoci(current.loci) && current.loci.elements.length > 0) {
                    this.hoverGroup = current.loci.elements[0].groupId;
                    this.setTrackball(false);
                } else {
                    this.hoverGroup = HandleGroup.None;
                    this.setTrackball(true);
                }
            });

            this.subscribeObservable(this.ctx.behaviors.interaction.click, ({ current }) => {
                if (!this.ctx.gizmoMode) return;
                if (isHandleLoci(current.loci)) return; // gizmo clicks are for dragging
                if (Loci.isEmpty(current.loci)) {
                    this.target = undefined;
                    this.setHandleEnabled(false);
                } else {
                    this.attach(current.loci);
                }
            });

            // raw input (isStart / interactionEnd) is only available once canvas3d exists
            this.subscribeObservable(this.ctx.behaviors.canvas3d.initialized, () => {
                const input = this.ctx.canvas3d?.input;
                if (!input) return;
                this.subscribeObservable(input.drag, ({ x, y, isStart }) => this.onDrag(x, y, isStart));
                this.subscribeObservable(input.interactionEnd, () => { this.onDragEnd(); });
            });
        }
    },
    params: () => ({}),
});
