/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { PluginBehavior } from '../../mol-plugin/behavior/behavior';
import { ParticleExporterUI } from './ui';

export const ParticleExport = PluginBehavior.create<{}>({
    name: 'extension-particle-export',
    category: 'misc',
    display: {
        name: 'Particle Export'
    },
    ctor: class extends PluginBehavior.Handler<{}> {
        register(): void {
            this.ctx.customStructureControls.set('particle-export', ParticleExporterUI as any);
        }

        update() {
            return false;
        }

        unregister() {
            this.ctx.customStructureControls.delete('particle-export');
        }
    },
    params: () => ({})
});
