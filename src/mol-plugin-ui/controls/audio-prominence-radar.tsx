/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { AudioBandDefinition } from '../../mol-plugin-state/manager/audio-reactor';

/**
 * Per-source prominence as a polygon with one axis per source: each vertex travels outward in
 * proportion to that source's prominence, so a source that spikes stretches its axis toward the
 * outer ring while the others retract. The level and onset that produced the score are drawn on
 * the same axis as small ticks, which is what makes the onset half-life and the softmax
 * temperature tunable by eye.
 */

export type AudioProminenceRadarProps<K extends string = string> = {
    sources: readonly AudioBandDefinition<K>[],
    prominence: Record<K, number>,
    level: Record<K, number>,
    onset: Record<K, number>,
    size?: number,
    showLabels?: boolean,
};

const Padding = 22;
/** A single source would score 1 and always sit on the outer ring, which reads as "pegged". */
const MinAxisCount = 2;

function axisPoint(cx: number, cy: number, radius: number, index: number, count: number, value: number) {
    // start at 12 o'clock and go clockwise, like a compass
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / count;
    return [cx + Math.cos(angle) * radius * value, cy + Math.sin(angle) * radius * value] as const;
}

function polygon(cx: number, cy: number, radius: number, count: number, values: readonly number[]) {
    const points: string[] = [];
    for (let i = 0; i < count; ++i) {
        const [x, y] = axisPoint(cx, cy, radius, i, count, values[i]);
        points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
    return points.join(' ');
}

export function AudioProminenceRadar<K extends string>({ sources, prominence, level, onset, size = 160, showLabels = true }: AudioProminenceRadarProps<K>) {
    const count = sources.length;
    if (count < MinAxisCount) return null;

    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - Padding;

    const prominenceValues = sources.map(s => clamp01(prominence[s.key]));
    const levelValues = sources.map(s => clamp01(level[s.key]));
    const onsetValues = sources.map(s => clamp01(onset[s.key]));

    let leaderIndex = 0;
    for (let i = 1; i < count; ++i) {
        if (prominenceValues[i] > prominenceValues[leaderIndex]) leaderIndex = i;
    }
    const hasLeader = prominenceValues[leaderIndex] > 0;

    return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block', margin: '0 auto' }}>
        {[0.25, 0.5, 0.75, 1].map(r => (
            <polygon
                key={r}
                points={polygon(cx, cy, radius, count, new Array(count).fill(r))}
                fill='none'
                stroke='currentColor'
                strokeOpacity={r === 1 ? 0.35 : 0.12}
                strokeWidth={1}
            />
        ))}

        {sources.map((source, i) => {
            const [x, y] = axisPoint(cx, cy, radius, i, count, 1);
            return <line key={source.key} x1={cx} y1={cy} x2={x} y2={y} stroke='currentColor' strokeOpacity={0.12} strokeWidth={1} />;
        })}

        <polygon points={polygon(cx, cy, radius, count, levelValues)} fill='none' stroke='currentColor' strokeOpacity={0.3} strokeWidth={1} strokeDasharray='2 2' />

        <polygon points={polygon(cx, cy, radius, count, prominenceValues)} fill='currentColor' fillOpacity={0.22} stroke='currentColor' strokeOpacity={0.8} strokeWidth={1.5} />

        {sources.map((source, i) => {
            const value = onsetValues[i];
            if (value <= 0) return null;
            const [ix, iy] = axisPoint(cx, cy, radius, i, count, Math.max(0, value - 0.04));
            const [ox, oy] = axisPoint(cx, cy, radius, i, count, Math.min(1, value + 0.04));
            return <line key={source.key} x1={ix} y1={iy} x2={ox} y2={oy} stroke='currentColor' strokeOpacity={0.9} strokeWidth={3} strokeLinecap='round' />;
        })}

        {showLabels && sources.map((source, i) => {
            const [x, y] = axisPoint(cx, cy, radius + 11, i, count, 1);
            const leading = hasLeader && i === leaderIndex;
            return <text
                key={source.key}
                x={x}
                y={y}
                fontSize={8}
                textAnchor={anchorFor(i, count)}
                dominantBaseline='middle'
                fill='currentColor'
                fillOpacity={leading ? 1 : 0.55}
                style={{ fontWeight: leading ? 700 : 400 }}
            >{source.label}</text>;
        })}
    </svg>;
}

function clamp01(value: number) {
    if (!isFinite(value) || value <= 0) return 0;
    return value >= 1 ? 1 : value;
}

function anchorFor(index: number, count: number): 'start' | 'middle' | 'end' {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / count;
    const x = Math.cos(angle);
    if (x > 0.2) return 'start';
    if (x < -0.2) return 'end';
    return 'middle';
}
