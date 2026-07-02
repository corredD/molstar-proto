/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 *
 * Simple recipe schematic: compartments as boxes, entities as circles sized by particle count,
 * modeled on Mesoscope's `SchematicWidget` (compartments -> ingredients) but as a hand-rolled
 * flex-wrap layout rather than a D3 circle-pack - Mol* has no D3 dependency and a "simple" schematic
 * doesn't need one. Selection is shared with `RecipeTable` via `onSelect`, mirroring Mesoscope's
 * `RecipeParityPanel`.
 */

import { ParticleRecipe, ParticleRecipeEntry } from './recipe';

const MIN_DIAMETER = 24;
const MAX_DIAMETER = 72;

function entryDiameter(entry: ParticleRecipeEntry): number {
    // area (not diameter) scales with count so the visual size roughly tracks "how many particles",
    // clamped to a sane on-screen range
    const d = 2 * Math.sqrt(Math.max(1, entry.count)) * 2;
    return Math.max(MIN_DIAMETER, Math.min(MAX_DIAMETER, d));
}

function groupByCompartment(entries: ParticleRecipeEntry[]): [string, ParticleRecipeEntry[]][] {
    const groups = new Map<string, ParticleRecipeEntry[]>();
    for (const e of entries) {
        if (!groups.has(e.compartment)) groups.set(e.compartment, []);
        groups.get(e.compartment)!.push(e);
    }
    return Array.from(groups.entries());
}

export function RecipeSchematic(props: { recipe: ParticleRecipe, selectedId?: string, onSelect: (id: string) => void }) {
    const groups = groupByCompartment(props.recipe.entries);

    return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 8 }}>
        {groups.map(([compartment, entries]) => (
            <div key={compartment} style={{
                border: '1px solid #999', borderRadius: 6, padding: 8, minWidth: 120,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            }}>
                <div style={{ fontSize: 'smaller', fontWeight: 'bold', color: '#666' }}>{compartment}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
                    {entries.map(entry => {
                        const d = entryDiameter(entry);
                        const selected = entry.id === props.selectedId;
                        return <div
                            key={entry.id}
                            title={`${entry.name} (${entry.count})`}
                            onClick={() => props.onSelect(entry.id)}
                            style={{
                                width: d, height: d, borderRadius: '50%', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: selected ? '#4e79a7' : '#bfd4e8',
                                border: selected ? '2px solid #234' : '1px solid #789',
                                color: selected ? '#fff' : '#234',
                                fontSize: 9, textAlign: 'center', overflow: 'hidden', wordBreak: 'break-word',
                            }}
                        >{entry.name}</div>;
                    })}
                </div>
            </div>
        ))}
    </div>;
}
