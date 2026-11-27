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
import { AudioRoute, AudioRouteTarget, getDefaultAudioRoutes } from '../audio-routing';
import { activeTargets, AudioSignal, bassTone, formatGolden, goldenDiffs, kickPeakStats, kickTrack, runAudioPipeline, silence, songMix } from './audio-pipeline-helper';

const Regenerate = !!process.env.AUDIO_GOLDEN;
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

    describe('rest after a pause', () => {
        const paused = () => {
            const s = kickTrack();
            return runAudioPipeline(s, getDefaultAudioRoutes(), { analysis: burst, paused: [[3, 5]] });
        };
        const at = (t: ReturnType<typeof paused>, sec: number) => Math.round(sec * 1000 / 16) - 1;

        // pins today's behaviour; sound-stops deletes this test
        it('today the drives are still open 1.5 s after a pause: decaying tails, not 0', () => {
            const t = paused();
            const i = at(t, 4.5);
            expect(t.drives.symAxis[i]).toBeCloseTo(0.033, 2);
            expect(t.drives.illumination[i]).toBeCloseTo(0.000225, 5);
        });

        // routing spec row: after a pause every drive is exactly 0 within the longest release (400 ms, the illumination
        // route) + one frame (16 ms). Today the wiggle route's floor (0.2) holds it open, and the others only decay: lane
        // `sound-stops` flips this to `it`.
        it.failing('every drive is exactly 0 416 ms (longest release + 1 frame) after a pause (to be met by lane sound-stops)', () => {
            const t = paused();
            const i = at(t, 3 + 0.416);
            for (const k of Object.keys(t.drives) as AudioRouteTarget[]) expect(t.drives[k][i]).toBe(0);
        });
        // pins today's behaviour; sound-stops deletes this test
        it('today the wiggle holds its 0.2 floor plus a tail through a pause', () => {
            const t = paused();
            expect(t.drives.wiggle[at(t, 4)]).toBeCloseTo(0.205, 2);
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
});
