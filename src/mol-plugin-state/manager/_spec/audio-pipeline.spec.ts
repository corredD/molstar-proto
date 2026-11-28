/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * The audio pipeline's measuring stick: synthesized signals through the reactor, the band-stems fallback and the
 * router, frame by frame (16 ms, 48 kHz), as the manager's tick does it. The golden traces and numbers below were
 * recorded from the code of 2026-11-27 (commit "measure"); they are the baseline every later audio lane must reproduce
 * (or, when its brief says "this changes the trace", regenerate in a commit of its own with the diff shown).
 *
 * Reuse: `runAudioPipeline(signal, routes, opts)` from ./audio-pipeline-helper (signals: kickTrack, bassTone, silence,
 * songMix; measuring: kickPeakStats, formatGolden). Route ids come from a global counter: key by route index.
 * Regenerate: `AUDIO_GOLDEN=1 npx jest src/mol-plugin-state/manager/_spec/audio-pipeline` prints GOLDEN and DERIVED.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { AudioReactivePresetDefinitions, getAudioReactivePreset, getPresetRoutes } from '../../helpers/audio-reactive-presets';
import { AudioReactiveFrame, DefaultAudioBandDefinitions, DefaultAudioBandKey } from '../audio-reactor';
import { AudioRestCutoff, AudioRoute, AudioRouteTarget, createAudioRoute, getDefaultAudioRoutes } from '../audio-routing';
import { AudioReactiveAnimationManagerParams, AudioReactiveAnimationManagerValues, getAnalysisLeadSeconds, getAudioDelaySeconds, getStemTimelineLeadSeconds } from '../audio-reactive-animation';
import { StemModelIds, StemModels, StemNames } from '../audio-stems/stem-models';
import { StemSeparator } from '../audio-stems/stem-separator';
import { ParamDefinition as PD } from '../../../mol-util/param-definition';
import { activeTargets, AudioPipelineTrace, AudioSignal, bassTone, formatGolden, goldenDiffs, KickTimes, kickPeakStats, kickTrack, runAudioPipeline, silence, songMix } from './audio-pipeline-helper';

const Regenerate = !!process.env.AUDIO_GOLDEN;
const Chain = { level: 'chain' as const, entryId: '6Q3Q', modelNum: 1, entityId: '1', operatorName: '1', asymId: 'A' };
const Every = 8;

const burst = getAudioReactivePreset('drums-bass-burst').analysis;
const ambient = getAudioReactivePreset('ambient-pulse').analysis;

type Run = { routes: () => AudioRoute[], analysis: typeof burst, signal: () => AudioSignal, cols: AudioRouteTarget[] };
const drumsOnly = () => getDefaultAudioRoutes().filter(r => r.source === 'stemDrums');
const bassOnly = () => getDefaultAudioRoutes().filter(r => r.source === 'stemBass');
const BurstCols: AudioRouteTarget[] = ['symAxis', 'wiggle', 'illumination'];
const AmbientCols: AudioRouteTarget[] = ['wiggle', 'instanceRandom', 'object'];
const Runs: Record<string, Run> = {
    'burst/kick': { routes: getDefaultAudioRoutes, analysis: burst, signal: () => kickTrack(), cols: BurstCols },
    'burst/bass': { routes: getDefaultAudioRoutes, analysis: burst, signal: () => bassTone(), cols: BurstCols },
    'burst/silence': { routes: getDefaultAudioRoutes, analysis: burst, signal: () => silence(), cols: BurstCols },
    'burst/song': { routes: getDefaultAudioRoutes, analysis: burst, signal: () => songMix(), cols: BurstCols },
    'drums-only/kick': { routes: drumsOnly, analysis: burst, signal: () => kickTrack(), cols: ['symAxis'] },
    'bass-only/kick': { routes: bassOnly, analysis: burst, signal: () => kickTrack(), cols: ['symAxis'] },
    'ambient/kick': { routes: () => getPresetRoutes(getAudioReactivePreset('ambient-pulse')), analysis: ambient, signal: () => kickTrack(), cols: AmbientCols },
    'ambient/song': { routes: () => getPresetRoutes(getAudioReactivePreset('ambient-pulse')), analysis: ambient, signal: () => songMix(), cols: AmbientCols },
};

