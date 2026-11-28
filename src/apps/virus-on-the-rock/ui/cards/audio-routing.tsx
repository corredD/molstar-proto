/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 * @author Ludovic Autin <autin@scripps.edu>
 */

import * as React from 'react';
import { useBehavior } from '../../../../mol-plugin-ui/hooks/use-behavior';
import { InspiredRoutings } from '../../../../mol-plugin-state/helpers/audio-routing-inspired';
import { describeAudioAffect, listAudioAffectChoices } from '../../../../mol-plugin-state/helpers/audio-affect';
import { AudioAffectLevels, AudioRouteCurves, AudioRouteSources, AudioRouteTargets, AudioScopeSlotCount, canonicalAudioAffect, createAudioRoute, draftsFromRoutes, maxScopeLevel, narrowedRouteCount, getDefaultAudioRoutes, isStemEventSource, loadStoredAudioRouting, parseAudioRouting, routesFromDrafts, storeAudioRouting, type AudioAffect, type AudioRoute, type AudioRoutingPreset } from '../../../../mol-plugin-state/manager/audio-routing';
import { type AudioReactiveStatus } from '../../../../mol-plugin-state/manager/audio-reactive-animation';
import type { VirusOnTheRockApp } from '../../app';

/** why a Who select is disabled once 8 routes act on a part (D3) */
export const NarrowedSlotsFullNote = '8 routes are narrowed (on or off): widen one to All first';

export const AffectLevelRank: Record<AudioAffect['level'], number> = {
    all: 0, model: 1, entity: 2, instance: 3, chain: 4, residue: 5, atom: 6,
};

export const AffectLevelShort: Record<AudioAffect['level'], string> = {
    all: 'All', model: 'Model', entity: 'Entity', instance: 'Instance', chain: 'Chain', residue: 'Residue', atom: 'Atom',
};

