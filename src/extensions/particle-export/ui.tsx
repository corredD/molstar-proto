/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { CollapsableControls, CollapsableState } from '../../mol-plugin-ui/base';
import { Button } from '../../mol-plugin-ui/controls/common';
import { GetAppSvg } from '../../mol-plugin-ui/controls/icons';
import { ParameterControls } from '../../mol-plugin-ui/controls/parameters';
import { download } from '../../mol-util/download';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { ParticleList, ParticleListParticle } from '../../mol-io/reader/particle-list';
import { RelionStarExportMetadata, writeRelionStarParticleList } from '../../mol-io/writer/relion/star';
import { writeDynamoTblParticleList } from '../../mol-io/writer/dynamo/tbl';
import { writeHaTsvParticleList } from '../../mol-io/writer/ha/tsv';
import { writeParticlesCsv } from '../../mol-io/writer/particles/csv';
import {
    getDefaultExportMetadata,
    getParticleListExportEntries,
    getVolumeMetadataDefaults,
    ParticleListExportEntry,
    suggestExportFileName,
    VolumeMetadataDefaults,
} from '../../mol-plugin-state/helpers/relion-star-export';

type CoordinateConvention = 'pixel' | 'centered-angstrom';
type OriginConvention = 'pixel' | 'angstrom' | 'none';
type ExportFormat = 'star' | 'dynamo' | 'ha-tsv' | 'csv';

const FormatOptions: ReadonlyArray<readonly [ExportFormat, string]> = [
    ['star', 'RELION STAR (.star)'],
    ['dynamo', 'Dynamo Table (.tbl + .doc)'],
    ['ha-tsv', 'HA Headered TSV (.tsv)'],
    ['csv', 'Generic CSV (Dynamo column order)'],
];

const FormatFileExt: Record<ExportFormat, string> = {
    'star': '.star',
    'dynamo': '.tbl',
    'ha-tsv': '.tsv',
    'csv': '.csv',
};

interface AdvancedValues {
    imageSize: number
    coordinateConvention: CoordinateConvention
    originConvention: OriginConvention
    centerCoordinates: boolean
    opticsGroupName: string
    voltage: number
    sphericalAberration: number
    amplitudeContrast: number
    defaultTomoName: string
    defaultMicrographName: string
    defaultImageName: string
    includeOpticsGroup: boolean
    includeTomoName: boolean
    includeMicrographName: boolean
    includeImageName: boolean
    includeClassNumber: boolean
    includeGroupNumber: boolean
}

interface FormValues {
    selected: string[]
    format: ExportFormat
    fileName: string
    apix: number
    advanced: AdvancedValues
}

interface ParticleExporterState {
    busy: boolean
    entries: ParticleListExportEntry[]
    volumeDefaults: VolumeMetadataDefaults
    values: FormValues
}

export class ParticleExporterUI extends CollapsableControls<{}, ParticleExporterState> {
    protected defaultState(): ParticleExporterState & CollapsableState {
        return {
            header: 'Export Particles List',
            isCollapsed: true,
            isHidden: true,
            brand: { accent: 'cyan', svg: GetAppSvg },
            busy: false,
            entries: [],
            volumeDefaults: {},
            values: emptyFormValues(),
        };
    }

    componentDidMount() {
        this.refresh();
        this.subscribe(this.plugin.state.data.events.changed, () => this.refresh());
    }

    private refresh = () => {
        const entries = getParticleListExportEntries(this.plugin);
        const volumeDefaults = getVolumeMetadataDefaults(this.plugin);
        this.setState(prev => {
            const validRefs = new Set(entries.map(e => e.ref));
            const selected = prev.values.selected.filter(ref => validRefs.has(ref));
            const effectiveSelected = selected.length === 0 && entries.length > 0 ? [entries[0].ref] : selected;
            const values = effectiveSelected.length > 0
                ? deriveFormValues(effectiveSelected, entries, volumeDefaults, prev.values)
                : emptyFormValues();
            return {
                ...prev,
                entries,
                volumeDefaults,
                values,
                isHidden: entries.length === 0,
            } as ParticleExporterState & CollapsableState;
        });
    };

