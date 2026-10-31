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
import { Hint, Line, propertiesClasses as classes } from './properties-view.js';

// A measurement's properties (_spec/ui.md §7): a distance's two points, an angle's three, a dihedral's four (a click
// picks the point's row), its text size, line width and opacity (`stage.editDistance`, one step a release). Lines as
// the properties' (properties-view.tsx).

/** A fraction shown as a percent */
const Percent = {
  format: (v: number) => String(Math.round(v * 100)),
  parse: (text: string) => Number.parseFloat(text.replace(',', '.')) / 100,
  unit: '%',
} as const;

/** A measurement's points and their names */
const Titles = {
  distance: [
    ['a', 'From'],
    ['b', 'To'],
  ],
  angle: [
    ['a', 'From'],
    ['b', 'At'],
    ['c', 'To'],
  ],
  dihedral: [
    ['a', 'From'],
    ['b', 'Axis from'],
    ['c', 'Axis to'],
    ['d', 'To'],
  ],
} as const satisfies Record<string, readonly (readonly ['a' | 'b' | 'c' | 'd', string])[]>;

/** A factor: "×1.5" */
const Times = { format: (v: number) => String(Math.round(v * 100) / 100), unit: '×' } as const;

export function DistanceProps(props: { api: ViewerApi; area: ExplorerApi; node: NodeRef }) {
  const { api, area } = props;
  const stage = api.stage;
  if (!stage) return <Hint>The stage tools are not loaded.</Hint>;
  const ref = props.node.ref;
  const distance = mapState(stage.distancesState(), (l) => l.find((d) => d.ref === ref));
  const edit = (values: Record<string, unknown>) => void api.run('stage.editDistance', { distance: ref, ...values });
  // its kind does not change: its points' lines are made once
  const points = Titles[distance.value?.measure ?? 'distance'];
  const point = (which: 'a' | 'b' | 'c' | 'd', title: string) => (
    <Line label={title}>
      <Button
        size="sm"
        variant="ghost"
        title="Pick its row"
        onClick={() => {
          const p = distance.value?.[which];
          if (p) area.revealRow(p.key || (which === 'a' && distance.value?.node) || `o:${p.ref}`);
        }}
      >
        {mapState(distance, (d) => d?.[which]?.label ?? '')}
      </Button>
    </Line>
  );
  return (
    <div class={classes.tight}>
      <Line label="Value">
        <span>{mapState(distance, (d) => d?.label ?? '')}</span>
      </Line>
      {points.map(([which, title]) => point(which, title))}
      <Field
        label="Text size"
        value={mapState(distance, (d) => d?.textSize ?? 1)}
        min={0.1}
        max={100}
        scale="log"
        {...Times}
        onCommit={(textSize) => edit({ textSize })}
      />
      <Field
        label="Line width"
        value={mapState(distance, (d) => d?.lineWidth ?? 1)}
        min={0.1}
        max={100}
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
    <Line label={label}>
      <Slider aria-label={label} {...slider} />
    </Line>
  );
}
