/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { PluginContext } from '../../../mol-plugin/context';
import { AudioReactiveAnimationManager } from '../audio-reactive-animation';

const plugin = { managers: { structure: { hierarchy: { current: { models: [], structures: [] } } } } } as unknown as PluginContext;

describe('stem listening state', () => {
    it('a stem is heard only with a model; each change emits once, none when unchanged', () => {
        const manager = new AudioReactiveAnimationManager(plugin);
        const seen: boolean[] = [];
        manager.state.stemListen.subscribe(v => seen.push(v.drums));
        manager.setStemListen('drums', true);
        // no model: refused
        expect(manager.state.stemListen.value.drums).toBe(false);
        manager.setParams({ stemModel: 'spleeter' });
        manager.setStemListen('drums', true);
        manager.setStemListen('drums', true);
        expect(manager.state.stemListen.value.drums).toBe(true);
        expect(seen).toEqual([false, true]);
    });

    it('Off clears it', () => {
        const manager = new AudioReactiveAnimationManager(plugin);
        manager.setParams({ stemModel: 'htdemucs' });
        manager.setStemListen('drums', true);
        manager.setStemListen('vocals', true);
        manager.setParams({ stemModel: 'off' });
        expect(Object.values(manager.state.stemListen.value)).toEqual([false, false, false, false]);
    });
});
