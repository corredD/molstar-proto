/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Interactive 3D transform gizmo. While gizmo mode is enabled:
 *  - clicking a structure or volume attaches the translate/rotate handle at its centre;
 *  - dragging a translate axis / rotation ring / centre handle moves it in real time and
 *    commits on release (TransformStructureConformation / VolumeTransform).
 *
 * Whole-object transforms only. Shapes are not yet targeted (no standard transform decorator).
 * (Keyboard shortcuts intentionally omitted for now.)
 */

import { PluginBehavior } from '../behavior';
import { HandleGroup, HandleHelperParams, isHandleLoci } from '../../../mol-canvas3d/helper/handle-helper';
import { Loci } from '../../../mol-model/loci';
import { StructureElement } from '../../../mol-model/structure';
import { Volume } from '../../../mol-model/volume';
import { Mat3, Mat4, Vec3 } from '../../../mol-math/linear-algebra';
import { Ray3D } from '../../../mol-math/geometry/primitives/ray3d';
import { Plane3D } from '../../../mol-math/geometry/primitives/plane3d';
import { Visual } from '../../../mol-repr/visual';
import { GraphicsRenderObject } from '../../../mol-gl/render-object';
import { StateSelection, StateTransformer } from '../../../mol-state';
import { StateTransforms } from '../../../mol-plugin-state/transforms';

type Mode = 'translate-axis' | 'translate-screen' | 'rotate'
type TargetKind = 'structure' | 'volume'

type GizmoTarget = { kind: TargetKind, ref: string, center: Vec3, radius: number, baseMatrix: Mat4 }
type GizmoSession = {
    mode: Mode
    axis: Vec3 // world axis (translate-axis / rotate) or view direction (translate-screen)
    target: GizmoTarget
    renderObjects: GraphicsRenderObject[]
    startParam: number // translate-axis
    startHit: Vec3 // translate-screen world hit
    startVec: Vec3 // rotate: centre -> hit, in the ring plane
    deltaMat: Mat4
}

function transformerForKind(kind: TargetKind): StateTransformer {
    return kind === 'structure'
        ? StateTransforms.Model.TransformStructureConformation
        : StateTransforms.Volume.VolumeTransform;
}

/** Parameter t such that `center + t*axis` is the point on the axis closest to the ray (unit dirs). */
function rayAxisParam(ray: Ray3D, center: Vec3, axis: Vec3): number {
    const w0 = Vec3.sub(Vec3(), ray.origin, center);
    const b = Vec3.dot(ray.direction, axis);
    const d = Vec3.dot(ray.direction, w0);
    const e = Vec3.dot(axis, w0);
    const denom = 1 - b * b;
    if (Math.abs(denom) < 1e-6) return NaN;
    return (e - b * d) / denom;
}

const _cross = Vec3();
/** Signed angle from a to b about `axis` (right-handed). */
function signedAngle(a: Vec3, b: Vec3, axis: Vec3): number {
    Vec3.cross(_cross, a, b);
    return Math.atan2(Vec3.dot(_cross, axis), Vec3.dot(a, b));
}

const _r = Mat4(), _t1 = Mat4(), _t2 = Mat4(), _negc = Vec3();
/** Rotation by `angle` about `axis` through `center`: T(c) R(axis,angle) T(-c). */
function aboutCenter(out: Mat4, center: Vec3, axis: Vec3, angle: number): Mat4 {
    Mat4.fromRotation(_r, angle, axis);
    Mat4.fromTranslation(_t1, center);
    Mat4.fromTranslation(_t2, Vec3.negate(_negc, center));
    Mat4.mul(out, _t1, _r);
    return Mat4.mul(out, out, _t2);
}

