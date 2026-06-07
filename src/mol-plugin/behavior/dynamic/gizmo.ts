/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Interactive 3D transform gizmo. While gizmo mode is enabled, clicking an object
 * attaches the translate/rotate handle to it (at its bounding-sphere center);
 * clicking empty space detaches it. (P1: click-to-attach placement. Drag-to-transform
 * and Blender G/R+XYZ keys are layered on in later stages.)
 */

import { PluginBehavior } from '../behavior';
import { HandleHelperParams, isHandleLoci } from '../../../mol-canvas3d/helper/handle-helper';
import { Loci } from '../../../mol-model/loci';
import { Mat3 } from '../../../mol-math/linear-algebra';
import { Sphere3D } from '../../../mol-math/geometry';

export const GizmoMode = PluginBehavior.create({
    name: 'gizmo-mode',
    category: 'interaction',
    display: { name: '3D Gizmo Mode', description: 'Click an object to attach an interactive translate/rotate gizmo while gizmo mode is enabled.' },
    ctor: class extends PluginBehavior.Handler {
        private enabled = false;
        private readonly sphere = Sphere3D();
        private readonly rotation = Mat3.identity();

        private get canvas3d() { return this.ctx.canvas3d; }

        private setHandleEnabled(on: boolean) {
            if (on === this.enabled) return;
            this.enabled = on;
            const params = (HandleHelperParams.handle.map('on') as any).defaultValue;
            this.canvas3d?.setProps({
                handle: { handle: on ? { name: 'on', params } : { name: 'off', params: {} } }
            });
        }

        private attach(loci: Loci) {
            const c = this.canvas3d;
            if (!c) return;
            const sphere = Loci.getBoundingSphere(loci, this.sphere);
            if (!sphere) { this.setHandleEnabled(false); return; }
            this.setHandleEnabled(true);
            c.handle.update(c.camera, sphere.center, this.rotation);
            c.requestDraw();
        }

        register() {
            this.subscribeObservable(this.ctx.behaviors.interaction.gizmoMode, on => {
                if (!on) this.setHandleEnabled(false);
            });
            this.subscribeObservable(this.ctx.behaviors.interaction.click, ({ current }) => {
                if (!this.ctx.gizmoMode) return;
                const loci = current.loci;
                // clicking the gizmo itself is reserved for dragging (handled later)
                if (isHandleLoci(loci)) return;
                if (Loci.isEmpty(loci)) this.setHandleEnabled(false);
                else this.attach(loci);
            });
        }
    },
    params: () => ({}),
});