    private params = () => {
        const entryOptions = this.state.entries.map(entry =>
            [entry.ref, `${entry.label} · ${entry.particleList.particles.length} pts`] as [string, string]
        );

        return {
            selected: PD.MultiSelect<string>(this.state.values.selected, entryOptions, { label: 'Particle Lists (merge)' }),
            format: PD.Select<ExportFormat>(this.state.values.format, FormatOptions as any, { label: 'Format' }),
            fileName: PD.Text(this.state.values.fileName, { label: 'File name' }),
            apix: PD.Numeric(this.state.values.apix, { min: 0.001, max: 1000, step: 0.001 }, { label: 'Pixel size (Å/px)' }),
            advanced: PD.Group({
                imageSize: PD.Numeric(this.state.values.advanced.imageSize, { min: 0, max: 100000, step: 1 }, { label: 'Image size (px)' }),
                coordinateConvention: PD.Select<CoordinateConvention>(this.state.values.advanced.coordinateConvention, [
                    ['pixel', 'rlnCoordinateX/Y/Z (pixel)'],
                    ['centered-angstrom', 'rlnCenteredCoordinateXAngst (Å, centered)'],
                ], { label: 'Coordinate columns' }),
                originConvention: PD.Select<OriginConvention>(this.state.values.advanced.originConvention, [
                    ['pixel', 'rlnOriginX/Y/Z (pixel)'],
                    ['angstrom', 'rlnOriginXAngst (Å)'],
                    ['none', 'Omit origin columns'],
                ], { label: 'Origin columns' }),
                centerCoordinates: PD.Boolean(this.state.values.advanced.centerCoordinates, { label: 'Subtract box center (centered-Å)' }),
                opticsGroupName: PD.Text(this.state.values.advanced.opticsGroupName, { label: 'Optics group name' }),
                voltage: PD.Numeric(this.state.values.advanced.voltage, { min: 0, max: 1000, step: 1 }, { label: 'Voltage (kV)' }),
                sphericalAberration: PD.Numeric(this.state.values.advanced.sphericalAberration, { min: 0, max: 10, step: 0.01 }, { label: 'Cs (mm)' }),
                amplitudeContrast: PD.Numeric(this.state.values.advanced.amplitudeContrast, { min: 0, max: 1, step: 0.001 }, { label: 'Amplitude contrast' }),
                defaultTomoName: PD.Text(this.state.values.advanced.defaultTomoName, { label: 'Default rlnTomoName' }),
                defaultMicrographName: PD.Text(this.state.values.advanced.defaultMicrographName, { label: 'Default rlnMicrographName' }),
                defaultImageName: PD.Text(this.state.values.advanced.defaultImageName, { label: 'Default rlnImageName' }),
                includeOpticsGroup: PD.Boolean(this.state.values.advanced.includeOpticsGroup, { label: 'Write rlnOpticsGroup column' }),
                includeTomoName: PD.Boolean(this.state.values.advanced.includeTomoName, { label: 'Write rlnTomoName column' }),
                includeMicrographName: PD.Boolean(this.state.values.advanced.includeMicrographName, { label: 'Write rlnMicrographName column' }),
                includeImageName: PD.Boolean(this.state.values.advanced.includeImageName, { label: 'Write rlnImageName column' }),
                includeClassNumber: PD.Boolean(this.state.values.advanced.includeClassNumber, { label: 'Write rlnClassNumber column' }),
                includeGroupNumber: PD.Boolean(this.state.values.advanced.includeGroupNumber, { label: 'Write rlnGroupNumber column' }),
            }, { label: 'Advanced metadata', isExpanded: false }),
        } as const;
    };

    private onChangeValues = (next: any) => {
        const newSelection: string[] = Array.isArray(next.selected) ? next.selected.slice() : [];
        const selectionChanged = !selectionEqual(newSelection, this.state.values.selected);

        if (selectionChanged && newSelection.length > 0) {
            // Re-derive defaults from the newly selected set; keep file name editable.
            this.setState(prev => ({
                ...prev,
                values: deriveFormValues(newSelection, prev.entries, prev.volumeDefaults, { ...prev.values, fileName: prev.values.fileName }),
            }));
            return;
        }

        const prevFormat = this.state.values.format;
        const nextFormat: ExportFormat = next.format;
        const fileName = prevFormat !== nextFormat
            ? `${stripExtension(next.fileName || '')}${FormatFileExt[nextFormat]}`
            : next.fileName;

        this.setState(prev => ({
            ...prev,
            values: {
                selected: newSelection,
                format: nextFormat,
                fileName,
                apix: next.apix,
                advanced: { ...next.advanced },
            },
        }));
    };