export const GizmoMode = PluginBehavior.create({
    name: 'gizmo-mode',
    category: 'interaction',
    display: { name: '3D Gizmo Mode', description: 'Click a structure or volume to attach a translate/rotate gizmo, then drag its handles.' },
    ctor: class extends PluginBehavior.Handler {
        private handleEnabled = false;
        private handleScale = 0;
        private hoverGroup = HandleGroup.None as number;
        private target: GizmoTarget | undefined;
        private session: GizmoSession | undefined;

        private readonly _ray: Ray3D = { origin: Vec3(), direction: Vec3() };
        private readonly _plane: Plane3D = { normal: Vec3(), constant: 0 };
        private readonly _rot = Mat3.identity();
        private readonly _rotDyn = Mat3();
        private readonly _vec = Vec3();

        private get canvas3d() { return this.ctx.canvas3d; }

        private hideHandle() {
            if (!this.handleEnabled) return;
            this.handleEnabled = false;
            this.canvas3d?.setProps({ handle: { handle: { name: 'off', params: {} } } });
        }

        /** Show the handle sized to the target (the helper is a fixed world size, so scale it). */
        private showHandle(scale: number) {
            if (this.handleEnabled && Math.abs(scale - this.handleScale) < 1e-3) return;
            this.handleEnabled = true;
            this.handleScale = scale;
            const params = { ...(HandleHelperParams.handle.map('on') as any).defaultValue, scale };
            this.canvas3d?.setProps({ handle: { handle: { name: 'on', params } } });
        }

        private setTrackball(on: boolean) {
            if (this.canvas3d) this.canvas3d.controls.enabled = on;
        }

        private viewDir(out: Vec3): Vec3 {
            const c = this.canvas3d!;
            return Vec3.normalize(out, Vec3.sub(out, c.camera.state.target, c.camera.state.position));
        }

        /** Mouse ray into the scene. `camera.getRay` expects bottom-up Y, input is top-down. */
        private updateRay(x: number, y: number) {
            const c = this.canvas3d!;
            c.camera.getRay(this._ray, x, c.input.height - y);
            Vec3.normalize(this._ray.direction, this._ray.direction);
        }

        private planeHit(center: Vec3, normal: Vec3, x: number, y: number): Vec3 | undefined {
            this.updateRay(x, y);
            Vec3.copy(this._plane.normal, normal);
            this._plane.constant = -Vec3.dot(normal, center);
            const out = Vec3();
            return Plane3D.intersectRay3D(out, this._plane, this._ray) ? out : undefined;
        }

        private readBaseMatrix(ref: string, transformer: StateTransformer): Mat4 {
            const o = this.ctx.state.data.selectQ(q => q.byRef(ref).subtree().withTransformer(transformer))[0];
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

        private cellRefForVolume(volume: Volume): string | undefined {
            const cells = this.ctx.state.data.cells;
            for (const [ref, cell] of cells) {
                if (cell.obj?.data === volume) return ref;
            }
            return undefined;
        }

        private resolveTarget(loci: Loci): GizmoTarget | undefined {
            const sphere = Loci.getBoundingSphere(loci);
            if (!sphere) return undefined;
            const radius = sphere.radius;
            if (StructureElement.Loci.is(loci)) {
                const cell = this.ctx.helpers.substructureParent.get(loci.structure, true);
                if (!cell) return undefined;
                const ref = cell.transform.ref;
                return { kind: 'structure', ref, radius, center: Vec3.clone(sphere.center), baseMatrix: this.readBaseMatrix(ref, StateTransforms.Model.TransformStructureConformation) };
            }
            // any volume loci kind (volume / isosurface / cell / segment) carries `.volume`
            const volume = (loci as any).volume;
            if (volume && Volume.is(volume)) {
                const ref = this.cellRefForVolume(volume);
                if (!ref) return undefined;
                return { kind: 'volume', ref, radius, center: Vec3.clone(sphere.center), baseMatrix: this.readBaseMatrix(ref, StateTransforms.Volume.VolumeTransform) };
            }
            return undefined; // shapes not yet supported
        }

        private attach(loci: Loci) {
            const c = this.canvas3d;
            if (!c) return;
            const target = this.resolveTarget(loci);
            if (!target) { this.target = undefined; this.hideHandle(); return; }
            this.target = target;
            this.showHandle(Math.max(target.radius * 0.12, 0.3));
            c.handle.update(c.camera, target.center, this._rot);
            c.requestDraw();
        }

        private modeForGroup(g: number): Mode | undefined {
            if (g === HandleGroup.TranslateObjectX || g === HandleGroup.TranslateObjectY || g === HandleGroup.TranslateObjectZ) return 'translate-axis';
            if (g === HandleGroup.TranslateScreenXY) return 'translate-screen';
            if (g === HandleGroup.RotateObjectX || g === HandleGroup.RotateObjectY || g === HandleGroup.RotateObjectZ) return 'rotate';
            return undefined;
        }

        private worldAxis(out: Vec3, g: number): Vec3 {
            switch (g) {
                case HandleGroup.TranslateObjectX: case HandleGroup.RotateObjectX: return Vec3.copy(out, Vec3.unitX);
                case HandleGroup.TranslateObjectY: case HandleGroup.RotateObjectY: return Vec3.copy(out, Vec3.unitY);
                default: return Vec3.copy(out, Vec3.unitZ);
            }
        }

        private begin(mode: Mode, axis: Vec3, x: number, y: number) {
            const t = this.target;
            if (!t) return;
            this.setTrackball(false);
            const center = t.center;
            const session: GizmoSession = {
                mode, axis: Vec3.clone(axis), target: t,
                renderObjects: this.collectRenderObjects(t.ref),
                startParam: 0, startHit: Vec3(), startVec: Vec3(), deltaMat: Mat4.identity(),
            };
            if (mode === 'translate-axis') {
                this.updateRay(x, y);
                session.startParam = rayAxisParam(this._ray, center, axis);
            } else if (mode === 'translate-screen') {
                const hit = this.planeHit(center, axis, x, y);
                if (hit) Vec3.copy(session.startHit, hit);
            } else {
                const hit = this.planeHit(center, axis, x, y);
                if (hit) Vec3.sub(session.startVec, hit, center);
            }
            this.session = session;
        }

        private updateSession(x: number, y: number) {
            const s = this.session;
            const c = this.canvas3d;
            if (!s || !c) return;
            const center = s.target.center;
            if (s.mode === 'translate-axis') {
                this.updateRay(x, y);
                const p = rayAxisParam(this._ray, center, s.axis);
                if (!Number.isFinite(p) || !Number.isFinite(s.startParam)) return;
                Mat4.fromTranslation(s.deltaMat, Vec3.scale(this._vec, s.axis, p - s.startParam));
            } else if (s.mode === 'translate-screen') {
                const hit = this.planeHit(center, s.axis, x, y);
                if (!hit) return;
                Mat4.fromTranslation(s.deltaMat, Vec3.sub(this._vec, hit, s.startHit));
            } else {
                const hit = this.planeHit(center, s.axis, x, y);
                if (!hit) return; // ring edge-on: skip frame
                const v = Vec3.sub(this._vec, hit, center);
                aboutCenter(s.deltaMat, center, s.axis, -signedAngle(s.startVec, v, s.axis));
            }
            for (const ro of s.renderObjects) Visual.setTransform(ro, s.deltaMat);
            // rotate the gizmo with the object for visual feedback (identity for pure translation)
            Mat3.fromMat4(this._rotDyn, s.deltaMat);
            c.handle.update(c.camera, Vec3.transformMat4(this._vec, center, s.deltaMat), this._rotDyn);
            c.requestDraw();
        }

        private async finish(commit: boolean) {
            const s = this.session;
            this.session = undefined;
            this.setTrackball(true);
            const c = this.canvas3d;
            if (!s || !c) return;

            if (commit && !Mat4.isIdentity(s.deltaMat, 1e-6)) {
                const abs = Mat4.mul(Mat4(), s.deltaMat, s.target.baseMatrix);
                await this.commit(s.target.ref, abs, transformerForKind(s.target.kind));
                s.target.baseMatrix = abs;
                Vec3.transformMat4(s.target.center, s.target.center, s.deltaMat);
                // committed -> downstream representation rebuilds at baked coords; reposition gizmo
                c.handle.update(c.camera, s.target.center, this._rot);
            } else {
                // cancel: clear the live preview and put the gizmo back
                for (const ro of s.renderObjects) Visual.setTransform(ro, Mat4.identity());
                c.handle.update(c.camera, s.target.center, this._rot);
            }
            c.requestDraw();
        }

        private async commit(ref: string, matrix: Mat4, transformer: StateTransformer) {
            const state = this.ctx.state.data;
            const o = state.selectQ(q => q.byRef(ref).subtree().withTransformer(transformer))[0];
            const params = { transform: { name: 'matrix' as const, params: { data: matrix, transpose: false } } };
            const b = o
                ? state.build().to(o).update(params)
                : state.build().to(ref).insert(transformer, params);
            await this.ctx.runTask(state.updateTree(b));
        }

        register() {
            this.subscribeObservable(this.ctx.behaviors.interaction.gizmoMode, on => {
                if (!on) {
                    this.session = undefined;
                    this.target = undefined;
                    this.hideHandle();
                    this.setTrackball(true);
                }
            });

            // hovering a handle disables the camera trackball so a drag starting on it never orbits
            this.subscribeObservable(this.ctx.behaviors.interaction.hover, ({ current }) => {
                if (this.session) return;
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
                if (this.session || isHandleLoci(current.loci)) return; // dragging / gizmo click
                if (Loci.isEmpty(current.loci)) { this.target = undefined; this.hideHandle(); } else this.attach(current.loci);
            });

            // raw drag (isStart) / interactionEnd are only available once canvas3d exists
            this.subscribeObservable(this.ctx.behaviors.canvas3d.initialized, () => {
                const input = this.ctx.canvas3d?.input;
                if (!input) return;
                this.subscribeObservable(input.drag, ({ x, y, isStart }) => {
                    if (isStart) {
                        const mode = this.modeForGroup(this.hoverGroup);
                        if (!this.ctx.gizmoMode || !this.target || !mode) return;
                        const axis = mode === 'translate-screen' ? this.viewDir(this._vec) : this.worldAxis(this._vec, this.hoverGroup);
                        this.begin(mode, axis, x, y);
                    } else {
                        this.updateSession(x, y);
                    }
                });
                this.subscribeObservable(input.interactionEnd, () => {
                    if (this.session) this.finish(true);
                });
            });
        }
    },
    params: () => ({}),
});
