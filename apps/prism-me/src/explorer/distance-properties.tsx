/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Button, Slider, type SliderProps } from '@molstar/prism-ui';
import { mapState } from '@molstar/prism-ui/reactive/map-state';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import type { ExplorerApi, NodeRef } from './operations.js';

// A distance's properties (_spec/ui.md, Measurements): its two points (a click picks the point's row), its text size,
// line width and opacity (`stage.editDistance`, one step a release).

const Muted = 'color: var(--msp-color-text-muted); font-size: var(--msp-font-size-xs)';
const Line = 'display: flex; align-items: center; gap: var(--msp-space-2); min-height: 28px';
const Label = 'width: 64px; flex: none';

/** A fraction shown as a percent */
const Percent = {
  format: (v: number) => String(Math.round(v * 100)),
  parse: (text: string) => Number.parseFloat(text.replace(',', '.')) / 100,
  unit: '%',
} as const;

/** A factor: "×1.5" */
const Times = { format: (v: number) => String(Math.round(v * 100) / 100), unit: '×' } as const;

export function DistanceProps(props: { api: ViewerApi; area: ExplorerApi; node: NodeRef }) {
  const { api, area } = props;
  const stage = api.stage;
  if (!stage) return <span style={Muted}>The stage tools are not loaded.</span>;
  const ref = props.node.ref;
  const distance = mapState(stage.distancesState(), (l) => l.find((d) => d.ref === ref));
  const edit = (values: Record<string, unknown>) => void api.run('stage.editDistance', { distance: ref, ...values });
  const point = (which: 'a' | 'b', title: string) => (
    <div style={Line}>
      <span style={Label}>{title}</span>
      <Button
        size="sm"
        variant="ghost"
        title="Pick its row"
        onClick={() => {
          const p = distance.value?.[which];
          if (p) area.revealRow(p.key || (which === 'a' && distance.value?.node) || `o:${p.ref}`);
        }}
      >
        {mapState(distance, (d) => d?.[which].label ?? '')}
      </Button>
    </div>
  );
  return (
    <div style="display: flex; flex-direction: column; gap: var(--msp-space-1)">
      <div style={Line}>
        <span style={Label}>Distance</span>
        <span>{mapState(distance, (d) => d?.label ?? '')}</span>
      </div>
      {point('a', 'From')}
      {point('b', 'To')}
      <Field
        label="Text size"
        value={mapState(distance, (d) => d?.textSize ?? 1)}
        min={0.1}
        max={10}
        scale="log"
        {...Times}
        onCommit={(textSize) => edit({ textSize })}
      />
      <Field
        label="Line width"
        value={mapState(distance, (d) => d?.lineWidth ?? 1)}
        min={0.1}
        max={10}
        scale="log"
        {...Times}
        onCommit={(lineWidth) => edit({ lineWidth })}
      />
      <Field
        label="Opacity"
        value={mapState(distance, (d) => d?.opacity ?? 1)}
        min={0}
        max={1}
        step={0.01}
        {...Percent}
        onCommit={(opacity) => edit({ opacity })}
      />
    </div>
  );
}

function Field(props: SliderProps & { label: string }) {
  const { label, ...slider } = props;
  return (
    <div style={Line}>
      <span style={Label}>{label}</span>
      <div style="flex: 1; min-width: 0">
        <Slider aria-label={label} {...slider} />
      </div>
    </div>
  );
}
