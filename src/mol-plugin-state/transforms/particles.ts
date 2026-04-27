/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { parseRelionStar } from '../../mol-io/reader/relion/star';
import { createParticleListFromCryoEtDataPortalNdjson } from '../../mol-model-formats/particles/ndjson';
import { createParticleListFromRelionStar } from '../../mol-model-formats/particles/star';
import { createParticleListFromDynamoTbl } from '../../mol-model-formats/particles/tbl';
import { ParticleUnit } from '../../mol-model/particles/particle-list';
import { PluginContext } from '../../mol-plugin/context';
import { StateTransformer } from '../../mol-state';
import { Task } from '../../mol-task';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { Theme } from '../../mol-theme/theme';
import { PluginStateObject as SO, PluginStateTransform } from '../objects';

export { ParticleListFromRelionStar };
export { ParticleListFromDynamoTbl };
export { ParticleListFromCryoEtDataPortalNdjson };
export { ParticlesRepresentation3D };

type ParticleListFromRelionStar = typeof ParticleListFromRelionStar
const ParticleListFromRelionStar = PluginStateTransform.BuiltIn({
    name: 'particle-list-from-relion-star',
    display: { name: 'Particle List from RELION STAR', description: 'Create ParticleList from RELION STAR data.' },
    from: SO.Format.Cif,
    to: SO.Particle.List,
    params: {
        label: PD.Optional(PD.Text('')),
        tomogram: PD.Optional(PD.Text('')),
    }
})({
    apply({ a, params }) {
        return Task.create('Create Particle List from RELION STAR', async ctx => {
            const relion = parseRelionStar(a.data);
            if (relion.isError) throw new Error(relion.message);

            const list = createParticleListFromRelionStar(relion.result, {
                label: params.label || void 0,
                tomogram: params.tomogram || void 0,
            });

            return new SO.Particle.List(list, { label: list.label, description: 'RELION Particle List' });
        });
    }
});

type ParticleListFromDynamoTbl = typeof ParticleListFromDynamoTbl
const ParticleListFromDynamoTbl = PluginStateTransform.BuiltIn({
    name: 'particle-list-from-dynamo-tbl',
    display: { name: 'Particle List from Dynamo TBL', description: 'Create ParticleList from Dynamo TBL data.' },
    from: SO.Format.DynamoTbl,
    to: SO.Particle.List,
    params: {
        label: PD.Optional(PD.Text('')),
        tomo: PD.Optional(PD.Numeric(0, { step: 1 })),
    }
})({
    apply({ a, params }) {
        return Task.create('Create Particle List from Dynamo TBL', async ctx => {
            const list = createParticleListFromDynamoTbl(a.data, {
                label: params.label || void 0,
                tomo: params.tomo,
            });
            return new SO.Particle.List(list, { label: list.label, description: 'Dynamo Particle List' });
        });
    }
});

type ParticleListFromCryoEtDataPortalNdjson = typeof ParticleListFromCryoEtDataPortalNdjson
const ParticleListFromCryoEtDataPortalNdjson = PluginStateTransform.BuiltIn({
    name: 'particle-list-from-cryoet-data-portal-ndjson',
    display: { name: 'Particle List from CryoET NDJSON', description: 'Create ParticleList from CryoET Data Portal NDJSON data.' },
    from: SO.Format.CryoEtDataPortalNdjson,
    to: SO.Particle.List,
    params: {
        label: PD.Optional(PD.Text('')),
        coordinateUnit: PD.Optional(PD.Select<ParticleUnit>('pixel', [['pixel', 'pixel'], ['angstrom', 'angstrom']])),
        type: PD.Optional(PD.Text('')),
    }
})({
    apply({ a, params }) {
        return Task.create('Create Particle List from CryoET NDJSON', async ctx => {
            const list = createParticleListFromCryoEtDataPortalNdjson(a.data, {
                label: params.label || void 0,
                coordinateUnit: params.coordinateUnit,
                type: params.type || void 0,
            });
            return new SO.Particle.List(list, { label: list.label, description: 'CryoET NDJSON Particle List' });
        });
    }
});

type ParticlesRepresentation3D = typeof ParticlesRepresentation3D
const ParticlesRepresentation3D = PluginStateTransform.BuiltIn({
    name: 'particles-representation-3d',
    display: '3D Representation',
    from: SO.Particle.List,
    to: SO.Particle.Representation3D,
    params: (a, ctx: PluginContext) => {
        const { registry, themes: themeCtx } = ctx.representation.particles;
        const type = registry.get(registry.default.name);

        if (!a) {
            return {
                type: PD.Mapped<any>(
                    registry.default.name,
                    registry.types,
                    name => PD.Group<any>(registry.get(name).getParams(themeCtx, undefined as any))),
                colorTheme: PD.Mapped<any>(
                    type.defaultColorTheme.name,
                    themeCtx.colorThemeRegistry.types,
                    name => PD.Group<any>(themeCtx.colorThemeRegistry.get(name).getParams({}))
                ),
                sizeTheme: PD.Mapped<any>(
                    type.defaultSizeTheme.name,
                    themeCtx.sizeThemeRegistry.types,
                    name => PD.Group<any>(themeCtx.sizeThemeRegistry.get(name).getParams({}))
                )
            };
        }

        const dataCtx = { particles: a.data };
        return ({
            type: PD.Mapped<any>(
                registry.default.name,
                registry.getApplicableTypes(a.data),
                name => PD.Group<any>(registry.get(name).getParams(themeCtx, a.data))),
            colorTheme: PD.Mapped<any>(
                type.defaultColorTheme.name,
                themeCtx.colorThemeRegistry.getApplicableTypes(dataCtx),
                name => PD.Group<any>(themeCtx.colorThemeRegistry.get(name).getParams(dataCtx))
            ),
            sizeTheme: PD.Mapped<any>(
                type.defaultSizeTheme.name,
                themeCtx.sizeThemeRegistry.getApplicableTypes(dataCtx),
                name => PD.Group<any>(themeCtx.sizeThemeRegistry.get(name).getParams(dataCtx))
            )
        });
    }
})({
    canAutoUpdate({ oldParams, newParams }) {
        return oldParams.type.name === newParams.type.name;
    },
    apply({ a, params }, plugin: PluginContext) {
        return Task.create('Particles Representation', async ctx => {
            const themes = plugin.representation.particles.themes;
            const provider = plugin.representation.particles.registry.get(params.type.name);
            const repr = provider.factory({ webgl: plugin.canvas3d?.webgl, ...themes }, provider.getParams);
            repr.setTheme(Theme.create(themes, { particles: a.data }, params));
            const props = params.type.params || {};
            await repr.createOrUpdate(props, a.data).runInContext(ctx);
            return new SO.Particle.Representation3D({ repr, sourceData: a.data }, { label: provider.label });
        });
    },
    update({ a, b, oldParams, newParams }, plugin: PluginContext) {
        return Task.create('Particles Representation', async ctx => {
            if (newParams.type.name !== oldParams.type.name) return StateTransformer.UpdateResult.Recreate;

            const provider = plugin.representation.particles.registry.get(newParams.type.name);
            if (provider.mustRecreate?.(oldParams.type.params, newParams.type.params)) return StateTransformer.UpdateResult.Recreate;

            const themes = plugin.representation.particles.themes;
            b.data.repr.setTheme(Theme.create(themes, { particles: a.data }, newParams));
            const props = { ...b.data.repr.props, ...newParams.type.params };
            await b.data.repr.createOrUpdate(props, a.data).runInContext(ctx);
            b.data.sourceData = a.data;
            return StateTransformer.UpdateResult.Updated;
        });
    }
});


