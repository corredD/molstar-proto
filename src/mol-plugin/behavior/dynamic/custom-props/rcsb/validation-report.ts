/**
 * Copyright (c) 2020 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { ParamDefinition as PD } from '../../../../../mol-util/param-definition'
import { PluginBehavior } from '../../../behavior';
import { ValidationReport, ValidationReportProvider, IntraUnitClashes } from '../../../../../mol-model-props/rcsb/validation-report';
import { RandomCoilIndexColorThemeProvider } from '../../../../../mol-model-props/rcsb/themes/random-coil-index';
import { GeometryQualityColorThemeProvider } from '../../../../../mol-model-props/rcsb/themes/geometry-quality';
import { Loci } from '../../../../../mol-model/loci';
import { OrderedSet } from '../../../../../mol-data/int';
import { ClashesRepresentationProvider } from '../../../../../mol-model-props/rcsb/representations/validation-report-clashes';
import { DensityFitColorThemeProvider } from '../../../../../mol-model-props/rcsb/themes/density-fit';

const Tag = ValidationReport.Tag

export const RCSBValidationReport = PluginBehavior.create<{ autoAttach: boolean, showTooltip: boolean }>({
    name: 'rcsb-validation-report-prop',
    category: 'custom-props',
    display: { name: 'RCSB Validation Report' },
    ctor: class extends PluginBehavior.Handler<{ autoAttach: boolean, showTooltip: boolean }> {
        private provider = ValidationReportProvider

        private labelClashes = (loci: Loci): string | undefined => {
            if (!this.params.showTooltip) return;

            if (loci.kind === 'data-loci' && loci.tag === 'clashes') {
                const idx = OrderedSet.start(loci.indices)
                const clashes = loci.data as IntraUnitClashes
                const { edgeProps: { id, magnitude, distance } } = clashes
                const mag = magnitude[idx].toFixed(2)
                const dist = distance[idx].toFixed(2)
                return `RCSB Clash id: ${id[idx]} | Magnitude: ${mag} \u212B | Distance: ${dist} \u212B`
            }
        }

        register(): void {
            this.ctx.customModelProperties.register(this.provider, this.params.autoAttach);

            this.ctx.lociLabels.addProvider(geometryQualityLabelProvider);
            this.ctx.lociLabels.addProvider(this.labelClashes);

            this.ctx.structureRepresentation.themeCtx.colorThemeRegistry.add(Tag.DensityFit, DensityFitColorThemeProvider)
            this.ctx.structureRepresentation.themeCtx.colorThemeRegistry.add(Tag.GeometryQuality, GeometryQualityColorThemeProvider)
            this.ctx.structureRepresentation.themeCtx.colorThemeRegistry.add(Tag.RandomCoilIndex, RandomCoilIndexColorThemeProvider)

            this.ctx.structureRepresentation.registry.add(Tag.Clashes, ClashesRepresentationProvider)
        }

        update(p: { autoAttach: boolean, showTooltip: boolean }) {
            let updated = this.params.autoAttach !== p.autoAttach
            this.params.autoAttach = p.autoAttach;
            this.params.showTooltip = p.showTooltip;
            this.ctx.customStructureProperties.setDefaultAutoAttach(this.provider.descriptor.name, this.params.autoAttach);
            return updated;
        }

        unregister() {
            this.ctx.customStructureProperties.unregister(this.provider.descriptor.name);

            this.ctx.lociLabels.removeProvider(geometryQualityLabelProvider);
            this.ctx.lociLabels.removeProvider(this.labelClashes);

            this.ctx.structureRepresentation.themeCtx.colorThemeRegistry.remove(Tag.DensityFit)
            this.ctx.structureRepresentation.themeCtx.colorThemeRegistry.remove(Tag.GeometryQuality)
            this.ctx.structureRepresentation.themeCtx.colorThemeRegistry.remove(Tag.RandomCoilIndex)

            this.ctx.structureRepresentation.registry.remove(Tag.Clashes)
        }
    },
    params: () => ({
        autoAttach: PD.Boolean(false),
        showTooltip: PD.Boolean(true),
        baseUrl: PD.Text(ValidationReport.DefaultBaseUrl)
    })
});

function geometryQualityLabelProvider(loci: Loci): string | undefined {
    switch (loci.kind) {
        case 'element-loci':
            if (loci.elements.length === 0) return void 0;
            const e = loci.elements[0];
            const geometryIssues = ValidationReportProvider.get(e.unit.model).value?.geometryIssues
            if (!geometryIssues) return

            const residueIndex = e.unit.model.atomicHierarchy.residueAtomSegments.index
            const issues = geometryIssues.get(residueIndex[e.unit.elements[OrderedSet.start(e.indices)]])
            if (!issues || issues.size === 0) return 'RCSB Geometry Quality: no issues';

            const label: string[] = []
            issues.forEach(i => label.push(i))
            return `RCSB Geometry Quality: ${label.join(', ')}`;

        default: return;
    }
}