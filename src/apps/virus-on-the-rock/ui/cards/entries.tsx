/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 * @author Ludovic Autin <autin@scripps.edu>
 */

import * as React from 'react';
import { useBehavior } from '../../../../mol-plugin-ui/hooks/use-behavior';
import { AudioScopeSlotCount, getAudioRouteSourceLabel, narrowedRouteCount, maxScopeLevel, getAudioRouteTargetLabel } from '../../../../mol-plugin-state/manager/audio-routing';
import type { VirusOnTheRockApp } from '../../app';
import { LoadedEntry, VirusOnTheRockState } from '../../state';
import { NarrowedSlotsFullNote } from './audio-routing';
import { ControlCard } from '../control-card';
import { useStateSlice } from '../state-slice';

/** A route to give this row as its Who: the routes that can be narrowed */
export function EntryWhoPicker({ app, refOrGroup }: { app: VirusOnTheRockApp, refOrGroup: string }) {
    const manager = app.viewer.plugin.managers.audioReactive;
    const routes = useBehavior(manager.state.routes);
    const narrowable = routes.filter(route => maxScopeLevel(route.target) !== 'all');
    if (narrowable.length === 0) return null;
    const slotsFull = narrowedRouteCount(routes) >= AudioScopeSlotCount;
    return <select
        className='vor-select vor-entry-who'
        value=''
        title={slotsFull ? `Make this the Who of a route. ${NarrowedSlotsFullNote}` : 'Make this the Who of a route'}
        onChange={e => {
            const affect = app.getEntryAffect(refOrGroup);
            if (affect && e.target.value) manager.setRouteAffect(Number(e.target.value), affect);
        }}
    >
        <option value=''>Who ▸</option>
        {narrowable.map((route, i) => <option key={route.id} value={route.id} disabled={slotsFull && route.affect.level === 'all'}>{`${i + 1}. ${getAudioRouteTargetLabel(route.target)} · ${getAudioRouteSourceLabel(route.source)}`}</option>)}
    </select>;
}

export function EntryRow({ app, entry, hidden, child }: { app: VirusOnTheRockApp, entry: { ref: string, label: string }, hidden: boolean, child?: boolean }) {
    return <div className={`vor-entry-row ${child ? 'vor-entry-child' : ''} ${hidden ? 'vor-entry-hidden' : ''}`}>
        <button className='vor-chip vor-entry-eye' title={hidden ? 'Show' : 'Hide'} onClick={() => app.setEntriesHidden([entry.ref], !hidden)}>{hidden ? '○' : '●'}</button>
        <span className='vor-entry-label'>{entry.label}</span>
        <EntryWhoPicker app={app} refOrGroup={entry.ref} />
        <button className='vor-chip' onClick={() => void app.removeStructure(entry.ref)}>Remove</button>
    </div>;
}

/** The loaded structures as a tree: a mesoscale example over its parts, each part shown or hidden, removed, or made a Who */
export function EntriesTree({ app, entries }: { app: VirusOnTheRockApp, entries: LoadedEntry[] }) {
    const [, redraw] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => {
        const sub = app.viewer.plugin.state.data.events.cell.stateUpdated.subscribe(() => redraw());
        return () => sub.unsubscribe();
    }, [app]);
    const [open, setOpen] = React.useState<Record<string, boolean>>({});
    if (entries.length === 0) return <p className='vor-help'>No structures loaded.</p>;

    const rows: React.ReactNode[] = [];
    const groups = new Map<string, { label: string, entries: LoadedEntry[] }>();
    const order: (LoadedEntry | string)[] = [];
    for (const entry of entries) {
        if (!entry.group) {
            order.push(entry);
            continue;
        }
        let group = groups.get(entry.group.ref);
        if (!group) {
            group = { label: entry.group.label, entries: [] };
            groups.set(entry.group.ref, group);
            order.push(entry.group.ref);
        }
        group.entries.push(entry);
    }
    for (const item of order) {
        if (typeof item !== 'string') {
            rows.push(<EntryRow key={item.ref} app={app} entry={item} hidden={app.isEntryHidden(item.ref)} />);
            continue;
        }
        const group = groups.get(item)!;
        const refs = group.entries.map(e => e.ref);
        const hidden = refs.every(ref => app.isEntryHidden(ref));
        const expanded = open[item] ?? true;
        rows.push(<div key={item} className={`vor-entry-row vor-entry-group ${hidden ? 'vor-entry-hidden' : ''}`}>
            <button className='vor-chip vor-entry-eye' title={hidden ? 'Show all' : 'Hide all'} onClick={() => app.setEntriesHidden(refs, !hidden)}>{hidden ? '○' : '●'}</button>
            <button className='vor-entry-toggle' onClick={() => setOpen({ ...open, [item]: !expanded })}>{expanded ? '▾' : '▸'} {group.label} <span className='vor-entry-count'>{group.entries.length}</span></button>
            <EntryWhoPicker app={app} refOrGroup={item} />
            <button className='vor-chip' onClick={() => void app.removeStructures(refs)}>Remove</button>
        </div>);
        if (!expanded) continue;
        for (const entry of group.entries) {
            rows.push(<EntryRow key={entry.ref} app={app} entry={entry} hidden={app.isEntryHidden(entry.ref)} child />);
        }
    }
    return <div className='vor-stack vor-entries'>{rows}</div>;
}

export const selectEntries = (s: VirusOnTheRockState) => ({
    loadedEntries: s.loadedEntries,
});

export function EntriesCard({ app }: { app: VirusOnTheRockApp }) {
    const state = useStateSlice(app, selectEntries);
    return <ControlCard title='Entries'>
        <details className='vor-disclosure'>
            <summary>Loaded Structures</summary>
            <EntriesTree app={app} entries={state.loadedEntries} />
        </details>
    </ControlCard>;
}
