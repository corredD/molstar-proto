/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 * @author Ludovic Autin <autin@scripps.edu>
 */

import * as React from 'react';
import type { VirusOnTheRockApp } from '../../app';
import { ExamplePdbIds, IsLocalHost, MesoscaleExamples } from '../../catalog';
import { VirusOnTheRockState } from '../../state';
import { ControlCard } from '../control-card';
import { useStateSlice } from '../state-slice';

export const selectLoadStructure = (s: VirusOnTheRockState) => ({
    randomPerSong: s.randomPerSong,
    loadingModel: s.loadingModel,
    songChangeNote: s.songChangeNote,
});

export function LoadStructureCard({ app, pdbId, setPdbId }: { app: VirusOnTheRockApp, pdbId: string, setPdbId: React.Dispatch<React.SetStateAction<string>> }) {
    const state = useStateSlice(app, selectLoadStructure);
    const onStructureFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);
        if (files.length > 0) await app.loadStructureFiles(files);
        event.target.value = '';
    };

    return <ControlCard title='Load Structure'>
        <div className='vor-stack'>
            <label className='vor-label' htmlFor='vor-pdb-id'>PDB ID</label>
            <div className='vor-row'>
                <input
                    id='vor-pdb-id'
                    className='vor-input'
                    value={pdbId}
                    onChange={e => setPdbId(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void app.loadPdb(pdbId); }}
                    placeholder='2plv'
                />
                <button className='vor-button vor-primary' onClick={() => void app.loadPdb(pdbId)}>Load</button>
            </div>
            <div className='vor-chip-row'>
                {ExamplePdbIds.map(example => <button
                    key={example}
                    className={`vor-chip ${pdbId.toLowerCase() === example ? 'vor-active' : ''}`}
                    onClick={() => {
                        setPdbId(example);
                        void app.loadPdb(example);
                    }}
                >
                    {example.toUpperCase()}
                </button>)}
                <button
                    className={`vor-chip ${state.randomPerSong ? 'vor-active' : ''}`}
                    onClick={() => void app.setRandomPerSong(!state.randomPerSong)}
                    title={state.randomPerSong
                        ? 'On: a random virus at each new song. Click to keep the current one.'
                        : 'A random virus now, and a new one at each new song (a PDB capsid or a mesoscale virion).'}
                >
                    Random
                </button>
            </div>
            <span className='vor-label'>Mesoscale</span>
            <div className='vor-chip-row'>
                {MesoscaleExamples.filter(example => !example.localOnly || IsLocalHost).map(example => <button
                    key={example.id}
                    className='vor-chip'
                    disabled={!!state.loadingModel}
                    title={example.description}
                    onClick={() => void app.loadMesoscaleExample(example)}
                >
                    {example.label}
                </button>)}
            </div>
            {(state.loadingModel || (state.randomPerSong && state.songChangeNote)) && <p className='vor-help'>
                {state.loadingModel ? `Loading ${state.loadingModel}…` : state.songChangeNote}
            </p>}
            <label className='vor-label' htmlFor='vor-structure-file'>Browser File</label>
            <input id='vor-structure-file' className='vor-file' type='file' multiple onChange={onStructureFileChange} />
        </div>
    </ControlCard>;
}
