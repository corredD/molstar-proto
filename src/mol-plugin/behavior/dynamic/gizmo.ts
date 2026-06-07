/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Interactive 3D transform gizmo. While gizmo mode is enabled, an interactive
 * translate/rotate handle is shown. (P1: mode toggle drives the handle on/off;
 * click-to-attach + drag transforms are layered on in later stages.)
 */

import { PluginBehavior } from '../behavior';
import { HandleHelperParams } from '../../../mol-canvas3d/helper/handle-helper';

export const GizmoMode = PluginBehavior.create({
    name: 'gizmo-mode',
    category: 'interaction',
    display: { name: '3D Gizmo Mode', description: 'Show an interactive translate/rotate gizmo while gizmo mode is enabled.' },
    ctor: class extends PluginBehavior.Handler {
        private setHandle(on: boolean) {
            const params = (HandleHelperParams.handle.map('on') as any).defaultValue;
            this.ctx.canvas3d?.setProps({
                handle: { handle: on ? { name: 'on', params } : { name: 'off', params: {} } }
            });
        }

        register() {
            // BehaviorSubject emits its current value on subscribe, so this also
            // syncs the handle with the initial gizmoMode state.
            this.subscribeObservable(this.ctx.behaviors.interaction.gizmoMode, on => this.setHandle(on));
        }
    },
    params: () => ({}),
});
