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
import { buildParticleListVisual } from '../helpers/relion-star';
import { isHaTsvParticleList } from '../../mol-io/reader/ha/tsv';

export const ParticleListFormatCategory = 'Particle List';

async function createParticleListsFromSet(
    plugin: PluginContext,
    setRef: string,
) {
    const set = StateObjectRef.resolveAndCheck(plugin.state.data, setRef)?.obj?.data;
    if (!set) throw new Error('Missing parsed particle-list set.');

    const update = plugin.state.data.build();
    const particleLists: StateObjectRef<RelionStarParticleListObject>[] = [];
    for (let index = 0, il = set.entries.length; index < il; ++index) {
        particleLists.push(update.to(setRef).apply(StateTransforms.Data.ParticleListFromSet, { index }).ref);
    }
    await update.commit({ revertOnError: true });
    return particleLists;
}

const RelionStarProviderImpl: DataFormatProviderType<{}, { particleLists: ReadonlyArray<StateObjectRef<RelionStarParticleListObject>> }> = {
    label: 'RELION STAR',
    description: 'RELION particle STAR file',
    category: ParticleListFormatCategory,
    stringExtensions: ['star'],
    parse: async (plugin: PluginContext, data: StateObjectRef<PluginStateObject.Data.Binary | PluginStateObject.Data.String>) => {
        const state = plugin.state.data;
        const cif = state.build().to(data)
            .apply(StateTransforms.Data.ParseCif, void 0, { state: { isGhost: true } });
        const particleListSet = await cif
            .apply(StateTransforms.Data.RelionStarParticleListSetFromCif, void 0, { state: { isGhost: true } })
            .commit({ revertOnError: true });
        return { particleLists: await createParticleListsFromSet(plugin, particleListSet.ref) };
    },
    visuals(plugin: PluginContext, data: { particleLists: ReadonlyArray<StateObjectRef<RelionStarParticleListObject>> }) {
        const update = plugin.state.data.build();
        for (const particleList of data.particleLists) {
            buildParticleListVisual(update, particleList);
        }
        return update.commit();
    }
};

export const RelionStarProvider = DataFormatProvider(RelionStarProviderImpl);

const DynamoTblProviderImpl: DataFormatProviderType<{}, { particleLists: ReadonlyArray<StateObjectRef<RelionStarParticleListObject>> }> = {
    label: 'Dynamo TBL',
    description: 'Dynamo particle table',
    category: ParticleListFormatCategory,
    stringExtensions: ['tbl'],
    parse: async (plugin: PluginContext, data: StateObjectRef<PluginStateObject.Data.Binary | PluginStateObject.Data.String>) => {
        const particleListSet = await plugin.state.data.build().to(data)
            .apply(StateTransforms.Data.DynamoTblParticleListSet, void 0, { state: { isGhost: true } })
            .commit({ revertOnError: true });
        return { particleLists: await createParticleListsFromSet(plugin, particleListSet.ref) };
    },
    visuals(plugin: PluginContext, data: { particleLists: ReadonlyArray<StateObjectRef<RelionStarParticleListObject>> }) {
        const update = plugin.state.data.build();
        for (const particleList of data.particleLists) {
            buildParticleListVisual(update, particleList);
        }
        return update.commit();
    }
};

export const DynamoTblProvider = DataFormatProvider(DynamoTblProviderImpl);

const HaTsvProviderImpl: DataFormatProviderType<{}, { particleLists: ReadonlyArray<StateObjectRef<RelionStarParticleListObject>> }> = {
    label: 'HA TSV',
    description: 'HA headered TSV particle table',
    category: ParticleListFormatCategory,
    stringExtensions: ['tsv'],
    isApplicable: (_info, data) => isHaTsvParticleList(data.toString()),
    parse: async (plugin: PluginContext, data: StateObjectRef<PluginStateObject.Data.Binary | PluginStateObject.Data.String>) => {
        const particleListSet = await plugin.state.data.build().to(data)
            .apply(StateTransforms.Data.HaTsvParticleListSet, void 0, { state: { isGhost: true } })
            .commit({ revertOnError: true });
        return { particleLists: await createParticleListsFromSet(plugin, particleListSet.ref) };
    },
    visuals(plugin: PluginContext, data: { particleLists: ReadonlyArray<StateObjectRef<RelionStarParticleListObject>> }) {
        const update = plugin.state.data.build();
        for (const particleList of data.particleLists) {
            buildParticleListVisual(update, particleList);
        }
        return update.commit();
    }
};

export const HaTsvProvider = DataFormatProvider(HaTsvProviderImpl);

export const BuiltInParticleFormats = [
    ['relion_star', RelionStarProvider] as const,
    ['dynamo_tbl', DynamoTblProvider] as const,
    ['ha_tsv', HaTsvProvider] as const,
] as const;
