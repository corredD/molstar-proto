/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 */

import './index.html';
import { resizeCanvas } from '../../mol-canvas3d/util';
import { Canvas3D, Canvas3DContext } from '../../mol-canvas3d/canvas3d';
import { AssetManager } from '../../mol-util/assets';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { RepresentationContext } from '../../mol-repr/representation';
import { ThemeRegistryContext } from '../../mol-theme/theme';
import { ParticlesRepresentation, getParticlesParams } from '../../mol-repr/shape/particles';
import { parseCifText } from '../../mol-io/reader/cif/text/parser';
import { parseRelionStar } from '../../mol-io/reader/relion/star';
import { parseDynamoTbl } from '../../mol-io/reader/dynamo/tbl';
import { parseCryoEtDataPortalNdjson } from '../../mol-io/reader/cryoet/ndjson';
import { createParticlesFromCryoEtDataPortalNdjson, createParticlesFromDynamoTbl, createParticlesFromRelionStar, getDynamoTblTomogramIds, getRelionStarTomogramNames, ParticlesData } from '../../mol-model-formats/shape/particles';

const parent = document.getElementById('app')!;
parent.style.width = '100%';
parent.style.height = '100%';
parent.style.position = 'relative';

const canvas = document.createElement('canvas');
parent.appendChild(canvas);

const panel = document.createElement('div');
panel.style.position = 'absolute';
panel.style.top = '16px';
panel.style.left = '16px';
panel.style.zIndex = '10';
panel.style.display = 'flex';
panel.style.flexDirection = 'column';
panel.style.gap = '8px';
panel.style.width = '360px';
panel.style.padding = '12px';
panel.style.background = 'rgba(20, 20, 20, 0.85)';
panel.style.color = 'white';
panel.style.fontFamily = 'sans-serif';
panel.style.fontSize = '13px';
panel.style.borderRadius = '8px';
parent.appendChild(panel);

const title = document.createElement('div');
title.textContent = 'Parse Particles';
title.style.fontSize = '16px';
title.style.fontWeight = '600';
panel.appendChild(title);

const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = '.star,.tbl,.ndjson,.jsonl';
panel.appendChild(fileInput);

const formatSelect = document.createElement('select');
for (const [value, label] of [
    ['auto', 'Auto'],
    ['star', 'RELION STAR'],
    ['tbl', 'Dynamo TBL'],
    ['ndjson', 'CryoET NDJSON'],
] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    formatSelect.appendChild(option);
}
panel.appendChild(formatSelect);

const subsetInput = document.createElement('input');
subsetInput.type = 'text';
subsetInput.placeholder = 'Subset filter: tomo name / tomo id / ndjson type';
panel.appendChild(subsetInput);

const buttonRow = document.createElement('div');
buttonRow.style.display = 'flex';
buttonRow.style.gap = '8px';
panel.appendChild(buttonRow);

const loadButton = document.createElement('button');
loadButton.textContent = 'Load';
buttonRow.appendChild(loadButton);

const clearButton = document.createElement('button');
clearButton.textContent = 'Clear';
buttonRow.appendChild(clearButton);

const status = document.createElement('pre');
status.style.whiteSpace = 'pre-wrap';
status.style.wordBreak = 'break-word';
status.style.maxHeight = '260px';
status.style.overflow = 'auto';
status.style.margin = '0';
panel.appendChild(status);

const assetManager = new AssetManager();
const canvas3dContext = Canvas3DContext.fromCanvas(canvas, assetManager);
const canvas3d = Canvas3D.create(canvas3dContext);
resizeCanvas(canvas, parent, canvas3dContext.pixelScale);
canvas3dContext.syncPixelScale();
canvas3d.requestResize();
canvas3d.animate();

canvas3d.input.resize.subscribe(() => {
    resizeCanvas(canvas, parent, canvas3dContext.pixelScale);
    canvas3dContext.syncPixelScale();
    canvas3d.requestResize();
});

const representationContext = {} as RepresentationContext;
const themeRegistryContext = representationContext as unknown as ThemeRegistryContext;
let currentRepr: ReturnType<typeof ParticlesRepresentation> | undefined;

function setStatus(lines: string[]) {
    status.textContent = lines.join('\n');
}

function inferFormat(fileName: string) {
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.star')) return 'star';
    if (lower.endsWith('.tbl')) return 'tbl';
    if (lower.endsWith('.ndjson') || lower.endsWith('.jsonl')) return 'ndjson';
    return 'auto';
}