/** One route's Who row: how fine (level), which one, and a pick from what is clicked in the viewer */
/** `slotsFull`: the 8 slots are taken, counted once per render by the card */
export function RouteAffectRow({ app, route, slotsFull }: { app: VirusOnTheRockApp, route: AudioRoute, slotsFull: boolean }) {
    const manager = app.viewer.plugin.managers.audioReactive;
    const hierarchy = useBehavior(manager.plugin.managers.structure.hierarchy.behaviors.selection);
    const affect = route.affect;
    const max = maxScopeLevel(route.target);
    const full = slotsFull && max !== 'all' && affect.level === 'all';
    const choices = React.useMemo(
        () => affect.level === 'all' ? [] : listAudioAffectChoices(manager.plugin, affect),
        [manager, affect, hierarchy],
    );
    if (max === 'all') {
        return <div className='vor-route-row vor-route-who'>
            <span className='vor-route-who-label'>Who</span>
            <span className='vor-route-who-fixed'>the whole view</span>
        </div>;
    }
    const levels = AudioAffectLevels.filter(([level]) => AffectLevelRank[level] <= AffectLevelRank[max]);
    const selected = JSON.stringify(canonicalAudioAffect(affect));
    const known = choices.some(choice => choice.id === selected);
    return <div className='vor-route-row vor-route-who'>
        <span className='vor-route-who-label'>Who</span>
        <select
            className='vor-select vor-route-level'
            value={affect.level}
            disabled={full}
            title={full ? NarrowedSlotsFullNote : max === 'atom'
                ? 'How much of the structure this route acts on'
                : 'How much of the structure this route moves. A chain moves with its whole copy, so instance motion stops at the chain'}
            onChange={e => manager.pickRouteAffect(route.id, e.target.value as AudioAffect['level'])}
        >
            {levels.map(([level]) => <option key={level} value={level}>{AffectLevelShort[level]}</option>)}
        </select>
        {affect.level !== 'all' && <select
            className='vor-select'
            value={known ? selected : ''}
            title={describeAudioAffect(manager.plugin, affect)}
            onChange={e => {
                const choice = choices.find(item => item.id === e.target.value);
                if (choice) manager.setRouteAffect(route.id, choice.affect);
            }}
        >
            {!known && <option value=''>{describeAudioAffect(manager.plugin, affect)}</option>}
            {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
        </select>}
        {affect.level !== 'all' && <button
            className='vor-chip vor-route-remove'
            title='Pick what is clicked or selected in the viewer'
            onClick={() => manager.pickRouteAffect(route.id, affect.level)}
        >◎</button>}
    </div>;
}

/** the built-in route sets in the Saved list: their option values carry this prefix, so a saved routing of the same name stays apart */
export const InspiredPrefix = 'inspired:';

export function AudioRoutingLibrary({ app }: { app: VirusOnTheRockApp }) {
    const manager = app.viewer.plugin.managers.audioReactive;
    const [presets, setPresets] = React.useState<AudioRoutingPreset[]>(() => loadStoredAudioRouting());
    const [name, setName] = React.useState('My routing');
    const [picked, setPicked] = React.useState('');
    const fileRef = React.useRef<HTMLInputElement>(null);

    const remember = (next: AudioRoutingPreset[]) => {
        const stored = storeAudioRouting(next);
        setPresets(stored);
        return stored;
    };

    const save = () => {
        const trimmed = name.trim() || 'Routing';
        const preset: AudioRoutingPreset = {
            version: 1,
            name: trimmed,
            routes: draftsFromRoutes(manager.state.routes.value),
        };
        const without = presets.filter(item => item.name !== trimmed);
        remember([preset, ...without]);
        setPicked(trimmed);
        setName(trimmed);
    };

    const load = (presetName: string) => {
        setPicked(presetName);
        if (presetName.startsWith(InspiredPrefix)) setName(presetName.slice(InspiredPrefix.length));
        loadFrom(presets, presetName);
    };

    const download = () => {
        const text = JSON.stringify({
            version: 1,
            name: name.trim() || 'Routing',
            routes: draftsFromRoutes(manager.state.routes.value),
        }, null, 2);
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `${(name.trim() || 'audio-routing').replace(/[^\w.-]+/g, '_')}.json`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const importFile = (file: File | undefined) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const parsed = typeof reader.result === 'string' ? parseAudioRouting(reader.result) : undefined;
            if (!parsed) return;
            const byName = new Map(presets.map(item => [item.name, item]));
            for (const preset of parsed) byName.set(preset.name, preset);
            const stored = remember([...byName.values()]);
            const first = parsed[0];
            if (!first) return;
            setName(first.name);
            setPicked(first.name);
            if (stored.some(item => item.name === first.name)) loadFrom(stored, first.name);
        };
        reader.readAsText(file);
    };

    const loadFrom = (list: readonly AudioRoutingPreset[], presetName: string) => {
        const preset = presetName.startsWith(InspiredPrefix)
            ? InspiredRoutings.find(item => item.name === presetName.slice(InspiredPrefix.length))
            : list.find(item => item.name === presetName);
        if (!preset) return;
        // a saved affect names its model by entry id too: reattached to the models loaded now
        manager.setRoutes(routesFromDrafts(preset.routes));
        for (const route of manager.state.routes.value) manager.setRouteAffect(route.id, route.affect);
    };

    return <div className='vor-routing-save'>
        <input className='vor-input' value={name} aria-label='Routing preset name' onChange={e => setName(e.target.value)} />
        <button className='vor-chip' title='Keep these routes and who they affect in this browser' onClick={save}>Save</button>
        <select className='vor-select' value={picked} aria-label='Saved routing presets' onChange={e => load(e.target.value)}>
            <option value=''>Saved…</option>
            {presets.length > 0 && <optgroup label='Saved in this browser'>
                {presets.map(preset => <option key={preset.name} value={preset.name}>{preset.name}</option>)}
            </optgroup>}
            <optgroup label='Inspired by acclaimed audio-visual works'>
                {InspiredRoutings.map(preset => <option key={preset.name} value={InspiredPrefix + preset.name} title={preset.description}>{preset.name}</option>)}
            </optgroup>
        </select>
        <button className='vor-chip' title='Remove the selected saved routing' disabled={!picked || picked.startsWith(InspiredPrefix)} onClick={() => {
            remember(presets.filter(item => item.name !== picked));
            setPicked('');
        }}>Delete</button>
        <button className='vor-chip' title='Download this routing as JSON' onClick={download}>Export</button>
        <button className='vor-chip' title='Load a routing JSON file' onClick={() => fileRef.current?.click()}>Import</button>
        <input ref={fileRef} className='vor-file' type='file' accept='application/json,.json' hidden onChange={e => {
            importFile(e.target.files?.[0]);
            e.target.value = '';
        }} />
    </div>;
}