    private save = () => {
        const v = this.state.values;
        if (v.selected.length === 0) return;

        const entriesByRef = new Map(this.state.entries.map(e => [e.ref, e]));
        const selectedLists = v.selected
            .map(ref => entriesByRef.get(ref))
            .filter((x): x is ParticleListExportEntry => !!x)
            .map(e => e.particleList);

        if (selectedLists.length === 0) return;

        const merged = mergeParticleLists(selectedLists);

        try {
            this.setState({ busy: true });
            const ext = FormatFileExt[v.format];
            const baseName = stripExtension(v.fileName.trim() || suggestExportFileName(merged.particleBlockHeader || 'particles', 'star'));
            const fileName = `${baseName}${ext}`;

            if (v.format === 'star') {
                const metadata: RelionStarExportMetadata = {
                    particleBlockName: merged.particleBlockHeader || 'particles',
                    coordinateConvention: v.advanced.coordinateConvention,
                    originConvention: v.advanced.originConvention,
                    angleSource: 'auto',
                    boxCenter: v.advanced.centerCoordinates && v.advanced.imageSize > 0
                        ? [v.advanced.imageSize / 2, v.advanced.imageSize / 2, v.advanced.imageSize / 2] as any
                        : undefined,
                    optics: {
                        opticsGroup: 1,
                        opticsGroupName: v.advanced.opticsGroupName || 'opticsGroup1',
                        imagePixelSize: v.apix,
                        imageSize: v.advanced.imageSize > 0 ? v.advanced.imageSize : undefined,
                        imageDimensionality: 3,
                        voltage: v.advanced.voltage > 0 ? v.advanced.voltage : undefined,
                        sphericalAberration: v.advanced.sphericalAberration > 0 ? v.advanced.sphericalAberration : undefined,
                        amplitudeContrast: v.advanced.amplitudeContrast > 0 ? v.advanced.amplitudeContrast : undefined,
                    },
                    defaultTomoName: v.advanced.defaultTomoName || undefined,
                    defaultMicrographName: v.advanced.defaultMicrographName || undefined,
                    defaultImageName: v.advanced.defaultImageName || undefined,
                    includeOpticsGroupColumn: v.advanced.includeOpticsGroup,
                    includeTomoNameColumn: v.advanced.includeTomoName,
                    includeMicrographNameColumn: v.advanced.includeMicrographName,
                    includeImageNameColumn: v.advanced.includeImageName,
                    includeClassNumberColumn: v.advanced.includeClassNumber,
                    includeGroupNumberColumn: v.advanced.includeGroupNumber,
                };
                const text = writeRelionStarParticleList(merged, { positionScale: v.apix, metadata });
                downloadText(text, fileName);
            } else if (v.format === 'dynamo') {
                const result = writeDynamoTblParticleList(merged, { apix: v.apix });
                downloadText(result.tbl, fileName);
                if (result.doc) downloadText(result.doc, `${baseName}.doc`);
            } else if (v.format === 'ha-tsv') {
                const text = writeHaTsvParticleList(merged, { apix: v.apix });
                downloadText(text, fileName);
            } else if (v.format === 'csv') {
                const text = writeParticlesCsv(merged, { apix: v.apix });
                downloadText(text, fileName);
            }
        } catch (e) {
            console.error(e);
            this.plugin.log.error(`Particle export failed: ${e}`);
        } finally {
            this.setState({ busy: false });
        }
    };

    protected renderControls(): JSX.Element | null {
        const disabled = this.state.busy || this.state.values.selected.length === 0;
        const formatValues = {
            selected: this.state.values.selected,
            format: this.state.values.format,
            fileName: this.state.values.fileName,
            apix: this.state.values.apix,
            advanced: this.state.values.advanced,
        };
        return <>
            <ParameterControls params={this.params() as any} values={formatValues} onChangeValues={this.onChangeValues} isDisabled={this.state.busy} />
            <Button icon={GetAppSvg} onClick={this.save} style={{ marginTop: 1 }} disabled={disabled} commit={disabled ? 'off' : 'on'}>
                {this.state.values.selected.length > 1 ? `Export & Merge (${this.state.values.selected.length})` : 'Export'}
            </Button>
        </>;
    }
}