async function buildParticlesData(file: File) {
    const text = await file.text();
    const requestedFormat = formatSelect.value;
    const format = requestedFormat === 'auto' ? inferFormat(file.name) : requestedFormat;
    const subset = subsetInput.value.trim();

    if (format === 'star') {
        const cif = await parseCifText(text).run();
        if (cif.isError) throw new Error(cif.message);

        const relion = parseRelionStar(cif.result);
        if (relion.isError) throw new Error(relion.message);

        const tomograms = getRelionStarTomogramNames(relion.result);
        const particles = createParticlesFromRelionStar(relion.result, subset ? { tomogram: subset } : {});
        return {
            particles,
            summary: [
                `format: RELION STAR`,
                `particle block: ${relion.result.particleBlock.header}`,
                `optics block: ${relion.result.opticsBlock?.header ?? 'none'}`,
                `tomograms: ${tomograms.length ? tomograms.join(', ') : 'none'}`,
                `rendered particles: ${particles.particles.length}`,
                `pixel size: ${particles.pixelSize ?? 'none'}`,
                ...particles.warnings.map(w => `warning: ${w}`),
            ]
        };
    }

    if (format === 'tbl') {
        const tbl = await parseDynamoTbl(text).run();
        if (tbl.isError) throw new Error(tbl.message);

        const tomogramIds = getDynamoTblTomogramIds(tbl.result);
        const tomo = subset ? Number(subset) : void 0;
        if (subset && !Number.isFinite(tomo)) {
            throw new Error('Dynamo subset filter must be a numeric tomo id.');
        }

        const particles = createParticlesFromDynamoTbl(tbl.result, tomo !== void 0 ? { tomo } : {});
        return {
            particles,
            summary: [
                'format: Dynamo TBL',
                `rows: ${tbl.result.rowCount}`,
                `columns: ${tbl.result.columnCount}`,
                `tomo ids: ${tomogramIds.length ? tomogramIds.join(', ') : 'none'}`,
                `rendered particles: ${particles.particles.length}`,
                `pixel size: ${particles.pixelSize ?? 'none'}`,
                ...tbl.warnings.map(w => `warning: ${w}`),
                ...particles.warnings.map(w => `warning: ${w}`),
            ]
        };
    }

    if (format === 'ndjson') {
        const ndjson = await parseCryoEtDataPortalNdjson(text).run();
        if (ndjson.isError) throw new Error(ndjson.message);

        const types = Array.from(new Set(ndjson.result.records.map(record => record.type))).sort();
        const particles = createParticlesFromCryoEtDataPortalNdjson(ndjson.result, subset ? { type: subset } : {});
        return {
            particles,
            summary: [
                'format: CryoET Data Portal ndjson',
                `record count: ${ndjson.result.records.length}`,
                `types: ${types.join(', ')}`,
                `rendered particles: ${particles.particles.length}`,
                `pixel size: ${particles.pixelSize ?? 'none'}`,
                ...particles.warnings.map(w => `warning: ${w}`),
            ]
        };
    }

    throw new Error(`Unable to infer format for '${file.name}'. Select the format manually.`);
}

async function renderParticles(particles: ParticlesData) {
    if (currentRepr) {
        canvas3d.remove(currentRepr);
        currentRepr.destroy();
        currentRepr = void 0;
    }

    const repr = ParticlesRepresentation(representationContext, getParticlesParams);
    const props = {
        ...PD.getDefaultValues(getParticlesParams(themeRegistryContext, particles)),
        visuals: ['position', 'orientation'] as Array<'position' | 'orientation'>,
    };
    await repr.createOrUpdate(props, particles).run();
    canvas3d.add(repr);
    canvas3d.requestCameraReset();
    currentRepr = repr;
}

async function loadCurrentFile() {
    const file = fileInput.files?.[0];
    if (!file) {
        setStatus(['Select a file first.']);
        return;
    }

    try {
        setStatus([`loading ${file.name}...`]);
        const { particles, summary } = await buildParticlesData(file);
        await renderParticles(particles);
        setStatus(summary);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus([`error: ${message}`]);
        console.error(error);
    }
}

loadButton.onclick = () => { void loadCurrentFile(); };
fileInput.onchange = () => { void loadCurrentFile(); };
clearButton.onclick = () => {
    if (currentRepr) {
        canvas3d.remove(currentRepr);
        currentRepr.destroy();
        currentRepr = void 0;
    }
    fileInput.value = '';
    setStatus(['cleared']);
};

setStatus([
    'Select a .star, .tbl, or .ndjson file.',
    'Optional subset filter:',
    '- RELION STAR: tomogram name',
    '- Dynamo TBL: numeric tomo id',
    '- CryoET ndjson: record type',
]);
