/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 * @author Ludovic Autin <autin@scripps.edu>
 */

import * as React from 'react';
import { Vec4 } from '../../../mol-math/linear-algebra/3d/vec4';
import { useBehavior } from '../../../mol-plugin-ui/hooks/use-behavior';
import { getAudioRouteSourceLabel, getAudioRouteTargetLabel, type AudioRoute } from '../../../mol-plugin-state/manager/audio-routing';
import { type AudioReactiveStatus } from '../../../mol-plugin-state/manager/audio-reactive-animation';
import type { VirusOnTheRockApp } from '../app';

const _sceneCenterScreen = Vec4();

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function sampleFloatSeries(values: ArrayLike<number>, t: number) {
    const count = values.length;
    if (count === 0) return 0;
    if (count === 1) return values[0];

    const clamped = clamp(t, 0, 1) * (count - 1);
    const left = Math.floor(clamped);
    const right = Math.min(count - 1, left + 1);
    const alpha = clamped - left;
    return values[left] * (1 - alpha) + values[right] * alpha;
}

function useWindowSize() {
    const [size, setSize] = React.useState(() => ({
        width: typeof window !== 'undefined' ? window.innerWidth : 1280,
        height: typeof window !== 'undefined' ? window.innerHeight : 720,
    }));

    React.useEffect(() => {
        const update = () => setSize({ width: window.innerWidth, height: window.innerHeight });
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, []);

    return size;
}

function getSceneVisualizerFrame(app: VirusOnTheRockApp, width: number, height: number) {
    const canvas3d = app.viewer.plugin.canvas3d;
    const camera = canvas3d?.camera;
    const sphere = canvas3d?.boundingSphereVisible;
    if (!camera || !sphere || sphere.radius <= 0 || !isFinite(sphere.radius)) {
        return {
            centerX: width * 0.5,
            centerY: height * 0.5,
            sceneRadius: Math.min(width, height) * 0.18,
        };
    }

    const pixelRatio = canvas3d?.webgl.pixelRatio ?? 1;
    camera.project(_sceneCenterScreen, sphere.center);
    const pixelSize = Math.max(camera.getPixelSize(sphere.center), 1e-4);
    return {
        centerX: _sceneCenterScreen[0] / pixelRatio,
        centerY: height - _sceneCenterScreen[1] / pixelRatio,
        sceneRadius: sphere.radius / (pixelSize * pixelRatio),
    };
}

/** the route lines: this many samples (~5 s at the status rate), each line scaled by its own recent maximum */
const RouteLineSamples = 150;
const RouteLineMinScale = 0.25;
const RouteSourceColors: Partial<Record<AudioRoute['source'], string>> = {
    stemDrums: '#ff7b72', stemBass: '#79c0ff', stemOther: '#7ee787', stemVocals: '#d2a8ff',
    beat: '#ffd166', amplitude: '#f0f6fc', subBass: '#4dabf7', bass: '#56d4ff', lowMids: '#63e6be',
    mids: '#a9e34b', highMids: '#ffa94d', treble: '#ff8787', midsTreble: '#e599f7',
};

function buildWavePath(samples: ArrayLike<number>, x0: number, x1: number, centerY: number, amplitude: number) {
    if (samples.length === 0) return '';

    let path = '';
    const dx = samples.length > 1 ? (x1 - x0) / (samples.length - 1) : 0;
    for (let i = 0, il = samples.length; i < il; ++i) {
        const x = x0 + dx * i;
        const y = centerY - samples[i] * amplitude;
        path += `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)} `;
    }
    return path.trimEnd();
}

function getRadialColor(value: number, normalizedIndex: number, hueShift: number) {
    const hue = 196 + hueShift + normalizedIndex * 44;
    const saturation = 90;
    const lightness = 60 + value * 18;
    return `hsla(${hue.toFixed(1)}, ${saturation}%, ${lightness.toFixed(1)}%, ${0.36 + value * 0.58})`;
}

export function AudioVisualizerOverlay(props: {
    app: VirusOnTheRockApp,
    showWaveformLine: boolean,
    showHistogramBars: boolean,
    showRadialVisualizer: boolean,
}) {
    const status = useBehavior(props.app.viewer.plugin.managers.audioReactive.state.status) as AudioReactiveStatus | undefined;
    const { width, height } = useWindowSize();
    const [radialOffset, setRadialOffset] = React.useState(() => ({ x: 0, y: 0 }));
    const [radialScale, setRadialScale] = React.useState(1);
    const routes = useBehavior(props.app.viewer.plugin.managers.audioReactive.state.routes);
    // each route's recent values, a ring per route, pushed once per status update (~30 Hz)
    const historyRef = React.useRef({ values: new Map<number, Float32Array>(), head: 0, lastStatus: undefined as AudioReactiveStatus | undefined });

    if (!status || width <= 0 || height <= 0) return null;

    const { spectrum } = status.visualization;
    const sceneFrame = getSceneVisualizerFrame(props.app, width, height);
    const overlayOpacity = status.playing ? 1 : status.loaded ? 0.58 : 0.22;
    const mix = status.frame.mix;
    const beat = status.frame.beatIntensity;
    const bass = Math.max(status.frame.frequencyBands.subBass, status.frame.frequencyBands.bass);

    const barCount = Math.max(20, Math.min(56, Math.floor(width / 14)));
    const barSpan = Math.min(width * 0.78, 960);
    const barGap = clamp(barSpan / (barCount * 5.5), 2, 6);
    const barWidth = Math.max(2.5, (barSpan - barGap * (barCount - 1)) / barCount);
    const barStartX = (width - (barWidth * barCount + barGap * (barCount - 1))) * 0.5;
    const barBaseY = height - Math.min(42, height * 0.05);
    const barMaxHeight = Math.min(height * 0.24, 170);
    const reflectionMaxHeight = Math.min(height * 0.12, 72);

    // the wave line: one line per enabled audio route, what it sent over the last seconds
    const waveCenterY = barBaseY - Math.min(120, height * 0.14);
    const waveAmplitude = Math.min(height * 0.11, 82);
    if (status !== historyRef.current.lastStatus) {
        historyRef.current.lastStatus = status;
        const head = historyRef.current.head = (historyRef.current.head + 1) % RouteLineSamples;
        for (const route of routes ?? []) {
            let h = historyRef.current.values.get(route.id);
            if (!h) historyRef.current.values.set(route.id, h = new Float32Array(RouteLineSamples));
            h[head] = status.routeValues.get(route.id) ?? 0;
        }
    }
    const routeLines: { id: number, path: string, color: string, label: string, labelX: number, labelY: number }[] = [];
    if (props.showWaveformLine) {
        const enabled = (routes ?? []).filter(r => r.enabled);
        const x0 = width * 0.08, x1 = width * 0.9;
        enabled.forEach((route, k) => {
            const h = historyRef.current.values.get(route.id);
            if (!h) return;
            let max = RouteLineMinScale;
            for (const v of h) if (v > max) max = v;
            const ordered = new Float32Array(RouteLineSamples);
            for (let i = 0; i < RouteLineSamples; i++) ordered[i] = h[(historyRef.current.head + 1 + i) % RouteLineSamples] / max;
            // stacked a little so overlapping lines stay apart
            const centerY = waveCenterY + (k - (enabled.length - 1) / 2) * 10;
            const lastY = centerY - ordered[RouteLineSamples - 1] * waveAmplitude;
            routeLines.push({
                id: route.id,
                path: buildWavePath(ordered, x0, x1, centerY, waveAmplitude),
                color: RouteSourceColors[route.source] ?? '#9fb3c8',
                label: `${getAudioRouteSourceLabel(route.source)} → ${getAudioRouteTargetLabel(route.target)}`,
                labelX: x1 + 8,
                labelY: lastY + 4,
            });
        });
    }

    const now = Date.now();
    const hueShift = Math.sin(now * 0.00032) * 12;
    const radialRotation = now * 0.0035;
    const radialAutoRadius = Math.max(sceneFrame.sceneRadius * 1.18, Math.min(width, height) * 0.2)
        + bass * 18
        + beat * 12;
    const radialBaseRadius = radialAutoRadius * radialScale;
    const radialMaxLength = Math.min(Math.min(width, height) * 0.14, sceneFrame.sceneRadius * 0.4 + 48) * radialScale;
    const radialInnerRadius = radialBaseRadius + mix * 8;
    const radialCount = Math.max(12, Math.min(28, Math.floor(spectrum.length / 2)));
    const radialCenterX = sceneFrame.centerX + radialOffset.x;
    const radialCenterY = sceneFrame.centerY + radialOffset.y;
    const radialHandleRadius = radialInnerRadius + radialMaxLength + 24;

    const beginRadialInteraction = (event: React.PointerEvent<SVGElement>, mode: 'move' | 'scale') => {
        event.preventDefault();
        event.stopPropagation();

        const startPointerX = event.clientX;
        const startPointerY = event.clientY;
        const startOffset = radialOffset;
        const startScale = radialScale;
        const startCenterX = radialCenterX;
        const startCenterY = radialCenterY;
        const startDistance = Math.max(24, Math.hypot(startPointerX - startCenterX, startPointerY - startCenterY));

        const onPointerMove = (moveEvent: PointerEvent) => {
            if (mode === 'move') {
                setRadialOffset({
                    x: startOffset.x + (moveEvent.clientX - startPointerX),
                    y: startOffset.y + (moveEvent.clientY - startPointerY),
                });
            } else {
                const currentDistance = Math.max(24, Math.hypot(moveEvent.clientX - startCenterX, moveEvent.clientY - startCenterY));
                setRadialScale(clamp(startScale * currentDistance / Math.max(24, startDistance), 0.45, 2.6));
            }
        };

        const onPointerUp = () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);
        };

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
    };

    const barRects: {
        x: number,
        y: number,
        height: number,
        reflectionY: number,
        reflectionHeight: number,
        opacity: number,
    }[] = [];
    for (let i = 0; i < barCount; ++i) {
        const t = barCount > 1 ? i / (barCount - 1) : 0;
        const value = Math.pow(sampleFloatSeries(spectrum, t), 0.9);
        const heightPx = 8 + value * barMaxHeight;
        const reflectionHeight = Math.min(reflectionMaxHeight, heightPx * 0.48);
        barRects.push({
            x: barStartX + i * (barWidth + barGap),
            y: barBaseY - heightPx,
            height: heightPx,
            reflectionY: barBaseY + 6,
            reflectionHeight,
            opacity: 0.22 + value * 0.78,
        });
    }

    const radialSegments: {
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        strokeWidth: number,
        glowWidth: number,
        color: string,
        glowOpacity: number,
    }[] = [];
    for (let i = 0; i < radialCount; ++i) {
        const t = radialCount > 1 ? i / (radialCount - 1) : 0;
        const value = Math.pow(sampleFloatSeries(spectrum, t), 0.88);
        const innerRadius = radialInnerRadius + value * 8;
        const outerRadius = innerRadius + 14 + value * radialMaxLength;
        const strokeWidth = 3.4 + value * 4.6;
        const glowWidth = strokeWidth + 7 + value * 5;
        const color = getRadialColor(value, t, hueShift);

        for (const mirror of [0, 1] as const) {
            const angle = (i / radialCount) * Math.PI + mirror * Math.PI;
            const rotation = angle + radialRotation * Math.PI / 180;
            const cos = Math.cos(rotation);
            const sin = Math.sin(rotation);
            radialSegments.push({
                x1: radialCenterX + cos * innerRadius,
                y1: radialCenterY + sin * innerRadius,
                x2: radialCenterX + cos * outerRadius,
                y2: radialCenterY + sin * outerRadius,
                strokeWidth,
                glowWidth,
                color,
                glowOpacity: 0.08 + value * 0.2,
            });
        }
    }

    return <div className='vor-visualizers' aria-hidden='true' style={{ opacity: overlayOpacity }}>
        <svg className='vor-visualizer-svg' viewBox={`0 0 ${width} ${height}`} preserveAspectRatio='none'>
            <defs>
                <linearGradient id='vor-wave-gradient' x1='0%' y1='0%' x2='100%' y2='0%'>
                    <stop offset='0%' stopColor='#8457ff' />
                    <stop offset='52%' stopColor='#b27cff' />
                    <stop offset='100%' stopColor='#49f2ff' />
                </linearGradient>
                <linearGradient id='vor-bar-gradient' x1='0%' y1='100%' x2='0%' y2='0%'>
                    <stop offset='0%' stopColor='#5b40db' />
                    <stop offset='52%' stopColor='#9a61ff' />
                    <stop offset='100%' stopColor='#37e8ff' />
                </linearGradient>
            </defs>

            {props.showRadialVisualizer && <>
                <circle
                    className='vor-radial-ring-shadow'
                    cx={radialCenterX}
                    cy={radialCenterY}
                    r={radialBaseRadius}
                    pointerEvents='none'
                />
                <circle
                    className='vor-radial-ring'
                    cx={radialCenterX}
                    cy={radialCenterY}
                    r={radialBaseRadius}
                    pointerEvents='none'
                />
                <circle
                    className='vor-radial-hit'
                    cx={radialCenterX}
                    cy={radialCenterY}
                    r={radialBaseRadius + 10}
                    fill='transparent'
                    stroke='transparent'
                    strokeWidth={10}
                    pointerEvents='stroke'
                    onPointerDown={event => beginRadialInteraction(event, 'move')}
                />
                <circle
                    className='vor-radial-handle'
                    cx={radialCenterX + radialHandleRadius}
                    cy={radialCenterY}
                    r={11}
                    onPointerDown={event => beginRadialInteraction(event, 'scale')}
                />
                <g className='vor-radial-group'>
                    {radialSegments.map((segment, index) => <React.Fragment key={index}>
                        <line
                            className='vor-radial-segment-glow'
                            x1={segment.x1}
                            y1={segment.y1}
                            x2={segment.x2}
                            y2={segment.y2}
                            stroke={segment.color}
                            strokeWidth={segment.glowWidth}
                            style={{ opacity: segment.glowOpacity }}
                        />
                        <line
                            className='vor-radial-segment'
                            x1={segment.x1}
                            y1={segment.y1}
                            x2={segment.x2}
                            y2={segment.y2}
                            stroke={segment.color}
                            strokeWidth={segment.strokeWidth}
                        />
                    </React.Fragment>)}
                </g>
            </>}

            {routeLines.map(line => <React.Fragment key={line.id}>
                <path className='vor-wave-shadow' d={line.path} />
                <path className='vor-route-line' d={line.path} style={{ stroke: line.color, filter: `drop-shadow(0 0 10px ${line.color})` }} />
                <text className='vor-route-line-label' x={line.labelX} y={line.labelY} fill={line.color}>{line.label}</text>
            </React.Fragment>)}

            {props.showHistogramBars && <g className='vor-bar-group'>
                {barRects.map((bar, index) => <React.Fragment key={index}>
                    <rect
                        className='vor-bar'
                        x={bar.x}
                        y={bar.y}
                        width={barWidth}
                        height={bar.height}
                        rx={barWidth * 0.5}
                        ry={barWidth * 0.5}
                        style={{ opacity: bar.opacity }}
                    />
                    <rect
                        className='vor-bar-reflection'
                        x={bar.x}
                        y={bar.reflectionY}
                        width={barWidth}
                        height={bar.reflectionHeight}
                        rx={barWidth * 0.5}
                        ry={barWidth * 0.5}
                        style={{ opacity: bar.opacity * 0.34 }}
                    />
                </React.Fragment>)}
            </g>}
        </svg>
    </div>;
}