function emptyFormValues(): FormValues {
    return {
        selected: [],
        format: 'star',
        fileName: 'particles_export.star',
        apix: 1,
        advanced: {
            imageSize: 0,
            coordinateConvention: 'pixel',
            originConvention: 'pixel',
            centerCoordinates: false,
            opticsGroupName: 'opticsGroup1',
            voltage: 300,
            sphericalAberration: 2.7,
            amplitudeContrast: 0.1,
            defaultTomoName: '',
            defaultMicrographName: '',
            defaultImageName: '',
            includeOpticsGroup: true,
            includeTomoName: false,
            includeMicrographName: false,
            includeImageName: false,
            includeClassNumber: false,
            includeGroupNumber: false,
        },
    };
}

function selectionEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; ++i) if (a[i] !== b[i]) return false;
    return true;
}

function stripExtension(name: string): string {
    return name.replace(/\.(star|tbl|tsv|csv|doc)$/i, '');
}

function downloadText(text: string, fileName: string) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    download(blob, fileName);
}

function mergeParticleLists(lists: ReadonlyArray<ParticleList>): ParticleList {
    if (lists.length === 1) return lists[0];

    const particles: ParticleListParticle[] = [];
    let particleIndex = 0;
    for (const list of lists) {
        for (const p of list.particles) {
            particles.push({ ...p, index: particleIndex++ });
        }
    }

    const labels = lists.map(l => l.particleBlockHeader || 'particles');
    const uniqueLabels = Array.from(new Set(labels));

    return {
        format: 'relion-star',
        particleBlockHeader: uniqueLabels.length === 1 ? uniqueLabels[0] : 'particles',
        opticsBlockHeader: lists.find(l => l.opticsBlockHeader)?.opticsBlockHeader,
        particles,
        suggestedScale: lists.find(l => l.suggestedScale && Number.isFinite(l.suggestedScale))?.suggestedScale ?? 1,
        warnings: lists.flatMap(l => l.warnings ?? []),
    };
}

function deriveFormValues(selected: string[], entries: ParticleListExportEntry[], volumeDefaults: VolumeMetadataDefaults, prev: FormValues): FormValues {
    const byRef = new Map(entries.map(e => [e.ref, e]));
    const chosen = selected.map(ref => byRef.get(ref)).filter((x): x is ParticleListExportEntry => !!x);
    if (chosen.length === 0) return emptyFormValues();

    const mergedList = chosen.length === 1 ? chosen[0].particleList : mergeParticleLists(chosen.map(e => e.particleList));
    const positionScale = chosen[0].positionScale;
    const metadata = getDefaultExportMetadata(positionScale, volumeDefaults, mergedList);
    const apix = volumeDefaults.pixelSize ?? positionScale ?? metadata.optics.imagePixelSize ?? 1;
    const imageSize = volumeDefaults.imageSize ?? metadata.optics.imageSize ?? 0;
    const fileNameLabel = chosen.length === 1
        ? chosen[0].label
        : `${chosen[0].label}_merged_${chosen.length}`;

    return {
        selected,
        format: 'star',
        fileName: suggestExportFileName(fileNameLabel, 'star'),
        apix,
        advanced: {
            imageSize,
            coordinateConvention: metadata.coordinateConvention,
            originConvention: metadata.originConvention,
            centerCoordinates: !!metadata.boxCenter,
            opticsGroupName: metadata.optics.opticsGroupName,
            voltage: metadata.optics.voltage ?? prev.advanced.voltage,
            sphericalAberration: metadata.optics.sphericalAberration ?? prev.advanced.sphericalAberration,
            amplitudeContrast: metadata.optics.amplitudeContrast ?? prev.advanced.amplitudeContrast,
            defaultTomoName: metadata.defaultTomoName ?? '',
            defaultMicrographName: metadata.defaultMicrographName ?? '',
            defaultImageName: metadata.defaultImageName ?? '',
            includeOpticsGroup: metadata.includeOpticsGroupColumn,
            includeTomoName: metadata.includeTomoNameColumn,
            includeMicrographName: metadata.includeMicrographNameColumn,
            includeImageName: metadata.includeImageNameColumn,
            includeClassNumber: metadata.includeClassNumberColumn,
            includeGroupNumber: metadata.includeGroupNumberColumn,
        },
    };
}
