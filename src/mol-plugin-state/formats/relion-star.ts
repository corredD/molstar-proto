/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 */

import { StateObjectRef } from '../../mol-state';
import { PluginContext } from '../../mol-plugin/context';
import { RelionStarParticleListObject } from '../objects/relion';
import { DataFormatProvider, type DataFormatProvider as DataFormatProviderType } from './provider';
import { StateTransforms } from '../transforms';
import { PluginStateObject } from '../objects';

export const ParticleListFormatCategory = 'Particle List';

const RelionStarProviderImpl: DataFormatProviderType<{}, { particleList: StateObjectRef<RelionStarParticleListObject> }> = {
    label: 'RELION STAR',
    description: 'RELION particle STAR file',
    category: ParticleListFormatCategory,
    stringExtensions: ['star'],
    parse: async (plugin: PluginContext, data: StateObjectRef<PluginStateObject.Data.Binary | PluginStateObject.Data.String>) => {
        const state = plugin.state.data;
        const cif = state.build().to(data)
            .apply(StateTransforms.Data.ParseCif, void 0, { state: { isGhost: true } });
        const particleList = await cif
            .apply(StateTransforms.Data.RelionStarParticleListFromCif)
            .commit({ revertOnError: true });
        return { particleList };
    }
};

export const RelionStarProvider = DataFormatProvider(RelionStarProviderImpl);

export const BuiltInParticleFormats = [
    ['relion_star', RelionStarProvider] as const,
] as const;
