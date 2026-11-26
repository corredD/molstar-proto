/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 *
 * Route sets after acclaimed audio-visual works (research of 2026-11-25, sources below and in
 * src/apps/virus-on-the-rock/_spec/audio-reactive-research.md), offered next to the saved routings. Their mappings are
 * a reading of each work's look, not its makers' method: most of those were cued by hand or authored in advance, not
 * driven by audio bands. They are routes only: the analysis and the motions stay as they are.
 */

import { AudioAffect, AudioRouteCurve, AudioRouteDraft, AudioRouteSource, AudioRouteTarget, AudioRoutingPreset, defaultAudioAffect } from '../manager/audio-routing';

/**
 * Who a route moves, by part of a mesoscale model: audio-affect.ts finds the part of that name in what is loaded. On a
 * model without parts (a PDB capsid) the route falls back to the first model, so it still moves.
 */
const Membrane: AudioAffect = { level: 'model', entryId: 'mesoscale:membrane' };
const Surface: AudioAffect = { level: 'model', entryId: 'mesoscale:surface' };
const Interior: AudioAffect = { level: 'model', entryId: 'mesoscale:interior' };

type RouteSpec = [source: AudioRouteSource, mode: 'level' | 'onset', target: AudioRouteTarget, gain: number, floor: number, releaseMs: number, affect?: AudioAffect, curve?: AudioRouteCurve];

function routesOf(...specs: RouteSpec[]): AudioRouteDraft[] {
    return specs.map(([source, mode, target, gain, floor, releaseMs, affect, curve]) => ({
        enabled: true, source, mode, curve: curve ?? 'linear', target, gain, floor, releaseMs, affect: affect ?? defaultAudioAffect(),
    }));
}

export type AudioRoutingTemplate = AudioRoutingPreset & { description: string };

export const InspiredRoutings: readonly AudioRoutingTemplate[] = [
    {
        // Ikeda, test pattern (YCAM, https://special.ycam.jp/datamatics/en/testpattern.html); Golden Nica 2001
        // (https://webarchive.ars.electronica.art/festival2001/press/pressprev8e.html)
        version: 1,
        name: 'Datamatics',
        description: 'Hard contrast, nothing smoothed: drum hits flash the background (at most 2.5 flashes a second, for photosensitivity) and light the virion, the treble jitters the inside, the camera holds still. After Ryoji Ikeda, test pattern / datamatics.',
        routes: routesOf(
            ['stemDrums', 'onset', 'background', 2.2, 0, 70, undefined, 'exp'],
            ['stemDrums', 'onset', 'illumination', 1.4, 0.15, 60, undefined, 'exp'],
            ['treble', 'onset', 'instanceRandom', 1.2, 0, 40, Interior],
            ['stemBass', 'onset', 'symAxis', 3, 0, 120],
        ),
    },
    {
        // Geiss, MilkDrop preset authoring (https://www.geisswerks.com/milkdrop/milkdrop_preset_authoring.html)
        version: 1,
        name: 'MilkDrop Breath',
        description: 'Slow breathing: the bass pushes the camera in, the loudness turns the hues, drum hits glow, the melody shivers the surface proteins. After MilkDrop (Geiss): levels against the song, damped copies, long decay.',
        routes: routesOf(
            ['stemBass', 'level', 'cameraZoom', 1.6, 0.1, 500],
            ['songLoudness', 'level', 'colorSpectrum', 0.6, 0, 2500],
            ['stemDrums', 'onset', 'illumination', 0.9, 0, 150],
            ['stemOther', 'level', 'wiggle', 1.4, 0.1, 200, Surface],
        ),
    },
    {
        // Max Cooper / Maxime Causeret, Order from Chaos (https://maxcooper.net/order-from-chaos); phrases of 8/16/32
        // bars (Cursa, DJ phrasing); a band-driven clock (Synesthesia audio uniforms)
        version: 1,
        name: 'Emergence',
        description: 'Order grows with the music: the melody runs a wave over the copies, the voice lights the surface, the bass slowly opens the virion, the loudness turns the camera, which also steps around on phrases. After Max Cooper and Maxime Causeret, Order from Chaos (2016).',
        routes: routesOf(
            ['stemOther', 'level', 'instanceWave', 4, 0, 800],
            ['stemVocals', 'level', 'illumination', 0.9, 0, 500, Surface],
            ['stemBass', 'level', 'symAxis', 2.5, 0.15, 1500],
            ['songLoudness', 'level', 'cameraSpin', 0.5, 0, 1200],
            ['stemDrums', 'onset', 'cameraStep', 1, 0, 120],
        ),
    },
    {
        // Drew Berry, Björk "Hollow" (WEHI, https://wehi.edu.au/wehi-tv/bjork-hollow-music-video)
        version: 1,
        name: 'Hollow Descent',
        description: 'A slow dive: the loudness pushes the camera in, the voice lifts the surface proteins off the membrane, drum hits ripple the membrane along its normal, the melody stirs the inside. After Drew Berry, Björk "Hollow" (2012).',
        routes: routesOf(
            ['songLoudness', 'level', 'cameraZoom', 1.2, 0, 3000],
            // not the clip plane: it moves only a clip object the user has added
            ['stemVocals', 'level', 'instanceNormal', 2, 0, 1200, Surface, 'log'],
            ['stemDrums', 'onset', 'instanceNormal', 2.5, 0, 250, Membrane],
            ['stemOther', 'level', 'wiggle', 1, 0.15, 400, Interior],
        ),
    },
    {
        // sidechain compression (Brad Pack, Sonarworks 2020, https://www.sonarworks.com/blog/learn/sidechain-compression)
        version: 1,
        name: 'Sidechain Pump',
        description: 'The kick owns the beat: it bursts the symmetry axes and ducks everything else, which swells back between hits; the bass breathes the membrane, the hats tick the inside. After sidechain compression: a release of about half a beat.',
        routes: routesOf(
            ['stemDrums', 'onset', 'symAxis', 6, 0, 250, undefined, 'exp'],
            ['stemDrums', 'onset', 'duck', 0.8, 0, 250],
            ['stemBass', 'level', 'instanceNormal', 3, 0, 300, Membrane],
            ['treble', 'onset', 'instanceRandom', 1, 0, 80, Interior],
            ['stemVocals', 'level', 'illumination', 0.7, 0, 400],
        ),
    },
    {
        // kynd, Lilium (BRDG020, 2015) and the Sawako videos (Vice, 2014,
        // https://www.vice.com/en/article/watch-code-generated-watercolors-flow-over-tranquil-tunes/)
        version: 1,
        name: 'Watercolour',
        description: 'Soft and liquid: the voice fades the virion in and out, the melody washes the hues, drum hits send a ripple over the copies, the bass rocks the camera. After kynd (Kenichi Yoneda): Lilium (2015), the Sawako videos.',
        routes: routesOf(
            ['stemVocals', 'level', 'opacity', 1.2, 0, 1500, undefined, 'log'],
            ['stemOther', 'level', 'colorSpectrum', 0.7, 0, 2000, undefined, 'log'],
            ['stemDrums', 'onset', 'instanceWave', 3, 0, 400],
            ['stemBass', 'level', 'cameraRock', 0.6, 0, 1500],
        ),
    },
];
