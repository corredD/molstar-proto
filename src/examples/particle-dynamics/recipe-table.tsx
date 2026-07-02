/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 *
 * Simple editable recipe table: one row per `ParticleRecipeEntry`, modeled directly on Mesoscope's
 * `IngredientSpreadsheetWidget` (a plain `<table>` with per-cell inputs/selects) - Mol*'s own UI kit
 * has no table component to reuse and this doesn't need one. Selection is shared with
 * `RecipeSchematic` via `onSelect`.
 */

import { Particle } from '../../mol-model/particles/particle-list';
import { ParticleRecipe, ParticleRecipeEntry } from './recipe';

const SURFACE_MODES: (Particle.SurfaceMode | '')[] = ['', 'on', 'inside', 'outside'];

export function RecipeTable(props: {
    recipe: ParticleRecipe,
    sources: { id: string, label: string }[],
    meshSources: { id: string, label: string }[],
    selectedId?: string,
    onSelect: (id: string) => void,
    onPatchEntry: (id: string, patch: Partial<ParticleRecipeEntry>) => void,
    onDeleteEntry: (id: string) => void,
}) {
    const { recipe, sources, meshSources, selectedId, onSelect, onPatchEntry, onDeleteEntry } = props;

    return <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'smaller' }}>
        <thead>
            <tr>
                {['Name', 'Compartment', 'Source', 'Count', 'Surface', ''].map(h =>
                    <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #999', padding: '2px 4px' }}>{h}</th>)}
            </tr>
        </thead>
        <tbody>
            {recipe.entries.map(entry => (
                <tr
                    key={entry.id}
                    onClick={() => onSelect(entry.id)}
                    style={{ background: entry.id === selectedId ? '#dbe9f7' : undefined, cursor: 'pointer' }}
                >
                    <td style={{ padding: '2px 4px' }}>
                        <input
                            value={entry.name}
                            onChange={e => onPatchEntry(entry.id, { name: e.target.value })}
                            onClick={e => e.stopPropagation()}
                            style={{ width: '100%' }}
                        />
                    </td>
                    <td style={{ padding: '2px 4px' }}>
                        <input
                            value={entry.compartment}
                            onChange={e => onPatchEntry(entry.id, { compartment: e.target.value })}
                            onClick={e => e.stopPropagation()}
                            style={{ width: '100%' }}
                        />
                    </td>
                    <td style={{ padding: '2px 4px' }}>
                        <select
                            value={entry.source}
                            onChange={e => onPatchEntry(entry.id, { source: e.target.value })}
                            onClick={e => e.stopPropagation()}
                        >
                            {sources.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </select>
                    </td>
                    <td style={{ padding: '2px 4px' }}>
                        <input
                            type='number' min={1} value={entry.count}
                            onChange={e => onPatchEntry(entry.id, { count: Math.max(1, +e.target.value | 0) })}
                            onClick={e => e.stopPropagation()}
                            style={{ width: 64 }}
                        />
                    </td>
                    <td style={{ padding: '2px 4px' }}>
                        <select
                            value={entry.surfaceMode ?? ''}
                            onChange={e => onPatchEntry(entry.id, { surfaceMode: (e.target.value || undefined) as Particle.SurfaceMode | undefined })}
                            onClick={e => e.stopPropagation()}
                        >
                            {SURFACE_MODES.map(m => <option key={m} value={m}>{m || 'free'}</option>)}
                        </select>
                        {entry.surfaceMode && <select
                            value={entry.surfaceMeshRef ?? ''}
                            onChange={e => onPatchEntry(entry.id, { surfaceMeshRef: e.target.value || undefined })}
                            onClick={e => e.stopPropagation()}
                        >
                            <option value=''>(no mesh)</option>
                            {meshSources.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                        </select>}
                    </td>
                    <td style={{ padding: '2px 4px' }}>
                        <button onClick={e => { e.stopPropagation(); onDeleteEntry(entry.id); }}>×</button>
                    </td>
                </tr>
            ))}
        </tbody>
    </table>;
}