export function AudioRoutingCard({ app }: { app: VirusOnTheRockApp }) {
    const manager = app.viewer.plugin.managers.audioReactive;
    const routes = useBehavior(manager.state.routes);
    const status = useBehavior(manager.state.status) as AudioReactiveStatus | undefined;
    if (!routes) return null;
    const slotsFull = narrowedRouteCount(routes) >= AudioScopeSlotCount;
    return <div className='vor-stack'>
        {slotsFull && <p className='vor-help'>{NarrowedSlotsFullNote}</p>}
        {routes.map(route => {
            const value = status?.routeValues.get(route.id) ?? 0;
            return <div key={route.id} className={`vor-route ${route.enabled ? '' : 'vor-route-off'}`}>
                <div className='vor-route-row'>
                    <input
                        type='checkbox'
                        checked={route.enabled}
                        title={route.enabled ? 'On: click to mute this route' : 'Off: click to turn this route on'}
                        onChange={e => manager.updateRoute(route.id, { enabled: e.target.checked })}
                    />
                    <select className='vor-select' value={route.source} onChange={e => manager.updateRoute(route.id, { source: e.target.value as AudioRoute['source'] })}>
                        {AudioRouteSources.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <select className='vor-select vor-route-mode' value={route.mode} title={isStemEventSource(route.source) ? 'An event source is a hit already: Level and Hits both read its strength on the frame it is heard' : 'Level follows how loud the source is; Hits follows how much it just rose'} onChange={e => manager.updateRoute(route.id, { mode: e.target.value as AudioRoute['mode'] })}>
                        <option value='level'>Level</option>
                        <option value='onset'>Hits</option>
                    </select>
                    <button className='vor-chip vor-route-remove' title='Remove this route' onClick={() => manager.removeRoute(route.id)}>×</button>
                </div>
                <div className='vor-route-row'>
                    <span className='vor-route-arrow'>→</span>
                    <select className='vor-select' value={route.target} onChange={e => {
                        manager.updateRoute(route.id, { target: e.target.value as AudioRoute['target'] });
                        // a channel that cannot be narrowed as far keeps what it can of the Who
                        manager.setRouteAffect(route.id, route.affect);
                    }}>
                        {AudioRouteTargets.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <select className='vor-select vor-route-mode' value={route.curve} title='How the source is bent before the gain: Log lifts the quiet parts (soft, always moving), Exp keeps only the peaks (hard contrast)' onChange={e => manager.updateRoute(route.id, { curve: e.target.value as AudioRoute['curve'] })}>
                        {AudioRouteCurves.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                </div>
                <RouteAffectRow app={app} route={route} slotsFull={slotsFull} />
                <div className='vor-route-row'>
                    <label className='vor-route-gain' title='Sensitivity: how much the source moves the channel'>
                        Gain {route.gain.toFixed(2)}
                        <input type='range' min='0' max='20' step='0.1' value={route.gain} onChange={e => manager.updateRoute(route.id, { gain: parseFloat(e.target.value) })} />
                    </label>
                    <div className='vor-route-meter' title='What this route sends now'><i style={{ width: `${Math.min(100, value * 12.5)}%` }} /></div>
                </div>
                <div className='vor-route-row'>
                    <label className='vor-route-gain' title='Hit threshold: the source at or under it sends nothing; above it, the rest is spread over the full range'>
                        Hit threshold {route.threshold.toFixed(2)}
                        <input type='range' min='0' max='0.95' step='0.05' value={route.threshold} onChange={e => manager.updateRoute(route.id, { threshold: parseFloat(e.target.value) })} />
                    </label>
                    <label title='Only while no stem events arrive (no model, or the model falling behind)'>
                        <input type='checkbox' checked={route.standIn} onChange={e => manager.updateRoute(route.id, { standIn: e.target.checked })} /> Stand-in
                    </label>
                </div>
            </div>;
        })}
        <div className='vor-chip-row'>
            <button className='vor-chip' onClick={() => manager.setRoutes([...routes, createAudioRoute({ enabled: true, source: 'stemDrums', mode: 'onset', target: 'symAxis', gain: 1, floor: 0, releaseMs: 250 })])}>+ Add route</button>
            <button className='vor-chip' title='A traveling wave on instance positions. Its height is this route’s source — pick the stem on the new row. It moves even when Instance Beats is off.' onClick={() => manager.setRoutes([...routes, createAudioRoute({ enabled: true, source: 'stemDrums', mode: 'level', target: 'instanceWave', gain: 6, floor: 0, releaseMs: 280 })])}>+ Instance wave</button>
            <button className='vor-chip' title='Kicks and bass notes (stem events) to the symmetry axes, the drums and bass levels standing in without them; other to the atoms, vocals to the illumination' onClick={() => manager.setRoutes(getDefaultAudioRoutes())}>Defaults</button>
        </div>
        <AudioRoutingLibrary app={app} />
        <p className='vor-help'>
            Each route sends an audio source to a visual channel; a channel sums its routes. Who narrows a route to one model, entity, instance or chain (atom wiggle, illumination and colours down to one residue or atom); ◎ takes what you clicked in the viewer. Camera, clipping and opacity always act on the whole view. Up to 8 routes can be narrowed at once; then the Who of the others is disabled. The wave's height is its route's source. Save keeps the routes and who each moves.
        </p>
    </div>;
}

export function AudioAnalysisWarning({ app }: { app: VirusOnTheRockApp }) {
    const status = useBehavior(app.viewer.plugin.managers.audioReactive.state.status);
    if (!status?.analysisBlocked) return null;
    return (
        <p className='vor-analysis-warning'>
            Audio is playing but analysis is silent. Remote streams may be CORS-blocked locally — try a local audio file instead, or run the app over HTTPS.
        </p>
    );
}