function run(name: string, routes = Runs[name].routes()) {
    const r = Runs[name];
    const signal = r.signal();
    return { signal, trace: runAudioPipeline(signal, routes, { analysis: r.analysis }) };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
function derive(name: string) {
    const { signal, trace } = run(name);
    const s = kickPeakStats(trace, signal.kicksS ?? [], 'symAxis');
    return { lag: [s.lagMedian, s.lagMin, s.lagMax], peak: r3(s.peakMedian), rest: [r3(s.restMedian), r3(s.restMax)] };
}

// <golden> recorded from the code of 2026-11-27: t(s) drums bass then the run's columns, every 8th frame of the first 4 s
const GOLDEN: Record<string, string> = {
    'burst/kick': `
        0.1280 0.0000 0.0000 0.0000 0.2000 0.0000
        0.2560 1.0000 0.1110 7.2217 0.2134 0.0014
        0.3840 0.8096 0.6944 9.2753 0.2655 0.0078
        0.5120 0.4545 0.3896 6.8130 0.2550 0.0066
        0.6400 0.2132 0.2178 4.7290 0.2435 0.0054
        0.7680 1.0000 0.6239 10.5554 0.2651 0.0077
        0.8960 0.7641 0.6607 9.2238 0.2601 0.0072
        1.0240 0.4166 0.3693 6.7099 0.2501 0.0061
        1.1520 0.1923 0.2064 4.6299 0.2395 0.0049
        1.2800 0.9895 0.8137 11.4011 0.2582 0.0067
        1.4080 0.7120 0.6250 8.9153 0.2533 0.0062
        1.5360 0.3780 0.3493 6.4522 0.2442 0.0053
        1.6640 0.1719 0.1952 4.4376 0.2348 0.0042
        1.7920 0.9517 0.8448 9.7415 0.2684 0.0080
        1.9200 0.6848 0.5942 7.7308 0.2616 0.0073
        2.0480 0.3635 0.3321 5.6678 0.2507 0.0061
        2.1760 0.1653 0.1856 3.9277 0.2396 0.0049
        2.3040 0.9836 0.8405 11.2347 0.2702 0.0083
        2.4320 0.6711 0.5625 8.5640 0.2624 0.0075
        2.5600 0.3476 0.3144 6.1168 0.2510 0.0062
        2.6880 0.1558 0.1757 4.1719 0.2397 0.0050
        2.8160 0.9606 0.8286 10.8660 0.2643 0.0076
        2.9440 0.6250 0.5312 8.2516 0.2566 0.0068
        3.0720 0.3164 0.2969 5.8675 0.2461 0.0057
        3.2000 0.1400 0.1659 3.9901 0.2357 0.0045
        3.3280 0.9227 0.8130 10.5254 0.2573 0.0066
        3.4560 0.5753 0.5025 7.9576 0.2501 0.0059
        3.5840 0.2852 0.2808 5.6342 0.2406 0.0049
        3.7120 0.1246 0.1570 3.8207 0.2314 0.0039
        3.8400 0.8875 0.7967 8.9909 0.2668 0.0078
        3.9680 0.5534 0.4777 6.9401 0.2577 0.0069
    `,
    'burst/bass': `
        0.1280 0.0000 0.0000 0.0000 0.2000 0.0000
        0.2560 0.0000 0.0000 0.0000 0.2000 0.0000
        0.3840 0.0000 0.0000 0.0000 0.2000 0.0000
        0.5120 0.0000 0.0000 0.0000 0.2000 0.0000
        0.6400 0.0000 0.0000 0.0000 0.2000 0.0000
        0.7680 0.0000 0.0000 0.0000 0.2000 0.0000
        0.8960 0.0000 0.0000 0.0000 0.2000 0.0000
        1.0240 1.0000 0.5250 9.5245 0.2238 0.0028
        1.1520 0.7641 0.7698 8.7392 0.2218 0.0026
        1.2800 0.4166 0.7698 7.2868 0.2183 0.0022
        1.4080 0.1923 0.7698 6.3991 0.2146 0.0018
        1.5360 0.0804 0.7698 5.8565 0.2113 0.0014
        1.6640 0.0314 0.7698 5.5249 0.2086 0.0011
        1.7920 0.0117 0.7698 5.3222 0.2066 0.0008
        1.9200 0.0042 0.7698 5.1983 0.2050 0.0006
        2.0480 0.0015 0.7698 5.1226 0.2039 0.0005
        2.1760 0.0007 0.7698 5.0763 0.2031 0.0004
        2.3040 0.0004 0.7698 5.0480 0.2025 0.0003
        2.4320 0.0004 0.7698 5.0307 0.2021 0.0002
        2.5600 0.0004 0.7698 5.0202 0.2018 0.0002
        2.6880 0.0004 0.7698 5.0137 0.2016 0.0001
        2.8160 0.0004 0.7698 5.0098 0.2015 0.0001
        2.9440 0.0005 0.7698 5.0074 0.2014 0.0001
        3.0720 0.0006 0.7698 5.0060 0.2013 0.0001
        3.2000 0.0006 0.7698 5.0051 0.2013 0.0001
        3.3280 0.0007 0.7698 5.0058 0.2012 0.0001
        3.4560 0.0007 0.7698 5.0063 0.2012 0.0001
        3.5840 0.0007 0.7698 5.0053 0.2012 0.0000
        3.7120 0.0009 0.7698 5.0072 0.2012 0.0000
        3.8400 0.0007 0.7698 5.0058 0.2012 0.0000
        3.9680 0.0009 0.7698 5.0063 0.2012 0.0000
    `,
    'burst/silence': `
        0.1280 0.0000 0.0000 0.0000 0.2000 0.0000
        0.2560 0.0000 0.0000 0.0000 0.2000 0.0000
        0.3840 0.0000 0.0000 0.0000 0.2000 0.0000
        0.5120 0.0000 0.0000 0.0000 0.2000 0.0000
        0.6400 0.0000 0.0000 0.0000 0.2000 0.0000
        0.7680 0.0000 0.0000 0.0000 0.2000 0.0000
        0.8960 0.0000 0.0000 0.0000 0.2000 0.0000
        1.0240 0.0000 0.0000 0.0000 0.2000 0.0000
        1.1520 0.0000 0.0000 0.0000 0.2000 0.0000
        1.2800 0.0000 0.0000 0.0000 0.2000 0.0000
        1.4080 0.0000 0.0000 0.0000 0.2000 0.0000
        1.5360 0.0000 0.0000 0.0000 0.2000 0.0000
        1.6640 0.0000 0.0000 0.0000 0.2000 0.0000
        1.7920 0.0000 0.0000 0.0000 0.2000 0.0000
        1.9200 0.0000 0.0000 0.0000 0.2000 0.0000
        2.0480 0.0000 0.0000 0.0000 0.2000 0.0000
        2.1760 0.0000 0.0000 0.0000 0.2000 0.0000
        2.3040 0.0000 0.0000 0.0000 0.2000 0.0000
        2.4320 0.0000 0.0000 0.0000 0.2000 0.0000
        2.5600 0.0000 0.0000 0.0000 0.2000 0.0000
        2.6880 0.0000 0.0000 0.0000 0.2000 0.0000
        2.8160 0.0000 0.0000 0.0000 0.2000 0.0000
        2.9440 0.0000 0.0000 0.0000 0.2000 0.0000
        3.0720 0.0000 0.0000 0.0000 0.2000 0.0000
        3.2000 0.0000 0.0000 0.0000 0.2000 0.0000
        3.3280 0.0000 0.0000 0.0000 0.2000 0.0000
        3.4560 0.0000 0.0000 0.0000 0.2000 0.0000
        3.5840 0.0000 0.0000 0.0000 0.2000 0.0000
        3.7120 0.0000 0.0000 0.0000 0.2000 0.0000
        3.8400 0.0000 0.0000 0.0000 0.2000 0.0000
        3.9680 0.0000 0.0000 0.0000 0.2000 0.0000
    `,
    'burst/song': `
        0.1280 0.8096 0.8105 9.4930 0.3277 0.0523
        0.2560 0.4545 0.8099 7.8510 0.3285 0.0523
        0.3840 0.2958 0.9015 7.5363 0.3445 0.0529
        0.5120 0.1546 0.8617 6.8051 0.3522 0.0533
        0.6400 0.0697 0.8391 6.2821 0.4073 0.0590
        0.7680 0.2271 0.9190 7.6016 0.3952 0.0580
        0.8960 0.4872 0.8523 7.9008 0.3839 0.0569
        1.0240 0.2924 0.8339 6.9298 0.3934 0.0652
        1.1520 0.1421 0.8237 6.3092 0.3980 0.0642
        1.2800 0.1943 0.8475 6.7553 0.3874 0.0624
        1.4080 0.3545 0.8956 7.5470 0.3769 0.0605
        1.5360 0.1990 0.8582 6.7978 0.4202 0.0590
        1.6640 0.0934 0.8372 6.2708 0.4125 0.0583
        1.7920 0.4882 0.9137 10.8145 0.3989 0.0573
        1.9200 0.3819 0.8573 8.7962 0.3854 0.0563
        2.0480 0.2213 0.7633 7.4373 0.4059 0.0649
        2.1760 0.1056 0.7380 6.3913 0.3985 0.0638
        2.3040 0.9836 0.7644 10.8589 0.3880 0.0620
        2.4320 0.6711 0.7796 8.7970 0.3777 0.0601
        2.5600 0.3476 0.7472 7.2749 0.4080 0.0602
        2.6880 0.1558 0.7290 6.2864 0.3996 0.0594
        2.8160 0.9606 0.8047 10.6349 0.3887 0.0583
        2.9440 0.6250 0.7707 8.5298 0.3775 0.0571
        3.0720 0.3164 0.7427 7.0970 0.4069 0.0603
        3.2000 0.1400 0.7265 6.1710 0.3979 0.0595
        3.3280 0.9301 0.8315 10.4866 0.3864 0.0583
        3.4560 0.5799 0.7751 8.4029 0.3746 0.0571
        3.5840 0.2875 0.7441 7.0230 0.4091 0.0612
        3.7120 0.1256 0.7272 6.1262 0.3991 0.0602
        3.8400 0.4841 0.8267 8.1943 0.3880 0.0589
        3.9680 0.2905 0.7746 6.9989 0.3763 0.0575
    `,
    'drums-only/kick': `
        0.1280 0.0000 0.0000 0.0000
        0.2560 1.0000 0.1110 6.5000
        0.3840 0.8096 0.6944 3.9729
        0.5120 0.4545 0.3896 2.4283
        0.6400 0.2132 0.2178 1.4842
        0.7680 1.0000 0.6239 6.5000
        0.8960 0.7641 0.6607 3.9729
        1.0240 0.4166 0.3693 2.4283
        1.1520 0.1923 0.2064 1.4842
        1.2800 0.9895 0.8137 6.1121
        1.4080 0.7120 0.6250 3.7358
        1.5360 0.3780 0.3493 2.2834
        1.6640 0.1719 0.1952 1.3956
        1.7920 0.9517 0.8448 4.2500
        1.9200 0.6848 0.5942 2.5977
        2.0480 0.3635 0.3321 1.5877
        2.1760 0.1653 0.1856 0.9704
        2.3040 0.9836 0.8405 5.7473
        2.4320 0.6711 0.5625 3.5128
        2.5600 0.3476 0.3144 2.1471
        2.6880 0.1558 0.1757 1.3123
        2.8160 0.9606 0.8286 5.4043
        2.9440 0.6250 0.5312 3.3032
        3.0720 0.3164 0.2969 2.0189
        3.2000 0.1400 0.1659 1.2340
        3.3280 0.9227 0.8130 5.0817
        3.4560 0.5753 0.5025 3.1060
        3.5840 0.2852 0.2808 1.8984
        3.7120 0.1246 0.1570 1.1604
        3.8400 0.8875 0.7967 3.5336
        3.9680 0.5534 0.4777 2.1598
    `,
    'bass-only/kick': `
        0.1280 0.0000 0.0000 0.0000
        0.2560 1.0000 0.1110 0.7217
        0.3840 0.8096 0.6944 5.3025
        0.5120 0.4545 0.3896 4.3847
        0.6400 0.2132 0.2178 3.2448
        0.7680 1.0000 0.6239 4.0554
        0.8960 0.7641 0.6607 5.2509
        1.0240 0.4166 0.3693 4.2816
        1.1520 0.1923 0.2064 3.1457
        1.2800 0.9895 0.8137 5.2890
        1.4080 0.7120 0.6250 5.1795
        1.5360 0.3780 0.3493 4.1688
        1.6640 0.1719 0.1952 3.0420
        1.7920 0.9517 0.8448 5.4915
        1.9200 0.6848 0.5942 5.1331
        2.0480 0.3635 0.3321 4.0801
        2.1760 0.1653 0.1856 2.9572
        2.3040 0.9836 0.8405 5.4875
        2.4320 0.6711 0.5625 5.0511
        2.5600 0.3476 0.3144 3.9698
        2.6880 0.1558 0.1757 2.8595
        2.8160 0.9606 0.8286 5.4617
        2.9440 0.6250 0.5312 4.9484
        3.0720 0.3164 0.2969 3.8485
        3.2000 0.1400 0.1659 2.7561
        3.3280 0.9227 0.8130 5.4437
        3.4560 0.5753 0.5025 4.8515
        3.5840 0.2852 0.2808 3.7358
        3.7120 0.1246 0.1570 2.6604
        3.8400 0.8875 0.7967 5.4574
        3.9680 0.5534 0.4777 4.7803
    `,
    'ambient/kick': `
        0.1280 0.0000 0.0000 0.2200 0.0000 0.1800
        0.2560 0.0285 0.0044 0.2205 0.0000 0.1805
        0.3840 0.9309 0.4487 0.2666 0.0000 0.2232
        0.5120 0.6391 0.3073 0.2620 0.0000 0.2188
        0.6400 0.3684 0.2060 0.2538 0.0000 0.2113
        0.7680 0.3330 0.1444 0.2458 0.0000 0.2039
        0.8960 0.9027 0.4489 0.2672 0.0000 0.2237
        1.0240 0.6034 0.3045 0.2619 0.0000 0.2188
        1.1520 0.3429 0.2041 0.2535 0.0000 0.2110
        1.2800 1.0000 0.2313 0.2463 0.0000 0.2043
        1.4080 0.8705 0.4395 0.2671 0.0000 0.2236
        1.5360 0.5672 0.2963 0.2613 0.0000 0.2182
        1.6640 0.3178 0.1986 0.2528 0.0000 0.2104
        1.7920 1.0000 0.3376 0.2564 0.0000 0.2137
        1.9200 0.8446 0.4252 0.2670 0.0000 0.2235
        2.0480 0.5406 0.2857 0.2607 0.0000 0.2177
        2.1760 0.2999 0.1915 0.2521 0.0000 0.2097
        2.3040 1.0000 0.4301 0.2636 0.0000 0.2203
        2.4320 0.8297 0.4067 0.2666 0.0000 0.2232
        2.5600 0.5257 0.2727 0.2599 0.0000 0.2169
        2.6880 0.2900 0.1828 0.2513 0.0000 0.2090
        2.8160 1.0000 0.4885 0.2661 0.0000 0.2226
        2.9440 0.7967 0.3914 0.2660 0.0000 0.2226
        3.0720 0.4952 0.2624 0.2589 0.0000 0.2160
        3.2000 0.2701 0.1759 0.2504 0.0000 0.2081
        3.3280 0.9934 0.5035 0.2675 0.0000 0.2240
        3.4560 0.7594 0.3805 0.2656 0.0000 0.2222
        3.5840 0.4626 0.2551 0.2582 0.0000 0.2154
        3.7120 0.2494 0.1710 0.2496 0.0000 0.2074
        3.8400 0.9834 0.5011 0.2679 0.0000 0.2243
        3.9680 0.7309 0.3668 0.2652 0.0000 0.2219
    `,
    'ambient/song': `
        0.1280 0.9352 0.5938 0.3063 0.0000 0.2599
        0.2560 0.6453 0.6179 0.3101 0.0000 0.2634
        0.3840 0.4649 0.6984 0.3247 0.0000 0.2770
        0.5120 0.3005 0.6752 0.3231 0.0000 0.2754
        0.6400 0.1720 0.6565 0.3301 0.0000 0.2819
        0.7680 0.0925 0.6461 0.3269 0.0000 0.2790
        0.8960 0.6563 0.6627 0.3294 0.0000 0.2813
        1.0240 0.4393 0.6464 0.3260 0.0000 0.2782
        1.1520 0.2498 0.6374 0.3278 0.0000 0.2798
        1.2800 0.1376 0.6271 0.3249 0.0000 0.2771
        1.4080 0.6935 0.6963 0.3301 0.0000 0.2820
        1.5360 0.4638 0.6715 0.3276 0.0000 0.2796
        1.6640 0.2636 0.6537 0.3296 0.0000 0.2814
        1.7920 1.0000 0.6895 0.3284 0.0000 0.2804
        1.9200 0.8691 0.6563 0.3292 0.0000 0.2811
        2.0480 0.5657 0.6298 0.3261 0.0000 0.2782
        2.1760 0.3167 0.4824 0.3223 0.0000 0.2747
        2.3040 1.0000 0.4774 0.3144 0.0000 0.2674
        2.4320 0.8010 0.4836 0.3095 0.0000 0.2629
        2.5600 0.4991 0.4661 0.3048 0.0000 0.2585
        2.6880 0.2726 0.4541 0.3020 0.0000 0.2559
        2.8160 0.9986 0.4676 0.3002 0.0000 0.2542
        2.9440 0.7835 0.4766 0.3045 0.0000 0.2583
        3.0720 0.4834 0.4609 0.3027 0.0000 0.2566
        3.2000 0.2625 0.4507 0.3003 0.0000 0.2543
        3.3280 0.9932 0.4669 0.3000 0.0000 0.2541
        3.4560 0.7587 0.4773 0.3042 0.0000 0.2580
        3.5840 0.4620 0.4615 0.3039 0.0000 0.2577
        3.7120 0.2490 0.4510 0.3009 0.0000 0.2549
        3.8400 0.9795 0.4817 0.3032 0.0000 0.2570
        3.9680 0.7211 0.4771 0.3043 0.0000 0.2580
    `,
};
const DERIVED: Record<string, { lag: number[], peak: number, rest: number[] }> = {
    'burst/kick': { lag: [2, 1, 2], peak: 11.401, rest: [0.397, 0.423] },
    'drums-only/kick': { lag: [0, 0, 1], peak: 6.5, rest: [0.223, 0.228] },
    'bass-only/kick': { lag: [2, 2, 2], peak: 5.468, rest: [0.563, 0.575] },
};
// </golden>

describe('audio pipeline (offline, 16 ms frames at 48 kHz)', () => {
    if (Regenerate) {
        it('prints the golden', () => {
            let out = '';
            for (const name of Object.keys(Runs)) {
                const { trace } = run(name);
                out += `GOLDENROWS ${name} cols=${Runs[name].cols.join(',')} active=${activeTargets(trace).join(',')}\n${formatGolden(trace, Runs[name].cols, Every)}\nENDROWS\n`;
                if (name.includes('kick') && !name.startsWith('ambient')) out += `DERIVED ${name} ${JSON.stringify(derive(name))}\n`;
            }
            process.stdout.write(out);
        });
        return;
    }

    for (const name of Object.keys(Runs)) {
        it(`${name}: the drives follow the golden trace`, () => {
            const { trace } = run(name);
            expect(goldenDiffs(trace, Runs[name].cols, GOLDEN[name], Every)).toEqual([]);
            // no other channel moves
            const active = activeTargets(trace).filter(t => !Runs[name].cols.includes(t));
            expect(active).toEqual([]);
        });
    }

    it('the golden comparator is sensitive: an illumination release +10 ms makes a row differ', () => {
        const routes = getDefaultAudioRoutes().map(r => r.target === 'illumination' ? { ...r, releaseMs: r.releaseMs + 10 } : r);
        const { trace } = run('burst/kick', routes);
        expect(goldenDiffs(trace, Runs['burst/kick'].cols, GOLDEN['burst/kick'], Every).length).toBeGreaterThan(0);
    });

    for (const name of Object.keys(DERIVED)) {
        it(`${name}: kick -> symAxis peak lag, rest/peak`, () => {
            const d = derive(name);
            expect(d.lag).toEqual(DERIVED[name].lag);
            expect(d.peak).toBeCloseTo(DERIVED[name].peak, 2);
            expect(d.rest[0]).toBeCloseTo(DERIVED[name].rest[0], 2);
            expect(d.rest[1]).toBeCloseTo(DERIVED[name].rest[1], 2);
        });
    }

    it('the kick peaks within 50 ms + one frame of the kick frame (the spec: <= 50 ms + one frame)', () => {
        const d = derive('burst/kick');
        expect(d.lag[0] * 16).toBeLessThanOrEqual(50 + 16);
    });

    it('gain x2 -> symAxis peak x2', () => {
        const x1 = run('burst/kick').trace;
        const doubled = getDefaultAudioRoutes().map(r => ({ ...r, gain: r.gain * 2 }));
        const x2 = run('burst/kick', doubled).trace;
        const p = (t: typeof x1) => t.drives.symAxis.reduce((m, v) => Math.max(m, v), 0);
        expect(p(x2) / p(x1)).toBeCloseTo(2, 6);
    });

    // routing spec rows "pause", "no floor once stopped", "pause or end of file with delay D", "clear", "stop", "released
    // drive" (lane sound-stops): once nothing is heard every route releases to 0 with its own release and rests at
    // exactly 0 below AudioRestCutoff; the bound is the formula, frame p - 1 + floor(max_j tau_j ln(v_j / 1e-3) / 16) + 1
    describe('rest once the sound stops', () => {
        const F = 16;
        const kickRoutes = () => getDefaultAudioRoutes();
        const frameAt = (sec: number) => Math.round(sec * 1000 / F) - 1;
        /** the first frame the element is paused, for a pause at `sec` (timeMs / 1000 > sec) */
        const firstPaused = (sec: number) => Math.floor(sec * 1000 / F);
        /** the rest frame the formula gives, from the route values on frame `last` (the last frame heard) */
        const restBound = (t: AudioPipelineTrace, routes: readonly AudioRoute[], last: number) => {
            let m = 0;
            routes.forEach((r, j) => {
                const v = t.routeValues[j][last];
                if (v > 0) m = Math.max(m, v < AudioRestCutoff ? 1 : Math.floor(r.releaseMs * Math.log(v / AudioRestCutoff) / F) + 1);
            });
            return last + m;
        };
        const allZero = (t: AudioPipelineTrace, i: number) => (Object.keys(t.drives) as AudioRouteTarget[]).every(k => t.drives[k][i] === 0)
            && t.routeValues.every(r => r[i] === 0);
        const pausedRun = (opts: Parameters<typeof runAudioPipeline>[2] = {}) => {
            const routes = kickRoutes();
            return { routes, t: runAudioPipeline(kickTrack(), routes, { analysis: burst, paused: [[3, 6]], durationS: 7, ...opts }) };
        };
        /** what the lane reports: the time from the pause to exact 0, kick track, Drums & Bass Burst */
        let measuredRestMs = 0;

        it('pause: every drive and route value is exactly 0 by the formula\'s frame, stays 0 until play, and not one frame earlier', () => {
            const { routes, t } = pausedRun();
            const p = firstPaused(3), R = restBound(t, routes, p - 1);
            for (let i = R; i <= frameAt(6); i++) if (!allZero(t, i)) throw new Error(`frame ${i} not at rest`);
            expect(allZero(t, R - 1)).toBe(false);
            // the Drums & Bass Burst bound (wiggle 2.2 at 350 ms: 2.69 s)
            measuredRestMs = (R - (p - 1)) * F;
            expect(measuredRestMs).toBeLessThanOrEqual(2700);
            process.stdout.write(`sound-stops: pause at 3 s, kick track, Drums & Bass Burst: exact 0 after ${measuredRestMs} ms (frame ${R}, last playing ${p - 1})\n`);
        });

        it('no floor once stopped: the wiggle follows its pure release from the last playing value; 0 before the first play', () => {
            const { routes, t } = pausedRun();
            const j = routes.findIndex(r => r.target === 'wiggle');
            const p = firstPaused(3);
            const v = t.routeValues[j][p - 1];
            expect(v).toBeGreaterThan(0.2);
            for (let k = 1; v * Math.exp(-F * k / 350) >= 2 * AudioRestCutoff; k++) {
                expect(t.drives.wiggle[p - 1 + k]).toBeCloseTo(v * Math.exp(-F * k / 350), 9);
            }
            // never played: nothing heard, no floor
            const early = runAudioPipeline(kickTrack(), kickRoutes(), { analysis: burst, paused: [[0, 1]], durationS: 2 });
            for (let i = 0; i < frameAt(1); i++) expect(early.drives.wiggle[i]).toBe(0);
        });

        for (const how of ['pause', 'end of file'] as const) {
            it(`${how} with a stem delay of 1 s: the drives follow the tail (as an unpaused run) for 1 s, then rest by the formula`, () => {
                const routes = kickRoutes();
                const stopOpts = how === 'pause' ? { paused: [[3, 10]] as [number, number][] } : { endedAtS: 3 };
                const t = runAudioPipeline(kickTrack(), routes, { analysis: burst, durationS: 8, stemDelayS: 1, ...stopOpts });
                const ref = runAudioPipeline(kickTrack(), kickRoutes(), { analysis: burst, durationS: 8, stemDelayS: 1 });
                // heard until the first frame not playing + D: the frames at or before 3.008 + 1 s, t < heardUntil
                const lastHeard = frameAt(4);
                const series = (x: AudioPipelineTrace) => [...(Object.keys(x.drives) as AudioRouteTarget[]).map(k => x.drives[k]), x.drums, x.bass, x.other, x.vocals, ...x.routeValues];
                const a = series(t), b = series(ref);
                for (let c = 0; c < a.length; c++) for (let i = 0; i <= lastHeard; i++) if (a[c][i] !== b[c][i]) throw new Error(`series ${c} frame ${i}: ${a[c][i]} vs ${b[c][i]}`);
                // the next frame is not heard: the wiggle's floor is gone
                expect(t.drives.wiggle[lastHeard + 1]).toBeLessThan(ref.drives.wiggle[lastHeard + 1]);
                const R = restBound(t, routes, lastHeard);
                for (let i = R; i < t.count; i++) if (!allZero(t, i)) throw new Error(`frame ${i} not at rest`);
                expect(allZero(t, R - 1)).toBe(false);
            });
        }

        it('the separator samples t - D through the tail and never once nothing is heard', () => {
            const t = runAudioPipeline(kickTrack(), kickRoutes(), { analysis: burst, durationS: 6, stemDelayS: 1, paused: [[3, 10]] });
            // heard from the first play (0.016 s) + D: the line is empty before
            const firstHeard = frameAt(1) + 1, lastHeard = frameAt(4);
            const byFrame = new Map(t.stemSamples.map(s => [s.index, s.time]));
            for (let i = firstHeard; i <= lastHeard; i++) expect(byFrame.get(i)).toBeCloseTo((i + 1) * F / 1000 - 1, 9);
            expect(t.stemSamples.filter(s => s.index < firstHeard || s.index > lastHeard)).toEqual([]);
        });

        it('clear: every drive, route value and scope slot is 0 on the next frame', () => {
            const routes = [...kickRoutes(), createAudioRoute({ enabled: true, source: 'stemDrums', mode: 'level', target: 'wiggle', gain: 1, floor: 0.3, releaseMs: 500, affect: Chain })];
            let clearedAt = -1;
            const scopeCount: number[] = [];
            const t = runAudioPipeline(kickTrack(), routes, {
                analysis: burst, durationS: 6,
                onFrame: ({ index, manager }) => {
                    scopeCount.push(manager.scopeCount);
                    if (index === 300) { manager.clear(); clearedAt = index; }
                },
            });
            expect(allZero(t, clearedAt)).toBe(false);
            expect(scopeCount[clearedAt]).toBe(1);
            for (let i = clearedAt + 1; i < t.count; i++) {
                if (!allZero(t, i)) throw new Error(`frame ${i} not at rest`);
                expect(scopeCount[i]).toBe(0);
            }
        });

        it('stop with a stem delay of 1 s: no tail, the routes release from the stop frame and rest by the formula', () => {
            const routes = kickRoutes();
            const stopAt = firstPaused(3) - 1;
            const t = runAudioPipeline(kickTrack(), routes, {
                analysis: burst, durationS: 6, stemDelayS: 1,
                onFrame: ({ index, manager }) => { if (index === stopAt) manager.stop(); },
            });
            // the next frame is not heard: the wiggle releases, no floor
            const j = routes.findIndex(r => r.target === 'wiggle');
            expect(t.routeValues[j][stopAt + 1]).toBeCloseTo(t.routeValues[j][stopAt] * Math.exp(-F / 350), 12);
            const R = restBound(t, routes, stopAt);
            for (let i = R; i < t.count; i++) if (!allZero(t, i)) throw new Error(`frame ${i} not at rest`);
            expect(allZero(t, R - 1)).toBe(false);
            expect(t.stemSamples.filter(s => s.index > stopAt)).toEqual([]);
        });

        it('no denormal: a route value on a frame not heard is 0 or at least 1e-3', () => {
            const { t } = pausedRun();
            for (let i = firstPaused(3); i <= frameAt(6); i++) {
                for (const r of t.routeValues) if (!(r[i] === 0 || r[i] >= AudioRestCutoff)) throw new Error(`frame ${i}: ${r[i]}`);
            }
        });

        it('latency 100 ms: the presented drives reach 0 exactly 7 frames after the live ones', () => {
            const firstRest = (t: AudioPipelineTrace) => { let r = -1; for (let i = frameAt(6); i >= firstPaused(3) && allZero(t, i); i--) r = i; return r; };
            const live = pausedRun().t, heard = pausedRun({ outputLatency: 0.1 }).t;
            expect(firstRest(live)).toBeGreaterThan(firstPaused(3));
            expect(firstRest(heard)).toBe(firstRest(live) + Math.ceil(100 / F));
        });

        it('a quiet end of the file heard in the tail is not a blocked analysis (review N3)', () => {
            // media silent from 4 s, ended at 6.5 s, D = 3: the tail (6.5-9.5 s) hands over 2.5 s of silence from 7 s on
            const quiet = kickTrack(48000, 10);
            quiet.samples.fill(0, 4 * quiet.sampleRate);
            const blocked: boolean[] = [], heard: boolean[] = [];
            runAudioPipeline(quiet, kickRoutes(), {
                analysis: burst, durationS: 10, stemDelayS: 3, endedAtS: 6.5,
                onFrame: ({ manager }) => { blocked.push(manager.state.status.value.analysisBlocked); heard.push(manager.state.status.value.heardPlaying); },
            });
            expect(heard[frameAt(9.25)]).toBe(true); // still the tail, silent for 2.25 s
            expect(blocked.some(b => b)).toBe(false);
        });

        it('heardPlaying with a stem delay of 1 s: true from D after the first play through the tail, false once nothing is heard', () => {
            const heard: boolean[] = [];
            runAudioPipeline(kickTrack(), kickRoutes(), {
                analysis: burst, durationS: 6, stemDelayS: 1, paused: [[3, 10]],
                onFrame: ({ manager }) => heard.push(manager.state.status.value.heardPlaying),
            });
            // the line is empty for D after the first play (0.016 s)
            const firstHeard = frameAt(1) + 1, lastHeard = frameAt(4);
            expect(heard.slice(0, firstHeard).some(h => h)).toBe(false);
            expect(heard.slice(firstHeard, lastHeard + 1).every(h => h)).toBe(true);
            expect(heard.slice(lastHeard + 1).every(h => !h)).toBe(true);
        });
    });

    // the tail is timed from the stop (the element's pause / ended event, the first tick not playing as a fallback) and
    // the delay now: heardUntil = stoppedAt + D on every tick (review S2)
    describe('the tail is timed from the stop', () => {
        const F = 16;
        const frameAt = (sec: number) => Math.round(sec * 1000 / F) - 1;
        it('the delay raised from 1 to 3 s at 3.5 s, inside the tail of a pause at 3 s: heard until 3 s after the stop', () => {
            const heard: boolean[] = [];
            runAudioPipeline(kickTrack(), getDefaultAudioRoutes(), {
                analysis: burst, durationS: 8, stemDelayS: 1, paused: [[3, 10]],
                onFrame: ({ index, manager }) => {
                    if (index === frameAt(3.5)) manager.setParams({ stemDelaySeconds: 3 });
                    heard.push(manager.state.status.value.heardPlaying);
                },
            });
            // stopped on the frame at 3.008 s (the pause event): heard while t < 6.008
            expect(heard.slice(frameAt(3.5), frameAt(6) + 1).every(h => h)).toBe(true);
            expect(heard.slice(frameAt(6) + 2).every(h => !h)).toBe(true);
        });
        it('ticks stalled 2.5-12 s (a hidden tab), paused at 3 s, delay 6 s: nothing is heard once the ticks come back', () => {
            const heard: boolean[] = [];
            const t = runAudioPipeline(kickTrack(48000, 20), getDefaultAudioRoutes(), {
                analysis: burst, durationS: 20, stemDelayS: 6, paused: [[3, 30]], stalled: [[2.5, 12]],
                onFrame: ({ manager }) => heard.push(manager.state.status.value.heardPlaying),
            });
            // the tail ended at 9.008 s, while no tick ran
            expect(heard.slice(frameAt(12) + 1).every(h => !h)).toBe(true);
            expect(t.stemSamples.filter(s => s.index > frameAt(12))).toEqual([]);
        });
    });

    // a (re)start with an empty delay line (the first play, after a flush, after a pause whose tail has drained): for D
    // seconds the analyser hands over the silence the line holds, known-empty, so not heard: no blocked analysis
    // counted, no heardPlaying, no floor (review S3 and the outside item)
    describe('an empty delay line is not heard', () => {
        const F = 16;
        const frameAt = (sec: number) => Math.round(sec * 1000 / F) - 1;
        const statusRun = (signal: AudioSignal, opts: Parameters<typeof runAudioPipeline>[2]) => {
            const blocked: boolean[] = [], heard: boolean[] = [];
            runAudioPipeline(signal, getDefaultAudioRoutes(), {
                analysis: burst, ...opts,
                onFrame: ({ manager }) => { blocked.push(manager.state.status.value.analysisBlocked); heard.push(manager.state.status.value.heardPlaying); },
            });
            return { blocked, heard };
        };
        it('delay 6 s, played from 0: no blocked analysis, not heard until 6 s, heard after', () => {
            const { blocked, heard } = statusRun(kickTrack(), { durationS: 8, stemDelayS: 6 });
            expect(blocked.some(b => b)).toBe(false);
            expect(heard.slice(0, frameAt(6)).some(h => h)).toBe(false);
            expect(heard.slice(frameAt(6) + 1).every(h => h)).toBe(true);
        });
        it('delay 6 s, resumed at 9.5 s after a pause from 2 s (the tail drained at 8 s): no blocked analysis, not heard for 6 s', () => {
            const { blocked, heard } = statusRun(kickTrack(48000, 20), { durationS: 18, stemDelayS: 6, paused: [[2, 9.5]] });
            expect(blocked.some(b => b)).toBe(false);
            // the first play's empty line until 6 s, then the tail of 0-2 s until 8 s
            expect(heard.slice(0, frameAt(6)).some(h => h)).toBe(false);
            expect(heard.slice(frameAt(6) + 1, frameAt(8)).every(h => h)).toBe(true);
            expect(heard.slice(frameAt(8) + 2, frameAt(15.5)).some(h => h)).toBe(false);
            expect(heard.slice(frameAt(15.5) + 2).every(h => h)).toBe(true);
        });
        it('a resume inside the tail (delay 1 s, paused 3-3.5 s): heard straight through, the line still holds sound', () => {
            const { heard } = statusRun(kickTrack(), { durationS: 6, stemDelayS: 1, paused: [[3, 3.5]] });
            expect(heard.slice(frameAt(1) + 1).every(h => h)).toBe(true);
        });
        it('control: a silent file with a delay of 1 s is blocked 2 s after the line has filled, not before', () => {
            const { blocked } = statusRun(silence(48000, 5), { durationS: 5, stemDelayS: 1 });
            expect(blocked.slice(0, frameAt(3)).some(b => b)).toBe(false);
            expect(blocked.slice(frameAt(3) + 2).every(b => b)).toBe(true);
        });
    });

    // the visuals show what is heard: the manager presents its live state outputLatency late (audio-presented-frame.ts)
    describe('what is heard: the presented frame', () => {
        type Live = {
            currentFrame: AudioReactiveFrame<DefaultAudioBandKey>, currentStems: Record<string, number>, stemsSeparated: boolean,
            router: { drives: Record<string, number>, values: Map<number, number> }, visualization: { waveform: Float32Array, spectrum: Float32Array },
            presented: { stemsSeparated: boolean },
        };
        const targets = (t: AudioPipelineTrace) => Object.keys(t.drives) as AudioRouteTarget[];
        const series = (t: AudioPipelineTrace) => [...targets(t).map(k => t.drives[k]), t.drums, t.bass, t.other, t.vocals, ...t.routeValues];
        const latencyRun = (L: number, paused: readonly (readonly [number, number])[] = [[3, 5]]) => runAudioPipeline(kickTrack(), getDefaultAudioRoutes(), { analysis: burst, paused, outputLatency: L });

        it('latency 0: every presented value is the live value of the same frame, and the presented objects keep their identity', () => {
            let held: unknown[] | undefined;
            let checked = 0;
            const mismatches: string[] = [];
            runAudioPipeline(songMix(), getDefaultAudioRoutes(), {
                analysis: burst, paused: [[3, 4]],
                onFrame: ({ index, manager: m }) => {
                    const live = m as unknown as Live;
                    for (const k of Object.keys(live.router.drives)) if (m.drives[k as AudioRouteTarget] !== live.router.drives[k]) mismatches.push(`${index} drive ${k}`);
                    for (const k of Object.keys(live.currentStems)) if (m.stems[k as keyof typeof m.stems] !== live.currentStems[k]) mismatches.push(`${index} stem ${k}`);
                    for (const [id, v] of live.router.values) if (m.routeValues.get(id) !== v) mismatches.push(`${index} route ${id}`);
                    for (const k of ['amplitude', 'peakAmplitude', 'beatIntensity', 'dominantFrequency', 'dominantFrequencyNormalized', 'mix'] as const) {
                        if (m.frame[k] !== live.currentFrame[k]) mismatches.push(`${index} frame ${k}`);
                        if (m.frame.raw[k] !== live.currentFrame.raw[k]) mismatches.push(`${index} raw ${k}`);
                    }
                    for (const set of ['frequencyBands', 'bandOnsets', 'bandProminence'] as const) {
                        for (const { key } of DefaultAudioBandDefinitions) {
                            if (m.frame[set][key] !== live.currentFrame[set][key]) mismatches.push(`${index} frame ${set}.${key}`);
                            if (m.frame.raw[set][key] !== live.currentFrame.raw[set][key]) mismatches.push(`${index} raw ${set}.${key}`);
                        }
                    }
                    const status = m.state.status.value;
                    if (live.presented.stemsSeparated !== live.stemsSeparated) mismatches.push(`${index} stemsSeparated`);
                    for (const a of ['waveform', 'spectrum'] as const) {
                        for (let i = 0; i < live.visualization[a].length; i++) if (status.visualization[a][i] !== live.visualization[a][i]) mismatches.push(`${index} ${a}[${i}]`);
                    }
                    const now = [m.frame, m.drives, m.stems, m.routeValues, m.scopes, m.scopeKind, m.scopeDrive, status.frame, status.drives, status.routeValues, status.visualization];
                    if (held) now.forEach((o, i) => { if (o !== held![i]) mismatches.push(`${index} identity ${i}`); });
                    else held = now;
                    checked++;
                },
            });
            expect(checked).toBeGreaterThan(500);
            expect(mismatches.slice(0, 5)).toEqual([]);
        });

        it('the source removed (no-audio branch): the presented frame comes to rest k frames later and the status follows it, then stops', () => {
            const amplitude: number[] = [], emitted: number[] = [];
            let removedAt = -1, sub: { unsubscribe(): void } | undefined;
            runAudioPipeline(songMix(), getDefaultAudioRoutes(), {
                analysis: burst, durationS: 6, outputLatency: 0.1,
                onFrame: ({ index, manager: m }) => {
                    amplitude.push(m.frame.amplitude);
                    if (index === 200) {
                        (m.state.audioPlayer.value as unknown as { src: string }).src = '';
                        removedAt = index;
                        sub = m.state.status.subscribe(() => emitted.push(index));
                    }
                },
            });
            sub?.unsubscribe();
            const k = Math.ceil(100 / 16);
            expect(amplitude[removedAt + 1]).toBeGreaterThan(0); // still what is heard
            expect(amplitude[removedAt + k + 1]).toBe(0);
            // one emission at subscribe, then the throttled ones (32 ms) until the presented frame rests
            expect(emitted.length).toBeGreaterThan(2);
            expect(emitted[emitted.length - 1]).toBeLessThanOrEqual(removedAt + k + 3);
        });

        it('heardPlaying is playing as heard: the same at latency 0, k frames late at 100 ms through a pause; each emission carries it', () => {
            const run = (L: number) => {
                const live: boolean[] = [], heard: boolean[] = [], wrong: string[] = [];
                let sub: { unsubscribe(): void } | undefined;
                runAudioPipeline(songMix(), getDefaultAudioRoutes(), {
                    analysis: burst, paused: [[3, 5]], durationS: 7, outputLatency: L,
                    onFrame: ({ index, paused, manager: m }) => {
                        const presented = (m as unknown as { presented: { playing: boolean } }).presented;
                        if (index === 0) sub = m.state.status.subscribe(s => { if (s.heardPlaying !== presented.playing) wrong.push(`${index}`); });
                        live.push(!paused);
                        heard.push(presented.playing);
                    },
                });
                sub?.unsubscribe();
                return { live, heard, wrong };
            };
            const r0 = run(0);
            expect(r0.heard).toEqual(r0.live);
            expect(r0.wrong).toEqual([]);
            const k = Math.ceil(100 / 16);
            const r = run(0.1);
            expect(r.heard.slice(k)).toEqual(r.live.slice(0, r.live.length - k));
            expect(r.heard.some((h, i) => h !== r.live[i])).toBe(true);
            expect(r.wrong).toEqual([]);
        });

        for (const L of [0, 0.1]) {
            it(`clear mid-release while paused, latency ${L * 1000} ms: the last status emitted carries zero drives and route values (review S1)`, () => {
                const atEmission: number[] = [];
                let sub: { unsubscribe(): void } | undefined;
                runAudioPipeline(kickTrack(), getDefaultAudioRoutes(), {
                    analysis: burst, durationS: 6, paused: [[3, 10]], outputLatency: L,
                    onFrame: ({ index, manager: m }) => {
                        if (index !== 230) return;
                        // the values as emitted, not read back through the presented objects later
                        sub = m.state.status.subscribe(st => atEmission.push(Math.max(...Object.values(st.drives), ...st.routeValues.values())));
                        expect(atEmission[0]).toBeGreaterThan(0); // releasing still
                        m.clear();
                    },
                });
                sub?.unsubscribe();
                expect(atEmission[atEmission.length - 1]).toBe(0);
            });
        }

        it('the source removed: the last status emitted says not heard playing', () => {
            const statuses: boolean[] = [];
            let sub: { unsubscribe(): void } | undefined;
            runAudioPipeline(songMix(), getDefaultAudioRoutes(), {
                analysis: burst, durationS: 6, outputLatency: 0.1,
                onFrame: ({ index, manager: m }) => {
                    if (index !== 200) return;
                    (m.state.audioPlayer.value as unknown as { src: string }).src = '';
                    sub = m.state.status.subscribe(s => statuses.push(s.heardPlaying));
                },
            });
            sub?.unsubscribe();
            expect(statuses[0]).toBe(true);
            expect(statuses[statuses.length - 1]).toBe(false);
        });

        for (const L of [0.1, 0.2]) {
            const k = Math.ceil(L * 1000 / 16);
            it(`latency ${L * 1000} ms: the presented trace is the live one ${k} frames late, through a pause`, () => {
                const live = series(latencyRun(0)), heard = series(latencyRun(L));
                let differs = false;
                live.forEach((s0, c) => {
                    const sL = heard[c];
                    for (let i = 0; i < s0.length; i++) {
                        const want = s0[Math.max(0, i - k)];
                        if (sL[i] !== want) throw new Error(`series ${c} frame ${i}: ${sL[i]} vs live ${want} at ${i - k}`);
                        if (sL[i] !== s0[i]) differs = true;
                    }
                });
                expect(differs).toBe(true);
            });

            it(`latency ${L * 1000} ms: kick -> peak lag grows by exactly ${k} frames`, () => {
                // no pause: kickPeakStats places the kicks on the wall clock
                const s0 = kickPeakStats(latencyRun(0, []), KickTimes(10), 'symAxis');
                const sL = kickPeakStats(latencyRun(L, []), KickTimes(10), 'symAxis');
                expect([sL.lagMedian, sL.lagMin, sL.lagMax]).toEqual([s0.lagMedian + k, s0.lagMin + k, s0.lagMax + k]);
            });
        }
    });

    // lane lookahead-sync: the analysis reads the source through a delay of D - lead, so a kick drives its peak on the
    // frame it is heard (routing spec row "kick -> peak with a delay"); with lookahead off nothing changes
    describe('lookahead', () => {
        const F = 16, D = 1;
        const ambientRoutes = () => getPresetRoutes(getAudioReactivePreset('ambient-pulse'));
        const heardKicks = (L: number) => KickTimes(10).map(k => k + D + L);
        const lookaheadRun = (routes: () => AudioRoute[], analysis: typeof burst, lookahead: boolean, L = 0, opts: Parameters<typeof runAudioPipeline>[2] = {}) =>
            runAudioPipeline(kickTrack(48000, 10), routes(), { analysis, durationS: 10 + D, stemDelayS: D, lookahead, outputLatency: L, ...opts });
        const lagOf = (t: AudioPipelineTrace, L: number, target: AudioRouteTarget) => kickPeakStats(t, heardKicks(L), target, 2);

        for (const L of [0, 0.032]) {
            for (const [name, routes] of [['full preset', getDefaultAudioRoutes], ['bass only', bassOnly]] as const) {
                it(`${name}, Drums & Bass Burst, D 1 s, latency ${L * 1000} ms: the heard kick -> symAxis peak within one frame`, () => {
                    const s = lagOf(lookaheadRun(routes, burst, true, L), L, 'symAxis');
                    process.stdout.write(`lookahead: ${name} L ${L * 1000} ms: heard kick -> peak ${s.lagMedian} frames (${s.lagMin}..${s.lagMax})\n`);
                    expect(Math.abs(s.lagMedian)).toBeLessThanOrEqual(1);
                });
            }
            it(`drums only (onset route), latency ${L * 1000} ms: median within one frame, never more than 2 frames early`, () => {
                const s = lagOf(lookaheadRun(drumsOnly, burst, true, L), L, 'symAxis');
                expect(Math.abs(s.lagMedian)).toBeLessThanOrEqual(1);
                expect(s.lagMin).toBeGreaterThanOrEqual(-2);
            });
        }

        for (const frameMs of [16, 37]) {
            it(`drums only, ${frameMs} ms frames: the rest window (shifted by the lead) reads with lookahead what it reads without`, () => {
                // the window 0.4-0.5 s after the heard kick ends on the next kick, whose drive now rises the lead before it
                const run = (on: boolean) => runAudioPipeline(kickTrack(48000, 10), drumsOnly(), { analysis: burst, durationS: 10 + D, stemDelayS: D, lookahead: on, frameMs });
                const off = kickPeakStats(run(false), heardKicks(0), 'symAxis', 2);
                const on = kickPeakStats(run(true), heardKicks(0), 'symAxis', 2, BurstLeadS);
                process.stdout.write(`lookahead rest/peak, drums only, ${frameMs} ms frames: on ${on.restMedian.toFixed(2)} (max ${on.restMax.toFixed(2)}), off ${off.restMedian.toFixed(2)} (max ${off.restMax.toFixed(2)})\n`);
                expect(Math.abs(on.restMedian - off.restMedian)).toBeLessThanOrEqual(0.05);
                expect(Math.abs(on.restMax - off.restMax)).toBeLessThanOrEqual(0.05);
            });
        }

        it('no stem model (the startup configuration): the audio 0.25 s late, the heard kick -> symAxis peak within one frame', () => {
            let delay = NaN;
            const t = runAudioPipeline(kickTrack(48000, 10), getDefaultAudioRoutes(), {
                analysis: burst, durationS: 10, lookahead: true,
                onFrame: ({ index, manager }) => { if (index === 0) delay = (manager as unknown as { delayNode: { delayTime: { value: number } } }).delayNode.delayTime.value; },
            });
            expect(delay).toBe(0.25);
            const s = kickPeakStats(t, KickTimes(10).map(k => k + 0.25), 'symAxis', 2);
            expect(Math.abs(s.lagMedian)).toBeLessThanOrEqual(1);
        });

        for (const target of ['wiggle', 'object'] as const) {
            it(`Ambient Pulse (${target}), D 1 s: the heard kick -> peak within one frame`, () => {
                const s = lagOf(lookaheadRun(ambientRoutes, ambient, true), 0, target);
                process.stdout.write(`lookahead: ambient ${target}: heard kick -> peak ${s.lagMedian} frames (${s.lagMin}..${s.lagMax})\n`);
                expect(Math.abs(s.lagMedian)).toBeLessThanOrEqual(1);
            });
        }

        /** Drums & Bass Burst's lead at 48 kHz: half its input window (1024 at 24 kHz: 2048 samples) + its band attack (12 ms) */
        const BurstLeadS = 2048 / 48000 / 2 + 0.012;
        const series = (x: AudioPipelineTrace) => [...(Object.keys(x.drives) as AudioRouteTarget[]).map(k => x.drives[k]), x.drums, x.bass, x.other, x.vocals, ...x.routeValues];
        const sameUpTo = (a: AudioPipelineTrace, b: AudioPipelineTrace, last: number) => {
            const sa = series(a), sb = series(b);
            for (let c = 0; c < sa.length; c++) for (let i = 0; i <= last; i++) if (sa[c][i] !== sb[c][i]) throw new Error(`series ${c} frame ${i}: ${sa[c][i]} vs ${sb[c][i]}`);
        };
        /** the last frame whose clock (frame i ticks at (i + 1) F) plus `offsetS` is before `untilS` */
        const lastFrameBefore = (untilS: number, offsetS: number) => Math.ceil((untilS - offsetS) * 1000 / F) - 2;

        it('lookahead off (explicitly) is the run without the param, frame for frame', () => {
            const a = lookaheadRun(getDefaultAudioRoutes, burst, false);
            const b = runAudioPipeline(kickTrack(48000, 10), getDefaultAudioRoutes(), { analysis: burst, durationS: 10 + D, stemDelayS: D });
            sameUpTo(a, b, a.count - 1);
        });

        it('a trim that brings the lead to 0 is lookahead off, frame for frame (the stems at t - D too)', () => {
            const a = lookaheadRun(getDefaultAudioRoutes, burst, true, 0, { lookaheadTrimMs: -50 });
            const b = lookaheadRun(getDefaultAudioRoutes, burst, false);
            sameUpTo(a, b, a.count - 1);
            expect(a.stemSamples).toEqual(b.stemSamples);
        });

        it('the audio delay and the lead: the table', () => {
            const v = (p: Partial<AudioReactiveAnimationManagerValues>): AudioReactiveAnimationManagerValues => ({ ...PD.getDefaultValues(AudioReactiveAnimationManagerParams), ...p });
            const htdemucs = StemModels.htdemucs.delaySeconds;
            const delays: [Partial<AudioReactiveAnimationManagerValues>, number][] = [
                [{}, 0],
                [{ stemDelaySeconds: 5 }, 0],
                [{ lookahead: true }, 0.25],
                [{ lookahead: true, stemDelaySeconds: 20 }, 20],
                [{ stemModel: 'htdemucs' }, htdemucs],
                [{ stemModel: 'htdemucs', stemDelaySeconds: 20 }, 20],
                [{ stemModel: 'htdemucs', lookahead: true }, htdemucs],
                [{ stemModel: 'htdemucs', lookahead: true, stemDelaySeconds: 20 }, 20],
            ];
            expect(delays.map(([p]) => getAudioDelaySeconds(v(p)))).toEqual(delays.map(([, d]) => d));
            const leads: [Partial<AudioReactiveAnimationManagerValues>, number, number][] = [
                [{ ...burst }, 48000, 0],
                [{ ...burst, lookahead: true }, 48000, BurstLeadS],
                [{ ...burst, lookahead: true }, 44100, Math.ceil(1024 * 44100 / 24000) / 44100 / 2 + 0.012],
                [{ ...ambient, lookahead: true }, 48000, Math.ceil(2048 * 48000 / 22050) / 48000 / 2 + 0.030],
                [{ ...burst, lookahead: true, lookaheadTrimMs: 20 }, 48000, BurstLeadS + 0.020],
                [{ ...burst, lookahead: true, lookaheadTrimMs: -50 }, 48000, 0],
                [{ ...burst, lookahead: true, stemDelaySeconds: 0.02 }, 48000, 0.02],
            ];
            leads.forEach(([p, sr, lead]) => expect(getAnalysisLeadSeconds(v(p), sr)).toBeCloseTo(lead, 12));
        });

        it('the separator samples t - D + max(0, lead - the model\'s timeline lead) while heard ahead, never before the start or after the stop', () => {
            const t = lookaheadRun(getDefaultAudioRoutes, burst, true, 0, { durationS: 6, paused: [[3, 10]], stemModel: 'htdemucs' });
            const stemLead = Math.max(0, BurstLeadS - StemModels.htdemucs.timelineLeadSeconds);
            // the first play ticks at F; the stop is the first paused frame's clock
            const start = F / 1000, stop = (Math.floor(3000 / F) + 1) * F / 1000;
            const byFrame = new Map(t.stemSamples.map(x => [x.index, x.time]));
            const first = lastFrameBefore(start + D, stemLead) + 1, last = lastFrameBefore(stop + D, stemLead);
            expect([Math.min(...byFrame.keys()), Math.max(...byFrame.keys())]).toEqual([first, last]);
            for (let i = first; i <= last; i++) expect(byFrame.get(i)).toBeCloseTo((i + 1) * F / 1000 - D + stemLead, 9);
            for (const x of t.stemSamples) {
                expect(x.time).toBeGreaterThanOrEqual(start - 1e-9);
                expect(x.time).toBeLessThan(stop);
            }
        });

        it('the stem timeline lead: the model\'s, or the hidden override in ms (clicksync --stem-lead)', () => {
            const v = (p: Partial<AudioReactiveAnimationManagerValues>): AudioReactiveAnimationManagerValues => ({ ...PD.getDefaultValues(AudioReactiveAnimationManagerParams), ...p });
            expect(v({}).stemTimelineLeadMs).toBeNull();
            expect(getStemTimelineLeadSeconds(v({}))).toBe(0);
            for (const id of StemModelIds) {
                expect(getStemTimelineLeadSeconds(v({ stemModel: id }))).toBe(StemModels[id].timelineLeadSeconds);
                expect(getStemTimelineLeadSeconds(v({ stemModel: id, stemTimelineLeadMs: 0 }))).toBe(0);
                expect(getStemTimelineLeadSeconds(v({ stemModel: id, stemTimelineLeadMs: -15 }))).toBe(-0.015);
            }
            // the override moves where the separator samples: lead 0 -> t - D + lead, -15 ms -> 15 ms further ahead
            for (const ms of [0, -15]) {
                const t = lookaheadRun(getDefaultAudioRoutes, { ...burst, stemTimelineLeadMs: ms }, true, 0, { durationS: 3, stemModel: 'htdemucs' });
                const x = t.stemSamples.find(s => s.index === 120)!;
                expect(x.time).toBeCloseTo(121 * F / 1000 - D + BurstLeadS - ms / 1000, 9);
            }
        });

        it('the stems are sampled one heard delay back, the delay node\'s (as heardUntil and the lead), not the params\'', () => {
            // the node reads 1.2 s from frame 100 while the params say 1 s (a browser shows a setValueAtTime a render quantum later)
            type Nodes = { delayNode: { delayTime: { value: number } }, analysisDelayNode: { delayTime: { value: number } } };
            const t = lookaheadRun(getDefaultAudioRoutes, burst, true, 0, {
                durationS: 3,
                onFrame: ({ index, manager }) => {
                    if (index !== 99) return;
                    const n = manager as unknown as Nodes;
                    n.delayNode.delayTime.value = 1.2; n.analysisDelayNode.delayTime.value = 1.2 - BurstLeadS;
                },
            });
            const stemLead = BurstLeadS - StemModels.spleeter.timelineLeadSeconds;
            const after = t.stemSamples.filter(x => x.index >= 100);
            expect(after.length).toBeGreaterThan(50);
            for (const x of after) expect([x.index, x.time]).toEqual([x.index, expect.closeTo((x.index + 1) * F / 1000 - 1.2 + stemLead, 9)]);
        });

        for (const how of ['pause', 'end of file'] as const) {
            it(`${how} mid-kick, D 1 s: the drives are the unpaused run's until stop + D - lead, heard playing until stop + D`, () => {
                const at = 3.27; // the kick at 3.25 s rings until 3.37 s
                const stopOpts = how === 'pause' ? { paused: [[at, 20]] as [number, number][] } : { endedAtS: at };
                const heardPlaying: boolean[] = [];
                const t = lookaheadRun(getDefaultAudioRoutes, burst, true, 0, { durationS: 8, ...stopOpts, onFrame: ({ manager }) => heardPlaying.push(manager.state.status.value.heardPlaying) });
                const ref = lookaheadRun(getDefaultAudioRoutes, burst, true, 0, { durationS: 8 });
                // the media enters the graph until the last playing frame's clock; the stop (the pause / ended event) is the next frame's
                const audioStop = Math.floor(at * 1000 / F) * F / 1000, stop = audioStop + F / 1000;
                const lastSame = lastFrameBefore(audioStop + D, BurstLeadS);
                const lastAnalysed = lastFrameBefore(stop + D, BurstLeadS), lastHeard = lastFrameBefore(stop + D, 0);
                expect(lastHeard - lastAnalysed).toBe(2);
                sameUpTo(t, ref, lastSame);
                // from here the analysis reads the silence after the stop, the lead ahead of what is heard
                expect(series(t).some((x, c) => x[lastSame + 1] !== series(ref)[c][lastSame + 1])).toBe(true);
                // not read once nothing is heard the lead ahead; the router holds the floor until lastHeard
                expect([t.analysed[lastAnalysed], t.analysed[lastAnalysed + 1]]).toEqual([1, 0]);
                // heard: the wiggle's floor holds; the next frame is not: its pure release, no floor
                const w = getDefaultAudioRoutes().findIndex(r => r.target === 'wiggle');
                expect(t.routeValues[w][lastHeard]).toBeGreaterThan(0.2);
                expect(t.routeValues[w][lastHeard + 1]).toBeCloseTo(t.routeValues[w][lastHeard] * Math.exp(-F / getDefaultAudioRoutes()[w].releaseMs), 9);
                expect(heardPlaying.lastIndexOf(true)).toBe(lastHeard);
            });
        }

        it('a (re)start: not heard for D, analysed from D - lead, no blocked analysis', () => {
            const blocked: boolean[] = [], heardPlaying: boolean[] = [];
            // played from 0, paused 2-4 s (the tail drains at 3 s), resumed at 4 s with an empty line
            const t = lookaheadRun(getDefaultAudioRoutes, burst, true, 0, {
                durationS: 7, paused: [[2, 4]],
                onFrame: ({ manager }) => { blocked.push(manager.state.status.value.analysisBlocked); heardPlaying.push(manager.state.status.value.heardPlaying); },
            });
            const resume = (Math.floor(4000 / F) + 1) * F / 1000;
            for (const start of [F / 1000, resume]) {
                const s = Math.round(start * 1000 / F) - 1;
                const firstAnalysed = lastFrameBefore(start + D, BurstLeadS) + 1, firstHeard = lastFrameBefore(start + D, 0) + 1;
                expect(firstHeard - firstAnalysed).toBe(2);
                for (let i = s; i < firstAnalysed; i++) expect([i, t.analysed[i]]).toEqual([i, 0]);
                for (let i = firstAnalysed; i < firstAnalysed + 10; i++) expect([i, t.analysed[i]]).toEqual([i, 1]);
                for (let i = s; i < firstHeard; i++) expect([i, heardPlaying[i]]).toEqual([i, false]);
                expect(heardPlaying[firstHeard]).toBe(true);
            }
            expect(blocked.some(b => b)).toBe(false);
        });

        it('a trim or preset change moves only the analysis delay (no separator reset); a delay change moves both and resets', () => {
            type Nodes = { delayNode: { delayTime: { value: number } }, analysisDelayNode: { delayTime: { value: number } } };
            const delays: [number, number][] = [];
            const t = lookaheadRun(getDefaultAudioRoutes, burst, true, 0, {
                durationS: 2,
                onFrame: ({ index, manager }) => {
                    const n = manager as unknown as Nodes;
                    if (index === 10) delays.push([n.delayNode.delayTime.value, n.analysisDelayNode.delayTime.value]);
                    if (index === 10) manager.setParams({ lookaheadTrimMs: 10 });
                    if (index === 11) delays.push([n.delayNode.delayTime.value, n.analysisDelayNode.delayTime.value]);
                    if (index === 11) manager.setParams({ bandAttackMs: 20 });
                    if (index === 12) delays.push([n.delayNode.delayTime.value, n.analysisDelayNode.delayTime.value]);
                    if (index === 20) manager.setParams({ stemDelaySeconds: 2 });
                    if (index === 21) delays.push([n.delayNode.delayTime.value, n.analysisDelayNode.delayTime.value]);
                },
            });
            const expected = [[1, 1 - BurstLeadS], [1, 1 - BurstLeadS - 0.010], [1, 1 - BurstLeadS - 0.018], [2, 2 - BurstLeadS - 0.018]];
            delays.forEach(([d, a], i) => { expect(d).toBeCloseTo(expected[i][0], 9); expect(a).toBeCloseTo(expected[i][1], 9); });
            // setParams before the run sets the delay (one reset, frame -1); the delay change at frame 20 resets
            expect(t.stemResets).toEqual([-1, 20]);
        });

        describe('the stems line up with the bands', () => {
            // a stub of HTDemucs' timeline (stem-models.ts createHTDemucs, 44.1 kHz): frame t is stamped at t 1024 + 512 (the
            // worker stamps it in context time) and its energy is the frequency branch's, a centred Hann STFT of 4096 (its
            // energy weights x^2 by Hann^2), plus the time branch's, the x^2 of the 1024 samples [t 1024, (t + 1) 1024); each
            // scaled to one hop of a steady signal (50/50). Drums and bass are the kick
            const sig = kickTrack(48000, 10);
            const at = (s44: number) => s44 / 44100 * 48000; // a 44.1 kHz sample position in the 48 kHz track
            const half = Math.round(at(2048)), hopSamples = at(1024);
            let hann2 = 0;
            for (let j = -half; j < half; j++) hann2 += (0.5 - 0.5 * Math.cos(Math.PI * (j + half) / half)) ** 2;
            const times: number[] = [], kick: number[] = [];
            for (let t = 0; at(t * 1024) < sig.samples.length; t++) {
                const ci = Math.round(at(t * 1024 + 512));
                let freq = 0, time = 0;
                for (let j = -half; j < half; j++) { const x = sig.samples[ci + j] ?? 0; freq += (0.5 - 0.5 * Math.cos(Math.PI * (j + half) / half)) ** 2 * x * x; }
                for (let i = Math.round(at(t * 1024)); i < Math.round(at((t + 1) * 1024)); i++) { const x = sig.samples[i] ?? 0; time += x * x; }
                times.push((t * 1024 + 512) / 44100); kick.push(freq * hopSamples / hann2 + time);
            }
            const separator = () => {
                const sep = new StemSeparator({} as AudioContext, {} as AudioNode, { workerUrl: '', wasmPath: '', localBaseUrls: [] }, () => { });
                const s = sep as unknown as { model: string, epoch: number, onWorkerMessage(msg: unknown): void };
                s.model = 'htdemucs';
                const energies = Object.fromEntries(StemNames.map(n => [n, Float32Array.from(n === 'drums' || n === 'bass' ? kick : kick.map(() => 1e-9))]));
                s.onWorkerMessage({ type: 'stems', model: 'htdemucs', times: Float64Array.from(times), energies, computeMs: 0, audioMs: 1, epoch: s.epoch });
                return sep;
            };
            const stemRun = (shiftS: number | undefined, frameMs: number, routes: () => AudioRoute[]) => {
                const sep = separator();
                const stemSample = shiftS === undefined ? undefined : (time: number, dtMs: number, a: number, r: number) => sep.sample(time + shiftS, dtMs, a, r);
                return runAudioPipeline(sig, routes(), { analysis: burst, durationS: 10 + D, stemDelayS: D, lookahead: true, stemSample, frameMs, stemModel: 'htdemucs' });
            };
            // 4 ms frames: the timing in ms, not in 16 ms steps. The drums (onset route) and the bass (level route) of the
            // stub carry the kick; the band stand-ins are the reference. With this framing both stems peak a little behind
            // the bands (drums 4 ms, bass 8 ms)
            const lagMs = (t: AudioPipelineTrace) => lagOf(t, 0, 'symAxis').lagMedian * 4;
            for (const [name, routes, sign] of [['drums only (onset route)', drumsOnly, 1], ['bass only (level route)', bassOnly, 1]] as const) {
                it(`${name}: the separated stem peaks within 10 ms of the band stand-in, ${sign < 0 ? 'ahead' : 'behind'}; sampled at t - D + lead (control) it peaks earlier, further off`, () => {
                    const bands = lagMs(stemRun(undefined, 4, routes)), stems = lagMs(stemRun(0, 4, routes)), control = lagMs(stemRun(StemModels.htdemucs.timelineLeadSeconds, 4, routes));
                    process.stdout.write(`lookahead stems, ${name}, 4 ms frames: kick -> peak bands ${bands} ms, separated ${stems} ms, control ${control} ms\n`);
                    expect(Math.abs(stems - bands)).toBeLessThanOrEqual(10);
                    expect(Math.sign(stems - bands)).toBe(sign);
                    expect(control).toBeLessThan(stems);
                    expect(bands - control).toBeGreaterThan(Math.abs(stems - bands));
                });
            }
        });
    });

    describe('a route on a motion that is off', () => {
        // the motion each target needs (copy of enableMotionsFor, apps/virus-on-the-rock/ui/cards/audio-routing.tsx)
        const flagOf = (t: AudioRouteTarget) => t === 'wiggle' ? 'atomWiggleEnabled'
            : ['symAxis', 'instanceRandom', 'instanceAxis', 'instanceNormal'].includes(t) ? 'instanceTumbleEnabled'
                : t === 'object' ? 'objectTransformEnabled' : undefined;
        const dead = (name: string) => {
            const preset = AudioReactivePresetDefinitions.find(p => p.name === name)!;
            const anim = preset.animation as Record<string, unknown>;
            return getPresetRoutes(preset).filter(r => r.enabled && flagOf(r.target) && anim[flagOf(r.target)!] === false).map(r => `${r.source}->${r.target}`);
        };
        it('the other presets make no dead route', () => {
            for (const p of AudioReactivePresetDefinitions) if (p.name !== 'ambient-pulse') expect([p.name, dead(p.name)]).toEqual([p.name, []]);
        });
        it('ambient-pulse makes no dead route (met by lane motions-follow-routes)', () => {
            expect(dead('ambient-pulse')).toEqual([]);
        });
    });

    describe('stem events', () => {
        const D = 1, F = 16;
        // no release: each event is a one-frame spike, so its frame and value read off the drive
        const kickRoute = () => [createAudioRoute({ enabled: true, source: 'stemKick', mode: 'level', target: 'symAxis', gain: 1, floor: 0, releaseMs: 0 })];
        /** kicks at `times` (audio-context = media seconds), each `dbfs`, posted as one worker batch live until 30 s */
        const kicks = (times: number[], dbfs: (i: number) => number = () => -6) => ({
            from: 0, until: 30, times: Float64Array.from(times), dbfs: Float32Array.from(times, (_, i) => dbfs(i)), kinds: new Uint8Array(times.length),
        });
        const KickAt = [2.5, 3.5, 4.5, 5.5];
        /** the first frame of each burst: the drive rising from 0 */
        const onsets = (t: AudioPipelineTrace) => {
            const out: number[] = [];
            for (let i = 1; i < t.count; i++) if (t.drives.symAxis[i] > 0 && t.drives.symAxis[i - 1] === 0) out.push(i);
            return out;
        };
        /** the frame whose clock first reaches `s`: frame i ticks at (i + 1) F */
        const frameAt = (s: number) => Math.ceil(s * 1000 / F - 1e-9) - 1;

        for (const [lookahead, trim] of [[false, 0], [true, 0], [true, 100]] as const) {
            for (const L of [0, 0.032]) {
                it(`a kick event moves symAxis once, on the frame it is heard, ±1 frame (D 1 s; lookahead ${lookahead ? `on, trim ${trim} ms` : 'off'}; latency ${L * 1000} ms)`, () => {
                    const t = runAudioPipeline(silence(48000, 8), kickRoute(), { durationS: 8, stemDelayS: D, stemModel: 'htdemucs', lookahead, lookaheadTrimMs: trim, outputLatency: L, stemEvents: kicks(KickAt) });
                    const got = onsets(t);
                    expect(got.length).toBe(KickAt.length);
                    // one frame each: an event fires once
                    expect(t.drives.symAxis.filter(x => x > 0).length).toBe(KickAt.length);
                    // with a 100 ms lead too: events are read at t - D, with no lead
                    got.forEach((i, k) => expect(Math.abs(i - frameAt(KickAt[k] + D + L))).toBeLessThanOrEqual(1));
                });
            }
        }

        // the frame shown when a kick is heard: the router's entry of a tick is shown once now - L reaches its stamp, so a
        // kick read at t - D fires late by up to a frame and is shown later still (headed clicksync, HTDemucs on the GPU,
        // ~64 ms frames: 77 ms late). The kick must show on the frame heard nearest to it
        for (const [frameMs, L] of [[16, 0], [16, 0.032], [64, 0], [64, 0.032], [37, 0.032], [50, 0.1]] as const) {
            it(`a kick event shows on the frame heard nearest to it, within half a frame (${frameMs} ms frames, latency ${L * 1000} ms)`, () => {
                const at = Array.from({ length: 8 }, (_, k) => 2.5 + k * 0.531);
                const t = runAudioPipeline(silence(48000, 8), kickRoute(), { durationS: 8, stemDelayS: D, stemModel: 'htdemucs', frameMs, outputLatency: L, stemEvents: kicks(at) });
                const shown: number[] = [];
                for (let i = 1; i < t.count; i++) if (t.drives.symAxis[i] > 0 && t.drives.symAxis[i - 1] === 0) shown.push(i);
                expect(shown.length).toBe(at.length);
                expect(t.drives.symAxis.filter(x => x > 0).length).toBe(at.length);
                // frame i is heard at its clock less the latency
                const lagsMs = shown.map((i, k) => ((i + 1) * frameMs / 1000 - L - D - at[k]) * 1000);
                for (const lag of lagsMs) expect(Math.abs(lag)).toBeLessThanOrEqual(frameMs / 2 + 1);
            });
        }

        it('alternating 1 / 0.5 kicks keep the burst order: each 6 dB softer kick bursts 1 - 6 / 18 of the loud one', () => {
            const times = [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5];
            const t = runAudioPipeline(silence(48000, 8), kickRoute(), { durationS: 8, stemDelayS: D, stemModel: 'htdemucs', stemEvents: kicks(times, i => i % 2 ? -12 : -6) });
            const peaks = onsets(t).map(i => t.drives.symAxis[i]);
            expect(peaks.length).toBe(times.length);
            for (let k = 0; k + 1 < peaks.length; k += 2) {
                expect(peaks[k]).toBeGreaterThan(0.95);
                expect(peaks[k + 1] / peaks[k]).toBeGreaterThan(0.6);
                expect(peaks[k + 1] / peaks[k]).toBeLessThan(0.72);
            }
        });

        it('no events (none posted, or no stem model): the event route never moves', () => {
            const none = runAudioPipeline(silence(48000, 6), kickRoute(), { durationS: 6, stemDelayS: D, stemModel: 'htdemucs', stemEvents: kicks([]) });
            expect(none.drives.symAxis.every(x => x === 0)).toBe(true);
            const noModel = runAudioPipeline(kickTrack(48000, 6), kickRoute(), { durationS: 6 });
            expect(noModel.drives.symAxis.every(x => x === 0)).toBe(true);
        });

        it('Drums & Bass Burst with live events: the kick and bass-note routes drive symAxis, the stand-ins rest', () => {
            const routes = getDefaultAudioRoutes();
            const sources = routes.map(r => `${r.source}${r.standIn ? ' (stand-in)' : ''}->${r.target} ${r.mode} ${r.gain}/${r.releaseMs}`);
            expect(sources).toEqual([
                'stemDrums (stand-in)->symAxis onset 6.5/260', 'stemBass (stand-in)->symAxis level 6.5/220',
                'stemOther->wiggle level 2/350', 'stemVocals->illumination level 0.6/400',
                'stemKick->symAxis level 6.5/120', 'stemBassNote->symAxis level 3/120',
            ]);
            // the kick track's band stems would drive symAxis; with events live and none in it, nothing does
            const quiet = runAudioPipeline(kickTrack(48000, 6), getDefaultAudioRoutes(), { analysis: burst, durationS: 6, stemDelayS: D, stemModel: 'htdemucs', stemEvents: kicks([]) });
            expect(quiet.drives.symAxis.every(x => x === 0)).toBe(true);
            expect(quiet.drives.wiggle.some(x => x > 0)).toBe(true);
            // a kick, the loudest: 6.5; a bass note 9 dB under the one before it: 3 x 0.5 (its loud level fell 0.06 dB since)
            const ev = { from: 0, until: 30, times: Float64Array.from([2.5, 3.4, 3.5]), dbfs: Float32Array.from([-6, -6, -15]), kinds: Uint8Array.from([0, 2, 2]) };
            const hit = runAudioPipeline(silence(48000, 6), getDefaultAudioRoutes(), { analysis: burst, durationS: 6, stemDelayS: D, stemModel: 'htdemucs', stemEvents: ev });
            expect(Math.max(...hit.drives.symAxis)).toBeCloseTo(6.5, 5);
            const i = frameAt(3.5 + D);
            expect(Math.max(...hit.drives.symAxis.slice(i - 1, i + 2))).toBeGreaterThan(3 * (-15 + 6.06 + 18) / 18 - 1e-3);
        });

        it('before the events\' coverage starts (a model switched mid-play, the delay kept): the stand-ins drive symAxis', () => {
            const t = runAudioPipeline(kickTrack(48000, 8), getDefaultAudioRoutes(), { analysis: burst, durationS: 8, stemDelayS: D, stemModel: 'htdemucs', stemEvents: { ...kicks([]), from: 4 } });
            let max = 0;
            for (let i = 0; i < t.count; i++) { const heard = t.timeMs[i] / 1000 - D; if (heard >= 2 && heard < 3.9) max = Math.max(max, t.drives.symAxis[i]); }
            expect(max).toBeGreaterThan(1);
        });

        it('a pause: the kicks in what is not heard never fire, nor after the resume', () => {
            const t = runAudioPipeline(silence(48000, 10), kickRoute(), { durationS: 10, stemDelayS: D, stemModel: 'htdemucs', stemEvents: kicks([2.5, 4.5, 7.5]), paused: [[3, 5]] });
            // 2.5 is heard at 3.5, in the tail of the pause at 3; 4.5 would be at 5.5, not heard (the line refills until
            // 6); 7.5 at 8.5
            const got = onsets(t);
            expect(got.length).toBe(2);
            expect(Math.abs(got[0] - frameAt(2.5 + D))).toBeLessThanOrEqual(1);
            expect(Math.abs(got[1] - frameAt(7.5 + D))).toBeLessThanOrEqual(1);
        });
    });
});
